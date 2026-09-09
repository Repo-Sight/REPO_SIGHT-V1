// api/_lib/supabase.js
//
// Shared Supabase client + auth helpers for the api/*.js serverless
// functions. Extracted in Phase 5 from four near-identical copies of the
// same getSupabase() lazy-init pattern (api/analyze.js, api/analyze-file.js,
// api/scans/[scanId].js, api/feedback.js) once a fifth consumer (the
// auth-aware scan recording below) needed the exact same client.
//
// NOTE: this file has no default export and no GET/POST-named export, so
// it does not match any shape Vercel's Node.js builder recognizes as a
// function entrypoint -- it is a plain imported module, not a route, and
// is bundled automatically wherever it's imported from (no vercel.json
// entry needed).
import { createClient } from "@supabase/supabase-js";

let _supabase;

// Service-role client -- bypasses Row Level Security entirely. Used for
// every existing Storage read/write (unchanged from Phases 0-4) and, as
// of Phase 5, for the user_scans insert/evict logic below. Never expose
// this client or its key to the frontend.
export function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Server misconfigured: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY " +
        "are not set for this environment in Vercel Project Settings."
      );
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

// Resolves the calling user from an "Authorization: Bearer <token>" header,
// if present. Returns null for anonymous requests AND for any malformed/
// expired/invalid token -- this must never throw, because the anonymous
// scanning flow (Phase 0-4's entire user base so far) has to keep working
// byte-for-byte regardless of what a bad Authorization header contains.
// A stale token degrades to "treated as anonymous", not a hard error.
export async function getUserFromRequest(req, supabase) {
  try {
    const header = req.headers?.authorization || req.headers?.Authorization;
    if (!header || !header.startsWith("Bearer ")) return null;
    const token = header.slice("Bearer ".length).trim();
    if (!token) return null;

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return { id: data.user.id, email: data.user.email || null };
  } catch (_) {
    return null;
  }
}

// Last-5-scans-per-user enforcement (v2 plan Section 8.3). Called AFTER
// the scan's report JSON is already durably written to the `scans`
// Storage bucket -- this only ever adds/evicts pointer metadata, it never
// touches the anonymous scan flow's own behavior. Every failure here is
// caught by the caller and logged, never surfaced to the user: losing a
// history row is not worth failing a scan that otherwise succeeded.
//
// Sequence matches the plan exactly: delete-blob -> delete-row -> insert-
// row per evicted entry, so a failed blob delete never leaves an orphaned
// row and a failed row delete never leaves a dangling blob.
const HISTORY_CAP = 5;

export async function recordUserScan(supabase, userId, scanId, payload) {
  const { data: existing, error: listErr } = await supabase
    .from("user_scans")
    .select("id, scan_id")
    .eq("user_id", userId)
    .order("scanned_at", { ascending: true }); // oldest first
  if (listErr) throw listErr;

  const rows = existing || [];
  if (rows.length >= HISTORY_CAP) {
    const toEvict = rows.slice(0, rows.length - HISTORY_CAP + 1);
    for (const row of toEvict) {
      await supabase.storage.from("scans").remove([`${row.scan_id}.json`]).catch(() => {});
      await supabase.from("user_scans").delete().eq("id", row.id);
    }
  }

  const { error: insertErr } = await supabase.from("user_scans").insert({
    user_id: userId,
    scan_id: scanId,
    project_name: payload.projectName,
    health_score: payload.project?.healthScore ?? null,
    health_grade: payload.project?.healthGrade ?? null,
  });
  if (insertErr) throw insertErr;
}
