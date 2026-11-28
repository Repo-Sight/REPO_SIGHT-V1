import { describeEngineNote } from "../lib/change";
import { formatNumber, type ScanReport } from "../lib/report";
import { useChange } from "./ChangeContext";

function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "an earlier date" : d.toLocaleDateString();
}

/**
 * "Track from this scan": the user picks one full scan of a repo as the starting point, and later
 * reports mark what is new since then. Shown to signed-in users on full repository reports.
 */
export function BaselinePanel({ report }: { report: ScanReport }) {
  const { canBaseline, baseline, baselineBusy, baselineError, saveBaseline, removeBaseline } = useChange();
  if (!canBaseline) return null;

  const isThis = baseline?.record.scanId === report.scanId;
  const btn = "rounded-md border border-line bg-white px-3 py-1 font-mono text-xs font-bold hover:bg-chrome disabled:opacity-60";
  return (
    <section className="rounded-md border border-line bg-white p-4 shadow-soft-sm" aria-label="Baseline">
      <h3 className="font-mono text-sm font-black">Baseline</h3>
      {baseline ? (
        <div className="mt-1 space-y-2 text-sm">
          <p>
            Set from the scan of {day(baseline.record.scannedAt)}: {formatNumber(baseline.record.findingCount)}{" "}
            {baseline.record.findingCount === 1 ? "finding" : "findings"}
            {baseline.record.healthScore !== null ? `, score ${Math.round(baseline.record.healthScore)}` : ""}.
          </p>
          {isThis ? (
            <p className="font-semibold">This report is your baseline.</p>
          ) : (
            <p className="font-semibold">
              Since the baseline: {formatNumber(baseline.diff.added)} new, {formatNumber(baseline.diff.resolved)} fixed.
            </p>
          )}
          {baseline.engineNote ? (
            <p className="text-xs">
              {describeEngineNote(baseline.engineNote, report.engineVersion, baseline.record.engineVersion)} Set a new baseline to start clean.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-1 text-sm">
          Pick a starting point. Every later scan of this repo then shows what is new since it, and the findings that were already there
          stay quiet. Only finding counts are kept, never your code.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!isThis ? (
          <button type="button" className={btn} disabled={baselineBusy} onClick={() => void saveBaseline()}>
            {baseline ? "Use this scan as the baseline" : "Set this scan as the baseline"}
          </button>
        ) : null}
        {baseline ? (
          <button type="button" className={btn} disabled={baselineBusy} onClick={() => void removeBaseline()}>
            Clear baseline
          </button>
        ) : null}
      </div>
      {baselineError ? (
        <p role="alert" className="mt-2 rounded-md border border-line bg-rose/25 px-3 py-2 text-sm font-semibold">
          {baselineError}
        </p>
      ) : null}
    </section>
  );
}
