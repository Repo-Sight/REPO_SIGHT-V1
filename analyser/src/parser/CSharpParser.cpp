#include "parser/CSharpParser.h"

#include <unordered_set>
#include <utility>

namespace cma {

CSharpParser::CSharpParser(const std::vector<Token>& tokens, int totalLines)
    : m_tokens(tokens)
    , m_totalLines(totalLines)
{
    m_lineTypes.assign(static_cast<std::size_t>(totalLines), LineType::BLANK);
    m_result.totalLines = totalLines;
}

FileMetrics CSharpParser::analyze() {
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

void CSharpParser::classifyLines() {
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
            // Covers multi-line verbatim/interpolated strings the same
            // way Java's triple-quoted text blocks are covered: every
            // line the literal spans is CODE, not COMMENT.
            int line = tok.line;
            for (char c : tok.value) {
                mark(line, LineType::CODE);
                if (c == '\n') ++line;
            }

        } else if (tok.type == TokenType::PREPROCESSOR) {
            // #if/#region/#pragma/etc. -- CODE, same treatment CppParser
            // gives its own preprocessor directives. No include-target
            // extraction here: C#'s import equivalent is the `using`
            // statement (an ordinary KEYWORD), not a preprocessor
            // directive -- see handleKeyword().
            mark(tok.line, LineType::CODE);

        } else {
            mark(tok.line, LineType::CODE);
        }
    }
}

void CSharpParser::walkTokens() {
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
                tryBeginFunction(i, i + 1);
            } else if (i + 1 < n && m_tokens[i + 1].type == TokenType::OPERATOR &&
                       m_tokens[i + 1].value == "<") {
                // Possible generic method name (`Foo<T>(...)`) -- C#
                // puts the type-parameter list after the name, unlike
                // Java. See trySkipGenericArgsToParen()'s doc comment
                // for why this can't misfire on an ordinary comparison.
                const std::size_t parenIdx = trySkipGenericArgsToParen(i + 1);
                if (parenIdx < n) {
                    tryBeginFunction(i, parenIdx);
                } else {
                    handleVariableDecl(i);
                }
            } else {
                handleVariableDecl(i);

                // Remember `name =` so a following lambda can borrow
                // this name instead of being "<anonymous>". Excludes
                // `==` *and* `=>` (next-next token '=' or '>') so
                // equality checks AND a bare single-param lambda
                // (`x => { }`, whose own 'x' is otherwise
                // indistinguishable at this lookahead distance from an
                // assignment target) don't clobber a real pending name
                // that was already set one token earlier by the actual
                // `name = x => { }` binding. Unlike TypeScriptParser,
                // C# has no `name: lambda` binding shape worth tracking
                // here.
                const bool nextIsAssign =
                    i + 1 < n && m_tokens[i + 1].type == TokenType::OPERATOR &&
                    m_tokens[i + 1].value == "=";
                const bool nextIsEqualityOrArrow =
                    nextIsAssign && i + 2 < n && m_tokens[i + 2].type == TokenType::OPERATOR &&
                    (m_tokens[i + 2].value == "=" || m_tokens[i + 2].value == ">");
                if (nextIsAssign && !nextIsEqualityOrArrow) {
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
                const bool nextIsQ = i + 1 < n && m_tokens[i + 1].type == TokenType::OPERATOR &&
                                      m_tokens[i + 1].value == "?";
                const bool nextIsDot = i + 1 < n && m_tokens[i + 1].type == TokenType::OPERATOR &&
                                       m_tokens[i + 1].value == ".";
                const bool nextIsBracket =
                    i + 1 < n && m_tokens[i + 1].type == TokenType::OPEN_BRACKET;

                if (nextIsQ) {
                    ++m_result.cyclomaticComplexity; // ?? / ??= nullish coalescing
                    ++i;
                } else if (nextIsDot || nextIsBracket) {
                    // '?.' / '?[' null-conditional access -- not a branch.
                } else if (precededByValueTypeKeyword(i)) {
                    // nullable-value-type marker (`int? x`) -- not a branch.
                } else {
                    ++m_result.cyclomaticComplexity; // ternary
                }
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

void CSharpParser::handleKeyword(std::size_t idx) {
    const Token& tok = m_tokens[idx];
    const std::string& v = tok.value;
    const std::size_t n = m_tokens.size();

    if (v == "for" || v == "while" || v == "do" || v == "foreach") {
        ++m_result.loopCount;
        ++m_result.cyclomaticComplexity;

    } else if (v == "if" || v == "switch") {
        ++m_result.conditionCount;
        ++m_result.cyclomaticComplexity;

    } else if (v == "case") {
        ++m_result.cyclomaticComplexity;

    } else if (v == "when") {
        // Switch pattern guard clause (`case int n when n > 0:`) -- a
        // genuine additional predicate on that case.
        ++m_result.cyclomaticComplexity;

    } else if (v == "catch") {
        ++m_result.cyclomaticComplexity;

    } else if (v == "try") {
        ++m_result.tryCatchCount;

    } else if (v == "class" || v == "struct" || v == "interface" ||
               v == "enum"  || v == "record" || v == "namespace") {
        // `record struct Foo(...)` / `record class Foo(...)`: the
        // "record" token itself already unwraps this two-keyword form
        // inside tryRecordClass() and captures the name once. Without
        // this guard, the very next token ("struct"/"class") would
        // independently re-trigger tryRecordClass() on the same name
        // and register the class twice.
        const bool isRecordStructOrClassTail =
            (v == "struct" || v == "class") && idx > 0 &&
            m_tokens[idx - 1].type == TokenType::KEYWORD &&
            m_tokens[idx - 1].value == "record";
        if (!isRecordStructOrClassTail) {
            tryRecordClass(idx, v);
        }

    } else if (v == "using") {
        // `using System;` / `using static System.Math;` are import
        // directives. `using (var x = ...) { }` (resource acquisition)
        // and `using var x = ...;` (using-declaration) are ordinary
        // statements, left alone.
        const bool isDirective = idx + 1 < n &&
            ((m_tokens[idx + 1].type == TokenType::IDENTIFIER) ||
             (m_tokens[idx + 1].type == TokenType::KEYWORD &&
              m_tokens[idx + 1].value == "static"));
        if (isDirective) {
            ++m_result.includeCount;
            m_result.includeTargets.push_back(extractUsingTarget(idx));
        }
    }
}

void CSharpParser::tryBeginFunction(std::size_t identIdx, std::size_t openParenIdx) {
    if (identIdx > 0) {
        const Token& prev = m_tokens[identIdx - 1];
        if (prev.type == TokenType::KEYWORD &&
            (prev.value == "new"    || prev.value == "class"     ||
             prev.value == "struct" || prev.value == "interface" ||
             prev.value == "enum"   || prev.value == "record")) {
            return;
        }
    }

    const std::size_t closeParenIdx = findMatchingParen(openParenIdx);
    if (closeParenIdx >= m_tokens.size()) return;

    const std::size_t bodyIdx = skipTrailingSpecifiers(closeParenIdx + 1);
    if (bodyIdx >= m_tokens.size()) return;
    if (m_tokens[bodyIdx].type != TokenType::OPEN_BRACE) return;

    PendingFunction pf;
    pf.info.name      = m_tokens[identIdx].value;
    pf.info.startLine = m_tokens[identIdx].line;
    pf.bodyBraceDepth = m_braceAnalyzer.depth() + 1;
    m_fnStack.push_back(std::move(pf));

    m_pendingArrowName.clear();
}

void CSharpParser::tryBeginArrowFunction(std::size_t arrowFirstIdx) {
    std::size_t after = arrowFirstIdx + 2; // past '=' and '>'
    while (after < m_tokens.size() && m_tokens[after].type == TokenType::NEWLINE) ++after;

    if (after >= m_tokens.size() || m_tokens[after].type != TokenType::OPEN_BRACE) {
        // Expression-bodied lambda (`x => x + 1`) or expression-bodied
        // member (`Foo() => 42;`) -- not brace-tracked, documented scope
        // limit (see class comment).
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

void CSharpParser::handleVariableDecl(std::size_t identIdx) {
    static const std::unordered_set<std::string> kDeclKeywords = {
        "byte","sbyte","short","ushort","int","uint","long","ulong",
        "char","float","double","decimal","bool","string","object",
        "var","dynamic"
    };

    if (identIdx == 0) return;

    const std::size_t prev = identIdx - 1;
    if (m_tokens[prev].type != TokenType::KEYWORD) return;
    if (!kDeclKeywords.count(m_tokens[prev].value)) return;

    const std::size_t next = identIdx + 1;
    if (next < m_tokens.size() && m_tokens[next].type == TokenType::OPEN_PAREN) return;

    ++m_result.variableCount;
}

bool CSharpParser::precededByValueTypeKeyword(std::size_t idx) const noexcept {
    static const std::unordered_set<std::string> kValueTypeKeywords = {
        "int","uint","long","ulong","short","ushort","byte","sbyte",
        "char","bool","decimal","double","float"
    };
    if (idx == 0) return false;
    const Token& prev = m_tokens[idx - 1];
    return prev.type == TokenType::KEYWORD && kValueTypeKeywords.count(prev.value) != 0;
}

void CSharpParser::tryRecordClass(std::size_t kwIdx, const std::string& kwValue) {
    std::size_t nameIdx = kwIdx + 1;

    // `record struct Foo(...)` / `record class Foo(...)` -- unwrap the
    // extra keyword so the type name lands in the right place.
    if (kwValue == "record" && nameIdx < m_tokens.size() &&
        m_tokens[nameIdx].type == TokenType::KEYWORD &&
        (m_tokens[nameIdx].value == "class" || m_tokens[nameIdx].value == "struct")) {
        ++nameIdx;
    }

    if (nameIdx < m_tokens.size() && m_tokens[nameIdx].type == TokenType::IDENTIFIER) {
        ClassInfo ci;
        ci.name = m_tokens[nameIdx].value;
        ci.line = m_tokens[kwIdx].line;
        if      (kwValue == "class")     ci.kind = ClassInfo::Kind::CLASS;
        else if (kwValue == "interface") ci.kind = ClassInfo::Kind::CLASS;
        else if (kwValue == "enum")      ci.kind = ClassInfo::Kind::ENUM;
        else if (kwValue == "namespace") ci.kind = ClassInfo::Kind::NAMESPACE;
        else                              ci.kind = ClassInfo::Kind::STRUCT; // struct, record
        m_result.classes.push_back(ci);
    }
    // File-scoped `namespace Foo;` (no braces at all) still records
    // fine -- this function never required a following brace either way.
}

// Returns the dotted target of a `using X;` / `using static X;` /
// `using Alias = X;` directive. Generic-argument tails on an alias
// target (`using L = List<int>;`) are dropped at the first non-
// identifier/'.' token -- a partial-capture limitation, not a crash.
std::string CSharpParser::extractUsingTarget(std::size_t kwIdx) const {
    const std::size_t n = m_tokens.size();
    std::size_t i = kwIdx + 1;

    if (i < n && m_tokens[i].type == TokenType::KEYWORD && m_tokens[i].value == "static") {
        ++i;
    }

    std::size_t eqIdx = n;
    for (std::size_t j = i; j < n && m_tokens[j].type != TokenType::SEMICOLON; ++j) {
        if (m_tokens[j].type == TokenType::OPERATOR && m_tokens[j].value == "=") {
            eqIdx = j;
            break;
        }
    }
    const std::size_t start = (eqIdx < n) ? eqIdx + 1 : i;

    std::string target;
    for (std::size_t k = start; k < n; ++k) {
        const Token& t = m_tokens[k];
        if (t.type == TokenType::SEMICOLON) break;
        if (t.type == TokenType::IDENTIFIER) {
            target += t.value;
        } else if (t.type == TokenType::OPERATOR && t.value == ".") {
            target += t.value;
        } else {
            break;
        }
    }
    return target;
}

std::size_t CSharpParser::findMatchingParen(std::size_t openIdx) const {
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

// Skips NEWLINEs and, mirroring JavaParser's `throws`-clause skip shape
// exactly, a generic type-parameter constraint clause
// (`Method<T>(...) where T : IComparable<T>`), which sits between the
// parameter list's ')' and the body's '{'. Multiple `where` clauses in
// sequence (one per constrained type parameter) are handled by the
// outer while re-entering this branch after each one.
std::size_t CSharpParser::skipTrailingSpecifiers(std::size_t i) const {
    const std::size_t n = m_tokens.size();

    while (i < n) {
        const Token& t = m_tokens[i];

        if (t.type == TokenType::NEWLINE) { ++i; continue; }

        if (t.type == TokenType::KEYWORD && t.value == "where") {
            ++i;
            while (i < n &&
                   m_tokens[i].type != TokenType::OPEN_BRACE &&
                   m_tokens[i].type != TokenType::SEMICOLON) {
                ++i;
            }
            continue;
        }

        break;
    }
    return i;
}

std::size_t CSharpParser::trySkipGenericArgsToParen(std::size_t ltIdx) const {
    const std::size_t n = m_tokens.size();
    if (ltIdx >= n ||
        !(m_tokens[ltIdx].type == TokenType::OPERATOR && m_tokens[ltIdx].value == "<")) {
        return n;
    }

    int depth = 1;
    std::size_t i = ltIdx + 1;
    for (; i < n; ++i) {
        const Token& t = m_tokens[i];

        if (t.type == TokenType::OPERATOR && t.value == "<") { ++depth; continue; }
        if (t.type == TokenType::OPERATOR && t.value == ">") {
            if (--depth == 0) { ++i; break; }
            continue;
        }
        // A generic type-parameter/argument list can't validly contain
        // any of these at unbalanced depth -- a real comparison chain
        // (`x < y > z;`) hits one of these long before it would ever
        // look like a closed, well-formed generic list, so this is a
        // safe bailout rather than a source of false positives.
        if (t.type == TokenType::SEMICOLON  || t.type == TokenType::OPEN_BRACE ||
            t.type == TokenType::CLOSE_BRACE || t.type == TokenType::OPEN_PAREN ||
            t.type == TokenType::CLOSE_PAREN || t.type == TokenType::END_OF_FILE) {
            return n;
        }
    }
    if (depth != 0) return n; // ran off the end unbalanced

    while (i < n && m_tokens[i].type == TokenType::NEWLINE) ++i;
    if (i < n && m_tokens[i].type == TokenType::OPEN_PAREN) return i;
    return n;
}

int CSharpParser::countTodos(const std::string& text) const {
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
