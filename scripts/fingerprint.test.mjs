// scripts/fingerprint.test.mjs -- run with: npm run test:api
// Stable finding fingerprints: they must ignore what changes between scans of the same
// problem (scan id in the path, line numbers, measurements) and separate what does not.
import test from "node:test";
import assert from "node:assert/strict";
import { assignFingerprints, ensureFingerprints, normalizeMessage, normalizePath } from "../api/_lib/fingerprint.js";
import { enrichReport } from "../api/_lib/enrich.js";

const v = (o = {}) => ({
  path: "/tmp/scan-aaaa/src/app.js", line: 10, ruleId: "js-complex-function",
  message: "Function 'run' has cyclomatic complexity 18 (limit 10) -- split it into smaller functions",
  severity: "warning", category: "style", ...o,
});
const fpOf = (o) => assignFingerprints([v(o)])[0].fp;

test("normalizePath drops the per-scan prefix, backslashes and dot segments", () => {
  assert.equal(normalizePath("/tmp/scan-abc123/src/a/b.js"), "a/b.js");
  assert.equal(normalizePath("/tmp/scan-abc123/single.py"), "single.py");
  assert.equal(normalizePath("a\\b\\c.js"), "a/b/c.js");
  assert.equal(normalizePath("../../etc/./passwd"), "etc/passwd");
  assert.equal(normalizePath(undefined), "");
  assert.equal(normalizePath(42), "");
});

test("normalizeMessage blanks measurements but keeps quoted names and literals", () => {
  assert.equal(
    normalizeMessage("Function 'scan' has cyclomatic complexity 18 (limit 10) -- split"),
    "Function 'scan' has cyclomatic complexity # (limit #) -- split"
  );
  assert.equal(normalizeMessage("File reaches nesting depth 7 -- extract"), "File reaches nesting depth # -- extract");
  assert.equal(normalizeMessage("Magic number '3600' in condition"), "Magic number '3600' in condition");
  assert.equal(normalizeMessage("  lots   of \n space "), "lots of space");
  assert.equal(normalizeMessage(null), "");
  assert.ok(normalizeMessage("x".repeat(1000)).length <= 300);
});

test("the same problem keeps its fingerprint across scans, line moves and metric changes", () => {
  const base = fpOf();
  assert.equal(fpOf({ path: "/tmp/scan-zzzz/src/app.js" }), base, "scan id is not part of it");
  assert.equal(fpOf({ line: 400 }), base, "line number is not part of it");
  assert.equal(
    fpOf({ message: "Function 'run' has cyclomatic complexity 25 (limit 10) -- split it into smaller functions" }),
    base,
    "complexity 18 -> 25 is the same finding getting worse, not a new one"
  );
});

test("different rule, file, function or literal gives a different fingerprint", () => {
  const base = fpOf();
  assert.notEqual(fpOf({ ruleId: "js-long-method" }), base);
  assert.notEqual(fpOf({ path: "/tmp/scan-aaaa/src/other.js" }), base);
  assert.notEqual(fpOf({ message: "Function 'walk' has cyclomatic complexity 18 (limit 10) -- split it into smaller functions" }), base);
  const magic = (n) => fpOf({ ruleId: "js-magic-number", message: `Magic number '${n}' in condition` });
  assert.notEqual(magic(2), magic(3));
});

test("identical hits in one file get distinct, line-ordered suffixes; list order does not matter", () => {
  const a = assignFingerprints([v({ line: 30 }), v({ line: 5 }), v({ line: 18 })]);
  assert.deepEqual(a.map((x) => x.fp.split(".")[1]), ["3", "1", "2"], "ordinal follows line, not list position");
  assert.equal(new Set(a.map((x) => x.fp)).size, 3);
  const b = assignFingerprints([v({ line: 5 }), v({ line: 18 }), v({ line: 30 })]);
  assert.deepEqual([...a].sort((x, y) => x.line - y.line).map((x) => x.fp), b.map((x) => x.fp));
});

test("count semantics: one extra identical hit adds exactly one new fingerprint", () => {
  const before = new Set(assignFingerprints([v({ line: 1 }), v({ line: 2 })]).map((x) => x.fp));
  const after = assignFingerprints([v({ line: 1 }), v({ line: 2 }), v({ line: 3 })]).map((x) => x.fp);
  assert.deepEqual(after.filter((f) => !before.has(f)).length, 1);
});

test("assign and ensure never throw on junk and are idempotent", () => {
  assert.equal(assignFingerprints(null), null);
  assert.equal(assignFingerprints("x"), "x");
  assert.doesNotThrow(() => assignFingerprints([null, 5, "x", {}, { ruleId: 7, line: "z", path: 3, message: {} }]));
  const list = [v({ line: 3 }), v({ line: 9 })];
  assignFingerprints(list);
  const first = list.map((x) => x.fp);
  ensureFingerprints(list);
  assignFingerprints(list);
  assert.deepEqual(list.map((x) => x.fp), first);
  assert.ok(first.every((f) => /^[0-9a-f]{24}\.\d+$/.test(f)));
});

test("enrichReport adds fp to fresh AND already-enriched reports, and leaves schemaVersion at 3", () => {
  const fresh = enrichReport({ violations: [v()] });
  assert.match(fresh.violations[0].fp, /^[0-9a-f]{24}\.1$/);
  assert.equal(fresh.schemaVersion, 3);

  const stored = { schemaVersion: 3, fixFirst: [], violations: [{ ruleId: "py-sec-eval-exec", path: "a.py", line: 1, message: "x" }] };
  enrichReport(stored);
  assert.match(stored.violations[0].fp, /^[0-9a-f]{24}\.1$/, "scans enriched before fp existed get it on read");
  assert.equal(stored.violations[0].tier, undefined, "and are still not re-ranked");
});
