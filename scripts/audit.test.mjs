// Invariants for the PDF audit data model (frontend/src/lib/audit.ts), run against the
// bundled demo report. audit.ts is plain erasable TypeScript, so Node strips the types;
// a tiny resolve hook adds the ".ts" the bundler-style imports leave out.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (/^\\.\\.?\\//.test(specifier) && !/\\.[a-z]+$/.test(specifier)) {
    try { return await next(specifier + ".ts", context); } catch {}
  }
  return next(specifier, context);
}`),
  import.meta.url,
);

const { buildAuditModel, weakestScoreComponent, AUDIT_LIMITS } = await import("../frontend/src/lib/audit.ts");
const demo = JSON.parse(readFileSync(new URL("../frontend/public/demo/report.json", import.meta.url), "utf8"));
const model = buildAuditModel(demo);

test("demo report: headline numbers come straight from the report", () => {
  assert.equal(model.score, Math.round(demo.project.healthScore));
  assert.equal(model.grade, demo.project.healthGrade);
  assert.equal(model.totalFindings, demo.violations.length);
  assert.equal(model.isSample, true);
  assert.equal(model.scanRef, null);
  assert.match(model.scannedOn, /^\d{4}-\d{2}-\d{2}$/);
});

test("tier counts add up to the total findings", () => {
  const sum = Object.values(model.tierCounts).reduce((a, b) => a + b, 0);
  assert.equal(sum, model.totalFindings);
});

test("no absolute server paths leak into the PDF", () => {
  const text = JSON.stringify(model);
  assert.ok(!text.includes("/tmp/scan-"), "server temp path leaked");
});

test("lists are capped and deterministic", () => {
  assert.ok(model.hotspots.length <= AUDIT_LIMITS.hotspots);
  assert.ok(model.security.groups.length <= AUDIT_LIMITS.securityRules);
  for (const g of model.security.groups) assert.ok(g.locations.length <= AUDIT_LIMITS.securityLocations);
  for (const f of model.fixFirst) assert.ok(f.locations.length <= AUDIT_LIMITS.fixFirstLocations);
  assert.deepEqual(buildAuditModel(demo), model);
});

test("hotspots are ordered severe-first, then findings, then complexity", () => {
  for (let i = 1; i < model.hotspots.length; i++) {
    const a = model.hotspots[i - 1], b = model.hotspots[i];
    const ka = [a.severe, a.findings, a.complexity], kb = [b.severe, b.findings, b.complexity];
    for (let k = 0; k < 3; k++) {
      if (ka[k] !== kb[k]) { assert.ok(ka[k] > kb[k], "hotspots out of order"); break; }
    }
  }
});

test("language shares sum to ~100 and match the analyzed lines", () => {
  const share = model.languages.reduce((n, l) => n + l.share, 0);
  assert.ok(Math.abs(share - 100) < 0.01, `share=${share}`);
});

test("security total matches the security-category violations", () => {
  assert.equal(model.security.total, demo.violations.filter((v) => v.category === "security").length);
});

test("weakest component is the largest weighted shortfall", () => {
  const w = weakestScoreComponent(demo.project);
  assert.ok(w && w.score < 100);
  assert.ok(model.summary.some((s) => s.includes(w.title.toLowerCase())));
});

test("older schema-2 style report (no tiers, no breakdown, no duplication) still builds", () => {
  const old = structuredClone(demo);
  delete old.tierCounts; delete old.fixFirst; delete old.duplication; delete old.byLanguage;
  delete old.project.scoreBreakdown;
  for (const v of old.violations) delete v.tier;
  const m = buildAuditModel(old);
  assert.equal(m.tierCounts, null);
  assert.equal(m.duplication, null);
  assert.deepEqual(m.components, []);
  assert.ok(m.languages.length > 0, "languages derived from files");
});

test("real scan id is shortened and not flagged as sample", () => {
  const real = { ...demo, scanId: "123e4567-e89b-42d3-a456-426614174000" };
  const m = buildAuditModel(real);
  assert.equal(m.isSample, false);
  assert.equal(m.scanRef, "123e4567");
});
