// Migration gate: every legacy page must survive the rewrite unchanged.
//   npm run build && npm run check:parity            (run from frontend/)
//   node scripts/check-parity.mjs --ref <git-ref>
//
// Reads the OLD static pages straight from git history (default: the commit
// this migration was built from), so it works after the old files are deleted.
// For each page it compares: <main> body, title, description, canonical,
// og:title/description, robots. Also checks sitemap/robots/ads.txt.
// Bodies are compared as token streams (tags, attributes, decoded text), because
// the prerenderer re-serialises HTML: &mdash; becomes the literal dash and
// <path/> becomes <path></path>. Those are the same markup to a browser.
//
// 5 learn pages were corrupted on Version2/main (they held another article's
// text). For those, the reference is the last GOOD commit listed in
// src/content/restored-from.json, not the corrupted base.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const refIdx = args.indexOf("--ref");
const BASE_REF = refIdx >= 0 ? args[refIdx + 1] : "37d8edc";
const dist = "dist";
const restored = JSON.parse(readFileSync("src/content/restored-from.json", "utf8"));

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const gitShow = (rev, path) =>
  execFileSync("git", ["-C", repoRoot, "show", `${rev}:${path}`], { encoding: "utf8", maxBuffer: 1 << 26 });

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", mdash: "\u2014", ndash: "\u2013",
  rarr: "\u2192", larr: "\u2190", middot: "\u00b7", hellip: "\u2026", rsquo: "\u2019", lsquo: "\u2018",
  ldquo: "\u201c", rdquo: "\u201d", times: "\u00d7",
};
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1));
    if (!(e in NAMED)) throw new Error(`unknown entity ${m} - add it to NAMED`);
    return NAMED[e];
  });
const attr = (html, re) => decode(html.match(re)?.[1]?.trim() ?? "");
const head = (html) => ({
  title: decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim()),
  description: attr(html, /<meta[^>]+name="description"[^>]+content="([^"]*)"/i),
  canonical: attr(html, /<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i),
  ogTitle: attr(html, /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i),
  ogDescription: attr(html, /<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i),
  robots: attr(html, /<meta[^>]+name="robots"[^>]+content="([^"]*)"/i),
});


const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
function tokens(html) {
  const out = [];
  // A tag starts with < plus a letter or /letter (browser rules); a raw "< 0" in a code sample is text.
  for (const part of html.split(/(<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>)/)) {
    if (!part || part.startsWith("<!--")) continue;
    if (!part.startsWith("<")) {
      const t = decode(part).replace(/\s+/g, " ").trim();
      if (!t) continue;
      if (out.length && out[out.length - 1].startsWith("T:")) out[out.length - 1] += " " + t;
      else out.push("T:" + t);
      continue;
    }
    const close = part.match(/^<\/\s*([a-z0-9-]+)/i);
    if (close) {
      out.push(`</${close[1].toLowerCase()}>`);
      continue;
    }
    const m = part.match(/^<\s*([a-z0-9-]+)([\s\S]*?)(\/?)>$/i);
    if (!m) throw new Error(`cannot tokenize ${part.slice(0, 60)}`);
    const name = m[1].toLowerCase();
    const attrs = [...m[2].matchAll(/([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|\x27([^\x27]*)\x27))?/g)]
      .map((a) => `${a[1].toLowerCase()}=${decode(a[2] ?? a[3] ?? "").replace(/\s+/g, " ").trim()}`)
      .sort()
      .join(" ");
    out.push(`<${name}${attrs ? " " + attrs : ""}>`);
    if (m[3] === "/" && !VOID.has(name)) out.push(`</${name}>`);
  }
  return out;
}
/** null when equal, otherwise a short description of the first difference. */
function markupDiff(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (x[i] !== y[i]) return `token ${i}/${n}: legacy ${JSON.stringify((x[i] ?? "(end)").slice(0, 70))} vs built ${JSON.stringify((y[i] ?? "(end)").slice(0, 70))}`;
  }
  return null;
}

// Inner html of the first <div ... data-rs-content=""> (balanced div depth).
function contentInner(html) {
  const start = html.match(/<div class="rs-prose[^"]*" data-rs-content="">/);
  if (!start) return null;
  let i = start.index + start[0].length;
  let depth = 1;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = i;
  for (let m; (m = re.exec(html)); ) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return html.slice(i, m.index);
  }
  return null;
}

let failed = 0;
const fail = (page, msg) => {
  failed++;
  console.log(`FAIL ${page}: ${msg}`);
};

const listing = execFileSync("git", ["-C", repoRoot, "ls-tree", "-r", "--name-only", BASE_REF, "frontend/"], {
  encoding: "utf8",
})
  .split("\n")
  .filter((f) => /^frontend\/(learn\/)?[a-z0-9-]+\.html$/.test(f));

let checked = 0;
for (const full of listing) {
  const rel = full.replace(/^frontend\//, "");
  if (rel === "index.html") continue; // home handled below
  const rev = restored[rel] ?? BASE_REF;
  const old = gitShow(rev, full);
  const builtPath = join(dist, rel);
  if (!existsSync(builtPath)) {
    fail(rel, "not built");
    continue;
  }
  const built = readFileSync(builtPath, "utf8");

  const oldMain = old.match(/<main[^>]*>([\s\S]*)<\/main>/)?.[1];
  const newMain = contentInner(built);
  if (newMain === null) fail(rel, "no data-rs-content block in built page");
  else {
    const d = markupDiff(oldMain, newMain);
    if (d) fail(rel, `body differs from ${rev}: ${d}`);
  }

  const a = head(old);
  const b = head(built);
  for (const k of Object.keys(a)) {
    if (k.startsWith("og") && a[k] === "") continue; // legacy 404 had no og tags; extra og tags are harmless
    if (a[k] !== b[k]) fail(rel, `${k}: "${a[k]}" != "${b[k]}"`);
  }
  checked++;
}

// Home: hero copy, marketing sections, JSON-LD.
{
  const old = gitShow(BASE_REF, "frontend/index.html");
  const built = readFileSync(join(dist, "index.html"), "utf8");
  const a = head(old);
  const b = head(built);
  for (const k of Object.keys(a)) if (a[k] !== b[k]) fail("index.html", `${k}: "${a[k]}" != "${b[k]}"`);
  const sections = [
    /<section class="pipeline" id="pipeline">[\s\S]*?<\/section>/,
    /<section class="features" id="features">[\s\S]*?<\/section>/,
    /<section class="features" id="learn">[\s\S]*?<\/section>/,
    /<section class="cta-band">[\s\S]*?<\/section>/,
  ];
  for (const re of sections) {
    const frag = old.match(re)?.[0];
    if (!frag) fail("index.html", `legacy section not found: ${re}`);
    else {
      const got = built.match(re)?.[0];
      const d = got ? markupDiff(frag, got) : "section not found in built page";
      if (d) fail("index.html", `section ${frag.slice(0, 40).replace(/\s+/g, " ")}...: ${d}`);
    }
  }
  const strip = (s) => decode(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  const oldH1 = strip(old.match(/<h1>([\s\S]*?)<\/h1>/)[1]);
  const newH1 = strip(built.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1]);
  if (oldH1 !== newH1) fail("index.html", `h1 "${oldH1}" != "${newH1}"`);
  const oldSub = strip(old.match(/<p class="hero-sub">([\s\S]*?)<\/p>/)[1]);
  if (!decode(built).includes(oldSub)) fail("index.html", "hero sub copy missing");
  const oldLd = JSON.parse(old.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1].replace("ronak.reposight@", "contact.reposight@"));
  const newLd = JSON.parse(built.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1]);
  if (JSON.stringify(oldLd) !== JSON.stringify(newLd)) fail("index.html", "JSON-LD differs (only the email should change)");
  checked++;
}

// Static files that must be carried over byte-for-byte.
for (const f of ["sitemap.xml", "robots.txt", "ads.txt"]) {
  const p = join(dist, f);
  if (!existsSync(p)) fail(f, "missing from dist");
  else if (readFileSync(p, "utf8") !== gitShow(BASE_REF, `frontend/${f}`)) fail(f, "differs from legacy");
}

console.log(`\nparity vs ${BASE_REF}: ${checked} pages compared, ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
