// Unit tests for Phase 2 (unanalyzed-language tracking): FileScanner's
// new optional `unsupported` out-param on scan() and its directory
// pruning of vendor/build/VCS directories. FileScanner had no dedicated
// unit test file before this change.

#include "filesystem/FileScanner.h"

#include <gtest/gtest.h>

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>

using namespace cma;
namespace fs = std::filesystem;

namespace {

class TempDir {
public:
    TempDir() {
        m_path = fs::temp_directory_path() /
                 fs::path("cma_scanner_test_" + std::to_string(::getpid()) + "_" +
                           std::to_string(reinterpret_cast<std::uintptr_t>(this)));
        fs::create_directories(m_path);
    }

    ~TempDir() {
        std::error_code ec;
        fs::remove_all(m_path, ec);
    }

    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;

    void write(const std::string& relPath, const std::string& content = "line1\nline2\n") {
        const auto full = m_path / relPath;
        fs::create_directories(full.parent_path());
        std::ofstream out(full, std::ios::trunc);
        out << content;
    }

    [[nodiscard]] const fs::path& path() const noexcept { return m_path; }

private:
    fs::path m_path;
};

} // namespace

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
TEST(FileScanner, ScanWithoutOutParamBehavesExactlyAsBefore) {
    TempDir dir;
    dir.write("main.cpp");
    dir.write("app.go");

    const FileScanner scanner(dir.path());
    const auto files = scanner.scan();

    ASSERT_EQ(files.size(), 1u);
    EXPECT_EQ(files[0].filename().string(), "main.cpp");
}

// Phase 3 groundwork: confirms FileScanner already handles a single
// regular file as the target path (not just a directory), since Phase 3
// (single-file upload/paste) plans to pass the file straight to the CMA
// binary without wrapping it in a directory first. This behavior already
// existed in scan()'s is_regular_file(m_rootPath) branch but had no
// direct test -- verifying it here rather than assuming from reading code.
TEST(FileScanner, SingleFileTargetPathReturnsThatFileWhenSupported) {
    TempDir dir;
    dir.write("solo.cpp", "int main() { return 0; }\n");

    const FileScanner scanner(dir.path() / "solo.cpp");
    const auto files = scanner.scan();

    ASSERT_EQ(files.size(), 1u);
    EXPECT_EQ(files[0].filename().string(), "solo.cpp");
}

TEST(FileScanner, SingleFileTargetPathWithUnsupportedExtensionReturnsEmptyAndReportsUnsupported) {
    TempDir dir;
    dir.write("data.go", "package main\n");

    const FileScanner scanner(dir.path() / "data.go");
    std::vector<UnsupportedFile> unsupported;
    const auto files = scanner.scan(&unsupported);

    EXPECT_TRUE(files.empty());
    ASSERT_EQ(unsupported.size(), 1u);
    EXPECT_EQ(unsupported[0].extension, ".go");
}

TEST(FileScanner, UnsupportedOutParamCollectsRejectedFilesWithExtension) {
    TempDir dir;
    dir.write("main.cpp");
    dir.write("app.go");
    dir.write("widget.rs");

    const FileScanner scanner(dir.path());
    std::vector<UnsupportedFile> unsupported;
    const auto files = scanner.scan(&unsupported);

    ASSERT_EQ(files.size(), 1u);
    ASSERT_EQ(unsupported.size(), 2u);

    // Sorted by path, so app.go precedes widget.rs.
    EXPECT_EQ(unsupported[0].path.filename().string(), "app.go");
    EXPECT_EQ(unsupported[0].extension, ".go");
    EXPECT_EQ(unsupported[1].path.filename().string(), "widget.rs");
    EXPECT_EQ(unsupported[1].extension, ".rs");
}

TEST(FileScanner, ExtensionlessFilesAreExcludedFromBothResults) {
    TempDir dir;
    dir.write("main.cpp");
    dir.write("README");
    dir.write("Dockerfile");

    const FileScanner scanner(dir.path());
    std::vector<UnsupportedFile> unsupported;
    const auto files = scanner.scan(&unsupported);

    EXPECT_EQ(files.size(), 1u);
    EXPECT_TRUE(unsupported.empty());
}

TEST(FileScanner, NullUnsupportedOutParamIsSafeToPass) {
    TempDir dir;
    dir.write("main.cpp");
    dir.write("app.go");

    const FileScanner scanner(dir.path());
    const auto files = scanner.scan(nullptr);

    EXPECT_EQ(files.size(), 1u);
}

TEST(FileScanner, PrunesNodeModulesFromBothAcceptedAndUnsupported) {
    TempDir dir;
    dir.write("src/main.cpp");
    dir.write("node_modules/somepkg/index.js");
    dir.write("node_modules/somepkg/lib.cpp"); // even recognized extensions inside are pruned

    const FileScanner scanner(dir.path());
    std::vector<UnsupportedFile> unsupported;
    const auto files = scanner.scan(&unsupported);

    ASSERT_EQ(files.size(), 1u);
    EXPECT_EQ(files[0].filename().string(), "main.cpp");
    EXPECT_TRUE(unsupported.empty());
}

TEST(FileScanner, PrunesGitVendorAndBuildDirectories) {
    TempDir dir;
    dir.write("src/main.cpp");
    dir.write(".git/objects/abcd.pack");
    dir.write("vendor/lib.go");
    dir.write("build/output.js");
    dir.write("dist/bundle.js");

    const FileScanner scanner(dir.path());
    std::vector<UnsupportedFile> unsupported;
    const auto files = scanner.scan(&unsupported);

    EXPECT_EQ(files.size(), 1u);
    EXPECT_TRUE(unsupported.empty());
}

TEST(FileScanner, PrunesDotNetAndOtherToolchainBuildDirectories) {
    TempDir dir;
    dir.write("src/main.cpp");
    dir.write("bin/Debug/App.dll.meta");     // .NET build output
    dir.write("obj/Debug/App.cs.orig");      // .NET intermediate output
    dir.write("Pods/SomePod/pod.m");          // CocoaPods
    dir.write(".pytest_cache/README.md");
    dir.write(".mypy_cache/3.11/main.data.json");
    dir.write(".tox/py311/lib/six.py");
    dir.write(".gradle/caches/build.bin");
    dir.write("coverage/lcov.info");
    dir.write(".cache/babel-loader/x.js");
    dir.write("out/index.js");

    const FileScanner scanner(dir.path());
    std::vector<UnsupportedFile> unsupported;
    const auto files = scanner.scan(&unsupported);

    EXPECT_EQ(files.size(), 1u);
    EXPECT_TRUE(unsupported.empty());
}

TEST(FileScanner, UnsupportedFilesOutsidePrunedDirsAreStillCollected) {
    TempDir dir;
    dir.write("src/main.cpp");
    dir.write("src/app.go");            // real project file, not vendored
    dir.write("node_modules/pkg/x.js"); // pruned, must not appear

    const FileScanner scanner(dir.path());
    std::vector<UnsupportedFile> unsupported;
    const auto files = scanner.scan(&unsupported);

    ASSERT_EQ(files.size(), 1u);
    ASSERT_EQ(unsupported.size(), 1u);
    EXPECT_EQ(unsupported[0].path.filename().string(), "app.go");
}

TEST(FileScanner, EmptyProjectProducesEmptyResultsNotCrash) {
    TempDir dir;

    const FileScanner scanner(dir.path());
    std::vector<UnsupportedFile> unsupported;
    const auto files = scanner.scan(&unsupported);

    EXPECT_TRUE(files.empty());
    EXPECT_TRUE(unsupported.empty());
}
