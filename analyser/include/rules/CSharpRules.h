#pragma once

#include "lexer/Token.h"
#include "parser/ParseResult.h"
#include "metrics/ViolationReport.h"

#include <string>
#include <vector>

namespace cma {

// C# anti-pattern / best-practice rule catalog -- Phase 2a, #3 of 3
// (7 rules, same "token stream + FileMetrics only" contract as
// CppRules.h/JavaRules.h/TypeScriptRules.h/JavaScriptRules.h).
//
// Rules:
//   csharp-empty-catch-block   empty catch (Type e) { } or catch { }
//                              body (C# allows the typeless/bindingless
//                              form, same shape as TS's optional-catch-
//                              binding)
//   csharp-public-field        a public field (excludes public static
//                              readonly/const constants and methods)
//   csharp-console-writeline   Console.WriteLine(...) / Console.Write(...)
//                              call -- prefer a logger in production code
//   csharp-async-void          'async void Method(...)' -- exceptions
//                              thrown inside can't be awaited/caught by
//                              the caller; prefer 'async Task'
//   csharp-long-method         same threshold as Java's/TS's
//   csharp-deep-nesting        same threshold as Java's/TS's
//   csharp-todo-without-ticket same shape as Java's/TS's
[[nodiscard]] std::vector<Violation> checkCSharpRules(
    const std::string& path, const std::vector<Token>& tokens, const FileMetrics& fm);

} // namespace cma
