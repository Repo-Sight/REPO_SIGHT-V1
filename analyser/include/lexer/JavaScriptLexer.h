#pragma once

#include "LexerUtils.h"
#include "Token.h"

#include <string>
#include <vector>

namespace cma {

// Tokenizer for the JavaScript front-end (Phase 2a, second of three:
// TS -> JS -> C#). Derived directly from TypeScriptLexer -- identical
// CharStream scaffolding, identical string/template-literal/number/
// comment handling, since none of that is TS-specific. The only
// difference from TypeScriptLexer is the keyword set (see kKeywords in
// the .cpp): TS-only contextual keywords used exclusively for type
// declarations (interface, enum, namespace, module, declare, readonly,
// abstract, override, satisfies, keyof, infer, is, out, unique,
// asserts, type, implements, private, protected, public, as) are
// dropped, since plain JavaScript has no type-annotation grammar for
// them to matter to -- they'd just lex as ordinary IDENTIFIER tokens on
// real JS source, which is the correct behavior.
//
// Deliberately NOT handled (same documented scope limits as
// TypeScriptLexer, inherited unchanged since neither is TS-specific):
//   - regex literals: a leading '/' always lexes as OPERATOR division.
//   - a template literal nested inside another template literal's
//     ${ ... } interpolation isn't tracked as its own literal.
class JavaScriptLexer {
public:
    explicit JavaScriptLexer(const std::string& source);
    [[nodiscard]] std::vector<Token> tokenize();

private:
    Token lexIdentifierOrKeyword();
    Token lexNumber();
    Token lexDoubleQuotedString();
    Token lexSingleQuotedString();
    Token lexTemplateLiteral();
    Token lexLineComment();
    Token lexBlockComment();
    Token lexSymbol();

    char cur()                  const noexcept { return m_stream.cur(); }
    char peekAt(int offset = 1) const noexcept { return m_stream.peekAt(offset); }
    char advance()                noexcept     { return m_stream.advance(); }
    bool atEnd()                const noexcept { return m_stream.atEnd(); }

    [[nodiscard]] bool isKeyword(const std::string& word) const noexcept;
    [[nodiscard]] static bool isIdentChar(char c) noexcept;
    [[nodiscard]] static bool isIdentStart(char c) noexcept;

    CharStream m_stream;
};

} // namespace cma
