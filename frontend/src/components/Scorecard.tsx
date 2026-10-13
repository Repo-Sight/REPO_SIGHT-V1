import { useEffect, useState } from "react";
import { fetchDemoReport } from "../lib/api";
import type { ScanReport } from "../lib/report";
import { useDesktop } from "../lib/desktopContext";

/**
 * "score-card.json": the small score-card window that floats on the bare desktop
 * next to home.mdx. It shows a real scan (the analyser run over this project's own
 * source, loaded from the static demo file), so it is never invented data. The
 * window chrome (minimise, maximise, close) comes from WindowFrame.
 */
export function ScoreCard() {
  const d = useDesktop();
  const [report, setReport] = useState<ScanReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDemoReport()
      .then((r) => !cancelled && setReport(r))
      .catch(() => {
        /* The card simply stays in its loading shell; every other window is unaffected. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const p = report?.project;

  return (
    <div className="p-3" data-app="ScoreCard">
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

      <a href="/?demo=1" className="rs-btn mt-3 block text-center" onClick={() => d.open("/?demo=1")}>
        Open sample report
      </a>
    </div>
  );
}
