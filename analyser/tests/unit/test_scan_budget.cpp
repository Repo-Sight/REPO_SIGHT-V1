// Unit tests for time-budgeted ("partial") scans: the deterministic sampling order, the loop
// deadline, MetricsEngine::sortInputsByPath(), the indexed dependency-graph lookup, and the
// "partial" block of the JSON report. See include/common/ScanBudget.h.

#include "common/ScanBudget.h"
#include "metrics/MetricsEngine.h"
#include "report/ReportGenerator.h"

#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <string>
#include <thread>
#include <vector>

using namespace cma;
namespace fs = std::filesystem;

namespace {

std::vector<fs::path> samplePaths(int n) {
    std::vector<fs::path> v;
    for (int i = 0; i < n; ++i)
        v.emplace_back("src/dir" + std::to_string(i % 7) + "/file" + std::to_string(i) + ".py");
    std::sort(v.begin(), v.end());
    return v;
}

} // namespace

TEST(ScanBudgetHash, Fnv1aMatchesPublishedVectors) {
    EXPECT_EQ(fnv1a64(""), 14695981039346656037ULL);
    EXPECT_EQ(fnv1a64("a"), 0xaf63dc4c8601ec8cULL);
    EXPECT_EQ(fnv1a64("foobar"), 0x85944171f73967e8ULL);
}

TEST(ScanBudgetOrder, SamplingOrderIsAPermutationOfTheInput) {
    const auto original = samplePaths(200);
    auto shuffled = original;
    orderForSampling(shuffled);
    auto a = original;
    auto b = shuffled;
    std::sort(a.begin(), a.end());
    std::sort(b.begin(), b.end());
    EXPECT_EQ(a, b);
}

TEST(ScanBudgetOrder, SamplingOrderDoesNotDependOnInputOrder) {
    auto forward = samplePaths(200);
    auto backward = forward;
    std::reverse(backward.begin(), backward.end());
    orderForSampling(forward);
    orderForSampling(backward);
    EXPECT_EQ(forward, backward);
}

TEST(ScanBudgetOrder, SamplingOrderIsNotAlphabetical) {
    // A prefix of the sampling order must spread across directories, not sit in the first one.
    auto files = samplePaths(200);
    orderForSampling(files);
    EXPECT_FALSE(std::is_sorted(files.begin(), files.end()));
    std::vector<std::string> dirs;
    for (std::size_t i = 0; i < 20; ++i) dirs.push_back(files[i].parent_path().string());
    std::sort(dirs.begin(), dirs.end());
    dirs.erase(std::unique(dirs.begin(), dirs.end()), dirs.end());
    EXPECT_GE(dirs.size(), 4u) << "the first 20 sampled files should touch several of the 7 directories";
}

TEST(ScanBudgetDeadline, NoBudgetNeverExpires) {
    const LoopDeadline none(0);
    const LoopDeadline negative(-5);
    EXPECT_FALSE(none.enabled());
    EXPECT_FALSE(negative.enabled());
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
    EXPECT_FALSE(none.expired());
    EXPECT_FALSE(negative.expired());
}

TEST(ScanBudgetDeadline, ExpiresOnlyAfterItsLoopShareOfTheBudget) {
    const LoopDeadline generous(3'600'000);
    EXPECT_TRUE(generous.enabled());
   EXPECT_FALSE(generous.expired());

    // Loop share of a 40ms budget is 10ms: not expired right away, expired well after.
    const LoopDeadline tight(40);
    EXPECT_FALSE(tight.expired());
    std::this_thread::sleep_for(std::chrono::milliseconds(60));
    EXPECT_TRUE(tight.expired());
}

TEST(ScanBudgetEngine, SortInputsByPathUsesFilesystemPathOrdering) {
    // FileScanner sorts by std::filesystem::path ordering, which compares component by component:
    // "a/b.py" sorts BEFORE "a-b/x.py" even though '-' < '/' as raw characters.
    MetricsEngine engine;
    for (const char* p : {"z/last.py", "a-b/x.py", "a/b.py", "m/mid.py"}) engine.addFile(p, FileMetrics{});
    engine.sortInputsByPath();

    std::vector<std::string> got;
    for (const auto& [p, fm] : engine.files()) got.push_back(p);
    std::vector<std::string> want = {"a-b/x.py", "a/b.py", "m/mid.py", "z/last.py"};
    std::sort(want.begin(), want.end(), [](const std::string& l, const std::string& r) { return fs::path(l) < fs::path(r); });
    EXPECT_EQ(got, want);
    EXPECT_EQ(got.front(), "a/b.py");
}

TEST(ScanBudgetDependencyGraph, SameBasenameResolvesToFirstFileInSortedOrderExcludingSelf) {
    MetricsEngine engine;
    FileMetrics user;
    user.includeTargets = {"util.h"};
    engine.addFile("lib/a/util.h", FileMetrics{});
    engine.addFile("lib/b/util.h", FileMetrics{});
    engine.addFile("lib/b/user.cpp", user);
    // A file that includes its own basename must not resolve to itself.
    FileMetrics self;
    self.includeTargets = {"util.h"};
    engine.addFile("lib/c/util.h", self);

    const auto g = engine.buildDependencyGraph();
    auto dependsOn = [&](const std::string& p) {
        for (const auto& f : g.files)
            if (f.path == p) return f.dependsOn;
        return std::vector<std::string>{};
    };
    EXPECT_EQ(dependsOn("lib/b/user.cpp"), std::vector<std::string>{"lib/a/util.h"});
    EXPECT_EQ(dependsOn("lib/c/util.h"), std::vector<std::string>{"lib/a/util.h"});
}

TEST(ScanBudgetDependencyGraph, SubdirectoryAndDottedTargetsStillResolve) {
    MetricsEngine engine;
    FileMetrics cpp;
    cpp.includeTargets = {"common/types.h"};
    FileMetrics py;
    py.includeTargets = {"pkg.mod"};
    FileMetrics java;
    java.includeTargets = {"com.example.Util", "java.util.*"};
    engine.addFile("src/main.cpp", cpp);
    engine.addFile("include/common/types.h", FileMetrics{});
    engine.addFile("app.py", py);
    engine.addFile("pkg/mod.py", FileMetrics{});
    engine.addFile("Main.java", java);
    engine.addFile("src/com/example/Util.java", FileMetrics{});

    const auto g = engine.buildDependencyGraph();
    auto fanOut = [&](const std::string& p) {
        for (const auto& f : g.files)
            if (f.path == p) return f.fanOut;
        return -1;
    };
    EXPECT_EQ(fanOut("src/main.cpp"), 1);
    EXPECT_EQ(fanOut("app.py"), 1);
    EXPECT_EQ(fanOut("Main.java"), 1) << "the wildcard import is skipped, the concrete one resolves";
}

TEST(ScanBudgetReport, PartialBlockAppearsOnlyForPartialScans) {
    ProjectMetrics complete;
    complete.filesAnalyzed = 10;
    const std::string full = ReportGenerator::toJson(complete, {});
   EXPECT_EQ(full.find("\"partial\""), std::string::npos) << "complete scans keep their JSON unchanged";

    ProjectMetrics partial = complete;
    partial.partialScan = true;
    partial.filesDiscovered = 400;
    const std::string json = ReportGenerator::toJson(partial, {});
    EXPECT_NE(json.find("\"partial\": {"), std::string::npos);
    EXPECT_NE(json.find("\"filesScanned\": 10"), std::string::npos);
    EXPECT_NE(json.find("\"filesTotal\": 400"), std::string::npos);
    EXPECT_NE(json.find("\"reason\": \"time_budget\""), std::string::npos);
}
