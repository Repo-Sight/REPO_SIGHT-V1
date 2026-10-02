import { useEffect, useMemo, useState } from "react";
import { ApiError, fetchScan } from "../lib/api";
import {
  SCORE_COMPONENTS,
  TIERS,
  formatNumber,
  languageLabel,
  relPath,
  violationsByPath,
  type FileMetrics,
  type FixFirstItem,
  type DuplicateMatch,
  type ScanReport,
  type Tier,
  type Violation,
} from "../lib/report";

type TabId = "overview" | "languages" | "files" | "security" | "duplication" | "scoring";
const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "languages", label: "By language" },
  { id: "files", label: "Files" },
  { id: "security", label: "Security" },
  { id: "duplication", label: "Duplication" },
  { id: "scoring", label: "Scoring" },
];

// Colour never carries meaning alone: every badge also prints its tier name.
const TIER_STYLE: Record<Tier, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-signal text-black",
  medium: "bg-amber-300 text-black",
  low: "bg-chrome text-black",
};

const card = "border-2 border-black bg-white shadow-brutal-sm";

function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span className={`inline-block border-2 border-black px-1.5 py-0.5 font-mono text-[11px] font-black uppercase ${TIER_STYLE[tier]}`}>
      {tier}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${card} p-3`}>
      <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-ink/70">{label}</div>
      <div className="mt-1 font-mono text-xl font-black">{value}</div>
    </div>
  );
}

/* ------------------------------ data loading ----------------------------- */

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; report: ScanReport };

export function ReportView({ scanId, onNewScan }: { scanId: string; onNewScan: () => void }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetchScan(scanId)
      .then((report) => !cancelled && setState({ kind: "ready", report }))
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ kind: "error", message: err instanceof ApiError ? err.message : "Could not load this report." });
      });
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  if (state.kind === "loading") {
    return (
      <p role="status" className="font-mono text-sm">
        Loading report…
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="space-y-4">
        <p role="alert" className="border-2 border-black bg-red-100 px-3 py-2 text-sm font-semibold">
          {state.message}
        </p>
        <button type="button" className="rs-btn" onClick={onNewScan}>
          Start a new scan
        </button>
      </div>
    );
  }
  return <ReportBody report={state.report} onNewScan={onNewScan} />;
}

/* --------------------------------- body ---------------------------------- */

export function ReportBody({ report, onNewScan }: { report: ScanReport; onNewScan: () => void }) {
  const [tab, setTab] = useState<TabId>("overview");
  const p = report.project;
  const created = report.createdAt ? new Date(report.createdAt) : null;
  const securityCount = useMemo(() => report.violations.filter((v) => v.category === "security").length, [report.violations]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words font-mono text-xl font-black sm:text-2xl">{report.projectName ?? "Single file scan"}</h2>
          <p className="font-mono text-xs text-ink/70">
            {formatNumber(p.filesAnalyzed)} files · {formatNumber(p.codeLines)} code lines
            {created && !Number.isNaN(created.getTime()) ? ` · scanned ${created.toLocaleDateString()}` : ""}
          </p>
        </div>
        <button type="button" className="rs-btn rs-btn-ghost" onClick={onNewScan}>
          New scan
        </button>
      </div>

      <div role="tablist" aria-label="Report sections" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`rs-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`rs-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`border-2 border-black px-3 py-1.5 font-mono text-xs font-bold sm:text-sm ${
              tab === t.id ? "bg-ink text-white shadow-brutal-sm" : "bg-white hover:bg-chrome"
            }`}
          >
            {t.label}
            {t.id === "security" && securityCount > 0 ? ` (${formatNumber(securityCount)})` : ""}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`rs-panel-${tab}`} aria-labelledby={`rs-tab-${tab}`}>
        {tab === "overview" ? <OverviewTab report={report} /> : null}
        {tab === "languages" ? <LanguagesTab report={report} /> : null}
        {tab === "files" ? <FilesTab report={report} /> : null}
        {tab === "security" ? <SecurityTab report={report} /> : null}
        {tab === "duplication" ? <DuplicationTab report={report} /> : null}
        {tab === "scoring" ? <ScoringTab report={report} /> : null}
      </div>
    </div>
  );
}

/* -------------------------------- overview ------------------------------- */

function OverviewTab({ report }: { report: ScanReport }) {
  const p = report.project;
  const fixFirst = report.fixFirst ?? [];
  const counts = report.tierCounts;
  const unanalyzed = report.unanalyzedLanguages ?? [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <div className={`${card} flex items-center gap-4 p-4`}>
          <div className="border-2 border-black bg-signal px-5 py-2 font-mono text-5xl font-black" aria-label={`Grade ${p.healthGrade}`}>
            {p.healthGrade}
          </div>
          <div>
            <div className="font-mono text-2xl font-black">{Math.round(p.healthScore)}/100</div>
            <div className="font-mono text-xs uppercase tracking-widest text-ink/70">Code health</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Functions" value={formatNumber(p.functionCount)} />
          <Stat label="Complexity" value={formatNumber(p.cyclomaticComplexity)} />
          <Stat label="Max nesting" value={formatNumber(p.maxNestingDepth)} />
          <Stat
            label="Duplication"
            value={report.duplication ? `${report.duplication.duplicatePercentage.toFixed(1)}%` : "n/a"}
          />
        </div>
      </div>

      {counts ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="Findings by severity">
          {TIERS.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 font-mono text-sm">
              <TierBadge tier={t} />
              <strong>{formatNumber(counts[t])}</strong>
            </span>
          ))}
        </div>
      ) : null}

      <section aria-labelledby="rs-fixfirst">
        <h3 id="rs-fixfirst" className="font-mono text-lg font-black">
          Fix these first
        </h3>
        {fixFirst.length === 0 ? (
          <p className={`${card} mt-3 p-4 text-sm`}>
            Clean run. No findings worth fixing first. Keep an eye on the Scoring tab to see where the score can still improve.
          </p>
        ) : (
          <ol className="mt-3 space-y-4">
            {fixFirst.map((item) => (
              <FixFirstCard key={`${item.rank}-${item.title}`} item={item} />
            ))}
          </ol>
        )}
      </section>

      {unanalyzed.length > 0 ? (
        <section className={`${card} p-4`} aria-labelledby="rs-unanalyzed">
          <h3 id="rs-unanalyzed" className="font-mono text-sm font-black">
            Not analyzed
          </h3>
          <p className="mt-1 text-sm text-ink/80">
            These file types were found but REPO-SIGHT has no analyzer for them yet:{" "}
            {unanalyzed.map((u) => `${u.languageName} (${formatNumber(u.fileCount)} files, ${formatNumber(u.lineCount)} lines)`).join(", ")}.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function FixFirstCard({ item }: { item: FixFirstItem }) {
  return (
    <li className={`${card} p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-black">#{item.rank}</span>
        <TierBadge tier={item.tier} />
        <span className="font-mono text-[11px] uppercase text-ink/70">{item.confidence} confidence</span>
        <span className="font-mono text-[11px] text-ink/70">
          · {formatNumber(item.count)} {item.count === 1 ? "occurrence" : "occurrences"} in {formatNumber(item.affectedFiles)}{" "}
          {item.affectedFiles === 1 ? "file" : "files"}
        </span>
      </div>
      <h4 className="mt-2 text-base font-black">{item.title}</h4>
      <dl className="mt-2 space-y-2 text-sm">
        {item.what ? (
          <div>
            <dt className="font-mono text-[11px] font-bold uppercase tracking-widest text-ink/70">What is wrong</dt>
            <dd>{item.what}</dd>
          </div>
        ) : null}
        {item.why ? (
          <div>
            <dt className="font-mono text-[11px] font-bold uppercase tracking-widest text-ink/70">Why it matters</dt>
            <dd>{item.why}</dd>
          </div>
        ) : null}
        {item.fix ? (
          <div>
            <dt className="font-mono text-[11px] font-bold uppercase tracking-widest text-ink/70">How to fix it</dt>
            <dd>{item.fix}</dd>
          </div>
        ) : null}
      </dl>
      {item.caveat ? <p className="mt-2 text-xs italic text-ink/70">{item.caveat}</p> : null}
      {item.locations.length > 0 ? (
        <ul className="mt-3 space-y-0.5 font-mono text-xs">
          {item.locations.map((l, i) => (
            <li key={`${l.path}-${l.line}-${i}`} className="break-all">
              {relPath(l.path)}
              {l.line > 0 ? `:${l.line}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/* -------------------------------- languages ------------------------------ */

const BAR_SHADES = ["bg-ink", "bg-signal", "bg-ok", "bg-amber-300", "bg-sky-400", "bg-chrome"];

function LanguagesTab({ report }: { report: ScanReport }) {
  const langs = useMemo(
    () => [...(report.byLanguage ?? [])].sort((a, b) => b.codeLines - a.codeLines),
    [report.byLanguage],
  );
  const total = langs.reduce((s, l) => s + l.codeLines, 0) || 1;

  if (langs.length === 0) return <p className="text-sm">No per-language data in this report.</p>;

  return (
    <div className="space-y-5">
      <div className="flex h-5 w-full overflow-hidden border-2 border-black" role="img" aria-label="Share of code lines by language">
        {langs.map((l, i) => (
          <div key={l.language} className={BAR_SHADES[i % BAR_SHADES.length]} style={{ width: `${(l.codeLines / total) * 100}%` }} />
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-2 border-black bg-white text-left text-sm">
          <thead className="bg-chrome font-mono text-xs uppercase">
            <tr>
              <th className="p-2">Language</th>
              <th className="p-2 text-right">Share</th>
              <th className="p-2 text-right">Files</th>
              <th className="p-2 text-right">Code lines</th>
              <th className="p-2 text-right">Functions</th>
              <th className="p-2 text-right">Complexity</th>
              <th className="p-2 text-right">Max nesting</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {langs.map((l, i) => (
              <tr key={l.language} className="border-t border-black/30">
                <td className="p-2">
                  <span className={`mr-2 inline-block h-3 w-3 border border-black align-middle ${BAR_SHADES[i % BAR_SHADES.length]}`} aria-hidden="true" />
                  {languageLabel(l.language)}
                </td>
                <td className="p-2 text-right">{((l.codeLines / total) * 100).toFixed(1)}%</td>
                <td className="p-2 text-right">{formatNumber(l.fileCount)}</td>
                <td className="p-2 text-right">{formatNumber(l.codeLines)}</td>
                <td className="p-2 text-right">{formatNumber(l.functionCount)}</td>
                <td className="p-2 text-right">{formatNumber(l.cyclomaticComplexity)}</td>
                <td className="p-2 text-right">{l.maxNestingDepth}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------------------- files -------------------------------- */

type SortKey = "issues" | "complexity" | "nesting" | "lines";
const PAGE = 50;
const FINDINGS_PER_FILE = 50;

function FilesTab({ report }: { report: ScanReport }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("issues");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const byPath = useMemo(() => violationsByPath(report.violations), [report.violations]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const issues = (f: FileMetrics) => byPath.get(f.path)?.length ?? 0;
    const value: Record<SortKey, (f: FileMetrics) => number> = {
      issues,
      complexity: (f) => f.cyclomaticComplexity,
      nesting: (f) => f.maxNestingDepth,
      lines: (f) => f.codeLines,
    };
    return report.files
      .filter((f) => !q || relPath(f.path).toLowerCase().includes(q))
      .sort((a, b) => value[sort](b) - value[sort](a) || b.cyclomaticComplexity - a.cyclomaticComplexity);
  }, [report.files, byPath, query, sort]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="rs-file-filter" className="block font-mono text-xs font-bold uppercase tracking-widest">
            Filter by path
          </label>
          <input
            id="rs-file-filter"
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            className="w-full border-2 border-black bg-white px-3 py-2 font-mono text-sm"
            placeholder="auth, .py, src/api…"
          />
        </div>
        <div>
          <label htmlFor="rs-file-sort" className="block font-mono text-xs font-bold uppercase tracking-widest">
            Sort by
          </label>
          <select
            id="rs-file-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="border-2 border-black bg-white px-3 py-2 font-mono text-sm"
          >
            <option value="issues">Most findings</option>
            <option value="complexity">Highest complexity</option>
            <option value="nesting">Deepest nesting</option>
            <option value="lines">Most code lines</option>
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className={`${card} p-4 text-sm`}>No files match that filter.</p>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, shown).map((f) => {
            const findings = byPath.get(f.path) ?? [];
            const isOpen = open === f.path;
            const panelId = `rs-file-${f.path}`;
            return (
              <li key={f.path} className={card}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpen(isOpen ? null : f.path)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left hover:bg-chrome"
                >
                  <span className="min-w-0 flex-1 break-all font-mono text-sm font-bold">{relPath(f.path)}</span>
                  <span className="font-mono text-xs">{languageLabel(f.language)}</span>
                  <span className="font-mono text-xs">{formatNumber(f.codeLines)} lines</span>
                  <span className="font-mono text-xs">CC {f.cyclomaticComplexity}</span>
                  <span className="font-mono text-xs">nest {f.maxNestingDepth}</span>
                  <span className="font-mono text-xs font-black">
                    {findings.length} {findings.length === 1 ? "finding" : "findings"}
                  </span>
                </button>
                {isOpen ? (
                  <div id={panelId} className="border-t-2 border-black p-3">
                    {findings.length === 0 ? (
                      <p className="text-sm">No findings in this file.</p>
                    ) : (
                      <FindingList findings={findings} />
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > shown ? (
        <button type="button" className="rs-btn rs-btn-ghost" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({rows.length - shown} left)
        </button>
      ) : null}
    </div>
  );
}

function FindingList({ findings }: { findings: Violation[] }) {
  const rank = (v: Violation) => (v.tier ? TIERS.indexOf(v.tier) : TIERS.length);
  const sorted = [...findings].sort((a, b) => rank(a) - rank(b) || a.line - b.line);
  return (
    <ul className="space-y-2">
      {sorted.slice(0, FINDINGS_PER_FILE).map((v, i) => (
        <li key={`${v.ruleId}-${v.line}-${i}`} className="flex flex-wrap items-start gap-2 text-sm">
          {v.tier ? <TierBadge tier={v.tier} /> : null}
          <span className="font-mono text-xs">{v.line > 0 ? `line ${v.line}` : "file-level"}</span>
          <span className="font-mono text-xs text-ink/70">{v.ruleId}</span>
          {/* v.message derives from scanned source; React escapes it, never render as HTML. */}
          <span className="min-w-0 flex-1 basis-full sm:basis-auto">{v.message}</span>
        </li>
      ))}
      {sorted.length > FINDINGS_PER_FILE ? (
        <li className="font-mono text-xs text-ink/70">+ {sorted.length - FINDINGS_PER_FILE} more in this file</li>
      ) : null}
    </ul>
  );
}

/* -------------------------------- security ------------------------------- */

const LOCATIONS_PER_RULE = 10;

function SecurityTab({ report }: { report: ScanReport }) {
  const groups = useMemo(() => {
    const byRule = new Map<string, Violation[]>();
    for (const v of report.violations) {
      if (v.category !== "security") continue;
      const list = byRule.get(v.ruleId);
      if (list) list.push(v);
      else byRule.set(v.ruleId, [v]);
    }
    const tierRank = (v: Violation) => (v.tier ? TIERS.indexOf(v.tier) : TIERS.length);
    return [...byRule.entries()]
      .map(([ruleId, items]) => ({
        ruleId,
        items: [...items].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line),
        rank: Math.min(...items.map(tierRank)),
        tier: items.map((i) => i.tier).find((t): t is Tier => !!t),
        files: new Set(items.map((i) => i.path)).size,
      }))
      .sort((a, b) => a.rank - b.rank || b.items.length - a.items.length);
  }, [report.violations]);

  if (groups.length === 0) {
    return (
      <div className={`${card} space-y-2 p-4 text-sm`}>
        <p className="font-semibold">No security findings.</p>
        <p>
          REPO-SIGHT's security rules found nothing in the analyzed files. These are static pattern checks (hardcoded secrets,
          injection, unsafe crypto and similar), so a clean result is encouraging but not proof the code is safe.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm">
        {formatNumber(groups.reduce((n, g) => n + g.items.length, 0))} potential security issues across {formatNumber(groups.length)}{" "}
        {groups.length === 1 ? "rule" : "rules"}. These are static pattern matches: review each in context before acting.
      </p>
      <ul className="space-y-3">
        {groups.map((g) => (
          <li key={g.ruleId} className={`${card} p-4`}>
            <div className="flex flex-wrap items-center gap-2">
              {g.tier ? <TierBadge tier={g.tier} /> : null}
              <span className="font-mono text-sm font-black">{g.ruleId}</span>
              <span className="font-mono text-xs text-ink/70">
                {formatNumber(g.items.length)} {g.items.length === 1 ? "occurrence" : "occurrences"} in {formatNumber(g.files)}{" "}
                {g.files === 1 ? "file" : "files"}
              </span>
            </div>
            {/* message derives from scanned source; React escapes it. */}
            <p className="mt-2 text-sm">{g.items[0].message}</p>
            <ul className="mt-3 space-y-0.5 font-mono text-xs">
              {g.items.slice(0, LOCATIONS_PER_RULE).map((v, i) => (
                <li key={`${v.path}-${v.line}-${i}`} className="break-all">
                  {relPath(v.path)}
                  {v.line > 0 ? `:${v.line}` : ""}
                </li>
              ))}
              {g.items.length > LOCATIONS_PER_RULE ? (
                <li className="text-ink/70">+ {g.items.length - LOCATIONS_PER_RULE} more</li>
              ) : null}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------- duplication ----------------------------- */

const MATCH_PAGE = 20;

function DuplicationTab({ report }: { report: ScanReport }) {
  const [shown, setShown] = useState(MATCH_PAGE);
  const dup = report.duplication;
  const matches = useMemo<DuplicateMatch[]>(
    () => [...(dup?.matches ?? [])].sort((a, b) => b.lineCount - a.lineCount),
    [dup?.matches],
  );

  if (!dup) return <p className="text-sm">This report has no duplication data.</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <Stat label="Duplicated" value={`${dup.duplicatePercentage.toFixed(1)}%`} />
        <Stat label="Duplicated lines" value={formatNumber(dup.duplicateLineCount)} />
      </div>
      {matches.length === 0 ? (
        <p className={`${card} p-4 text-sm`}>No duplicated blocks found.</p>
      ) : (
        <>
          <p className="text-sm">
            Largest duplicated blocks first. Extract shared code into one function or module and call it from both places.
          </p>
          <ul className="space-y-2">
            {matches.slice(0, shown).map((m, i) => (
              <li key={`${m.pathA}-${m.lineStartA}-${m.pathB}-${m.lineStartB}-${i}`} className={`${card} p-3`}>
                <div className="font-mono text-xs font-black">{formatNumber(m.lineCount)} lines</div>
                <div className="mt-1 break-all font-mono text-xs">
                  {relPath(m.pathA)}:{m.lineStartA}-{m.lineEndA}
                </div>
                <div className="break-all font-mono text-xs text-ink/70">
                  ↔ {relPath(m.pathB)}:{m.lineStartB}-{m.lineEndB}
                </div>
              </li>
            ))}
          </ul>
          {matches.length > shown ? (
            <button type="button" className="rs-btn rs-btn-ghost" onClick={() => setShown((n) => n + MATCH_PAGE)}>
              Show more ({matches.length - shown} left)
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

/* --------------------------------- scoring ------------------------------- */

function ScoringTab({ report }: { report: ScanReport }) {
  const p = report.project;
  const b = p.scoreBreakdown;
  if (!b) return <p className="text-sm">This report has no score breakdown.</p>;

  const parts = SCORE_COMPONENTS.map((c) => ({ ...c, score: Math.max(0, Math.min(100, b[c.key] ?? 0)) }));
  const weakest = [...parts].sort((a, c) => (100 - a.score) * a.weight - (100 - c.score) * c.weight).reverse()[0];

  return (
    <div className="space-y-5">
      <p className="text-sm">
        The health score is a weighted blend of five measures. Each is scored 0 to 100; the weight shows how much it moves the total.
        {weakest && weakest.score < 100 ? (
          <>
            {" "}
            Biggest gain available: <strong>{weakest.title.toLowerCase()}</strong>.
          </>
        ) : null}
      </p>
      <ul className="space-y-4">
        {parts.map((c) => (
          <li key={c.key} className={`${card} p-4`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-mono text-sm font-black">{c.title}</h3>
              <span className="font-mono text-xs text-ink/70">weight {Math.round(c.weight * 100)}%</span>
            </div>
            <div
              className="mt-2 h-3 w-full border-2 border-black bg-chrome"
              role="meter"
              aria-label={`${c.title} score`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(c.score)}
            >
              <div className="h-full bg-signal" style={{ width: `${c.score}%` }} />
            </div>
            <p className="mt-2 font-mono text-xs">{Math.round(c.score)}/100 · {c.describe(p)}</p>
            {c.score < 100 ? <p className="mt-1 text-sm">{c.tip}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
