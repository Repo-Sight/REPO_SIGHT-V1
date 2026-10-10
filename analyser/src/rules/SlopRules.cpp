#include "rules/SlopRules.h"

#include <cctype>
#include <cstddef>
#include <unordered_set>

namespace cma {
namespace {

constexpr int kComplexFunctionThreshold = 10;

// Rule IDs are written out in full (not built from a prefix) so the rule
// catalog parity test, which scans this directory for string literals, can
// see every ID this file can emit.
struct SlopIds {
    const char* complexFunction;
    const char* placeholder;
};

SlopIds idsFor(Language lang) {
    switch (lang) {
        case Language::Cpp:        return {"cpp-complex-function",    "cpp-unreviewed-placeholder"};
        case Language::Python:     return {"py-complex-function",     "py-unreviewed-placeholder"};
        case Language::Java:       return {"java-complex-function",   "java-unreviewed-placeholder"};
        case Language::TypeScript: return {"ts-complex-function",     "ts-unreviewed-placeholder"};
        case Language::JavaScript: return {"js-complex-function",     "js-unreviewed-placeholder"};
        case Language::CSharp:     return {"csharp-complex-function", "csharp-unreviewed-placeholder"};
    }
    return {nullptr, nullptr};
}

Violation makeSlopViolation(const std::string& path, int line, const char* ruleId,
                            Language lang, std::string message) {
    Violation v;
    v.path = path;
    v.line = line;
    v.ruleId = ruleId;
    v.language = languageToString(lang);
    v.message = std::move(message);
    v.severity = "warning";
    return v;
}

bool isOp(const Token& t, const char* value) {
    return t.type == TokenType::OPERATOR && t.value == value;
}

bool isValueTypeKeyword(const Token& t) {
    static const std::unordered_set<std::string> kTypes = {
        "int", "uint", "long", "ulong", "short", "ushort", "byte", "sbyte",
        "char", "bool", "decimal", "double", "float"};
    return t.type == TokenType::KEYWORD && kTypes.count(t.value) != 0;
}

// How many decision points the token at `i` adds. `consumed` is set to 1 when
// the token and the one after it form a single operator (&&, ||, ??) so the
// caller skips the second half. Mirrors each language's parser.
int decisionPoints(Language lang, const std::vector<Token>& tk, std::size_t i,
                   std::size_t& consumed) {
    consumed = 0;
    const Token& t = tk[i];
    const std::size_t n = tk.size();
    const bool hasNext = i + 1 < n;

    if (t.type == TokenType::KEYWORD) {
        const std::string& v = t.value;
        if (lang == Language::Python) {
            return (v == "if" || v == "elif" || v == "for" || v == "while" ||
                    v == "and" || v == "or" || v == "except") ? 1 : 0;
        }
        if (v == "for" || v == "while" || v == "do" || v == "if" || v == "switch" ||
            v == "case" || v == "catch") {
            return 1;
        }
        if (lang == Language::CSharp && (v == "foreach" || v == "when")) return 1;
        return 0;
    }

    if (t.type != TokenType::OPERATOR || lang == Language::Python) return 0;

    // && and || arrive as two consecutive single-character operator tokens.
    if ((t.value == "&" || t.value == "|") && hasNext && isOp(tk[i + 1], t.value.c_str())) {
        consumed = 1;
        return 1;
    }

    if (t.value != "?") return 0;

    // Java / C++: every '?' is a ternary.
    if (lang == Language::Java || lang == Language::Cpp) return 1;

    const bool nextIsQ = hasNext && isOp(tk[i + 1], "?");
    if (nextIsQ) {  // '??' nullish coalescing
        consumed = 1;
        return 1;
    }
    const bool nextIsDot = hasNext && isOp(tk[i + 1], ".");
    if (lang == Language::JavaScript) return nextIsDot ? 0 : 1;
    if (lang == Language::TypeScript) {
        const bool nextIsColon = hasNext && isOp(tk[i + 1], ":");
        return (nextIsDot || nextIsColon) ? 0 : 1;
    }
    // C#: '?.' and '?[' are null-conditional access, 'int?' is a nullable type.
    const bool nextIsBracket = hasNext && tk[i + 1].type == TokenType::OPEN_BRACKET;
    if (nextIsDot || nextIsBracket) return 0;
    if (i > 0 && isValueTypeKeyword(tk[i - 1])) return 0;
    return 1;
}

// Index of the smallest function whose line range contains `line`, or -1.
int innermostFunction(const std::vector<FunctionInfo>& fns, int line) {
    int best = -1;
    int bestSpan = 0;
    for (std::size_t k = 0; k < fns.size(); ++k) {
        const FunctionInfo& f = fns[k];
        if (f.startLine <= 0 || f.endLine < f.startLine) continue;
        if (line < f.startLine || line > f.endLine) continue;
        const int span = f.endLine - f.startLine;
        if (best < 0 || span < bestSpan ||
            (span == bestSpan && f.startLine >= fns[static_cast<std::size_t>(best)].startLine)) {
            best = static_cast<int>(k);
            bestSpan = span;
        }
    }
    return best;
}

void checkComplexFunctions(Language lang, const SlopIds& ids, const std::string& path,
                           const std::vector<Token>& tokens, const FileMetrics& fm,
                           std::vector<Violation>& out) {
    if (fm.functions.empty()) return;

    std::vector<int> complexity(fm.functions.size(), 1);
    for (std::size_t i = 0; i < tokens.size(); ++i) {
        std::size_t consumed = 0;
        const int pts = decisionPoints(lang, tokens, i, consumed);
        if (pts > 0) {
            const int owner = innermostFunction(fm.functions, tokens[i].line);
            if (owner >= 0) complexity[static_cast<std::size_t>(owner)] += pts;
        }
        i += consumed;
    }

    for (std::size_t k = 0; k < fm.functions.size(); ++k) {
        if (complexity[k] <= kComplexFunctionThreshold) continue;
        const FunctionInfo& f = fm.functions[k];
        const std::string name = f.name.empty() ? "(anonymous)" : f.name;
        out.push_back(makeSlopViolation(
            path, f.startLine, ids.complexFunction, lang,
            "Function '" + name + "' has cyclomatic complexity " + std::to_string(complexity[k]) +
                " (limit " + std::to_string(kComplexFunctionThreshold) +
                ") -- split it into smaller functions"));
    }
}

// Lower-cased, whitespace-collapsed copy so a phrase still matches across a
// line break inside a block comment.
std::string normalised(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    bool prevSpace = false;
    for (char ch : s) {
        const unsigned char c = static_cast<unsigned char>(ch);
        if (std::isspace(c)) {
            if (!prevSpace) out += ' ';
            prevSpace = true;
        } else {
            out += static_cast<char>(std::tolower(c));
            prevSpace = false;
        }
    }
    return out;
}

// High-precision phrases only. Ordinary prose such as "the rest of the code
// assumes the list is sorted" must NOT match, so the "rest of ..." entries
// need an elision marker or a "remains / unchanged" ending.
const char* const kPlaceholderPhrases[] = {
    "as an ai language model", "as an ai assistant", "as a large language model",
    "i cannot assist with", "i can't assist with",
    "here's the updated", "here is the updated", "here's the complete",
    "here is the complete", "here's the full", "here is the full",
    "... rest of", "rest of the code remains", "rest of the code is unchanged",
    "rest of the file remains", "rest of the file is unchanged",
    "rest of the implementation remains", "rest of the function remains",
    "rest of the class remains", "rest of your code",
    "existing code remains", "existing code here", "... existing code",
    "existing code ...", "... unchanged", "unchanged ...", "(unchanged)",
    "other methods remain", "remaining code remains",
    "your code here", "your implementation here", "your logic here",
    "implementation goes here", "code goes here", "logic goes here",
    "add your code here", "add your logic here", "insert your code here",
    "placeholder implementation", "lorem ipsum",
};

void checkPlaceholders(Language lang, const SlopIds& ids, const std::string& path,
                       const std::vector<Token>& tokens, std::vector<Violation>& out) {
    for (const Token& tok : tokens) {
        if (tok.type != TokenType::LINE_COMMENT && tok.type != TokenType::BLOCK_COMMENT) continue;
        const std::string text = normalised(tok.value);
        for (const char* phrase : kPlaceholderPhrases) {
            if (text.find(phrase) == std::string::npos) continue;
            out.push_back(makeSlopViolation(
                path, tok.line, ids.placeholder, lang,
                std::string("Comment looks like an AI-assistant leftover or an unfinished placeholder (\"") +
                    phrase + "\") -- review the code around it, then complete or remove it"));
            break;
        }
    }
}

} // namespace

std::vector<Violation> checkSlopRules(Language lang, const std::string& path,
                                      const std::vector<Token>& tokens, const FileMetrics& fm) {
    std::vector<Violation> out;
    const SlopIds ids = idsFor(lang);
    if (ids.complexFunction == nullptr) return out;
    checkComplexFunctions(lang, ids, path, tokens, fm, out);
    checkPlaceholders(lang, ids, path, tokens, out);
    return out;
}

} // namespace cma
