import { useEffect, useRef, type ReactNode } from "react";

/**
 * Desktop icons for the home page. Original glyphs (simple 24px strokes), no
 * third-party artwork. Everything is plain links / <details>, so the prerendered
 * HTML is complete and works without JavaScript.
 */

export type Tone = "red" | "yellow" | "blue" | "green" | "ink";

const TONES: Record<Tone, string> = {
  red: "bg-[#ffe6d9] border-[#f4b99c]",
  yellow: "bg-[#ffe3a3] border-[#e9b94e]",
  blue: "bg-[#dbe6ff] border-[#a9c0f5]",
  green: "bg-[#d8f3e2] border-[#9ed8b4]",
  ink: "bg-chrome border-line",
};

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="26"
      height="26"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const GLYPHS = {
  scan: (
    <Glyph>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="m10 9-2.5 3L10 15M14 9l2.5 3L14 15" />
    </Glyph>
  ),
  report: (
    <Glyph>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 17v-3M12 17v-6M15 17v-4" />
    </Glyph>
  ),
  folder: (
    <Glyph>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Glyph>
  ),
  shield: (
    <Glyph>
      <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </Glyph>
  ),
  book: (
    <Glyph>
      <path d="M5 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5zM19 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z" />
    </Glyph>
  ),
  info: (
    <Glyph>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </Glyph>
  ),
  mail: (
    <Glyph>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </Glyph>
  ),
  lock: (
    <Glyph>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Glyph>
  ),
  terms: (
    <Glyph>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h7M9 17h5" />
    </Glyph>
  ),
  coffee: (
    <Glyph>
      <path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v2M12 3v2" />
    </Glyph>
  ),
} as const;

export type GlyphName = keyof typeof GLYPHS;

const TILE =
  "grid h-14 w-14 place-items-center rounded-2xl border text-ink shadow-soft-sm transition-transform group-hover:-translate-y-0.5 group-hover:shadow-soft group-focus-visible:-translate-y-0.5";
const LABEL =
  "mt-1.5 block max-w-[5.5rem] text-center text-[0.72rem] font-medium leading-tight text-ink group-hover:underline";

export function DesktopIcon({
  href,
  label,
  glyph,
  tone,
  external,
}: {
  href: string;
  label: string;
  glyph: GlyphName;
  tone: Tone;
  external?: boolean;
}) {
  return (
    <li className="flex justify-center">
      <a
        href={href}
        className="group flex w-20 flex-col items-center rounded-xl p-1 no-underline hover:bg-white/60"
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        <span className={`${TILE} ${TONES[tone]}`}>{GLYPHS[glyph]}</span>
        <span className={LABEL}>{label}</span>
      </a>
    </li>
  );
}

export interface FolderLink {
  href: string;
  label: string;
}

/** A folder icon that opens a small window of links. Works without JS (<details>); JS adds click-outside + Esc to close. */
export function DesktopFolder({
  label,
  tone,
  title,
  links,
  side = "right",
}: {
  label: string;
  tone: Tone;
  title: string;
  links: FolderLink[];
  side?: "left" | "right";
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const close = () => el.removeAttribute("open");
    const onDown = (e: MouseEvent) => {
      if (el.open && !el.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const pos =
    side === "right" ? "lg:left-full lg:ml-2 lg:top-0" : "lg:right-full lg:mr-2 lg:top-0";

  return (
    <li className="relative flex justify-center">
      <details ref={ref} className="rs-folder">
        <summary className="group flex w-20 cursor-pointer list-none flex-col items-center rounded-xl p-1 hover:bg-white/60">
          <span className={`${TILE} ${TONES[tone]}`}>{GLYPHS.folder}</span>
          <span className={LABEL}>{label}</span>
        </summary>
        <div
          className={`z-50 overflow-hidden rounded-xl border border-line bg-paper shadow-soft-lg max-lg:fixed max-lg:inset-x-4 max-lg:top-24 lg:absolute lg:w-64 ${pos}`}
        >
          <div className="flex items-center gap-2 border-b border-line bg-chrome px-3 py-1.5 text-sm font-semibold">
            <span className="h-2.5 w-2.5 rounded-full bg-signal" aria-hidden="true" />
            {title}
          </div>
          <ul className="grid gap-0.5 p-1.5">
            {links.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="block rounded-md px-2.5 py-1.5 text-sm hover:bg-chrome">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </li>
  );
}
