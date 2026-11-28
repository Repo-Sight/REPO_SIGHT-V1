// scripts/baseline.test.mjs -- run with: npm run test:api
// Baselines (api/_lib/baseline.js, api/baseline.js): the group builder, the row, the access rules of
// POST and DELETE, and migration/code parity.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildBaselineGroups, buildBaselineRow, handleBaseline, MAX_BASELINE_GROUPS } from "../api/_lib/baseline.js";
import { assignFingerprints } from "../api/_lib/fingerprint.js";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "me@example.com" };
const OTHER = "22222222-2222-4222-8222-222222222222";
const SCAN = "5b1c1c0e-6f4e-4c4e-9f4a-0d6b7a8c9d10";

function violations() {
  return assignFingerprints([
    { ruleId: "R1", path: "a.js", line: 1, message: "m1" },
    { ruleId: "R1", path: "a.js", line: 9, message: "m1" },
    { ruleId: "R2", path: "b.js", line: 3, message: "m2" },
  ]);
}
function payload(over = {}) {
  return {
    status: "COMPLETED",
    scanId: SCAN,
    repoOwner: "Acme",
    repoName: "Widget",
    createdAt: "2026-11-27T10:00:00.000Z",
    visibility: "public",
    engineVersion: "3.0",
    project: { healthScore: 81.3414 },
    violations: violations(),
    ...over,
  };
}

test("groups count findings per fingerprint hash", () => {
  const g = buildBaselineGroups(violations());
  assert.equal(g.count, 3);
  assert.deepEqual(Object.values(g.groups).sort(), [1, 2]);
  for (const k of Object.keys(g.groups)) assert.match(k, /^[0-9a-f]{24}$/);
});

test("a finding without a valid fingerprint, or no list, refuses the baseline", () => {
  assert.equal(buildBaselineGroups([{ ruleId: "R1" }]).error, "NO_FINGERPRINTS");
  assert.equal(buildBaselineGroups([{ fp: "x".repeat(24) + ".1" }]).error, "NO_FINGERPRINTS");
  assert.equal(buildBaselineGroups(undefined).error, "NO_FINGERPRINTS");
  assert.equal(buildBaselineGroups([]).count, 0);
});

test("more distinct groups than the cap is refused, never truncated", () => {
  const many = Array.from({ length: MAX_BASELINE_GROUPS + 1 }, (_, i) => ({ fp: `${i.toString(16).padStart(24, "0")}.1` }));
  assert.equal(buildBaselineGroups(many).error, "TOO_MANY_FINDINGS");
  assert.equal(buildBaselineGroups(many.slice(0, MAX_BASELINE_GROUPS)).count, MAX_BASELINE_GROUPS);
});

test("row: repo key is lower case from the report, numbers clamped, engine kept", () => {
  const { row, error } = buildBaselineRow({ userId: USER.id, scanId: SCAN, payload: payload() });
  assert.equal(error, undefined);
  assert.equal(row.repo_key, "acme/widget");
  assert.equal(row.health_score, 81.34);
  assert.equal(row.engine_version, "3.0");
  assert.equal(row.finding_count, 3);
  assert.equal(row.scanned_at, "2026-11-27T10:00:00.000Z");
  assert.equal(JSON.stringify(row).includes("a.js"), false, "no path in the row");
});

test("row: pasted-file scans, bad repo names and partial scans are refused", () => {
  const ref = (p) => buildBaselineRow({ userId: USER.id, scanId: SCAN, payload: p }).error;
  assert.equal(ref(payload({ repoOwner: undefined })), "NOT_A_REPO_SCAN");
  assert.equal(ref(payload({ repoName: ".." })), "NOT_A_REPO_SCAN");
  assert.equal(ref(payload({ repoOwner: "a/b" })), "NOT_A_REPO_SCAN");
  assert.equal(ref(payload({ partial: { scanned: 5, total: 50 } })), "PARTIAL");
  assert.equal(buildBaselineRow({ userId: null, scanId: SCAN, payload: payload() }).error, "NOT_A_REPO_SCAN");
});

// ---- handler -------------------------------------------------------------------------------

function fakeRes() {
  const r = { code: null, body: undefined, headers: {}, ended: false };
  r.setHeader = (k, v) => void (r.headers[k] = v);
  r.status = (c) => ((r.code = c), r);
  r.json = (b) => ((r.body = b), r);
  r.end = () => ((r.ended = true), r);
  return r;
}

function fakeSupabase({ user = USER, owned = [{ scan_id: SCAN }], stored = { [`${SCAN}.json`]: payload() }, upsertError = null } = {}) {
  const calls = { upsert: [], delete: [], ownedQuery: [] };
  return {
    calls,
    auth: { getUser: async (token) => (token === "good" && user ? { data: { user }, error: null } : { data: null, error: { message: "bad" } }) },
    storage: {
      from: () => ({
        download: async (key) => (stored[key] ? { data: { text: async () => JSON.stringify(stored[key]) }, error: null } : { data: null, error: { message: "nope" } }),
      }),
    },
    from(table) {
      if (table === "user_scans") {
        const q = { filters: {} };
        const b = {
          select: () => b,
          eq: (k, v) => ((q.filters[k] = v), b),
          limit: async () => (calls.ownedQuery.push(q.filters), { data: owned, error: null }),
        };
        return b;
      }
      assert.equal(table, "scan_baselines");
      return {
        upsert: async (row, opts) => (calls.upsert.push({ row, opts }), { error: upsertError }),
        delete: () => {
          const f = {};
          const b = { eq: (k, v) => ((f[k] = v), k === "repo_key" ? (calls.delete.push(f), Promise.resolve({ error: null })) : b) };
          return b;
        },
      };
    },
  };
}
const authed = { authorization: "Bearer good" };

test("POST needs a signed-in user", async () => {
  const res = fakeRes();
  await handleBaseline({ method: "POST", headers: {}, body: { scanId: SCAN } }, res, { supabase: fakeSupabase() });
  assert.equal(res.code, 401);
});

test("only POST and DELETE are served", async () => {
  const res = fakeRes();
  await handleBaseline({ method: "GET", headers: authed }, res, { supabase: fakeSupabase() });
  assert.equal(res.code, 405);
  assert.equal(res.headers.Allow, "POST, DELETE");
});

test("POST validates the scan id", async () => {
  for (const scanId of [undefined, 5, "../../etc", SCAN + "x", ""]) {
    const res = fakeRes();
    await handleBaseline({ method: "POST", headers: authed, body: { scanId } }, res, { supabase: fakeSupabase() });
    assert.equal(res.code, 400, String(scanId));
  }
});

test("POST stores the baseline of the caller's own scan; the repo comes from the report", async () => {
  const sb = fakeSupabase();
  const res = fakeRes();
  await handleBaseline({ method: "POST", headers: authed, body: { scanId: SCAN, repo: "evil/other" } }, res, { supabase: sb });
  assert.equal(res.code, 200);
  assert.equal(sb.calls.upsert.length, 1);
  assert.deepEqual(sb.calls.upsert[0].opts, { onConflict: "user_id,repo_key" });
  assert.equal(sb.calls.upsert[0].row.user_id, USER.id);
  assert.equal(sb.calls.upsert[0].row.repo_key, "acme/widget");
  assert.deepEqual(sb.calls.ownedQuery[0], { user_id: USER.id, scan_id: SCAN });
  assert.deepEqual(res.body, { repoKey: "acme/widget", scanId: SCAN, findingCount: 3, engineVersion: "3.0", scannedAt: "2026-11-27T10:00:00.000Z" });
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("a scan that is not in the caller's history is refused, nothing is stored", async () => {
  const sb = fakeSupabase({ owned: [] });
  const res = fakeRes();
  await handleBaseline({ method: "POST", headers: authed, body: { scanId: SCAN } }, res, { supabase: sb });
  assert.equal(res.code, 404);
  assert.equal(sb.calls.upsert.length, 0);
});

test("a private scan of someone else, or an unknown visibility, is refused like a missing scan", async () => {
  for (const over of [{ visibility: "private", ownerId: OTHER }, { visibility: "private" }, { visibility: "internal" }]) {
    const sb = fakeSupabase({ stored: { [`private/${SCAN}.json`]: payload(over) } });
    const res = fakeRes();
    await handleBaseline({ method: "POST", headers: authed, body: { scanId: SCAN } }, res, { supabase: sb });
    assert.equal(res.code, 404, JSON.stringify(over));
    assert.equal(sb.calls.upsert.length, 0);
  }
});

test("the caller's own private scan can be a baseline", async () => {
  const sb = fakeSupabase({ stored: { [`private/${SCAN}.json`]: payload({ visibility: "private", ownerId: USER.id }) } });
  const res = fakeRes();
  await handleBaseline({ method: "POST", headers: authed, body: { scanId: SCAN } }, res, { supabase: sb });
  assert.equal(res.code, 200);
});

test("a stored report from before fingerprints existed gets them on the way in", async () => {
  const old = payload();
  for (const v of old.violations) delete v.fp;
  const sb = fakeSupabase({ stored: { [`${SCAN}.json`]: old } });
  const res = fakeRes();
  await handleBaseline({ method: "POST", headers: authed, body: { scanId: SCAN } }, res, { supabase: sb });
  assert.equal(res.code, 200);
  assert.equal(res.body.findingCount, 3);
});

test("a partial scan is refused with a clear message", async () => {
  const sb = fakeSupabase({ stored: { [`${SCAN}.json`]: payload({ partial: { scanned: 5, total: 50 } }) } });
  const res = fakeRes();
  await handleBaseline({ method: "POST", headers: authed, body: { scanId: SCAN } }, res, { supabase: sb });
  assert.equal(res.code, 422);
  assert.match(res.body.error, /only part of the repo/);
});

test("a database failure is a generic 500 that leaks nothing", async () => {
  const orig = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(" "));
  try {
    const sb = fakeSupabase({ upsertError: { message: "connection refused to db.internal:5432" } });
    const res = fakeRes();
    await handleBaseline({ method: "POST", headers: authed, body: { scanId: SCAN } }, res, { supabase: sb });
    assert.equal(res.code, 500);
    assert.doesNotMatch(JSON.stringify(res.body), /internal|5432|good/);
    assert.ok(logged.every((l) => !l.includes("good") && !l.includes(USER.email)));
  } finally {
    console.error = orig;
  }
});

test("DELETE clears only the caller's row, repo key validated and lower-cased", async () => {
  const sb = fakeSupabase();
  const res = fakeRes();
  await handleBaseline({ method: "DELETE", headers: authed, query: { repo: "Acme/Widget" } }, res, { supabase: sb });
  assert.equal(res.code, 204);
  assert.deepEqual(sb.calls.delete, [{ user_id: USER.id, repo_key: "acme/widget" }]);
  for (const repo of [undefined, "", "a", "a/b/c", "../x", "a/..", "a b/c", ["x"]]) {
    const r = fakeRes();
    await handleBaseline({ method: "DELETE", headers: authed, query: { repo } }, r, { supabase: fakeSupabase() });
    assert.equal(r.code, 400, String(repo));
  }
  const anon = fakeRes();
  await handleBaseline({ method: "DELETE", headers: {}, query: { repo: "a/b" } }, anon, { supabase: fakeSupabase() });
  assert.equal(anon.code, 401);
});

test("every column the code writes exists in the migration; reads only, no client write policy", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261128_scan_baselines.sql", import.meta.url), "utf8");
  const body = sql.slice(sql.indexOf("create table"), sql.indexOf("primary key"));
  const columns = new Set([...body.matchAll(/^\s{2}([a-z_]+)\s/gm)].map((m) => m[1]));
  const { row } = buildBaselineRow({ userId: USER.id, scanId: SCAN, payload: payload() });
  for (const key of Object.keys(row)) assert.ok(columns.has(key), `column ${key} missing from migration`);
  assert.match(sql, /primary key \(user_id, repo_key\)/);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /scan_baselines_select_own/);
  assert.ok(!/for (insert|update|delete|all)\b/i.test(sql), "no client write policy");
});

test("the group cap matches the browser's", async (t) => {
  if (!process.features?.typescript) return t.skip("Node without TypeScript type stripping");
  const change = await import("../frontend/src/lib/change.ts");
  assert.equal(change.MAX_BASELINE_GROUPS, MAX_BASELINE_GROUPS);
});

test("the route is registered with a duration cap", () => {
  const cfg = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(cfg.functions["api/baseline.js"]?.maxDuration <= 10);
});
