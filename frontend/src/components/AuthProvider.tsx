import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { AuthContext, type AuthState, type AuthUser } from "../lib/authContext";
import { getSupabase, mightHaveSession } from "../lib/supabase";
import { AccountModal } from "./AccountModal";

const toUser = (s: Session | null): AuthUser | null => (s ? { id: s.user.id, email: s.user.email ?? null } : null);
const redirectUrl = () => `${window.location.origin}${window.location.pathname}${window.location.search}`;

/**
 * Anonymous visitors never download supabase-js: the client is only attached when a
 * stored session or a sign-in redirect is detected, or when the visitor opens sign-in.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    async function attach() {
      const sb = await getSupabase();
      const { data } = await sb.auth.getSession();
      if (!cancelled) setUser(toUser(data.session));
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

  const signInWithGithub = useCallback(async () => {
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.signInWithOAuth({ provider: "github", options: { redirectTo: redirectUrl() } });
      return error ? error.message || "Could not start GitHub sign-in." : null;
    } catch {
      return "Could not start GitHub sign-in.";
    }
  }, []);

  const sendMagicLink = useCallback(async (email: string) => {
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl() } });
      return error ? error.message || "Could not send the sign-in link. Please try again in a moment." : null;
    } catch {
      return "Could not send the sign-in link. Please try again in a moment.";
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      const sb = await getSupabase();
      await sb.auth.signOut();
    } finally {
      setUser(null);
    }
  }, []);

  const openAccount = useCallback(() => setOpen(true), []);

  const value = useMemo<AuthState>(
    () => ({ ready, user, signInWithGithub, sendMagicLink, signOut, openAccount }),
    [ready, user, signInWithGithub, sendMagicLink, signOut, openAccount],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {open ? <AccountModal onClose={() => setOpen(false)} /> : null}
    </AuthContext.Provider>
  );
}
