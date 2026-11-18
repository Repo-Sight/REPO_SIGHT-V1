// Builds the "Try a demo report" payload: frontend/public/demo/report.json
//
//   node scripts/build-demo-report.mjs            # analyse this repo
//   node scripts/build-demo-report.mjs <srcDir>   # analyse another checkout
//
// The report is REAL: the committed analyser binary runs over a copy of the
// source tree, then api/_lib/enrich.js adds tiers + Fix First, exactly as
// api/analyze.js does for a live scan. Nothing is hand-written or edited.
//
// Re-run it whenever the analyser or rule catalog changes (the demo is a
// snapshot, like the committed binary). Needs a Linux x64 host, or set
// CMA_BIN to a binary built for yours.
//
// The copy lives at /tmp/scan-demo/src so file paths have the same shape as a
// live scan (frontend relPath() strips that prefix). Deliberately excluded:
// scripts/fixtures (intentionally bad code for tests), build output, deps.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { enrichReport } from "../api/_lib/enrich.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = resolve(process.argv[2] ?? root);
const cma = process.env.CMA_BIN ?? join(root, "backend", "bin", "linux-x64-cma");
const out = join(root, "frontend", "public", "demo", "report.json");

const work = "/tmp/scan-demo";
const copy = join(work, "src");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".vercel"]);
const SKIP_PATHS = ["backend/bin", "scripts/fixtures", "frontend/public/demo"];

rmSync(work, { recursive: true, force: true });
mkdirSync(copy, { recursive: true });
cpSync(srcDir, copy, {
  recursive: true,
  filter: (p) => {
    const rel = relative(srcDir, p).split(sep).join("/");
    if (!rel) return true;
    if (rel.split("/").some((part) => SKIP_DIRS.has(part))) return false;
    return !SKIP_PATHS.some((s) => rel === s || rel.startsWith(`${s}/`));
  },
});

const rawPath = join(work, "report.json");
execFileSync(cma, [copy, "--json", rawPath], { stdio: ["ignore", "ignore", "inherit"], timeout: 45_000 });

const report = JSON.parse(readFileSync(rawPath, "utf8"));
report.coverageSummary = { available: false };
enrichReport(report);

// No repoOwner/repoName/repoBranch on purpose: the AI-explain button and the
// scan-over-scan trend only apply to live scans of a repo, not to this snapshot.
const payload = {
  status: "COMPLETED",
  scanId: "demo",
  projectName: "REPO-SIGHT (demo)",
  createdAt: new Date().toISOString(),
  visibility: "public",
  ...report,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(payload));
rmSync(work, { recursive: true, force: true });

const p = payload.project;
console.log(
  `demo report: ${p.filesAnalyzed} files, ${payload.violations.length} findings, ` +
    `score ${Math.round(p.healthScore)} (${p.healthGrade}), fixFirst ${payload.fixFirst?.length ?? 0}, ` +
    `schema v${payload.schemaVersion}, ${(JSON.stringify(payload).length / 1024).toFixed(0)} KB -> ${relative(root, out)}`,
);
 
