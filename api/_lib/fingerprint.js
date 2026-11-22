// api/_lib/fingerprint.js
//
// Stable finding fingerprints (V3 plan, Phase 1 item 2).
//
// A fingerprint names a PROBLEM, not a position: it must survive the edits that do not
// change the problem (lines moving, a function getting one branch longer) so a later scan
// can say "this finding is new" or "this one is fixed". It is built from what the report
// carries -- rule id, repo-relative path, and the finding message with its measurements
// removed -- because the report stores no source snippet.
//
//   fp = "<24 hex chars of sha256(ruleId | path | normalized message)>.<n>"
//
// <n> counts findings that share the same first part inside one report (1, 2, 3 ...,
// ordered by line), so two identical hits in one file stay distinct and the per-problem
// COUNT is always right: with three before and four after, exactly one fp is new.
//
// Known limits (inherent to the inputs, so named here instead of hidden):
//   - Renaming a function or moving a finding to another file reads as one fixed + one new.
//   - With several identical hits in one file, which one counts as "new" is decided by
//     order, so it can point at the wrong line even though the count is right.
//
// Pure module: no I/O, never throws on junk input.
import { createHash } from "node:crypto";

export const FINGERPRINT_KEY = "repoSightFinding/v1";

// "/tmp/scan-<id>/src/app.js" -> "app.js". The scan id changes every scan, so it must never
// reach a fingerprint. Mirrors relPath() in frontend/src/lib/report.ts.
const SCAN_ROOT_RE = /^\/tmp\/scan-[^/]+\/(?:src\/)?/;

export function normalizePath(path) {
  if (typeof path !== "string" || !path) return "";
  return path
    .replace(/\\/g, "/")
    .replace(SCAN_ROOT_RE, "")
    .split("/")
    .filter((seg) => seg !== "" && seg !== "." && seg !== "..")
    .join("/");
}

// Digits outside single quotes are measurements ("complexity 18 (limit 10)", "147 lines",
// "depth 7") and change as the code changes, so they become "#". Quoted parts are names and
// literals ("'scan'", "'popen(...)'", "Magic number '2'") and stay: they say WHICH problem it is.
export function normalizeMessage(message) {
  if (typeof message !== "string") return "";
  return message
    .replace(/\s+/g, " ")
    .trim()
    .split(/('[^']*')/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\d+/g, "#")))
    .join("")
    .slice(0, 300);
}

function baseHash(v) {
  const key = [String(v.ruleId ?? ""), normalizePath(v.path), normalizeMessage(v.message)].join("\u0000");
  return createHash("sha256").update(key).digest("hex").slice(0, 24);
}

// Sets `fp` on every violation object in the list. Deterministic: the same report always gets
// the same fingerprints, and recomputing over a report that already has them changes nothing.
export function assignFingerprints(violations) {
  if (!Array.isArray(violations)) return violations;
  const groups = new Map();
  violations.forEach((v, index) => {
    if (!v || typeof v !== "object") return;
    const h = baseHash(v);
    const list = groups.get(h);
    if (list) list.push({ v, index });
    else groups.set(h, [{ v, index }]);
  });
  for (const [h, list] of groups) {
    const line = (v) => (Number.isInteger(v.line) ? v.line : 0);
    list.sort((a, b) => line(a.v) - line(b.v) || a.index - b.index);
    list.forEach(({ v }, i) => {
      v.fp = `${h}.${i + 1}`;
    });
  }
  return violations;
}

// Cheap guard for read-time use: only recompute when some violation has no fingerprint yet.
export function ensureFingerprints(violations) {
  if (!Array.isArray(violations)) return violations;
  const missing = violations.some((v) => v && typeof v === "object" && typeof v.fp !== "string");
  return missing ? assignFingerprints(violations) : violations;
}
