+#pragma once
+
+#include "lexer/Token.h"
+#include "parser/ParseResult.h"
+#include "metrics/ViolationReport.h"
+
+#include <string>
+#include <vector>
+
+namespace cma {
+
+// TypeScript anti-pattern / best-practice rule catalog -- Phase 2a
+// (7 rules, same "token stream + FileMetrics only" contract as
+// CppRules.h/JavaRules.h/PythonRules.h).
+//
+// Rules:
+//   ts-empty-catch-block   empty catch (e) { } or catch { } body
+//                          (TS/JS allow the optional-catch-binding form)
+//   ts-explicit-any        ': any' type annotation or 'as any' assertion
+//   ts-var-usage           legacy 'var' instead of 'let'/'const'
+//   ts-loose-equality      '==' / '!=' instead of '===' / '!=='
+//   ts-long-method         same threshold as Java's/C++'s
+//   ts-deep-nesting        same threshold as Java's/C++'s
+//   ts-todo-without-ticket same shape as Java's/C++'s
+[[nodiscard]] std::vector<Violation> checkTypeScriptRules(
+    const std::string& path, const std::vector<Token>& tokens, const FileMetrics& fm);
+
+} // namespace cma
