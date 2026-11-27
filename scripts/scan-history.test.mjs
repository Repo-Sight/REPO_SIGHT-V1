// scripts/scan-history.test.mjs -- run with: npm run test:api
// Compact per-scan history (api/_lib/scanHistory.js), the engine-version pin, the commit-id
// reader, and the migration/code parity check. The full pipeline is covered in private-scan.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildHistoryRow, recordScanHistory } from "../api/_lib/scanHistory.js";
import { ENGINE_VERSION, RULESET_PIN } from "../api/_lib/engineVersion.js";
import { RULES } from "../api/_lib/ruleCatalog.js";
import { readCommitSha } from "../api/_lib/github.js";

const SHA = "a".repeat(40);
const payload = {
  project: {
    healthScore: 81.3414,
    healthGrade: "B",
    scoreBreakdown: { complexityDensity: 100, avgFunctionLength: 100, commentCoverage: 56.7072, todoDensity: 100, nestingDepth: 0 },
    filesAnalyzed: 101,
    totalLines: 22805,
  },
  tierCounts: { critical: 0, high: 33, medium: 56, low: 90 },
};
const base = { userId: "u1", repo: "acme/repo", scanId: "5b1c1c0e-6f4e-4c4e-9f4a-0d6b7a8c9d10", commit: SHA, branch: "main", payload, partial: null };

test("builds one compact numeric row from a stored report", () => {
  const row = buildHistoryRow(base);
  assert.deepEqual(row, {
    user_id: "u1",
    repo_key: "acme/repo",
    scan_id: base.scanId,
    commit_sha: SHA,
    branch: "main",
    engine_version: ENGINE_VERSION,
    health_score: 81.34,
    health_grade: "B",
    score_complexity: 100,
    score_function_length: 100,
    score_comments: 56.71,
    score_todo: 100,
    score_nesting: 0,
    tier_critical: 0,
    tier_high: 33,
    tier_medium: 56,
    tier_low: 90,
    files_analyzed: 101,
    total_lines: 22805,
    partial: false,
  });
});

test("a partial scan is flagged so the trend can dim it", () => {
  assert.equal(buildHistoryRow({ ...base, partial: { scanned: 10, total: 40 } }).partial, true);
});

test("no usable score means no row (no holes in the trend)", () => {
  for (const healthScore of [undefined, null, "x", NaN, Infinity]) {
    assert.equal(buildHistoryRow({ ...base, payload: { ...payload, project: { ...payload.project, healthScore } } }), null);
  }
  assert.equal(buildHistoryRow({ ...base, payload: {} }), null);
  assert.equal(buildHistoryRow({ ...base, userId: null }), null);
  assert.equal(buildHistoryRow({ ...base, repo: null }), null);
  assert.equal(buildHistoryRow({ ...base, scanId: "" }), null);
});

test("scores are clamped to 0..100, counts are non-negative integers, bad commits are dropped", () => {
  const row = buildHistoryRow({
    ...base,
    commit: "not-a-sha; drop table",
    branch: "b".repeat(300),
    payload: {
      project: { healthScore: 140, healthGrade: "ABC", scoreBreakdown: { complexityDensity: -5, nestingDepth: "oops" }, filesAnalyzed: -3, totalLines: 7.9 },
      tierCounts: { critical: "2", high: -1, medium: null },
    },
  });
  assert.equal(row.health_score, 100);
  assert.equal(row.health_grade, "AB");
  assert.equal(row.score_complexity, 0);
  assert.equal(row.score_nesting, null);
  assert.equal(row.score_comments, null);
  assert.equal(row.commit_sha, null);
  assert.equal(row.branch.length, 100);
  assert.equal(row.files_analyzed, 0);
  assert.equal(row.total_lines, 7);
  assert.deepEqual([row.tier_critical, row.tier_high, row.tier_medium, row.tier_low], [2, 0, 0, 0]);
});

test("recordScanHistory upserts into scan_history keyed on scan_id", async () => {
  const calls = [];
  const supabase = { from: (t) => ({ upsert: async (row, opts) => (calls.push({ t, row, opts }), { error: null }) }) };
  await recordScanHistory(supabase, base);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].t, "scan_history");
  assert.deepEqual(calls[0].opts, { onConflict: "scan_id" });
  assert.equal(calls[0].row.scan_id, base.scanId);
});

test("recordScanHistory never throws: error result, thrown error, no client, no row", async () => {
  const origErr = console.error;
  console.error = () => {};
  try {
    await recordScanHistory({ from: () => ({ upsert: async () => ({ error: { message: "boom" } }) }) }, base);
    await recordScanHistory({ from: () => ({ upsert: async () => { throw new Error("net down"); } }) }, base);
    await recordScanHistory({ from: () => { throw new Error("no table"); } }, base);
    await recordScanHistory(null, base);
    await recordScanHistory({ from: () => ({ upsert: async () => { throw new Error("must not be called"); } }) }, { ...base, userId: null });
  } finally {
    console.error = origErr;
  }
});

test("engine version is pinned to the rule catalog: change the rules, review the version", () => {
  const pin = createHash("sha256").update(Object.keys(RULES).sort().join("\n")).digest("hex").slice(0, 16);
  assert.equal(
    pin,
    RULESET_PIN,
    "The rule catalog changed. Bump ENGINE_VERSION in api/_lib/engineVersion.js if scores can move, then set RULESET_PIN to " + pin
  );
  assert.match(ENGINE_VERSION, /^\d+\.\d+$/);
});

test("readCommitSha accepts only a 40-hex id from the global pax header", () => {
  assert.equal(readCommitSha({ globalExtended: { comment: SHA } }), SHA);
  assert.equal(readCommitSha({ globalExtended: { comment: SHA.toUpperCase() } }), null);
  assert.equal(readCommitSha({ globalExtended: { comment: "abc" } }), null);
  assert.equal(readCommitSha({ globalExtended: { comment: SHA + "\n; evil" } }), null);
  assert.equal(readCommitSha({ globalExtended: {} }), null);
  assert.equal(readCommitSha({}), null);
  assert.equal(readCommitSha(undefined), null);
});

test("every column the code writes exists in the migration, with the same name", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261127_scan_history.sql", import.meta.url), "utf8");
  const body = sql.slice(sql.indexOf("create table"), sql.indexOf(");"));
  const columns = new Set([...body.matchAll(/^\s{2}([a-z_]+)\s/gm)].map((m) => m[1]));
  for (const key of Object.keys(buildHistoryRow(base))) assert.ok(columns.has(key), `column ${key} missing from migration`);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /scan_history_select_own/);
  assert.ok(!/for (insert|update|delete|all)\b/i.test(sql), "no client write policy");
});
