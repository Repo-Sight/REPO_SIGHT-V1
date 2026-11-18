// Groups the engine's "unanalyzedLanguages" list for display. Pure data, no React.
//
// The engine reports every extension it has no analyzer for. That includes real source
// languages (Go, Rust, ...) but also markup, data, text and image files. Only the first
// kind says something about what the grade does not cover, so the two are shown apart.

import type { UnanalyzedLanguage } from "./report";

export interface UnanalyzedEntry {
  name: string;
  fileCount: number;
  /** null for binary files, where a line count means nothing. */
  lineCount: number | null;
}

export interface UnanalyzedGroups {
  /** Source code without an analyzer: not covered by the grade or the findings. */
  code: UnanalyzedEntry[];
  /** Markup, data, text, images and similar files. */
  other: UnanalyzedEntry[];
}

// extension -> display name, for files that are not source code.
const OTHER_NAMES: Record<string, string> = {
  ".json": "JSON",
  ".html": "HTML",
  ".htm": "HTML",
  ".css": "CSS",
  ".scss": "SCSS",
  ".xml": "XML",
  ".txt": "Text",
  ".md": "Markdown",
  ".csv": "CSV",
  ".yml": "YAML",
  ".yaml": "YAML",
  ".toml": "TOML",
  ".svg": "SVG",
  ".lock": "Lockfiles",
  ".png": "Images",
  ".jpg": "Images",
  ".jpeg": "Images",
  ".gif": "Images",
  ".webp": "Images",
  ".ico": "Images",
  ".pdf": "PDF",
  ".woff": "Fonts",
  ".woff2": "Fonts",
  ".ttf": "Fonts",
  ".otf": "Fonts",
};

const BINARY_NAMES = new Set(["Images", "Fonts", "PDF"]);

function byWeight(a: UnanalyzedEntry, b: UnanalyzedEntry): number {
  const la = a.lineCount ?? -1;
  const lb = b.lineCount ?? -1;
  if (la !== lb) return lb - la;
  if (a.fileCount !== b.fileCount) return b.fileCount - a.fileCount;
  return a.name.localeCompare(b.name);
}

function merge(map: Map<string, UnanalyzedEntry>, name: string, fileCount: number, lineCount: number | null): void {
  const hit = map.get(name);
  if (!hit) {
    map.set(name, { name, fileCount, lineCount });
    return;
  }
  hit.fileCount += fileCount;
  hit.lineCount = hit.lineCount === null || lineCount === null ? null : hit.lineCount + lineCount;
}

export function groupUnanalyzed(list: UnanalyzedLanguage[]): UnanalyzedGroups {
  const code = new Map<string, UnanalyzedEntry>();
  const other = new Map<string, UnanalyzedEntry>();
  for (const u of list) {
    const ext = (u.extension ?? "").toLowerCase();
    const otherName = OTHER_NAMES[ext];
    if (otherName) {
      merge(other, otherName, u.fileCount, BINARY_NAMES.has(otherName) ? null : u.lineCount);
    } else if (!ext) {
      merge(other, "Files without extension", u.fileCount, u.lineCount);
    } else {
      merge(code, u.languageName || ext, u.fileCount, u.lineCount);
    }
  }
  return { code: [...code.values()].sort(byWeight), other: [...other.values()].sort(byWeight) };
}

function plural(n: number, one: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : `${one}s`}`;
}

/** "Go (3 files, 120 lines)" or "Images (3 files)". */
export function describeEntry(e: UnanalyzedEntry): string {
  const parts = [plural(e.fileCount, "file")];
  if (e.lineCount !== null) parts.push(plural(e.lineCount, "line"));
  return `${e.name} (${parts.join(", ")})`;
}

export function describeEntries(entries: UnanalyzedEntry[]): string {
  return entries.map(describeEntry).join(", ");
}
