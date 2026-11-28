import { diffByFingerprint, engineNote, groupFingerprints, type EngineNote } from "./change";
import { relPath, type ScanReport, type Violation } from "./report";

export interface ScanDelta {
  currentScore: number;
  previousScore: number;
  scoreDelta: number;
  previousDate: string | null;
  resolved: number;
  added: number;
  resolvedSecurity: number;
  addedSecurity: number;
  filesSimpler: number;
  filesMoreComplex: number;
  mostComplexFile: { path: string; delta: number } | null;
  /** Fingerprints of the current findings the previous scan did not have; null when matching fell back to file and rule. */
  newFps: Set<string> | null;
  /** True when findings were matched by stable fingerprint, false for the older file-and-rule match. */
  viaFingerprint: boolean;
  engineNote: EngineNote;
  currentEngine: string | null;
  previousEngine: string | null;
}

/**
 * Fallback match, used only for reports that carry no fingerprints. Findings are matched per
 * (repo-relative file, rule), not per line: server paths carry a per-scan temp prefix, and line
 * numbers shift whenever code above a finding changes. Per key, any drop in count is "resolved"
 * and any rise is "new". Reports served by the API always carry fingerprints (api/_lib/enrich.js).
 */
function countByKey(violations: Violation[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of violations) {
    const key = `${relPath(v.path)}\u0000${v.ruleId}`;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}

function diffCounts(cur: Map<string, number>, prev: Map<string, number>): { added: number; resolved: number } {
  let added = 0;
  let resolved = 0;
  for (const [key, n] of cur) added += Math.max(0, n - (prev.get(key) ?? 0));
  for (const [key, n] of prev) resolved += Math.max(0, n - (cur.get(key) ?? 0));
  return { added, resolved };
}

export function computeScanDelta(current: ScanReport, previous: ScanReport): ScanDelta {
  const currentScore = Math.round(current.project.healthScore || 0);
  const previousScore = Math.round(previous.project.healthScore || 0);

  const isSec = (v: Violation) => v.category === "security";
  // Preferred match: stable fingerprints (they name the problem, so a finding that only moved is not new).
  const prevGroups = groupFingerprints(previous.violations);
  const fpAll = prevGroups ? diffByFingerprint(current.violations, prevGroups) : null;
  const prevSec = previous.violations.filter(isSec);
  const fpSec = fpAll ? diffByFingerprint(current.violations.filter(isSec), groupFingerprints(prevSec) ?? {}) : null;
  const all = fpAll ?? diffCounts(countByKey(current.violations), countByKey(previous.violations));
  const sec = fpSec ?? diffCounts(countByKey(current.violations.filter(isSec)), countByKey(prevSec));

  // Only files present in both scans can get simpler or more complex; new or deleted files are just new or gone.
  const prevByPath = new Map(previous.files.map((f) => [relPath(f.path), f]));
  let filesSimpler = 0;
  let filesMoreComplex = 0;
  let mostComplexFile: ScanDelta["mostComplexFile"] = null;
  for (const f of current.files) {
    const before = prevByPath.get(relPath(f.path));
    if (!before) continue;
    const d = (f.cyclomaticComplexity || 0) - (before.cyclomaticComplexity || 0);
    if (d > 0) {
      filesMoreComplex++;
      if (!mostComplexFile || d > mostComplexFile.delta) mostComplexFile = { path: relPath(f.path), delta: d };
    } else if (d < 0) {
      filesSimpler++;
    }
  }

  return {
    currentScore,
    previousScore,
    scoreDelta: currentScore - previousScore,
    previousDate: previous.createdAt ?? null,
    resolved: all.resolved,
    added: all.added,
    resolvedSecurity: sec.resolved,
    addedSecurity: sec.added,
    filesSimpler,
    filesMoreComplex,
    mostComplexFile,
    newFps: fpAll && fpSec ? fpAll.newFps : null,
    viaFingerprint: Boolean(fpAll && fpSec),
    engineNote: engineNote(current.engineVersion, previous.engineVersion),
    currentEngine: current.engineVersion ?? null,
    previousEngine: previous.engineVersion ?? null,
  };
}
