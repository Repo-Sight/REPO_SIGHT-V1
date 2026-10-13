import { FOOTER_COLUMNS } from "../lib/nav";
import { SITE } from "../site";

/** Footer inside each page window. Plain links, so the prerendered HTML is complete. */
export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-chrome">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
        <div className="lg:col-span-4 xl:col-span-1">
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
  );
}
