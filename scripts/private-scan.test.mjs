// scripts/private-scan.test.mjs -- run with: npm run test:api
//
// Guards Phase C (private repository scanning). Two layers:
//   * pure units: URL parsing, token-header parsing, the scan access rule,
//     GitHub status -> error mapping.
//   * end-to-end handler tests against a fake Supabase (real HTTP on
//     127.0.0.1, real @supabase/supabase-js client) and a stubbed GitHub
//     (fetch wrapper), running the real analyser binary on a real tarball.
//     These prove the property that matters: a private scan's report is
//     readable by its owner and by nobody else, and the GitHub token is
//     never persisted.
// Uses only node:test -- no new dependencies.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";

import {
  parseGithubUrl,
  readGithubToken,
  fetchRepoMeta,
  GithubAuthError,
  GithubNotFoundError,
  GithubAccessError,
  GithubRateLimitError,
} from "../api/_lib/github.js";
import analyzeHandler from "../api/analyze.js";
import { fetchFileSnippet } from "../api/explain-finding.js";
import { recordUserScan } from "../api/_lib/supabase.js";
import scanHandler, { canViewScan } from "../api/scans/[scanId].js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// Distinctive so a leak anywhere (payload, response body, logs) is greppable.
const OWNER_GH_TOKEN = "gho_OWNERtokenSECRET0123456789abcdefghij";
const OWNER_SESSION = "session-owner";
const OTHER_SESSION = "session-other";

// ------------------------------------------------------------ test doubles
const stored = new Map();           // "<scanId>.json" -> string (fake Storage)
let ghCalls = [];                   // every request that reached "GitHub"
let rawCalls = [];                  // requests to raw.githubusercontent.com
let removedKeys = [];               // keys removed via Storage DELETE
let userScanRows = [];              // what GET user_scans returns
let ghMeta = { status: 200, body: { private: true, default_branch: "trunk" }, headers: {} };
let server;
let tarballGz;
const realFetch = globalThis.fetch;

async function buildTarball() {
  const dir = mkdtempSync(join(tmpdir(), "rs-tar-"));
  const top = join(dir, "owner-repo-abc123");
  mkdirSync(top);
  writeFileSync(
    join(top, "app.py"),
    "import os\n\ndef run(cmd):\n    if cmd:\n        return eval(cmd)\n    return os.getcwd()\n"
  );
  const chunks = [];
  const stream = tar.c({ gzip: true, cwd: dir }, ["owner-repo-abc123"]);
  for await (const c of stream) chunks.push(c);
  rmSync(dir, { recursive: true, force: true });
  return Buffer.concat(chunks);
}

function fakeSupabase() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const send = (status, obj) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(obj === undefined ? "" : JSON.stringify(obj));
      };

      if (url.pathname === "/auth/v1/user") {
        const tok = (req.headers.authorization || "").replace("Bearer ", "");
        const id = tok === OWNER_SESSION ? "user-owner" : tok === OTHER_SESSION ? "user-other" : null;
        if (!id) return send(401, { msg: "invalid JWT", code: 401 });
        return send(200, { id, aud: "authenticated", role: "authenticated", email: `${id}@example.com` });
      }
      if (req.method === "DELETE" && url.pathname === "/storage/v1/object/scans") {
        const { prefixes = [] } = JSON.parse(body || "{}");
        for (const k of prefixes) { removedKeys.push(k); stored.delete(k); }
        return send(200, prefixes.map(name => ({ name })));
      }
      const obj = url.pathname.match(/^\/storage\/v1\/object\/scans\/(.+)$/);
      if (obj) {
        const key = decodeURIComponent(obj[1]);
        if (req.method === "POST" || req.method === "PUT") {
          stored.set(key, body);
          return send(200, { Key: `scans/${key}` });
        }
        if (req.method === "GET") {
          return stored.has(key)
            ? (res.writeHead(200, { "content-type": "application/json" }), res.end(stored.get(key)))
            : send(404, { statusCode: "404", error: "not_found", message: "Object not found" });
        }
      }
      if (url.pathname === "/rest/v1/user_scans") {
        if (req.method === "GET") return send(200, userScanRows);
        return send(req.method === "DELETE" ? 204 : 201);
      }
      send(404, { error: "unhandled " + req.method + " " + url.pathname });
    });
  });
}

function stubFetch(input, init) {
  const url = typeof input === "string" ? input : input.url;
  if (url.startsWith("https://raw.githubusercontent.com/")) {
    rawCalls.push({ url, headers: init?.headers || {} });
    return Promise.resolve(new Response("line one\nline two\nline three\n", { status: 200 }));
  }
  if (url.startsWith("https://api.github.com/") || url.startsWith("https://codeload.github.com/")) {
    ghCalls.push({ url, headers: init?.headers || {} });
    if (url === "https://api.github.com/repos/acme/secret-repo/tarball/trunk" ||
        url === "https://codeload.github.com/acme/public-repo/tar.gz/refs/heads/main") {
      return Promise.resolve(new Response(tarballGz, { status: 200 }));
    }
    if (url.startsWith("https://api.github.com/repos/") && url.split("/").length === 6) {
      return Promise.resolve(
        new Response(JSON.stringify(ghMeta.body), { status: ghMeta.status, headers: ghMeta.headers })
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }
  return realFetch(input, init);
}

function mockRes() {
  const r = { statusCode: 200, headers: {}, body: undefined };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  return r;
}

const post = (body, headers = {}) => ({ method: "POST", body, headers });
async function analyze(body, headers) {
  const res = mockRes();
  await analyzeHandler(post(body, headers), res);
  return res;
}
async function getScan(scanId, headers = {}) {
  const res = mockRes();
  await scanHandler({ method: "GET", query: { scanId }, headers }, res);
  return res;
}

before(async () => {
  chmodSync(join(root, "backend", "bin", "linux-x64-cma"), 0o755);
  tarballGz = await buildTarball();
  server = fakeSupabase();
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = stubFetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  await new Promise(r => server.close(r));
});
const reset = () => {
  ghCalls = [];
  rawCalls = [];
  removedKeys = [];
  userScanRows = [];
  stored.clear();
  ghMeta = { status: 200, body: { private: true, default_branch: "trunk" }, headers: {} };
};

// ------------------------------------------------------------------- units
test("parseGithubUrl accepts real repo URLs and rejects path tricks", () => {
  assert.deepEqual(parseGithubUrl("https://github.com/acme/widget"), { owner: "acme", repo: "widget" });
  assert.deepEqual(parseGithubUrl("https://github.com/acme/widget.git"), { owner: "acme", repo: "widget" });
  assert.deepEqual(parseGithubUrl("https://github.com/acme/wid.get-2_x/?tab=readme"), { owner: "acme", repo: "wid.get-2_x" });
  for (const bad of [
    "", null, undefined, "https://gitlab.com/a/b", "https://github.com/onlyowner",
    "https://github.com/../etc", "https://github.com/a/..", "https://github.com/a%2Fb/c",
    "https://github.com/a/b c", "javascript:alert(1)",
  ]) {
    assert.equal(parseGithubUrl(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test("readGithubToken: absent, plausible, and junk", () => {
  assert.deepEqual(readGithubToken({ headers: {} }), { token: null });
  assert.deepEqual(readGithubToken({ headers: { "x-github-token": "" } }), { token: null });
  for (const ok of [OWNER_GH_TOKEN, "github_pat_11ABCDEFG0abcdefghijklmnop_qrstuvwxyz", "ghu_" + "a".repeat(36)]) {
    assert.deepEqual(readGithubToken({ headers: { "x-github-token": ok } }), { token: ok });
  }
  for (const bad of ["short", "has space in it 0123456789abcdef", "tok\r\nX-Evil: 1_______________", "x".repeat(300), "a".repeat(19), "ünïcode_tokén_0123456789abcdef"]) {
    assert.deepEqual(readGithubToken({ headers: { "x-github-token": bad } }), { invalid: true }, JSON.stringify(bad));
  }
});

test("canViewScan: public/legacy open, private owner-only, fails closed", () => {
  const owner = { id: "u1" };
  assert.equal(canViewScan({}, null), true, "pre-Phase-C scan has no visibility");
  assert.equal(canViewScan({ visibility: "public" }, null), true);
  assert.equal(canViewScan({ visibility: "private", ownerId: "u1" }, owner), true);
  assert.equal(canViewScan({ visibility: "private", ownerId: "u1" }, { id: "u2" }), false);
  assert.equal(canViewScan({ visibility: "private", ownerId: "u1" }, null), false);
  assert.equal(canViewScan({ visibility: "private" }, { id: "u1" }), false, "no ownerId -> nobody");
  assert.equal(canViewScan({ visibility: "private", ownerId: "" }, { id: "" }), false);
  assert.equal(canViewScan({ visibility: "internal" }, owner), false, "unknown value fails closed");
});

test("fetchRepoMeta maps GitHub statuses to distinct errors", async () => {
  const tok = OWNER_GH_TOKEN;
  ghMeta = { status: 200, body: { private: true, default_branch: "trunk" }, headers: {} };
  assert.deepEqual(await fetchRepoMeta("acme", "secret-repo", tok), { isPrivate: true, defaultBranch: "trunk" });

  ghMeta = { status: 200, body: { private: false, default_branch: "main" }, headers: {} };
  assert.deepEqual(await fetchRepoMeta("acme", "secret-repo", tok), { isPrivate: false, defaultBranch: "main" });

  const cases = [
    [401, {}, GithubAuthError],
    [404, {}, GithubNotFoundError],
    [403, {}, GithubAccessError],
    [403, { "x-ratelimit-remaining": "0" }, GithubRateLimitError],
    [429, {}, GithubRateLimitError],
  ];
  for (const [status, headers, Err] of cases) {
    ghMeta = { status, body: { message: "x" }, headers };
    await assert.rejects(() => fetchRepoMeta("acme", "secret-repo", tok), Err, `status ${status}`);
  }

  ghMeta = { status: 200, body: { private: true, default_branch: "bad branch;rm" }, headers: {} };
  await assert.rejects(() => fetchRepoMeta("acme", "secret-repo", tok), /unusable default branch/);
  ghMeta = { status: 500, body: {}, headers: {} };
  await assert.rejects(() => fetchRepoMeta("acme", "secret-repo", tok), /unexpected error \(500\)/);
});

// ----------------------------------------------------------- handler: gates
test("GitHub token without a REPO-SIGHT session is refused before any GitHub call", async () => {
  reset();
  const res = await analyze({ repoUrl: "https://github.com/acme/secret-repo" }, { "x-github-token": OWNER_GH_TOKEN });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "signin_required");
  assert.equal(ghCalls.length, 0, "token must not be used when nobody owns the scan");
});

test("a stale/invalid session is treated as anonymous, so a token alongside it is refused", async () => {
  reset();
  const res = await analyze(
    { repoUrl: "https://github.com/acme/secret-repo" },
    { "x-github-token": OWNER_GH_TOKEN, authorization: "Bearer expired-session" }
  );
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "signin_required");
  assert.equal(ghCalls.length, 0);
});

test("malformed X-GitHub-Token is a 400 and never reaches GitHub", async () => {
  reset();
  const res = await analyze(
    { repoUrl: "https://github.com/acme/secret-repo" },
    { "x-github-token": "not a token", authorization: `Bearer ${OWNER_SESSION}` }
  );
  assert.equal(res.statusCode, 400);
  assert.equal(ghCalls.length, 0);
});

test("revoked GitHub token -> 401 github_reauth, and the response never echoes the token", async () => {
  reset();
  ghMeta = { status: 401, body: { message: "Bad credentials" }, headers: {} };
  const res = await analyze(
    { repoUrl: "https://github.com/acme/secret-repo" },
    { "x-github-token": OWNER_GH_TOKEN, authorization: `Bearer ${OWNER_SESSION}` }
  );
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "github_reauth");
  assert.ok(!JSON.stringify(res.body).includes(OWNER_GH_TOKEN));
});

test("repo the token can't see -> 404 github_not_found (same answer as a nonexistent repo)", async () => {
  reset();
  ghMeta = { status: 404, body: { message: "Not Found" }, headers: {} };
  const res = await analyze(
    { repoUrl: "https://github.com/acme/secret-repo" },
    { "x-github-token": OWNER_GH_TOKEN, authorization: `Bearer ${OWNER_SESSION}` }
  );
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, "github_not_found");
});

// ------------------------------------------------- handler: end-to-end paths
test("PRIVATE scan e2e: owner can read it, everyone else gets 'not found', token never stored", async () => {
  reset();
  const res = await analyze(
    { repoUrl: "https://github.com/acme/secret-repo" },
    { "x-github-token": OWNER_GH_TOKEN, authorization: `Bearer ${OWNER_SESSION}` }
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const { scanId } = res.body;

  // Used the authenticated API path on the default branch, with the token.
  const tarballCall = ghCalls.find(c => c.url.endsWith("/tarball/trunk"));
  assert.ok(tarballCall, "authenticated tarball requested");
  assert.equal(tarballCall.headers.Authorization, `Bearer ${OWNER_GH_TOKEN}`);
  assert.ok(!ghCalls.some(c => c.url.includes("codeload")), "private path never touches the public codeload path");

  // Stored payload is stamped private + owned, and contains no credential.
  const raw = stored.get(`private/${scanId}.json`);
  assert.ok(raw, "scan blob written under the private/ prefix");
  assert.equal(
    stored.has(`${scanId}.json`), false,
    "no bare-UUID root key: older deployments sharing this bucket serve any root key with no visibility check"
  );
  assert.deepEqual([...stored.keys()], [`private/${scanId}.json`], "exactly one blob, and it is the private one");
  const payload = JSON.parse(raw);
  assert.equal(payload.visibility, "private");
  assert.equal(payload.ownerId, "user-owner");
  assert.equal(payload.repoBranch, "trunk");
  assert.equal(payload.status, "COMPLETED");
  assert.ok(!raw.includes(OWNER_GH_TOKEN), "GitHub token must never be persisted");
  assert.ok(!raw.includes(OWNER_SESSION), "session token must never be persisted");

  // Access matrix.
  const anon = await getScan(scanId);
  assert.equal(anon.body.status, "FAILED");
  assert.equal(anon.body.errorMessage, "Scan not found.");
  assert.equal(anon.body.files, undefined, "no report data leaks to anonymous callers");

  const other = await getScan(scanId, { authorization: `Bearer ${OTHER_SESSION}` });
  assert.equal(other.body.errorMessage, "Scan not found.");
  assert.equal(other.body.files, undefined);

  const bogus = await getScan(scanId, { authorization: "Bearer garbage" });
  assert.equal(bogus.body.errorMessage, "Scan not found.");

  const owner = await getScan(scanId, { authorization: `Bearer ${OWNER_SESSION}` });
  assert.equal(owner.body.status, "COMPLETED");
  assert.equal(owner.body.visibility, "private");
  assert.ok(Array.isArray(owner.body.files) && owner.body.files.length >= 1);
  assert.ok(owner.body.schemaVersion >= 3, "enrichment still applied to private scans");
  assert.equal(owner.headers["cache-control"], "private, no-store");
  assert.equal(anon.headers["cache-control"], "private, no-store");
});

test("PUBLIC scan without token is unchanged: codeload path, no API call, world-readable", async () => {
  reset();
  const res = await analyze({ repoUrl: "https://github.com/acme/public-repo" });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  assert.ok(ghCalls.every(c => c.url.startsWith("https://codeload.github.com/")), "no api.github.com call");
  const payload = JSON.parse(stored.get(`${res.body.scanId}.json`));
  assert.equal(payload.visibility, "public");
  assert.equal("ownerId" in payload, false, "public/anonymous payload carries no owner");

  const anon = await getScan(res.body.scanId);
  assert.equal(anon.body.status, "COMPLETED");
  assert.equal(anon.headers["cache-control"], undefined);
});

test("legacy scan blobs with no visibility field stay world-readable", async () => {
  reset();
  const legacyId = "11111111-1111-4111-8111-111111111111";
  stored.set(`${legacyId}.json`, JSON.stringify({ status: "COMPLETED", scanId: legacyId, projectName: "a/b", violations: [], files: [] }));
  const res = await getScan(legacyId);
  assert.equal(res.body.status, "COMPLETED");
});

test("a signed-in token scan of a PUBLIC repo is recorded public, not private", async () => {
  reset();
  ghMeta = { status: 200, body: { private: false, default_branch: "trunk" }, headers: {} };
  const res = await analyze(
    { repoUrl: "https://github.com/acme/secret-repo" },
    { "x-github-token": OWNER_GH_TOKEN, authorization: `Bearer ${OWNER_SESSION}` }
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const payload = JSON.parse(stored.get(`${res.body.scanId}.json`));
  assert.equal(payload.visibility, "public");
  assert.equal("ownerId" in payload, false);
});

// ------------------------------------------- shared-bucket / history / AI guard
test("older deployments can't reach a private scan: their id check rejects any key with a slash", () => {
  // Version1's api/scans/[scanId].js validates ids with exactly this regex
  // and builds the storage key as `${scanId}.json`. A private blob is stored
  // at `private/<uuid>.json`, so no id that passes this check can ever
  // produce that key.
  const V1_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const uuid = "11111111-1111-4111-8111-111111111111";
  assert.ok(V1_ID_RE.test(uuid));
  assert.equal(`${uuid}.json` === `private/${uuid}.json`, false);
  for (const smuggled of [`private/${uuid}`, `private%2F${uuid}`, `../private/${uuid}`, `${uuid}/../x`]) {
    assert.equal(V1_ID_RE.test(smuggled), false, smuggled);
  }
});

test("history eviction deletes the evicted scan's PRIVATE blob too (no orphaned owner-only reports)", async () => {
  reset();
  const oldIds = [1, 2, 3, 4, 5].map(n => `0000000${n}-0000-4000-8000-000000000000`);
  userScanRows = oldIds.map((scan_id, i) => ({ id: i + 1, scan_id }));
  stored.set(`private/${oldIds[0]}.json`, "{}");
  stored.set(`${oldIds[1]}.json`, "{}");

  const { getSupabase } = await import("../api/_lib/supabase.js");
  await recordUserScan(getSupabase(), "user-owner", "22222222-2222-4222-8222-222222222222", { projectName: "acme/x", project: {} });

  assert.ok(removedKeys.includes(`private/${oldIds[0]}.json`), "private key removed");
  assert.ok(removedKeys.includes(`${oldIds[0]}.json`), "root key removal also attempted (visibility isn't recorded on the row)");
  assert.equal(stored.has(`private/${oldIds[0]}.json`), false);
  assert.equal(stored.has(`${oldIds[1]}.json`), true, "only the oldest row (beyond the cap) is evicted");
});

test("AI explain can only ever see public code: file fetch carries no credentials", async () => {
  reset();
  const snippet = await fetchFileSnippet({ repoOwner: "acme", repoName: "secret-repo", repoBranch: "trunk", path: "src/a.py", line: 2 });
  assert.match(snippet, />> 2: line two/);
  assert.equal(rawCalls.length, 1);
  assert.equal(rawCalls[0].url.startsWith("https://raw.githubusercontent.com/acme/secret-repo/trunk/"), true);
  const sent = JSON.stringify(rawCalls[0].headers).toLowerCase();
  assert.ok(!sent.includes("authorization") && !sent.includes("x-github-token"),
    "an unauthenticated raw fetch can only return public files, so private source can never reach the Gemini call");
});
