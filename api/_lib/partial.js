// api/_lib/partial.js
//
// Time-budgeted ("partial") scans, server side (V3 plan, Phase 1 item 3). The analyser binary takes
// --time-budget-ms and, when it has to stop early, writes a `partial` block into its JSON. This module
// decides the budget it is given and validates what comes back. Pure functions, no I/O.
//
// Time plan for one scan request (vercel.json caps the function at 60s; the handler's own deadline is 55s):
//   download + extract    whatever it takes (counted in `elapsedMs`)
//   analyser              min(45s, what is left minus RESPONSE_RESERVE_MS), asked to finish inside it
//   read + enrich + store RESPONSE_RESERVE_MS
// The Node-side kill (budget + ENGINE_KILL_GRACE_MS) stays as the last resort: a scan that blows through
// its budget still ends in the existing clean "timed out" error, never in a hung request.

export const ENGINE_BUDGET_MAX_MS = 45_000;
// Below this the engine could only sample a handful of files, which tells the user nothing.
export const ENGINE_BUDGET_MIN_MS = 6_000;
export const RESPONSE_RESERVE_MS = 5_000;
export const ENGINE_KILL_GRACE_MS = 3_000;

// Budget in ms for the analyser, or null when too little time is left to run it at all.
export function engineBudgetMs(elapsedMs, overallMs) {
  const left = Math.floor(overallMs - elapsedMs - RESPONSE_RESERVE_MS);
  const budget = Math.min(ENGINE_BUDGET_MAX_MS, left);
  return budget >= ENGINE_BUDGET_MIN_MS ? budget : null;
}

// Optional env knob CMA_TIME_BUDGET_MS: can only LOWER the budget (tests, and an ops lever if the
// hosting CPU turns out slower than expected). Anything that is not a positive integer is ignored.
export function budgetOverride(raw) {
  if (typeof raw !== "string" || !/^\d{1,9}$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

// Validates the engine's `partial` block. Returns a clean { filesScanned, filesTotal, reason } or null
// (junk, or not actually partial), so nothing unvetted reaches a stored report or the UI.
export function sanitizePartial(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { filesScanned, filesTotal } = raw;
  const ok = (n) => Number.isInteger(n) && n >= 0 && n <= 10_000_000;
  if (!ok(filesScanned) || !ok(filesTotal) || filesScanned < 1 || filesTotal <= filesScanned) return null;
  return { filesScanned, filesTotal, reason: "time_budget" };
}
