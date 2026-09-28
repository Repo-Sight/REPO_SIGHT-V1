// api/_lib/github.js
//
// GitHub access for repo scanning. Two paths, deliberately separate:
//
//   PUBLIC  (no token)  -- unchanged from Phases 0-6: unauthenticated
//                          codeload.github.com download, main then master.
//   PRIVATE (token)     -- Phase C: the signed-in user's own GitHub OAuth
//                          token, used against api.github.com only.
//
// Token handling rules (Section 11 / 16 / 17):
//   * The token arrives per request in the X-GitHub-Token header, is used
//     for the two GitHub calls below, and is dropped. It is never written
//     to Supabase, /tmp, the scan payload, or a log line.
//   * Every host we send it to is a fixed literal (api.github.com). The
//     owner/repo/ref segments are regex-validated before URL construction.
//   * Error classes carry fixed, token-free messages so a stray
//     console.error(err) can never echo a credential.
//
// Plain imported module (no default export) -- not a Vercel route.
import * as tar from "tar";
import { pipeline as streamPipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export const GITHUB_TOKEN_HEADER = "x-github-token";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "repo-sight-scanner";

// Reject tarballs larger than this to prevent /tmp exhaustion.
// 100 MB compressed is already a very large repo; extracted it's ~3-5x that.
export const MAX_TARBALL_BYTES = 100 * 1024 * 1024;

// Bound the time GitHub gets to START answering (response headers), so a
// hung upstream can't eat the whole function budget before our own deadline
// logic engages. Deliberately NOT an AbortSignal.timeout(): that would also
// abort the response BODY mid-stream, killing any large-but-healthy tarball
// download. The timer is cleared as soon as headers arrive; body streaming
// is then bounded only by the handler's overall deadline.
const GITHUB_HEADERS_TIMEOUT_MS = 15_000;

async function fetchStart(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_HEADERS_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class RepoTooLargeError extends Error {}
// Token rejected: expired, revoked, or malformed. Client should reconnect.
export class GithubAuthError extends Error {}
// 404: repo doesn't exist OR the token can't see it. GitHub deliberately
// returns 404 (not 403) for private repos you can't access, so the two are
// indistinguishable -- and must stay indistinguishable to the caller.
export class GithubNotFoundError extends Error {}
// 403 that is not a rate limit: typically an org that restricts OAuth apps
// or enforces SAML SSO until the user approves/authorizes the app.
export class GithubAccessError extends Error {}
export class GithubRateLimitError extends Error {}

export function parseGithubUrl(repoUrl) {
  const m = String(repoUrl || "")
    .trim()
    .match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?(?:[?#].*)?$/);
  if (!m) return null;
  // GitHub logins/repo names are [A-Za-z0-9._-]. The URL regex above is
  // permissive; tighten here because these become URL path segments.
  if (!/^[A-Za-z0-9._-]+$/.test(m[1]) || !/^[A-Za-z0-9._-]+$/.test(m[2])) return null;
  if (m[1] === "." || m[1] === ".." || m[2] === "." || m[2] === "..") return null;
  return { owner: m[1], repo: m[2] };
}

// Reads the optional GitHub token header.
//   { token: null }            -- header absent (anonymous/public flow)
//   { token: "<value>" }       -- present and plausible
//   { invalid: true }          -- present but not shaped like a GitHub token
// Shape check only (gho_/ghu_/ghp_/github_pat_/legacy 40-hex all fit): it
// stops header-injection junk and absurd lengths, GitHub does the real auth.
export function readGithubToken(req) {
  const raw = req.headers?.[GITHUB_TOKEN_HEADER];
  if (raw === undefined || raw === null || raw === "") return { token: null };
  const value = Array.isArray(raw) ? raw[0] : raw;
  const token = String(value).trim();
  if (!/^[A-Za-z0-9_-]{20,255}$/.test(token)) return { invalid: true };
  return { token };
}

function authedHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
  };
}

function isRateLimited(res) {
  if (res.status === 429) return true;
  return res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0";
}

// Maps a non-OK GitHub response to one of our error classes. Never includes
// response bodies or headers in the message.
function throwForStatus(res) {
  if (res.status === 401) {
    throw new GithubAuthError("GitHub rejected the access token.");
  }
  if (isRateLimited(res)) {
    throw new GithubRateLimitError("GitHub API rate limit reached.");
  }
  if (res.status === 403) {
    throw new GithubAccessError("GitHub denied access to this repository.");
  }
  if (res.status === 404) {
    throw new GithubNotFoundError("Repository not found or not accessible.");
  }
  throw new Error(`GitHub returned an unexpected error (${res.status}).`);
}

// GET /repos/{owner}/{repo} -> { isPrivate, defaultBranch }
export async function fetchRepoMeta(owner, repo, token) {
  const res = await fetchStart(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: authedHeaders(token),
  });
  if (!res.ok) throwForStatus(res);
  const meta = await res.json();
  const defaultBranch = String(meta?.default_branch || "");
  if (!/^[A-Za-z0-9._\/-]+$/.test(defaultBranch)) {
    throw new Error("GitHub returned an unusable default branch name.");
  }
  return { isPrivate: meta.private === true, defaultBranch };
}

// Stream an HTTP response body straight into the tar extractor (no .tar.gz
// ever touches /tmp -- peak disk = extracted size only).
async function extractResponse(res, srcDir) {
  // Best-effort early reject; GitHub may omit content-length.
  const contentLength = Number(res.headers.get("content-length") || 0);
  if (contentLength > MAX_TARBALL_BYTES) {
    const mb = Math.round(contentLength / 1024 / 1024);
    throw new RepoTooLargeError(
      `Repository tarball is ${mb} MB compressed -- exceeds the 100 MB limit. ` +
      "Try a smaller or more focused repo."
    );
  }
  await streamPipeline(Readable.fromWeb(res.body), tar.x({ cwd: srcDir, strip: 1 }));
}

// PUBLIC path -- behavior identical to the pre-Phase-C implementation.
// Returns the branch that resolved, or null if neither main nor master exists.
export async function downloadPublicAndExtract(owner, repo, srcDir) {
  for (const branch of ["main", "master"]) {
    const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${branch}`;
    const res = await fetch(url);
    if (!res.ok) continue;
    await extractResponse(res, srcDir);
    return branch;
  }
  return null;
}

// PRIVATE path -- authenticated tarball of the repo's default branch.
// api.github.com answers 302 -> a pre-signed codeload URL. fetch drops the
// Authorization header on that cross-origin redirect (fetch spec), so the
// token never reaches codeload.
export async function downloadAuthedAndExtract(owner, repo, branch, token, srcDir) {
  const res = await fetchStart(`${GITHUB_API}/repos/${owner}/${repo}/tarball/${branch}`, {
    headers: authedHeaders(token),
    redirect: "follow",
  });
  if (!res.ok) throwForStatus(res);
  await extractResponse(res, srcDir);
}
