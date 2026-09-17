#include "lexer/JavaScriptLexer.h"

#include <cctype>
#include <unordered_set>

namespace cma {

// ECMAScript reserved + contextual keywords this tool's grammar patterns
// care about. Everything TS added on top for its type system (interface,
// enum, namespace, module, declare, readonly, abstract, override,
// satisfies, keyof, infer, is, out, unique, asserts, type, implements,
// private, protected, public, as) is deliberately absent -- plain
// JavaScript has no declaration forms that use them, so on real JS
// source they lex as ordinary IDENTIFIER, which is correct (not a gap:
// there is no JS construct they'd need to recognize).
static const std::unordered_set<std::string> kKeywords = {
    "break","case","catch","class","const","continue","debugger","default","delete","do",
    "else","export","extends","finally","for","function","if","import","in","instanceof",
    "new","return","super","switch","this","throw","try","typeof","var","void","while","with","yield",
    "let","async","await","of","static","get","set",
    "true","false","null","undefined"
};

JavaScriptLexer::JavaScriptLexer(const std::string& source) : m_stream(source) {}

bool JavaScriptLexer::isIdentStart(char c) noexcept {
    return std::isalpha(static_cast<unsigned char>(c)) || c == '_' || c == '$';
}

bool JavaScriptLexer::isIdentChar(char c) noexcept {
    return std::isalnum(static_cast<unsigned char>(c)) || c == '_' || c == '$';
}

std::vector<Token> JavaScriptLexer::tokenize() {
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

Token JavaScriptLexer::lexIdentifierOrKeyword() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    while (!atEnd() && isIdentChar(cur())) value += advance();
    const TokenType type = isKeyword(value) ? TokenType::KEYWORD : TokenType::IDENTIFIER;
    return {type, std::move(value), sl, sc};
}

// Handles decimal, hex (0x), octal (0o), binary (0b), underscore
// separators (1_000_000), and the BigInt suffix (123n) -- none of this
// is TS-specific, identical to TypeScriptLexer::lexNumber().
Token JavaScriptLexer::lexNumber() {
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

Token JavaScriptLexer::lexDoubleQuotedString() {
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

// JS has no char-literal type: 'x' is a one-character STRING_LITERAL,
// not CHAR_LITERAL -- identical to TypeScriptLexer's own divergence from
// JavaLexer here, inherited unchanged since this was never TS-specific.
Token JavaScriptLexer::lexSingleQuotedString() {
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
// tracked via a brace-depth counter, identical to
// TypeScriptLexer::lexTemplateLiteral() -- template literals are plain
// ES2015+ JS, not a TS addition.
Token JavaScriptLexer::lexTemplateLiteral() {
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

Token JavaScriptLexer::lexLineComment() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    while (!atEnd() && cur() != '\n') value += advance();
    return {TokenType::LINE_COMMENT, std::move(value), sl, sc};
}

Token JavaScriptLexer::lexBlockComment() {
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

Token JavaScriptLexer::lexSymbol() {
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
            // Includes ',', '@' (decorators -- stage-3 JS proposal, kept
            // for parity with TS), '#' (real JS private-field sigil).
            return {TokenType::PUNCTUATION, val, sl, sc};
    }
}

bool JavaScriptLexer::isKeyword(const std::string& word) const noexcept {
    return kKeywords.count(word) != 0;
}

} // namespace cma
