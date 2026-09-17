// Unit tests for CSharpParser -- Phase 2a's #3 of 3 front-end,
// completing the phase. Mirrors test_typescript_parser.cpp's structure.

#include "lexer/CSharpLexer.h"
#include "parser/CSharpParser.h"

#include <gtest/gtest.h>

using namespace cma;

namespace {
FileMetrics parse(const std::string& src) {
    CSharpLexer lexer(src);
    auto tokens = lexer.tokenize();

    int totalLines = 1;
    for (char c : src) if (c == '\n') ++totalLines;

    CSharpParser parser(tokens, totalLines);
    return parser.analyze();
}
} // namespace

TEST(CSharpParser, DetectsOrdinaryMethod) {
    auto fm = parse(
        "public class Calculator {\n"
        "    public int Add(int a, int b) {\n"
        "        return a + b;\n"
        "    }\n"
        "}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "Add");
    EXPECT_EQ(fm.functions[0].startLine, 2);
    EXPECT_EQ(fm.functions[0].endLine, 4);
}

TEST(CSharpParser, GenericMethodNameFollowedByAngleBracketsIsDetected) {
    // C# puts <T> *after* the method name, unlike Java -- the one real
    // shape difference trySkipGenericArgsToParen() exists for.
    auto fm = parse(
        "public class Box {\n"
        "    public T Max<T>(T a, T b) where T : System.IComparable<T> {\n"
        "        return a;\n"
        "    }\n"
        "}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "Max");
}

TEST(CSharpParser, WhereConstraintClauseDoesNotBlockBodyDetection) {
    // Without the 'where'-clause skip in skipTrailingSpecifiers(), the
    // body's '{' would never be found immediately after the parameter
    // list's ')', and the method above would silently not be counted.
    auto fm = parse(
        "class C {\n"
        "    void M<T>() where T : new() {\n"
        "        var x = new T();\n"
        "    }\n"
        "}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "M");
}

TEST(CSharpParser, ComparisonChainIsNotMisdetectedAsGenericMethod) {
    auto fm = parse("void M() { bool r = (x < y) > z; }\n");
    // Only M itself should be detected -- the comparison chain must not
    // spuriously register 'x' (or anything else) as a function.
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "M");
}

TEST(CSharpParser, GenericMethodCallIsNotMisdetectedAsDeclaration) {
    auto fm = parse(
        "void M() {\n"
        "    var list = Foo.Bar<int>(5);\n"
        "}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "M");
}

TEST(CSharpParser, RecordPrimaryConstructorIsNotMisdetectedAsFunction) {
    auto fm = parse("public record Point(int X, int Y);\n");
    EXPECT_EQ(fm.functionCount(), 0);
    ASSERT_EQ(fm.classCount(), 1);
    EXPECT_EQ(fm.classes[0].name, "Point");
    EXPECT_EQ(fm.classes[0].kind, ClassInfo::Kind::STRUCT);
}

TEST(CSharpParser, RecordStructTwoKeywordFormFindsCorrectName) {
    auto fm = parse("public record struct Point(int X, int Y);\n");
    ASSERT_EQ(fm.classCount(), 1);
    EXPECT_EQ(fm.classes[0].name, "Point");
    EXPECT_EQ(fm.classes[0].kind, ClassInfo::Kind::STRUCT);
}

TEST(CSharpParser, PrimaryConstructorClassIsNotMisdetectedAsFunction) {
    auto fm = parse("class Box(int value) {\n}\n");
    EXPECT_EQ(fm.functionCount(), 0);
    ASSERT_EQ(fm.classCount(), 1);
    EXPECT_EQ(fm.classes[0].name, "Box");
    EXPECT_EQ(fm.classes[0].kind, ClassInfo::Kind::CLASS);
}

TEST(CSharpParser, ClassStructInterfaceEnumKindsMapCorrectly) {
    auto fm = parse(
        "class A {}\n"
        "struct B {}\n"
        "interface C {}\n"
        "enum D {}\n");
    ASSERT_EQ(fm.classCount(), 4);
    EXPECT_EQ(fm.classes[0].kind, ClassInfo::Kind::CLASS);
    EXPECT_EQ(fm.classes[1].kind, ClassInfo::Kind::STRUCT);
    EXPECT_EQ(fm.classes[2].kind, ClassInfo::Kind::CLASS);
    EXPECT_EQ(fm.classes[3].kind, ClassInfo::Kind::ENUM);
}

TEST(CSharpParser, FileScopedNamespaceIsRecordedWithoutBraces) {
    auto fm = parse("namespace Foo.Bar;\n\nclass C {}\n");
    ASSERT_GE(fm.classCount(), 2);
    EXPECT_EQ(fm.classes[0].kind, ClassInfo::Kind::NAMESPACE);
    EXPECT_EQ(fm.classes[0].name, "Foo");
}

TEST(CSharpParser, BlockLambdaAssignedToNameIsCountedUnderThatName) {
    auto fm = parse(
        "void M() {\n"
        "    Func<int,int> square = x => {\n"
        "        return x * x;\n"
        "    };\n"
        "}\n");
    ASSERT_EQ(fm.functionCount(), 2); // M, and the lambda named 'square'
    bool sawSquare = false;
    for (const auto& f : fm.functions) if (f.name == "square") sawSquare = true;
    EXPECT_TRUE(sawSquare);
}

TEST(CSharpParser, ExpressionBodiedLambdaIsNotCounted) {
    auto fm = parse("void M() { Func<int,int> sq = x => x * x; }\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "M");
}

TEST(CSharpParser, LinqCallWithLambdaIsNotMisdetectedAsDeclaration) {
    auto fm = parse(
        "void M() {\n"
        "    var evens = numbers.Where(x => x > 0).ToList();\n"
        "}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "M");
}

TEST(CSharpParser, UsingDirectiveIsCountedAsImport) {
    auto fm = parse("using System;\nusing System.Collections.Generic;\n");
    EXPECT_EQ(fm.includeCount, 2);
    ASSERT_EQ(fm.includeTargets.size(), 2u);
    EXPECT_EQ(fm.includeTargets[0], "System");
    EXPECT_EQ(fm.includeTargets[1], "System.Collections.Generic");
}

TEST(CSharpParser, UsingStaticDirectiveTargetSkipsStaticKeyword) {
    auto fm = parse("using static System.Math;\n");
    ASSERT_EQ(fm.includeTargets.size(), 1u);
    EXPECT_EQ(fm.includeTargets[0], "System.Math");
}

TEST(CSharpParser, UsingAliasDirectiveTargetIsAfterEquals) {
    auto fm = parse("using Alias = System.Text.StringBuilder;\n");
    ASSERT_EQ(fm.includeTargets.size(), 1u);
    EXPECT_EQ(fm.includeTargets[0], "System.Text.StringBuilder");
}

TEST(CSharpParser, UsingResourceStatementIsNotCountedAsImport) {
    auto fm = parse("void M() { using (var f = Open()) { } }\n");
    EXPECT_EQ(fm.includeCount, 0);
}

TEST(CSharpParser, UsingDeclarationIsNotCountedAsImport) {
    auto fm = parse("void M() { using var f = Open(); }\n");
    EXPECT_EQ(fm.includeCount, 0);
}

TEST(CSharpParser, LoopKeywordsIncrementLoopCount) {
    auto fm = parse(
        "void M() {\n"
        "    for (int i = 0; i < 10; i++) {}\n"
        "    while (true) {}\n"
        "    do {} while (true);\n"
        "    foreach (var x in xs) {}\n"
        "}\n");
    // 5, not 4: do-while's trailing 'while' triggers its own +1 on top
    // of 'do''s, exactly like JavaParser/TypeScriptParser/
    // JavaScriptParser already do for the same construct -- consistent
    // cross-language counting methodology, not a C#-specific quirk.
    EXPECT_EQ(fm.loopCount, 5);
}

TEST(CSharpParser, IfAndSwitchIncrementConditionCount) {
    auto fm = parse(
        "void M() {\n"
        "    if (a) {}\n"
        "    switch (a) { case 1: break; }\n"
        "}\n");
    EXPECT_EQ(fm.conditionCount, 2);
}

TEST(CSharpParser, TryCatchIncrementsTryCatchCount) {
    auto fm = parse("void M() { try {} catch (Exception e) {} }\n");
    EXPECT_EQ(fm.tryCatchCount, 1);
}

TEST(CSharpParser, SwitchCaseGuardWhenAddsComplexity) {
    auto withGuard = parse(
        "void M(object o) {\n"
        "    switch (o) {\n"
        "        case int n when n > 0: break;\n"
        "        default: break;\n"
        "    }\n"
        "}\n");
    auto withoutGuard = parse(
        "void M(object o) {\n"
        "    switch (o) {\n"
        "        case int n: break;\n"
        "        default: break;\n"
        "    }\n"
        "}\n");
    EXPECT_GT(withGuard.cyclomaticComplexity, withoutGuard.cyclomaticComplexity);
}

TEST(CSharpParser, NullableValueTypeMarkerIsNotCountedAsTernary) {
    auto fm = parse("void M() { int? x = null; bool? y = null; }\n");
    EXPECT_EQ(fm.cyclomaticComplexity, 1); // baseline only, no ternary miscounted
}

TEST(CSharpParser, TernaryIsCountedAsComplexity) {
    auto before = parse("void M() {}\n");
    auto after  = parse("void M() { var r = flag ? a : b; }\n");
    EXPECT_EQ(after.cyclomaticComplexity, before.cyclomaticComplexity + 1);
}

TEST(CSharpParser, NullConditionalAccessIsNotCountedAsComplexity) {
    auto fm = parse("void M() { var n = obj?.Name; var v = arr?[0]; }\n");
    EXPECT_EQ(fm.cyclomaticComplexity, 1);
}

TEST(CSharpParser, NullCoalescingIsCountedAsComplexity) {
    auto before = parse("void M() {}\n");
    auto after  = parse("void M() { var n = a ?? b; }\n");
    EXPECT_EQ(after.cyclomaticComplexity, before.cyclomaticComplexity + 1);
}

TEST(CSharpParser, LogicalAndOrAreSingleComplexityIncrementEach) {
    auto fm = parse("void M() { if (a && b || c) {} }\n");
    // baseline(1) + if(1) + &&(1) + ||(1)
    EXPECT_EQ(fm.cyclomaticComplexity, 4);
}

TEST(CSharpParser, PublicFieldCountedAsVariable) {
    auto fm = parse("class C { public int Count; }\n");
    EXPECT_EQ(fm.variableCount, 1);
}

TEST(CSharpParser, VarDeclarationCountedAsVariable) {
    auto fm = parse("void M() { var x = 1; }\n");
    EXPECT_EQ(fm.variableCount, 1);
}

TEST(CSharpParser, ConstFieldIsExcludedFromComplexityUnaffectedButStillAVariable) {
    // const isn't a rules concern here (that's csharp-public-field's
    // job) -- the parser's own variableCount just counts declarations
    // regardless of modifiers, mirroring Java's equivalent behavior.
    auto fm = parse("class C { public const int Max = 10; }\n");
    EXPECT_EQ(fm.variableCount, 1);
}

TEST(CSharpParser, NestingDepthTracksBraces) {
    auto fm = parse(
        "void M() {\n"
        "    if (a) {\n"
        "        if (b) {\n"
        "            if (c) {}\n"
        "        }\n"
        "    }\n"
        "}\n");
    EXPECT_EQ(fm.maxNestingDepth, 4); // M's body + 3 nested ifs
}

TEST(CSharpParser, TodoInCommentIsCounted) {
    auto fm = parse("// TODO: fix this\nvoid M() {}\n");
    EXPECT_EQ(fm.todoCount, 1);
}

TEST(CSharpParser, MultiLineVerbatimStringLinesAreCode) {
    auto fm = parse("string s = @\"line one\nline two\nline three\";\n");
    EXPECT_EQ(fm.codeLines, 3);
    EXPECT_EQ(fm.commentLines, 0);
}

TEST(CSharpParser, BlankAndCommentLinesClassifiedCorrectly) {
    auto fm = parse(
        "\n"
        "// a comment\n"
        "void M() {}\n");
    // blankLines is 2, not 1: the helper's totalLines counts the source
    // string's trailing '\n' as starting one more (unwritten) line, the
    // same trailing-newline convention every other parser test file in
    // this project already relies on -- that phantom line has no tokens
    // on it, so it defaults to BLANK alongside the real blank line 1.
    EXPECT_EQ(fm.blankLines, 2);
    EXPECT_EQ(fm.commentLines, 1);
    EXPECT_EQ(fm.codeLines, 1);
}
