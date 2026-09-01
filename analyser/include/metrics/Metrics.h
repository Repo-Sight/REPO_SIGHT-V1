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
};
 
} // namespace cma
 
