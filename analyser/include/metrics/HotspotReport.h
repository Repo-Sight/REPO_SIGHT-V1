#pragma once
 
#include <cstddef>
#include <string>
#include <vector>
 
namespace cma {
 
// How many files the no-git fallback reports. Small on purpose: the fallback
// answers "where should I look first?", not "rank everything".
inline constexpr std::size_t kComplexityFallbackTopFiles = 3;
 
struct FileHotspot {
    std::string path;
    int    cyclomaticComplexity = 0;
    int    maxNestingDepth      = 0;
    int    commitCount           = 0;
    int    linesAdded            = 0;
    int    linesDeleted          = 0;
    // git mode:        normalised complexity x normalised churn, 0..100.
    // complexity mode: mean of normalised complexity and normalised nesting
    //                  depth, 0..100 (no churn data exists in this mode).
    double hotspotScore          = 0.0;
};
 
struct HotspotReport {
    // Git mode (gitAvailable == true): every file, ranked by complexity x churn.
    // Complexity mode (gitAvailable == false): at most
    // kComplexityFallbackTopFiles files, ranked by complexity and nesting
    // depth. commitCount/linesAdded/linesDeleted are 0 in this mode. Empty when
    // no file has any branching (cyclomaticComplexity > 1).
    std::vector<FileHotspot> files;
    bool gitAvailable = false;
};
 
} // namespace cma
