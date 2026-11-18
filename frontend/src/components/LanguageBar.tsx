import { formatNumber, languageLabel, type LanguageAggregate } from "../lib/report";

// Shared by the Overview card and the By language tab so both always agree.
export const LANGUAGE_SHADES = ["bg-ink", "bg-signal", "bg-ok", "bg-amber", "bg-lav", "bg-chrome"];

export function languageShade(index: number): string {
  return LANGUAGE_SHADES[index % LANGUAGE_SHADES.length];
}

/** Languages sorted by code lines, largest first. Zero-line languages are dropped. */
export function sortLanguages(byLanguage: LanguageAggregate[] | undefined): LanguageAggregate[] {
  return [...(byLanguage ?? [])].filter((l) => l.codeLines > 0).sort((a, b) => b.codeLines - a.codeLines);
}

export function formatShare(codeLines: number, total: number): string {
  if (total <= 0) return "0%";
  const pct = (codeLines / total) * 100;
  if (pct > 0 && pct < 0.1) return "<0.1%";
  return `${pct.toFixed(1)}%`;
}

export function LanguageBar({ langs, showLegend = true }: { langs: LanguageAggregate[]; showLegend?: boolean }) {
  const total = langs.reduce((s, l) => s + l.codeLines, 0);
  if (langs.length === 0 || total <= 0) return null;

  const summary = langs.map((l) => `${languageLabel(l.language)} ${formatShare(l.codeLines, total)}`).join(", ");

  return (
    <div>
      <div
        className="flex h-5 w-full overflow-hidden rounded-md border border-line"
        role="img"
        aria-label={`Share of code lines by language: ${summary}`}
      >
        {langs.map((l, i) => (
          <div
            key={l.language}
            className={languageShade(i)}
            // A sliver of a language must stay visible, so every segment gets a small floor width.
            style={{ width: `${(l.codeLines / total) * 100}%`, minWidth: "3px" }}
            title={`${languageLabel(l.language)}: ${formatShare(l.codeLines, total)} (${formatNumber(l.codeLines)} code lines)`}
          />
        ))}
      </div>
      {showLegend ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
          {langs.map((l, i) => (
            <li key={l.language} className="inline-flex items-center gap-1.5">
              <span className={`inline-block h-3 w-3 border border-line ${languageShade(i)}`} aria-hidden="true" />
              <span>{languageLabel(l.language)}</span>
              <strong>{formatShare(l.codeLines, total)}</strong>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
