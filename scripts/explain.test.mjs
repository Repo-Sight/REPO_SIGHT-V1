// scripts/explain.test.mjs -- run with: npm run test:api
// Guards the Gemini call: current default model, no deprecated sampling parameters,
// GEMINI_MODEL override, and a provider 404 surfacing as a clear error.
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { callGemini } from "../api/explain-finding.js";

const realFetch = globalThis.fetch;
let calls;
let reply;

beforeEach(() => {
  calls = [];
  reply = { status: 200, body: { candidates: [{ content: { parts: [{ text: " Because it can overflow. " }] } }] } };
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.GEMINI_MODEL;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
      text: async () => JSON.stringify(reply.body),
    };
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
});

const finding = { language: "cpp", ruleId: "CPP-1", category: "security", severity: "high", message: "strcpy", snippet: ">> 1 strcpy(a,b);", line: 1 };

test("default model is the current Flash-Lite, not the retired 2.5 Flash", async () => {
  const text = await callGemini(finding);
  assert.equal(text, "Because it can overflow.");
  assert.match(calls[0].url, /\/models\/gemini-3\.5-flash-lite:generateContent\?/);
  assert.ok(!calls[0].url.includes("2.5"));
});

test("request carries no deprecated sampling parameters and leaves room for thinking tokens", async () => {
  await callGemini(finding);
  const cfg = calls[0].body.generationConfig;
  for (const k of ["temperature", "topP", "topK", "top_p", "top_k"]) assert.equal(k in cfg, false, k);
  assert.ok(cfg.maxOutputTokens >= 1024);
});

test("GEMINI_MODEL overrides the default", async () => {
  process.env.GEMINI_MODEL = "gemini-3.8-flash";
  await callGemini(finding);
  assert.match(calls[0].url, /\/models\/gemini-3\.8-flash:generateContent\?/);
});

test("a provider 404 surfaces as a clear error without leaking the key", async () => {
  reply = { status: 404, body: { error: { code: 404, message: "model gone" } } };
  await assert.rejects(callGemini(finding), (err) => {
    assert.match(err.message, /AI provider returned an error \(404\)/);
    assert.ok(!err.message.includes("test-key"));
    return true;
  });
});

test("an empty provider answer is an error, not a blank explanation", async () => {
  reply = { status: 200, body: { candidates: [{ content: { parts: [{ text: "  " }] }, finishReason: "MAX_TOKENS" }] } };
  await assert.rejects(callGemini(finding), /empty response/);
});
