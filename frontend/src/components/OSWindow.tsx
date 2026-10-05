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
 * holds the full content (crawlers see what users see). The controls are
 * decorative (aria-hidden). Interactive scanner/report windows get their own
 * controls later.
 */
export function OSWindow({ title, subtitle, children, className = "", id }: OSWindowProps) {
  return (
    <section id={id} className={`overflow-hidden rounded-xl border border-line bg-paper shadow-soft-lg ${className}`}>
      <div className="flex items-center gap-3 border-b border-line bg-chrome px-4 py-2 select-none">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-signal" aria-hidden="true" />
          <span className="truncate">{title}</span>
          {subtitle ? <span className="hidden truncate font-normal text-muted md:inline">/ {subtitle}</span> : null}
        </div>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-4 rounded-sm border border-line bg-paper" />
          <span className="h-2.5 w-2.5 rounded-sm border border-line bg-paper" />
          <span className="h-2.5 w-2.5 rounded-full border border-line bg-paper" />
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
