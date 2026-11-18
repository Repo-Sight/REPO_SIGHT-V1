// scripts/badge.test.mjs -- run with: npm run test:api
// Guards the README badge: what it may reveal, id parsing, SVG safety.
import test from "node:test";
import assert from "node:assert/strict";
import badgeHandler, { badgeModel, renderBadge, parseBadgeId } from "../api/badge/[scanId].js";

const ID = "3f2b8c1e-9d4a-4e7b-8a21-5c6d7e8f9a0b";

const fakeRes = () => {
  const r = { headers: {}, code: 0, body: undefined };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = c => { r.code = c; return r; };
  r.send = b => { r.body = b; return r; };
  r.json = b => { r.body = b; return r; };
  return r;
};

test("public scan shows grade and rounded score with its colour", () => {
  const m = badgeModel({ visibility: "public", project: { healthGrade: "B", healthScore: 82.4 } });
  assert.equal(m.value, "B \u00b7 82");
  assert.equal(m.color, "#97ca00");
});

test("pre-visibility (legacy) scans behave as public", () => {
  assert.equal(badgeModel({ project: { healthGrade: "A", healthScore: 95 } }).value, "A \u00b7 95");
});

test("private, unknown-visibility and malformed payloads never reveal a score", () => {
  for (const p of [
    { visibility: "private", project: { healthGrade: "A", healthScore: 99 } },
    { visibility: "weird", project: { healthGrade: "A", healthScore: 99 } },
    { visibility: "public", project: { healthGrade: "Z", healthScore: 50 } },
    { visibility: "public", project: { healthGrade: "A", healthScore: "x" } },
    {}, null, undefined,
  ]) {
    assert.equal(badgeModel(p).value, "unavailable");
  }
});

test("scan id accepts bare uuid and .svg suffix, rejects everything else", () => {
  assert.equal(parseBadgeId(ID), ID);
  assert.equal(parseBadgeId(`${ID}.svg`), ID);
  assert.equal(parseBadgeId(`${ID}.SVG`), ID);
  assert.equal(parseBadgeId(["../etc/passwd"]), null);
  assert.equal(parseBadgeId(`${ID}/x`), null);
  assert.equal(parseBadgeId(""), null);
  assert.equal(parseBadgeId(undefined), null);
});

test("badge SVG escapes text and carries an accessible label", () => {
  const svg = renderBadge('a"<b>', "x & y", "#4c1");
  assert.ok(svg.startsWith("<svg"));
  assert.ok(!svg.includes("<b>"));
  assert.ok(svg.includes("&lt;b&gt;") && svg.includes("x &amp; y"));
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label=/);
});

test("handler: bad id -> 400 SVG, wrong method -> 405, no storage touched", async () => {
  const bad = fakeRes();
  await badgeHandler({ method: "GET", query: { scanId: "nope" } }, bad);
  assert.equal(bad.code, 400);
  assert.equal(bad.headers["Content-Type"], "image/svg+xml; charset=utf-8");
  assert.ok(String(bad.body).includes("invalid id"));
  assert.equal(bad.headers["X-Content-Type-Options"], "nosniff");

  const post = fakeRes();
  await badgeHandler({ method: "POST", query: { scanId: ID } }, post);
  assert.equal(post.code, 405);
  assert.equal(post.headers.Allow, "GET, HEAD");
});
