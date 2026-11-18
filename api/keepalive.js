// api/keepalive.js
//
// GET /api/keepalive   (called daily by the Vercel cron in vercel.json)
//
// Supabase free-tier projects are PAUSED after ~7 days without activity.
// A paused project makes every scan fail at the Storage upload step
// ("StorageUnknownError: fetch failed ... ENOTFOUND <ref>.supabase.co").
// This endpoint does one cheap DB read and one cheap Storage read so the
// project always counts as active.
//
// Auth: if CRON_SECRET is set in Vercel env, Vercel sends it as
// "Authorization: Bearer <secret>" on cron calls and we require it.
// If CRON_SECRET is not set the endpoint is still harmless (read-only,
// returns no data), it just is not access-restricted.
import { getSupabase } from "./_lib/supabase.js";

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers?.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ ok: false });
    return;
  }

  try {
    const supabase = getSupabase();

    const db = await supabase
      .from("user_scans")
      .select("id", { count: "exact", head: true });
    if (db.error) throw db.error;

    const storage = await supabase.storage.from("scans").list("", { limit: 1 });
    if (storage.error) throw storage.error;

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("keepalive failed:", err);
    res.status(500).json({ ok: false });
  }
}
