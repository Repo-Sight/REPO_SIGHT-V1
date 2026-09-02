#pragma once

#include <string>
#include <unordered_map>

namespace cma {

// Extension -> human-readable language name, used only for the "we saw
// these files but didn't analyze them" report (Metrics.h's
// UnanalyzedLanguageSummary). Deliberately separate from
// common/Language.h's kExtensionMap: that map identifies which
// front-end can actually tokenize/parse a file; this one is
// display-only labeling for files no front-end recognizes yet.
//
// An extension missing from this table isn't dropped -- it just falls
// back to the raw extension itself as the label (e.g. ".sql" -> ".sql")
// so nothing analyzed-but-unlabeled silently disappears from the report.
//
// As Phase 2a lands JavaScript/TypeScript/C# as real front-ends, their
// entries here simply stop being reached (detectLanguage() will claim
// those extensions first) -- no cleanup needed, this table just narrows
// on its own.
[[nodiscard]] inline std::string unanalyzedLanguageName(const std::string& extension) {
    static const std::unordered_map<std::string, std::string> kNames = {
        {".js",    "JavaScript"}, {".mjs",  "JavaScript"},
        {".cjs",   "JavaScript"}, {".jsx",  "JavaScript"},
        {".ts",    "TypeScript"}, {".tsx",  "TypeScript"},
        {".cs",    "C#"},
        {".go",    "Go"},
        {".rs",    "Rust"},
        {".rb",    "Ruby"},
        {".php",   "PHP"},
        {".swift", "Swift"},
        {".kt",    "Kotlin"},     {".kts", "Kotlin"},
        {".m",     "Objective-C"},
        {".scala", "Scala"},
        {".dart",  "Dart"},
    };
    const auto it = kNames.find(extension);
    return (it != kNames.end()) ? it->second : extension;
}

+} // namespace cma
