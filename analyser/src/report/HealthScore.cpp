#include "report/HealthScore.h"
 
#include <algorithm>
#include <array>
 
namespace cma {
 
namespace {
 
double scoreComponent(double value, double goodRef, double badRef) noexcept {
    if (goodRef == badRef) return 100.0;
    double t = (value - badRef) / (goodRef - badRef);
    t = std::clamp(t, 0.0, 1.0);
    return t * 100.0;
}
 
constexpr double kComplexityDensityWeight = 0.35;
constexpr double kComplexityDensityGood   = 0.15;
constexpr double kComplexityDensityBad    = 0.50;
 
constexpr double kAvgFunctionLengthWeight = 0.25;
constexpr double kAvgFunctionLengthGood   = 15.0;
constexpr double kAvgFunctionLengthBad    = 60.0;
 
constexpr double kCommentDensityWeight = 0.20;
constexpr double kCommentDensityGood   = 0.20;
constexpr double kCommentDensityBad    = 0.02;
 
constexpr double kTodoDensityWeight = 0.10;
constexpr double kTodoDensityGood   = 0.01;
constexpr double kTodoDensityBad    = 0.05;
 
constexpr double kNestingDepthWeight = 0.10;
constexpr double kNestingDepthGood   = 3.0;
constexpr double kNestingDepthBad    = 8.0;
 
char gradeFor(double score) noexcept {
    if (score >= 90.0) return 'A';
    if (score >= 80.0) return 'B';
    if (score >= 70.0) return 'C';
    if (score >= 60.0) return 'D';
    return 'F';
}
 
} // anonymous namespace
 
HealthScore computeHealthScore(const ProjectMetrics& m) noexcept {
    const double codeLines = std::max(1, m.codeLines);
 
    const double complexityDensity = m.cyclomaticComplexity / codeLines;
    const double commentDensity    = m.commentLines / codeLines;
    const double todoDensity       = m.todoCount / codeLines;
 
    const double s1 = scoreComponent(complexityDensity, kComplexityDensityGood, kComplexityDensityBad);
    const double s2 = scoreComponent(m.avgFunctionLength, kAvgFunctionLengthGood, kAvgFunctionLengthBad);
    const double s3 = scoreComponent(commentDensity, kCommentDensityGood, kCommentDensityBad);
    const double s4 = scoreComponent(todoDensity, kTodoDensityGood, kTodoDensityBad);
    const double s5 = scoreComponent(static_cast<double>(m.maxNestingDepth), kNestingDepthGood, kNestingDepthBad);
 
    const double overall =
        kComplexityDensityWeight * s1 +
        kAvgFunctionLengthWeight * s2 +
        kCommentDensityWeight    * s3 +
        kTodoDensityWeight       * s4 +
        kNestingDepthWeight      * s5;
 
    HealthScore result;
    result.score = overall;
    result.grade = gradeFor(overall);
     result.breakdown.complexityDensity = s1;
    result.breakdown.avgFunctionLength = s2;
    result.breakdown.commentCoverage   = s3;
    result.breakdown.todoDensity       = s4;
    result.breakdown.nestingDepth      = s5;
    return result;
}
 
} // namespace cma
 
