#pragma once
 
#include "LexerUtils.h"
#include "Token.h"
 
#include <string>
#include <vector>
 
namespace cma {
 
class CppLexer {
public:
   // C shares this lexer. The only difference is the keyword set: in C the C++-only keywords
   // (new, delete, class, this, try, catch, template, namespace, ...) are ordinary identifiers and
   // very common ones (`struct node *new`, `int class`), so lexing them as keywords would trigger
   // C++ rules and C++ parser paths on valid C.
   enum class Dialect { Cpp, C };

   explicit CppLexer(const std::string& source, Dialect dialect = Dialect::Cpp);
   [[nodiscard]] std::vector<Token> tokenize();
 
private:
    Token lexIdentifierOrKeyword();
    Token lexNumber();
    Token lexString();
    Token lexCharLiteral();
    Token lexLineComment();
    Token lexBlockComment();
    Token lexPreprocessor();
    Token lexSymbol();
 
    char cur()                  const noexcept { return m_stream.cur(); }
    char peekAt(int offset = 1) const noexcept { return m_stream.peekAt(offset); }
    char advance()              noexcept       { return m_stream.advance(); }
    bool atEnd()                const noexcept { return m_stream.atEnd(); }
 
    [[nodiscard]] bool isKeyword(const std::string& word) const noexcept;
 
    CharStream m_stream;
    Dialect    m_dialect;
};
 
} // namespace cma
 
