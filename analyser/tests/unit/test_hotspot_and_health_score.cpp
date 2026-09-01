// Unit tests for the Phase 4 Sprint 3 features (P0-4 git hotspot scoring
// from the competitive R&D report backlog, plus the Code Health Score
// and shareable SVG badge from CMA_FEATURE_DIFFERENTIATION_ANALYSIS.md):
// GitHistory's pure log parser, MetricsEngine::buildHotspotReport(),
// computeHealthScore(), and ReportGenerator's badge/hotspot-JSON
// additions.
 
#include "lexer/CppLexer.h"
#include "metrics/HotspotReport.h"
#include "metrics/MetricsEngine.h"
#include "parser/CppParser.h"
#include "report/HealthScore.h"
#include "report/ReportGenerator.h"
#include "vcs/GitHistory.h"
 
#include <gtest/gtest.h>
 
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
 
using namespace cma;
namespace fs = std::filesystem;
 
namespace {
 
FileMetrics analyzeCpp(const std::string& src) {
    CppLexer lexer(src);
    auto tokens = lexer.tokenize();
    int lineCount = 1;
    for (char c : src) if (c == '\n') ++lineCount;
    CppParser parser(tokens, lineCount);
    return parser.analyze();
}
 
class TempGitRepo {
public:
    TempGitRepo() {
        m_path = fs::temp_directory_path() /
                 fs::path("cma_hotspot_test_" + std::to_string(::getpid()) + "_" +
                           std::to_string(reinterpret_cast<std::uintptr_t>(this)));
        fs::create_directories(m_path);
        run("git init -q");
        run("git config user.email test@test.com");
        run("git config user.name Test");
    }
 
    ~TempGitRepo() {
        std::error_code ec;
        fs::remove_all(m_path, ec);
    }
 
    TempGitRepo(const TempGitRepo&) = delete;
    TempGitRepo& operator=(const TempGitRepo&) = delete;
 
    void writeAndCommit(const std::string& relPath, const std::string& content,
                         const std::string& message) {
        const auto full = m_path / relPath;
        fs::create_directories(full.parent_path());
        std::ofstream out(full, std::ios::trunc);
        out << content;
        out.close();
        run("git add -A");
        run("git commit -q -m \"" + message + "\"");
    }
 
    [[nodiscard]] const fs::path& path() const noexcept { return m_path; }
 
private:
    void run(const std::string& cmd) const {
        const std::string full = "cd \"" + m_path.string() + "\" && " + cmd + " > /dev/null 2>&1";
     if (std::system(full.c_str()) != 0) {
       // Best-effort test helper; a failed git command here surfaces as a
      // downstream test assertion failure rather than here.
     }
    }
 
    fs::path m_path;
};
 
} // namespace
 
TEST(GitLogParsing, SingleCommitSingleFile) {
    const std::string raw = "__CMA_COMMIT__\n1\t2\tfoo.cpp\n";
    const auto churn = parseGitLogOutput(raw);
    ASSERT_EQ(churn.count("foo.cpp"), 1u);
    EXPECT_EQ(churn.at("foo.cpp").commitCount, 1);
    EXPECT_EQ(churn.at("foo.cpp").linesAdded, 1);
    EXPECT_EQ(churn.at("foo.cpp").linesDeleted, 2);
}
 
TEST(GitLogParsing, MultipleCommitsSameFileAccumulatesCommitCount) {
    const std::string raw =
        "__CMA_COMMIT__\n3\t0\tfoo.cpp\n\n__CMA_COMMIT__\n1\t1\tfoo.cpp\n\n__CMA_COMMIT__\n0\t2\tfoo.cpp\n";
    const auto churn = parseGitLogOutput(raw);
    ASSERT_EQ(churn.count("foo.cpp"), 1u);
    EXPECT_EQ(churn.at("foo.cpp").commitCount, 3);
    EXPECT_EQ(churn.at("foo.cpp").linesAdded, 4);
    EXPECT_EQ(churn.at("foo.cpp").linesDeleted, 3);
}
 
TEST(GitLogParsing, BinaryFileNumstatDashesTreatedAsZero) {
    const std::string raw = "__CMA_COMMIT__\n-\t-\timage.png\n";
    const auto churn = parseGitLogOutput(raw);
    ASSERT_EQ(churn.count("image.png"), 1u);
    EXPECT_EQ(churn.at("image.png").commitCount, 1);
    EXPECT_EQ(churn.at("image.png").linesAdded, 0);
    EXPECT_EQ(churn.at("image.png").linesDeleted, 0);
}
 
TEST(GitLogParsing, SimpleRenameResolvesToNewPath) {
    const std::string raw = "__CMA_COMMIT__\n5\t2\told/path.h => new/path.h\n";
    const auto churn = parseGitLogOutput(raw);
    EXPECT_EQ(churn.count("old/path.h"), 0u);
    ASSERT_EQ(churn.count("new/path.h"), 1u);
    EXPECT_EQ(churn.at("new/path.h").commitCount, 1);
}
 
TEST(GitLogParsing, CompactBraceRenameResolvesToNewPath) {
    const std::string raw = "__CMA_COMMIT__\n5\t2\tsrc/{old.h => new.h}\n";
    const auto churn = parseGitLogOutput(raw);
    ASSERT_EQ(churn.count("src/new.h"), 1u);
    EXPECT_EQ(churn.count("src/old.h"), 0u);
}
 
TEST(GitLogParsing, EmptyOutputProducesEmptyMap) {
    const auto churn = parseGitLogOutput("");
    EXPECT_TRUE(churn.empty());
}
 
TEST(GitLogParsing, MultipleFilesInOneCommitEachCounted) {
    const std::string raw = "__CMA_COMMIT__\n1\t0\ta.cpp\n2\t0\tb.cpp\n";
    const auto churn = parseGitLogOutput(raw);
    ASSERT_EQ(churn.count("a.cpp"), 1u);
    ASSERT_EQ(churn.count("b.cpp"), 1u);
    EXPECT_EQ(churn.at("a.cpp").commitCount, 1);
    EXPECT_EQ(churn.at("b.cpp").commitCount, 1);
}
 
TEST(GitHistoryCollect, ReturnsFalseForNonGitDirectory) {
    const auto tmp = fs::temp_directory_path() / "cma_not_a_git_repo_test";
    fs::create_directories(tmp);
    GitHistory git(tmp);
    EXPECT_FALSE(git.collect());
    EXPECT_FALSE(git.available());
    EXPECT_TRUE(git.churn().empty());
    fs::remove_all(tmp);
}
 
TEST(GitHistoryCollect, ReturnsTrueAndPopulatesChurnForRealRepo) {
    TempGitRepo repo;
    repo.writeAndCommit("a.cpp", "int a() { return 1; }\n", "commit 1");
    repo.writeAndCommit("a.cpp", "int a() { return 1; }\nint b() { return 2; }\n", "commit 2");
 
    GitHistory git(repo.path());
    ASSERT_TRUE(git.collect());
    EXPECT_TRUE(git.available());
 
    const auto key = canonicalPathKey(repo.path() / "a.cpp");
    ASSERT_EQ(git.churn().count(key), 1u);
    EXPECT_EQ(git.churn().at(key).commitCount, 2);
}
 
TEST(GitHistoryCollect, WorksFromSubdirectoryOfRepo) {
    TempGitRepo repo;
    repo.writeAndCommit("sub/a.cpp", "int a() { return 1; }\n", "commit 1");
 
    GitHistory git(repo.path() / "sub");
    ASSERT_TRUE(git.collect());
    const auto key = canonicalPathKey(repo.path() / "sub" / "a.cpp");
    EXPECT_EQ(git.churn().count(key), 1u);
}
 
TEST(HotspotReportBuild, GitUnavailableReturnsEmptyWithFalseFlag) {
    const auto tmp = fs::temp_directory_path() / "cma_hotspot_nogit_test";
    fs::create_directories(tmp);
    GitHistory git(tmp);
    (void)git.collect();
 
    MetricsEngine engine;
    engine.addFile("x.cpp", analyzeCpp("int f() { return 1; }\n"));
 
    const auto report = engine.buildHotspotReport(git);
    EXPECT_FALSE(report.gitAvailable);
    EXPECT_TRUE(report.files.empty());
    fs::remove_all(tmp);
}
 
TEST(HotspotReportBuild, RanksModeratelyComplexHighChurnAboveMostComplexLowChurn) {
    TempGitRepo repo;
    repo.writeAndCommit("foo.cpp", "int f() { return 1; }\n", "v1");
    repo.writeAndCommit("foo.cpp", "int f() { return 1; }\nint g() { return 2; }\n", "v2");
    repo.writeAndCommit("foo.cpp",
        "int f() { return 1; }\nint g() { return 2; }\nint h(int x) { if (x) return 1; return 0; }\n",
        "v3");
    repo.writeAndCommit("bar.cpp",
        "int classify(int x) {\n"
        "    if (x < 0) { if (x < -5) { return -2; } return -1; }\n"
        "    return 0;\n"
        "}\n",
        "v1-only");
 
    GitHistory git(repo.path());
    ASSERT_TRUE(git.collect());
 
    MetricsEngine engine;
    engine.addFile((repo.path() / "foo.cpp").string(),
                    analyzeCpp("int f() { return 1; }\nint g() { return 2; }\n"
                               "int h(int x) { if (x) return 1; return 0; }\n"));
    engine.addFile((repo.path() / "bar.cpp").string(),
                    analyzeCpp("int classify(int x) {\n"
                               "    if (x < 0) { if (x < -5) { return -2; } return -1; }\n"
                               "    return 0;\n"
                               "}\n"));
 
    const auto report = engine.buildHotspotReport(git);
    ASSERT_TRUE(report.gitAvailable);
    ASSERT_EQ(report.files.size(), 2u);
 
    EXPECT_EQ(report.files[0].path.find("foo.cpp") != std::string::npos, true);
    EXPECT_GT(report.files[0].hotspotScore, report.files[1].hotspotScore);
}
 
TEST(HotspotReportBuild, TiedScoresBreakByPathForDeterminism) {
    const auto tmp = fs::temp_directory_path() / "cma_hotspot_nogit_tiebreak_test";
    fs::create_directories(tmp);
    GitHistory git(tmp);
    (void)git.collect();
 
    MetricsEngine engine;
    engine.addFile("zzz.cpp", analyzeCpp("int f() { return 1; }\n"));
    engine.addFile("aaa.cpp", analyzeCpp("int f() { return 1; }\n"));
    const auto report = engine.buildHotspotReport(git);
    EXPECT_TRUE(report.files.empty());
    fs::remove_all(tmp);
}
 
TEST(HealthScore, EmptyProjectNeverDividesByZero) {
    ProjectMetrics m;
    const auto hs = computeHealthScore(m);
    EXPECT_GE(hs.score, 0.0);
    EXPECT_LE(hs.score, 100.0);
}
 
TEST(HealthScore, LowComplexityDensityShortFunctionsGoodComments) {
    ProjectMetrics good;
    good.codeLines = 1000;
    good.cyclomaticComplexity = 100;
    good.avgFunctionLength = 10;
    good.commentLines = 300;
    good.todoCount = 0;
    good.maxNestingDepth = 2;
    const auto hs = computeHealthScore(good);
    EXPECT_GE(hs.score, 90.0);
    EXPECT_EQ(hs.grade, 'A');
}
 
TEST(HealthScore, HighComplexityDensityLongFunctionsNoComments) {
    ProjectMetrics bad;
    bad.codeLines = 1000;
    bad.cyclomaticComplexity = 700;
    bad.avgFunctionLength = 90;
    bad.commentLines = 0;
    bad.todoCount = 80;
    bad.maxNestingDepth = 10;
    const auto hs = computeHealthScore(bad);
    EXPECT_LE(hs.score, 10.0);
    EXPECT_EQ(hs.grade, 'F');
}
 
TEST(HealthScore, GradeBandsMatchDocumentedThresholds) {
    ProjectMetrics m;
    m.codeLines = 1000;
    m.cyclomaticComplexity = 150;
    m.avgFunctionLength = 15;
    m.commentLines = 200;
    m.todoCount = 10;
    m.maxNestingDepth = 3;
    const auto hs = computeHealthScore(m);
    EXPECT_NEAR(hs.score, 100.0, 0.5);
    EXPECT_EQ(hs.grade, 'A');
}
 
TEST(ReportGeneratorBadge, SvgContainsScoreAndIsWellFormedTagBalance) {
    ProjectMetrics m;
    m.codeLines = 500;
    m.cyclomaticComplexity = 60;
    m.avgFunctionLength = 12;
    m.commentLines = 100;
    m.maxNestingDepth = 2;
 
    const auto svg = ReportGenerator::toBadgeSvg(m);
    EXPECT_NE(svg.find("<svg"), std::string::npos);
    EXPECT_NE(svg.find("</svg>"), std::string::npos);
    EXPECT_NE(svg.find("code health"), std::string::npos);
 
    const auto health = computeHealthScore(m);
    std::ostringstream expected;
    expected << static_cast<int>(health.score + 0.5) << "/100";
    EXPECT_NE(svg.find(expected.str()), std::string::npos);
}
 
TEST(ReportGeneratorBadge, DifferentGradesProduceDifferentColors) {
    ProjectMetrics good;
    good.codeLines = 1000; good.cyclomaticComplexity = 100; good.avgFunctionLength = 10;
    good.commentLines = 300; good.maxNestingDepth = 2;
 
    ProjectMetrics bad;
    bad.codeLines = 1000; bad.cyclomaticComplexity = 700; bad.avgFunctionLength = 90;
    bad.commentLines = 0; bad.todoCount = 80; bad.maxNestingDepth = 10;
 
    const auto svgGood = ReportGenerator::toBadgeSvg(good);
    const auto svgBad  = ReportGenerator::toBadgeSvg(bad);
    EXPECT_NE(svgGood.find("#4c1"), std::string::npos);
    EXPECT_NE(svgBad.find("#e05d44"), std::string::npos);
}
 
TEST(ReportGeneratorBadge, SaveBadgeToFileMatchesToBadgeSvg) {
    ProjectMetrics m;
    m.codeLines = 200; m.cyclomaticComplexity = 30; m.avgFunctionLength = 15;
    const auto expected = ReportGenerator::toBadgeSvg(m);
 
    const std::string path = "/tmp/cma_test_badge_output.svg";
    ASSERT_TRUE(ReportGenerator::saveBadgeToFile(m, path));
 
    std::ifstream in(path);
    ASSERT_TRUE(in.is_open());
    std::ostringstream buf;
    buf << in.rdbuf();
    EXPECT_EQ(buf.str(), expected);
    std::remove(path.c_str());
}
 
TEST(ReportGeneratorBadge, SaveBadgeToFileFailsOnUnwritablePath) {
    ProjectMetrics m;
    EXPECT_FALSE(ReportGenerator::saveBadgeToFile(m, "/nonexistent_dir_xyz/badge.svg"));
}
 
TEST(ReportGeneratorJsonHotspots, FourArgOutputIncludesHealthScoreAndHotspotsBlock) {
    ProjectMetrics pm;
    pm.codeLines = 500; pm.cyclomaticComplexity = 60; pm.avgFunctionLength = 12;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("main.cpp", FileMetrics{});
 
    DependencyGraph graph;
    FileCoupling fc; fc.path = "main.cpp";
    graph.files.push_back(fc);
 
    HotspotReport hotspots;
    hotspots.gitAvailable = true;
    FileHotspot fh; fh.path = "main.cpp"; fh.cyclomaticComplexity = 5; fh.commitCount = 3;
    fh.hotspotScore = 42.0;
    hotspots.files.push_back(fh);
 
    const auto json = ReportGenerator::toJson(pm, files, graph, hotspots);
    EXPECT_NE(json.find("\"healthScore\""), std::string::npos);
    EXPECT_NE(json.find("\"healthGrade\""), std::string::npos);
    EXPECT_NE(json.find("\"hotspots\""), std::string::npos);
    EXPECT_NE(json.find("\"gitAvailable\": true"), std::string::npos);
    EXPECT_NE(json.find("\"hotspotScore\": 42"), std::string::npos);
}
 
TEST(ReportGeneratorJsonHotspots, TwoAndThreeArgOutputNeverContainHealthOrHotspotKeys) {
    ProjectMetrics pm;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("main.cpp", FileMetrics{});
 
    const auto json2 = ReportGenerator::toJson(pm, files);
    EXPECT_EQ(json2.find("\"healthScore\""), std::string::npos);
    EXPECT_EQ(json2.find("\"hotspots\""), std::string::npos);
 
    DependencyGraph graph;
    FileCoupling fc; fc.path = "main.cpp";
    graph.files.push_back(fc);
    const auto json3 = ReportGenerator::toJson(pm, files, graph);
    EXPECT_EQ(json3.find("\"healthScore\""), std::string::npos);
    EXPECT_EQ(json3.find("\"hotspots\""), std::string::npos);
}
 
TEST(ReportGeneratorJsonHotspots, GitUnavailableProducesEmptyTopFilesArray) {
    ProjectMetrics pm;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("main.cpp", FileMetrics{});
    DependencyGraph graph;
    FileCoupling fc; fc.path = "main.cpp";
    graph.files.push_back(fc);
 
    HotspotReport hotspots;
    const auto json = ReportGenerator::toJson(pm, files, graph, hotspots);
    EXPECT_NE(json.find("\"gitAvailable\": false"), std::string::npos);
    EXPECT_NE(json.find("\"topFiles\": []"), std::string::npos);
}
 
TEST(ReportGeneratorJsonHotspots, SaveJsonToFileFourArgMatchesToJson) {
    ProjectMetrics pm;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("main.cpp", FileMetrics{});
    DependencyGraph graph;
    FileCoupling fc; fc.path = "main.cpp";
    graph.files.push_back(fc);
    HotspotReport hotspots;
 
    const auto expected = ReportGenerator::toJson(pm, files, graph, hotspots);
    const std::string path = "/tmp/cma_test_hotspot_json_output.json";
    ASSERT_TRUE(ReportGenerator::saveJsonToFile(pm, files, graph, hotspots, path));
 
    std::ifstream in(path);
    ASSERT_TRUE(in.is_open());
    std::ostringstream buf;
    buf << in.rdbuf();
    EXPECT_EQ(buf.str(), expected);
    std::remove(path.c_str());
}
 
