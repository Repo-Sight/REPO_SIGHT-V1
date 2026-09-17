// Unit tests for the Phase 6c security-hotspot rule catalog (39 rules
// across C++/Python/Java/TypeScript/JavaScript/C#, added on top of the
// Phase 4 Sprint 3B style/best-practice catalog covered by
// test_rule_violations.cpp). One positive case per new rule, a handful of
// negative/no-false-trigger cases for the fuzzier heuristics, a "clean code
// triggers nothing" case per language, and category-field regression
// checks (new rules stamp category="security", pre-existing rules still
// default to category="style").

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

using namespace cma;

namespace {

bool hasRule(const std::vector<Violation>& v, const std::string& id) {
    return std::any_of(v.begin(), v.end(), [&](const Violation& x) { return x.ruleId == id; });
}

const Violation* findRule(const std::vector<Violation>& v, const std::string& id) {
    auto it = std::find_if(v.begin(), v.end(), [&](const Violation& x) { return x.ruleId == id; });
    return it == v.end() ? nullptr : &(*it);
}

std::vector<Violation> runCpp(const std::string& src, const std::string& path = "f.cpp") {
    CppLexer lexer(src);
    auto tokens = lexer.tokenize();
    int lc = 1; for (char c : src) if (c == '\n') ++lc;
    CppParser parser(tokens, lc);
    auto fm = parser.analyze();
    return checkCppRules(path, tokens, fm);
}

std::vector<Violation> runPy(const std::string& src) {
    PythonLexer lexer(src);
    auto tokens = lexer.tokenize();
    int lc = 1; for (char c : src) if (c == '\n') ++lc;
    PythonParser parser(tokens, lc);
    auto fm = parser.analyze();
    return checkPythonRules("f.py", tokens, fm);
}

std::vector<Violation> runJava(const std::string& src) {
    JavaLexer lexer(src);
    auto tokens = lexer.tokenize();
    int lc = 1; for (char c : src) if (c == '\n') ++lc;
    JavaParser parser(tokens, lc);
    auto fm = parser.analyze();
    return checkJavaRules("F.java", tokens, fm);
}

std::vector<Violation> runTs(const std::string& src) {
    TypeScriptLexer lexer(src);
    auto tokens = lexer.tokenize();
    int lc = 1; for (char c : src) if (c == '\n') ++lc;
    TypeScriptParser parser(tokens, lc);
    auto fm = parser.analyze();
    return checkTypeScriptRules("f.ts", tokens, fm);
}

std::vector<Violation> runJs(const std::string& src) {
    JavaScriptLexer lexer(src);
    auto tokens = lexer.tokenize();
    int lc = 1; for (char c : src) if (c == '\n') ++lc;
    JavaScriptParser parser(tokens, lc);
    auto fm = parser.analyze();
    return checkJavaScriptRules("f.js", tokens, fm);
}

std::vector<Violation> runCs(const std::string& src) {
    CSharpLexer lexer(src);
    auto tokens = lexer.tokenize();
    int lc = 1; for (char c : src) if (c == '\n') ++lc;
    CSharpParser parser(tokens, lc);
    auto fm = parser.analyze();
    return checkCSharpRules("f.cs", tokens, fm);
}

} // namespace

// ---- category field: backward compatibility regression checks ----

TEST(SecurityCategoryField, NewRuleStampsSecurityCategory) {
    auto v = runCpp("int main() { system(\"ls\"); return 0; }\n");
    const Violation* hit = findRule(v, "cpp-sec-system-call");
    ASSERT_NE(hit, nullptr);
    EXPECT_EQ(hit->category, "security");
}

TEST(SecurityCategoryField, PreExistingRuleStillDefaultsToStyleCategory) {
    auto v = runCpp("int* p = new int(5);\ndelete p;\n");
    const Violation* hit = findRule(v, "cpp-raw-new-delete");
    ASSERT_NE(hit, nullptr);
    EXPECT_EQ(hit->category, "style");
}

// ---- C++ ----

TEST(CppSecurityRules, SystemCallPositive) {
    auto v = runCpp("int main() { system(\"ls\"); return 0; }\n");
    EXPECT_TRUE(hasRule(v, "cpp-sec-system-call"));
}
TEST(CppSecurityRules, PopenCallPositive) {
    auto v = runCpp("void f() { auto p = popen(\"ls\", \"r\"); }\n");
    EXPECT_TRUE(hasRule(v, "cpp-sec-popen-call"));
}
TEST(CppSecurityRules, UnsafeBufferFnPositive) {
    auto v = runCpp("void f(char* d, const char* s) { strcpy(d, s); }\n");
    EXPECT_TRUE(hasRule(v, "cpp-sec-unsafe-buffer-fn"));
}
TEST(CppSecurityRules, WeakRandomPositive) {
    auto v = runCpp("void f() { srand(1); int x = rand(); }\n");
    EXPECT_TRUE(hasRule(v, "cpp-sec-weak-random"));
}
TEST(CppSecurityRules, WeakHashPositive) {
    auto v = runCpp("void f() { MD5(data, len, digest); }\n");
    EXPECT_TRUE(hasRule(v, "cpp-sec-weak-hash"));
}
TEST(CppSecurityRules, HardcodedSecretPositive) {
    auto v = runCpp("void f() { const char* password = \"letmein123\"; }\n");
    EXPECT_TRUE(hasRule(v, "cpp-sec-hardcoded-secret"));
}
TEST(CppSecurityRules, ShortLiteralNotFlaggedAsSecret) {
    auto v = runCpp("void f() { const char* password = \"hi\"; }\n");
    EXPECT_FALSE(hasRule(v, "cpp-sec-hardcoded-secret"));
}
TEST(CppSecurityRules, CleanCodeTriggersNoSecurityRules) {
    auto v = runCpp("int add(int a, int b) { return a + b; }\n");
    for (const auto& violation : v) {
        EXPECT_EQ(violation.category, "style") << "unexpected security rule: " << violation.ruleId;
    }
}

// ---- Python ----

TEST(PythonSecurityRules, EvalExecPositive) {
    auto v = runPy("eval(user_input)\n");
    EXPECT_TRUE(hasRule(v, "py-sec-eval-exec"));
}
TEST(PythonSecurityRules, OsSystemPositive) {
    auto v = runPy("import os\nos.system(cmd)\n");
    EXPECT_TRUE(hasRule(v, "py-sec-os-system"));
}
TEST(PythonSecurityRules, SubprocessShellTruePositive) {
    auto v = runPy("import subprocess\nsubprocess.call(cmd, shell=True)\n");
    EXPECT_TRUE(hasRule(v, "py-sec-subprocess-shell-true"));
}
TEST(PythonSecurityRules, SubprocessWithoutShellTrueNegative) {
    auto v = runPy("import subprocess\nsubprocess.call(cmd)\n");
    EXPECT_FALSE(hasRule(v, "py-sec-subprocess-shell-true"));
}
TEST(PythonSecurityRules, PickleLoadPositive) {
    auto v = runPy("import pickle\ndata = pickle.loads(raw)\n");
    EXPECT_TRUE(hasRule(v, "py-sec-pickle-load"));
}
TEST(PythonSecurityRules, YamlUnsafeLoadPositive) {
    auto v = runPy("import yaml\nconfig = yaml.load(stream)\n");
    EXPECT_TRUE(hasRule(v, "py-sec-yaml-unsafe-load"));
}
TEST(PythonSecurityRules, YamlLoadWithSafeLoaderNegative) {
    auto v = runPy("import yaml\nconfig = yaml.load(stream, Loader=yaml.SafeLoader)\n");
    EXPECT_FALSE(hasRule(v, "py-sec-yaml-unsafe-load"));
}
TEST(PythonSecurityRules, WeakHashPositive) {
    auto v = runPy("import hashlib\nh = hashlib.md5(data)\n");
    EXPECT_TRUE(hasRule(v, "py-sec-weak-hash"));
}
TEST(PythonSecurityRules, HardcodedSecretPositive) {
    auto v = runPy("password = \"letmein123\"\n");
    EXPECT_TRUE(hasRule(v, "py-sec-hardcoded-secret"));
}
TEST(PythonSecurityRules, CleanCodeTriggersNoSecurityRules) {
    auto v = runPy("def add(a, b):\n    return a + b\n");
    for (const auto& violation : v) {
        EXPECT_EQ(violation.category, "style") << "unexpected security rule: " << violation.ruleId;
    }
}

// ---- Java ----

TEST(JavaSecurityRules, RuntimeExecPositive) {
    auto v = runJava("class F { void f() { Runtime.getRuntime().exec(cmd); } }\n");
    EXPECT_TRUE(hasRule(v, "java-sec-runtime-exec"));
}
TEST(JavaSecurityRules, ProcessBuilderPositive) {
    auto v = runJava("class F { void f() { Object pb = new ProcessBuilder(cmd); } }\n");
    EXPECT_TRUE(hasRule(v, "java-sec-runtime-exec"));
}
TEST(JavaSecurityRules, WeakHashPositive) {
    auto v = runJava("class F { void f() throws Exception { MessageDigest.getInstance(\"MD5\"); } }\n");
    EXPECT_TRUE(hasRule(v, "java-sec-weak-hash"));
}
TEST(JavaSecurityRules, WeakCipherPositive) {
    auto v = runJava("class F { void f() throws Exception { Cipher.getInstance(\"DES\"); } }\n");
    EXPECT_TRUE(hasRule(v, "java-sec-weak-cipher"));
}
TEST(JavaSecurityRules, SqlStringConcatPositive) {
    auto v = runJava(
        "class F { void f() { stmt.executeQuery(\"SELECT * FROM t WHERE id=\" + id); } }\n");
    EXPECT_TRUE(hasRule(v, "java-sec-sql-string-concat"));
}
TEST(JavaSecurityRules, SqlWithoutConcatNegative) {
    auto v = runJava("class F { void f() { stmt.executeQuery(\"SELECT * FROM t\"); } }\n");
    EXPECT_FALSE(hasRule(v, "java-sec-sql-string-concat"));
}
TEST(JavaSecurityRules, TrustManagerReviewPositive) {
    auto v = runJava("class F implements X509TrustManager { }\n");
    EXPECT_TRUE(hasRule(v, "java-sec-trust-manager-review"));
}
TEST(JavaSecurityRules, HardcodedSecretPositive) {
    auto v = runJava("class F { String password = \"letmein123\"; }\n");
    EXPECT_TRUE(hasRule(v, "java-sec-hardcoded-secret"));
}
TEST(JavaSecurityRules, CleanCodeTriggersNoSecurityRules) {
    auto v = runJava("class F { void f() { int x = 1 + 2; } }\n");
    for (const auto& violation : v) {
        EXPECT_EQ(violation.category, "style") << "unexpected security rule: " << violation.ruleId;
    }
}

// ---- TypeScript ----

TEST(TypeScriptSecurityRules, EvalPositive) {
    auto v = runTs("eval(code);\n");
    EXPECT_TRUE(hasRule(v, "ts-sec-eval"));
}
TEST(TypeScriptSecurityRules, ChildProcessExecPositive) {
    auto v = runTs("exec(cmd);\n");
    EXPECT_TRUE(hasRule(v, "ts-sec-child-process-exec"));
}
TEST(TypeScriptSecurityRules, InnerHtmlAssignmentPositive) {
    auto v = runTs("el.innerHTML = html;\n");
    EXPECT_TRUE(hasRule(v, "ts-sec-inner-html"));
}
TEST(TypeScriptSecurityRules, InnerHtmlStrictComparisonNegative) {
    auto v = runTs("if (el.innerHTML === expected) { f(); }\n");
    EXPECT_FALSE(hasRule(v, "ts-sec-inner-html"));
}
TEST(TypeScriptSecurityRules, WeakHashPositive) {
    auto v = runTs("const h = createHash('md5');\n");
    EXPECT_TRUE(hasRule(v, "ts-sec-weak-hash"));
}
TEST(TypeScriptSecurityRules, StrongHashNegative) {
    auto v = runTs("const h = createHash('sha256');\n");
    EXPECT_FALSE(hasRule(v, "ts-sec-weak-hash"));
}
TEST(TypeScriptSecurityRules, DisabledTlsPositive) {
    auto v = runTs("const opts = { rejectUnauthorized: false };\n");
    EXPECT_TRUE(hasRule(v, "ts-sec-disabled-tls"));
}
TEST(TypeScriptSecurityRules, EnabledTlsNegative) {
    auto v = runTs("const opts = { rejectUnauthorized: true };\n");
    EXPECT_FALSE(hasRule(v, "ts-sec-disabled-tls"));
}
TEST(TypeScriptSecurityRules, SqlStringConcatPositive) {
    auto v = runTs("db.query(\"SELECT * FROM t WHERE id=\" + id);\n");
    EXPECT_TRUE(hasRule(v, "ts-sec-sql-string-concat"));
}
TEST(TypeScriptSecurityRules, SqlWithoutConcatNegative) {
    auto v = runTs("db.query(\"SELECT * FROM t\");\n");
    EXPECT_FALSE(hasRule(v, "ts-sec-sql-string-concat"));
}
TEST(TypeScriptSecurityRules, HardcodedSecretPositive) {
    auto v = runTs("const password = \"letmein123\";\n");
    EXPECT_TRUE(hasRule(v, "ts-sec-hardcoded-secret"));
}
TEST(TypeScriptSecurityRules, CleanCodeTriggersNoSecurityRules) {
    auto v = runTs("function add(a: number, b: number): number { return a + b; }\n");
    for (const auto& violation : v) {
        EXPECT_EQ(violation.category, "style") << "unexpected security rule: " << violation.ruleId;
    }
}

// ---- JavaScript ----

TEST(JavaScriptSecurityRules, EvalPositive) {
    auto v = runJs("eval(code);\n");
    EXPECT_TRUE(hasRule(v, "js-sec-eval"));
}
TEST(JavaScriptSecurityRules, ChildProcessExecPositive) {
    auto v = runJs("exec(cmd);\n");
    EXPECT_TRUE(hasRule(v, "js-sec-child-process-exec"));
}
TEST(JavaScriptSecurityRules, InnerHtmlAssignmentPositive) {
    auto v = runJs("el.innerHTML = html;\n");
    EXPECT_TRUE(hasRule(v, "js-sec-inner-html"));
}
TEST(JavaScriptSecurityRules, InnerHtmlStrictComparisonNegative) {
    auto v = runJs("if (el.innerHTML === expected) { f(); }\n");
    EXPECT_FALSE(hasRule(v, "js-sec-inner-html"));
}
TEST(JavaScriptSecurityRules, WeakHashPositive) {
    auto v = runJs("const h = createHash('md5');\n");
    EXPECT_TRUE(hasRule(v, "js-sec-weak-hash"));
}
TEST(JavaScriptSecurityRules, StrongHashNegative) {
    auto v = runJs("const h = createHash('sha256');\n");
    EXPECT_FALSE(hasRule(v, "js-sec-weak-hash"));
}
TEST(JavaScriptSecurityRules, DisabledTlsPositive) {
    auto v = runJs("const opts = { rejectUnauthorized: false };\n");
    EXPECT_TRUE(hasRule(v, "js-sec-disabled-tls"));
}
TEST(JavaScriptSecurityRules, EnabledTlsNegative) {
    auto v = runJs("const opts = { rejectUnauthorized: true };\n");
    EXPECT_FALSE(hasRule(v, "js-sec-disabled-tls"));
}
TEST(JavaScriptSecurityRules, SqlStringConcatPositive) {
    auto v = runJs("db.query(\"SELECT * FROM t WHERE id=\" + id);\n");
    EXPECT_TRUE(hasRule(v, "js-sec-sql-string-concat"));
}
TEST(JavaScriptSecurityRules, SqlWithoutConcatNegative) {
    auto v = runJs("db.query(\"SELECT * FROM t\");\n");
    EXPECT_FALSE(hasRule(v, "js-sec-sql-string-concat"));
}
TEST(JavaScriptSecurityRules, HardcodedSecretPositive) {
    auto v = runJs("const password = \"letmein123\";\n");
    EXPECT_TRUE(hasRule(v, "js-sec-hardcoded-secret"));
}
TEST(JavaScriptSecurityRules, CleanCodeTriggersNoSecurityRules) {
    auto v = runJs("function add(a, b) { return a + b; }\n");
    for (const auto& violation : v) {
        EXPECT_EQ(violation.category, "style") << "unexpected security rule: " << violation.ruleId;
    }
}

// ---- C# ----

TEST(CSharpSecurityRules, ProcessStartPositive) {
    auto v = runCs("class F { void M() { Process.Start(\"cmd.exe\"); } }\n");
    EXPECT_TRUE(hasRule(v, "csharp-sec-process-start"));
}
TEST(CSharpSecurityRules, WeakHashMd5Positive) {
    auto v = runCs("class F { void M() { var h = MD5.Create(); } }\n");
    EXPECT_TRUE(hasRule(v, "csharp-sec-weak-hash"));
}
TEST(CSharpSecurityRules, WeakHashSha1Positive) {
    auto v = runCs("class F { void M() { var h = SHA1.Create(); } }\n");
    EXPECT_TRUE(hasRule(v, "csharp-sec-weak-hash"));
}
TEST(CSharpSecurityRules, WeakCipherPositive) {
    auto v = runCs("class F { void M() { var d = DES.Create(); } }\n");
    EXPECT_TRUE(hasRule(v, "csharp-sec-weak-cipher"));
}
TEST(CSharpSecurityRules, SqlStringConcatPositive) {
    auto v = runCs(
        "class F { void M() { var c = new SqlCommand(\"SELECT * FROM t WHERE id=\" + id); } }\n");
    EXPECT_TRUE(hasRule(v, "csharp-sec-sql-string-concat"));
}
TEST(CSharpSecurityRules, SqlWithoutConcatNegative) {
    auto v = runCs("class F { void M() { var c = new SqlCommand(\"SELECT * FROM t\"); } }\n");
    EXPECT_FALSE(hasRule(v, "csharp-sec-sql-string-concat"));
}
TEST(CSharpSecurityRules, CertValidationCallbackReviewPositive) {
    auto v = runCs(
        "class F { void M() { ServerCertificateValidationCallback = (s, c, ch, e) => true; } }\n");
    EXPECT_TRUE(hasRule(v, "csharp-sec-cert-validation-disabled"));
}
TEST(CSharpSecurityRules, HardcodedSecretPositive) {
    auto v = runCs("class F { string password = \"letmein123\"; }\n");
    EXPECT_TRUE(hasRule(v, "csharp-sec-hardcoded-secret"));
}
TEST(CSharpSecurityRules, CleanCodeTriggersNoSecurityRules) {
    auto v = runCs("class F { void M() { int x = 1 + 2; } }\n");
    for (const auto& violation : v) {
        EXPECT_EQ(violation.category, "style") << "unexpected security rule: " << violation.ruleId;
    }
}
