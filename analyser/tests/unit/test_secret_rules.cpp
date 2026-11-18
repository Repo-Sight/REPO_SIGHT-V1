// Unit tests for provider-token scrubbing (rules/SecretRules.h):
//   <lang>-sec-secret-token   Anthropic / OpenAI / AWS / GitHub tokens in string literals
// Every case goes through checkRules() so the dispatch wiring is covered too.
//
// No real-looking token is written out in this file (it would trip secret
// scanners on the repo itself): bodies are generated at run time from a fixed
// seed, and only the public prefixes appear as literals.

#include "lexer/CppLexer.h"
#include "lexer/CSharpLexer.h"
#include "lexer/JavaLexer.h"
#include "lexer/JavaScriptLexer.h"
#include "lexer/PythonLexer.h"
#include "lexer/TypeScriptLexer.h"
#include "parser/CppParser.h"
#include "parser/CSharpParser.h"
#include "parser/JavaParser.h"
#include "parser/JavaScriptParser.h"
#include "parser/PythonParser.h"
#include "parser/TypeScriptParser.h"
#include "rules/RuleDispatch.h"

#include <gtest/gtest.h>

#include <algorithm>
#include <cstdint>
#include <string>

using namespace cma;

namespace {

int lineCount(const std::string& src) {
    int lc = 1;
    for (char c : src) if (c == '\n') ++lc;
    return lc;
}

template <class Lexer, class Parser>
std::vector<Violation> run(Language lang, const std::string& path, const std::string& src) {
    Lexer lexer(src);
    auto tokens = lexer.tokenize();
    Parser parser(tokens, lineCount(src));
    auto fm = parser.analyze();
    return checkRules(lang, path, tokens, fm);
}

std::vector<Violation> runCpp(const std::string& s)  { return run<CppLexer, CppParser>(Language::Cpp, "f.cpp", s); }
std::vector<Violation> runPy(const std::string& s)   { return run<PythonLexer, PythonParser>(Language::Python, "f.py", s); }
std::vector<Violation> runJava(const std::string& s) { return run<JavaLexer, JavaParser>(Language::Java, "F.java", s); }
std::vector<Violation> runTs(const std::string& s)   { return run<TypeScriptLexer, TypeScriptParser>(Language::TypeScript, "f.ts", s); }
std::vector<Violation> runJs(const std::string& s)   { return run<JavaScriptLexer, JavaScriptParser>(Language::JavaScript, "f.js", s); }
std::vector<Violation> runCs(const std::string& s)   { return run<CSharpLexer, CSharpParser>(Language::CSharp, "F.cs", s); }

int count(const std::vector<Violation>& v, const std::string& id) {
    return static_cast<int>(std::count_if(v.begin(), v.end(), [&](const Violation& x) { return x.ruleId == id; }));
}

// Deterministic pseudo-random body from `alphabet`, so the test source holds
// no literal token. Forces a digit, an upper and a lower case letter in
// the first three positions when the alphabet allows it.
std::string body(std::size_t n, const std::string& alphabet, std::uint32_t seed) {
    std::string out;
    std::uint32_t x = seed;
    for (std::size_t i = 0; i < n; ++i) {
        x = x * 1664525u + 1013904223u;
        out += alphabet[(x >> 16) % alphabet.size()];
    }
    return out;
}

const std::string kBase62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const std::string kUpperDigit = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

std::string mixed(std::size_t n, std::uint32_t seed) {
    std::string b = body(n, kBase62, seed);
    b[0] = 'A'; b[1] = 'b'; b[2] = '7';
    return b;
}

std::string anthropicKey() { return "sk-ant-api03-" + mixed(90, 1); }
std::string openAiKey()    { return "sk-proj-" + mixed(60, 2); }
std::string legacyOpenAi() { return "sk-" + mixed(48, 3); }
std::string awsKeyId()     { return "AKIA" + body(16, kUpperDigit, 4); }
std::string githubToken()  { return "ghp_" + body(36, kBase62, 5); }
std::string githubPat()    { return "github_pat_" + body(70, kBase62 + "_", 6); }

} // namespace

// ---- each provider ----

TEST(SecretToken, FlagsAnthropicKey) {
    auto v = runPy("client = make(\"" + anthropicKey() + "\")\n");
    EXPECT_EQ(count(v, "py-sec-secret-token"), 1);
}

TEST(SecretToken, FlagsOpenAiProjectAndLegacyKeys) {
    EXPECT_EQ(count(runJs("const k = '" + openAiKey() + "';\n"), "js-sec-secret-token"), 1);
    EXPECT_EQ(count(runJs("const k = '" + legacyOpenAi() + "';\n"), "js-sec-secret-token"), 1);
}

TEST(SecretToken, FlagsAwsAccessKeyId) {
    EXPECT_EQ(count(runJava("class A { String k = \"" + awsKeyId() + "\"; }\n"), "java-sec-secret-token"), 1);
}

TEST(SecretToken, FlagsGitHubClassicAndFineGrainedTokens) {
    EXPECT_EQ(count(runTs("const t: string = '" + githubToken() + "';\n"), "ts-sec-secret-token"), 1);
    EXPECT_EQ(count(runTs("const t: string = '" + githubPat() + "';\n"), "ts-sec-secret-token"), 1);
}

TEST(SecretToken, EmitsPerLanguageRuleIdAsSecurityWarning) {
    const std::string tok = githubToken();
    auto cpp = runCpp("const char* k = \"" + tok + "\";\n");
    auto cs  = runCs("class A { string k = \"" + tok + "\"; }\n");
    EXPECT_EQ(count(cpp, "cpp-sec-secret-token"), 1);
    EXPECT_EQ(count(cs, "csharp-sec-secret-token"), 1);
    for (const auto& v : cpp) {
        if (v.ruleId != "cpp-sec-secret-token") continue;
        EXPECT_EQ(v.category, "security");
        EXPECT_EQ(v.severity, "warning");
        EXPECT_EQ(v.language, "cpp");
        EXPECT_EQ(v.line, 1);
    }
}

TEST(SecretToken, ReportsEveryTokenInOneLiteral) {
    auto v = runPy("blob = \"" + githubToken() + " " + awsKeyId() + "\"\n");
    EXPECT_EQ(count(v, "py-sec-secret-token"), 2);
}

// ---- the report must never repeat the secret ----

TEST(SecretToken, MessageNeverContainsTheTokenBody) {
    const std::string tok = anthropicKey();
    auto v = runPy("k = \"" + tok + "\"\n");
    bool seen = false;
    for (const auto& x : v) {
        if (x.ruleId != "py-sec-secret-token") continue;
        seen = true;
        EXPECT_EQ(x.message.find(tok.substr(13, 20)), std::string::npos);
        EXPECT_NE(x.message.find("Anthropic"), std::string::npos);
        EXPECT_NE(x.message.find("sk-ant-"), std::string::npos);
    }
    EXPECT_TRUE(seen);
}

// ---- things that must NOT fire ----

TEST(SecretToken, IgnoresPlaceholdersAndDocsExamples) {
    EXPECT_EQ(count(runPy("k = \"sk-ant-api03-" + std::string(40, 'x') + "\"\n"), "py-sec-secret-token"), 0);
    EXPECT_EQ(count(runPy("k = \"sk-ant-your-key-goes-here-" + std::string(10, 'a') + "\"\n"), "py-sec-secret-token"), 0);
    EXPECT_EQ(count(runPy("k = \"AKIAIOSFODNN7EXAMPLE\"\n"), "py-sec-secret-token"), 0);
    EXPECT_EQ(count(runPy("k = \"AKIA" + std::string(16, 'X') + "\"\n"), "py-sec-secret-token"), 0);
    EXPECT_EQ(count(runPy("k = \"ghp_" + std::string(36, 'a') + "\"\n"), "py-sec-secret-token"), 0);
}

TEST(SecretToken, IgnoresTooShortAndWrongShapes) {
    EXPECT_EQ(count(runPy("k = \"sk-ant-abc123\"\n"), "py-sec-secret-token"), 0);
    EXPECT_EQ(count(runPy("k = \"ghp_" + body(10, kBase62, 7) + "\"\n"), "py-sec-secret-token"), 0);
    // 17 characters after AKIA: an identifier, not a key ID.
    EXPECT_EQ(count(runPy("k = \"AKIA" + body(17, kUpperDigit, 8) + "\"\n"), "py-sec-secret-token"), 0);
    // sk- followed by a kebab-case slug.
    EXPECT_EQ(count(runPy("k = \"sk-learn-model-selection-cross-validation-pipeline-utils\"\n"), "py-sec-secret-token"), 0);
}

TEST(SecretToken, RequiresAWordBoundaryBeforeThePrefix) {
    // "task-" / "disk-" end in "sk-": must not be read as an OpenAI key.
    EXPECT_EQ(count(runPy("k = \"disk-" + mixed(48, 9) + "\"\n"), "py-sec-secret-token"), 0);
    EXPECT_EQ(count(runPy("k = \"XAKIA" + body(16, kUpperDigit, 10) + "\"\n"), "py-sec-secret-token"), 0);
}

TEST(SecretToken, OnlyStringLiteralsAreScanned) {
    auto v = runPy("# token: " + githubToken() + "\nx = 1\n");
    EXPECT_EQ(count(v, "py-sec-secret-token"), 0);
}

// ---- dispatch ----

TEST(SecretDispatch, SupersedesTheNameBasedRuleOnTheSameLine) {
    auto v = runPy("OPENAI_API_KEY = \"" + openAiKey() + "\"\n");
    EXPECT_EQ(count(v, "py-sec-secret-token"), 1);
    EXPECT_EQ(count(v, "py-sec-hardcoded-secret"), 0);
}

TEST(SecretDispatch, KeepsTheNameBasedRuleWhenNoTokenFormatMatches) {
    auto v = runPy("DB_PASSWORD = \"hunter2hunter2\"\n");
    EXPECT_EQ(count(v, "py-sec-hardcoded-secret"), 1);
    EXPECT_EQ(count(v, "py-sec-secret-token"), 0);
}

TEST(SecretDispatch, KeepsTheNameBasedRuleOnOtherLines) {
    auto v = runPy("DB_PASSWORD = \"hunter2hunter2\"\nk = \"" + githubToken() + "\"\n");
    EXPECT_EQ(count(v, "py-sec-hardcoded-secret"), 1);
    EXPECT_EQ(count(v, "py-sec-secret-token"), 1);
}
