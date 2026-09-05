#include "rules/CSharpRules.h"

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
    v.path = path; v.line = line; v.ruleId = ruleId; v.language = "csharp";
    v.message = std::move(message); v.severity = severity;
    return v;
}

} // anonymous namespace

std::vector<Violation> checkCSharpRules(const std::string& path, const std::vector<Token>& tokens,
                                         const FileMetrics& fm) {
    std::vector<Violation> out;
    const std::size_t n = tokens.size();

    for (std::size_t i = 0; i < n; ++i) {
        const Token& tok = tokens[i];

        // csharp-empty-catch-block: catch ( ... ) { [NEWLINE]* } or the
        // typeless/bindingless form catch { [NEWLINE]* }.
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
                        out.push_back(makeViolation(path, tok.line, "csharp-empty-catch-block",
                            "Empty catch block silently swallows the exception", "warning"));
                    }
                }
            } else if (i + 1 < n && tokens[i + 1].type == TokenType::OPEN_BRACE) {
                std::size_t k = i + 2;
                while (k < n && tokens[k].type == TokenType::NEWLINE) ++k;
                if (k < n && tokens[k].type == TokenType::CLOSE_BRACE) {
                    out.push_back(makeViolation(path, tok.line, "csharp-empty-catch-block",
                        "Empty catch block silently swallows the exception", "warning"));
                }
            }
        }

        // csharp-public-field: public [modifiers] TYPE name (;|=|,) --
        // excludes methods (stops at '(') and properties (stops at
        // '{', which is the correct/idiomatic C# encapsulation
        // mechanism, not an anti-pattern), and excludes const fields and
        // static+readonly constants.
        if (tok.type == TokenType::KEYWORD && tok.value == "public") {
            std::size_t j = i + 1;
            bool isStatic = false, isReadonly = false, isConst = false;
            while (j < n && tokens[j].type == TokenType::KEYWORD &&
                   (tokens[j].value == "static"   || tokens[j].value == "readonly" ||
                    tokens[j].value == "const"    || tokens[j].value == "volatile" ||
                    tokens[j].value == "virtual"  || tokens[j].value == "override" ||
                    tokens[j].value == "abstract" || tokens[j].value == "sealed"   ||
                    tokens[j].value == "async")) {
                if (tokens[j].value == "static")   isStatic   = true;
                if (tokens[j].value == "readonly") isReadonly = true;
                if (tokens[j].value == "const")    isConst    = true;
                ++j;
            }
            if (!(isConst || (isStatic && isReadonly))) {
                std::size_t k = j;
                int depth = 0;
                std::size_t nameIdx = n;
                while (k < n) {
                    const Token& t = tokens[k];
                    if (t.type == TokenType::OPERATOR && t.value == "<") { ++depth; ++k; continue; }
                    if (t.type == TokenType::OPERATOR && t.value == ">") { if (depth > 0) --depth; ++k; continue; }
                    if (t.type == TokenType::OPEN_BRACKET)  { ++depth; ++k; continue; }
                    if (t.type == TokenType::CLOSE_BRACKET) { if (depth > 0) --depth; ++k; continue; }
                    if (depth == 0 &&
                        (t.type == TokenType::SEMICOLON ||
                         (t.type == TokenType::OPERATOR && t.value == "=") ||
                         t.type == TokenType::OPEN_PAREN ||
                         t.type == TokenType::OPEN_BRACE ||
                         (t.type == TokenType::PUNCTUATION && t.value == ","))) {
                        break;
                    }
                    if (depth == 0 && t.type == TokenType::IDENTIFIER) nameIdx = k;
                    ++k;
                }
                if (nameIdx < n && k < n &&
                    tokens[k].type != TokenType::OPEN_PAREN &&
                    tokens[k].type != TokenType::OPEN_BRACE) {
                    out.push_back(makeViolation(path, tokens[nameIdx].line, "csharp-public-field",
                        "Public field '" + tokens[nameIdx].value +
                        "' breaks encapsulation -- consider a property or a private field with accessors",
                        "info"));
                }
            }
        }

        // csharp-console-writeline: Console.WriteLine( or Console.Write(
        if (tok.type == TokenType::IDENTIFIER && tok.value == "Console" &&
            i + 3 < n &&
            tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "." &&
            tokens[i + 2].type == TokenType::IDENTIFIER &&
            (tokens[i + 2].value == "WriteLine" || tokens[i + 2].value == "Write") &&
            tokens[i + 3].type == TokenType::OPEN_PAREN) {
            out.push_back(makeViolation(path, tok.line, "csharp-console-writeline",
                "Console." + tokens[i + 2].value +
                "() is easy to lose in production -- prefer a logger (ILogger, etc.)", "info"));
        }

        // csharp-async-void: 'async void MethodName(' -- exceptions
        // thrown inside can't be awaited/caught by the caller.
        if (tok.type == TokenType::KEYWORD && tok.value == "async" &&
            i + 1 < n && tokens[i + 1].type == TokenType::KEYWORD && tokens[i + 1].value == "void") {
            const std::string name =
                (i + 2 < n && tokens[i + 2].type == TokenType::IDENTIFIER) ? tokens[i + 2].value : "<unknown>";
            out.push_back(makeViolation(path, tok.line, "csharp-async-void",
                "'async void " + name + "' can't be awaited -- an exception it throws can crash the "
                "process instead of being observable by the caller -- prefer 'async Task'", "warning"));
        }
    }

    // csharp-long-method
    for (const auto& fn : fm.functions) {
        if (fn.lineCount() > kLongFunctionThreshold) {
            out.push_back(makeViolation(path, fn.startLine, "csharp-long-method",
                "Method '" + fn.name + "' is " + std::to_string(fn.lineCount()) +
                " lines -- consider splitting it", "info"));
        }
    }

    // csharp-deep-nesting
    if (fm.maxNestingDepth > kDeepNestingThreshold) {
        out.push_back(makeViolation(path, 0, "csharp-deep-nesting",
            "File reaches nesting depth " + std::to_string(fm.maxNestingDepth) +
            " -- consider extracting helper methods", "info"));
    }

    // csharp-todo-without-ticket
    for (const auto& tok : tokens) {
        if (tok.type != TokenType::LINE_COMMENT && tok.type != TokenType::BLOCK_COMMENT) continue;
        const bool hasTodo = tok.value.find("TODO") != std::string::npos ||
                              tok.value.find("FIXME") != std::string::npos;
        if (!hasTodo || hasTicketReference(tok.value)) continue;
        out.push_back(makeViolation(path, tok.line, "csharp-todo-without-ticket",
            "TODO/FIXME without a ticket reference (#123 or PROJ-123)", "info"));
    }

    return out;
}

} // namespace cma
