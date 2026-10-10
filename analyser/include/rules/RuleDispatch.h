#pragma once

#include "common/Language.h"
#include "lexer/Token.h"
#include "parser/ParseResult.h"
#include "metrics/ViolationReport.h"
#include "rules/CppRules.h"
#include "rules/PythonRules.h"
#include "rules/JavaRules.h"
#include "rules/TypeScriptRules.h"
#include "rules/JavaScriptRules.h"
#include "rules/CSharpRules.h"
#include "rules/SlopRules.h"
#include "rules/SecretRules.h"

#include <algorithm>
#include <iterator>
#include <string>
#include <utility>
#include <vector>

namespace cma {

// Switch-based tag dispatch from a Language value to the concrete
// per-language rule catalog -- mirrors common/LanguageDispatch.h's
// tokenizeSource()/parseTokens() shape exactly. Adding a language's rule
// catalog means adding one case here.
[[nodiscard]] inline std::vector<Violation> checkLanguageRules(
    Language lang, const std::string& path,
    const std::vector<Token>& tokens, const FileMetrics& fm) {
    switch (lang) {
        case Language::Cpp:        return checkCppRules(path, tokens, fm);
        case Language::Python:     return checkPythonRules(path, tokens, fm);
        case Language::Java:       return checkJavaRules(path, tokens, fm);
        case Language::TypeScript: return checkTypeScriptRules(path, tokens, fm);
        case Language::JavaScript: return checkJavaScriptRules(path, tokens, fm);
        case Language::CSharp:     return checkCSharpRules(path, tokens, fm);
    }
    return {};
}

// True for a language's name-based "hardcoded secret" rule.
[[nodiscard]] inline bool isGenericSecretRule(const std::string& ruleId) {
    static const std::string kSuffix = "-sec-hardcoded-secret";
    return ruleId.size() >= kSuffix.size() &&
           ruleId.compare(ruleId.size() - kSuffix.size(), kSuffix.size(), kSuffix) == 0;
}

// Every file's violations: the language's own catalog first, then the
// language-independent slop gates (rules/SlopRules.h) and provider-token
// scrubbing (rules/SecretRules.h) appended after it so the per-language
// ordering is undisturbed.
//
// A provider-token finding supersedes the name-based hardcoded-secret finding
// on the same line: `OPENAI_API_KEY = "sk-..."` is ONE leaked key, so it is
// reported once, by the more specific (high-confidence) rule.
[[nodiscard]] inline std::vector<Violation> checkRules(
    Language lang, const std::string& path,
    const std::vector<Token>& tokens, const FileMetrics& fm) {
    std::vector<Violation> out = checkLanguageRules(lang, path, tokens, fm);

    std::vector<Violation> slop = checkSlopRules(lang, path, tokens, fm);
    out.insert(out.end(), std::make_move_iterator(slop.begin()),
               std::make_move_iterator(slop.end()));

    std::vector<Violation> secrets = checkSecretRules(lang, path, tokens);
    if (!secrets.empty()) {
        out.erase(std::remove_if(out.begin(), out.end(),
                                 [&](const Violation& v) {
                                     if (!isGenericSecretRule(v.ruleId)) return false;
                                     for (const Violation& s : secrets) {
                                         if (s.line == v.line) return true;
                                     }
                                     return false;
                                 }),
                  out.end());
        out.insert(out.end(), std::make_move_iterator(secrets.begin()),
                   std::make_move_iterator(secrets.end()));
    }
    return out;
}

} // namespace cma
