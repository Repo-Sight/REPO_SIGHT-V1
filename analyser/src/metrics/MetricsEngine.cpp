#include "metrics/MetricsEngine.h"

#include "common/UnanalyzedLanguageNames.h"
#include "lexer/Token.h"
 
#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <set>
#include <tuple>
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

// ------------------------------------------------------------
// Duplication detection (Phase 6a)
//
// Token-based, language-scoped clone detection using non-overlapping
// chunk fingerprinting + bidirectional extension -- the same family of
// technique used by lightweight copy-paste detectors (e.g. CPD/Simian):
// hash fixed-size, non-overlapping windows of the normalized token
// stream; any two windows that hash-collide are a candidate duplicate
// seed, which is then extended backward and forward token-by-token to
// find the true boundaries of the match. Chunking (rather than sliding
// by 1 token) keeps the seed-finding pass O(totalTokens / window)
// instead of O(totalTokens); the extension pass is bounded by the
// length of actual matches found, not file size, so the whole pass
// stays comfortably inside the 55s serverless budget (V2 plan Section
// 2.4) even for large repos.

// Minimum seed length, in normalized tokens. ~40 tokens is roughly
// 8-15 lines of typical code across the supported languages -- enough
// to filter out incidental boilerplate (short getters, single-line
// guards) that would otherwise flood the report with meaningless noise
// (project instructions Section 14: reports should be actionable, not
// exhaustive).
constexpr std::size_t kDuplicationWindowTokens = 40;

constexpr std::uint64_t kFnvOffsetBasis = 1469598103934665603ULL;
constexpr std::uint64_t kFnvPrime       = 1099511628211ULL;

// FNV-1a over the window's normalized codes. A unit-separator byte is
// mixed in between tokens so token boundaries can't collapse into each
// other (e.g. "a","bc" vs "ab","c" must not hash the same).
std::uint64_t hashWindow(const std::vector<NormalizedToken>& tokens,
                          std::size_t start, std::size_t length) {
    std::uint64_t h = kFnvOffsetBasis;
    for (std::size_t i = 0; i < length; ++i) {
        for (unsigned char c : tokens[start + i].code) {
            h ^= c;
            h *= kFnvPrime;
        }
        h ^= 0x1Fu; // unit separator between tokens
        h *= kFnvPrime;
    }
    return h;
}

bool sameNormalizedRun(const std::vector<NormalizedToken>& a, std::size_t ai,
                        const std::vector<NormalizedToken>& b, std::size_t bi,
                        std::size_t length) {
    for (std::size_t i = 0; i < length; ++i) {
        if (a[ai + i].code != b[bi + i].code) return false;
    }
    return true;
}

struct ChunkLocation {
    std::size_t entryIndex; // index into the language's entries vector
    std::size_t tokenStart; // token index within that entry
};

void detectDuplicatesWithinLanguage(
    const std::vector<const FileTokenStream*>& entries,
    std::vector<DuplicateMatch>& out) {
    if (entries.empty()) return;

    std::unordered_map<std::uint64_t, std::vector<ChunkLocation>> seeds;

    for (std::size_t e = 0; e < entries.size(); ++e) {
        const auto& tokens = entries[e]->tokens;
        if (tokens.size() < kDuplicationWindowTokens) continue;
        for (std::size_t start = 0;
             start + kDuplicationWindowTokens <= tokens.size();
             start += kDuplicationWindowTokens) {
            const auto h = hashWindow(tokens, start, kDuplicationWindowTokens);
            seeds[h].push_back(ChunkLocation{e, start});
        }
    }

    // Dedupe on the final (possibly-swapped) match coordinates: multiple
    // chunk seeds inside one true duplicate block all extend to the
    // exact same range, so this collapses them to a single reported
    // match while still keeping distinct matches against a different
    // partner file/location.
    std::set<std::tuple<std::string, int, std::string, int>> reported;

    for (auto& seedEntry : seeds) {
        const auto& locations = seedEntry.second;
        if (locations.size() < 2) continue;

        for (std::size_t i = 0; i < locations.size(); ++i) {
            for (std::size_t j = i + 1; j < locations.size(); ++j) {
                const ChunkLocation& locA = locations[i];
                const ChunkLocation& locB = locations[j];

                const auto& tokensA = entries[locA.entryIndex]->tokens;
                const auto& tokensB = entries[locB.entryIndex]->tokens;

                // Confirm the hash match is a real match, not a
                // collision (FNV-1a over ~40 short tokens is very
                // unlikely to collide, but verifying is cheap and the
                // report must never show a false "duplicate").
                if (!sameNormalizedRun(tokensA, locA.tokenStart,
                                        tokensB, locB.tokenStart,
                                        kDuplicationWindowTokens))
                    continue;

                std::size_t startA = locA.tokenStart;
                std::size_t startB = locB.tokenStart;
                std::size_t matchLen = kDuplicationWindowTokens;

                while (startA > 0 && startB > 0 &&
                       tokensA[startA - 1].code == tokensB[startB - 1].code) {
                    --startA;
                    --startB;
                    ++matchLen;
                }
                while (startA + matchLen < tokensA.size() &&
                       startB + matchLen < tokensB.size() &&
                       tokensA[startA + matchLen].code == tokensB[startB + matchLen].code) {
                    ++matchLen;
                }

                // Same-file matches must not overlap themselves --
                // that's repetition inside one already-counted span,
                // not two distinct duplicate locations.
                if (locA.entryIndex == locB.entryIndex) {
                    const std::size_t endA = startA + matchLen;
                    const std::size_t endB = startB + matchLen;
                    const bool overlap = startA < endB && startB < endA;
                    if (overlap) continue;
                }

                DuplicateMatch match;
                match.pathA      = entries[locA.entryIndex]->path;
                match.lineStartA = tokensA[startA].line;
                match.lineEndA   = tokensA[startA + matchLen - 1].line;

                match.pathB      = entries[locB.entryIndex]->path;
                match.lineStartB = tokensB[startB].line;
                match.lineEndB   = tokensB[startB + matchLen - 1].line;

                match.tokenCount = static_cast<int>(matchLen);

                // Report pairs in a stable order regardless of which
                // side the hash bucket found first.
                if (std::tie(match.pathB, match.lineStartB) <
                    std::tie(match.pathA, match.lineStartA)) {
                    std::swap(match.pathA, match.pathB);
                    std::swap(match.lineStartA, match.lineStartB);
                    std::swap(match.lineEndA, match.lineEndB);
                }
                match.lineCount = match.lineEndA - match.lineStartA + 1;

                const auto key = std::make_tuple(match.pathA, match.lineStartA,
                                                  match.pathB, match.lineStartB);
                if (!reported.insert(key).second) continue;

                out.push_back(std::move(match));
            }
        }
    }
}

} // anonymous namespace
 
void MetricsEngine::addFile(const std::string& filename, FileMetrics metrics) {
    m_files.emplace_back(filename, std::move(metrics));
}

void MetricsEngine::addUnanalyzedFile(std::string extension, int lineCount) {
    m_unanalyzedFiles.emplace_back(std::move(extension), lineCount);
}

void MetricsEngine::addFileTokens(const std::string& path, const std::string& language,
                                   const std::vector<Token>& tokens) {
    FileTokenStream entry;
    entry.path = path;
    entry.language = language;
    entry.tokens.reserve(tokens.size());

    for (const auto& t : tokens) {
        switch (t.type) {
            case TokenType::LINE_COMMENT:
            case TokenType::BLOCK_COMMENT:
            case TokenType::NEWLINE:
            case TokenType::END_OF_FILE:
            case TokenType::UNKNOWN:
                continue; // formatting/noise -- not structural signal
            default:
                break;
        }

        NormalizedToken nt;
        nt.line = t.line;
        switch (t.type) {
            case TokenType::IDENTIFIER:     nt.code = "\x01ID";  break;
            case TokenType::STRING_LITERAL: nt.code = "\x01STR"; break;
            case TokenType::CHAR_LITERAL:   nt.code = "\x01CHR"; break;
            case TokenType::NUMBER_LITERAL: nt.code = "\x01NUM"; break;
            default:                        nt.code = t.value;  break;
        }
        entry.tokens.push_back(std::move(nt));
    }

    m_tokenStreams.push_back(std::move(entry));
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

DuplicationReport MetricsEngine::buildDuplicationReport() const {
    DuplicationReport report;

    // Group token streams by language -- duplication across different
    // languages is not meaningful (disjoint keyword/operator sets across
    // languages already make cross-language matches vanishingly rare,
    // and grouping keeps every reported pair actionable: "this Python
    // block repeats that Python block", never a mixed-language false
    // positive).
    std::unordered_map<std::string, std::vector<const FileTokenStream*>> byLanguage;
    for (const auto& entry : m_tokenStreams) {
        byLanguage[entry.language].push_back(&entry);
    }

    std::vector<DuplicateMatch> allMatches;
    for (const auto& group : byLanguage) {
        detectDuplicatesWithinLanguage(group.second, allMatches);
    }

    // Largest/most-valuable-to-fix match first; stable tie-break by path.
    std::sort(allMatches.begin(), allMatches.end(),
              [](const DuplicateMatch& a, const DuplicateMatch& b) {
                  if (a.tokenCount != b.tokenCount) return a.tokenCount > b.tokenCount;
                  if (a.pathA != b.pathA) return a.pathA < b.pathA;
                  return a.lineStartA < b.lineStartA;
              });

    report.matches = std::move(allMatches);

    // Deduplicated line coverage per file, for the headline percentage:
    // merge overlapping/adjacent [start,end] intervals per path so a
    // line counted by more than one match is only counted once.
    std::unordered_map<std::string, std::vector<std::pair<int, int>>> intervalsByPath;
    for (const auto& m : report.matches) {
        intervalsByPath[m.pathA].emplace_back(m.lineStartA, m.lineEndA);
        intervalsByPath[m.pathB].emplace_back(m.lineStartB, m.lineEndB);
    }

    int duplicateLines = 0;
    for (auto& pathIntervals : intervalsByPath) {
        auto& intervals = pathIntervals.second;
        std::sort(intervals.begin(), intervals.end());

        int mergedStart = -1;
        int mergedEnd   = -1;
        for (const auto& interval : intervals) {
            if (mergedStart == -1) {
                mergedStart = interval.first;
                mergedEnd   = interval.second;
                continue;
            }
            if (interval.first <= mergedEnd + 1) {
                mergedEnd = std::max(mergedEnd, interval.second);
            } else {
                duplicateLines += (mergedEnd - mergedStart + 1);
                mergedStart = interval.first;
                mergedEnd   = interval.second;
            }
        }
        if (mergedStart != -1) duplicateLines += (mergedEnd - mergedStart + 1);
    }
    report.duplicateLineCount = duplicateLines;

    int totalCodeLines = 0;
    for (const auto& fileEntry : m_files) totalCodeLines += fileEntry.second.codeLines;

    report.duplicatePercentage =
        (totalCodeLines > 0)
            ? (static_cast<double>(duplicateLines) / totalCodeLines) * 100.0
            : 0.0;

    return report;
}
 
} // namespace cma
