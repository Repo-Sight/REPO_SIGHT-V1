// api/scans/[scanId].js
//
// GET /api/scans/:scanId[?format=sarif|json]
//
// format=sarif  SARIF 2.1.0 (GitHub code scanning, coding agents); format=json  the report with
// repo-relative paths. Both go through exactly the same access check as the plain report.
//
// Reads `${scanId}.json` from the Supabase `scans` storage bucket
// (written by api/analyze.js) and returns it as-is.
//
// Phase C: scans of PRIVATE repos (visibility:"private") are owner-only.
// The scan id is an unguessable UUID but it is still just a link -- links
// get pasted, shared, and leaked -- so for private scans the id alone is
// never enough: the caller must present a valid Supabase session whose
// user id equals the scan's ownerId. Anyone else gets the same "Scan not
// found." a nonexistent id returns (no existence oracle). Public and
// pre-Phase-C scans (no visibility field) are served exactly as before.

import { getSupabase, getUserFromRequest } from "../_lib/supabase.js";
import { enrichReport } from "../_lib/enrich.js";
import { getRepoLatest, parseRepoParams } from "../_lib/repoLatest.js";
import { buildJsonExport, buildSarif } from "../_lib/sarif.js";
// analyze.js only ever names scan objects with crypto.randomUUID() (v4).
// Validating that shape here means this endpoint can only ever look up
// keys that our own analyze step could have created -- it can't be used
// to fetch arbitrary "<anything>.json" out of the scans bucket.
const SCAN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Pure access rule, exported for tests. Fail closed: a private scan with no
// ownerId, or an unknown visibility value, is treated as private-to-nobody.
export function canViewScan(payload, user) {
  const visibility = payload?.visibility;
  if (visibility === undefined || visibility === "public") return true;
  if (visibility === "private") {
    return Boolean(user && payload.ownerId && user.id === payload.ownerId);
  }
  return false;
}

export default async function handler(req, res) {
  const { scanId } = req.query;

  if (!scanId || typeof scanId !== "string") {
    res.status(400).json({ status: "FAILED", errorMessage: "Missing scan id." });
    return;
  }
  // GET /api/scans/latest?owner=<o>&repo=<r> (the repo scorecard): resolves to the latest PUBLIC
  // scan of that repo, then goes through exactly the same checks below.
  const wantsLatest = scanId === "latest";
  if (!wantsLatest && !SCAN_ID_RE.test(scanId)) {
    res.status(400).json({ status: "FAILED", errorMessage: "Invalid scan id." });
    return;
  }
  
  const rawFormat = Array.isArray(req.query?.format) ? req.query.format[0] : req.query?.format;
  const format = rawFormat === undefined || rawFormat === "" ? null : String(rawFormat).toLowerCase();
  if (format !== null && format !== "sarif" && format !== "json") {
    res.status(400).json({ status: "FAILED", errorMessage: "Unknown format. Use sarif or json." });
    return;
  }

  try {
    const supabase = getSupabase();
    let id = scanId;
    if (wantsLatest) {
      const key = parseRepoParams(req.query?.owner, req.query?.repo);
      const latest = key ? await getRepoLatest(supabase, key) : null;
      if (!latest) {
        res.status(200).json({ status: "FAILED", errorMessage: "Scan not found." });
        return;
      }
      id = latest.scan_id;
    }
    // Public/legacy scans sit at the bucket root; owner-only scans of private
    // repos sit under "private/" (see api/analyze.js). Both go through the
    // same canViewScan() gate below.
    let { data, error } = await supabase.storage.from("scans").download(`${id}.json`);
    if (error || !data) {
      ({ data, error } = await supabase.storage.from("scans").download(`private/${id}.json`));
    }
    if (error || !data) {
      res.status(200).json({ status: "FAILED", errorMessage: "Scan not found." });
      return;
    }

    const text = await data.text();
    const payload = JSON.parse(text);

    if (!canViewScan(payload, await getUserFromRequest(req, supabase))) {
      res.setHeader("Cache-Control", "private, no-store");
      res.status(200).json({ status: "FAILED", errorMessage: "Scan not found." });
      return;
    }
    if (payload.visibility === "private") {
      // Never let a shared cache (CDN/proxy) hold an owner-only report.
      res.setHeader("Cache-Control", "private, no-store");
    }

    // Scans stored before schema v3 have no tier/confidence/fixFirst;
    // derive them on read (idempotent -- v3 scans pass through untouched).
    enrichReport(payload);
    if (wantsLatest && payload.visibility !== "private") res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
    if (format) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `attachment; filename="repo-sight-${id}.${format === "sarif" ? "sarif" : "json"}"`);
      if (format === "sarif") {
        res.setHeader("Content-Type", "application/sarif+json; charset=utf-8");
        res.status(200).send(JSON.stringify(buildSarif(payload)));
      } else {
        res.status(200).json(buildJsonExport(payload));
      }
      return;
    }
    res.status(200).json(payload);
  } catch (err) {
    console.error("Scan fetch error:", err);
    res.status(200).json({
      status: "FAILED",
      errorMessage: err?.message || "Could not retrieve scan.",
    });
  }
}
