#include "parser/JavaScriptParser.h"

#include <unordered_set>
#include <utility>

namespace cma {

JavaScriptParser::JavaScriptParser(const std::vector<Token>& tokens, int totalLines)
    : m_tokens(tokens)
    , m_totalLines(totalLines)
{
    m_lineTypes.assign(static_cast<std::size_t>(totalLines), LineType::BLANK);
    m_result.totalLines = totalLines;
}

FileMetrics JavaScriptParser::analyze() {
    classifyLines();
    walkTokens();

    for (const auto& lt : m_lineTypes) {
        switch (lt) {
            case LineType::BLANK:   ++m_result.blankLines;   break;
            case LineType::COMMENT: ++m_result.commentLines; break;
            case LineType::CODE:    ++m_result.codeLines;    break;
        }
    }

    m_result.maxNestingDepth = m_braceAnalyzer.maxDepth();
    return m_result;
}

void JavaScriptParser::classifyLines() {
    const auto mark = [&](int srcLine, LineType lt) {
        const auto idx = static_cast<std::size_t>(srcLine - 1);
        if (idx >= m_lineTypes.size()) return;
        if (lt == LineType::CODE ||
            (lt == LineType::COMMENT && m_lineTypes[idx] == LineType::BLANK)) {
            m_lineTypes[idx] = lt;
        }
    };

    for (const auto& tok : m_tokens) {
        if (tok.type == TokenType::END_OF_FILE || tok.type == TokenType::NEWLINE)
            continue;

        if (tok.type == TokenType::LINE_COMMENT) {
            mark(tok.line, LineType::COMMENT);
            m_result.todoCount += countTodos(tok.value);

        } else if (tok.type == TokenType::BLOCK_COMMENT) {
            int line = tok.line;
            for (char c : tok.value) {
                mark(line, LineType::COMMENT);
                if (c == '\n') ++line;
            }
            m_result.todoCount += countTodos(tok.value);

        } else if (tok.type == TokenType::STRING_LITERAL) {
            // Covers multi-line template literals: every line the
            // literal spans is CODE, not COMMENT.
            int line = tok.line;
            for (char c : tok.value) {
                mark(line, LineType::CODE);
                if (c == '\n') ++line;
            }

        } else {
            mark(tok.line, LineType::CODE);
        }
    }
}

void JavaScriptParser::walkTokens() {
    const std::size_t n = m_tokens.size();
    int lastLine = 0;

    for (std::size_t i = 0; i < n; ++i) {
        const Token& tok = m_tokens[i];
        if (tok.type != TokenType::END_OF_FILE) lastLine = tok.line;

        switch (tok.type) {

        case TokenType::OPEN_BRACE:
            m_braceAnalyzer.onOpenBrace();
            m_pendingArrowName.clear();
            break;

        case TokenType::CLOSE_BRACE:
            if (!m_fnStack.empty() &&
                m_braceAnalyzer.depth() == m_fnStack.back().bodyBraceDepth) {
                m_fnStack.back().info.endLine = tok.line;
                m_result.functions.push_back(m_fnStack.back().info);
                m_fnStack.pop_back();
            }
            m_braceAnalyzer.onCloseBrace();
            m_pendingArrowName.clear();
            break;

        case TokenType::SEMICOLON:
            m_pendingArrowName.clear();
            break;

        case TokenType::KEYWORD:
            handleKeyword(i);
            break;

        case TokenType::IDENTIFIER:
            if (i + 1 < n && m_tokens[i + 1].type == TokenType::OPEN_PAREN) {
                tryBeginFunction(i);
            } else {
                handleVariableDecl(i);

                // Remember `name =` / `name:` so a following arrow
                // function can borrow this name instead of being
                // "<anonymous>". Excludes `==`/`===` (next-next token
                // also '=') so equality checks don't misfire this.
                const bool nextIsAssignOrColon =
                    i + 1 < n && m_tokens[i + 1].type == TokenType::OPERATOR &&
                    (m_tokens[i + 1].value == "=" || m_tokens[i + 1].value == ":");
                const bool isEquality =
                    nextIsAssignOrColon && m_tokens[i + 1].value == "=" &&
                    i + 2 < n && m_tokens[i + 2].type == TokenType::OPERATOR &&
                    m_tokens[i + 2].value == "=";
                if (nextIsAssignOrColon && !isEquality) {
                    m_pendingArrowName = tok.value;
                }
            }
            break;

        case TokenType::OPERATOR:
            if (tok.value == "=" && i + 1 < n &&
                m_tokens[i + 1].type == TokenType::OPERATOR && m_tokens[i + 1].value == ">") {
                tryBeginArrowFunction(i);
                ++i; // consume the '>' half of '=>' too
            }
            else if ((tok.value == "&" || tok.value == "|") &&
                      i + 1 < n &&
                      m_tokens[i + 1].type  == TokenType::OPERATOR &&
                      m_tokens[i + 1].value == tok.value) {
                ++m_result.cyclomaticComplexity; // && / ||
                ++i;
            }
            else if (tok.value == "?") {
                // No '?:' optional-parameter-marker case here (that's a
                // TS-only construct) -- in JS, '?' is always '??'
                // nullish coalescing, '?.' optional chaining, or a
                // ternary.
                const bool nextIsQ = i + 1 < n && m_tokens[i + 1].type == TokenType::OPERATOR &&
                                      m_tokens[i + 1].value == "?";
                const bool nextIsDot =
                    i + 1 < n && m_tokens[i + 1].type == TokenType::OPERATOR &&
                    m_tokens[i + 1].value == ".";
                if (nextIsQ) {
                    ++m_result.cyclomaticComplexity; // ?? nullish coalescing
                    ++i;
                } else if (!nextIsDot) {
                    ++m_result.cyclomaticComplexity; // ternary
                }
                // else: '?.' optional chaining -- not a branch, no increment.
            }
            break;

        default:
            break;
        }
    }

    while (!m_fnStack.empty()) {
        m_fnStack.back().info.endLine = lastLine;
        m_result.functions.push_back(m_fnStack.back().info);
        m_fnStack.pop_back();
    }
}

void JavaScriptParser::handleKeyword(std::size_t idx) {
    const Token& tok = m_tokens[idx];
    const std::string& v = tok.value;

    if (v == "for" || v == "while" || v == "do") {
        ++m_result.loopCount;
        ++m_result.cyclomaticComplexity;

    } else if (v == "if" || v == "switch") {
        ++m_result.conditionCount;
        ++m_result.cyclomaticComplexity;

    } else if (v == "case") {
        ++m_result.cyclomaticComplexity;

    } else if (v == "catch") {
        ++m_result.cyclomaticComplexity;

    } else if (v == "try") {
        ++m_result.tryCatchCount;

    } else if (v == "class") {
        // interface/enum/namespace/module aren't in JavaScriptLexer's
        // keyword set at all (see the .h's header comment) -- they lex
        // as ordinary IDENTIFIER on real JS source, so 'class' is the
        // only structural keyword that can reach here.
        tryRecordClass(idx);

    } else if (v == "import") {
        ++m_result.includeCount;
        m_result.includeTargets.push_back(extractImportTarget(idx));

    } else if (v == "function") {
        // Named `function foo(...)` is picked up generically when the
        // walker reaches the IDENTIFIER "foo" (next token is '('). Only
        // the anonymous form -- 'function' directly followed by '(' --
        // needs handling here, since there's no identifier to trigger
        // the generic path.
        if (idx + 1 < m_tokens.size() && m_tokens[idx + 1].type == TokenType::OPEN_PAREN) {
            tryBeginAnonymousFunction(idx + 1);
        }
    }
}

void JavaScriptParser::tryBeginFunction(std::size_t identIdx) {
    if (identIdx > 0) {
        const Token& prev = m_tokens[identIdx - 1];
        // 'new ClassName(...)' and 'class ClassName(...)'-shaped tokens
        // (the latter doesn't occur in real JS grammar, kept only for
        // parity/safety) must not be misdetected as a function
        // declaration. interface/enum/namespace/module don't need
        // guarding against here -- see handleKeyword()'s comment.
        if (prev.type == TokenType::KEYWORD &&
            (prev.value == "new" || prev.value == "class")) {
            return;
        }
    }

    const std::size_t openParenIdx  = identIdx + 1;
    const std::size_t closeParenIdx = findMatchingParen(openParenIdx);
    if (closeParenIdx >= m_tokens.size()) return;

    const std::size_t bodyIdx = skipTrailingSpecifiers(closeParenIdx + 1);
    if (bodyIdx >= m_tokens.size()) return;
    if (m_tokens[bodyIdx].type != TokenType::OPEN_BRACE) return;

    countParameters(openParenIdx, closeParenIdx);

    PendingFunction pf;
    pf.info.name      = m_tokens[identIdx].value;
    pf.info.startLine = m_tokens[identIdx].line;
    pf.bodyBraceDepth = m_braceAnalyzer.depth() + 1;
    m_fnStack.push_back(std::move(pf));

    m_pendingArrowName.clear();
}

void JavaScriptParser::tryBeginAnonymousFunction(std::size_t openParenIdx) {
    const std::size_t closeParenIdx = findMatchingParen(openParenIdx);
    if (closeParenIdx >= m_tokens.size()) return;

    const std::size_t bodyIdx = skipTrailingSpecifiers(closeParenIdx + 1);
    if (bodyIdx >= m_tokens.size()) return;
    if (m_tokens[bodyIdx].type != TokenType::OPEN_BRACE) return;

    countParameters(openParenIdx, closeParenIdx);

    PendingFunction pf;
    pf.info.name      = m_pendingArrowName.empty() ? "<anonymous>" : m_pendingArrowName;
    pf.info.startLine = m_tokens[openParenIdx].line;
    pf.bodyBraceDepth = m_braceAnalyzer.depth() + 1;
    m_fnStack.push_back(std::move(pf));

    m_pendingArrowName.clear();
}

void JavaScriptParser::tryBeginArrowFunction(std::size_t arrowFirstIdx) {
    std::size_t after = arrowFirstIdx + 2; // past '=' and '>'
    while (after < m_tokens.size() && m_tokens[after].type == TokenType::NEWLINE) ++after;

    if (after >= m_tokens.size() || m_tokens[after].type != TokenType::OPEN_BRACE) {
        // Expression-bodied arrow (`x => x + 1`) -- not brace-tracked,
        // so it can't be given an endLine the way this parser's function
        // model works. Documented scope limit; the pending name is still
        // consumed below so it doesn't leak into an unrelated later arrow.
        m_pendingArrowName.clear();
        return;
    }

    PendingFunction pf;
    pf.info.name      = m_pendingArrowName.empty() ? "<anonymous>" : m_pendingArrowName;
    pf.info.startLine = m_tokens[arrowFirstIdx].line;
    pf.bodyBraceDepth = m_braceAnalyzer.depth() + 1;
    m_fnStack.push_back(std::move(pf));

    m_pendingArrowName.clear();
}

void JavaScriptParser::handleVariableDecl(std::size_t identIdx) {
    static const std::unordered_set<std::string> kDeclKeywords = {"let", "const", "var"};

    if (identIdx == 0) return;

    const std::size_t prev = identIdx - 1;
    if (m_tokens[prev].type != TokenType::KEYWORD) return;
    if (!kDeclKeywords.count(m_tokens[prev].value)) return;

    const std::size_t next = identIdx + 1;
    if (next < m_tokens.size() && m_tokens[next].type == TokenType::OPEN_PAREN) return;

    ++m_result.variableCount;
}

// Only 'class' ever reaches this (see handleKeyword()'s comment), so
// unlike TypeScriptParser::tryRecordClass() there's no kwValue to
// branch on -- every recorded entry is ClassInfo::Kind::CLASS.
void JavaScriptParser::tryRecordClass(std::size_t kwIdx) {
    const std::size_t nameIdx = kwIdx + 1;
    if (nameIdx < m_tokens.size() && m_tokens[nameIdx].type == TokenType::IDENTIFIER) {
        ClassInfo ci;
        ci.name = m_tokens[nameIdx].value;
        ci.line = m_tokens[kwIdx].line;
        ci.kind = ClassInfo::Kind::CLASS;
        m_result.classes.push_back(ci);
    }
    // Anonymous class expressions (`const Foo = class { }`) name with
    // '{', not an identifier -- silently not recorded (no crash, no
    // false entry), same shape as TypeScriptParser's own silent-skip
    // precedent for ambient `declare module "some-lib"`.
}

// Counts simple `name` / `name = default` parameter bindings at paren
// depth 0. Unlike TypeScriptParser::countParameters(), there's no
// '<'/'>' generic-type-argument depth tracking -- JS parameter lists
// have no type annotations, so a bare '<' or '>' here is an ordinary
// comparison operator inside a default-value expression, not a type
// argument delimiter, and doesn't need special handling. Destructured
// params (`{a, b}` or `[x, y]`) aren't counted -- same limitation
// TypeScriptParser has.
void JavaScriptParser::countParameters(std::size_t openParenIdx, std::size_t closeParenIdx) {
    int depth = 0;
    bool atParamStart = true;

    for (std::size_t k = openParenIdx + 1; k < closeParenIdx; ++k) {
        const Token& t = m_tokens[k];

        if (t.type == TokenType::OPEN_PAREN || t.type == TokenType::OPEN_BRACKET ||
            t.type == TokenType::OPEN_BRACE) {
            ++depth; continue;
        }
        if (t.type == TokenType::CLOSE_PAREN || t.type == TokenType::CLOSE_BRACKET ||
            t.type == TokenType::CLOSE_BRACE) {
            if (depth > 0) { --depth; }
            continue;
        }
        if (depth != 0) continue;

        if (t.type == TokenType::PUNCTUATION && t.value == ",") { atParamStart = true; continue; }
        if (t.type == TokenType::NEWLINE) continue;

        if (atParamStart && t.type == TokenType::IDENTIFIER) {
            ++m_result.variableCount;
        }
        atParamStart = false;
    }
}

// Returns the module specifier string of an `import ... from "x"` (or
// bare `import "x"`) statement, quotes stripped. Not TS-specific --
// identical to TypeScriptParser::extractImportTarget().
std::string JavaScriptParser::extractImportTarget(std::size_t kwIdx) const {
    std::size_t i = kwIdx + 1;
    while (i < m_tokens.size()) {
        const Token& t = m_tokens[i];
        if (t.type == TokenType::SEMICOLON) break;
        if (t.type == TokenType::STRING_LITERAL) {
            return (t.value.size() >= 2) ? t.value.substr(1, t.value.size() - 2) : t.value;
        }
        ++i;
    }
    return "";
}

std::size_t JavaScriptParser::findMatchingParen(std::size_t openIdx) const {
    if (openIdx >= m_tokens.size() ||
        m_tokens[openIdx].type != TokenType::OPEN_PAREN)
        return m_tokens.size();

    int depth = 1;
    for (std::size_t i = openIdx + 1; i < m_tokens.size(); ++i) {
        if (m_tokens[i].type == TokenType::OPEN_PAREN)  ++depth;
        if (m_tokens[i].type == TokenType::CLOSE_PAREN) { if (--depth == 0) return i; }
        if (m_tokens[i].type == TokenType::END_OF_FILE) break;
    }
    return m_tokens.size();
}

// Skips from just after a parameter list's ')' to the function body's
// '{'. Unlike TypeScriptParser::skipTrailingSpecifiers(), there's no
// return-type annotation to skip over -- JS goes straight from ')' to
// '{' -- so this only needs to step past NEWLINE tokens (e.g. Allman-
// style `function foo()\n{`); the caller already rejects anything that
// isn't OPEN_BRACE once this returns.
std::size_t JavaScriptParser::skipTrailingSpecifiers(std::size_t i) const {
    const std::size_t n = m_tokens.size();
    while (i < n && m_tokens[i].type == TokenType::NEWLINE) ++i;
    return i;
}

int JavaScriptParser::countTodos(const std::string& text) const {
    int count = 0;
    for (std::size_t pos = 0;
         (pos = text.find("TODO", pos)) != std::string::npos;
         pos += 4) { ++count; }
    for (std::size_t pos = 0;
         (pos = text.find("FIXME", pos)) != std::string::npos;
         pos += 5) { ++count; }
    return count;
}

} // namespace cma
