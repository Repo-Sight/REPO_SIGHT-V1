// api/_lib/baseline.js
//
// Baselines (V3 plan, Phase 2 item 5.4): "track from this scan". The user picks one full scan of a
// repo; the findings it had are stored as compact GROUPS (fingerprint hash -> how many), and later
// reports mark every finding above that count as new (frontend/src/lib/change.ts does the matching).
//
// Why groups and not the full report: user_scans keeps the user's last five scans, so the baseline
// scan's full report is usually evicted long before it is needed. Groups are numbers and hashes only:
// no code, no paths, no messages.
//
// Plain imported module, not a route: api/scans/[scanId].js hands requests for /api/scans/baseline
// to handleBaseline. It is not its own file in api/ because Vercel Hobby allows 12 functions per
// deployment, every file in api/ is one, and item 6 (weekly digest) still needs a slot.
import { enrichReport } from "./enrich.js";
import { getSupabase, getUserFromRequest } from "./supabase.js";
import { repoKey } from "./events.js";

// Distinct finding hashes one baseline may hold. Above this the baseline is refused instead of being
// truncated: a truncated baseline would report old findings as new. Must equal MAX_BASELINE_GROUPS in
// frontend/src/lib/change.ts (scripts/baseline.test.mjs checks).
export const MAX_BASELINE_GROUPS = 5000;

const FP_RE = /^([0-9a-f]{24})\.([1-9][0-9]{0,5})$/;
const SCAN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPO_KEY_RE = /^[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9._-]{1,100}$/;

export const BASELINE_ERRORS = Object.freeze({
  NOT_A_REPO_SCAN: { status: 400, message: "Only a repository scan can be a baseline." },
  PARTIAL: { status: 422, message: "That scan covered only part of the repo. Use a full scan as the baseline." },
  NO_FINGERPRINTS: { status: 422, message: "That scan has no finding fingerprints, so it cannot be a baseline. Scan the repo again." },
  TOO_MANY_FINDINGS: {
    status: 422,
    message: `That scan has more than ${MAX_BASELINE_GROUPS} distinct findings, which is more than a baseline can hold.`,
  },
});

/** { groups, count } from a report's findings, or { error } when it cannot be a baseline. */
export function buildBaselineGroups(violations) {
  if (!Array.isArray(violations)) return { error: "NO_FINGERPRINTS" };
  const groups = Object.create(null);
  let distinct = 0;
  for (const v of violations) {
    const m = FP_RE.exec(typeof v?.fp === "string" ? v.fp : "");
    if (!m) return { error: "NO_FINGERPRINTS" };
    if (groups[m[1]] === undefined) {
      distinct += 1;
      if (distinct > MAX_BASELINE_GROUPS) return { error: "TOO_MANY_FINDINGS" };
      groups[m[1]] = 0;
    }
    groups[m[1]] += 1;
  }
  return { groups: { ...groups }, count: violations.length };
}

function score(v) {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n)) return null;
  return Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
}

/** { row } for the scan_baselines upsert, or { error } (a key of BASELINE_ERRORS). Reads nothing but the report. */
export function buildBaselineRow({ userId, scanId, payload }) {
  const key = repoKey(payload?.repoOwner, payload?.repoName);
  if (!userId || !scanId || !key || !REPO_KEY_RE.test(key) || key.endsWith("/.") || key.endsWith("/..")) {
    return { error: "NOT_A_REPO_SCAN" };
  }
  if (payload.partial) return { error: "PARTIAL" };
  const g = buildBaselineGroups(payload.violations);
  if (g.error) return { error: g.error };
  const created = Date.parse(payload.createdAt);
  return {
    row: {
      user_id: userId,
      repo_key: key,
      scan_id: scanId,
      engine_version: typeof payload.engineVersion === "string" && payload.engineVersion ? payload.engineVersion.slice(0, 20) : null,
      health_score: score(payload.project?.healthScore),
      finding_count: g.count,
      groups: g.groups,
      scanned_at: new Date(Number.isFinite(created) ? created : Date.now()).toISOString(),
    },
  };
}

function fail(res, status, message) {
  res.status(status).json({ error: message });
}

async function readStoredReport(supabase, scanId) {
  // Public and older scans sit at the bucket root, owner-only scans of private repos under "private/".
  for (const key of [`${scanId}.json`, `private/${scanId}.json`]) {
    const { data, error } = await supabase.storage.from("scans").download(key);
    if (!error && data) return JSON.parse(await data.text());
  }
  return null;
}

/**
 * POST   /api/scans/baseline   body { "scanId": "<uuid>" }   set (or replace) the baseline of that scan's repo
 * DELETE /api/scans/baseline?repo=owner/name                  clear it
 * Header: Authorization: Bearer <Supabase access token>   (required for both)
 *
 * The scan must be one of the caller's own (it must be in their user_scans history), and the repo
 * comes from the stored report, never from the request. Reading baselines needs no endpoint: the
 * browser reads its own row (Row Level Security).
 */
export async function handleBaseline(req, res, deps = {}) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "POST, DELETE");
    return fail(res, 405, "Method not allowed. Use POST or DELETE.");
  }
  try {
    const supabase = deps.supabase ?? getSupabase();
    const user = await getUserFromRequest(req, supabase);
    if (!user) return fail(res, 401, "Sign in to use baselines.");

    if (req.method === "DELETE") {
      const raw = Array.isArray(req.query?.repo) ? req.query.repo[0] : req.query?.repo;
      const key = typeof raw === "string" ? raw.toLowerCase() : "";
      if (!REPO_KEY_RE.test(key) || key.endsWith("/.") || key.endsWith("/..")) return fail(res, 400, "Invalid repository.");
      const { error } = await supabase.from("scan_baselines").delete().eq("user_id", user.id).eq("repo_key", key);
      if (error) throw error;
      res.status(204).end();
      return;
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const scanId = body.scanId;
    if (typeof scanId !== "string" || !SCAN_ID_RE.test(scanId)) return fail(res, 400, "Invalid scan id.");

    const { data: owned, error: ownedErr } = await supabase
      .from("user_scans")
      .select("scan_id")
      .eq("user_id", user.id)
      .eq("scan_id", scanId)
      .limit(1);
    if (ownedErr) throw ownedErr;
    const notFound = "That scan is not in your recent history, so it cannot be a baseline. Scan the repo again and use the new report.";
    if (!owned?.length) return fail(res, 404, notFound);

    const payload = await readStoredReport(supabase, scanId);
    // Fail closed, like canViewScan: only public, older (no field) or own private scans.
    const vis = payload?.visibility;
    const allowed = vis === undefined || vis === "public" || (vis === "private" && payload.ownerId === user.id);
    if (!payload || !allowed) return fail(res, 404, notFound);

    enrichReport(payload); // idempotent: scans stored before fingerprints existed get them here
    const built = buildBaselineRow({ userId: user.id, scanId, payload });
    if (built.error) {
      const e = BASELINE_ERRORS[built.error];
      return fail(res, e.status, e.message);
    }
    const { error: upsertErr } = await supabase.from("scan_baselines").upsert(built.row, { onConflict: "user_id,repo_key" });
    if (upsertErr) throw upsertErr;
    res.status(200).json({
      repoKey: built.row.repo_key,
      scanId,
      findingCount: built.row.finding_count,
      engineVersion: built.row.engine_version,
      scannedAt: built.row.scanned_at,
    });
  } catch (err) {
    // Never log the report, the token or the user: the message alone is enough to find the cause.
    console.error("baseline failed:", err?.message ?? err?.code ?? "unknown");
    fail(res, 500, "Could not update the baseline. Please try again.");
  }
}
