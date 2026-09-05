#pragma once
 
#include "metrics/Metrics.h"
 
namespace cma {
 
// The five weighted components computeHealthScore() already calculates
// internally (complexity density 35%, avg function length 25%, comment
// coverage 20%, TODO density 10%, nesting depth 10%) — previously
// discarded after being folded into HealthScore::score. Each component
// is itself a 0-100 sub-score, same scale as the overall score.
struct ScoreBreakdown {
    double complexityDensity = 0.0; // s1, weight 0.35
    double avgFunctionLength = 0.0; // s2, weight 0.25
    double commentCoverage   = 0.0; // s3, weight 0.20
    double todoDensity       = 0.0; // s4, weight 0.10
    double nestingDepth      = 0.0; // s5, weight 0.10
};
struct HealthScore {
    double         score = 0.0;
    char           grade = 'F';
    ScoreBreakdown breakdown;
};
 
[[nodiscard]] HealthScore computeHealthScore(const ProjectMetrics& metrics) noexcept;
 
} // namespace cma
 
