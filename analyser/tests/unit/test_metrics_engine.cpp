// Unit tests for Phase 2's MetricsEngine::addUnanalyzedFile() and its
// extension-grouped aggregation into ProjectMetrics::unanalyzedLanguages
// at compute() time. MetricsEngine::compute()'s grouping logic (both
// this and the earlier Phase 1 byLanguage grouping) had no direct unit
// test before this file -- coverage previously lived one layer up, at
// ReportGenerator's JSON-serialization tests.

#include "metrics/MetricsEngine.h"

#include <gtest/gtest.h>

using namespace cma;

TEST(MetricsEngineUnanalyzed, EmptyByDefault) {
    MetricsEngine engine;
    const auto pm = engine.compute();
    EXPECT_TRUE(pm.unanalyzedLanguages.empty());
}

TEST(MetricsEngineUnanalyzed, GroupsMultipleFilesOfSameExtension) {
    MetricsEngine engine;
    engine.addUnanalyzedFile(".go", 10);
    engine.addUnanalyzedFile(".go", 25);
    engine.addUnanalyzedFile(".go", 5);

    const auto pm = engine.compute();
    ASSERT_EQ(pm.unanalyzedLanguages.size(), 1u);
    EXPECT_EQ(pm.unanalyzedLanguages[0].extension, ".go");
    EXPECT_EQ(pm.unanalyzedLanguages[0].languageName, "Go");
    EXPECT_EQ(pm.unanalyzedLanguages[0].fileCount, 3);
    EXPECT_EQ(pm.unanalyzedLanguages[0].lineCount, 40);
}

TEST(MetricsEngineUnanalyzed, SortsByLineCountDescending) {
    MetricsEngine engine;
    engine.addUnanalyzedFile(".rs", 5);
    engine.addUnanalyzedFile(".go", 100);
    engine.addUnanalyzedFile(".rb", 50);

    const auto pm = engine.compute();
    ASSERT_EQ(pm.unanalyzedLanguages.size(), 3u);
    EXPECT_EQ(pm.unanalyzedLanguages[0].extension, ".go");
    EXPECT_EQ(pm.unanalyzedLanguages[1].extension, ".rb");
    EXPECT_EQ(pm.unanalyzedLanguages[2].extension, ".rs");
}

TEST(MetricsEngineUnanalyzed, TiesBrokenByExtensionAlphabetically) {
    MetricsEngine engine;
    engine.addUnanalyzedFile(".rs", 10);
    engine.addUnanalyzedFile(".go", 10);

    const auto pm = engine.compute();
    ASSERT_EQ(pm.unanalyzedLanguages.size(), 2u);
    EXPECT_EQ(pm.unanalyzedLanguages[0].extension, ".go");
    EXPECT_EQ(pm.unanalyzedLanguages[1].extension, ".rs");
}

TEST(MetricsEngineUnanalyzed, UnknownExtensionFallsBackToRawExtensionAsName) {
    MetricsEngine engine;
    engine.addUnanalyzedFile(".zig", 12);

    const auto pm = engine.compute();
    ASSERT_EQ(pm.unanalyzedLanguages.size(), 1u);
    EXPECT_EQ(pm.unanalyzedLanguages[0].extension, ".zig");
    EXPECT_EQ(pm.unanalyzedLanguages[0].languageName, ".zig");
}

TEST(MetricsEngineUnanalyzed, DoesNotAffectByLanguageOrFilesData) {
    MetricsEngine engine;
    engine.addUnanalyzedFile(".go", 10);

    const auto pm = engine.compute();
    EXPECT_TRUE(pm.byLanguage.empty());
    EXPECT_TRUE(engine.files().empty());
}

// Phase 2a's final checklist item, now that all three (TS -> JS -> C#)
// have landed: a mixed-language project groups every language into its
// own byLanguage entry, C# included alongside the pre-existing ones.
TEST(MetricsEngineByLanguage, GroupsCSharpAlongsideOtherLanguages) {
    MetricsEngine engine;

    FileMetrics cpp;
    cpp.language = "cpp";
    cpp.totalLines = 10; cpp.codeLines = 8;
    engine.addFile("a.cpp", cpp);

    FileMetrics cs1;
    cs1.language = "csharp";
    cs1.totalLines = 20; cs1.codeLines = 15;
    engine.addFile("b.cs", cs1);

    FileMetrics cs2;
    cs2.language = "csharp";
    cs2.totalLines = 30; cs2.codeLines = 25;
    engine.addFile("c.cs", cs2);

    const auto pm = engine.compute();
    ASSERT_EQ(pm.byLanguage.size(), 2u);

    const LanguageAggregate* csharpAgg = nullptr;
    for (const auto& agg : pm.byLanguage) {
        if (agg.language == "csharp") csharpAgg = &agg;
    }
    ASSERT_NE(csharpAgg, nullptr);
    EXPECT_EQ(csharpAgg->fileCount, 2);
    EXPECT_EQ(csharpAgg->totalLines, 50);
    EXPECT_EQ(csharpAgg->codeLines, 40);
}

// Phase 2a's actual closing checklist item: "mixed repo containing
// C++/Python/Java/TS/JS/C# -> verify per-language breakdown ... is
// correct for all six languages." The prior test only covered two.
TEST(MetricsEngineByLanguage, SixLanguageMixedRepoProducesCorrectPerLanguageBreakdown) {
    MetricsEngine engine;

    struct Seed { const char* path; const char* language; int totalLines; int codeLines; };
    const Seed seeds[] = {
        {"a.cpp",  "cpp",        10, 8},
        {"b.py",   "python",     20, 15},
        {"c.java", "java",       30, 22},
        {"d.ts",   "typescript", 40, 33},
        {"e.js",   "javascript", 50, 41},
        {"f.cs",   "csharp",     60, 48},
        {"g.cs",   "csharp",     15, 12},
    };

    for (const auto& seed : seeds) {
        FileMetrics fm;
        fm.language = seed.language;
        fm.totalLines = seed.totalLines;
        fm.codeLines = seed.codeLines;
        engine.addFile(seed.path, fm);
    }

    const auto pm = engine.compute();

    // 7 files, 6 distinct languages -- csharp has two files grouped together.
    ASSERT_EQ(pm.byLanguage.size(), 6u);
    ASSERT_EQ(engine.files().size(), 7u);

    auto findAgg = [&pm](const std::string& lang) -> const LanguageAggregate* {
        for (const auto& agg : pm.byLanguage) {
            if (agg.language == lang) return &agg;
        }
        return nullptr;
    };

    const LanguageAggregate* cppAgg = findAgg("cpp");
    ASSERT_NE(cppAgg, nullptr);
    EXPECT_EQ(cppAgg->fileCount, 1);
    EXPECT_EQ(cppAgg->totalLines, 10);
    EXPECT_EQ(cppAgg->codeLines, 8);

    const LanguageAggregate* pyAgg = findAgg("python");
    ASSERT_NE(pyAgg, nullptr);
    EXPECT_EQ(pyAgg->fileCount, 1);
    EXPECT_EQ(pyAgg->totalLines, 20);
    EXPECT_EQ(pyAgg->codeLines, 15);

    const LanguageAggregate* javaAgg = findAgg("java");
    ASSERT_NE(javaAgg, nullptr);
    EXPECT_EQ(javaAgg->fileCount, 1);
    EXPECT_EQ(javaAgg->totalLines, 30);
    EXPECT_EQ(javaAgg->codeLines, 22);

    const LanguageAggregate* tsAgg = findAgg("typescript");
    ASSERT_NE(tsAgg, nullptr);
    EXPECT_EQ(tsAgg->fileCount, 1);
    EXPECT_EQ(tsAgg->totalLines, 40);
    EXPECT_EQ(tsAgg->codeLines, 33);

    const LanguageAggregate* jsAgg = findAgg("javascript");
    ASSERT_NE(jsAgg, nullptr);
    EXPECT_EQ(jsAgg->fileCount, 1);
    EXPECT_EQ(jsAgg->totalLines, 50);
    EXPECT_EQ(jsAgg->codeLines, 41);

    const LanguageAggregate* csAgg = findAgg("csharp");
    ASSERT_NE(csAgg, nullptr);
    EXPECT_EQ(csAgg->fileCount, 2);
    EXPECT_EQ(csAgg->totalLines, 75);
    EXPECT_EQ(csAgg->codeLines, 60);
}
