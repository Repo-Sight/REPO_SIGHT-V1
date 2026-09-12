#include "lexer/CSharpLexer.h"

#include <cctype>
#include <unordered_set>

namespace cma {

// True reserved words plus the curated contextual set explained in
// CSharpLexer.h's header comment. LINQ query keywords other than
// `where` are deliberately excluded -- see that comment for why.
static const std::unordered_set<std::string> kKeywords = {
    "abstract","as","base","bool","break","byte",
    "case","catch","char","checked","class","const","continue",
    "decimal","default","delegate","do","double",
    "else","enum","event","explicit","extern",
    "false","finally","fixed","float","for","foreach",
    "goto",
    "if","implicit","in","int","interface","internal","is",
    "lock","long",
    "namespace","new","null",
    "object","operator","out","override",
    "params","private","protected","public",
    "readonly","ref","return",
    "sbyte","sealed","short","sizeof","stackalloc","static","string","struct","switch",
    "this","throw","true","try","typeof",
    "uint","ulong","unchecked","unsafe","ushort","using",
    "virtual","void","volatile",
    "while",
    // Curated contextual keywords (see header comment).
    "var","dynamic","async","await","yield","partial","get","set","value",
    "add","remove","nameof","record","init","required","global","with",
    "when","unmanaged","notnull","alias","where"
};

CSharpLexer::CSharpLexer(const std::string& source) : m_stream(source) {}

bool CSharpLexer::isIdentStart(char c) noexcept {
    return std::isalpha(static_cast<unsigned char>(c)) || c == '_';
}

bool CSharpLexer::isIdentChar(char c) noexcept {
    return std::isalnum(static_cast<unsigned char>(c)) || c == '_';
}

std::vector<Token> CSharpLexer::tokenize() {
    std::vector<Token> tokens;
    tokens.reserve(m_stream.size() / 4);

    while (!atEnd()) {
        const char c = cur();

        if (c == '\n') {
            tokens.push_back({TokenType::NEWLINE, "\n", m_stream.line(), m_stream.col()});
            advance();
            continue;
        }
        if (std::isspace(static_cast<unsigned char>(c))) {
            advance();
            continue;
        }
        if (c == '/' && peekAt() == '/') { tokens.push_back(lexLineComment());  continue; }
        if (c == '/' && peekAt() == '*') { tokens.push_back(lexBlockComment()); continue; }
        if (c == '#')                    { tokens.push_back(lexPreprocessor()); continue; }

        // '@' is C#'s verbatim-string prefix (@"...") *and* its
        // reserved-word-escape prefix (@class) -- and the two prefixes
        // can combine with '$' in either order (@$"..." / $@"...").
        if (c == '@') {
            if (peekAt() == '"') { tokens.push_back(lexVerbatimString()); continue; }
            if (peekAt() == '$' && peekAt(2) == '"') { tokens.push_back(lexInterpolatedString(true)); continue; }
            if (isIdentStart(peekAt())) { tokens.push_back(lexVerbatimIdentifier()); continue; }
            tokens.push_back(lexSymbol());
            continue;
        }
        if (c == '$') {
            if (peekAt() == '"') { tokens.push_back(lexInterpolatedString(false)); continue; }
            if (peekAt() == '@' && peekAt(2) == '"') { tokens.push_back(lexInterpolatedString(true)); continue; }
            tokens.push_back(lexSymbol());
            continue;
        }

        if (c == '"')  { tokens.push_back(lexRegularString()); continue; }
        if (c == '\'') { tokens.push_back(lexCharLiteral());   continue; }
        if (std::isdigit(static_cast<unsigned char>(c))) { tokens.push_back(lexNumber()); continue; }
        if (isIdentStart(c)) { tokens.push_back(lexIdentifierOrKeyword()); continue; }

        tokens.push_back(lexSymbol());
    }

    tokens.push_back({TokenType::END_OF_FILE, "", m_stream.line(), m_stream.col()});
    return tokens;
}

Token CSharpLexer::lexIdentifierOrKeyword() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    while (!atEnd() && isIdentChar(cur())) value += advance();
    const TokenType type = isKeyword(value) ? TokenType::KEYWORD : TokenType::IDENTIFIER;
    return {type, std::move(value), sl, sc};
}

// `@identifier` escapes a reserved word for use as an ordinary name
// (e.g. `@class`, `@if`). Always IDENTIFIER, regardless of whether the
// text after '@' matches a keyword -- that's the feature's whole point.
Token CSharpLexer::lexVerbatimIdentifier() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    value += advance(); // '@'
    while (!atEnd() && isIdentChar(cur())) value += advance();
    return {TokenType::IDENTIFIER, std::move(value), sl, sc};
}

// Handles decimal, hex (0x), binary (0b), underscore separators, and
// C#'s numeric suffixes (f/F, d/D, m/M, l/L, u/U, and combinations like
// ul/UL) -- all fall out of the same "alnum or . or _" scan Java's
// lexNumber() already uses, since hex digits and suffix letters are
// alnum. Scientific-notation sign (1e+10) reuses the same trailing e/E
// lookback.
Token CSharpLexer::lexNumber() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    while (!atEnd()) {
        const char c = cur();
        if (std::isalnum(static_cast<unsigned char>(c)) || c == '.' || c == '_') {
            value += advance();
        } else if ((c == '+' || c == '-') && !value.empty() &&
                   (value.back() == 'e' || value.back() == 'E')) {
            value += advance();
        } else {
            break;
        }
    }
    return {TokenType::NUMBER_LITERAL, std::move(value), sl, sc};
}

Token CSharpLexer::lexCharLiteral() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    value += advance();
    while (!atEnd() && cur() != '\'') {
        if (cur() == '\\') {
            value += advance();
            if (!atEnd()) value += advance();
        } else if (cur() == '\n') {
            break;
        } else {
            value += advance();
        }
    }
    if (!atEnd()) value += advance();
    return {TokenType::CHAR_LITERAL, std::move(value), sl, sc};
}

Token CSharpLexer::lexRegularString() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    value += advance();
    while (!atEnd() && cur() != '"') {
        if (cur() == '\\') {
            value += advance();
            if (!atEnd()) value += advance();
        } else if (cur() == '\n') {
            break;
        } else {
            value += advance();
        }
    }
    if (!atEnd()) value += advance();
    return {TokenType::STRING_LITERAL, std::move(value), sl, sc};
}

// Verbatim string: @"..." -- no backslash escaping; a doubled quote ""
// represents one literal '"'; spans multiple lines literally (no break
// on raw newline, unlike lexRegularString()).
Token CSharpLexer::lexVerbatimString() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    value += advance(); // '@'
    value += advance(); // '"'
    while (!atEnd()) {
        if (cur() == '"' && peekAt() == '"') {
            value += advance(); value += advance();
            continue;
        }
        if (cur() == '"') {
            value += advance();
            break;
        }
        value += advance();
    }
    return {TokenType::STRING_LITERAL, std::move(value), sl, sc};
}

// Interpolated string: $"...{expr}..." or, when verbatim is true, the
// combined $@"..."/@$"..." form. The leading prefix characters ('$',
// '@', in whichever order the caller detected) are consumed generically
// by scanning up to the opening '"', so this doesn't need to know which
// order was used.
//
// '{'/'}' are brace-depth tracked to find interpolation holes, the same
// technique TypeScriptLexer uses for template-literal ${ }. Doubled
// '{{'/'}}' outside any hole are literal-brace escapes (real C# syntax),
// not the start of one. A string literal encountered *inside* a hole is
// skipped as its own unit so its quotes can't prematurely close the
// outer literal and any braces inside it can't desync the depth counter
// -- this is what makes `$"{Foo("{}")}"`-shaped source tokenize as one
// STRING_LITERAL rather than terminating early.
Token CSharpLexer::lexInterpolatedString(bool verbatim) {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;

    while (!atEnd() && cur() != '"') value += advance(); // '$'/'@' prefix
    if (!atEnd()) value += advance();                     // opening '"'

    int interpDepth = 0;
    while (!atEnd()) {
        const char c = cur();

        if (interpDepth == 0 && c == '"') {
            if (verbatim && peekAt() == '"') {
                value += advance(); value += advance();
                continue;
            }
            value += advance();
            break;
        }
        if (interpDepth == 0 && !verbatim && c == '\\') {
            value += advance();
            if (!atEnd()) value += advance();
            continue;
        }
        if (interpDepth == 0 && c == '{' && peekAt() == '{') {
            value += advance(); value += advance();
            continue;
        }
        if (interpDepth == 0 && c == '}' && peekAt() == '}') {
            value += advance(); value += advance();
            continue;
        }
        if (interpDepth == 0 && c == '{') {
            value += advance();
            ++interpDepth;
            continue;
        }
        if (interpDepth > 0 && c == '"') {
            // Nested string literal inside a hole -- skip as a unit.
            value += advance();
            while (!atEnd() && cur() != '"') {
                if (cur() == '\\') {
                    value += advance();
                    if (!atEnd()) value += advance();
                    continue;
                }
                value += advance();
            }
            if (!atEnd()) value += advance();
            continue;
        }
        if (interpDepth > 0 && c == '{') { value += advance(); ++interpDepth; continue; }
        if (interpDepth > 0 && c == '}') { value += advance(); --interpDepth; continue; }
        if (interpDepth == 0 && !verbatim && c == '\n') break;

        value += advance();
    }
    return {TokenType::STRING_LITERAL, std::move(value), sl, sc};
}

Token CSharpLexer::lexLineComment() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    while (!atEnd() && cur() != '\n') value += advance();
    return {TokenType::LINE_COMMENT, std::move(value), sl, sc};
}

Token CSharpLexer::lexBlockComment() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    value += advance(); value += advance();
    while (!atEnd()) {
        if (cur() == '*' && peekAt() == '/') {
            value += advance(); value += advance();
            break;
        }
        value += advance();
    }
    return {TokenType::BLOCK_COMMENT, std::move(value), sl, sc};
}

// Line-oriented, same shape as CppLexer::lexPreprocessor(): spans to the
// next un-escaped newline (a trailing '\' continues the directive onto
// the next line, folded to a space). Covers #if/#else/#elif/#endif,
// #region/#endregion, #pragma, #nullable, #define/#undef, #line,
// #warning, #error.
Token CSharpLexer::lexPreprocessor() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;

    while (!atEnd()) {
        if (cur() == '\n') {
            if (!value.empty() && value.back() == '\\') {
                value.back() = ' ';
                advance();
            } else {
                break;
            }
        } else {
            value += advance();
        }
    }
    return {TokenType::PREPROCESSOR, std::move(value), sl, sc};
}

Token CSharpLexer::lexSymbol() {
    const int sl = m_stream.line(), sc = m_stream.col();
    const char c = advance();
    const std::string val(1, c);

    switch (c) {
        case '{': return {TokenType::OPEN_BRACE,    val, sl, sc};
        case '}': return {TokenType::CLOSE_BRACE,   val, sl, sc};
        case '(': return {TokenType::OPEN_PAREN,    val, sl, sc};
        case ')': return {TokenType::CLOSE_PAREN,   val, sl, sc};
        case '[': return {TokenType::OPEN_BRACKET,  val, sl, sc};
        case ']': return {TokenType::CLOSE_BRACKET, val, sl, sc};
        case ';': return {TokenType::SEMICOLON,     val, sl, sc};
        case '+': case '-': case '*': case '/': case '%':
        case '=': case '<': case '>': case '!':
        case '&': case '|': case '^': case '~':
        case '?': case ':': case '.':
            return {TokenType::OPERATOR, val, sl, sc};
        default:
            // Includes ',', '@' (bare, when not followed by '"' or an
            // identifier-start char), '$' (bare, when not part of an
            // interpolated-string prefix).
            return {TokenType::PUNCTUATION, val, sl, sc};
    }
}

bool CSharpLexer::isKeyword(const std::string& word) const noexcept {
    return kKeywords.count(word) != 0;
}

} // namespace cma
