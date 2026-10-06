"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CloudConnector } = require("../src/server/cloud-connector.js");

const response = (status = 200, data = { configured:true }, retryAfter = null) => new Response(JSON.stringify(data), {
  status, headers:{ "content-type":"application/json", ...(retryAfter ? { "retry-after":retryAfter } : {}) },
});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness(t, fetchImpl) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-suggestion-status-"));
  const originalFetch = global.fetch, originalNow = Date.now, originalRandom = Math.random;
  let now = 1000;
  const requests = [], connector = new CloudConnector({ stateDir:directory, executeRequest:async () => ({}), defaultOrigin:"https://one.example", suggestionTransport:{request:(...args) => global.fetch(...args)} });
  global.fetch = (url, options) => { requests.push({ url, options, at:now }); return fetchImpl(url, options); };
  Date.now = () => now; Math.random = () => 0.5;
  t.after(() => { global.fetch = originalFetch; Date.now = originalNow; Math.random = originalRandom; connector.close(); fs.rmSync(directory, { recursive:true, force:true }); });
  return { connector, requests, advance:milliseconds => { now += milliseconds; },
    account:(token, origin = "https://one.example") => connector.writeConfiguration({ origin, accountToken:token, enabled:false }),
  };
}

test("desktop windows coalesce status and reuse fresh copies without leaking the guest credential", async t => {
  const reply = deferred(); let calls = 0;
  const h = harness(t, () => ++calls === 1 ? reply.promise : Promise.resolve(response())), c = h.connector;
  const first = c.suggestionRequest("/status"), second = c.suggestionRequest("/status", { refresh:true });
  assert.equal(h.requests.length, 1);
  reply.resolve(response(200, { configured:true, guestToken:"guest-secret", access:{ remaining:200 } }));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.guestToken, undefined); assert.equal(b.guestToken, undefined);
  a.access.remaining = 0;
  assert.equal((await c.suggestionRequest("/status")).access.remaining, 200);
  assert.equal(h.requests.length, 1);
  await c.suggestionRequest("/status", { refresh:true }); assert.equal(h.requests.length, 1, "same-second refresh does not burst");
  h.advance(30000); await c.suggestionRequest("/status"); assert.equal(h.requests.length, 2);
});

test("desktop status retains failures and cooldowns while allowing explicit stable-error recovery", async t => {
  let result;
  const h = harness(t, async () => response(result.status, result.data)), c = h.connector;
  for (const status of [401, 403, 404, 501, 200]) {
    c.invalidateSuggestionStatus(); result = { status, data:{ configured:false } };
    const check = () => c.suggestionRequest("/status");
    if (status === 200) assert.equal((await check()).configured, false);
    else await assert.rejects(check, error => error.status === status);
    const calls = h.requests.length;
    h.advance(299000);
    if (status === 200) await check(); else await assert.rejects(check, error => error.status === status);
    assert.equal(h.requests.length, calls);
    h.advance(1000);
    if (status === 401 || status === 403) { await assert.rejects(check); assert.equal(h.requests.length, calls); }
    else { if (status === 200) await check(); else await assert.rejects(check); assert.equal(h.requests.length, calls + 1); }
    result = { status:200, data:{ configured:true } }; h.advance(1000);
    assert.equal((await c.suggestionRequest("/status", { refresh:true })).configured, true);
  }
});

test("desktop Retry-After seconds and dates hold across windows and explicit refreshes", async t => {
  let retryAfter = "120", calls = 0;
  const h = harness(t, async () => ++calls % 2 ? response(429, { error:"capacity" }, retryAfter) : response()), c = h.connector;
  for (const dateHeader of [false, true]) {
    c.invalidateSuggestionStatus();
    if (dateHeader) retryAfter = new Date(Date.now() + 120000).toUTCString();
    let firstError;
    await assert.rejects(c.suggestionRequest("/status"), error => { firstError = error; return error.status === 429; });
    h.advance(119000);
    await assert.rejects(c.suggestionRequest("/status", { refresh:true }), error => error === firstError);
    assert.equal(h.requests.length, dateHeader ? 3 : 1);
    h.advance(1000); assert.equal((await c.suggestionRequest("/status")).configured, true);
  }
});

test("desktop transient status errors back off without retrying until another caller asks", async t => {
  let calls = 0;
  const h = harness(t, async () => { if (++calls < 3) throw Error("offline"); return response(); }), c = h.connector;
  await assert.rejects(c.suggestionRequest("/status"), error => error.status === 503);
  assert.equal(c.suggestionStatus.nextAt, 6000);
  h.advance(4999); await assert.rejects(c.suggestionRequest("/status")); assert.equal(calls, 1);
  h.advance(1); await assert.rejects(c.suggestionRequest("/status")); assert.equal(calls, 2);
  assert.equal(c.suggestionStatus.nextAt, 16000);
  h.advance(10000); assert.equal((await c.suggestionRequest("/status")).configured, true); assert.equal(calls, 3);
});

test("due Suggest refresh bypasses the relay's cached failure even within the same second", async t => {
  for (const status of [401, 403, 404, 501, 503, 200]) {
    let calls = 0;
    const h = harness(t, async () => ++calls === 1 ? response(status, { configured:false }) : response());
    if (status === 200) assert.equal((await h.connector.suggestionRequest("/status")).configured, false);
    else await assert.rejects(h.connector.suggestionRequest("/status"));
    assert.equal((await h.connector.suggestionRequest("/status", { refresh:true })).configured, true);
    assert.equal(calls, 2, `status ${status} must not block new input`);
  }
});

test("desktop changes of account or origin detach old status even when transport ignores abort", async t => {
  const old = deferred(); let calls = 0;
  const h = harness(t, async () => ++calls === 1 ? old.promise : response(200, { configured:true, access:{ owner:`account-${calls}` } })), c = h.connector;
  h.account("first-token");
  const stale = c.suggestionRequest("/status"), rejected = assert.rejects(stale, error => error.status === 409);
  h.account("second-token"); const fresh = await c.suggestionRequest("/status");
  assert.equal(fresh.access.owner, "account-2"); assert.equal(h.requests[0].options.signal.aborted, true);
  old.resolve(response(200, { configured:false, guestToken:"stale-guest", access:{ owner:"old" } })); await rejected;
  assert.equal(c.suggestionGuests["https://one.example"], undefined);
  assert.equal((await c.suggestionRequest("/status")).access.owner, "account-2");
  h.account("second-token", "https://two.example"); await c.suggestionRequest("/status");
  assert.equal(h.requests.length, 3); assert.match(h.requests.at(-1).url, /^https:\/\/two\.example/);
  assert.equal(h.requests.at(-1).options.headers.authorization, "Bearer second-token");
});

test("one window cancelling its wait preserves another window's shared status check", async t => {
  const reply = deferred(), h = harness(t, () => reply.promise), c = h.connector, controller = new AbortController();
  const a = c.suggestionRequest("/status", { signal:controller.signal }), b = c.suggestionRequest("/status");
  controller.abort(); await assert.rejects(a, error => error.name === "AbortError");
  assert.equal(h.requests[0].options.signal.aborted, false);
  reply.resolve(response()); assert.equal((await b).configured, true); assert.equal(h.requests.length, 1);
});

test("spending changes invalidate status, and inference replies replace cached allowance including capacity errors", async t => {
  let kind = "initial";
  const old = deferred(), h = harness(t, async (url) => {
    if (url.endsWith("/preferences")) return response(200, { access:{ remaining:10, paidEnabled:true } });
    if (url.endsWith("/status")) return kind === "stale" ? old.promise : response(200, { configured:true, guestToken:"guest", access:{ remaining:200 } });
    return kind === "capacity" ? response(429, { error:"guest_capacity", details:{ access:{ remaining:0, reason:"guest_capacity" } } }) : response(200, { ok:true, access:{ remaining:199 } });
  }), c = h.connector;
  await c.suggestionRequest("/status");
  h.advance(1000); kind = "stale";
  const stale = c.suggestionRequest("/status", { refresh:true }), rejected = assert.rejects(stale, error => error.status === 409);
  await c.suggestionRequest("/preferences", { body:{ paidEnabled:true } });
  old.resolve(response(200, { configured:true, access:{ remaining:200 } })); await rejected;
  assert.equal(c.suggestionStatus, null);
  kind = "inference"; await c.suggestionRequest("", { body:{} });
  assert.equal((await c.suggestionRequest("/status")).access.remaining, 199);
  kind = "capacity"; await assert.rejects(c.suggestionRequest("", { body:{} }), error => error.status === 429);
  assert.equal((await c.suggestionRequest("/status")).access.reason, "guest_capacity");
  kind = "inference"; await c.suggestionRequest("", { body:{} });
  assert.equal((await c.suggestionRequest("/status")).access.reason, undefined, "a successful action clears an obsolete capacity reason");
});
