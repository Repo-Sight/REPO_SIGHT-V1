#pragma once

#include "common/Language.h"
#include "lexer/Token.h"
#include "metrics/ViolationReport.h"
#include "parser/ParseResult.h"

#include <string>
#include <vector>

namespace cma {

// "AI code slop" gates. Two deterministic, language-independent checks that
// run for every supported language after that language's own rule catalog
// (wired in rules/RuleDispatch.h's checkRules()):
//
//   <lang>-complex-function         a single function whose cyclomatic
//                                   complexity is over 10 (nested functions
//                                   are measured separately, not added to
//                                   their parent)
//   <lang>-unreviewed-placeholder   a comment that reads like an AI-assistant
//                                   leftover or an unfinished placeholder
//                                   ("... rest of the code remains", "your
//                                   code here", "as an AI language model")
//
// Long functions (over 100 lines) already have a per-language rule
// (cpp-long-function, py-long-function, java-long-method, ...), so they are
// not duplicated here.
//
// Per-function complexity is derived from tokens using the same decision
// points each language's parser counts for the file-level figure, so the two
// numbers agree.
[[nodiscard]] std::vector<Violation> checkSlopRules(
    Language lang, const std::string& path,
    const std::vector<Token>& tokens, const FileMetrics& fm);

} // namespace cma
