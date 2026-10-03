// Gate for the bundled sample report behind "Try a demo report".
//   npm run check:demo
// A missing or malformed public/demo/report.json would silently break the main
// call to action, so CI fails on it. Regenerate with:
//   node scripts/build-demo-report.mjs   (repo root)
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "public/demo/report.json";
const problems = [];
let r;
try {
  r = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.error(`demo report: cannot read/parse ${file}: ${e.message}`);
  process.exit(1);
}

const need = (ok, msg) => ok || problems.push(msg);
need(r.status === "COMPLETED", "status is not COMPLETED");
need(r.project && typeof r.project.healthScore === "number", "project.healthScore missing");
need(Array.isArray(r.files) && r.files.length > 0, "files[] empty");
need(Array.isArray(r.violations) && r.violations.length > 0, "violations[] empty");
need(Array.isArray(r.byLanguage) && r.byLanguage.length > 0, "byLanguage[] empty");
need(r.schemaVersion >= 3, `schemaVersion ${r.schemaVersion} < 3 (no tiers / Fix First)`);
need(Array.isArray(r.fixFirst) && r.fixFirst.length > 0, "fixFirst[] empty");
need(r.tierCounts && typeof r.tierCounts.high === "number", "tierCounts missing");
// A snapshot has no live repo: these would switch on AI-explain / trend UI that cannot work.
need(!r.repoOwner && !r.repoName && !r.repoBranch, "repoOwner/repoName/repoBranch must be absent");
const raw = JSON.stringify(r);
need(!/\/home\/|\/Users\/|[A-Z]:\\\\/.test(raw), "host filesystem path leaked into the report");
need(
  (r.files ?? []).every((f) => f.path.startsWith("/tmp/scan-demo/src/")),
  "file paths are not under /tmp/scan-demo/src/ (frontend relPath() would not strip them)",
);

if (problems.length) {
  console.error(`demo report: ${problems.length} problem(s)\n - ${problems.join("\n - ")}`);
  process.exit(1);
}
console.log(
  `demo report ok: ${r.files.length} files, ${r.violations.length} findings, fixFirst ${r.fixFirst.length}, schema v${r.schemaVersion}`,
);
