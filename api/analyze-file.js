// api/analyze-file.js
//
// POST /api/analyze-file
// Body: { "filename": "Example.cpp", "content": "<source text>" }
//
// Phase 3 (single-file analysis): writes the submitted source straight to
// /tmp and runs the prebuilt CMA binary directly against that one file --
// FileScanner already treats a single regular-file target path as a
// one-file scan (see analyser/src/filesystem/FileScanner.cpp), so no
// analyser changes were needed for this. No tarball download step, so this
// mirrors api/analyze.js's pipeline shape but skips downloadAndExtract()
// entirely and uses a much smaller time budget.
//
// Writes the resulting report JSON into the same Supabase Storage `scans`
// bucket, in the same shape api/analyze.js uses, so the existing
// GET /api/scans/[scanId].js endpoint and dashboard.js's report renderer
// work for file-based scans with zero changes.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, readdir, stat, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { getSupabase, getUserFromRequest, recordUserScan } from "./_lib/supabase.js";

const execFileAsync = promisify(execFile);

const CMA_BINARY = join(process.cwd(), "backend", "bin", "linux-x64-cma");

// No download step here, so the budget can be far tighter than
// api/analyze.js's 55s/45s -- writing one file and running cma against it
// is near-instant. Keep a margin under vercel.json's maxDuration for this
// function (see Section 2's constraint: return JSON before Vercel kills it).
const OVERALL_TIMEOUT_MS = 12_000;
const CMA_TIMEOUT_MS     = 10_000;

// Generous for a single source file; prevents /tmp abuse from an
// oversized paste/upload (Section 12/40 -- resource limits on untrusted
// input). 2 MB is far beyond any real single source file.
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;

// Mirrors analyser/src/filesystem/FileScanner.cpp's kSupportedExtensions
// exactly. Kept in sync manually -- if a language is added there, add its
// extension(s) here too, or single-file uploads for it will be rejected
// before ever reaching the binary.
const SUPPORTED_EXTENSIONS = new Set([
  ".cpp", ".cc", ".cxx", ".c++",
  ".h", ".hpp", ".hxx", ".h++",
  ".py",
  ".java",
  ".ts", ".tsx",
  ".js", ".mjs", ".cjs", ".jsx",
  ".cs",
]);

const SUPPORTED_LANGUAGES_MESSAGE =
  "Supported: C++ (.cpp/.cc/.cxx/.c++/.h/.hpp/.hxx/.h++), Python (.py), " +
  "Java (.java), TypeScript (.ts/.tsx), JavaScript (.js/.mjs/.cjs/.jsx), C# (.cs).";

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

// Same opportunistic cleanup as api/analyze.js, same "scan-" prefix, so
// either endpoint's stale /tmp dirs get swept regardless of which one
// runs next. Duplicated rather than imported from api/analyze.js to avoid
// creating a shared-module coupling between the two handlers for ~15 lines.
async function cleanStaleTmpDirs() {
  try {
    const entries = await readdir("/tmp");
    const STALE_MS = 10 * 60 * 1000; // 10 min
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

function getExtension(name) {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

// Validates and normalizes the submitted filename. Returns the safe
// basename on success, or null on failure (caller turns that into a 400).
// Using path.basename() strips any directory components -- "../../etc/x"
// becomes "x" -- so this also closes off path traversal structurally,
// not just by pattern-matching the input (Section 11: treat all
// user-provided paths/filenames as untrusted).
function sanitizeFilename(rawName) {
  if (typeof rawName !== "string") return null;
  const safe = basename(rawName.trim());
  if (!safe || safe === "." || safe === "..") return null;
  if (safe.length > 255) return null;
  return safe;
}

async function runPipeline({ filePath, reportPath, scanId, supabase, displayName, user }) {
  let cmaResult;
  try {
    cmaResult = await execFileAsync(
      CMA_BINARY,
      [filePath, "--json", reportPath],
      { timeout: CMA_TIMEOUT_MS }
    );
  } catch (cmaErr) {
    const stderr = String(cmaErr?.stderr || "");
    if (stderr.includes("No recognized source files found")) {
      return {
        status: 400,
        body: { error: `Could not analyze this file. ${SUPPORTED_LANGUAGES_MESSAGE}` },
      };
    }
    throw cmaErr;
  }
  void cmaResult;

  const report = JSON.parse(await readFile(reportPath, "utf8"));

  const payload = {
    status: "COMPLETED",
    scanId,
    projectName: displayName,
    createdAt: new Date().toISOString(),
    ...report,
  };

  const { error: uploadError } = await supabase.storage
    .from("scans")
    .upload(`${scanId}.json`, JSON.stringify(payload), {
      contentType: "application/json",
      upsert: true,
    });

  if (uploadError) throw uploadError;

  // Phase 5: see api/analyze.js's identical block -- additive only,
  // never turns a successful scan into an error for the user.
  if (user) {
    try {
      await recordUserScan(supabase, user.id, scanId, payload);
    } catch (historyErr) {
      console.error("recordUserScan failed (scan itself still succeeded):", historyErr);
    }
  }

  return { status: 200, body: { scanId } };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  const filename = sanitizeFilename(req.body?.filename);
  if (!filename) {
    res.status(400).json({ error: "Provide a filename, e.g. \"Example.cpp\"." });
    return;
  }

  const ext = getExtension(filename);
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    res.status(400).json({
      error: `Unrecognized file type "${ext || filename}". ${SUPPORTED_LANGUAGES_MESSAGE}`,
    });
    return;
  }

  const content = req.body?.content;
  if (typeof content !== "string" || content.length === 0) {
    res.status(400).json({ error: "File content is empty." });
    return;
  }
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    res.status(413).json({
      error: `File is larger than the ${Math.round(MAX_CONTENT_BYTES / 1024 / 1024)} MB single-file limit.`,
    });
    return;
  }

  await cleanStaleTmpDirs();

  const scanId    = randomUUID();
  const workDir   = join("/tmp", `scan-${scanId}`);
  const filePath  = join(workDir, filename);
  const reportPath = join(workDir, "report.json");

  try {
    const supabase = getSupabase();
    const user = await getUserFromRequest(req, supabase);
    await mkdir(workDir, { recursive: true });
    await writeFile(filePath, content, "utf8");

    const result = await withDeadline(
      runPipeline({ filePath, reportPath, scanId, supabase, displayName: filename, user }),
      OVERALL_TIMEOUT_MS
    );
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error("Analyze-file error:", err);

    const timedOut =
      err instanceof PipelineTimeoutError ||
      err?.code === "ETIMEDOUT" ||
      err?.killed;

    const message = timedOut
      ? "Analysis timed out. Try a smaller file."
      : err?.message || "Analysis failed.";

    res.status(500).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
