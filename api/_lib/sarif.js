// api/_lib/sarif.js
//
// Machine-readable exports of a stored report (V3 plan, Phase 1 item 2). Pure functions, no I/O:
//   buildSarif(report)      SARIF 2.1.0, ready for GitHub code scanning and coding agents
//   buildJsonExport(report) the report itself with repo-relative paths (no "/tmp/scan-<id>/" prefix)
//
// Served by api/scans/[scanId].js (?format=sarif | json) after the same access check as the
// report, so a private scan's export is owner-only. The Action (item 7) reuses buildSarif.
//
// Text taken from scanned source (messages, paths) is plain text here: control characters are
// removed and nothing is ever interpreted as markup.
import { getRule } from "./ruleCatalog.js";
import { scoreOf } from "./enrich.js";
import { FINGERPRINT_KEY, ensureFingerprints, normalizePath } from "./fingerprint.js";

export const SARIF_VERSION = "2.1.0";
export const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";
// GitHub code scanning accepts at most 25,000 results per run.
export const MAX_SARIF_RESULTS = 25000;

const SECURITY_SEVERITY = { critical: "9.5", high: "8.0", medium: "5.0", low: "2.0" };

// critical -> error; high -> error for security rules, warning otherwise; medium -> warning; low -> note.
export function levelFor(tier, category) {
  if (tier === "critical") return "error";
  if (tier === "high") return category === "security" ? "error" : "warning";
  if (tier === "medium") return "warning";
  return "note";
}

const clean = (s, max = 1000) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const encodeUri = (relPath) => relPath.split("/").map(encodeURIComponent).join("/");

function ruleDescriptor(ruleId, violation) {
  const rule = getRule(ruleId);
  const tier = rule?.tier ?? violation.tier ?? "low";
  const category = rule?.category ?? violation.category ?? "style";
  const confidence = rule?.confidence ?? violation.confidence ?? "low";
  const title = rule?.title ?? ruleId;
  const parts = rule ? [rule.what, rule.why, rule.fix, rule.caveat].filter(Boolean) : [clean(violation.message)];
  const tags = [category, ...(rule?.language ? [rule.language] : [])];
  const d = {
    id: ruleId,
    name: clean(title, 120),
    shortDescription: { text: clean(title, 200) },
    fullDescription: { text: clean(parts.join(" "), 1000) },
    help: {
      text: parts.map((p) => clean(p, 600)).join("\n\n"),
      markdown: rule
        ? [
            `**What:** ${clean(rule.what, 600)}`,
            `**Why it matters:** ${clean(rule.why, 600)}`,
            `**How to fix it:** ${clean(rule.fix, 600)}`,
            ...(rule.caveat ? [`*${clean(rule.caveat, 600)}*`] : []),
          ].join("\n\n")
        : clean(violation.message, 600),
    },
    defaultConfiguration: { level: levelFor(tier, category) },
    properties: { tags, precision: confidence },
  };
  if (category === "security") d.properties["security-severity"] = SECURITY_SEVERITY[tier] ?? SECURITY_SEVERITY.low;
  return d;
}

export function buildSarif(report) {
  const all = Array.isArray(report?.violations) ? report.violations.filter((v) => v && typeof v === "object") : [];
  ensureFingerprints(all);

  // Findings with no usable path cannot be placed in a SARIF location; count them instead of inventing one.
  const placed = all.filter((v) => normalizePath(v.path) !== "");
  let omitted = all.length - placed.length;

  let kept = placed;
  if (kept.length > MAX_SARIF_RESULTS) {
    kept = [...kept]
      .sort((a, b) => scoreOf(b.tier, b.confidence) - scoreOf(a.tier, a.confidence))
      .slice(0, MAX_SARIF_RESULTS);
    omitted += placed.length - kept.length;
  }

  const firstByRule = new Map();
  for (const v of kept) {
    const id = String(v.ruleId ?? "unknown");
    if (!firstByRule.has(id)) firstByRule.set(id, v);
  }
  const ruleIds = [...firstByRule.keys()].sort();
  const ruleIndex = new Map(ruleIds.map((id, i) => [id, i]));
  const rules = ruleIds.map((id) => ruleDescriptor(id, firstByRule.get(id)));

  const results = kept.map((v) => {
    const ruleId = String(v.ruleId ?? "unknown");
    const rule = getRule(ruleId);
    const tier = v.tier ?? rule?.tier ?? "low";
    const category = v.category ?? rule?.category ?? "style";
    const line = Number.isInteger(v.line) ? v.line : 0;
    return {
      ruleId,
      ruleIndex: ruleIndex.get(ruleId),
      level: levelFor(tier, category),
      message: { text: clean(v.message) || ruleId },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: encodeUri(normalizePath(v.path)), uriBaseId: "%SRCROOT%" },
            // GitHub rejects line 0; file-level findings (no single line) point at line 1.
            region: { startLine: Math.max(1, line) },
          },
        },
      ],
      partialFingerprints: { [FINGERPRINT_KEY]: v.fp },
      properties: { tier, confidence: v.confidence ?? rule?.confidence ?? "low", category, fileLevel: line < 1 },
    };
  });

  const run = {
    tool: {
      driver: {
        name: "REPO-SIGHT",
        informationUri: "https://www.repo-sight.com/",
        rules,
      },
    },
    columnKind: "utf16CodeUnits",
    results,
    properties: {
      scanId: typeof report?.scanId === "string" ? report.scanId : null,
      healthScore: report?.project?.healthScore ?? null,
      healthGrade: report?.project?.healthGrade ?? null,
      omittedResults: omitted,
      // Present only when the scan covered a sample of the repo (see api/_lib/partial.js).
      ...(report?.partial ? { partial: { filesScanned: report.partial.filesScanned, filesTotal: report.partial.filesTotal } } : {}),
    },
  };
  if (typeof report?.repoOwner === "string" && typeof report?.repoName === "string") {
    run.versionControlProvenance = [
      {
        repositoryUri: `https://github.com/${encodeURIComponent(report.repoOwner)}/${encodeURIComponent(report.repoName)}`,
        ...(typeof report.repoBranch === "string" ? { branch: report.repoBranch } : {}),
      },
    ];
  }
  return { $schema: SARIF_SCHEMA, version: SARIF_VERSION, runs: [run] };
}

// Same shape as the stored report (so the frontend's ScanReport type still describes it), with every
// scan path made repo-relative. The "/tmp/scan-<id>/" prefix is an internal server path and changes per
// scan. Any string that starts with it is rewritten, whatever its key, so new path-bearing fields
// (dependency lists, duplicate pairs, hotspots) cannot leak it by being forgotten here.
const SCAN_PATH_PREFIX = "/tmp/scan-";

function relativize(node, depth) {
  if (typeof node === "string") return node.startsWith(SCAN_PATH_PREFIX) ? normalizePath(node) : node;
  if (depth > 12 || node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => relativize(n, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = relativize(v, depth + 1);
  return out;
}

export function buildJsonExport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return report;
  ensureFingerprints(report.violations);
  return relativize(report, 0);
}
