import { AdSlot } from "../components/AdSlot";
import { Html, OSWindow } from "../components/OSWindow";
import { Seo } from "../components/Seo";
import { homeContent as c } from "../content/content";

export function Home() {
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

      {/* #analyze is the anchor every CTA links to; the scanner form lands here in step 3. */}
      <OSWindow id="analyze" title="REPO-SIGHT" subtitle="static code analysis">
        <div className="max-w-3xl space-y-5">
          <h1 className="text-balance text-3xl font-black leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
            {c.h1Lead}{" "}
            <span className="inline-block bg-signal px-2 py-0.5 text-white shadow-brutal-sm">{c.h1Highlight}</span>
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-ink/80 sm:text-lg">{c.heroSub}</p>
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
