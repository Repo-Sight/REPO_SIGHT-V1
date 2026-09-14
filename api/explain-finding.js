// api/explain-finding.js
//
// POST /api/explain-finding
// Body: {
//   repoOwner, repoName, repoBranch,   // from the stored scan's payload
//   path, line,                       // which file/line the finding is at
//   ruleId, language, message, severity, category   // the Violation itself
// }
//
// AI features, first cut: "Explain this finding" -- a hybrid SAST+LLM
// design, not a free-form "review my whole repo" call. CMA already found
// the issue deterministically (39 security rules + style rules across 6
// languages); the LLM's only job here is to explain *why* a specific,
// already-flagged line matters and suggest a fix, grounded in a small
// snippet of real code around it. Research on this exact question (hybrid
// SAST+LLM vs. pure-LLM review) consistently shows the hybrid approach
// scoped this way is far more reliable than asking an LLM to find issues
// on its own -- this deliberately never asks the model to review anything
// it wasn't already told is a problem.
//
// Cost constraint (explicit founder decision): this must never carry a
// per-call API cost. There is no standing free tier for Claude or OpenAI
// (only expiring trial credits) as of when this was written -- Google's
// Gemini API is the one mainstream provider with a genuine, ongoing,
// no-credit-card-required free tier, so that's what this calls. Swapping
// providers later only means changing callGemini() below.
//
// Signed-in only (explicit founder decision, for basic abuse/cost control
// even though Gemini's free tier itself has no cost -- rate limits are
// still a shared resource across all users).
//
// No sandbox, no code execution: this only ever fetches a file's raw text
// from GitHub (same trust level as the repo scan itself, which already
// only supports public repos) and passes a small slice of it as text to
// an LLM API -- same risk class as api/analyze.js parsing repo source.
import { getSupabase, getUserFromRequest } from "./_lib/supabase.js";

// Keep well under this function's vercel.json maxDuration (see below) --
// GitHub fetch + one small Gemini call should both be fast; this is a
// safety net against a hung upstream request, not a normal-case limit.
const OVERALL_TIMEOUT_MS = 20_000;

const MAX_FIELD_LEN = 300; // generous for any real owner/repo/path/ruleId/message
const CONTEXT_LINES = 8;   // lines of code shown before/after the flagged line
const MAX_FILE_BYTES = 2 * 1024 * 1024; // guard against being pointed at a huge file

// Configurable because free-tier model names/availability on Gemini shift
// over time -- check ai.google.dev for the current recommended free Flash
// model when setting GEMINI_API_KEY up, and override via GEMINI_MODEL if
// the default below has since been retired.
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

class ExplainTimeoutError extends Error {}
class UpstreamFetchError extends Error {}

function withDeadline(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new ExplainTimeoutError("Request timed out")), ms);
      t.unref?.();
    }),
  ]);
}

function isNonEmptyShortString(v) {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_FIELD_LEN;
}

// Validates the request body. Every one of these fields either came from
// a Violation this same server already produced, or from the scan
// payload this server already wrote -- but the client echoes them back to
// us, so they're untrusted input on this request regardless of where they
// originated (Section 11: treat everything from the frontend as
// untrusted). Returns an error string, or null if valid.
export function validateBody(body) {
  if (!body || typeof body !== "object") return "Missing request body.";
  const requiredStrings = ["repoOwner", "repoName", "repoBranch", "path", "ruleId", "language", "message", "severity"];
  for (const key of requiredStrings) {
    if (!isNonEmptyShortString(body[key])) return `Missing or invalid "${key}".`;
  }
  if (!Number.isInteger(body.line) || body.line < 1 || body.line > 2_000_000) {
    return "Invalid line number.";
  }
  // Repo owner/name are GitHub identifiers -- keep the character set tight
  // rather than passing anything through into a URL we construct.
  if (!/^[A-Za-z0-9._-]+$/.test(body.repoOwner) || !/^[A-Za-z0-9._-]+$/.test(body.repoName)) {
    return "Invalid repository owner/name.";
  }
  if (!/^[A-Za-z0-9._\/-]+$/.test(body.repoBranch)) return "Invalid branch name.";
  return null;
}

export async function fetchFileSnippet({ repoOwner, repoName, repoBranch, path, line }) {
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/${encodeURIComponent(repoBranch)}/${path}`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new UpstreamFetchError(`Could not reach GitHub to read this file: ${err.message}`);
  }
  if (!res.ok) {
    throw new UpstreamFetchError(
      res.status === 404
        ? "Could not find this file on GitHub anymore -- it may have been renamed, moved, or deleted since the scan."
        : `GitHub returned an error (${res.status}) fetching this file.`
    );
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_FILE_BYTES) {
    throw new UpstreamFetchError("This file is too large to fetch a snippet from.");
  }
  const text = Buffer.from(buf).toString("utf8");
  const lines = text.split(/\r?\n/);

  const startIdx = Math.max(0, line - 1 - CONTEXT_LINES);
  const endIdx = Math.min(lines.length, line + CONTEXT_LINES);
  const snippetLines = lines.slice(startIdx, endIdx).map((text, i) => {
    const lineNo = startIdx + i + 1;
    const marker = lineNo === line ? ">>" : "  ";
    return `${marker} ${lineNo}: ${text}`;
  });
  return snippetLines.join("\n");
}

export async function callGemini({ language, ruleId, category, severity, message, snippet, line }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Server misconfigured: GEMINI_API_KEY is not set for this environment in Vercel Project Settings."
    );
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

  // Deliberately narrow prompt: the model is told exactly one thing to
  // explain (a finding CMA already made), with just enough surrounding
  // code to have real context -- not "review this file" or "review this
  // repo". This is the hybrid-SAST-hint pattern, not free-form review.
  const prompt = `You are helping a developer understand ONE specific static-analysis finding in their code. Do not review anything else in the file.

Language: ${language}
Rule: ${ruleId} (${category}, severity: ${severity})
Finding: ${message}
Flagged line: ${line}

Code snippet (">>" marks the flagged line, line numbers included):
\`\`\`${language}
${snippet}
\`\`\`

Reply in at most 120 words, plain text, no markdown headers:
1. One short paragraph on WHY this specific pattern matters in practice (not a generic definition of the rule).
2. A concrete, minimal suggested fix for THIS code, as a short code snippet if useful.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.2 },
      }),
    });
  } catch (err) {
    throw new UpstreamFetchError(`Could not reach the AI provider: ${err.message}`);
  }

  if (res.status === 429) {
    throw new UpstreamFetchError(
      "AI explanations are rate-limited right now (free tier) -- try again in a minute."
    );
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new UpstreamFetchError(`AI provider returned an error (${res.status}). ${bodyText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  if (!text.trim()) {
    throw new UpstreamFetchError("AI provider returned an empty response.");
  }
  return text.trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  const validationError = validateBody(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  try {
    const supabase = getSupabase();
    const user = await getUserFromRequest(req, supabase);
    // Signed-in only -- explicit founder decision for basic abuse/cost
    // control across the shared free-tier rate limit, distinct from
    // api/analyze.js's anonymous-allowed pattern.
    if (!user) {
      res.status(401).json({ error: "Sign in to use AI explanations." });
      return;
    }

    const { repoOwner, repoName, repoBranch, path, line, ruleId, language, message, severity, category } = req.body;

    const result = await withDeadline(
      (async () => {
        const snippet = await fetchFileSnippet({ repoOwner, repoName, repoBranch, path, line });
        const explanation = await callGemini({
          language, ruleId, category: category || "style", severity, message, snippet, line,
        });
        return explanation;
      })(),
      OVERALL_TIMEOUT_MS
    );

    res.status(200).json({ explanation: result });
  } catch (err) {
    console.error("Explain-finding error:", err);
    const timedOut = err instanceof ExplainTimeoutError;
    const upstream = err instanceof UpstreamFetchError;
    const status = timedOut ? 504 : upstream ? 502 : 500;
    const message = timedOut
      ? "This took too long -- try again."
      : err?.message || "Could not generate an explanation.";
    res.status(status).json({ error: message });
  }
}
