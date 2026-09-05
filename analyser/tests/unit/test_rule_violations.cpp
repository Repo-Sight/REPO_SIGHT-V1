// Unit tests for the Phase 4 Sprint 3B rule catalog (RECONSTRUCTED module
// -- see rules/CppRules.h et al.'s header comments). One positive +
// one negative case per rule (21 rules = 42 cases), plus dispatch and
// end-to-end coverage. This is a fresh test file written against this
// session's reconstruction, not a recovery of the original 61-case file
// -- exact case count/names will differ from your real repo's version.
 
#include "lexer/CppLexer.h"
#include "lexer/JavaLexer.h"
#include "lexer/JavaScriptLexer.h"
#include "lexer/PythonLexer.h"
#include "lexer/TypeScriptLexer.h"
#include "parser/CppParser.h"
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


} // namespace
 
// ---- C++ ----
 
TEST(CppRules, RawNewDeletePositive) {
    auto v = runCpp("int* p = new int(5);\ndelete p;\n");
    EXPECT_TRUE(hasRule(v, "cpp-raw-new-delete"));
}
TEST(CppRules, RawNewDeleteNegative) {
    auto v = runCpp("auto p = std::make_unique<int>(5);\n");
    EXPECT_FALSE(hasRule(v, "cpp-raw-new-delete"));
}
 
TEST(CppRules, UsingNamespaceStdHeaderPositive) {
    auto v = runCpp("using namespace std;\n", "widget.h");
    EXPECT_TRUE(hasRule(v, "cpp-using-namespace-std-header"));
}
TEST(CppRules, UsingNamespaceStdSourceNegative) {
    auto v = runCpp("using namespace std;\n", "widget.cpp");
    EXPECT_FALSE(hasRule(v, "cpp-using-namespace-std-header"));
}
 
TEST(CppRules, EmptyCatchAllSingleLineDetected) {
    auto v = runCpp("void f() { try { g(); } catch (...) {} }\n");
    EXPECT_TRUE(hasRule(v, "cpp-catch-all-ellipsis"));
}
TEST(CppRules, EmptyCatchAllMultiLineDetected) {
    auto v = runCpp("void f() { try { g(); } catch (...) {\n} }\n");
    EXPECT_TRUE(hasRule(v, "cpp-catch-all-ellipsis"));
}
TEST(CppRules, CatchTypedWithBodyNegative) {
    auto v = runCpp("void f() { try { g(); } catch (std::exception& e) { log(e); } }\n");
    EXPECT_FALSE(hasRule(v, "cpp-catch-all-ellipsis"));
}
 
TEST(CppRules, MagicNumberPositive) {
    auto v = runCpp("void f(int x) { if (x < 42) { g(); } }\n");
    EXPECT_TRUE(hasRule(v, "cpp-magic-number-literal"));
}
TEST(CppRules, MagicNumberZeroOneNegative) {
    auto v = runCpp("void f(int x) { if (x < 1) { g(); } }\n");
    EXPECT_FALSE(hasRule(v, "cpp-magic-number-literal"));
}
 
TEST(CppRules, LongFunctionPositive) {
    std::string body = "void f() {\n";
    for (int i = 0; i < 105; ++i) body += "g();\n";
    body += "}\n";
    auto v = runCpp(body);
    EXPECT_TRUE(hasRule(v, "cpp-long-function"));
}
TEST(CppRules, ShortFunctionNegative) {
    auto v = runCpp("void f() { g(); }\n");
    EXPECT_FALSE(hasRule(v, "cpp-long-function"));
}
 
TEST(CppRules, DeepNestingPositive) {
    std::string body = "void f() {\n";
    for (int i = 0; i < 7; ++i) body += "if (1) {\n";
    body += "g();\n";
    for (int i = 0; i < 7; ++i) body += "}\n";
    body += "}\n";
    auto v = runCpp(body);
    EXPECT_TRUE(hasRule(v, "cpp-deep-nesting"));
}
TEST(CppRules, ShallowNestingNegative) {
    auto v = runCpp("void f() { if (1) { g(); } }\n");
    EXPECT_FALSE(hasRule(v, "cpp-deep-nesting"));
}
 
TEST(CppRules, TodoWithoutTicketPositive) {
    auto v = runCpp("// TODO fix this\nvoid f() {}\n");
    EXPECT_TRUE(hasRule(v, "cpp-todo-without-ticket"));
}
TEST(CppRules, TodoWithTicketNegative) {
    auto v = runCpp("// TODO(#123): fix this\nvoid f() {}\n");
    EXPECT_FALSE(hasRule(v, "cpp-todo-without-ticket"));
}
 
// ---- Python ----
 
TEST(PythonRules, MutableDefaultArgPositive) {
    auto v = runPy("def f(x=[]):\n    return x\n");
    EXPECT_TRUE(hasRule(v, "py-mutable-default-arg"));
}
TEST(PythonRules, NoneDefaultArgNegative) {
    auto v = runPy("def f(x=None):\n    x = x or []\n    return x\n");
    EXPECT_FALSE(hasRule(v, "py-mutable-default-arg"));
}
 
TEST(PythonRules, BareExceptPositive) {
    auto v = runPy("try:\n    f()\nexcept:\n    pass\n");
    EXPECT_TRUE(hasRule(v, "py-bare-except"));
}
TEST(PythonRules, TypedExceptNegative) {
    auto v = runPy("try:\n    f()\nexcept ValueError:\n    pass\n");
    EXPECT_FALSE(hasRule(v, "py-bare-except"));
}
 
TEST(PythonRules, WildcardImportPositive) {
    auto v = runPy("from os import *\n");
    EXPECT_TRUE(hasRule(v, "py-wildcard-import"));
}
TEST(PythonRules, NamedImportNegative) {
    auto v = runPy("from os import path\n");
    EXPECT_FALSE(hasRule(v, "py-wildcard-import"));
}
 
TEST(PythonRules, LongFunctionPositive) {
    std::string body = "def f():\n";
    for (int i = 0; i < 105; ++i) body += "    g()\n";
    auto v = runPy(body);
    EXPECT_TRUE(hasRule(v, "py-long-function"));
}
TEST(PythonRules, ShortFunctionNegative) {
    auto v = runPy("def f():\n    return 1\n");
    EXPECT_FALSE(hasRule(v, "py-long-function"));
}
 
TEST(PythonRules, DeepNestingPositive) {
    std::string body = "def f():\n";
    std::string indent = "    ";
    for (int i = 0; i < 7; ++i) { body += indent + "if True:\n"; indent += "    "; }
    body += indent + "pass\n";
    auto v = runPy(body);
    EXPECT_TRUE(hasRule(v, "py-deep-nesting"));
}
TEST(PythonRules, ShallowNestingNegative) {
    auto v = runPy("def f():\n    if True:\n        pass\n");
    EXPECT_FALSE(hasRule(v, "py-deep-nesting"));
}
 
TEST(PythonRules, MutableClassAttributePositive) {
    auto v = runPy("class Widget:\n    items = []\n    def __init__(self):\n        pass\n");
    EXPECT_TRUE(hasRule(v, "py-mutable-class-attribute"));
}
TEST(PythonRules, InstanceAttributeInInitNegative) {
    auto v = runPy("class Widget:\n    def __init__(self):\n        self.items = []\n");
    EXPECT_FALSE(hasRule(v, "py-mutable-class-attribute"));
}
 
TEST(PythonRules, TodoWithoutTicketPositive) {
    auto v = runPy("# TODO fix this\ndef f():\n    pass\n");
    EXPECT_TRUE(hasRule(v, "py-todo-without-ticket"));
}
TEST(PythonRules, TodoWithTicketNegative) {
    auto v = runPy("# TODO(#42): fix this\ndef f():\n    pass\n");
    EXPECT_FALSE(hasRule(v, "py-todo-without-ticket"));
}
 
// ---- Java ----
 
TEST(JavaRules, EmptyCatchBlockSingleLineDetected) {
    auto v = runJava("class X { void f() { try { g(); } catch (Exception e) {} } }\n");
    EXPECT_TRUE(hasRule(v, "java-empty-catch-block"));
}
TEST(JavaRules, EmptyCatchBlockMultiLineDetected) {
    auto v = runJava("class X { void f() { try { g(); } catch (Exception e) {\n} } }\n");
    EXPECT_TRUE(hasRule(v, "java-empty-catch-block"));
}
TEST(JavaRules, CatchWithBodyNegative) {
    auto v = runJava("class X { void f() { try { g(); } catch (Exception e) { log(e); } } }\n");
    EXPECT_FALSE(hasRule(v, "java-empty-catch-block"));
}
 
TEST(JavaRules, PublicFieldPositive) {
    auto v = runJava("class X { public int count; }\n");
    EXPECT_TRUE(hasRule(v, "java-public-field"));
}
TEST(JavaRules, PublicStaticFinalConstantNegative) {
    auto v = runJava("class X { public static final int MAX = 10; }\n");
    EXPECT_FALSE(hasRule(v, "java-public-field"));
}
TEST(JavaRules, PublicMethodNegative) {
    auto v = runJava("class X { public void run() {} }\n");
    EXPECT_FALSE(hasRule(v, "java-public-field"));
}
 
TEST(JavaRules, PrintStackTracePositive) {
    auto v = runJava("class X { void f() { e.printStackTrace(); } }\n");
    EXPECT_TRUE(hasRule(v, "java-printstacktrace"));
}
TEST(JavaRules, LoggerCallNegative) {
    auto v = runJava("class X { void f() { logger.error(e); } }\n");
    EXPECT_FALSE(hasRule(v, "java-printstacktrace"));
}
 
TEST(JavaRules, LongMethodPositive) {
    std::string body = "class X { void f() {\n";
    for (int i = 0; i < 105; ++i) body += "g();\n";
    body += "} }\n";
    auto v = runJava(body);
    EXPECT_TRUE(hasRule(v, "java-long-method"));
}
TEST(JavaRules, ShortMethodNegative) {
    auto v = runJava("class X { void f() { g(); } }\n");
    EXPECT_FALSE(hasRule(v, "java-long-method"));
}
 
TEST(JavaRules, DeepNestingPositive) {
    std::string body = "class X { void f() {\n";
    for (int i = 0; i < 7; ++i) body += "if (true) {\n";
    body += "g();\n";
    for (int i = 0; i < 7; ++i) body += "}\n";
    body += "} }\n";
    auto v = runJava(body);
    EXPECT_TRUE(hasRule(v, "java-deep-nesting"));
}
TEST(JavaRules, ShallowNestingNegative) {
    auto v = runJava("class X { void f() { if (true) { g(); } } }\n");
    EXPECT_FALSE(hasRule(v, "java-deep-nesting"));
}
 
TEST(JavaRules, RawTypeDeclarationPositive) {
    auto v = runJava("class X { void f() { List names; } }\n");
    EXPECT_TRUE(hasRule(v, "java-raw-type-usage"));
}
TEST(JavaRules, RawTypeInstantiationPositive) {
    auto v = runJava("class X { void f() { Object o = new ArrayList(); } }\n");
    EXPECT_TRUE(hasRule(v, "java-raw-type-usage"));
}
TEST(JavaRules, GenericTypeNegative) {
    auto v = runJava("class X { void f() { List<String> names; } }\n");
    EXPECT_FALSE(hasRule(v, "java-raw-type-usage"));
}
 
TEST(JavaRules, TodoWithoutTicketPositive) {
    auto v = runJava("// TODO fix this\nclass X {}\n");
    EXPECT_TRUE(hasRule(v, "java-todo-without-ticket"));
}
TEST(JavaRules, TodoWithTicketNegative) {
    auto v = runJava("// TODO(PROJ-99): fix this\nclass X {}\n");
    EXPECT_FALSE(hasRule(v, "java-todo-without-ticket"));
}

// ---- TypeScript ----

TEST(TypeScriptRules, EmptyCatchBlockWithBindingPositive) {
    auto v = runTs("function f() {\n    try { risky(); } catch (e) { }\n}\n");
    EXPECT_TRUE(hasRule(v, "ts-empty-catch-block"));
}
TEST(TypeScriptRules, EmptyCatchBlockNoBindingPositive) {
    auto v = runTs("function f() {\n    try { risky(); } catch { }\n}\n");
    EXPECT_TRUE(hasRule(v, "ts-empty-catch-block"));
}
TEST(TypeScriptRules, CatchWithBodyNegative) {
    auto v = runTs("function f() {\n    try { risky(); } catch (e) { handle(e); }\n}\n");
    EXPECT_FALSE(hasRule(v, "ts-empty-catch-block"));
}

TEST(TypeScriptRules, ExplicitAnyTypeAnnotationPositive) {
    auto v = runTs("let x: any = 5;\n");
    EXPECT_TRUE(hasRule(v, "ts-explicit-any"));
}
TEST(TypeScriptRules, ExplicitAnyAssertionPositive) {
    auto v = runTs("let x = y as any;\n");
    EXPECT_TRUE(hasRule(v, "ts-explicit-any"));
}
TEST(TypeScriptRules, SpecificTypeAnnotationNegative) {
    auto v = runTs("let x: number = 5;\n");
    EXPECT_FALSE(hasRule(v, "ts-explicit-any"));
}

TEST(TypeScriptRules, VarUsagePositive) {
    auto v = runTs("var x = 1;\n");
    EXPECT_TRUE(hasRule(v, "ts-var-usage"));
}
TEST(TypeScriptRules, LetUsageNegative) {
    auto v = runTs("let x = 1;\n");
    EXPECT_FALSE(hasRule(v, "ts-var-usage"));
}

TEST(TypeScriptRules, LooseEqualityDoubleEqualsPositive) {
    auto v = runTs("function f(a, b) {\n    if (a == b) { return true; }\n}\n");
    EXPECT_TRUE(hasRule(v, "ts-loose-equality"));
}
TEST(TypeScriptRules, LooseEqualityNotEqualsPositive) {
    auto v = runTs("function f(a, b) {\n    if (a != b) { return true; }\n}\n");
    EXPECT_TRUE(hasRule(v, "ts-loose-equality"));
}
TEST(TypeScriptRules, StrictEqualityNegative) {
    auto v = runTs("function f(a, b) {\n    if (a === b) { return true; }\n}\n");
    EXPECT_FALSE(hasRule(v, "ts-loose-equality"));
}
TEST(TypeScriptRules, StrictNotEqualsNegative) {
    auto v = runTs("function f(a, b) {\n    if (a !== b) { return true; }\n}\n");
    EXPECT_FALSE(hasRule(v, "ts-loose-equality"));
}
TEST(TypeScriptRules, ArrowFunctionNotMisreadAsLooseEquality) {
    auto v = runTs("const f = (a, b) => {\n    return a === b;\n};\n");
    EXPECT_FALSE(hasRule(v, "ts-loose-equality"));
}

TEST(TypeScriptRules, LongFunctionPositive) {
    std::string body = "function f() {\n";
    for (int i = 0; i < 105; ++i) body += "g();\n";
    body += "}\n";
    auto v = runTs(body);
    EXPECT_TRUE(hasRule(v, "ts-long-method"));
}
TEST(TypeScriptRules, ShortFunctionNegative) {
    auto v = runTs("function f() { g(); }\n");
    EXPECT_FALSE(hasRule(v, "ts-long-method"));
}

TEST(TypeScriptRules, DeepNestingPositive) {
    std::string body = "function f() {\n";
    for (int i = 0; i < 7; ++i) body += "if (true) {\n";
    body += "g();\n";
    for (int i = 0; i < 7; ++i) body += "}\n";
    body += "}\n";
    auto v = runTs(body);
    EXPECT_TRUE(hasRule(v, "ts-deep-nesting"));
}
TEST(TypeScriptRules, ShallowNestingNegative) {
    auto v = runTs("function f() { if (true) { g(); } }\n");
    EXPECT_FALSE(hasRule(v, "ts-deep-nesting"));
}

TEST(TypeScriptRules, TodoWithoutTicketPositive) {
    auto v = runTs("// TODO fix this\nfunction f() { }\n");
    EXPECT_TRUE(hasRule(v, "ts-todo-without-ticket"));
}
TEST(TypeScriptRules, TodoWithTicketNegative) {
    auto v = runTs("// TODO(PROJ-99): fix this\nfunction f() { }\n");
    EXPECT_FALSE(hasRule(v, "ts-todo-without-ticket"));
}

// ---- JavaScript ----
// 6 rules, not 7: no js-explicit-any counterpart (see JavaScriptRules.h --
// plain JS has no type annotations for such a rule to inspect).

TEST(JavaScriptRules, EmptyCatchBlockWithBindingPositive) {
    auto v = runJs("function f() {\n    try { risky(); } catch (e) { }\n}\n");
    EXPECT_TRUE(hasRule(v, "js-empty-catch-block"));
}
TEST(JavaScriptRules, EmptyCatchBlockNoBindingPositive) {
    auto v = runJs("function f() {\n    try { risky(); } catch { }\n}\n");
    EXPECT_TRUE(hasRule(v, "js-empty-catch-block"));
}
TEST(JavaScriptRules, CatchWithBodyNegative) {
    auto v = runJs("function f() {\n    try { risky(); } catch (e) { handle(e); }\n}\n");
    EXPECT_FALSE(hasRule(v, "js-empty-catch-block"));
}

TEST(JavaScriptRules, VarUsagePositive) {
    auto v = runJs("var x = 1;\n");
    EXPECT_TRUE(hasRule(v, "js-var-usage"));
}
TEST(JavaScriptRules, LetUsageNegative) {
    auto v = runJs("let x = 1;\n");
    EXPECT_FALSE(hasRule(v, "js-var-usage"));
}

TEST(JavaScriptRules, LooseEqualityDoubleEqualsPositive) {
    auto v = runJs("function f(a, b) {\n    if (a == b) { return true; }\n}\n");
    EXPECT_TRUE(hasRule(v, "js-loose-equality"));
}
TEST(JavaScriptRules, LooseEqualityNotEqualsPositive) {
    auto v = runJs("function f(a, b) {\n    if (a != b) { return true; }\n}\n");
    EXPECT_TRUE(hasRule(v, "js-loose-equality"));
}
TEST(JavaScriptRules, StrictEqualityNegative) {
    auto v = runJs("function f(a, b) {\n    if (a === b) { return true; }\n}\n");
    EXPECT_FALSE(hasRule(v, "js-loose-equality"));
}
TEST(JavaScriptRules, StrictNotEqualsNegative) {
    auto v = runJs("function f(a, b) {\n    if (a !== b) { return true; }\n}\n");
    EXPECT_FALSE(hasRule(v, "js-loose-equality"));
}
TEST(JavaScriptRules, ArrowFunctionNotMisreadAsLooseEquality) {
    auto v = runJs("const f = (a, b) => {\n    return a === b;\n};\n");
    EXPECT_FALSE(hasRule(v, "js-loose-equality"));
}

TEST(JavaScriptRules, LongFunctionPositive) {
    std::string body = "function f() {\n";
    for (int i = 0; i < 105; ++i) body += "g();\n";
    body += "}\n";
    auto v = runJs(body);
    EXPECT_TRUE(hasRule(v, "js-long-method"));
}
TEST(JavaScriptRules, ShortFunctionNegative) {
    auto v = runJs("function f() { g(); }\n");
    EXPECT_FALSE(hasRule(v, "js-long-method"));
}

TEST(JavaScriptRules, DeepNestingPositive) {
    std::string body = "function f() {\n";
    for (int i = 0; i < 7; ++i) body += "if (true) {\n";
    body += "g();\n";
    for (int i = 0; i < 7; ++i) body += "}\n";
    body += "}\n";
    auto v = runJs(body);
    EXPECT_TRUE(hasRule(v, "js-deep-nesting"));
}
TEST(JavaScriptRules, ShallowNestingNegative) {
    auto v = runJs("function f() { if (true) { g(); } }\n");
    EXPECT_FALSE(hasRule(v, "js-deep-nesting"));
}

TEST(JavaScriptRules, TodoWithoutTicketPositive) {
    auto v = runJs("// TODO fix this\nfunction f() { }\n");
    EXPECT_TRUE(hasRule(v, "js-todo-without-ticket"));
}
TEST(JavaScriptRules, TodoWithTicketNegative) {
    auto v = runJs("// TODO(PROJ-99): fix this\nfunction f() { }\n");
    EXPECT_FALSE(hasRule(v, "js-todo-without-ticket"));
}

// ---- RuleDispatch ----
 
TEST(RuleDispatch, RoutesToCppCatalog) {
    const std::string src = "new int(1);\n";
    CppLexer lexer(src);
    auto tokens = lexer.tokenize();
    CppParser parser(tokens, 1);
    auto fm = parser.analyze();
    auto v = checkRules(Language::Cpp, "f.cpp", tokens, fm);
    ASSERT_FALSE(v.empty());
    EXPECT_EQ(v[0].language, "cpp");
}
TEST(RuleDispatch, RoutesToPythonCatalog) {
    const std::string src = "from os import *\n";
    PythonLexer lexer(src);
    auto tokens = lexer.tokenize();
    PythonParser parser(tokens, 2);
    auto fm = parser.analyze();
    auto v = checkRules(Language::Python, "f.py", tokens, fm);
    ASSERT_FALSE(v.empty());
    EXPECT_EQ(v[0].language, "python");
}
TEST(RuleDispatch, RoutesToJavaCatalog) {
    const std::string src = "class X { public int c; }\n";
    JavaLexer lexer(src);
    auto tokens = lexer.tokenize();
    JavaParser parser(tokens, 1);
    auto fm = parser.analyze();
    auto v = checkRules(Language::Java, "F.java", tokens, fm);
    ASSERT_FALSE(v.empty());
    EXPECT_EQ(v[0].language, "java");
}
TEST(RuleDispatch, RoutesToTypeScriptCatalog) {
    const std::string src = "var x = 1;\n";
    TypeScriptLexer lexer(src);
    auto tokens = lexer.tokenize();
    TypeScriptParser parser(tokens, 1);
    auto fm = parser.analyze();
    auto v = checkRules(Language::TypeScript, "f.ts", tokens, fm);
    ASSERT_FALSE(v.empty());
    EXPECT_EQ(v[0].language, "typescript");
}
TEST(RuleDispatch, RoutesToJavaScriptCatalog) {
    const std::string src = "var x = 1;\n";
    JavaScriptLexer lexer(src);
    auto tokens = lexer.tokenize();
    JavaScriptParser parser(tokens, 1);
    auto fm = parser.analyze();
    auto v = checkRules(Language::JavaScript, "f.js", tokens, fm);
    ASSERT_FALSE(v.empty());
    EXPECT_EQ(v[0].language, "javascript");
}
  
 
// ---- End-to-end sanity ----
 
TEST(RulesEndToEnd, MixedFileFiresMultipleDistinctRules) {
    auto v = runCpp(
        "// TODO fix\n"
        "using namespace std;\n"
        "int* p = new int(5);\n"
        "void f(int x) { if (x < 42) { try { g(); } catch (...) {} } }\n",
        "widget.h");
    EXPECT_TRUE(hasRule(v, "cpp-todo-without-ticket"));
    EXPECT_TRUE(hasRule(v, "cpp-using-namespace-std-header"));
    EXPECT_TRUE(hasRule(v, "cpp-raw-new-delete"));
    EXPECT_TRUE(hasRule(v, "cpp-magic-number-literal"));
    EXPECT_TRUE(hasRule(v, "cpp-catch-all-ellipsis"));
}
