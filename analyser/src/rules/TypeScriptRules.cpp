#include "rules/TypeScriptRules.h"

#include <cctype>

namespace cma {

namespace {

constexpr int kLongFunctionThreshold = 100;
constexpr int kDeepNestingThreshold  = 6;

bool hasTicketReference(const std::string& text) {
    for (std::size_t i = 0; i < text.size(); ++i) {
        if (text[i] == '#' && i + 1 < text.size() &&
            std::isdigit(static_cast<unsigned char>(text[i + 1]))) {
            return true;
        }
    }
    for (std::size_t i = 0; i < text.size(); ++i) {
        if (std::isupper(static_cast<unsigned char>(text[i]))) {
            std::size_t j = i;
            while (j < text.size() && std::isupper(static_cast<unsigned char>(text[j]))) ++j;
            if (j < text.size() && text[j] == '-' && j + 1 < text.size() &&
                std::isdigit(static_cast<unsigned char>(text[j + 1]))) {
                return true;
            }
            i = j;
        }
    }
    return false;
}

Violation makeViolation(const std::string& path, int line, const std::string& ruleId,
                         std::string message, const std::string& severity) {
    Violation v;
    v.path = path; v.line = line; v.ruleId = ruleId; v.language = "typescript";
    v.message = std::move(message); v.severity = severity;
    return v;
}

} // anonymous namespace

std::vector<Violation> checkTypeScriptRules(const std::string& path, const std::vector<Token>& tokens,
                                             const FileMetrics& fm) {
    std::vector<Violation> out;
    const std::size_t n = tokens.size();

    for (std::size_t i = 0; i < n; ++i) {
        const Token& tok = tokens[i];

        // ts-empty-catch-block: catch ( ... ) { [NEWLINE]* } or the
        // optional-catch-binding form catch { [NEWLINE]* }.
        if (tok.type == TokenType::KEYWORD && tok.value == "catch") {
            if (i + 1 < n && tokens[i + 1].type == TokenType::OPEN_PAREN) {
                std::size_t j = i + 2;
                int depth = 1;
                while (j < n && depth > 0) {
                    if (tokens[j].type == TokenType::OPEN_PAREN) ++depth;
                    else if (tokens[j].type == TokenType::CLOSE_PAREN) { --depth; if (depth == 0) break; }
                    ++j;
                }
                if (j + 1 < n && tokens[j + 1].type == TokenType::OPEN_BRACE) {
                    std::size_t k = j + 2;
                    while (k < n && tokens[k].type == TokenType::NEWLINE) ++k;
                    if (k < n && tokens[k].type == TokenType::CLOSE_BRACE) {
                        out.push_back(makeViolation(path, tok.line, "ts-empty-catch-block",
                            "Empty catch block silently swallows the error", "warning"));
                    }
                }
            } else if (i + 1 < n && tokens[i + 1].type == TokenType::OPEN_BRACE) {
                std::size_t k = i + 2;
                while (k < n && tokens[k].type == TokenType::NEWLINE) ++k;
                if (k < n && tokens[k].type == TokenType::CLOSE_BRACE) {
                    out.push_back(makeViolation(path, tok.line, "ts-empty-catch-block",
                        "Empty catch block silently swallows the error", "warning"));
                }
            }
        }

        // ts-explicit-any: ': any' type annotation or 'as any' assertion.
        if (tok.type == TokenType::IDENTIFIER && tok.value == "any" && i > 0) {
            const Token& prev = tokens[i - 1];
            const bool afterColon = prev.type == TokenType::OPERATOR && prev.value == ":";
            const bool afterAs    = prev.type == TokenType::KEYWORD  && prev.value == "as";
            if (afterColon || afterAs) {
                out.push_back(makeViolation(path, tok.line, "ts-explicit-any",
                    "Explicit 'any' discards type checking for this value -- prefer a specific "
                    "type or 'unknown'", "info"));
            }
        }

        // ts-var-usage: legacy function-scoped 'var'.
        if (tok.type == TokenType::KEYWORD && tok.value == "var") {
            out.push_back(makeViolation(path, tok.line, "ts-var-usage",
                "'var' is function-scoped and hoisted -- prefer 'let' or 'const'", "info"));
        }

        // ts-loose-equality: '==' / '!=' that are NOT the strict '===' /
        // '!==' forms. Each '=' or '!' is a separate single-char OPERATOR
        // token (see TypeScriptLexer::lexSymbol), so this walks the run
        // length of consecutive '=' tokens to tell '==' (2) apart from
        // '===' (3), and separately checks the '=' run right after a
        // leading '!' to tell '!=' (1) apart from '!==' (2).
        if (tok.type == TokenType::OPERATOR && tok.value == "=" &&
            (i == 0 || !(tokens[i - 1].type == TokenType::OPERATOR &&
                         (tokens[i - 1].value == "=" || tokens[i - 1].value == "!")))) {
            std::size_t j = i;
            int runLen = 0;
            while (j < n && tokens[j].type == TokenType::OPERATOR && tokens[j].value == "=") {
                ++runLen; ++j;
            }
            if (runLen == 2) {
                out.push_back(makeViolation(path, tok.line, "ts-loose-equality",
                    "'==' performs type coercion -- prefer '===' for predictable comparisons", "info"));
            }
        }
        if (tok.type == TokenType::OPERATOR && tok.value == "!" &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "=") {
            std::size_t j = i + 1;
            int eqRun = 0;
            while (j < n && tokens[j].type == TokenType::OPERATOR && tokens[j].value == "=") {
                ++eqRun; ++j;
            }
            if (eqRun == 1) {
                out.push_back(makeViolation(path, tok.line, "ts-loose-equality",
                    "'!=' performs type coercion -- prefer '!==' for predictable comparisons", "info"));
            }
        }
    }

    // ts-long-method
    for (const auto& fn : fm.functions) {
        if (fn.lineCount() > kLongFunctionThreshold) {
            out.push_back(makeViolation(path, fn.startLine, "ts-long-method",
                "Function '" + fn.name + "' is " + std::to_string(fn.lineCount()) +
                " lines -- consider splitting it", "info"));
        }
    }

    // ts-deep-nesting
    if (fm.maxNestingDepth > kDeepNestingThreshold) {
        out.push_back(makeViolation(path, 0, "ts-deep-nesting",
            "File reaches nesting depth " + std::to_string(fm.maxNestingDepth) +
            " -- consider extracting helper functions", "info"));
    }

    // ts-todo-without-ticket
    for (const auto& tok : tokens) {
        if (tok.type != TokenType::LINE_COMMENT && tok.type != TokenType::BLOCK_COMMENT) continue;
        const bool hasTodo = tok.value.find("TODO") != std::string::npos ||
                              tok.value.find("FIXME") != std::string::npos;
        if (!hasTodo || hasTicketReference(tok.value)) continue;
        out.push_back(makeViolation(path, tok.line, "ts-todo-without-ticket",
            "TODO/FIXME without a ticket reference (#123 or PROJ-123)", "info"));
    }

    return out;
}

} // namespace cma
