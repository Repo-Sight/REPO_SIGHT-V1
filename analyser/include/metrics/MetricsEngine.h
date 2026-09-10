#pragma once
 
#include "Metrics.h"
#include "DependencyGraph.h"
#include "DuplicationReport.h"
#include "HotspotReport.h"
#include "lexer/Token.h"
#include "parser/ParseResult.h"
#include "vcs/GitHistory.h"
 
#include <string>
#include <utility>
#include <vector>
 
namespace cma {

// Normalized token used only for duplication detection (Phase 6a) --
// distinct from lexer::Token, which is not retained after normalizing
// (see MetricsEngine::addFileTokens()). Identifiers and literals are
// collapsed to placeholders so renamed variables / changed literal
// values still count as duplicates (Type-2 clone detection); everything
// else (keywords, operators, punctuation, braces) keeps its literal
// text since that IS the structural signal. Comments/newlines are
// dropped entirely -- formatting differences should never block a match.
struct NormalizedToken {
    std::string code;
    int         line = 0;
};

// One file's normalized token stream, retained only for the lifetime of
// a single `cma` run -- not part of FileMetrics or the JSON schema.
struct FileTokenStream {
    std::string path;
    std::string language;
    std::vector<NormalizedToken> tokens;
};
 
class MetricsEngine {
public:
    void addFile(const std::string& filename, FileMetrics metrics);
 
    // Records a file that was discovered but not analyzed (unrecognized
    // extension) -- see FileScanner::scan()'s unsupported out-param.
    // lineCount is a cheap newline count, not full FileMetrics -- no
    // front-end exists to parse this file. Grouped by extension into
    // ProjectMetrics::unanalyzedLanguages at compute() time.
    void addUnanalyzedFile(std::string extension, int lineCount);

    // Records a file's token stream for duplication detection (Phase
    // 6a). Normalizes and stores a compact copy internally -- the raw
    // Token vector passed in is not retained, so callers are free to
    // discard/reuse it right after this call (see main.cpp's per-file
    // loop, which also feeds the same tokens into checkRules()).
    void addFileTokens(const std::string& path, const std::string& language,
                        const std::vector<Token>& tokens);
 
    [[nodiscard]] ProjectMetrics compute() const;
 
    [[nodiscard]] const std::vector<std::pair<std::string, FileMetrics>>&
    files() const noexcept;
 
    [[nodiscard]] DependencyGraph buildDependencyGraph() const;
 
    [[nodiscard]] HotspotReport buildHotspotReport(const GitHistory& git) const;

    [[nodiscard]] DuplicationReport buildDuplicationReport() const;
 
private:
    std::vector<std::pair<std::string, FileMetrics>> m_files;
 
    // (extension, lineCount) per unanalyzed file, grouped in compute().
    std::vector<std::pair<std::string, int>> m_unanalyzedFiles;

    // One entry per file passed to addFileTokens(), consumed only by
    // buildDuplicationReport().
    std::vector<FileTokenStream> m_tokenStreams;
};
 
} // namespace cma
