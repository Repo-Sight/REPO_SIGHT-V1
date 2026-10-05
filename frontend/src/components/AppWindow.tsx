import type { ReactNode, Ref } from "react";

export type WindowPhase = "idle" | "in" | "out";

interface AppWindowProps {
  title: string;
  expanded: boolean;
  phase: WindowPhase;
  /** Capped at 1200px wide when windowed (the home page only). */
  wide?: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  scrollerRef: Ref<HTMLDivElement>;
  children: ReactNode;
}

const BTN =
  "grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-line-soft hover:text-ink focus-visible:text-ink";

/**
 * The one desktop window. Behaviour follows posthog.com's window manager:
 * 80% x 95% centred, expand/restore, close with an exit animation, forced
 * full-size under 768px (no expand button there). Geometry and animation live in
 * index.css (.rs-win). There is no drag or resize, same as PostHog.
 *
 * The prerendered HTML is always the open, windowed, idle state, so crawlers and
 * the first hydrated render see the full content.
 */
export function AppWindow({ title, expanded, phase, wide, onToggleExpand, onClose, scrollerRef, children }: AppWindowProps) {
  return (
    <section
      className="rs-win"
      aria-label={title}
      data-app="AppWindow"
      data-focused="true"
      data-expanded={expanded}
      data-wide={wide ? "true" : "false"}
      data-phase={phase}
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-chrome px-3 py-1.5 select-none">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-signal" aria-hidden="true" />
          <span className="truncate">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`${BTN} max-md:hidden`}
            onClick={onToggleExpand}
            aria-label={expanded ? "Restore window" : "Expand window"}
            title={`${expanded ? "Restore window" : "Expand window"} (Shift + Up)`}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {expanded ? (
                <path d="M2.5 6.5h4v-4M13.5 9.5h-4v4M6.5 6.5l-4-4M9.5 9.5l4 4" />
              ) : (
                <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
              )}
            </svg>
          </button>
          <button type="button" className={BTN} onClick={onClose} aria-label="Close window" title="Close window (Shift + W)">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="m3.5 3.5 9 9m0-9-9 9" />
            </svg>
          </button>
        </div>
      </div>
      <div ref={scrollerRef} className="rs-win-body min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </div>
    </section>
  );
}
