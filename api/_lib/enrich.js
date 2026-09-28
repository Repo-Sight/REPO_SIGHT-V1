// api/_lib/enrich.js
//
// Turns the analyser's flat violation list into something a developer can
// act on: every violation gets a `tier` and `confidence`, and the report
// gets `tierCounts` plus a ranked `fixFirst` list.
//
// PURELY ADDITIVE (schemaVersion 2 rule: never break old consumers):
//   - no existing key is removed, renamed or reordered
//   - `severity` / `category` on violations are left exactly as the
//     analyser wrote them
//   - `schemaVersion` is raised 2 -> 3 only to signal "tier/confidence/
//     fixFirst are present"; v2 consumers ignore the extra keys
//
// Runs at write time in api/analyze.js and api/analyze-file.js, and again
// on read in api/scans/[scanId].js so scans stored before this existed get
// the same fields without a migration. Idempotent. Never throws: a scan
// must not fail because ranking failed.
import { getRule } from "./ruleCatalog.js";

export const ENRICHED_SCHEMA_VERSION = 3;
export const FIX_FIRST_LIMIT = 5;
const LOCATIONS_PER_GROUP = 5;

// Ranking = impact (tier) x confidence. Numbers are deliberately coarse:
// the order they produce must be explainable in one sentence.
//   critical/medium = 70  >  high/high = 60  >  high/medium = 42
//   >  medium/high = 30   >  high/low = 24   >  medium/medium = 21 ...
const TIER_IMPACT = { critical: 100, high: 60, medium: 30, low: 10 };
const CONFIDENCE_WEIGHT = { high: 1.0, medium: 0.7, low: 0.4 };
const TIER_ORDER = ["critical", "high", "medium", "low"];

// Rules missing from the catalog (a new analyser rule shipped without
// catalog copy) still get ranked, conservatively, from the analyser's own
// severity so nothing silently vanishes from Fix First.
function fallbackClassification(v) {
  const isWarning = v?.severity === "warning";
  return {
    tier: isWarning ? "medium" : "low",
    confidence: "low",
  };
}

function classify(v) {
  const rule = getRule(v?.ruleId);
  if (rule) return { tier: rule.tier, confidence: rule.confidence, rule };
  return { ...fallbackClassification(v), rule: null };
}

export function scoreOf(tier, confidence) {
  const impact = TIER_IMPACT[tier] ?? 0;
  const weight = CONFIDENCE_WEIGHT[confidence] ?? 0;
  return Math.round(impact * weight * 10) / 10;
}

function emptyTierCounts() {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

export function enrichReport(report) {
  try {
    if (!report || typeof report !== "object" || Array.isArray(report)) return report;

    // Already enriched (e.g. stored by a newer deploy): leave untouched.
    if (report.schemaVersion >= ENRICHED_SCHEMA_VERSION && Array.isArray(report.fixFirst)) {
      return report;
    }

    const violations = Array.isArray(report.violations) ? report.violations : [];
    const tierCounts = emptyTierCounts();
    // One Fix First entry per PROBLEM, not per rule ID: "hardcoded credential"
    // in Python, Java and JS is one job for the developer, not three. Keyed
    // by the catalog title (shared across a rule family) + tier + confidence,
    // so a language variant ranked differently stays its own entry.
    const groups = new Map();

    for (const v of violations) {
      if (!v || typeof v !== "object") continue;

      const { tier, confidence, rule } = classify(v);
      if (v.tier === undefined) v.tier = tier;
      if (v.confidence === undefined) v.confidence = confidence;
      tierCounts[v.tier] = (tierCounts[v.tier] ?? 0) + 1;

      const ruleId = typeof v.ruleId === "string" ? v.ruleId : "unknown";
      const title = rule?.title ?? ruleId;
      const key = `${title}|${v.tier}|${v.confidence}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          title,
          tier: v.tier,
          confidence: v.confidence,
          score: scoreOf(v.tier, v.confidence),
          category: v.category ?? (rule?.category || "style"),
          // Uncatalogued rules fall back to the analyser's own one-line
          // message (derived from scanned source -- consumers must escape
          // it like any other violation message).
          what: rule?.what ?? v.message ?? "",
          why: rule?.why ?? "",
          fix: rule?.fix ?? "",
          catalogued: !!rule,
          count: 0,
          ruleIds: new Set(),
          languages: new Set(),
          files: new Set(),
          locations: [],
        };
        if (rule?.caveat) g.caveat = rule.caveat;
        groups.set(key, g);
      }
      g.count += 1;
      g.ruleIds.add(ruleId);
      const lang = v.language ?? rule?.language;
      if (typeof lang === "string") g.languages.add(lang);
      if (typeof v.path === "string") g.files.add(v.path);
      if (g.locations.length < LOCATIONS_PER_GROUP) {
        g.locations.push({ path: v.path ?? null, line: Number.isInteger(v.line) ? v.line : 0 });
      }
    }

    const ranked = [...groups.values()]
      .sort(
        (a, b) =>
          b.score - a.score ||
          TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
          b.count - a.count ||
          a.title.localeCompare(b.title)
      )
      .slice(0, FIX_FIRST_LIMIT)
      .map((g, i) => {
        const { files, ruleIds, languages, ...rest } = g;
        return {
          rank: i + 1,
          ...rest,
          ruleIds: [...ruleIds].sort(),
          languages: [...languages].sort(),
          affectedFiles: files.size,
        };
      });

    report.tierCounts = tierCounts;
    report.fixFirst = ranked;
    report.schemaVersion = ENRICHED_SCHEMA_VERSION;
    return report;
  } catch (err) {
    console.error("enrichReport failed (report returned unenriched):", err);
    return report;
  }
}
