import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DialogWindow } from "./DialogWindow";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])';
const CLOSE_MS = 250;

/**
 * Asks before ending the session. Cancel is focused first, so a stray Enter or Space never signs anyone out.
 * Rendered above the account dialog (z-[60] vs z-50) because Sign out can be pressed from inside it.
 */
export function SignOutConfirm({
  login,
  onConfirm,
  onCancel,
}: {
  login: string | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  // A ref, not state: two clicks in the same tick must not both pass the guard.
  const submitted = useRef(false);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelButton.current?.focus();
    return () => opener?.focus?.();
  }, []);

  function cancel() {
    if (closing || busy) return;
    setClosing(true);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    timer.current = window.setTimeout(onCancel, reduced ? 0 : CLOSE_MS);
  }

  async function confirm() {
    if (closing || submitted.current) return;
    submitted.current = true;
    setBusy(true);
    // The provider unmounts this dialog once the session is gone.
    await onConfirm();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel();
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
    <DialogWindow
      title="sign-out.dlg"
      icon="lock"
      role="alertdialog"
      labelledBy="rs-signout-title"
      describedBy="rs-signout-desc"
      closing={closing}
      top
      size="sm"
      panelRef={panel}
      onDismiss={cancel}
      onKeyDown={onKeyDown}
      closeDisabled={busy}
      closeLabel="Cancel"
    >
      <h2 id="rs-signout-title" className="font-mono text-lg font-black">
        Sign out?
      </h2>
      <p id="rs-signout-desc" className="mt-2 text-sm">
        {login ? `You will be signed out of REPO-SIGHT as @${login} on this browser. ` : "You will be signed out of REPO-SIGHT on this browser. "}
        Your saved scans stay in your account, and you can sign back in with GitHub any time.
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button ref={cancelButton} type="button" className="rs-btn rs-btn-ghost" onClick={cancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="rs-btn" onClick={() => void confirm()} disabled={busy}>
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </DialogWindow>
  );
}
