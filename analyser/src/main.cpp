#include "common/Language.h"
#include "common/LanguageDispatch.h"
#include "filesystem/FileScanner.h"
#include "metrics/DependencyGraph.h"
#include "metrics/HotspotReport.h"
#include "metrics/MetricsEngine.h"
#include "metrics/ViolationReport.h"
#include "parser/ParseResult.h"
#include "report/ReportGenerator.h"
#include "rules/RuleDispatch.h"
#include "vcs/GitHistory.h"

#include <algorithm>
#include <filesystem>
#include <iostream>
#include <optional>
#include <string>

namespace fs = std::filesystem;
using namespace cma;

struct Config {
    fs::path    targetPath;
    std::string outputFile;
    std::string jsonFile;
    std::string badgeFile;
    std::string htmlFile;
};

static std::optional<Config> parseArgs(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: cma <path> [--out <report.txt>] [--json <report.json>] "
                     "[--badge <badge.svg>] [--html <report.html>]\n";
        return std::nullopt;
    }

    Config cfg;
    cfg.targetPath = argv[1];

    for (int i = 2; i < argc - 1; ++i) {
        const std::string arg = argv[i];
        if      (arg == "--out")   cfg.outputFile = argv[i + 1];
        else if (arg == "--json")  cfg.jsonFile   = argv[i + 1];
        else if (arg == "--badge") cfg.badgeFile  = argv[i + 1];
        else if (arg == "--html")  cfg.htmlFile   = argv[i + 1];
    }
    return cfg;
}

int main(int argc, char* argv[]) {
    const auto cfg = parseArgs(argc, argv);
    if (!cfg) return 1;

    const FileScanner scanner(cfg->targetPath);
    std::vector<UnsupportedFile> unsupportedFiles;
    const std::vector<fs::path> files = scanner.scan(&unsupportedFiles);

    if (files.empty()) {
        std::cerr << "No recognized source files found in: " << cfg->targetPath << '\n';
        return 1;
    }

    std::cout << "Analyzing " << files.size() << " file(s)...\n";

    MetricsEngine engine;
    std::vector<Violation> violations;
    int skipped = 0;

    for (const auto& filepath : files) {
        const auto source = FileScanner::readFile(filepath);
        if (!source) {
            std::cerr << "  [skip] cannot read: " << filepath << '\n';
            ++skipped;
            continue;
        }

        const auto lang = detectLanguage(filepath);
        if (!lang) {
            std::cerr << "  [skip] unrecognized language: " << filepath << '\n';
            ++skipped;
            continue;
        }

        const int lineCount =
            static_cast<int>(std::count(source->begin(), source->end(), '\n')) + 1;

        auto tokens  = tokenizeSource(*lang, *source);
        FileMetrics fm = parseTokens(*lang, tokens, lineCount);
        fm.language = languageToString(*lang);
 
        auto fileViolations = checkRules(*lang, filepath.string(), tokens, fm);
        violations.insert(violations.end(),
                          std::make_move_iterator(fileViolations.begin()),
                          std::make_move_iterator(fileViolations.end()));

        engine.addFile(filepath.string(), std::move(fm));
    }

    if (skipped > 0)
        std::cout << "Warning: skipped " << skipped << " unreadable file(s).\n";

    // Unanalyzed files: no front-end exists for these, so only a cheap
    // line count is taken -- no tokenize/parse. A read failure here is
    // silently skipped from the report (not counted in `skipped` above,
    // which tracks recognized-but-unreadable files, a different case).
    int unanalyzedReadFailures = 0;
    for (const auto& unsupported : unsupportedFiles) {
        const auto source = FileScanner::readFile(unsupported.path);
        if (!source) {
            ++unanalyzedReadFailures;
            continue;
        }
        const int lineCount =
            static_cast<int>(std::count(source->begin(), source->end(), '\n')) + 1;
        engine.addUnanalyzedFile(unsupported.extension, lineCount);
    }

    if (!unsupportedFiles.empty()) {
        std::cout << "Note: found " << unsupportedFiles.size()
                  << " file(s) with no language front-end yet"
                     " (see report's unanalyzedLanguages).\n";
    }
    if (unanalyzedReadFailures > 0) {
        std::cerr << "Warning: could not read " << unanalyzedReadFailures
                  << " unanalyzed file(s) for line count.\n";
    }

    std::sort(violations.begin(), violations.end(),
              [](const Violation& a, const Violation& b) {
                  if (a.path != b.path) return a.path < b.path;
                  if (a.line != b.line) return a.line < b.line;
                  return a.ruleId < b.ruleId;
              });

    const ProjectMetrics report = engine.compute();
    ReportGenerator::printSummary(report, std::cout);

    if (!cfg->outputFile.empty()) {
        if (ReportGenerator::saveToFile(report, cfg->outputFile))
            std::cout << "Report saved to: " << cfg->outputFile << '\n';
        else
            std::cerr << "Warning: could not write to: " << cfg->outputFile << '\n';
    }

    // Compute expensive data once; feed both --json and --html.
    const bool needsFullData = !cfg->jsonFile.empty() || !cfg->htmlFile.empty();
    if (needsFullData) {
        const DependencyGraph depGraph = engine.buildDependencyGraph();

        GitHistory git(cfg->targetPath);
        if (!git.collect()) {
            std::cerr << "Note: no git history found at " << cfg->targetPath
                      << " -- hotspot data will be empty in the report.\n";
        }
        const HotspotReport hotspots = engine.buildHotspotReport(git);

        ViolationReport violationReport;
        violationReport.violations = violations;

        if (!cfg->jsonFile.empty()) {
            if (ReportGenerator::saveJsonToFile(report, engine.files(), depGraph,
                                                hotspots, violationReport, cfg->jsonFile))
                std::cout << "JSON report saved to: " << cfg->jsonFile << '\n';
            else
                std::cerr << "Warning: could not write JSON to: " << cfg->jsonFile << '\n';
        }

        if (!cfg->htmlFile.empty()) {
            if (ReportGenerator::saveHtmlToFile(report, engine.files(), depGraph,
                                                hotspots, violationReport, cfg->htmlFile))
                std::cout << "HTML report saved to: " << cfg->htmlFile << '\n';
            else
                std::cerr << "Warning: could not write HTML to: " << cfg->htmlFile << '\n';
        }
    }

    if (!cfg->badgeFile.empty()) {
        if (ReportGenerator::saveBadgeToFile(report, cfg->badgeFile))
            std::cout << "Badge saved to: " << cfg->badgeFile << '\n';
        else
            std::cerr << "Warning: could not write badge to: " << cfg->badgeFile << '\n';
    }

    return 0;
}
