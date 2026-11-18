// scripts/welcome.test.mjs -- run with: npm run test:api
// Guards the one-time welcome email: who may receive it, that it never repeats,
// that nothing user-controlled reaches the message unescaped, and that an
// unconfigured deployment sends nothing.
import test from "node:test";
import assert from "node:assert/strict";
import {
  handleWelcome,
  welcomeEligibility,
  buildWelcomeEmail,
  githubLogin,
  bearerToken,
  NEW_ACCOUNT_MAX_AGE_MS,
  DEFAULT_REPLY_TO,
} from "../api/welcome.js";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();

const newUser = (over = {}) => ({
  id: "11111111-2222-4333-8444-555555555555",
  email: "dev@example.com",
  email_confirmed_at: minutesAgo(1),
  created_at: minutesAgo(1),
  app_metadata: { provider: "github", providers: ["github"] },
  user_metadata: { user_name: "octo-dev" },
  identities: [],
  ...over,
});

const fakeRes = () => {
  const r = { code: 0, body: undefined, headersSent: false };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

const ENV = { RESEND_API_KEY: "re_test", WELCOME_FROM_EMAIL: "REPO-SIGHT <hello@repo-sight.com>" };

function harness({ user = newUser(), getUserError = null, claimError = null, sendOk = true, sendStatus = 200 } = {}) {
  const calls = { updates: [], fetches: [] };
  const supabase = {
    auth: {
      getUser: async () => (getUserError ? { data: { user: null }, error: getUserError } : { data: { user }, error: null }),
      admin: {
        updateUserById: async (id, attrs) => {
          calls.updates.push({ id, attrs });
          // the first update is the claim; later ones are releases
          return { error: calls.updates.length === 1 ? claimError : null };
        },
      },
    },
  };
  const fetchImpl = async (url, init) => {
    calls.fetches.push({ url, init, body: JSON.parse(init.body) });
    return { ok: sendOk, status: sendStatus, json: async () => ({ name: "validation_error" }) };
  };
  return { calls, deps: { supabase, fetchImpl, env: ENV, now: NOW } };
}

const post = (token = "tok") => ({ method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });

test("eligibility: a brand-new verified account qualifies", () => {
  assert.deepEqual(welcomeEligibility(newUser(), NOW), { ok: true });
});

test("eligibility: existing accounts never get a welcome after a later sign-in", () => {
  const old = newUser({ created_at: new Date(NOW - NEW_ACCOUNT_MAX_AGE_MS - 1000).toISOString() });
  assert.equal(welcomeEligibility(old, NOW).reason, "not_new_account");
});

test("eligibility: already-sent marker, missing email, unverified email, bad timestamp", () => {
  assert.equal(welcomeEligibility(newUser({ app_metadata: { welcome_sent_at: minutesAgo(1) } }), NOW).reason, "already_sent");
  assert.equal(welcomeEligibility(newUser({ email: null }), NOW).reason, "no_email");
  assert.equal(welcomeEligibility(newUser({ email: "nope" }), NOW).reason, "no_email");
  assert.equal(welcomeEligibility(newUser({ email_confirmed_at: null }), NOW).reason, "email_unverified");
  assert.equal(welcomeEligibility(newUser({ created_at: "garbage" }), NOW).reason, "not_new_account");
  assert.equal(welcomeEligibility(null, NOW).reason, "no_email");
});

test("eligibility: verified GitHub identity counts as verified even without email_confirmed_at", () => {
  const u = newUser({ email_confirmed_at: null, identities: [{ identity_data: { email_verified: true } }] });
  assert.deepEqual(welcomeEligibility(u, NOW), { ok: true });
});

test("greeting uses a valid GitHub login only", () => {
  assert.equal(githubLogin({ user_metadata: { user_name: "octo-dev" } }), "octo-dev");
  assert.equal(githubLogin({ user_metadata: { preferred_username: "abc" } }), "abc");
  assert.equal(githubLogin({ user_metadata: { user_name: "<script>alert(1)</script>" } }), null);
  assert.equal(githubLogin({ user_metadata: { user_name: "a".repeat(40) } }), null);
  assert.equal(githubLogin({ user_metadata: { user_name: "-bad" } }), null);
  assert.equal(githubLogin({}), null);
});

test("email content names REPO-SIGHT, is honest about scope, and escapes the greeting", () => {
  const { subject, text, html } = buildWelcomeEmail("octo-dev");
  assert.match(subject, /REPO-SIGHT/);
  assert.match(text, /Hi octo-dev,/);
  assert.match(text, /never runs its code/);
  assert.match(text, /https:\/\/www\.repo-sight\.com\//);
  assert.match(html, /REPO-SIGHT/);
  assert.ok(!/<script/i.test(html));
  assert.equal(buildWelcomeEmail(null).text.split("\n")[0], "Hi,");
  // Defence in depth: even if a hostile value reached the builder it is escaped in HTML.
  assert.ok(!buildWelcomeEmail("<img src=x onerror=1>").html.includes("<img"));
});

test("bearerToken parses only a proper Bearer header", () => {
  assert.equal(bearerToken({ headers: { authorization: "Bearer abc" } }), "abc");
  assert.equal(bearerToken({ headers: { authorization: "Basic abc" } }), null);
  assert.equal(bearerToken({ headers: { authorization: "Bearer   " } }), null);
  assert.equal(bearerToken({ headers: {} }), null);
});

test("handler: wrong method -> 405, no token -> 401, invalid token -> 401, nothing sent", async () => {
  const h = harness();
  const get = fakeRes();
  await handleWelcome({ method: "GET", headers: {} }, get, h.deps);
  assert.equal(get.code, 405);

  const anon = fakeRes();
  await handleWelcome(post(null), anon, h.deps);
  assert.equal(anon.code, 401);

  const bad = harness({ getUserError: { message: "invalid" } });
  const r = fakeRes();
  await handleWelcome(post(), r, bad.deps);
  assert.equal(r.code, 401);
  assert.equal(bad.calls.fetches.length, 0);
  assert.equal(h.calls.fetches.length + bad.calls.fetches.length, 0);
});

test("handler: unconfigured deployment is a silent no-op and never touches Supabase or the provider", async () => {
  for (const env of [{}, { RESEND_API_KEY: "re_test" }, { WELCOME_FROM_EMAIL: "x <a@b.c>" }]) {
    const h = harness();
    const r = fakeRes();
    await handleWelcome(post(), r, { ...h.deps, env });
    assert.equal(r.code, 200);
    assert.deepEqual(r.body, { sent: false, reason: "not_configured" });
    assert.equal(h.calls.fetches.length, 0);
    assert.equal(h.calls.updates.length, 0);
  }
});

test("handler: sends once to the account's own address, claim recorded before send, idempotency key set", async () => {
  const h = harness();
  const r = fakeRes();
  await handleWelcome(post(), r, h.deps);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { sent: true });

  assert.equal(h.calls.updates.length, 1);
  assert.ok(h.calls.updates[0].attrs.app_metadata.welcome_sent_at);

  assert.equal(h.calls.fetches.length, 1);
  const f = h.calls.fetches[0];
  assert.equal(f.url, "https://api.resend.com/emails");
  assert.equal(f.init.headers["Idempotency-Key"], "welcome-11111111-2222-4333-8444-555555555555");
  assert.equal(f.init.headers.Authorization, "Bearer re_test");
  assert.deepEqual(f.body.to, ["dev@example.com"]);
  assert.equal(f.body.from, ENV.WELCOME_FROM_EMAIL);
  assert.equal(f.body.reply_to, DEFAULT_REPLY_TO);
  assert.match(f.body.subject, /REPO-SIGHT/);
});

test("handler: recipient cannot be redirected through the request body", async () => {
  const h = harness();
  const r = fakeRes();
  await handleWelcome({ ...post(), body: { to: "victim@example.com", email: "victim@example.com" } }, r, h.deps);
  assert.deepEqual(h.calls.fetches[0].body.to, ["dev@example.com"]);
});

test("handler: second call for the same user does not send again", async () => {
  const h = harness({ user: newUser({ app_metadata: { welcome_sent_at: minutesAgo(0) } }) });
  const r = fakeRes();
  await handleWelcome(post(), r, h.deps);
  assert.deepEqual(r.body, { sent: false, reason: "already_sent" });
  assert.equal(h.calls.fetches.length, 0);
});

test("handler: claim failure -> nothing sent", async () => {
  const h = harness({ claimError: { message: "db down" } });
  const r = fakeRes();
  await handleWelcome(post(), r, h.deps);
  assert.deepEqual(r.body, { sent: false, reason: "claim_failed" });
  assert.equal(h.calls.fetches.length, 0);
});

test("handler: provider failure releases the claim so a later sign-in can retry", async () => {
  const h = harness({ sendOk: false, sendStatus: 403 });
  const r = fakeRes();
  await handleWelcome(post(), r, h.deps);
  assert.equal(r.code, 502);
  assert.equal(h.calls.updates.length, 2);
  assert.equal(h.calls.updates[1].attrs.app_metadata.welcome_sent_at, null);
});

test("handler: failure logs never contain the address or the token", async () => {
  const h = harness({ sendOk: false, sendStatus: 422 });
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(" "));
  try {
    await handleWelcome(post("secret-token"), fakeRes(), h.deps);
  } finally {
    console.error = orig;
  }
  const out = logged.join("\n");
  assert.ok(out.includes("422"));
  assert.ok(!out.includes("dev@example.com"));
  assert.ok(!out.includes("secret-token"));
});
