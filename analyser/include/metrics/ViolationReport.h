#pragma once
 
#include <string>
#include <vector>
 
namespace cma {
 
// One detected anti-pattern / best-practice violation -- Phase 4 Sprint 3B
// (per-language rule catalog, 21 rules across C++/Python/Java). Produced by
// checkCppRules()/checkPythonRules()/checkJavaRules() (rules/*.h),
// dispatched via rules/RuleDispatch.h's checkRules(). Deliberately flat,
// not nested per-file -- mirrors HotspotReport::files' shape: a violation
// is naturally something a consumer wants to scan/sort/filter across the
// whole project, and each entry already carries its own path+line.
//
// RECONSTRUCTED FILE: this header was never uploaded to project knowledge
// as a literal file -- only its shape was described in prose inside
// PATCH_NOTES_PHASE4_SPRINT3B.md and CMA_DOCUMENTATION_PHASE4_SPRINT3B_ADDENDUM.md.
// Rebuilt here from that description; verify against your real repo if it exists there.
struct Violation {
    std::string path;
    int         line = 0;
    std::string ruleId;    // e.g. "cpp-raw-new-delete"
    std::string language;  // "cpp" | "python" | "java" | "typescript"
    std::string message;   // short, plain-English, one line
    std::string severity;  // "info" | "warning" -- CMA never emits "error";
                            // failing a build on style is P0-3's separate,
                            // unbuilt job (quality gates / exit codes).
};
 
struct ViolationReport {
    std::vector<Violation> violations;
};
 
} // namespace cma
 
