import { useEffect, useId, useMemo, useState } from "react";
import { isRepoKey } from "../lib/api";
import { useAuth } from "../lib/authContext";
import { listRepoHistory } from "../lib/history";
import type { ScanReport } from "../lib/report";
import { TREND_METRICS, TREND_METRIC_LABEL, buildTrend, describeTrend, type Trend, type TrendMetric } from "../lib/trend";

const W = 640;
const H = 240;
const M = { left: 38, right: 14, top: 22, bottom: 30 };
const GRADE_LINES: { at: number; label: string }[] = [
  { at: 90, label: "A" },
  { at: 80, label: "B" },
  { at: 70, label: "C" },
  { at: 60, label: "D" },
];

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** One line chart: each dot is one scan, spaced evenly in scan order. Dashed lines mark engine updates. */
export function TrendChart({ trend, metric, currentScanId }: { trend: Trend; metric: TrendMetric; currentScanId?: string }) {
  const { points, markers } = trend;
  const n = points.length;
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const x = (i: number) => M.left + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const y = (v: number) => M.top + (1 - v / 100) * innerH;

  // The line joins full scans only; a partial scan is a sample, so it is drawn hollow and left off the line.
  let path = "";
  points.forEach((p, i) => {
    const v = p.values[metric];
    if (p.partial || v === null) return;
    path += `${path ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
  });

  const grid = metric === "health" ? GRADE_LINES : [{ at: 50, label: "" }];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${TREND_METRIC_LABEL[metric]} over ${n} scans. The same data is in the table below the chart.`}
      className="h-auto w-full"
    >
      <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} className="stroke-line" />
      <line x1={M.left} x2={W - M.right} y1={y(100)} y2={y(100)} className="stroke-line" />
      {[0, 100].map((v) => (
        <text key={v} x={M.left - 6} y={y(v) + 3} textAnchor="end" className="fill-muted font-mono text-[10px]">
          {v}
        </text>
      ))}
      {grid.map((g) => (
        <g key={g.at}>
          <line x1={M.left} x2={W - M.right} y1={y(g.at)} y2={y(g.at)} strokeDasharray="2 4" className="stroke-line-soft" />
          <text x={M.left - 6} y={y(g.at) + 3} textAnchor="end" className="fill-muted font-mono text-[10px]">
            {g.at}
            {g.label ? ` ${g.label}` : ""}
          </text>
        </g>
      ))}

      {markers.map((m) => {
        const mx = (x(m.index - 1) + x(m.index)) / 2;
        return (
          <g key={`${m.index}-${m.to}`}>
            <line x1={mx} x2={mx} y1={M.top - 6} y2={H - M.bottom} strokeDasharray="4 3" className="stroke-amber" />
            <text x={mx + 4} y={M.top - 9} className="fill-amber font-mono text-[10px]">
              engine {m.to}
            </text>
          </g>
        );
      })}

      {path ? <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-signal" /> : null}

      {points.map((p, i) => {
        const v = p.values[metric];
        if (v === null) return null;
        const label = `${new Date(p.at).toLocaleDateString()}: ${Math.round(v * 10) / 10}${p.partial ? " (partial scan)" : ""}, engine ${p.engineVersion}`;
        return (
          <g key={p.scanId}>
            {p.scanId === currentScanId ? <circle cx={x(i)} cy={y(v)} r={8} fill="none" strokeWidth={1.5} className="stroke-ink" /> : null}
            <circle
              cx={x(i)}
              cy={y(v)}
              r={4}
              strokeWidth={2}
              className={p.partial ? "fill-paper stroke-muted" : "fill-signal stroke-signal"}
            >
              <title>{label}</title>
            </circle>
          </g>
        );
      })}

      <text x={M.left} y={H - 8} className="fill-muted font-mono text-[10px]">
        {n ? shortDate(points[0].at) : ""}
      </text>
      <text x={W - M.right} y={H - 8} textAnchor="end" className="fill-muted font-mono text-[10px]">
        {n > 1 ? shortDate(points[n - 1].at) : ""}
      </text>
    </svg>
  );
}

function TrendTable({ trend, metric }: { trend: Trend; metric: TrendMetric }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left font-mono text-xs">
        <thead>
          <tr className="border-b border-line">
            <th className="py-1 pr-3">Date</th>
            <th className="py-1 pr-3">{TREND_METRIC_LABEL[metric]}</th>
            <th className="py-1 pr-3">Engine</th>
            <th className="py-1 pr-3">Commit</th>
            <th className="py-1">Note</th>
          </tr>
        </thead>
        <tbody>
          {[...trend.points].reverse().map((p) => (
            <tr key={p.scanId} className="border-b border-line-soft">
              <td className="py-1 pr-3">{new Date(p.at).toLocaleDateString()}</td>
              <td className="py-1 pr-3">{p.values[metric] === null ? "n/a" : Math.round((p.values[metric] as number) * 10) / 10}</td>
              <td className="py-1 pr-3">{p.engineVersion}</td>
              <td className="py-1 pr-3">{p.commit ? p.commit.slice(0, 7) : "unknown"}</td>
              <td className="py-1">{p.partial ? "partial scan, not counted" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Load = { kind: "idle" } | { kind: "ready"; trend: Trend } | { kind: "none" };

/**
 * The score trend of one repo for the signed-in user. Shown only with at least two scans on record;
 * a failed lookup shows nothing (the trend is a bonus, like the comparison with the previous scan).
 */
export function TrendPanel({ report }: { report: ScanReport }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [load, setLoad] = useState<Load>({ kind: "idle" });
  const [metric, setMetric] = useState<TrendMetric>("health");
  const selectId = useId();
  const repoKey = report.repoOwner && report.repoName ? `${report.repoOwner}/${report.repoName}`.toLowerCase() : null;

  useEffect(() => {
    setLoad({ kind: "idle" });
    if (!userId || !repoKey || !isRepoKey(repoKey)) return;
    let cancelled = false;
    listRepoHistory(repoKey)
      .then((rows) => {
        if (cancelled) return;
        const trend = buildTrend(rows);
        setLoad(trend.points.length >= 2 ? { kind: "ready", trend } : { kind: "none" });
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, repoKey, report.scanId]);

  const trend = load.kind === "ready" ? load.trend : null;
  const summary = useMemo(() => (trend ? describeTrend(trend.summary) : ""), [trend]);
  if (!trend) return null;

  return (
    <section className="rounded-md border border-line bg-white p-4 shadow-soft-sm" aria-label="Score trend for this repository">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-mono text-sm font-black">Score trend</h3>
          <p className="mt-1 text-sm">{summary}</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={selectId} className="font-mono text-xs font-bold uppercase tracking-widest">
            Show
          </label>
          <select
            id={selectId}
            value={metric}
            onChange={(e) => setMetric(e.target.value as TrendMetric)}
            className="rounded-md border border-line bg-white px-2 py-1 font-mono text-xs"
          >
            {TREND_METRICS.map((m) => (
              <option key={m} value={m}>
                {TREND_METRIC_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-3">
        <TrendChart trend={trend} metric={metric} currentScanId={report.scanId} />
      </div>
      <p className="mt-2 text-xs text-ink/80">
        Each dot is one scan. Hollow dots are partial scans and are not counted.
        {trend.markers.length > 0
          ? " A dashed line marks an engine update: scores on either side were computed by different rules, so a step there is the engine, not your code."
          : ""}
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer font-mono text-xs font-bold">Show as table</summary>
        <div className="mt-2">
          <TrendTable trend={trend} metric={metric} />
        </div>
      </details>
    </section>
  );
}
