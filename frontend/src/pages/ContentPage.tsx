import { Html } from "../components/OSWindow";
import { Seo } from "../components/Seo";
import { pageHtml, type PageEntry } from "../content/content";

export function ContentPage({ entry }: { entry: PageEntry }) {
  return (
    <>
      <Seo
        title={entry.title}
        description={entry.description}
        canonical={entry.canonical}
        robots={entry.robots}
        ogTitle={entry.ogTitle}
        ogDescription={entry.ogDescription}
      />
     <Html html={pageHtml(entry.file)} className={`rs-${entry.kind}`} />
    </>
  );
}
