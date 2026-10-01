// Gate for the BUILT html (what crawlers fetch before any JS runs).
//   npm run build && npm run check
// Fails (exit 1) if a page is missing SEO essentials, points its canonical at a
// different page, duplicates another page's h1/title/description, or a sitemap
// URL has no built file. Safe to run in CI on every push.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const dist = process.argv[2] ?? "dist";
const ORIGIN = "https://www.repo-sight.com";

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".html") ? [p] : [];
  });

const strip = (s) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const attr = (html, re) => html.match(re)?.[1]?.trim() ?? "";
const urlFor = (rel) => {
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return "/" + rel.slice(0, -"index.html".length);
  return "/" + rel;
};

const files = walk(dist).sort();
if (files.length === 0) {
  console.error(`no .html found in ${dist} (run "npm run build" first)`);
  process.exit(1);
}

let failed = 0;
const seen = { h1: new Map(), title: new Map(), desc: new Map() };
const built = new Set();

for (const file of files) {
  const rel = relative(dist, file).replaceAll("\\", "/");
  built.add(rel);
  const html = readFileSync(file, "utf8");
  const is404 = rel === "404.html";
  const problems = [];
  const warnings = [];

  const h1s = [...html.matchAll(/<h1[\s>][\s\S]*?<\/h1>/gi)].map((m) => strip(m[0]));
  const title = strip(attr(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const desc = attr(html, /<meta[^>]+name="description"[^>]+content="([^"]*)"/i);
  const canonical = attr(html, /<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i);
  const robots = attr(html, /<meta[^>]+name="robots"[^>]+content="([^"]*)"/i);
  const ogTitle = attr(html, /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i);
  const ld = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];

  if (!/<html[^>]+lang="en"/i.test(html)) problems.push('missing <html lang="en">');
  if (/<div id="root"><\/div>/.test(html)) problems.push("empty #root (not prerendered)");
  if (h1s.length !== 1) problems.push(`expected 1 <h1>, found ${h1s.length}`);
  if (!title) problems.push("empty <title>");
  else if (title.length > 70) warnings.push(`title ${title.length} chars (>70)`);
  if (!desc) problems.push("missing meta description");
  if (!html.includes('name="google-adsense-account"')) problems.push("missing adsense account meta");

  if (is404) {
    if (!/noindex/i.test(robots)) problems.push("404 page must be noindex");
  } else {
    if (/noindex/i.test(robots)) problems.push("unexpected noindex");
    const expected = ORIGIN + urlFor(rel);
    if (canonical !== expected) problems.push(`canonical "${canonical}" should be "${expected}"`);
    if (!ogTitle) problems.push("missing og:title");
    for (const [k, v] of [["h1", h1s[0]], ["title", title], ["description", desc]]) {
      if (!v) continue;
      const prev = seen[k === "description" ? "desc" : k].get(v);
      if (prev) problems.push(`duplicate ${k} with ${prev}: "${v.slice(0, 60)}"`);
      else seen[k === "description" ? "desc" : k].set(v, rel);
    }
  }
  for (const [, body] of ld) {
    try {
      JSON.parse(body);
    } catch {
      problems.push("invalid JSON-LD");
    }
  }
  if (/ronak\.reposight/i.test(html)) problems.push("uses ronak.reposight@ (canonical contact is contact.reposight@)");

  if (problems.length) {
    failed++;
    console.log(`FAIL ${rel}`);
    problems.forEach((p) => console.log(`     - ${p}`));
  } else {
    console.log(`ok   ${rel.padEnd(52)} h1: ${(h1s[0] ?? "").slice(0, 44)}`);
  }
  warnings.forEach((w) => console.log(`     ! ${w}`));
}

// Sitemap: every <loc> must resolve to a built file.
const sitemapPath = join(dist, "sitemap.xml");
if (!existsSync(sitemapPath)) {
  failed++;
  console.log("FAIL sitemap.xml missing from dist");
} else {
  const locs = [...readFileSync(sitemapPath, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const missing = locs.filter((loc) => {
    const p = loc.replace(ORIGIN, "");
    const rel = p === "/" ? "index.html" : p.endsWith("/") ? p.slice(1) + "index.html" : p.slice(1);
    return !built.has(rel);
  });
  if (missing.length) {
    failed++;
    console.log(`FAIL sitemap lists URLs with no built page: ${missing.join(", ")}`);
  } else {
    console.log(`ok   sitemap.xml: ${locs.length}/${locs.length} URLs have a built page`);
  }
}
for (const f of ["robots.txt", "ads.txt"]) {
  if (!existsSync(join(dist, f))) {
    failed++;
    console.log(`FAIL ${f} missing from dist`);
  }
}

console.log(`\n${files.length} pages checked, ${failed} failing`);
process.exit(failed ? 1 : 0);
