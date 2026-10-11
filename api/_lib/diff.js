// api/_lib/diff.js
//
// Pure helpers for the diff-aware hook (api/analyze-diff.js). No I/O, no
// Supabase, no process state -- everything here is unit-testable on its own
// (scripts/diff.test.mjs).
//
//   parseUnifiedDiff(text)   -> which NEW-side line numbers each file added
//   safeRelPath(raw)         -> validated repo-relative path, or null
//   splitViolationsByDiff()  -> findings on added lines vs everything else
//
// The diff text is untrusted input (Section 11): nothing here ever builds a
// filesystem path from it without going through safeRelPath(), and hunk
// bodies are consumed by their declared line counts, never by guessing.
import { posix } from "node:path";

const MAX_PATH_LENGTH = 512;

// Returns a normalised, repo-relative POSIX path, or null if the input
// could escape the working directory or is otherwise unusable.
//   "src/a.js"      -> "src/a.js"
//   "./src/a.js"    -> "src/a.js"
//   "../../etc/x"   -> null   (traversal)
//   "/etc/x"        -> null   (absolute)
//   "a\\b.js"       -> null   (backslash: not a repo path on any platform
//                              we write to; refuse rather than reinterpret)
export function safeRelPath(raw) {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > MAX_PATH_LENGTH) return null;
  if (/[\x00-\x1f\\]/.test(raw)) return null;
  if (raw.startsWith("/")) return null;
  if (raw.split("/").some(seg => seg === "..")) return null;
  const norm = posix.normalize(raw);
  if (norm === "." || norm === "" || norm.endsWith("/") || norm.startsWith("../")) return null;
  return norm;
}

// "--- a/x" / "+++ b/x" payload -> raw path string, or null if it uses a
// quoting form we don't support (the file is then reported as skipped).
// Handles: trailing "\t<timestamp>" (plain `diff -u`) and git's C-style
// quoting for paths with special characters (\\ \" \t \n only; octal
// escapes for non-ASCII bytes are not supported and yield null).
function parseDiffPath(rawField) {
  let p = rawField.replace(/\r$/, "");
  const tab = p.indexOf("\t");
  if (tab !== -1) p = p.slice(0, tab);
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) {
    const inner = p.slice(1, -1);
    let out = "";
    for (let k = 0; k < inner.length; k++) {
      const c = inner[k];
      if (c !== "\\") { out += c; continue; }
      const n = inner[++k];
      if (n === '"' || n === "\\") out += n;
      else if (n === "t") out += "\t";
      else if (n === "n") out += "\n";
      else return null;
    }
    p = out;
  }
  return p;
}

function stripSidePrefix(p, prefix) {
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

// Parses unified diff text (`git diff`, `git diff --cached`, `git show`,
// `diff -u`, the body of a GitHub .diff URL).
//
// Returns:
//   files:   Map<relPath, { added: Set<number>, isNew: boolean }>
//              added = 1-based line numbers in the NEW (post-change) file
//              isNew = file did not exist before this diff
//   skipped: [{ path, reason }]  deleted / binary / unsafe-path entries
//
// Expects git's default a/ b/ prefixes (not --no-prefix).
export function parseUnifiedDiff(text) {
  const files = new Map();
  const skipped = [];
  if (typeof text !== "string") return { files, skipped };

  const lines = text.split("\n");
  let i = 0;
  let oldPath = null;       // raw path from the last "--- " line
  let headerNewFile = false; // "new file mode" seen in the current header
  let lastGitPath = null;    // b-side path from "diff --git", for labelling
  let cur = null;            // record for the current +++ file (null = ignore hunks)

  while (i < lines.length) {
    const line = lines[i].replace(/\r$/, "");

    if (line.startsWith("diff --git ")) {
      oldPath = null;
      headerNewFile = false;
      cur = null;
      const m = /^diff --git a\/.+ b\/(.+)$/.exec(line);
      lastGitPath = m ? m[1] : null;
      i++;
      continue;
    }
    if (line.startsWith("new file mode")) { headerNewFile = true; i++; continue; }

    if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      skipped.push({ path: lastGitPath, reason: "binary file" });
      cur = null;
      i++;
      continue;
    }

    if (line.startsWith("--- ")) {
      oldPath = parseDiffPath(line.slice(4));
      i++;
      continue;
    }

    if (line.startsWith("+++ ")) {
      i++;
      const newRaw = parseDiffPath(line.slice(4));
      cur = null;
      if (newRaw === "/dev/null") {
        skipped.push({ path: oldPath ? stripSidePrefix(oldPath, "a/") : null, reason: "deleted file" });
        continue;
      }
      const rel = newRaw === null ? null : safeRelPath(stripSidePrefix(newRaw, "b/"));
      if (rel === null) {
        skipped.push({ path: null, reason: "unsafe or unsupported path in diff" });
        continue;
      }
      const isNew = headerNewFile || oldPath === "/dev/null";
      cur = files.get(rel);
      if (!cur) {
        cur = { added: new Set(), isNew };
        files.set(rel, cur);
      } else if (isNew) {
        cur.isNew = true;
      }
      continue;
    }

    const h = HUNK_RE.exec(line);
    if (h) {
      let oldLeft = h[2] === undefined ? 1 : Number(h[2]);
      let newLeft = h[4] === undefined ? 1 : Number(h[4]);
      let newLine = Number(h[3]);
      i++;
      // Consume exactly the declared number of lines. A deleted line whose
      // text starts with "-- " shows up as "--- ..." and must not be
      // mistaken for a file header -- counting is what makes that safe.
      while (i < lines.length && (oldLeft > 0 || newLeft > 0)) {
        const l = lines[i];
        // A bare "\r" is an empty context line from a CRLF diff.
        const ch = l === "\r" ? undefined : l[0];
        if (ch === "+") {
          if (newLeft <= 0) break;
          if (cur) cur.added.add(newLine);
          newLine++;
          newLeft--;
        } else if (ch === "-") {
          if (oldLeft <= 0) break;
          oldLeft--;
        } else if (ch === " " || ch === undefined) {
          // ch === undefined: an empty context line whose single leading
          // space was stripped by an editor or mail client.
          if (oldLeft <= 0 || newLeft <= 0) break;
          oldLeft--;
          newLeft--;
          newLine++;
        } else if (ch === "\\") {
          // "\ No newline at end of file" -- not a content line.
        } else {
          break; // malformed hunk body; stop and resume top-level parsing
        }
        i++;
      }
      continue;
    }

    i++;
  }

  return { files, skipped };
}

// Maps an absolute analyser-reported path back to the repo-relative path we
// wrote it under. Returns null for anything outside srcDir.
export function relFromAbs(absPath, srcDir) {
  if (typeof absPath !== "string" || typeof srcDir !== "string") return null;
  const prefix = srcDir.endsWith("/") ? srcDir : `${srcDir}/`;
  return absPath.startsWith(prefix) ? absPath.slice(prefix.length) : null;
}

// Splits analyser violations into those the diff introduced and a count of
// everything else in the touched files.
//
//   introduced  = reported line is one of the file's added lines, OR the
//                 finding is file-level (line 0) on a brand-new file.
//   preexisting = anything else in a touched file (not the author's change).
//
// Findings are anchored to the line the analyser reports (usually where the
// construct starts), so a long-function finding on an old function whose
// body was edited -- but whose first line was not -- counts as pre-existing.
// Returned violations are copies with `path` rewritten repo-relative, so no
// server temp path ever reaches the response.
export function splitViolationsByDiff(violations, srcDir, diffFiles) {
  const introduced = [];
  let preexisting = 0;
  for (const v of Array.isArray(violations) ? violations : []) {
    if (!v || typeof v !== "object") continue;
    const rel = relFromAbs(v.path, srcDir);
    const file = rel === null ? undefined : diffFiles.get(rel);
    if (!file) continue;
    const line = Number.isInteger(v.line) ? v.line : 0;
    const isIntroduced = line > 0 ? file.added.has(line) : file.isNew;
    if (isIntroduced) introduced.push({ ...v, path: rel });
    else preexisting++;
  }
  return { introduced, preexisting };
}
