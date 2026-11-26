// scripts/partial.test.mjs -- run with: npm run test:api
// Time-budgeted ("partial") scans: the server-side budget helpers, and the committed analyser binary's
// --time-budget-ms behavior (a stale binary that lacks the flag fails here, not silently in production).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENGINE_BUDGET_MAX_MS, ENGINE_BUDGET_MIN_MS, RESPONSE_RESERVE_MS,
  budgetOverride, engineBudgetMs, sanitizePartial,
} from "../api/_lib/partial.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(root, "backend", "bin", "linux-x64-cma");

test("engineBudgetMs: the engine gets what is left minus the reserve, capped, or null when too little", () => {
  assert.equal(engineBudgetMs(0, 55_000), ENGINE_BUDGET_MAX_MS, "fast download: capped at 45s");
  assert.equal(engineBudgetMs(10_000, 55_000), 40_000, "55 - 10 - reserve");
  assert.equal(engineBudgetMs(55_000 - RESPONSE_RESERVE_MS - ENGINE_BUDGET_MIN_MS, 55_000), ENGINE_BUDGET_MIN_MS, "exactly the minimum is still enough");
  assert.equal(engineBudgetMs(55_000 - RESPONSE_RESERVE_MS - ENGINE_BUDGET_MIN_MS + 1, 55_000), null, "one ms less is not");
  assert.equal(engineBudgetMs(60_000, 55_000), null, "already past the window");
  assert.equal(engineBudgetMs(12_345.9, 55_000), 37_654);
});

test("budgetOverride accepts only a positive integer string", () => {
  assert.equal(budgetOverride("1"), 1);
  assert.equal(budgetOverride(" 2500 "), 2500);
  for (const bad of [undefined, null, "", "0", "-5", "1.5", "abc", "1e3", "9999999999", 12]) assert.equal(budgetOverride(bad), null, String(bad));
});

test("sanitizePartial keeps a real partial block and rejects everything else", () => {
  assert.deepEqual(sanitizePartial({ filesScanned: 10, filesTotal: 400, reason: "whatever", extra: "<script>" }), { filesScanned: 10, filesTotal: 400, reason: "time_budget" });
  for (const bad of [null, undefined, "x", [], {}, { filesScanned: 0, filesTotal: 5 }, { filesScanned: 5, filesTotal: 5 }, { filesScanned: 6, filesTotal: 5 },
    { filesScanned: "3", filesTotal: 9 }, { filesScanned: 1.5, filesTotal: 9 }, { filesScanned: 1, filesTotal: 1e9 }, { filesScanned: -1, filesTotal: 9 }]) {
    assert.equal(sanitizePartial(bad), null, JSON.stringify(bad));
  }
});

// --------------------------------------------------- the committed binary
function makeTree(n) {
  const dir = mkdtempSync(join(tmpdir(), "rs-partial-"));
  for (let d = 0; d < 5; d++) mkdirSync(join(dir, `pkg${d}`));
  for (let i = 0; i < n; i++) {
    writeFileSync(join(dir, `pkg${i % 5}`, `m${i}.py`), `import os\n\ndef f${i}(x):\n    if x > ${i}:\n        return x\n    return os.getcwd()\n`);
  }
  return dir;
}
function run(dir, extra = []) {
  const out = join(dir, "..", `rs-out-${Math.random().toString(36).slice(2)}.json`);
  execFileSync(BIN, [dir, "--json", out, ...extra], { stdio: "pipe", timeout: 60_000 });
  const text = readFileSync(out, "utf8");
  rmSync(out, { force: true });
  return { text, report: JSON.parse(text) };
}

test("binary: a tiny budget stops early and says so, with a report that describes exactly the sample", () => {
  chmodSync(BIN, 0o755);
  const dir = makeTree(400);
  try {
    const { report } = run(dir, ["--time-budget-ms", "1"]);
    assert.ok(report.partial, "committed binary supports --time-budget-ms (rebuild and commit backend/bin if this fails)");
    assert.equal(report.partial.filesTotal, 400);
    assert.ok(report.partial.filesScanned >= 1 && report.partial.filesScanned < 400);
    assert.equal(report.partial.reason, "time_budget");
    assert.equal(report.project.filesAnalyzed, report.partial.filesScanned);
    assert.equal(report.files.length, report.partial.filesScanned);
    const paths = report.files.map((f) => f.path);
    assert.deepEqual(paths, [...paths].sort(), "files come back in path order, not sampling order");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("binary: a generous budget finishes everything and equals a run with no budget", () => {
  chmodSync(BIN, 0o755);
  const dir = makeTree(150);
  try {
    const none = run(dir);
    const generous = run(dir, ["--time-budget-ms", "600000"]);
    assert.equal(generous.report.partial, undefined, "complete scans carry no partial block");
    assert.equal(generous.text, none.text, "a budget that is never hit changes nothing");
    assert.equal(none.report.project.filesAnalyzed, 150);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("binary: samples come from one fixed order (smaller sample is a prefix of a bigger one) and a nonsense budget is ignored", () => {
  chmodSync(BIN, 0o755);
  const dir = makeTree(60);
  try {
    // How many files a 1 ms budget gets through depends on timing, but WHICH files come first does not:
    // every run walks the same hash order, so two samples are always nested.
    const a = new Set(run(dir, ["--time-budget-ms", "1"]).report.files.map((f) => f.path));
    const b = new Set(run(dir, ["--time-budget-ms", "1"]).report.files.map((f) => f.path));
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    assert.ok(small.size >= 1);
    assert.ok([...small].every((p) => big.has(p)), "the smaller sample is contained in the bigger one");
    const junk = run(dir, ["--time-budget-ms", "abc"]).report;
    assert.equal(junk.partial, undefined);
    assert.equal(junk.project.filesAnalyzed, 60);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
