// scripts/trend.test.mjs -- run with: npm run test:api
// Score trend (frontend/src/lib/trend.ts): history rows to chart points, engine-change markers and
// a summary that never blames the repo for an engine change. TypeScript is stripped by Node 22.18+.
import test from "node:test";
import assert from "node:assert/strict";

const canStrip = Boolean(process.features?.typescript);
let mod = null;
if (canStrip) mod = await import("../frontend/src/lib/trend.ts");
const opts = { skip: canStrip ? false : "Node without TypeScript type stripping" };

let n = 0;
function row(over = {}) {
  n += 1;
  return {
    scan_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    commit_sha: null,
    branch: "main",
    engine_version: "3.0",
    health_score: 80,
    health_grade: "B",
    score_complexity: 90,
    score_function_length: 80,
    score_comments: 70,
    score_todo: 100,
    score_nesting: 60,
    tier_critical: 0,
    tier_high: 1,
    tier_medium: 2,
    tier_low: 3,
    partial: false,
    scanned_at: new Date(Date.UTC(2026, 10, n)).toISOString(),
    ...over,
  };
}

test("rows are sorted oldest first and numeric strings are read (Postgres numeric)", opts, () => {
  const a = row({ health_score: "70.50" });
  const b = row({ health_score: "75.00" });
  const t = mod.buildTrend([b, a]);
  assert.deepEqual(t.points.map((p) => p.scanId), [a.scan_id, b.scan_id]);
  assert.equal(t.points[0].values.health, 70.5);
  assert.equal(t.points[1].tiers.high, 1);
});

test("rows with no usable score or date are dropped, duplicates keep the first", opts, () => {
  const ok = row();
  const t = mod.buildTrend([
    ok,
    { ...ok, health_score: 10 },
    row({ health_score: null }),
    row({ health_score: "abc" }),
    row({ scanned_at: "not a date" }),
    null,
    { scan_id: 5 },
  ]);
  assert.equal(t.points.length, 1);
  assert.equal(t.points[0].values.health, 80);
});

test("scores are clamped to 0..100 and bad commits are dropped", opts, () => {
  const t = mod.buildTrend([row({ health_score: 150, score_nesting: -4, commit_sha: "zz; drop" }), row({ commit_sha: "a".repeat(40) })]);
  assert.equal(t.points[0].values.health, 100);
  assert.equal(t.points[0].values.nesting, 0);
  assert.equal(t.points[0].commit, null);
  assert.equal(t.points[1].commit, "a".repeat(40));
});

test("only the newest `limit` points are kept", opts, () => {
  const rows = Array.from({ length: 10 }, (_, i) => row({ health_score: i * 10 }));
  const t = mod.buildTrend(rows, 4);
  assert.deepEqual(t.points.map((p) => p.values.health), [60, 70, 80, 90]);
});

test("an engine change gets a marker at the first point of the new engine", opts, () => {
  const t = mod.buildTrend([row(), row(), row({ engine_version: "3.1" }), row({ engine_version: "3.1" }), row({ engine_version: "3.2" })]);
  assert.deepEqual(t.markers, [
    { index: 2, from: "3.0", to: "3.1" },
    { index: 4, from: "3.1", to: "3.2" },
  ]);
});

test("summary change is measured only across scans of the latest engine", opts, () => {
  const t = mod.buildTrend([
    row({ health_score: 90 }),
    row({ health_score: 88 }),
    row({ health_score: 70, engine_version: "3.1" }),
    row({ health_score: 74, engine_version: "3.1" }),
  ]);
  const s = t.summary;
  assert.equal(s.engineVersion, "3.1");
  assert.equal(s.comparableScans, 2);
  assert.equal(s.change, 4); // not -16: the 90 to 70 step is the engine
  assert.equal(s.earlierEngine, true);
  assert.equal(s.best, 74);
  assert.equal(s.worst, 70);
  assert.match(mod.describeTrend(s), /^Up 4 points over 2 scans under the current engine\.$/);
});

test("partial scans are drawn but never counted in the summary", opts, () => {
  const t = mod.buildTrend([row({ health_score: 80 }), row({ health_score: 20, partial: true }), row({ health_score: 85 })]);
  assert.equal(t.points.length, 3);
  assert.equal(t.points[1].partial, true);
  assert.equal(t.summary.fullScans, 2);
  assert.equal(t.summary.change, 5);
  assert.equal(t.summary.worst, 80);
});

test("one comparable scan has no change yet; no full scan has no summary", opts, () => {
  assert.equal(mod.buildTrend([row()]).summary.change, null);
  assert.match(mod.describeTrend(mod.buildTrend([row()]).summary), /Scan again/);
  assert.equal(mod.buildTrend([row({ partial: true })]).summary, null);
  assert.equal(mod.buildTrend([]).summary, null);
  assert.equal(mod.buildTrend(undefined).points.length, 0);
  assert.equal(mod.describeTrend(null), "No full scans to chart yet.");
});

test("describeTrend wording: down, unchanged, singular", opts, () => {
  const down = mod.buildTrend([row({ health_score: 80 }), row({ health_score: 79 })]).summary;
  assert.equal(mod.describeTrend(down), "Down 1 point over 2 scans.");
  const same = mod.buildTrend([row({ health_score: 80 }), row({ health_score: 80 })]).summary;
  assert.equal(mod.describeTrend(same), "Unchanged at 80 over 2 scans.");
});

test("an unknown engine string is kept apart from known ones", opts, () => {
  const t = mod.buildTrend([row({ engine_version: "" }), row()]);
  assert.equal(t.points[0].engineVersion, "unknown");
  assert.equal(t.markers.length, 1);
});
