import type { ReactNode } from "react";

interface OSWindowProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  id?: string;
}

/**
 * Static window frame for content routes. Stateless on purpose: no close or
 * minimize state and no entrance animation, so the prerendered HTML always
 * holds the full content (crawlers see what users see). Interactive
 * scanner/report windows get their own controls later.
 */
export function OSWindow({ title, subtitle, children, className = "", id }: OSWindowProps) {
  return (
    <section id={id} className={`border-2 border-black bg-parchment shadow-brutal-lg ${className}`}>
      <div className="flex items-center gap-3 border-b-2 border-black bg-chrome px-4 py-2.5 select-none">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="h-3.5 w-3.5 rounded-full border border-black/60 bg-[#ff5f56]" />
          <span className="h-3.5 w-3.5 rounded-full border border-black/60 bg-[#ffbd2e]" />
          <span className="h-3.5 w-3.5 rounded-full border border-black/60 bg-ok" />
        </div>
        <div className="flex min-w-0 items-center gap-2 font-mono text-xs font-semibold sm:text-sm">
          <span className="truncate">{title}</span>
          {subtitle ? <span className="hidden truncate text-ink/70 md:inline">/ {subtitle}</span> : null}
        </div>
      </div>
      <div className="p-4 sm:p-6 lg:p-8">{children}</div>
    </section>
  );
}

/** Renders a verbatim legacy HTML fragment. data-rs-content marks it for the parity gate. */
export function Html({ html, className = "" }: { html: string; className?: string }) {
  return (
    <div
      className={`rs-prose ${className}`}
      data-rs-content=""
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
