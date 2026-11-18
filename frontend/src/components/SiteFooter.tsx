import { FOOTER_COLUMNS } from "../lib/nav";
import { SITE } from "../site";

/**
 * Footer inside each page window. Plain links, so the prerendered HTML is complete.
 *
 * Columns follow the WINDOW width (container queries on the window's `rswin` container), not the screen width: a docked
 * window is ~600px wide on a 1440px screen, so screen breakpoints (`lg:`) gave it four ~105px columns and the long
 * contact email spilled over the "Follow" column. 1 column below 36rem, 2 up to 64rem, 4 from 64rem; the brand block
 * spans the full row until 80rem.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-chrome">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 py-12 @xl:grid-cols-2 @xl:px-6 @5xl:grid-cols-4 @5xl:px-8">
        <div className="min-w-0 @xl:col-span-2 @5xl:col-span-4 @7xl:col-span-1">
          <div className="flex items-center gap-2.5">
            <img src="/apple-touch-icon.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg border border-line" />
            <span className="rs-display text-2xl">{SITE.name}</span>
          </div>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">
            A free static analysis engine for C++, Python, Java, TypeScript, JavaScript, and C#. Built for students, job seekers,
            and indie devs.
          </p>
        </div>
        {FOOTER_COLUMNS.map((col) => (
          <div key={col.title} className="min-w-0">
            <h2 className="text-sm font-semibold">{col.title}</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {col.links.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    className="[overflow-wrap:anywhere] hover:text-ink hover:underline"
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
  );
}
