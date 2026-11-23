#pragma once

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace cma {

// Time-budgeted ("partial") scans, used by the hosted service whose function has a hard wall-clock
// limit. The CLI and the GitHub Action never pass a budget and are unaffected.
//
// How it works: with --time-budget-ms the analysis loop stops starting new files once
// kLoopBudgetShare of the budget is gone, and the remaining share is left for everything that runs
// after the loop (dependency graph, duplication, JSON). The files that were not reached are simply
// not analyzed and the report says so ("partial").
//
// Which files get analyzed matters: alphabetical order would sample only the first directories.
// Files are therefore visited in a fixed pseudo-random order (FNV-1a of the path), so the analyzed
// part is a uniform sample of the repository and the density-based health score estimates the whole.
// The order depends only on the path strings, never on the machine or the run.

// Share of the budget the analysis loop may use. The rest covers post-loop work (duplication, JSON,
// dependency graph), which grows with the files analyzed. Measured on a 27k-file repo: loop 2.0s of
// 7.3s total (27%), so a 25% loop share keeps total time near the budget even for the heaviest case.
constexpr double kLoopBudgetShare = 0.25;

[[nodiscard]] constexpr std::uint64_t fnv1a64(std::string_view s) {
    std::uint64_t h = 14695981039346656037ULL;
    for (const char c : s) {
        h ^= static_cast<unsigned char>(c);
        h *= 1099511628211ULL;
    }
    return h;
}

// Deterministic sampling order: by hash of the path string, the path itself as tiebreak.
inline void orderForSampling(std::vector<std::filesystem::path>& files) {
    std::sort(files.begin(), files.end(),
              [](const std::filesystem::path& a, const std::filesystem::path& b) {
                  const std::string sa = a.string();
                  const std::string sb = b.string();
                  const std::uint64_t ha = fnv1a64(sa);
                  const std::uint64_t hb = fnv1a64(sb);
                  return ha != hb ? ha < hb : sa < sb;
              });
}

// Budget in milliseconds measured from construction; 0 (or negative) means no budget, never expires.
class LoopDeadline {
public:
    explicit LoopDeadline(long long budgetMs)
        : m_enabled(budgetMs > 0),
          m_start(std::chrono::steady_clock::now()),
          m_loopLimit(std::chrono::duration_cast<std::chrono::steady_clock::duration>(
              std::chrono::duration<double, std::milli>(static_cast<double>(budgetMs) * kLoopBudgetShare))) {}

    [[nodiscard]] bool enabled() const { return m_enabled; }
    [[nodiscard]] bool expired() const {
        return m_enabled && (std::chrono::steady_clock::now() - m_start) >= m_loopLimit;
    }

private:
    bool m_enabled;
    std::chrono::steady_clock::time_point m_start;
    std::chrono::steady_clock::duration   m_loopLimit;
};

} // namespace cma
