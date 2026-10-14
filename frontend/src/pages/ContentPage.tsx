import { Html } from "../components/OSWindow";
import { Seo } from "../components/Seo";
import { articleJsonLd, articleMeta, withByline } from "../content/articles";
import { pageHtml, type PageEntry } from "../content/content";

/** Route element: only the <head> for the URL. The page itself is rendered inside its window (WindowContent). */
export function PageHead({ entry }: { entry: PageEntry }) {
  const meta = articleMeta(entry);
  return (
    <Seo
      title={entry.title}
      description={entry.description}
      canonical={entry.canonical}
      robots={entry.robots}
      ogTitle={entry.ogTitle}
      ogDescription={entry.ogDescription}
      jsonLd={meta ? articleJsonLd(entry, meta) : null}
    />
  );
}

/** The page body, verbatim legacy markup. /learn/ articles also get a byline with author and dates. */
export function PageBody({ entry }: { entry: PageEntry }) {
  const meta = articleMeta(entry);
  const html = pageHtml(entry.file);
  return <Html html={meta ? withByline(html, meta) : html} className={`rs-${entry.kind}`} />;
}
