import { useEffect, useState } from "react";
import { fetchDemoReport } from "../lib/api";
import type { ScanReport } from "../lib/report";

/**
 * "demo-report.json": the small score-card window that sits on the desktop next
 * to home.mdx. It shows a real scan (the analyser run over this project's own
 * source, loaded from the static demo file), so it is never invented data.
 * Only rendered on the bare home route at >= 1280px (CSS hides it below that).
 * The close button only dismisses this card, not the main window.
 */
export function ScoreWindow() {
  const [report, setReport] = useState<ScanReport | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchDemoReport()
      .then((r) => !cancelled && setReport(r))
      .catch(() => {
        /* The card simply stays in its loading shell; the main window is unaffected. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (hidden) return null;
  const p = report?.project;

  return (
    <section className="rs-card-win" aria-label="demo-report.json" data-app="ScoreWindow">
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-chrome px-3 py-1.5 select-none">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-signal" aria-hidden="true" />
          <span className="truncate">demo-report.json</span>
        </div>
        <button
          type="button"
          className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-line-soft hover:text-ink"
          onClick={() => setHidden(true)}
          aria-label="Close demo-report.json"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="m3.5 3.5 9 9m0-9-9 9" />
          </svg>
        </button>
      </div>

      <div className="p-3">
        <p className="font-mono text-[0.65rem] font-bold uppercase tracking-widest text-muted">Sample scan · REPO-SIGHT itself</p>
        <div className="mt-2 flex items-end gap-4">
          <span className="rs-card-grade" aria-label={p ? `Grade ${p.healthGrade}` : undefined}>
            {p ? p.healthGrade : "–"}
          </span>
          <div className="min-w-0 flex-1 pb-1">
            <p className="font-mono text-sm tabular-nums">
              <strong>{p ? Math.round(p.healthScore) : "–"}</strong>
              <span className="text-muted"> / 100 health</span>
            </p>
            <div className="rs-card-bar mt-1.5" aria-hidden="true">
              <span style={{ width: `${p ? Math.max(0, Math.min(100, p.healthScore)) : 0}%` }} />
            </div>
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            ["Files", p?.filesAnalyzed],
            ["Functions", p?.functionCount],
            ["Findings", report?.violations.length],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-md border border-line bg-chrome px-1 py-1.5">
              <dd className="font-mono text-sm font-bold tabular-nums">{value ?? "–"}</dd>
              <dt className="text-[0.65rem] text-muted">{label}</dt>
            </div>
          ))}
        </dl>

        <a href="/?demo=1" className="rs-btn mt-3 block text-center">
          Open sample report
        </a>
      </div>
    </section>
  );
}
