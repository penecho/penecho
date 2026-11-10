"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../public/widget-host.js"), "utf8");
function boot(remoteCanvas) {
  const messages = [], replies = [], calls = [];
  const parent = { postMessage:message => messages.push(message) };
  const context = vm.createContext({ parent, window:{}, location:{ origin:"https://cloud.test" }, parentOrigin:"https://cloud.test",
    remoteCanvas, publicFetchUrl:"http://localhost/api/widget-fetch", accessSession:"session", PUBLIC_FETCH_MAX_URL_LENGTH:16384,
    inner:{ contentWindow:{ postMessage:message => replies.push(message) } },
    fetch:async (url, options) => { calls.push({ url, options }); return new Response("local bytes"); },
    setTimeout, clearTimeout, Response, TextDecoder,
  });
  vm.runInContext(source.slice(source.indexOf("  async function proxyPublicFetch("), source.indexOf("  function resolveImageAssets(")), context);
  return { context, parent, calls, replies, messages };
}
test("Cloud Widget host waits for its authenticated parent's routed public response", async () => {
  const run = boot(true), pending = run.context.proxyPublicFetch({ requestId:"public-fetch-1", url:"https://example.org/data" });
  assert.equal(run.calls.length, 0);
  assert.equal(run.messages.length, 1);
  assert.equal(run.messages[0].url, "https://example.org/data");
  const data = { type:"penecho-widget-host-public-fetch-result", requestId:run.messages[0].requestId, status:200,
    headers:{ "content-type":"text/plain", "x-penecho-upstream-status":"201" }, body:new TextEncoder().encode("cloud bytes").buffer };
  assert.equal(run.context.receiveParentPublicFetch({ source:{}, origin:"https://cloud.test", data }), false);
  assert.equal(run.context.receiveParentPublicFetch({ source:run.parent, origin:"https://foreign.test", data }), false);
  assert.equal(run.replies.length, 0);
  assert.equal(run.context.receiveParentPublicFetch({ source:run.parent, origin:"https://cloud.test", data }), true);
  await pending;
  assert.equal(run.replies[0].status, 201);
  assert.equal(new TextDecoder().decode(run.replies[0].body), "cloud bytes");
});
test("Local and viewer Widget host retains its existing local public proxy contract", async () => {
  const run = boot(false);
  await run.context.proxyPublicFetch({ requestId:"public-fetch-1", url:"https://example.org/data" });
  assert.equal(run.messages.length, 0);
  assert.equal(run.calls.length, 1);
  assert.equal(run.calls[0].url, "http://localhost/api/widget-fetch");
  assert.equal(run.calls[0].options.method, "POST");
  assert.equal(run.calls[0].options.headers["X-PenEcho-Session"], "session");
  assert.equal(JSON.parse(run.calls[0].options.body).url, "https://example.org/data");
  assert.equal(new TextDecoder().decode(run.replies[0].body), "local bytes");
});
