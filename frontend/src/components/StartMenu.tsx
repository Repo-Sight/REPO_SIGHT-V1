import { useEffect, useMemo, useRef, useState } from "react";
import { useDesktop } from "../lib/desktopContext";
import { GLYPHS, LEFT, RIGHT, type DesktopItem } from "./DesktopIcons";

interface Entry {
  href: string;
  label: string;
  group: string;
  glyph: DesktopItem["glyph"];
  external?: boolean;
}

/** Every destination on the desktop, flattened into start-menu groups. */
function buildEntries(): Entry[] {
  const out: Entry[] = [];
  for (const i of LEFT) {
    if (i.folder) i.folder.links.forEach((l) => out.push({ href: l.href, label: l.label, group: i.folder!.title, glyph: i.glyph }));
    else out.push({ href: i.href, label: i.label, group: "Apps", glyph: i.glyph });
  }
  for (const i of RIGHT) out.push({ href: i.href, label: i.label, group: "System", glyph: i.glyph, external: i.external });
  return out;
}
const ENTRIES = buildEntries();
const GROUPS = ["Apps", "Languages", "Checkers", "System"];

/**
 * The start menu: every page as a launcher, type-to-filter, plus the window
 * commands (show desktop, cascade, tile, close all). Links are plain anchors;
 * SiteLayout's click handler turns them into windows.
 */
export function StartMenu({ onClose }: { onClose: () => void }) {
  const d = useDesktop();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!root.current?.contains(t) && !t.closest("[data-start-button]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? ENTRIES.filter((e) => e.label.toLowerCase().includes(n) || e.group.toLowerCase().includes(n)) : ENTRIES;
  }, [q]);

  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <div ref={root} className="rs-start rs-pop" role="dialog" aria-label="Start menu">
      <div className="p-2">
        <input
          ref={input}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown[0]) {
              e.preventDefault();
              const first = shown[0];
              onClose();
              if (first.external) window.open(first.href, "_blank", "noopener,noreferrer");
              else d.open(first.href);
            }
          }}
          placeholder="Search pages…"
          aria-label="Search pages"
          className="w-full rounded-md border border-line bg-chrome px-3 py-1.5 font-mono text-sm placeholder:text-muted"
        />
      </div>

      <div className="max-h-[min(66vh,30rem)] overflow-y-auto px-2 pb-2">
        {shown.length === 0 ? <p className="px-2 py-3 text-sm text-muted">No page matches “{q}”.</p> : null}
        {GROUPS.map((g) => {
          const items = shown.filter((e) => e.group === g);
          if (items.length === 0) return null;
          return (
            <section key={g} aria-label={g} className="mb-1.5">
              <h2 className="px-2 pb-1 pt-2 font-mono text-[0.65rem] font-bold uppercase tracking-widest text-muted">{g}</h2>
              <ul className="grid gap-0.5">
                {items.map((e) => (
                  <li key={e.href + e.label}>
                    <a
                      href={e.href}
                      onClick={onClose}
                      className="rs-start-item"
                      {...(e.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    >
                      <span className="inline-grid place-items-center [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">
                        {GLYPHS[e.glyph]}
                      </span>
                      {e.label}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-1 border-t border-line bg-chrome p-2 text-sm">
        <button type="button" className="rs-start-cmd" onClick={act(d.showDesktop)}>
          Show desktop
        </button>
        <button type="button" className="rs-start-cmd" onClick={act(d.openCard)}>
          Score card
        </button>
        <button type="button" className="rs-start-cmd" onClick={act(d.cascade)}>
          Cascade windows
        </button>
        <button type="button" className="rs-start-cmd" onClick={act(d.tile)}>
          Tile windows
        </button>
        <button type="button" className="rs-start-cmd col-span-2" data-danger="true" onClick={act(d.closeAll)}>
          Close all windows
        </button>
      </div>
    </div>
  );
}
