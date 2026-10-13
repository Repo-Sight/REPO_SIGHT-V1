import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MenuItem } from "../lib/desktopContext";

/** Right-click menu. Closes on outside click, Escape, scroll, resize or after an item runs. Arrow keys move, Enter runs. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
    el.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [])];
      if (btns.length === 0) return;
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
      btns[next].focus();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    document.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
      document.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  return (
    <div ref={ref} role="menu" className="rs-ctxmenu rs-pop" style={{ left: pos.left, top: pos.top }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          disabled={it.disabled}
          data-danger={it.danger ? "true" : undefined}
          onClick={() => {
            onClose();
            it.onSelect();
          }}
        >
          <span>{it.label}</span>
          {it.hint ? <kbd>{it.hint}</kbd> : null}
        </button>
      ))}
    </div>
  );
}
