// api/rules.js
//
// GET /api/rules
// Optional filters: ?language=python|cpp|java|javascript|typescript|csharp
//                   ?category=security|style
//
// Serves the rule catalog (api/_lib/ruleCatalog.js): every analyser rule's
// tier, confidence and plain-English what / why / fix. Static, public and
// cacheable -- it contains nothing user-specific -- so the SPA, the report
// view and any future /rules SEO pages can all read one source of truth.
import { listRules, TIERS, CONFIDENCES } from "./_lib/ruleCatalog.js";

const LANGUAGES = new Set(["cpp", "python", "java", "javascript", "typescript", "csharp"]);
const CATEGORIES = new Set(["security", "style"]);

const first = v => (Array.isArray(v) ? v[0] : v);

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed. Use GET." });
    return;
  }

  const language = first(req.query?.language);
  const category = first(req.query?.category);

  if (language !== undefined && !LANGUAGES.has(language)) {
    res.status(400).json({ error: `Unknown language. Use one of: ${[...LANGUAGES].join(", ")}.` });
    return;
  }
  if (category !== undefined && !CATEGORIES.has(category)) {
    res.status(400).json({ error: "Unknown category. Use security or style." });
    return;
  }

  const rules = listRules().filter(
    r => (!language || r.language === language) && (!category || r.category === category)
  );

  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).json({
    catalogVersion: 1,
    tiers: TIERS,
    confidences: CONFIDENCES,
    count: rules.length,
    rules,
  });
}
