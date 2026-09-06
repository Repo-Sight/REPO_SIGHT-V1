// Unit tests for CSharpLexer -- the Phase 2a front-end's tokenizer, and
// the last of three (TS -> JS -> C#). Mirrors test_java_lexer.cpp's
// structure/conventions, one TEST() per behavior, GoogleTest.

#include "lexer/CSharpLexer.h"

#include <gtest/gtest.h>

using namespace cma;

namespace {
std::vector<Token> lex(const std::string& src) {
    CSharpLexer lexer(src);
    return lexer.tokenize();
}
} // namespace

TEST(CSharpLexer, RecognizesTrueReservedKeywords) {
    auto toks = lex("class if else for while return void");
    for (std::size_t i = 0; i + 1 < toks.size(); ++i) {
        EXPECT_EQ(toks[i].type, TokenType::KEYWORD) << "token: " << toks[i].value;
    }
}

TEST(CSharpLexer, LiteralsAreKeywords) {
    auto toks = lex("true false null");
    EXPECT_EQ(toks[0].type, TokenType::KEYWORD);
    EXPECT_EQ(toks[1].type, TokenType::KEYWORD);
    EXPECT_EQ(toks[2].type, TokenType::KEYWORD);
}

TEST(CSharpLexer, ContextualKeywordsTreatedAsAlwaysKeywords) {
    auto toks = lex("var async await get set record where");
    for (std::size_t i = 0; i + 1 < toks.size(); ++i) {
        EXPECT_EQ(toks[i].type, TokenType::KEYWORD) << "token: " << toks[i].value;
    }
}

TEST(CSharpLexer, LinqQueryWordsAreIdentifiersNotKeywords) {
    // Deliberate exception to the contextual-keyword promotion --
    // documented in CSharpLexer.h.
    auto toks = lex("select from group by");
    for (std::size_t i = 0; i + 1 < toks.size(); ++i) {
        EXPECT_EQ(toks[i].type, TokenType::IDENTIFIER) << "token: " << toks[i].value;
    }
}

TEST(CSharpLexer, UserTypeNamesAreIdentifiersNotKeywords) {
    auto toks = lex("String List Console DateTime");
    for (std::size_t i = 0; i + 1 < toks.size(); ++i) {
        EXPECT_EQ(toks[i].type, TokenType::IDENTIFIER) << "token: " << toks[i].value;
    }
}

TEST(CSharpLexer, RegularDoubleQuotedStringIsStringLiteral) {
    auto toks = lex(R"("hello world")");
    EXPECT_EQ(toks[0].type, TokenType::STRING_LITERAL);
}

TEST(CSharpLexer, SingleQuotedCharIsCharLiteralNotStringLiteral) {
    // Unlike JS/TS: C# has a real char type.
    auto toks = lex("'x'");
    EXPECT_EQ(toks[0].type, TokenType::CHAR_LITERAL);
    EXPECT_NE(toks[0].type, TokenType::STRING_LITERAL);
}

TEST(CSharpLexer, VerbatimStringIsStringLiteral) {
    auto toks = lex(R"(@"C:\temp\file.txt")");
    EXPECT_EQ(toks[0].type, TokenType::STRING_LITERAL);
}

TEST(CSharpLexer, VerbatimStringDoubledQuoteEscapeStaysInsideLiteral) {
    auto toks = lex(R"(@"she said ""hi""" + 1)");
    ASSERT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    // The literal absorbs the doubled-quote escape and closes at the
    // real terminating quote; '+' and '1' follow as separate tokens.
    EXPECT_EQ(toks[1].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[1].value, "+");
}

TEST(CSharpLexer, VerbatimStringSpansMultipleLinesLiterally) {
    auto toks = lex("@\"line one\nline two\"");
    ASSERT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_NE(toks[0].value.find('\n'), std::string::npos);
}

TEST(CSharpLexer, InterpolatedStringIsOneStringLiteralToken) {
    auto toks = lex(R"($"total: {a + b}")");
    ASSERT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_EQ(toks[1].type, TokenType::END_OF_FILE);
}

TEST(CSharpLexer, InterpolatedStringWithNestedCallStringArgument) {
    // A nested string literal inside a hole must not prematurely close
    // the outer interpolated string.
    auto toks = lex(R"($"value: {Foo("x")}")");
    ASSERT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_EQ(toks[1].type, TokenType::END_OF_FILE);
}

TEST(CSharpLexer, InterpolatedStringDoubledBraceIsLiteralBrace) {
    auto toks = lex(R"($"{{literal}} value={x}")");
    ASSERT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_EQ(toks[1].type, TokenType::END_OF_FILE);
}

TEST(CSharpLexer, CombinedVerbatimInterpolatedDollarAtOrder) {
    auto toks = lex(R"($@"path: {dir}\sub")");
    ASSERT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_EQ(toks[1].type, TokenType::END_OF_FILE);
}

TEST(CSharpLexer, CombinedVerbatimInterpolatedAtDollarOrder) {
    auto toks = lex(R"(@$"path: {dir}\sub")");
    ASSERT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_EQ(toks[1].type, TokenType::END_OF_FILE);
}

TEST(CSharpLexer, VerbatimIdentifierEscapesReservedWord) {
    auto toks = lex("@class");
    EXPECT_EQ(toks[0].type, TokenType::IDENTIFIER);
    EXPECT_EQ(toks[0].value, "@class");
}

TEST(CSharpLexer, VerbatimIdentifierUsableAsOrdinaryName) {
    auto toks = lex("int @class = 1;");
    EXPECT_EQ(toks[0].type, TokenType::KEYWORD);   // int
    EXPECT_EQ(toks[1].type, TokenType::IDENTIFIER); // @class
    EXPECT_EQ(toks[1].value, "@class");
}

TEST(CSharpLexer, UnterminatedSingleLineStringRecoversGracefully) {
    auto toks = lex("x = \"oops\ny = 1");
    bool sawY = false;
    for (const auto& t : toks) if (t.value == "y") sawY = true;
    EXPECT_TRUE(sawY);
}

TEST(CSharpLexer, NumbersWithUnderscoreSeparators) {
    auto toks = lex("1_000_000");
    EXPECT_EQ(toks[0].type, TokenType::NUMBER_LITERAL);
    EXPECT_EQ(toks[0].value, "1_000_000");
}

TEST(CSharpLexer, NumericSuffixesAbsorbed) {
    auto toks = lex("3.14f 5m 10L 7u");
    EXPECT_EQ(toks[0].value, "3.14f");
    EXPECT_EQ(toks[1].value, "5m");
    EXPECT_EQ(toks[2].value, "10L");
    EXPECT_EQ(toks[3].value, "7u");
}

TEST(CSharpLexer, HexAndBinaryLiterals) {
    auto toks = lex("0x1F 0b1010");
    EXPECT_EQ(toks[0].value, "0x1F");
    EXPECT_EQ(toks[1].value, "0b1010");
}

TEST(CSharpLexer, LineCommentToEndOfLine) {
    auto toks = lex("x = 1;  // a comment\ny = 2;");
    bool sawComment = false;
    for (const auto& t : toks) {
        if (t.type == TokenType::LINE_COMMENT) {
            sawComment = true;
            EXPECT_NE(t.value.find("a comment"), std::string::npos);
        }
    }
    EXPECT_TRUE(sawComment);
}

TEST(CSharpLexer, XmlDocCommentIsOrdinaryLineComment) {
    auto toks = lex("/// <summary>Does a thing.</summary>\n");
    EXPECT_EQ(toks[0].type, TokenType::LINE_COMMENT);
}

TEST(CSharpLexer, BlockCommentSpansMultipleLines) {
    auto toks = lex("/* line one\nline two */");
    ASSERT_EQ(toks[0].type, TokenType::BLOCK_COMMENT);
    EXPECT_NE(toks[0].value.find('\n'), std::string::npos);
}

TEST(CSharpLexer, PreprocessorDirectiveHasDedicatedType) {
    auto toks = lex("#region Fields\nint x;\n#endregion\n");
    EXPECT_EQ(toks[0].type, TokenType::PREPROCESSOR);
}

TEST(CSharpLexer, NullableMarkerIsSingleCharOperator) {
    auto toks = lex("int? x;");
    EXPECT_EQ(toks[0].type, TokenType::KEYWORD);   // int
    EXPECT_EQ(toks[1].type, TokenType::OPERATOR);  // ?
    EXPECT_EQ(toks[1].value, "?");
}

TEST(CSharpLexer, OperatorsAreSingleCharacterNeverPreCombined) {
    auto toks = lex("a && b");
    ASSERT_GE(toks.size(), 3u);
    EXPECT_EQ(toks[1].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[1].value, "&");
    EXPECT_EQ(toks[2].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[2].value, "&");
}

TEST(CSharpLexer, ArrowIsTwoSeparateOperatorTokens) {
    auto toks = lex("x => x");
    EXPECT_EQ(toks[1].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[1].value, "=");
    EXPECT_EQ(toks[2].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[2].value, ">");
}

TEST(CSharpLexer, AttributeBracketsAreDedicatedTypes) {
    auto toks = lex("[Obsolete]");
    EXPECT_EQ(toks[0].type, TokenType::OPEN_BRACKET);
    EXPECT_EQ(toks[1].type, TokenType::IDENTIFIER);
    EXPECT_EQ(toks[2].type, TokenType::CLOSE_BRACKET);
}

TEST(CSharpLexer, CommaIsPunctuation) {
    auto toks = lex("a, b");
    EXPECT_EQ(toks[1].type, TokenType::PUNCTUATION);
    EXPECT_EQ(toks[1].value, ",");
}

TEST(CSharpLexer, BracesParensBracketsMapToDedicatedTypes) {
    auto toks = lex("{ ( [ ] ) }");
    EXPECT_EQ(toks[0].type, TokenType::OPEN_BRACE);
    EXPECT_EQ(toks[1].type, TokenType::OPEN_PAREN);
    EXPECT_EQ(toks[2].type, TokenType::OPEN_BRACKET);
    EXPECT_EQ(toks[3].type, TokenType::CLOSE_BRACKET);
    EXPECT_EQ(toks[4].type, TokenType::CLOSE_PAREN);
    EXPECT_EQ(toks[5].type, TokenType::CLOSE_BRACE);
}

TEST(CSharpLexer, SemicolonHasDedicatedType) {
    auto toks = lex("x = 1;");
    bool sawSemi = false;
    for (const auto& t : toks) if (t.type == TokenType::SEMICOLON) sawSemi = true;
    EXPECT_TRUE(sawSemi);
}

TEST(CSharpLexer, NewlinesAlwaysEmittedNoImplicitJoining) {
    auto toks = lex("Foo(\n1,\n2\n)");
    int newlineCount = 0;
    for (const auto& t : toks) if (t.type == TokenType::NEWLINE) ++newlineCount;
    EXPECT_EQ(newlineCount, 3);
}

TEST(CSharpLexer, EndsWithEndOfFileSentinel) {
    auto toks = lex("x = 1;");
    EXPECT_EQ(toks.back().type, TokenType::END_OF_FILE);
}
