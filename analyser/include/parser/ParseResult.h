
#pragma once
 
#include <string>
#include <vector>
 
namespace cma {
 
struct FunctionInfo {
    std::string name;
    int         startLine = 0;
    int         endLine   = 0;
 
    [[nodiscard]] int lineCount() const noexcept {
        return (endLine >= startLine) ? (endLine - startLine + 1) : 0;
    }
};
 
struct ClassInfo {
    enum class Kind { CLASS, STRUCT, ENUM, NAMESPACE };
 
    std::string name;
    int         line = 0;
    Kind        kind = Kind::CLASS;
};
 
struct FileMetrics {
    // Populated by main.cpp from the detectLanguage() dispatch that already
    // runs per file (see common/Language.h::languageToString). Empty only
    // for FileMetrics built directly in tests without going through main's
    // pipeline.
    std::string language;

    int totalLines   = 0;
    int blankLines   = 0;
    int commentLines = 0;
    int codeLines    = 0;
 
    std::vector<FunctionInfo> functions;
    std::vector<ClassInfo>    classes;
    int                       includeCount  = 0;
    // One entry per include/import directive, parallel to includeCount
    // (invariant: includeTargets.size() == includeCount always holds).
    std::vector<std::string> includeTargets;
    int variableCount = 0;
 
    int loopCount            = 0;
    int conditionCount       = 0;
    int tryCatchCount        = 0;
    int maxNestingDepth      = 0;
    int cyclomaticComplexity = 1;
 
    int todoCount = 0;
 
    [[nodiscard]] int functionCount() const noexcept {
        return static_cast<int>(functions.size());
    }
    [[nodiscard]] int classCount() const noexcept {
        return static_cast<int>(classes.size());
    }
 
    [[nodiscard]] const FunctionInfo* longestFunction() const noexcept;
    [[nodiscard]] double              avgFunctionLength() const noexcept;
};
 
} // namespace cma
 
