// Unit tests for the C front end (V3 plan, Phase 1 item 4): the C keyword dialect of CppLexer,
// extension detection and the ".h" rule, the C rule catalog (rules/CRules.h), the C cases of the
// slop and secret gates, and FileScanner picking up ".c" files. Rule cases go through checkRules()
// so the dispatch wiring is covered too.

#include "common/Language.h"
#include "filesystem/FileScanner.h"
#include "lexer/CppLexer.h"
#include "parser/CppParser.h"
#include "rules/RuleDispatch.h"

#include <gtest/gtest.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

using namespace cma;
namespace fs = std::filesystem;

namespace {

int lineCount(const std::string& src) {
    int lc = 1;
    for (char c : src) if (c == '\n') ++lc;
    return lc;
}

std::vector<Violation> runC(const std::string& src, const std::string& path = "f.c") {
    CppLexer lexer(src, CppLexer::Dialect::C);
    auto tokens = lexer.tokenize();
    CppParser parser(tokens, lineCount(src));
    auto fm = parser.analyze();
    return checkRules(Language::C, path, tokens, fm);
}

FileMetrics parseC(const std::string& src) {
    CppLexer lexer(src, CppLexer::Dialect::C);
    auto tokens = lexer.tokenize();
    CppParser parser(tokens, lineCount(src));
    return parser.analyze();
}

int count(const std::vector<Violation>& v, const std::string& id) {
    return static_cast<int>(std::count_if(v.begin(), v.end(), [&](const Violation& x) { return x.ruleId == id; }));
}

TokenType typeOf(const std::string& src, CppLexer::Dialect d, const std::string& word) {
    CppLexer lexer(src, d);
    for (const Token& t : lexer.tokenize())
        if (t.value == word) return t.type;
    return TokenType::END_OF_FILE;
}

std::string wrap(const std::string& body) { return "void f(char *in, char *msg) {\n" + body + "\n}\n"; }

} // namespace

// ------------------------------------------------------------------------------ lexer dialect

TEST(CLexer, CxxOnlyKeywordsAreIdentifiersInC) {
    for (const char* w : {"new", "delete", "class", "this", "try", "catch", "template", "namespace", "public",
                          "private", "virtual", "operator", "using", "typename", "final", "override"}) {
        EXPECT_EQ(typeOf(std::string("int ") + w + " = 1;", CppLexer::Dialect::C, w), TokenType::IDENTIFIER) << w;
        EXPECT_EQ(typeOf(std::string("int ") + w + " = 1;", CppLexer::Dialect::Cpp, w), TokenType::KEYWORD) << w;
    }
}

TEST(CLexer, CKeywordsStayKeywordsInC) {
    for (const char* w : {"struct", "union", "enum", "typedef", "static", "extern", "const", "volatile", "register",
                          "inline", "restrict", "_Bool", "_Atomic", "_Generic", "sizeof", "goto", "switch"}) {
        EXPECT_EQ(typeOf(std::string(w) + " x;", CppLexer::Dialect::C, w), TokenType::KEYWORD) << w;
    }
}

TEST(CLexer, DefaultDialectIsStillCpp) {
    CppLexer lexer("class A {};");
    bool sawClassKeyword = false;
    for (const Token& t : lexer.tokenize())
        if (t.value == "class" && t.type == TokenType::KEYWORD) sawClassKeyword = true;
    EXPECT_TRUE(sawClassKeyword);
}

// ------------------------------------------------------------------- detection and the .h rule

TEST(CLanguage, ExtensionAndName) {
    EXPECT_EQ(detectLanguage("a/b/main.c"), Language::C);
    EXPECT_EQ(detectLanguage("a/b/main.h"), Language::Cpp) << "plain detection keeps .h as C++; the scan decides";
    EXPECT_EQ(languageToString(Language::C), "c");
}

TEST(CLanguage, HeaderRuleFollowsTheWholeFileList) {
    using P = std::vector<fs::path>;
    EXPECT_EQ(headerLanguageFor(P{"a.c", "b.h"}), Language::C);
    EXPECT_EQ(headerLanguageFor(P{"a.c", "b.c", "x/y.h", "z.py"}), Language::C);
    EXPECT_EQ(headerLanguageFor(P{"b.h"}), Language::Cpp) << "a lone header (single upload) stays C++";
    EXPECT_EQ(headerLanguageFor(P{"a.c", "b.h", "c.cpp"}), Language::Cpp);
    EXPECT_EQ(headerLanguageFor(P{"a.c", "b.h", "c.cc"}), Language::Cpp);
    EXPECT_EQ(headerLanguageFor(P{"a.c", "b.h", "c.hpp"}), Language::Cpp);
    EXPECT_EQ(headerLanguageFor(P{"a.c", "b.h", "c.hxx"}), Language::Cpp);
    EXPECT_EQ(headerLanguageFor(P{"a.c", "b.h", "c.h++"}), Language::Cpp);
    EXPECT_EQ(headerLanguageFor(P{}), Language::Cpp);
}

TEST(CLanguage, DetectWithHeaderLanguageOnlyTouchesDotH) {
    EXPECT_EQ(detectLanguage("x/b.h", Language::C), Language::C);
    EXPECT_EQ(detectLanguage("x/b.h", Language::Cpp), Language::Cpp);
    EXPECT_EQ(detectLanguage("x/b.hpp", Language::C), Language::Cpp);
    EXPECT_EQ(detectLanguage("x/a.c", Language::Cpp), Language::C);
    EXPECT_EQ(detectLanguage("x/a.py", Language::C), Language::Python);
    EXPECT_FALSE(detectLanguage("x/a.txt", Language::C).has_value());
}

TEST(CLanguage, FileScannerPicksUpDotC) {
    const fs::path dir = fs::temp_directory_path() / ("cma_c_scan_" + std::to_string(::getpid()));
    fs::create_directories(dir / "src");
    std::ofstream(dir / "src" / "a.c") << "int main(void) { return 0; }\n";
    std::ofstream(dir / "src" / "a.h") << "int f(void);\n";
    std::ofstream(dir / "notes.txt") << "x\n";
    const auto files = FileScanner(dir.string()).scan();
    fs::remove_all(dir);
    EXPECT_EQ(files.size(), 2u);
    EXPECT_EQ(headerLanguageFor(files), Language::C);
}

// ------------------------------------------------------------------------------------- parser

TEST(CParser, FindsFunctionsAndSurvivesCConstructs) {
    const FileMetrics fm = parseC(R"(
#include <stdio.h>
#define MAX(a, b) ((a) > (b) ? (a) : (b))
typedef struct { int x; void (*cb)(int); } handler_t;
struct ops { int (*open)(const char *); int (*close)(int); };
enum color { RED, GREEN = 2, BLUE };
static int helper(int a) { if (a) return 1; return 0; }
int main(int argc, char **argv) {
    int new = 0, class = 1;
    for (int i = 0; i < argc; i++) { new += i; }
    return helper(new + class);
}
)");
    ASSERT_GE(fm.functions.size(), 2u);
    std::vector<std::string> names;
    for (const auto& f : fm.functions) names.push_back(f.name);
    EXPECT_NE(std::find(names.begin(), names.end(), "helper"), names.end());
    EXPECT_NE(std::find(names.begin(), names.end(), "main"), names.end());
}

// ----------------------------------------------------------------------------------- C rules

TEST(CRules, UnsafeBufferFunctions) {
    for (const char* fn : {"gets(buf)", "strcpy(buf, in)", "strcat(buf, in)", "sprintf(buf, \"%s\", in)", "vsprintf(buf, in, ap)"}) {
        auto v = runC(wrap(std::string("char buf[8]; ") + fn + ";"));
        EXPECT_EQ(count(v, "c-sec-unsafe-buffer-fn"), 1) << fn;
        for (const auto& x : v) if (x.ruleId == "c-sec-unsafe-buffer-fn") { EXPECT_EQ(x.category, "security"); EXPECT_EQ(x.language, "c"); }
    }
    EXPECT_EQ(count(runC(wrap("snprintf(buf, 8, \"%s\", in); strncpy(buf, in, 8); fgets(buf, 8, stdin);")), "c-sec-unsafe-buffer-fn"), 0);
}

TEST(CRules, UnsafeBufferFunctionNotFlaggedWhenDeclaredOrMemberOrQualified) {
    EXPECT_EQ(count(runC("char *strcpy(char *dst, const char *src);\n"), "c-sec-unsafe-buffer-fn"), 0) << "declaration";
    EXPECT_EQ(count(runC("extern int sprintf(char *, const char *, ...);\n"), "c-sec-unsafe-buffer-fn"), 0) << "declaration";
    EXPECT_EQ(count(runC(wrap("ops->strcpy(a, b); obj.sprintf(a);")), "c-sec-unsafe-buffer-fn"), 0) << "member calls";
    EXPECT_EQ(count(runC(wrap("return strcpy(a, b);")), "c-sec-unsafe-buffer-fn"), 1) << "return is a call context";
    EXPECT_EQ(count(runC(wrap("if (x) strcpy(a, b); else strcat(a, b);")), "c-sec-unsafe-buffer-fn"), 2);
}

TEST(CRules, SystemAndPopen) {
    auto v = runC(wrap("system(in); popen(in, \"r\");"));
    EXPECT_EQ(count(v, "c-sec-system-call"), 1);
    EXPECT_EQ(count(v, "c-sec-popen-call"), 1);
    EXPECT_EQ(count(runC(wrap("my_system(in); int system = 0;")), "c-sec-system-call"), 0);
}

TEST(CRules, FixedCommandsAreNotReported) {
    EXPECT_EQ(count(runC(wrap("system(\"sync\");")), "c-sec-system-call"), 0);
    EXPECT_EQ(count(runC(wrap("system(\"xterm -e gdb -x \" GDB_FILE);")), "c-sec-system-call"), 0) << "literal + macro constant";
    EXPECT_EQ(count(runC(wrap("system(NULL);")), "c-sec-system-call"), 0);
    EXPECT_EQ(count(runC(wrap("system(cmd);")), "c-sec-system-call"), 1);
    EXPECT_EQ(count(runC(wrap("system(\"ls \" + 0); system(in);")), "c-sec-system-call"), 2) << "anything non-constant still counts";
    EXPECT_EQ(count(runC(wrap("FILE *f = popen(\"pidin info\", \"r\");")), "c-sec-popen-call"), 0);
    EXPECT_EQ(count(runC(wrap("FILE *f = popen(cmd, \"w\");")), "c-sec-popen-call"), 1);
}

TEST(CRules, WeakRandomAndHash) {
    EXPECT_EQ(count(runC(wrap("srand(1); int a = rand(); long b = random();")), "c-sec-weak-random"), 3);
    EXPECT_EQ(count(runC(wrap("MD5(in, 3, out); SHA1_Init(&c); EVP_sha1();")), "c-sec-weak-hash"), 3);
    EXPECT_EQ(count(runC(wrap("int operand = 3; my_random_value(1);")), "c-sec-weak-random"), 0);
}

TEST(CRules, InsecureTempFile) {
    EXPECT_EQ(count(runC(wrap("char *a = tmpnam(0); char *b = tempnam(0, 0); mktemp(x);")), "c-sec-insecure-temp-file"), 3);
    EXPECT_EQ(count(runC(wrap("int fd = mkstemp(x); FILE *f = tmpfile();")), "c-sec-insecure-temp-file"), 0);
}

TEST(CRules, FormatStringNeedsAPlainVariableAsLastArgument) {
    EXPECT_EQ(count(runC(wrap("printf(msg);")), "c-sec-format-string"), 1);
    EXPECT_EQ(count(runC(wrap("fprintf(stderr, msg);")), "c-sec-format-string"), 1);
    EXPECT_EQ(count(runC(wrap("snprintf(buf, 8, msg);")), "c-sec-format-string"), 1);
    EXPECT_EQ(count(runC(wrap("syslog(LOG_ERR, msg);")), "c-sec-format-string"), 1);
    // Not flagged: literal format, extra arguments, macro-style constant, expression, v-variants.
    EXPECT_EQ(count(runC(wrap("printf(\"%s\", msg);")), "c-sec-format-string"), 0);
    EXPECT_EQ(count(runC(wrap("printf(msg, a);")), "c-sec-format-string"), 0);
    EXPECT_EQ(count(runC(wrap("printf(USAGE_TEXT);")), "c-sec-format-string"), 0);
    EXPECT_EQ(count(runC(wrap("printf(_(\"hello\"));")), "c-sec-format-string"), 0);
    EXPECT_EQ(count(runC(wrap("vprintf(msg, ap);")), "c-sec-format-string"), 0);
    EXPECT_EQ(count(runC(wrap("printf(\"hello\\n\");")), "c-sec-format-string"), 0);
}

TEST(CRules, UnsafeScanfOnlyWithoutAFieldWidth) {
    EXPECT_EQ(count(runC(wrap("scanf(\"%s\", buf);")), "c-sec-unsafe-scanf"), 1);
    EXPECT_EQ(count(runC(wrap("sscanf(in, \"%d %s\", &n, buf);")), "c-sec-unsafe-scanf"), 1);
    EXPECT_EQ(count(runC(wrap("fscanf(f, \"%[a-z]\", buf);")), "c-sec-unsafe-scanf"), 1);
    EXPECT_EQ(count(runC(wrap("scanf(\"%ls\", w);")), "c-sec-unsafe-scanf"), 1);
    EXPECT_EQ(count(runC(wrap("scanf(\"%15s\", buf);")), "c-sec-unsafe-scanf"), 0);
    EXPECT_EQ(count(runC(wrap("scanf(\"%d\", &n);")), "c-sec-unsafe-scanf"), 0);
    EXPECT_EQ(count(runC(wrap("scanf(\"%*s\");")), "c-sec-unsafe-scanf"), 0);
    EXPECT_EQ(count(runC(wrap("scanf(\"100%% done %d\", &n);")), "c-sec-unsafe-scanf"), 0);
    EXPECT_EQ(count(runC(wrap("scanf(fmt, buf);")), "c-sec-unsafe-scanf"), 0);
}

TEST(CRules, HardcodedSecret) {
    EXPECT_EQ(count(runC("static const char *password = \"hunter2hunter2\";\n"), "c-sec-hardcoded-secret"), 1);
    EXPECT_EQ(count(runC("char api_key[] = \"abcdef123456\";\n"), "c-sec-hardcoded-secret"), 1);
    EXPECT_EQ(count(runC("char secret[64] = \"abcdef123456\";\n"), "c-sec-hardcoded-secret"), 1);
    EXPECT_EQ(count(runC("struct cfg c = { .passwd = \"abcdef123456\" };\n"), "c-sec-hardcoded-secret"), 1);
    EXPECT_EQ(count(runC("const char *password = \"\";\n"), "c-sec-hardcoded-secret"), 0);
    EXPECT_EQ(count(runC("const char *password = getenv(\"PW\");\n"), "c-sec-hardcoded-secret"), 0);
}

TEST(CRules, MallocUncheckedOnlyWhenDereferencedImmediately) {
    EXPECT_EQ(count(runC(wrap("char *p = malloc(8);\n p[0] = 0;")), "c-malloc-unchecked"), 1);
    EXPECT_EQ(count(runC(wrap("struct s *p = (struct s *)calloc(1, 8);\n p->x = 1;")), "c-malloc-unchecked"), 1);
    EXPECT_EQ(count(runC(wrap("char *p = malloc(8);\n memset(p, 0, 8);")), "c-malloc-unchecked"), 1);
    EXPECT_EQ(count(runC(wrap("char *p = strdup(in);\n *p = 'x';")), "c-malloc-unchecked"), 1);
    // Checked, or not dereferenced next: clean.
    EXPECT_EQ(count(runC(wrap("char *p = malloc(8);\n if (!p) return;\n p[0] = 0;")), "c-malloc-unchecked"), 0);
    EXPECT_EQ(count(runC(wrap("char *p = malloc(8);\n if (p == NULL) return;")), "c-malloc-unchecked"), 0);
    EXPECT_EQ(count(runC(wrap("char *p;\n if ((p = malloc(8)) == NULL) return;\n p[0] = 0;")), "c-malloc-unchecked"), 0);
    EXPECT_EQ(count(runC(wrap("char *p = malloc(8);\n use(p);")), "c-malloc-unchecked"), 0);
    EXPECT_EQ(count(runC(wrap("x = foo(malloc(8));\n x[0] = 0;")), "c-malloc-unchecked"), 0);
    EXPECT_EQ(count(runC(wrap("s->buf = malloc(8);\n s->buf[0] = 0;")), "c-malloc-unchecked"), 0) << "member targets are not tracked";
}

TEST(CRules, ReallocSelfAssign) {
    EXPECT_EQ(count(runC(wrap("buf = realloc(buf, 64);")), "c-realloc-self-assign"), 1);
    EXPECT_EQ(count(runC(wrap("buf = (char *)realloc(buf, 64);")), "c-realloc-self-assign"), 1);
    EXPECT_EQ(count(runC(wrap("s->buf = realloc(s->buf, 64);")), "c-realloc-self-assign"), 1);
    EXPECT_EQ(count(runC(wrap("tmp = realloc(buf, 64);")), "c-realloc-self-assign"), 0);
    EXPECT_EQ(count(runC(wrap("buf = realloc(other, 64);")), "c-realloc-self-assign"), 0);
    EXPECT_EQ(count(runC(wrap("if ((buf = realloc(buf, 64)) == NULL) return;")), "c-realloc-self-assign"), 0) << "inside a larger expression";
}

TEST(CRules, MacroMultiStatement) {
    EXPECT_EQ(count(runC("#define SWAP(a, b) tmp = a; a = b; b = tmp\n"), "c-macro-multi-statement"), 1);
    EXPECT_EQ(count(runC("#define LOG(x) puts(x); fflush(stdout)\n"), "c-macro-multi-statement"), 1);
    EXPECT_EQ(count(runC("#define SAFE(a) do { a++; a--; } while (0)\n"), "c-macro-multi-statement"), 0);
    EXPECT_EQ(count(runC("#define BLOCK(a) { a++; a--; }\n"), "c-macro-multi-statement"), 0);
    EXPECT_EQ(count(runC("#define ONE(a) a++;\n"), "c-macro-multi-statement"), 0) << "a trailing semicolon alone is one statement";
    EXPECT_EQ(count(runC("#define MAX(a, b) ((a) > (b) ? (a) : (b))\n"), "c-macro-multi-statement"), 0);
    EXPECT_EQ(count(runC("#define FIELD 3; 4\n"), "c-macro-multi-statement"), 0) << "object-like macros are not checked";
    EXPECT_EQ(count(runC("#define DECL(n) int n; int n##_x\n"), "c-macro-multi-statement"), 0) << "token pasting = declaration generator";
    EXPECT_EQ(count(runC("#define MSG(x) printf(\"a; b\", x)\n"), "c-macro-multi-statement"), 0) << "';' inside a string";
    EXPECT_EQ(count(runC("#define MULTI(a) \\\n  a++; \\\n  a--\n"), "c-macro-multi-statement"), 1) << "line continuations";
    EXPECT_EQ(count(runC("#define CHECK(c) if (c) puts(\"ok\"); else { puts(\"bad\"); exit(1); }\n"), "c-macro-multi-statement"), 0) << "control-structure macro";
    EXPECT_EQ(count(runC("#define OPTION(o, v, s) case o: v = s; break;\n"), "c-macro-multi-statement"), 0) << "case-label generator";
    EXPECT_EQ(count(runC("#define FAIL(m) puts(m); return 1\n"), "c-macro-multi-statement"), 1);
    EXPECT_EQ(count(runC("#define SHOWCASE(a) a++; a--\n"), "c-macro-multi-statement"), 1) << "'case' inside another word is not a case label";
}

TEST(CRules, MagicNumberLongFunctionNestingTodo) {
    EXPECT_EQ(count(runC(wrap("if (x > 42) { y(); } while (z < 1) { }")), "c-magic-number-literal"), 1);
    std::string longBody;
    for (int i = 0; i < 110; ++i) longBody += "    x++;\n";
    EXPECT_EQ(count(runC("int big(int x) {\n" + longBody + "    return x;\n}\n"), "c-long-function"), 1);
    EXPECT_EQ(count(runC("int ok(int x) { return x; }\n"), "c-long-function"), 0);
    std::string deep = "int d(int x) {\n";
    for (int i = 0; i < 8; ++i) deep += "if (x) {\n";
    deep += "x++;\n";
    for (int i = 0; i < 8; ++i) deep += "}\n";
    deep += "return x;\n}\n";
    EXPECT_EQ(count(runC(deep), "c-deep-nesting"), 1);
    EXPECT_EQ(count(runC("/* TODO fix */\n// FIXME later\n// TODO(#12) ok\n// TODO PROJ-9 ok\n"), "c-todo-without-ticket"), 2);
}

TEST(CRules, CxxOnlyKeywordsUsedAsCIdentifiersDoNotTriggerCppRules) {
    // `new` / `delete` / `class` are plain identifiers in C and must not look like C++ allocation or classes.
    auto v = runC("struct node { int class; };\nvoid f(struct node *new) { struct node *delete = new; (void)delete; }\n");
    EXPECT_EQ(count(v, "cpp-raw-new-delete"), 0);
    for (const auto& x : v) EXPECT_EQ(x.ruleId.rfind("c-", 0), 0u) << x.ruleId << " is not a C rule";
}

TEST(CRules, SlopAndSecretGatesWorkForC) {
    std::string src = "int f(int a) {\n";
    for (int i = 0; i < 11; ++i) src += "    if (a == " + std::to_string(i) + ") { a++; }\n";
    src += "    return a;\n}\n";
    EXPECT_EQ(count(runC(src), "c-complex-function"), 1);
    EXPECT_EQ(count(runC("int g(int a) {\n    if (a) { a++; }\n    return a;\n}\n"), "c-complex-function"), 0);
    EXPECT_EQ(count(runC("// rest of the code remains the same\nint g(void) { return 0; }\n"), "c-unreviewed-placeholder"), 1);
    EXPECT_EQ(count(runC("const char *k = \"AKIAQ7R2M5K9X3B8WZ4T\";\n"), "c-sec-secret-token"), 1);
    // A provider token supersedes the name-based finding on the same line.
    auto both = runC("const char *aws_secret = \"AKIAQ7R2M5K9X3B8WZ4T\";\n");
    EXPECT_EQ(count(both, "c-sec-secret-token"), 1);
    EXPECT_EQ(count(both, "c-sec-hardcoded-secret"), 0);
}
