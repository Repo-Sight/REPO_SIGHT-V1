#pragma once

#include "common/Language.h"
#include "lexer/Token.h"
#include "metrics/ViolationReport.h"

#include <string>
#include <vector>

namespace cma {

// Provider-token scrubbing. One deterministic, language-independent check that
// runs for every supported language after that language's own rule catalog
// (wired in rules/RuleDispatch.h's checkRules()):
//
//   <lang>-sec-secret-token   a string literal that contains a live-looking
//                             API token with a well-known, fixed format:
//                               Anthropic  sk-ant-...
//                               OpenAI     sk-..., sk-proj-..., sk-svcacct-...
//                               AWS        AKIA... / ASIA... access key IDs
//                               GitHub     ghp_/gho_/ghu_/ghs_/ghr_..., github_pat_...
//
// Unlike <lang>-sec-hardcoded-secret (which keys off a suspicious variable
// NAME), this matches the token's own FORMAT, so it also catches keys that sit
// in a config object, an argument or an unnamed constant. Matching is
// high-precision on purpose: a left word boundary, a minimum body length,
// character-class checks and a placeholder filter ("xxxx", "example", ...).
//
// The report NEVER repeats the matched value -- reports are shareable pages,
// PDFs and badges, and must not become a second place the secret is leaked.
// The message names only the provider and the fixed public prefix.
[[nodiscard]] std::vector<Violation> checkSecretRules(
    Language lang, const std::string& path, const std::vector<Token>& tokens);

} // namespace cma
