import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SITE } from "../site";
import { TIERS, formatNumber, type ScanReport, type Tier } from "../lib/report";
import { buildAuditModel, type AuditModel } from "../lib/audit";

const MAX_NAME = 80;

/* ---------------------------- screen: export panel ---------------------------- */

/**
 * "Download PDF audit". The PDF is the browser's own print-to-PDF of a dedicated,
 * print-only document (portalled to <body>, hidden on screen, the only thing visible
 * when printing). No PDF library and no upload: the report never leaves the browser.
 */
export function AuditExport({ report }: { report: ScanReport }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [preparedFor, setPreparedFor] = useState("");
  const [preparedBy, setPreparedBy] = useState("");
  const forId = useId();
  const byId = useId();
  const model = useMemo(() => buildAuditModel(report), [report]);

  // The portal target (document.body) only exists on the client.
  useEffect(() => setMounted(true), []);

  function printAudit() {
    const previous = document.title;
    const printTitle = `${model.title} - Code Health Audit - REPO-SIGHT`;
    document.title = printTitle; // browsers use the title as the default PDF file name
    let timer = 0;
    const restore = () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", restore);
      if (document.title === printTitle) document.title = previous;
    };
    window.addEventListener("afterprint", restore);
    timer = window.setTimeout(restore, 30_000); // fallback where afterprint never fires
    window.print();
  }

  return (
    <>
      <div className="border-2 border-black bg-white p-3">
        <button type="button" className="font-mono text-xs font-bold underline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide PDF export" : "Download a client-ready PDF audit"}
        </button>
        {open ? (
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block font-mono text-xs font-bold" htmlFor={forId}>
                  Prepared for (optional)
                </label>
                <input
                  id={forId}
                  type="text"
                  maxLength={MAX_NAME}
                  value={preparedFor}
                  onChange={(e) => setPreparedFor(e.target.value)}
                  placeholder="Client or team name"
                  className="mt-1 w-full border-2 border-black bg-white px-2 py-1 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block font-mono text-xs font-bold" htmlFor={byId}>
                  Prepared by (optional)
                </label>
                <input
                  id={byId}
                  type="text"
                  maxLength={MAX_NAME}
                  value={preparedBy}
                  onChange={(e) => setPreparedBy(e.target.value)}
                  placeholder="Your name or company"
                  className="mt-1 w-full border-2 border-black bg-white px-2 py-1 font-mono text-xs"
                />
              </div>
            </div>
            <button type="button" className="rs-btn" onClick={printAudit}>
              Print / save as PDF
            </button>
            <p className="font-mono text-xs text-ink/70">
              In the print dialog choose "Save as PDF" and switch off "Headers and footers" for a clean page. The audit is built
              in your browser from this report; nothing is uploaded.
            </p>
          </div>
        ) : null}
      </div>
      {mounted
        ? createPortal(<AuditDocument model={model} preparedFor={preparedFor.trim()} preparedBy={preparedBy.trim()} />, document.body)
        : null}
    </>
  );
}

/* ----------------------------- print: the document ---------------------------- */

const TIER_PRINT: Record<Tier, string> = {
  critical: "bg-black text-white",
  high: "border-2 border-black font-black",
  medium: "border border-black",
  low: "border border-black/50",
};

function PTier({ tier }: { tier: Tier }) {
  return <span className={`inline-block px-1.5 font-mono text-[8pt] font-bold uppercase ${TIER_PRINT[tier]}`}>{tier}</span>;
}

// keepTogether: short sections move to the next page whole instead of orphaning a row.
function Section({ n, title, children, keepTogether = false }: { n: number; title: string; children: ReactNode; keepTogether?: boolean }) {
  return (
    <section className={`mt-7 ${keepTogether ? "break-inside-avoid" : ""}`}>
      <h2 className="break-after-avoid border-b-2 border-black pb-1 font-mono text-[13pt] font-black">
        {n}. {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const TH = "border-b-2 border-black px-1.5 py-1 text-left font-mono text-[8pt] font-black uppercase";
const TD = "border-b border-black/30 px-1.5 py-1 align-top";

function AuditDocument({ model, preparedFor, preparedBy }: { model: AuditModel; preparedFor: string; preparedBy: string }) {
  const m = model;
  return (
    <div id="rs-print-root" aria-hidden="true">
      <header className="flex items-end justify-between border-b-4 border-black pb-2">
        <div>
          <div className="font-mono text-[10pt] font-black tracking-widest">{SITE.name}</div>
          <div className="font-mono text-[18pt] font-black leading-tight">Code Health Audit</div>
        </div>
        <div className="text-right font-mono text-[8.5pt]">
          {m.scannedOn ? <div>Scanned {m.scannedOn}</div> : null}
          {m.scanRef ? <div>Scan {m.scanRef}</div> : <div>Sample report</div>}
        </div>
      </header>

      <div className="mt-4">
        <div className="break-words font-mono text-[16pt] font-black">{m.title}</div>
        {m.source ? <div className="font-mono text-[9pt]">{m.source}</div> : null}
        {preparedFor || preparedBy ? (
          <div className="mt-1 font-mono text-[9pt]">
            {preparedFor ? <span>Prepared for: {preparedFor}</span> : null}
            {preparedFor && preparedBy ? <span> · </span> : null}
            {preparedBy ? <span>Prepared by: {preparedBy}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-stretch gap-4">
        <div className="flex items-center gap-3 border-2 border-black px-4 py-2">
          <div className="border-2 border-black bg-black px-4 py-1 font-mono text-[34pt] font-black leading-none text-white">{m.grade}</div>
          <div>
            <div className="font-mono text-[18pt] font-black leading-none">{m.score}/100</div>
            <div className="font-mono text-[8pt] font-bold uppercase tracking-widest">Code health</div>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-4 gap-2">
          {m.kpis.map((k) => (
            <div key={k.label} className="border border-black px-2 py-1">
              <div className="font-mono text-[7pt] font-bold uppercase tracking-widest">{k.label}</div>
              <div className="font-mono text-[11pt] font-black">{k.value}</div>
            </div>
          ))}
        </div>
      </div>

      {m.tierCounts ? (
        <div className="mt-3 flex flex-wrap items-center gap-4 font-mono text-[9pt]">
          {TIERS.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <PTier tier={t} />
              <strong>{formatNumber(m.tierCounts?.[t])}</strong>
            </span>
          ))}
        </div>
      ) : null}

      <Section n={1} title="Summary">
        <ul className="list-disc space-y-1 pl-5">
          {m.summary.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Section>

      <Section n={2} title="Fix these first">
        {m.fixFirst.length === 0 ? (
          <p>No findings worth prioritising. This analysis found nothing that needs fixing first.</p>
        ) : (
          <ol className="space-y-3">
            {m.fixFirst.map((item) => (
              <li key={`${item.rank}-${item.title}`} className="break-inside-avoid border border-black p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10pt] font-black">{item.rank}.</span>
                  <PTier tier={item.tier} />
                  <span className="font-mono text-[10pt] font-black">{item.title}</span>
                </div>
                <div className="mt-0.5 font-mono text-[8pt]">
                  {formatNumber(item.count)} {item.count === 1 ? "occurrence" : "occurrences"} in {formatNumber(item.affectedFiles)}{" "}
                  {item.affectedFiles === 1 ? "file" : "files"} · confidence {item.confidence}
                </div>
                <dl className="mt-1.5 space-y-1">
                  <div>
                    <dt className="inline font-bold">What: </dt>
                    <dd className="inline">{item.what}</dd>
                  </div>
                  <div>
                    <dt className="inline font-bold">Why it matters: </dt>
                    <dd className="inline">{item.why}</dd>
                  </div>
                  <div>
                    <dt className="inline font-bold">How to fix: </dt>
                    <dd className="inline">{item.fix}</dd>
                  </div>
                  {item.caveat ? (
                    <div>
                      <dt className="inline font-bold">Note: </dt>
                      <dd className="inline">{item.caveat}</dd>
                    </div>
                  ) : null}
                </dl>
                {item.locations.length > 0 ? (
                  <div className="mt-1.5 break-all font-mono text-[8pt]">Where: {item.locations.join(" · ")}</div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Section>

      {m.components.length > 0 ? (
        <Section n={3} title="Score breakdown" keepTogether>
          <table className="w-full border-collapse text-[9pt]">
            <thead>
              <tr>
                <th className={TH}>Measure</th>
                <th className={TH}>Score</th>
                <th className={TH}>Weight</th>
                <th className={TH}>Measured</th>
              </tr>
            </thead>
            <tbody>
              {m.components.map((c) => (
                <tr key={c.title} className="break-inside-avoid">
                  <td className={`${TD} font-bold`}>{c.title}</td>
                  <td className={`${TD} font-mono`}>{c.score}/100</td>
                  <td className={`${TD} font-mono`}>{c.weight}%</td>
                  <td className={TD}>
                    {c.measured}
                    {c.score < 100 ? <div className="mt-0.5 font-bold">To improve: {c.tip}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {m.languages.length > 0 ? (
        <Section n={4} title="Languages" keepTogether>
          <table className="w-full border-collapse text-[9pt]">
            <thead>
              <tr>
                <th className={TH}>Language</th>
                <th className={TH}>Files</th>
                <th className={TH}>Code lines</th>
                <th className={TH}>Share</th>
                <th className={TH}>Functions</th>
                <th className={TH}>Complexity</th>
              </tr>
            </thead>
            <tbody>
              {m.languages.map((l) => (
                <tr key={l.label} className="break-inside-avoid">
                  <td className={`${TD} font-bold`}>{l.label}</td>
                  <td className={`${TD} font-mono`}>{formatNumber(l.files)}</td>
                  <td className={`${TD} font-mono`}>{formatNumber(l.codeLines)}</td>
                  <td className={`${TD} font-mono`}>{l.share.toFixed(1)}%</td>
                  <td className={`${TD} font-mono`}>{formatNumber(l.functions)}</td>
                  <td className={`${TD} font-mono`}>{formatNumber(l.complexity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {m.unanalyzed ? <p className="mt-2 text-[9pt]">Not analyzed (no analyzer yet): {m.unanalyzed}.</p> : null}
        </Section>
      ) : null}

      {m.hotspots.length > 0 ? (
        <Section n={5} title="Hotspot files">
          <p className="mb-2 text-[9pt]">Ranked by critical and high findings, then total findings, then cyclomatic complexity.</p>
          <table className="w-full border-collapse text-[9pt]">
            <thead>
              <tr>
                <th className={TH}>File</th>
                <th className={TH}>Lang</th>
                <th className={TH}>Lines</th>
                <th className={TH}>Complexity</th>
                <th className={TH}>Nesting</th>
                <th className={TH}>Findings</th>
              </tr>
            </thead>
            <tbody>
              {m.hotspots.map((h) => (
                <tr key={h.path} className="break-inside-avoid">
                  <td className={`${TD} break-all font-mono text-[8pt]`}>{h.path}</td>
                  <td className={TD}>{h.language}</td>
                  <td className={`${TD} font-mono`}>{formatNumber(h.codeLines)}</td>
                  <td className={`${TD} font-mono`}>{formatNumber(h.complexity)}</td>
                  <td className={`${TD} font-mono`}>{h.nesting}</td>
                  <td className={`${TD} font-mono`}>
                    {formatNumber(h.findings)}
                    {h.severe > 0 ? ` (${formatNumber(h.severe)} high+)` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      <Section n={6} title="Security findings">
        {m.security.groups.length === 0 ? (
          <p>No security findings. These are static pattern checks, so a clean result is encouraging but not proof the code is safe.</p>
        ) : (
          <>
            <p className="mb-2">
              {formatNumber(m.security.total)} potential {m.security.total === 1 ? "issue" : "issues"} across{" "}
              {formatNumber(m.security.ruleCount)} {m.security.ruleCount === 1 ? "rule" : "rules"}. Static pattern matches: review each in
              context before acting.
            </p>
            <ul className="space-y-2">
              {m.security.groups.map((g) => (
                <li key={g.ruleId} className="break-inside-avoid border border-black p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {g.tier ? <PTier tier={g.tier} /> : null}
                    <span className="font-mono text-[9.5pt] font-black">{g.ruleId}</span>
                    <span className="font-mono text-[8pt]">
                      {formatNumber(g.count)} in {formatNumber(g.files)} {g.files === 1 ? "file" : "files"}
                    </span>
                  </div>
                  <p className="mt-1">{g.message}</p>
                  <p className="mt-1 break-all font-mono text-[8pt]">
                    {g.locations.join(" · ")}
                    {g.more > 0 ? ` · +${formatNumber(g.more)} more` : ""}
                  </p>
                </li>
              ))}
            </ul>
            {m.security.hiddenRules > 0 ? (
              <p className="mt-2 text-[9pt]">{formatNumber(m.security.hiddenRules)} lower-priority security rules are not listed here.</p>
            ) : null}
          </>
        )}
      </Section>

      {m.duplication ? (
        <Section n={7} title="Duplication">
          <p>
            {m.duplication.percentage.toFixed(1)}% duplicated ({formatNumber(m.duplication.lines)} lines).
            {m.duplication.matches.length > 0 ? " Largest duplicated blocks:" : " No duplicated blocks found."}
          </p>
          {m.duplication.matches.length > 0 ? (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 break-all font-mono text-[8pt]">
              {m.duplication.matches.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}

      <Section n={m.duplication ? 8 : 7} title="Scope and limitations">
        <p className="text-[9pt]">
          REPO-SIGHT performs static analysis: source files are parsed and measured, never executed. Findings are pattern-based and can
          include false positives, so confirm each one in context. Security findings are not a penetration test and are not a guarantee
          that the code is safe. Results describe the analyzed snapshot only
          {m.schemaVersion ? ` (report schema v${m.schemaVersion})` : ""}.
        </p>
        <p className="mt-2 font-mono text-[8.5pt]">
          Generated by {SITE.name} · {SITE.url.replace(/^https?:\/\//, "")}
        </p>
      </Section>
    </div>
  );
}
