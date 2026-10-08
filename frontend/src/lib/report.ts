// Report types + pure helpers. Mirrors the JSON the analyser + api/_lib/enrich.js
// produce (schemaVersion 3). Every field the UI does not strictly need is optional,
// so older stored scans (schema 2, no tiers) still render.

export type Tier = "critical" | "high" | "medium" | "low";
export type Confidence = "high" | "medium" | "low";

export interface ScoreBreakdown {
  complexityDensity: number;
  avgFunctionLength: number;
  commentCoverage: number;
  todoDensity: number;
  nestingDepth: number;
}

export interface ProjectMetrics {
  filesAnalyzed: number;
  totalLines: number;
  codeLines: number;
  commentLines: number;
  functionCount: number;
  classCount: number;
  maxNestingDepth: number;
  cyclomaticComplexity: number;
  todoCount: number;
  avgFunctionLength: number;
  longestFunctionLines: number;
  longestFunctionName: string;
  healthScore: number;
  healthGrade: string;
  scoreBreakdown?: ScoreBreakdown;
}

export interface LanguageAggregate {
  language: string;
  fileCount: number;
  totalLines: number;
  codeLines: number;
  functionCount: number;
  maxNestingDepth: number;
  cyclomaticComplexity: number;
}

export interface FileMetrics {
  path: string;
  language: string;
  totalLines: number;
  codeLines: number;
  functionCount: number;
  maxNestingDepth: number;
  cyclomaticComplexity: number;
  todoCount: number;
}

export interface Violation {
  path: string;
  line: number;
  ruleId: string;
  language?: string;
  message: string;
  severity: string;
  category?: string;
  tier?: Tier;
  confidence?: Confidence;
}

export interface FixFirstLocation {
  path: string | null;
  line: number;
}

export interface FixFirstItem {
  rank: number;
  title: string;
  tier: Tier;
  confidence: Confidence;
  count: number;
  affectedFiles: number;
  what: string;
  why: string;
  fix: string;
  caveat?: string;
  languages: string[];
  locations: FixFirstLocation[];
}

export interface UnanalyzedLanguage {
  extension: string;
  languageName: string;
  fileCount: number;
  lineCount: number;
}

export interface DuplicateMatch {
  pathA: string;
  lineStartA: number;
  lineEndA: number;
  pathB: string;
  lineStartB: number;
  lineEndB: number;
  tokenCount?: number;
  lineCount: number;
}

export interface HotspotFile {
  path: string;
  cyclomaticComplexity: number;
  /** Absent on reports produced before the no-git fallback existed. */
  maxNestingDepth?: number;
  commitCount: number;
  linesAdded: number;
  linesDeleted: number;
  hotspotScore: number;
}

/**
 * "git": every file ranked by complexity x churn. "complexity": no git history
 * (every repo-tarball scan), so the analyser returns the top few files by
 * cyclomatic complexity and nesting depth. Both are empty when nothing branches.
 */
export interface HotspotReport {
  gitAvailable: boolean;
  /** Absent on reports produced before the no-git fallback existed. */
  mode?: "git" | "complexity";
  topFiles: HotspotFile[];
}

export interface ScanReport {
  status: "COMPLETED" | "FAILED";
  errorMessage?: string;
  scanId: string;
  /** Absent on pre-visibility scans, which are public. Private scans are owner-only. */
  visibility?: "public" | "private";
  projectName?: string;
  /** Present on repo scans (not pasted files). Needed for AI explanations. */
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
  createdAt?: string;
  schemaVersion?: number;
  project: ProjectMetrics;
  files: FileMetrics[];
  byLanguage?: LanguageAggregate[];
  unanalyzedLanguages?: UnanalyzedLanguage[];
  hotspots?: HotspotReport;
  violations: Violation[];
  tierCounts?: Record<Tier, number>;
  fixFirst?: FixFirstItem[];
  duplication?: { duplicatePercentage: number; duplicateLineCount: number; matches?: DuplicateMatch[] };
}

export const TIERS: Tier[] = ["critical", "high", "medium", "low"];

const LANGUAGE_LABELS: Record<string, string> = {
  cpp: "C++",
  python: "Python",
  java: "Java",
  typescript: "TypeScript",
  javascript: "JavaScript",
  csharp: "C#",
};

export function languageLabel(language: string | undefined): string {
  if (!language) return "Unknown";
  return LANGUAGE_LABELS[language.toLowerCase()] ?? language;
}

/**
 * The analyser reports absolute server paths. Repo scans: /tmp/scan-<id>/src/<path>.
 * Single-file scans: /tmp/scan-<id>/<name>. Show only the part the user recognises.
 */
export function relPath(path: string | null | undefined): string {
  if (!path) return "(unknown file)";
  return path.replace(/^\/tmp\/scan-[^/]+\/(?:src\/)?/, "");
}

export function formatNumber(n: number | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "0";
}

export function violationsByPath(violations: Violation[]): Map<string, Violation[]> {
  const map = new Map<string, Violation[]>();
  for (const v of violations) {
    const list = map.get(v.path);
    if (list) list.push(v);
    else map.set(v.path, [v]);
  }
  return map;
}

/** Mirrors analyser/src/report/HealthScore.cpp weights; breakdown values are 0-100 per component. */
export const SCORE_COMPONENTS: {
  key: keyof ScoreBreakdown;
  title: string;
  weight: number;
  tip: string;
  describe: (p: ProjectMetrics) => string;
}[] = [
  {
    key: "complexityDensity",
    title: "Complexity density",
    weight: 0.35,
    tip: "Break large functions into smaller ones and cut branching (if/else, loops) per function.",
    describe: (p) =>
      `${(p.cyclomaticComplexity / Math.max(1, p.codeLines)).toFixed(2)} cyclomatic complexity per code line (target: 0.15 or lower)`,
  },
  {
    key: "avgFunctionLength",
    title: "Average function length",
    weight: 0.25,
    tip: "Split your longest functions into smaller, single-purpose ones. The Files tab shows where.",
    describe: (p) => `${p.avgFunctionLength.toFixed(1)} lines per function on average (target: 15 or fewer)`,
  },
  {
    key: "commentCoverage",
    title: "Comment coverage",
    weight: 0.2,
    tip: "Comment the non-obvious logic, starting with your most complex files.",
    describe: (p) =>
      `${((p.commentLines / Math.max(1, p.codeLines)) * 100).toFixed(1)}% of code lines are comments (target: 20% or more)`,
  },
  {
    key: "todoDensity",
    title: "TODO density",
    weight: 0.1,
    tip: "Resolve or delete TODO/FIXME markers instead of letting them pile up.",
    describe: (p) =>
      `${((p.todoCount / Math.max(1, p.codeLines)) * 100).toFixed(1)}% of code lines carry a TODO/FIXME (target: 1% or lower)`,
  },
  {
    key: "nestingDepth",
    title: "Max nesting depth",
    weight: 0.1,
    tip: "Flatten deep if/loop blocks with early returns and guard clauses.",
    describe: (p) => `Deepest nesting is ${p.maxNestingDepth} levels (target: 3 or shallower)`,
  },
];
