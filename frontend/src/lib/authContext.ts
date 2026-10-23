import { createContext, useContext } from "react";

/** Which entry the visitor clicked. GitHub OAuth itself is the same flow for both. */
export type AuthMode = "signin" | "signup";

export interface AuthUser {
  id: string;
  email: string | null;
  /** GitHub username, from the sign-in profile. */
  login: string | null;
}

export interface AuthState {
  /** False until the first session check finishes (always false during prerender). */
  ready: boolean;
  user: AuthUser | null;
  /** GitHub is the only sign-in. Resolves to an error message, or null when the redirect to GitHub started. */
  signInWithGithub: (mode?: AuthMode) => Promise<string | null>;
  /** Ends the session immediately, with no prompt. UI should call requestSignOut instead. */
  signOut: () => Promise<void>;
  /** Opens the "Sign out?" confirmation; the session ends only if the user confirms. */
  requestSignOut: () => void;
  /** Opens the account dialog on the Sign in or Sign up view (anything else opens Sign in). */
  openAccount: (mode?: AuthMode) => void;
}

export const AuthContext = createContext<AuthState>({
  ready: false,
  user: null,
  signInWithGithub: async () => "Sign-in is unavailable.",
  signOut: async () => {},
  requestSignOut: () => {},
  openAccount: () => {},
});

export const useAuth = () => useContext(AuthContext);
