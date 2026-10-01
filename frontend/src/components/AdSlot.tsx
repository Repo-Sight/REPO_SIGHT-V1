import { useEffect, useRef } from "react";
import { SITE } from "../site";

type AdQueue = unknown[] & { requestNonPersonalizedAds?: number };

/** Same behaviour as the live site: non-personalized ads unless consent was accepted. */
export function AdSlot({ slot = "8550818093" }: { slot?: string }) {
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current) return;
    pushed.current = true;
    const w = window as unknown as { adsbygoogle?: AdQueue };
    w.adsbygoogle = w.adsbygoogle || ([] as AdQueue);
    try {
      if (localStorage.getItem(SITE.consentKey) !== "accepted") {
        w.adsbygoogle.requestNonPersonalizedAds = 1;
      }
    } catch {
      /* storage unavailable: keep default */
    }
    try {
      w.adsbygoogle.push({});
    } catch {
      /* ad script blocked or slot already filled */
    }
  }, []);

  return (
    <div className="rs-ad-slot" data-ad-region="mid-page" aria-label="Advertisement">
      <span className="rs-ad-label">Advertisement</span>
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={SITE.adClient}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
