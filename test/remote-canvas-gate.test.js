"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const gateScript = fs.readFileSync(path.join(ROOT, "public", "remote-canvas.js"), "utf8");
const gateCss = fs.readFileSync(path.join(ROOT, "public", "remote-canvas.css"), "utf8");

const CANVAS_ID = "123e4567-e89b-12d3-a456-426614174000";
const COMMUNITY_ID = "123e4567-e89b-42d3-a456-426614174000";
const SAVED_CANVAS_ID = "123e4567-e89b-42d3-a456-426614174001";
const CURRENT_CANVAS_ID = "123e4567-e89b-42d3-a456-426614174002";
const SWITCHED_CANVAS_ID = "123e4567-e89b-42d3-a456-426614174003";
const HOSTED_MODEL_ID = "123e4567-e89b-42d3-a456-426614174004";

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.className = "";
    this.textContent = "";
    this.hidden = false;
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] || null; }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  insertBefore(node) { this.children.unshift(node); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  click() { this.listeners.get("click")?.({ target:this }); }
}

function flatten(root) {
  const out = [];
  const walk = (node) => { out.push(node); for (const child of node.children || []) walk(child); };
  walk(root);
  return out;
}

function boot({ pathname = `/canvas/${CANVAS_ID}`, baseURI = "https://cloud.penecho.test/canvas/", language = "en-US", respond, openCanvas, takeFurther, saveEcho, currentCanvasId, widgetFrames = [], nativeReads = false, fetchResponse, statusTimeout } = {}) {
  const topRow = new FakeElement("div");
  topRow.className = "top-row";
  const brand = new FakeElement("div");
  brand.className = "brand";
  topRow.append(brand);
  const document = {
    baseURI,
    cookie:"",
    body:new FakeElement("body"),
    createElement:(tag) => new FakeElement(tag),
    querySelector:(selector) => {
      if (selector === ".top-row") return topRow;
      if (selector === ".brand") return brand;
      if (selector === ".remote-canvas-status") return flatten(topRow).find((el) => el.className === "remote-canvas-status") || null;
      return null;
    },
    querySelectorAll:(selector) => [".canvas-widget:not(.widget-offscreen) .canvas-widget-frame", ".canvas-widget .canvas-widget-frame"].includes(selector) ? widgetFrames : [],
    getElementById:() => null,
  };
  const redirects = [];
  const replacements = [];
  const routeUpdates = [];
  const location = {
    pathname,
    origin:"https://cloud.penecho.test",
    href:`https://cloud.penecho.test${pathname}`,
    assign(url) { redirects.push(url); },
    replace(url) { replacements.push(url); },
  };
  const opened = [];
  const taken = [];
  const saveEchoCalls = [];
  const windowObject = {
    history:{ state:null, replaceState(state, title, url) { routeUpdates.push(url); location.pathname = url; } },
    PENECHO_CONFIG:{ runtime:"cloud", remoteCanvasNativeReads:nativeReads },
    PenEchoCloudProjects:{
      openCanvas:openCanvas || (async (id) => { opened.push(id); }),
      saveEcho:async (name) => {
        saveEchoCalls.push(name);
        return saveEcho ? saveEcho(name) : SAVED_CANVAS_ID;
      },
      currentCanvasId:typeof currentCanvasId === "function" ? currentCanvasId : () => currentCanvasId || null,
    },
    PenEchoCommunityUI:{ takeFurther:takeFurther || (async (id) => { taken.push(id); }) },
  };
  const windowListeners = new Map();
  windowObject.addEventListener = (type, handler) => {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set());
    windowListeners.get(type).add(handler);
  };
  windowObject.requestAnimationFrame = (callback) => setImmediate(() => callback(Date.now()));
  windowObject.dispatchEvent = (event) => {
    for (const handler of windowListeners.get(event.type) || []) handler(event);
    return true;
  };
  windowObject.dispatchMessage = (data, source, origin = location.origin) => {
    for (const handler of windowListeners.get("message") || []) handler({ data, source, origin });
  };
  const fetchCalls = [];
  windowObject.fetch = async (url, options = {}) => {
    fetchCalls.push({ url:String(url), options });
    if (String(url).startsWith("/api/v1/remote-canvas/status")) {
      const outcome = respond ? await respond() : { device:null };
      if (outcome instanceof Error) throw outcome;
      return { ok:true, status:200, json:async () => outcome };
    }
    return fetchResponse ? fetchResponse(String(url), options) : { ok:true, status:200, json:async () => ({}) };
  };
  const context = {
    window:windowObject, document, location, navigator:{ language },
    URL, URLSearchParams, Headers, Request, Response, CustomEvent, crypto:webcrypto, Date, console, AbortController, setTimeout:statusTimeout || setTimeout, clearTimeout,
  };
  vm.runInNewContext(gateScript, context, { filename:"public/remote-canvas.js" });
  const gate = document.body.children[0];
  return { gate, brand, window:windowObject, redirects, replacements, routeUpdates, fetchCalls, opened, taken, saveEchoCalls,
    back:topRow.children[0],
    title:flatten(gate).find((el) => el.id === "remoteCanvasTitle"),
    detail:flatten(gate).find((el) => el.className === "remote-canvas-detail"),
    actions:flatten(gate).filter((el) => el.dataset.action) };
}

async function flush(rounds = 8) {
  for (let index = 0; index < rounds; index++) await new Promise((resolve) => setImmediate(resolve));
}

test("share auto-fill uses the selected hosted model without waiting for any linked device", async () => {
  for (const nativeReads of [false, true]) {
    let finishStatus;
    const pending = new Promise(resolve => { finishStatus = resolve; });
    const metadata = { name:"Cloud Craft", description:"Cloud generated description", category:"education", tags:[] };
    const run = boot({ nativeReads, respond:() => pending, fetchResponse:async () => new Response(JSON.stringify({ metadata })) });
    for (const kind of ["widget", "canvas"]) {
      const body = JSON.stringify({ kind, preview:{ contentType:"image/webp", dataBase64:"preview" }, reasoningEffort:"high" });
      const response = await run.window.fetch("/api/community/metadata", { method:"POST", headers:{ "x-penecho-connection":`hosted:${HOSTED_MODEL_ID}` }, body });
      const call = run.fetchCalls.at(-1);
      assert.equal(call.url, "/api/community/metadata");
      assert.equal(call.options.headers.get("x-penecho-connection"), `hosted:${HOSTED_MODEL_ID}`);
      assert.equal(call.options.body, body);
      assert.deepEqual((await response.json()).metadata, metadata);
      assert.equal(run.fetchCalls.some(call => call.url.startsWith("/api/v1/remote-canvas/http")), false);
    }
    finishStatus({ device:null });
    await flush();
  }
});

test("share auto-fill preserves an explicit local connection and its pinned host in both Cloud modes", async () => {
  for (const nativeReads of [false, true]) {
    const run = boot({ nativeReads, respond:() => ({ device:{ id:SAVED_CANVAS_ID, online:true, ready:true, capabilities:{ canvasAgent:true } } }) });
    await flush();
    await run.window.fetch("/api/community/metadata", { method:"POST", headers:{ "x-penecho-connection":CURRENT_CANVAS_ID }, body:'{"kind":"canvas"}' });
    const call = run.fetchCalls.at(-1), url = new URL(call.url, "https://cloud.penecho.test");
    assert.equal(url.pathname, "/api/v1/remote-canvas/http");
    assert.equal(url.searchParams.get("path"), "/api/community/metadata");
    assert.equal(url.searchParams.get("deviceId"), SAVED_CANVAS_ID);
    assert.equal(call.options.headers.get("x-penecho-connection"), CURRENT_CANVAS_ID);
  }
});

test("local share auto-fill never switches to Cloud when its device is absent or offline", async () => {
  for (const nativeReads of [false, true]) for (const device of [null, { id:SAVED_CANVAS_ID, online:false }]) {
    const run = boot({ nativeReads, respond:() => ({ device }) });
    await flush();
    const response = await run.window.fetch("/api/community/metadata", { method:"POST", headers:{ "x-penecho-connection":CURRENT_CANVAS_ID }, body:'{"kind":"canvas"}' });
    assert.equal(response.status, 409);
    assert.equal(run.fetchCalls.some(call => call.url === "/api/community/metadata" || call.url.startsWith("/api/v1/hosted/")), false);
  }
});

test("local share auto-fill preserves connection errors and never retries with a Cloud model", async () => {
  for (const nativeReads of [false, true]) for (const status of [409, 502, 504]) {
    const error = { error:"CONNECTION_STALE", message:"The selected local connection is unavailable." };
    const run = boot({ nativeReads, respond:() => ({ device:{ id:SAVED_CANVAS_ID, online:true, ready:true, capabilities:{ canvasAgent:true } } }), fetchResponse:async () => new Response(JSON.stringify(error), { status }) });
    await flush();
    const response = await run.window.fetch("/api/community/metadata", { method:"POST", headers:{ "x-penecho-connection":CURRENT_CANVAS_ID }, body:'{"kind":"widget"}' });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), error);
    const calls = run.fetchCalls.filter(call => !call.url.startsWith("/api/v1/remote-canvas/status"));
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.startsWith("/api/v1/remote-canvas/http?"));
    assert.equal(calls[0].options.headers.get("x-penecho-connection"), CURRENT_CANVAS_ID);
  }
});

// The single action the gate can ever reveal, and the states that reveal it.
const actionRevealStates = (action) => {
  const states = [];
  const pattern = new RegExp(`\\.remote-canvas-gate\\[data-state="([a-z]+)"\\] \\.remote-canvas-actions \\[data-action="${action}"\\]`, "g");
  for (const match of gateCss.matchAll(pattern)) states.push(match[1]);
  return states;
};

test("Remote Canvas gate only ever contains a single Link Device action", () => {
  const run = boot();
  assert.equal(run.gate.className, "remote-canvas-gate");
  assert.deepEqual(run.actions.map((el) => el.dataset.action), ["link"]);
  const [link] = run.actions;
  assert.equal(link.tagName, "A");
  assert.equal(link.href, "/dashboard.html#devices");
  assert.equal(link.textContent, "Link Device");
  assert.equal(link.listeners.size, 0);
  assert.doesNotMatch(gateScript, /data-action=["']retry["']/i);
  assert.doesNotMatch(gateScript, /downloads\.html|remote-canvas-flow|innerHTML/);
  assert.doesNotMatch(gateCss, /remote-canvas-flow|data-action="retry"|remote-canvas-actions button/);
});

test("Remote Canvas brand doubles as the way back to the console", () => {
  const project = boot();
  assert.ok(project.brand, "brand element exists in the top row");
  assert.equal(project.brand.getAttribute("role"), "link");
  assert.equal(project.brand.title, "Back to Projects");
  assert.equal(project.brand.getAttribute("aria-label"), "Back to Projects");
  const click = project.brand.listeners.get("click");
  assert.ok(click, "brand is clickable");
  click({ });
  assert.equal(project.redirects[0], "/dashboard.html");

  const community = boot({ pathname:`/canvas/community/${COMMUNITY_ID}` });
  assert.equal(community.brand.title, "Back to Echoes");
  community.brand.listeners.get("click")({ });
  assert.equal(community.redirects[0], "/community.html");

  const zhCommunity = boot({ pathname:`/canvas/community/${COMMUNITY_ID}`, language:"zh-CN" });
  assert.equal(zhCommunity.brand.getAttribute("aria-label"), "返回 Echoes");
  assert.doesNotMatch(gateScript, /remote-canvas-back/);
});

test("Remote Canvas publishes the account and device status without adding a duplicate brand badge", async () => {
  const run = boot({ respond:() => ({ account:{ name:"Remote User" }, device:{ id:SAVED_CANVAS_ID, name:"My PenEcho", platform:"darwin", online:true, ready:true, capabilities:{canvasAgent:true} } }) });
  await flush();
  assert.equal(run.brand.children.some((child) => child.className === "remote-canvas-status"), false);
  assert.equal(run.window.PENECHO_REMOTE_CLOUD_STATUS.accountName, "Remote User");
  assert.equal(run.window.PENECHO_REMOTE_CLOUD_STATUS.deviceOnline, true);
  assert.doesNotMatch(gateCss, /\.remote-canvas-status/);
});

test("Remote Canvas gate reveals Link Device only in the unlinked state and reveals nothing in any other state", () => {
  assert.match(gateCss, /\.remote-canvas-actions\s*\{[^}]*display:\s*none/);
  assert.match(gateCss, /\.remote-canvas-actions a\s*\{[^}]*display:\s*none/);
  assert.deepEqual(actionRevealStates("link"), ["unlinked"]);
  assert.match(gateCss, /\.remote-canvas-gate\[data-state="unlinked"\] \.remote-canvas-actions\s*\{/);
  for (const state of ["checking", "offline", "opening", "error"])
    assert.doesNotMatch(gateCss, new RegExp(`\\.remote-canvas-gate\\[data-state="${state}"\\] \\.remote-canvas-actions`));
});

test("Remote Canvas gate without a linked device shows the unlinked state with Link Device as the only action", async () => {
  const run = boot({ respond:() => ({ device:null }) });
  assert.equal(run.gate.dataset.state, "checking");
  await flush();
  assert.equal(run.gate.dataset.state, "unlinked");
  assert.equal(run.title.textContent, "Connect one PenEcho host to open this Canvas");
  assert.equal(run.detail.textContent, "No device is linked yet. Install PenEcho, then connect one main computer from Link Device.");
  assert.equal(run.gate.hidden, false);
  assert.deepEqual(run.actions.map((el) => el.dataset.action), ["link"]);
});

test("Remote Canvas gate shows no actions while checking and none once a linked device is offline or opening", async () => {
  const offline = boot({ respond:() => ({ device:{ name:"My PenEcho", platform:"darwin 25.3.0", online:false } }) });
  assert.equal(offline.gate.dataset.state, "checking");
  assert.deepEqual(actionRevealStates("link").filter((state) => state === offline.gate.dataset.state), []);
  await flush();
  assert.equal(offline.gate.dataset.state, "offline");
  assert.equal(offline.title.textContent, "Your linked PenEcho host is offline");
  assert.equal(offline.detail.textContent, "My PenEcho · darwin 25.3.0 · Offline");
  assert.equal(offline.gate.hidden, false);
  assert.deepEqual(offline.actions.map((el) => el.dataset.action), ["link"]);
  assert.deepEqual(actionRevealStates("link").filter((state) => state === "offline"), []);

  const online = boot({
    respond:() => ({ device:{ name:"My PenEcho", platform:"darwin 25.3.0", online:true, ready:true, capabilities:{canvasAgent:true} } }),
    widgetFrames:[{ contentWindow:{} }],
  });
  await flush();
  assert.equal(online.gate.dataset.state, "opening");
  assert.deepEqual(actionRevealStates("link").filter((state) => state === "opening"), []);
  assert.deepEqual(online.opened, [CANVAS_ID]);
  assert.deepEqual(online.redirects, [], "Cloud fallback must use the authenticated relay, not invent a LAN URL");
  assert.equal(online.gate.hidden, true);
});

test("Cloud Canvas stays covered until every visible Widget reports rendered content", async () => {
  const firstWindow = {}, secondWindow = {}, run = boot({
    respond:() => ({ device:{ id:SAVED_CANVAS_ID, name:"My PenEcho", platform:"darwin", online:true, ready:true, capabilities:{canvasAgent:true} } }),
    widgetFrames:[{ contentWindow:firstWindow }, { contentWindow:secondWindow }],
    nativeReads:true,
  });
  await flush();
  assert.equal(run.gate.dataset.state, "opening");
  assert.equal(run.gate.hidden, false);

  run.window.dispatchMessage({ type:"penecho-widget-host-ready" }, firstWindow);
  run.window.dispatchMessage({ type:"penecho-widget-host-ready" }, secondWindow);
  await flush();
  assert.equal(run.gate.hidden, false, "an empty Widget host must not reveal the Canvas before its document renders");

  run.window.dispatchMessage({ type:"penecho-widget-capture-ready" }, firstWindow);
  await flush();
  assert.equal(run.gate.hidden, false, "one ready Widget must not reveal a partially loaded Canvas");

  run.window.dispatchMessage({ type:"penecho-widget-capture-ready" }, secondWindow, "https://untrusted.test");
  await flush();
  assert.equal(run.gate.hidden, false, "a cross-origin ready message must be ignored");

  run.window.dispatchMessage({ type:"penecho-widget-capture-ready" }, secondWindow);
  await flush();
  assert.equal(run.gate.hidden, true);
});

test("Remote public Echo uses the linked-host bridge without redirecting to a guessed LAN origin", async () => {
  const run = boot({
    pathname:`/canvas/community/${COMMUNITY_ID}`,
    respond:() => ({ device:{ id:"device-1", name:"My PenEcho", platform:"darwin", online:true, ready:true, capabilities:{canvasAgent:true} } }),
  });
  await flush();
  assert.deepEqual(run.taken, [COMMUNITY_ID]);
  assert.deepEqual(run.opened, []);
  assert.deepEqual(run.redirects, []);
  assert.equal(run.gate.hidden, true);
  assert.doesNotMatch(gateScript, /device\.(?:lan|local)(?:Url|Origin)|192\.168\.|location\.assign\([^)]*device/);
});

test("Remote Canvas gate error state shows the failure title and detail without any action", async () => {
  const run = boot({ respond:() => new Error("relay exploded") });
  await flush();
  assert.equal(run.gate.dataset.state, "error");
  assert.equal(run.title.textContent, "This Canvas could not be opened");
  assert.equal(run.detail.textContent, "relay exploded");
  assert.equal(run.gate.hidden, false);
  assert.deepEqual(run.actions.map((el) => el.dataset.action), ["link"]);
  assert.deepEqual(actionRevealStates("link").filter((state) => state === "error"), []);
  assert.equal(run.fetchCalls.filter((call) => call.url.startsWith("/api/v1/remote-canvas/status")).length, 1);
});

test("Remote Canvas gate keeps the zh copy path", async () => {
  const zh = boot({ language:"zh-CN", respond:() => ({ device:null }) });
  await flush();
  assert.equal(zh.gate.dataset.state, "unlinked");
  assert.equal(zh.title.textContent, "连接 PenEcho 主机后即可打开");
  assert.equal(zh.detail.textContent, "请先连接一台 PenEcho 主机。");
  assert.deepEqual(zh.actions.map((el) => el.textContent), ["连接设备"]);

  const offline = boot({ language:"zh-CN", respond:() => ({ device:{ name:"我的 PenEcho", platform:"macOS", online:false } }) });
  await flush();
  assert.equal(offline.detail.textContent, "我的 PenEcho · macOS · 离线");

  const online = boot({ language:"zh-CN", respond:() => ({ device:{ name:"我的 PenEcho", platform:"macOS", online:true, ready:true, capabilities:{canvasAgent:true} } }) });
  await flush();
  assert.equal(online.detail.textContent, "我的 PenEcho · macOS · 在线");
  assert.match(gateScript, /私人云端画布/);
  assert.match(gateScript, /Private Cloud Canvas/);
});

test("Remote Canvas gate 401 response redirects to auth with returnTo", async () => {
  const document = {
    cookie:"",
    body:new FakeElement("body"),
    createElement:(tag) => new FakeElement(tag),
    querySelector:() => null,
  };
  const redirects = [];
  const location = {
    pathname:`/canvas/${CANVAS_ID}`,
    origin:"https://cloud.penecho.test",
    href:`https://cloud.penecho.test/canvas/${CANVAS_ID}`,
    assign(url) { redirects.push(url); },
  };
  const windowObject = { PENECHO_CONFIG:{ runtime:"cloud" }, addEventListener() {} };
  windowObject.fetch = async () => ({ ok:false, status:401, json:async () => ({}) });
  vm.runInNewContext(gateScript, {
    window:windowObject, document, location, navigator:{ language:"en-US" },
    URL, Headers, Request, crypto:webcrypto, Date, console, setTimeout, clearTimeout,
  }, { filename:"public/remote-canvas.js" });
  await flush();
  assert.deepEqual(redirects, [`/auth.html?returnTo=${encodeURIComponent(`/canvas/${CANVAS_ID}`)}`]);
});

test("Remote Canvas gate keeps the cloud fetch bridge and community take-further flow", async () => {
  const community = boot({ pathname:`/canvas/community/${COMMUNITY_ID}`, respond:() => ({ device:{ name:"Host", platform:"linux", online:true, ready:true, capabilities:{canvasAgent:true} } }) });
  await flush();
  assert.deepEqual(community.taken, [COMMUNITY_ID]);
  assert.equal(community.gate.hidden, true);

  const offline = boot({ respond:() => ({ device:null }) });
  await flush();
  const offlineResponse = await offline.window.fetch("/api/canvases?x=1");
  assert.equal(offlineResponse.ok, false);
  assert.equal(offlineResponse.status, 409);
  assert.equal(offline.fetchCalls.filter((call) => call.url.startsWith("/api/v1/remote-canvas/http")).length, 0);

  const run = boot({ respond:() => ({ device:{ name:"Host", platform:"linux", online:true, ready:true, capabilities:{canvasAgent:true} } }) });
  const response = await run.window.fetch("/api/canvases?x=1");
  assert.equal(response.ok, true);
  const bridged = run.fetchCalls.find((call) => call.url.startsWith("/api/v1/remote-canvas/http"));
  assert.ok(bridged, "expected the same-origin API request to be bridged to the remote host");
  assert.match(bridged.url, /path=%2Fapi%2Fcanvases%3Fx%3D1/);
  const connectionBody = JSON.stringify({ action:"save", id:"default", connection:{ provider:"codex-cli", cliPath:"codex", effort:"medium" } });
  await run.window.fetch("/api/settings/connections", { method:"POST", headers:{ "content-type":"application/json" }, body:connectionBody });
  const connectionBridge = run.fetchCalls.at(-1);
  assert.match(connectionBridge.url, /path=%2Fapi%2Fsettings%2Fconnections/);
  assert.equal(connectionBridge.options.method, "POST");
  assert.equal(connectionBridge.options.body, connectionBody);
  const direct = await run.window.fetch("/api/ai/command", { method:"POST" });
  assert.equal(direct.ok, true);
  assert.equal(run.fetchCalls.at(-1).url, "/api/ai/command");
  await run.window.fetch("/api/plugins");
  assert.match(run.fetchCalls.at(-1).url, /path=%2Fapi%2Fplugins$/, "the default Cloud client keeps the production linked-host plugin protocol");
  await run.window.fetch("/api/plugins?scope=private");
  assert.equal(run.fetchCalls.at(-1).url, "/api/v1/remote-canvas/http?path=%2Fapi%2Fplugins%3Fscope%3Dprivate");

  await run.window.fetch(`/api/cloud/canvases/${CANVAS_ID}`);
  assert.match(run.fetchCalls.at(-1).url, /path=%2Fapi%2Fcloud%2Fcanvases%2F/, "the default Cloud client keeps the production linked-host Canvas protocol");
  await run.window.fetch(`/api/canvases/${CANVAS_ID}`);
  assert.match(run.fetchCalls.at(-1).url, /path=%2Fapi%2Fcanvases%2F/, "Cloud reading a host Canvas remains bridged");
  await run.window.fetch(`/api/cloud/canvases/${CANVAS_ID}/save`, { method:"POST", body:"{}" });
  assert.match(run.fetchCalls.at(-1).url, /path=%2Fapi%2Fcloud%2Fcanvases%2F.*%2Fsave/, "Cloud saves remain host-owned and bridged");
});

test("native Cloud Canvas reads stay behind the explicit runtime flag", async () => {
  const run = boot({
    nativeReads:true,
    respond:() => ({ device:{ name:"Host", platform:"linux", online:true, ready:true, capabilities:{canvasAgent:true} } }),
  });
  await flush();

  await run.window.fetch("/api/plugins");
  assert.equal(run.fetchCalls.at(-1).url, "/api/plugins");
  await run.window.fetch("/api/plugins?scope=private");
  assert.equal(run.fetchCalls.at(-1).url, "/api/plugins?scope=private");
  await run.window.fetch(`/api/cloud/canvases/${CANVAS_ID}`);
  assert.equal(run.fetchCalls.at(-1).url, `/api/cloud/canvases/${CANVAS_ID}`);
  await run.window.fetch("/api/v1/remote-canvas/http?path=%2Fapi%2Fwidget-fetch", {
    method:"POST",
    body:JSON.stringify({ url:"https://data.example.com/feed.json" }),
  });
  assert.equal(run.fetchCalls.at(-1).url, "/api/v1/widget-fetch?url=https%3A%2F%2Fdata.example.com%2Ffeed.json");
  assert.equal(run.fetchCalls.at(-1).options.method, "GET");
});

test("Cloud-native Canvas opens directly even when a linked device is online", async () => {
  const run = boot({
    nativeReads:true,
    respond:() => ({ device:{ name:"Host", platform:"linux", online:true, ready:true, capabilities:{canvasAgent:true} } }),
  });
  await flush();
  assert.equal(run.gate.hidden, true);
  assert.deepEqual(run.opened, [CANVAS_ID]);
  assert.equal(run.window.PENECHO_CONFIG.browserCanvasEditing, true);
  assert.equal(run.fetchCalls.some((call) => call.url.startsWith("/api/v1/remote-canvas/http")), false);
});

test("native community Canvas reads open Echoes without a linked device, while the default path keeps its device gate", async () => {
  for (const result of [{ device:null }, { device:{ name:"Host", platform:"linux", online:false } }]) {
    const run = boot({
      pathname:`/canvas/community/${COMMUNITY_ID}`,
      nativeReads:true,
      respond:() => result,
    });
    await flush();
    assert.equal(run.gate.dataset.state, "opening");
    assert.equal(run.gate.hidden, true);
    assert.equal(run.window.PENECHO_CONFIG.browserCanvasEditing, true);
    assert.deepEqual(run.taken, [COMMUNITY_ID]);
    assert.deepEqual(run.opened, []);
  }

  for (const [result, expectedState] of [
    [{ device:null }, "unlinked"],
    [{ device:{ name:"Host", platform:"linux", online:false } }, "offline"],
  ]) {
    const run = boot({
      pathname:`/canvas/community/${COMMUNITY_ID}`,
      respond:() => result,
    });
    await flush();
    assert.equal(run.gate.dataset.state, expectedState);
    assert.equal(run.gate.hidden, false);
    assert.notEqual(run.window.PENECHO_CONFIG.browserCanvasEditing, true);
    assert.deepEqual(run.taken, []);
    assert.deepEqual(run.opened, []);
  }
});

test("native community Echo saves behind the gate and updates its route without reloading the Canvas", async () => {
  let releaseSave;
  const savePending = new Promise((resolve) => { releaseSave = resolve; });
  const run = boot({
    pathname:`/canvas/community/${COMMUNITY_ID}`,
    nativeReads:true,
    respond:() => ({ device:null }),
    takeFurther:async () => ({ id:COMMUNITY_ID, name:"Echoed Craft" }),
    saveEcho:async (name) => {
      assert.equal(name, "Echoed Craft");
      return savePending;
    },
  });
  await flush();
  assert.deepEqual(run.saveEchoCalls, ["Echoed Craft"]);
  assert.deepEqual(run.replacements, [], "the route must wait for Cloud save completion");
  assert.deepEqual(run.routeUpdates, []);
  assert.equal(run.gate.hidden, false);

  releaseSave(SAVED_CANVAS_ID);
  await flush();
  assert.deepEqual(run.routeUpdates, [`/canvas/${SAVED_CANVAS_ID}`]);
  assert.deepEqual(run.replacements, [], "saving must not reload the document");
  assert.deepEqual(run.opened, [], "the saved document is already loaded");
  assert.equal(run.gate.hidden, true);
});

test("native community Echo keeps the gate visible when Cloud save fails", async () => {
  const run = boot({
    pathname:`/canvas/community/${COMMUNITY_ID}`,
    nativeReads:true,
    respond:() => ({ device:{ name:"Host", platform:"linux", online:false } }),
    takeFurther:async () => ({ id:COMMUNITY_ID, name:"Echoed Craft" }),
    saveEcho:async () => { throw Error("Cloud save unavailable"); },
  });
  await flush();
  assert.deepEqual(run.saveEchoCalls, ["Echoed Craft"]);
  assert.deepEqual(run.replacements, []);
  assert.deepEqual(run.routeUpdates, []);
  assert.equal(run.gate.dataset.state, "error");
  assert.equal(run.gate.hidden, false);
  assert.equal(run.title.textContent, "This Craft could not be continued right now");
  assert.equal(run.detail.textContent, "Cloud save unavailable");
});

test("hosted Cloud commands bind the live current Canvas instead of the deep-link pathname", async () => {
  const run = boot({
    pathname:`/canvas/${CANVAS_ID}`,
    currentCanvasId:() => CURRENT_CANVAS_ID,
    respond:() => ({ device:null }),
    fetchResponse:(url) => ({ ok:true, status:200, json:async () => ({ url }) }),
  });
  const response = await run.window.fetch("/api/ai/command", {
    method:"POST",
    headers:{ "x-penecho-connection":`hosted:${HOSTED_MODEL_ID}` },
    body:JSON.stringify({ action:"inspect" }),
  });
  assert.equal(response.status, 200);
  const fence = run.fetchCalls.find((call) => call.url.includes("/execution-fence"));
  assert.ok(fence);
  assert.equal(fence.url, `/api/v1/hosted/canvases/${CURRENT_CANVAS_ID}/execution-fence`);
  const command = run.fetchCalls.find((call) => call.url === "/api/v1/hosted/commands");
  assert.ok(command);
  assert.deepEqual(JSON.parse(command.options.body), {
    modelId:HOSTED_MODEL_ID,
    canvasId:CURRENT_CANVAS_ID,
    command:{ action:"inspect" },
    executionSessionId:JSON.parse(fence.options.body).executionSessionId,
    executionSessionStartedAt:JSON.parse(fence.options.body).executionSessionStartedAt,
    generation:1,
  });
  assert.notEqual(fence.url, `/api/v1/hosted/canvases/${CANVAS_ID}/execution-fence`);
});

test("hosted Cloud commands stop after the active Canvas changes while the fence is pending", async () => {
  let activeCanvasId = CURRENT_CANVAS_ID, releaseFence;
  const pendingFence = new Promise((resolve) => { releaseFence = resolve; });
  const run = boot({
    currentCanvasId:() => activeCanvasId,
    respond:() => ({ device:null }),
    fetchResponse:(url) => url.includes("/execution-fence")
      ? pendingFence
      : { ok:true, status:200, json:async () => ({}) },
  });
  const request = run.window.fetch("/api/ai/command", {
    method:"POST",
    headers:{ "x-penecho-connection":`hosted:${HOSTED_MODEL_ID}` },
    body:JSON.stringify({ action:"mutate" }),
  });
  await flush();
  assert.equal(run.fetchCalls.filter((call) => call.url.includes("/execution-fence")).length, 1);
  assert.equal(run.fetchCalls.filter((call) => call.url === "/api/v1/hosted/commands").length, 0);
  activeCanvasId = SWITCHED_CANVAS_ID;
  releaseFence({ ok:true, status:200 });
  const response = await request;
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error:"cloud_canvas_changed",
    message:"The active Canvas changed. Retry on the current Canvas.",
  });
  assert.equal(run.fetchCalls.filter((call) => call.url === "/api/v1/hosted/commands").length, 0);
});

test("hosted Cloud commands run for unsaved Canvas without saving content", async () => {
  const draftId=SWITCHED_CANVAS_ID;
  const run = boot({ fetchResponse:(url) => ({ok:true,status:200,json:async()=>url === "/api/v1/hosted/draft-scopes" ? {canvasId:CANVAS_ID} : {}}) });
  run.window.PenEchoCloudProjects={currentExecutionScope:()=>({canvasId:draftId,draft:true})};
  const response = await run.window.fetch("/api/ai/command", {
    method:"POST", headers:{ "x-penecho-connection":`hosted:${HOSTED_MODEL_ID}` },
    body:JSON.stringify({ action:"inspect" }),
  });
  assert.equal(response.status,200);
  const command=run.fetchCalls.find(call=>call.url==="/api/v1/hosted/commands");
  assert.equal(JSON.parse(command.options.body).canvasId,CANVAS_ID);
  assert.equal(run.fetchCalls.filter(call=>call.url===`/api/v1/hosted/canvases/${CANVAS_ID}/execution-fence`).length,1);
  assert.equal(run.fetchCalls.some(call=>/\/api\/v1\/canvases/.test(call.url)),false);
});

test("desktop runtime keeps its existing direct Cloud sync path", async () => {
  const calls = [], windowObject = {
    PENECHO_CONFIG:{ runtime:"local" },
    fetch:async (url) => { calls.push(String(url)); return { ok:true, status:200 }; },
  };
  vm.runInNewContext(gateScript, {
    window:windowObject,
    location:{ pathname:`/canvas/${CANVAS_ID}` },
  }, { filename:"public/remote-canvas.js" });
  await windowObject.fetch(`/api/cloud/canvases/${CANVAS_ID}`);
  assert.deepEqual(calls, [`/api/cloud/canvases/${CANVAS_ID}`]);
});

test("opt-in browser editing opens stored Canvas without a device and keeps host capabilities unavailable", async () => {
  const run = boot({nativeReads:true,respond:()=>({device:null})});
  await flush();
  assert.equal(run.gate.hidden,true);
  assert.deepEqual(run.opened,[CANVAS_ID]);
  assert.equal(run.window.PENECHO_CONFIG.browserCanvasEditing,true);
  assert.equal(run.window.PENECHO_CONFIG.canvasAgent,false);
  const settings = await run.window.fetch("/api/settings");
  assert.deepEqual((await settings.json()).connections,[]);
  const forbidden = await run.window.fetch("/api/canvas-agent/files");
  assert.equal(forbidden.status,409);
  assert.equal((await forbidden.json()).error,"linked_device_required");
  await run.window.fetch("/api/widget-fetch?url=https%3A%2F%2Fexample.test%2Fdata");
  assert.equal(run.fetchCalls.at(-1).url,"/api/v1/widget-fetch?url=https%3A%2F%2Fexample.test%2Fdata");
});

test("browser-only Canvas library and MCP requests report the linked-device state", async () => {
  for (const [status, expectedCode, result] of [
    ["unlinked", "linked_device_required", { device:null }],
    ["offline", "device_offline", { device:{ name:"Host", platform:"linux", online:false } }],
  ]) {
    const run = boot({ nativeReads:true, respond:() => result });
    await flush();
    assert.equal(run.gate.dataset.state, "opening", `${status} browser editing should open the stored Canvas`);

    for (const endpoint of ["/api/canvases", "/api/canvas-projects", "/api/mcp/status"]) {
      const response = await run.window.fetch(endpoint);
      assert.equal(response.status, 409, `${status} ${endpoint} should be blocked`);
      assert.equal(response.ok, false, `${status} ${endpoint} should not look successful`);
      const payload = await response.json();
      assert.equal(payload.error, expectedCode, `${status} ${endpoint} error`);
      assert.equal(payload.code, expectedCode, `${status} ${endpoint} code`);
    }
  }
});

test("Remote Canvas fetch wrapper preserves the Canvas base URL on nested community routes", async () => {
  const run = boot({
    pathname:`/canvas/community/${COMMUNITY_ID}`,
    respond:() => ({ device:{ name:"Host", platform:"linux", online:true, ready:true, capabilities:{canvasAgent:true} } }),
  });
  await flush();

  await run.window.fetch("plugins/weather/plugin.md?v=abc123");
  assert.equal(run.fetchCalls.at(-1).url, "/canvas/plugins/weather/plugin.md?v=abc123");
  assert.doesNotMatch(run.fetchCalls.at(-1).url, /^\/canvas\/community\/plugins\//);

  await run.window.fetch(new URL("plugins/stocks/plugin.md", "https://cloud.penecho.test/canvas/"));
  assert.equal(run.fetchCalls.at(-1).url, "/canvas/plugins/stocks/plugin.md");

  await run.window.fetch(new Request("https://cloud.penecho.test/canvas/plugins/flowchart/plugin.md"));
  assert.equal(run.fetchCalls.at(-1).url, "/canvas/plugins/flowchart/plugin.md");

  await run.window.fetch("plugins/private/air-quality/plugin.md");
  assert.equal(run.fetchCalls.at(-1).url, "/api/v1/remote-canvas/http?path=%2Fplugins%2Fprivate%2Fair-quality%2Fplugin.md");

  await run.window.fetch("plugins/private/air-quality/styles.css");
  assert.equal(run.fetchCalls.at(-1).url, "/api/v1/remote-canvas/http?path=%2Fplugins%2Fprivate%2Fair-quality%2Fstyles.css");
});

test("Remote Canvas gate stays compact, accessible and mobile-friendly", () => {
  assert.match(gateScript, /gate\.setAttribute\("role", "status"\)/);
  assert.match(gateScript, /gate\.setAttribute\("aria-live", "polite"\)/);
  assert.match(gateScript, /card\.setAttribute\("aria-labelledby", "remoteCanvasTitle"\)/);
  assert.match(gateCss, /\.remote-canvas-card\s*\{[^}]*max-width:\s*480px/);
  assert.match(gateCss, /\.remote-canvas-card h2\s*\{[^}]*font-size:\s*17px[^}]*font-weight:\s*600[^}]*letter-spacing:\s*normal/);
  assert.match(gateCss, /\.remote-canvas-actions a\s*\{[^}]*min-height:\s*36px/);
  assert.match(gateCss, /@media \(pointer: coarse\)\s*\{[^}]*\.remote-canvas-actions a\s*\{\s*min-height:\s*44px/);
  assert.doesNotMatch(gateCss, /font-size:\s*clamp|letter-spacing:\s*-/);
  assert.match(gateCss, /@media \(max-width: 720px\)/);
  assert.match(gateCss, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.remote-canvas-gate\s*\{[^}]*backdrop-filter:\s*none/);
});

test("fresh account status restores a hosted Agent capability missing from cached boot config",async()=>{
  const run=boot({nativeReads:true,respond:()=>({device:null,account:{name:'UAT user',credits:995.3},capabilities:{hostedCanvasAgent:true}})});
  await flush();
  assert.equal(run.window.PENECHO_CONFIG.hostedCanvasAgent,true);
  assert.equal(run.window.PENECHO_CONFIG.canvasAgent,false);
  assert.equal(run.window.PENECHO_REMOTE_CLOUD_STATUS.credits,995.3);
  assert.equal(run.gate.hidden,true);
  assert.deepEqual(run.opened,[CANVAS_ID]);
});

for (const mode of ["online", "offline", "absent", "denied"]) {
  test(`Legacy Widget parent public fetch uses authoritative pinned device: ${mode}`, async () => {
    const replies = [], deviceId = "123e4567-e89b-42d3-a456-426614174001";
    const source = { postMessage:(message, origin) => replies.push({ message, origin }) };
    const frame = { contentWindow:source, src:"https://cloud.penecho.test/canvas/widget-host.html?remote-canvas=1" };
    const run = boot({ nativeReads:false, widgetFrames:[frame],
      respond:() => ({ device:mode === "absent" ? null : { id:deviceId, online:mode !== "offline", name:"Pinned host", platform:"mac" } }),
      fetchResponse:(url) => url.startsWith("/api/v1/remote-canvas/http") && ["offline", "denied"].includes(mode)
        ? Response.json({ error:mode === "offline" ? "device_offline" : "forbidden" }, { status:mode === "offline" ? 409 : 403 })
        : new Response("public bytes", { headers:{ "content-type":"text/plain", "x-penecho-upstream-status":"201" } }),
    });
    await flush();
    run.window.dispatchMessage({ type:"penecho-widget-capture-ready" }, source);
    run.window.dispatchMessage({ type:"penecho-widget-host-public-fetch", requestId:"widget-fetch-1", url:"https://example.org/data?a=b" }, source);
    await flush();
    const calls = run.fetchCalls.filter(call => !call.url.startsWith("/api/v1/remote-canvas/status"));
    assert.equal(calls.length, mode === "offline" ? 2 : 1);
    const first = new URL(calls[0].url, "https://cloud.penecho.test");
    assert.equal(first.pathname, mode === "absent" ? "/api/v1/widget-fetch" : "/api/v1/remote-canvas/http");
    if (mode !== "absent") {
      assert.equal(first.searchParams.get("deviceId"), deviceId);
      assert.equal(first.searchParams.get("path"), "/api/widget-fetch?url=https%3A%2F%2Fexample.org%2Fdata%3Fa%3Db");
    }
    for (const call of calls) { assert.equal(call.options.method, "GET"); assert.equal(call.options.body, undefined); }
    assert.equal(replies.length, 1);
    assert.equal(replies[0].origin, "https://cloud.penecho.test");
    assert.equal(replies[0].message.status, mode === "denied" ? 403 : 200);
    if (mode !== "denied") assert.equal(new TextDecoder().decode(replies[0].message.body), "public bytes");
  });
}

test("Widget parent refuses foreign origin and unowned frames", async () => {
  const source = { postMessage:() => {} }, run = boot({ nativeReads:true });
  await flush();
  const message = { type:"penecho-widget-host-public-fetch", requestId:"widget-fetch-1", url:"https://example.org/data" };
  run.window.dispatchMessage(message, source);
  run.window.dispatchMessage(message, source, "https://other.test");
  await flush();
  assert.equal(run.fetchCalls.length, 1);
});

test("Cloud-native editing adds pinned device capabilities while retaining Cloud ownership", async () => {
  const deviceId = "123e4567-e89b-42d3-a456-426614174010";
  const run = boot({ nativeReads:true, currentCanvasId:CURRENT_CANVAS_ID,
    respond:() => ({ device:{ id:deviceId, online:true, ready:true, capabilities:{canvasAgent:true} } }),
  });
  await flush();
  assert.equal(run.window.PENECHO_CONFIG.browserCanvasEditing, true);
  assert.equal(run.window.PENECHO_CONFIG.linkedDeviceOnline, true);
  assert.equal(run.window.PENECHO_CONFIG.linkedDeviceLinked, true);
  assert.equal(run.window.PENECHO_CONFIG.canvasAgent, true);
  for (const [endpoint, options] of [
    ["/api/settings", {}], ["/api/settings/connections", {}],
    ["/api/canvases", {}], ["/api/canvas-projects", {}],
    ["/api/settings/connections", { method:"POST", body:'{"action":"save"}' }],
    ["/api/ai/command", { method:"POST", body:'{"action":"inspect"}' }],
    ["/api/plugins/improve", { method:"POST", body:'{"prompt":"Improve"}' }],
  ]) {
    await run.window.fetch(endpoint, options);
    const call = run.fetchCalls.at(-1), url = new URL(call.url, "https://cloud.penecho.test");
    assert.equal(url.pathname, "/api/v1/remote-canvas/http");
    assert.equal(url.searchParams.get("path"), endpoint);
    assert.equal(url.searchParams.get("deviceId"), deviceId);
    assert.equal(call.options.body, options.body);
  }
  for (const [endpoint, options] of [
    [`/api/cloud/canvases/${CANVAS_ID}`, {}],
    [`/api/cloud/canvases/${CANVAS_ID}/save`, { method:"POST", body:"{}" }],
    ["/api/cloud/status", {}], ["/api/plugins", {}], ["/api/plugins?scope=private", {}],
  ]) {
    await run.window.fetch(endpoint, options);
    assert.equal(run.fetchCalls.at(-1).url, endpoint);
  }
  await run.window.fetch("/api/mcp/status");
  assert.equal(run.fetchCalls.at(-1).url, `/api/v1/remote-canvas/mcp/status?deviceId=${deviceId}`);
  await run.window.fetch("/api/v1/remote-canvas/http?path=%2Fapi%2Fsettings&deviceId=other-device");
  assert.equal(new URL(run.fetchCalls.at(-1).url, "https://cloud.penecho.test").searchParams.get("deviceId"), deviceId);
  await run.window.fetch("/api/ai/command", { method:"POST", headers:{ "x-penecho-connection":`hosted:${HOSTED_MODEL_ID}` }, body:"{}" });
  assert.equal(run.fetchCalls.at(-1).url, "/api/v1/hosted/commands");
});

test("Cloud-native host capability requires a valid online pinned device", async () => {
  const deviceId = "123e4567-e89b-42d3-a456-426614174010";
  for (const device of [null, { id:deviceId, online:false }, { id:"", online:true, ready:true, capabilities:{canvasAgent:true} }, { id:"invalid", online:true, ready:true, capabilities:{canvasAgent:true} }]) {
    const run = boot({ nativeReads:true, respond:() => ({ device }) });
    await flush();
    assert.equal(run.window.PENECHO_CONFIG.browserCanvasEditing, true);
    assert.equal(run.window.PENECHO_CONFIG.linkedDeviceLinked, Boolean(device));
    assert.equal(run.window.PENECHO_CONFIG.linkedDeviceOnline, false);
    assert.equal(run.window.PENECHO_CONFIG.canvasAgent, false);
    for (const endpoint of ["/api/canvases", "/api/canvas-projects", "/api/canvas-agent/files", "/api/ai/command", "/api/plugins/improve", "/api/settings/connections"]) {
      const response = await run.window.fetch(endpoint, { method:"POST", body:"{}" });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error, device ? "device_offline" : "linked_device_required");
    }
    assert.equal(run.fetchCalls.some(call => call.url.startsWith("/api/v1/remote-canvas/http")), false);
    await run.window.fetch(`/api/cloud/canvases/${CANVAS_ID}/save`, { method:"POST", body:"{}" });
    assert.equal(run.fetchCalls.at(-1).url, `/api/cloud/canvases/${CANVAS_ID}/save`);
  }
});

test("linked device refresh recovers without reopening and never switches the pinned host", async () => {
  let device = { id:SAVED_CANVAS_ID, online:false };
  const run = boot({ nativeReads:true, respond:() => ({ device }) });
  await flush();
  device = { id:SAVED_CANVAS_ID, online:true, ready:true, capabilities:{canvasAgent:true} };
  const first = run.window.PenEchoLinkedDevice.refresh();
  assert.equal(first, run.window.PenEchoLinkedDevice.refresh(), "concurrent refreshes share one owner");
  await first;
  assert.equal(run.window.PENECHO_CONFIG.canvasAgent, true);
  await run.window.fetch("/api/settings");
  assert.equal(new URL(run.fetchCalls.at(-1).url, "https://cloud.penecho.test").searchParams.get("deviceId"), SAVED_CANVAS_ID);
  device = { id:CURRENT_CANVAS_ID, online:true, ready:true, capabilities:{canvasAgent:true} };
  await run.window.PenEchoLinkedDevice.refresh();
  assert.equal(run.window.PENECHO_CONFIG.linkedDeviceOnline, false);
  assert.equal(run.window.PENECHO_REMOTE_CLOUD_STATUS.deviceId, SAVED_CANVAS_ID);
  assert.equal((await run.window.fetch("/api/canvases")).status, 409);
  device = { id:SAVED_CANVAS_ID, online:true, ready:true, capabilities:{canvasAgent:true} };
  await run.window.PenEchoLinkedDevice.refresh();
  assert.equal(run.window.PENECHO_CONFIG.canvasAgent, true);
  assert.deepEqual(run.opened, [CANVAS_ID]);
});

test("device offline relay errors revoke host capabilities until an explicit refresh", async () => {
  const run = boot({ nativeReads:true, respond:() => ({ device:{ id:SAVED_CANVAS_ID, online:true, ready:true, capabilities:{canvasAgent:true} } }),
    fetchResponse:() => Response.json({ error:"device_offline" }, { status:409 }),
  });
  await flush();
  await run.window.fetch("/api/canvases");
  assert.equal(run.window.PENECHO_CONFIG.linkedDeviceOnline, false);
  assert.equal(run.window.PENECHO_CONFIG.canvasAgent, false);
  const before = run.fetchCalls.length;
  assert.equal((await run.window.fetch("/api/canvases")).status, 409);
  assert.equal(run.fetchCalls.length, before);
  await run.window.PenEchoLinkedDevice.refresh();
  assert.equal(run.window.PENECHO_CONFIG.canvasAgent, true);
});

test("Cloud plugin ownership is unchanged for hosted improvement and catalog mutations", async () => {
  const run = boot({ nativeReads:true, respond:() => ({ device:{ id:SAVED_CANVAS_ID, online:true, ready:true, capabilities:{canvasAgent:true} } }) });
  await flush();
  await run.window.fetch("/api/plugins/improve", { method:"POST", headers:{ "x-penecho-connection":`hosted:${HOSTED_MODEL_ID}` }, body:"{}" });
  assert.equal(run.fetchCalls.at(-1).url, "/api/plugins/improve");
  assert.equal(run.fetchCalls.at(-1).options.headers.get("x-penecho-device"), SAVED_CANVAS_ID);
  await run.window.fetch("/api/plugins", { method:"POST", body:"{}" });
  assert.equal(run.fetchCalls.at(-1).url, "/api/plugins");
});

test("linked device status timeout releases refresh and permits recovery", async () => {
  let hang = false;
  const run = boot({ nativeReads:true,
    respond:() => hang ? new Promise(() => {}) : { device:{ id:SAVED_CANVAS_ID, online:true, ready:true, capabilities:{canvasAgent:true} } },
    statusTimeout:(callback, delay) => setTimeout(callback, delay === 8000 ? 10 : delay),
  });
  await flush();
  hang = true;
  await assert.rejects(run.window.PenEchoLinkedDevice.refresh(), /timed out/);
  assert.equal(run.window.PENECHO_CONFIG.linkedDeviceOnline, false);
  assert.equal(run.fetchCalls.at(-1).options.signal.aborted, true);
  hang = false;
  await run.window.PenEchoLinkedDevice.refresh();
  assert.equal(run.window.PENECHO_CONFIG.linkedDeviceOnline, true);
});


test("Cloud opens and fetches Widget data before device discovery resolves", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const replies = [];
  const source = { postMessage:message => replies.push(message) };
  const frame = { contentWindow:source, src:"https://cloud.penecho.test/canvas/widget-host.html" };
  const run = boot({ nativeReads:true, respond:() => pending, widgetFrames:[frame],
    fetchResponse:() => new Response("public data") });
  const concurrentRefresh = run.window.PenEchoLinkedDevice.refresh();
  await flush();
  assert.deepEqual(run.opened, [CANVAS_ID], "device discovery must not delay document retrieval");
  run.window.dispatchMessage({type:"penecho-widget-host-public-fetch",requestId:"widget-fetch-2",url:"https://example.org/data"},source);
  await flush();
  assert.equal(replies.length,1,"public Widget data must not wait for a device");
  assert.equal(run.fetchCalls.filter(call=>call.url.startsWith("/api/v1/widget-fetch")).length,1);
  run.window.dispatchMessage({type:"penecho-widget-capture-ready"},source);
  await flush();
  assert.equal(run.gate.hidden,true,"ready Cloud content must be revealed while discovery is pending");
  release({device:{id:SAVED_CANVAS_ID,online:true, ready:true, capabilities:{canvasAgent:true}}});
  await concurrentRefresh;
  await flush();
  assert.equal(run.fetchCalls.filter(call=>call.url.startsWith("/api/v1/remote-canvas/status")).length,1,"startup consumers must share device discovery");
  assert.equal(run.window.PENECHO_CONFIG.linkedDeviceOnline,true);
  await run.window.fetch("/api/canvases");
  assert.ok(run.fetchCalls.some(call=>call.url.includes("deviceId="+SAVED_CANVAS_ID)));
  assert.deepEqual(run.opened,[CANVAS_ID],"late capabilities must not reopen the document");
});

test("device discovery failure leaves a successfully opened Cloud document usable",async()=>{
  const run=boot({nativeReads:true,respond:()=>new Error("gateway unavailable")});
  await flush();
  assert.equal(run.gate.hidden,true);
  assert.deepEqual(run.opened,[CANVAS_ID]);
  assert.equal(run.window.PENECHO_CONFIG.browserCanvasEditing,true);
  await run.window.fetch("/api/cloud/library");
  assert.equal(run.fetchCalls.at(-1).url,"/api/cloud/library");
});

 test("healthy Library and Settings reads reuse the pinned device without another status roundtrip", async () => {
  const run=boot({nativeReads:true,respond:()=>({device:{id:SAVED_CANVAS_ID,online:true, ready:true, capabilities:{canvasAgent:true}}})});
  await flush();
  const before=run.fetchCalls.filter(c=>c.url==="/api/v1/remote-canvas/status").length;
  await run.window.PenEchoLinkedDevice.refresh({ifNeeded:true});
  await run.window.PenEchoLinkedDevice.refresh({ifNeeded:true});
  assert.equal(run.fetchCalls.filter(c=>c.url==="/api/v1/remote-canvas/status").length,before);
 });
 test("a linked offline device reports failure instead of a successful empty connection list", async () => {
  const run=boot({nativeReads:true,respond:()=>({device:{id:SAVED_CANVAS_ID,online:false}})});
  await flush();
  const response=await run.window.fetch("/api/settings");
  assert.equal(response.status,409);
  assert.equal((await response.json()).code,"device_offline");
 });

test('online without capabilities acknowledgement does not enable Agent or report Connected', async () => {
  const deviceId='123e4567-e89b-42d3-a456-426614174010';let ready=false;
  const run=boot({nativeReads:true,respond:()=>({accountId:'account-a',device:{id:deviceId,online:true,ready,capabilities:{canvasAgent:true}}})});
  await flush();assert.equal(run.window.PENECHO_CONFIG.canvasAgent,false);assert.equal(run.window.PENECHO_REMOTE_CLOUD_STATUS.deviceReady,false);
  assert.equal(run.window.PENECHO_CONFIG.linkedDeviceId,deviceId);assert.equal(run.window.PENECHO_CONFIG.connectionAccountId,'account-a');
  ready=true;await run.window.PenEchoLinkedDevice.refresh();assert.equal(run.window.PENECHO_CONFIG.canvasAgent,true);assert.equal(run.window.PENECHO_REMOTE_CLOUD_STATUS.deviceReady,true);
  run.window.PenEchoLinkedDevice.invalidate();assert.equal(run.window.PENECHO_CONFIG.linkedDeviceReady,false);assert.equal(run.window.PENECHO_CONFIG.canvasAgent,false);
});


test("draft changed while resolving execution scope never submits an old command",async()=>{
  let release,active=CANVAS_ID;
  const run=boot({fetchResponse:async(url)=>url==="/api/v1/hosted/draft-scopes"
    ? new Promise(resolve=>{release=()=>resolve({ok:true,status:200,json:async()=>({canvasId:SAVED_CANVAS_ID})});})
    : {ok:true,status:200,json:async()=>({})}});
  run.window.PenEchoCloudProjects.currentExecutionScope=()=>({canvasId:active,draft:true});
  const request=run.window.fetch("/api/ai/command",{method:"POST",headers:{"x-penecho-connection":`hosted:${HOSTED_MODEL_ID}`},body:'{}'});
  active=SWITCHED_CANVAS_ID;release();
  const response=await request;assert.equal(response.status,409);
  assert.equal(run.fetchCalls.some(call=>call.url.includes('/execution-fence')||call.url==='/api/v1/hosted/commands'),false);
});
