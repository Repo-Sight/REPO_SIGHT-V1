#include "rules/JavaScriptRules.h"

#include <algorithm>
#include <array>
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
    v.path = path; v.line = line; v.ruleId = ruleId; v.language = "javascript";
    v.message = std::move(message); v.severity = severity;
    return v;
}

// Phase 6c: identical to makeViolation() but stamps category="security" so
// the frontend's Security tab can filter these out of the general
// style/best-practice violations list without a new report type.
Violation makeSecurityViolation(const std::string& path, int line, const std::string& ruleId,
                                  std::string message, const std::string& severity) {
    Violation v = makeViolation(path, line, ruleId, std::move(message), severity);
    v.category = "security";
    return v;
}

std::string toLowerCopy(const std::string& s) {
    std::string lower = s;
    std::transform(lower.begin(), lower.end(), lower.begin(),
                    [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return lower;
}

// Phase 6c heuristic: does this identifier look like it names a credential?
// Lowercased substring match -- intentionally simple (flags for human
// review, isn't a proof of anything leaking).
bool isSuspiciousSecretName(const std::string& name) {
    const std::string lower = toLowerCopy(name);
    static const std::array<const char*, 8> needles = {
        "password", "passwd", "secret", "apikey", "api_key",
        "accesskey", "access_key", "authtoken"
    };
    for (const char* needle : needles) {
        if (lower.find(needle) != std::string::npos) return true;
    }
    return false;
}

// Phase 6c heuristic: a STRING_LITERAL token's value includes its
// surrounding quote characters -- strip them before judging whether the
// literal is long enough to plausibly be a real secret rather than a
// placeholder/empty string.
bool isPlausibleSecretLiteral(const std::string& raw) {
    if (raw.size() < 2) return false;
    const std::string stripped = raw.substr(1, raw.size() - 2);
    return stripped.size() >= 6;
}

} // anonymous namespace

std::vector<Violation> checkJavaScriptRules(const std::string& path, const std::vector<Token>& tokens,
                                             const FileMetrics& fm) {
    std::vector<Violation> out;
    const std::size_t n = tokens.size();

    for (std::size_t i = 0; i < n; ++i) {
        const Token& tok = tokens[i];

        // js-empty-catch-block: catch ( ... ) { [NEWLINE]* } or the
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
                        out.push_back(makeViolation(path, tok.line, "js-empty-catch-block",
                            "Empty catch block silently swallows the error", "warning"));
                    }
                }
            } else if (i + 1 < n && tokens[i + 1].type == TokenType::OPEN_BRACE) {
                std::size_t k = i + 2;
                while (k < n && tokens[k].type == TokenType::NEWLINE) ++k;
                if (k < n && tokens[k].type == TokenType::CLOSE_BRACE) {
                    out.push_back(makeViolation(path, tok.line, "js-empty-catch-block",
                        "Empty catch block silently swallows the error", "warning"));
                }
            }
        }

        // js-var-usage: legacy function-scoped 'var'.
        if (tok.type == TokenType::KEYWORD && tok.value == "var") {
            out.push_back(makeViolation(path, tok.line, "js-var-usage",
                "'var' is function-scoped and hoisted -- prefer 'let' or 'const'", "info"));
        }

        // js-loose-equality: '==' / '!=' that are NOT the strict '===' /
        // '!==' forms. Each '=' or '!' is a separate single-char OPERATOR
        // token (see JavaScriptLexer::lexSymbol), so this walks the run
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
                out.push_back(makeViolation(path, tok.line, "js-loose-equality",
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
                out.push_back(makeViolation(path, tok.line, "js-loose-equality",
                    "'!=' performs type coercion -- prefer '!==' for predictable comparisons", "info"));
            }
        }

        // js-sec-eval: eval(...) executes a string as code.
        if (tok.type == TokenType::IDENTIFIER && tok.value == "eval" &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPEN_PAREN) {
            out.push_back(makeSecurityViolation(path, tok.line, "js-sec-eval",
                "'eval(...)' executes a string as code -- review that no part of it is built "
                "from untrusted input", "warning"));
        }

        // js-sec-child-process-exec: exec(...)/execSync(...) shell out to
        // the OS (typically via Node's child_process module).
        if (tok.type == TokenType::IDENTIFIER &&
            (tok.value == "exec" || tok.value == "execSync") &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPEN_PAREN) {
            out.push_back(makeSecurityViolation(path, tok.line, "js-sec-child-process-exec",
                "'" + tok.value + "(...)' runs a shell command -- review that no part of it is "
                "built from untrusted input", "warning"));
        }

        // js-sec-inner-html: assigning to .innerHTML with unescaped content
        // is a classic DOM-based XSS vector.
        if (tok.type == TokenType::OPERATOR && tok.value == "." &&
            i + 2 < n &&
            tokens[i + 1].type == TokenType::IDENTIFIER && tokens[i + 1].value == "innerHTML" &&
            tokens[i + 2].type == TokenType::OPERATOR && tokens[i + 2].value == "=" &&
            !(i + 3 < n && tokens[i + 3].type == TokenType::OPERATOR && tokens[i + 3].value == "=")) {
            out.push_back(makeSecurityViolation(path, tokens[i + 1].line, "js-sec-inner-html",
                "Assigning to '.innerHTML' inserts raw HTML into the page -- review that the "
                "value is sanitized/escaped, or use textContent for plain text", "warning"));
        }

        // js-sec-weak-hash: crypto.createHash('md5'/'sha1') is broken for
        // collision resistance -- fine for checksums, not for passwords.
        if (tok.type == TokenType::IDENTIFIER && tok.value == "createHash" &&
            i + 2 < n &&
            tokens[i + 1].type == TokenType::OPEN_PAREN &&
            tokens[i + 2].type == TokenType::STRING_LITERAL) {
            const std::string algo = toLowerCopy(tokens[i + 2].value);
            if (algo.find("md5") != std::string::npos || algo.find("sha1") != std::string::npos) {
                out.push_back(makeSecurityViolation(path, tok.line, "js-sec-weak-hash",
                    "createHash(" + tokens[i + 2].value + ") is a broken/weak hash -- avoid it "
                    "for passwords or integrity checks that need collision resistance", "info"));
            }
        }

        // js-sec-disabled-tls: 'rejectUnauthorized: false' disables TLS
        // certificate validation for the request/socket it configures.
        if (tok.type == TokenType::IDENTIFIER && tok.value == "rejectUnauthorized" &&
            i + 2 < n &&
            tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == ":" &&
            tokens[i + 2].type == TokenType::KEYWORD && tokens[i + 2].value == "false") {
            out.push_back(makeSecurityViolation(path, tok.line, "js-sec-disabled-tls",
                "'rejectUnauthorized: false' disables TLS certificate validation -- review "
                "whether this can reach production", "warning"));
        }

        // js-sec-sql-string-concat: query(...) with a '+' inside the call is
        // a classic SQL-injection shape -- review for a parameterized query.
        if (tok.type == TokenType::IDENTIFIER && tok.value == "query" &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPEN_PAREN) {
            std::size_t j = i + 2;
            int depth = 1;
            bool sawConcat = false;
            while (j < n && depth > 0) {
                if (tokens[j].type == TokenType::OPEN_PAREN) ++depth;
                else if (tokens[j].type == TokenType::CLOSE_PAREN) { --depth; if (depth == 0) break; }
                else if (tokens[j].type == TokenType::OPERATOR && tokens[j].value == "+") sawConcat = true;
                ++j;
            }
            if (sawConcat) {
                out.push_back(makeSecurityViolation(path, tok.line, "js-sec-sql-string-concat",
                    "'query(...)' builds its statement with string concatenation -- review for "
                    "SQL injection, prefer parameterized/tagged queries", "warning"));
            }
        }

        // js-sec-hardcoded-secret: NAME = "literal" where NAME looks like a
        // credential. Heuristic only -- flags for review, not a proven leak.
        if (tok.type == TokenType::IDENTIFIER && isSuspiciousSecretName(tok.value) &&
            i + 2 < n &&
            tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "=" &&
            tokens[i + 2].type == TokenType::STRING_LITERAL &&
            isPlausibleSecretLiteral(tokens[i + 2].value)) {
            out.push_back(makeSecurityViolation(path, tok.line, "js-sec-hardcoded-secret",
                "'" + tok.value + "' is assigned a string literal that looks like a credential "
                "-- review whether this should come from a secret store or environment "
                "variable instead", "warning"));
        }
    }

    // js-long-method
    for (const auto& fn : fm.functions) {
        if (fn.lineCount() > kLongFunctionThreshold) {
            out.push_back(makeViolation(path, fn.startLine, "js-long-method",
                "Function '" + fn.name + "' is " + std::to_string(fn.lineCount()) +
                " lines -- consider splitting it", "info"));
        }
    }

    // js-deep-nesting
    if (fm.maxNestingDepth > kDeepNestingThreshold) {
        out.push_back(makeViolation(path, 0, "js-deep-nesting",
            "File reaches nesting depth " + std::to_string(fm.maxNestingDepth) +
            " -- consider extracting helper functions", "info"));
    }

    // js-todo-without-ticket
    for (const auto& tok : tokens) {
        if (tok.type != TokenType::LINE_COMMENT && tok.type != TokenType::BLOCK_COMMENT) continue;
        const bool hasTodo = tok.value.find("TODO") != std::string::npos ||
                              tok.value.find("FIXME") != std::string::npos;
        if (!hasTodo || hasTicketReference(tok.value)) continue;
        out.push_back(makeViolation(path, tok.line, "js-todo-without-ticket",
            "TODO/FIXME without a ticket reference (#123 or PROJ-123)", "info"));
    }

    return out;
}

} // namespace cma
