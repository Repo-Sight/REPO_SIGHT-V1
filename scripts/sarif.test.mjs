// scripts/sarif.test.mjs -- run with: npm run test:api
// SARIF 2.1.0 + JSON export of a stored report.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildJsonExport, buildSarif, levelFor, MAX_SARIF_RESULTS, SARIF_SCHEMA } from "../api/_lib/sarif.js";
import { enrichReport } from "../api/_lib/enrich.js";
import { FINGERPRINT_KEY } from "../api/_lib/fingerprint.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const demo = () => enrichReport(JSON.parse(readFileSync(join(root, "frontend/public/demo/report.json"), "utf8")));

test("levelFor: critical and high security are errors, style stays below that", () => {
  assert.equal(levelFor("critical", "security"), "error");
  assert.equal(levelFor("critical", "style"), "error");
  assert.equal(levelFor("high", "security"), "error");
  assert.equal(levelFor("high", "style"), "warning");
  assert.equal(levelFor("medium", "style"), "warning");
  assert.equal(levelFor("low", "style"), "note");
  assert.equal(levelFor(undefined, undefined), "note");
});

test("buildSarif on the demo report: valid envelope, one result per finding, rules deduped", () => {
  const report = demo();
  const sarif = buildSarif(report);
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.$schema, SARIF_SCHEMA);
  assert.equal(sarif.runs.length, 1);
  const run = sarif.runs[0];
  assert.equal(run.tool.driver.name, "REPO-SIGHT");
  assert.equal(run.results.length, report.violations.length);
  assert.equal(run.properties.omittedResults, 0);

  const ids = run.tool.driver.rules.map((r) => r.id);
  assert.deepEqual(ids, [...ids].sort(), "rules sorted");
  assert.equal(new Set(ids).size, ids.length, "rules unique");
  for (const r of run.results) {
    assert.equal(run.tool.driver.rules[r.ruleIndex].id, r.ruleId, "ruleIndex points at its rule");
    assert.ok(["error", "warning", "note"].includes(r.level));
    assert.ok(r.message.text.length > 0);
    assert.ok(r.locations[0].physicalLocation.region.startLine >= 1, "GitHub rejects line 0");
    assert.equal(r.locations[0].physicalLocation.artifactLocation.uriBaseId, "%SRCROOT%");
  }
  const fps = run.results.map((r) => r.partialFingerprints[FINGERPRINT_KEY]);
  assert.equal(new Set(fps).size, fps.length, "fingerprints unique, so GitHub can track each alert");
});

test("SARIF carries no server paths, relative uris only, and file-level findings point at line 1", () => {
  const text = JSON.stringify(buildSarif(demo()));
  assert.ok(!text.includes("/tmp/scan-"), "no internal scan path");
  const fileLevel = buildSarif(demo()).runs[0].results.find((r) => r.properties.fileLevel);
  assert.ok(fileLevel, "demo has a file-level finding (line 0)");
  assert.equal(fileLevel.locations[0].physicalLocation.region.startLine, 1);
  assert.ok(!fileLevel.locations[0].physicalLocation.artifactLocation.uri.startsWith("/"));
});

test("security rules carry security-severity; catalogued rules carry what / why / fix", () => {
  const rules = buildSarif(demo()).runs[0].tool.driver.rules;
  const sec = rules.find((r) => r.id === "cpp-sec-popen-call");
  assert.equal(sec.properties["security-severity"], "8.0");
  assert.equal(sec.defaultConfiguration.level, "error");
  const style = rules.find((r) => r.id === "js-empty-catch-block");
  assert.equal(style.properties["security-severity"], undefined);
  assert.match(style.help.markdown, /\*\*How to fix it:\*\*/);
  assert.equal(style.properties.precision, "high");
});

test("uncatalogued rules still export, from the finding's own message", () => {
  const sarif = buildSarif({ violations: [{ path: "a.js", line: 3, ruleId: "js-brand-new-rule", message: "Something odd", severity: "warning", category: "style" }] });
  const rule = sarif.runs[0].tool.driver.rules[0];
  assert.equal(rule.id, "js-brand-new-rule");
  assert.equal(rule.shortDescription.text, "js-brand-new-rule");
  assert.match(rule.help.text, /Something odd/);
  assert.equal(sarif.runs[0].results[0].level, "note");
});

test("untrusted text: control characters are stripped, uris are encoded, nothing throws on junk", () => {
  const sarif = buildSarif({
    violations: [
      { path: "/tmp/scan-x/src/we ird#name?.js", line: 2, ruleId: "js-x", message: "bad\u0000\u001b[31m text\nsecond line" },
      { path: "", line: 1, ruleId: "js-x", message: "no path" },
      null, 7, "x",
    ],
  });
  const run = sarif.runs[0];
  assert.equal(run.results.length, 1, "pathless finding omitted, junk skipped");
  assert.equal(run.properties.omittedResults, 1);
  assert.ok(!/[\u0000-\u001f]/.test(run.results[0].message.text));
  assert.equal(run.results[0].locations[0].physicalLocation.artifactLocation.uri, "we%20ird%23name%3F.js");
  assert.doesNotThrow(() => buildSarif(null));
  assert.doesNotThrow(() => buildSarif({}));
  assert.equal(buildSarif({}).runs[0].results.length, 0);
});

test("over the GitHub limit, the most severe findings are kept and the loss is reported", () => {
  const violations = Array.from({ length: MAX_SARIF_RESULTS + 5 }, (_, i) => ({
    path: `f${i}.js`, line: 1, ruleId: "js-x", message: `m${i}`, tier: i < 5 ? "critical" : "low", confidence: "high", category: "style",
  }));
  const run = buildSarif({ violations }).runs[0];
  assert.equal(run.results.length, MAX_SARIF_RESULTS);
  assert.equal(run.properties.omittedResults, 5);
  assert.equal(run.results.filter((r) => r.level === "error").length, 5, "all critical findings survived the cut");
});

test("repo scans record where they came from", () => {
  const run = buildSarif({ repoOwner: "acme", repoName: "web app", repoBranch: "main", violations: [] }).runs[0];
  assert.equal(run.versionControlProvenance[0].repositoryUri, "https://github.com/acme/web%20app");
  assert.equal(run.versionControlProvenance[0].branch, "main");
  assert.equal(buildSarif({ violations: [] }).runs[0].versionControlProvenance, undefined);
});

test("buildJsonExport: same report, repo-relative paths everywhere, fingerprints present, input untouched", () => {
  const report = demo();
  const before = JSON.stringify(report.files[0]);
  const out = buildJsonExport(report);
  assert.ok(!JSON.stringify(out).includes("/tmp/scan-"), "also dependency lists, duplicate pairs and hotspots");
  assert.equal(out.files.length, report.files.length);
  assert.equal(out.violations.length, report.violations.length);
  assert.ok(out.violations.every((x) => typeof x.fp === "string"));
  assert.equal(out.project.healthScore, report.project.healthScore);
  assert.equal(JSON.stringify(report.files[0]), before, "export is a copy");
  assert.equal(buildJsonExport(null), null);
});
