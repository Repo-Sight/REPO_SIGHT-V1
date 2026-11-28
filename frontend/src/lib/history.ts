import { getSupabase } from "./supabase";
import { MAX_TREND_POINTS, type HistoryRow } from "./trend";

export interface ScanRow {
  scan_id: string;
  project_name: string;
  health_score: number | null;
  health_grade: string | null;
  scanned_at: string;
}

/** Rows are filtered to the signed-in user by Row Level Security. */
export async function listMyScans(): Promise<ScanRow[]> {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("user_scans")
    .select("scan_id, project_name, health_score, health_grade, scanned_at")
    .order("scanned_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ScanRow[];
}

/** The signed-in user's most recent earlier scan of the same project, if any. */
export async function findPreviousScanId(
  projectName: string,
  currentScanId: string,
  before?: string,
): Promise<string | null> {
  if (!projectName) return null;
  const sb = await getSupabase();
  let q = sb.from("user_scans").select("scan_id").eq("project_name", projectName).neq("scan_id", currentScanId);
  if (before) q = q.lt("scanned_at", before);
  const { data, error } = await q.order("scanned_at", { ascending: false }).limit(1);
  if (error || !data?.length) return null;
  return (data[0] as { scan_id: string }).scan_id;
}

const HISTORY_COLUMNS =
  "scan_id, commit_sha, branch, engine_version, health_score, health_grade, score_complexity, score_function_length, " +
  "score_comments, score_todo, score_nesting, tier_critical, tier_high, tier_medium, tier_low, partial, scanned_at";

/**
 * The signed-in user's compact history rows for one repo ("owner/name", lower case, the same key the
 * server writes). Newest first, at most `limit`. Row Level Security limits the rows to the user's own.
 */
export async function listRepoHistory(repoKey: string, limit: number = MAX_TREND_POINTS): Promise<HistoryRow[]> {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("scan_history")
    .select(HISTORY_COLUMNS)
    .eq("repo_key", repoKey)
    .order("scanned_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as HistoryRow[];
}
