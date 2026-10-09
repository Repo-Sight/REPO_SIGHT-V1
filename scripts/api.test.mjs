// scripts/api.test.mjs -- run with: npm run test:api  (node --test scripts/api.test.mjs)
//
// Guards the schema-v3 layer (rule catalog + report enrichment + /api/rules).
// Uses only node:test -- no new dependencies.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { RULES, TIERS, CONFIDENCES, getRule, listRules } from "../api/_lib/ruleCatalog.js";
import { enrichReport, scoreOf, FIX_FIRST_LIMIT } from "../api/_lib/enrich.js";
import rulesHandler from "../api/rules.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const fixture = () =>
  JSON.parse(readFileSync(join(here, "fixtures", "sample-report.json"), "utf8"));

// ---------------------------------------------------------------- catalog
test("catalog covers exactly the rule IDs the analyser can emit", () => {
  const dir = join(root, "analyser", "src", "rules");
  const ids = new Set();
  for (const f of readdirSync(dir).filter(n => n.endsWith("Rules.cpp"))) {
    const src = readFileSync(join(dir, f), "utf8");
    for (const m of src.matchAll(/"((?:cpp|py|java|js|ts|csharp)-[a-z0-9-]+)"/g)) ids.add(m[1]);
  }
  const catalog = new Set(Object.keys(RULES));
  const missing = [...ids].filter(i => !catalog.has(i));
  const orphaned = [...catalog].filter(i => !ids.has(i));
  assert.deepEqual(missing, [], `analyser rules missing from catalog: ${missing}`);
  assert.deepEqual(orphaned, [], `catalog rules the analyser doesn't have: ${orphaned}`);
  assert.ok(ids.size >= 60, "sanity: rule scan should find the full rule set");
});

test("every catalog entry is complete and valid", () => {
  for (const r of listRules()) {
    assert.ok(TIERS.includes(r.tier), `${r.ruleId} tier`);
    assert.ok(CONFIDENCES.includes(r.confidence), `${r.ruleId} confidence`);
    for (const k of ["title", "what", "why", "fix"]) {
      assert.equal(typeof r[k], "string", `${r.ruleId}.${k} is a string`);
      assert.ok(r[k].length > 10, `${r.ruleId}.${k} is non-trivial`);
    }
    assert.ok(r.language, `${r.ruleId} language`);
  }
});

test("security rules are categorised security, and hardcoded secrets rank critical", () => {
  for (const r of listRules()) {
    assert.equal(r.category, r.ruleId.includes("-sec-") ? "security" : "style");
  }
  for (const id of Object.keys(RULES).filter(i => i.endsWith("hardcoded-secret"))) {
    assert.equal(getRule(id).tier, "critical");
  }
});

test("getRule tolerates junk and returns fresh copies", () => {
  assert.equal(getRule("nope-not-a-rule"), null);
  assert.equal(getRule(undefined), null);
  assert.equal(getRule("__proto__"), null);
  assert.equal(getRule("constructor"), null);
  const a = getRule("py-sec-eval-exec");
  a.title = "mutated";
  assert.notEqual(getRule("py-sec-eval-exec").title, "mutated");
});

// ------------------------------------------------------------- enrichment
test("enrichReport adds v3 fields to a real analyser report without disturbing v2 fields", () => {
  const before = fixture();
  const after = enrichReport(fixture());

  assert.equal(after.schemaVersion, 3);
  assert.deepEqual(Object.keys(before).every(k => k in after), true, "no v2 key removed");

  after.violations.forEach((v, i) => {
    const b = before.violations[i];
    for (const k of Object.keys(b)) assert.equal(v[k], b[k], `violation[${i}].${k} unchanged`);
    assert.ok(TIERS.includes(v.tier));
    assert.ok(CONFIDENCES.includes(v.confidence));
  });

  const total = Object.values(after.tierCounts).reduce((a, b) => a + b, 0);
  assert.equal(total, before.violations.length, "tierCounts sums to violation count");
});

test("empty-catch rules are high tier / high confidence (drives the Fix now card)", () => {
  for (const id of ["java-empty-catch-block", "csharp-empty-catch-block", "js-empty-catch-block", "ts-empty-catch-block"]) {
    const rule = getRule(id);
    assert.equal(rule.tier, "high", `${id} tier`);
    assert.equal(rule.confidence, "high", `${id} confidence`);
    assert.equal(rule.category, "style", `${id} stays a style rule, not a security rule`);
  }
});

test("Fix First is ranked: hardcoded secret first, style noise last", () => {
  const { fixFirst } = enrichReport(fixture());
  assert.ok(fixFirst.length > 0 && fixFirst.length <= FIX_FIRST_LIMIT);
  assert.deepEqual(fixFirst[0].ruleIds, ["py-sec-hardcoded-secret"]);
  assert.equal(fixFirst[0].tier, "critical");
  assert.equal(fixFirst[0].rank, 1);
  for (let i = 1; i < fixFirst.length; i++) {
    assert.ok(fixFirst[i - 1].score >= fixFirst[i].score, "scores non-increasing");
    assert.equal(fixFirst[i].rank, i + 1);
  }
  for (const g of fixFirst) {
    assert.ok(g.what && g.why && g.fix, `${g.ruleId} has plain-English copy`);
    assert.ok(g.count >= 1 && g.affectedFiles >= 1);
    assert.ok(g.locations.length >= 1 && g.locations.length <= 5);
  }
});

test("enrichReport is idempotent", () => {
  const once = enrichReport(fixture());
  const snapshot = JSON.stringify(once);
  assert.equal(JSON.stringify(enrichReport(once)), snapshot);
});

test("scoreOf orders as documented", () => {
  assert.ok(scoreOf("critical", "medium") > scoreOf("high", "high"));
  assert.ok(scoreOf("high", "high") > scoreOf("high", "medium"));
  assert.ok(scoreOf("high", "medium") > scoreOf("medium", "high"));
  assert.equal(scoreOf("bogus", "high"), 0);
});

test("uncatalogued rule falls back from analyser severity instead of vanishing", () => {
  const r = enrichReport({
    violations: [
      { path: "a.py", line: 1, ruleId: "py-future-rule", severity: "warning", message: "new thing" },
      { path: "a.py", line: 2, ruleId: "py-other-rule", severity: "info", message: "minor" },
    ],
  });
  assert.equal(r.violations[0].tier, "medium");
  assert.equal(r.violations[1].tier, "low");
  assert.equal(r.violations[0].confidence, "low");
  assert.deepEqual(r.fixFirst[0].ruleIds, ["py-future-rule"]);
  assert.equal(r.fixFirst[0].catalogued, false);
  assert.equal(r.fixFirst[0].what, "new thing");
});

test("enrichReport never throws on empty or malformed input", () => {
  assert.equal(enrichReport(null), null);
  assert.equal(enrichReport(undefined), undefined);
  assert.equal(enrichReport("str"), "str");
  const arr = [];
  assert.equal(enrichReport(arr), arr);

  const empty = enrichReport({});
  assert.deepEqual(empty.fixFirst, []);
  assert.deepEqual(empty.tierCounts, { critical: 0, high: 0, medium: 0, low: 0 });

  const junk = enrichReport({ violations: [null, 5, "x", {}, { ruleId: 7, line: "z", path: 3 }] });
  assert.equal(junk.schemaVersion, 3);
  assert.ok(Array.isArray(junk.fixFirst));

  assert.deepEqual(enrichReport({ violations: "nope" }).fixFirst, []);
});

test("an already-v3 report is returned untouched", () => {
  const v3 = { schemaVersion: 3, fixFirst: [], violations: [{ ruleId: "py-sec-eval-exec" }] };
  const out = enrichReport(v3);
  assert.equal(out.violations[0].tier, undefined, "not re-processed");
});

test("groups a repeated rule into one Fix First entry with a count", () => {
  const violations = Array.from({ length: 12 }, (_, i) => ({
    path: `f${i % 3}.js`, line: i + 1, ruleId: "js-var-usage", severity: "info", category: "style",
  }));
  const { fixFirst } = enrichReport({ violations });
  assert.equal(fixFirst.length, 1);
  assert.equal(fixFirst[0].count, 12);
  assert.equal(fixFirst[0].affectedFiles, 3);
  assert.equal(fixFirst[0].locations.length, 5, "locations capped");
});

test("same problem across languages is ONE Fix First entry, not one per language", () => {
  const secret = (lang, path) => ({
    path, line: 1, ruleId: `${lang}-sec-hardcoded-secret`, severity: "warning", category: "security",
  });
  const { fixFirst } = enrichReport({
    violations: [
      secret("py", "a.py"), secret("java", "A.java"), secret("js", "a.js"),
      { path: "a.py", line: 9, ruleId: "py-sec-pickle-load", severity: "warning", category: "security" },
    ],
  });
  assert.equal(fixFirst.length, 2, "secrets collapse into one entry, pickle is another");
  assert.equal(fixFirst[0].title, "Hardcoded credential");
  assert.equal(fixFirst[0].count, 3);
  assert.deepEqual(fixFirst[0].ruleIds, ["java-sec-hardcoded-secret", "js-sec-hardcoded-secret", "py-sec-hardcoded-secret"]);
  assert.deepEqual(fixFirst[0].languages, ["java", "javascript", "python"]);
  assert.equal(fixFirst[0].affectedFiles, 3);
});

test("a rule variant with a different tier is not merged into its family", () => {
  const { fixFirst } = enrichReport({
    violations: [
      { path: "a.py", line: 1, ruleId: "py-sec-os-system", severity: "warning", category: "security" },
      { path: "a.cs", line: 1, ruleId: "csharp-sec-process-start", severity: "warning", category: "security" },
    ],
  });
  assert.equal(fixFirst.length, 2);
  assert.equal(fixFirst[0].tier, "high");
  assert.equal(fixFirst[1].tier, "medium");
});

// ------------------------------------------------------------------ API
function call(query = {}, method = "GET") {
  const res = {
    headers: {}, code: null, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
  rulesHandler({ method, query }, res);
  return res;
}

test("GET /api/rules returns the whole catalog, cacheable", () => {
  const res = call();
  assert.equal(res.code, 200);
  assert.equal(res.body.count, Object.keys(RULES).length);
  assert.deepEqual(res.body.tiers, TIERS);
  assert.match(res.headers["Cache-Control"], /s-maxage/);
});

test("GET /api/rules filters by language and category", () => {
  const py = call({ language: "python" });
  assert.ok(py.body.rules.length > 0 && py.body.rules.every(r => r.language === "python"));
  const sec = call({ category: "security" });
  assert.ok(sec.body.rules.every(r => r.category === "security"));
  const both = call({ language: "python", category: "security" });
  assert.ok(both.body.rules.every(r => r.ruleId.startsWith("py-sec-")));
});

test("GET /api/rules rejects bad input and wrong methods", () => {
  assert.equal(call({ language: "cobol" }).code, 400);
  assert.equal(call({ category: "vibes" }).code, 400);
  const post = call({}, "POST");
  assert.equal(post.code, 405);
  assert.equal(post.headers.Allow, "GET");
});
