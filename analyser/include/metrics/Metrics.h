#pragma once
 
#include <string>
#include <vector>
namespace cma {
 
// Per-language mirror of ProjectMetrics's own aggregation fields, one
// entry per distinct FileMetrics::language value seen. Built by grouping
// the existing per-file records (MetricsEngine::compute()) — not a
// separate scan.
struct LanguageAggregate {
    std::string language;
    int         fileCount = 0;

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

   double      avgFunctionLength    = 0.0;
    int         longestFunctionLines = 0;
    std::string longestFunctionName;
};
// Aggregated view of files discovered on disk whose extension isn't
// recognized by any language front-end (see FileScanner::scan()'s
// unsupported out-param). No tokenize/parse runs on these -- only a
// cheap newline count -- so this tracks presence and volume, not code
// quality, for languages REPO-SIGHT doesn't analyze yet.
struct UnanalyzedLanguageSummary {
    std::string extension;    // e.g. ".go" -- includes the dot, matches FileScanner's convention
    std::string languageName; // e.g. "Go" -- see common/UnanalyzedLanguageNames.h
    int         fileCount = 0;
    int         lineCount = 0; // sum of cheap newline counts across files of this extension
};

struct ProjectMetrics {
    int filesAnalyzed = 0;
 
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
 
    double      avgFunctionLength    = 0.0;
    int         longestFunctionLines = 0;
    std::string longestFunctionName;

    // Grouping of the same per-file records above, by FileMetrics::language.
    // Sorted by codeLines descending (largest language in the project first),
     // language name as tiebreak for determinism.
    std::vector<LanguageAggregate> byLanguage;

    // Files discovered on disk but not analyzed (no recognized language
    // front-end), grouped by extension. Populated via
    // MetricsEngine::addUnanalyzedFile(); empty if every discovered file
    // was analyzed. Sorted by lineCount descending, extension as tiebreak.
    std::vector<U
};
 
} // namespace cma
 
