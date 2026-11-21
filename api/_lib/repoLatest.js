// api/_lib/repoLatest.js
//
// "Latest public scan per repo" (supabase/migrations/20261121_repo_latest.sql). Backs the
// live README badge (api/badge/[scanId].js) and the repo scorecard (api/scans/[scanId].js).
//
// Rules: only PUBLIC repos are ever written; a failure here must never fail or slow the scan
// it rides on (recordRepoLatest never throws); a row with removed = true is invisible.

import { repoKey } from "./events.js";

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const GRADES = ["A", "B", "C", "D", "F"];

// owner + repo from a URL or query -> "owner/repo" (lowercase) or null. The badge URL ends in
// ".svg", which is stripped only when asked, so a repo literally named "x.svg" stays addressable
// through the scorecard.
export function parseRepoParams(owner, repo, { stripSvg = false } = {}) {
  const o = String(Array.isArray(owner) ? owner[0] : owner ?? "");
  let r = String(Array.isArray(repo) ? repo[0] : repo ?? "");
  if (stripSvg) r = r.replace(/\.svg$/i, "");
  if (!OWNER_RE.test(o) || !REPO_RE.test(r) || r === "." || r === "..") return null;
  return repoKey(o, r);
}

// Grade + score of a stored report, or null when they are missing or malformed.
export function summarizeReport(payload) {
  const grade = String(payload?.project?.healthGrade ?? "").toUpperCase();
  const score = Number(payload?.project?.healthScore);
  if (!GRADES.includes(grade) || !Number.isFinite(score) || score < 0 || score > 100) return null;
  return { grade, score };
}

// -> true when the pointer was written. Never throws. Callers pass `repo` only for PUBLIC repos.
export async function recordRepoLatest(supabase, { repo, scanId, payload } = {}) {
  try {
    const summary = summarizeReport(payload);
    if (!repo || !scanId || !summary) return false;
    const { error } = await supabase.from("repo_latest").upsert(
      {
        repo_key: repo,
        scan_id: scanId,
        health_grade: summary.grade,
        health_score: summary.score,
        scanned_at: new Date().toISOString(),
      },
      { onConflict: "repo_key" }
    );
    if (error) throw error;
    return true;
  } catch (err) {
    console.error("recordRepoLatest failed (scan itself unaffected):", err?.code || err?.message || "error");
    return false;
  }
}

// -> { scan_id, health_grade, health_score, scanned_at } or null (unknown, removed, or error).
export async function getRepoLatest(supabase, key) {
  if (!key) return null;
  try {
    const { data, error } = await supabase
      .from("repo_latest")
      .select("scan_id, health_grade, health_score, scanned_at, removed")
      .eq("repo_key", key)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.removed) return null;
    return data;
  } catch (err) {
    console.error("getRepoLatest failed:", err?.code || err?.message || "error");
    return null;
  }
}
