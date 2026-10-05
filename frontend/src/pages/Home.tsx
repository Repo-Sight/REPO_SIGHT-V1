import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AdSlot } from "../components/AdSlot";
import { DesktopFolder, DesktopIcon } from "../components/DesktopIcons";
import { DemoReport } from "../components/DemoReport";
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
        <OSWindow title="REPO-SIGHT" subtitle="sample report">
          <DemoReport onNewScan={newScan} />
        </OSWindow>
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

      {/* PostHog-style hero: left-aligned headline, then a desktop: icons either side, windows in the middle. */}
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

      <div className="grid gap-x-6 gap-y-6 lg:grid-cols-[5.5rem_minmax(0,1fr)_5.5rem]">
        <nav aria-label="Desktop" className="order-1 lg:order-none lg:col-start-1 lg:row-start-1 lg:self-start lg:sticky lg:top-24">
          <ul role="list" className="grid grid-cols-5 gap-y-2 lg:grid-cols-1">
            <DesktopIcon href="/#analyze" label="Analyze" glyph="scan" tone="red" />
            <DesktopIcon href="/?demo=1" label="Demo report" glyph="report" tone="yellow" />
            <DesktopFolder
              label="Languages"
              tone="blue"
              title="Languages"
              links={[
                { href: "/cpp-code-analyzer.html", label: "C++ analyzer" },
                { href: "/python-code-analyzer.html", label: "Python analyzer" },
                { href: "/java-code-analyzer.html", label: "Java analyzer" },
                { href: "/typescript-code-analyzer.html", label: "TypeScript analyzer" },
                { href: "/javascript-code-analyzer.html", label: "JavaScript analyzer" },
              ]}
            />
            <DesktopFolder
              label="Checkers"
              tone="green"
              title="Checkers"
              links={[
                { href: "/github-code-analyzer.html", label: "GitHub code analyzer" },
                { href: "/code-quality-checker.html", label: "Code quality checker" },
                { href: "/code-complexity-checker.html", label: "Code complexity checker" },
                { href: "/code-security-scanner.html", label: "Code security scanner" },
                { href: "/free-static-code-analyzer.html", label: "Free static analyzer" },
              ]}
            />
            <DesktopIcon href="/learn/" label="Learn" glyph="book" tone="ink" />
          </ul>
        </nav>

        <div className="order-3 min-w-0 space-y-10 lg:order-none lg:col-start-2 lg:row-start-1">
          {/* #analyze is the anchor every CTA links to. */}
          <OSWindow id="analyze" title="REPO-SIGHT" subtitle="scan a repository">
            <Scanner />
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
        </div>

        <nav aria-label="Desktop, more" className="order-2 lg:order-none lg:col-start-3 lg:row-start-1 lg:self-start lg:sticky lg:top-24">
          <ul role="list" className="grid grid-cols-5 gap-y-2 lg:grid-cols-1">
            <DesktopIcon href="/about.html" label="About" glyph="info" tone="blue" />
            <DesktopIcon href="/contact.html" label="Contact" glyph="mail" tone="yellow" />
            <DesktopIcon href="/privacy.html" label="Privacy" glyph="lock" tone="green" />
            <DesktopIcon href="/terms.html" label="Terms" glyph="terms" tone="ink" />
            <DesktopIcon
              href="https://buymeacoffee.com/ronakarora1"
              label="Support"
              glyph="coffee"
              tone="red"
              external
            />
          </ul>
        </nav>
      </div>

      <Html html={c.ctaHtml} />
    </div>
  );
}
