#pragma once

#include "lexer/Token.h"
#include "parser/ParseResult.h"
#include "metrics/ViolationReport.h"

#include <string>
#include <vector>

namespace cma {

// C rule catalog (V3 plan, Phase 1 item 4). Operates purely on the token stream the C dialect of
// CppLexer produced and the FileMetrics CppParser computed, like every other language catalog.
// The language-independent slop gates and provider-token scrubbing are added by RuleDispatch.h.
//
// Security (category "security"):
//   c-sec-unsafe-buffer-fn      gets / strcpy / strcat / sprintf / vsprintf
//   c-sec-system-call           system(...)
//   c-sec-popen-call            popen(...)
//   c-sec-weak-random           rand / srand / random / srandom
//   c-sec-weak-hash             MD5 / SHA1 (and the OpenSSL EVP / *_Init spellings)
//   c-sec-hardcoded-secret      NAME = "literal" where NAME looks like a credential
//   c-sec-format-string         printf-family call whose format argument is a plain variable
//   c-sec-unsafe-scanf          scanf-family call with an unbounded %s / %[ conversion
//   c-sec-insecure-temp-file    tmpnam / tempnam / mktemp
// Memory and macros:
//   c-malloc-unchecked          pointer dereferenced in the statement right after malloc/calloc/realloc/strdup
//   c-realloc-self-assign       p = realloc(p, n): the old block leaks when realloc fails
//   c-macro-multi-statement     function-like #define expanding to several statements without do { } while (0)
// General:
//   c-magic-number-literal      numeric literal other than 0/1 inside an if/while condition
//   c-long-function             functions[].lineCount() > 100
//   c-deep-nesting              file-level maxNestingDepth > 6
//   c-todo-without-ticket       TODO/FIXME with no #123 or PROJ-123 reference
[[nodiscard]] std::vector<Violation> checkCRules(
    const std::string& path, const std::vector<Token>& tokens, const FileMetrics& fm);

} // namespace cma
