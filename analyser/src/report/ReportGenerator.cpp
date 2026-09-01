#include "report/ReportGenerator.h"

#include <fstream>
#include <iomanip>
#include <sstream>

namespace cma {

namespace {
    constexpr char kSeparator[] = "==================================";

    constexpr char kHtmlCss[] =
        "body{font-family:sans-serif;margin:2rem;color:#333;}"
        "h2{border-bottom:2px solid #ddd;padding-bottom:.4rem;margin-top:1.5rem;}"
        "h3{margin:.5rem 0;}"
        "table{border-collapse:collapse;width:100%;margin:.5rem 0 1rem;}"
        "th,td{border:1px solid #ccc;padding:.3rem .7rem;text-align:left;"
               "word-break:break-all;}"
        "thead{background:#f5f5f5;}"
        "section{margin-bottom:1.5rem;}"
        ".muted{color:#888;font-style:italic;}"
        ".badge{margin:.5rem 0;}";
} // namespace

// ============================================================
// Text report
// ============================================================

void ReportGenerator::printSummary(const ProjectMetrics& metrics, std::ostream& out) {
    writeReport(metrics, out);
}

bool ReportGenerator::saveToFile(const ProjectMetrics& metrics,
                                  const std::string& outputPath) {
    std::ofstream file(outputPath, std::ios::out | std::ios::trunc);
    if (!file.is_open()) return false;
    writeReport(metrics, file);
    return file.good();
}

void ReportGenerator::writeReport(const ProjectMetrics& m, std::ostream& out) {
    out << kSeparator << '\n';
    out << "CODE METRICS REPORT\n";
    out << kSeparator << '\n';
    out << "Files Analyzed : " << m.filesAnalyzed << '\n';
    out << "Total Lines : "    << m.totalLines     << '\n';
    out << "Blank Lines : "    << m.blankLines     << '\n';
    out << "Comments : "       << m.commentLines   << '\n';
    out << "Functions : "      << m.functionCount  << '\n';
    out << "Classes : "        << m.classCount     << '\n';
    out << "Variables : "      << m.variableCount  << '\n';
    out << "Loops : "          << m.loopCount      << '\n';
    out << "Conditions : "     << m.conditionCount << '\n';
    out << "Maximum Nesting : " << m.maxNestingDepth << '\n';
    out << "Cyclomatic Complexity : " << m.cyclomaticComplexity << '\n';
    out << "Average Function Length : "
        << std::fixed << std::setprecision(1) << m.avgFunctionLength << '\n';
    if (m.longestFunctionLines > 0) {
        out << "Longest Function : " << m.longestFunctionName  << '\n';
        out << "Length : "           << m.longestFunctionLines << " lines\n";
    } else {
        out << "Longest Function : (none)\n";
    }
    out << "TODO Comments : " << m.todoCount << '\n';
    out << kSeparator << '\n';
}

// ============================================================
// JSON
// ============================================================

std::string ReportGenerator::toJson(
    const ProjectMetrics& metrics,
    const std::vector<std::pair<std::string, FileMetrics>>& files) {
    std::ostringstream out;
    writeJson(metrics, files, nullptr, nullptr, nullptr, out);
    return out.str();
}

bool ReportGenerator::saveJsonToFile(
    const ProjectMetrics& metrics,
    const std::vector<std::pair<std::string, FileMetrics>>& files,
    const std::string& outputPath) {
    std::ofstream file(outputPath, std::ios::out | std::ios::trunc);
    if (!file.is_open()) return false;
    writeJson(metrics, files, nullptr, nullptr, nullptr, file);
    return file.good();
}

std::string ReportGenerator::toJson(
    const ProjectMetrics& metrics,
    const std::vector<std::pair<std::string, FileMetrics>>& files,
    const DependencyGraph& graph) {
    std::ostringstream out;
    writeJson(metrics, files, &graph, nullptr, nullptr, out);
    return out.str();
}

bool ReportGenerator::saveJsonToFile(
    const ProjectMetrics& metrics,
    const std::vector<std::pair<std::string, FileMetrics>>& files,
    const DependencyGraph& graph,
    const std::string& outputPath) {
    std::ofstream file(outputPath, std::ios::out | std::ios::trunc);
    if (!file.is_open()) return false;
    writeJson(metrics, files, &graph, nullptr, nullptr, file);
    return file.good();
}

std::string ReportGenerator::toJson(
    const ProjectMetrics& metrics,
    const std::vector<std::pair<std::string, FileMetrics>>& files,
    const DependencyGraph& graph,
    const HotspotReport& hotspots) {
    std::ostringstream out;
    writeJson(metrics, files, &graph, &hotspots, nullptr, out);
    return out.str();
}

bool ReportGenerator::saveJsonToFile(
    const ProjectMetrics& metrics,
    const std::vector<std::pair<std::string, FileMetrics>>& files,
    const DependencyGraph& graph,
    const HotspotReport& hotspots,
    const std::string& outputPath) {
    std::ofstream file(outputPath, std::ios::out | std::ios::trunc);
    if (!file.is_open()) return false;
    writeJson(metrics, files, &graph, &hotspots, nullptr, file);
    return file.good();
}

std::string ReportGenerator::toJson(
    const ProjectMetrics& metrics,
    const std::vector<std::pair<std::string, FileMetrics>>& files,
    const DependencyGraph& graph,
    const HotspotReport& hotspots,
    const ViolationReport& violations) {
    std::ostringstream out;
    writeJson(metrics, files, &graph, &hotspots, &violations, out);
    return out.str();
}

bool ReportGenerator::saveJsonToFile(
    const ProjectMetrics& metrics,
    const std::vector<std::pair<std::string, FileMetrics>>& files,
    const DependencyGraph& graph,
    const HotspotReport& hotspots,
    const ViolationReport& violations,
    const std::string& outputPath) {
    std::ofstream file(outputPath, std::ios::out | std::ios::trunc);
    if (!file.is_open()) return false;
    writeJson(metrics, files, &graph, &hotspots, &violations, file);
    return file.good();
}

void ReportGenerator::writeJson(
    const ProjectMetrics& m,
    const std::vector<std::pair<std::string, FileMetrics>>& files,
    const DependencyGraph* graph,
    const HotspotReport* hotspots,
    const ViolationReport* violations,
    std::ostream& out) {
    out << "{\n";
    out << "  \"schemaVersion\": 2,\n";
    out << "  \"project\": {\n";
    out << "    \"filesAnalyzed\": "        << m.filesAnalyzed        << ",\n";
    out << "    \"totalLines\": "           << m.totalLines           << ",\n";
    out << "    \"blankLines\": "           << m.blankLines           << ",\n";
    out << "    \"commentLines\": "         << m.commentLines         << ",\n";
    out << "    \"codeLines\": "            << m.codeLines            << ",\n";
    out << "    \"functionCount\": "        << m.functionCount        << ",\n";
    out << "    \"classCount\": "           << m.classCount           << ",\n";
    out << "    \"variableCount\": "        << m.variableCount        << ",\n";
    out << "    \"includeCount\": "         << m.includeCount         << ",\n";
    out << "    \"loopCount\": "            << m.loopCount            << ",\n";
    out << "    \"conditionCount\": "       << m.conditionCount       << ",\n";
    out << "    \"tryCatchCount\": "        << m.tryCatchCount        << ",\n";
    out << "    \"maxNestingDepth\": "      << m.maxNestingDepth      << ",\n";
    out << "    \"cyclomaticComplexity\": " << m.cyclomaticComplexity << ",\n";
    out << "    \"todoCount\": "            << m.todoCount            << ",\n";
    out << "    \"avgFunctionLength\": "    << m.avgFunctionLength    << ",\n";
    out << "    \"longestFunctionLines\": " << m.longestFunctionLines << ",\n";
    if (hotspots != nullptr) {
        const auto health = computeHealthScore(m);
        out << "    \"longestFunctionName\": \"" << jsonEscape(m.longestFunctionName) << "\",\n";
        out << "    \"healthScore\": "  << health.score << ",\n";
        out << "    \"healthGrade\": \"" << health.grade << "\"\n";
    } else {
        out << "    \"longestFunctionName\": \"" << jsonEscape(m.longestFunctionName) << "\"\n";
    }
    out << "  },\n";

    std::unordered_map<std::string, const FileCoupling*> couplingByPath;
    if (graph != nullptr) {
        couplingByPath.reserve(graph->files.size());
        for (const auto& fc : graph->files) couplingByPath[fc.path] = &fc;
    }

    out << "  \"files\": [";
    for (std::size_t i = 0; i < files.size(); ++i) {
        out << (i == 0 ? "\n" : ",\n");
        out << "    {\n";
        out << "      \"path\": \"" << jsonEscape(files[i].first) << "\",\n";
        writeFileMetricsJson(files[i].second, out);
        if (graph != nullptr) {
            out << ",\n";
            writeDependenciesJson(couplingByPath, files[i].first, out);
        }
        out << "\n    }";
    }
    out << (files.empty() ? "" : "\n  ");
    out << "]";

    if (hotspots != nullptr) {
        out << ",\n";
        writeHotspotsJson(*hotspots, out);
    }

    if (violations != nullptr) {
        out << ",\n";
        writeViolationsJson(*violations, out);
    }

    out << "\n}\n";
}

void ReportGenerator::writeFileMetricsJson(const FileMetrics& fm, std::ostream& out) {
    out << "      \"totalLines\": "           << fm.totalLines           << ",\n";
    out << "      \"blankLines\": "           << fm.blankLines           << ",\n";
    out << "      \"commentLines\": "         << fm.commentLines         << ",\n";
    out << "      \"codeLines\": "            << fm.codeLines            << ",\n";
    out << "      \"functionCount\": "        << (fm.functions.size())   << ",\n";
    out << "      \"classCount\": "           << (fm.classes.size())     << ",\n";
    out << "      \"variableCount\": "        << fm.variableCount        << ",\n";
    out << "      \"includeCount\": "         << fm.includeCount         << ",\n";
    out << "      \"loopCount\": "            << fm.loopCount            << ",\n";
    out << "      \"conditionCount\": "       << fm.conditionCount       << ",\n";
    out << "      \"tryCatchCount\": "        << fm.tryCatchCount        << ",\n";
    out << "      \"maxNestingDepth\": "      << fm.maxNestingDepth      << ",\n";
    out << "      \"cyclomaticComplexity\": " << fm.cyclomaticComplexity << ",\n";
    out << "      \"todoCount\": "            << fm.todoCount            << ",\n";
    out << "      \"functions\": [";
    for (std::size_t i = 0; i < fm.functions.size(); ++i) {
        const auto& fn = fm.functions[i];
        out << (i == 0 ? "\n" : ",\n");
        out << "        {\"name\": \"" << jsonEscape(fn.name) << "\", "
            << "\"startLine\": " << fn.startLine << ", "
            << "\"endLine\": "   << fn.endLine   << ", "
            << "\"lineCount\": " << fn.lineCount() << "}";
    }
    out << (fm.functions.empty() ? "" : "\n      ");
    out << "],\n";

    out << "      \"classes\": [";
    for (std::size_t i = 0; i < fm.classes.size(); ++i) {
        const auto& ci = fm.classes[i];
        const char* kindStr = "class";
        switch (ci.kind) {
            case ClassInfo::Kind::CLASS:     kindStr = "class";     break;
            case ClassInfo::Kind::STRUCT:    kindStr = "struct";    break;
            case ClassInfo::Kind::ENUM:      kindStr = "enum";      break;
            case ClassInfo::Kind::NAMESPACE: kindStr = "namespace"; break;
        }
        out << (i == 0 ? "\n" : ",\n");
        out << "        {\"name\": \"" << jsonEscape(ci.name) << "\", "
            << "\"line\": " << ci.line << ", "
            << "\"kind\": \"" << kindStr << "\"}";
    }
    out << (fm.classes.empty() ? "" : "\n      ");
    out << "]";
}

void ReportGenerator::writeDependenciesJson(
    const std::unordered_map<std::string, const FileCoupling*>& couplingByPath,
    const std::string& path,
    std::ostream& out) {
    static const FileCoupling kEmpty{};
    const auto it = couplingByPath.find(path);
    const FileCoupling& fc = (it != couplingByPath.end()) ? *it->second : kEmpty;

    out << "      \"dependencies\": {\n";
    out << "        \"fanOut\": " << fc.fanOut << ",\n";
    out << "        \"fanIn\": "  << fc.fanIn  << ",\n";

    out << "        \"dependsOn\": [";
    for (std::size_t i = 0; i < fc.dependsOn.size(); ++i)
        out << (i == 0 ? "" : ", ") << "\"" << jsonEscape(fc.dependsOn[i]) << "\"";
    out << "],\n";

    out << "        \"dependedOnBy\": [";
    for (std::size_t i = 0; i < fc.dependedOnBy.size(); ++i)
        out << (i == 0 ? "" : ", ") << "\"" << jsonEscape(fc.dependedOnBy[i]) << "\"";
    out << "]\n";

    out << "      }";
}

void ReportGenerator::writeHotspotsJson(const HotspotReport& hotspots, std::ostream& out) {
    out << "  \"hotspots\": {\n";
    out << "    \"gitAvailable\": " << (hotspots.gitAvailable ? "true" : "false") << ",\n";
    out << "    \"topFiles\": [";
    for (std::size_t i = 0; i < hotspots.files.size(); ++i) {
        const auto& fh = hotspots.files[i];
        out << (i == 0 ? "\n" : ",\n");
        out << "      {\n";
        out << "        \"path\": \""             << jsonEscape(fh.path)       << "\",\n";
        out << "        \"cyclomaticComplexity\": " << fh.cyclomaticComplexity << ",\n";
        out << "        \"commitCount\": "         << fh.commitCount           << ",\n";
        out << "        \"linesAdded\": "          << fh.linesAdded            << ",\n";
        out << "        \"linesDeleted\": "        << fh.linesDeleted          << ",\n";
        out << "        \"hotspotScore\": "        << fh.hotspotScore          << "\n";
        out << "      }";
    }
    out << (hotspots.files.empty() ? "" : "\n    ");
    out << "]\n";
    out << "  }";
}

void ReportGenerator::writeViolationsJson(const ViolationReport& violations, std::ostream& out) {
    out << "  \"violations\": [";
    for (std::size_t i = 0; i < violations.violations.size(); ++i) {
        const auto& v = violations.violations[i];
        out << (i == 0 ? "\n" : ",\n");
        out << "    {\n";
        out << "      \"path\": \""     << jsonEscape(v.path)     << "\",\n";
        out << "      \"line\": "       << v.line                  << ",\n";
        out << "      \"ruleId\": \""   << jsonEscape(v.ruleId)   << "\",\n";
        out << "      \"language\": \"" << jsonEscape(v.language) << "\",\n";
        out << "      \"message\": \""  << jsonEscape(v.message)  << "\",\n";
        out << "      \"severity\": \"" << jsonEscape(v.severity) << "\"\n";
        out << "    }";
    }
    out << (violations.violations.empty() ? "" : "\n  ");
    out << "]";
}

std::string ReportGenerator::jsonEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (unsigned char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b";  break;
            case '\f': out += "\\f";  break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (c < 0x20) {
                    static const char* kHex = "0123456789abcdef";
                    out += "\\u00";
                    out += kHex[(c >> 4) & 0xF];
                    out += kHex[c & 0xF];
                } else {
                    out += static_cast<char>(c);
                }
        }
    }
    return out;
}

// ============================================================
// SVG Badge
// ============================================================

namespace {

const char* colorForGrade(char grade) {
    switch (grade) {
        case 'A': return "#4c1";
        case 'B': return "#97ca00";
        case 'C': return "#dfb317";
        case 'D': return "#fe7d37";
        default:  return "#e05d44";
    }
}

std::string xmlEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) {
        switch (c) {
            case '&':  out += "&amp;";  break;
            case '<':  out += "&lt;";   break;
            case '>':  out += "&gt;";   break;
            case '"':  out += "&quot;"; break;
            default:   out += c;
        }
    }
    return out;
}

} // anonymous namespace

std::string ReportGenerator::toBadgeSvg(const ProjectMetrics& metrics) {
    const auto health = computeHealthScore(metrics);

    std::ostringstream scoreText;
    scoreText << static_cast<int>(health.score + 0.5) << "/100 (" << health.grade << ")";
    const std::string scoreLabel = xmlEscape(scoreText.str());
    const std::string color = colorForGrade(health.grade);

    constexpr int kLabelWidth = 96;
    constexpr int kValueWidth = 92;
    constexpr int kHeight     = 20;
    const int totalWidth = kLabelWidth + kValueWidth;

    std::ostringstream svg;
    svg << "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" << totalWidth
        << "\" height=\"" << kHeight << "\" role=\"img\" aria-label=\"code health: "
        << scoreLabel << "\">\n";
    svg << "  <linearGradient id=\"s\" x2=\"0\" y2=\"100%\">\n";
    svg << "    <stop offset=\"0\" stop-color=\"#bbb\" stop-opacity=\".1\"/>\n";
    svg << "    <stop offset=\"1\" stop-opacity=\".1\"/>\n";
    svg << "  </linearGradient>\n";
    svg << "  <clipPath id=\"r\">\n";
    svg << "    <rect width=\"" << totalWidth << "\" height=\"" << kHeight << "\" rx=\"3\" fill=\"#fff\"/>\n";
    svg << "  </clipPath>\n";
    svg << "  <g clip-path=\"url(#r)\">\n";
    svg << "    <rect width=\"" << kLabelWidth << "\" height=\"" << kHeight << "\" fill=\"#555\"/>\n";
    svg << "    <rect x=\"" << kLabelWidth << "\" width=\"" << kValueWidth
        << "\" height=\"" << kHeight << "\" fill=\"" << color << "\"/>\n";
    svg << "    <rect width=\"" << totalWidth << "\" height=\"" << kHeight << "\" fill=\"url(#s)\"/>\n";
    svg << "  </g>\n";
    svg << "  <g fill=\"#fff\" text-anchor=\"middle\" "
           "font-family=\"Verdana,Geneva,DejaVu Sans,sans-serif\" font-size=\"11\">\n";
    svg << "    <text x=\"" << (kLabelWidth / 2) << "\" y=\"14\">code health</text>\n";
    svg << "    <text x=\"" << (kLabelWidth + kValueWidth / 2) << "\" y=\"14\">" << scoreLabel << "</text>\n";
    svg << "  </g>\n";
    svg << "</svg>\n";
    return svg.str();
}

bool ReportGenerator::saveBadgeToFile(const ProjectMetrics& metrics,
                                       const std::string& outputPath) {
    std::ofstream file(outputPath, std::ios::out | std::ios::trunc);
    if (!file.is_open()) return false;
    file << toBadgeSvg(metrics);
    return file.good();
}

// ============================================================
// HTML report (Phase 4 Sprint 4)
// ============================================================

std::string ReportGenerator::toHtml(
    const ProjectMetrics& metrics,
    const std::vector<std::pair<std::string, FileMetrics>>& files) {
    std::ostringstream out;
    writeHtml(metrics, files, nullptr, nullptr, nullptr, out);
    return out.str();
}

bool ReportGenerator::saveHtmlToFile(
    const ProjectMetrics& metrics,
    const std::vector<std::pair<std::string, FileMetrics>>& files,
    const std::string& outputPath) {
    std::ofstream file(outputPath, std::ios::out | std::ios::trunc);
    if (!file.is_open()) return false;
    writeHtml(metrics, files, nullptr, nullptr, nullptr, file);
    return file.good();
}

std::string ReportGenerator::toHtml(
    const ProjectMetrics& metrics,
    const std::vector<std::pair<std::string, FileMetrics>>& files,
    const DependencyGraph& graph,
    const HotspotReport& hotspots,
    const ViolationReport& violations) {
    std::ostringstream out;
    writeHtml(metrics, files, &graph, &hotspots, &violations, out);
    return out.str();
}

bool ReportGenerator::saveHtmlToFile(
    const ProjectMetrics& metrics,
    const std::vector<std::pair<std::string, FileMetrics>>& files,
    const DependencyGraph& graph,
    const HotspotReport& hotspots,
    const ViolationReport& violations,
    const std::string& outputPath) {
    std::ofstream file(outputPath, std::ios::out | std::ios::trunc);
    if (!file.is_open()) return false;
    writeHtml(metrics, files, &graph, &hotspots, &violations, file);
    return file.good();
}

std::string ReportGenerator::htmlEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (unsigned char c : s) {
        switch (c) {
            case '&':  out += "&amp;";  break;
            case '<':  out += "&lt;";   break;
            case '>':  out += "&gt;";   break;
            case '"':  out += "&quot;"; break;
            default:   out += static_cast<char>(c);
        }
    }
    return out;
}

void ReportGenerator::writeHtml(
    const ProjectMetrics& m,
    const std::vector<std::pair<std::string, FileMetrics>>& files,
    const DependencyGraph* graph,
    const HotspotReport* hotspots,
    const ViolationReport* violations,
    std::ostream& out) {

    out << "<!DOCTYPE html>\n"
        << "<html lang=\"en\">\n"
        << "<head>\n"
        << "<meta charset=\"UTF-8\">\n"
        << "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n"
        << "<title>Code Metrics Report</title>\n"
        << "<style>" << kHtmlCss << "</style>\n"
        << "</head>\n"
        << "<body>\n"
        << "<div class=\"container\">\n";

    // --- Summary section ---
    out << "<section id=\"summary\">\n"
        << "<h2>Code Metrics Report</h2>\n"
        << "<table>\n"
        << "<thead>\n"
        << "<tr><th>Metric</th><th>Value</th></tr>\n"
        << "</thead>\n"
        << "<tbody>\n";

    auto row = [&](const char* label, auto value) {
        out << "<tr><td>" << label << "</td><td>" << value << "</td></tr>\n";
    };
    row("Files Analyzed",        m.filesAnalyzed);
    row("Total Lines",           m.totalLines);
    row("Blank Lines",           m.blankLines);
    row("Comment Lines",         m.commentLines);
    row("Code Lines",            m.codeLines);
    row("Functions",             m.functionCount);
    row("Classes",               m.classCount);
    row("Loops",                 m.loopCount);
    row("Conditions",            m.conditionCount);
    row("Max Nesting Depth",     m.maxNestingDepth);
    row("Cyclomatic Complexity", m.cyclomaticComplexity);
    row("TODO Comments",         m.todoCount);

    out << "</tbody>\n"
        << "</table>\n";

    if (hotspots != nullptr) {
        out << "<h3>Code Health</h3>\n"
            << "<div class=\"badge\">"
            << toBadgeSvg(m)
            << "</div>\n";
    }

    out << "</section>\n";

    // --- Per-file breakdown section ---
    out << "<section id=\"files\">\n"
        << "<h2>Per-File Breakdown</h2>\n";
    writeHtmlFilesTable(files, out);
    out << "</section>\n";

    // --- Extended sections (5-arg only) ---
    if (graph != nullptr)
        writeHtmlDependenciesSection(files, *graph, out);
    if (hotspots != nullptr)
        writeHtmlHotspotsSection(*hotspots, out);
    if (violations != nullptr)
        writeHtmlViolationsSection(*violations, out);

    out << "</div>\n"
        << "</body>\n"
        << "</html>\n";
}

void ReportGenerator::writeHtmlFilesTable(
    const std::vector<std::pair<std::string, FileMetrics>>& files,
    std::ostream& out) {
    out << "<table>\n"
        << "<thead>\n"
        << "<tr>"
        << "<th>File</th><th>Lines</th><th>Functions</th>"
        << "<th>Classes</th><th>Complexity</th><th>TODOs</th>"
        << "</tr>\n"
        << "</thead>\n"
        << "<tbody>\n";

    for (const auto& [path, fm] : files) {
        out << "<tr>"
            << "<td>" << htmlEscape(path)        << "</td>"
            << "<td>" << fm.totalLines           << "</td>"
            << "<td>" << fm.functions.size()     << "</td>"
            << "<td>" << fm.classes.size()       << "</td>"
            << "<td>" << fm.cyclomaticComplexity << "</td>"
            << "<td>" << fm.todoCount            << "</td>"
            << "</tr>\n";
    }

    out << "</tbody>\n"
        << "</table>\n";
}

void ReportGenerator::writeHtmlDependenciesSection(
    const std::vector<std::pair<std::string, FileMetrics>>& files,
    const DependencyGraph& graph,
    std::ostream& out) {

    std::unordered_map<std::string, const FileCoupling*> couplingByPath;
    couplingByPath.reserve(graph.files.size());
    for (const auto& fc : graph.files)
        couplingByPath[fc.path] = &fc;

    out << "<section id=\"dependencies\">\n"
        << "<h2>Dependencies</h2>\n"
        << "<table>\n"
        << "<thead>\n"
        << "<tr>"
        << "<th>File</th><th>Fan-Out</th><th>Fan-In</th>"
        << "<th>Depends On</th><th>Depended On By</th>"
        << "</tr>\n"
        << "</thead>\n"
        << "<tbody>\n";

    static const FileCoupling kEmpty{};
    for (const auto& [path, fm] : files) {
        const auto it = couplingByPath.find(path);
        const FileCoupling& fc = (it != couplingByPath.end()) ? *it->second : kEmpty;

        std::string dependsOn;
        for (std::size_t i = 0; i < fc.dependsOn.size(); ++i) {
            if (i > 0) dependsOn += ", ";
            dependsOn += htmlEscape(fc.dependsOn[i]);
        }
        std::string dependedOnBy;
        for (std::size_t i = 0; i < fc.dependedOnBy.size(); ++i) {
            if (i > 0) dependedOnBy += ", ";
            dependedOnBy += htmlEscape(fc.dependedOnBy[i]);
        }

        out << "<tr>"
            << "<td>" << htmlEscape(path) << "</td>"
            << "<td>" << fc.fanOut        << "</td>"
            << "<td>" << fc.fanIn         << "</td>"
            << "<td>" << dependsOn        << "</td>"
            << "<td>" << dependedOnBy     << "</td>"
            << "</tr>\n";
    }

    out << "</tbody>\n"
        << "</table>\n"
        << "</section>\n";
}

void ReportGenerator::writeHtmlHotspotsSection(
    const HotspotReport& hotspots,
    std::ostream& out) {
    out << "<section id=\"hotspots\">\n"
        << "<h2>Hotspots</h2>\n";

    if (!hotspots.gitAvailable) {
        out << "<p class=\"muted\">Git history not available</p>\n";
    } else {
        out << "<table>\n"
            << "<thead>\n"
            << "<tr>"
            << "<th>File</th><th>Cyclomatic Complexity</th><th>Commits</th>"
            << "<th>Lines Added</th><th>Lines Deleted</th><th>Hotspot Score</th>"
            << "</tr>\n"
            << "</thead>\n"
            << "<tbody>\n";

        for (const auto& fh : hotspots.files) {
            out << "<tr>"
                << "<td>" << htmlEscape(fh.path)    << "</td>"
                << "<td>" << fh.cyclomaticComplexity << "</td>"
                << "<td>" << fh.commitCount          << "</td>"
                << "<td>" << fh.linesAdded           << "</td>"
                << "<td>" << fh.linesDeleted         << "</td>"
                << "<td>" << fh.hotspotScore         << "</td>"
                << "</tr>\n";
        }

        out << "</tbody>\n"
            << "</table>\n";
    }

    out << "</section>\n";
}

void ReportGenerator::writeHtmlViolationsSection(
    const ViolationReport& violations,
    std::ostream& out) {
    out << "<section id=\"violations\">\n"
        << "<h2>Rule Violations</h2>\n";

    if (violations.violations.empty()) {
        out << "<p class=\"muted\">No violations detected</p>\n";
    } else {
        out << "<table>\n"
            << "<thead>\n"
            << "<tr>"
            << "<th>File</th><th>Line</th><th>Rule</th>"
            << "<th>Language</th><th>Severity</th><th>Message</th>"
            << "</tr>\n"
            << "</thead>\n"
            << "<tbody>\n";

        for (const auto& v : violations.violations) {
            out << "<tr>"
                << "<td>" << htmlEscape(v.path)    << "</td>"
                << "<td>" << v.line                 << "</td>"
                << "<td>" << htmlEscape(v.ruleId)  << "</td>"
                << "<td>" << htmlEscape(v.language) << "</td>"
                << "<td>" << htmlEscape(v.severity) << "</td>"
                << "<td>" << htmlEscape(v.message)  << "</td>"
                << "</tr>\n";
        }

        out << "</tbody>\n"
            << "</table>\n";
    }

    out << "</section>\n";
}

} // namespace cma
