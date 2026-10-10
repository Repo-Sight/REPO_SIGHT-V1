// api/_lib/ruleCatalog.js
//
// Single source of truth for how REPO-SIGHT explains and ranks findings.
// One entry per analyser rule ID (analyser/src/rules/*Rules.cpp), giving:
//
//   tier        critical | high | medium | low
//               How bad it is IF the finding is real (potential impact).
//   confidence  high | medium | low
//               How likely a match is a genuine problem, as opposed to a
//               harmless pattern match. The analyser is token-based with no
//               data-flow/taint tracking, so "runs a shell command" cannot
//               tell trusted input from untrusted input -> medium/low.
//   title/what/why/fix (+ optional caveat)
//               Plain-English "what is wrong / why it matters / how to fix".
//
// The analyser's own `severity` ("info" | "warning") and `category`
// ("style" | "security") fields are untouched -- tier/confidence are
// ADDITIVE, computed here at the API layer (api/_lib/enrich.js), so adding
// or re-tuning a tier never needs a C++ rebuild or a new analyser binary.
//
// KEEP IN SYNC: every ruleId emitted by the analyser must have an entry
// here. scripts/api.test.mjs scans analyser/src/rules/*.cpp and fails if a
// rule is missing (or if this file names a rule the analyser doesn't have).
// Thresholds quoted in the copy (100 lines, depth 6, complexity 10) mirror the
// constants kLongFunctionThreshold / kDeepNestingThreshold /
// kComplexFunctionThreshold in the rule sources.

export const TIERS = ["critical", "high", "medium", "low"];
export const CONFIDENCES = ["high", "medium", "low"];

// ---------------------------------------------------------------------------
// Families: text shared by the same problem across languages.
// ---------------------------------------------------------------------------
const FAMILIES = {
  "hardcoded-secret": {
    title: "Hardcoded credential",
    what: "A variable whose name looks like a password, secret or API key is assigned a fixed string in the source code.",
    why: "Anyone who can read the code -- teammates, contractors, or the whole internet if the repo is or becomes public -- can use that credential. Deleting it later does not remove it from git history.",
    fix: "Load the value from an environment variable or a secret manager, rotate the credential if it was real, and purge it from git history.",
    caveat: "Matched on the variable's name plus a string literal, so placeholders and test values can be false positives.",
  },
  "secret-token": {
    title: "Live-looking API token in the source",
    what: "A string in the code contains a token in the exact format of an Anthropic, OpenAI, AWS or GitHub credential (for example an sk-ant-, sk-, AKIA or ghp_ key).",
    why: "Anyone who can read the code can use that key to run up your bill, read your data or push to your repositories -- and bots scan public repos for these formats within minutes. Deleting the line later does not remove it from git history.",
    fix: "Treat the key as compromised: revoke it in the provider's dashboard, create a new one, load it from an environment variable or secret manager, and purge the old one from git history.",
    caveat: "Matched on the token's format, not on whether it is still active -- an already-revoked or test key still shows up. The report never repeats the value.",
  },
  eval: {
    title: "Dynamic code execution",
    what: "The code runs a string as program code at runtime (eval / exec).",
    why: "If any part of that string can come from a user, a file or the network, an attacker can run their own code with your application's permissions.",
    fix: "Remove eval. Parse data with a real parser, or replace the dynamic code with a lookup table or explicit function calls.",
    caveat: "The analyser cannot see where the string comes from; eval of a constant is harmless.",
  },
  "command-exec": {
    title: "OS command execution",
    what: "The code launches an operating-system command or shell.",
    why: "If any part of the command is built from untrusted input, an attacker can add commands of their own (command injection).",
    fix: "Prefer a library API over shelling out. If you must run a process, pass arguments as a list with no shell, validate values against an allowlist, and never build the command by string concatenation.",
    caveat: "The analyser cannot see where the arguments come from; fixed commands are lower risk.",
  },
  "shell-true": {
    title: "subprocess with shell=True",
    what: "A subprocess call passes the command through a shell (shell=True).",
    why: "Shell metacharacters in any interpolated value are interpreted, so untrusted input can inject extra commands.",
    fix: "Pass the command as a list (subprocess.run([\"ls\", path])) and drop shell=True.",
  },
  "sql-concat": {
    title: "SQL built by string concatenation",
    what: "A database query is assembled by joining strings together.",
    why: "If any joined value is user-controlled, an attacker can change the meaning of the query (SQL injection) to read, change or delete data.",
    fix: "Use parameterized queries / prepared statements and pass values as bound parameters instead of concatenating them.",
    caveat: "Pattern-based: concatenating only constants is safe, but the analyser cannot tell.",
  },
  "inner-html": {
    title: "Raw HTML insertion (innerHTML)",
    what: "A value is assigned to .innerHTML, which inserts it into the page as raw HTML.",
    why: "If the value includes user-supplied text, an attacker can inject script into your page (cross-site scripting, XSS).",
    fix: "Use textContent for plain text, or sanitize the HTML with a vetted library such as DOMPurify before inserting it.",
    caveat: "Assigning a fixed, trusted template is fine; the analyser flags every assignment.",
  },
  "weak-hash": {
    title: "Weak hash algorithm (MD5 / SHA-1)",
    what: "The code uses MD5 or SHA-1, hash functions considered broken for security purposes.",
    why: "Attackers can produce collisions or crack hashed passwords very quickly, so signatures and password storage built on them are unsafe.",
    fix: "For passwords use bcrypt, scrypt or Argon2. For integrity or signatures use SHA-256 or stronger.",
    caveat: "Harmless for non-security uses such as cache keys or file checksums; flagged by algorithm name only.",
  },
  "weak-cipher": {
    title: "Broken encryption algorithm",
    what: "The code selects a deprecated cipher (such as DES).",
    why: "These ciphers can be brute-forced with modest resources, so data encrypted with them is not really protected.",
    fix: "Use AES-256 in an authenticated mode such as AES-GCM.",
  },
  "weak-random": {
    title: "Predictable random numbers",
    what: "The code calls rand() / srand(), which are not cryptographically secure.",
    why: "The output is predictable, so tokens, keys or nonces generated from it can be guessed.",
    fix: "For anything security-sensitive use an OS-provided secure source (getrandom, /dev/urandom, BCryptGenRandom). rand() is fine for games and simulations.",
    caveat: "Only matters when the value is used for security.",
  },
  "unsafe-buffer": {
    title: "Unbounded buffer copy",
    what: "The code calls strcpy, strcat, sprintf or gets, which do not check the size of the destination buffer.",
    why: "Input longer than the buffer overwrites neighbouring memory (buffer overflow), a classic route to crashes and remote code execution.",
    fix: "Use bounded variants (strncpy, snprintf, fgets) or std::string / std::vector, and check lengths before copying.",
    caveat: "Copying a string of known-safe length is fine; the analyser cannot prove lengths.",
  },
  "tls-disabled": {
    title: "TLS certificate validation disabled",
    what: "The code sets rejectUnauthorized to false, so HTTPS certificates are not verified.",
    why: "Connections can be intercepted or altered by a man-in-the-middle with no warning.",
    fix: "Remove the override. For self-signed dev certificates, add the CA to the trust store (for example NODE_EXTRA_CA_CERTS) instead of disabling checks.",
  },
  "cert-review": {
    title: "Custom certificate validation",
    what: "The code installs its own certificate-validation logic.",
    why: "If that logic returns success unconditionally, TLS protection is silently switched off.",
    fix: "Confirm it really validates the certificate chain and hostname; delete the override if it only exists to bypass errors.",
    caveat: "Custom validation can be legitimate (certificate pinning); this is a prompt to review, not proof of a flaw.",
  },
  "empty-catch": {
    title: "Empty error handler",
    what: "A catch block does nothing with the caught error.",
    why: "Failures vanish silently, so bugs surface later, far from their cause, and are hard to diagnose.",
    fix: "Log the error, handle it meaningfully, or re-throw it. If ignoring it is intentional, add a comment saying why.",
  },
  "catch-all-cpp": {
    title: "Empty catch(...) block",
    what: "A catch(...) block swallows every possible exception and does nothing.",
    why: "Real failures, including memory and logic errors, disappear silently and the program keeps running in an unknown state.",
    fix: "Catch specific exception types. If a catch-all is needed at a boundary, log and rethrow or translate the error.",
  },
  "bare-except": {
    title: "Bare except clause",
    what: "A bare 'except:' catches every exception, including KeyboardInterrupt and SystemExit.",
    why: "It hides real bugs and makes the program hard to stop or debug.",
    fix: "Catch a specific exception type, or at minimum 'except Exception:' and log it.",
  },
  "async-void": {
    title: "async void method",
    what: "An 'async void' method cannot be awaited by its caller.",
    why: "An exception thrown inside it cannot be caught by the caller and can crash the whole process.",
    fix: "Return 'async Task' instead. Keep 'async void' only for event handlers.",
  },
  "using-namespace-std": {
    title: "using namespace std in a header",
    what: "A header file contains 'using namespace std;'.",
    why: "Every file that includes the header inherits it, causing name clashes that are confusing to track down.",
    fix: "Remove it from headers and qualify names (std::string) instead.",
  },
  "mutable-default": {
    title: "Mutable default argument",
    what: "A function uses a list, dict or set as a default argument value.",
    why: "The default is created once and shared across every call, so changes leak between calls.",
    fix: "Default to None and create the list or dict inside the function.",
  },
  "mutable-class-attr": {
    title: "Shared mutable class attribute",
    what: "A class defines a mutable attribute (list, dict or set) at class level.",
    why: "It is shared by every instance, so one instance's changes affect all the others.",
    fix: "Initialize it in __init__ so each instance gets its own copy.",
    caveat: "Sometimes intentional (a shared registry); confirm before changing.",
  },
  "wildcard-import": {
    title: "Wildcard import",
    what: "The code uses 'from module import *'.",
    why: "It pollutes the namespace and hides where names come from, which makes code harder to read and can silently shadow other names.",
    fix: "Import only the names you use, or import the module and qualify them.",
  },
  "long-function": {
    title: "Very long function",
    what: "A function or method is longer than 100 lines.",
    why: "Long functions are hard to read, test and change safely, and they tend to collect bugs.",
    fix: "Split it into smaller functions that each do one job.",
  },
  "complex-function": {
    title: "Overly complex function",
    what: "A single function has a cyclomatic complexity over 10: more than nine independent decision points (if, loops, case, catch, && / ||, ternaries) in its own body.",
    why: "Every decision point is another path to test and another place for a bug. Code produced quickly, by hand or with an AI assistant, tends to pile branches into one function because adding an if is easier than restructuring.",
    fix: "Split it into smaller functions that each handle one case, replace long if/else chains with early returns or a lookup table, and add tests before you refactor.",
    caveat: "Counted from the function's own body; a nested function is measured separately. A flat switch with many simple cases can score high without being hard to read.",
  },
  "unreviewed-placeholder": {
    title: "Unreviewed placeholder or AI leftover",
    what: "A comment looks like text left behind by an AI coding assistant, or marks code that was never filled in (for example \"... rest of the code remains\" or \"your code here\").",
    why: "Elided or placeholder code usually means part of the real logic is missing, or a snippet was pasted without being read. It can ship as a silent gap or a stale copy.",
    fix: "Read the code around the comment, complete or delete the placeholder, then remove the comment.",
    caveat: "Matched on a fixed list of phrases inside comments, so an ordinary human note can occasionally trigger it.",
  },
  "deep-nesting": {
    title: "Deeply nested code",
    what: "A file reaches a nesting depth greater than 6 (ifs, loops and blocks inside each other).",
    why: "Each extra level of nesting makes the logic harder to follow and test.",
    fix: "Use early returns, extract helper functions, and flatten conditions.",
  },
  "magic-number": {
    title: "Magic number in a condition",
    what: "A bare numeric literal is used directly in a condition.",
    why: "Readers cannot tell what the number means, and changing it later means hunting for every copy.",
    fix: "Give it a named constant that explains its purpose.",
    caveat: "Obvious values such as 0 or 1 are often fine.",
  },
  "raw-new-delete": {
    title: "Manual new/delete",
    what: "The code uses raw new or delete instead of a smart pointer or container.",
    why: "Forgetting a delete leaks memory; deleting twice or on an early return causes crashes.",
    fix: "Use std::make_unique / std::make_shared or an RAII container such as std::vector.",
  },
  "todo-no-ticket": {
    title: "TODO/FIXME without a ticket",
    what: "A TODO or FIXME comment has no ticket reference (#123 or PROJ-123).",
    why: "Untracked TODOs are rarely done and quietly become permanent technical debt.",
    fix: "Add a ticket reference, or do the work now, or delete the comment.",
  },
  "debug-output": {
    title: "Debug output instead of a logger",
    what: "The code prints to the console or dumps a stack trace directly.",
    why: "Console output is easy to lose in production and cannot be filtered, timestamped or routed.",
    fix: "Use a real logger (ILogger, SLF4J/Log4j, etc.).",
  },
  "public-field": {
    title: "Public field",
    what: "A class exposes a public field directly.",
    why: "Any code can change it, so the class cannot enforce rules or change its internals later.",
    fix: "Make it private and expose a property or accessor methods.",
  },
  "raw-type": {
    title: "Raw generic type",
    what: "A generic type (such as List) is used without its type parameter.",
    why: "The compiler cannot check what goes in or out, so type errors appear at runtime instead.",
    fix: "Add the type parameter (List<String>).",
  },
  "var-usage": {
    title: "var declaration",
    what: "The code declares variables with 'var'.",
    why: "'var' is function-scoped and hoisted, which causes surprising bugs.",
    fix: "Use 'const' by default and 'let' when the value changes.",
  },
  "loose-equality": {
    title: "Loose equality (== / !=)",
    what: "The code compares values with == or !=, which convert types first.",
    why: "Type coercion gives surprising results (0 == '' is true), causing subtle bugs.",
    fix: "Use === and !==.",
    caveat: "'x == null' is a common deliberate idiom for null-or-undefined.",
  },
  "explicit-any": {
    title: "Explicit any type",
    what: "A value is typed as 'any'.",
    why: "It switches off type checking for that value and everything derived from it.",
    fix: "Use a specific type, or 'unknown' and narrow it.",
  },
};

// Language-specific fix wording, layered over the family text where the
// generic advice benefits from the right API name.
const r = (family, tier, confidence, fix) => ({ family, tier, confidence, fix });

export const RULES = {
  // ---- hardcoded secrets (critical if real; name-based heuristic) ----
  "cpp-sec-hardcoded-secret": r("hardcoded-secret", "critical", "medium", "Read it at runtime with std::getenv or a secret manager, rotate the credential if it was real, and purge it from git history."),
  "csharp-sec-hardcoded-secret": r("hardcoded-secret", "critical", "medium", "Read it from configuration, user-secrets or Environment.GetEnvironmentVariable, rotate the credential if it was real, and purge it from git history."),
  "java-sec-hardcoded-secret": r("hardcoded-secret", "critical", "medium", "Read it with System.getenv or a secret manager, rotate the credential if it was real, and purge it from git history."),
  "js-sec-hardcoded-secret": r("hardcoded-secret", "critical", "medium", "Read it from process.env or a secret manager, rotate the credential if it was real, and purge it from git history."),
  "ts-sec-hardcoded-secret": r("hardcoded-secret", "critical", "medium", "Read it from process.env or a secret manager, rotate the credential if it was real, and purge it from git history."),
  "py-sec-hardcoded-secret": r("hardcoded-secret", "critical", "medium", "Read it from os.environ or a secret manager, rotate the credential if it was real, and purge it from git history."),

  "cpp-sec-secret-token": r("secret-token", "critical", "high", "Read it at runtime with std::getenv or a secret manager, revoke and rotate the key, and purge the old one from git history."),
  "csharp-sec-secret-token": r("secret-token", "critical", "high", "Read it from configuration, user-secrets or Environment.GetEnvironmentVariable, revoke and rotate the key, and purge the old one from git history."),
  "java-sec-secret-token": r("secret-token", "critical", "high", "Read it with System.getenv or a secret manager, revoke and rotate the key, and purge the old one from git history."),
  "js-sec-secret-token": r("secret-token", "critical", "high", "Read it from process.env or a secret manager, revoke and rotate the key, and purge the old one from git history."),
  "ts-sec-secret-token": r("secret-token", "critical", "high", "Read it from process.env or a secret manager, revoke and rotate the key, and purge the old one from git history."),
  "py-sec-secret-token": r("secret-token", "critical", "high", "Read it from os.environ or a secret manager, revoke and rotate the key, and purge the old one from git history."),

  // ---- injection and code execution ----
  "js-sec-eval": r("eval", "high", "medium", "Remove eval. Use JSON.parse for data, or replace dynamic code with a lookup table or explicit function calls."),
  "ts-sec-eval": r("eval", "high", "medium", "Remove eval. Use JSON.parse for data, or replace dynamic code with a lookup table or explicit function calls."),
  "py-sec-eval-exec": r("eval", "high", "medium", "Remove eval/exec. Use ast.literal_eval for literals, json.loads for data, or a lookup table of allowed functions."),
  "py-sec-subprocess-shell-true": r("shell-true", "high", "high"),
  "py-sec-os-system": r("command-exec", "high", "medium", "Use subprocess.run with a list of arguments and no shell, and validate any user-supplied value."),
  "cpp-sec-system-call": r("command-exec", "high", "medium", "Avoid system(). Use a library API, or exec-family calls with an argument array and validated input."),
  "cpp-sec-popen-call": r("command-exec", "high", "medium", "Avoid popen(). Use a library API, or exec-family calls with an argument array and validated input."),
  "js-sec-child-process-exec": r("command-exec", "high", "medium", "Use execFile / spawn with an argument array instead of exec, and validate any user-supplied value."),
  "ts-sec-child-process-exec": r("command-exec", "high", "medium", "Use execFile / spawn with an argument array instead of exec, and validate any user-supplied value."),
  "java-sec-runtime-exec": r("command-exec", "high", "medium", "Use ProcessBuilder with a separate argument list (never one concatenated string) and validate any user-supplied value."),
  "csharp-sec-process-start": r("command-exec", "medium", "medium", "Pass arguments through ProcessStartInfo.ArgumentList, never a concatenated string, and validate any user-supplied value."),
  "java-sec-sql-string-concat": r("sql-concat", "high", "medium", "Use PreparedStatement with bound parameters."),
  "csharp-sec-sql-string-concat": r("sql-concat", "high", "medium", "Use SqlParameter (or an ORM) instead of concatenating values into the query text."),
  "js-sec-sql-string-concat": r("sql-concat", "high", "medium", "Use parameterized queries (query('... WHERE id = $1', [id])) instead of template or string concatenation."),
  "ts-sec-sql-string-concat": r("sql-concat", "high", "medium", "Use parameterized queries (query('... WHERE id = $1', [id])) instead of template or string concatenation."),
  "js-sec-inner-html": r("inner-html", "high", "low"),
  "ts-sec-inner-html": r("inner-html", "high", "low"),

  // ---- unsafe deserialization ----
  "py-sec-pickle-load": {
    family: null, tier: "high", confidence: "medium",
    title: "Unsafe deserialization (pickle)",
    what: "The code loads data with pickle, which can execute code while reading.",
    why: "If an attacker can influence the bytes being unpickled, they can run arbitrary code on your server.",
    fix: "Use a safe format such as JSON. Only unpickle data you produced and that no untrusted party can modify.",
    caveat: "Safe when the data source is fully trusted; the analyser cannot see the source.",
  },
  "py-sec-yaml-unsafe-load": {
    family: null, tier: "high", confidence: "high",
    title: "Unsafe YAML loading",
    what: "yaml.load() is called without a safe Loader.",
    why: "Crafted YAML can construct arbitrary Python objects and run code while it is parsed.",
    fix: "Use yaml.safe_load(), or pass Loader=yaml.SafeLoader.",
  },

  // ---- memory safety ----
  "cpp-sec-unsafe-buffer-fn": r("unsafe-buffer", "high", "medium"),

  // ---- TLS and cryptography ----
  "js-sec-disabled-tls": r("tls-disabled", "high", "high"),
  "ts-sec-disabled-tls": r("tls-disabled", "high", "high"),
  "java-sec-weak-cipher": r("weak-cipher", "high", "high", "Use AES/GCM/NoPadding with a random IV instead of DES."),
  "csharp-sec-weak-cipher": r("weak-cipher", "high", "high", "Use AesGcm (or Aes with an authenticated mode) instead of DES, RC2 or TripleDES."),
  "java-sec-trust-manager-review": r("cert-review", "medium", "low", "Check that checkServerTrusted / checkClientTrusted really validate the chain; delete the class if it only exists to bypass errors."),
  "csharp-sec-cert-validation-disabled": r("cert-review", "medium", "low", "Check that the ServerCertificateValidationCallback does not simply return true; delete it if it only exists to bypass errors."),
  "cpp-sec-weak-hash": r("weak-hash", "medium", "low"),
  "csharp-sec-weak-hash": r("weak-hash", "medium", "low"),
  "java-sec-weak-hash": r("weak-hash", "medium", "low"),
  "js-sec-weak-hash": r("weak-hash", "medium", "low"),
  "ts-sec-weak-hash": r("weak-hash", "medium", "low"),
  "py-sec-weak-hash": r("weak-hash", "medium", "low"),
  "cpp-sec-weak-random": r("weak-random", "medium", "low"),

  // ---- error handling ----
  // Empty catch blocks are "high": the failure is swallowed, so the bug shows
  // up later and far from its cause. high + confidence high also feeds the
  // "Fix now" card at the top of the report Overview.
  "java-empty-catch-block": r("empty-catch", "high", "high"),
  "csharp-empty-catch-block": r("empty-catch", "high", "high"),
  "js-empty-catch-block": r("empty-catch", "high", "high"),
  "ts-empty-catch-block": r("empty-catch", "high", "high"),
  "cpp-catch-all-ellipsis": r("catch-all-cpp", "medium", "high"),
  "py-bare-except": r("bare-except", "medium", "high"),
  "csharp-async-void": r("async-void", "medium", "high"),

  // ---- language pitfalls ----
  "cpp-using-namespace-std-header": r("using-namespace-std", "medium", "high"),
  "py-mutable-default-arg": r("mutable-default", "medium", "high"),
  "py-mutable-class-attribute": r("mutable-class-attr", "medium", "medium"),
  "cpp-raw-new-delete": r("raw-new-delete", "medium", "medium"),
  "py-wildcard-import": r("wildcard-import", "low", "high"),
  "js-loose-equality": r("loose-equality", "low", "medium"),
  "ts-loose-equality": r("loose-equality", "low", "medium"),
  "js-var-usage": r("var-usage", "low", "high"),
  "ts-var-usage": r("var-usage", "low", "high"),
  "ts-explicit-any": r("explicit-any", "low", "medium"),
  "java-raw-type-usage": r("raw-type", "low", "medium"),
  "java-public-field": r("public-field", "low", "medium"),
  "csharp-public-field": r("public-field", "low", "medium"),
  "cpp-magic-number-literal": r("magic-number", "low", "low"),

  // ---- maintainability (objective thresholds) ----
  "cpp-long-function": r("long-function", "medium", "high"),
  "py-long-function": r("long-function", "medium", "high"),
  "java-long-method": r("long-function", "medium", "high"),
  "csharp-long-method": r("long-function", "medium", "high"),
  "js-long-method": r("long-function", "medium", "high"),
  "ts-long-method": r("long-function", "medium", "high"),
  "cpp-deep-nesting": r("deep-nesting", "medium", "high"),
  "py-deep-nesting": r("deep-nesting", "medium", "high"),
  "java-deep-nesting": r("deep-nesting", "medium", "high"),
  "csharp-deep-nesting": r("deep-nesting", "medium", "high"),
  "js-deep-nesting": r("deep-nesting", "medium", "high"),
  "ts-deep-nesting": r("deep-nesting", "medium", "high"),

  // ---- AI code slop gates (analyser/src/rules/SlopRules.cpp) ----
  "cpp-complex-function": r("complex-function", "medium", "high"),
  "py-complex-function": r("complex-function", "medium", "high"),
  "java-complex-function": r("complex-function", "medium", "high"),
  "csharp-complex-function": r("complex-function", "medium", "high"),
  "js-complex-function": r("complex-function", "medium", "high"),
  "ts-complex-function": r("complex-function", "medium", "high"),
  "cpp-unreviewed-placeholder": r("unreviewed-placeholder", "medium", "medium"),
  "py-unreviewed-placeholder": r("unreviewed-placeholder", "medium", "medium"),
  "java-unreviewed-placeholder": r("unreviewed-placeholder", "medium", "medium"),
  "csharp-unreviewed-placeholder": r("unreviewed-placeholder", "medium", "medium"),
  "js-unreviewed-placeholder": r("unreviewed-placeholder", "medium", "medium"),
  "ts-unreviewed-placeholder": r("unreviewed-placeholder", "medium", "medium"),

  // ---- housekeeping ----
  "cpp-todo-without-ticket": r("todo-no-ticket", "low", "high"),
  "py-todo-without-ticket": r("todo-no-ticket", "low", "high"),
  "java-todo-without-ticket": r("todo-no-ticket", "low", "high"),
  "csharp-todo-without-ticket": r("todo-no-ticket", "low", "high"),
  "js-todo-without-ticket": r("todo-no-ticket", "low", "high"),
  "ts-todo-without-ticket": r("todo-no-ticket", "low", "high"),
  "java-printstacktrace": r("debug-output", "low", "high", "Replace printStackTrace() with a logger call (SLF4J / Log4j) that records the exception."),
  "csharp-console-writeline": r("debug-output", "low", "high", "Replace Console.WriteLine with ILogger."),
};

const LANGUAGE_BY_PREFIX = {
  cpp: "cpp",
  py: "python",
  java: "java",
  js: "javascript",
  ts: "typescript",
  csharp: "csharp",
};

// Resolves a ruleId to its full, display-ready catalog entry, or null for a
// rule the catalog doesn't know (callers fall back gracefully -- see
// enrich.js). Returned objects are fresh copies; callers may mutate them.
export function getRule(ruleId) {
  if (typeof ruleId !== "string" || !Object.hasOwn(RULES, ruleId)) return null;
  const entry = RULES[ruleId];
  const family = entry.family ? FAMILIES[entry.family] : null;
  const prefix = ruleId.split("-")[0];
  const out = {
    ruleId,
    language: LANGUAGE_BY_PREFIX[prefix] || null,
    category: ruleId.includes("-sec-") ? "security" : "style",
    tier: entry.tier,
    confidence: entry.confidence,
    title: entry.title ?? family?.title,
    what: entry.what ?? family?.what,
    why: entry.why ?? family?.why,
    fix: entry.fix ?? family?.fix,
  };
  const caveat = entry.caveat ?? family?.caveat;
  if (caveat) out.caveat = caveat;
  return out;
}

export function listRules() {
  return Object.keys(RULES).map(getRule);
}
