// Engine version stamped on every stored history row (V3 plan, Phase 2 item 5).
//
// Why: the score is computed by the committed engine, so any change to the rules, thresholds or
// score weights moves scores for repos that did not change at all (adding C, Go or PHP does this
// for repos that contain those files). The trend chart marks each change of this value so a step
// in the line is read as "the engine changed", not "the repo got worse".
//
// How to keep it honest:
//   * Bump ENGINE_VERSION whenever a change under analyser/ can move a score: rules, severity or
//     confidence, thresholds, score weights, a new language.
//   * RULESET_PIN is a hash of the rule ids in the rule catalog. scripts/scan-history.test.mjs
//     fails when the catalog changes without this pin (and so the version) being reviewed, which
//     is the guard against forgetting. Update both together:
//       node -e 'import("./api/_lib/ruleCatalog.js").then(async m=>{const {createHash}=await import("node:crypto");
//         console.log(createHash("sha256").update(Object.keys(m.RULES).sort().join("\n")).digest("hex").slice(0,16))})'
export const ENGINE_VERSION = "3.0";
export const RULESET_PIN = "bcf753e88f74320e";
