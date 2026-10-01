import manifest from "./manifest.json";
import home from "./home.json";
import pipelineHtml from "./home-pipeline.html?raw";
import featuresHtml from "./home-features.html?raw";
import learnHtml from "./home-learn.html?raw";
import ctaHtml from "./home-cta.html?raw";

export type PageKind = "tool" | "legal" | "notfound";

export interface PageEntry {
  /** Public URL path, e.g. "/python-code-analyzer.html" or "/learn/". */
  path: string;
  /** Fragment file under ./pages, e.g. "learn/what-is-static-analysis.html". */
  file: string;
  kind: PageKind;
  title: string;
  description: string;
  canonical: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  robots: string | null;
}

export const pages = manifest as PageEntry[];

// Page bodies are the original <main> markup, kept verbatim (SEO parity).
const fragments = import.meta.glob("./pages/**/*.html", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function pageHtml(file: string): string {
  const html = fragments[`./pages/${file}`];
  if (html === undefined) throw new Error(`Missing content fragment: ${file}`);
  return html;
}

export const homeContent = {
  ...home,
  pipelineHtml,
  featuresHtml,
  learnHtml,
  ctaHtml,
};
