"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { gzipSync } = require("node:zlib");
const { setTimeout:delay } = require("node:timers/promises");
const { createSuggestionTransport } = require("../src/server/suggestion-transport.js");

async function fixture(t, handler, tls = null) {
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler), sockets = new Set();
  let opened = 0;
  server.keepAliveTimeout = 60000;
  server.on("connection", socket => { opened++; sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const transport = createSuggestionTransport(); t.after(() => transport.close());
  return { transport, server, sockets, opened:() => opened, url:`${tls ? "https" : "http"}://127.0.0.1:${server.address().port}` };
}

test("Suggest sockets survive idle pauses and are replaced after the peer closes them", async t => {
  const f = await fixture(t, (_req, res) => res.end('{"ok":true}'));
  await f.transport.request(f.url); await delay(30); await f.transport.request(f.url);
  assert.equal(f.opened(), 1);
  const socket = Object.values(f.transport.httpAgent.freeSockets).flat()[0];
  const closed = new Promise(resolve => socket.once("close", resolve));
  for (const peer of f.sockets) peer.destroy(); await closed;
  assert.equal((await f.transport.request(f.url)).status, 200);
  assert.equal(f.opened(), 2);
});

test("Suggest limits concurrency to two connections without replaying queued POSTs", async t => {
  let active = 0, peak = 0;
  const bodies = [];
  const f = await fixture(t, (req, res) => {
    active++; peak = Math.max(peak, active); let raw = "";
    req.on("data", chunk => raw += chunk);
    req.on("end", () => { bodies.push(raw); setTimeout(() => { active--; res.end('{"ok":true}'); }, 20); });
  });
  await Promise.all([1, 2, 3].map(id => f.transport.request(f.url, { method:"POST", body:JSON.stringify({ id }) })));
  assert.equal(peak, 2); assert.equal(f.opened(), 2);
  assert.deepEqual(bodies.map(raw => JSON.parse(raw).id).sort(), [1, 2, 3]);
});

test("Suggest preserves authorization, UTF-8 body length, response status and Retry-After", async t => {
  const payload = JSON.stringify({ question:"数学" }); let observed;
  const f = await fixture(t, (req, res) => {
    let raw = ""; req.on("data", chunk => raw += chunk);
    req.on("end", () => {
      observed = { headers:req.headers, raw };
      res.writeHead(429, { "retry-after":"120", "content-encoding":"gzip" });
      res.end(gzipSync('{"error":"capacity"}'));
    });
  });
  const response = await f.transport.request(f.url, { method:"POST", headers:{ authorization:"Bearer account", "x-penecho-guest":"trial", "content-type":"application/json" }, body:payload });
  assert.equal(response.status, 429); assert.equal(response.ok, false);
  assert.equal(response.headers.get("retry-after"), "120");
  assert.deepEqual(JSON.parse(await response.text()), { error:"capacity" });
  assert.equal(observed.raw, payload); assert.equal(observed.headers["content-length"], String(Buffer.byteLength(payload)));
  assert.equal(observed.headers.authorization, "Bearer account"); assert.equal(observed.headers["x-penecho-guest"], "trial");
});

test("Suggest deadlines and caller cancellation cover response bodies, then allow a new connection", async t => {
  let calls = 0; let ready;
  const started = new Promise(resolve => ready = resolve);
  const f = await fixture(t, (_req, res) => {
    if (++calls <= 2) { res.writeHead(200); res.write("{"); ready(); }
    else res.end('{"ok":true}');
  });
  const controller = new AbortController(), reason = new Error("caller stopped");
  const pending = f.transport.request(f.url, { signal:controller.signal });
  const cancelled = assert.rejects(pending, error => error === reason);
  await started; controller.abort(reason); await cancelled;
  await assert.rejects(f.transport.request(f.url, { signal:AbortSignal.timeout(30) }), error => error.name === "TimeoutError");
  assert.equal((await f.transport.request(f.url)).status, 200);
  const already = new AbortController(); already.abort();
  await assert.rejects(f.transport.request(f.url, { signal:already.signal }), error => error.name === "AbortError");
  assert.equal(calls, 3);
});

test("Suggest rejects redirects and never follows them with credentials", async t => {
  let requests = 0;
  const f = await fixture(t, (_req, res) => { requests++; res.writeHead(307, { location:"/other" }); res.end(); });
  await assert.rejects(f.transport.request(f.url, { method:"POST", body:"{}", headers:{ authorization:"Bearer secret" } }), error => error.code === "suggestion_redirect_rejected");
  assert.equal(requests, 1);
});

test("Suggest rejects incomplete POST responses without an automatic replay", async t => {
  let requests = 0;
  const f = await fixture(t, (_req, res) => { requests++; res.writeHead(200, { "content-length":"100" }); res.write("{"); setImmediate(() => res.destroy()); });
  await assert.rejects(f.transport.request(f.url, { method:"POST", body:"{}" }), error => ["suggestion_response_aborted", "ECONNRESET"].includes(error.code));
  await delay(20); assert.equal(requests, 1);
});

test("Suggest bounds decompressed responses and recovers after a size failure", async t => {
  const f = await fixture(t, (req, res) => {
    if (req.url === "/large") { res.writeHead(200, { "content-encoding":"gzip" }); res.end(gzipSync("x".repeat(1024))); }
    else res.end("{}");
  });
  const transport = createSuggestionTransport({ maxResponseBytes:100 }); t.after(() => transport.close());
  await assert.rejects(transport.request(f.url + "/large"), error => error.code === "suggestion_response_too_large");
  assert.equal((await transport.request(f.url)).status, 200);
});

test("closing Suggest transport releases active and queued requests and forbids new work", async t => {
  const f = await fixture(t, () => {});
  const requests = Array.from({ length:3 }, () => f.transport.request(f.url));
  const rejected = requests.map(pending => assert.rejects(pending, error => error.code === "suggestion_transport_closed"));
  await delay(20); f.transport.close(); await Promise.all(rejected);
  await assert.rejects(f.transport.request(f.url), error => error.code === "suggestion_transport_closed");
});

test("Suggest retains certificate and hostname validation while reusing HTTPS sockets", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-suggest-tls-"));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const key = path.join(directory, "key.pem"), cert = path.join(directory, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "1", "-keyout", key, "-out", cert, "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio:"ignore" });
  const certificate = fs.readFileSync(cert);
  const f = await fixture(t, (_req, res) => res.end("{}"), { key:fs.readFileSync(key), cert:certificate });
  await assert.rejects(f.transport.request(f.url), error => error.code === "DEPTH_ZERO_SELF_SIGNED_CERT");
  f.transport.httpsAgent.options.ca = certificate;
  await f.transport.request(f.url); const before = f.opened();
  await f.transport.request(f.url); assert.equal(f.opened(), before);
  f.transport.httpsAgent.options.servername = "wrong.example";
  await assert.rejects(f.transport.request(f.url), error => error.code === "ERR_TLS_CERT_ALTNAME_INVALID");
  await assert.rejects(f.transport.request("http://example.com"), /HTTPS/);
});
