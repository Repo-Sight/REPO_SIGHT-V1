// Unit tests for JavaScriptLexer -- the Phase 2a front-end's tokenizer
// (JS is second of three: TS -> JS -> C#). Mirrors
// test_typescript_lexer.cpp's structure/conventions, one TEST() per
// behavior, GoogleTest. Most cases are unchanged from TS's own tests
// since none of that behavior is TS-specific; the keyword-set tests
// are the deliberate exception -- see JavaScriptLexer.h/.cpp's header
// comments for what's dropped and why.

#include "lexer/JavaScriptLexer.h"

#include <gtest/gtest.h>

using namespace cma;

namespace {
std::vector<Token> lex(const std::string& src) {
    JavaScriptLexer lexer(src);
    return lexer.tokenize();
}
} // namespace

TEST(JavaScriptLexer, RecognizesTrueReservedKeywords) {
    auto toks = lex("class if else for while return function");
    for (std::size_t i = 0; i + 1 < toks.size(); ++i) {
        EXPECT_EQ(toks[i].type, TokenType::KEYWORD) << "token: " << toks[i].value;
    }
}

TEST(JavaScriptLexer, LiteralsAreKeywords) {
    auto toks = lex("true false null undefined");
    EXPECT_EQ(toks[0].type, TokenType::KEYWORD);
    EXPECT_EQ(toks[1].type, TokenType::KEYWORD);
    EXPECT_EQ(toks[2].type, TokenType::KEYWORD);
    EXPECT_EQ(toks[3].type, TokenType::KEYWORD);
}

TEST(JavaScriptLexer, RealJsContextualKeywordsTreatedAsAlwaysKeywords) {
    // let/async/await/static/get/set are genuine ECMAScript
    // (contextual) keywords, unlike interface/enum/readonly below.
    auto toks = lex("let async await static get set");
    for (std::size_t i = 0; i + 1 < toks.size(); ++i) {
        EXPECT_EQ(toks[i].type, TokenType::KEYWORD) << "token: " << toks[i].value;
    }
}

TEST(JavaScriptLexer, TsOnlyTypeKeywordsAreIdentifiersNotKeywords) {
    // The deliberate difference from TypeScriptLexer: these words exist
    // only for TS's type-declaration grammar (interface/enum/readonly/
    // declare/namespace/satisfies), which plain JS has no equivalent
    // for -- so on real JS source they must lex as ordinary IDENTIFIER,
    // not KEYWORD. This is the regression test for that decision.
    auto toks = lex("interface enum readonly declare namespace satisfies");
    for (std::size_t i = 0; i + 1 < toks.size(); ++i) {
        EXPECT_EQ(toks[i].type, TokenType::IDENTIFIER) << "token: " << toks[i].value;
    }
}

TEST(JavaScriptLexer, BuiltinTypeNamesAreIdentifiersNotKeywords) {
    auto toks = lex("string number boolean any unknown never object symbol bigint");
    for (std::size_t i = 0; i + 1 < toks.size(); ++i) {
        EXPECT_EQ(toks[i].type, TokenType::IDENTIFIER) << "token: " << toks[i].value;
    }
}

TEST(JavaScriptLexer, IdentifiersMayContainDollarSign) {
    auto toks = lex("$scope x$1 $leading");
    EXPECT_EQ(toks[0].type, TokenType::IDENTIFIER);
    EXPECT_EQ(toks[0].value, "$scope");
    EXPECT_EQ(toks[1].value, "x$1");
    EXPECT_EQ(toks[2].value, "$leading");
}

TEST(JavaScriptLexer, DoubleQuotedStringIsStringLiteral) {
    auto toks = lex(R"("hello world")");
    EXPECT_EQ(toks[0].type, TokenType::STRING_LITERAL);
}

TEST(JavaScriptLexer, SingleQuotedStringIsStringLiteralNotCharLiteral) {
    auto toks = lex("'x'");
    EXPECT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_NE(toks[0].type, TokenType::CHAR_LITERAL);
}

TEST(JavaScriptLexer, TemplateLiteralIsStringLiteral) {
    auto toks = lex("`hello`");
    EXPECT_EQ(toks[0].type, TokenType::STRING_LITERAL);
}

TEST(JavaScriptLexer, TemplateLiteralWithInterpolationIsOneToken) {
    auto toks = lex("`total: ${a + b}`");
    ASSERT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_EQ(toks[1].type, TokenType::END_OF_FILE);
}

TEST(JavaScriptLexer, TemplateLiteralInterpolationWithNestedObjectBraces) {
    auto toks = lex("`x: ${JSON.stringify({a: 1})}`");
    ASSERT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_EQ(toks[1].type, TokenType::END_OF_FILE);
}

TEST(JavaScriptLexer, TemplateLiteralSpansMultipleLinesInValue) {
    auto toks = lex("`line one\nline two`");
    ASSERT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_NE(toks[0].value.find('\n'), std::string::npos);
}

TEST(JavaScriptLexer, UnterminatedSingleLineStringRecoversGracefully) {
    auto toks = lex("x = \"oops\ny = 1");
    bool sawY = false;
    for (const auto& t : toks) if (t.value == "y") sawY = true;
    EXPECT_TRUE(sawY);
}

TEST(JavaScriptLexer, NumbersWithUnderscoreSeparators) {
    auto toks = lex("1_000_000");
    EXPECT_EQ(toks[0].type, TokenType::NUMBER_LITERAL);
    EXPECT_EQ(toks[0].value, "1_000_000");
}

TEST(JavaScriptLexer, BigIntSuffixAbsorbed) {
    auto toks = lex("100n");
    EXPECT_EQ(toks[0].type, TokenType::NUMBER_LITERAL);
    EXPECT_EQ(toks[0].value, "100n");
}

TEST(JavaScriptLexer, HexAndBinaryAndOctalLiterals) {
    auto toks = lex("0x1F 0b1010 0o17");
    EXPECT_EQ(toks[0].value, "0x1F");
    EXPECT_EQ(toks[1].value, "0b1010");
    EXPECT_EQ(toks[2].value, "0o17");
}

TEST(JavaScriptLexer, LineCommentToEndOfLine) {
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

TEST(JavaScriptLexer, BlockCommentSpansMultipleLines) {
    auto toks = lex("/* line one\nline two */");
    ASSERT_EQ(toks[0].type, TokenType::BLOCK_COMMENT);
    EXPECT_NE(toks[0].value.find('\n'), std::string::npos);
}

TEST(JavaScriptLexer, JsDocCommentIsOrdinaryBlockComment) {
    auto toks = lex("/** jsdoc */");
    EXPECT_EQ(toks[0].type, TokenType::BLOCK_COMMENT);
}

TEST(JavaScriptLexer, NoPreprocessorTokenEverEmitted) {
    auto toks = lex("class X { }");
    for (const auto& t : toks) EXPECT_NE(t.type, TokenType::PREPROCESSOR);
}

TEST(JavaScriptLexer, OperatorsAreSingleCharacterNeverPreCombined) {
    auto toks = lex("a && b");
    ASSERT_GE(toks.size(), 3u);
    EXPECT_EQ(toks[1].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[1].value, "&");
    EXPECT_EQ(toks[2].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[2].value, "&");
}

TEST(JavaScriptLexer, ArrowIsTwoSeparateOperatorTokens) {
    auto toks = lex("x => x");
    EXPECT_EQ(toks[1].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[1].value, "=");
    EXPECT_EQ(toks[2].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[2].value, ">");
}

TEST(JavaScriptLexer, DotIsAnOperator) {
    auto toks = lex("obj.field");
    ASSERT_EQ(toks.size(), 4u);
    EXPECT_EQ(toks[1].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[1].value, ".");
}

TEST(JavaScriptLexer, AtSignIsPunctuationNotOperator) {
    auto toks = lex("@decorator");
    EXPECT_EQ(toks[0].type, TokenType::PUNCTUATION);
    EXPECT_EQ(toks[0].value, "@");
}

TEST(JavaScriptLexer, CommaIsPunctuation) {
    auto toks = lex("a, b");
    EXPECT_EQ(toks[1].type, TokenType::PUNCTUATION);
    EXPECT_EQ(toks[1].value, ",");
}

TEST(JavaScriptLexer, BracesParensBracketsMapToDedicatedTypes) {
    auto toks = lex("{ ( [ ] ) }");
    EXPECT_EQ(toks[0].type, TokenType::OPEN_BRACE);
    EXPECT_EQ(toks[1].type, TokenType::OPEN_PAREN);
    EXPECT_EQ(toks[2].type, TokenType::OPEN_BRACKET);
    EXPECT_EQ(toks[3].type, TokenType::CLOSE_BRACKET);
    EXPECT_EQ(toks[4].type, TokenType::CLOSE_PAREN);
    EXPECT_EQ(toks[5].type, TokenType::CLOSE_BRACE);
}

TEST(JavaScriptLexer, SemicolonHasDedicatedType) {
    auto toks = lex("x = 1;");
    bool sawSemi = false;
    for (const auto& t : toks) if (t.type == TokenType::SEMICOLON) sawSemi = true;
    EXPECT_TRUE(sawSemi);
}

TEST(JavaScriptLexer, NewlinesAlwaysEmittedNoImplicitJoining) {
    auto toks = lex("foo(\n1,\n2\n)");
    int newlineCount = 0;
    for (const auto& t : toks) if (t.type == TokenType::NEWLINE) ++newlineCount;
    EXPECT_EQ(newlineCount, 3);
}

TEST(JavaScriptLexer, EndsWithEndOfFileSentinel) {
    auto toks = lex("x = 1;");
    EXPECT_EQ(toks.back().type, TokenType::END_OF_FILE);
}
