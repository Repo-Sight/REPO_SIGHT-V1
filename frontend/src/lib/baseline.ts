import { ApiError } from "./api";
import { sanitizeGroups, type FpGroups } from "./change";
import { authHeaders, getSupabase } from "./supabase";

/** The signed-in user's baseline for one repo: finding groups (hash -> count), never code or paths. */
export interface BaselineRecord {
  scanId: string;
  engineVersion: string | null;
  healthScore: number | null;
  findingCount: number;
  groups: FpGroups;
  /** When the baseline scan ran. */
  scannedAt: string;
  /** When the user set it. */
  setAt: string;
}

/** The baseline of a repo ("owner/name", lower case), or null when there is none. Row Level Security limits it to the user's own. */
export async function getBaseline(repoKey: string): Promise<BaselineRecord | null> {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("scan_baselines")
    .select("scan_id, engine_version, health_score, finding_count, groups, scanned_at, set_at")
    .eq("repo_key", repoKey)
    .maybeSingle();
  if (error || !data) return null;
  const groups = sanitizeGroups(data.groups);
  if (!groups) return null;
  return {
    scanId: String(data.scan_id),
    engineVersion: typeof data.engine_version === "string" ? data.engine_version : null,
    healthScore: data.health_score === null || data.health_score === undefined ? null : Number(data.health_score),
    findingCount: Number(data.finding_count) || 0,
    groups,
    scannedAt: String(data.scanned_at),
    setAt: String(data.set_at),
  };
}

async function call(method: "POST" | "DELETE", url: string, body?: Record<string, string>): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(await authHeaders()) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Could not reach REPO-SIGHT. Check your connection and try again.", 0);
  }
  if (res.ok) return;
  let message = `Could not update the baseline (HTTP ${res.status}).`;
  try {
    const data: unknown = await res.json();
    const msg = data && typeof data === "object" ? (data as Record<string, unknown>).error : null;
    if (typeof msg === "string" && msg) message = msg;
  } catch {
    // keep the generic message
  }
  throw new ApiError(message, res.status);
}

/** Make the given scan (one of the user's own full scans) the baseline of its repo. */
export const setBaseline = (scanId: string): Promise<void> => call("POST", "/api/scans/baseline", { scanId });

export const clearBaseline = (repoKey: string): Promise<void> =>
  call("DELETE", `/api/baseline?repo=${encodeURIComponent(repoKey)}`);
