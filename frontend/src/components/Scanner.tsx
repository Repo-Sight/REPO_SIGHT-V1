import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { analyzeFile, analyzeRepo, ApiError, MAX_FILE_BYTES } from "../lib/api";
import { useAuth } from "../lib/authContext";
import { GITHUB_AUTH_ENABLED, githubProviderToken } from "../lib/supabase";
type Mode = "repo" | "file";

const FILE_ACCEPT = ".cpp,.cc,.cxx,.c,.h,.hpp,.py,.java,.ts,.tsx,.js,.jsx,.mjs,.cjs,.cs";

const inputClass =
  "w-full rounded-md border border-line bg-white px-3 py-2.5 font-mono text-sm shadow-soft-sm placeholder:text-ink/50";
const tabClass = (active: boolean) =>
  `rounded-md border border-line px-3 py-1.5 font-mono text-xs font-bold sm:text-sm ${
    active ? "bg-ink text-white shadow-soft-sm" : "bg-white hover:bg-chrome"
  }`;

/**
 * Scan form. Both modes POST to our API, then navigate to /?scan=<id> (the same
 * URL shape existing shared reports already use). Works anonymously; sign-in
 * and private repos arrive with the auth step.
 */
export function Scanner() {
  const navigate = useNavigate();
  const { user, signInWithGithub, openAccount } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("repo");
  const [repoUrl, setRepoUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [privateScan, setPrivateScan] = useState(false);
  const [reconnect, setReconnect] = useState(false);
  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("That file is over 2 MB. Pick a single source file, or scan the whole repo instead.");
      e.target.value = "";
      return;
    }
    setError(null);
    setFilename(file.name);
    setContent(await file.text());
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setReconnect(false);

    if (mode === "repo") {
      if (!/^https?:\/\/github\.com\/[^/\s]+\/[^/\s]+/i.test(repoUrl.trim())) {
        setError("Enter a GitHub repo URL, e.g. https://github.com/owner/repo");
        return;
      }
    } else {
      if (!filename.trim()) {
        setError("Add a file name with its extension (e.g. app.py) so REPO-SIGHT knows the language.");
        return;
      }
      if (!content.trim()) {
        setError("Paste some code or choose a file first.");
        return;
      }
      if (new Blob([content]).size > MAX_FILE_BYTES) {
        setError("That is over 2 MB. Analyze a single source file, or scan the whole repo instead.");
        return;
      }
    }

    setBusy(true);
    try {
       let githubToken: string | undefined;
       if (mode === "repo" && privateScan) {
        githubToken = (await githubProviderToken()) ?? undefined;
        if (!githubToken) {
          setReconnect(true);
          setError("Your GitHub connection has expired. Sign in with GitHub again to scan private repos.");
          setBusy(false);
          return;
        }
      }
      const scanId =
      mode === "repo" ? await analyzeRepo(repoUrl.trim(), githubToken) : await analyzeFile(filename.trim(), content);
        navigate({ pathname: "/", search: `?scan=${encodeURIComponent(scanId)}` });
    } catch (err) {
      if (err instanceof ApiError && err.code === "github_reauth") setReconnect(true);
      setError(err instanceof ApiError ? err.message : "Analysis failed. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-4" aria-busy={busy}>
      <div role="group" aria-label="What to analyze" className="flex flex-wrap gap-2">
        <button type="button" className={tabClass(mode === "repo")} aria-pressed={mode === "repo"} onClick={() => setMode("repo")}>
          GitHub repo
        </button>
        <button type="button" className={tabClass(mode === "file")} aria-pressed={mode === "file"} onClick={() => setMode("file")}>
          Paste or upload a file
        </button>
      </div>

      {mode === "repo" ? (
        <div className="space-y-2">
          <label htmlFor="rs-repo-url" className="block font-mono text-xs font-bold uppercase tracking-widest">
            Public GitHub repository
          </label>
          <input
            id="rs-repo-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://github.com/owner/repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            disabled={busy}
            className={inputClass}
          />
           {GITHUB_AUTH_ENABLED ? (
            user ? (
              <label className="flex items-center gap-2 font-mono text-xs">
                <input
                  type="checkbox"
                 checked={privateScan}
                 onChange={(e) => setPrivateScan(e.target.checked)}
                  disabled={busy}
                  className="h-4 w-4 rounded-md border border-line"
                />
                Private repo (uses your GitHub sign-in; the token is never stored)
             </label>
           ) : (
              <p className="font-mono text-xs text-ink/70">
                Private repo?{" "}
                <button type="button" className="font-bold underline" onClick={openAccount}>
                  Sign in with GitHub
                </button>{" "}
                to scan it.
              </p>
            )
          ) : null}
       </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <label htmlFor="rs-filename" className="block font-mono text-xs font-bold uppercase tracking-widest">
                File name
              </label>
              <input
                id="rs-filename"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="app.py"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                disabled={busy}
                className={inputClass}
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                className="rs-btn"
                onClick={() => fileInput.current?.click()}
                disabled={busy}
              >
                Choose file
              </button>
              <input ref={fileInput} type="file" accept={FILE_ACCEPT} onChange={onPickFile} className="sr-only" tabIndex={-1} aria-hidden="true" />
            </div>
          </div>
          <label htmlFor="rs-code" className="block font-mono text-xs font-bold uppercase tracking-widest">
            Source code
          </label>
          <textarea
            id="rs-code"
            rows={9}
            spellCheck={false}
            placeholder="Paste code here, or choose a file above"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={busy}
            className={`${inputClass} resize-y`}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="rs-btn" disabled={busy}>
          {busy ? "Analyzing…" : "Analyze now"}
        </button>
         <button
          type="button"
          className="rs-btn rs-btn-ghost"
          disabled={busy}
          onClick={() => navigate({ pathname: "/", search: "?demo=1" })}
        >
          Try a demo report
        </button>
        <p className="font-mono text-xs text-ink/70">Free. No signup. Your code is never executed.</p>
      </div>

      <p role="status" aria-live="polite" className="font-mono text-xs text-ink/70">
        {busy ? "Fetching and analyzing. Large repos can take up to a minute." : ""}
      </p>
      {error ? (
        <p role="alert" className="rounded-md border border-line bg-red-100 px-3 py-2 text-sm font-semibold">
          {error}
        </p>
      ) : null}
    </form>
  );
}
