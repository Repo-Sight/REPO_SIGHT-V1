#include "lexer/CppLexer.h"
 
#include <cctype>
#include <unordered_set>
 
namespace cma {
 
static const std::unordered_set<std::string> kKeywords = {
    "alignas","alignof","auto",
    "bool","break",
    "case","catch","char","char8_t","char16_t","char32_t","class",
    "const","constexpr","consteval","constinit","const_cast","continue",
    "decltype","default","delete","do","double","dynamic_cast",
    "else","enum","explicit","export","extern",
    "false","final","float","for","friend",
    "goto",
    "if","inline","int",
    "long",
    "mutable",
    "namespace","new","noexcept","nullptr",
    "operator","override",
    "private","protected","public",
    "register","reinterpret_cast","requires","return",
    "short","signed","sizeof","static","static_assert","static_cast",
    "struct","switch",
    "template","this","thread_local","throw","true","try","typedef",
    "typeid","typename",
    "union","unsigned","using",
    "virtual","void","volatile",
    "wchar_t","while"
};
 
// C11 keywords plus the C23 spellings that are real keywords there (bool, true, false, nullptr,
// alignas, alignof, static_assert, thread_local, typeof). Everything C++-only is deliberately absent.
static const std::unordered_set<std::string> kCKeywords = {
    "alignas","alignof","auto",
    "bool","break",
    "case","char","const","continue",
    "default","do","double",
    "else","enum","extern",
    "false","float","for",
    "goto",
    "if","inline","int",
    "long",
    "nullptr",
    "register","restrict","return",
    "short","signed","sizeof","static","static_assert","struct","switch",
    "thread_local","true","typedef","typeof",
    "union","unsigned",
    "void","volatile",
    "while",
    "_Alignas","_Alignof","_Atomic","_Bool","_Complex","_Generic","_Imaginary","_Noreturn",
    "_Static_assert","_Thread_local"
};

CppLexer::CppLexer(const std::string& source, Dialect dialect)
    : m_stream(source), m_dialect(dialect) {}

 
std::vector<Token> CppLexer::tokenize() {
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
        if (c == '#')                    { tokens.push_back(lexPreprocessor());  continue; }
        if (c == '"')                    { tokens.push_back(lexString());        continue; }
        if (c == '\'')                   { tokens.push_back(lexCharLiteral());   continue; }
 
        if (std::isdigit(static_cast<unsigned char>(c))) {
            tokens.push_back(lexNumber());
            continue;
        }
        if (std::isalpha(static_cast<unsigned char>(c)) || c == '_') {
            tokens.push_back(lexIdentifierOrKeyword());
            continue;
        }
 
        tokens.push_back(lexSymbol());
    }
 
    tokens.push_back({TokenType::END_OF_FILE, "", m_stream.line(), m_stream.col()});
    return tokens;
}
 
Token CppLexer::lexIdentifierOrKeyword() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
 
    while (!atEnd() &&
           (std::isalnum(static_cast<unsigned char>(cur())) || cur() == '_')) {
        value += advance();
    }
 
    const TokenType type =
        isKeyword(value) ? TokenType::KEYWORD : TokenType::IDENTIFIER;
    return {type, std::move(value), sl, sc};
}
 
Token CppLexer::lexNumber() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
 
    while (!atEnd()) {
        const char c = cur();
        if (std::isalnum(static_cast<unsigned char>(c)) || c == '.') {
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
 
Token CppLexer::lexString() {
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
 
Token CppLexer::lexCharLiteral() {
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
 
Token CppLexer::lexLineComment() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    while (!atEnd() && cur() != '\n') value += advance();
    return {TokenType::LINE_COMMENT, std::move(value), sl, sc};
}
 
Token CppLexer::lexBlockComment() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
 
    value += advance();
    value += advance();
    while (!atEnd()) {
        if (cur() == '*' && peekAt() == '/') {
            value += advance();
            value += advance();
            break;
        }
        value += advance();
    }
    return {TokenType::BLOCK_COMMENT, std::move(value), sl, sc};
}
 
Token CppLexer::lexPreprocessor() {
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
 
Token CppLexer::lexSymbol() {
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
        case '+': case '-': case '*': case '/':
        case '%': case '=': case '<': case '>':
        case '!': case '&': case '|': case '^':
        case '~': case '?': case ':': case '.':
            return {TokenType::OPERATOR, val, sl, sc};
        default:
            return {TokenType::PUNCTUATION, val, sl, sc};
    }
}
 
bool CppLexer::isKeyword(const std::string& word) const noexcept {
    return m_dialect == Dialect::C ? kCKeywords.count(word) != 0 : kKeywords.count(word) != 0;
}
 
} // namespace cma
 
