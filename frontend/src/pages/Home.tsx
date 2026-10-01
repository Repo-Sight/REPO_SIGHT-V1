import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AdSlot } from "../components/AdSlot";
import { Html, OSWindow } from "../components/OSWindow";
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
  useEffect(() => {
    const id = new URLSearchParams(search).get("scan");
    setScanId(isScanId(id) ? id : null);
  }, [search]);

  const newScan = useCallback(() => {
    navigate({ pathname: "/", search: "", hash: "#analyze" });
  }, [navigate]);

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
        <OSWindow title="REPO-SIGHT" subtitle="report">
          <ReportView scanId={scanId} onNewScan={newScan} />
        </OSWindow>
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

      {/* #analyze is the anchor every CTA links to. */}
      <OSWindow id="analyze" title="REPO-SIGHT" subtitle="static code analysis">
        <div className="space-y-6">
          <div className="max-w-3xl space-y-5">
            <h1 className="text-balance text-3xl font-black leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
              {c.h1Lead}{" "}
              <span className="inline-block bg-signal px-2 py-0.5 text-white shadow-brutal-sm">{c.h1Highlight}</span>
            </h1>
            <p className="max-w-2xl text-base leading-relaxed text-ink/80 sm:text-lg">{c.heroSub}</p>
          </div>
          <Scanner />
        </div>
      </OSWindow>

      <OSWindow title="pipeline" subtitle="how it works">
        <Html html={c.pipelineHtml} />
      </OSWindow>

      <AdSlot />

      <OSWindow title="features" subtitle="what you get">
        <Html html={c.featuresHtml} />
      </OSWindow>

      <OSWindow title="learn" subtitle="read up on the numbers">
        <Html html={c.learnHtml} />
      </OSWindow>

      <Html html={c.ctaHtml} />
    </div>
  );
}
