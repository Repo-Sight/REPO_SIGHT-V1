#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <vector>
 
namespace cma {


// A file discovered during scan() whose extension isn't recognized by
// any language front-end (the complement of scan()'s own result set).
// No content is read to produce this -- path and extension only, plus
// whatever cheap line count the caller chooses to add on top (see
// main.cpp / MetricsEngine::addUnanalyzedFile()). Extensionless files
// (Makefile, Dockerfile, LICENSE, ...) are not source-language files in
// this project's sense and are excluded here, same as they always were
// from scan()'s result.
struct UnsupportedFile {
    std::filesystem::path path;
    std::string           extension; // includes the leading '.', e.g. ".go"
};

// Discovers analyzable source files within a directory tree and reads
// file content.
//
// Single responsibility: file I/O and extension-based discovery only.
// This class does not tokenize, parse, or analyze, and — deliberately —
// does not know which *language* a file is, only whether some front-end
// recognizes its extension. Language identity is a separate concern
// (see common/Language.h's detectLanguage()), kept out of this class so
// FileScanner's contract doesn't grow with every new language front-end.
// It also doesn't know human-readable display names for languages it
// can't analyze (see common/UnanalyzedLanguageNames.h) -- same reasoning.
//
// Usage:
//   FileScanner scanner("/path/to/project");
//   for (const auto& path : scanner.scan()) {
//       auto content = FileScanner::readFile(path);
//       if (content) { /* pass to the language front-end for path */ }
//   }

class FileScanner {
public:
    // rootPath may be a directory (scanned recursively) or a single file.
    // Takes by value and moves: no copy of the path string on construction.
    explicit FileScanner(std::filesystem::path rootPath);
 
    // Walks the directory tree and returns all recognized source file
    // paths (C++, Python, and Java, as of Phase 3).
    // - Sorts results for deterministic output across platforms.
    // - Silently skips permission-denied entries.
    // - Returns an empty vector (never throws) if rootPath is invalid.
    // - Never descends into vendor/build/VCS directories (see
    //   kExcludedDirectories in FileScanner.cpp) -- pruned during the
    //   walk, not filtered afterward, so a large node_modules/vendor
    //   tree doesn't cost traversal time either.
    // - If unsupported is non-null, it is also populated (same single
    //   walk) with every file whose extension isn't recognized by any
    //   front-end -- pass nullptr to skip that bookkeeping entirely.

    [[nodiscard]] std::vector<std::filesystem::path> scan(
        std::vector<UnsupportedFile>* unsupported = nullptr) const;

 
    // Reads the entire content of filePath into a std::string.
    // Returns std::nullopt if the file cannot be opened or an I/O error occurs.
    // static: requires no instance state — pure path → content transformation.
    [[nodiscard]] static std::optional<std::string> readFile(
        const std::filesystem::path& filePath);
 
private:
    std::filesystem::path m_rootPath;
 
    // Returns true if path has an extension recognized by any language
    // front-end (see the kSupportedExtensions set in FileScanner.cpp).

    [[nodiscard]] static bool isSupportedFile(const std::filesystem::path& path);
};
 
} // namespace cma
 
