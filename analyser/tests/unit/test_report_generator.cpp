// Unit tests for ReportGenerator — specifically the Phase 4 JSON export
// additions (toJson/saveJsonToFile, P0-1/P0-2 from the competitive R&D
// report backlog).
 
#include "report/ReportGenerator.h"
 
#include <gtest/gtest.h>
 
#include <cstdlib>
#include <fstream>
#include <sstream>
 
using namespace cma;
 
namespace {
 
ProjectMetrics makeEmptyProject() {
    return ProjectMetrics{};
}
 
FileMetrics makeFileWithOneFunction(const std::string& fnName, int startLine, int endLine) {
    FileMetrics fm;
    fm.totalLines = endLine;
    fm.codeLines = endLine;
    FunctionInfo fn;
    fn.name = fnName;
    fn.startLine = startLine;
    fn.endLine = endLine;
    fm.functions.push_back(fn);
    return fm;
}
 
bool isBalanced(const std::string& json) {
    int braces = 0, brackets = 0;
    bool inString = false;
    bool escaped = false;
    for (char c : json) {
        if (escaped) { escaped = false; continue; }
        if (c == '\\' && inString) { escaped = true; continue; }
        if (c == '"') { inString = !inString; continue; }
        if (inString) continue;
        if (c == '{') ++braces;
        if (c == '}') --braces;
        if (c == '[') ++brackets;
        if (c == ']') --brackets;
    }
    return braces == 0 && brackets == 0 && !inString;
}
 
} // namespace
 
TEST(ReportGeneratorJson, EmptyProjectProducesBalancedStructure) {
    const auto json = ReportGenerator::toJson(makeEmptyProject(), {});
    EXPECT_TRUE(isBalanced(json));
    EXPECT_NE(json.find("\"project\""), std::string::npos);
    EXPECT_NE(json.find("\"files\": []"), std::string::npos);
}
 
TEST(ReportGeneratorJson, SingleFileProducesBalancedStructure) {
    ProjectMetrics pm;
    pm.filesAnalyzed = 1;
    pm.functionCount = 1;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("foo.cpp", makeFileWithOneFunction("foo", 1, 5));
 
    const auto json = ReportGenerator::toJson(pm, files);
    EXPECT_TRUE(isBalanced(json));
}
 
TEST(ReportGeneratorJson, MultiFileProducesBalancedStructure) {
    ProjectMetrics pm;
    pm.filesAnalyzed = 3;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("a.cpp", makeFileWithOneFunction("a", 1, 3));
    files.emplace_back("b.py",  makeFileWithOneFunction("b", 1, 3));
    files.emplace_back("c.java", makeFileWithOneFunction("c", 1, 3));
 
    const auto json = ReportGenerator::toJson(pm, files);
    EXPECT_TRUE(isBalanced(json));
    EXPECT_NE(json.find("\"a.cpp\""), std::string::npos);
    EXPECT_NE(json.find("\"b.py\""), std::string::npos);
    EXPECT_NE(json.find("\"c.java\""), std::string::npos);
}
 
TEST(ReportGeneratorJson, ProjectFieldsPresentWithCorrectValues) {
    ProjectMetrics pm;
    pm.filesAnalyzed = 5;
    pm.totalLines = 100;
    pm.functionCount = 12;
    pm.cyclomaticComplexity = 30;
 
    const auto json = ReportGenerator::toJson(pm, {});
    EXPECT_NE(json.find("\"filesAnalyzed\": 5"), std::string::npos);
    EXPECT_NE(json.find("\"totalLines\": 100"), std::string::npos);
    EXPECT_NE(json.find("\"functionCount\": 12"), std::string::npos);
    EXPECT_NE(json.find("\"cyclomaticComplexity\": 30"), std::string::npos);
}
 
TEST(ReportGeneratorJson, PerFileBreakdownIncludesPathAndMetrics) {
    ProjectMetrics pm;
    std::vector<std::pair<std::string, FileMetrics>> files;
    FileMetrics fm;
    fm.totalLines = 42;
    fm.loopCount = 3;
    files.emplace_back("src/widget.cpp", fm);
 
    const auto json = ReportGenerator::toJson(pm, files);
    EXPECT_NE(json.find("\"path\": \"src/widget.cpp\""), std::string::npos);
    EXPECT_NE(json.find("\"totalLines\": 42"), std::string::npos);
    EXPECT_NE(json.find("\"loopCount\": 3"), std::string::npos);
}
 
TEST(ReportGeneratorJson, FunctionsArraySerializesNameAndLines) {
    ProjectMetrics pm;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("f.cpp", makeFileWithOneFunction("processOrder", 10, 20));
 
    const auto json = ReportGenerator::toJson(pm, files);
    EXPECT_NE(json.find("\"name\": \"processOrder\""), std::string::npos);
    EXPECT_NE(json.find("\"startLine\": 10"), std::string::npos);
    EXPECT_NE(json.find("\"endLine\": 20"), std::string::npos);
    EXPECT_NE(json.find("\"lineCount\": 11"), std::string::npos);
}
 
TEST(ReportGeneratorJson, ClassesArraySerializesEachKindAsLowercaseString) {
    ProjectMetrics pm;
    FileMetrics fm;
    ClassInfo c1; c1.name = "Widget"; c1.kind = ClassInfo::Kind::CLASS;
    ClassInfo c2; c2.name = "Point";  c2.kind = ClassInfo::Kind::STRUCT;
    ClassInfo c3; c3.name = "Color";  c3.kind = ClassInfo::Kind::ENUM;
    ClassInfo c4; c4.name = "utils";  c4.kind = ClassInfo::Kind::NAMESPACE;
    fm.classes = {c1, c2, c3, c4};
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("f.cpp", fm);
 
    const auto json = ReportGenerator::toJson(pm, files);
    EXPECT_NE(json.find("\"kind\": \"class\""), std::string::npos);
    EXPECT_NE(json.find("\"kind\": \"struct\""), std::string::npos);
    EXPECT_NE(json.find("\"kind\": \"enum\""), std::string::npos);
    EXPECT_NE(json.find("\"kind\": \"namespace\""), std::string::npos);
}
 
TEST(ReportGeneratorJson, ZeroFunctionsProducesEmptyStringNotTextSentinel) {
    ProjectMetrics pm;
    const auto json = ReportGenerator::toJson(pm, {});
    EXPECT_EQ(json.find("(none)"), std::string::npos);
    EXPECT_NE(json.find("\"longestFunctionName\": \"\""), std::string::npos);
    EXPECT_NE(json.find("\"longestFunctionLines\": 0"), std::string::npos);
}
 
TEST(ReportGeneratorJson, EscapesQuotesInFilePath) {
    ProjectMetrics pm;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("has\"quote.cpp", FileMetrics{});
 
    const auto json = ReportGenerator::toJson(pm, files);
    EXPECT_TRUE(isBalanced(json));
    EXPECT_NE(json.find("has\\\"quote.cpp"), std::string::npos);
}
 
TEST(ReportGeneratorJson, EscapesBackslashInFilePath) {
    ProjectMetrics pm;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("C:\\Users\\dev\\file.cpp", FileMetrics{});
 
    const auto json = ReportGenerator::toJson(pm, files);
    EXPECT_TRUE(isBalanced(json));
    EXPECT_NE(json.find("C:\\\\Users\\\\dev\\\\file.cpp"), std::string::npos);
}
 
TEST(ReportGeneratorJson, EscapesQuoteAndBackslashTogetherOneQuotePerSourceStyle) {
    ProjectMetrics pm;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("has\"quote_and\\backslash\\file.cpp", FileMetrics{});
 
    const auto json = ReportGenerator::toJson(pm, files);
    EXPECT_TRUE(isBalanced(json));
    EXPECT_NE(json.find("has\\\"quote_and\\\\backslash\\\\file.cpp"), std::string::npos);
}
 
TEST(ReportGeneratorJson, EscapesNewlineAndTabInFunctionName) {
    ProjectMetrics pm;
    FileMetrics fm = makeFileWithOneFunction("weird\nname\twith\rcontrol", 1, 2);
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("f.cpp", fm);
 
    const auto json = ReportGenerator::toJson(pm, files);
    EXPECT_TRUE(isBalanced(json));
    EXPECT_NE(json.find("\\n"), std::string::npos);
    EXPECT_NE(json.find("\\t"), std::string::npos);
    EXPECT_NE(json.find("\\r"), std::string::npos);
}
 
TEST(ReportGeneratorJson, SaveJsonToFileProducesSameContentAsToJson) {
    ProjectMetrics pm;
    pm.filesAnalyzed = 2;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("a.cpp", makeFileWithOneFunction("a", 1, 3));
 
    const auto expected = ReportGenerator::toJson(pm, files);
 
    const std::string path = "/tmp/cma_test_report_generator_output.json";
    ASSERT_TRUE(ReportGenerator::saveJsonToFile(pm, files, path));
 
    std::ifstream in(path);
    ASSERT_TRUE(in.is_open());
    std::ostringstream buf;
    buf << in.rdbuf();
    EXPECT_EQ(buf.str(), expected);
 
    std::remove(path.c_str());
}
 
TEST(ReportGeneratorJson, SaveJsonToFileFailsOnUnwritablePath) {
    ProjectMetrics pm;
    const bool ok = ReportGenerator::saveJsonToFile(
        pm, {}, "/nonexistent_directory_xyz/report.json");
    EXPECT_FALSE(ok);
}
 
TEST(ReportGeneratorJson, TextReportStillPrintsNoneSentinelUnaffectedByJsonWork) {
    ProjectMetrics pm;
    std::ostringstream out;
    ReportGenerator::printSummary(pm, out);
    EXPECT_NE(out.str().find("Longest Function : (none)"), std::string::npos);
}

// -- Phase 1: language field + byLanguage/scoreBreakdown --

TEST(ReportGeneratorJson, FileEntryIncludesLanguageKey) {
    ProjectMetrics pm;
    FileMetrics fm;
    fm.language = "python";
    fm.totalLines = 10;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("script.py", fm);

    const auto json = ReportGenerator::toJson(pm, files);
    EXPECT_TRUE(isBalanced(json));
    EXPECT_NE(json.find("\"language\": \"python\""), std::string::npos);
}

TEST(ReportGeneratorJson, ByLanguageBlockPresentEvenWithEmptyProject) {
    const auto json = ReportGenerator::toJson(makeEmptyProject(), {});
    EXPECT_TRUE(isBalanced(json));
    EXPECT_NE(json.find("\"byLanguage\": []"), std::string::npos);
}

TEST(ReportGeneratorJson, ByLanguageBlockSerializesAggregateFields) {
    ProjectMetrics pm;
    LanguageAggregate cpp;
    cpp.language             = "cpp";
    cpp.fileCount            = 2;
    cpp.codeLines            = 120;
    cpp.cyclomaticComplexity = 15;
    cpp.avgFunctionLength    = 8.5;
    pm.byLanguage.push_back(cpp);

    LanguageAggregate py;
    py.language  = "python";
    py.fileCount = 1;
    py.codeLines = 40;
    pm.byLanguage.push_back(py);

    const auto json = ReportGenerator::toJson(pm, {});
    EXPECT_TRUE(isBalanced(json));
    EXPECT_NE(json.find("\"language\": \"cpp\""), std::string::npos);
    EXPECT_NE(json.find("\"fileCount\": 2"), std::string::npos);
    EXPECT_NE(json.find("\"codeLines\": 120"), std::string::npos);
    EXPECT_NE(json.find("\"language\": \"python\""), std::string::npos);
    EXPECT_NE(json.find("\"fileCount\": 1"), std::string::npos);
}

TEST(ReportGeneratorJson, ScoreBreakdownOnlyPresentWithHotspotsArg) {
    ProjectMetrics pm;
    pm.codeLines = 500;
    pm.cyclomaticComplexity = 60;
    pm.avgFunctionLength = 12;
    std::vector<std::pair<std::string, FileMetrics>> files;

    const auto json2 = ReportGenerator::toJson(pm, files);
    EXPECT_EQ(json2.find("\"scoreBreakdown\""), std::string::npos);

    DependencyGraph graph;
    const auto json3 = ReportGenerator::toJson(pm, files, graph);
    EXPECT_EQ(json3.find("\"scoreBreakdown\""), std::string::npos);

    HotspotReport hotspots;
    hotspots.gitAvailable = true;
    const auto json4 = ReportGenerator::toJson(pm, files, graph, hotspots);
    EXPECT_TRUE(isBalanced(json4));
    EXPECT_NE(json4.find("\"scoreBreakdown\""), std::string::npos);
    EXPECT_NE(json4.find("\"complexityDensity\""), std::string::npos);
    EXPECT_NE(json4.find("\"avgFunctionLength\": 100"), std::string::npos);
}
