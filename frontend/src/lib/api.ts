import type { ScanReport, Violation } from "./report";
import { authHeaders } from "./supabase";

/** Error from our own /api routes. `message` is already safe to show to the user. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Server limit for /api/analyze-file is 2 MB; fail fast on the client. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

const SCAN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isScanId = (v: string | null | undefined): v is string => !!v && SCAN_ID_RE.test(v);

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await res.json();
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
async function postForScanId(
  url: string,
  body: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
       headers: { "Content-Type": "application/json", ...(await authHeaders()), ...extraHeaders },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Could not reach REPO-SIGHT. Check your connection and try again.", 0);
  }
  const data = await readJson(res);
  if (!res.ok) {
    const message =
      typeof data.error === "string" && data.error ? data.error : `Analysis failed (HTTP ${res.status}).`;
    throw new ApiError(message, res.status, typeof data.code === "string" ? data.code : undefined);
  }
  if (!isScanId(typeof data.scanId === "string" ? data.scanId : null)) {
    throw new ApiError("Analysis finished but returned no report id. Please try again.", res.status);
  }
  return data.scanId as string;
}

/** Pass the user's GitHub token to scan a private repo (the API also requires a signed-in session). */
export const analyzeRepo = (repoUrl: string, githubToken?: string) =>
  postForScanId("/api/analyze", { repoUrl }, githubToken ? { "X-GitHub-Token": githubToken } : {});

export const analyzeFile = (filename: string, content: string) =>
  postForScanId("/api/analyze-file", { filename, content });

/** GET /api/scans/:id. The endpoint returns HTTP 200 with status FAILED for missing/forbidden scans. */
export async function fetchScan(scanId: string): Promise<ScanReport> {
  let res: Response;
  try {
    res = await fetch(`/api/scans/${encodeURIComponent(scanId)}`, { headers: await authHeaders() });
  } catch {
    throw new ApiError("Could not reach REPO-SIGHT. Check your connection and try again.", 0);
  }
  const data = await readJson(res);
  if (data.status === "FAILED" || !res.ok) {
    const message =
      typeof data.errorMessage === "string" && data.errorMessage ? data.errorMessage : "Scan not found.";
    throw new ApiError(message, res.status);
  }
  return asReport(data, res.status);
}

function asReport(data: Record<string, unknown>, status: number): ScanReport {
  if (!data.project || !Array.isArray(data.violations) || !Array.isArray(data.files)) {
    throw new ApiError("This report is incomplete or in an unknown format.", status);
  }
  return data as unknown as ScanReport;
}

/** The bundled sample report (frontend/public/demo/report.json, built by scripts/build-demo-report.mjs). Static, so it loads instantly and never touches the scan API. */
export async function fetchDemoReport(): Promise<ScanReport> {
  let res: Response;
  try {
    res = await fetch("/demo/report.json");
  } catch {
    throw new ApiError("Could not load the demo report. Check your connection and try again.", 0);
  }
  if (!res.ok) throw new ApiError("The demo report is unavailable right now.", res.status);
  return asReport(await readJson(res), res.status);
}

export interface ExplainContext {
  repoOwner: string;
  repoName: string;
  repoBranch: string;
}

/** POST /api/explain-finding (signed-in only). `path` must be repo-relative: the server fetches it from GitHub. */
export async function explainFinding(ctx: ExplainContext, v: Violation, repoRelativePath: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/explain-finding", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({
        ...ctx,
        path: repoRelativePath,
        line: v.line,
        ruleId: v.ruleId,
        language: v.language ?? "unknown",
        message: v.message,
        severity: v.severity,
        category: v.category,
      }),
    });
  } catch {
    throw new ApiError("Could not reach REPO-SIGHT. Check your connection and try again.", 0);
  }
  const data = await readJson(res);
  if (!res.ok) {
    const message =
      res.status === 401
        ? "Sign in to use AI explanations."
        : typeof data.error === "string" && data.error
          ? data.error
          : "Could not generate an explanation.";
    throw new ApiError(message, res.status);
  }
  if (typeof data.explanation !== "string" || !data.explanation.trim()) {
    throw new ApiError("Could not generate an explanation.", res.status);
  }
  return data.explanation;
}
