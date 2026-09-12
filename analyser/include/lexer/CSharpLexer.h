#pragma once

#include "LexerUtils.h"
#include "Token.h"

#include <string>
#include <vector>

namespace cma {

// Tokenizer for the C# front-end (Phase 2a, third and last of three:
// TS -> JS -> C#). Structurally mirrors JavaLexer -- same CharStream
// scaffolding, same identifier/number/comment scanning, same
// single-char-operator policy, real char-literal type (unlike JS/TS) --
// since C# is nominally-typed and class-based like Java, not
// structurally-typed like TS/JS. What C#'s grammar needs on top of
// Java's shape:
//   - verbatim strings: `@"..."` -- no backslash escaping; a doubled
//     quote `""` inside represents one literal `"`; may span multiple
//     lines literally (unlike a plain string, which stops at a raw
//     newline the same way JavaLexer's does).
//   - interpolated strings: `$"...{expr}..."`, and the combined
//     verbatim+interpolated forms `$@"..."` / `@$"..."`. `{expr}` holes
//     are tracked via a brace-depth counter (same technique
//     TypeScriptLexer uses for template-literal `${ }`), with a nested
//     string literal inside a hole skipped as a unit so its own quotes
//     can't prematurely close the outer interpolated string and its own
//     braces can't desync the depth counter. Doubled `{{` / `}}` outside
//     any hole are literal-brace escapes, not the start of a hole.
//   - verbatim identifiers: `@class`, `@if`, `@namespace` -- `@`
//     immediately followed by an identifier-start character escapes a
//     reserved word for use as an ordinary name. Lexed as a single
//     IDENTIFIER token (the `@` included in its value, matching how the
//     source spells it) and never promoted to KEYWORD even if the text
//     after `@` matches one -- that's the feature's entire purpose.
//   - preprocessor directives (`#if`, `#region`, `#pragma`, `#nullable`,
//     etc.) -- reuses CppLexer's line-based lexPreprocessor() approach
//     (a PREPROCESSOR token spans to the next un-escaped newline),
//     since C#'s directives are line-oriented the same way C's are.
//
// Deliberately NOT handled (documented scope limits, same spirit as the
// project's existing per-language approximations):
//   - raw string literals (`"""..."""`, C# 11+) -- not recognized; a
//     leading `"` in that position lexes as an ordinary (empty, since
//     the next two chars are also `"`) string followed by more tokens
//     rather than crashing.
//   - a string literal nested inside another interpolated string's
//     `{ }` hole that is *itself* interpolated isn't given special
//     handling beyond the generic nested-string skip described above --
//     matches TypeScriptLexer's equivalent template-literal-nesting
//     limitation.
//   - LINQ query-expression contextual keywords (from/select/group/into/
//     orderby/join/let/on/equals/by/ascending/descending) are lexed as
//     ordinary IDENTIFIER, not promoted to always-KEYWORD the way Java/
//     TS treat their own contextual sets. Chosen deliberately: these
//     particular words collide with extremely common ordinary
//     identifier/property/parameter usage outside query-expression
//     position (`select`, `on`, `by`, `let` are all plausible variable
//     names) far more than TS's contextual set does, and this tool
//     doesn't hook into any of them for a parser feature, so promoting
//     them would only add collision risk with no benefit.
//
//     `where` is the one deliberate exception: also LINQ-contextual, but
//     promoted to always-KEYWORD anyway because CSharpParser needs it as
//     a real KEYWORD token to recognize a generic type-parameter
//     constraint clause (`Method<T>(...) where T : IComparable<T>`) --
//     see CSharpParser.h's skipTrailingSpecifiers(). Its identifier-
//     collision risk is low in practice (unlike `select`/`on`/`by`,
//     hardly anyone names a variable `where`).
//   - Unicode escape sequences in identifiers (`\uXXXX`) -- not
//     unescaped; vanishingly rare in real C# source.
class CSharpLexer {
public:
    explicit CSharpLexer(const std::string& source);
    [[nodiscard]] std::vector<Token> tokenize();

private:
    Token lexIdentifierOrKeyword();
    Token lexVerbatimIdentifier();
    Token lexNumber();
    Token lexCharLiteral();
    Token lexRegularString();
    Token lexVerbatimString();
    Token lexInterpolatedString(bool verbatim);
    Token lexLineComment();
    Token lexBlockComment();
    Token lexPreprocessor();
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
