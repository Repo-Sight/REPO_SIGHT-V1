#include "rules/PythonRules.h"
 
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
    v.path = path; v.line = line; v.ruleId = ruleId; v.language = "python";
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
 
std::vector<Violation> checkPythonRules(const std::string& path, const std::vector<Token>& tokens,
                                          const FileMetrics& fm) {
    std::vector<Violation> out;
    const std::size_t n = tokens.size();
 
    struct ClassFrame { int bodyColumn; bool sawDef; };
    std::vector<ClassFrame> classStack;
 
    bool atStatementStart = true;
    bool pendingClassHeader = false;
 
    for (std::size_t i = 0; i < n; ++i) {
        const Token& tok = tokens[i];
 
        if (tok.type == TokenType::NEWLINE) { atStatementStart = true; continue; }
        if (tok.type == TokenType::END_OF_FILE) break;
 
        if (atStatementStart) {
            // Strictly-less-than: a statement sitting AT the class body's
            // own column is still inside the class (it's the body's first
            // line); only a shallower column is a real dedent out of it.
            while (!classStack.empty() && tok.col < classStack.back().bodyColumn) {
                classStack.pop_back();
            }
        }
 
        // py-bare-except: 'except' directly followed by ':'
        if (tok.type == TokenType::KEYWORD && tok.value == "except" &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == ":") {
            out.push_back(makeViolation(path, tok.line, "py-bare-except",
                "Bare 'except:' catches every exception including KeyboardInterrupt/SystemExit "
                "-- catch a specific exception type", "warning"));
        }
 
        // py-wildcard-import: 'import' immediately followed by '*'
        if (tok.type == TokenType::KEYWORD && tok.value == "import" &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "*") {
            out.push_back(makeViolation(path, tok.line, "py-wildcard-import",
                "Wildcard import pollutes the namespace and hides where names come from", "warning"));
        }
 
        // py-mutable-default-arg
        if (tok.type == TokenType::KEYWORD && tok.value == "def") {
            std::size_t j = i + 1;
            while (j < n && tokens[j].type != TokenType::OPEN_PAREN && tokens[j].type != TokenType::NEWLINE) ++j;
            if (j < n && tokens[j].type == TokenType::OPEN_PAREN) {
                int depth = 1;
                std::size_t k = j + 1;
                while (k < n && depth > 0) {
                    if (tokens[k].type == TokenType::OPEN_PAREN) ++depth;
                    else if (tokens[k].type == TokenType::CLOSE_PAREN) { --depth; if (depth == 0) break; }
                    else if (tokens[k].type == TokenType::OPERATOR && tokens[k].value == "=" &&
                             k + 1 < n &&
                             (tokens[k + 1].type == TokenType::OPEN_BRACKET ||
                              tokens[k + 1].type == TokenType::OPEN_BRACE)) {
                        out.push_back(makeViolation(path, tok.line, "py-mutable-default-arg",
                            "Mutable default argument is shared across every call -- use None and "
                            "create the default inside the function", "warning"));
                    }
                    ++k;
                }
            }
        }
 
        // Class-body tracking, feeds py-mutable-class-attribute
        if (tok.type == TokenType::KEYWORD && tok.value == "class") {
            pendingClassHeader = true;
        }
        if (pendingClassHeader && tok.type == TokenType::OPERATOR && tok.value == ":") {
            pendingClassHeader = false;
            std::size_t k = i + 1;
            while (k < n && tokens[k].type == TokenType::NEWLINE) ++k;
            if (k < n) classStack.push_back(ClassFrame{tokens[k].col, false});
        }
 
        if (atStatementStart && !classStack.empty() && tok.col == classStack.back().bodyColumn) {
            if (tok.type == TokenType::KEYWORD && tok.value == "def") {
                classStack.back().sawDef = true;
            } else if (!classStack.back().sawDef &&
                       tok.type == TokenType::IDENTIFIER &&
                       i + 2 < n &&
                       tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "=" &&
                       (tokens[i + 2].type == TokenType::OPEN_BRACKET ||
                        tokens[i + 2].type == TokenType::OPEN_BRACE)) {
                out.push_back(makeViolation(path, tok.line, "py-mutable-class-attribute",
                    "Class-level mutable attribute is shared by every instance -- initialize it in "
                    "__init__ instead", "warning"));
            }
        }
 
        // py-sec-eval-exec: eval(...)/exec(...) run arbitrary code built
        // from a string -- a classic injection point when that string is
        // ever influenced by untrusted input.
        if (tok.type == TokenType::IDENTIFIER && (tok.value == "eval" || tok.value == "exec") &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPEN_PAREN) {
            out.push_back(makeSecurityViolation(path, tok.line, "py-sec-eval-exec",
                "'" + tok.value + "(...)' executes a string as code -- review that no part of it "
                "is built from untrusted input", "warning"));
        }

        // py-sec-os-system: os.system(...) shells out directly.
        if (tok.type == TokenType::IDENTIFIER && tok.value == "os" &&
            i + 3 < n &&
            tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "." &&
            tokens[i + 2].type == TokenType::IDENTIFIER && tokens[i + 2].value == "system" &&
            tokens[i + 3].type == TokenType::OPEN_PAREN) {
            out.push_back(makeSecurityViolation(path, tok.line, "py-sec-os-system",
                "os.system(...) runs a shell command -- review that no part of it is built from "
                "untrusted input; subprocess.run(...) without shell=True is usually safer",
                "warning"));
        }

        // py-sec-subprocess-shell-true: subprocess.call/run/Popen(...) with
        // shell=True lets a caller-influenced string reach the shell.
        if (tok.type == TokenType::IDENTIFIER && tok.value == "subprocess" &&
            i + 3 < n &&
            tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "." &&
            tokens[i + 2].type == TokenType::IDENTIFIER &&
            (tokens[i + 2].value == "call" || tokens[i + 2].value == "run" ||
             tokens[i + 2].value == "Popen") &&
            tokens[i + 3].type == TokenType::OPEN_PAREN) {
            std::size_t j = i + 4;
            int depth = 1;
            bool sawShellTrue = false;
            while (j < n && depth > 0) {
                if (tokens[j].type == TokenType::OPEN_PAREN) ++depth;
                else if (tokens[j].type == TokenType::CLOSE_PAREN) { --depth; if (depth == 0) break; }
                else if (tokens[j].type == TokenType::IDENTIFIER && tokens[j].value == "shell" &&
                         j + 2 < n &&
                         tokens[j + 1].type == TokenType::OPERATOR && tokens[j + 1].value == "=" &&
                         tokens[j + 2].type == TokenType::KEYWORD && tokens[j + 2].value == "True") {
                    sawShellTrue = true;
                }
                ++j;
            }
            if (sawShellTrue) {
                out.push_back(makeSecurityViolation(path, tok.line, "py-sec-subprocess-shell-true",
                    "subprocess." + tokens[i + 2].value + "(..., shell=True) passes the command "
                    "through a shell -- review that no part of it is built from untrusted input",
                    "warning"));
            }
        }

        // py-sec-pickle-load: pickle.load/loads(...) can execute arbitrary
        // code while deserializing data from an untrusted source.
        if (tok.type == TokenType::IDENTIFIER && tok.value == "pickle" &&
            i + 3 < n &&
            tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "." &&
            tokens[i + 2].type == TokenType::IDENTIFIER &&
            (tokens[i + 2].value == "load" || tokens[i + 2].value == "loads") &&
            tokens[i + 3].type == TokenType::OPEN_PAREN) {
            out.push_back(makeSecurityViolation(path, tok.line, "py-sec-pickle-load",
                "pickle." + tokens[i + 2].value + "(...) can execute arbitrary code while "
                "deserializing -- only unpickle data from a source you fully trust", "warning"));
        }

        // py-sec-yaml-unsafe-load: yaml.load(...) without an explicit safe
        // Loader can execute arbitrary Python objects during deserialization.
        if (tok.type == TokenType::IDENTIFIER && tok.value == "yaml" &&
            i + 3 < n &&
            tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "." &&
            tokens[i + 2].type == TokenType::IDENTIFIER && tokens[i + 2].value == "load" &&
            tokens[i + 3].type == TokenType::OPEN_PAREN) {
            std::size_t j = i + 4;
            int depth = 1;
            bool sawLoaderArg = false;
            while (j < n && depth > 0) {
                if (tokens[j].type == TokenType::OPEN_PAREN) ++depth;
                else if (tokens[j].type == TokenType::CLOSE_PAREN) { --depth; if (depth == 0) break; }
                else if (tokens[j].type == TokenType::IDENTIFIER && tokens[j].value == "Loader") {
                    sawLoaderArg = true;
                }
                ++j;
            }
            if (!sawLoaderArg) {
                out.push_back(makeSecurityViolation(path, tok.line, "py-sec-yaml-unsafe-load",
                    "yaml.load(...) without Loader=yaml.SafeLoader can execute arbitrary Python "
                    "objects from untrusted YAML -- use yaml.safe_load() or pass a safe Loader",
                    "warning"));
            }
        }

        // py-sec-weak-hash: MD5/SHA1 are broken for collision resistance --
        // fine for checksums, not for passwords or integrity checks.
        if (tok.type == TokenType::IDENTIFIER && tok.value == "hashlib" &&
            i + 3 < n &&
            tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "." &&
            tokens[i + 2].type == TokenType::IDENTIFIER &&
            (tokens[i + 2].value == "md5" || tokens[i + 2].value == "sha1") &&
            tokens[i + 3].type == TokenType::OPEN_PAREN) {
            out.push_back(makeSecurityViolation(path, tok.line, "py-sec-weak-hash",
                "hashlib." + tokens[i + 2].value + "(...) is a broken/weak hash -- avoid it for "
                "passwords or integrity checks that need collision resistance", "info"));
        }

        // py-sec-hardcoded-secret: NAME = "literal" where NAME looks like a
        // credential. Heuristic only -- flags for review, not a proven leak.
        if (tok.type == TokenType::IDENTIFIER && isSuspiciousSecretName(tok.value) &&
            i + 2 < n &&
            tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "=" &&
            tokens[i + 2].type == TokenType::STRING_LITERAL &&
            isPlausibleSecretLiteral(tokens[i + 2].value)) {
            out.push_back(makeSecurityViolation(path, tok.line, "py-sec-hardcoded-secret",
                "'" + tok.value + "' is assigned a string literal that looks like a credential "
                "-- review whether this should come from a secret store or environment "
                "variable instead", "warning"));
        }

        atStatementStart = false;
    }
 
    // py-long-function
    for (const auto& fn : fm.functions) {
        if (fn.lineCount() > kLongFunctionThreshold) {
            out.push_back(makeViolation(path, fn.startLine, "py-long-function",
                "Function '" + fn.name + "' is " + std::to_string(fn.lineCount()) +
                " lines -- consider splitting it", "info"));
        }
    }
 
    // py-deep-nesting
    if (fm.maxNestingDepth > kDeepNestingThreshold) {
        out.push_back(makeViolation(path, 0, "py-deep-nesting",
            "File reaches nesting depth " + std::to_string(fm.maxNestingDepth) +
            " -- consider extracting helper functions", "info"));
    }
 
    // py-todo-without-ticket
    for (const auto& tok : tokens) {
        if (tok.type != TokenType::LINE_COMMENT) continue;
        const bool hasTodo = tok.value.find("TODO") != std::string::npos ||
                              tok.value.find("FIXME") != std::string::npos;
        if (!hasTodo || hasTicketReference(tok.value)) continue;
        out.push_back(makeViolation(path, tok.line, "py-todo-without-ticket",
            "TODO/FIXME without a ticket reference (#123 or PROJ-123)", "info"));
    }
 
    return out;
}
 
} // namespace cma
