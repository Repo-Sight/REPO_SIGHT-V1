// api/_lib/coverage.js
//
// Phase 6d: coverage integration, first cut. Scope decision (see project
// history): REPO-SIGHT does not execute a submitted repo's test suite --
// there is no secure sandbox anywhere in this stack (Vercel serverless
// functions give no kernel-level isolation, and vercel.json's 60s
// maxDuration makes install+test+coverage a non-starter for real repos
// regardless). Instead, the user runs their own tests locally/in CI and
// uploads the resulting LCOV report (lcov.info) alongside a normal repo
// scan. This module only ever parses text -- same risk class as parsing
// the repo's own source, which api/analyze.js already does safely.
//
// LCOV is a plain line-based text format (see geninfo(1)). We only need a
// handful of its record types for per-file line coverage:
//   SF:<path>            -- start of a per-file record
//   DA:<line>,<hits>[,checksum]
//   LF:<count>            -- lines-found summary (informational fallback)
//   LH:<count>            -- lines-hit summary (informational fallback)
//   end_of_record         -- closes the current SF: record
// Everything else (FN:/FNDA:/BRDA:/TN:/etc.) is ignored -- not needed for
// the per-file/overall percentage this phase surfaces.

const MAX_COVERAGE_BYTES = 5 * 1024 * 1024; // generous for real lcov.info files

class CoverageTooLargeError extends Error {}
class CoverageParseError extends Error {}

function validateCoverageSize(text) {
  if (Buffer.byteLength(text, "utf8") > MAX_COVERAGE_BYTES) {
    throw new CoverageTooLargeError(
      `Coverage report is larger than the ${Math.round(MAX_COVERAGE_BYTES / 1024 / 1024)} MB limit.`
    );
  }
}

function finalizeEntry(entry) {
  const uncoveredLines = [];
  for (const [lineNo, hits] of entry.lineHits) {
    if (hits === 0) uncoveredLines.push(lineNo);
  }
  uncoveredLines.sort((a, b) => a - b);

  // Prefer the file's own LF:/LH: summary lines when present -- some
  // coverage generators omit a DA: line for every source line (e.g. blank
  // lines), so lineHits.size can under-count linesFound.
  const linesFound = entry.linesFoundSummary ?? entry.lineHits.size;
  const linesHit =
    entry.linesHitSummary ?? [...entry.lineHits.values()].filter(h => h > 0).length;

  return {
    sourcePath: entry.path,
    linesFound,
    linesHit,
    coveragePct: linesFound > 0 ? Math.round((linesHit / linesFound) * 10000) / 100 : 0,
    uncoveredLines,
  };
}

// Parses LCOV text into an array of per-file coverage entries. Never
// throws on malformed content -- a lcov.info with garbage lines simply
// ignores those lines (matches the "fail gracefully on malformed input"
// principle used throughout the analyser for untrusted source files).
export function parseLcov(text) {
  validateCoverageSize(text);

  const entries = [];
  let current = null;

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.startsWith("SF:")) {
      // A new SF: without a preceding end_of_record (malformed input) --
      // close out whatever was open rather than silently dropping it.
      if (current) entries.push(finalizeEntry(current));
      current = { path: line.slice(3).trim(), lineHits: new Map(), linesFoundSummary: null, linesHitSummary: null };
      continue;
    }
    if (!current) continue; // ignore anything before the first SF:

    if (line.startsWith("DA:")) {
      const parts = line.slice(3).split(",");
      const lineNo = Number(parts[0]);
      const hits = Number(parts[1]);
      if (Number.isFinite(lineNo) && Number.isFinite(hits)) {
        current.lineHits.set(lineNo, hits);
      }
    } else if (line.startsWith("LF:")) {
      const n = Number(line.slice(3));
      if (Number.isFinite(n)) current.linesFoundSummary = n;
    } else if (line.startsWith("LH:")) {
      const n = Number(line.slice(3));
      if (Number.isFinite(n)) current.linesHitSummary = n;
    } else if (line === "end_of_record") {
      entries.push(finalizeEntry(current));
      current = null;
    }
  }
  if (current) entries.push(finalizeEntry(current)); // tolerate missing trailing end_of_record

  if (entries.length === 0) {
    throw new CoverageParseError(
      "Could not find any \"SF:\"/\"end_of_record\" file records in the uploaded report -- " +
      "is this a valid LCOV (.info) file?"
    );
  }
  return entries;
}

function normalizeForMatch(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "");
}

// Score = length of the longest common path *suffix*, in segments.
// LCOV's SF: paths are whatever the coverage tool's working directory was
// (often absolute, from a CI machine) -- essentially never identical to
// our analyzer's srcDir-rooted paths. Matching on trailing segments (e.g.
// ".../src/foo/bar.cpp" vs "/home/runner/work/x/x/src/foo/bar.cpp") is the
// same heuristic tools like Codecov use for this exact mismatch.
function suffixMatchScore(candidatePath, lcovPath) {
  const a = normalizeForMatch(candidatePath).split("/").filter(Boolean);
  const b = normalizeForMatch(lcovPath).split("/").filter(Boolean);
  const n = Math.min(a.length, b.length);
  let score = 0;
  for (let k = 1; k <= n; k++) {
    if (a[a.length - k] !== b[b.length - k]) break;
    score = k;
  }
  return score;
}

// Merges parsed LCOV entries into an already-computed CMA report (the
// parsed report.json, before it's uploaded to Storage). Mutates and
// returns `report`. `srcDirPrefix` should be the exact directory path
// that was passed to the cma binary as its scan root (api/analyze.js
// already has this in scope as `srcDir`) -- stripping it turns the
// analyzer's absolute paths back into repo-relative ones for matching.
//
// Ambiguous matches (two or more files tie for the best suffix score) are
// deliberately left unmatched rather than guessing -- attaching coverage
// to the wrong file is worse than omitting it, and the unmatchedFiles
// list in the summary surfaces this instead of hiding it.
export function mergeCoverageIntoReport(report, lcovEntries, { srcDirPrefix } = {}) {
  const files = Array.isArray(report.files) ? report.files : [];
  const unmatchedFiles = [];
  let filesMatched = 0;
  let totalFound = 0;
  let totalHit = 0;

  for (const entry of lcovEntries) {
    totalFound += entry.linesFound;
    totalHit += entry.linesHit;

    let bestScore = 0;
    let bestFile = null;
    let tie = false;

    for (const f of files) {
      const relPath =
        srcDirPrefix && f.path.startsWith(srcDirPrefix)
          ? f.path.slice(srcDirPrefix.length).replace(/^[/\\]/, "")
          : f.path;
      const score = suffixMatchScore(relPath, entry.sourcePath);
      if (score > bestScore) {
        bestScore = score;
        bestFile = f;
        tie = false;
      } else if (score === bestScore && score > 0 && f !== bestFile) {
        tie = true;
      }
    }

    if (bestFile && bestScore >= 1 && !tie) {
      bestFile.coverage = {
        linesFound: entry.linesFound,
        linesHit: entry.linesHit,
        coveragePct: entry.coveragePct,
        uncoveredLines: entry.uncoveredLines,
      };
      filesMatched++;
    } else {
      unmatchedFiles.push(entry.sourcePath);
    }
  }

  report.coverageSummary = {
    available: true,
    overallPct: totalFound > 0 ? Math.round((totalHit / totalFound) * 10000) / 100 : 0,
    linesFound: totalFound,
    linesHit: totalHit,
    filesInReport: lcovEntries.length,
    filesMatched,
    unmatchedFiles,
  };

  return report;
}

export { CoverageTooLargeError, CoverageParseError, MAX_COVERAGE_BYTES };
