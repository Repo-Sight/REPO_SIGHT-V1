// scripts/event.test.mjs -- run with: npm run test:api
// Guards the Phase 0 usage events: only allow-listed names are stored, the user id comes
// from a verified token (never the body), scan_completed cannot be forged from the browser,
// and a tracking failure never throws into the request it rides on.
import test from "node:test";
import assert from "node:assert/strict";
import { handleEvent } from "../api/event.js";
import { recordEvent, repoKey, EVENT_NAMES } from "../api/_lib/events.js";

const UID = "11111111-2222-4333-8444-555555555555";
const SCAN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function fakeSupabase({ insertError = null, user = null } = {}) {
  const rows = [];
  return {
    rows,
    from: (table) => ({
      insert: async (row) => {
        rows.push({ table, row });
        return { error: insertError };
      },
    }),
    auth: { getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: new Error("bad token") }) },
  };
}

const fakeRes = () => {
  const r = { code: 0, body: undefined, ended: false };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
};

const post = (body, token) => ({ method: "POST", body, headers: token ? { authorization: `Bearer ${token}` } : {} });

test("event names are the three Phase 0 events", () => {
  assert.deepEqual([...EVENT_NAMES], ["scan_completed", "badge_copied", "sign_in"]);
});

test("repoKey lowercases owner/repo and rejects empty or oversized names", () => {
  assert.equal(repoKey("Octo", "Hello-World"), "octo/hello-world");
  assert.equal(repoKey("", "x"), null);
  assert.equal(repoKey(undefined, "x"), null);
  assert.equal(repoKey("a".repeat(100), "b".repeat(100)), null);
});

test("recordEvent stores an allow-listed event with cleaned, flat meta", async () => {
  const sb = fakeSupabase();
  const ok = await recordEvent(sb, {
    name: "scan_completed",
    userId: UID,
    repo: "octo/hello",
    meta: { kind: "repo", n: 3, flag: true, nested: { secret: "x" }, long: "y".repeat(500), nan: NaN },
  });
  assert.equal(ok, true);
  assert.equal(sb.rows.length, 1);
  assert.equal(sb.rows[0].table, "events");
  const { row } = sb.rows[0];
  assert.equal(row.user_id, UID);
  assert.equal(row.repo_key, "octo/hello");
  assert.equal(row.meta.kind, "repo");
  assert.equal(row.meta.n, 3);
  assert.equal(row.meta.flag, true);
  assert.equal("nested" in row.meta, false);
  assert.equal("nan" in row.meta, false);
  assert.equal(row.meta.long.length, 64);
});

test("recordEvent refuses unknown names and never throws on a storage error", async () => {
  const sb = fakeSupabase();
  assert.equal(await recordEvent(sb, { name: "drop_table" }), false);
  assert.equal(sb.rows.length, 0);
  assert.equal(await recordEvent(fakeSupabase({ insertError: { code: "42P01" } }), { name: "sign_in" }), false);
  assert.equal(await recordEvent({ from() { throw new Error("boom"); } }, { name: "sign_in" }), false);
});

test("POST only", async () => {
  const res = fakeRes();
  await handleEvent({ method: "GET", headers: {} }, res, { supabase: fakeSupabase() });
  assert.equal(res.code, 405);
});

test("scan_completed and unknown events cannot be sent from the browser", async () => {
  for (const name of ["scan_completed", "nope", 5, undefined]) {
    const sb = fakeSupabase();
    const res = fakeRes();
    await handleEvent(post({ name }), res, { supabase: sb });
    assert.equal(res.code, 400, String(name));
    assert.equal(sb.rows.length, 0);
  }
});

test("sign_in without a valid token is rejected and stores nothing", async () => {
  const sb = fakeSupabase({ user: null });
  const res = fakeRes();
  await handleEvent(post({ name: "sign_in", userId: UID }), res, { supabase: sb });
  assert.equal(res.code, 401);
  assert.equal(sb.rows.length, 0);
  const res2 = fakeRes();
  await handleEvent(post({ name: "sign_in" }, "bad"), res2, { supabase: sb });
  assert.equal(res2.code, 401);
});

test("sign_in takes the user id from the verified token, not the body", async () => {
  const sb = fakeSupabase({ user: { id: UID, email: "dev@example.com" } });
  const res = fakeRes();
  await handleEvent(post({ name: "sign_in", userId: "99999999-9999-4999-8999-999999999999" }, "tok"), res, { supabase: sb });
  assert.equal(res.code, 204);
  assert.equal(sb.rows.length, 1);
  assert.equal(sb.rows[0].row.user_id, UID);
  assert.equal(sb.rows[0].row.name, "sign_in");
});

test("badge_copied works anonymously and keeps only a valid scan id", async () => {
  const sb = fakeSupabase();
  const res = fakeRes();
  await handleEvent(post({ name: "badge_copied", scanId: SCAN }), res, { supabase: sb });
  assert.equal(res.code, 204);
  assert.equal(sb.rows[0].row.user_id, null);
  assert.equal(sb.rows[0].row.meta.scanId, SCAN);

  const sb2 = fakeSupabase();
  await handleEvent(post({ name: "badge_copied", scanId: "../../etc/passwd" }), fakeRes(), { supabase: sb2 });
  assert.equal(sb2.rows.length, 1);
  assert.deepEqual(sb2.rows[0].row.meta, {});
});

test("a storage failure still answers 204", async () => {
  const res = fakeRes();
  await handleEvent(post({ name: "badge_copied" }), res, { supabase: fakeSupabase({ insertError: { code: "x" } }) });
  assert.equal(res.code, 204);
});
