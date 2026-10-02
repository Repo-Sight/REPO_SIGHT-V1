import { useAuth } from "../lib/authContext";

/** Header control. Renders nothing until the first session check completes (so prerendered HTML is unchanged). */
export function AuthMenu() {
  const { ready, user, openAccount } = useAuth();
  if (!ready) return null;
  return (
    <button type="button" className="rs-btn rs-btn-ghost shrink-0 !px-3 !py-1.5 !text-xs sm:!text-sm" onClick={openAccount}>
      {user ? "My scans" : "Sign in"}
    </button>
  );
}
