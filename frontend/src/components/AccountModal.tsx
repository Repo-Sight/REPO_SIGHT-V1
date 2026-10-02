import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/authContext";
import { listMyScans, type ScanRow } from "../lib/history";
import { GITHUB_AUTH_ENABLED } from "../lib/supabase";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])';

export function AccountModal({ onClose }: { onClose: () => void }) {
  const { user, signInWithGithub, sendMagicLink, signOut } = useAuth();
  const panel = useRef<HTMLDivElement>(null);

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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rs-account-title"
        className="w-full max-w-md border-2 border-black bg-white p-5 shadow-brutal"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="rs-account-title" className="font-mono text-lg font-black">
            {user ? "Your account" : "Sign in"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="border-2 border-black px-2 font-mono font-black hover:bg-chrome">
            ×
          </button>
        </div>
        {user ? (
          <SignedIn email={user.email} onClose={onClose} onSignOut={signOut} />
        ) : (
          <SignedOut signInWithGithub={signInWithGithub} sendMagicLink={sendMagicLink} />
        )}
      </div>
    </div>
  );
}

function SignedOut({
  signInWithGithub,
  sendMagicLink,
}: {
  signInWithGithub: () => Promise<string | null>;
  sendMagicLink: (email: string) => Promise<string | null>;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function onMagic(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    setSent(null);
    const err = await sendMagicLink(value);
    setBusy(false);
    if (err) setError(err);
    else setSent(value);
  }

  async function onGithub() {
    setError(null);
    const err = await signInWithGithub();
    if (err) setError(err);
  }

  return (
    <div className="mt-3 space-y-4">
      <p className="text-sm">
        Signing in is optional. It saves your last 5 scans, shows what changed since your previous scan, and unlocks AI
        explanations of findings.
      </p>
      {GITHUB_AUTH_ENABLED ? (
        <>
          <button type="button" className="rs-btn w-full" onClick={onGithub}>
            Continue with GitHub
          </button>
          <p className="text-center font-mono text-xs text-ink/70">or</p>
        </>
      ) : null}
      <form onSubmit={onMagic} className="space-y-2">
        <label htmlFor="rs-magic-email" className="block font-mono text-xs font-bold uppercase tracking-widest">
          Email me a sign-in link
        </label>
        <input
          id="rs-magic-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          placeholder="you@example.com"
          className="w-full border-2 border-black bg-white px-3 py-2 font-mono text-sm"
        />
        <button type="submit" className="rs-btn rs-btn-ghost w-full" disabled={busy}>
          {busy ? "Sending…" : "Send link"}
        </button>
      </form>
      <p role="status" aria-live="polite" className="text-sm font-semibold">
        {sent ? `Check ${sent} for a sign-in link.` : ""}
      </p>
      {error ? (
        <p role="alert" className="border-2 border-black bg-red-100 px-3 py-2 text-sm font-semibold">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SignedIn({ email, onClose, onSignOut }: { email: string | null; onClose: () => void; onSignOut: () => Promise<void> }) {
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
      <p className="break-all font-mono text-xs">{email ?? "Signed in"}</p>
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
                  className="flex flex-wrap items-center justify-between gap-2 border-2 border-black p-2 hover:bg-chrome"
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
