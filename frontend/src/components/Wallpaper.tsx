import { useEffect, useRef, useState } from "react";

/**
 * Desktop wallpaper: an isometric floor of scrolling code and a git graph, with
 * REPO / SIGHT spelled in letter cubes. Decorative only (aria-hidden, no pointer events).
 *
 * Prerender-safe: the static HTML holds just the grid floor and the nine cubes.
 * The code text and git graph are generated after mount, so no large decorative
 * markup is shipped in every prerendered page and hydration always matches.
 * Everything below is deterministic (no Math.random).
 */

const GAP = 134;
const LINES = [
  "#include <cma/metrics.h>",
  "int analyze(const Repo& repo) {",
  "  auto score = grade(repo.files, 82);",
  '  if (score < 60) flag("hotspot");',
  "def cyclomatic(node): return len(node.branches) + 1",
  "for f in repo.files: report.add(f, 'B')",
  "public static int depth(Node n) { return 4; }",
  "git checkout -b feat/js-support",
  'git commit -m "fix: hotspot in parser"',
  "$ cma --json report.json",
  "coverage 92%  complexity 7  grade B",
  "struct Metrics { int loc; int cc; };",
  "# TODO: ship V2",
  "git push origin Version2",
  "// WARN long function parse() 212 lines",
];
const LANE_COLORS = ["#8ea8c4", "#9a94b8", "#8fae96", "#c0a070", "#6fa0b4", "#a8b4c2"];

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const KEYWORDS = /(\/\/.*|# .*)|("[^"]*"|'[^']*')|\b(int|const|return|def|for|if|void|auto|public|static|struct)\b|\b(\d+%?)\b|(\w+)(?=\()/g;
const highlight = (t: string) =>
  esc(t).replace(KEYWORDS, (m, c, s, k, n) => `<i class="${c ? "c" : s ? "s" : k ? "k" : n ? "n" : "f"}">${m}</i>`);

function buildDeco() {
  const half = Array.from({ length: 92 }, (_, r) =>
    Array.from({ length: 5 }, (_, c) => highlight(LINES[(r * 7 + c * 3) % LINES.length].padEnd(46))).join("  "),
  ).join("\n");
  let svg = "";
  LANE_COLORS.forEach((color, i) => {
    const x = 260 + i * 376;
    svg += `<path d="M${x} 0V2400" stroke="${color}" stroke-opacity=".4" stroke-width="3"/>`;
    for (let y = 70 + i * 23; y < 2400; y += 150 + ((i * 37) % 60)) {
      svg += `<circle cx="${x}" cy="${y}" r="8" fill="#0c121a" stroke="${color}" stroke-width="3"/>`;
    }
    if (i < 5) {
      for (let k = 0; k < 3; k++) {
        const y = 200 + ((i * 7 + k * 5) % 13) * 160;
        svg += `<path d="M${x} ${y}C${x} ${y + 90} ${x + 376} ${y + 30} ${x + 376} ${y + 130}" stroke="${color}" stroke-opacity=".5" stroke-width="3" fill="none"/>`;
      }
    }
  });
  return { code: `${half}\n${half}`, svg };
}

const HEAT = [0, 1, 2]
  .flatMap((r) =>
    [0, 1, 2].map(
      (c) =>
        `<rect x="${3 + c * 6.5}" y="${3 + r * 6.5}" width="5" height="5" rx="1" stroke="none" fill="currentColor" fill-opacity="${[0.9, 0.3, 0.6, 0.4, 1, 0.5, 0.7, 0.9, 0.3][r * 3 + c]}"/>`,
    ),
  )
  .join("");

const ICONS: Record<string, string> = {
  editor: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h5M7 13h9M7 16h4"/>',
  rack: '<rect x="3" y="3" width="18" height="5" rx="1"/><rect x="3" y="10" width="18" height="5" rx="1"/><rect x="3" y="17" width="18" height="4" rx="1"/>',
  circ: '<path d="M3 7h6l3 4h9M3 17h7l2-3M12 11V4"/><circle cx="9" cy="7" r="1.4"/><circle cx="21" cy="11" r="1.4"/>',
  term: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 10l3 2-3 2M12 15h5"/>',
  git: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 7v10M18 11c0 4-6 3-12 6"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  lens: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l6 6"/>',
  heat: HEAT,
  list: '<path d="M4 6l2 2 3-3M4 14l2 2 3-3M12 7h8M12 15h8"/>',
};

// letter, material class, icon, label on the side face
const CUBES: [string, string, string, string][] = [
  ["R", "rs-m1", "editor", "main.cpp"],
  ["E", "rs-m2", "rack", "rack-01"],
  ["P", "rs-m3", "circ", "die.v"],
  ["O", "rs-m4", "term", "$ _"],
  ["S", "rs-m5", "git", "git log"],
  ["I", "rs-m6", "cpu", "x86_64"],
  ["G", "rs-m7", "lens", "grep -r"],
  ["H", "rs-m8", "heat", "hotspot"],
  ["T", "rs-m9", "list", "pass"],
];
const ROWS: [number, number][] = [
  [0, 4],
  [4, 9],
];

export function Wallpaper() {
  const root = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [narrow, setNarrow] = useState(false);
  const [ready, setReady] = useState(false);
  const [deco, setDeco] = useState<{ code: string; svg: string } | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const m = w < 760;
      setNarrow(m);
      setScale(Math.max(0.4, Math.min(w / (m ? 820 : 1500), h / (m ? 950 : 820))));
      setReady(true);
    };
    fit();
    setDeco(buildDeco());
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ax = narrow ? 50 : 68;
  const ay = narrow ? 58 : 55;

  return (
    <div ref={root} className="rs-wall" data-ready={ready} aria-hidden="true">
      <div className="rs-wall-glow" />
      <div className="rs-scene" style={{ perspective: `${1700 * scale}px`, perspectiveOrigin: `${ax}% ${ay}%` }}>
        <div className="rs-stage" style={{ left: `${ax}%`, top: `${ay}%`, ["--k" as string]: scale }}>
          <div className="rs-floor">
            {deco ? (
              <>
                <div className="rs-code" dangerouslySetInnerHTML={{ __html: deco.code }} />
                <svg viewBox="0 0 2400 2400" dangerouslySetInnerHTML={{ __html: deco.svg }} />
              </>
            ) : null}
          </div>
          {ROWS.map(([a, b], ri) =>
            CUBES.slice(a, b).map(([letter, mat, icon, tag], j) => {
              const n = b - a;
              const x = (j - (n - 1) / 2) * GAP;
              const y = (ri ? 0.5 : -0.5) * GAP;
              return (
                <div
                  key={letter + a}
                  className={`rs-cube ${mat}`}
                  style={{ transform: `translate3d(${x}px,${y}px,56px) rotateX(-90deg)` }}
                >
                  <div className="rs-face rs-fp">
                    <span className="rs-ltr">{letter}</span>
                  </div>
                  <div className="rs-face rs-ft">
                    <svg className="rs-ic" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: ICONS[icon] }} />
                  </div>
                  <div className="rs-face rs-fr">
                    <span className="rs-tag">{tag}</span>
                  </div>
                </div>
              );
            }),
          )}
        </div>
      </div>
    </div>
  );
}
