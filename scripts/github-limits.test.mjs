// scripts/github-limits.test.mjs
//
// Public-path download behaviour in api/_lib/github.js:
//   * main -> master -> HEAD fallback (trunk/develop repos)
//   * limits enforced WHILE streaming (codeload sends no content-length)
//   * symlink entries skipped
//   * abort signal tears the pipeline down
//
// Run: node --test scripts/github-limits.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  downloadPublicAndExtract,
  RepoTooLargeError,
  MAX_TARBALL_BYTES,
  MAX_EXTRACTED_BYTES,
  MAX_EXTRACTED_FILES,
} from "../api/_lib/github.js";

// ---- minimal ustar writer (header + padded body) --------------------------
function header(name, { size = 0, type = "0", link = "" } = {}) {
  const b = Buffer.alloc(512);
  b.write(name, 0, 100, "utf8");
  b.write("0000644\0", 100);
  b.write("0000000\0", 108);
  b.write("0000000\0", 116);
  b.write(size.toString(8).padStart(11, "0") + "\0", 124);
  b.write("00000000000\0", 136);
  b.write("        ", 148); // checksum placeholder (8 spaces)
  b.write(type, 156);
  b.write(link, 157, 100, "utf8");
  b.write("ustar\0" + "00", 257);
  let sum = 0;
  for (const byte of b) sum += byte;
  b.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return b;
}
function entry(name, body = "") {
  const data = Buffer.from(body);
  const pad = (512 - (data.length % 512)) % 512;
  return Buffer.concat([header(name, { size: data.length }), data, Buffer.alloc(pad)]);
}
const END = Buffer.alloc(1024);
const tgz = (...parts) => gzipSync(Buffer.concat([...parts, END]));

// Deliver a buffer the way a network does: many small chunks, with
// backpressure (pull-based), so the extractor can't be handed everything at once.
function chunked(buf, size = 1024) {
  let off = 0;
  return new ReadableStream({
    async pull(controller) {
      if (off >= buf.length) { controller.close(); return; }
      controller.enqueue(buf.subarray(off, off + size));
      off += size;
      await new Promise((r) => setImmediate(r));
    },
  });
}

// ---- fetch stub -------------------------------------------------------------
const realFetch = globalThis.fetch;
let calls = [];
function stub(routes) {
  calls = [];
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);
    const r = routes(url, init);
    return Promise.resolve(r ?? new Response("not found", { status: 404 }));
  };
}
test.afterEach(() => { globalThis.fetch = realFetch; });

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "gh-limits-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

test("default branch other than main/master resolves via HEAD", async () => {
  const body = tgz(entry("repo-trunk/"), entry("repo-trunk/a.py", "x = 1\n"));
  stub((url) => url.endsWith("/tar.gz/HEAD") ? new Response(body, { status: 200 }) : null);
  await withDir(async (dir) => {
    const label = await downloadPublicAndExtract("acme", "repo", dir);
    assert.equal(label, "HEAD");
    assert.deepEqual(calls.map((u) => u.split("/tar.gz/")[1]), ["refs/heads/main", "refs/heads/master", "HEAD"]);
    assert.equal(await readFile(join(dir, "a.py"), "utf8"), "x = 1\n");
  });
});

test("main still wins first; nonexistent repo returns null after all three refs", async () => {
  const body = tgz(entry("repo-main/a.py", "x = 1\n"));
  stub((url) => url.endsWith("refs/heads/main") ? new Response(body, { status: 200 }) : null);
  await withDir(async (dir) => {
    assert.equal(await downloadPublicAndExtract("acme", "repo", dir), "main");
    assert.equal(calls.length, 1);
  });
  stub(() => null);
  await withDir(async (dir) => {
    assert.equal(await downloadPublicAndExtract("acme", "nope", dir), null);
    assert.equal(calls.length, 3);
  });
});

test("symlink and hardlink entries are not extracted", async () => {
  const body = tgz(
    entry("r/ok.py", "x = 1\n"),
    header("r/evil.py", { type: "2", link: "/etc/passwd" }),
    header("r/hard.py", { type: "1", link: "r/ok.py" }),
  );
  stub((url) => url.endsWith("refs/heads/main") ? new Response(body, { status: 200 }) : null);
  await withDir(async (dir) => {
    await downloadPublicAndExtract("acme", "repo", dir);
    assert.deepEqual((await readdir(dir)).sort(), ["ok.py"]);
  });
});

test("too many entries aborts extraction with RepoTooLargeError", async () => {
  const parts = [];
  for (let i = 0; i < MAX_EXTRACTED_FILES + 2000; i++) parts.push(entry(`r/f${i}.txt`));
  const body = tgz(...parts);
  stub((url) => url.endsWith("refs/heads/main") ? new Response(chunked(body), { status: 200 }) : null);
  await withDir(async (dir) => {
    await assert.rejects(() => downloadPublicAndExtract("acme", "repo", dir), RepoTooLargeError);
    const first = (await readdir(dir)).length;
    await new Promise((r) => setTimeout(r, 300));
    const second = (await readdir(dir)).length;
    assert.ok(first <= MAX_EXTRACTED_FILES, "nothing past the cap was written");
    assert.equal(second, first, "no writes continue after the error");
  });
});

test("declared extracted size over the cap is rejected from the header alone", async () => {
  const body = gzipSync(Buffer.concat([header("r/huge.bin", { size: MAX_EXTRACTED_BYTES + 1 }), Buffer.alloc(4096)]));
  stub((url) => url.endsWith("refs/heads/main") ? new Response(body, { status: 200 }) : null);
  await withDir(async (dir) => {
    await assert.rejects(() => downloadPublicAndExtract("acme", "repo", dir), RepoTooLargeError);
    assert.deepEqual(await readdir(dir), []);
  });
});

test("compressed download over the cap is rejected even with no content-length", async () => {
  const chunk = Buffer.alloc(1024 * 1024, 7);
  let sent = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (sent > MAX_TARBALL_BYTES / chunk.length + 2) { controller.close(); return; }
      sent += 1;
      controller.enqueue(chunk);
    },
  });
  stub((url) => url.endsWith("refs/heads/main") ? new Response(stream, { status: 200 }) : null);
  await withDir(async (dir) => {
    await assert.rejects(() => downloadPublicAndExtract("acme", "repo", dir), RepoTooLargeError);
    assert.ok(sent < MAX_TARBALL_BYTES / chunk.length + 10, "stopped reading soon after the cap");
  });
});

test("aborting the signal stops a stalled download and cancels the body", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull() { return new Promise((r) => setTimeout(r, 20)); }, // never produces data
    cancel() { cancelled = true; },
  });
  stub((url) => url.endsWith("refs/heads/main") ? new Response(stream, { status: 200 }) : null);
  const controller = new AbortController();
  await withDir(async (dir) => {
    const p = downloadPublicAndExtract("acme", "repo", dir, controller.signal);
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(p, (err) => err.name === "AbortError" || err.code === "ABORT_ERR");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(cancelled, true, "response body was cancelled");
  });
});
