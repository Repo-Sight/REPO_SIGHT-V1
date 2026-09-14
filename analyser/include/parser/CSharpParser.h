#pragma once

#include "BraceBlockAnalyzer.h"
#include "ParseResult.h"
#include "lexer/Token.h"

#include <string>
#include <vector>

namespace cma {

// Structural analyzer for the C# front-end (Phase 2a, #3 of 3, completes
// the phase). Per the V2 plan's Section 2.3, C# is structurally closer
// to JavaParser's shape than to TypeScriptParser/JavaScriptParser's:
// nominally-typed, class-based, and -- critically for the existing
// identifier-followed-by-'('-means-function-start heuristic -- C# puts
// the return type *before* the method name, exactly like Java and
// unlike TS/JS's name-first-then-type-annotation shape. That means this
// parser reuses Java's simpler skipTrailingSpecifiers() shape (no
// TS-style angle/paren-tracked return-type skip is needed) and Java's
// implicit parameter-counting approach (parameters fall out of the same
// generic handleVariableDecl() used for local declarations, since a C#
// parameter is `Type name` just like a Java one -- no separate
// countParameters() needed the way TS's reversed `name: Type` shape
// required).
//
// Real C#-only accommodations needed on top of Java's shape:
//   - lambda expressions (`(x) => { }`, `x => { }`), including naming
//     one from a preceding `name =` binding -- reuses TypeScriptParser's
//     tryBeginArrowFunction()/pendingArrowName technique verbatim, since
//     C# lambdas use the identical `=>` syntax. Expression-bodied
//     lambdas (`x => x + 1`) are out of scope for the same reason TS's
//     are: no brace body means no endLine to track.
//   - expression-bodied members (`public int Foo() => 42;`) -- same
//     scope limit as expression-bodied lambdas, for the same reason.
//   - generic method names (`T Max<T>(T a, T b)`): the method name is
//     followed by '<...>' before the parameter list, not by '(' the way
//     Java's method names always are -- Java has no equivalent (Java's
//     `<T>` sits *before* the return type, not after the name, so
//     Java's method name is still always immediately followed by '(').
//     trySkipGenericArgsToParen() handles this: on seeing
//     `identifier <`, it scans for a balanced '>' and requires the very
//     next token to be '(' before treating it as a possible function
//     start at all, bailing out (silently, no miscount) the moment it
//     sees a brace/paren/semicolon at unbalanced depth -- which is
//     exactly the shape a real comparison expression (`x < y > z;`)
//     produces, so ordinary comparisons are never misdetected as
//     generic method names. This same bailout, plus the existing
//     "must be followed by '{'" check every function-start candidate
//     already goes through, is also what protects a generic *call*
//     (`Foo.Bar<int>(5);`) from being misdetected as a declaration --
//     no special-casing beyond what already protects plain calls
//     (`console.log(...)`-style) was needed.
//   - generic type-parameter constraint clauses (`Method<T>(...) where
//     T : IComparable<T>`), which sit between the parameter list's ')'
//     and the body's '{' -- skipTrailingSpecifiers() gains a `where`
//     case mirroring Java's existing `throws`-clause skip shape exactly
//     (advance until '{' or ';'), since a constraint clause can't
//     validly contain either before the real body starts.
//   - `using` directives (the import equivalent) vs. `using (...)`
//     resource-acquisition statements vs. `using var x = ...;`
//     using-declarations -- all three start with the same KEYWORD, so
//     handleKeyword() only treats it as an import when the next token
//     is an IDENTIFIER (a namespace path) or the `static` keyword;
//     `using (` and `using var` are left alone as ordinary statements.
//   - nullable-value-type '?' (`int? x`) vs. ternary '?' vs. null-
//     conditional '?.'/'?['  vs. null-coalescing '??'/'??=': lookahead
//     (next token is '?', '.', or '[') resolves the chaining/coalescing
//     forms first, reusing TypeScriptParser's technique; a nullable-
//     value-type marker is then recognized by *lookback* -- the
//     immediately preceding token is one of C#'s built-in value-type
//     keywords (int, bool, double, ...) -- since a bare value-type
//     keyword token can only legally precede '?' via that syntax in
//     valid C#, this specific check has no realistic false positive.
//     Anything else falls through to ternary, same as TS. Documented
//     scope limit: a nullable *reference*/user type (`MyClass? obj`,
//     `string? name`) isn't distinguished from a ternary condition that
//     happens to be a bare identifier (`flag ? a : b`) -- both have an
//     IDENTIFIER immediately before '?', which lookback alone can't
//     disambiguate without real type resolution. Only the built-in-
//     keyword case is handled; this is the same class of imprecision
//     the project already accepts for identifier-typed declarations
//     elsewhere (e.g. Java's `String s = ...` not counting as a
//     variable declaration).
//   - `async void` isn't specially detected here (that's a rule, see
//     CSharpRules.h) but `async`/`await`/`when` (switch-case guard
//     clauses) are recognized keywords; `when` adds one decision point
//     the same way `case` does, since a guard clause is a genuine extra
//     predicate on that case.
//   - records / record structs (`record Point(int X, int Y);`, `record
//     struct Point(...)`, `record class Point(...)`) map to
//     ClassInfo::Kind::STRUCT, matching Java's own established
//     precedent of mapping *its* `record` keyword to STRUCT. The
//     two-keyword `record struct`/`record class` form is unwrapped
//     (the extra keyword is skipped) so the type name is still found in
//     the right place. The record's positional parameter list
//     (`(int X, int Y)`) is protected from being misdetected as a
//     function by the same guard-list mechanism Java already uses to
//     protect its own record syntax (the preceding-keyword exclusion
//     list here also includes "struct").
//   - `namespace Foo.Bar { }` and the C# 10 file-scoped
//     `namespace Foo.Bar;` (no braces at all -- the rest of the file is
//     implicitly inside it) both map to ClassInfo::Kind::NAMESPACE,
//     matching TypeScriptParser's own namespace handling. Only the
//     first dotted segment ("Foo") is captured as the name -- the same
//     partial-capture limitation TS's own namespace handling already
//     has for nothing dotted to begin with; C#'s namespaces commonly
//     are dotted, so this is a real (documented) precision loss, not a
//     new kind of one.
//
// Deliberately out of scope for this pass (documented, not silent):
//   - property accessor bodies (`public int Foo { get { ... } set { ...
//     } }`) are not tracked as separate FunctionInfo entries. The
//     existing function-detection heuristic requires an identifier
//     immediately followed by '(', which `get`/`set` block-bodied
//     accessors never are (auto-properties `{ get; set; }` have no
//     body at all). Adding bespoke accessor-body detection was
//     considered and rejected: the natural trigger shape
//     (`identifier { ...`) is indistinguishable at the token level from
//     an object-initializer (`new Foo { Bar = 1 }`), and a heuristic
//     that risks misfiring on that extremely common pattern is worse
//     than the documented gap. Accessor bodies' contents still fully
//     participate in file-level complexity/nesting/loop/condition
//     counts (those accumulate globally over brace-tracked scope, not
//     per-function) -- only the `functions[]` list (avg-function-length,
//     per-function long-method rule) omits them.
//   - switch *expressions* (`x switch { 1 => "one", _ => "other" }`,
//     C# 8+): the enclosing `switch` keyword is still counted as one
//     decision point exactly like a switch statement's `switch` keyword
//     is, but individual arms add no complexity of their own the way a
//     switch statement's `case` labels do -- an expression arm has no
//     `case` keyword to hook into (its syntax is `pattern => result`,
//     not `case pattern:`), and counting `=>` occurrences generically
//     would double-count real lambdas that happen to appear as an arm's
//     result expression.
//   - destructured/tuple deconstruction bindings (`var (a, b) = point;`)
//     aren't counted -- same class of limitation TS's own destructured-
//     binding gap already documents.
class CSharpParser {
public:
    explicit CSharpParser(const std::vector<Token>& tokens, int totalLines);

    [[nodiscard]] FileMetrics analyze();

private:
    struct PendingFunction {
        FunctionInfo info;
        int          bodyBraceDepth = 0;
    };

    void classifyLines();

    void walkTokens();
    void handleKeyword(std::size_t idx);
    void tryBeginFunction(std::size_t identIdx, std::size_t openParenIdx);
    void tryBeginArrowFunction(std::size_t arrowFirstIdx);
    void handleVariableDecl(std::size_t identIdx);
    void tryRecordClass(std::size_t kwIdx, const std::string& kwValue);

    // True when the token immediately before idx is one of C#'s built-in
    // value-type keywords (int, bool, double, ...) -- see the class
    // comment's '?' disambiguation note for why this is the one lookback
    // check used to recognize a nullable-value-type marker rather than
    // a ternary.
    [[nodiscard]] bool precededByValueTypeKeyword(std::size_t idx) const noexcept;

    [[nodiscard]] std::string extractUsingTarget(std::size_t kwIdx) const;

    [[nodiscard]] std::size_t findMatchingParen(std::size_t openIdx) const;
    [[nodiscard]] std::size_t skipTrailingSpecifiers(std::size_t afterCloseParen) const;
    // On seeing `identifier <`, looks for a balanced '>' followed
    // immediately (mod newlines) by '(' -- i.e. a generic method name.
    // Returns that '(' index, or m_tokens.size() if the shape doesn't
    // match (bailing out the moment an unbalanced brace/paren/semicolon
    // is seen, so an ordinary comparison like `x < y > z` is never
    // mistaken for one).
    [[nodiscard]] std::size_t trySkipGenericArgsToParen(std::size_t ltIdx) const;

    [[nodiscard]] int countTodos(const std::string& commentText) const;

    const std::vector<Token>& m_tokens;
    int                        m_totalLines;
    FileMetrics                m_result;

    BraceBlockAnalyzer            m_braceAnalyzer;
    std::vector<PendingFunction>  m_fnStack;

    // Name of the most recent `identifier =` binding seen since the
    // last statement boundary, for a following lambda to borrow instead
    // of being recorded as "<anonymous>". Same technique and lifetime
    // as TypeScriptParser's m_pendingArrowName.
    std::string m_pendingArrowName;

    enum class LineType { BLANK, COMMENT, CODE };
    std::vector<LineType> m_lineTypes;
};

} // namespace cma
