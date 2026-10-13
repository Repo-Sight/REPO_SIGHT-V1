import type { AppSpec } from "../lib/apps";
import { GLYPHS, type GlyphName } from "./DesktopIcons";

export function glyphFor(spec: AppSpec): GlyphName {
  switch (spec.kind) {
    case "home":
      return "home";
    case "demo":
    case "report":
    case "card":
      return "report";
    case "page": {
      const p = spec.entry?.path ?? "";
      if (spec.entry?.kind === "notfound") return "info";
      if (p.startsWith("/learn")) return "book";
      if (p.startsWith("/about")) return "info";
      if (p.startsWith("/contact")) return "mail";
      if (p.startsWith("/privacy")) return "lock";
      if (p.startsWith("/terms")) return "terms";
      if (p.includes("security")) return "shield";
      return "scan";
    }
  }
}

/** The small app glyph used in title bars, taskbar chips and the start menu (scaled from the 26px desktop glyphs). */
export function AppIcon({ spec, className = "" }: { spec: AppSpec; className?: string }) {
  return (
    <span className={`inline-grid shrink-0 place-items-center [&_svg]:h-4 [&_svg]:w-4 ${className}`} aria-hidden="true">
      {GLYPHS[glyphFor(spec)]}
    </span>
  );
}
