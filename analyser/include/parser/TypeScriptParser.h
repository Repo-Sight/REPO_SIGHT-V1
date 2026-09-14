#pragma once

#include "BraceBlockAnalyzer.h"
#include "ParseResult.h"
#include "lexer/Token.h"

#include <string>
#include <vector>

namespace cma {

// Structural analyzer for the TypeScript front-end (Phase 2a, #1 of 3).
// Same brace-depth-tracked shape as JavaParser, plus what TS/JS need on
// top of Java's grammar:
//   - arrow functions (`(x) => { }`), including naming one from the
//     nearest preceding `name =` / `name:` binding when present
//   - anonymous `function (x) { }` expressions (no name token to key
//     detection off of the way Java's identifier-before-paren trick does)
//   - `?` disambiguation: ternary vs `?.` optional chaining vs `?:`
//     optional-parameter/property marker, plus `??` nullish coalescing
//   - return-type annotations between `)` and `{` (Java has none --
//     Java's return type precedes the method name, not follows the
//     parameter list)
//
// Deliberately out of scope for this pass (documented, not silent):
//   - arrow-function parameter lists are not counted toward
//     variableCount (named-function and class-method parameters are,
//     via countParameters()) -- arrow params need backward paren-
//     matching from the `=>` that findMatchingParen()'s forward-only
//     design doesn't support without real restructuring
//   - destructured bindings (`const { a, b } = x`, function params
//     using `{ }`/`[ ]` patterns) aren't counted -- same limitation
//     Java's parser already has for its own declaration forms
//   - object-type return annotations containing their own `{ }`
//     (`function f(): { a: number } { ... }`) may locate the wrong
//     brace as the body; rare in practice
class TypeScriptParser {
public:
    explicit TypeScriptParser(const std::vector<Token>& tokens, int totalLines);

    [[nodiscard]] FileMetrics analyze();

private:
    struct PendingFunction {
        FunctionInfo info;
        int          bodyBraceDepth = 0;
    };

    void classifyLines();

    void walkTokens();
    void handleKeyword(std::size_t idx);
    void tryBeginFunction(std::size_t identIdx);
    void tryBeginAnonymousFunction(std::size_t openParenIdx);
    void tryBeginArrowFunction(std::size_t arrowFirstIdx);
    void handleVariableDecl(std::size_t identIdx);
    void tryRecordClass(std::size_t kwIdx, const std::string& kwValue);
    void countParameters(std::size_t openParenIdx, std::size_t closeParenIdx);

    [[nodiscard]] std::string extractImportTarget(std::size_t kwIdx) const;

    [[nodiscard]] std::size_t findMatchingParen(std::size_t openIdx) const;
    [[nodiscard]] std::size_t skipTrailingSpecifiers(std::size_t afterCloseParen) const;

    [[nodiscard]] int countTodos(const std::string& commentText) const;

    const std::vector<Token>& m_tokens;
    int                        m_totalLines;
    FileMetrics                m_result;

    BraceBlockAnalyzer            m_braceAnalyzer;
    std::vector<PendingFunction>  m_fnStack;

    // Name of the most recent `identifier =` / `identifier:` binding
    // seen since the last statement boundary. If an arrow function
    // follows before the next boundary (`;`, `{`, or `}`), it borrows
    // this name instead of being recorded as "<anonymous>". Cleared at
    // every statement boundary and every time it's consumed.
    std::string m_pendingArrowName;

    enum class LineType { BLANK, COMMENT, CODE };
    std::vector<LineType> m_lineTypes;
};

} // namespace cma
