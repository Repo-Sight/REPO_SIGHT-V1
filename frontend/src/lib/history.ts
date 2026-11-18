import { getSupabase } from "./supabase";

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
