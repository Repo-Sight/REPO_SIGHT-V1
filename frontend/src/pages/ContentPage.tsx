import { Html } from "../components/OSWindow";
import { Seo } from "../components/Seo";
import { pageHtml, type PageEntry } from "../content/content";

/** Route element: only the <head> for the URL. The page itself is rendered inside its window (WindowContent). */
export function PageHead({ entry }: { entry: PageEntry }) {
  return (
    <Seo
      title={entry.title}
      description={entry.description}
      canonical={entry.canonical}
      robots={entry.robots}
      ogTitle={entry.ogTitle}
      ogDescription={entry.ogDescription}
    />
  );
}

/** The page body, verbatim legacy markup. */
export function PageBody({ entry }: { entry: PageEntry }) {
  return <Html html={pageHtml(entry.file)} className={`rs-${entry.kind}`} />;
}
