#include "rules/CppRules.h"
 
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
    v.path = path; v.line = line; v.ruleId = ruleId; v.language = "cpp";
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

// Phase 6c heuristic: does this identifier look like it names a credential?
// Lowercased substring match -- intentionally simple (flags for human
// review, isn't a proof of anything leaking).
bool isSuspiciousSecretName(const std::string& name) {
    std::string lower;
    lower.reserve(name.size());
    for (char c : name) lower += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
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
// surrounding quote characters (see CppLexer::lexStringLiteral) -- strip
// them before judging whether the literal is long enough to plausibly be
// a real secret rather than a placeholder/empty string.
bool isPlausibleSecretLiteral(const std::string& raw) {
    if (raw.size() < 2) return false;
    const std::string stripped = raw.substr(1, raw.size() - 2);
    return stripped.size() >= 6;
}

bool isCppHeaderPath(const std::string& path) {
    static const std::array<const char*, 4> exts = {".h", ".hpp", ".hxx", ".h++"};
    for (const char* ext : exts) {
        const std::size_t elen = std::string(ext).size();
        if (path.size() >= elen && path.compare(path.size() - elen, elen, ext) == 0) return true;
    }
    return false;
}
 
} // anonymous namespace
 
std::vector<Violation> checkCppRules(const std::string& path, const std::vector<Token>& tokens,
                                       const FileMetrics& fm) {
    std::vector<Violation> out;
    const std::size_t n = tokens.size();
    const bool isHeader = isCppHeaderPath(path);
 
    bool inCondition = false;
    int  condParenDepth = 0;
 
    for (std::size_t i = 0; i < n; ++i) {
        const Token& tok = tokens[i];
 
        // cpp-raw-new-delete
        if (tok.type == TokenType::KEYWORD && (tok.value == "new" || tok.value == "delete")) {
            out.push_back(makeViolation(path, tok.line, "cpp-raw-new-delete",
                "Raw '" + tok.value + "' found -- prefer std::make_unique/std::make_shared or an RAII container",
                "info"));
        }
 
        // cpp-using-namespace-std-header
        if (isHeader && tok.type == TokenType::KEYWORD && tok.value == "using" &&
            i + 2 < n &&
            tokens[i + 1].type == TokenType::KEYWORD && tokens[i + 1].value == "namespace" &&
            tokens[i + 2].type == TokenType::IDENTIFIER && tokens[i + 2].value == "std") {
            out.push_back(makeViolation(path, tok.line, "cpp-using-namespace-std-header",
                "'using namespace std;' in a header pollutes every translation unit that includes it",
                "warning"));
        }
 
        // cpp-catch-all-ellipsis: catch ( ... ) { [NEWLINE]* }
        if (tok.type == TokenType::KEYWORD && tok.value == "catch" &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPEN_PAREN) {
            std::size_t j = i + 2;
            int depth = 1;
            bool sawEllipsis = false;
            while (j < n && depth > 0) {
                if (tokens[j].type == TokenType::OPEN_PAREN) ++depth;
                else if (tokens[j].type == TokenType::CLOSE_PAREN) { --depth; if (depth == 0) break; }
                else if (tokens[j].type == TokenType::OPERATOR && tokens[j].value == ".") sawEllipsis = true;
                ++j;
            }
            if (sawEllipsis && j + 1 < n && tokens[j + 1].type == TokenType::OPEN_BRACE) {
                std::size_t k = j + 2;
                while (k < n && tokens[k].type == TokenType::NEWLINE) ++k;
                if (k < n && tokens[k].type == TokenType::CLOSE_BRACE) {
                    out.push_back(makeViolation(path, tok.line, "cpp-catch-all-ellipsis",
                        "Empty catch(...) block silently swallows every exception", "warning"));
                }
            }
        }
 
        // cpp-magic-number-literal: numeric literal inside an if/while condition
        if (tok.type == TokenType::KEYWORD && (tok.value == "if" || tok.value == "while") &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPEN_PAREN) {
            inCondition = true;
            condParenDepth = 0;
        }
        if (inCondition) {
            if (tok.type == TokenType::OPEN_PAREN) ++condParenDepth;
            if (tok.type == TokenType::CLOSE_PAREN) {
                --condParenDepth;
                if (condParenDepth <= 0) inCondition = false;
            }
            if (tok.type == TokenType::NUMBER_LITERAL && tok.value != "0" && tok.value != "1") {
                out.push_back(makeViolation(path, tok.line, "cpp-magic-number-literal",
                    "Magic number '" + tok.value + "' in condition -- consider a named constant", "info"));
            }
        }

        // cpp-sec-system-call / cpp-sec-popen-call: shelling out with
        // caller-influenced input is a classic command-injection vector.
        if (tok.type == TokenType::IDENTIFIER &&
            (tok.value == "system" || tok.value == "popen") &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPEN_PAREN) {
            out.push_back(makeSecurityViolation(path, tok.line,
                tok.value == "system" ? "cpp-sec-system-call" : "cpp-sec-popen-call",
                "Call to '" + tok.value + "(...)' runs a shell command -- review that no part of "
                "the command is built from untrusted input", "warning"));
        }

        // cpp-sec-unsafe-buffer-fn: classic unbounded/format-string buffer
        // functions (CWE-120/CWE-676).
        if (tok.type == TokenType::IDENTIFIER &&
            (tok.value == "strcpy" || tok.value == "strcat" ||
             tok.value == "sprintf" || tok.value == "gets") &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPEN_PAREN) {
            out.push_back(makeSecurityViolation(path, tok.line, "cpp-sec-unsafe-buffer-fn",
                "'" + tok.value + "(...)' does not bound-check its destination -- prefer the "
                "bounded variant (strncpy, snprintf, fgets)", "warning"));
        }

        // cpp-sec-weak-random: rand()/srand() are not cryptographically
        // secure -- fine for simulations/games, not for tokens/keys/nonces.
        if (tok.type == TokenType::IDENTIFIER &&
            (tok.value == "rand" || tok.value == "srand") &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPEN_PAREN) {
            out.push_back(makeSecurityViolation(path, tok.line, "cpp-sec-weak-random",
                "'" + tok.value + "(...)' is not cryptographically secure -- avoid it for "
                "security-sensitive randomness (tokens, keys, nonces)", "info"));
        }

        // cpp-sec-weak-hash: MD5/SHA1 are broken for collision resistance --
        // fine for checksums, not for passwords, signatures, or integrity checks.
        if (tok.type == TokenType::IDENTIFIER &&
            (tok.value == "MD5" || tok.value == "SHA1" ||
             tok.value == "EVP_md5" || tok.value == "EVP_sha1") &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPEN_PAREN) {
            out.push_back(makeSecurityViolation(path, tok.line, "cpp-sec-weak-hash",
                "'" + tok.value + "(...)' is a broken/weak hash -- avoid it for passwords, "
                "signatures, or integrity checks that need collision resistance", "info"));
        }

        // cpp-sec-hardcoded-secret: NAME = "literal" where NAME looks like a
        // credential. Heuristic only -- flags for review, not a proven leak.
        if (tok.type == TokenType::IDENTIFIER && isSuspiciousSecretName(tok.value) &&
            i + 2 < n &&
            tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "=" &&
            tokens[i + 2].type == TokenType::STRING_LITERAL &&
            isPlausibleSecretLiteral(tokens[i + 2].value)) {
            out.push_back(makeSecurityViolation(path, tok.line, "cpp-sec-hardcoded-secret",
                "'" + tok.value + "' is assigned a string literal that looks like a credential "
                "-- review whether this should come from a secret store or environment "
                "variable instead", "warning"));
        }
    }
 
    // cpp-long-function
    for (const auto& fn : fm.functions) {
        if (fn.lineCount() > kLongFunctionThreshold) {
            out.push_back(makeViolation(path, fn.startLine, "cpp-long-function",
                "Function '" + fn.name + "' is " + std::to_string(fn.lineCount()) +
                " lines -- consider splitting it", "info"));
        }
    }
 
    // cpp-deep-nesting (file-level)
    if (fm.maxNestingDepth > kDeepNestingThreshold) {
        out.push_back(makeViolation(path, 0, "cpp-deep-nesting",
            "File reaches nesting depth " + std::to_string(fm.maxNestingDepth) +
            " -- consider extracting helper functions", "info"));
    }
 
    // cpp-todo-without-ticket
    for (const auto& tok : tokens) {
        if (tok.type != TokenType::LINE_COMMENT && tok.type != TokenType::BLOCK_COMMENT) continue;
        const bool hasTodo = tok.value.find("TODO") != std::string::npos ||
                              tok.value.find("FIXME") != std::string::npos;
        if (!hasTodo || hasTicketReference(tok.value)) continue;
        out.push_back(makeViolation(path, tok.line, "cpp-todo-without-ticket",
            "TODO/FIXME without a ticket reference (#123 or PROJ-123)", "info"));
    }
 
    return out;
}
 
} // namespace cma
