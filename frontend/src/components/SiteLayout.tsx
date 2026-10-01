import { useState } from "react";
import { Outlet } from "react-router-dom";
import { SITE } from "../site";
import { ConsentAndCta } from "./ConsentAndCta";

const NAV = [
  { href: "/#pipeline", label: "How it works" },
  { href: "/#features", label: "What you get" },
  { href: "/learn/", label: "Learn" },
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
      {
        href: "https://www.instagram.com/reposight?igsi=OW96ZzdxeDR2N3Y4&utm_source=ig_contact_invite",
        label: "Instagram",
        external: true,
      },
      { href: "https://www.linkedin.com/company/reposight/", label: "LinkedIn", external: true },
    ],
  },
];

export function SiteLayout() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="rs-skip">
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b-2 border-black bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <a href="/" className="flex items-center gap-2.5" aria-label={`${SITE.name} home`}>
            <img
              src="/apple-touch-icon.png"
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 rounded-lg border-2 border-black"
            />
            <span className="font-mono text-lg font-black tracking-tight">{SITE.name}</span>
          </a>

          <nav
            id="site-nav"
            aria-label="Main"
            className={`${open ? "flex" : "hidden"} absolute left-0 right-0 top-full flex-col gap-1 border-b-2 border-black bg-white p-4 md:static md:flex md:flex-row md:items-center md:gap-6 md:border-0 md:p-0 md:ml-6`}
          >
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="rs-navlink" onClick={() => setOpen(false)}>
                {n.label}
              </a>
            ))}
          </nav>

          <a href="/#analyze" className="rs-btn ml-auto hidden sm:inline-block">
            Analyze a repo
          </a>
          <button
            type="button"
            className="ml-auto border-2 border-black bg-white p-2 shadow-brutal-sm sm:ml-0 md:hidden"
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
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <Outlet />
      </main>

      <footer className="border-t-2 border-black bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
          <div className="lg:col-span-4 xl:col-span-1">
            <div className="flex items-center gap-2.5">
              <img src="/apple-touch-icon.png" alt="" width={36} height={36} className="h-9 w-9 rounded-lg border-2 border-black" />
              <span className="font-mono text-lg font-black tracking-tight">{SITE.name}</span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink/80">
              A free static analysis engine for C++, Python, Java, TypeScript, JavaScript, and C#. Built for
              students, job seekers, and indie devs.
            </p>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <h2 className="font-mono text-xs font-bold uppercase tracking-widest">{col.title}</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      className="rs-navlink"
                      {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
                {col.title === "Legal" ? <li className="text-ink/70">Apache 2.0 License</li> : null}
              </ul>
            </div>
          ))}
        </div>
      </footer>

      <ConsentAndCta />
    </div>
  );
}
