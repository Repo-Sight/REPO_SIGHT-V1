// Single source for absolute URLs and the one canonical contact address.
export const SITE = {
  name: "REPO-SIGHT",
  url: "https://www.repo-sight.com",
  ogImage: "https://www.repo-sight.com/og-image.png",
  contactEmail: "contact.reposight@gmail.com",
  adClient: "ca-pub-9503894064247817",
  consentKey: "rs-cookie-consent",
} as const;

/**
 * The single "Supported by" partner shown by <SponsorSlot />.
 * null = slot is open (the slot shows an "open" card linking to contactEmail).
 * To fill it: set the fields below. Put the logo in frontend/public/partners/
 * (self-hosted, no remote images) and reference it as "/partners/<file>".
 * Do not put "ad", "ads", "banner" or "sponsor" in the logo file name or path:
 * content blockers match on those words.
 */
export type Partner = {
  name: string;
  url: `https://${string}`;
  blurb?: string;
  logo?: `/partners/${string}`;
};
export const SPONSOR: Partner | null = null;
