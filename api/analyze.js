// api/analyze.js
//
// POST /api/analyze
// Body: { "repoUrl": "https://github.com/<owner>/<repo>" }
//
// Streams the repo tarball directly into the tar extractor (no .tar.gz
// ever written to disk), runs the prebuilt CMA binary, and stores the
// resulting report JSON in Supabase Storage under the `scans` bucket.
import * as tar from "tar";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, readdir, stat } from "node:fs/promises";
import { pipeline as streamPipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getSupabase, getUserFromRequest, recordUserScan } from "./_lib/supabase.js";

const execFileAsync = promisify(execFile);

const CMA_BINARY = join(process.cwd(), "backend", "bin", "linux-x64-cma");

// vercel.json caps this function at maxDuration: 60. Keep our own deadline a
// few seconds under so we can return a JSON error before Vercel force-kills.
const OVERALL_TIMEOUT_MS = 55_000;
const CMA_TIMEOUT_MS     = 45_000;

// Reject tarballs larger than this to prevent /tmp exhaustion.
// 100 MB compressed is already a very large repo; extracted it's ~3-5x that.
const MAX_TARBALL_BYTES = 100 * 1024 * 1024;

class PipelineTimeoutError extends Error {}
class RepoTooLargeError extends Error {}

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

function parseGithubUrl(repoUrl) {
  const m = String(repoUrl || "")
    .trim()
    .match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?(?:[?#].*)?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

// Remove stale scan-* dirs left in /tmp by crashed previous invocations.
// Vercel /tmp persists across warm invocations on the same container, so
// failed cleanups accumulate. Runs opportunistically; errors are swallowed.
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

// KEY FIX: stream the HTTP response body directly into the tar extractor.
// Old code: fetch → arrayBuffer() → writeFile → tar.x(file)
//   peak disk = tar.gz size + extracted size (e.g. 80 MB + 300 MB = 380 MB)
// New code: fetch → stream → tar.x() (no .tar.gz ever touches /tmp)
//   peak disk = extracted size only (e.g. 300 MB)
// This halves peak /tmp usage and removes the .tar.gz write entirely.
async function downloadAndExtract(owner, repo, srcDir) {
  for (const branch of ["main", "master"]) {
    const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${branch}`;
    const res = await fetch(url);
    if (!res.ok) continue;

    // Reject oversized repos early when content-length is available.
    // Note: GitHub may omit this header; the size guard is best-effort.
    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength > 0 && contentLength > MAX_TARBALL_BYTES) {
      const mb = Math.round(contentLength / 1024 / 1024);
      throw new RepoTooLargeError(
        `Repository tarball is ${mb} MB compressed — exceeds the 100 MB limit. ` +
        "Try a smaller or more focused repo."
      );
    }

    // Stream HTTP body → tar extractor (no intermediate file)
    await streamPipeline(
      Readable.fromWeb(res.body),
      tar.x({ cwd: srcDir, strip: 1 })
    );
    return branch;
  }
  return null;
}

async function runPipeline({ parsed, srcDir, reportPath, scanId, supabase, user }) {
  const branch = await downloadAndExtract(parsed.owner, parsed.repo, srcDir);

  if (!branch) {
    return {
      status: 404,
      body: {
        error: `Could not find "${parsed.owner}/${parsed.repo}" on GitHub ` +
               "(checked main and master). Make sure the repo is public.",
      },
    };
  }

  let cmaResult;
  try {
    cmaResult = await execFileAsync(
      CMA_BINARY,
      [srcDir, "--json", reportPath],
      { timeout: CMA_TIMEOUT_MS }
    );
  } catch (cmaErr) {
    const stderr = String(cmaErr?.stderr || "");
    if (stderr.includes("No recognized source files found")) {
      return {
        status: 400,
        body: {
          error:
            "No supported source files (C++, Python, or Java) found in this repository.",
        },
      };
    }
    throw cmaErr;
  }

  void cmaResult;

  const report = JSON.parse(await readFile(reportPath, "utf8"));

  const payload = {
    status: "COMPLETED",
    scanId,
    projectName: `${parsed.owner}/${parsed.repo}`,
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

  // Phase 5: additive only -- anonymous scans (user === null) behave
  // exactly as they did in Phases 0-4. A failure here is logged and
  // swallowed rather than failing a scan that already succeeded and is
  // already durably stored; losing one history-list entry isn't worth
  // turning a working scan into an error for the user.
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

  const parsed = parseGithubUrl(req.body?.repoUrl);
  if (!parsed) {
    res.status(400).json({
      error:
        "Provide a valid public GitHub repo URL, e.g. https://github.com/owner/repo",
    });
    return;
  }

  // Sweep stale dirs from failed previous invocations before allocating space.
  await cleanStaleTmpDirs();

  const scanId  = randomUUID();
  // Everything lives under workDir — one rm(workDir, recursive) covers all.
  // There is no separate tarPath any more (streaming eliminated it).
  const workDir    = join("/tmp", `scan-${scanId}`);
  const srcDir     = join(workDir, "src");
  const reportPath = join(workDir, "report.json");

  try {
    const supabase = getSupabase();
    const user = await getUserFromRequest(req, supabase);
    await mkdir(srcDir, { recursive: true });

    const result = await withDeadline(
      runPipeline({ parsed, srcDir, reportPath, scanId, supabase, user }),
      OVERALL_TIMEOUT_MS
    );
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error("Analyze error:", err);

    const timedOut =
      err instanceof PipelineTimeoutError ||
      err?.code === "ETIMEDOUT" ||
      err?.killed;

    const tooLarge = err instanceof RepoTooLargeError;

    const message = timedOut
      ? "Analysis timed out — this repo is too large for the ~55s window. Try a smaller repo."
      : tooLarge
      ? err.message
      : err?.message || "Analysis failed.";

    res.status(tooLarge ? 413 : 500).json({ error: message });
  } finally {
    // Single rm covers everything (no separate tarPath exists any more).
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
