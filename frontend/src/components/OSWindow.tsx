import type { ReactNode } from "react";
 * A flat content block inside the desktop window (the window chrome itself is
 * AppWindow, owned by SiteLayout). Plain markup, so prerendered HTML holds the
 * full content.
 */
   export function Block({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`rounded-lg border border-line bg-paper/80 p-4 sm:p-6 lg:p-8 ${className}`}>
    {children}
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
