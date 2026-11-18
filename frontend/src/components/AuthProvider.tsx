import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { AuthContext, type AuthMode, type AuthState, type AuthUser } from "../lib/authContext";
import { getSupabase, mightHaveSession } from "../lib/supabase";
import { requestWelcomeEmail } from "../lib/welcome";
import { AccountModal } from "./AccountModal";
import { SignOutConfirm } from "./SignOutConfirm";

const INTENT_KEY = "rs-auth-intent";
const INTENT_MAX_AGE_MS = 10 * 60 * 1000;
/** created_at and last_sign_in_at this close together means the account was created by this very sign-in. */
const NEW_ACCOUNT_WINDOW_MS = 2 * 60 * 1000;

function clearStoredSession() {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("sb-") && key.endsWith("-auth-token")) window.localStorage.removeItem(key);
    }
  } catch {
    // storage blocked: nothing was stored
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const toUser = (s: Session | null): AuthUser | null => {
  if (!s) return null;
  const meta = s.user.user_metadata ?? {};
  return { id: s.user.id, email: s.user.email ?? null, login: str(meta.user_name) ?? str(meta.preferred_username) };
};
const redirectUrl = () => `${window.location.origin}${window.location.pathname}${window.location.search}`;

/** Remember which button was clicked across the GitHub redirect (same tab only). */
function writeIntent(mode: AuthMode) {
  try {
    window.sessionStorage.setItem(INTENT_KEY, JSON.stringify({ mode, at: Date.now() }));
  } catch {
    // storage blocked: the dialog simply shows no welcome note
  }
}

function takeIntent(): AuthMode | null {
  try {
    const raw = window.sessionStorage.getItem(INTENT_KEY);
    window.sessionStorage.removeItem(INTENT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { mode?: unknown; at?: unknown };
    if (typeof v.at !== "number" || Date.now() - v.at > INTENT_MAX_AGE_MS) return null;
    return v.mode === "signup" || v.mode === "signin" ? v.mode : null;
  } catch {
    return null;
  }
}

function isNewAccount(s: Session): boolean {
  const created = Date.parse(s.user.created_at);
  const last = Date.parse(s.user.last_sign_in_at ?? "");
  return Number.isFinite(created) && Number.isFinite(last) && Math.abs(last - created) < NEW_ACCOUNT_WINDOW_MS;
}

/**
 * GitHub OAuth cannot tell "sign in" from "sign up", so the two buttons share one flow. What differs is
 * the dialog and, when a click does not match reality (a Sign in click that created an account, or a
 * Sign up click by someone who already had one), a one-line note after returning from GitHub.
 */
function welcomeNote(intent: AuthMode, created: boolean): string | null {
  if (intent === "signin" && created) return "No account existed for this GitHub login, so one was created. Welcome.";
  if (intent === "signup" && created) return "Account created. You are signed in with GitHub.";
  if (intent === "signup" && !created) return "You already had an account, so you were signed in.";
  return null;
}

/**
 * Anonymous visitors never download supabase-js: the client is only attached when a
 * stored session or a sign-in redirect is detected, or when the visitor opens sign-in.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("signin");
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    async function attach() {
      const sb = await getSupabase();
      const { data } = await sb.auth.getSession();
      if (!cancelled) {
        setUser(toUser(data.session));
        // Brand-new account only: the server decides whether the one-time welcome email is due.
        if (data.session && isNewAccount(data.session)) requestWelcomeEmail(data.session.access_token, data.session.user.id);
        const intent = data.session ? takeIntent() : null;
        const note = data.session && intent ? welcomeNote(intent, isNewAccount(data.session)) : null;
        if (note) {
          setNotice(note);
          setOpen(true);
        }
      }
      const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
        if (!cancelled) setUser(toUser(session));
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    }

    const done = () => {
      if (!cancelled) setReady(true);
    };
    if (mightHaveSession()) attach().catch(() => {}).then(done);
    else done();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const signInWithGithub = useCallback(async (m: AuthMode = "signin") => {
    try {
      const sb = await getSupabase();
      writeIntent(m === "signup" ? "signup" : "signin");
      // prompt=select_account makes GitHub show its account picker instead of silently reusing whichever
      // account this browser is already signed in to, so the visitor chooses the account (or another one,
      // including signing up for a new GitHub account there). GitHub supports this on its OAuth authorize URL.
      const { error } = await sb.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: redirectUrl(), queryParams: { prompt: "select_account" } },
      });
      return error ? error.message || "Could not start GitHub sign-in." : null;
    } catch {
      return "Could not start GitHub sign-in.";
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      const sb = await getSupabase();
      // "local" ends this browser's session only. The library default ("global") would also sign the
      // user out on every other device they use.
      const { error } = await sb.auth.signOut({ scope: "local" });
      // supabase-js keeps the stored session when the revoke call fails (e.g. offline). The user asked to
      // sign out, so remove it ourselves rather than silently signing them back in on the next page load.
      if (error) clearStoredSession();
    } catch {
      clearStoredSession();
    } finally {
      setUser(null);
    }
  }, []);

  const requestSignOut = useCallback(() => setConfirmingSignOut(true), []);

  const confirmSignOut = useCallback(async () => {
    await signOut();
    setConfirmingSignOut(false);
    setOpen(false);
  }, [signOut]);

  // Some callers pass this straight to onClick, so anything that is not exactly "signup" opens Sign in.
  const openAccount = useCallback((m?: AuthMode) => {
    setMode(m === "signup" ? "signup" : "signin");
    setNotice(null);
    setOpen(true);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ ready, user, signInWithGithub, signOut, requestSignOut, openAccount }),
    [ready, user, signInWithGithub, signOut, requestSignOut, openAccount],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {open ? <AccountModal initialMode={mode} notice={notice} onClose={() => setOpen(false)} /> : null}
      {confirmingSignOut && user ? (
        <SignOutConfirm login={user.login} onConfirm={confirmSignOut} onCancel={() => setConfirmingSignOut(false)} />
      ) : null}
    </AuthContext.Provider>
  );
}
