"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/client/app/smart-suggestions.js"), "utf8");
const statusSource = source.slice(source.indexOf("  let smartSuggestStatusSequence"));
const accessSource = source.slice(source.indexOf("  function updateSuggestionAccess("), source.indexOf("  function suggestionAccessNotice("));
const settled = () => new Promise(resolve => setImmediate(resolve));
const response = (status = 200, data = { configured:true }, retryAfter = null) => ({
  status, ok:status >= 200 && status < 300, json:async () => data,
  headers:{ get:() => retryAfter },
});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function harness(fetchImpl, { enabled = true, visible = true } = {}) {
  let now = 1000, nextTimer = 1;
  const timers = new Map(), requests = [], windowEvents = new Map(), documentEvents = new Map(), accessUpdates = [], scheduled = [];
  const smartSuggest = { enabled, available:false, access:null, sequence:0,
    availability:{ pending:null, controller:null, checkedAt:0, nextAt:0, retryAfterAt:0, failures:0, authRequired:false } };
  const document = { visibilityState:visible ? "visible" : "hidden", querySelector:() => null, addEventListener:(name, callback) => documentEvents.set(name, callback) };
  const context = vm.createContext({ smartSuggest, document, SMART_SUGGEST:{}, AbortController,
    Date:class extends Date { static now() { return now; } }, Math:Object.assign(Object.create(Math), { random:() => 0.5 }),
    window:{ addEventListener:(name, callback) => windowEvents.set(name, callback) },
    authenticatedApiHeaders:headers => headers, suggestionApiPath:suffix => `/api/suggest${suffix}`,
    updateSuggestionAccess:data => { accessUpdates.push(data); if (data?.access) smartSuggest.access = data.access; },
    syncSmartSuggestToggle() {}, assistRefresh() {}, cancelSmartSuggest() {},
    refreshSuggestionSpendingControl() {}, refreshSuggestionAllowanceStatus() {},
    scheduleAssist:() => scheduled.push(now), resumeWidgetAssistSuggestions() {},
    setTimeout:(fn, delay) => { const id = nextTimer++; timers.set(id, { fn, at:now + delay }); return id; }, clearTimeout:id => timers.delete(id),
    fetch:(url, options) => { requests.push({ url, options, at:now }); return fetchImpl(url, options); },
  });
  vm.runInContext(statusSource, context);
  return { context, smartSuggest, requests, timers, accessUpdates, scheduled,
    useActualAccessUpdates:() => vm.runInContext(accessSource, context),
    refresh:options => context.refreshSmartSuggestAvailability(options),
    event:(name, detail) => windowEvents.get(name)?.({ detail }),
    visible:value => { document.visibilityState = value ? "visible" : "hidden"; documentEvents.get("visibilitychange")?.(); },
    advance:async milliseconds => { now += milliseconds; for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); } await settled(); },
  };
}

test("initial status failures never create idle polling, including a missing Cloud status route", async () => {
  for (const result of [response(200, { configured:false }), response(401), response(403), response(404), response(501), response(429), response(503), null]) {
    const h = harness(async () => { if (!result) throw Error("offline"); return result; });
    await settled();
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
    await h.advance(3600000);
    assert.equal(h.requests.length, 1, `idle status ${result?.status || "network"}`);
    assert.equal(h.timers.size, 0);
  }
});

test("focus, visibility, online and explicit refresh share one current check", async () => {
  const reply = deferred(), h = harness(() => reply.promise);
  const pending = h.refresh();
  assert.equal(h.refresh({ force:true }), pending);
  h.event("focus"); h.event("online"); h.visible(true); h.event("penecho:settings-page", { page:"canvas" });
  assert.equal(h.requests.length, 1);
  reply.resolve(response()); await pending;
  assert.equal(h.timers.size, 0);
  h.event("focus"); h.event("online"); h.visible(true);
  assert.equal(h.requests.length, 1, "recent status is reused by passive events");
  h.event("penecho:settings-page", { page:"canvas" });
  assert.equal(h.requests.length, 1, "settings events in the same second cannot burst");
  await h.advance(30000); h.event("focus"); await settled();
  assert.equal(h.requests.length, 2);
});

test("passive status checks retain bounded exponential cooldown", async () => {
  let calls = 0;
  const h = harness(async () => ++calls < 3 ? response(503) : response());
  await settled();
  assert.equal(h.smartSuggest.availability.nextAt, 6000);
  for (let i = 0; i < 5; i++) { h.event("focus"); await h.refresh({ reason:"focus" }); }
  assert.equal(calls, 1);
  await h.advance(5000); await h.refresh({ reason:"focus" });
  assert.equal(calls, 2);
  assert.equal(h.smartSuggest.availability.nextAt, 16000);
  await h.advance(10000); h.event("focus"); await settled();
  assert.equal(calls, 3);
  assert.equal(h.smartSuggest.available, true);
  assert.equal(h.scheduled.length, 1, "recovery resumes queued suggestions");
  assert.equal(h.timers.size, 0);
});

test("transient jitter remains bounded and a request timeout never arms an idle retry", async () => {
  const h = harness(async () => response(503));
  await settled();
  for (const random of [0, 1, 1, 1, 1, 1, 1]) {
    h.context.Math.random = () => random;
    const delay = h.smartSuggest.availability.nextAt - h.requests.at(-1).at;
    assert.ok(delay >= 5000 && delay <= 60000, `bounded delay ${delay}`);
    await h.advance(delay); await h.refresh({ reason:"input" });
    assert.equal(h.timers.size, 0);
  }
  assert.equal(h.smartSuggest.availability.nextAt - h.requests.at(-1).at, 60000);
  const timedOut = harness((_url, options) => new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once:true })));
  await timedOut.advance(7000);
  assert.equal(timedOut.smartSuggest.available, false);
  assert.equal(timedOut.timers.size, 0);
  await timedOut.advance(60000); assert.equal(timedOut.requests.length, 1);
});

test("passive checks retain auth failures and five-minute unsupported/unconfigured caches", async () => {
  for (const status of [401, 403, 404, 501, 200]) {
    let calls = 0;
    const h = harness(async () => ++calls === 1 ? response(status, { configured:false }) : response());
    await settled(); await h.advance(299000);
    await h.refresh({ reason:"focus" }); h.event("focus"); await settled();
    assert.equal(calls, 1);
    await h.advance(1000); await h.refresh({ reason:"focus" });
    assert.equal(calls, status === 401 || status === 403 ? 1 : 2);
    if (status === 401 || status === 403) { h.event("penecho:settings-page", { page:"canvas" }); await settled(); }
    assert.equal(calls, 2);
    assert.equal(h.smartSuggest.available, true);
  }
});

test("each due Suggest bypasses cached failures immediately and forwards recovery to the relay", async () => {
  for (const failure of [null, response(503), response(401), response(403), response(404), response(501), response(200, { configured:false })]) {
    let calls = 0;
    const h = harness(async () => {
      if (++calls === 1) { if (!failure) throw Error("offline"); return failure; }
      return response();
    });
    await settled();
    assert.equal(h.smartSuggest.available, false);
    await h.refresh({ reason:"input" });
    assert.equal(calls, 2, `due input retries status ${failure?.status || "network"} without waiting`);
    assert.equal(h.requests[1].options.headers["X-PenEcho-Suggest-Refresh"], "1");
    assert.equal(h.smartSuggest.available, true);
    assert.equal(h.scheduled.length, 1, "recovery continues ranking");
    assert.equal(h.timers.size, 0, "no idle polling");
  }
});

test("repeated failed Suggest demand remains retryable and concurrent demand coalesces", async () => {
  const reply = deferred(); let calls = 0;
  const h = harness(async () => ++calls < 3 ? response(503) : reply.promise);
  await settled();
  await h.refresh({ reason:"input" });
  assert.equal(calls, 2); assert.equal(h.timers.size, 0);
  const pending = h.refresh({ reason:"input" });
  assert.equal(h.refresh({ reason:"input" }), pending);
  assert.equal(calls, 3);
  reply.resolve(response()); await pending;
  assert.equal(h.smartSuggest.available, true);
});

test("Retry-After seconds and HTTP dates prevent early explicit or passive recovery", async () => {
  for (const retryAfter of ["120", new Date(121000).toUTCString()]) {
    let calls = 0;
    const h = harness(async () => ++calls === 1 ? response(429, { error:"capacity" }, retryAfter) : response());
    await settled(); await h.advance(119000);
    await h.refresh(); await h.refresh({ reason:"input" }); h.event("focus"); h.event("penecho:settings-page", { page:"canvas" }); await settled();
    assert.equal(calls, 1);
    await h.advance(1000); h.event("online"); await settled();
    assert.equal(calls, 2); assert.equal(h.smartSuggest.available, true);
  }
});

test("account changes detach stale checks and refresh immediately even with automatic suggestions off", async () => {
  const old = deferred(); let calls = 0;
  const h = harness(async () => ++calls === 1 ? old.promise : response(200, { configured:true, access:{ account:"new" } }), { enabled:false });
  const oldPending = h.refresh();
  h.event("penecho:cloud-account-changed"); await settled();
  assert.equal(calls, 2);
  assert.equal(h.requests[0].options.signal.aborted, true);
  old.resolve(response(200, { configured:false, access:{ account:"old" } })); await oldPending;
  assert.equal(h.smartSuggest.available, true);
  assert.equal(h.smartSuggest.access.account, "new");
  assert.equal(h.requests[1].options.headers["X-PenEcho-Suggest-Refresh"], "1");
  assert.equal(h.timers.size, 0);
});

test("hidden pages and disabled automatic suggestions suppress passive checks while explicit controls stay available", async () => {
  const h = harness(async () => response(), { enabled:false, visible:false });
  await settled(); assert.equal(h.requests.length, 0);
  h.visible(true); await settled(); assert.equal(h.requests.length, 1, "one deferred initialization is allowed while off");
  await h.advance(60000); h.event("focus"); h.event("online"); h.visible(true); await h.refresh({ reason:"input" });
  assert.equal(h.requests.length, 1);
  h.event("penecho:settings-page", { page:"canvas" }); await settled();
  assert.equal(h.requests.length, 2, "Settings still updates manual feature availability");
  h.visible(false); await h.advance(60000); await h.refresh();
  assert.equal(h.requests.length, 2);
});

test("hidden pages discard a response whose transport ignores abort", async () => {
  const old = deferred(), h = harness(() => old.promise);
  const pending = h.refresh(); h.visible(false);
  old.resolve(response(200, { configured:true, access:{ stale:true } })); await pending;
  assert.equal(h.smartSuggest.available, false); assert.equal(h.accessUpdates.length, 0);
  assert.equal(h.timers.size, 0);
});

test("authoritative preferences and inference allowance reject an older Cloud-browser status response", async () => {
  for (const action of ["preferences", "inference"]) {
    const old = deferred(), h = harness(async url => url.endsWith("/preferences") ? response(200, { access:{ remaining:199, paidEnabled:true } }) : old.promise);
    h.useActualAccessUpdates();
    const pending = h.smartSuggest.availability.pending;
    if (action === "preferences") await h.context.setSuggestionSpending(true, 50);
    else h.context.updateSuggestionAccess({ ok:true, access:{ remaining:199 } });
    assert.equal(h.smartSuggest.available, true);
    assert.equal(h.requests[0].options.signal.aborted, true);
    old.resolve(response(200, { configured:true, access:{ remaining:200 } })); await pending;
    assert.equal(h.smartSuggest.access.remaining, 199, action);
    assert.equal(h.smartSuggest.availability.pending, null);
    assert.equal(h.timers.size, 0);
    assert.equal(h.requests.filter(request => request.url.endsWith("/status")).length, 1, "new allowance does not trigger another status fetch");
  }
});

test("a preference response from the previous account cannot replace the new account allowance", async () => {
  const preference = deferred(); let statusCalls = 0;
  const h = harness(async url => url.endsWith("/preferences") ? preference.promise : response(200, { configured:true, access:{ account:++statusCalls === 1 ? "old" : "new" } }));
  h.useActualAccessUpdates(); await settled();
  const pending = h.context.setSuggestionSpending(true, 50);
  h.event("penecho:cloud-account-changed"); await settled();
  preference.resolve(response(200, { access:{ account:"old", paidEnabled:true } })); await pending;
  assert.equal(h.smartSuggest.access.account, "new");
});

test("re-enabling sends the explicit refresh before input demand can reuse desktop auth failure", async () => {
  const h = harness(async () => response(401), { enabled:false });
  await settled();
  h.context.SMART_SUGGEST_STORAGE_KEY = "suggestions";
  h.context.localStorage = { setItem() {} };
  h.context.state = {};
  h.context.requestInteractionLayerRender = () => {};
  h.context.scheduleAssist = () => h.refresh({ reason:"input" });
  vm.runInContext(source.slice(source.indexOf("  function setSmartSuggestEnabled("), source.indexOf("  function smartSuggestSyncDocument(")), h.context);
  await h.advance(1000);
  h.context.setSmartSuggestEnabled(true); await settled();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].options.headers["X-PenEcho-Suggest-Refresh"], "1");
});
