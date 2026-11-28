// Score trend (V3 plan, Phase 2 item 5.2): turns the compact scan_history rows of one repo into
// chart points, engine-change markers and an honest summary. Pure and dependency-free on purpose.
//
// Erasable TypeScript only (annotations, `import type`): scripts/trend.test.mjs runs this file
// directly under Node's type stripping, so it must not use enums, namespaces or parameter
// properties, and must not import values from other modules.

/** One row of public.scan_history as the browser reads it (column names as stored). */
export interface HistoryRow {
  scan_id: string;
  commit_sha: string | null;
  branch: string | null;
  engine_version: string;
  health_score: number | string | null;
  health_grade: string | null;
  score_complexity: number | string | null;
  score_function_length: number | string | null;
  score_comments: number | string | null;
  score_todo: number | string | null;
  score_nesting: number | string | null;
  tier_critical: number | null;
  tier_high: number | null;
  tier_medium: number | null;
  tier_low: number | null;
  partial: boolean | null;
  scanned_at: string;
}

export const TREND_METRICS = ["health", "complexity", "functionLength", "comments", "todo", "nesting"] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];

export const TREND_METRIC_LABEL: Record<TrendMetric, string> = {
  health: "Health score",
  complexity: "Complexity density",
  functionLength: "Function length",
  comments: "Comment coverage",
  todo: "TODO density",
  nesting: "Nesting depth",
};

export interface TrendPoint {
  scanId: string;
  /** Epoch milliseconds. */
  at: number;
  iso: string;
  commit: string | null;
  branch: string | null;
  engineVersion: string;
  grade: string | null;
  /** True when the scan covered only part of the repo: drawn hollow, left out of the summary. */
  partial: boolean;
  /** 0..100 per metric, null when the row did not carry it. */
  values: Record<TrendMetric, number | null>;
  tiers: { critical: number; high: number; medium: number; low: number };
}

/** A change of engine version between two neighbouring points: a step here is the engine, not the repo. */
export interface EngineMarker {
  /** Index in `points` of the first point scored by the new engine. */
  index: number;
  from: string;
  to: string;
}

export interface TrendSummary {
  /** Scans that count (not partial). */
  fullScans: number;
  latestScore: number;
  /** Engine version of the latest counted scan; every number below was scored by it. */
  engineVersion: string;
  /** Counted scans scored by that same engine, oldest first. The change below is measured over these only. */
  comparableScans: number;
  /** Latest minus the first comparable scan; null with fewer than two comparable scans. */
  change: number | null;
  best: number;
  worst: number;
  /** True when scans under an older engine are in the chart: the line steps at a marker for engine reasons. */
  earlierEngine: boolean;
}

export interface Trend {
  points: TrendPoint[];
  markers: EngineMarker[];
  summary: TrendSummary | null;
}

export const MAX_TREND_POINTS = 60;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

function count(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Oldest first, at most `limit` newest rows kept. Rows with no usable score or date are dropped
 * (a hole would draw a false line), duplicates by scan id keep the first.
 */
export function buildTrend(rows: HistoryRow[], limit: number = MAX_TREND_POINTS): Trend {
  const seen = new Set<string>();
  const points: TrendPoint[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.scan_id !== "string" || seen.has(r.scan_id)) continue;
    const at = Date.parse(r.scanned_at);
    const health = num(r.health_score);
    if (!Number.isFinite(at) || health === null) continue;
    seen.add(r.scan_id);
    points.push({
      scanId: r.scan_id,
      at,
      iso: new Date(at).toISOString(),
      commit: typeof r.commit_sha === "string" && /^[0-9a-f]{40}$/.test(r.commit_sha) ? r.commit_sha : null,
      branch: typeof r.branch === "string" && r.branch ? r.branch : null,
      engineVersion: typeof r.engine_version === "string" && r.engine_version ? r.engine_version : "unknown",
      grade: typeof r.health_grade === "string" && r.health_grade ? r.health_grade : null,
      partial: r.partial === true,
      values: {
        health,
        complexity: num(r.score_complexity),
        functionLength: num(r.score_function_length),
        comments: num(r.score_comments),
        todo: num(r.score_todo),
        nesting: num(r.score_nesting),
      },
      tiers: { critical: count(r.tier_critical), high: count(r.tier_high), medium: count(r.tier_medium), low: count(r.tier_low) },
    });
  }
  points.sort((a, b) => a.at - b.at);
  const kept = points.length > limit ? points.slice(points.length - limit) : points;

  const markers: EngineMarker[] = [];
  for (let i = 1; i < kept.length; i++) {
    if (kept[i].engineVersion !== kept[i - 1].engineVersion) {
      markers.push({ index: i, from: kept[i - 1].engineVersion, to: kept[i].engineVersion });
    }
  }
  return { points: kept, markers, summary: summarize(kept) };
}

function summarize(points: TrendPoint[]): TrendSummary | null {
  const full = points.filter((p) => !p.partial);
  if (full.length === 0) return null;
  const latest = full[full.length - 1];
  // Only scans under the latest engine are comparable with the latest score; an older engine scored
  // the same code differently, so a change measured across the boundary would blame the repo.
  const comparable = full.filter((p) => p.engineVersion === latest.engineVersion);
  const scores = comparable.map((p) => p.values.health as number);
  return {
    fullScans: full.length,
    latestScore: round1(latest.values.health as number),
    engineVersion: latest.engineVersion,
    comparableScans: comparable.length,
    change: comparable.length >= 2 ? round1((latest.values.health as number) - (comparable[0].values.health as number)) : null,
    best: round1(Math.max(...scores)),
    worst: round1(Math.min(...scores)),
    earlierEngine: full.some((p) => p.engineVersion !== latest.engineVersion),
  };
}

/** One sentence for the panel header, e.g. "Up 4.2 points over 6 scans since the engine changed." */
export function describeTrend(s: TrendSummary | null): string {
  if (!s) return "No full scans to chart yet.";
  const scope = s.earlierEngine ? " under the current engine" : "";
  if (s.change === null) return `Latest score ${s.latestScore}/100${scope}. Scan again to see a change.`;
  const abs = Math.abs(s.change);
  const dir = s.change > 0 ? `Up ${abs}` : s.change < 0 ? `Down ${abs}` : "Unchanged at " + s.latestScore;
  const pts = s.change === 0 ? "" : abs === 1 ? " point" : " points";
  return `${dir}${pts} over ${s.comparableScans} scans${scope}.`;
}
