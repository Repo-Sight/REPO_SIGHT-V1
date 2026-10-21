import { useAuth } from "../lib/authContext";

const BTN = "shrink-0 !px-2.5 !py-1.5 !text-xs sm:!px-3 sm:!text-sm";

/** Header control. Renders nothing until the first session check completes (so prerendered HTML is unchanged). */
export function AuthMenu() {
  const { ready, user, openAccount } = useAuth();
  if (!ready) return null;
  if (user) {
    return (
      <button type="button" className={`rs-btn rs-btn-ghost ${BTN}`} onClick={() => openAccount()}>
        My scans
      </button>
    );
  }
  return (
    <>
      <button type="button" className={`rs-btn rs-btn-ghost ${BTN}`} onClick={() => openAccount("signin")}>
        Sign in
      </button>
      {/* Wrapper hides it on very narrow phones: the unlayered .rs-btn display rule would beat a `hidden` utility on the button itself.
          The dialog's "New here? Sign up" link covers those screens. */}
      <span className="hidden min-[400px]:inline-block">
        <button type="button" className={`rs-btn ${BTN}`} onClick={() => openAccount("signup")}>
          Sign up
        </button>
      </span>
    </>
  );
}
