import { createContext, useContext } from "react";

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthState {
  /** False until the first session check finishes (always false during prerender). */
  ready: boolean;
  user: AuthUser | null;
  /** Each action resolves to an error message, or null on success. */
  signInWithGithub: () => Promise<string | null>;
  sendMagicLink: (email: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  openAccount: () => void;
}

export const AuthContext = createContext<AuthState>({
  ready: false,
  user: null,
  signInWithGithub: async () => "Sign-in is unavailable.",
  sendMagicLink: async () => "Sign-in is unavailable.",
  signOut: async () => {},
  openAccount: () => {},
});

export const useAuth = () => useContext(AuthContext);
