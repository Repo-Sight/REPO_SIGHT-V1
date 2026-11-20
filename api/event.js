// api/event.js
//
// POST /api/event   body: { "name": "badge_copied" | "sign_in", "scanId"?: "<uuid>" }
// Header (required for sign_in): Authorization: Bearer <Supabase access token>
//
// Browser-side usage events for the Phase 0 baseline. The third event, scan_completed,
// is recorded server-side inside api/analyze.js and api/analyze-file.js, so it cannot be
// forged from here (it is not accepted by this endpoint).
//
//   * sign_in      needs a bearer token that resolves to a real user; the user id comes
//                  from the token, never from the body. No token -> 401, nothing stored.
//   * badge_copied anonymous is fine; scanId, if present, must be a UUID v4.
//
// Always 204 on success so a tracking hiccup never surfaces in the UI. Anonymous writes
// are bounded by the Vercel Firewall rate limit (include /api/event in it).
import { getSupabase, getUserFromRequest } from "./_lib/supabase.js";
import { recordEvent } from "./_lib/events.js";

const BROWSER_EVENTS = new Set(["badge_copied", "sign_in"]);
const SCAN_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handleEvent(req, res, deps = {}) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const name = body.name;
  if (typeof name !== "string" || !BROWSER_EVENTS.has(name)) {
    res.status(400).json({ error: "Unknown event." });
    return;
  }

  let supabase;
  try {
    supabase = deps.supabase ?? getSupabase();
  } catch {
    res.status(204).end(); // misconfigured environment: tracking is best-effort
    return;
  }

  const user = await getUserFromRequest(req, supabase);
  if (name === "sign_in" && !user) {
    res.status(401).json({ error: "Sign-in required." });
    return;
  }

  const meta = {};
  if (name === "badge_copied" && typeof body.scanId === "string" && SCAN_UUID_RE.test(body.scanId)) {
    meta.scanId = body.scanId.toLowerCase();
  }

  await recordEvent(supabase, { name, userId: user?.id ?? null, meta });
  res.status(204).end();
}

export default function handler(req, res) {
  return handleEvent(req, res);
}
