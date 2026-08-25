// api/feedback.js
//
// POST /api/feedback
// Body: { rating: 1-5, message?: string, scanId?: string, projectName?: string }
// Records one feedback submission and bumps a running average.
//
// GET /api/feedback
// Returns { count, average } for display (e.g. "4.6/5 from 32 developers").
//
// Reuses the existing `scans` Supabase Storage bucket (no new bucket to
// provision, no new env vars for storage) under a `feedback/` prefix:
//   feedback/<uuid>.json    one JSON file per submission (audit trail)
//   feedback/_stats.json    running { count, sum } so GET stays a single
//                           cheap download instead of listing + downloading
//                           every submission on every request.
//
// Optional email notification: if RESEND_API_KEY and FEEDBACK_NOTIFY_EMAIL
// are set, each new submission also triggers a best-effort email via the
// Resend HTTP API (plain fetch, no SDK dependency added). Storage is the
// record of truth; email is a convenience notification only -- neither the
// stats update nor the email can fail the user's submission.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Lazy init -- same pattern as api/analyze.js and api/scans/[scanId].js, so
// a missing env var surfaces as a JSON error instead of crashing cold start.
let _supabase;
function getSupabase() {
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

const BUCKET = "scans";
const STATS_KEY = "feedback/_stats.json";
const MAX_MESSAGE_LENGTH = 1000;
// Only accept scanId values our own analyze step could have produced
// (crypto.randomUUID() v4) -- same guard as api/scans/[scanId].js. A
// malformed value is dropped rather than rejected; scanId is just optional
// context for a feedback entry, not something we look up.
const SCAN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Best-effort notification email for a new feedback entry. Silently no-ops
// if RESEND_API_KEY / FEEDBACK_NOTIFY_EMAIL aren't configured, so this is
// safe to call unconditionally and safe to leave unconfigured. Never throws
// -- caller doesn't need to wrap this in try/catch.
async function notifyByEmail(entry) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.FEEDBACK_NOTIFY_EMAIL;
  if (!apiKey || !to) return;

  const from = process.env.FEEDBACK_FROM_EMAIL || "REPO-SIGHT Feedback <onboarding@resend.dev>";
  const stars = "★".repeat(entry.rating) + "☆".repeat(5 - entry.rating);

  const html = `
    <p><strong>New REPO-SIGHT feedback</strong> &mdash; ${stars} (${entry.rating}/5)</p>
    ${entry.projectName ? `<p><strong>Project:</strong> ${escapeHtml(entry.projectName)}</p>` : ""}
    ${entry.scanId ? `<p><strong>Scan ID:</strong> ${escapeHtml(entry.scanId)}</p>` : ""}
    ${entry.message ? `<p><strong>Message:</strong><br>${escapeHtml(entry.message).replace(/\n/g, "<br>")}</p>` : "<p><em>No message provided.</em></p>"}
    <p style="color:#888;font-size:12px;">Submitted ${entry.createdAt}</p>
  `.trim();

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: `New feedback: ${entry.rating}/5${entry.projectName ? ` — ${entry.projectName}` : ""}`,
        html,
      }),
    });
    if (!res.ok) {
      console.error("Feedback email notification failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("Feedback email notification error:", err);
  }
}

async function readStats(supabase) {
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(STATS_KEY);
    if (error || !data) return { count: 0, sum: 0 };
    const parsed = JSON.parse(await data.text());
    return { count: Number(parsed.count) || 0, sum: Number(parsed.sum) || 0 };
  } catch (_) {
    // No stats file yet, or it's unreadable -- start from zero rather
    // than failing the whole request over a display aggregate.
    return { count: 0, sum: 0 };
  }
}

// Best-effort running total. Not transaction-safe under two truly
// concurrent writes (last write wins) -- acceptable at this traffic scale;
// swapping this for a real DB counter later wouldn't change the API shape.
async function bumpStats(supabase, rating) {
  const current = await readStats(supabase);
  const next = { count: current.count + 1, sum: current.sum + rating };
  await supabase.storage.from(BUCKET).upload(STATS_KEY, JSON.stringify(next), {
    contentType: "application/json",
    upsert: true,
  });
}

async function handlePost(req, res, supabase) {
  const body = req.body && typeof req.body === "object" ? req.body : {};

  // Honeypot: a hidden field real users never see or fill in. Bots that
  // populate every field "succeed" with a 200 but nothing gets stored.
  if (typeof body.company === "string" && body.company.trim() !== "") {
    res.status(200).json({ ok: true });
    return;
  }

  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: "Rating must be a whole number from 1 to 5." });
    return;
  }

  let message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length > MAX_MESSAGE_LENGTH) message = message.slice(0, MAX_MESSAGE_LENGTH);

  let scanId = typeof body.scanId === "string" ? body.scanId.trim() : "";
  if (!SCAN_ID_RE.test(scanId)) scanId = "";

  const projectName =
    typeof body.projectName === "string" ? body.projectName.trim().slice(0, 200) : "";

  const entry = {
    id: randomUUID(),
    rating,
    message,
    scanId: scanId || null,
    projectName: projectName || null,
    createdAt: new Date().toISOString(),
  };

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(`feedback/${entry.id}.json`, JSON.stringify(entry), {
      contentType: "application/json",
      upsert: false,
    });
  if (uploadError) throw uploadError;

  // Stats are a display nicety, not the record of truth -- don't fail the
  // user's submission if this secondary write has a hiccup.
  try {
    await bumpStats(supabase, rating);
  } catch (statsErr) {
    console.error("Feedback stats update failed:", statsErr);
  }

  // Fire-and-forget notification -- see notifyByEmail() for why this can
  // never throw or block the response.
  await notifyByEmail(entry);

  res.status(200).json({ ok: true });
}

async function handleGet(req, res, supabase) {
  const { count, sum } = await readStats(supabase);
  const average = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
  res.status(200).json({ count, average });
}

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();
    if (req.method === "POST") {
      await handlePost(req, res, supabase);
    } else if (req.method === "GET") {
      await handleGet(req, res, supabase);
    } else {
      res.status(405).json({ error: "Method not allowed. Use GET or POST." });
    }
  } catch (err) {
    console.error("Feedback error:", err);
    res.status(500).json({ error: err?.message || "Could not process feedback." });
  }
}
