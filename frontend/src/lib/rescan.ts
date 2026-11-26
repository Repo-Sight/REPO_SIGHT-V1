// Rescan planning (V3 plan, Phase 2 item 5a): turns a stored report into "which repo URL do we
// scan again, and does it need the user's GitHub token". Pure and dependency-free on purpose.
//
// The rescan itself is the normal scan (POST /api/analyze), which always fetches the repo live
// from GitHub, so a rescan sees the repo as it is now, not as it was at the earlier scan.
//
// Erasable TypeScript only (annotations, `import type`): scripts/rescan.test.mjs runs this file
// directly under Node's type stripping, so it must not use enums, namespaces or parameter properties.
import type { ScanReport } from "./report";

export const GITHUB_REAUTH_MESSAGE = "Your GitHub connection has expired. Reconnect GitHub to rescan this private repo.";

export type RescanPlan =
  | { kind: "public"; repoUrl: string }
  | { kind: "private"; repoUrl: string }
  | { kind: "unavailable"; reason: string };

// GitHub owner and repo-name rules, the same shapes api/analyze.js accepts. The report is data
// we stored, but it reaches a URL here, so it is validated again instead of trusted.
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

export function planRescan(report: Pick<ScanReport, "repoOwner" | "repoName" | "visibility">): RescanPlan {
  const { repoOwner, repoName, visibility } = report;
  if (!repoOwner || !repoName) {
    return { kind: "unavailable", reason: "Pasted files cannot be rescanned. Paste the new version of the file above instead." };
  }
  if (!OWNER_RE.test(repoOwner) || !REPO_RE.test(repoName) || repoName === "." || repoName === "..") {
    return { kind: "unavailable", reason: "This scan has no valid repository address, so it cannot be rescanned." };
  }
  // Fail closed, like canViewScan on the server: an unknown visibility value is not scanned.
  if (visibility !== undefined && visibility !== "public" && visibility !== "private") {
    return { kind: "unavailable", reason: "This scan cannot be rescanned." };
  }
  const repoUrl = `https://github.com/${repoOwner}/${repoName}`;
  return visibility === "private" ? { kind: "private", repoUrl } : { kind: "public", repoUrl };
}
