import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { AdSlot } from "../components/AdSlot";
import { Block, Html } from "../components/OSWindow";
import { Scanner } from "../components/Scanner";
import { Seo } from "../components/Seo";
import { SponsorSlot } from "../components/SponsorSlot";
import { homeContent as c } from "../content/content";
import { resolveApp } from "../lib/apps";

/**
 * Route element for "/": only the <head>. The page itself lives in its window
 * (HomeBody here, DemoReport / ReportView for ?demo= and ?scan=). The query
 * string only counts after mount so the prerendered head and the first hydrated
 * render match.
 */
export function HomeHead() {
  const { search } = useLocation();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const app = resolveApp("/", mounted ? search : "");

  if (app.kind === "demo") {
    return (
      <Seo title="Sample code health report | REPO-SIGHT" description={c.description} canonical={c.canonical} robots="noindex, follow" />
    );
  }
  if (app.kind === "report") {
    // Reports are per-scan pages: keep them out of the index, canonical stays on the homepage.
    return <Seo title="Code health report | REPO-SIGHT" description={c.description} canonical={c.canonical} robots="noindex, follow" />;
  }
  return (
    <Seo
      title={c.title}
      description={c.description}
      canonical={c.canonical}
      robots={c.robots}
      ogTitle={c.ogTitle}
      ogDescription={c.ogDescription}
      jsonLd={c.jsonLd}
    />
  );
}

/** The marketing home page, rendered inside the home.mdx window. */
export function HomeBody() {
  return (
    <div className="space-y-10">
      {/* Left-aligned headline; the desktop icons live in the shell (SiteLayout), behind the windows. */}
      <section aria-labelledby="hero-title" className="pt-2 sm:pt-6">
        <div className="max-w-4xl space-y-5">
          <h1 id="hero-title" className="rs-display text-balance text-4xl leading-[1.1] sm:text-5xl lg:text-6xl">
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

      <SponsorSlot />

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
