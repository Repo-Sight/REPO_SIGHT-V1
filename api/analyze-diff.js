// api/analyze-diff.js
//
// POST /api/analyze-diff
// Body: {
//   "diff":  "<unified diff text>",                    // git diff / git diff --cached / .diff URL body
//   "files": [ { "path": "src/a.js", "content": "<full file AFTER the change>" }, ... ]
// }
//
// Diff-aware hook: reports only the findings a change INTRODUCED -- findings
// that sit on lines the diff added -- instead of re-reporting the whole
// repository. Intended consumers: a CI step / GitHub Action posting PR
// comments, a pre-push check, or any script that can run `git diff`.
//
// Why `files` is required: the analyser needs whole files (a hunk alone has
// unbalanced braces and no function context, so complexity / length / nesting
// rules would be wrong). The diff says WHICH lines are new; the supplied post-
// change file contents say WHAT the code is. A diff entry with no matching
// `files` entry is reported under `skipped`, never guessed at.
//
// Stateless by design: nothing is stored in Supabase, no history row, no auth
// needed, and submitted source is deleted from /tmp before the response goes
// out. Mirrors api/analyze-file.js's pipeline shape and time budget.
//
// Response (all string fields derived from scanned source -- e.g. `message` --
// must be escaped by consumers like any other violation message):
//   {
//     schemaVersion: 1, mode: "diff",
//     summary: { filesInDiff, filesAnalyzed, addedLines, introduced,
//                byTier: {critical,high,medium,low}, preexistingInTouchedFiles },
//     fixFirst:   [...],   // same shape as the full-report fixFirst, introduced findings only
//     introduced: [...],   // violations with repo-relative `path`, ranked, capped
//     introducedTruncated: boolean,
//     skipped:    [ { path, reason } ]
//   }
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, readdir, stat, writeFile } from "node:fs/promises";
import { join, dirname, extname, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { enrichReport, scoreOf } from "./_lib/enrich.js";
import { parseUnifiedDiff, safeRelPath, splitViolationsByDiff } from "./_lib/diff.js";

const execFileAsync = promisify(execFile);

const CMA_BINARY = join(process.cwd(), "backend", "bin", "linux-x64-cma");

// Same budget as api/analyze-file.js (vercel.json maxDuration is 15 for this
// function); keep our own deadline under it so we can return JSON first.
const OVERALL_TIMEOUT_MS = 12_000;
const CMA_TIMEOUT_MS     = 10_000;

// Resource limits on untrusted input (Sections 12/40). Vercel rejects request
// bodies above ~4.5 MB, so the total stays under that.
const MAX_DIFF_BYTES  = 1 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_FILES       = 100;
const MAX_INTRODUCED  = 500;

// Mirrors api/analyze-file.js / analyser FileScanner kSupportedExtensions.
// Keep in sync manually when a language is added.
const SUPPORTED_EXTENSIONS = new Set([
  ".cpp", ".cc", ".cxx", ".c++",
  ".h", ".hpp", ".hxx", ".h++",
  ".py",
  ".java",
  ".ts", ".tsx",
  ".js", ".mjs", ".cjs", ".jsx",
  ".cs",
]);

class PipelineTimeoutError extends Error {}

function withDeadline(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const t = setTimeout(
        () => reject(new PipelineTimeoutError("Analysis pipeline exceeded its time budget")),
        ms
      );
      t.unref?.();
    }),
  ]);
}

// Same opportunistic stale-dir sweep as the other two handlers (same "scan-"
// prefix, so any of them cleans up after any other). Duplicated on purpose,
// matching the existing convention of not coupling the handlers.
async function cleanStaleTmpDirs() {
  try {
    const entries = await readdir("/tmp");
    const STALE_MS = 10 * 60 * 1000;
    const now = Date.now();
    await Promise.all(
      entries
        .filter(e => e.startsWith("scan-"))
        .map(async e => {
          const fullPath = join("/tmp", e);
          try {
            const s = await stat(fullPath);
            if (now - s.mtimeMs > STALE_MS) {
              await rm(fullPath, { recursive: true, force: true });
            }
          } catch (_) {}
        })
    );
  } catch (_) {}
}

function emptyTierCounts() {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

// Validates the request body. Returns { error: { status, message } } or
// { diffText, contents: Map<relPath, string>, skipped: [] }.
function validateBody(body) {
  const diffText = body?.diff;
  if (typeof diffText !== "string" || diffText.trim().length === 0) {
    return { error: { status: 400, message: "Provide a unified diff in \"diff\" (e.g. the output of `git diff`)." } };
  }
  let total = Buffer.byteLength(diffText, "utf8");
  if (total > MAX_DIFF_BYTES) {
    return { error: { status: 413, message: `Diff is larger than the ${MAX_DIFF_BYTES / 1024 / 1024} MB limit.` } };
  }

  const filesIn = body?.files;
  if (!Array.isArray(filesIn) || filesIn.length === 0) {
    return { error: { status: 400, message: "Provide \"files\": [{ \"path\", \"content\" }] with the post-change content of each changed file." } };
  }
  if (filesIn.length > MAX_FILES) {
    return { error: { status: 413, message: `Too many files (limit ${MAX_FILES}).` } };
  }

  const contents = new Map();
  const skipped = [];
  for (const f of filesIn) {
    if (!f || typeof f.path !== "string" || typeof f.content !== "string") {
      return { error: { status: 400, message: "Each entry in \"files\" needs a string \"path\" and a string \"content\"." } };
    }
    total += Buffer.byteLength(f.content, "utf8");
    if (total > MAX_TOTAL_BYTES) {
      return { error: { status: 413, message: `Request is larger than the ${MAX_TOTAL_BYTES / 1024 / 1024} MB limit.` } };
    }
    const rel = safeRelPath(f.path);
    if (rel === null) {
      skipped.push({ path: null, reason: "unsafe path in files" });
      continue;
    }
    contents.set(rel, f.content);
  }
  return { diffText, contents, skipped };
}

async function runPipeline({ srcDir, reportPath, toWrite }) {
  for (const [rel, content] of toWrite) {
    const target = join(srcDir, rel);
    // Defense in depth on top of safeRelPath(): never write outside srcDir.
    if (!target.startsWith(srcDir + sep)) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  try {
    await execFileAsync(CMA_BINARY, [srcDir, "--json", reportPath], { timeout: CMA_TIMEOUT_MS });
  } catch (cmaErr) {
    const stderr = String(cmaErr?.stderr || "");
    if (stderr.includes("No recognized source files found")) return [];
    throw cmaErr;
  }

  const report = JSON.parse(await readFile(reportPath, "utf8"));
  return Array.isArray(report.violations) ? report.violations : [];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  const checked = validateBody(req.body);
  if (checked.error) {
    res.status(checked.error.status).json({ error: checked.error.message });
    return;
  }
  const { diffText, contents } = checked;
  const skipped = [...checked.skipped];

  const parsed = parseUnifiedDiff(diffText);
  skipped.push(...parsed.skipped);
  if (parsed.files.size === 0 && parsed.skipped.length === 0) {
    res.status(400).json({ error: "No file changes found in the diff. Send unified diff output, e.g. `git diff`." });
    return;
  }

  // A diff file is analysed only if it is a supported type AND we were given
  // its post-change content. Everything else is reported, never guessed.
  const toWrite = new Map();
  const analysedDiffFiles = new Map();
  for (const [rel, rec] of parsed.files) {
    if (!SUPPORTED_EXTENSIONS.has(extname(rel).toLowerCase())) {
      skipped.push({ path: rel, reason: "unsupported file type" });
    } else if (!contents.has(rel)) {
      skipped.push({ path: rel, reason: "content not supplied" });
    } else {
      toWrite.set(rel, contents.get(rel));
      analysedDiffFiles.set(rel, rec);
    }
  }
  for (const rel of contents.keys()) {
    if (!parsed.files.has(rel)) skipped.push({ path: rel, reason: "not in diff" });
  }

  let addedLines = 0;
  for (const rec of analysedDiffFiles.values()) addedLines += rec.added.size;

  let violations = [];
  if (toWrite.size > 0) {
    await cleanStaleTmpDirs();
    const workDir    = join("/tmp", `scan-${randomUUID()}`);
    const srcDir     = join(workDir, "src");
    const reportPath = join(workDir, "report.json");
    try {
      await mkdir(srcDir, { recursive: true });
      violations = await withDeadline(
        runPipeline({ srcDir, reportPath, toWrite }),
        OVERALL_TIMEOUT_MS
      );
      const { introduced, preexisting } = splitViolationsByDiff(violations, srcDir, analysedDiffFiles);
      res.status(200).json(buildResponse({
        introduced, preexisting, skipped,
        filesInDiff: parsed.files.size,
        filesAnalyzed: analysedDiffFiles.size,
        addedLines,
      }));
    } catch (err) {
      // Details (which can include server paths) go to logs only; the
      // user-facing message is generic (Section 27).
      console.error("Analyze-diff error:", err);
      const timedOut =
        err instanceof PipelineTimeoutError || err?.code === "ETIMEDOUT" || err?.killed;
      res.status(500).json({
        error: timedOut ? "Analysis timed out. Try a smaller change." : "Analysis failed.",
      });
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
    return;
  }

  res.status(200).json(buildResponse({
    introduced: [], preexisting: 0, skipped,
    filesInDiff: parsed.files.size,
    filesAnalyzed: 0,
    addedLines: 0,
  }));
}

function buildResponse({ introduced, preexisting, skipped, filesInDiff, filesAnalyzed, addedLines }) {
  // enrichReport() assigns tier/confidence onto each violation and builds
  // tierCounts + fixFirst -- run it on just the introduced findings so
  // "fix first" ranks this change's problems, not the whole repo's.
  const tmp = { violations: introduced };
  enrichReport(tmp);

  const ranked = [...introduced].sort(
    (a, b) =>
      scoreOf(b.tier, b.confidence) - scoreOf(a.tier, a.confidence) ||
      (a.path ?? "").localeCompare(b.path ?? "") ||
      (a.line ?? 0) - (b.line ?? 0)
  );

  return {
    schemaVersion: 1,
    mode: "diff",
    summary: {
      filesInDiff,
      filesAnalyzed,
      addedLines,
      introduced: introduced.length,
      byTier: tmp.tierCounts ?? emptyTierCounts(),
      preexistingInTouchedFiles: preexisting,
    },
    fixFirst: tmp.fixFirst ?? [],
    introduced: ranked.slice(0, MAX_INTRODUCED),
    introducedTruncated: ranked.length > MAX_INTRODUCED,
    skipped,
  };
}
