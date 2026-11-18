// api/badge/[scanId].js
//
// GET /api/badge/:scanId[.svg]
//
// Flat "code health | A · 92" SVG for a README. Reads the same stored scan as
// api/scans/[scanId].js, but ONLY ever reveals grade + score of PUBLIC scans.
// Private (owner-only) scans, unknown ids and unreadable scans all render the
// identical grey "unavailable" badge, so the badge is not an existence oracle
// and a README embed can never leak a private report.
//
// Colour never carries the meaning alone: the grade letter and score are text.

import { getSupabase } from "../_lib/supabase.js";

const SCAN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const GRADE_COLORS = { A: "#4c1", B: "#97ca00", C: "#dfb317", D: "#fe7d37", F: "#e05d44" };
const GREY = "#9f9f9f";
const LABEL = "code health";

const xmlEscape = s =>
  String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Pure: what a stored payload is allowed to show. Public (or pre-visibility)
// scans with a valid grade only; everything else is "unavailable".
export function badgeModel(payload) {
  const vis = payload?.visibility;
  if (vis !== undefined && vis !== "public") return unavailable();
  const grade = String(payload?.project?.healthGrade ?? "").toUpperCase();
  const score = Number(payload?.project?.healthScore);
  if (!GRADE_COLORS[grade] || !Number.isFinite(score)) return unavailable();
  return { value: `${grade} \u00b7 ${Math.round(score)}`, color: GRADE_COLORS[grade] };
}

function unavailable() {
  return { value: "unavailable", color: GREY };
}

// Pure: shields-style flat badge. ~6.6px per char at Verdana 11px is close
// enough for a two-segment badge; no font metrics dependency.
export function renderBadge(label, value, color) {
  const w = text => Math.round(text.length * 6.6) + 12;
  const lw = w(label);
  const vw = w(value);
  const total = lw + vw;
  const l = xmlEscape(label);
  const v = xmlEscape(value);
  const title = xmlEscape(`${label}: ${value}`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${title}">` +
    `<title>${title}</title>` +
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>` +
    `<clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${total}" height="20" fill="url(#s)"/></g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">` +
    `<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${l}</text><text x="${lw / 2}" y="14">${l}</text>` +
    `<text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${v}</text><text x="${lw + vw / 2}" y="14">${v}</text>` +
    `</g></svg>`
  );
}

// Accept both /api/badge/<uuid> and /api/badge/<uuid>.svg
export function parseBadgeId(raw) {
  const id = String(Array.isArray(raw) ? raw[0] : raw ?? "").replace(/\.svg$/i, "");
  return SCAN_ID_RE.test(id) ? id : null;
}

function send(res, status, svg, cache) {
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", cache);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  res.status(status).send(svg);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.status(405).json({ error: "Method not allowed. Use GET." });
    return;
  }

  const id = parseBadgeId(req.query?.scanId);
  if (!id) {
    send(res, 400, renderBadge(LABEL, "invalid id", GREY), "public, max-age=60");
    return;
  }

  let model = unavailable();
  let cache = "public, max-age=60, s-maxage=60";
  try {
    const supabase = getSupabase();
    // Private scans live under "private/": deliberately never looked up here.
    const { data, error } = await supabase.storage.from("scans").download(`${id}.json`);
    if (!error && data) {
      model = badgeModel(JSON.parse(await data.text()));
      // Scans are immutable once written, so a found badge can be cached longer.
      if (model.color !== GREY) cache = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
    }
  } catch (err) {
    console.error("Badge fetch error:", err?.message || err);
  }
  send(res, 200, renderBadge(LABEL, model.value, model.color), cache);
}
