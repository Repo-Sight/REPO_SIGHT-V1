import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { analyzeRepo, ApiError, fetchScan } from "../lib/api";
import { useAuth } from "../lib/authContext";
import type { ScanReport } from "../lib/report";
import { GITHUB_REAUTH_MESSAGE, planRescan } from "../lib/rescan";
import { githubProviderToken } from "../lib/supabase";

interface Props {
  /** The report on screen. Pass this when you have it. */
  report?: ScanReport;
  /** A history row only has the scan id; the report is fetched on click to learn the repo and its visibility. */
  scanId?: string;
  label?: string;
  /** Runs once the new scan exists, just before the page moves to it (the account dialog closes itself here). */
  onDone?: () => void;
}

/**
 * Rescan a repo from a stored scan. It runs the normal scan, which always fetches the repo live
 * from GitHub, then opens the new report; the report's own comparison shows what changed since
 * the previous scan. Private repos use the GitHub token held in the browser session. It is never
 * stored, and if it has expired the user gets the same Reconnect prompt as the scan form.
 */
export function RescanButton({ report, scanId, label = "Rescan", onDone }: Props) {
  const navigate = useNavigate();
  const { signInWithGithub } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnect, setReconnect] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setReconnect(false);
    try {
      const source = report ?? (scanId ? await fetchScan(scanId) : null);
      if (!source) {
        setError("This scan cannot be rescanned.");
        return;
      }
      const plan = planRescan(source);
      if (plan.kind === "unavailable") {
        setError(plan.reason);
        return;
      }
      let githubToken: string | undefined;
      if (plan.kind === "private") {
        githubToken = (await githubProviderToken()) ?? undefined;
        if (!githubToken) {
          setReconnect(true);
          setError(GITHUB_REAUTH_MESSAGE);
          return;
        }
      }
      const newId = await analyzeRepo(plan.repoUrl, githubToken);
      onDone?.();
      navigate({ pathname: "/", search: `?scan=${encodeURIComponent(newId)}` });
    } catch (err) {
      if (err instanceof ApiError && err.code === "github_reauth") setReconnect(true);
      if (alive.current) setError(err instanceof ApiError ? err.message : "Rescan failed. Please try again.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function onReconnect() {
    const err = await signInWithGithub("signin");
    if (err && alive.current) setError(err);
  }

  return (
    <>
      <button type="button" className="rs-btn rs-btn-ghost" onClick={() => void run()} disabled={busy} aria-busy={busy}>
        {busy ? "Rescanning…" : label}
      </button>
      {busy ? (
        <span role="status" className="sr-only">
          Fetching the repo from GitHub and analyzing it. Large repos can take up to a minute.
        </span>
      ) : null}
      {error ? (
        <p role="alert" className="basis-full rounded-md border border-line bg-rose/25 px-3 py-2 text-sm font-semibold">
          {error}
        </p>
      ) : null}
      {reconnect ? (
        <button type="button" className="rs-btn rs-btn-ghost" onClick={() => void onReconnect()}>
          Reconnect GitHub
        </button>
      ) : null}
    </>
  );
}
