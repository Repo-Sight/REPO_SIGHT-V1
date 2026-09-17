// Unit tests for TypeScriptLexer -- the Phase 2a front-end's tokenizer
// (TS is first of three: TS -> JS -> C#). Mirrors test_java_lexer.cpp's
// structure/conventions, one TEST() per behavior, GoogleTest.

#include "lexer/TypeScriptLexer.h"

#include <gtest/gtest.h>

using namespace cma;

namespace {
std::vector<Token> lex(const std::string& src) {
    TypeScriptLexer lexer(src);
    return lexer.tokenize();
}
} // namespace

TEST(TypeScriptLexer, RecognizesTrueReservedKeywords) {
    auto toks = lex("class if else for while return function");
    for (std::size_t i = 0; i + 1 < toks.size(); ++i) {
        EXPECT_EQ(toks[i].type, TokenType::KEYWORD) << "token: " << toks[i].value;
    }
}

TEST(TypeScriptLexer, LiteralsAreKeywords) {
    auto toks = lex("true false null undefined");
    EXPECT_EQ(toks[0].type, TokenType::KEYWORD);
    EXPECT_EQ(toks[1].type, TokenType::KEYWORD);
    EXPECT_EQ(toks[2].type, TokenType::KEYWORD);
    EXPECT_EQ(toks[3].type, TokenType::KEYWORD);
}

TEST(TypeScriptLexer, ContextualKeywordsTreatedAsAlwaysKeywords) {
    auto toks = lex("let async await interface enum readonly");
    for (std::size_t i = 0; i + 1 < toks.size(); ++i) {
        EXPECT_EQ(toks[i].type, TokenType::KEYWORD) << "token: " << toks[i].value;
    }
}

TEST(TypeScriptLexer, BuiltinTypeNamesAreIdentifiersNotKeywords) {
    // Mirrors Java's "String stays IDENTIFIER" precedent: TS type names
    // are not reserved words in JS/TS grammar.
    auto toks = lex("string number boolean any unknown never object symbol bigint");
    for (std::size_t i = 0; i + 1 < toks.size(); ++i) {
        EXPECT_EQ(toks[i].type, TokenType::IDENTIFIER) << "token: " << toks[i].value;
    }
}

TEST(TypeScriptLexer, IdentifiersMayContainDollarSign) {
    auto toks = lex("$scope x$1 $leading");
    EXPECT_EQ(toks[0].type, TokenType::IDENTIFIER);
    EXPECT_EQ(toks[0].value, "$scope");
    EXPECT_EQ(toks[1].value, "x$1");
    EXPECT_EQ(toks[2].value, "$leading");
}

TEST(TypeScriptLexer, DoubleQuotedStringIsStringLiteral) {
    auto toks = lex(R"("hello world")");
    EXPECT_EQ(toks[0].type, TokenType::STRING_LITERAL);
}

TEST(TypeScriptLexer, SingleQuotedStringIsStringLiteralNotCharLiteral) {
    // The one deliberate divergence from JavaLexer: JS has no char type.
    auto toks = lex("'x'");
    EXPECT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_NE(toks[0].type, TokenType::CHAR_LITERAL);
}

TEST(TypeScriptLexer, TemplateLiteralIsStringLiteral) {
    auto toks = lex("`hello`");
    EXPECT_EQ(toks[0].type, TokenType::STRING_LITERAL);
}

TEST(TypeScriptLexer, TemplateLiteralWithInterpolationIsOneToken) {
    auto toks = lex("`total: ${a + b}`");
    ASSERT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_EQ(toks[1].type, TokenType::END_OF_FILE);
}

TEST(TypeScriptLexer, TemplateLiteralInterpolationWithNestedObjectBraces) {
    // Nested '{' '}' inside ${ ... } must not close the literal early.
    auto toks = lex("`x: ${JSON.stringify({a: 1})}`");
    ASSERT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_EQ(toks[1].type, TokenType::END_OF_FILE);
}

TEST(TypeScriptLexer, TemplateLiteralSpansMultipleLinesInValue) {
    auto toks = lex("`line one\nline two`");
    ASSERT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_NE(toks[0].value.find('\n'), std::string::npos);
}

TEST(TypeScriptLexer, UnterminatedSingleLineStringRecoversGracefully) {
    auto toks = lex("x = \"oops\ny = 1");
    bool sawY = false;
    for (const auto& t : toks) if (t.value == "y") sawY = true;
    EXPECT_TRUE(sawY);
}

TEST(TypeScriptLexer, NumbersWithUnderscoreSeparators) {
    auto toks = lex("1_000_000");
    EXPECT_EQ(toks[0].type, TokenType::NUMBER_LITERAL);
    EXPECT_EQ(toks[0].value, "1_000_000");
}

TEST(TypeScriptLexer, BigIntSuffixAbsorbed) {
    auto toks = lex("100n");
    EXPECT_EQ(toks[0].type, TokenType::NUMBER_LITERAL);
    EXPECT_EQ(toks[0].value, "100n");
}

TEST(TypeScriptLexer, HexAndBinaryAndOctalLiterals) {
    auto toks = lex("0x1F 0b1010 0o17");
    EXPECT_EQ(toks[0].value, "0x1F");
    EXPECT_EQ(toks[1].value, "0b1010");
    EXPECT_EQ(toks[2].value, "0o17");
}

TEST(TypeScriptLexer, LineCommentToEndOfLine) {
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

TEST(TypeScriptLexer, BlockCommentSpansMultipleLines) {
    auto toks = lex("/* line one\nline two */");
    ASSERT_EQ(toks[0].type, TokenType::BLOCK_COMMENT);
    EXPECT_NE(toks[0].value.find('\n'), std::string::npos);
}

TEST(TypeScriptLexer, JsDocCommentIsOrdinaryBlockComment) {
    auto toks = lex("/** jsdoc */");
    EXPECT_EQ(toks[0].type, TokenType::BLOCK_COMMENT);
}

TEST(TypeScriptLexer, NoPreprocessorTokenEverEmitted) {
    auto toks = lex("class X { }");
    for (const auto& t : toks) EXPECT_NE(t.type, TokenType::PREPROCESSOR);
}

TEST(TypeScriptLexer, OperatorsAreSingleCharacterNeverPreCombined) {
    auto toks = lex("a && b");
    ASSERT_GE(toks.size(), 3u);
    EXPECT_EQ(toks[1].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[1].value, "&");
    EXPECT_EQ(toks[2].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[2].value, "&");
}

TEST(TypeScriptLexer, ArrowIsTwoSeparateOperatorTokens) {
    auto toks = lex("x => x");
    EXPECT_EQ(toks[1].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[1].value, "=");
    EXPECT_EQ(toks[2].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[2].value, ">");
}

TEST(TypeScriptLexer, DotIsAnOperator) {
    auto toks = lex("obj.field");
    ASSERT_EQ(toks.size(), 4u);
    EXPECT_EQ(toks[1].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[1].value, ".");
}

TEST(TypeScriptLexer, AtSignIsPunctuationNotOperator) {
    auto toks = lex("@Component");
    EXPECT_EQ(toks[0].type, TokenType::PUNCTUATION);
    EXPECT_EQ(toks[0].value, "@");
}

TEST(TypeScriptLexer, CommaIsPunctuation) {
    auto toks = lex("a, b");
    EXPECT_EQ(toks[1].type, TokenType::PUNCTUATION);
    EXPECT_EQ(toks[1].value, ",");
}

TEST(TypeScriptLexer, BracesParensBracketsMapToDedicatedTypes) {
    auto toks = lex("{ ( [ ] ) }");
    EXPECT_EQ(toks[0].type, TokenType::OPEN_BRACE);
    EXPECT_EQ(toks[1].type, TokenType::OPEN_PAREN);
    EXPECT_EQ(toks[2].type, TokenType::OPEN_BRACKET);
    EXPECT_EQ(toks[3].type, TokenType::CLOSE_BRACKET);
    EXPECT_EQ(toks[4].type, TokenType::CLOSE_PAREN);
    EXPECT_EQ(toks[5].type, TokenType::CLOSE_BRACE);
}

TEST(TypeScriptLexer, SemicolonHasDedicatedType) {
    auto toks = lex("x = 1;");
    bool sawSemi = false;
    for (const auto& t : toks) if (t.type == TokenType::SEMICOLON) sawSemi = true;
    EXPECT_TRUE(sawSemi);
}

TEST(TypeScriptLexer, NewlinesAlwaysEmittedNoImplicitJoining) {
    auto toks = lex("foo(\n1,\n2\n)");
    int newlineCount = 0;
    for (const auto& t : toks) if (t.type == TokenType::NEWLINE) ++newlineCount;
    EXPECT_EQ(newlineCount, 3);
}

TEST(TypeScriptLexer, EndsWithEndOfFileSentinel) {
    auto toks = lex("x = 1;");
    EXPECT_EQ(toks.back().type, TokenType::END_OF_FILE);
}
