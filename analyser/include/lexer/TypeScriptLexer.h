#pragma once

#include "LexerUtils.h"
#include "Token.h"

#include <string>
#include <vector>

namespace cma {

// Tokenizer for the TypeScript front-end (Phase 2a, first of three:
// TS -> JS -> C#). Structurally mirrors JavaLexer -- same CharStream
// scaffolding, same single-char-operator policy -- with the additions
// TS/JS's grammar needs that Java's doesn't:
//   - single-quoted strings are STRING_LITERAL, not CHAR_LITERAL (JS has
//     no char-literal type; 'x' and "x" are the same kind of thing)
//   - backtick template literals, with ${ ... } interpolation tracked by
//     brace depth so a nested object literal inside an interpolation
//     (`${ {a: 1} }`) doesn't prematurely close the literal
//
// Deliberately NOT handled (documented scope limits, same spirit as the
// project's existing per-language approximations):
//   - regex literals: a leading '/' always lexes as OPERATOR division:
//     a regex body will mis-tokenize as an operator/identifier sequence
//     rather than crash. Full regex-vs-division disambiguation needs
//     grammar context this tool doesn't build.
//   - a template literal nested inside another template literal's
//     ${ ... } interpolation isn't tracked as its own literal -- brace
//     depth still balances correctly for the common (non-nested) case.
class TypeScriptLexer {
public:
    explicit TypeScriptLexer(const std::string& source);
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
