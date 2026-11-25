// scripts/c-language.test.mjs -- run with: npm run test:api
// C language support (V3 plan, Phase 1 item 4): the three hand-synced extension lists agree, the rule
// catalog covers every C rule, and the committed analyser binary classifies and flags C as designed.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getRule, listRules } from "../api/_lib/ruleCatalog.js";
import { enrichReport } from "../api/_lib/enrich.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(root, "backend", "bin", "linux-x64-cma");
const read = (p) => readFileSync(join(root, p), "utf8");

// ---------------------------------------------------------------- extension lists stay in sync
function cppExtensions() {
  const src = read("analyser/src/filesystem/FileScanner.cpp");
  const block = src.slice(src.indexOf("kSupportedExtensions"));
  return [...block.slice(0, block.indexOf("};")).matchAll(/"(\.[a-z+]+)"/g)].map((m) => m[1]).sort();
}
function jsExtensions(file) {
  const src = read(file);
  const block = src.slice(src.indexOf("const SUPPORTED_EXTENSIONS"));
  return [...block.slice(0, block.indexOf("]);")).matchAll(/"(\.[a-z+]+)"/g)].map((m) => m[1]).sort();
}

test("supported extensions: FileScanner.cpp, analyze-file.js and analyze-diff.js list the same set, .c included", () => {
  const engine = cppExtensions();
  assert.ok(engine.includes(".c"), "engine scans .c");
  assert.ok(engine.length >= 16, `parsed the engine list (${engine.length})`);
  assert.deepEqual(jsExtensions("api/analyze-file.js"), engine, "analyze-file.js is out of sync with FileScanner.cpp");
  assert.deepEqual(jsExtensions("api/analyze-diff.js"), engine, "analyze-diff.js is out of sync with FileScanner.cpp");
});

// ------------------------------------------------------------------------------------- catalog
test("catalog: 19 C rules, all resolvable, 10 of them security, prefixed c- and typed as language c", () => {
  const c = listRules().filter((r) => r.language === "c");
  assert.equal(c.length, 19);
  assert.equal(c.filter((r) => r.category === "security").length, 10);
  for (const r of c) {
    assert.ok(r.ruleId.startsWith("c-"));
    assert.ok(r.title && r.what && r.why && r.fix, `${r.ruleId} has full copy`);
    assert.ok(["critical", "high", "medium", "low"].includes(r.tier));
    assert.ok(["high", "medium", "low"].includes(r.confidence));
  }
  assert.equal(getRule("cpp-sec-system-call").language, "cpp", "the c- prefix does not capture cpp-");
  assert.equal(listRules().length, 117);
  assert.equal(listRules().filter((r) => r.category === "security").length, 55);
});

// ------------------------------------------------------------------------- the committed binary
function scan(files) {
  const dir = mkdtempSync(join(tmpdir(), "rs-c-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  const out = join(tmpdir(), `rs-c-out-${Math.random().toString(36).slice(2)}.json`);
  try {
    execFileSync(BIN, [dir, "--json", out], { stdio: "pipe", timeout: 30_000 });
    return JSON.parse(readFileSync(out, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { force: true });
  }
}
const languages = (report) => Object.fromEntries(report.files.map((f) => [f.path.split("/").slice(-2).join("/").replace(/^rs-c-[^/]+\//, ""), f.language]));

const DEMO_C = `#include <stdio.h>
#include <string.h>
static const char *password = "hunter2hunter2";
int handle(char *in, char *msg) {
    char buf[16];
    char *p = malloc(32);
    p[0] = 'x';
    strcpy(buf, in);
    printf(msg);
    scanf("%s", buf);
    system(in);
    struct node { int class; int new; } n;
    return n.new;
}
`;

test("binary: .c files are language c; .h follows the scan-level rule", () => {
  chmodSync(BIN, 0o755);
  const cOnly = languages(scan({ "a.c": DEMO_C, "a.h": "int handle(char *in, char *msg);\n" }));
  assert.deepEqual(Object.values(cOnly).sort(), ["c", "c"], "no C++ source: the header counts as C");

  const mixed = languages(scan({ "a.c": DEMO_C, "a.h": "int handle(char *in, char *msg);\n", "b.cpp": "int main() { return 0; }\n" }));
  assert.equal(mixed["a.c"] ?? Object.entries(mixed).find(([k]) => k.endsWith("a.c"))[1], "c");
  assert.equal(Object.entries(mixed).find(([k]) => k.endsWith("a.h"))[1], "cpp", "a C++ file makes headers C++");

  const lone = languages(scan({ "only.h": "int f(void);\n" }));
  assert.deepEqual(Object.values(lone), ["cpp"], "a lone header (single upload) stays C++");
});

test("binary: a C file produces the C findings, each with a catalog entry, and C identifiers named like C++ keywords stay quiet", () => {
  chmodSync(BIN, 0o755);
  const report = enrichReport(scan({ "demo.c": DEMO_C }));
  const ids = new Set(report.violations.map((v) => v.ruleId));
  for (const want of ["c-sec-hardcoded-secret", "c-malloc-unchecked", "c-sec-unsafe-buffer-fn", "c-sec-format-string", "c-sec-unsafe-scanf", "c-sec-system-call"]) {
    assert.ok(ids.has(want), `${want} reported (got ${[...ids].join(", ")})`);
  }
  assert.ok([...ids].every((id) => id.startsWith("c-")), "no cpp-* rule fires on C");
  for (const v of report.violations) {
    assert.ok(getRule(v.ruleId), `${v.ruleId} is in the catalog`);
    assert.ok(v.tier && v.confidence, `${v.ruleId} got tier + confidence`);
  }
  assert.ok(report.fixFirst.length >= 1);
  assert.equal(report.byLanguage.find((b) => b.language === "c").fileCount, 1);
});
