const KEY_PREFIX = "rs-welcome-requested:";

/**
 * Asks the server to send the one-time welcome email after a brand-new account signs in.
 * The server is the authority (it checks account age, verified address and a sent marker),
 * so this is a hint, never a guarantee: it is fire-and-forget and must never affect sign-in.
 * The local marker only avoids repeat calls from the same browser.
 */
export function requestWelcomeEmail(accessToken: string, userId: string): void {
  const key = `${KEY_PREFIX}${userId}`;
  try {
    if (window.localStorage.getItem(key)) return;
  } catch {
    // storage blocked: the server still guarantees one email at most
  }
  fetch("/api/welcome", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    keepalive: true,
  })
    .then((res) => {
      // Server errors (5xx) stay retryable on the next page load inside the account-age window.
      if (res.status >= 500) return;
      try {
        window.localStorage.setItem(key, "1");
      } catch {
        // ignore
      }
    })
    .catch(() => {});
}
