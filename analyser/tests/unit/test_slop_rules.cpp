// Unit tests for the "AI code slop" gates (rules/SlopRules.h):
//   <lang>-complex-function        cyclomatic complexity over 10, per function
//   <lang>-unreviewed-placeholder  AI-assistant leftovers / unfinished placeholders
// Every case goes through checkRules() so the dispatch wiring is covered too.

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

// `n` independent `if` statements inside one brace-delimited function body.
// Complexity = 1 + n.
std::string ifs(int n) {
    std::string s;
    for (int i = 0; i < n; ++i) s += "    if (a == " + std::to_string(i) + ") { b++; }\n";
    return s;
}

std::string pyIfs(int n) {
    std::string s;
    for (int i = 0; i < n; ++i) s += "    if a == " + std::to_string(i) + ":\n        b += 1\n";
    return s;
}

} // namespace

// ---- complex function: boundary (10 ok, 11 flagged) ----

TEST(SlopComplex, CppFlagsOverTen) {
    auto v = runCpp("void f(int a, int b) {\n" + ifs(10) + "}\n");   // 11
    EXPECT_EQ(count(v, "cpp-complex-function"), 1);
}
TEST(SlopComplex, CppAllowsTen) {
    auto v = runCpp("void f(int a, int b) {\n" + ifs(9) + "}\n");    // 10
    EXPECT_EQ(count(v, "cpp-complex-function"), 0);
}
TEST(SlopComplex, JavaFlagsOverTen) {
    auto v = runJava("class A { void f(int a, int b) {\n" + ifs(10) + "} }\n");
    EXPECT_EQ(count(v, "java-complex-function"), 1);
}
TEST(SlopComplex, JavaAllowsTen) {
    auto v = runJava("class A { void f(int a, int b) {\n" + ifs(9) + "} }\n");
    EXPECT_EQ(count(v, "java-complex-function"), 0);
}
TEST(SlopComplex, TypeScriptFlagsOverTen) {
    auto v = runTs("function f(a: number, b: number) {\n" + ifs(10) + "}\n");
    EXPECT_EQ(count(v, "ts-complex-function"), 1);
}
TEST(SlopComplex, TypeScriptAllowsTen) {
    auto v = runTs("function f(a: number, b: number) {\n" + ifs(9) + "}\n");
    EXPECT_EQ(count(v, "ts-complex-function"), 0);
}
TEST(SlopComplex, JavaScriptFlagsOverTen) {
    auto v = runJs("function f(a, b) {\n" + ifs(10) + "}\n");
    EXPECT_EQ(count(v, "js-complex-function"), 1);
}
TEST(SlopComplex, JavaScriptAllowsTen) {
    auto v = runJs("function f(a, b) {\n" + ifs(9) + "}\n");
    EXPECT_EQ(count(v, "js-complex-function"), 0);
}
TEST(SlopComplex, CSharpFlagsOverTen) {
    auto v = runCs("class A { void F(int a, int b) {\n" + ifs(10) + "} }\n");
    EXPECT_EQ(count(v, "csharp-complex-function"), 1);
}
TEST(SlopComplex, CSharpAllowsTen) {
    auto v = runCs("class A { void F(int a, int b) {\n" + ifs(9) + "} }\n");
    EXPECT_EQ(count(v, "csharp-complex-function"), 0);
}
TEST(SlopComplex, PythonFlagsOverTen) {
    auto v = runPy("def f(a, b):\n" + pyIfs(10));
    EXPECT_EQ(count(v, "py-complex-function"), 1);
}
TEST(SlopComplex, PythonAllowsTen) {
    auto v = runPy("def f(a, b):\n" + pyIfs(9));
    EXPECT_EQ(count(v, "py-complex-function"), 0);
}

// ---- complexity details ----

TEST(SlopComplex, LogicalOperatorsAndTernaryCount) {
    // 1 + 4 (&&) + 4 (||) + 2 (ternary) = 11
    auto v = runJs("function f(a, b, c) {\n"
                   "  return a && b && c && a && b || c || a || b || c ? 1 : b ? 2 : 3;\n"
                   "}\n");
    EXPECT_EQ(count(v, "js-complex-function"), 1);
}
TEST(SlopComplex, OptionalChainingIsNotABranch) {
    std::string body = "function f(a) {\n";
    for (int i = 0; i < 12; ++i) body += "  const x" + std::to_string(i) + " = a?.b" + std::to_string(i) + ";\n";
    body += "}\n";
    EXPECT_EQ(count(runJs(body), "js-complex-function"), 0);
}
TEST(SlopComplex, CSharpNullableTypeIsNotABranch) {
    std::string body = "class A { void F() {\n";
    for (int i = 0; i < 12; ++i) body += "  int? x" + std::to_string(i) + " = null;\n";
    body += "} }\n";
    EXPECT_EQ(count(runCs(body), "csharp-complex-function"), 0);
}
TEST(SlopComplex, NestedFunctionMeasuredSeparately) {
    // Outer holds 6 ifs, inner holds 6 ifs. Combined that would be 13, but
    // neither function is over 10 on its own, so nothing is flagged.
    auto v = runJs("function outer(a, b) {\n" + ifs(6) +
                   "  function inner(a, b) {\n" + ifs(6) + "  }\n}\n");
    EXPECT_EQ(count(v, "js-complex-function"), 0);
}
TEST(SlopComplex, OnlyTheComplexFunctionIsReported) {
    auto v = runJs("function small(a) { if (a) { return 1; } return 0; }\n"
                   "function big(a, b) {\n" + ifs(11) + "}\n");
    ASSERT_EQ(count(v, "js-complex-function"), 1);
    auto it = std::find_if(v.begin(), v.end(), [](const Violation& x) { return x.ruleId == "js-complex-function"; });
    EXPECT_NE(it->message.find("'big'"), std::string::npos);
    EXPECT_NE(it->message.find("12"), std::string::npos);
    EXPECT_EQ(it->language, "javascript");
    EXPECT_EQ(it->severity, "warning");
    EXPECT_EQ(it->category, "style");
}

// ---- unreviewed placeholder / AI leftover ----

TEST(SlopPlaceholder, CppFlagsElidedCode) {
    auto v = runCpp("void f() {\n  // ... rest of the code remains the same\n}\n");
    EXPECT_EQ(count(v, "cpp-unreviewed-placeholder"), 1);
}
TEST(SlopPlaceholder, PythonFlagsHashComment) {
    auto v = runPy("def f():\n    # your code here\n    pass\n");
    EXPECT_EQ(count(v, "py-unreviewed-placeholder"), 1);
}
TEST(SlopPlaceholder, JavaFlagsBlockComment) {
    auto v = runJava("class A {\n  /* As an AI language model, I cannot run this. */\n  void f() { }\n}\n");
    EXPECT_EQ(count(v, "java-unreviewed-placeholder"), 1);
}
TEST(SlopPlaceholder, TypeScriptFlagsImplementationGoesHere) {
    auto v = runTs("function f() {\n  // implementation goes here\n}\n");
    EXPECT_EQ(count(v, "ts-unreviewed-placeholder"), 1);
}
TEST(SlopPlaceholder, JavaScriptFlagsHereIsTheUpdated) {
    auto v = runJs("// Here is the updated function\nfunction f() { }\n");
    EXPECT_EQ(count(v, "js-unreviewed-placeholder"), 1);
}
TEST(SlopPlaceholder, CSharpFlagsExistingCodeElision) {
    auto v = runCs("class A {\n  // ... existing code ...\n  void F() { }\n}\n");
    EXPECT_EQ(count(v, "csharp-unreviewed-placeholder"), 1);
}
TEST(SlopPlaceholder, MatchesAcrossLineBreakInBlockComment) {
    auto v = runJava("class A {\n  /* rest of the code\n     remains the same */\n  void f() { }\n}\n");
    // "rest of the code\n remains" collapses to "rest of the code remains".
    EXPECT_EQ(count(v, "java-unreviewed-placeholder"), 1);
}
TEST(SlopPlaceholder, OrdinaryProseIsNotFlagged) {
    auto v = runJs("// the rest of the code assumes the list is sorted\n"
                   "// keep the existing code path for legacy callers\n"
                   "function f() { }\n");
    EXPECT_EQ(count(v, "js-unreviewed-placeholder"), 0);
}
TEST(SlopPlaceholder, PhraseInsideStringLiteralIsNotFlagged) {
    auto v = runJs("const msg = \"your code here\";\n");
    EXPECT_EQ(count(v, "js-unreviewed-placeholder"), 0);
}
TEST(SlopPlaceholder, OneViolationPerComment) {
    auto v = runPy("# your code here, implementation goes here\ndef f():\n    pass\n");
    EXPECT_EQ(count(v, "py-unreviewed-placeholder"), 1);
}

// ---- dispatch ----

TEST(SlopDispatch, AppendsAfterLanguageRulesWithoutDisturbingThem) {
    auto v = runPy("from os import *\n# your code here\n");
    EXPECT_EQ(count(v, "py-wildcard-import"), 1);
    EXPECT_EQ(count(v, "py-unreviewed-placeholder"), 1);
    EXPECT_EQ(v.front().ruleId, "py-wildcard-import");
}
