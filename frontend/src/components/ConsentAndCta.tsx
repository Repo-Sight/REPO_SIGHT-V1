import { useEffect, useState } from "react";
import { SITE } from "../site";

type Consent = "accepted" | "rejected";

function readConsent(): Consent | null {
  try {
    const v = localStorage.getItem(SITE.consentKey);
    return v === "accepted" || v === "rejected" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Cookie banner + sticky "Analyze" bar, ported from the live site's
 * site-enhancements.js. Renders nothing until after mount, so the prerendered
 * HTML and the first client render match (no hydration mismatch).
 */
export function ConsentAndCta() {
  const [mounted, setMounted] = useState(false);
  const [consent, setConsent] = useState<Consent | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    setConsent(readConsent());
    setMounted(true);
     // The window body scrolls, not the page. Scroll events don't bubble, so listen in the capture phase.
    const onScroll = (e: Event) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el && !el.classList.contains("rs-win-body")) return;
      setScrolled((el ? el.scrollTop : window.scrollY) > 320);
    };
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);

  const decide = (value: Consent) => {
    try {
      localStorage.setItem(SITE.consentKey, value);
    } catch {
      /* storage unavailable: banner just closes for this visit */
    }
    setConsent(value);
  };

  if (!mounted) return null;

  return (
    <>
      {consent === null ? (
        <div className="rs-cookie-banner" role="region" aria-label="Cookie consent">
          <p>
            We use cookies for basic analytics and to show ads. <a href="/privacy.html">Privacy policy</a>
          </p>
          <div className="rs-cookie-actions">
            <button type="button" className="rs-btn rs-btn-ghost" onClick={() => decide("rejected")}>
              Reject
            </button>
            <button type="button" className="rs-btn" onClick={() => decide("accepted")}>
              Accept
            </button>
          </div>
        </div>
      ) : (
        <div className={`rs-sticky-cta${scrolled ? " is-visible" : ""}`}>
          <span>Ready to see your repo&rsquo;s numbers?</span>
          <a href="/#analyze" className="rs-btn">
            Analyze a repo
          </a>
        </div>
      )}
    </>
  );
}
