import type { KeyboardEvent, ReactNode, Ref } from "react";
import { GLYPHS, type GlyphName } from "./DesktopIcons";

interface DialogWindowProps {
  /** File-style title shown in the title bar, like every other window ("sign-in.dlg"). */
  title: string;
  icon: GlyphName;
  role?: "dialog" | "alertdialog";
  /** id of the visible heading inside the body (the title bar text is decorative). */
  labelledBy: string;
  describedBy?: string;
  closing: boolean;
  /** Sits above the account dialog when true (Sign out can be pressed from inside it). */
  top?: boolean;
  panelRef: Ref<HTMLDivElement>;
  /** Backdrop click and the title-bar close control. */
  onDismiss: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  closeDisabled?: boolean;
  closeLabel?: string;
  /** Max width of the window. */
  size?: "sm" | "md";
  children: ReactNode;
}

/**
 * The modal dialog shell: same window chrome as every page window (title bar, app glyph,
 * control button, rounded frame), minus the controls a dialog cannot have. A modal has
 * nothing to minimise or maximise, so only Close is offered. Focus handling, Escape and
 * the exit animation stay with the caller, which owns the dialog's state.
 */
export function DialogWindow({
  title,
  icon,
  role = "dialog",
  labelledBy,
  describedBy,
  closing,
  top = false,
  panelRef,
  onDismiss,
  onKeyDown,
  closeDisabled = false,
  closeLabel = "Close dialog",
  size = "md",
  children,
}: DialogWindowProps) {
  return (
    <div
      className={`rs-overlay fixed inset-0 ${top ? "z-[60]" : "z-50"} flex items-start justify-center overflow-y-auto bg-black/50 p-2 pt-12 sm:pt-20`}
      data-closing={closing}
      onMouseDown={(e) => e.target === e.currentTarget && onDismiss()}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        data-closing={closing}
        data-app="DialogWindow"
        className={`rs-modal rs-dialog w-full ${size === "sm" ? "max-w-sm" : "max-w-md"}`}
      >
        <div className="rs-titlebar">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold" aria-hidden="true">
            <span className="rs-title-icon inline-grid shrink-0 place-items-center [&_svg]:h-4 [&_svg]:w-4">{GLYPHS[icon]}</span>
            <span className="truncate">{title}</span>
          </div>
          <div className="rs-ctrls" role="group" aria-label="Dialog controls">
            <button
              type="button"
              className="rs-ctl rs-ctl-close"
              onClick={onDismiss}
              disabled={closeDisabled}
              aria-label={closeLabel}
              title="Close (Esc)"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="m3.5 3.5 9 9m0-9-9 9" />
              </svg>
            </button>
          </div>
        </div>
        <div className="rs-dialog-body">{children}</div>
      </div>
    </div>
  );
}
