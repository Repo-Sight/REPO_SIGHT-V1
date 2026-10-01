import type { RouteRecord } from "vite-react-ssg";
import { SiteLayout } from "./components/SiteLayout";
import { pages, type PageEntry } from "./content/content";
import { ContentPage } from "./pages/ContentPage";
import { Home } from "./pages/Home";

// One prerendered static HTML file per route. Route paths keep the ".html"
// suffix so every live URL stays exactly as it is today (sitemap unchanged).
const page = (entry: PageEntry) =>
  function Page() {
    return <ContentPage entry={entry} />;
  };

const learnIndex = pages.find((p) => p.path === "/learn/");
const notFound = pages.find((p) => p.kind === "notfound");
if (!learnIndex || !notFound) throw new Error("content manifest is missing /learn/ or 404.html");

const learnArticles = pages.filter((p) => p.path.startsWith("/learn/") && p.path !== "/learn/");
const topLevel = pages.filter((p) => !p.path.startsWith("/learn/") && p.kind !== "notfound");

const NotFound = page(notFound);

export const routes: RouteRecord[] = [
  {
    path: "/",
    Component: SiteLayout,
    children: [
      { index: true, Component: Home },
      ...topLevel.map((p) => ({ path: p.path.slice(1), Component: page(p) })),
      {
        path: "learn/",
        children: [
          { index: true, Component: page(learnIndex) },
          ...learnArticles.map((p) => ({ path: p.path.replace("/learn/", ""), Component: page(p) })),
        ],
      },
      // Static 404 page; Vercel serves /404.html with a 404 status for unknown URLs.
      { path: "404.html", Component: NotFound },
      { path: "*", Component: NotFound },
    ],
  },
];
