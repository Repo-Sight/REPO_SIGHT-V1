// New versus existing findings (V3 plan, Phase 2 items 5.3 and 5.4). Pure and dependency-free.
//
// A finding fingerprint (api/_lib/fingerprint.js) is "<24 hex>.<n>": the hash names the PROBLEM
// (rule, repo-relative path, message with its measurements removed) and <n> counts findings that
// share it inside one report, ordered by line. So a report reduces to groups: hash -> how many.
// A current finding is NEW when its <n> is above the count the earlier report had for that hash;
// with three before and four after, exactly the fourth is new. Counts, not identities, are what the
// fingerprints guarantee, so groups are all a baseline needs to store.
//
// Erasable TypeScript only: scripts/change.test.mjs runs this file under Node's type stripping,
// so no enums, no namespaces, no parameter properties, and no value imports from other modules.

export interface FpViolation {
  fp?: string;
  category?: string;
}

/** hash -> number of findings with that hash in one report. */
export type FpGroups = Record<string, number>;

export interface FpDiff {
  /** Fingerprints (as in the current report) that the earlier report did not have. */
  newFps: Set<string>;
  added: number;
  resolved: number;
}

const FP_RE = /^([0-9a-f]{24})\.([1-9][0-9]{0,5})$/;

export function parseFp(fp: unknown): { hash: string; index: number } | null {
  if (typeof fp !== "string") return null;
  const m = FP_RE.exec(fp);
  return m ? { hash: m[1], index: Number(m[2]) } : null;
}

/**
 * Reduce a report's findings to groups. Null when any finding has no valid fingerprint (a report
 * from before fingerprints existed): the caller then falls back to the older per-file, per-rule match.
 */
export function groupFingerprints(violations: FpViolation[]): FpGroups | null {
  if (!Array.isArray(violations)) return null;
  const groups: FpGroups = Object.create(null);
  for (const v of violations) {
    const p = parseFp(v?.fp);
    if (!p) return null;
    groups[p.hash] = (groups[p.hash] ?? 0) + 1;
  }
  return groups;
}

/** Diff the current findings against an earlier report's groups. Null when a current finding has no valid fingerprint. */
export function diffByFingerprint(current: FpViolation[], earlier: FpGroups): FpDiff | null {
  const have = groupFingerprints(current);
  if (!have) return null;
  const newFps = new Set<string>();
  for (const v of current) {
    const p = parseFp(v.fp);
    if (p && p.index > (earlier[p.hash] ?? 0)) newFps.add(v.fp as string);
  }
  let resolved = 0;
  for (const hash of Object.keys(earlier)) resolved += Math.max(0, earlier[hash] - (have[hash] ?? 0));
  return { newFps, added: newFps.size, resolved };
}

export type EngineNote = "changed" | "unknown" | null;

/**
 * Whether two reports were scored by the same engine. A difference means new, removed or retuned
 * rules can show up as new or fixed findings without any code change. A missing version (reports
 * stored before engine tracking) is "unknown", not "same".
 */
export function engineNote(current: string | null | undefined, earlier: string | null | undefined): EngineNote {
  if (!current) return null;
  if (!earlier) return "unknown";
  return current === earlier ? null : "changed";
}

export function describeEngineNote(note: EngineNote, current?: string | null, earlier?: string | null): string {
  if (note === "changed") {
    return `The engine was updated (${earlier} to ${current}) since then, so some differences come from new or changed rules, not from your code.`;
  }
  if (note === "unknown") {
    return "That scan predates engine tracking, so some differences may come from rule updates, not from your code.";
  }
  return "";
}

/** Distinct finding hashes one baseline may hold. Must equal MAX_BASELINE_GROUPS in api/_lib/baseline.js (a test checks). */
export const MAX_BASELINE_GROUPS = 5000;

const HASH_RE = /^[0-9a-f]{24}$/;

/**
 * Groups read back from the database. They are data we stored, but they feed the diff, so they are
 * checked again: anything that is not a plain object of 24-hex keys with positive integer counts
 * (or has more keys than a baseline may hold) is refused, and the baseline is treated as absent.
 */
export function sanitizeGroups(raw: unknown): FpGroups | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: FpGroups = Object.create(null);
  let n = 0;
  for (const key of Object.keys(raw)) {
    const v = (raw as Record<string, unknown>)[key];
    if (!HASH_RE.test(key) || typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 1_000_000) return null;
    if (++n > MAX_BASELINE_GROUPS) return null;
    out[key] = v;
  }
  return out;
}
