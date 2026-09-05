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

TEST(FileScanner, ScanWithoutOutParamBehavesExactlyAsBefore) {
    TempDir dir;
    dir.write("main.cpp");
    dir.write("app.go");

    const FileScanner scanner(dir.path());
    const auto files = scanner.scan();

    ASSERT_EQ(files.size(), 1u);
    EXPECT_EQ(files[0].filename().string(), "main.cpp");
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
