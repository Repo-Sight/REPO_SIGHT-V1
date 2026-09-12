// Unit tests for JavaScriptParser -- the Phase 2a front-end's structural
// analyzer (JS is second of three: TS -> JS -> C#). Mirrors
// test_typescript_parser.cpp's structure/conventions, one TEST() per
// behavior, GoogleTest. Cases exercising TS-only syntax (return-type
// annotations, interface/enum/namespace declarations, generic type
// arguments, optional-parameter markers) are replaced with JS-shaped
// equivalents -- see JavaScriptParser.h's header comment for exactly
// what's stripped and why.

#include "parser/JavaScriptParser.h"
#include "lexer/JavaScriptLexer.h"

#include <gtest/gtest.h>

using namespace cma;

namespace {
FileMetrics analyze(const std::string& src) {
    JavaScriptLexer lexer(src);
    auto tokens = lexer.tokenize();
    int lineCount = 1;
    for (char c : src) if (c == '\n') ++lineCount;
    JavaScriptParser parser(tokens, lineCount);
    return parser.analyze();
}
} // namespace

// ---- Functions: named declarations ----

TEST(JavaScriptParser, DetectsNamedFunctionDeclaration) {
    auto fm = analyze("function foo() {\n    return 1;\n}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "foo");
}

TEST(JavaScriptParser, DetectsMultipleSiblingFunctions) {
    auto fm = analyze("function a() { }\nfunction b() { }\nfunction c() { }\n");
    EXPECT_EQ(fm.functionCount(), 3);
}

TEST(JavaScriptParser, FunctionCallIsNotMisdetectedAsDeclaration) {
    auto fm = analyze("function f() {\n    console.log(\"hi\");\n}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "f");
}

TEST(JavaScriptParser, MethodInsideClassIsDetected) {
    auto fm = analyze("class X {\n    greet() {\n        return 1;\n    }\n}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "greet");
}

TEST(JavaScriptParser, FunctionBraceOnNextLineStillDetected) {
    // Exercises the simplified skipTrailingSpecifiers(): unlike
    // TypeScriptParser, there's no return-type annotation to skip over,
    // just NEWLINE tokens between ')' and '{' (Allman brace style).
    auto fm = analyze("function foo()\n{\n    return 1;\n}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "foo");
}

TEST(JavaScriptParser, ConstructorIsDetected) {
    auto fm = analyze("class Point {\n    constructor(x, y) {\n        return;\n    }\n}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "constructor");
}

TEST(JavaScriptParser, DeclarationWithoutBodyIsNotCounted) {
    // Not valid JS grammar (no ambient/overload declarations), but
    // exercises the same "no body -> not a function" bail-out
    // TypeScriptParser relies on for its (valid-in-TS) 'declare'
    // signatures -- confirms malformed input degrades gracefully rather
    // than miscounting.
    auto fm = analyze("function greet(name);\n");
    EXPECT_EQ(fm.functionCount(), 0);
}

// ---- Functions: arrow and anonymous ----

TEST(JavaScriptParser, ArrowFunctionAssignedToConstBorrowsThatName) {
    auto fm = analyze("const foo = (x) => {\n    return x;\n};\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "foo");
}

TEST(JavaScriptParser, ArrowFunctionAsCallbackIsAnonymous) {
    auto fm = analyze(
        "array.forEach((item) => {\n"
        "  process(item);\n"
        "});\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "<anonymous>");
}

TEST(JavaScriptParser, ExpressionBodiedArrowIsNotCounted) {
    // Documented scope limit: no brace body means no endLine to track.
    auto fm = analyze("const double = x => x * 2;\n");
    EXPECT_EQ(fm.functionCount(), 0);
}

TEST(JavaScriptParser, AnonymousFunctionExpressionIsDetected) {
    auto fm = analyze("setTimeout(function () {\n    tick();\n}, 100);\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "<anonymous>");
}

TEST(JavaScriptParser, NamedFunctionExpressionAssignedToConstBorrowsName) {
    auto fm = analyze("const handler = function (req, res) {\n    ok();\n};\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "handler");
}

TEST(JavaScriptParser, FunctionOpenAtEofIsClosed) {
    auto fm = analyze("function f() {\n    return 1;\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_GT(fm.functions[0].endLine, 0);
}

// ---- Classes ----

TEST(JavaScriptParser, DetectsClass) {
    auto fm = analyze("class Foo { }\n");
    ASSERT_EQ(fm.classCount(), 1);
    EXPECT_EQ(fm.classes[0].name, "Foo");
    EXPECT_EQ(fm.classes[0].kind, ClassInfo::Kind::CLASS);
}

TEST(JavaScriptParser, ExtendsSubclassStillDetectsClassName) {
    auto fm = analyze("class Dog extends Animal { }\n");
    ASSERT_EQ(fm.classCount(), 1);
    EXPECT_EQ(fm.classes[0].name, "Dog");
}

TEST(JavaScriptParser, InterfaceEnumNamespaceAreOrdinaryIdentifiersNotClassKeywords) {
    // The deliberate difference from TypeScriptParser: interface/enum/
    // namespace aren't in JavaScriptLexer's keyword set (see its header
    // comment), so they never reach handleKeyword()'s 'class' branch --
    // no ClassInfo is ever recorded for them on real JS source.
    auto fm = analyze("interface Foo { }\nenum Color { }\nnamespace Utils { }\n");
    EXPECT_EQ(fm.classCount(), 0);
}

// ---- Complexity: keywords, logical operators, ternary, ?./?? ----

TEST(JavaScriptParser, ElseIfCountsAsIndependentDecisionPoint) {
    auto fm = analyze(
        "function f(x) {\n"
        "    if (x === 1) { return 1; }\n"
        "    else if (x === 2) { return 2; }\n"
        "    else { return 3; }\n"
        "}\n");
    EXPECT_EQ(fm.conditionCount, 2);
    EXPECT_EQ(fm.cyclomaticComplexity, 3);
}

TEST(JavaScriptParser, ForWhileDoAllCountAsLoops) {
    auto fm = analyze(
        "function f() {\n"
        "    for (let i = 0; i < 3; i++) { }\n"
        "    while (true) { break; }\n"
        "    do { } while (false);\n"
        "}\n");
    EXPECT_EQ(fm.loopCount, 4);
}

TEST(JavaScriptParser, LogicalAndOrDetectedViaTwoTokenTrick) {
    auto fm = analyze(
        "function f(a, b) {\n"
        "    if (a && b || !a) { return true; }\n"
        "    return false;\n"
        "}\n");
    EXPECT_EQ(fm.cyclomaticComplexity, 4);
}

TEST(JavaScriptParser, TernaryAddsComplexity) {
    auto fm = analyze("function f(a, b) {\n    return a > b ? a : b;\n}\n");
    EXPECT_EQ(fm.cyclomaticComplexity, 2);
}

TEST(JavaScriptParser, OptionalChainingDoesNotAddComplexity) {
    auto fm = analyze("function f(a) {\n    return a?.b?.c;\n}\n");
    EXPECT_EQ(fm.cyclomaticComplexity, 1);
}

TEST(JavaScriptParser, NullishCoalescingAddsComplexity) {
    auto fm = analyze("function f(a, b) {\n    return a ?? b;\n}\n");
    EXPECT_EQ(fm.cyclomaticComplexity, 2);
}

TEST(JavaScriptParser, TryCatchFinally) {
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

TEST(JavaScriptParser, SwitchCaseLikeJava) {
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

TEST(JavaScriptParser, ConstDeclarationCounts) {
    auto fm = analyze("function f() {\n    const x = 1;\n}\n");
    EXPECT_EQ(fm.variableCount, 1);
}

TEST(JavaScriptParser, LetDeclarationCounts) {
    auto fm = analyze("function f() {\n    let x = 1;\n}\n");
    EXPECT_EQ(fm.variableCount, 1);
}

TEST(JavaScriptParser, VarDeclarationCounts) {
    auto fm = analyze("function f() {\n    var x = 1;\n}\n");
    EXPECT_EQ(fm.variableCount, 1);
}

TEST(JavaScriptParser, FunctionParametersCount) {
    auto fm = analyze("function f(a, b) {\n    return a;\n}\n");
    EXPECT_EQ(fm.variableCount, 2);
}

TEST(JavaScriptParser, FunctionNameItselfIsNotCountedAsVariable) {
    auto fm = analyze("function compute() {\n    return 0;\n}\n");
    EXPECT_EQ(fm.variableCount, 0);
}

TEST(JavaScriptParser, ArrayDefaultValueCommaDoesNotSplitParameterCount) {
    // No generic-type-argument syntax in JS (see countParameters()'s
    // header comment) -- this is the JS-shaped equivalent check that a
    // bracket-nested comma in a default value isn't mistaken for a new
    // parameter boundary.
    auto fm = analyze("function f(a, b = [1, 2, 3]) {\n    return a;\n}\n");
    EXPECT_EQ(fm.variableCount, 2);
}

// ---- Comments / TODOs / imports ----

TEST(JavaScriptParser, LineCommentIsCounted) {
    auto fm = analyze("// just a comment\n");
    EXPECT_EQ(fm.commentLines, 1);
    EXPECT_EQ(fm.codeLines, 0);
}

TEST(JavaScriptParser, TodoAndFixmeCountedInComments) {
    auto fm = analyze("// TODO: fix this\n// FIXME: also this\n");
    EXPECT_EQ(fm.todoCount, 2);
}

TEST(JavaScriptParser, TemplateLiteralSpansCountAsCode) {
    auto fm = analyze("const s = `\n    a\n    b\n`;\n");
    EXPECT_EQ(fm.commentLines, 0);
}

TEST(JavaScriptParser, NamedImportCountsOnceWithModuleTarget) {
    auto fm = analyze("import { readFile } from 'fs';\n");
    ASSERT_EQ(fm.includeCount, 1);
    EXPECT_EQ(fm.includeTargets[0], "fs");
}

TEST(JavaScriptParser, MultipleImportStatementsEachCount) {
    auto fm = analyze(
        "import { A } from 'a';\n"
        "import * as B from 'b';\n"
        "import 'c';\n");
    EXPECT_EQ(fm.includeCount, 3);
}

// ---- Nesting depth ----

TEST(JavaScriptParser, MaxNestingDepthTracksBraceDepth) {
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

TEST(JavaScriptParser, EmptyClassHasDepthOne) {
    auto fm = analyze("class X { }\n");
    EXPECT_EQ(fm.maxNestingDepth, 1); 
}

TEST(JavaScriptParser, CallbackBodyIncreasesDepthLikeAnyBlock) {
    // Documents the Phase 2a decision: brace-depth-based nesting
    // tracking is not type-annotation-specific, so it transfers
    // unchanged from TypeScriptParser -- a callback's '{' is just
    // another block, no JS-specific handling needed.
    auto fm = analyze(
        "function f() {\n"
        "    items.forEach((item) => {\n"
        "        if (item.ok) {\n"
        "            process(item);\n"
        "        }\n"
        "    });\n"
        "}\n");
    EXPECT_EQ(fm.maxNestingDepth, 3);
}

TEST(JavaScriptParser, BraceBlockAnalyzerNeverGoesNegativeOnUnbalancedInput) {
    auto fm = analyze("} } } class X { \n");
    EXPECT_GE(fm.maxNestingDepth, 0);
}
