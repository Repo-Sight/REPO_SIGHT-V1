#pragma once
 
#include "Metrics.h"
#include "DependencyGraph.h"
#include "HotspotReport.h"
#include "parser/ParseResult.h"
#include "vcs/GitHistory.h"
 
#include <string>
#include <utility>
#include <vector>
 
namespace cma {
 
class MetricsEngine {
public:
    void addFile(const std::string& filename, FileMetrics metrics);
 
    // Records a file that was discovered but not analyzed (unrecognized
    // extension) -- see FileScanner::scan()'s unsupported out-param.
    // lineCount is a cheap newline count, not full FileMetrics -- no
    // front-end exists to parse this file. Grouped by extension into
    // ProjectMetrics::unanalyzedLanguages at compute() time.
    void addUnanalyzedFile(std::string extension, int lineCount);
  
    [[nodiscard]] ProjectMetrics compute() const;
 
    [[nodiscard]] const std::vector<std::pair<std::string, FileMetrics>>&
    files() const noexcept;
 
    [[nodiscard]] DependencyGraph buildDependencyGraph() const;
 
    [[nodiscard]] HotspotReport buildHotspotReport(const GitHistory& git) const;
 
private:
    std::vector<std::pair<std::string, FileMetrics>> m_files;

    // (extension, lineCount) per unanalyzed file, grouped in compute().
    std::vector<std::pair<std::string, int>> m_unanalyzedFiles;
};
} // namespace cma
 
