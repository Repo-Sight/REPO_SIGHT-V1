// scripts/dashboard-private.test.mjs -- run with: npm run test:api
//
// Frontend logic for Phase C (private repos), tested WITHOUT a DOM:
// dashboard.js exports its pure helpers, and the class methods under test
// only touch `this.<fields>` so they can be called via prototype.call().
// frontend/package.json has no "type", so Node loads dashboard.js as
// CommonJS -- exactly how the browser treats it (a classic <script>).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  RepoSightDashboard,
  readGithubToken,
  writeGithubToken,
  clearGithubToken,
  nextStepForAnalyzeFailure,
  GH_TOKEN_KEY,
} = require("../frontend/dashboard.js");

const TOKEN = "gho_OWNERtokenSECRET0123456789abcdefghij";
const fakeStore = () => {
  const m = new Map();
  return {
    m,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: k => void m.delete(k),
  };
};

test("dashboard.js loads in plain Node (no DOM) and exports the helpers", () => {
  assert.equal(typeof RepoSightDashboard, "function");
  assert.equal(typeof nextStepForAnalyzeFailure, "function");
});

test("token storage: only well-formed tokens are written, junk is ignored, storage failures are swallowed", () => {
  const s = fakeStore();
  assert.equal(writeGithubToken(s, TOKEN), true);
  assert.equal(readGithubToken(s), TOKEN);
  assert.equal(s.m.size, 1);

  for (const bad of ["", "short", "has space in it 0123456789abcdef", "x".repeat(300), null, undefined, 42]) {
    const s2 = fakeStore();
    assert.equal(writeGithubToken(s2, bad), false, JSON.stringify(bad));
    assert.equal(s2.m.size, 0);
  }

  // A poisoned value already sitting in storage is never returned.
  const s3 = fakeStore();
  s3.setItem(GH_TOKEN_KEY, "bad token\r\nX-Evil: 1");
  assert.equal(readGithubToken(s3), null);

  clearGithubToken(s);
  assert.equal(readGithubToken(s), null);

  // sessionStorage can throw (disabled / sandboxed iframe): never surface it.
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };
  assert.equal(readGithubToken(throwing), null);
  assert.equal(writeGithubToken(throwing, TOKEN), false);
  assert.doesNotThrow(() => clearGithubToken(throwing));
  assert.equal(readGithubToken(null), null);
});

test("nextStepForAnalyzeFailure: public-path 404 retries with token only when one exists", () => {
  const notFound = { error: "Could not find ..." };
  assert.equal(nextStepForAnalyzeFailure(404, notFound, { usedToken: false, hasToken: true }), "retry_with_token");
  assert.equal(nextStepForAnalyzeFailure(404, notFound, { usedToken: false, hasToken: false }), "connect_github");
  // Already retried with the token and still a plain 404 -> don't loop.
  assert.equal(nextStepForAnalyzeFailure(404, notFound, { usedToken: true, hasToken: true }), "show");
});

test("nextStepForAnalyzeFailure: every server error code maps to the right action", () => {
  const ctx = { usedToken: true, hasToken: true };
  assert.equal(nextStepForAnalyzeFailure(401, { code: "signin_required" }, ctx), "signin");
  assert.equal(nextStepForAnalyzeFailure(401, { code: "github_reauth" }, ctx), "reconnect");
  assert.equal(nextStepForAnalyzeFailure(404, { code: "github_not_found" }, ctx), "install_app");
  assert.equal(nextStepForAnalyzeFailure(403, { code: "github_access_denied" }, ctx), "show");
  assert.equal(nextStepForAnalyzeFailure(429, { code: "github_rate_limit" }, ctx), "show");
  assert.equal(nextStepForAnalyzeFailure(500, { error: "boom" }, ctx), "show");
  assert.equal(nextStepForAnalyzeFailure(413, { error: "too big" }, { usedToken: false, hasToken: true }), "show");
  assert.equal(nextStepForAnalyzeFailure(0, undefined, undefined), "show");
});

test("captureGithubToken: keeps the token on sign-in, ignores refreshes, wipes it on sign-out", () => {
  const s = fakeStore();
  const ctx = { sessionStore: () => s, track: () => {} };
  const capture = RepoSightDashboard.prototype.captureGithubToken;

  capture.call(ctx, "SIGNED_IN", { provider_token: TOKEN, user: { id: "u1" } });
  assert.equal(readGithubToken(s), TOKEN);

  // Later events carry no provider_token: must NOT clobber the stored one.
  capture.call(ctx, "TOKEN_REFRESHED", { user: { id: "u1" } });
  capture.call(ctx, "INITIAL_SESSION", null);
  assert.equal(readGithubToken(s), TOKEN);

  // A magic-link session never has a provider_token: nothing stored.
  const s2 = fakeStore();
  capture.call({ sessionStore: () => s2, track() {} }, "SIGNED_IN", { user: { id: "u2" } });
  assert.equal(s2.m.size, 0);

  capture.call(ctx, "SIGNED_OUT", null);
  assert.equal(readGithubToken(s), null, "sign-out must remove the GitHub token");

  // No storage available: no throw.
  assert.doesNotThrow(() => capture.call({ sessionStore: () => null, track() {} }, "SIGNED_IN", { provider_token: TOKEN }));
});

test("Explain button is offered for public repo scans, never for private ones", () => {
  const can = jsonData => RepoSightDashboard.prototype.canExplainFindings.call({ jsonData });
  const repo = { repoOwner: "acme", repoName: "widget", repoBranch: "main" };
  assert.equal(can({ ...repo, visibility: "public" }), true);
  assert.equal(can({ ...repo }), true, "pre-Phase-C scans have no visibility field");
  assert.equal(can({ ...repo, visibility: "private" }), false);
  assert.equal(can({ visibility: "public" }), false, "paste/upload scans have no repo identity");
  assert.equal(can(null), false);
});
