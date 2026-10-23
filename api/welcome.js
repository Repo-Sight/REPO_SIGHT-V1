// api/welcome.js
//
// POST /api/welcome
// Header: Authorization: Bearer <Supabase access token>
//
// Sends ONE welcome email from REPO-SIGHT to a user who has just created an
// account (GitHub is the only sign-in method). The browser calls this once after
// returning from GitHub; the server decides whether an email is actually due, so
// a repeated, forged or replayed call cannot cause spam:
//
//   * the bearer token must resolve to a real Supabase user (no token, no email),
//   * the account must have been created within the last 15 minutes, so existing
//     users never receive a "welcome" after a later sign-in,
//   * the address must be present and verified by GitHub,
//   * a `welcome_sent_at` marker in Supabase `app_metadata` (writable only with the
//     service-role key, never by the user) is claimed BEFORE sending, and Resend's
//     Idempotency-Key header covers the narrow window between two simultaneous calls.
//
// The recipient is always the address on the authenticated account, never a value
// taken from the request body.
//
// Environment (set in Vercel, never committed):
//   RESEND_API_KEY       already used by api/feedback.js. Unset -> endpoint is a no-op.
//   WELCOME_FROM_EMAIL   e.g. "REPO-SIGHT <hello@repo-sight.com>". The domain must be
//                        verified in Resend. Unset -> no-op (we never fall back to the
//                        Resend sandbox sender, which cannot reach real users).
//   WELCOME_REPLY_TO     optional, defaults to the site's contact address.
//
// Email is a courtesy: every failure path returns without affecting sign-in, and
// no email address, token or provider response body is ever logged.
import { getSupabase } from "./_lib/supabase.js";

export const NEW_ACCOUNT_MAX_AGE_MS = 15 * 60 * 1000;
export const DEFAULT_REPLY_TO = "contact.reposight@gmail.com";
export const SITE_URL = "https://www.repo-sight.com/";
const SEND_TIMEOUT_MS = 8000;
// GitHub usernames: alphanumerics and single hyphens, at most 39 characters.
const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function bearerToken(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

// Only a syntactically valid GitHub login is ever put in the greeting; anything
// else (display names are free text) falls back to a plain "Hi,".
export function githubLogin(user) {
  const meta = user?.user_metadata ?? {};
  for (const candidate of [meta.user_name, meta.preferred_username]) {
    if (typeof candidate === "string" && GITHUB_LOGIN_RE.test(candidate)) return candidate;
  }
  return null;
}

function emailIsVerified(user) {
  if (user.email_confirmed_at) return true;
  return Array.isArray(user.identities) && user.identities.some((i) => i?.identity_data?.email_verified === true);
}

// -> { ok: true } or { ok: false, reason }. Pure, so it is unit-tested directly.
export function welcomeEligibility(user, now = Date.now()) {
  if (!user || typeof user.email !== "string" || !user.email.includes("@")) return { ok: false, reason: "no_email" };
  if (!emailIsVerified(user)) return { ok: false, reason: "email_unverified" };
  if (user.app_metadata?.welcome_sent_at) return { ok: false, reason: "already_sent" };
  const created = Date.parse(user.created_at ?? "");
  if (!Number.isFinite(created) || now - created > NEW_ACCOUNT_MAX_AGE_MS || now < created - 60_000) {
    return { ok: false, reason: "not_new_account" };
  }
  return { ok: true };
}

export function buildWelcomeEmail(login) {
  const greeting = login ? `Hi ${login},` : "Hi,";
  const subject = "Welcome to REPO-SIGHT";

  const text = [
    greeting,
    "",
    "Thanks for signing in to REPO-SIGHT. Your account is ready.",
    "",
    "What you can do with it:",
    "",
    "- Scan a public repository: paste its GitHub URL on the home page, or analyse a single file.",
    "- Scan a private repository: install the REPO-SIGHT GitHub App on the one repository you choose. REPO-SIGHT reads that repository only for the scan and never runs its code.",
    "- Keep a short history of your last five scans and see how your score changes between them.",
    "",
    `Start here: ${SITE_URL}`,
    "",
    "You are getting this email once, because you just signed in with GitHub. It is not a newsletter and no further emails follow from it. REPO-SIGHT never asks for a password. If GitHub also sent you a notice about authorizing REPO-SIGHT, that message comes from GitHub and is expected.",
    "",
    "Questions, or something looks wrong? Reply to this email. To delete your account and scan history, reply with the word delete.",
    "",
    "Ronak Arora",
    "REPO-SIGHT",
    SITE_URL,
  ].join("\n");

  const p = 'style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2933;"';
  const li = 'style="margin:0 0 8px;"';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dde1e6;border-radius:8px;padding:28px;">
<p style="margin:0 0 20px;font-size:13px;letter-spacing:.08em;font-weight:700;color:#1f2933;">REPO-SIGHT</p>
<p ${p}>${escapeHtml(greeting)}</p>
<p ${p}>Thanks for signing in to REPO-SIGHT. Your account is ready.</p>
<p ${p}>What you can do with it:</p>
<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.6;color:#1f2933;">
<li ${li}>Scan a public repository: paste its GitHub URL on the home page, or analyse a single file.</li>
<li ${li}>Scan a private repository: install the REPO-SIGHT GitHub App on the one repository you choose. REPO-SIGHT reads that repository only for the scan and never runs its code.</li>
<li ${li}>Keep a short history of your last five scans and see how your score changes between them.</li>
</ul>
<p ${p}><a href="${SITE_URL}" style="color:#1f4fbf;font-weight:600;">Open REPO-SIGHT</a></p>
<p ${p}>You are getting this email once, because you just signed in with GitHub. It is not a newsletter and no further emails follow from it. REPO-SIGHT never asks for a password. If GitHub also sent you a notice about authorizing REPO-SIGHT, that message comes from GitHub and is expected.</p>
<p ${p}>Questions, or something looks wrong? Reply to this email. To delete your account and scan history, reply with the word delete.</p>
<p style="margin:0;font-size:15px;line-height:1.6;color:#1f2933;">Ronak Arora<br>REPO-SIGHT</p>
</div>
</body></html>`;

  return { subject, text, html };
}

async function sendViaResend({ apiKey, from, replyTo, to, userId, content, fetchImpl }) {
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Same user, same key: Resend collapses duplicate sends for 24 hours.
      "Idempotency-Key": `welcome-${userId}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: replyTo,
      subject: content.subject,
      html: content.html,
      text: content.text,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (res.ok) return { ok: true };
  let detail = "";
  try {
    const body = await res.json();
    detail = String(body?.name || body?.message || "").slice(0, 120);
  } catch {
    // non-JSON error body: status code alone is enough
  }
  return { ok: false, status: res.status, detail };
}

// Dependencies are injectable so the handler is testable without network or Supabase.
export async function handleWelcome(req, res, deps = {}) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now();
  const fetchImpl = deps.fetchImpl ?? fetch;

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }

  // Cheap, key-only checks first: an unconfigured deployment does no work.
  const apiKey = env.RESEND_API_KEY;
  const from = env.WELCOME_FROM_EMAIL;
  if (!apiKey || !from) {
    res.status(200).json({ sent: false, reason: "not_configured" });
    return;
  }

  const supabase = deps.supabase ?? getSupabase();
  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;
  if (error || !user) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }

  const eligibility = welcomeEligibility(user, now);
  if (!eligibility.ok) {
    res.status(200).json({ sent: false, reason: eligibility.reason });
    return;
  }

  // Claim first. If the claim cannot be recorded we do not send: an unrecorded
  // send could repeat on every later sign-in.
  const claim = await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: { welcome_sent_at: new Date(now).toISOString() },
  });
  if (claim?.error) {
    console.error("Welcome email: could not record claim");
    res.status(200).json({ sent: false, reason: "claim_failed" });
    return;
  }

  const content = buildWelcomeEmail(githubLogin(user));
  let result;
  try {
    result = await sendViaResend({
      apiKey,
      from,
      replyTo: env.WELCOME_REPLY_TO || DEFAULT_REPLY_TO,
      to: user.email,
      userId: user.id,
      content,
      fetchImpl,
    });
  } catch {
    result = { ok: false, status: 0, detail: "network_error" };
  }

  if (!result.ok) {
    console.error(`Welcome email failed: status=${result.status} ${result.detail}`.trim());
    // Release the claim so a sign-in inside the 15-minute window can retry.
    await supabase.auth.admin
      .updateUserById(user.id, { app_metadata: { welcome_sent_at: null } })
      .catch(() => {});
    res.status(502).json({ sent: false, reason: "provider_error" });
    return;
  }

  res.status(200).json({ sent: true });
}

export default async function handler(req, res) {
  try {
    await handleWelcome(req, res);
  } catch (err) {
    console.error("Welcome error:", err?.message ? String(err.message).slice(0, 120) : "unknown");
    if (!res.headersSent) res.status(500).json({ error: "Could not process request." });
  }
}
