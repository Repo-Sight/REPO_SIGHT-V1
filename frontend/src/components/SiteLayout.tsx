import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type MouseEvent } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { CARD_APP, resolveApp, resolveHref, type AppSpec } from "../lib/apps";
import {
  DesktopActionsContext,
  DesktopViewContext,
  type DesktopActions,
  type DesktopView,
  type MenuItem,
} from "../lib/desktopContext";
import {
  CLOSE_MS,
  cascadeAll,
  cascadeRect,
  clampRect,
  defaultRect,
  initialState,
  reducer,
  tileAll,
  topWin,
  type Rect,
} from "../lib/windows";
import { AuthProvider } from "./AuthProvider";
import { ConsentAndCta } from "./ConsentAndCta";
import { ContextMenu } from "./ContextMenu";
import { Desktop } from "./DesktopIcons";
import { Taskbar } from "./Taskbar";
import { Wallpaper } from "./Wallpaper";
import { WindowFrame } from "./WindowFrame";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;

/**
 * The desktop. A small window manager: every page is an app that opens in its own
 * window (drag, resize, minimise, maximise, close, snap), with a taskbar, a start
 * menu and right-click menus around it.
 *
 * Routing still owns the URL. The address bar always shows the focused window's
 * page, opening a link opens (or focuses) that page's window, and back/forward
 * move between them. The first render is always "the window for this URL, open,
 * default size, idle", which is exactly what is prerendered into each static page.
 */
export function SiteLayout() {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();

  // First render (= the prerendered HTML) never sees the real query string.
  const [state, dispatch] = useReducer(reducer, resolveApp(pathname, ""), initialState);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [snap, setSnap] = useState<Rect | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const layerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  /** A hash to scroll to inside a window once that window is in the DOM. */
  const pendingScroll = useRef<{ id: string; hash: string } | null>(null);
  /** A location we navigated to ourselves (e.g. "/" after the last window closed): the URL sync must not reopen a window for it. */
  const skipSync = useRef<string | null>(null);
  /** The window id `open()` just pushed a URL for. The router applies a navigation asynchronously, so until it lands the
   *  focus -> address-bar effect must not "correct" the old URL (that would replace the entry that was just pushed). */
  const pendingNav = useRef<string | null>(null);
  const closing = useRef(new Set<string>());

  const focused = topWin(state.wins);
  const focusedId = focused?.spec.id ?? null;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  /* ------------------------------ commands ------------------------------ */

  const actions = useMemo<DesktopActions>(() => {
    const size = () => {
      const r = layerRef.current?.getBoundingClientRect();
      return { W: r?.width ?? 1200, H: r?.height ?? 700 };
    };
    const live = () => stateRef.current.wins.filter((w) => !w.closing);

    const activate = (spec: AppSpec, animate = true) => {
      const exists = stateRef.current.wins.some((w) => w.spec.id === spec.id);
      let rect: Rect | null = null;
      if (!exists) {
        const { W, H } = size();
        rect = cascadeRect(spec.kind, live().length, W, H);
      }
      dispatch({ type: "activate", spec, rect, animate: animate && !reducedMotion() });
    };

    const a: DesktopActions = {
      mobile,
      layerRef,
      open: (href) => {
        const r = resolveHref(href, window.location.href);
        if (!r) {
          window.location.assign(href);
          return;
        }
        activate(r.app);
        if (r.hash) pendingScroll.current = { id: r.app.id, hash: r.hash };
        const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        const there = `${r.url.pathname}${r.url.search}${r.url.hash}`;
        if (here !== there) {
          pendingNav.current = r.app.id;
          navigateRef.current({ pathname: r.url.pathname, search: r.url.search, hash: r.url.hash });
        }
      },
      openCard: () => activate(CARD_APP),
      focus: (id) => dispatch({ type: "focus", id }),
      toggleFromTaskbar: (id) => {
        const w = stateRef.current.wins.find((x) => x.spec.id === id);
        if (!w) return;
        if (w.min) dispatch({ type: "activate", spec: w.spec, rect: null, animate: false });
        else if (topWin(stateRef.current.wins)?.spec.id === id) dispatch({ type: "minimize", id });
        else dispatch({ type: "focus", id });
      },
      minimize: (id) => dispatch({ type: "minimize", id }),
      toggleMax: (id) => dispatch({ type: "toggleMax", id }),
      setMax: (id, max) => dispatch({ type: "setMax", id, max }),
      close: (id) => dispatch({ type: "close", id }),
      closeAll: () => dispatch({ type: "closeAll" }),
      showDesktop: () => dispatch({ type: "showDesktop" }),
      cascade: () => {
        const { W, H } = size();
        const ws = live()
          .filter((w) => !w.min && w.spec.kind !== "card")
          .sort((p, q) => p.z - q.z);
        dispatch({ type: "arrange", rects: cascadeAll(ws.map((w) => ({ id: w.spec.id, kind: w.spec.kind })), W, H) });
      },
      tile: () => {
        const { W, H } = size();
        const ws = live().filter((w) => !w.min).sort((p, q) => p.z - q.z);
        dispatch({ type: "arrange", rects: tileAll(ws.map((w) => w.spec.id), W, H) });
      },
      setRect: (id, rect) => dispatch({ type: "setRect", id, rect }),
      opened: (id) => dispatch({ type: "opened", id }),
      setSnap,
      showMenu: (x, y, items) => setMenu({ x, y, items }),
    };
    return a;
  }, [mobile]);

  /* ----------------------- URL <-> windows, both ways ----------------------- */

  // Location -> windows. First run swaps the prerendered window for the one the real URL asks for; later runs
  // (links, back/forward, the scanner navigating to ?scan=) open or focus that page's window.
  useEffect(() => {
    const spec = resolveApp(pathname, search);
    pendingNav.current = null;
    if (hash) pendingScroll.current = { id: spec.id, hash };
    if (!stateRef.current.ready) {
      dispatch({ type: "hydrate", spec });
      // The floating score card joins the bare home desktop on wide screens, behind the home window.
      if (spec.kind === "home" && window.matchMedia("(min-width: 1280px)").matches) {
        const el = layerRef.current;
        const W = el?.clientWidth ?? 1280;
        const H = el?.clientHeight ?? 700;
        dispatch({ type: "activate", spec: CARD_APP, rect: defaultRect("card", W, H), animate: !reducedMotion() });
        dispatch({ type: "activate", spec, rect: null, animate: false });
      }
      return;
    }
    const key = `${pathname}${search}`;
    if (skipSync.current === key) {
      skipSync.current = null;
      return;
    }
    actions.open(`${pathname}${search}${hash}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search, hash]);

  // Focus -> address bar. The URL always shows the focused window's page; with no windows left it goes back to "/".
  useEffect(() => {
    if (!state.ready) return;
    const here = resolveApp(window.location.pathname, window.location.search);
    if (focusedId === null) {
      if (state.wins.length === 0 && (window.location.pathname !== "/" || window.location.search !== "")) {
        skipSync.current = "/";
        navigateRef.current("/", { replace: true });
      }
      return;
    }
    const w = state.wins.find((x) => x.spec.id === focusedId);
    if (!w || w.spec.kind === "card") return;
    if (pendingNav.current === focusedId) return;
    if (here.id !== focusedId) {
      skipSync.current = w.spec.url;
      navigateRef.current(w.spec.url, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, state.ready, state.wins.length]);

  // Scroll to a #hash inside the window that owns it, once that window is rendered.
  useEffect(() => {
    const p = pendingScroll.current;
    if (!p) return;
    const win = [...document.querySelectorAll<HTMLElement>("[data-win]")].find((el) => el.dataset.win === p.id);
    if (!win) return;
    pendingScroll.current = null;
    const id = decodeURIComponent(p.hash.slice(1));
    if (!id) return;
    const target = [...win.querySelectorAll<HTMLElement>("[id]")].find((el) => el.id === id);
    target?.scrollIntoView();
  }, [state.wins, hash]);

  // Closing windows play their exit animation, then leave the list.
  useEffect(() => {
    for (const w of state.wins) {
      if (!w.closing || closing.current.has(w.spec.id)) continue;
      const id = w.spec.id;
      closing.current.add(id);
      window.setTimeout(() => {
        closing.current.delete(id);
        dispatch({ type: "remove", id });
      }, reducedMotion() ? 0 : CLOSE_MS);
    }
  }, [state.wins]);

  // Keep dragged / tiled windows inside the desktop when it shrinks.
  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      const rects: Record<string, Rect> = {};
      for (const w of stateRef.current.wins) {
        if (!w.rect) continue;
        const c = clampRect(w.rect, W, H);
        if (c.x !== w.rect.x || c.y !== w.rect.y || c.w !== w.rect.w || c.h !== w.rect.h) rects[w.spec.id] = c;
      }
      if (Object.keys(rects).length > 0) dispatch({ type: "fit", rects });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ------------------------------- keyboard ------------------------------- */

  // Shift+Up maximise/restore, Shift+Down minimise, Shift+W close, Shift+X close all, Shift+D show desktop,
  // Shift+Left/Right switch windows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || TYPING.test(t.tagName))) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const top = topWin(stateRef.current.wins);
      if (e.key === "ArrowUp" && top) {
        e.preventDefault();
        if (!mobile) actions.toggleMax(top.spec.id);
      } else if (e.key === "ArrowDown" && top) {
        e.preventDefault();
        actions.minimize(top.spec.id);
      } else if (e.key === "W" && top) {
        e.preventDefault();
        actions.close(top.spec.id);
      } else if (e.key === "X") {
        e.preventDefault();
        actions.closeAll();
      } else if (e.key === "D") {
        e.preventDefault();
        actions.showDesktop();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const order = stateRef.current.wins.filter((w) => !w.closing);
        if (order.length < 2) return;
        e.preventDefault();
        const i = order.findIndex((w) => w.spec.id === top?.spec.id);
        const next = order[(i + (e.key === "ArrowRight" ? 1 : -1) + order.length) % order.length];
        actions.toggleFromTaskbar(next.spec.id);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [actions, mobile]);

  /* ------------------------------- pointer -------------------------------- */

  // Same-site page links open (or focus) that page's window instead of reloading.
  const onLinkClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      if (!resolveHref(a.href, window.location.href)) return;
      e.preventDefault();
      setMenuOpen(false);
      actions.open(a.href);
    },
    [actions],
  );

  const onDesktopContext = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest(".rs-win, a, summary, button, input")) return;
    e.preventDefault();
    const any = state.wins.some((w) => !w.closing);
    actions.showMenu(e.clientX, e.clientY, [
      { label: "Show desktop", hint: "Shift+D", disabled: !any && state.stash.length === 0, onSelect: actions.showDesktop },
      { label: "Cascade windows", disabled: !any || mobile, onSelect: actions.cascade },
      { label: "Tile windows", disabled: !any || mobile, onSelect: actions.tile },
      { label: "Open home", onSelect: () => actions.open("/") },
      { label: "Open score card", onSelect: actions.openCard },
      { label: "Close all windows", hint: "Shift+X", danger: true, disabled: !any, onSelect: actions.closeAll },
    ]);
  };

  const view = useMemo<DesktopView>(() => ({ wins: state.wins, focusedId, snap }), [state.wins, focusedId, snap]);
  const visible = state.wins.filter((w) => !w.min && !w.closing);
  const covered = visible.some((w) => w.max) || (mobile && visible.length > 0);
  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <AuthProvider>
      <DesktopActionsContext value={actions}>
        <DesktopViewContext value={view}>
          <div id="app-container" className="flex h-dvh flex-col p-2" onClick={onLinkClick}>
            <a href="#main" className="rs-skip">
              Skip to content
            </a>

            {/* Route elements only render this URL's <head> (title, meta, JSON-LD); pages render inside windows. */}
            <Outlet />

            <Taskbar menuOpen={menuOpen} setMenuOpen={setMenuOpen} />

            {/* Desktop viewport: icons underneath, the window layer on top, everything clipped to this box. */}
            <div className="relative min-h-0 flex-1 overflow-clip" onContextMenu={onDesktopContext}>
              <Wallpaper />
              <Desktop covered={covered} />
              <div ref={layerRef} data-app="WindowList" className="pointer-events-none absolute inset-0 z-10">
                {state.wins.map((w) => (
                  <WindowFrame key={w.spec.id} win={w} focused={w.spec.id === focusedId} />
                ))}
                {snap ? (
                  <div
                    className="rs-snap"
                    aria-hidden="true"
                    style={{ left: snap.x + 6, top: snap.y + 6, width: Math.max(0, snap.w - 12), height: Math.max(0, snap.h - 12) }}
                  />
                ) : null}
              </div>
            </div>
            <ConsentAndCta />
            {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} /> : null}
          </div>
        </DesktopViewContext>
      </DesktopActionsContext>
    </AuthProvider>
  );
}
