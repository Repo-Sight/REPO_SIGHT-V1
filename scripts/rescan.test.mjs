// scripts/rescan.test.mjs -- run with: npm run test:api
// Rescan planning (frontend/src/lib/rescan.ts): which repo URL a stored scan is scanned again
// from, and whether it needs the user's GitHub token. The module is TypeScript; Node strips the
// types when it imports the file (default since Node 22.18). Older Node: the suite skips.
import test from "node:test";
import assert from "node:assert/strict";

const canStrip = Boolean(process.features?.typescript);
let mod = null;
if (canStrip) mod = await import("../frontend/src/lib/rescan.ts");
const opts = { skip: canStrip ? false : "Node without TypeScript type stripping" };

test("public repo scan plans a public rescan of the plain GitHub URL", opts, () => {
  const plan = mod.planRescan({ repoOwner: "octo-cat", repoName: "hello.world_1", visibility: "public" });
  assert.deepEqual(plan, { kind: "public", repoUrl: "https://github.com/octo-cat/hello.world_1" });
});

test("scans from before the visibility field are public", opts, () => {
  assert.equal(mod.planRescan({ repoOwner: "a", repoName: "b" }).kind, "public");
});

test("private scan plans a private rescan (token needed)", opts, () => {
  const plan = mod.planRescan({ repoOwner: "me", repoName: "secret", visibility: "private" });
  assert.deepEqual(plan, { kind: "private", repoUrl: "https://github.com/me/secret" });
});

test("pasted-file scans have no repo and cannot be rescanned", opts, () => {
  const plan = mod.planRescan({ visibility: "public" });
  assert.equal(plan.kind, "unavailable");
  assert.match(plan.reason, /Pasted files/);
  assert.equal(mod.planRescan({ repoOwner: "a" }).kind, "unavailable");
  assert.equal(mod.planRescan({ repoName: "b" }).kind, "unavailable");
});

test("owner or repo that could change the URL is refused", opts, () => {
  const bad = [
    ["a/b", "c"],
    ["a", "b/c"],
    ["a", ".."],
    ["a", "."],
    ["a b", "c"],
    ["a", "b c"],
    ["-a", "b"],
    ["a", "b#frag"],
    ["a", "b?x=1"],
    ["evil.com", "x"],
    ["a".repeat(40), "b"],
    ["a", "b".repeat(101)],
    ["a", ""],
  ];
  for (const [repoOwner, repoName] of bad) {
    assert.equal(mod.planRescan({ repoOwner, repoName, visibility: "public" }).kind, "unavailable", `${repoOwner}/${repoName}`);
  }
});

test("unknown visibility fails closed, like the server access rule", opts, () => {
  assert.equal(mod.planRescan({ repoOwner: "a", repoName: "b", visibility: "internal" }).kind, "unavailable");
});

test("the reauth message is stable (the UI shows it as is)", opts, () => {
  assert.match(mod.GITHUB_REAUTH_MESSAGE, /GitHub connection has expired/);
});
