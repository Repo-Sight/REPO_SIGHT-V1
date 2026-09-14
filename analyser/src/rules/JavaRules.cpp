#include "rules/JavaRules.h"
 
#include <array>
#include <cctype>
#include <unordered_set>
 
namespace cma {
 
namespace {
 
constexpr int kLongFunctionThreshold = 100;
constexpr int kDeepNestingThreshold  = 6;
 
const std::unordered_set<std::string> kRawTypeNames = {
    "List", "Map", "Set", "ArrayList", "HashMap", "HashSet",
    "LinkedList", "TreeMap", "TreeSet"
};
 
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
    v.path = path; v.line = line; v.ruleId = ruleId; v.language = "java";
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
// surrounding quote characters -- strip them before judging whether the
// literal is long enough to plausibly be a real secret rather than a
// placeholder/empty string.
bool isPlausibleSecretLiteral(const std::string& raw) {
    if (raw.size() < 2) return false;
    const std::string stripped = raw.substr(1, raw.size() - 2);
    return stripped.size() >= 6;
}

} // anonymous namespace
 
std::vector<Violation> checkJavaRules(const std::string& path, const std::vector<Token>& tokens,
                                        const FileMetrics& fm) {
    std::vector<Violation> out;
    const std::size_t n = tokens.size();
    bool flaggedTrustManager = false;
 
    for (std::size_t i = 0; i < n; ++i) {
        const Token& tok = tokens[i];
 
        // java-empty-catch-block: catch ( ... ) { [NEWLINE]* }
        if (tok.type == TokenType::KEYWORD && tok.value == "catch" &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPEN_PAREN) {
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
                    out.push_back(makeViolation(path, tok.line, "java-empty-catch-block",
                        "Empty catch block silently swallows the exception", "warning"));
                }
            }
        }
 
        // java-public-field: public [modifiers] TYPE name (=|;|,)  -- excludes
        // public static final constants and methods.
        if (tok.type == TokenType::KEYWORD && tok.value == "public") {
            std::size_t j = i + 1;
            bool isStatic = false, isFinal = false;
            while (j < n && tokens[j].type == TokenType::KEYWORD &&
                   (tokens[j].value == "static" || tokens[j].value == "final" ||
                    tokens[j].value == "volatile" || tokens[j].value == "transient" ||
                    tokens[j].value == "abstract" || tokens[j].value == "synchronized")) {
                if (tokens[j].value == "static") isStatic = true;
                if (tokens[j].value == "final")  isFinal  = true;
                ++j;
            }
            if (!(isStatic && isFinal)) {
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
                         (t.type == TokenType::PUNCTUATION && t.value == ","))) {
                        break;
                    }
                    if (depth == 0 && t.type == TokenType::IDENTIFIER) nameIdx = k;
                    ++k;
                }
                if (nameIdx < n && k < n && tokens[k].type != TokenType::OPEN_PAREN) {
                    out.push_back(makeViolation(path, tokens[nameIdx].line, "java-public-field",
                        "Public field '" + tokens[nameIdx].value +
                        "' breaks encapsulation -- consider a private field with accessors", "info"));
                }
            }
        }
 
        // java-printstacktrace: '.' 'printStackTrace' '('
        if (tok.type == TokenType::OPERATOR && tok.value == "." &&
            i + 2 < n &&
            tokens[i + 1].type == TokenType::IDENTIFIER && tokens[i + 1].value == "printStackTrace" &&
            tokens[i + 2].type == TokenType::OPEN_PAREN) {
            out.push_back(makeViolation(path, tokens[i + 1].line, "java-printstacktrace",
                "printStackTrace() dumps to stderr and is easy to lose in production -- use a logger",
                "info"));
        }
 
        // java-raw-type-usage
        if (tok.type == TokenType::IDENTIFIER && kRawTypeNames.count(tok.value)) {
            const bool followedByGeneric = (i + 1 < n && tokens[i + 1].type == TokenType::OPERATOR &&
                                             tokens[i + 1].value == "<");
            const bool followedByDot = (i + 1 < n && tokens[i + 1].type == TokenType::OPERATOR &&
                                         tokens[i + 1].value == ".");
            if (!followedByGeneric && !followedByDot) {
                const bool precededByNew = (i > 0 && tokens[i - 1].type == TokenType::KEYWORD &&
                                             tokens[i - 1].value == "new");
                const bool rawInstantiation = precededByNew && i + 1 < n &&
                                               tokens[i + 1].type == TokenType::OPEN_PAREN;
                const bool rawDeclaration = (i + 1 < n && tokens[i + 1].type == TokenType::IDENTIFIER);
                if (rawInstantiation || rawDeclaration) {
                    out.push_back(makeViolation(path, tok.line, "java-raw-type-usage",
                        "Raw type '" + tok.value + "' used without a generic parameter -- prefer "
                        "'" + tok.value + "<T>' for compile-time type safety", "info"));
                }
            }
        }

        // java-sec-runtime-exec: Runtime.getRuntime().exec(...) or
        // 'new ProcessBuilder(...)' both shell out to the OS.
        if (tok.type == TokenType::IDENTIFIER && tok.value == "Runtime" &&
            i + 7 < n &&
            tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "." &&
            tokens[i + 2].type == TokenType::IDENTIFIER && tokens[i + 2].value == "getRuntime" &&
            tokens[i + 3].type == TokenType::OPEN_PAREN &&
            tokens[i + 4].type == TokenType::CLOSE_PAREN &&
            tokens[i + 5].type == TokenType::OPERATOR && tokens[i + 5].value == "." &&
            tokens[i + 6].type == TokenType::IDENTIFIER && tokens[i + 6].value == "exec" &&
            tokens[i + 7].type == TokenType::OPEN_PAREN) {
            out.push_back(makeSecurityViolation(path, tok.line, "java-sec-runtime-exec",
                "Runtime.getRuntime().exec(...) runs an OS command -- review that no part of it "
                "is built from untrusted input", "warning"));
        }
        if (tok.type == TokenType::KEYWORD && tok.value == "new" &&
            i + 2 < n &&
            tokens[i + 1].type == TokenType::IDENTIFIER && tokens[i + 1].value == "ProcessBuilder" &&
            tokens[i + 2].type == TokenType::OPEN_PAREN) {
            out.push_back(makeSecurityViolation(path, tokens[i + 1].line, "java-sec-runtime-exec",
                "'new ProcessBuilder(...)' launches an OS process -- review that no argument is "
                "built from untrusted input", "warning"));
        }

        // java-sec-weak-hash: MessageDigest.getInstance("MD5"/"SHA1"/"SHA-1")
        // -- broken for collision resistance, fine for checksums only.
        if (tok.type == TokenType::IDENTIFIER && tok.value == "MessageDigest" &&
            i + 4 < n &&
            tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "." &&
            tokens[i + 2].type == TokenType::IDENTIFIER && tokens[i + 2].value == "getInstance" &&
            tokens[i + 3].type == TokenType::OPEN_PAREN &&
            tokens[i + 4].type == TokenType::STRING_LITERAL &&
            (tokens[i + 4].value.find("MD5") != std::string::npos ||
             tokens[i + 4].value.find("SHA1") != std::string::npos ||
             tokens[i + 4].value.find("SHA-1") != std::string::npos)) {
            out.push_back(makeSecurityViolation(path, tok.line, "java-sec-weak-hash",
                "MessageDigest.getInstance(" + tokens[i + 4].value + ") is a broken/weak hash -- "
                "avoid it for passwords or integrity checks that need collision resistance",
                "info"));
        }

        // java-sec-weak-cipher: Cipher.getInstance("DES"/"DESede"/...) --
        // DES's 56-bit key is brute-forceable today.
        if (tok.type == TokenType::IDENTIFIER && tok.value == "Cipher" &&
            i + 4 < n &&
            tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "." &&
            tokens[i + 2].type == TokenType::IDENTIFIER && tokens[i + 2].value == "getInstance" &&
            tokens[i + 3].type == TokenType::OPEN_PAREN &&
            tokens[i + 4].type == TokenType::STRING_LITERAL &&
            tokens[i + 4].value.find("DES") != std::string::npos) {
            out.push_back(makeSecurityViolation(path, tok.line, "java-sec-weak-cipher",
                "Cipher.getInstance(" + tokens[i + 4].value + ") uses DES, a broken cipher -- "
                "prefer AES/GCM", "warning"));
        }

        // java-sec-sql-string-concat: executeQuery/executeUpdate(...) with a
        // '+' inside the call is a classic SQL-injection shape -- review for
        // a parameterized query (PreparedStatement) instead.
        if (tok.type == TokenType::IDENTIFIER &&
            (tok.value == "executeQuery" || tok.value == "executeUpdate") &&
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
                out.push_back(makeSecurityViolation(path, tok.line, "java-sec-sql-string-concat",
                    "'" + tok.value + "(...)' builds its query with string concatenation -- "
                    "review for SQL injection, prefer PreparedStatement with bound parameters",
                    "warning"));
            }
        }

        // java-sec-trust-manager-review: a custom X509TrustManager can
        // silently disable certificate validation -- flagged once per file
        // for human review, not a proven bypass.
        if (!flaggedTrustManager &&
            tok.type == TokenType::IDENTIFIER && tok.value == "X509TrustManager") {
            flaggedTrustManager = true;
            out.push_back(makeSecurityViolation(path, tok.line, "java-sec-trust-manager-review",
                "Custom X509TrustManager found -- review checkServerTrusted/checkClientTrusted "
                "to confirm certificate validation isn't silently disabled", "info"));
        }

        // java-sec-hardcoded-secret: NAME = "literal" where NAME looks like
        // a credential. Heuristic only -- flags for review, not a proven leak.
        if (tok.type == TokenType::IDENTIFIER && isSuspiciousSecretName(tok.value) &&
            i + 2 < n &&
            tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "=" &&
            tokens[i + 2].type == TokenType::STRING_LITERAL &&
            isPlausibleSecretLiteral(tokens[i + 2].value)) {
            out.push_back(makeSecurityViolation(path, tok.line, "java-sec-hardcoded-secret",
                "'" + tok.value + "' is assigned a string literal that looks like a credential "
                "-- review whether this should come from a secret store or environment "
                "variable instead", "warning"));
        }
    }
 
    // java-long-method
    for (const auto& fn : fm.functions) {
        if (fn.lineCount() > kLongFunctionThreshold) {
            out.push_back(makeViolation(path, fn.startLine, "java-long-method",
                "Method '" + fn.name + "' is " + std::to_string(fn.lineCount()) +
                " lines -- consider splitting it", "info"));
        }
    }
 
    // java-deep-nesting
    if (fm.maxNestingDepth > kDeepNestingThreshold) {
        out.push_back(makeViolation(path, 0, "java-deep-nesting",
            "File reaches nesting depth " + std::to_string(fm.maxNestingDepth) +
            " -- consider extracting helper methods", "info"));
    }
 
    // java-todo-without-ticket
    for (const auto& tok : tokens) {
        if (tok.type != TokenType::LINE_COMMENT && tok.type != TokenType::BLOCK_COMMENT) continue;
        const bool hasTodo = tok.value.find("TODO") != std::string::npos ||
                              tok.value.find("FIXME") != std::string::npos;
        if (!hasTodo || hasTicketReference(tok.value)) continue;
        out.push_back(makeViolation(path, tok.line, "java-todo-without-ticket",
            "TODO/FIXME without a ticket reference (#123 or PROJ-123)", "info"));
    }
 
    return out;
}
 
} // namespace cma
