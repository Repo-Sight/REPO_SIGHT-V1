import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { SITE } from "../site";
import { AuthMenu } from "./AuthMenu";
import { AuthProvider } from "./AuthProvider";
import { ConsentAndCta } from "./ConsentAndCta";

const NAV = [
  { href: "/#pipeline", label: "How it works" },
  { href: "/#features", label: "What you get" },
  { href: "/learn/", label: "Learn" },
];

const LANGUAGES = [
  { href: "/cpp-code-analyzer.html", label: "C++" },
  { href: "/python-code-analyzer.html", label: "Python" },
  { href: "/java-code-analyzer.html", label: "Java" },
  { href: "/typescript-code-analyzer.html", label: "TypeScript" },
  { href: "/javascript-code-analyzer.html", label: "JavaScript" },
];

const FOOTER_COLUMNS: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/#analyze", label: "Analyze a repo" },
      { href: "/#pipeline", label: "How it works" },
      { href: "/#features", label: "What you get" },
    ],
  },
  {
    title: "Tools",
    links: [
      { href: "/cpp-code-analyzer.html", label: "C++ analyzer" },
      { href: "/python-code-analyzer.html", label: "Python analyzer" },
      { href: "/java-code-analyzer.html", label: "Java analyzer" },
      { href: "/typescript-code-analyzer.html", label: "TypeScript analyzer" },
      { href: "/javascript-code-analyzer.html", label: "JavaScript analyzer" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/learn/", label: "Browse all articles" },
      { href: "/learn/what-is-static-analysis.html", label: "What is static analysis?" },
      { href: "/learn/cyclomatic-complexity-explained.html", label: "Cyclomatic complexity" },
      { href: "/learn/reading-a-code-health-score.html", label: "Reading a health score" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/about.html", label: "About" },
      { href: "/privacy.html", label: "Privacy Policy" },
      { href: "/terms.html", label: "Terms of Use" },
    ],
  },
  {
    title: "Contact",
    links: [
      { href: "/contact.html", label: "Contact page" },
      { href: `mailto:${SITE.contactEmail}`, label: SITE.contactEmail },
    ],
  },
  {
    title: "Follow",
    links: [
      { href: "https://buymeacoffee.com/ronakarora1", label: "Support this project", external: true },
      {
        href: "https://www.instagram.com/reposight?igsi=OW96ZzdxeDR2N3Y4&utm_source=ig_contact_invite",
        label: "Instagram",
        external: true,
      },
      { href: "https://www.linkedin.com/company/reposight/", label: "LinkedIn", external: true },
    ],
  },
];

/** Label of the "open window" chip in the taskbar, derived from the route (matches the window title bar). */
function windowLabel(pathname: string): string {
  if (pathname === "/" || pathname === "") return "home";
  const last = pathname.split("/").filter(Boolean).pop() ?? "home";
  return pathname.endsWith("/") ? `${last}/` : last;
}

/** Taskbar clock. Renders empty until mounted so prerendered HTML and first hydration match. */
function Clock() {
  const [now, setNow] = useState("");
  useEffect(() => {
    const tick = () =>
      setNow(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="hidden min-w-[4.5ch] text-sm tabular-nums text-muted sm:inline" aria-hidden="true">
      {now}
    </span>
  );
}

export function SiteLayout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <AuthProvider>
      <div className="flex min-h-screen flex-col">
        <a href="#main" className="rs-skip">
          Skip to content
        </a>

        <header className="sticky top-0 z-40 px-2 pt-2 sm:px-3">
          <div
            id="taskbar"
            className="mx-auto flex max-w-7xl items-center gap-2 rounded-xl border border-line bg-paper/90 px-2 py-1.5 shadow-soft backdrop-blur"
          >
            <a
              href="/"
              className="flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-chrome"
              aria-label={`${SITE.name} home`}
            >
              <img
                src="/apple-touch-icon.png"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 rounded-md border border-line"
              />
              <span className="text-base font-extrabold tracking-tight">{SITE.name}</span>
            </a>

            <span className="mx-1 hidden h-6 w-px bg-line md:block" aria-hidden="true" />

            <nav
              id="site-nav"
              aria-label="Main"
              className={`${open ? "flex" : "hidden"} absolute left-2 right-2 top-full mt-1 flex-col gap-1 rounded-xl border border-line bg-paper p-3 shadow-soft-lg md:static md:mt-0 md:flex md:flex-1 md:flex-row md:items-center md:gap-1 md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none`}
            >
              {NAV.map((n) => (
                <a key={n.href} href={n.href} className="rs-navlink" onClick={() => setOpen(false)}>
                  {n.label}
                </a>
              ))}
              <details className="rs-menu">
                <summary className="rs-navlink">Languages</summary>
                <div className="rs-menu-panel">
                  {LANGUAGES.map((l) => (
                    <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
                      {l.label} analyzer
                    </a>
                  ))}
                </div>
              </details>
            </nav>

            {/* "Open window" chip: the current page, like a task in a taskbar. */}
            <span
              className="ml-auto hidden max-w-[16rem] items-center gap-2 truncate rounded-lg border border-line bg-chrome px-2.5 py-1 text-sm font-medium lg:flex"
              aria-hidden="true"
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-signal" />
              <span className="truncate">{windowLabel(pathname)}</span>
            </span>

            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Clock />
              <AuthMenu />
              <a href="/#analyze" className="rs-btn hidden !py-1.5 sm:inline-block">
                Analyze a repo
              </a>
              <button
                type="button"
                className="rounded-md border border-line bg-paper p-2 md:hidden"
                aria-label="Toggle menu"
                aria-expanded={open}
                aria-controls="site-nav"
                onClick={() => setOpen((v) => !v)}
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <line x1="3" y1="7" x2="21" y2="7" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="17" x2="21" y2="17" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
          <Outlet />
        </main>

        <footer className="border-t border-line bg-chrome">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
            <div className="lg:col-span-4 xl:col-span-1">
              <div className="flex items-center gap-2.5">
                <img src="/apple-touch-icon.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg border border-line" />
                <span className="text-lg font-extrabold tracking-tight">{SITE.name}</span>
              </div>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">
                A free static analysis engine for C++, Python, Java, TypeScript, JavaScript, and C#. Built for
                students, job seekers, and indie devs.
              </p>
            </div>
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <h2 className="text-sm font-semibold">{col.title}</h2>
                <ul className="mt-3 space-y-2 text-sm text-muted">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <a
                        href={l.href}
                        className="hover:text-ink hover:underline"
                        {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      >
                        {l.label}
                      </a>
                    </li>
                  ))}
                  {col.title === "Legal" ? <li>Apache 2.0 License</li> : null}
                </ul>
              </div>
            ))}
          </div>
        </footer>

        <ConsentAndCta />
      </div>
    </AuthProvider>
  );
}
