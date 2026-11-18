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
}

/**
 * Findings are matched per (repo-relative file, rule), not per line: server paths carry a
 * per-scan temp prefix, and line numbers shift whenever code above a finding changes.
 * Per key, any drop in count is "resolved" and any rise is "new".
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

  const all = diffCounts(countByKey(current.violations), countByKey(previous.violations));
  const isSec = (v: Violation) => v.category === "security";
  const sec = diffCounts(countByKey(current.violations.filter(isSec)), countByKey(previous.violations.filter(isSec)));

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
  };
}
