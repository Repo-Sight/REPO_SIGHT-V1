import { useEffect, useState } from "react";
import { GLYPHS } from "./DesktopIcons";

/**
 * Sticky "Analyze" bar. Name kept so SiteLayout's import is unchanged.
 *
 * Ad consent is NOT handled here. Visitors in the EEA, UK and Switzerland get
 * Google's certified consent message (AdSense dashboard -> Privacy & messaging),
 * which is the only consent UI for ads. The old custom Accept/Reject banner was
 * removed: its "Reject" never stopped the ad script, so it controlled nothing.
 *
 * Renders nothing until after mount so prerendered HTML and the first client
 * render match (no hydration mismatch).
 */
export function ConsentAndCta() {
  const [mounted, setMounted] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
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

  if (!mounted) return null;

  return (
    <div className={`rs-sticky-cta${scrolled ? " is-visible" : ""}`}>
      <span className="rs-sticky-cta-label">
        <span className="rs-title-icon inline-grid shrink-0 place-items-center [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">
          {GLYPHS.scan}
        </span>
        <span>Ready to see your repo&rsquo;s numbers?</span>
      </span>
      <a href="/#analyze" className="rs-btn">
        Analyze a repo
      </a>
    </div>
  );
}
