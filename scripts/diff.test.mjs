// scripts/diff.test.mjs -- run with: npm run test:api  (node --test scripts/diff.test.mjs)
//
// Guards the diff-aware hook: the unified-diff parser (api/_lib/diff.js), the
// introduced-vs-preexisting split, and POST /api/analyze-diff end to end
// against the real prebuilt analyser binary and a real `git diff`.
// Uses only node:test -- no new dependencies.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseUnifiedDiff, safeRelPath, relFromAbs, splitViolationsByDiff } from "../api/_lib/diff.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sorted = set => [...set].sort((a, b) => a - b);

// ------------------------------------------------------------ safeRelPath
test("safeRelPath accepts normal repo paths and normalises ./", () => {
  assert.equal(safeRelPath("src/a.js"), "src/a.js");
  assert.equal(safeRelPath("./src/a.js"), "src/a.js");
  assert.equal(safeRelPath("a/b/../c.js"), null, "any .. segment is refused, even if it stays inside");
});

test("safeRelPath rejects traversal, absolute, backslash, control chars, junk", () => {
  for (const bad of [
    "../../etc/passwd", "/etc/passwd", "a\\b.js", "a\0b.js", "a\nb.js",
    "", ".", "src/", "..", "../x", 42, null, undefined, "x".repeat(600),
  ]) {
    assert.equal(safeRelPath(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

// ------------------------------------------------------- parseUnifiedDiff
test("modified file: records NEW-side line numbers of added lines only", () => {
  const diff = [
    "diff --git a/src/a.js b/src/a.js",
    "index 111..222 100644",
    "--- a/src/a.js",
    "+++ b/src/a.js",
    "@@ -1,4 +1,6 @@",
    " keep1",
    "-old2",
    "+new2",
    "+new3",
    " keep4",
    " keep5",
    "",
  ].join("\n");
  const { files, skipped } = parseUnifiedDiff(diff);
  assert.deepEqual(skipped, []);
  const f = files.get("src/a.js");
  assert.deepEqual(sorted(f.added), [2, 3]);
  assert.equal(f.isNew, false);
});

test("multiple hunks keep their own line offsets", () => {
  const diff = [
    "--- a/x.py", "+++ b/x.py",
    "@@ -1,2 +1,3 @@", " a", "+b", " c",
    "@@ -10,2 +11,3 @@", " j", "+k", " l",
  ].join("\n");
  assert.deepEqual(sorted(parseUnifiedDiff(diff).files.get("x.py").added), [2, 12]);
});

test("new file: every line added, isNew true", () => {
  const diff = [
    "diff --git a/n.ts b/n.ts", "new file mode 100644", "index 000..111",
    "--- /dev/null", "+++ b/n.ts", "@@ -0,0 +1,3 @@", "+l1", "+l2", "+l3",
  ].join("\n");
  const f = parseUnifiedDiff(diff).files.get("n.ts");
  assert.deepEqual(sorted(f.added), [1, 2, 3]);
  assert.equal(f.isNew, true);
});

test("deleted file is skipped, not analysed", () => {
  const diff = [
    "diff --git a/gone.js b/gone.js", "deleted file mode 100644",
    "--- a/gone.js", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-x", "-y",
  ].join("\n");
  const { files, skipped } = parseUnifiedDiff(diff);
  assert.equal(files.size, 0);
  assert.deepEqual(skipped, [{ path: "gone.js", reason: "deleted file" }]);
});

test("rename with edit: keyed by the NEW path", () => {
  const diff = [
    "diff --git a/old.js b/new.js", "similarity index 80%", "rename from old.js", "rename to new.js",
    "--- a/old.js", "+++ b/new.js", "@@ -1,2 +1,2 @@", " a", "-b", "+c",
  ].join("\n");
  const { files } = parseUnifiedDiff(diff);
  assert.deepEqual([...files.keys()], ["new.js"]);
  assert.deepEqual(sorted(files.get("new.js").added), [2]);
});

test("a deleted line that starts with '-- ' is not mistaken for a file header", () => {
  // Deleted source line "-- sql comment" appears in the diff as "--- sql comment".
  const diff = [
    "--- a/q.js", "+++ b/q.js", "@@ -1,3 +1,3 @@",
    " a", "--- sql comment", "+++ not a header either", " c",
  ].join("\n");
  const { files, skipped } = parseUnifiedDiff(diff);
  assert.deepEqual([...files.keys()], ["q.js"]);
  assert.deepEqual(sorted(files.get("q.js").added), [2]);
  assert.deepEqual(skipped, []);
});

test("'\\ No newline' markers and omitted hunk counts are handled", () => {
  const diff = [
    "--- a/z.js", "+++ b/z.js", "@@ -1 +1 @@", "-old", "\\ No newline at end of file", "+new", "\\ No newline at end of file",
  ].join("\n");
  assert.deepEqual(sorted(parseUnifiedDiff(diff).files.get("z.js").added), [1]);
});

test("CRLF diff text and stripped-space context lines parse correctly", () => {
  const diff = ["--- a/c.js", "+++ b/c.js", "@@ -1,3 +1,4 @@", " a", "", "+b", " c"].join("\r\n");
  assert.deepEqual(sorted(parseUnifiedDiff(diff).files.get("c.js").added), [3]);
});

test("quoted paths and timestamp suffixes", () => {
  const quoted = ['--- "a/sp ace.js"', '+++ "b/sp ace.js"', "@@ -0,0 +1 @@", "+x"].join("\n");
  assert.ok(parseUnifiedDiff(quoted).files.has("sp ace.js"));
  const stamped = ["--- a/t.js\t2026-01-01 00:00:00", "+++ b/t.js\t2026-01-02 00:00:00", "@@ -0,0 +1 @@", "+x"].join("\n");
  assert.ok(parseUnifiedDiff(stamped).files.has("t.js"));
  const octal = ['--- "a/caf\\303\\251.js"', '+++ "b/caf\\303\\251.js"', "@@ -0,0 +1 @@", "+x"].join("\n");
  const r = parseUnifiedDiff(octal);
  assert.equal(r.files.size, 0, "unsupported quoting is skipped, not guessed");
  assert.equal(r.skipped.length, 1);
});

test("path traversal in the diff is skipped and its hunks are ignored", () => {
  const diff = [
    "--- a/../../etc/cron.d/x", "+++ b/../../etc/cron.d/x", "@@ -0,0 +1 @@", "+evil",
    "--- a/ok.js", "+++ b/ok.js", "@@ -0,0 +1 @@", "+fine",
  ].join("\n");
  const { files, skipped } = parseUnifiedDiff(diff);
  assert.deepEqual([...files.keys()], ["ok.js"]);
  assert.equal(skipped.length, 1);
});

test("binary files are skipped; garbage input yields nothing", () => {
  const bin = ["diff --git a/i.png b/i.png", "index 1..2 100644", "Binary files a/i.png and b/i.png differ"].join("\n");
  const r = parseUnifiedDiff(bin);
  assert.equal(r.files.size, 0);
  assert.deepEqual(r.skipped, [{ path: "i.png", reason: "binary file" }]);
  assert.equal(parseUnifiedDiff("hello world\nnot a diff").files.size, 0);
  assert.equal(parseUnifiedDiff(undefined).files.size, 0);
});

// -------------------------------------------------- splitViolationsByDiff
test("splitViolationsByDiff: added line = introduced, other lines = preexisting", () => {
  const srcDir = "/tmp/scan-x/src";
  const diffFiles = new Map([
    ["a.js", { added: new Set([6]), isNew: false }],
    ["fresh.js", { added: new Set([1, 2]), isNew: true }],
  ]);
  const vs = [
    { path: `${srcDir}/a.js`, line: 6, ruleId: "r" },     // introduced
    { path: `${srcDir}/a.js`, line: 4, ruleId: "r" },     // preexisting
    { path: `${srcDir}/a.js`, line: 0, ruleId: "r" },     // file-level on old file -> preexisting
    { path: `${srcDir}/fresh.js`, line: 0, ruleId: "r" }, // file-level on new file -> introduced
    { path: `${srcDir}/other.js`, line: 1, ruleId: "r" }, // not in diff -> ignored
    { path: "/elsewhere/a.js", line: 6, ruleId: "r" },    // outside srcDir -> ignored
    null,
  ];
  const { introduced, preexisting } = splitViolationsByDiff(vs, srcDir, diffFiles);
  assert.deepEqual(introduced.map(v => [v.path, v.line]), [["a.js", 6], ["fresh.js", 0]]);
  assert.equal(preexisting, 2);
  assert.ok(introduced.every(v => !v.path.includes("/tmp/")), "no server path in output");
  assert.equal(relFromAbs("/tmp/scan-x/srcevil/a.js", srcDir), null, "prefix match needs the separator");
});

// ------------------------------------------------- handler, real binary
// The handler resolves the analyser at <cwd>/backend/bin/linux-x64-cma when it
// is imported. The committed binary is mode 644 (the Vercel build chmods it),
// so run from a scratch cwd holding an executable copy instead of touching the
// repo file. node --test runs each file in its own process, so chdir is safe.
const srcBinary = join(root, "backend", "bin", "linux-x64-cma");
const scratch = mkdtempSync(join(tmpdir(), "diff-test-"));
mkdirSync(join(scratch, "backend", "bin"), { recursive: true });
let canRun = process.platform === "linux" && existsSync(srcBinary);
if (canRun) {
  const dst = join(scratch, "backend", "bin", "linux-x64-cma");
  copyFileSync(srcBinary, dst);
  chmodSync(dst, 0o755);
  canRun = !spawnSync(dst, [], { timeout: 5000 }).error;
}
const gitOk = !spawnSync("git", ["--version"]).error;
const skipE2E = !canRun ? "needs the linux-x64 analyser binary" : !gitOk ? "needs git" : false;

process.chdir(scratch);
const { default: handler } = await import("../api/analyze-diff.js");

function call(body, method = "POST") {
  const res = {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return handler({ method, body }, res).then(() => res);
}

test("rejects non-POST, missing diff, missing files, bad file entries", async () => {
  assert.equal((await call({}, "GET")).statusCode, 405);
  assert.equal((await call({ files: [] })).statusCode, 400);
  assert.equal((await call({ diff: "   ", files: [{ path: "a.js", content: "x" }] })).statusCode, 400);
  assert.equal((await call({ diff: "--- a/a.js\n+++ b/a.js\n@@ -0,0 +1 @@\n+x" })).statusCode, 400);
  assert.equal((await call({ diff: "--- a/a.js\n+++ b/a.js", files: [{ path: "a.js" }] })).statusCode, 400);
  assert.equal((await call({ diff: "not a diff at all", files: [{ path: "a.js", content: "x" }] })).statusCode, 400);
});

test("enforces size limits", async () => {
  const big = "x".repeat(1024 * 1024 + 1);
  assert.equal((await call({ diff: big, files: [{ path: "a.js", content: "x" }] })).statusCode, 413);
  const many = Array.from({ length: 101 }, (_, i) => ({ path: `f${i}.js`, content: "x" }));
  assert.equal((await call({ diff: "--- a/a.js\n+++ b/a.js", files: many })).statusCode, 413);
});

test("diff entries without content, unsupported types, and extra files are reported", async () => {
  const diff = [
    "--- a/nocontent.js", "+++ b/nocontent.js", "@@ -0,0 +1 @@", "+x",
    "--- a/README.md", "+++ b/README.md", "@@ -0,0 +1 @@", "+x",
  ].join("\n");
  const r = await call({ diff, files: [{ path: "extra.js", content: "x" }, { path: "../../evil.js", content: "x" }] });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.summary.filesAnalyzed, 0);
  const reasons = Object.fromEntries(r.body.skipped.map(s => [s.path, s.reason]));
  assert.equal(reasons["nocontent.js"], "content not supplied");
  assert.equal(reasons["README.md"], "unsupported file type");
  assert.equal(reasons["extra.js"], "not in diff");
  assert.ok(r.body.skipped.some(s => s.reason === "unsafe path in files"));
});

test("end to end on a real git diff: only findings on added lines are introduced",
  { skip: skipE2E }, async () => {
  const repo = mkdtempSync(join(tmpdir(), "diff-repo-"));
  const git = (...args) => {
    const r = spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  try {
    git("init", "-q");
    const w = (rel, text) => {
      mkdirSync(dirname(join(repo, rel)), { recursive: true });
      writeFileSync(join(repo, rel), text);
    };
    w("src/old.js", "function a() {\n  return 1;\n}\neval(legacyInput);\n");
    w("src/dead.js", "eval(gone);\n");
    w("logo.bin", Buffer.from([0, 1, 2, 3, 0, 255]));
    git("add", "-A"); git("commit", "-q", "-m", "base");

    // Change: add an eval inside old.js, add a brand-new file with an eval,
    // delete dead.js, touch a binary, add a doc.
    const oldNew = "function a() {\n  return 1;\n}\neval(legacyInput);\nfunction b(x) {\n  return eval(x);\n}\n";
    w("src/old.js", oldNew);
    w("src/added.js", "eval(x);\n");
    w("logo.bin", Buffer.from([9, 9, 0, 9]));
    w("NOTES.md", "hi\n");
    rmSync(join(repo, "src/dead.js"));
    git("add", "-A");
    const diff = git("diff", "--cached");

    const r = await call({
      diff,
      files: [
        { path: "src/old.js", content: oldNew },
        { path: "src/added.js", content: "eval(x);\n" },
      ],
    });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const b = r.body;
    assert.equal(b.mode, "diff");
    assert.equal(b.summary.filesAnalyzed, 2);
    assert.equal(b.summary.addedLines, 4); // old.js lines 5-7 + added.js line 1
    assert.deepEqual(
      b.introduced.map(v => [v.path, v.line, v.ruleId]).sort(),
      [["src/added.js", 1, "js-sec-eval"], ["src/old.js", 6, "js-sec-eval"]]
    );
    assert.equal(b.summary.introduced, 2);
    assert.equal(b.summary.preexistingInTouchedFiles, 1, "old.js line 4 predates the diff");
    assert.equal(b.fixFirst.length >= 1, true);
    assert.equal(Object.values(b.summary.byTier).reduce((x, y) => x + y, 0), 2);
    const reasons = Object.fromEntries(b.skipped.map(s => [s.path, s.reason]));
    assert.equal(reasons["src/dead.js"], "deleted file");
    assert.equal(reasons["logo.bin"], "binary file");
    assert.equal(reasons["NOTES.md"], "unsupported file type");
    const text = JSON.stringify(b);
    assert.ok(!text.includes("/tmp/scan-"), "no server temp path in the response");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

after(() => { rmSync(scratch, { recursive: true, force: true }); });
