// Unit tests for Phase 6a's MetricsEngine::addFileTokens() and
// buildDuplicationReport() -- token-based, language-scoped duplicate
// block detection (see MetricsEngine.cpp's "Duplication detection"
// section for the chunk-fingerprint + extension algorithm).
//
// Fixtures build a synthetic 40-normalized-token block (the detector's
// minimum seed length) out of four repeated "if (x) { y = z; }"-shaped
// statements spanning 12 lines (4 iterations x 3 lines each). Where a
// test needs a block below the minimum, the last token is dropped to
// get exactly 39.

#include "metrics/MetricsEngine.h"

#include <gtest/gtest.h>

using namespace cma;

namespace {

// Builds a 40-token block: KEYWORD "if" ( ID ) { \n ID = ID ; \n } --
// repeated 4 times, starting at `startLine`. `idSuffix` lets callers
// produce blocks that are structurally identical but use different
// identifier names (renamed-variable duplicates still count as Type-2
// clones, since IDENTIFIER tokens are normalized to a placeholder).
std::vector<Token> makeBlock(int startLine, const std::string& idSuffix) {
    std::vector<Token> tokens;
    int line = startLine;
    for (int i = 0; i < 4; ++i) {
        tokens.push_back(Token{TokenType::KEYWORD, "if", line, 1});
        tokens.push_back(Token{TokenType::OPEN_PAREN, "(", line, 3});
        tokens.push_back(Token{TokenType::IDENTIFIER, "x" + idSuffix, line, 4});
        tokens.push_back(Token{TokenType::CLOSE_PAREN, ")", line, 6});
        tokens.push_back(Token{TokenType::OPEN_BRACE, "{", line, 8});
        ++line;
        tokens.push_back(Token{TokenType::IDENTIFIER, "y" + idSuffix, line, 2});
        tokens.push_back(Token{TokenType::OPERATOR, "=", line, 4});
        tokens.push_back(Token{TokenType::IDENTIFIER, "z" + idSuffix, line, 6});
        tokens.push_back(Token{TokenType::SEMICOLON, ";", line, 7});
        ++line;
        tokens.push_back(Token{TokenType::CLOSE_BRACE, "}", line, 1});
        ++line;
    }
    return tokens;
}

// Line span of a block produced by makeBlock(): 4 iterations x 3 lines.
constexpr int kBlockLineSpan = 11; // last line = startLine + kBlockLineSpan

FileMetrics makeFileMetrics(const std::string& language, int codeLines) {
    FileMetrics fm;
    fm.language = language;
    fm.codeLines = codeLines;
    return fm;
}

} // namespace

TEST(DuplicationReport, EmptyByDefault) {
    MetricsEngine engine;
    const auto report = engine.buildDuplicationReport();
    EXPECT_TRUE(report.matches.empty());
    EXPECT_EQ(report.duplicateLineCount, 0);
    EXPECT_DOUBLE_EQ(report.duplicatePercentage, 0.0);
}

TEST(DuplicationReport, BelowWindowThresholdIsNotReported) {
    MetricsEngine engine;
    auto blockA = makeBlock(1, "A");
    auto blockB = makeBlock(1, "A");
    blockA.pop_back(); // 39 tokens -- one below the 40-token minimum seed
    blockB.pop_back();

    engine.addFile("a.cpp", makeFileMetrics("cpp", 12));
    engine.addFile("b.cpp", makeFileMetrics("cpp", 12));
    engine.addFileTokens("a.cpp", "cpp", blockA);
    engine.addFileTokens("b.cpp", "cpp", blockB);

    const auto report = engine.buildDuplicationReport();
    EXPECT_TRUE(report.matches.empty());
}

TEST(DuplicationReport, DetectsExactDuplicateBlockAcrossFiles) {
    MetricsEngine engine;
    const auto block = makeBlock(1, "A");

    engine.addFile("a.cpp", makeFileMetrics("cpp", 12));
    engine.addFile("b.cpp", makeFileMetrics("cpp", 12));
    engine.addFileTokens("a.cpp", "cpp", block);
    engine.addFileTokens("b.cpp", "cpp", block);

    const auto report = engine.buildDuplicationReport();
    ASSERT_EQ(report.matches.size(), 1u);

    const auto& m = report.matches[0];
    EXPECT_EQ(m.pathA, "a.cpp");
    EXPECT_EQ(m.pathB, "b.cpp");
    EXPECT_EQ(m.lineStartA, 1);
    EXPECT_EQ(m.lineEndA, 1 + kBlockLineSpan);
    EXPECT_EQ(m.lineStartB, 1);
    EXPECT_EQ(m.lineEndB, 1 + kBlockLineSpan);
    EXPECT_EQ(m.tokenCount, 40);
}

TEST(DuplicationReport, RenamedIdentifiersStillCountAsDuplicate) {
    MetricsEngine engine;
    engine.addFile("a.cpp", makeFileMetrics("cpp", 12));
    engine.addFile("b.cpp", makeFileMetrics("cpp", 12));
    engine.addFileTokens("a.cpp", "cpp", makeBlock(1, "A"));
    engine.addFileTokens("b.cpp", "cpp", makeBlock(1, "TotallyDifferentName"));

    const auto report = engine.buildDuplicationReport();
    ASSERT_EQ(report.matches.size(), 1u);
    EXPECT_EQ(report.matches[0].tokenCount, 40);
}

TEST(DuplicationReport, DifferingKeywordBreaksTheMatch) {
    MetricsEngine engine;
    auto blockA = makeBlock(1, "A");
    auto blockB = makeBlock(1, "A");
    // Structural change (not an identifier/literal), so it is NOT
    // normalized away -- this must prevent a full-window match.
    blockB[0].value = "while";

    engine.addFile("a.cpp", makeFileMetrics("cpp", 12));
    engine.addFile("b.cpp", makeFileMetrics("cpp", 12));
    engine.addFileTokens("a.cpp", "cpp", blockA);
    engine.addFileTokens("b.cpp", "cpp", blockB);

    const auto report = engine.buildDuplicationReport();
    EXPECT_TRUE(report.matches.empty());
}

TEST(DuplicationReport, DoesNotMatchAcrossDifferentLanguages) {
    MetricsEngine engine;
    const auto block = makeBlock(1, "A");

    engine.addFile("a.cpp", makeFileMetrics("cpp", 12));
    engine.addFile("b.py", makeFileMetrics("python", 12));
    engine.addFileTokens("a.cpp", "cpp", block);
    engine.addFileTokens("b.py", "python", block);

    const auto report = engine.buildDuplicationReport();
    EXPECT_TRUE(report.matches.empty());
}

TEST(DuplicationReport, IgnoresCommentAndNewlineTokensWhenMatching) {
    MetricsEngine engine;
    auto blockA = makeBlock(1, "A");
    auto blockB = makeBlock(1, "A");

    // Sprinkle comments/newlines into B at different positions -- these
    // are stripped during normalization and must not block the match.
    blockB.insert(blockB.begin() + 2, Token{TokenType::LINE_COMMENT, "// note", 1, 0});
    blockB.insert(blockB.begin() + 5, Token{TokenType::NEWLINE, "\n", 1, 0});

    engine.addFile("a.cpp", makeFileMetrics("cpp", 12));
    engine.addFile("b.cpp", makeFileMetrics("cpp", 12));
    engine.addFileTokens("a.cpp", "cpp", blockA);
    engine.addFileTokens("b.cpp", "cpp", blockB);

    const auto report = engine.buildDuplicationReport();
    ASSERT_EQ(report.matches.size(), 1u);
    EXPECT_EQ(report.matches[0].tokenCount, 40);
}

TEST(DuplicationReport, SelfDuplicationWithinSameFileAndPercentage) {
    MetricsEngine engine;
    const auto block1 = makeBlock(1, "A");
    const auto block2 = makeBlock(100, "A"); // identical shape, far away

    std::vector<Token> tokens = block1;
    tokens.insert(tokens.end(), block2.begin(), block2.end());

    // 24 duplicate lines out of 200 total code lines -> 12%.
    engine.addFile("only.cpp", makeFileMetrics("cpp", 200));
    engine.addFileTokens("only.cpp", "cpp", tokens);

    const auto report = engine.buildDuplicationReport();
    ASSERT_EQ(report.matches.size(), 1u);

    const auto& m = report.matches[0];
    EXPECT_EQ(m.pathA, "only.cpp");
    EXPECT_EQ(m.pathB, "only.cpp");

    const int expectedDuplicateLines = 2 * (kBlockLineSpan + 1); // 2 blocks, 12 lines each
    EXPECT_EQ(report.duplicateLineCount, expectedDuplicateLines);
    EXPECT_DOUBLE_EQ(report.duplicatePercentage,
                      static_cast<double>(expectedDuplicateLines) / 200.0 * 100.0);
}

TEST(DuplicationReport, DoesNotAffectFilesOrComputeData) {
    MetricsEngine engine;
    engine.addFile("a.cpp", makeFileMetrics("cpp", 12));
    engine.addFileTokens("a.cpp", "cpp", makeBlock(1, "A"));

    const auto pm = engine.compute();
    EXPECT_EQ(pm.filesAnalyzed, 1);
    ASSERT_EQ(engine.files().size(), 1u);
    EXPECT_EQ(engine.files()[0].first, "a.cpp");
}
