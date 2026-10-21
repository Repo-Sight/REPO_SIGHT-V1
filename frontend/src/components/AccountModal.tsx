import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth, type AuthMode } from "../lib/authContext";
import { listMyScans, type ScanRow } from "../lib/history";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])';

const MODAL_CLOSE_MS = 250;
export function AccountModal({ initialMode, notice, onClose: unmount }: { initialMode: AuthMode; notice: string | null; onClose: () => void }) {
  const { user, signInWithGithub, signOut } = useAuth();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const panel = useRef<HTMLDivElement>(null);
   const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Exit animation first (panel slides up and fades, overlay fades), then unmount. Every close path goes through here.
  const onClose = () => {
    if (closing) return;
    setClosing(true);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    timer.current = window.setTimeout(unmount, reduced ? 0 : MODAL_CLOSE_MS);
  };

  // Move focus in on open, restore it to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => opener?.focus?.();
  }, []);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
    className="rs-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2"
      data-closing={closing}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rs-account-title"
      data-closing={closing}
        className="rs-modal w-full max-w-md rounded-lg border border-line bg-white p-5 shadow-soft-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="rs-account-title" className="font-mono text-lg font-black">
            {user ? "Your account" : mode === "signup" ? "Create your account" : "Sign in"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md border border-line px-2 font-mono font-black hover:bg-chrome">
            ×
          </button>
        </div>
        {user ? (
          <SignedIn email={user.email} login={user.login} notice={notice} onClose={onClose} onSignOut={signOut} />
        ) : (
          <SignedOut mode={mode} setMode={setMode} signInWithGithub={signInWithGithub} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function SignedOut({
  mode,
  setMode,
  signInWithGithub,
  onClose,
}: {
  mode: AuthMode;
  setMode: (m: AuthMode) => void;
  signInWithGithub: (mode?: AuthMode) => Promise<string | null>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signup = mode === "signup";

  async function onGithub() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await signInWithGithub(mode);
    // On success the browser is already leaving for GitHub, so only a failure needs the button back.
    if (err) {
      setError(err);
      setBusy(false);
    }
  }

  function flip(next: AuthMode) {
    setError(null);
    setMode(next);
  }

  return (
    <div className="mt-3 space-y-4">
      {signup ? (
        <>
          <p className="text-sm">
            Signing up is free and optional: public scans never need an account. With one you get:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>Your last 5 scans, saved</li>
            <li>What changed since your previous scan of the same repo</li>
            <li>AI explanations of findings</li>
            <li>Private repo scans (these always need a GitHub sign-in)</li>
          </ul>
        </>
      ) : (
        <p className="text-sm">Welcome back. Sign in with GitHub to see your last 5 scans and scan private repos.</p>
      )}
      <button type="button" className="rs-btn w-full" onClick={() => void onGithub()} disabled={busy}>
        {busy ? "Opening GitHub…" : signup ? "Sign up with GitHub" : "Sign in with GitHub"}
      </button>
      {signup ? (
        <p className="text-xs text-ink/70">
          By signing up you agree to the{" "}
          <Link to="/terms.html" onClick={onClose} className="font-bold underline">
            Terms of Use
          </Link>{" "}
          and{" "}
          <Link to="/privacy.html" onClick={onClose} className="font-bold underline">
            Privacy Policy
          </Link>
          . We only receive your GitHub email and public profile (username, avatar).
        </p>
      ) : null}
      <p className="text-center text-sm">
        {signup ? "Already have an account?" : "New here?"}{" "}
        <button type="button" className="font-bold underline" onClick={() => flip(signup ? "signin" : "signup")}>
          {signup ? "Sign in" : "Sign up"}
        </button>
      </p>
      {error ? (
        <p role="alert" className="rounded-md border border-line bg-rose/25 px-3 py-2 text-sm font-semibold">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SignedIn({
  email,
  login,
  notice,
  onClose,
  onSignOut,
}: {
  email: string | null;
  login: string | null;
  notice: string | null;
  onClose: () => void;
  onSignOut: () => Promise<void>;
}) {
  const [rows, setRows] = useState<ScanRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listMyScans()
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mt-3 space-y-4">
      {notice ? (
        <p role="status" className="rounded-md border border-line bg-chrome px-3 py-2 text-sm font-semibold">
          {notice}
        </p>
      ) : null}
      <p className="break-all font-mono text-xs">{[login ? `@${login}` : null, email].filter(Boolean).join(" · ") || "Signed in"}</p>
      <section aria-labelledby="rs-myscans">
        <h3 id="rs-myscans" className="font-mono text-sm font-black">
          My scans
        </h3>
        {failed ? (
          <p role="alert" className="mt-2 text-sm">
            Could not load your scan history right now.
          </p>
        ) : rows === null ? (
          <p role="status" className="mt-2 text-sm">
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="mt-2 text-sm">No scans yet. Run one while signed in and it will show up here.</p>
        ) : (
          <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">
            {rows.map((r) => (
              <li key={r.scan_id}>
                <Link
                  to={{ pathname: "/", search: `?scan=${encodeURIComponent(r.scan_id)}` }}
                  onClick={onClose}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-2 hover:bg-chrome"
                >
                  <span className="min-w-0 break-all font-mono text-sm font-bold">{r.project_name}</span>
                  <span className="font-mono text-xs">
                    {r.health_grade ?? "—"}
                    {r.health_score != null ? ` ${Math.round(r.health_score)}` : ""} · {new Date(r.scanned_at).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <button type="button" className="rs-btn rs-btn-ghost w-full" onClick={() => void onSignOut().then(onClose)}>
        Sign out
      </button>
    </div>
  );
}
