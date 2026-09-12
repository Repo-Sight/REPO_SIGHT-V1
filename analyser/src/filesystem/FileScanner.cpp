#include "filesystem/FileScanner.h"

#include <algorithm>
#include <fstream>
#include <iostream>
#include <sstream>
#include <unordered_set>

namespace cma {

namespace {

const std::unordered_set<std::string> kSupportedExtensions = {
    ".cpp", ".cc", ".cxx", ".c++",
    ".h",   ".hpp", ".hxx", ".h++",
    ".py",
    ".java",
    ".ts", ".tsx",
    ".js", ".mjs", ".cjs", ".jsx",
    ".cs"
};

// Directories that never contain source code worth analyzing: vendored
// dependencies, VCS internals, build/output artifacts. Pruned entirely
// (recursion into them is disabled, not just filtered afterward), so
// this also caps traversal cost on repos with large dependency trees --
// relevant given the analyzer's serverless time budget.
// Matched by exact directory name at any depth, not by path.
const std::unordered_set<std::string> kExcludedDirectories = {
    // VCS / editor
    ".git", ".idea", ".vscode",
    // JS/TS
    "node_modules", ".next",
    // Python
    "venv", ".venv", "__pycache__", ".pytest_cache", ".mypy_cache",
    ".tox", ".eggs",
    // Rust / general vendored deps
    "vendor", "target",
    // Java / Kotlin (Gradle)
    ".gradle",
    // C# / .NET -- bin/obj are near-universal per-project build output;
    // relevant now since C# is next in line for real analysis (Phase 2a).
    // Tradeoff: this would also exclude a hand-rolled top-level bin/ of
    // CLI scripts in a non-.NET repo -- accepted, since such scripts are
    // rarely what someone wants complexity/health-scored anyway.
    "bin", "obj",
    // iOS / Swift
    "Pods", ".build",
    // Generic build output / coverage / caches
    "build", "dist", "out", "coverage", ".cache"
};

} // anonymous namespace

FileScanner::FileScanner(std::filesystem::path rootPath)
    : m_rootPath(std::move(rootPath)) {}

std::vector<std::filesystem::path> FileScanner::scan(
    std::vector<UnsupportedFile>* unsupported) const {
    std::vector<std::filesystem::path> files;
    std::error_code ec;

    if (unsupported != nullptr) unsupported->clear();

    if (!std::filesystem::exists(m_rootPath, ec) || ec) {
        std::cerr << "[FileScanner] Path does not exist: " << m_rootPath << '\n';
        return files;
    }

    if (std::filesystem::is_regular_file(m_rootPath)) {
        if (isSupportedFile(m_rootPath)) {
            files.push_back(m_rootPath);
        } else {
            std::cerr << "[FileScanner] File is not a recognised source file: "
                      << m_rootPath << '\n';
            const std::string ext = m_rootPath.extension().string();
            if (unsupported != nullptr && !ext.empty()) {
                unsupported->push_back(UnsupportedFile{m_rootPath, ext});
            }
        }
        return files;
    }

    if (!std::filesystem::is_directory(m_rootPath)) {
        std::cerr << "[FileScanner] Path is neither a file nor a directory: "
                  << m_rootPath << '\n';
        return files;
    }

    try {
        const auto opts = std::filesystem::directory_options::skip_permission_denied;

        for (auto it = std::filesystem::recursive_directory_iterator(m_rootPath, opts);
             it != std::filesystem::recursive_directory_iterator(); ++it) {
            const auto& entry = *it;

            if (entry.is_directory() &&
                kExcludedDirectories.count(entry.path().filename().string()) > 0) {
                it.disable_recursion_pending();
                continue;
            }

            if (!entry.is_regular_file()) continue;

            if (isSupportedFile(entry.path())) {
                files.push_back(entry.path());
            } else if (unsupported != nullptr) {
                const std::string ext = entry.path().extension().string();
                if (!ext.empty()) {
                    unsupported->push_back(UnsupportedFile{entry.path(), ext});
                }
            }
        }
    } catch (const std::filesystem::filesystem_error& e) {
        std::cerr << "[FileScanner] Filesystem error during scan: " << e.what() << '\n';
    }

    std::sort(files.begin(), files.end());
    if (unsupported != nullptr) {
        std::sort(unsupported->begin(), unsupported->end(),
                   [](const UnsupportedFile& a, const UnsupportedFile& b) {
                       return a.path < b.path;
                   });
    }

    return files;
}

std::optional<std::string> FileScanner::readFile(
    const std::filesystem::path& filePath) {

    std::ifstream stream(filePath, std::ios::in);
    if (!stream.is_open()) {
        std::cerr << "[FileScanner] Cannot open: " << filePath << '\n';
        return std::nullopt;
    }

    std::ostringstream buf;
    buf << stream.rdbuf();

    if (stream.bad()) {
        std::cerr << "[FileScanner] I/O error reading: " << filePath << '\n';
        return std::nullopt;
    }

    return buf.str();
}

bool FileScanner::isSupportedFile(const std::filesystem::path& path) {
    return kSupportedExtensions.count(path.extension().string()) > 0;
}

} // namespace cma
