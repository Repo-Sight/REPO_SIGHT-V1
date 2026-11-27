// Compact per-scan history (V3 plan, Phase 2 item 5): one small row per scan of a signed-in
// user, kept long after the full report blobs are evicted (user_scans keeps only the last five).
// A row holds numbers only: score, the five component scores, finding counts per tier, the
// commit, the branch and the engine version. It holds no code, no file paths and no findings.
//
// Written from the scan pipeline right after the full report is stored. Like every other
// bonus write there, it never throws: a failed history row must not fail a scan that succeeded.
import { ENGINE_VERSION } from "./engineVersion.js";

const SHA_RE = /^[0-9a-f]{40}$/;

function score(v) {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n)) return null;
  return Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
}

function count(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 2_000_000_000) : 0;
}

/**
 * Build the row to store, or null when the report has no usable score (a row with no score
 * would draw a hole in the trend, so it is not stored).
 */
export function buildHistoryRow({ userId, repo, scanId, commit, branch, payload, partial }) {
  if (!userId || !repo || !scanId) return null;
  const project = payload?.project;
  const health = score(project?.healthScore);
  if (health === null) return null;
  const b = project?.scoreBreakdown ?? {};
  const t = payload?.tierCounts ?? {};
  return {
    user_id: userId,
    repo_key: String(repo).slice(0, 140),
    scan_id: scanId,
    commit_sha: typeof commit === "string" && SHA_RE.test(commit) ? commit : null,
    branch: typeof branch === "string" && branch ? branch.slice(0, 100) : null,
    engine_version: ENGINE_VERSION,
    health_score: health,
    health_grade: typeof project?.healthGrade === "string" ? project.healthGrade.slice(0, 2) : null,
    score_complexity: score(b.complexityDensity),
    score_function_length: score(b.avgFunctionLength),
    score_comments: score(b.commentCoverage),
    score_todo: score(b.todoDensity),
    score_nesting: score(b.nestingDepth),
    tier_critical: count(t.critical),
    tier_high: count(t.high),
    tier_medium: count(t.medium),
    tier_low: count(t.low),
    files_analyzed: count(project?.filesAnalyzed),
    total_lines: count(project?.totalLines),
    partial: Boolean(partial),
  };
}

/** Upsert one history row (idempotent on scan_id). Never throws. */
export async function recordScanHistory(supabase, input) {
  try {
    const row = buildHistoryRow(input);
    if (!supabase || !row) return;
    const { error } = await supabase.from("scan_history").upsert(row, { onConflict: "scan_id" });
    if (error) console.error("recordScanHistory failed (scan itself still succeeded):", error.message ?? error.code ?? "unknown");
  } catch (err) {
    console.error("recordScanHistory failed (scan itself still succeeded):", err?.message ?? "unknown");
  }
}
