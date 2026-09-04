#pragma once
 
#include "Language.h"
#include "lexer/CppLexer.h"
#include "lexer/JavaLexer.h"
#include "lexer/PythonLexer.h"
#include "lexer/Token.h"
#include "parser/CppParser.h"
#include "parser/JavaParser.h"
#include "parser/ParseResult.h"
#include "parser/PythonParser.h"
#include "parser/TypeScriptParser.h"

#include <string>
#include <vector>
 
namespace cma {
 
// Switch-based tag dispatch from a Language value to the concrete
// per-language Lexer. This is the one place that knows about every
// language front-end; adding a language means adding one `case` here
// (and the corresponding *Lexer type), not touching any existing lexer
// or the orchestration code in main.cpp.
//
// Phase 1: a single case (Cpp). Phase 2 added Python. Phase 3 adds Java
// the same way.
[[nodiscard]] inline std::vector<Token> tokenizeSource(
    Language lang, const std::string& source) {
    switch (lang) {
        case Language::Cpp: {
            CppLexer lexer(source);
            return lexer.tokenize();
        }
        case Language::Python: {
            PythonLexer lexer(source);
            return lexer.tokenize();
        }
        case Language::Java: {
            JavaLexer lexer(source);
            return lexer.tokenize();
        }
      case Language::TypeScript: {
            TypeScriptLexer lexer(source);
            return lexer.tokenize();
        }
    }
    return {}; // unreachable while every Language enumerator has a case
               // above; kept so a future enumerator added without a
               // matching case fails loudly (empty tokens) rather than
               // relying on undefined switch fallthrough.
}
 
// Switch-based tag dispatch from a Language value to the concrete
// per-language Parser. Both per-language Parsers already target the same
// FileMetrics contract, so this is the only place that needs to know all
// of them exist.
[[nodiscard]] inline FileMetrics parseTokens(
    Language lang, const std::vector<Token>& tokens, int totalLines) {
    switch (lang) {
        case Language::Cpp: {
            CppParser parser(tokens, totalLines);
            return parser.analyze();
        }
        case Language::Python: {
            PythonParser parser(tokens, totalLines);
            return parser.analyze();
        }
        case Language::Java: {
            JavaParser parser(tokens, totalLines);
            return parser.analyze();
        }
             case Language::TypeScript: {
            TypeScriptParser parser(tokens, totalLines);
            return parser.analyze();
        }
    }
    return {}; // unreachable, same rationale as tokenizeSource() above
}
 
} // namespace cma
 
