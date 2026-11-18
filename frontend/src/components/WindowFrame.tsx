import { memo, useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useDesktop } from "../lib/desktopContext";
import { MIN_H, MIN_W, OPEN_MS, defaultRect, snapTarget, type Rect, type Win } from "../lib/windows";
import { AppIcon } from "./AppIcon";
import { WindowContent } from "./WindowContent";

type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const DIRS: Dir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

interface Props {
  win: Win;
  focused: boolean;
}

/**
 * One OS window. Every window has the same three controls (minimise, maximise /
 * restore, close) in every state, plus: drag by the title bar, resize from any
 * edge or corner, double-click the title bar to maximise, drag to a screen edge
 * to snap, click anywhere to focus. Under 768px windows are forced full-size, so
 * there is no drag, resize or maximise there, but minimise and close stay.
 *
 * Drag and resize write CSS variables straight to the element while the pointer
 * moves (so a heavy report body never re-renders mid-drag) and commit the final
 * rectangle to the window manager once on release.
 */
function WindowFrameImpl({ win, focused }: Props) {
  const d = useDesktop();
  const ref = useRef<HTMLElement>(null);
  const { spec } = win;
  const id = spec.id;

  // Open animation: play once, then settle to idle.
  useEffect(() => {
    if (!win.opening) return;
    const t = window.setTimeout(() => d.opened(id), reducedMotion() ? 0 : OPEN_MS);
    return () => window.clearTimeout(t);
  }, [win.opening, id, d]);

  const begin = (e: ReactPointerEvent, mode: "move" | Dir) => {
    if (e.button !== 0 || d.mobile) return;
    const el = ref.current;
    const layer = d.layerRef.current;
    if (!el || !layer) return;
    if (mode === "move" && (e.target as HTMLElement).closest("button")) return;
    if (mode !== "move") e.stopPropagation();

    const lb = layer.getBoundingClientRect();
    const W = lb.width;
    const H = lb.height;
    const wasMax = win.max;
    let start: Rect = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    let last: Rect = start;
    let snapKey = "";
    let snapNow: ReturnType<typeof snapTarget> = null;

    const show = (r: Rect) => {
      el.dataset.geo = "custom";
      el.style.setProperty("--x", `${r.x}px`);
      el.style.setProperty("--y", `${r.y}px`);
      el.style.setProperty("--w", `${r.w}px`);
      el.style.setProperty("--h", `${r.h}px`);
    };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved) {
        if (Math.abs(dx) + Math.abs(dy) < 4) return;
        moved = true;
        el.dataset.dragging = "true";
        document.body.style.userSelect = "none";
        if (mode === "move" && wasMax) {
          // Dragging a maximised window out of maximise: restore its size under the pointer, like a real OS.
          const base = win.rect ?? defaultRect(spec.kind, W, H);
          const ratio = clamp((sx - lb.left) / W, 0, 1);
          start = { x: sx - lb.left - base.w * ratio, y: 0, w: base.w, h: base.h };
          el.dataset.max = "false";
        }
      }
      let r: Rect;
      if (mode === "move") {
        r = {
          x: clamp(start.x + dx, -(start.w - 96), W - 96),
          y: clamp(start.y + dy, 0, H - 36),
          w: start.w,
          h: start.h,
        };
        const px = ev.clientX - lb.left;
        const py = ev.clientY - lb.top;
        snapNow = snapTarget(px, py, W, H);
        const key = snapNow ? (snapNow.kind === "max" ? "max" : `${snapNow.rect.x}`) : "";
        if (key !== snapKey) {
          snapKey = key;
          d.setSnap(snapNow ? (snapNow.kind === "max" ? { x: 0, y: 0, w: W, h: H } : snapNow.rect) : null);
        }
      } else {
        let { x, y, w, h } = start;
        if (mode.includes("e")) w = clamp(start.w + dx, MIN_W, W - start.x);
        if (mode.includes("s")) h = clamp(start.h + dy, MIN_H, H - start.y);
        if (mode.includes("w")) {
          const nx = clamp(start.x + dx, 0, start.x + start.w - MIN_W);
          w = start.w + (start.x - nx);
          x = nx;
        }
        if (mode.includes("n")) {
          const ny = clamp(start.y + dy, 0, start.y + start.h - MIN_H);
          h = start.h + (start.y - ny);
          y = ny;
        }
        r = { x, y, w, h };
      }
      last = r;
      show(r);
    };

    const end = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      document.body.style.userSelect = "";
      delete el.dataset.dragging;
      d.setSnap(null);
      if (!moved) return;
      if (mode === "move" && snapNow) {
        if (snapNow.kind === "max") {
          d.setRect(id, last);
          d.setMax(id, true);
        } else {
          d.setRect(id, snapNow.rect);
        }
        return;
      }
      d.setRect(id, last);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
  };

  const style: CSSProperties & Record<string, string | number> = { zIndex: win.z };
  if (win.rect) {
    style["--x"] = `${win.rect.x}px`;
    style["--y"] = `${win.rect.y}px`;
    style["--w"] = `${win.rect.w}px`;
    style["--h"] = `${win.rect.h}px`;
  }

  const phase = win.closing ? "out" : win.opening ? "in" : "idle";

  return (
    <section
      ref={ref}
      className="rs-win"
      aria-label={spec.title}
      data-app="AppWindow"
      data-win={id}
      data-kind={spec.kind}
      data-focused={focused}
      data-max={win.max}
      data-min={win.min}
      data-geo={win.rect ? "custom" : "default"}
      data-phase={phase}
      inert={win.min || win.closing}
      aria-hidden={win.min ? true : undefined}
      style={style}
      onPointerDownCapture={() => d.focus(id)}
    >
      <div
        className="rs-titlebar"
        onPointerDown={(e) => begin(e, "move")}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest("button") || d.mobile) return;
          d.toggleMax(id);
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
          <AppIcon spec={spec} className="rs-title-icon" />
          <span className="truncate">{spec.title}</span>
        </div>
        <div className="rs-ctrls" role="group" aria-label="Window controls">
          <button type="button" className="rs-ctl" onClick={() => d.minimize(id)} aria-label="Minimize window" title="Minimize (Shift + Down)">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M3.5 11.5h9" />
            </svg>
          </button>
          <button
            type="button"
            className="rs-ctl rs-ctl-max"
            onClick={() => d.toggleMax(id)}
            aria-label={win.max ? "Restore window" : "Maximize window"}
            title={win.max ? "Restore (Shift + Up)" : "Maximize (Shift + Up)"}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {win.max ? (
                <>
                  <rect x="2.5" y="5.5" width="8" height="8" rx="1.2" />
                  <path d="M5.5 5.5v-2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2" />
                </>
              ) : (
                <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
              )}
            </svg>
          </button>
          <button type="button" className="rs-ctl rs-ctl-close" onClick={() => d.close(id)} aria-label="Close window" title="Close (Shift + W)">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="m3.5 3.5 9 9m0-9-9 9" />
            </svg>
          </button>
        </div>
      </div>

      <div className="rs-win-body min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <WindowContent spec={spec} focused={focused} />
      </div>

      {win.max || win.min ? null : DIRS.map((dir) => <span key={dir} className="rs-rz" data-dir={dir} onPointerDown={(e) => begin(e, dir)} aria-hidden="true" />)}
    </section>
  );
}

export const WindowFrame = memo(WindowFrameImpl);
