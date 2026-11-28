import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, fetchScan, isRepoKey } from "../lib/api";
import { useAuth } from "../lib/authContext";
import { clearBaseline, getBaseline, setBaseline, type BaselineRecord } from "../lib/baseline";
import { diffByFingerprint, engineNote, type EngineNote, type FpDiff } from "../lib/change";
import { computeScanDelta, type ScanDelta } from "../lib/delta";
import { findPreviousScanId } from "../lib/history";
import type { ScanReport, Violation } from "../lib/report";

/** What a finding is "new" against: the user's previous scan of this repo, or the baseline they set. */
export type ChangeSource = "previous" | "baseline";

export interface BaselineView {
  record: BaselineRecord;
  diff: FpDiff;
  engineNote: EngineNote;
}

export interface ChangeValue {
  /** True once the lookup has finished, so "no comparison" is never shown while it is still loading. */
  settled: boolean;
  /** The comparison with the previous scan, when there is one. */
  delta: ScanDelta | null;
  /** Comparisons that can mark findings as new, in display order. Empty when none is available. */
  sources: ChangeSource[];
  source: ChangeSource | null;
  setSource: (s: ChangeSource) => void;
  /** Findings lists show only new findings. */
  onlyNew: boolean;
  setOnlyNew: (v: boolean) => void;
  /** True for a finding the active comparison did not have. Always false without a comparison. */
  isNew: (v: Violation) => boolean;
  newCount: number;
  /** Plain-words tail for sentences, e.g. "since your previous scan". */
  label: string;
  /** Signed in, a repository scan, and a full (not partial) report: a baseline can be set and compared. */
  canBaseline: boolean;
  baseline: BaselineView | null;
  baselineBusy: boolean;
  /** Safe-to-show message from the last failed baseline action. */
  baselineError: string | null;
  /** Make this report's scan the baseline. */
  saveBaseline: () => Promise<void>;
  removeBaseline: () => Promise<void>;
}

const NONE: ChangeValue = {
  settled: false,
  delta: null,
  sources: [],
  source: null,
  setSource: () => {},
  onlyNew: false,
  setOnlyNew: () => {},
  isNew: () => false,
  newCount: 0,
  label: "",
  canBaseline: false,
  baseline: null,
  baselineBusy: false,
  baselineError: null,
  saveBaseline: async () => {},
  removeBaseline: async () => {},
};

const Ctx = createContext<ChangeValue>(NONE);

export const useChange = (): ChangeValue => useContext(Ctx);

const SOURCE_LABEL: Record<ChangeSource, string> = {
  previous: "since your previous scan",
  baseline: "since your baseline",
};

/**
 * Looks up what changed since the signed-in user's earlier scan of this repo and shares it with the
 * report, so the overview callout, the NEW badges and the "only new" filter all agree. A failed lookup
 * shows nothing: the comparison is a bonus and never surfaces an error.
 */
export function ChangeProvider({ report, children }: { report: ScanReport; children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const isRepoScan = Boolean(report.repoOwner && report.projectName);
  const [delta, setDelta] = useState<ScanDelta | null>(null);
  const [settled, setSettled] = useState(false);
  const [chosen, setChosen] = useState<ChangeSource | null>(null);
  const [onlyNew, setOnlyNew] = useState(false);
  const [record, setRecord] = useState<BaselineRecord | null>(null);
  const [baselineBusy, setBaselineBusy] = useState(false);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const repoKey = report.repoOwner && report.repoName ? `${report.repoOwner}/${report.repoName}`.toLowerCase() : null;
  const canBaseline = Boolean(userId && repoKey && isRepoKey(repoKey) && !report.partial);

  // The user's baseline for this repo (one row, read under Row Level Security). Failure means "no baseline".
  useEffect(() => {
    setRecord(null);
    setBaselineError(null);
    if (!canBaseline || !repoKey) return;
    let cancelled = false;
    getBaseline(repoKey)
      .then((r) => !cancelled && setRecord(r))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canBaseline, repoKey, report.scanId]);

  useEffect(() => {
    setDelta(null);
    setSettled(false);
    setOnlyNew(false);
    if (!userId || !isRepoScan) return;
    let cancelled = false;
    (async () => {
      const prevId = await findPreviousScanId(report.projectName ?? "", report.scanId, report.createdAt);
      if (!prevId) return;
      const previous = await fetchScan(prevId);
      // A score change between a sample and a full scan (or two different samples) would be noise, not progress.
      if (!cancelled && !report.partial && !previous.partial) setDelta(computeScanDelta(report, previous));
    })()
      .catch(() => {
        // Comparison is a bonus: never surface an error for it.
      })
      .finally(() => {
        if (!cancelled) setSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, isRepoScan, report]);

  const baseline = useMemo<BaselineView | null>(() => {
    if (!record || !canBaseline) return null;
    const diff = diffByFingerprint(report.violations, record.groups);
    return diff ? { record, diff, engineNote: engineNote(report.engineVersion, record.engineVersion) } : null;
  }, [record, canBaseline, report]);

  const sources = useMemo<ChangeSource[]>(() => {
    const list: ChangeSource[] = [];
    if (delta?.newFps) list.push("previous");
    if (baseline) list.push("baseline");
    return list;
  }, [delta, baseline]);
  const source = chosen && sources.includes(chosen) ? chosen : (sources[0] ?? null);
  const activeFps = source === "previous" ? (delta?.newFps ?? null) : source === "baseline" ? (baseline?.diff.newFps ?? null) : null;
  const isNew = useCallback((v: Violation) => Boolean(activeFps && v.fp && activeFps.has(v.fp)), [activeFps]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBaselineBusy(true);
    setBaselineError(null);
    try {
      await action();
    } catch (err) {
      setBaselineError(err instanceof ApiError ? err.message : "Could not update the baseline. Please try again.");
    } finally {
      setBaselineBusy(false);
    }
  }, []);

  const saveBaseline = useCallback(
    () =>
      run(async () => {
        await setBaseline(report.scanId);
        if (repoKey) setRecord(await getBaseline(repoKey));
      }),
    [run, report.scanId, repoKey],
  );
  const removeBaseline = useCallback(
    () =>
      run(async () => {
        if (!repoKey) return;
        await clearBaseline(repoKey);
        setRecord(null);
      }),
    [run, repoKey],
  );

  const value = useMemo<ChangeValue>(
    () => ({
      settled,
      delta,
      sources,
      source,
      setSource: setChosen,
      onlyNew: Boolean(source) && onlyNew,
      setOnlyNew,
      isNew,
      newCount: activeFps?.size ?? 0,
      label: source ? SOURCE_LABEL[source] : "",
      canBaseline,
      baseline,
      baselineBusy,
      baselineError,
      saveBaseline,
      removeBaseline,
    }),
    [settled, delta, sources, source, onlyNew, isNew, activeFps, canBaseline, baseline, baselineBusy, baselineError, saveBaseline, removeBaseline],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
