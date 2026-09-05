#pragma once
 
#include <filesystem>
#include <optional>
#include <string>
#include <unordered_map>
 
namespace cma {
 
// Identifies which per-language front-end (Lexer/Parser pair) should
// process a given source file.
//
// Phase 1 introduced this as scaffolding for the multi-language platform;
// Phase 2 wired up Python; Phase 3 wires up Java.
//
// Deliberately a plain enum, not a polymorphic tag: dispatch on it is a
// switch statement (see LanguageDispatch.h), not a virtual call, which
// preserves the project's existing no-vtable, value-type style.
//
// Phase 2a adds TypeScript (first of three: TS -> JS -> C#, per the
// decided build order). .tsx is mapped to TypeScript, not a separate
// enumerator -- JSX-in-TS is still TS syntax for analysis purposes.
//
// JavaScript is second. Built as a reduction of TypeScriptLexer/Parser
// (see JavaScriptLexer.h/JavaScriptParser.h for exactly what's stripped),
// per the decided build order's rationale: TS is a superset of JS for
// essentially all control-flow/expression parsing this tool cares about,
// so deriving JS from the real TS implementation is less duplicated work
// than the reverse. .jsx maps to JavaScript, not a separate enumerator,
// mirroring the .tsx precedent above.
//
// CSharp is third and last, completing Phase 2a. Per Section 2.3 of the
// V2 plan, C# is structurally closer to Java's build-out than to TS/JS's
// (nominally-typed, class-based, type-before-name declarations) -- see
// CSharpLexer.h/CSharpParser.h for exactly which pieces mirror Java vs.
// which real C#-only accommodations (verbatim/interpolated strings,
// generic-method-name lookahead, nullable-value-type '?', 'where'
// constraint clauses) were still needed despite that closer starting
// point.
enum class Language {
    Cpp,
    Python,
    Java,
    TypeScript,
    JavaScript,
    CSharp,
};
 
// Maps a file extension to the Language that should analyze it, or
// nullopt if the extension isn't recognized by any front-end.
//
// This intentionally lives here, not in FileScanner: FileScanner's
// documented responsibility is I/O and discovery only ("it has no
// knowledge of tokens, lines, or metrics"); language identity is exactly
// that kind of semantic knowledge, so it's kept out of FileScanner and
// composed in by main.cpp instead. FileScanner still decides which files
// are *worth reading* (its own, separately-extended extension set); this
// decides *which front-end* reads them.
[[nodiscard]] inline std::optional<Language> detectLanguage(
    const std::filesystem::path& path) noexcept {
    static const std::unordered_map<std::string, Language> kExtensionMap = {
        {".cpp", Language::Cpp}, {".cc",  Language::Cpp},
        {".cxx", Language::Cpp}, {".c++", Language::Cpp},
        {".h",   Language::Cpp}, {".hpp", Language::Cpp},
        {".hxx", Language::Cpp}, {".h++", Language::Cpp},
        {".py",  Language::Python},
        {".java", Language::Java},
        {".ts",  Language::TypeScript}, {".tsx", Language::TypeScript},
        {".js",  Language::JavaScript}, {".mjs", Language::JavaScript},
        {".cjs", Language::JavaScript}, {".jsx", Language::JavaScript},
        {".cs",  Language::CSharp},
    };
    const auto it = kExtensionMap.find(path.extension().string());
    if (it == kExtensionMap.end()) return std::nullopt;
    return it->second;
}
 
// Canonical lowercase string form of a Language, matching the literal
// strings already hardcoded per-rule in CppRules.cpp/PythonRules.cpp/
// JavaRules.cpp for Violation::language ("cpp"/"python"/"java").
[[nodiscard]] inline std::string languageToString(Language lang) noexcept {
   switch (lang) {
       case Language::Cpp:    return "cpp";
       case Language::Python: return "python";
       case Language::Java:   return "java";
     case Language::TypeScript: return "typescript";
     case Language::JavaScript: return "javascript";
     case Language::CSharp:     return "csharp";
   }
    return "unknown";
}
  
} // namespace cma
