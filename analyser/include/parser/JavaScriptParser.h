#pragma once

#include "BraceBlockAnalyzer.h"
#include "ParseResult.h"
#include "lexer/Token.h"

#include <string>
#include <vector>

namespace cma {

// Structural analyzer for the JavaScript front-end (Phase 2a, #2 of 3).
// Derived directly from TypeScriptParser -- same brace-depth-tracked
// shape, same function/arrow-function/class detection -- with every
// TS-type-annotation-specific piece stripped, since plain JS has no
// type-annotation grammar for it to apply to:
//   - no generic type-argument depth tracking in countParameters()
//     (`Map<string, number>` doesn't exist in JS; a bare '<'/'>' in a
//     parameter list's default-value expression is just a comparison)
//   - no return-type-annotation skipping between ')' and '{' -- JS
//     functions go straight from the parameter list to the body, so
//     skipTrailingSpecifiers() only needs to skip NEWLINE tokens
//   - no '?:' optional-parameter-marker case in the '?' disambiguation
//     -- JS has no optional-parameter syntax, so '?' is always either
//     '?.' optional chaining, '??' nullish coalescing, or a ternary
//   - tryRecordClass()/handleKeyword()'s interface/enum/namespace/module
//     branches are gone -- JavaScriptLexer's keyword set doesn't include
//     those words at all, so they'd never reach here as KEYWORD tokens
//
// What transfers unchanged from TypeScriptParser (deliberately -- see
// Phase 2a plan's note to re-check this once TS was real code): brace-
// depth-based cyclomatic-complexity and nesting-depth tracking. Neither
// was ever type-annotation-specific -- a callback body's '{' increases
// depth exactly like any other block, TS or not -- so no JS-specific
// handling was needed for either metric.
//
// Deliberately out of scope for this pass (same documented limits as
// TypeScriptParser, inherited unchanged):
//   - arrow-function parameter lists are not counted toward
//     variableCount
//   - destructured bindings aren't counted
class JavaScriptParser {
public:
    explicit JavaScriptParser(const std::vector<Token>& tokens, int totalLines);

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
    void tryRecordClass(std::size_t kwIdx);
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
