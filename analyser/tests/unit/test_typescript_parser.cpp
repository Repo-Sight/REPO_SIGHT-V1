// Unit tests for TypeScriptParser -- the Phase 2a front-end's structural
// analyzer. Mirrors test_java_parser.cpp's structure/conventions, one
// TEST() per behavior, GoogleTest.

#include "parser/TypeScriptParser.h"
#include "lexer/TypeScriptLexer.h"

#include <gtest/gtest.h>

using namespace cma;

namespace {
FileMetrics analyze(const std::string& src) {
    TypeScriptLexer lexer(src);
    auto tokens = lexer.tokenize();
    int lineCount = 1;
    for (char c : src) if (c == '\n') ++lineCount;
    TypeScriptParser parser(tokens, lineCount);
    return parser.analyze();
}
} // namespace

// ---- Functions: named declarations ----

TEST(TypeScriptParser, DetectsNamedFunctionDeclaration) {
    auto fm = analyze("function foo() {\n    return 1;\n}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "foo");
}

TEST(TypeScriptParser, DetectsMultipleSiblingFunctions) {
    auto fm = analyze("function a() { }\nfunction b() { }\nfunction c() { }\n");
    EXPECT_EQ(fm.functionCount(), 3);
}

TEST(TypeScriptParser, FunctionCallIsNotMisdetectedAsDeclaration) {
    auto fm = analyze("function f() {\n    console.log(\"hi\");\n}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "f");
}

TEST(TypeScriptParser, MethodInsideClassIsDetected) {
    auto fm = analyze("class X {\n    greet() {\n        return 1;\n    }\n}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "greet");
}

TEST(TypeScriptParser, MethodWithReturnTypeAnnotationStillDetected) {
    auto fm = analyze("class X {\n    greet(): string {\n        return \"hi\";\n    }\n}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "greet");
}

TEST(TypeScriptParser, FunctionTypeReturnAnnotationStillLocatesBody) {
    auto fm = analyze(
        "function make(): (x: number) => void {\n"
        "    return null;\n"
        "}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "make");
}

TEST(TypeScriptParser, ConstructorIsDetected) {
    auto fm = analyze("class Point {\n    constructor(x, y) {\n        return;\n    }\n}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "constructor");
}

TEST(TypeScriptParser, OverloadSignatureWithoutBodyIsNotCounted) {
    auto fm = analyze("declare function greet(name: string): void;\n");
    EXPECT_EQ(fm.functionCount(), 0);
}

// ---- Functions: arrow and anonymous ----

TEST(TypeScriptParser, ArrowFunctionAssignedToConstBorrowsThatName) {
    auto fm = analyze("const foo = (x) => {\n    return x;\n};\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "foo");
}

TEST(TypeScriptParser, ArrowFunctionAsCallbackIsAnonymous) {
    auto fm = analyze(
        "array.forEach((item) => {\n"
        "  process(item);\n"
        "});\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "<anonymous>");
}

TEST(TypeScriptParser, ExpressionBodiedArrowIsNotCounted) {
    // Documented scope limit: no brace body means no endLine to track.
    auto fm = analyze("const double = x => x * 2;\n");
    EXPECT_EQ(fm.functionCount(), 0);
}

TEST(TypeScriptParser, AnonymousFunctionExpressionIsDetected) {
    auto fm = analyze("setTimeout(function () {\n    tick();\n}, 100);\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "<anonymous>");
}

TEST(TypeScriptParser, NamedFunctionExpressionAssignedToConstBorrowsName) {
    auto fm = analyze("const handler = function (req, res) {\n    ok();\n};\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "handler");
}

TEST(TypeScriptParser, FunctionOpenAtEofIsClosed) {
    auto fm = analyze("function f() {\n    return 1;\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_GT(fm.functions[0].endLine, 0);
}

// ---- Classes / interfaces / enums / namespaces ----

TEST(TypeScriptParser, DetectsClass) {
    auto fm = analyze("class Foo { }\n");
    ASSERT_EQ(fm.classCount(), 1);
    EXPECT_EQ(fm.classes[0].name, "Foo");
    EXPECT_EQ(fm.classes[0].kind, ClassInfo::Kind::CLASS);
}

TEST(TypeScriptParser, InterfaceMapsToClassKind) {
    auto fm = analyze("interface Foo { }\n");
    ASSERT_EQ(fm.classCount(), 1);
    EXPECT_EQ(fm.classes[0].kind, ClassInfo::Kind::CLASS);
}

TEST(TypeScriptParser, EnumMapsToEnumKind) {
    auto fm = analyze("enum Color { Red, Green, Blue }\n");
    ASSERT_EQ(fm.classCount(), 1);
    EXPECT_EQ(fm.classes[0].kind, ClassInfo::Kind::ENUM);
}

TEST(TypeScriptParser, NamespaceMapsToNamespaceKind) {
    auto fm = analyze("namespace Utils { }\n");
    ASSERT_EQ(fm.classCount(), 1);
    EXPECT_EQ(fm.classes[0].kind, ClassInfo::Kind::NAMESPACE);
}

// ---- Complexity: keywords, logical operators, ternary, ?./??:/?? ----

TEST(TypeScriptParser, ElseIfCountsAsIndependentDecisionPoint) {
    auto fm = analyze(
        "function f(x) {\n"
        "    if (x === 1) { return 1; }\n"
        "    else if (x === 2) { return 2; }\n"
        "    else { return 3; }\n"
        "}\n");
    EXPECT_EQ(fm.conditionCount, 2);
    EXPECT_EQ(fm.cyclomaticComplexity, 3);
}

TEST(TypeScriptParser, ForWhileDoAllCountAsLoops) {
    auto fm = analyze(
        "function f() {\n"
        "    for (let i = 0; i < 3; i++) { }\n"
        "    while (true) { break; }\n"
        "    do { } while (false);\n"
        "}\n");
    EXPECT_EQ(fm.loopCount, 4);
}

TEST(TypeScriptParser, LogicalAndOrDetectedViaTwoTokenTrick) {
    auto fm = analyze(
        "function f(a, b) {\n"
        "    if (a && b || !a) { return true; }\n"
        "    return false;\n"
        "}\n");
    EXPECT_EQ(fm.cyclomaticComplexity, 4);
}

TEST(TypeScriptParser, TernaryAddsComplexity) {
    auto fm = analyze("function f(a, b) {\n    return a > b ? a : b;\n}\n");
    EXPECT_EQ(fm.cyclomaticComplexity, 2);
}

TEST(TypeScriptParser, OptionalChainingDoesNotAddComplexity) {
    auto fm = analyze("function f(a) {\n    return a?.b?.c;\n}\n");
    EXPECT_EQ(fm.cyclomaticComplexity, 1);
}

TEST(TypeScriptParser, NullishCoalescingAddsComplexity) {
    auto fm = analyze("function f(a, b) {\n    return a ?? b;\n}\n");
    EXPECT_EQ(fm.cyclomaticComplexity, 2);
}

TEST(TypeScriptParser, OptionalParameterMarkerDoesNotAddComplexity) {
    auto fm = analyze("function f(a?: number) {\n    return a;\n}\n");
    EXPECT_EQ(fm.cyclomaticComplexity, 1);
}

TEST(TypeScriptParser, TryCatchFinally) {
    auto fm = analyze(
        "function f() {\n"
        "    try {\n"
        "        risky();\n"
        "    } catch (e) {\n"
        "        handle();\n"
        "    } finally {\n"
        "        cleanup();\n"
        "    }\n"
        "}\n");
    EXPECT_EQ(fm.tryCatchCount, 1);
    EXPECT_EQ(fm.cyclomaticComplexity, 2);
}

TEST(TypeScriptParser, SwitchCaseLikeJava) {
    auto fm = analyze(
        "function f(code) {\n"
        "    switch (code) {\n"
        "        case 1:\n"
        "            return \"one\";\n"
        "        case 2:\n"
        "            return \"two\";\n"
        "        default:\n"
        "            return \"other\";\n"
        "    }\n"
        "}\n");
    EXPECT_EQ(fm.conditionCount, 1);
    EXPECT_EQ(fm.cyclomaticComplexity, 4);
}

// ---- Variables: let/const/var, parameters ----

TEST(TypeScriptParser, ConstDeclarationCounts) {
    auto fm = analyze("function f() {\n    const x = 1;\n}\n");
    EXPECT_EQ(fm.variableCount, 1);
}

TEST(TypeScriptParser, LetDeclarationCounts) {
    auto fm = analyze("function f() {\n    let x = 1;\n}\n");
    EXPECT_EQ(fm.variableCount, 1);
}

TEST(TypeScriptParser, VarDeclarationCounts) {
    auto fm = analyze("function f() {\n    var x = 1;\n}\n");
    EXPECT_EQ(fm.variableCount, 1);
}

TEST(TypeScriptParser, FunctionParametersCount) {
    auto fm = analyze("function f(a: number, b: string) {\n    return a;\n}\n");
    EXPECT_EQ(fm.variableCount, 2);
}

TEST(TypeScriptParser, FunctionNameItselfIsNotCountedAsVariable) {
    auto fm = analyze("function compute() {\n    return 0;\n}\n");
    EXPECT_EQ(fm.variableCount, 0);
}

TEST(TypeScriptParser, GenericParameterTypeCommaDoesNotSplitParameterCount) {
    // Map<string, number> must not be mistaken for a parameter boundary.
    auto fm = analyze("function f(m: Map<string, number>) {\n    return m;\n}\n");
    EXPECT_EQ(fm.variableCount, 1);
}

// ---- Comments / TODOs / imports ----

TEST(TypeScriptParser, LineCommentIsCounted) {
    auto fm = analyze("// just a comment\n");
    EXPECT_EQ(fm.commentLines, 1);
    EXPECT_EQ(fm.codeLines, 0);
}

TEST(TypeScriptParser, TodoAndFixmeCountedInComments) {
    auto fm = analyze("// TODO: fix this\n// FIXME: also this\n");
    EXPECT_EQ(fm.todoCount, 2);
}

TEST(TypeScriptParser, TemplateLiteralSpansCountAsCode) {
    auto fm = analyze("const s = `\n    a\n    b\n`;\n");
    EXPECT_EQ(fm.commentLines, 0);
}

TEST(TypeScriptParser, NamedImportCountsOnceWithModuleTarget) {
    auto fm = analyze("import { readFile } from 'fs';\n");
    ASSERT_EQ(fm.includeCount, 1);
    EXPECT_EQ(fm.includeTargets[0], "fs");
}

TEST(TypeScriptParser, MultipleImportStatementsEachCount) {
    auto fm = analyze(
        "import { A } from 'a';\n"
        "import * as B from 'b';\n"
        "import 'c';\n");
    EXPECT_EQ(fm.includeCount, 3);
}

// ---- Nesting depth ----

TEST(TypeScriptParser, MaxNestingDepthTracksBraceDepth) {
    auto fm = analyze(
        "function f() {\n"
        "    if (true) {\n"
        "        if (true) {\n"
        "            return;\n"
        "        }\n"
        "    }\n"
        "}\n");
    EXPECT_EQ(fm.maxNestingDepth, 3);
}

TEST(TypeScriptParser, EmptyClassHasDepthOne) {
    auto fm = analyze("class X { }\n");
    EXPECT_EQ(fm.maxNestingDepth, 1);
}

TEST(TypeScriptParser, BraceBlockAnalyzerNeverGoesNegativeOnUnbalancedInput) {
    auto fm = analyze("} } } class X { \n");
    EXPECT_GE(fm.maxNestingDepth, 0);
}
 
