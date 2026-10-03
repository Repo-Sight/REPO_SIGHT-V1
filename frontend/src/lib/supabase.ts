import type { Session, SupabaseClient } from "@supabase/supabase-js";

// Public values. The publishable key is designed to ship to browsers: access is
// enforced by Postgres Row Level Security on user_scans, not by hiding the key.
// Override per environment with VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY.
const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL ?? "https://pktcvyzndrxqgetyyxwu.supabase.co";
const SUPABASE_KEY =
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_VydPRlN9Sd3rJ3lifHCTog_0ulffKcm";

/** GitHub sign-in is offered only once the provider is enabled in Supabase (set VITE_GITHUB_AUTH=true). */
export const GITHUB_AUTH_ENABLED = import.meta.env?.VITE_GITHUB_AUTH === "true";

let clientPromise: Promise<SupabaseClient> | null = null;

/**
 * Lazily loads supabase-js in its own chunk so marketing pages never pay for it.
 * Browser only: this must never run during prerender.
 */
export function getSupabase(): Promise<SupabaseClient> {
  if (typeof window === "undefined") return Promise.reject(new Error("Supabase is browser-only"));
  clientPromise ??= import("@supabase/supabase-js").then((m) => m.createClient(SUPABASE_URL, SUPABASE_KEY));
  return clientPromise;
}

/**
 * Cheap check (no network, no supabase-js load) for "might this visitor be signed in,
 * or just returning from a sign-in link?". Anonymous visitors skip loading the client.
 */
export function mightHaveSession(): boolean {
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i) ?? "";
      if (key.startsWith("sb-") && key.endsWith("-auth-token")) return true;
    }
  } catch {
    // storage blocked: fall through to the URL check
  }
  const url = `${window.location.search}${window.location.hash}`;
  return /[?&#](code|access_token|error_description)=/.test(url);
}

export async function getSession(): Promise<Session | null> {
  if (typeof window === "undefined" || !mightHaveSession()) return null;
  try {
    const sb = await getSupabase();
    const { data } = await sb.auth.getSession();
    return data.session;
  } catch {
    return null;
  }
}
/**
 * GitHub's own user token, used only for private-repo scans. Supabase keeps it on the
 * session until the first token refresh, so a signed-in user can legitimately have none:
 * callers then ask them to reconnect GitHub. Never persisted or logged by us.
 */
export async function githubProviderToken(): Promise<string | null> {
  const token = (await getSession())?.provider_token;
  return token ? token : null;
}


/** Anonymous requests simply carry no Authorization header: an auth hiccup must never block a scan. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = (await getSession())?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
