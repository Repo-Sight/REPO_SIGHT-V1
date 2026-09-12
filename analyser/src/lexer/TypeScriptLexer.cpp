#include "lexer/TypeScriptLexer.h"

#include <cctype>
#include <unordered_set>

namespace cma {

// True/future reserved words plus TS's contextual keywords, treated as
// always-keyword the same way JavaLexer treats Java's contextual set
// (var/record/yield/sealed/permits) as always-keyword rather than
// tracking grammar position -- simpler, and consistent with this
// project's existing precedent.
//
// Deliberately excluded: TS builtin type names (string, number, boolean,
// any, never, unknown, object, symbol, bigint) are NOT reserved words in
// JS/TS grammar -- they stay IDENTIFIER, mirroring Java's own precedent
// that "String" (a common builtin type) is an identifier, not a keyword.
static const std::unordered_set<std::string> kKeywords = {
    "break","case","catch","class","const","continue","debugger","default","delete","do",
    "else","export","extends","finally","for","function","if","import","in","instanceof",
    "new","return","super","switch","this","throw","try","typeof","var","void","while","with","yield",
    "let","async","await","of","as","from","declare","module","namespace","readonly","abstract",
    "override","satisfies","keyof","infer","is","out","unique","asserts","type","interface","enum",
    "implements","private","protected","public","static","get","set",
    "true","false","null","undefined"
};

TypeScriptLexer::TypeScriptLexer(const std::string& source) : m_stream(source) {}

bool TypeScriptLexer::isIdentStart(char c) noexcept {
    return std::isalpha(static_cast<unsigned char>(c)) || c == '_' || c == '$';
}

bool TypeScriptLexer::isIdentChar(char c) noexcept {
    return std::isalnum(static_cast<unsigned char>(c)) || c == '_' || c == '$';
}

std::vector<Token> TypeScriptLexer::tokenize() {
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
        if (c == '"')  { tokens.push_back(lexDoubleQuotedString()); continue; }
        if (c == '\'') { tokens.push_back(lexSingleQuotedString()); continue; }
        if (c == '`')  { tokens.push_back(lexTemplateLiteral());   continue; }
        if (std::isdigit(static_cast<unsigned char>(c))) { tokens.push_back(lexNumber()); continue; }
        if (isIdentStart(c)) { tokens.push_back(lexIdentifierOrKeyword()); continue; }

        tokens.push_back(lexSymbol());
    }

    tokens.push_back({TokenType::END_OF_FILE, "", m_stream.line(), m_stream.col()});
    return tokens;
}

Token TypeScriptLexer::lexIdentifierOrKeyword() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    while (!atEnd() && isIdentChar(cur())) value += advance();
    const TokenType type = isKeyword(value) ? TokenType::KEYWORD : TokenType::IDENTIFIER;
    return {type, std::move(value), sl, sc};
}

// Handles decimal, hex (0x), octal (0o), binary (0b), underscore
// separators (1_000_000), and the BigInt suffix (123n) -- all fall out
// of the same "alnum or . or _" scan Java's lexNumber() already uses,
// since hex digits/suffix letters are alnum. Scientific-notation sign
// (1e+10) reuses the same trailing e/E lookback.
Token TypeScriptLexer::lexNumber() {
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

Token TypeScriptLexer::lexDoubleQuotedString() {
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

// JS/TS has no char-literal type: 'x' is a one-character STRING_LITERAL,
// not CHAR_LITERAL -- the one deliberate divergence from JavaLexer's
// otherwise-identical string-scanning shape.
Token TypeScriptLexer::lexSingleQuotedString() {
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
    return {TokenType::STRING_LITERAL, std::move(value), sl, sc};
}

// Template literal: backtick ... backtick, with ${ expr } interpolation
// tracked via a brace-depth counter so braces belonging to an object
// literal inside an interpolation don't close the template early. The
// whole thing -- text plus every interpolation -- is emitted as one
// STRING_LITERAL token (may span multiple lines); the parser's existing
// multi-line STRING_LITERAL line-classification already handles that,
// same as it does for Java's triple-quoted text blocks.
Token TypeScriptLexer::lexTemplateLiteral() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    value += advance(); // opening `

    int interpDepth = 0;
    while (!atEnd()) {
        const char c = cur();

        if (interpDepth == 0 && c == '`') {
            value += advance();
            break;
        }
        if (c == '\\') {
            value += advance();
            if (!atEnd()) value += advance();
            continue;
        }
        if (interpDepth == 0 && c == '$' && peekAt() == '{') {
            value += advance(); value += advance();
            ++interpDepth;
            continue;
        }
        if (interpDepth > 0 && c == '{') {
            value += advance();
            ++interpDepth;
            continue;
        }
        if (interpDepth > 0 && c == '}') {
            value += advance();
            --interpDepth;
            continue;
        }
        value += advance();
    }
    return {TokenType::STRING_LITERAL, std::move(value), sl, sc};
}

Token TypeScriptLexer::lexLineComment() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    while (!atEnd() && cur() != '\n') value += advance();
    return {TokenType::LINE_COMMENT, std::move(value), sl, sc};
}

Token TypeScriptLexer::lexBlockComment() {
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

Token TypeScriptLexer::lexSymbol() {
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
            // Includes ',', '@' (decorators), '#' (private-field sigil) --
            // same fallback Java uses for '@'.
            return {TokenType::PUNCTUATION, val, sl, sc};
    }
}

bool TypeScriptLexer::isKeyword(const std::string& word) const noexcept {
    return kKeywords.count(word) != 0;
}

} // namespace cma
