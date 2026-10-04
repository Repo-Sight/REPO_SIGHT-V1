// Pure data for the printable PDF audit. No React, no DOM: the document component only
// lays out what this returns, so every number in the PDF comes from the report JSON.

import { SCORE_COMPONENTS, TIERS, languageLabel, relPath, violationsByPath } from "./report";
import type { FixFirstItem, ProjectMetrics, ScanReport, Tier, Violation } from "./report";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const AUDIT_LIMITS = {
  fixFirstLocations: 3,
  hotspots: 10,
  securityRules: 10,
  securityLocations: 5,
  duplicateMatches: 5,
} as const;

export interface AuditKpi {
  label: string;
  value: string;
}

export interface AuditComponentRow {
  title: string;
  score: number;
  weight: number;
  measured: string;
  tip: string;
}

export interface AuditLanguageRow {
  label: string;
  files: number;
  codeLines: number;
  /** Percent of analyzed code lines, 0-100. */
  share: number;
  functions: number;
  complexity: number;
}

export interface AuditHotspot {
  path: string;
  language: string;
  codeLines: number;
  complexity: number;
  nesting: number;
  findings: number;
  /** Critical + high findings in this file. */
  severe: number;
}

export interface AuditSecurityGroup {
  ruleId: string;
  tier?: Tier;
  count: number;
  files: number;
  message: string;
  locations: string[];
  more: number;
}

export interface AuditFixFirst extends Omit<FixFirstItem, "locations"> {
  locations: string[];
}

export interface AuditModel {
  title: string;
  /** "owner/repo (branch)" for repo scans, otherwise null. */
  source: string | null;
  /** YYYY-MM-DD, or null when the report has no timestamp. */
  scannedOn: string | null;
  /** First 8 characters of the scan id, or null for the bundled sample. */
  scanRef: string | null;
  isSample: boolean;
  grade: string;
  score: number;
  kpis: AuditKpi[];
  /** Null on older (schema 2) reports that carry no severity tiers. */
  tierCounts: Record<Tier, number> | null;
  totalFindings: number;
  summary: string[];
  fixFirst: AuditFixFirst[];
  components: AuditComponentRow[];
  languages: AuditLanguageRow[];
  hotspots: AuditHotspot[];
  security: { total: number; ruleCount: number; groups: AuditSecurityGroup[]; hiddenRules: number };
  duplication: { percentage: number; lines: number; matches: string[] } | null;
  unanalyzed: string | null;
  schemaVersion: number | null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function isTier(t: string | undefined): t is Tier {
  return !!t && (TIERS as string[]).includes(t);
}

/** Same ranking the Scoring tab uses: biggest weighted shortfall first. */
export function weakestScoreComponent(p: ProjectMetrics): { title: string; score: number; weight: number } | null {
  const b = p.scoreBreakdown;
  if (!b) return null;
  let best: { title: string; score: number; weight: number; gap: number } | null = null;
  for (const c of SCORE_COMPONENTS) {
    const score = Math.max(0, Math.min(100, b[c.key] ?? 0));
    const gap = (100 - score) * c.weight;
    if (score < 100 && (!best || gap > best.gap)) best = { title: c.title, score, weight: c.weight, gap };
  }
  return best ? { title: best.title, score: best.score, weight: best.weight } : null;
}

function countTiers(report: ScanReport): Record<Tier, number> | null {
  if (report.tierCounts) return report.tierCounts;
  if (!report.violations.some((v) => isTier(v.tier))) return null;
  const counts: Record<Tier, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const v of report.violations) if (isTier(v.tier)) counts[v.tier] += 1;
  return counts;
}

function buildLanguages(report: ScanReport): AuditLanguageRow[] {
  const rows = (report.byLanguage ?? []).map((l) => ({
    label: languageLabel(l.language),
    files: l.fileCount,
    codeLines: l.codeLines,
    functions: l.functionCount,
    complexity: l.cyclomaticComplexity,
  }));
  if (rows.length === 0) {
    const byLang = new Map<string, AuditLanguageRow>();
    for (const f of report.files) {
      const label = languageLabel(f.language);
      const row = byLang.get(label) ?? { label, files: 0, codeLines: 0, share: 0, functions: 0, complexity: 0 };
      row.files += 1;
      row.codeLines += f.codeLines;
      row.functions += f.functionCount;
      row.complexity += f.cyclomaticComplexity;
      byLang.set(label, row);
    }
    rows.push(...byLang.values());
  }
  const total = rows.reduce((n, r) => n + r.codeLines, 0);
  return rows
    .map((r) => ({ ...r, share: total > 0 ? (r.codeLines / total) * 100 : 0 }))
    .sort((a, b) => b.codeLines - a.codeLines || a.label.localeCompare(b.label));
}

function buildHotspots(report: ScanReport): AuditHotspot[] {
  const byPath = violationsByPath(report.violations);
  return report.files
    .map((f) => {
      const found = byPath.get(f.path) ?? [];
      return {
        path: relPath(f.path),
        language: languageLabel(f.language),
        codeLines: f.codeLines,
        complexity: f.cyclomaticComplexity,
        nesting: f.maxNestingDepth,
        findings: found.length,
        severe: found.filter((v) => v.tier === "critical" || v.tier === "high").length,
      };
    })
    .sort(
      (a, b) =>
        b.severe - a.severe || b.findings - a.findings || b.complexity - a.complexity || a.path.localeCompare(b.path),
    )
    .slice(0, AUDIT_LIMITS.hotspots);
}

function buildSecurity(report: ScanReport): AuditModel["security"] {
  const byRule = new Map<string, Violation[]>();
  for (const v of report.violations) {
    if (v.category !== "security") continue;
    const list = byRule.get(v.ruleId);
    if (list) list.push(v);
    else byRule.set(v.ruleId, [v]);
  }
  const tierRank = (v: Violation) => (isTier(v.tier) ? TIERS.indexOf(v.tier) : TIERS.length);
  const all = [...byRule.entries()]
    .map(([ruleId, items]) => {
      const sorted = [...items].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
      return {
        ruleId,
        rank: Math.min(...items.map(tierRank)),
        tier: items.map((i) => i.tier).find(isTier),
        count: items.length,
        files: new Set(items.map((i) => i.path)).size,
        message: items[0].message,
        locations: sorted
          .slice(0, AUDIT_LIMITS.securityLocations)
          .map((v) => `${relPath(v.path)}${v.line > 0 ? `:${v.line}` : ""}`),
        more: Math.max(0, items.length - AUDIT_LIMITS.securityLocations),
      };
    })
    .sort((a, b) => a.rank - b.rank || b.count - a.count || a.ruleId.localeCompare(b.ruleId));
  const total = all.reduce((n, g) => n + g.count, 0);
  const groups = all.slice(0, AUDIT_LIMITS.securityRules).map(({ rank: _rank, ...g }) => g);
  return { total, ruleCount: all.length, groups, hiddenRules: Math.max(0, all.length - groups.length) };
}

function fmtMatch(m: { pathA: string; lineStartA: number; lineEndA: number; pathB: string; lineStartB: number; lineEndB: number }) {
  return `${relPath(m.pathA)}:${m.lineStartA}-${m.lineEndA} <-> ${relPath(m.pathB)}:${m.lineStartB}-${m.lineEndB}`;
}

export function buildAuditModel(report: ScanReport): AuditModel {
  const p = report.project;
  const created = report.createdAt ? new Date(report.createdAt) : null;
  const scannedOn = created && !Number.isNaN(created.getTime()) ? created.toISOString().slice(0, 10) : null;
  const isSample = !UUID_RE.test(report.scanId);
  const tierCounts = countTiers(report);
  const totalFindings = report.violations.length;
  const languages = buildLanguages(report);
  const security = buildSecurity(report);
  const dup = report.duplication ?? null;
  const unanalyzed = report.unanalyzedLanguages ?? [];

  const score = Math.round(p.healthScore);
  const summary: string[] = [
    `${plural(p.filesAnalyzed, "file")} (${p.codeLines.toLocaleString("en-US")} code lines) in ${plural(languages.length, "language")} were analyzed. Overall code health is ${score}/100, grade ${p.healthGrade}.`,
  ];
  if (tierCounts) {
    summary.push(
      `${plural(totalFindings, "finding")} in total: ${tierCounts.critical} critical, ${tierCounts.high} high, ${tierCounts.medium} medium, ${tierCounts.low} low.`,
    );
  } else {
    summary.push(`${plural(totalFindings, "finding")} in total.`);
  }
  const weakest = weakestScoreComponent(p);
  if (weakest) {
    summary.push(
      `Largest improvement opportunity: ${weakest.title.toLowerCase()} (${Math.round(weakest.score)}/100, ${Math.round(weakest.weight * 100)}% of the score).`,
    );
  }
  if (security.total > 0) {
    summary.push(`${plural(security.total, "potential security issue")} across ${plural(security.ruleCount, "rule")} need review.`);
  }
  if (dup) summary.push(`${dup.duplicatePercentage.toFixed(1)}% of lines sit in duplicated blocks.`);

  const b = p.scoreBreakdown;
  const components: AuditComponentRow[] = b
    ? SCORE_COMPONENTS.map((c) => ({
        title: c.title,
        score: Math.round(Math.max(0, Math.min(100, b[c.key] ?? 0))),
        weight: Math.round(c.weight * 100),
        measured: c.describe(p),
        tip: c.tip,
      }))
    : [];

  return {
    title: report.projectName ?? "Single file scan",
    source: report.repoOwner && report.repoName ? `${report.repoOwner}/${report.repoName}${report.repoBranch ? ` (${report.repoBranch})` : ""}` : null,
    scannedOn,
    scanRef: isSample ? null : report.scanId.slice(0, 8),
    isSample,
    grade: p.healthGrade,
    score,
    kpis: [
      { label: "Files", value: p.filesAnalyzed.toLocaleString("en-US") },
      { label: "Code lines", value: p.codeLines.toLocaleString("en-US") },
      { label: "Functions", value: p.functionCount.toLocaleString("en-US") },
      { label: "Complexity", value: p.cyclomaticComplexity.toLocaleString("en-US") },
      { label: "Max nesting", value: String(p.maxNestingDepth) },
      { label: "Avg function", value: `${p.avgFunctionLength.toFixed(1)} lines` },
      { label: "Duplication", value: dup ? `${dup.duplicatePercentage.toFixed(1)}%` : "n/a" },
      { label: "Findings", value: totalFindings.toLocaleString("en-US") },
    ],
    tierCounts,
    totalFindings,
    summary,
    fixFirst: (report.fixFirst ?? []).map((item) => ({
      ...item,
      locations: item.locations.slice(0, AUDIT_LIMITS.fixFirstLocations).map((l) => `${relPath(l.path)}${l.line > 0 ? `:${l.line}` : ""}`),
    })),
    components,
    languages,
    hotspots: buildHotspots(report),
    security,
    duplication: dup
      ? {
          percentage: dup.duplicatePercentage,
          lines: dup.duplicateLineCount,
          matches: [...(dup.matches ?? [])]
            .sort((a, c) => c.lineCount - a.lineCount)
            .slice(0, AUDIT_LIMITS.duplicateMatches)
            .map(fmtMatch),
        }
      : null,
    unanalyzed:
      unanalyzed.length > 0
        ? unanalyzed.map((u) => `${u.languageName} (${plural(u.fileCount, "file")}, ${plural(u.lineCount, "line")})`).join(", ")
        : null,
    schemaVersion: report.schemaVersion ?? null,
  };
}
