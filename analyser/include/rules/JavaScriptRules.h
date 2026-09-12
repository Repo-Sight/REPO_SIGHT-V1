#pragma once

#include "lexer/Token.h"
#include "parser/ParseResult.h"
#include "metrics/ViolationReport.h"

#include <string>
#include <vector>

namespace cma {

// JavaScript anti-pattern / best-practice rule catalog -- Phase 2a
// (6 rules, same "token stream + FileMetrics only" contract as
// CppRules.h/JavaRules.h/PythonRules.h/TypeScriptRules.h).
//
// Derived directly from TypeScriptRules' 7 rules, minus ts-explicit-any:
// that rule flags ': any' type annotations and 'as any' assertions,
// neither of which are valid JavaScript grammar -- plain JS has no type
// system for 'any' to discard, so there's no equivalent to check for.
// The remaining 6 all apply unchanged to plain JS:
//
// Rules:
//   js-empty-catch-block   empty catch (e) { } or catch { } body
//                          (JS allows the optional-catch-binding form)
//   js-var-usage           legacy 'var' instead of 'let'/'const'
//   js-loose-equality      '==' / '!=' instead of '===' / '!=='
//   js-long-method         same threshold as TS's/Java's/C++'s
//   js-deep-nesting        same threshold as TS's/Java's/C++'s
//   js-todo-without-ticket same shape as TS's/Java's/C++'s
[[nodiscard]] std::vector<Violation> checkJavaScriptRules(
    const std::string& path, const std::vector<Token>& tokens, const FileMetrics& fm);

} // namespace cma
