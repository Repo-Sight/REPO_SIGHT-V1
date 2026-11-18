import data from "./articles.json";
import { SITE } from "../site";
import type { PageEntry } from "./content";

/**
 * Publication data for /learn/ articles (byline + Article JSON-LD).
 * `published` = date the article first went live (from git history).
 * `modified` = set ONLY when the article text was materially revised.
 * Never backdate or bump it for cosmetic/template changes.
 */
export interface ArticleMeta {
  published: string; // YYYY-MM-DD
  modified?: string; // YYYY-MM-DD
}

const AUTHOR = "Ronak Arora";
const meta = data as Record<string, ArticleMeta>;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A /learn/ article page (not the /learn/ index). */
export function isArticle(entry: PageEntry): boolean {
  return entry.path.startsWith("/learn/") && entry.path !== "/learn/";
}

export function articleMeta(entry: PageEntry): ArticleMeta | null {
  return isArticle(entry) ? (meta[entry.file] ?? null) : null;
}

// Manual format: no Intl/timezone, so prerendered and hydrated output are identical.
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function showUpdated(m: ArticleMeta): m is ArticleMeta & { modified: string } {
  return !!m.modified && m.modified !== m.published;
}

/** Inline byline text, appended to the article's existing "Back to Learn" line. */
export function bylineHtml(m: ArticleMeta): string {
  const published = `Published <time datetime="${m.published}">${formatDate(m.published)}</time>`;
  const updated = showUpdated(m)
    ? ` &middot; Updated <time datetime="${m.modified}">${formatDate(m.modified)}</time>`
    : "";
  return `By <a href="/about.html" rel="author">${AUTHOR}</a> &middot; ${published}${updated}`;
}

/** Put the byline on the same line as the back link; fall back to just after the <h1>. */
export function withByline(html: string, m: ArticleMeta): string {
  const line = bylineHtml(m);
  const re = /(<p class="legal-updated">[\s\S]*?)(<\/p>)/;
  if (re.test(html)) return html.replace(re, (_all, a: string, b: string) => `${a} &middot; ${line}${b}`);
  return html.replace(/<\/h1>/, () => `</h1>\n<p class="legal-updated">${line}</p>`);
}

export function articleJsonLd(entry: PageEntry, m: ArticleMeta): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: entry.title.replace(/\s*\|\s*REPO-SIGHT$/, ""),
    description: entry.description,
    mainEntityOfPage: entry.canonical ?? `${SITE.url}${entry.path}`,
    datePublished: m.published,
    dateModified: m.modified ?? m.published,
    image: SITE.ogImage,
    author: { "@type": "Person", name: AUTHOR, url: `${SITE.url}/about.html` },
    publisher: {
      "@type": "Organization",
      name: SITE.name,
      url: `${SITE.url}/`,
      logo: { "@type": "ImageObject", url: `${SITE.url}/apple-touch-icon.png` },
    },
  };
}
