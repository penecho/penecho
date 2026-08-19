"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const gateScript = fs.readFileSync(path.join(ROOT, "public", "remote-canvas.js"), "utf8");
const gateCss = fs.readFileSync(path.join(ROOT, "public", "remote-canvas.css"), "utf8");

const CANVAS_ID = "123e4567-e89b-12d3-a456-426614174000";
const COMMUNITY_ID = "123e4567-e89b-42d3-a456-426614174000";

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

function boot({ pathname = `/canvas/${CANVAS_ID}`, baseURI = "https://cloud.penecho.test/canvas/", language = "en-US", respond, openCanvas, takeFurther } = {}) {
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
  };
  const redirects = [];
  const location = {
    pathname,
    origin:"https://cloud.penecho.test",
    href:`https://cloud.penecho.test${pathname}`,
    assign(url) { redirects.push(url); },
  };
  const opened = [];
  const taken = [];
  const windowObject = {
    PENECHO_CONFIG:{ runtime:"cloud" },
    PenEchoCloudProjects:{ openCanvas:openCanvas || (async (id) => { opened.push(id); }) },
    PenEchoCommunityUI:{ takeFurther:takeFurther || (async (id) => { taken.push(id); }) },
  };
  const fetchCalls = [];
  windowObject.fetch = async (url, options = {}) => {
    fetchCalls.push({ url:String(url), options });
    if (String(url).startsWith("/api/v1/remote-canvas/status")) {
      const outcome = respond ? respond() : { device:null };
      if (outcome instanceof Error) throw outcome;
      return { ok:true, status:200, json:async () => outcome };
    }
    return { ok:true, status:200, json:async () => ({}) };
  };
  const context = {
    window:windowObject, document, location, navigator:{ language },
    URL, Headers, Request, Date, console, setTimeout, clearTimeout,
  };
  vm.runInNewContext(gateScript, context, { filename:"public/remote-canvas.js" });
  const gate = document.body.children[0];
  return { gate, brand, window:windowObject, redirects, fetchCalls, opened, taken,
    back:topRow.children[0],
    title:flatten(gate).find((el) => el.id === "remoteCanvasTitle"),
    detail:flatten(gate).find((el) => el.className === "remote-canvas-detail"),
    actions:flatten(gate).filter((el) => el.dataset.action) };
}

async function flush(rounds = 8) {
  for (let index = 0; index < rounds; index++) await new Promise((resolve) => setImmediate(resolve));
}

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
  assert.doesNotMatch(gateScript, /retry|Try again|重新连接/i);
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

test("Remote Canvas keeps the connected-device status beside the brand and out of the AI feedback area", async () => {
  const run = boot({ respond:() => ({ device:{ name:"My PenEcho", platform:"darwin", online:true } }) });
  await flush();
  const badge = run.brand.children.find((child) => child.className === "remote-canvas-status");
  assert.ok(badge);
  assert.equal(badge.children[0].textContent, "My PenEcho");
  assert.equal(badge.title, "Protected remote connection: My PenEcho");
  assert.equal(badge.getAttribute("aria-label"), badge.title);
  assert.match(gateCss, /\.remote-canvas-status\s*\{[^}]*max-width:\s*min\(132px, 18vw\)/);
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

  const online = boot({ respond:() => ({ device:{ name:"My PenEcho", platform:"darwin 25.3.0", online:true } }) });
  await flush();
  assert.equal(online.gate.dataset.state, "opening");
  assert.deepEqual(actionRevealStates("link").filter((state) => state === "opening"), []);
  assert.deepEqual(online.opened, [CANVAS_ID]);
  assert.deepEqual(online.redirects, [], "Cloud fallback must use the authenticated relay, not invent a LAN URL");
  assert.equal(online.gate.hidden, true);
});

test("Remote public Echo uses the linked-host bridge without redirecting to a guessed LAN origin", async () => {
  const run = boot({
    pathname:`/canvas/community/${COMMUNITY_ID}`,
    respond:() => ({ device:{ id:"device-1", name:"My PenEcho", platform:"darwin", online:true } }),
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

  const online = boot({ language:"zh-CN", respond:() => ({ device:{ name:"我的 PenEcho", platform:"macOS", online:true } }) });
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
  const windowObject = { PENECHO_CONFIG:{ runtime:"cloud" } };
  windowObject.fetch = async () => ({ ok:false, status:401, json:async () => ({}) });
  vm.runInNewContext(gateScript, {
    window:windowObject, document, location, navigator:{ language:"en-US" },
    URL, Headers, Request, Date, console, setTimeout, clearTimeout,
  }, { filename:"public/remote-canvas.js" });
  await flush();
  assert.deepEqual(redirects, [`/auth.html?returnTo=${encodeURIComponent(`/canvas/${CANVAS_ID}`)}`]);
});

test("Remote Canvas gate keeps the cloud fetch bridge and community take-further flow", async () => {
  const community = boot({ pathname:`/canvas/community/${COMMUNITY_ID}`, respond:() => ({ device:{ name:"Host", platform:"linux", online:true } }) });
  await flush();
  assert.deepEqual(community.taken, [COMMUNITY_ID]);
  assert.equal(community.gate.hidden, true);

  const offline = boot({ respond:() => ({ device:null }) });
  await flush();
  const offlineResponse = await offline.window.fetch("/api/canvases?x=1");
  assert.equal(offlineResponse.ok, false);
  assert.equal(offlineResponse.status, 409);
  assert.equal(offline.fetchCalls.filter((call) => call.url.startsWith("/api/v1/remote-canvas/http")).length, 0);

  const run = boot({ respond:() => ({ device:{ name:"Host", platform:"linux", online:true } }) });
  const response = await run.window.fetch("/api/canvases?x=1");
  assert.equal(response.ok, true);
  const bridged = run.fetchCalls.find((call) => call.url.startsWith("/api/v1/remote-canvas/http"));
  assert.ok(bridged, "expected the same-origin API request to be bridged to the remote host");
  assert.match(bridged.url, /path=%2Fapi%2Fcanvases%3Fx%3D1/);
  const direct = await run.window.fetch("/api/ai/command", { method:"POST" });
  assert.equal(direct.ok, true);
  assert.equal(run.fetchCalls.at(-1).url, "/api/ai/command");
});

test("Remote Canvas fetch wrapper preserves the Canvas base URL on nested community routes", async () => {
  const run = boot({
    pathname:`/canvas/community/${COMMUNITY_ID}`,
    respond:() => ({ device:{ name:"Host", platform:"linux", online:true } }),
  });
  await flush();

  await run.window.fetch("plugins/weather/plugin.md?v=abc123");
  assert.equal(run.fetchCalls.at(-1).url, "/canvas/plugins/weather/plugin.md?v=abc123");
  assert.doesNotMatch(run.fetchCalls.at(-1).url, /^\/canvas\/community\/plugins\//);

  await run.window.fetch(new URL("plugins/stocks/plugin.md", "https://cloud.penecho.test/canvas/"));
  assert.equal(run.fetchCalls.at(-1).url, "/canvas/plugins/stocks/plugin.md");

  await run.window.fetch(new Request("https://cloud.penecho.test/canvas/plugins/flowchart/plugin.md"));
  assert.equal(run.fetchCalls.at(-1).url, "/canvas/plugins/flowchart/plugin.md");
});

test("Remote Canvas gate stays compact, accessible and mobile-friendly", () => {
  assert.match(gateScript, /gate\.setAttribute\("role", "status"\)/);
  assert.match(gateScript, /gate\.setAttribute\("aria-live", "polite"\)/);
  assert.match(gateScript, /card\.setAttribute\("aria-labelledby", "remoteCanvasTitle"\)/);
  assert.match(gateCss, /\.remote-canvas-card\s*\{[^}]*max-width:\s*480px/);
  assert.match(gateCss, /\.remote-canvas-card h2\s*\{[^}]*font-size:\s*20px[^}]*letter-spacing:\s*0/);
  assert.match(gateCss, /\.remote-canvas-actions a\s*\{[^}]*min-height:\s*36px/);
  assert.match(gateCss, /@media \(pointer: coarse\)\s*\{[^}]*\.remote-canvas-actions a\s*\{\s*min-height:\s*44px/);
  assert.doesNotMatch(gateCss, /font-size:\s*clamp|letter-spacing:\s*-/);
  assert.match(gateCss, /@media \(max-width: 720px\)/);
  assert.match(gateCss, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.remote-canvas-gate\s*\{[^}]*backdrop-filter:\s*none/);
});
