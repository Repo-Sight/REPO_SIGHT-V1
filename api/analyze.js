// api/analyze.js
//
// POST /api/analyze
// Body:    { "repoUrl": "https://github.com/<owner>/<repo>", "coverageReport"?: string }
// Headers: Authorization: Bearer <supabase access token>   (optional; enables history)
//          X-GitHub-Token: <user's GitHub OAuth token>     (optional; enables PRIVATE repos)
//
// Streams the repo tarball directly into the tar extractor (no .tar.gz
// ever written to disk), runs the prebuilt CMA binary, and stores the
// resulting report JSON in Supabase Storage under the `scans` bucket.
//
// Phase C (private repos): when X-GitHub-Token is present the request MUST
// also carry a valid Supabase session (a private scan has to belong to
// someone). The GitHub token is used for two api.github.com calls and then
// dropped -- never stored, never logged. Private scans are stamped
// visibility:"private" + ownerId and are only readable by that owner
// (see api/scans/[scanId].js). Requests without the header behave exactly
// as they did before Phase C.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getSupabase, getUserFromRequest, recordUserScan } from "./_lib/supabase.js";
import { enrichReport } from "./_lib/enrich.js";
import {
  parseGithubUrl,
  readGithubToken,
  fetchRepoMeta,
  downloadPublicAndExtract,
  downloadAuthedAndExtract,
  RepoTooLargeError,
  GithubAuthError,
  GithubNotFoundError,
  GithubAccessError,
  GithubRateLimitError,
} from "./_lib/github.js";
import { enrichReport } from "./_lib/enrich.js";
import {
  parseLcov,
  mergeCoverageIntoReport,
  CoverageTooLargeError,
  CoverageParseError,
} from "./_lib/coverage.js";

const execFileAsync = promisify(execFile);

const CMA_BINARY = join(process.cwd(), "backend", "bin", "linux-x64-cma");

// vercel.json caps this function at maxDuration: 60. Keep our own deadline a
// few seconds under so we can return a JSON error before Vercel force-kills.
const OVERALL_TIMEOUT_MS = 55_000;
const CMA_TIMEOUT_MS     = 45_000;

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

// Resolves where the source comes from and extracts it into srcDir.
//   No token -> legacy public path (codeload, main then master). Unchanged.
//   Token    -> GitHub API: repo metadata (private flag + default branch),
//               then the authenticated tarball of the default branch.
// Returns { branch, isPrivate } or null when the public path finds nothing.
async function fetchSource({ parsed, srcDir, githubToken }) {
  if (!githubToken) {
    const branch = await downloadPublicAndExtract(parsed.owner, parsed.repo, srcDir);
    return branch ? { branch, isPrivate: false } : null;
  }
  const meta = await fetchRepoMeta(parsed.owner, parsed.repo, githubToken);
  await downloadAuthedAndExtract(parsed.owner, parsed.repo, meta.defaultBranch, githubToken, srcDir);
  return { branch: meta.defaultBranch, isPrivate: meta.isPrivate };
}

async function runPipeline({ parsed, srcDir, reportPath, scanId, supabase, user, coverageReport, githubToken }) {
  const source = await fetchSource({ parsed, srcDir, githubToken });

  if (!source) {
    return {
      status: 404,
      body: {
        error: `Could not find "${parsed.owner}/${parsed.repo}" on GitHub ` +
               "(checked main and master). Make sure the repo is public, " +
               "or sign in with GitHub to scan a private repo.",
      },
    };
  }
  const { branch, isPrivate } = source;

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
            "No supported source files (C++, Python, Java, TypeScript, JavaScript, or C#) found in this repository.",
        },
      };
    }
    throw cmaErr;
  }

  void cmaResult;

  const report = JSON.parse(await readFile(reportPath, "utf8"));

  // Phase 6d: optional user-uploaded LCOV report, merged into the CMA
  // output before storage. REPO-SIGHT never runs the repo's own test
  // suite (no secure sandbox exists in this stack -- see coverage.js's
  // header comment) -- the user supplies coverage from their own
  // local/CI test run instead. Parse/merge errors are surfaced as 400s;
  // they never fail a scan that otherwise succeeded on its own terms, so
  // a bad coverage paste can't take down an otherwise-good analysis.
  if (typeof coverageReport === "string" && coverageReport.length > 0) {
    const lcovEntries = parseLcov(coverageReport); // throws Coverage{TooLarge,Parse}Error
    mergeCoverageIntoReport(report, lcovEntries, { srcDirPrefix: srcDir });
  } else {
    report.coverageSummary = { available: false };
  }

  // Schema v3 (additive): tier/confidence per violation + ranked fixFirst.
  // Never throws; a ranking problem must not fail an otherwise good scan.
  enrichReport(report);

  const payload = {
    status: "COMPLETED",
    scanId,
    projectName: `${parsed.owner}/${parsed.repo}`,
    // Additive (schemaVersion 2 rule: never break old consumers) -- needed
    // by api/explain-finding.js to re-fetch a single file's current
    // content from GitHub for the "Explain this finding" feature. Scans
    // recorded before this field existed simply won't have it; the
    // frontend treats its absence as "explain not available for this
    // scan" rather than erroring.
    repoOwner: parsed.owner,
    repoName: parsed.repo,
    repoBranch: branch,
    createdAt: new Date().toISOString(),
    // Phase C (additive): "private" scans are readable only by ownerId --
    // enforced in api/scans/[scanId].js. Absent on pre-Phase-C scans, which
    // are treated as public. ownerId is set ONLY for private scans; public
    // and anonymous payloads are byte-identical to before apart from the
    // added "visibility": "public".
    visibility: isPrivate ? "private" : "public",
    ...(isPrivate ? { ownerId: user.id } : {}),
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

// Translates thrown errors into { status, body }. GitHub errors carry fixed,
// token-free messages (see api/_lib/github.js); `code` is an additive field
// the frontend uses to decide whether to prompt a GitHub reconnect.
function classifyError(err) {
  if (err instanceof GithubAuthError) {
    return {
      status: 401,
      body: {
        code: "github_reauth",
        error: "Your GitHub connection expired or was revoked. Reconnect GitHub and try again.",
      },
    };
  }
  if (err instanceof GithubNotFoundError) {
    return {
      status: 404,
      body: {
        code: "github_not_found",
        error: "Repository not found, or your GitHub account doesn't have access to it.",
      },
    };
  }
  if (err instanceof GithubAccessError) {
    return {
      status: 403,
      body: {
        code: "github_access_denied",
        error:
          "GitHub denied access. If this repo belongs to an organization, the organization " +
          "may need to approve REPO-SIGHT (or you need to authorize it for SAML SSO).",
      },
    };
  }
  if (err instanceof GithubRateLimitError) {
    return {
      status: 429,
      body: {
        code: "github_rate_limit",
        error: "GitHub's API rate limit was reached for your account. Try again in a few minutes.",
      },
    };
  }

  const timedOut =
    err instanceof PipelineTimeoutError ||
    err?.code === "ETIMEDOUT" ||
    err?.killed;

  const tooLarge = err instanceof RepoTooLargeError || err instanceof CoverageTooLargeError;
  const badCoverage = err instanceof CoverageParseError;

  const message = timedOut
    ? "Analysis timed out — this repo is too large for the ~55s window. Try a smaller repo."
    : tooLarge || badCoverage
    ? err.message
    : err?.message || "Analysis failed.";

  const status = tooLarge ? 413 : badCoverage ? 400 : 500;
  return { status, body: { error: message } };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  const parsed = parseGithubUrl(req.body?.repoUrl);
  if (!parsed) {
    res.status(400).json({
      error: "Provide a valid GitHub repo URL, e.g. https://github.com/owner/repo",
    });
    return;
  }

  const gh = readGithubToken(req);
  if (gh.invalid) {
    res.status(400).json({ error: "Invalid GitHub token." });
    return;
  }
  const githubToken = gh.token;

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

    // A GitHub token without a REPO-SIGHT session can't own its scan, and an
    // unowned private scan would be unreadable by anyone. Refuse up front,
    // before any GitHub call is made with the token.
    if (githubToken && !user) {
      res.status(401).json({
        code: "signin_required",
        error: "Sign in to scan private repositories.",
      });
      return;
    }

    await mkdir(srcDir, { recursive: true });

    const coverageReport = req.body?.coverageReport;

    const result = await withDeadline(
      runPipeline({ parsed, srcDir, reportPath, scanId, supabase, user, coverageReport, githubToken }),
      OVERALL_TIMEOUT_MS
    );
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error("Analyze error:", err);
    const { status, body } = classifyError(err);
    res.status(status).json(body);
  } finally {
    // Single rm covers everything (no separate tarPath exists any more).
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
