#include "rules/SecretRules.h"

#include <cctype>
#include <cstddef>
#include <string>
#include <utility>

namespace cma {
namespace {

// Rule IDs are written out in full (not built from a prefix) so the rule
// catalog parity test, which scans this directory for string literals, can
// see every ID this file can emit.
const char* idFor(Language lang) {
    switch (lang) {
        case Language::Cpp:        return "cpp-sec-secret-token";
        case Language::Python:     return "py-sec-secret-token";
        case Language::Java:       return "java-sec-secret-token";
        case Language::TypeScript: return "ts-sec-secret-token";
        case Language::JavaScript: return "js-sec-secret-token";
        case Language::CSharp:     return "csharp-sec-secret-token";
    }
    return nullptr;
}

bool isDigit(char c) { return std::isdigit(static_cast<unsigned char>(c)) != 0; }
bool isUpper(char c) { return std::isupper(static_cast<unsigned char>(c)) != 0; }
bool isLower(char c) { return std::islower(static_cast<unsigned char>(c)) != 0; }
bool isAlnum(char c) { return std::isalnum(static_cast<unsigned char>(c)) != 0; }
bool isBodyChar(char c) { return isAlnum(c) || c == '_' || c == '-'; }
bool isAlnumOrUnderscore(char c) { return isAlnum(c) || c == '_'; }
bool isUpperOrDigit(char c) { return isUpper(c) || isDigit(c); }

template <class Pred>
std::size_t runLength(const std::string& s, std::size_t pos, Pred pred) {
    std::size_t n = 0;
    while (pos + n < s.size() && pred(s[pos + n])) ++n;
    return n;
}

bool startsWith(const std::string& s, std::size_t pos, const char* prefix) {
    return s.compare(pos, std::char_traits<char>::length(prefix), prefix) == 0;
}

std::string lowered(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) out += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return out;
}

// Real keys are random. Reject the shapes people use when they write a
// fake one into docs, tests and README snippets.
bool looksLikePlaceholder(const std::string& body) {
    // Long run of one repeated character ("xxxxxxxx", "AAAAAAAA", "00000000").
    std::size_t run = 1;
    for (std::size_t i = 1; i < body.size(); ++i) {
        run = (body[i] == body[i - 1]) ? run + 1 : 1;
        if (run >= 6) return true;
    }
    static const char* const kWords[] = {"example", "your", "placeholder", "dummy",
                                         "sample", "redacted", "changeme", "123456"};
    const std::string low = lowered(body);
    for (const char* w : kWords) {
        if (low.find(w) != std::string::npos) return true;
    }
    return false;
}

bool hasDigitUpperLower(const std::string& body) {
    bool d = false, u = false, l = false;
    for (char c : body) {
        d = d || isDigit(c);
        u = u || isUpper(c);
        l = l || isLower(c);
    }
    return d && u && l;
}

struct Hit {
    const char* provider;   // human-readable provider + token kind
    const char* prefix;     // fixed, public prefix -- the only part we quote
    std::size_t end;        // one past the last character of the token
};

// Tries every token format at `pos`. Returns false when none matches.
bool matchAt(const std::string& s, std::size_t pos, Hit& hit) {
    // The match must start at a boundary so "task-..." / "disk-..." / "risk-..."
    // are never read as "sk-...".
    if (pos > 0 && isAlnum(s[pos - 1])) return false;

    if (startsWith(s, pos, "sk-ant-")) {
        const std::size_t start = pos + 7;
        const std::size_t len = runLength(s, start, isBodyChar);
        if (len >= 32 && !looksLikePlaceholder(s.substr(start, len))) {
            hit = {"Anthropic API key", "sk-ant-", start + len};
            return true;
        }
        return false;
    }

    if (startsWith(s, pos, "sk-")) {
        const std::size_t start = pos + 3;
        const std::size_t len = runLength(s, start, isBodyChar);
        if (len >= 40) {
            const std::string body = s.substr(start, len);
            if (hasDigitUpperLower(body) && !looksLikePlaceholder(body)) {
                hit = {"OpenAI API key", "sk-", start + len};
                return true;
            }
        }
        return false;
    }

    if (startsWith(s, pos, "AKIA") || startsWith(s, pos, "ASIA")) {
        const std::size_t start = pos + 4;
        const std::size_t len = runLength(s, start, isUpperOrDigit);
        // Exactly 16 characters after the prefix, and nothing alphanumeric
        // after them (a longer word is an identifier, not a key ID).
        const bool tailOk = start + len >= s.size() || !isAlnum(s[start + len]);
        if (len == 16 && tailOk && !looksLikePlaceholder(s.substr(start, len))) {
            hit = {"AWS access key ID", s[pos + 1] == 'K' ? "AKIA" : "ASIA", start + len};
            return true;
        }
        return false;
    }

    static const char* const kGhPrefixes[] = {"ghp_", "gho_", "ghu_", "ghs_", "ghr_"};
    for (const char* p : kGhPrefixes) {
        if (!startsWith(s, pos, p)) continue;
        const std::size_t start = pos + 4;
        const std::size_t len = runLength(s, start, isAlnum);
        if (len >= 36 && !looksLikePlaceholder(s.substr(start, len))) {
            hit = {"GitHub token", p, start + len};
            return true;
        }
        return false;
    }

    if (startsWith(s, pos, "github_pat_")) {
        const std::size_t start = pos + 11;
        const std::size_t len = runLength(s, start, isAlnumOrUnderscore);
        if (len >= 59 && !looksLikePlaceholder(s.substr(start, len))) {
            hit = {"GitHub fine-grained token", "github_pat_", start + len};
            return true;
        }
        return false;
    }

    return false;
}

} // namespace

std::vector<Violation> checkSecretRules(Language lang, const std::string& path,
                                        const std::vector<Token>& tokens) {
    std::vector<Violation> out;
    const char* id = idFor(lang);
    if (id == nullptr) return out;

    for (const Token& tok : tokens) {
        if (tok.type != TokenType::STRING_LITERAL) continue;
        const std::string& s = tok.value;
        // Cheap reject: every format needs at least this many characters.
        if (s.size() < 20) continue;

        std::size_t pos = 0;
        while (pos < s.size()) {
            Hit hit{nullptr, nullptr, 0};
            if (!matchAt(s, pos, hit)) { ++pos; continue; }

            Violation v;
            v.path = path;
            v.line = tok.line;
            v.ruleId = id;
            v.language = languageToString(lang);
            v.category = "security";
            v.severity = "warning";
            v.message = std::string("String contains what looks like a live ") + hit.provider +
                        " (starts with '" + hit.prefix +
                        "'; value not repeated here) -- treat it as compromised: revoke and rotate it, "
                        "load the new one from an environment variable or secret manager, and purge "
                        "the old one from git history";
            out.push_back(std::move(v));
            pos = hit.end;
        }
    }
    return out;
}

} // namespace cma
