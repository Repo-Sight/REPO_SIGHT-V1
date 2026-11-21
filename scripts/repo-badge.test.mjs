// scripts/repo-badge.test.mjs -- run with: npm run test:api
// Pure and fake-client tests for the live per-repo badge: input parsing, the badge text, and
// the "never throw into a scan" contract of the repo_latest helpers.
import test from "node:test";
import assert from "node:assert/strict";
import { parseRepoParams, summarizeReport, recordRepoLatest, getRepoLatest } from "../api/_lib/repoLatest.js";
import { repoBadgeModel, handleBadge } from "../api/badge/[scanId].js";

const SCAN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const payload = { project: { healthGrade: "b", healthScore: 84.4 } };

function fakeDb({ row = null, upsertError = null, selectError = null } = {}) {
  const upserts = [];
  return {
    upserts,
    from: (table) => {
      assert.equal(table, "repo_latest");
      return {
        upsert: async (r, o) => (upserts.push({ r, o }), { error: upsertError }),
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: selectError }) }) }),
      };
    },
  };
}
const res = () => {
  const r = { code: 0, body: undefined, headers: {} };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

test("parseRepoParams lowercases, strips .svg only when asked, and rejects bad names", () => {
  assert.equal(parseRepoParams("Octo", "Hello-World"), "octo/hello-world");
  assert.equal(parseRepoParams("octo", "hello.svg", { stripSvg: true }), "octo/hello");
  assert.equal(parseRepoParams("octo", "hello.svg"), "octo/hello.svg");
  for (const [o, r] of [["", "x"], ["x", ""], ["-bad", "x"], ["a/b", "x"], ["x", "../etc"], ["x", ".."], ["x", "."], ["x", "a b"], [undefined, "x"], ["a".repeat(40), "x"]]) {
    assert.equal(parseRepoParams(o, r), null, `${o}/${r}`);
  }
});

test("summarizeReport accepts only a valid grade and a 0-100 score", () => {
  assert.deepEqual(summarizeReport(payload), { grade: "B", score: 84.4 });
  assert.equal(summarizeReport({ project: { healthGrade: "Z", healthScore: 50 } }), null);
  assert.equal(summarizeReport({ project: { healthGrade: "A", healthScore: 101 } }), null);
  assert.equal(summarizeReport({ project: { healthGrade: "A" } }), null);
  assert.equal(summarizeReport(null), null);
});

test("recordRepoLatest upserts by repo key and never throws", async () => {
  const db = fakeDb();
  assert.equal(await recordRepoLatest(db, { repo: "octo/hello", scanId: SCAN, payload }), true);
  assert.equal(db.upserts[0].r.repo_key, "octo/hello");
  assert.equal(db.upserts[0].r.scan_id, SCAN);
  assert.equal(db.upserts[0].r.health_grade, "B");
  assert.equal(db.upserts[0].o.onConflict, "repo_key");
  assert.equal("removed" in db.upserts[0].r, false, "an upsert must never reset a takedown");

  assert.equal(await recordRepoLatest(db, { repo: null, scanId: SCAN, payload }), false);
  assert.equal(await recordRepoLatest(db, { repo: "o/r", scanId: SCAN, payload: {} }), false);
  assert.equal(await recordRepoLatest(fakeDb({ upsertError: { code: "42P01" } }), { repo: "o/r", scanId: SCAN, payload }), false);
  assert.equal(await recordRepoLatest({ from() { throw new Error("boom"); } }, { repo: "o/r", scanId: SCAN, payload }), false);
});

test("getRepoLatest hides removed rows and swallows errors", async () => {
  const row = { scan_id: SCAN, health_grade: "A", health_score: 95, scanned_at: "2026-11-20T10:00:00Z", removed: false };
  assert.equal((await getRepoLatest(fakeDb({ row }), "o/r")).scan_id, SCAN);
  assert.equal(await getRepoLatest(fakeDb({ row: { ...row, removed: true } }), "o/r"), null);
  assert.equal(await getRepoLatest(fakeDb({ row: null }), "o/r"), null);
  assert.equal(await getRepoLatest(fakeDb({ selectError: { code: "x" } }), "o/r"), null);
  assert.equal(await getRepoLatest(fakeDb({ row }), null), null);
});

test("repoBadgeModel shows grade, rounded score and the scan date", () => {
  const m = repoBadgeModel({ health_grade: "a", health_score: 91.6, scanned_at: "2026-11-20T23:59:00Z" });
  assert.equal(m.value, "A \u00b7 92 \u00b7 2026-11-20");
  assert.equal(m.color, "#4c1");
  for (const bad of [null, {}, { health_grade: "Q", health_score: 5, scanned_at: "2026-11-20" }, { health_grade: "A", health_score: 5, scanned_at: "nope" }]) {
    assert.equal(repoBadgeModel(bad).value, "not scanned");
  }
});

test("by-repo badge: invalid repo -> 400 badge, unknown -> grey not scanned, known -> graded", async () => {
  const bad = res();
  await handleBadge({ method: "GET", query: { scanId: "by-repo", owner: "../x", repo: "y" } }, bad, { supabase: fakeDb() });
  assert.equal(bad.code, 400);
  assert.ok(bad.body.includes("invalid repo"));

  const unknown = res();
  await handleBadge({ method: "GET", query: { scanId: "by-repo", owner: "o", repo: "r.svg" } }, unknown, { supabase: fakeDb({ row: null }) });
  assert.equal(unknown.code, 200);
  assert.ok(unknown.body.includes("not scanned"));

  const known = res();
  const row = { scan_id: SCAN, health_grade: "C", health_score: 71, scanned_at: "2026-11-20T10:00:00Z", removed: false };
  await handleBadge({ method: "GET", query: { scanId: "by-repo", owner: "o", repo: "r" } }, known, { supabase: fakeDb({ row }) });
  assert.ok(known.body.includes("C \u00b7 71 \u00b7 2026-11-20"));
  assert.equal(known.headers["content-type"], "image/svg+xml; charset=utf-8");
});

test("the existing per-scan badge URL still resolves to the old handler path (400 on a bad id)", async () => {
  const r = res();
  await handleBadge({ method: "GET", query: { scanId: "not-a-uuid.svg" } }, r, { supabase: fakeDb() });
  assert.equal(r.code, 400);
  assert.ok(r.body.includes("invalid id"));
});
