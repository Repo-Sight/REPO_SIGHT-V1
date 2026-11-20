/**
 * Phase 0 usage events (retention baseline). Fire-and-forget: a tracking failure must never
 * affect the page. The server decides what is stored; sign_in needs a valid access token,
 * and scan_completed is recorded server-side, not from the browser.
 */
export function trackBadgeCopied(scanId: string): void {
  send({ name: "badge_copied", scanId });
}

export function trackSignIn(accessToken: string): void {
  send({ name: "sign_in" }, accessToken);
}

function send(body: Record<string, string>, accessToken?: string): void {
  try {
    fetch("/api/event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}
