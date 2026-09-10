#pragma once

#include <string>
#include <vector>

namespace cma {

// One pair of matching code blocks found by
// MetricsEngine::buildDuplicationReport() (Phase 6a). Reported with
// (pathA, lineStartA) <= (pathB, lineStartB) lexicographically, so the
// same duplicate pair is never emitted twice in swapped order.
struct DuplicateMatch {
    std::string pathA;
    int         lineStartA = 0;
    int         lineEndA   = 0;

    std::string pathB;
    int         lineStartB = 0;
    int         lineEndB   = 0;

    // Length of the match in normalized tokens (see MetricsEngine.h's
    // NormalizedToken) -- comments/whitespace are already excluded, and
    // identifiers/literals are normalized, so this reflects structural
    // size, not a raw lexer token count.
    int tokenCount = 0;

    // Lines spanned on the pathA side. pathB's span can differ slightly
    // when formatting/comments differ between the two copies; pathA's
    // span is the representative value shown in reports.
    int lineCount = 0;
};

struct DuplicationReport {
    std::vector<DuplicateMatch> matches;

    // Code lines that participate in at least one match, deduplicated
    // across overlapping matches within the same file and summed across
    // the whole project.
    int duplicateLineCount = 0;

    // duplicateLineCount as a percentage of total analyzed code lines.
    // 0 when there are no code lines (avoids a divide-by-zero at the
    // call site in MetricsEngine::buildDuplicationReport()).
    double duplicatePercentage = 0.0;
};

} // namespace cma
