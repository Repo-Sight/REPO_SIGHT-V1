import { useEffect, useState } from "react";
import { useDesktop, useDesktopView, type MenuItem } from "../lib/desktopContext";
import { LANGUAGES, NAV } from "../lib/nav";
import type { Win } from "../lib/windows";
import { SITE } from "../site";
import { AppIcon } from "./AppIcon";
import { AuthMenu } from "./AuthMenu";
import { StartMenu } from "./StartMenu";

/** Taskbar clock. Renders empty until mounted so prerendered HTML and first hydration match. */
function Clock() {
  const [now, setNow] = useState("");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="hidden min-w-[4.5ch] text-sm tabular-nums text-muted sm:inline" aria-hidden="true">
      {now}
    </span>
  );
}

/** Right-click menu for a window (taskbar chip). */
function windowMenu(w: Win, d: ReturnType<typeof useDesktop>, focused: boolean): MenuItem[] {
  const id = w.spec.id;
  return [
    w.min || !focused
      ? { label: w.min ? "Restore" : "Bring to front", onSelect: () => d.toggleFromTaskbar(id) }
      : { label: "Minimize", hint: "Shift+Down", onSelect: () => d.minimize(id) },
    { label: w.max ? "Restore size" : "Maximize", hint: "Shift+Up", disabled: d.mobile || w.min, onSelect: () => d.toggleMax(id) },
    { label: "Close", hint: "Shift+W", danger: true, onSelect: () => d.close(id) },
  ];
}

function Chip({ w, focused }: { w: Win; focused: boolean }) {
  const d = useDesktop();
  return (
    <button
      type="button"
      className="rs-chip"
      data-active={focused}
      data-min={w.min}
      aria-pressed={focused}
      title={`${w.spec.title}${w.min ? " (minimized)" : ""}`}
      onClick={() => d.toggleFromTaskbar(w.spec.id)}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          d.close(w.spec.id);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        d.showMenu(e.clientX, e.clientY, windowMenu(w, d, focused));
      }}
    >
      <AppIcon spec={w.spec} />
      <span className="truncate">{w.spec.title}</span>
    </button>
  );
}

/** Open windows as rows (phones, where the taskbar chips do not fit). */
function WindowList() {
  const d = useDesktop();
  const { wins, focusedId } = useDesktopView();
  const live = wins.filter((w) => !w.closing);
  if (live.length === 0) return null;
  return (
    <div className="border-t border-line pt-2 md:hidden" role="group" aria-label="Open windows">
      <p className="px-1 pb-1 font-mono text-[0.65rem] font-bold uppercase tracking-widest text-muted">Open windows</p>
      <ul className="grid gap-1">
        {live.map((w) => (
          <li key={w.spec.id} className="flex items-center gap-1">
            <button type="button" className="rs-chip min-w-0 flex-1" data-active={w.spec.id === focusedId} data-min={w.min} onClick={() => d.toggleFromTaskbar(w.spec.id)}>
              <AppIcon spec={w.spec} />
              <span className="truncate">{w.spec.title}</span>
            </button>
            <button type="button" className="rs-ctl rs-ctl-close" aria-label={`Close ${w.spec.title}`} onClick={() => d.close(w.spec.id)}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="m3.5 3.5 9 9m0-9-9 9" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The taskbar: start menu button, brand, site links, one chip per open window
 * (click = focus / minimise / restore, middle-click = close, right-click = menu),
 * clock, sign-in, and a "show desktop" strip at the far right.
 */
export function Taskbar({ menuOpen, setMenuOpen }: { menuOpen: boolean; setMenuOpen: (v: boolean | ((p: boolean) => boolean)) => void }) {
  const d = useDesktop();
  const { wins, focusedId } = useDesktopView();
  const [startOpen, setStartOpen] = useState(false);
  const live = wins.filter((w) => !w.closing);

  return (
    <header className="relative z-40 shrink-0">
      <div
        id="taskbar"
        className="flex h-[42px] items-center gap-2 rounded-lg border border-line bg-paper/90 px-2 shadow-soft-lg backdrop-blur"
      >
        <button
          type="button"
          data-start-button=""
          className="rs-start-btn"
          aria-label="Start menu"
          aria-expanded={startOpen}
          aria-haspopup="dialog"
          onClick={() => setStartOpen((v) => !v)}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
            <rect x="2" y="2" width="5" height="5" rx="1" />
            <rect x="9" y="2" width="5" height="5" rx="1" />
            <rect x="2" y="9" width="5" height="5" rx="1" />
            <rect x="9" y="9" width="5" height="5" rx="1" />
          </svg>
        </button>

        <a href="/" className="flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-chrome" aria-label={`${SITE.name} home`}>
          <img src="/apple-touch-icon.png" alt="" width={28} height={28} className="h-7 w-7 rounded-md border border-line" />
          <span className="rs-display hidden text-xl sm:inline">{SITE.name}</span>
        </a>

        <span className="mx-1 hidden h-6 w-px bg-line lg:block" aria-hidden="true" />

        <nav
          id="site-nav"
          aria-label="Main"
          className={`${menuOpen ? "flex" : "hidden"} absolute left-0 right-0 top-full mt-1 flex-col gap-1 rounded-lg border border-line bg-paper p-3 shadow-soft-lg lg:static lg:mt-0 lg:flex lg:flex-row lg:items-center lg:gap-1 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none`}
        >
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="rs-navlink" onClick={() => setMenuOpen(false)}>
              {n.label}
            </a>
          ))}
          <details className="rs-menu">
            <summary className="rs-navlink">Languages</summary>
            <div className="rs-menu-panel">
              {LANGUAGES.map((l) => (
                <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}>
                  {l.label} analyzer
                </a>
              ))}
            </div>
          </details>
          <WindowList />
        </nav>

        <div className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex" role="toolbar" aria-label="Open windows">
          {live.map((w) => (
            <Chip key={w.spec.id} w={w} focused={w.spec.id === focusedId} />
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <Clock />
          <AuthMenu />
          {/* Wrapper hides it on phones: the unlayered .rs-btn display rule would beat a `hidden` utility on the link itself. */}
          <span className="hidden sm:inline-block">
            <a href="/#analyze" className="rs-btn !py-1">
              Analyze a repo
            </a>
          </span>
          <button
            type="button"
            className="rounded-md border border-line bg-paper p-1.5 lg:hidden"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
            aria-controls="site-nav"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="3" y1="7" x2="21" y2="7" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="17" x2="21" y2="17" />
            </svg>
          </button>
          <button type="button" className="rs-showdesk" aria-label="Show desktop" title="Show desktop (Shift + D)" onClick={d.showDesktop} />
        </div>
      </div>

      {startOpen ? <StartMenu onClose={() => setStartOpen(false)} /> : null}
    </header>
  );
}
