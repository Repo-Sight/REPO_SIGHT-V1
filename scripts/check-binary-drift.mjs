// scripts/check-binary-drift.mjs
//
// Usage: node scripts/check-binary-drift.mjs <fresh-cma> <committed-cma> [fixtureDir]
//
// Fails (exit 1) when the analyser binary committed for production
// (backend/bin/linux-x64-cma) reports different findings than a binary built
// from the current sources. Vercel cannot compile C++, so the prebuilt binary
// is what actually runs in prod -- and it does NOT rebuild itself when the
// analyser sources change. A stale binary once shipped with no security
// findings at all; this check turns that silent drift into a red CI run.
//
// Compares the multiset of ruleIds both binaries emit over a fixture that
// exercises most rules in all six languages.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [freshBin, committedBin, fixtureArg] = process.argv.slice(2);
if (!freshBin || !committedBin) {
  console.error("usage: check-binary-drift.mjs <fresh-cma> <committed-cma> [fixtureDir]");
  process.exit(2);
}
const fixture = resolve(fixtureArg ?? join(here, "fixtures", "drift-src"));

function ruleCounts(bin, tmp, label) {
  const out = join(tmp, `${label}.json`);
  execFileSync(resolve(bin), [fixture, "--json", out], { stdio: "pipe", timeout: 60_000 });
  const report = JSON.parse(readFileSync(out, "utf8"));
  const counts = new Map();
  for (const v of report.violations ?? []) counts.set(v.ruleId, (counts.get(v.ruleId) ?? 0) + 1);
  return counts;
}

const tmp = mkdtempSync(join(tmpdir(), "cma-drift-"));
try {
  const fresh = ruleCounts(freshBin, tmp, "fresh");
  const committed = ruleCounts(committedBin, tmp, "committed");

  const diffs = [];
  for (const id of new Set([...fresh.keys(), ...committed.keys()])) {
    const f = fresh.get(id) ?? 0;
    const c = committed.get(id) ?? 0;
    if (f !== c) diffs.push(`  ${id}: fresh build=${f}, committed binary=${c}`);
  }

  if (diffs.length) {
    console.error(
      `BINARY DRIFT: committed backend/bin/linux-x64-cma disagrees with a fresh build on ${diffs.length} rule(s):\n` +
        diffs.sort().join("\n") +
        `\n\nRebuild the static binary from the current analyser sources and commit it:\n` +
        `  cmake -S analyser -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_EXE_LINKER_FLAGS=-static\n` +
        `  cmake --build build && strip build/cma && cp build/cma backend/bin/linux-x64-cma`
    );
    process.exit(1);
  }
  const total = [...fresh.values()].reduce((a, b) => a + b, 0);
  console.log(`OK: committed binary matches fresh build (${fresh.size} distinct rules, ${total} findings on fixture).`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
