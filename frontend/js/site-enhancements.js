/* REPO-SIGHT -- cookie consent banner + sticky mobile CTA.
   Vanilla JS, no dependencies. Included on every page via a single
   <script defer src="/js/site-enhancements.js"> tag. */
(function () {
  "use strict";

  var CONSENT_KEY = "rs-cookie-consent"; // "accepted" | "rejected"

  function getConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch (e) {
      return null;
    }
  }

  function setConsent(value) {
    try {
      localStorage.setItem(CONSENT_KEY, value);
    } catch (e) {
      /* localStorage unavailable (private mode, etc.) -- banner will just
         show again next visit, which is an acceptable fallback. */
    }
  }

  /* ---------------------------------------------------------------- */
  /* Cookie consent banner                                             */
  /* ---------------------------------------------------------------- */

  function initCookieBanner() {
    if (getConsent()) return null; // already decided on a prior visit

    var banner = document.createElement("div");
    banner.className = "rs-cookie-banner";
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Cookie consent");
    banner.innerHTML =
      '<p class="rs-cookie-banner__text">' +
      "We use cookies for basic analytics and to show ads. " +
      '<a href="/privacy.html">Privacy policy</a>' +
      "</p>" +
      '<div class="rs-cookie-banner__actions">' +
      '<button type="button" class="btn-ghost" data-consent="rejected">Reject</button>' +
      '<button type="button" class="btn-primary" data-consent="accepted">Accept</button>' +
      "</div>";

    document.body.appendChild(banner);

    banner.addEventListener("click", function (event) {
      var target = event.target.closest("[data-consent]");
      if (!target) return;
      setConsent(target.getAttribute("data-consent"));
      banner.remove();
      initStickyCta(); // banner is gone -- sticky CTA can engage now
    });

    return banner;
  }

  /* ---------------------------------------------------------------- */
  /* Sticky mobile CTA                                                  */
  /* ---------------------------------------------------------------- */

  var stickyCtaInitialized = false;

  function initStickyCta() {
    if (stickyCtaInitialized) return;
    stickyCtaInitialized = true;

    var bar = document.createElement("div");
    bar.className = "rs-sticky-cta";
    bar.innerHTML =
      '<span class="rs-sticky-cta__text">Ready to see your repo\u2019s numbers?</span>' +
      '<a href="/#analyze" class="btn-primary">Analyze a repo</a>';
    document.body.appendChild(bar);

    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        if (window.scrollY > 320) {
          bar.classList.add("is-visible");
        } else {
          bar.classList.remove("is-visible");
        }
        ticking = false;
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------------------------------------------------------------- */
  /* Boot                                                               */
  /* ---------------------------------------------------------------- */

  function boot() {
    var banner = initCookieBanner();
    if (!banner) {
      // Consent already decided on a previous visit -- nothing to stack
      // the sticky bar under, so it can engage immediately.
      initStickyCta();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
