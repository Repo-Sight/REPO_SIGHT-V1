// api/_lib/events.js
//
// Phase 0 usage events (retention baseline). Plain imported module, not a route.
// Rows land in the Supabase `events` table (supabase/migrations/20261120_events.sql).
//
// Rules: recording an event must NEVER fail or slow the request it rides on (it is
// awaited, but every error is swallowed and logged without payloads), and nothing
// identifying beyond the signed-in user id and a PUBLIC repo name is stored.

export const EVENT_NAMES = Object.freeze(["scan_completed", "badge_copied", "sign_in"]);

const REPO_KEY_MAX = 140;

// "owner/repo" lowercase, or null. Callers pass a key only for PUBLIC repositories.
export function repoKey(owner, repo) {
  if (typeof owner !== "string" || typeof repo !== "string" || !owner || !repo) return null;
  const key = `${owner}/${repo}`.toLowerCase();
  return key.length <= REPO_KEY_MAX ? key : null;
}

// Small, flat, primitive-only meta so a caller bug can never store a report or a secret.
function cleanMeta(meta) {
  const out = {};
  if (meta && typeof meta === "object") {
    for (const [k, v] of Object.entries(meta)) {
      if (Object.keys(out).length >= 6) break;
      if (typeof v === "string") out[k] = v.slice(0, 64);
      else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
      else if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}

// -> true when the row was written. Never throws.
export async function recordEvent(supabase, { name, userId = null, repo = null, meta = {} } = {}) {
  try {
    if (!EVENT_NAMES.includes(name)) return false;
    const { error } = await supabase.from("events").insert({
      name,
      user_id: userId || null,
      repo_key: repo,
      meta: cleanMeta(meta),
    });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error(`recordEvent(${String(name)}) failed (request itself unaffected):`, err?.code || err?.message || "error");
    return false;
  }
}
