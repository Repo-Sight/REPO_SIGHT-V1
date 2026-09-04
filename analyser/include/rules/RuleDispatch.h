#pragma once
 
#include "common/Language.h"
#include "lexer/Token.h"
#include "parser/ParseResult.h"
#include "metrics/ViolationReport.h"
#include "rules/CppRules.h"
#include "rules/PythonRules.h"
#include "rules/JavaRules.h" 
#include "rules/TypeScriptRules.h"

#include <string>
#include <vector>
 
namespace cma {
 
// Switch-based tag dispatch from a Language value to the concrete
// per-language rule catalog -- mirrors common/LanguageDispatch.h's
// tokenizeSource()/parseTokens() shape exactly. Adding a fourth
// language's rule catalog means adding one case here.
[[nodiscard]] inline std::vector<Violation> checkRules(
    Language lang, const std::string& path,
    const std::vector<Token>& tokens, const FileMetrics& fm) {
    switch (lang) {
        case Language::Cpp:    return checkCppRules(path, tokens, fm);
        case Language::Python: return checkPythonRules(path, tokens, fm);
        case Language::Java:   return checkJavaRules(path, tokens, fm);
    }
    return {};
}
 
} // namespace cma
 
