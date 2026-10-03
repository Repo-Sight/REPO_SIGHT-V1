import { useEffect, useState } from "react";
import { ApiError, fetchDemoReport } from "../lib/api";
import type { ScanReport } from "../lib/report";
import { ReportBody } from "./ReportView";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; report: ScanReport };

/**
 * Sample report for visitors who have not pasted anything yet. It is a real
 * analysis (the analyser run over this project's own source), loaded from a
 * static file, so it is instant and costs no API call or scan.
 */
export function DemoReport({ onNewScan }: { onNewScan: () => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchDemoReport()
      .then((report) => !cancelled && setState({ kind: "ready", report }))
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ kind: "error", message: err instanceof ApiError ? err.message : "Could not load the demo report." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <p role="status" className="font-mono text-sm">
        Loading demo report…
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="space-y-4">
        <p role="alert" className="border-2 border-black bg-red-100 px-3 py-2 text-sm font-semibold">
          {state.message}
        </p>
        <button type="button" className="rs-btn" onClick={onNewScan}>
          Scan your own code
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-black bg-chrome px-3 py-2 shadow-brutal-sm">
        <p className="font-mono text-xs sm:text-sm">
          <strong>Sample report.</strong> A real scan of REPO-SIGHT&apos;s own source code. No signup, nothing to paste.
        </p>
        <button type="button" className="rs-btn" onClick={onNewScan}>
          Scan your own code
        </button>
      </div>
      <ReportBody report={state.report} onNewScan={onNewScan} />
    </div>
  );
}
