import { pages, type PageEntry } from "../content/content";
import { isScanId } from "./api";

/**
 * The "apps" of the desktop. Every URL on the site maps to exactly one app, and
 * an app is what lives inside a window. The id is the window's identity: opening
 * an app that already has a window focuses that window instead of duplicating it.
 */
export type AppKind = "home" | "page" | "demo" | "report" | "card";

export interface AppSpec {
  /** Window identity. For URL apps this is path + search ("/", "/about.html", "/?scan=<id>"). */
  id: string;
  kind: AppKind;
  /** File-name style title shown in the title bar and the taskbar chip. */
  title: string;
  /** The URL the address bar shows while this window is focused. */
  url: string;
  entry?: PageEntry;
  scanId?: string;
}

const byPath = new Map(pages.map((p) => [p.path, p]));
const notFound = pages.find((p) => p.kind === "notfound");

export const HOME_APP: AppSpec = { id: "/", kind: "home", title: "home.mdx", url: "/" };
export const DEMO_APP: AppSpec = { id: "/?demo=1", kind: "demo", title: "demo-report.json", url: "/?demo=1" };
/** The small score card that floats on the bare desktop. Not a URL, so it never touches the address bar. */
export const CARD_APP: AppSpec = { id: "card:demo", kind: "card", title: "score-card.json", url: "" };

/** "/learn/" -> "learn/", "/learn/x.html" -> "x.html", "/about.html" -> "about.html". */
function fileTitle(path: string): string {
  const last = path.split("/").filter(Boolean).pop() ?? "home";
  return path.endsWith("/") ? `${last}/` : last;
}

/**
 * Map a location to an app. `search` must be "" for the first (prerendered)
 * render; the real query string only counts after mount, so hydration matches.
 */
export function resolveApp(pathname: string, search: string): AppSpec {
  if (pathname === "/" || pathname === "") {
    const params = new URLSearchParams(search);
    const scan = params.get("scan");
    if (isScanId(scan)) {
      const id = `/?scan=${encodeURIComponent(scan)}`;
      return { id, kind: "report", title: "report.json", url: id, scanId: scan };
    }
    if (params.get("demo") === "1") return DEMO_APP;
    return HOME_APP;
  }
  const entry = byPath.get(pathname) ?? byPath.get(pathname.endsWith("/") ? pathname.slice(0, -1) : `${pathname}/`) ?? notFound;
  if (!entry) return HOME_APP;
  return { id: entry.path, kind: "page", title: fileTitle(entry.path), url: entry.path, entry };
}

/** Resolve an href (relative or absolute, same origin) to an app plus the hash to scroll to. Null = not an in-site page. */
export function resolveHref(href: string, base: string): { app: AppSpec; hash: string; url: URL } | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (typeof window !== "undefined" && url.origin !== window.location.origin) return null;
  const isPage = url.pathname === "/" || url.pathname.endsWith(".html") || url.pathname.endsWith("/");
  if (!isPage) return null;
  return { app: resolveApp(url.pathname, url.search), hash: url.hash, url };
}
