#include "metrics/MetricsEngine.h"

#include "common/UnanalyzedLanguageNames.h"
 
#include <algorithm>
#include <filesystem>
#include <set>
#include <unordered_map>
 
namespace cma {
 
namespace {

// Shared accumulation logic for both the whole-project total and each
// per-language group in compute() below — same fields ProjectMetrics
// and LanguageAggregate both carry, kept in one place instead of
// duplicated per grouping.
struct MetricAccumulator {
    int fileCount = 0;

    int totalLines   = 0;
    int blankLines   = 0;
    int commentLines = 0;
    int codeLines    = 0;

    int functionCount = 0;
    int classCount    = 0;
    int variableCount = 0;
    int includeCount  = 0;

    int loopCount            = 0;
    int conditionCount       = 0;
    int tryCatchCount        = 0;
    int cyclomaticComplexity = 0;
    int maxNestingDepth      = 0;

    int todoCount = 0;

    long        totalFnLength       = 0;
    int         totalFnCount        = 0;
    int         longestFunctionLines = 0;
    std::string longestFunctionName;
};

void accumulate(MetricAccumulator& acc, const FileMetrics& fm) {
    ++acc.fileCount;
    acc.totalLines            += fm.totalLines;
    acc.blankLines            += fm.blankLines;
    acc.commentLines          += fm.commentLines;
    acc.codeLines             += fm.codeLines;
    acc.functionCount         += fm.functionCount();
    acc.classCount            += fm.classCount();
    acc.variableCount         += fm.variableCount;
    acc.includeCount          += fm.includeCount;
    acc.loopCount             += fm.loopCount;
    acc.conditionCount        += fm.conditionCount;
    acc.tryCatchCount         += fm.tryCatchCount;
    acc.cyclomaticComplexity  += fm.cyclomaticComplexity;
    acc.todoCount             += fm.todoCount;
    acc.maxNestingDepth        = std::max(acc.maxNestingDepth, fm.maxNestingDepth);

    for (const auto& fn : fm.functions) {
        acc.totalFnLength += fn.lineCount();
        ++acc.totalFnCount;
        if (fn.lineCount() > acc.longestFunctionLines) {
            acc.longestFunctionLines = fn.lineCount();
            acc.longestFunctionName  = fn.name + "()";
        }
    }
}

double avgFnLength(const MetricAccumulator& acc) {
    return (acc.totalFnCount > 0)
        ? static_cast<double>(acc.totalFnLength) / acc.totalFnCount
        : 0.0;
}
  

bool pathEndsWithComponent(const std::string& path, const std::string& candidate) {
    if (candidate.empty() || candidate.size() > path.size()) return false;
    if (path.compare(path.size() - candidate.size(), candidate.size(), candidate) != 0)
        return false;
    const auto boundaryIdx = path.size() - candidate.size();
    if (boundaryIdx == 0) return true;
    const char before = path[boundaryIdx - 1];
    return before == '/' || before == '\\';
}
 
std::vector<std::string> candidateSuffixes(const std::string& target) {
    std::vector<std::string> candidates;
    if (target.empty() || target.back() == '*') return candidates;
 
    candidates.push_back(target);
 
    const auto dotPos = target.find('.');
    if (dotPos != std::string::npos) {
        std::string asPath = target;
        for (auto& c : asPath) if (c == '.') c = '/';
        candidates.push_back(asPath + ".py");
        candidates.push_back(asPath + ".java");
 
        const auto lastDot = target.find_last_of('.');
        const std::string basename = target.substr(lastDot + 1);
        if (!basename.empty()) {
            candidates.push_back(basename + ".py");
            candidates.push_back(basename + ".java");
        }
    }
    return candidates;
}
 
} // anonymous namespace
 
void MetricsEngine::addFile(const std::string& filename, FileMetrics metrics) {
    m_files.emplace_back(filename, std::move(metrics));
}

void MetricsEngine::addUnanalyzedFile(std::string extension, int lineCount) {
    m_unanalyzedFiles.emplace_back(std::move(extension), lineCount);
}
 
const std::vector<std::pair<std::string, FileMetrics>>&
MetricsEngine::files() const noexcept {
    return m_files;
}
 
ProjectMetrics MetricsEngine::compute() const {
  MetricAccumulator overall;
 std::unordered_map<std::string, MetricAccumulator> byLang;
 std::vector<std::string> langOrder; // first-seen order; final output is re-sorted below
 
    for (const auto& [filename, fm] : m_files) {
  accumulate(overall, fm);

        const std::string langKey = fm.language.empty() ? "unknown" : fm.language;
        auto it = byLang.find(langKey);
        if (it == byLang.end()) {
            langOrder.push_back(langKey);
            it = byLang.emplace(langKey, MetricAccumulator{}).first;
         }
        accumulate(it->second, fm);
        
    }
 
    ProjectMetrics pm;
    pm.filesAnalyzed         = overall.fileCount;
    pm.totalLines            = overall.totalLines;
    pm.blankLines            = overall.blankLines;
    pm.commentLines          = overall.commentLines;
    pm.codeLines             = overall.codeLines;
    pm.functionCount         = overall.functionCount;
    pm.classCount            = overall.classCount;
    pm.variableCount         = overall.variableCount;
    pm.includeCount          = overall.includeCount;
    pm.loopCount             = overall.loopCount;
    pm.conditionCount        = overall.conditionCount;
    pm.tryCatchCount         = overall.tryCatchCount;
    pm.cyclomaticComplexity  = overall.cyclomaticComplexity;
    pm.maxNestingDepth       = overall.maxNestingDepth;
    pm.todoCount             = overall.todoCount;
    pm.avgFunctionLength     = avgFnLength(overall);
    pm.longestFunctionLines  = overall.longestFunctionLines;
    pm.longestFunctionName   = overall.longestFunctionName;

    pm.byLanguage.reserve(langOrder.size());
    for (const auto& langKey : langOrder) {
        const auto& acc = byLang.at(langKey);
        LanguageAggregate la;
        la.language             = langKey;
        la.fileCount            = acc.fileCount;
        la.totalLines           = acc.totalLines;
        la.blankLines           = acc.blankLines;
        la.commentLines         = acc.commentLines;
        la.codeLines            = acc.codeLines;
        la.functionCount        = acc.functionCount;
        la.classCount           = acc.classCount;
        la.variableCount        = acc.variableCount;
        la.includeCount         = acc.includeCount;
        la.loopCount            = acc.loopCount;
        la.conditionCount       = acc.conditionCount;
        la.tryCatchCount        = acc.tryCatchCount;
        la.cyclomaticComplexity = acc.cyclomaticComplexity;
        la.maxNestingDepth      = acc.maxNestingDepth;
        la.todoCount            = acc.todoCount;
        la.avgFunctionLength    = avgFnLength(acc);
        la.longestFunctionLines = acc.longestFunctionLines;
        la.longestFunctionName  = acc.longestFunctionName;
        pm.byLanguage.push_back(std::move(la));
    }

    std::sort(pm.byLanguage.begin(), pm.byLanguage.end(),
              [](const LanguageAggregate& a, const LanguageAggregate& b) {
                  if (a.codeLines != b.codeLines) return a.codeLines > b.codeLines;
                  return a.language < b.language;
              });

    std::unordered_map<std::string, UnanalyzedLanguageSummary> unanalyzedByExt;
    std::vector<std::string> unanalyzedOrder; // first-seen order; re-sorted below
    for (const auto& [extension, lineCount] : m_unanalyzedFiles) {
        auto it = unanalyzedByExt.find(extension);
        if (it == unanalyzedByExt.end()) {
            unanalyzedOrder.push_back(extension);
            UnanalyzedLanguageSummary summary;
            summary.extension    = extension;
            summary.languageName = unanalyzedLanguageName(extension);
            it = unanalyzedByExt.emplace(extension, std::move(summary)).first;
        }
        ++it->second.fileCount;
        it->second.lineCount += lineCount;
    }

    pm.unanalyzedLanguages.reserve(unanalyzedOrder.size());
    for (const auto& extension : unanalyzedOrder) {
        pm.unanalyzedLanguages.push_back(std::move(unanalyzedByExt.at(extension)));
    }

    std::sort(pm.unanalyzedLanguages.begin(), pm.unanalyzedLanguages.end(),
              [](const UnanalyzedLanguageSummary& a, const UnanalyzedLanguageSummary& b) {
                  if (a.lineCount != b.lineCount) return a.lineCount > b.lineCount;
                  return a.extension < b.extension;
              });

    return pm;
}
 
DependencyGraph MetricsEngine::buildDependencyGraph() const {
    DependencyGraph graph;
    graph.files.reserve(m_files.size());
    for (const auto& [path, fm] : m_files) {
        FileCoupling fc;
        fc.path = path;
        graph.files.push_back(std::move(fc));
    }
    std::sort(graph.files.begin(), graph.files.end(),
              [](const FileCoupling& a, const FileCoupling& b) { return a.path < b.path; });
 
    std::unordered_map<std::string, std::size_t> indexByPath;
    indexByPath.reserve(graph.files.size());
    for (std::size_t i = 0; i < graph.files.size(); ++i) indexByPath[graph.files[i].path] = i;
 
    std::vector<std::set<std::string>> dependsOnSets(graph.files.size());
    std::vector<std::set<std::string>> dependedOnBySets(graph.files.size());
 
    for (const auto& [srcPath, fm] : m_files) {
        const auto srcIdxIt = indexByPath.find(srcPath);
        if (srcIdxIt == indexByPath.end()) continue;
        const std::size_t srcIdx = srcIdxIt->second;
 
        for (const auto& target : fm.includeTargets) {
            bool resolved = false;
            for (const auto& candidate : candidateSuffixes(target)) {
                for (std::size_t j = 0; j < graph.files.size(); ++j) {
                    if (j == srcIdx) continue;
                    if (pathEndsWithComponent(graph.files[j].path, candidate)) {
                        dependsOnSets[srcIdx].insert(graph.files[j].path);
                        dependedOnBySets[j].insert(srcPath);
                        resolved = true;
                        break;
                    }
                }
                if (resolved) break;
            }
        }
    }
 
    for (std::size_t i = 0; i < graph.files.size(); ++i) {
        graph.files[i].dependsOn.assign(dependsOnSets[i].begin(), dependsOnSets[i].end());
        graph.files[i].dependedOnBy.assign(dependedOnBySets[i].begin(), dependedOnBySets[i].end());
        graph.files[i].fanOut = static_cast<int>(graph.files[i].dependsOn.size());
        graph.files[i].fanIn  = static_cast<int>(graph.files[i].dependedOnBy.size());
    }
 
    return graph;
}
 
HotspotReport MetricsEngine::buildHotspotReport(const GitHistory& git) const {
    HotspotReport report;
    if (!git.available()) {
        report.gitAvailable = false;
        return report;
    }
    report.gitAvailable = true;
 
    const auto& churnMap = git.churn();
 
    int maxComplexity = 0;
    int maxCommits     = 0;
 
    std::vector<FileHotspot> hotspots;
    hotspots.reserve(m_files.size());
 
    for (const auto& [path, fm] : m_files) {
        FileHotspot fh;
        fh.path = path;
        fh.cyclomaticComplexity = fm.cyclomaticComplexity;
 
        const auto key = canonicalPathKey(std::filesystem::path(path));
        const auto it  = churnMap.find(key);
        if (it != churnMap.end()) {
            fh.commitCount  = it->second.commitCount;
            fh.linesAdded   = it->second.linesAdded;
            fh.linesDeleted = it->second.linesDeleted;
        }
 
        maxComplexity = std::max(maxComplexity, fh.cyclomaticComplexity);
        maxCommits    = std::max(maxCommits, fh.commitCount);
 
        hotspots.push_back(std::move(fh));
    }
 
    for (auto& fh : hotspots) {
        const double normComplexity =
            (maxComplexity > 0) ? static_cast<double>(fh.cyclomaticComplexity) / maxComplexity : 0.0;
        const double normChurn =
            (maxCommits > 0) ? static_cast<double>(fh.commitCount) / maxCommits : 0.0;
        fh.hotspotScore = normComplexity * normChurn * 100.0;
    }
 
    std::sort(hotspots.begin(), hotspots.end(), [](const FileHotspot& a, const FileHotspot& b) {
        if (a.hotspotScore != b.hotspotScore) return a.hotspotScore > b.hotspotScore;
        return a.path < b.path;
    });
 
    report.files = std::move(hotspots);
    return report;
}
 
} // namespace cma
 
