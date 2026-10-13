import { memo } from "react";
import type { AppSpec } from "../lib/apps";
import { useDesktop } from "../lib/desktopContext";
import { DemoReport } from "./DemoReport";
import { PageBody } from "../pages/ContentPage";
import { HomeBody } from "../pages/Home";
import { ReportView } from "./ReportView";
import { ScoreCard } from "./ScoreCard";
import { SiteFooter } from "./SiteFooter";

/** What lives inside a window, chosen by app kind. Memoised: a focus change elsewhere must not re-render a heavy report. */
function WindowContentImpl({ spec, focused }: { spec: AppSpec; focused: boolean }) {
  const d = useDesktop();
  if (spec.kind === "card") return <ScoreCard />;

  const newScan = () => d.open("/#analyze");
  let body;
  switch (spec.kind) {
    case "home":
      body = <HomeBody />;
      break;
    case "demo":
      body = (
        <div className="space-y-10">
          <DemoReport onNewScan={newScan} />
        </div>
      );
      break;
    case "report":
      body = (
        <div className="space-y-10">
          {/* Reports are per-scan pages: kept out of the index by the route's <Seo robots="noindex">. */}
          <ReportView scanId={spec.scanId ?? ""} onNewScan={newScan} />
        </div>
      );
      break;
    default:
      body = spec.entry ? <PageBody entry={spec.entry} /> : null;
  }

  return (
    <>
      <main id={focused ? "main" : undefined} className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {body}
      </main>
      <SiteFooter />
    </>
  );
}

export const WindowContent = memo(WindowContentImpl);
