import type { ScanReport } from "./report";

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

async function postForScanId(url: string, body: Record<string, string>): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

export const analyzeRepo = (repoUrl: string) => postForScanId("/api/analyze", { repoUrl });

export const analyzeFile = (filename: string, content: string) =>
  postForScanId("/api/analyze-file", { filename, content });

/** GET /api/scans/:id. The endpoint returns HTTP 200 with status FAILED for missing/forbidden scans. */
export async function fetchScan(scanId: string): Promise<ScanReport> {
  let res: Response;
  try {
    res = await fetch(`/api/scans/${encodeURIComponent(scanId)}`);
  } catch {
    throw new ApiError("Could not reach REPO-SIGHT. Check your connection and try again.", 0);
  }
  const data = await readJson(res);
  if (data.status === "FAILED" || !res.ok) {
    const message =
      typeof data.errorMessage === "string" && data.errorMessage ? data.errorMessage : "Scan not found.";
    throw new ApiError(message, res.status);
  }
  if (!data.project || !Array.isArray(data.violations) || !Array.isArray(data.files)) {
    throw new ApiError("This report is incomplete or in an unknown format.", res.status);
  }
  return data as unknown as ScanReport;
}
