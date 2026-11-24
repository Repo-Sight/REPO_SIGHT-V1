#include "rules/CRules.h"

#include <array>
#include <cctype>
#include <cstddef>
#include <string_view>
#include <utility>

namespace cma {

namespace {

constexpr int kLongFunctionThreshold = 100;
constexpr int kDeepNestingThreshold  = 6;
constexpr std::size_t kNpos = static_cast<std::size_t>(-1);

// ---------------------------------------------------------------------------------- violations

Violation makeViolation(const std::string& path, int line, const std::string& ruleId,
                         std::string message, const std::string& severity) {
    Violation v;
    v.path = path; v.line = line; v.ruleId = ruleId; v.language = "c";
    v.message = std::move(message); v.severity = severity;
    return v;
}

Violation makeSecurityViolation(const std::string& path, int line, const std::string& ruleId,
                                  std::string message, const std::string& severity) {
    Violation v = makeViolation(path, line, ruleId, std::move(message), severity);
    v.category = "security";
    return v;
}

// ------------------------------------------------------------------------------ token helpers

bool isSignificant(const Token& t) {
    return t.type != TokenType::NEWLINE && t.type != TokenType::LINE_COMMENT &&
           t.type != TokenType::BLOCK_COMMENT && t.type != TokenType::PREPROCESSOR;
}

std::size_t prevSig(const std::vector<Token>& t, std::size_t i) {
    while (i > 0) {
        --i;
        if (isSignificant(t[i])) return i;
    }
    return kNpos;
}

std::size_t nextSig(const std::vector<Token>& t, std::size_t i) {
    for (++i; i < t.size(); ++i)
        if (isSignificant(t[i])) return i;
    return kNpos;
}

bool isOp(const Token& t, const char* v) { return t.type == TokenType::OPERATOR && t.value == v; }

// Index of the ')' matching the '(' at `open`, or kNpos.
std::size_t matchingParen(const std::vector<Token>& t, std::size_t open) {
    int depth = 0;
    for (std::size_t i = open; i < t.size(); ++i) {
        if (t[i].type == TokenType::OPEN_PAREN) ++depth;
        else if (t[i].type == TokenType::CLOSE_PAREN) { if (--depth == 0) return i; }
    }
    return kNpos;
}

// Top-level arguments of the call whose '(' is at `open`: [first, last) token-index ranges of the
// significant tokens, split on commas at depth 1. Empty when the parentheses never close.
std::vector<std::pair<std::size_t, std::size_t>> callArgs(const std::vector<Token>& t, std::size_t open) {
    std::vector<std::pair<std::size_t, std::size_t>> args;
    const std::size_t close = matchingParen(t, open);
    if (close == kNpos) return args;
    int depth = 0;
    std::size_t start = kNpos, last = kNpos;
    for (std::size_t i = open + 1; i < close; ++i) {
        const Token& k = t[i];
        if (!isSignificant(k)) continue;
        const bool opener = k.type == TokenType::OPEN_PAREN || k.type == TokenType::OPEN_BRACKET || k.type == TokenType::OPEN_BRACE;
        const bool closer = k.type == TokenType::CLOSE_PAREN || k.type == TokenType::CLOSE_BRACKET || k.type == TokenType::CLOSE_BRACE;
        if (depth == 0 && k.type == TokenType::PUNCTUATION && k.value == ",") {
            if (start != kNpos) args.emplace_back(start, last + 1);
            start = kNpos;
            continue;
        }
        if (start == kNpos) start = i;
        last = i;
        if (opener) ++depth;
        if (closer) --depth;
    }
    if (start != kNpos) args.emplace_back(start, last + 1);
    return args;
}

bool inSet(const std::string& v, std::initializer_list<const char*> names) {
    for (const char* n : names)
        if (v == n) return true;
    return false;
}

// `obj.strcpy(` / `obj->strcpy(` call a member, not the libc function.
bool isMemberAccess(const std::vector<Token>& t, std::size_t i) {
    const std::size_t p = prevSig(t, i);
    if (p == kNpos) return false;
    if (isOp(t[p], ".")) return true;
    if (isOp(t[p], ">")) {
        const std::size_t q = prevSig(t, p);
        return q != kNpos && isOp(t[q], "-");
    }
    return false;
}

// `char *strcpy(` / `int sprintf(` is a declaration or definition of a function with that name,
// not a call to it. A call is preceded by an operator, '(', ',', ';', '{', '}' or return/else/case/do.
bool looksLikeDeclaration(const std::vector<Token>& t, std::size_t i) {
    const std::size_t p = prevSig(t, i);
    if (p == kNpos) return false;
    const Token& k = t[p];
    if (k.type == TokenType::IDENTIFIER) return true;
    if (k.type == TokenType::KEYWORD) return !inSet(k.value, {"return", "else", "case", "do", "sizeof", "goto"});
    if (isOp(k, "*")) {
        const std::size_t q = prevSig(t, p);
        return q != kNpos && (t[q].type == TokenType::IDENTIFIER || t[q].type == TokenType::KEYWORD);
    }
    return false;
}

// A call to a function from `names`: identifier + '(' that is neither a member call nor a declaration.
bool isCallTo(const std::vector<Token>& t, std::size_t i, std::initializer_list<const char*> names) {
    const Token& k = t[i];
    if (k.type != TokenType::IDENTIFIER || !inSet(k.value, names)) return false;
    const std::size_t n = nextSig(t, i);
    if (n == kNpos || t[n].type != TokenType::OPEN_PAREN) return false;
    return !isMemberAccess(t, i) && !looksLikeDeclaration(t, i);
}

bool isAllCapsMacroName(const std::string& s) {
    bool hasLetter = false;
    for (const char c : s) {
        if (std::islower(static_cast<unsigned char>(c))) return false;
        if (std::isupper(static_cast<unsigned char>(c))) hasLetter = true;
    }
    return hasLetter;
}

// True when the argument tokens [a, b) are only string literals and ALL-CAPS identifiers (macro
// constants such as NULL or VI_GDB_FILE): a fixed command that nothing outside the source controls.
bool isConstantArgument(const std::vector<Token>& t, std::size_t a, std::size_t b) {
    if (a >= b) return false;
    for (std::size_t k = a; k < b; ++k) {
        if (!isSignificant(t[k])) continue;
        const bool literal = t[k].type == TokenType::STRING_LITERAL;
        const bool macro   = t[k].type == TokenType::IDENTIFIER && isAllCapsMacroName(t[k].value);
        if (!literal && !macro) return false;
    }
    return true;
}

// ------------------------------------------------------------------------------ text helpers

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

// A STRING_LITERAL token's value includes its quotes; judge only what is inside them.
bool isPlausibleSecretLiteral(const std::string& raw) {
    if (raw.size() < 2) return false;
    return raw.size() - 2 >= 6;
}

// scanf-family format text: true when it holds a %s or %[ conversion with no field width, which
// writes an unbounded number of bytes into the caller's buffer (CWE-120).
bool hasUnboundedStringConversion(const std::string& lit) {
    for (std::size_t i = 0; i < lit.size(); ++i) {
        if (lit[i] != '%') continue;
        ++i;
        if (i >= lit.size()) break;
        if (lit[i] == '%') continue;
        if (lit[i] == '*') ++i;                         // %*s discards the value: nothing is stored
        else {
            bool width = false;
            while (i < lit.size() && std::isdigit(static_cast<unsigned char>(lit[i]))) { width = true; ++i; }
            while (i < lit.size() && std::string_view("hlLqjzt").find(lit[i]) != std::string_view::npos) ++i;
            if (i < lit.size() && (lit[i] == 's' || lit[i] == '[') && !width) return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------- allocation rules

bool isAllocFn(const std::string& v) {
    return inSet(v, {"malloc", "calloc", "realloc", "strdup", "strndup", "reallocarray"});
}

// Tokens of a plain lvalue ending just before index `end` (exclusive): NAME or NAME(.|->)NAME...,
// returned as concatenated text and the index of its first token. Empty when it is anything fancier.
std::pair<std::string, std::size_t> lvalueBefore(const std::vector<Token>& t, std::size_t end) {
    std::string text;
    std::size_t first = kNpos;
    std::size_t i = prevSig(t, end);
    bool expectName = true;
    while (i != kNpos) {
        const Token& k = t[i];
        if (expectName) {
            if (k.type != TokenType::IDENTIFIER) break;
            text = k.value + text;
            first = i;
            expectName = false;
            i = prevSig(t, i);
            continue;
        }
        if (isOp(k, ".")) { text = "." + text; expectName = true; i = prevSig(t, i); continue; }
        if (isOp(k, ">")) {
            const std::size_t q = prevSig(t, i);
            if (q != kNpos && isOp(t[q], "-")) { text = "->" + text; expectName = true; i = prevSig(t, q); continue; }
        }
        break;
    }
    if (expectName) return {"", kNpos};                 // dangling '.' or '->'
    return {text, first};
}

// If tokens[eq] is the '=' of `LVALUE = [(type *)] allocfn( ... ) ;`, returns the index of the
// allocator identifier; otherwise kNpos.
std::size_t allocCallAfterAssign(const std::vector<Token>& t, std::size_t eq) {
    std::size_t j = nextSig(t, eq);
    if (j == kNpos) return kNpos;
    if (t[j].type == TokenType::OPEN_PAREN) {           // optional cast: (type *)
        const std::size_t close = matchingParen(t, j);
        if (close == kNpos) return kNpos;
        for (std::size_t k = j + 1; k < close; ++k) {
            if (!isSignificant(t[k])) continue;
            const bool ok = t[k].type == TokenType::IDENTIFIER || t[k].type == TokenType::KEYWORD || isOp(t[k], "*");
            if (!ok) return kNpos;
        }
        j = nextSig(t, close);
        if (j == kNpos) return kNpos;
    }
    if (t[j].type != TokenType::IDENTIFIER || !isAllocFn(t[j].value)) return kNpos;
    const std::size_t open = nextSig(t, j);
    if (open == kNpos || t[open].type != TokenType::OPEN_PAREN) return kNpos;
    return j;
}

// True when the statement starting at `s` dereferences `name` immediately: name->..., name[...],
// *name, or name passed as the destination to a memory/string function.
bool dereferencesFirst(const std::vector<Token>& t, std::size_t s, const std::string& name) {
    if (s == kNpos) return false;
    const Token& a = t[s];
    if (a.type == TokenType::IDENTIFIER && a.value == name) {
        const std::size_t n = nextSig(t, s);
        if (n == kNpos) return false;
        if (t[n].type == TokenType::OPEN_BRACKET) return true;
        if (isOp(t[n], "-")) {
            const std::size_t m = nextSig(t, n);
            return m != kNpos && isOp(t[m], ">");
        }
        return false;
    }
    if (isOp(a, "*")) {
        const std::size_t n = nextSig(t, s);
        return n != kNpos && t[n].type == TokenType::IDENTIFIER && t[n].value == name;
    }
    if (a.type == TokenType::IDENTIFIER &&
        inSet(a.value, {"memset", "memcpy", "memmove", "strcpy", "strncpy", "strcat", "strncat", "sprintf", "snprintf", "bzero"})) {
        const std::size_t open = nextSig(t, s);
        if (open == kNpos || t[open].type != TokenType::OPEN_PAREN) return false;
        const std::size_t arg = nextSig(t, open);
        return arg != kNpos && t[arg].type == TokenType::IDENTIFIER && t[arg].value == name;
    }
    return false;
}

// ----------------------------------------------------------------------------------- macros

// `#define NAME(args) body` -> name and body; false for object-like macros and anything else.
bool parseFunctionLikeMacro(const std::string& directive, std::string& name, std::string& body) {
    std::size_t i = 0;
    auto skipSpace = [&] { while (i < directive.size() && (directive[i] == ' ' || directive[i] == '\t')) ++i; };
    if (i >= directive.size() || directive[i] != '#') return false;
    ++i; skipSpace();
    if (directive.compare(i, 6, "define") != 0) return false;
    i += 6;
    if (i >= directive.size() || (directive[i] != ' ' && directive[i] != '\t')) return false;
    skipSpace();
    const std::size_t nameStart = i;
    while (i < directive.size() && (std::isalnum(static_cast<unsigned char>(directive[i])) || directive[i] == '_')) ++i;
    if (i == nameStart || i >= directive.size() || directive[i] != '(') return false;   // object-like
    name = directive.substr(nameStart, i - nameStart);
    const std::size_t close = directive.find(')', i);
    if (close == std::string::npos) return false;
    body = directive.substr(close + 1);
    const std::size_t b = body.find_first_not_of(" \t");
    const std::size_t e = body.find_last_not_of(" \t");
    body = b == std::string::npos ? "" : body.substr(b, e - b + 1);
    return !body.empty();
}

// Body with string/char literals blanked and comments removed, so ';' inside them is not counted.
std::string stripLiterals(const std::string& s) {
    std::string out;
    for (std::size_t i = 0; i < s.size(); ++i) {
        const char c = s[i];
        if (c == '"' || c == '\'') {
            const char q = c;
            out += ' ';
            for (++i; i < s.size() && s[i] != q; ++i)
                if (s[i] == '\\') ++i;
        } else if (c == '/' && i + 1 < s.size() && s[i + 1] == '*') {
            const std::size_t end = s.find("*/", i + 2);
            if (end == std::string::npos) break;
            i = end + 1;
            out += ' ';
        } else if (c == '/' && i + 1 < s.size() && s[i + 1] == '/') {
            break;
        } else {
            out += c;
        }
    }
    return out;
}

bool bodyHasSeveralStatements(const std::string& rawBody) {
    const std::string body = stripLiterals(rawBody);
    if (body.find("##") != std::string::npos) return false;   // declaration generators: DEFINE_X(n) int n; ...
    const std::size_t first = body.find_first_not_of(" \t");
    if (first == std::string::npos) return false;
    if (body[first] == '{' || body[first] == '(') return false;
    // Control-structure macros (do/if/for/while/switch ...) and case-label generators are deliberate
    // compound statements, not a run of independent statements.
    static const std::array<const char*, 6> kControl = {"do", "if", "for", "while", "switch", "else"};
    for (const char* kw : kControl) {
        const std::size_t len = std::char_traits<char>::length(kw);
        if (body.compare(first, len, kw) == 0 &&
            (first + len >= body.size() || !(std::isalnum(static_cast<unsigned char>(body[first + len])) || body[first + len] == '_')))
            return false;
    }
    for (std::size_t p = body.find("case"); p != std::string::npos; p = body.find("case", p + 1)) {
        const bool startOk = p == 0 || !(std::isalnum(static_cast<unsigned char>(body[p - 1])) || body[p - 1] == '_');
        const bool endOk = p + 4 >= body.size() || !(std::isalnum(static_cast<unsigned char>(body[p + 4])) || body[p + 4] == '_');
        if (startOk && endOk) return false;
    }
    int paren = 0;
    for (std::size_t i = 0; i < body.size(); ++i) {
        if (body[i] == '(') ++paren;
        else if (body[i] == ')') --paren;
        else if (body[i] == ';' && paren == 0) return body.find_first_not_of(" \t", i + 1) != std::string::npos;
    }
    return false;
}

} // anonymous namespace

std::vector<Violation> checkCRules(const std::string& path, const std::vector<Token>& tokens,
                                     const FileMetrics& fm) {
    std::vector<Violation> out;
    const std::size_t n = tokens.size();

    bool inCondition = false;
    int  condParenDepth = 0;

    for (std::size_t i = 0; i < n; ++i) {
        const Token& tok = tokens[i];

        // c-macro-multi-statement
        if (tok.type == TokenType::PREPROCESSOR) {
            std::string name, body;
            if (parseFunctionLikeMacro(tok.value, name, body) && bodyHasSeveralStatements(body)) {
                out.push_back(makeViolation(path, tok.line, "c-macro-multi-statement",
                    "Macro '" + name + "' expands to several statements without do { ... } while (0) -- "
                    "after 'if (x) " + name + "(...);' only the first one is conditional", "warning"));
            }
            continue;
        }

        // c-magic-number-literal: numeric literal inside an if/while condition
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
                out.push_back(makeViolation(path, tok.line, "c-magic-number-literal",
                    "Magic number '" + tok.value + "' in condition -- consider a named constant or enum", "info"));
            }
        }

        if (tok.type != TokenType::IDENTIFIER) continue;

        // c-sec-unsafe-buffer-fn (CWE-120/CWE-676)
        if (isCallTo(tokens, i, {"gets", "strcpy", "strcat", "sprintf", "vsprintf"})) {
            out.push_back(makeSecurityViolation(path, tok.line, "c-sec-unsafe-buffer-fn",
                "'" + tok.value + "(...)' does not bound-check its destination -- prefer the bounded "
                "variant (snprintf, strncat, fgets) or a length-checked copy", "warning"));
        }

        // c-sec-system-call / c-sec-popen-call (CWE-78). A command made only of string literals and
        // macro constants (system("sync")) has nothing for an attacker to influence, so it is not reported.
        if (isCallTo(tokens, i, {"system", "popen"})) {
            const auto cmdArgs = callArgs(tokens, nextSig(tokens, i));
            if (!cmdArgs.empty() && isConstantArgument(tokens, cmdArgs[0].first, cmdArgs[0].second)) continue;
            out.push_back(makeSecurityViolation(path, tok.line,
                tok.value == "system" ? "c-sec-system-call" : "c-sec-popen-call",
                "Call to '" + tok.value + "(...)' runs a shell command -- review that no part of "
                "the command is built from untrusted input", "warning"));
        }

        // c-sec-weak-random (CWE-338)
        if (isCallTo(tokens, i, {"rand", "srand", "random", "srandom"})) {
            out.push_back(makeSecurityViolation(path, tok.line, "c-sec-weak-random",
                "'" + tok.value + "(...)' is not cryptographically secure -- avoid it for "
                "security-sensitive randomness (tokens, keys, nonces)", "info"));
        }

        // c-sec-weak-hash (CWE-327)
        if (isCallTo(tokens, i, {"MD5", "SHA1", "EVP_md5", "EVP_sha1", "MD5_Init", "SHA1_Init"})) {
            out.push_back(makeSecurityViolation(path, tok.line, "c-sec-weak-hash",
                "'" + tok.value + "(...)' is a broken/weak hash -- avoid it for passwords, "
                "signatures, or integrity checks that need collision resistance", "info"));
        }

        // c-sec-insecure-temp-file (CWE-377)
        if (isCallTo(tokens, i, {"tmpnam", "tempnam", "mktemp"})) {
            out.push_back(makeSecurityViolation(path, tok.line, "c-sec-insecure-temp-file",
                "'" + tok.value + "(...)' returns a name that another process can claim before it is "
                "opened -- use mkstemp() or tmpfile()", "warning"));
        }

        // c-sec-format-string (CWE-134): the format argument is a plain variable and the last argument.
        {
            int fmtIndex = -1;
            if      (isCallTo(tokens, i, {"printf"}))                                  fmtIndex = 0;
            else if (isCallTo(tokens, i, {"fprintf", "dprintf", "sprintf", "syslog", "asprintf"})) fmtIndex = 1;
            else if (isCallTo(tokens, i, {"snprintf"}))                                fmtIndex = 2;
            if (fmtIndex >= 0) {
                const auto args = callArgs(tokens, nextSig(tokens, i));
                if (args.size() == static_cast<std::size_t>(fmtIndex) + 1) {
                    const auto [a, b] = args.back();
                    if (b - a == 1 && tokens[a].type == TokenType::IDENTIFIER && !isAllCapsMacroName(tokens[a].value)) {
                        out.push_back(makeSecurityViolation(path, tok.line, "c-sec-format-string",
                            "'" + tok.value + "(... " + tokens[a].value + ")' uses a variable as the format string -- "
                            "if it holds user input, '%' sequences in it are interpreted; pass it as "
                            "\"%s\", " + tokens[a].value, "warning"));
                    }
                }
            }
        }

        // c-sec-unsafe-scanf (CWE-120): %s / %[ with no width
        if (isCallTo(tokens, i, {"scanf", "fscanf", "sscanf"})) {
            const auto args = callArgs(tokens, nextSig(tokens, i));
            const std::size_t fmtIndex = tok.value == "scanf" ? 0 : 1;
            if (args.size() > fmtIndex) {
                const auto [a, b] = args[fmtIndex];
                std::string literal;
                bool onlyLiterals = true;
                for (std::size_t k = a; k < b; ++k) {
                    if (tokens[k].type == TokenType::STRING_LITERAL) literal += tokens[k].value;
                    else onlyLiterals = false;
                }
                if (onlyLiterals && !literal.empty() && hasUnboundedStringConversion(literal)) {
                    out.push_back(makeSecurityViolation(path, tok.line, "c-sec-unsafe-scanf",
                        "'" + tok.value + "(...)' reads a string with no field width (%s or %[) -- "
                        "input longer than the buffer overflows it; use a width such as %63s", "warning"));
                }
            }
        }

        // c-sec-hardcoded-secret: NAME = "literal" or NAME[...] = "literal"
        if (isSuspiciousSecretName(tok.value)) {
            std::size_t j = nextSig(tokens, i);
            if (j != kNpos && tokens[j].type == TokenType::OPEN_BRACKET) {
                while (j != kNpos && tokens[j].type != TokenType::CLOSE_BRACKET) j = nextSig(tokens, j);
                if (j != kNpos) j = nextSig(tokens, j);
            }
            if (j != kNpos && isOp(tokens[j], "=")) {
                const std::size_t v = nextSig(tokens, j);
                if (v != kNpos && tokens[v].type == TokenType::STRING_LITERAL &&
                    isPlausibleSecretLiteral(tokens[v].value)) {
                    out.push_back(makeSecurityViolation(path, tok.line, "c-sec-hardcoded-secret",
                        "'" + tok.value + "' is assigned a string literal that looks like a credential "
                        "-- review whether this should come from a secret store or environment "
                        "variable instead", "warning"));
                }
            }
        }
    }

    // Assignment-based memory rules, anchored on the '=' token.
    for (std::size_t i = 0; i < n; ++i) {
        if (!isOp(tokens[i], "=")) continue;
        const std::size_t next = nextSig(tokens, i);
        if (next != kNpos && isOp(tokens[next], "=")) { ++i; continue; }          // '=='
        const std::size_t before = prevSig(tokens, i);
        if (before != kNpos && tokens[before].type == TokenType::OPERATOR &&
            inSet(tokens[before].value, {"=", "!", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^"})) continue;  // ==, !=, <=, +=, ...

        const std::size_t alloc = allocCallAfterAssign(tokens, i);
        if (alloc == kNpos) continue;
        const auto [lhs, lhsFirst] = lvalueBefore(tokens, i);
        if (lhs.empty()) continue;
        const std::size_t open = nextSig(tokens, alloc);
        const std::size_t close = matchingParen(tokens, open);
        if (close == kNpos) continue;
        const std::size_t after = nextSig(tokens, close);
        if (after == kNpos || tokens[after].type != TokenType::SEMICOLON) continue;     // part of a larger expression

        // c-realloc-self-assign: p = realloc(p, n) loses the old block when realloc returns NULL.
        if (tokens[alloc].value == "realloc" || tokens[alloc].value == "reallocarray") {
            const auto args = callArgs(tokens, open);
            if (!args.empty()) {
                std::string first;
                for (std::size_t k = args[0].first; k < args[0].second; ++k) first += tokens[k].value;
                if (first == lhs) {
                    out.push_back(makeViolation(path, tokens[alloc].line, "c-realloc-self-assign",
                        "'" + lhs + " = " + tokens[alloc].value + "(" + lhs + ", ...)' leaks the original block and "
                        "leaves " + lhs + " NULL if the allocation fails -- assign to a temporary first", "warning"));
                }
            }
        }

        // c-malloc-unchecked: only a plain local name, dereferenced in the very next statement.
        if (lhs.find('.') == std::string::npos && lhs.find("->") == std::string::npos) {
            if (dereferencesFirst(tokens, nextSig(tokens, after), lhs)) {
                out.push_back(makeViolation(path, tokens[alloc].line, "c-malloc-unchecked",
                    "'" + lhs + "' from " + tokens[alloc].value + "() is used in the next statement with no NULL check "
                    "-- a failed allocation crashes here", "warning"));
            }
        }
    }

    // c-long-function
    for (const auto& fn : fm.functions) {
        if (fn.lineCount() > kLongFunctionThreshold) {
            out.push_back(makeViolation(path, fn.startLine, "c-long-function",
                "Function '" + fn.name + "' is " + std::to_string(fn.lineCount()) +
                " lines -- consider splitting it", "info"));
        }
    }

    // c-deep-nesting (file-level)
    if (fm.maxNestingDepth > kDeepNestingThreshold) {
        out.push_back(makeViolation(path, 0, "c-deep-nesting",
            "File reaches nesting depth " + std::to_string(fm.maxNestingDepth) +
            " -- consider extracting helper functions", "info"));
    }

    // c-todo-without-ticket
    for (const auto& tok : tokens) {
        if (tok.type != TokenType::LINE_COMMENT && tok.type != TokenType::BLOCK_COMMENT) continue;
        const bool hasTodo = tok.value.find("TODO") != std::string::npos ||
                              tok.value.find("FIXME") != std::string::npos;
        if (!hasTodo || hasTicketReference(tok.value)) continue;
        out.push_back(makeViolation(path, tok.line, "c-todo-without-ticket",
            "TODO/FIXME without a ticket reference (#123 or PROJ-123)", "info"));
    }

    return out;
}

} // namespace cma
