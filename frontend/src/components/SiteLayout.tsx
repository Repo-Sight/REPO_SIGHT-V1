import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { SITE } from "../site"; 
import { AppWindow, type WindowPhase } from "./AppWindow";
import { AuthMenu } from "./AuthMenu";
import { AuthProvider } from "./AuthProvider";
import { ConsentAndCta } from "./ConsentAndCta";
import { Desktop } from "./DesktopIcons";

// Window timings, same as the CSS animations (index.css).
const OPEN_MS = 200;
const CLOSE_MS = 150;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
/** Window title: the app name on the home route, otherwise the page file name. */
function windowTitle(pathname: string): string {
  return pathname === "/" || pathname === "" ? SITE.name : windowLabel(pathname);
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
const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;

export function SiteLayout() {
const [menuOpen, setMenuOpen] = useState(false);
  // Window state. The first render (= the prerendered HTML) is always: open, windowed, idle.
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [phase, setPhase] = useState<WindowPhase>("idle");
  const [mobile, setMobile] = useState(false);
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
  const scroller = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.clearTimeout(timer.current);
    };
  }, []);

  /** Open a closed window. Animates only here (a click on the bare desktop), never on first load or page swaps. */
  const openWindow = useCallback((animate: boolean) => {
    window.clearTimeout(timer.current);
    setOpen(true);
    if (animate && !reducedMotion()) {
      setPhase("in");
      timer.current = window.setTimeout(() => setPhase("idle"), OPEN_MS);
    } else {
      setPhase("idle");
    }
  }, []);

  /** Close: play the exit animation, remove the window, and land on the bare desktop at "/". */
  const closeWindow = useCallback(() => {
    if (!open || phase === "out") return;
    window.clearTimeout(timer.current);
    setPhase("out");
    timer.current = window.setTimeout(
      () => {
        setOpen(false);
        setExpanded(false);
        setPhase("idle");
        if (pathname !== "/") navigate("/");
      },
      reducedMotion() ? 0 : CLOSE_MS,
    );
  }, [open, phase, pathname, navigate]);

  const toggleExpanded = useCallback(() => {
    if (open && phase !== "out") setExpanded((v) => !v);
  }, [open, phase]);

  // Landing on a page by back/forward while the desktop is bare brings the window back (no animation).
  useEffect(() => {
    if (!open && pathname !== "/") openWindow(false);
  }, [pathname, open, openWindow]);

  // A page swap starts at the top of the window (or at the #anchor); the window itself never moves.
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
    else if (scroller.current) scroller.current.scrollTop = 0;
  }, [pathname, hash]);

  // Keyboard, as on posthog.com: Shift+Up expand/restore, Shift+W close, Shift+X close all (one window here).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || TYPING.test(t.tagName))) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        toggleExpanded();
      } else if (e.key === "W" || e.key === "X") {
        e.preventDefault();
        closeWindow();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleExpanded, closeWindow]);

  // Same-site page links swap the window's content instead of reloading, so the window keeps its state.
  const onLinkClick = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return;
    const url = new URL(a.href, window.location.href);
    const isPage = url.pathname === "/" || url.pathname.endsWith(".html") || url.pathname.endsWith("/");
    if (url.origin !== window.location.origin || !isPage) return;
    if (open && url.pathname === pathname && url.hash && !url.search) return; // in-page anchor
    e.preventDefault();
    setMenuOpen(false);
    if (!open) openWindow(true);
    navigate({ pathname: url.pathname, search: url.search, hash: url.hash });
  };

  return (
    <AuthProvider>
      <div id="app-container" className="flex h-dvh flex-col p-2" onClick={onLinkClick}>
        <a href="#main" className="rs-skip">
          Skip to content
        </a>

        <header className="relative z-40 shrink-0">        
         <div
            id="taskbar"
         className="flex h-[42px] items-center gap-2 rounded-lg border border-line bg-paper/90 px-2 shadow-soft-lg backdrop-blur"
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
       className={`${menuOpen ? "flex" : "hidden"} absolute left-0 right-0 top-full mt-1 flex-col gap-1 rounded-lg border border-line bg-paper p-3 shadow-soft-lg md:static md:mt-0 md:flex md:flex-1 md:flex-row md:items-center md:gap-1 md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none`} 
              >
              {NAV.map((n) => (
       <a key={n.href} href={n.href} className="rs-navlink" onClick={() => setMenuOpen(false)}>
                {n.label}
                </a>
              ))}
              <details className="rs-menu">
                <summary className="rs-navlink">Languages</summary>
                <div className="rs-menu-panel">
                  {LANGUAGES.map((l) => (
  <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}>
    {l.label} analyzer
                    </a>
                  ))}
                </div>
              </details>
            </nav>

        {/* "Open window" chip: the current page, like a task in a taskbar. Hidden while the desktop is bare. */}
            {open ? (
              <span
                className="ml-auto hidden max-w-[16rem] items-center gap-2 truncate rounded-lg border border-line bg-chrome px-2.5 py-0.5 text-sm font-medium lg:flex"
                aria-hidden="true"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-signal" />
                <span className="truncate">{windowLabel(pathname)}</span>
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Clock />
              <AuthMenu />
              <a href="/#analyze" className="rs-btn hidden !py-1 sm:inline-block"> 
               Analyze a repo
              </a>
              <button
                type="button"
               className="rounded-md border border-line bg-paper p-1.5 md:hidden"
                aria-label="Toggle menu"
                aria-expanded={menuOpen}            
                aria-controls="site-nav"
                onClick={() => setMenuOpen((v) => !v)}   
                >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <line x1="3" y1="7" x2="21" y2="7" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="17" x2="21" y2="17" />
                </svg>
              </button>
            </div>
          </div>
        </header>

       {/* Desktop viewport: icons underneath, the window layer on top, everything clipped to this box. */}
        <div className="relative min-h-0 flex-1 overflow-clip">
          <Desktop covered={open && (expanded || mobile)} />
          <div data-app="WindowList" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            {open ? (
              <AppWindow
                title={windowTitle(pathname)}
                expanded={expanded}
                phase={phase}
                wide={pathname === "/"}
                onToggleExpand={toggleExpanded}
                onClose={closeWindow}
                scrollerRef={scroller}
              >
                <main id="main" className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
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
              </AppWindow>
            ) : null}
           </div>

        </div>
          </div>
        <ConsentAndCta />
      </div>
    </AuthProvider>
  );
}
