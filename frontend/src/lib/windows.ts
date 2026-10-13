import type { AppKind, AppSpec } from "./apps";

/** Pure window-manager state: no DOM, no React. Geometry is in desktop-layer pixels. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Win {
  spec: AppSpec;
  /** null = the CSS default geometry (what the prerendered HTML uses). Set once a window is moved, resized, cascaded or tiled. */
  rect: Rect | null;
  max: boolean;
  min: boolean;
  /** Stacking order; the highest non-minimised window is the focused one. */
  z: number;
  opening: boolean;
  closing: boolean;
}

export interface DesktopState {
  wins: Win[];
  z: number;
  /** False until the first client-side sync with the real URL (the first render must equal the prerendered HTML). */
  ready: boolean;
  /** Windows hidden by "Show desktop", so a second press brings the same ones back. */
  stash: string[];
}

export type Action =
  | { type: "hydrate"; spec: AppSpec }
  | { type: "activate"; spec: AppSpec; rect: Rect | null; animate: boolean }
  | { type: "focus"; id: string }
  | { type: "minimize"; id: string }
  | { type: "toggleMax"; id: string }
  | { type: "setMax"; id: string; max: boolean }
  | { type: "setRect"; id: string; rect: Rect }
  | { type: "close"; id: string }
  | { type: "closeAll" }
  | { type: "remove"; id: string }
  | { type: "opened"; id: string }
  | { type: "showDesktop" }
  | { type: "arrange"; rects: Record<string, Rect> }
  /** Re-clamp rectangles after the desktop resized. Never changes maximised / minimised state. */
  | { type: "fit"; rects: Record<string, Rect> };

export const MIN_W = 340;
export const MIN_H = 220;
export const OPEN_MS = 200;
export const CLOSE_MS = 150;

const newWin = (spec: AppSpec, z: number, rect: Rect | null, animate: boolean): Win => ({
  spec,
  rect,
  max: false,
  min: false,
  z,
  opening: animate,
  closing: false,
});

export function initialState(spec: AppSpec): DesktopState {
  return { wins: [newWin(spec, 1, null, false)], z: 1, ready: false, stash: [] };
}

/** The focused window: the topmost one that is neither minimised nor closing. */
export function topWin(wins: Win[]): Win | null {
  let top: Win | null = null;
  for (const w of wins) {
    if (w.min || w.closing) continue;
    if (!top || w.z > top.z) top = w;
  }
  return top;
}

const patch = (s: DesktopState, id: string, f: (w: Win) => Win): Win[] => s.wins.map((w) => (w.spec.id === id ? f(w) : w));

export function reducer(s: DesktopState, a: Action): DesktopState {
  switch (a.type) {
    case "hydrate": {
      // First client sync: the prerendered window may not be the one the URL asks for (?scan=, ?demo=). Swap it silently.
      if (s.ready && s.wins.length > 0) return s;
      const same = s.wins.length === 1 && s.wins[0].spec.id === a.spec.id;
      return { ...s, ready: true, wins: same ? s.wins : [newWin(a.spec, 1, null, false)], z: 1 };
    }
    case "activate": {
      const existing = s.wins.find((w) => w.spec.id === a.spec.id);
      const z = s.z + 1;
      if (existing) {
        return { ...s, z, wins: patch(s, a.spec.id, (w) => ({ ...w, z, min: false, closing: false })) };
      }
      return { ...s, z, wins: [...s.wins, newWin(a.spec, z, a.rect, a.animate)] };
    }
    case "focus": {
      const top = topWin(s.wins);
      if (top?.spec.id === a.id) return s;
      const z = s.z + 1;
      return { ...s, z, wins: patch(s, a.id, (w) => ({ ...w, z })) };
    }
    case "minimize":
      return { ...s, wins: patch(s, a.id, (w) => ({ ...w, min: true })) };
    case "toggleMax":
      return { ...s, wins: patch(s, a.id, (w) => ({ ...w, max: !w.max })) };
    case "setMax":
      return { ...s, wins: patch(s, a.id, (w) => ({ ...w, max: a.max })) };
    case "setRect":
      return { ...s, wins: patch(s, a.id, (w) => ({ ...w, rect: a.rect, max: false })) };
    case "close":
      return { ...s, wins: patch(s, a.id, (w) => (w.closing ? w : { ...w, closing: true, opening: false })) };
    case "closeAll":
      return { ...s, stash: [], wins: s.wins.map((w) => (w.closing ? w : { ...w, closing: true, opening: false })) };
    case "remove":
      return { ...s, wins: s.wins.filter((w) => w.spec.id !== a.id), stash: s.stash.filter((id) => id !== a.id) };
    case "opened":
      return { ...s, wins: patch(s, a.id, (w) => (w.opening ? { ...w, opening: false } : w)) };
    case "showDesktop": {
      const visible = s.wins.filter((w) => !w.min && !w.closing);
      if (visible.length > 0) {
        const ids = visible.map((w) => w.spec.id);
        return { ...s, stash: ids, wins: s.wins.map((w) => (ids.includes(w.spec.id) ? { ...w, min: true } : w)) };
      }
      // Everything already hidden: bring back what "Show desktop" hid, keeping its stacking order.
      const back = s.wins.filter((w) => s.stash.includes(w.spec.id) && !w.closing).sort((p, q) => p.z - q.z);
      if (back.length === 0) return s;
      let z = s.z;
      const zs = new Map(back.map((w) => [w.spec.id, ++z]));
      return { ...s, z, stash: [], wins: s.wins.map((w) => (zs.has(w.spec.id) ? { ...w, min: false, z: zs.get(w.spec.id)! } : w)) };
    }
    case "arrange":
      return {
        ...s,
        wins: s.wins.map((w) => {
          const r = a.rects[w.spec.id];
          return r ? { ...w, rect: r, max: false } : w;
        }),
      };
    case "fit":
      return { ...s, wins: s.wins.map((w) => (a.rects[w.spec.id] ? { ...w, rect: a.rects[w.spec.id] } : w)) };
  }
}

/* ------------------------------- geometry -------------------------------- */

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Mirrors the CSS default geometry (index.css, .rs-win) so JS-opened windows look like the first one. */
export function defaultRect(kind: AppKind, W: number, H: number): Rect {
  if (kind === "card") return { x: Math.max(0, W - 142 - 304), y: 20, w: 304, h: 316 };
  if ((kind === "home" || kind === "page") && W >= 1100) {
    return { x: 118, y: 12, w: Math.round(clamp(W * 0.42, 520, 640)), h: Math.max(MIN_H, H - 24) };
  }
  const w = Math.round(kind === "report" || kind === "demo" ? Math.min(W * 0.8, 1200) : W * 0.8);
  return { x: Math.round((W - w) / 2), y: Math.round(H * 0.025), w, h: Math.round(H * 0.95) };
}

/** A new window starts at its default spot, nudged down-right per window already open (wraps after 6). */
export function cascadeRect(kind: AppKind, openCount: number, W: number, H: number): Rect {
  const base = defaultRect(kind, W, H);
  if (kind === "card") return base;
  const step = 28 * (openCount % 6);
  const w = Math.min(base.w, W);
  const h = Math.min(base.h, H);
  return { x: clamp(base.x + step, 0, W - w), y: clamp(base.y + step, 0, H - h), w, h };
}

/** Keep a window inside the desktop (used when the desktop shrinks). Title bar always stays reachable. */
export function clampRect(r: Rect, W: number, H: number): Rect {
  const w = clamp(r.w, Math.min(MIN_W, W), W);
  const h = clamp(r.h, Math.min(MIN_H, H), H);
  return { x: clamp(r.x, 0, W - w), y: clamp(r.y, 0, H - h), w, h };
}

/** Overlapping windows stepped down-right, oldest at the back. */
export function cascadeAll(ids: { id: string; kind: AppKind }[], W: number, H: number): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  ids.forEach(({ id, kind }, i) => {
    out[id] = cascadeRect(kind === "card" ? "page" : kind, i, W, H);
  });
  return out;
}

/** Non-overlapping grid, 6px gutters. */
export function tileAll(ids: string[], W: number, H: number): Record<string, Rect> {
  const n = ids.length;
  const out: Record<string, Rect> = {};
  if (n === 0) return out;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const g = 6;
  const cw = (W - g * (cols + 1)) / cols;
  const ch = (H - g * (rows + 1)) / rows;
  ids.forEach((id, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out[id] = { x: Math.round(g + c * (cw + g)), y: Math.round(g + r * (ch + g)), w: Math.round(cw), h: Math.round(ch) };
  });
  return out;
}

/** Edge-snap target for a drag that ends with the pointer at (px, py) inside a W x H desktop. */
export type Snap = { kind: "max" } | { kind: "rect"; rect: Rect };
export function snapTarget(px: number, py: number, W: number, H: number): Snap | null {
  const edge = 6;
  if (py <= edge) return { kind: "max" };
  if (px <= edge) return { kind: "rect", rect: { x: 0, y: 0, w: Math.round(W / 2), h: H } };
  if (px >= W - edge) return { kind: "rect", rect: { x: Math.round(W / 2), y: 0, w: Math.round(W / 2), h: H } };
  return null;
}
