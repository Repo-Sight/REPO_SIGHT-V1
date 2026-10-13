import { createContext, useContext, type RefObject } from "react";
import type { Rect, Win } from "./windows";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Keyboard hint shown on the right. */
  hint?: string;
}

/**
 * Window-manager commands. The object only changes when `mobile` flips, so
 * memoised windows that use it do not re-render when other windows move.
 */
export interface DesktopActions {
  /** < 768px: every window is forced full-size and there is no dragging or maximise. */
  mobile: boolean;
  /** Open (or focus / restore) the window for an in-site href, and move the address bar to it. */
  open: (href: string) => void;
  focus: (id: string) => void;
  /** Taskbar behaviour: restore if minimised, minimise if it is already the focused one, otherwise focus. */
  toggleFromTaskbar: (id: string) => void;
  minimize: (id: string) => void;
  toggleMax: (id: string) => void;
  close: (id: string) => void;
  closeAll: () => void;
  showDesktop: () => void;
  /** Reopen the floating score card (the bare-desktop widget). */
  openCard: () => void;
  cascade: () => void;
  tile: () => void;
  setRect: (id: string, rect: Rect) => void;
  setMax: (id: string, max: boolean) => void;
  opened: (id: string) => void;
  setSnap: (r: Rect | null) => void;
  showMenu: (x: number, y: number, items: MenuItem[]) => void;
  layerRef: RefObject<HTMLDivElement | null>;
}

/** What the taskbar and start menu render from. Changes whenever any window changes. */
export interface DesktopView {
  wins: Win[];
  focusedId: string | null;
  snap: Rect | null;
}

export const DesktopActionsContext = createContext<DesktopActions | null>(null);
export const DesktopViewContext = createContext<DesktopView | null>(null);

export function useDesktop(): DesktopActions {
  const ctx = useContext(DesktopActionsContext);
  if (!ctx) throw new Error("useDesktop must be used inside SiteLayout");
  return ctx;
}

export function useDesktopView(): DesktopView {
  const ctx = useContext(DesktopViewContext);
  if (!ctx) throw new Error("useDesktopView must be used inside SiteLayout");
  return ctx;
}
