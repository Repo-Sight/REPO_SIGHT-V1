import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AdSlot } from "../components/AdSlot";
import { DemoReport } from "../components/DemoReport";
import { Block, Html } from "../components/OSWindow";
import { ReportView } from "../components/ReportView";
import { Scanner } from "../components/Scanner";
import { Seo } from "../components/Seo";
import { homeContent as c } from "../content/content";
import { isScanId } from "../lib/api";

export function Home() {
  const { search } = useLocation();
  const navigate = useNavigate();

  // Read ?scan= only after mount: the prerendered HTML (and the first hydrated
  // render) is always the marketing page, so there is no hydration mismatch
  // for visitors who arrive on an existing /?scan=<id> report link.
  const [scanId, setScanId] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(search);
    const id = params.get("scan");
    setScanId(isScanId(id) ? id : null);
    setDemo(params.get("demo") === "1");
  }, [search]);

  const newScan = useCallback(() => {
    navigate({ pathname: "/", search: "", hash: "#analyze" });
  }, [navigate]);

  if (demo && !scanId) {
    return (
      <div className="space-y-10">
        <Seo
          title="Sample code health report | REPO-SIGHT"
          description={c.description}
          canonical={c.canonical}
          robots="noindex, follow"
        />
        <DemoReport onNewScan={newScan} />
      </div>
    );
  }

  if (scanId) {
    return (
      <div className="space-y-10">
        {/* Reports are per-scan pages: keep them out of the index, canonical stays on the homepage. */}
        <Seo
          title="Code health report | REPO-SIGHT"
          description={c.description}
          canonical={c.canonical}
          robots="noindex, follow"
        />
        <ReportView scanId={scanId} onNewScan={newScan} />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <Seo
        title={c.title}
        description={c.description}
        canonical={c.canonical}
        robots={c.robots}
        ogTitle={c.ogTitle}
        ogDescription={c.ogDescription}
        jsonLd={c.jsonLd}
      />

      {/* Left-aligned headline; the desktop icons live in the shell (SiteLayout), behind the window. */}
      <section aria-labelledby="hero-title" className="pt-2 sm:pt-6">
        <div className="max-w-4xl space-y-5">
          <h1
            id="hero-title"
            className="text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl"
          >
            {c.h1Lead} <span className="text-signal">{c.h1Highlight}</span>
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted sm:text-lg">{c.heroSub}</p>
        </div>
      </section>

      {/* #analyze is the anchor every CTA links to. */}
      <Block id="analyze">
        <Scanner />
      </Block>

      <Block>
        <Html html={c.pipelineHtml} />
      </Block>

      <AdSlot />

      <Block>
        <Html html={c.featuresHtml} />
      </Block>

      <Block>
        <Html html={c.learnHtml} />
      </Block>

      <Html html={c.ctaHtml} />
    </div>
  );
}
