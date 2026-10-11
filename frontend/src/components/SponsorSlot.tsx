import { SITE, SPONSOR } from "../site";

/**
 * "Supported by" slot: one fixed, flat-fee placement.
 *
 * Plain markup. No script, no ad network, no request to a third party, no
 * tracking. Nothing here is fetched at runtime, so it is also in the
 * prerendered HTML. Naming is deliberate: neither the class (`rs-partner`) nor
 * the logo folder (`/partners/`) uses words that content-blocker lists match on
 * (ad, ads, banner, sponsor), so the slot is not hidden by default.
 *
 * Content comes from SPONSOR in site.ts. While SPONSOR is null the slot shows an
 * "open" card that links to the contact address.
 */
const OPEN_HREF = `mailto:${SITE.contactEmail}?subject=${encodeURIComponent("Supporter slot")}`;

export function SponsorSlot({ compact = false }: { compact?: boolean }) {
  const pad = compact ? "px-3 py-2" : "p-4 sm:p-5";
  return (
    <aside aria-label="Supported by" className={`rs-partner w-full rounded-lg border border-line bg-paper/80 ${pad}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-mono text-[0.65rem] font-bold uppercase tracking-widest text-muted">Supported by</span>
        {SPONSOR ? (
          <>
            <a
              href={SPONSOR.url}
              target="_blank"
              rel="sponsored noopener"
              className="flex min-w-0 items-center gap-3 underline-offset-4 hover:underline"
            >
              {SPONSOR.logo ? (
                <img src={SPONSOR.logo} alt="" height={28} loading="lazy" decoding="async" className="h-7 w-auto max-w-40" />
              ) : null}
              <span className="break-words font-mono text-sm font-bold">{SPONSOR.name}</span>
            </a>
            {SPONSOR.blurb ? <span className="text-sm text-muted">{SPONSOR.blurb}</span> : null}
          </>
        ) : (
          <span className="text-sm">
            This spot is open. Flat monthly fee, fixed placement, no tracking scripts.{" "}
            <a href={OPEN_HREF} className="font-bold underline underline-offset-4">
              Email {SITE.contactEmail}
            </a>
          </span>
        )}
      </div>
    </aside>
  );
}
