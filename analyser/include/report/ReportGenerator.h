#pragma once

#include "metrics/DependencyGraph.h"
#include "metrics/HotspotReport.h"
#include "metrics/Metrics.h"
#include "metrics/ViolationReport.h"
#include "parser/ParseResult.h"
#include "report/HealthScore.h"

#include <ostream>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace cma {

class ReportGenerator {
public:
    static void printSummary(const ProjectMetrics& metrics, std::ostream& out);
    [[nodiscard]] static bool saveToFile(const ProjectMetrics& metrics,
                                          const std::string& outputPath);

    // -- Phase 4 Sprint 1 --
    [[nodiscard]] static std::string toJson(
        const ProjectMetrics& metrics,
        const std::vector<std::pair<std::string, FileMetrics>>& files);

    [[nodiscard]] static bool saveJsonToFile(
        const ProjectMetrics& metrics,
        const std::vector<std::pair<std::string, FileMetrics>>& files,
        const std::string& outputPath);

    // -- Phase 4 Sprint 2 --
    [[nodiscard]] static std::string toJson(
        const ProjectMetrics& metrics,
        const std::vector<std::pair<std::string, FileMetrics>>& files,
        const DependencyGraph& graph);

    [[nodiscard]] static bool saveJsonToFile(
        const ProjectMetrics& metrics,
        const std::vector<std::pair<std::string, FileMetrics>>& files,
        const DependencyGraph& graph,
        const std::string& outputPath);

    // -- Phase 4 Sprint 3 --
    [[nodiscard]] static std::string toJson(
        const ProjectMetrics& metrics,
        const std::vector<std::pair<std::string, FileMetrics>>& files,
        const DependencyGraph& graph,
        const HotspotReport& hotspots);

    [[nodiscard]] static bool saveJsonToFile(
        const ProjectMetrics& metrics,
        const std::vector<std::pair<std::string, FileMetrics>>& files,
        const DependencyGraph& graph,
        const HotspotReport& hotspots,
        const std::string& outputPath);

    // -- Phase 4 Sprint 3B --
    [[nodiscard]] static std::string toJson(
        const ProjectMetrics& metrics,
        const std::vector<std::pair<std::string, FileMetrics>>& files,
        const DependencyGraph& graph,
        const HotspotReport& hotspots,
        const ViolationReport& violations);

    [[nodiscard]] static bool saveJsonToFile(
        const ProjectMetrics& metrics,
        const std::vector<std::pair<std::string, FileMetrics>>& files,
        const DependencyGraph& graph,
        const HotspotReport& hotspots,
        const ViolationReport& violations,
        const std::string& outputPath);

    // -- Phase 4 Sprint 4 (static HTML report) --
    [[nodiscard]] static std::string toHtml(
        const ProjectMetrics& metrics,
        const std::vector<std::pair<std::string, FileMetrics>>& files);

    [[nodiscard]] static bool saveHtmlToFile(
        const ProjectMetrics& metrics,
        const std::vector<std::pair<std::string, FileMetrics>>& files,
        const std::string& outputPath);

    [[nodiscard]] static std::string toHtml(
        const ProjectMetrics& metrics,
        const std::vector<std::pair<std::string, FileMetrics>>& files,
        const DependencyGraph& graph,
        const HotspotReport& hotspots,
        const ViolationReport& violations);

    [[nodiscard]] static bool saveHtmlToFile(
        const ProjectMetrics& metrics,
        const std::vector<std::pair<std::string, FileMetrics>>& files,
        const DependencyGraph& graph,
        const HotspotReport& hotspots,
        const ViolationReport& violations,
        const std::string& outputPath);

    [[nodiscard]] static std::string toBadgeSvg(const ProjectMetrics& metrics);
    [[nodiscard]] static bool saveBadgeToFile(const ProjectMetrics& metrics,
                                               const std::string& outputPath);

private:
    // --- text report ---
    static void writeReport(const ProjectMetrics& metrics, std::ostream& out);

    // --- JSON internals ---
    static void writeJson(
        const ProjectMetrics& metrics,
        const std::vector<std::pair<std::string, FileMetrics>>& files,
        const DependencyGraph* graph,
        const HotspotReport* hotspots,
        const ViolationReport* violations,
        std::ostream& out);

    static void writeDependenciesJson(
        const std::unordered_map<std::string, const FileCoupling*>& couplingByPath,
        const std::string& path,
        std::ostream& out);

    static void writeHotspotsJson(const HotspotReport& hotspots, std::ostream& out);
    static void writeViolationsJson(const ViolationReport& violations, std::ostream& out);
    static void writeFileMetricsJson(const FileMetrics& fm, std::ostream& out);

static void writeByLanguageJson(const std::vector<LanguageAggregate>& byLanguage,
                                   std::ostream& out);
    [[nodiscard]] static std::string jsonEscape(const std::string& s);

    // --- HTML internals ---
    static void writeHtml(
        const ProjectMetrics& metrics,
        const std::vector<std::pair<std::string, FileMetrics>>& files,
        const DependencyGraph* graph,
        const HotspotReport* hotspots,
        const ViolationReport* violations,
        std::ostream& out);

    static void writeHtmlFilesTable(
        const std::vector<std::pair<std::string, FileMetrics>>& files,
        std::ostream& out);

    static void writeHtmlDependenciesSection(
        const std::vector<std::pair<std::string, FileMetrics>>& files,
        const DependencyGraph& graph,
        std::ostream& out);

    static void writeHtmlHotspotsSection(
        const HotspotReport& hotspots,
        std::ostream& out);

    static void writeHtmlViolationsSection(
        const ViolationReport& violations,
        std::ostream& out);

    [[nodiscard]] static std::string htmlEscape(const std::string& s);
};

} // namespace cma
