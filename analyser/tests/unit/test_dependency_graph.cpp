// Unit tests for the Phase 4 Sprint 2 dependency-graph feature (P0-6 from
// the competitive R&D report backlog): per-language include/import target
// extraction, MetricsEngine::buildDependencyGraph()'s resolution
// heuristic, and the DependencyGraph-aware ReportGenerator JSON
// overloads.
 
#include "lexer/CppLexer.h"
#include "lexer/JavaLexer.h"
#include "lexer/PythonLexer.h"
#include "metrics/DependencyGraph.h"
#include "metrics/MetricsEngine.h"
#include "parser/CppParser.h"
#include "parser/JavaParser.h"
#include "parser/PythonParser.h"
#include "report/ReportGenerator.h"
 
#include <gtest/gtest.h>
 
#include <algorithm>
#include <cstdio>
#include <fstream>
#include <sstream>
 
using namespace cma;
 
namespace {
 
FileMetrics analyzeCpp(const std::string& src) {
    CppLexer lexer(src);
    auto tokens = lexer.tokenize();
    int lineCount = 1;
    for (char c : src) if (c == '\n') ++lineCount;
    CppParser parser(tokens, lineCount);
    return parser.analyze();
}
 
FileMetrics analyzePython(const std::string& src) {
    PythonLexer lexer(src);
    auto tokens = lexer.tokenize();
    int lineCount = 1;
    for (char c : src) if (c == '\n') ++lineCount;
    PythonParser parser(tokens, lineCount);
    return parser.analyze();
}
 
FileMetrics analyzeJava(const std::string& src) {
    JavaLexer lexer(src);
    auto tokens = lexer.tokenize();
    int lineCount = 1;
    for (char c : src) if (c == '\n') ++lineCount;
    JavaParser parser(tokens, lineCount);
    return parser.analyze();
}
 
const FileCoupling* find(const DependencyGraph& g, const std::string& path) {
    auto it = std::find_if(g.files.begin(), g.files.end(),
                            [&](const FileCoupling& fc) { return fc.path == path; });
    return it == g.files.end() ? nullptr : &*it;
}
 
} // namespace
 
TEST(DependencyGraphExtraction, CppIncludeTargetsSizeMatchesIncludeCount) {
    auto fm = analyzeCpp("#include \"foo.h\"\n#include <vector>\n#include \"bar.h\"\n");
    EXPECT_EQ(fm.includeCount, 3);
    ASSERT_EQ(fm.includeTargets.size(), 3u);
    EXPECT_EQ(fm.includeTargets[0], "foo.h");
    EXPECT_EQ(fm.includeTargets[1], "");
    EXPECT_EQ(fm.includeTargets[2], "bar.h");
}
 
TEST(DependencyGraphExtraction, CppQuotedIncludeWithSubdirectoryCaptured) {
    auto fm = analyzeCpp("#include \"sub/foo.h\"\n");
    ASSERT_EQ(fm.includeTargets.size(), 1u);
    EXPECT_EQ(fm.includeTargets[0], "sub/foo.h");
}
 
TEST(DependencyGraphExtraction, PythonImportTargetsSizeMatchesIncludeCount) {
    auto fm = analyzePython("import a.b.c\nfrom pkg import util\nimport os\n");
    EXPECT_EQ(fm.includeCount, 3);
    ASSERT_EQ(fm.includeTargets.size(), 3u);
    EXPECT_EQ(fm.includeTargets[0], "a.b.c");
    EXPECT_EQ(fm.includeTargets[1], "pkg");
    EXPECT_EQ(fm.includeTargets[2], "os");
}
 
TEST(DependencyGraphExtraction, PythonCommaSeparatedImportCapturesFirstSegmentOnly) {
    auto fm = analyzePython("import os, sys\n");
    ASSERT_EQ(fm.includeTargets.size(), 1u);
    EXPECT_EQ(fm.includeTargets[0], "os");
}
 
TEST(DependencyGraphExtraction, JavaImportTargetsSizeMatchesIncludeCount) {
    auto fm = analyzeJava(
        "import com.example.Util;\n"
        "import java.util.*;\n");
    EXPECT_EQ(fm.includeCount, 2);
    ASSERT_EQ(fm.includeTargets.size(), 2u);
    EXPECT_EQ(fm.includeTargets[0], "com.example.Util");
    EXPECT_EQ(fm.includeTargets[1], "java.util.*");
}
 
TEST(DependencyGraphExtraction, JavaStaticImportSkipsStaticKeyword) {
    auto fm = analyzeJava("import static org.junit.Assert.assertEquals;\n");
    ASSERT_EQ(fm.includeTargets.size(), 1u);
    EXPECT_EQ(fm.includeTargets[0], "org.junit.Assert.assertEquals");
}
 
TEST(DependencyGraphResolution, EveryAnalyzedFileAppearsEvenWithZeroEdges) {
    MetricsEngine engine;
    engine.addFile("a.cpp", FileMetrics{});
    engine.addFile("b.cpp", FileMetrics{});
    const auto graph = engine.buildDependencyGraph();
    ASSERT_EQ(graph.files.size(), 2u);
    EXPECT_NE(find(graph, "a.cpp"), nullptr);
    EXPECT_NE(find(graph, "b.cpp"), nullptr);
}
 
TEST(DependencyGraphResolution, CppQuotedIncludeResolvesToAnalyzedFile) {
    MetricsEngine engine;
    FileMetrics main;
    main.includeTargets = {"foo.h"};
    engine.addFile("src/main.cpp", main);
    engine.addFile("src/foo.h", FileMetrics{});
 
    const auto graph = engine.buildDependencyGraph();
    const auto* mainFc = find(graph, "src/main.cpp");
    ASSERT_NE(mainFc, nullptr);
    EXPECT_EQ(mainFc->fanOut, 1);
    ASSERT_EQ(mainFc->dependsOn.size(), 1u);
    EXPECT_EQ(mainFc->dependsOn[0], "src/foo.h");
 
    const auto* fooFc = find(graph, "src/foo.h");
    ASSERT_NE(fooFc, nullptr);
    EXPECT_EQ(fooFc->fanIn, 1);
}
 
TEST(DependencyGraphResolution, EmptyTargetNeverResolvesToAnything) {
    MetricsEngine engine;
    FileMetrics main;
    main.includeTargets = {""};
    engine.addFile("main.cpp", main);
    engine.addFile("other.cpp", FileMetrics{});
 
    const auto graph = engine.buildDependencyGraph();
    const auto* mainFc = find(graph, "main.cpp");
    ASSERT_NE(mainFc, nullptr);
    EXPECT_EQ(mainFc->fanOut, 0);
}
 
TEST(DependencyGraphResolution, PythonDottedImportResolvesViaPathConversion) {
    MetricsEngine engine;
    FileMetrics app;
    app.includeTargets = {"pkg.util"};
    engine.addFile("app.py", app);
    engine.addFile("pkg/util.py", FileMetrics{});
 
    const auto graph = engine.buildDependencyGraph();
    const auto* appFc = find(graph, "app.py");
    ASSERT_NE(appFc, nullptr);
    ASSERT_EQ(appFc->dependsOn.size(), 1u);
    EXPECT_EQ(appFc->dependsOn[0], "pkg/util.py");
}
 
TEST(DependencyGraphResolution, PythonBarePackageTargetDoesNotResolve) {
    MetricsEngine engine;
    FileMetrics app;
    app.includeTargets = {"pkg"};
    engine.addFile("app.py", app);
    engine.addFile("pkg/util.py", FileMetrics{});
 
    const auto graph = engine.buildDependencyGraph();
    const auto* appFc = find(graph, "app.py");
    ASSERT_NE(appFc, nullptr);
    EXPECT_EQ(appFc->fanOut, 0);
}
 
TEST(DependencyGraphResolution, JavaDottedImportResolvesViaPathConversion) {
    MetricsEngine engine;
    FileMetrics mainJ;
    mainJ.includeTargets = {"com.example.Util"};
    engine.addFile("com/example/Main.java", mainJ);
    engine.addFile("com/example/Util.java", FileMetrics{});
 
    const auto graph = engine.buildDependencyGraph();
    const auto* mainFc = find(graph, "com/example/Main.java");
    ASSERT_NE(mainFc, nullptr);
    ASSERT_EQ(mainFc->dependsOn.size(), 1u);
    EXPECT_EQ(mainFc->dependsOn[0], "com/example/Util.java");
}
 
TEST(DependencyGraphResolution, JavaWildcardImportNeverResolves) {
    MetricsEngine engine;
    FileMetrics mainJ;
    mainJ.includeTargets = {"java.util.*"};
    engine.addFile("Main.java", mainJ);
    engine.addFile("java/util/List.java", FileMetrics{});
 
    const auto graph = engine.buildDependencyGraph();
    const auto* mainFc = find(graph, "Main.java");
    ASSERT_NE(mainFc, nullptr);
    EXPECT_EQ(mainFc->fanOut, 0);
}
 
TEST(DependencyGraphResolution, PathComponentBoundaryPreventsPartialBasenameMatch) {
    MetricsEngine engine;
    FileMetrics main;
    main.includeTargets = {"foo.h"};
    engine.addFile("src/main.cpp", main);
    engine.addFile("src/myfoo.h", FileMetrics{});
 
    const auto graph = engine.buildDependencyGraph();
    const auto* mainFc = find(graph, "src/main.cpp");
    ASSERT_NE(mainFc, nullptr);
    EXPECT_EQ(mainFc->fanOut, 0);
}
 
TEST(DependencyGraphResolution, NoSelfEdgesEvenIfTargetMatchesOwnFilename) {
    MetricsEngine engine;
    FileMetrics fm;
    fm.includeTargets = {"foo.h"};
    engine.addFile("foo.h", fm);
 
    const auto graph = engine.buildDependencyGraph();
    const auto* fc = find(graph, "foo.h");
    ASSERT_NE(fc, nullptr);
    EXPECT_EQ(fc->fanOut, 0);
    EXPECT_EQ(fc->fanIn, 0);
}
 
TEST(DependencyGraphResolution, DuplicateIncludesOfSameTargetDedupeToOneEdge) {
    MetricsEngine engine;
    FileMetrics main;
    main.includeTargets = {"foo.h", "foo.h"};
    engine.addFile("main.cpp", main);
    engine.addFile("foo.h", FileMetrics{});
 
    const auto graph = engine.buildDependencyGraph();
    const auto* mainFc = find(graph, "main.cpp");
    ASSERT_NE(mainFc, nullptr);
    EXPECT_EQ(mainFc->fanOut, 1);
    EXPECT_EQ(mainFc->dependsOn.size(), 1u);
}
 
TEST(DependencyGraphResolution, FanInCountsMultipleDependents) {
    MetricsEngine engine;
    FileMetrics a, b;
    a.includeTargets = {"foo.h"};
    b.includeTargets = {"foo.h"};
    engine.addFile("a.cpp", a);
    engine.addFile("b.cpp", b);
    engine.addFile("foo.h", FileMetrics{});
 
    const auto graph = engine.buildDependencyGraph();
    const auto* fooFc = find(graph, "foo.h");
    ASSERT_NE(fooFc, nullptr);
    EXPECT_EQ(fooFc->fanIn, 2);
    EXPECT_EQ(fooFc->dependedOnBy, (std::vector<std::string>{"a.cpp", "b.cpp"}));
}
 
TEST(DependencyGraphResolution, OutputIsDeterministicallySorted) {
    MetricsEngine engine;
    engine.addFile("zebra.cpp", FileMetrics{});
    engine.addFile("apple.cpp", FileMetrics{});
    engine.addFile("mango.cpp", FileMetrics{});
 
    const auto graph = engine.buildDependencyGraph();
    ASSERT_EQ(graph.files.size(), 3u);
    EXPECT_EQ(graph.files[0].path, "apple.cpp");
    EXPECT_EQ(graph.files[1].path, "mango.cpp");
    EXPECT_EQ(graph.files[2].path, "zebra.cpp");
}
 
TEST(DependencyGraphResolution, CalledTwiceReturnsSameResultBothTimes) {
    MetricsEngine engine;
    FileMetrics main;
    main.includeTargets = {"foo.h"};
    engine.addFile("main.cpp", main);
    engine.addFile("foo.h", FileMetrics{});
 
    const auto g1 = engine.buildDependencyGraph();
    const auto g2 = engine.buildDependencyGraph();
    ASSERT_EQ(g1.files.size(), g2.files.size());
    for (std::size_t i = 0; i < g1.files.size(); ++i) {
        EXPECT_EQ(g1.files[i].path, g2.files[i].path);
        EXPECT_EQ(g1.files[i].fanOut, g2.files[i].fanOut);
        EXPECT_EQ(g1.files[i].fanIn, g2.files[i].fanIn);
    }
}
 
TEST(ReportGeneratorJsonDeps, ThreeArgOutputIncludesDependenciesBlock) {
    ProjectMetrics pm;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("main.cpp", FileMetrics{});
 
    DependencyGraph graph;
    FileCoupling fc;
    fc.path = "main.cpp";
    fc.fanOut = 2;
    fc.fanIn = 1;
    fc.dependsOn = {"a.h", "b.h"};
    fc.dependedOnBy = {"c.cpp"};
    graph.files.push_back(fc);
 
    const auto json = ReportGenerator::toJson(pm, files, graph);
    EXPECT_NE(json.find("\"dependencies\""), std::string::npos);
    EXPECT_NE(json.find("\"fanOut\": 2"), std::string::npos);
    EXPECT_NE(json.find("\"fanIn\": 1"), std::string::npos);
    EXPECT_NE(json.find("\"a.h\""), std::string::npos);
    EXPECT_NE(json.find("\"c.cpp\""), std::string::npos);
}
 
TEST(ReportGeneratorJsonDeps, TwoArgOutputNeverContainsDependenciesKey) {
    ProjectMetrics pm;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("main.cpp", FileMetrics{});
 
    const auto json = ReportGenerator::toJson(pm, files);
    EXPECT_EQ(json.find("\"dependencies\""), std::string::npos);
}
 
TEST(ReportGeneratorJsonDeps, EmptyGraphProducesZeroFanInOutForEveryFile) {
    ProjectMetrics pm;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("lonely.cpp", FileMetrics{});
 
    DependencyGraph graph;
    FileCoupling fc;
    fc.path = "lonely.cpp";
    graph.files.push_back(fc);
 
    const auto json = ReportGenerator::toJson(pm, files, graph);
    EXPECT_NE(json.find("\"fanOut\": 0"), std::string::npos);
    EXPECT_NE(json.find("\"fanIn\": 0"), std::string::npos);
    EXPECT_NE(json.find("\"dependsOn\": []"), std::string::npos);
    EXPECT_NE(json.find("\"dependedOnBy\": []"), std::string::npos);
}
 
TEST(ReportGeneratorJsonDeps, EscapesPathsWithinDependencyArrays) {
    ProjectMetrics pm;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("main.cpp", FileMetrics{});
 
    DependencyGraph graph;
    FileCoupling fc;
    fc.path = "main.cpp";
    fc.dependsOn = {"has\"quote.h"};
    fc.fanOut = 1;
    graph.files.push_back(fc);
 
    const auto json = ReportGenerator::toJson(pm, files, graph);
    EXPECT_NE(json.find("has\\\"quote.h"), std::string::npos);
}
 
TEST(ReportGeneratorJsonDeps, SaveJsonToFileThreeArgMatchesToJson) {
    ProjectMetrics pm;
    std::vector<std::pair<std::string, FileMetrics>> files;
    files.emplace_back("main.cpp", FileMetrics{});
    DependencyGraph graph;
    FileCoupling fc;
    fc.path = "main.cpp";
    graph.files.push_back(fc);
 
    const auto expected = ReportGenerator::toJson(pm, files, graph);
    const std::string path = "/tmp/cma_test_dep_graph_output.json";
    ASSERT_TRUE(ReportGenerator::saveJsonToFile(pm, files, graph, path));
 
    std::ifstream in(path);
    ASSERT_TRUE(in.is_open());
    std::ostringstream buf;
    buf << in.rdbuf();
    EXPECT_EQ(buf.str(), expected);
    std::remove(path.c_str());
}
 
TEST(DependencyGraphEndToEnd, MixedCppFilesProduceCorrectGraph) {
    MetricsEngine engine;
    engine.addFile("src/main.cpp",
                    analyzeCpp("#include \"foo.h\"\n#include <vector>\nint main(){return 0;}\n"));
    engine.addFile("src/foo.h", analyzeCpp("int foo();\n"));
 
    const auto graph = engine.buildDependencyGraph();
    const auto* mainFc = find(graph, "src/main.cpp");
    const auto* fooFc  = find(graph, "src/foo.h");
    ASSERT_NE(mainFc, nullptr);
    ASSERT_NE(fooFc, nullptr);
    EXPECT_EQ(mainFc->fanOut, 1);
    EXPECT_EQ(fooFc->fanIn, 1);
}
 
// -- Phase 1: MetricsEngine::compute() byLanguage grouping --
// FileMetrics::language is populated by main.cpp, not by the parsers'
// analyze() calls used here, so each fixture sets it explicitly --
// mirroring what main.cpp's languageToString(*lang) assignment does.

TEST(MetricsEngineByLanguage, GroupsFilesByLanguageWithCorrectAggregates) {
    MetricsEngine engine;

    FileMetrics cpp1 = analyzeCpp("int f() { return 1; }\n");
    cpp1.language = "cpp";
    engine.addFile("a.cpp", cpp1);

    FileMetrics cpp2 = analyzeCpp("int g() { if (1) { return 1; } return 0; }\n");
    cpp2.language = "cpp";
    engine.addFile("b.cpp", cpp2);

    FileMetrics py1 = analyzePython("def h():\n    return 1\n");
    py1.language = "python";
    engine.addFile("c.py", py1);

    const auto pm = engine.compute();
    ASSERT_EQ(pm.byLanguage.size(), 2u);

    const LanguageAggregate* cppAgg = nullptr;
    const LanguageAggregate* pyAgg  = nullptr;
    for (const auto& la : pm.byLanguage) {
        if (la.language == "cpp")    cppAgg = &la;
        if (la.language == "python") pyAgg  = &la;
    }
    ASSERT_NE(cppAgg, nullptr);
    ASSERT_NE(pyAgg,  nullptr);

    EXPECT_EQ(cppAgg->fileCount, 2);
    EXPECT_EQ(pyAgg->fileCount, 1);

    // Every LanguageAggregate is a strict subset of the project total;
    // the two groups here partition the project exactly.
    EXPECT_EQ(cppAgg->totalLines + pyAgg->totalLines, pm.totalLines);
    EXPECT_EQ(cppAgg->functionCount + pyAgg->functionCount, pm.functionCount);
    EXPECT_EQ(cppAgg->cyclomaticComplexity + pyAgg->cyclomaticComplexity,
              pm.cyclomaticComplexity);
}

TEST(MetricsEngineByLanguage, SortedByCodeLinesDescending) {
    MetricsEngine engine;

    FileMetrics small = analyzePython("def f():\n    pass\n");
    small.language = "python";
    engine.addFile("small.py", small);

    FileMetrics big = analyzeCpp(
        "int a() { return 1; }\n"
        "int b() { return 2; }\n"
        "int c() { return 3; }\n"
        "int d() { return 4; }\n");
    big.language = "cpp";
    engine.addFile("big.cpp", big);

    const auto pm = engine.compute();
    ASSERT_EQ(pm.byLanguage.size(), 2u);
    EXPECT_EQ(pm.byLanguage[0].language, "cpp");
    EXPECT_GT(pm.byLanguage[0].codeLines, pm.byLanguage[1].codeLines);
}

TEST(MetricsEngineByLanguage, EmptyProjectProducesEmptyByLanguage) {
    MetricsEngine engine;
    const auto pm = engine.compute();
    EXPECT_TRUE(pm.byLanguage.empty());
}

TEST(MetricsEngineByLanguage, UnsetLanguageGroupsUnderUnknownFallbackKey) {
    // FileMetrics built outside main.cpp's pipeline (e.g. constructed
    // directly, as in most other unit tests) leaves language empty --
    // compute() must not silently drop these files from byLanguage.
    MetricsEngine engine;
    FileMetrics fm = analyzeCpp("int f() { return 1; }\n");
    engine.addFile("mystery.cpp", fm);

    const auto pm = engine.compute();
    ASSERT_EQ(pm.byLanguage.size(), 1u);
    EXPECT_EQ(pm.byLanguage[0].language, "unknown");
    EXPECT_EQ(pm.byLanguage[0].fileCount, 1);
}
