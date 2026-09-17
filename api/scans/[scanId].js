// api/scans/[scanId].js
//
// GET /api/scans/:scanId
//
// Reads `${scanId}.json` from the Supabase `scans` storage bucket
// (written by api/analyze.js) and returns it as-is.

import { getSupabase } from "../_lib/supabase.js";
// analyze.js only ever names scan objects with crypto.randomUUID() (v4).
// Validating that shape here means this endpoint can only ever look up
// keys that our own analyze step could have created -- it can't be used
// to fetch arbitrary "<anything>.json" out of the scans bucket.
const SCAN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  const { scanId } = req.query;

  if (!scanId || typeof scanId !== "string") {
    res.status(400).json({ status: "FAILED", errorMessage: "Missing scan id." });
    return;
  }
  if (!SCAN_ID_RE.test(scanId)) {
    res.status(400).json({ status: "FAILED", errorMessage: "Invalid scan id." });
    return;
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.storage.from("scans").download(`${scanId}.json`);
    if (error || !data) {
      res.status(200).json({ status: "FAILED", errorMessage: "Scan not found." });
      return;
    }

    const text = await data.text();
    const payload = JSON.parse(text);
    res.status(200).json(payload);
  } catch (err) {
    console.error("Scan fetch error:", err);
    res.status(200).json({
      status: "FAILED",
      errorMessage: err?.message || "Could not retrieve scan.",
    });
  }
}
