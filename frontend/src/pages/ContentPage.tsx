import { Html, OSWindow } from "../components/OSWindow";
import { Seo } from "../components/Seo";
import { pageHtml, type PageEntry } from "../content/content";

export function ContentPage({ entry }: { entry: PageEntry }) {
  const name = entry.file.split("/").pop() ?? entry.file;
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
      <OSWindow title={name}>
        <Html html={pageHtml(entry.file)} className={`rs-${entry.kind}`} />
      </OSWindow>
    </>
  );
}
