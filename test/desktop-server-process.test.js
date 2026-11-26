"use strict";
require("./helpers/safety.js");

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");
const { test, after } = require("node:test");

const { createLink, setActive, active } = require("../src/server/desktop-link.js");
const { createServerProcess, ENTRY } = require("../desktop/server-process.js");
const { attachBrowserHost } = require("../desktop/browser-host.js");
const { applyEnvironment } = require("../desktop/config-environment.js");
const { DesktopAdapter, createBrowserEngine } = require("../src/server/project-lines/browser-engine.js");
const { pagePictureChecked, canRenderPages } = require("../src/server/project-lines/page-picture.js");

const ROOT = path.resolve(__dirname, "..");
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-server-process-")));
const closers = [];
after(async () => { for (const close of closers) await close(); fs.rmSync(temp, { recursive:true, force:true, maxRetries:3 }); });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function waitFor(check, label, ms = 15000) {
  for (const until = Date.now() + ms; Date.now() < until;) { const value = await check(); if (value) return value; await pause(40); }
  throw new Error(`Timed out: ${label}`);
}
// Two links that hear each other the way two processes do: one after the other, as copies.
function linkPair() {
  const ends = [];
  const make = other => createLink({ send:(message, callback) => { const copy = structuredClone(message); setImmediate(() => { ends[other]?.receive(copy); callback?.(null); }); } });
  ends.push(make(1), make(0));
  return ends;
}

test("the link answers requests, passes on errors with their code, hands over cancelling, and ends every wait when it closes", async () => {
  const [window, server] = linkPair();
  let heard = null, aborted = false;
  server.handle("add", ({ a, b }) => a + b);
  server.handle("bytes", () => Buffer.from("png"));
  server.handle("refuse", () => { throw Object.assign(new Error("No."), { code:"SSRF_BLOCKED", status:403, secret:"stays here" }); });
  server.handle("uncarried", () => () => {});
  server.handle("wait", (_params, { signal }) => new Promise(() => signal.addEventListener("abort", () => { aborted = true; })));
  server.handle("told", params => { heard = params; throw new Error("Nobody waits for this."); });
  assert.equal(await window.request("add", { a:20, b:22 }), 42);
  assert.equal(Buffer.from(await window.request("bytes")).toString(), "png");
  await assert.rejects(window.request("refuse"), error => error.code === "SSRF_BLOCKED" && error.status === 403 && error.message === "No." && error.secret === undefined);
  await assert.rejects(window.request("uncarried"), /could not be cloned/);
  await assert.rejects(window.request("nothing"), error => error.code === "UNKNOWN_REQUEST");
  window.notify("told", { on:false });
  await waitFor(() => heard, "notify");
  assert.deepEqual(heard, { on:false });
  const controller = new AbortController(), waiting = window.request("wait", null, { signal:controller.signal });
  setImmediate(() => controller.abort());
  await assert.rejects(waiting, error => error.code === "ABORTED");
  await waitFor(() => aborted, "the other side hears the cancelling");
  // What is not this link's is left alone.
  window.receive(null); window.receive({ type:"other" }); window.receive({ penecho:1, reply:99999, value:1 });
  let closed = 0;
  window.onClose(() => closed++);
  const left = window.request("wait");
  window.close(); window.close();
  await assert.rejects(left, error => error.code === "DESKTOP_LINK_CLOSED");
  await assert.rejects(window.request("add", { a:1, b:1 }), error => error.code === "DESKTOP_LINK_CLOSED");
  assert.equal(closed, 1);
  assert.equal(window.notify("told", {}), false);
});

test("settings without a value take the shell's value away, and the address has defaults", () => {
  const target = { PATH:"/bin", AI_API_KEY:"old", PORT:"" };
  applyEnvironment({ AI_API_KEY:undefined, AI_PROVIDER:"api", EMPTY:null, N:3 }, target);
  assert.deepEqual(target, { PATH:"/bin", AI_PROVIDER:"api", N:"3", HOST:"0.0.0.0", PORT:"3888" });
});

// The real server, in its own process, as the desktop app starts it (here with Node itself instead of Electron run as Node).
function serverEnvironment(name) {
  const state = path.join(temp, name), home = path.join(temp, `${name}-home`);
  fs.mkdirSync(state, { recursive:true }); fs.mkdirSync(home, { recursive:true });
  return { state, launch:{ ...process.env, NODE_ENV:"test", HOME:home, PENECHO_USER_HOME:home },
    settings:{ PENECHO_STATE_DIR:state, HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_KEY:"fixture-key", AI_API_MODEL:"fixture", PENECHO_DESKTOP_APP:"true", PENECHO_TEST_OPEN_ACCESS:"1",
      PENECHO_BROWSER_FILE:path.join(state, "browser.json"), PENECHO_DRAW_FILE:path.join(state, "draw.json") } };
}
function start(name, options = {}) {
  const env = serverEnvironment(name), seen = { up:[], ended:0, failed:[], network:[] };
  const server = createServerProcess({ env:env.launch, settings:() => env.settings, logFile:path.join(env.state, "logs", "desktop-server.log"), restartAfterMs:20,
    attach:link => { link.handle("network-access", ({ on }) => { seen.network.push(on); }); options.attach?.(link); },
    onUp:info => seen.up.push(info), onEnded:() => { seen.ended++; }, onFailed:error => seen.failed.push(error), ...options.process });
  closers.push(() => server.stop());
  return { ...env, server, seen };
}

test("the server runs in its own process: it serves, takes in picked files, tells about network access, and stops when asked", async () => {
  const t = start("serves"), info = await t.server.start();
  const origin = `http://127.0.0.1:${info.port}`, pid = t.server.pid();
  assert.notEqual(pid, process.pid);
  assert.equal(info.host, "127.0.0.1");
  assert.equal(info.networkAccess, true);
  assert.equal(t.seen.up[0].again, false);
  assert.equal(t.server.listening(), true);
  assert.equal((await fetch(`${origin}/projects.html`)).status, 200);
  const post = (route, body) => fetch(origin + route, { method:"POST", headers:{ "content-type":"application/json", origin }, body:JSON.stringify(body) });
  const file = path.join(t.state, "picked.txt");
  fs.writeFileSync(file, "picked");
  const pickerToken = await t.server.request("picker-grant", { selectedPath:file, kind:"file" });
  assert.match(pickerToken, /^picker-/);
  assert.equal((await post("/api/canvas-agent/projects", { kind:"file", path:file, pickerToken })).status, 201, "the server's process keeps the grant");
  assert.equal((await post("/api/canvas-agent/projects", { kind:"file", path:file, pickerToken })).status, 403, "once");
  await assert.rejects(t.server.request("picker-grant", { selectedPath:"relative.txt", kind:"file" }), /absolute file path/);
  assert.equal((await post("/api/local-access/network", { on:false })).status, 200);
  await waitFor(() => t.seen.network.at(-1) === false, "the app hears that network access is off");
  const stopped = t.server.stop();
  assert.equal(t.server.listening(), false, "no window is opened on a server that is closing");
  await stopped;
  assert.equal(alive(pid), false, "stop() waits until the process has gone");
  assert.equal(t.server.running(), false);
  assert.deepEqual([t.seen.ended, t.seen.failed.length], [0, 0], "being stopped is not an end of its own");
  await assert.rejects(fetch(`${origin}/projects.html`));
  await assert.rejects(t.server.request("picker-grant", { selectedPath:file, kind:"file" }), error => error.code === "SERVER_NOT_RUNNING");
  assert.equal(fs.existsSync(path.join(t.state, "servers", `${info.port}.json`)), false, "its record is taken away");
});

test("the API key goes over the channel, not into the environment the process is started with, and agents are not told to run as Node", async () => {
  let spawned = null;
  const t = start("environment", { process:{ spawnImpl:(command, args, options) => { spawned = { command, args, options }; return require("node:child_process").spawn(command, args, options); } } });
  await t.server.start();
  assert.deepEqual(spawned.args, [ENTRY]);
  assert.equal(spawned.options.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(Object.values(spawned.options.env).includes("fixture-key"), false);
  assert.equal(spawned.options.windowsHide, true);
  assert.notEqual(spawned.options.detached, true);
  const entry = fs.readFileSync(ENTRY, "utf8");
  assert.ok(entry.indexOf("delete process.env.ELECTRON_RUN_AS_NODE") < entry.indexOf("require("), "taken away before anything reads it");
  // Only to say the language: what agents get is the person's own.
  if (process.platform !== "win32") assert.match(spawned.options.env.LC_ALL, /^[A-Za-z_]+\.UTF-8$/);
  assert.match(entry, /delete process\.env\.LC_ALL/);
  await t.server.stop();
});

test("a server that dies is started again on the same port; asked to stop from outside, it stays stopped", { skip:process.platform === "win32" && "signals end a Windows process without a trace" }, async () => {
  const t = start("restarts"), first = await t.server.start(), pid = t.server.pid();
  process.kill(pid, "SIGKILL");
  await waitFor(() => t.seen.up.length === 2, "started again");
  assert.equal(t.seen.up[1].again, true);
  assert.equal(t.seen.up[1].port, first.port);
  assert.notEqual(t.server.pid(), pid);
  assert.equal((await fetch(`http://127.0.0.1:${first.port}/projects.html`)).status, 200);
  process.kill(t.server.pid(), "SIGTERM");
  await waitFor(() => t.seen.ended === 1, "ended");
  assert.equal(t.server.running(), false);
  await pause(120);
  assert.equal(t.seen.up.length, 2, "not started again");
  assert.deepEqual(t.seen.failed, []);
});

test("a taken port and a wrong setting are told at once, with nothing left running", async () => {
  const taken = require("node:http").createServer();
  await new Promise(resolve => taken.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise(resolve => taken.close(resolve)));
  const t = start("taken");
  await assert.rejects((Object.assign(t.settings, { PORT:String(taken.address().port) }), t.server.start()), /EADDRINUSE/);
  await waitFor(() => !t.server.running(), "gone");
  const wrong = start("wrong"), began = Date.now();
  await assert.rejects((Object.assign(wrong.settings, { AI_PROVIDER:"codex-cli", AI_TIMEOUT_SECONDS:"5" }), wrong.server.start()), /PenEcho configuration error: AI_TIMEOUT_SECONDS must be/);
  assert.ok(Date.now() - began < 30000, "not only after waiting for it");
  await wrong.server.stop();
});

// A child process that does what it is told, without PenEcho's server.
class FakeChild extends EventEmitter {
  static pid = 700000;
  constructor(behave) { super(); this.pid = ++FakeChild.pid; this.killed = []; this.behave = behave; this.link = createLink({ send:(message, callback) => { setImmediate(() => { this.emit("message", structuredClone(message)); callback?.(null); }); } }); behave?.(this); }
  send(message, callback) { const copy = structuredClone(message); setImmediate(() => { this.link.receive(copy); callback?.(null); }); return true; }
  kill(signal) { this.killed.push(signal); setImmediate(() => this.end(null, signal)); return true; }
  end(code, signal = null) { if (this.ended) return; this.ended = true; this.emit("disconnect"); this.emit("exit", code, signal); }
}
function fakes({ behave = child => child.link.handle("start", () => ({ port:4321, host:"0.0.0.0", networkAccess:true })), ...options } = {}) {
  const children = [], seen = { up:0, ended:0, failed:[] };
  const server = createServerProcess({ spawnImpl:() => { const child = new FakeChild(behave); children.push(child); return child; }, restartAfterMs:1, onUp:() => { seen.up++; }, onEnded:() => { seen.ended++; }, onFailed:error => seen.failed.push(error), ...options });
  return { server, children, seen };
}

test("a server that keeps dying is started again three times a minute at most, and then when asked to", async () => {
  let now = 0;
  const t = fakes({ now:() => now });
  await t.server.start();
  for (let n = 1; n <= 3; n++) { t.children.at(-1).end(null, "SIGSEGV"); await waitFor(() => t.seen.up === n + 1, `restart ${n}`); }
  t.children.at(-1).end(1);
  await waitFor(() => t.seen.failed.length === 1, "given up");
  assert.match(t.seen.failed[0].message, /ended unexpectedly \(code 1\)/);
  await pause(20);
  assert.equal(t.children.length, 4);
  await t.server.again();
  assert.equal(t.seen.up, 5);
  now = 61_000;
  t.children.at(-1).end(134);
  await waitFor(() => t.seen.up === 6, "a minute later it is started again on its own");
});

test("a server started again reads its settings again, on the port it had; asked while it is about to be, it is started once", async () => {
  let key = "first";
  const heard = [];
  const t = fakes({ settings:() => ({ PORT:"0", AI_API_KEY:key }), restartAfterMs:40, behave:child => child.link.handle("start", ({ env }) => { heard.push(env); return { port:4321, host:"0.0.0.0", networkAccess:true }; }) });
  await t.server.start();
  key = "second";
  t.children[0].end(1);
  await t.server.again();
  await pause(80);
  assert.equal(t.children.length, 2);
  assert.deepEqual(heard, [{ PORT:"0", AI_API_KEY:"first" }, { PORT:"4321", AI_API_KEY:"second" }]);
  await assert.rejects(t.server.again(), /cannot be started again/);
});

test("penecho stop and signals end the app with its server; a crash does not", async () => {
  for (const [code, signal] of [[0, null], [143, null], [130, null], [null, "SIGTERM"], [null, "SIGHUP"]]) {
    const t = fakes();
    await t.server.start();
    t.children[0].end(code, signal);
    await waitFor(() => t.seen.ended === 1, `${code} ${signal}`);
    await pause(10);
    assert.equal(t.children.length, 1);
  }
});

test("a server that does not answer is ended: while starting after the time allowed, while stopping too", async () => {
  const slow = fakes({ behave:child => child.link.handle("start", () => new Promise(() => {})), startMs:30 });
  await assert.rejects(slow.server.start(), /did not become ready/);
  assert.deepEqual(slow.children[0].killed, ["SIGKILL"]);
  assert.equal(slow.children.length, 1, "a first start that fails is told, not tried again");
  const stuck = fakes({ stopMs:30 });
  await stuck.server.start();
  await Promise.all([stuck.server.stop(), stuck.server.stop()]);
  assert.deepEqual(stuck.children[0].killed, ["SIGKILL"]);
  await assert.rejects(stuck.server.again(), /cannot be started again/);
  const early = fakes({ behave:child => child.link.handle("start", () => new Promise(() => {})) || child.link.handle("stop", () => { setImmediate(() => child.end(0)); return true; }) });
  const starting = assert.rejects(early.server.start(), /ended while starting/);
  await early.server.stop();
  await starting;
  assert.deepEqual([early.seen.ended, early.seen.failed.length], [0, 0]);
});

test("the server ends by itself when the app has gone, however the app ended, also while it is busy", { timeout:30000 }, async () => {
  const env = serverEnvironment("orphan");
  const parent = path.join(temp, "parent.cjs");
  fs.writeFileSync(parent, `const { createServerProcess } = require(${JSON.stringify(path.join(ROOT, "desktop/server-process.js"))});
let settings = null;
const server = createServerProcess({ env:process.env, settings:() => settings, ...(process.argv[2] ? { entry:process.argv[2] } : {}) });
process.once("message", sent => { settings = sent; server.start().then(info => process.send({ pid:server.pid(), port:info.port }), error => process.send({ error:error.message })); });`);
  const app = fork(parent, { env:env.launch, stdio:"ignore" });
  const info = await new Promise(resolve => { app.once("message", resolve); app.send(env.settings); });
  assert.ok(info.pid, info.error);
  assert.equal(alive(info.pid), true);
  app.kill("SIGKILL");
  await waitFor(() => !alive(info.pid), "the server has gone too");
  if (process.platform === "win32") return;
  // One that never gets back to its own work does not stay behind and keep the port.
  const busy = serverEnvironment("orphan-busy"), entry = path.join(temp, "busy-entry.cjs");
  fs.writeFileSync(entry, `require(${JSON.stringify(ENTRY)}); process.on("SIGUSR2", () => { for (;;); });`);
  const second = fork(parent, [entry], { env:busy.launch, stdio:"ignore" });
  const held = await new Promise(resolve => { second.once("message", resolve); second.send(busy.settings); });
  assert.ok(held.pid, held.error);
  process.kill(held.pid, "SIGUSR2");
  await pause(300);
  second.kill("SIGKILL");
  await waitFor(() => !alive(held.pid), "the busy server has gone too");
});

test("page pictures are asked of the app, and a picture it could not draw is none", async () => {
  const [window, server] = linkPair(), asked = [];
  attachBrowserHost(window, { picture:async (page, size, check) => { asked.push({ page, html:fs.readFileSync(page, "utf8"), size, check }); if (asked.length > 1) throw new Error("No window."); return { png:Buffer.from("png"), checks:check ? [] : null }; } });
  assert.equal(active(), null);
  setActive(server);
  try {
    assert.equal(canRenderPages({}, "linux"), true);
    const drawn = await pagePictureChecked("<p>hi</p>", { width:300, height:200 });
    assert.equal(Buffer.from(drawn.png).toString(), "png");
    assert.deepEqual(drawn.checks, []);
    assert.equal(asked[0].html, "<p>hi</p>", "the page itself: the app measures it without a probe in it");
    assert.deepEqual([asked[0].size, asked[0].check], [{ width:300, height:200 }, true]);
    assert.deepEqual(await pagePictureChecked("<p>again</p>"), { png:null, checks:null });
    await waitFor(() => !fs.existsSync(asked[0].page), "its file is taken away");
  } finally { setActive(null); }
});

// The app's side, with the same shape as ElectronAdapter.
function fakeAdapter() {
  const calls = [];
  return {
    calls, live:new Set(),
    pooled() { return this.pool || 0; },
    async create({ policy, proxy, sessionId, viewport }) { calls.push(["create", proxy, sessionId, viewport]); const context = { policy, events:{ console:[], consoleErrors:[], pageErrors:[], requestFailures:[] }, status:null, viewport }; this.live.add(context); return context; },
    async navigate(context, url, waitUntil, _timeoutMs, signal) {
      calls.push(["navigate", url, waitUntil]);
      if (url.includes("never")) return new Promise((_, reject) => signal.addEventListener("abort", () => { calls.push(["aborted"]); reject(Object.assign(new Error("cancelled"), { code:"ABORTED", status:499 })); }));
      calls.push(["allowed", url, await context.policy(url)], ["outside", await context.policy("file:///etc/passwd")], ["data", await context.policy("data:text/plain,x")]);
      context.status = 201;
      for (let n = 0; n < 150; n++) if (context.events.console.length < 100) context.events.console.push(`log: ${n}`);
    },
    async evaluate(_context, expression) { if (expression.includes("location.href||")) return { url:"http://127.0.0.1:9/", title:"T", text:"words", prototype:false }; if (expression === "location.href") return "http://127.0.0.1:9/"; if (expression === "1+1") return 2; if (expression === "boom") throw Object.assign(new Error("Script failed"), { code:"BAD" }); return expression.includes("__penechoBrowserErrors") ? ["late"] : true; },
    async setViewport(_context, viewport) { calls.push(["viewport", viewport]); },
    async press(_context, key) { calls.push(["press", key]); },
    async capture() { return Buffer.from("\x89PNG picture", "latin1"); },
    async reset(context) { calls.push(["reset"]); this.live.delete(context); this.pool = 1; },
    async dispose(context) { calls.push(["dispose"]); this.live.delete(context); },
    async closePool() { calls.push(["close-pool"]); this.pool = 0; },
    async close() { calls.push(["close"]); this.pool = 0; this.live.clear(); },
  };
}

test("the agents' browser uses the app's windows from the server's process: rules, events, sessions and cancelling come over", async () => {
  const [window, server] = linkPair(), adapter = fakeAdapter();
  attachBrowserHost(window, { createAdapter:() => adapter });
  const engine = createBrowserEngine({ stateDirectory:path.join(temp, "engine"), desktopLink:server });
  closers.push(() => engine.close());
  assert.equal(engine.engine, "electron-offscreen");
  assert.equal(engine.status().available, true);
  const seen = await engine.inspect({ url:"http://127.0.0.1:9/", includeText:true, viewport:"800x600", steps:[{ op:"eval", expression:"1+1" }, { op:"press", key:"Enter" }], screenshot:{ includeBase64:true } });
  assert.equal(seen.ok, true);
  assert.equal(seen.status, 201);
  assert.equal(seen.text, "words");
  assert.equal(seen.steps[0].result, 2);
  assert.equal(seen.console.length, 100);
  assert.deepEqual(seen.pageErrors, ["late"]);
  assert.equal(Buffer.from(seen.pngBase64, "base64").toString("latin1"), "\x89PNG picture");
  assert.deepEqual(adapter.calls.find(c => c[0] === "create")[3], { width:800, height:600 });
  assert.deepEqual(Object.keys(adapter.calls.find(c => c[0] === "create")[1]).sort(), ["password", "port", "proxyBypassList", "proxyServer", "username"]);
  assert.deepEqual(adapter.calls.find(c => c[0] === "allowed"), ["allowed", "http://127.0.0.1:9/", true]);
  assert.deepEqual(adapter.calls.find(c => c[0] === "outside"), ["outside", false], "the server decides what a page may load");
  assert.deepEqual(adapter.calls.find(c => c[0] === "data"), ["data", true]);
  assert.equal(engine.status().pooled, 1);
  assert.equal(adapter.live.size, 0);

  const kept = await engine.inspect({ url:"http://127.0.0.1:9/", keepSession:true, screenshot:false });
  const again = await engine.inspect({ sessionId:kept.sessionId, screenshot:false });
  assert.deepEqual(again.console, [], "each request hears its own events");
  await assert.rejects(engine.inspect({ sessionId:kept.sessionId, steps:[{ op:"eval", expression:"boom" }], screenshot:false }), error => error.message === "Script failed" && error.code === "BAD");
  const next = await engine.inspect({ sessionId:kept.sessionId, steps:[{ op:"navigate", url:"http://127.0.0.1:9/next" }], screenshot:false });
  assert.equal(next.console.length, 100, "and as many as any other");
  await engine.closeSession(kept.sessionId);
  assert.equal(adapter.calls.at(-1)[0], "dispose");

  const controller = new AbortController();
  const never = engine.inspect({ url:"http://127.0.0.1:9/never", screenshot:false }, { signal:controller.signal });
  await waitFor(() => adapter.calls.some(c => c[1] === "http://127.0.0.1:9/never"), "navigating");
  controller.abort();
  await assert.rejects(never, error => error.code === "ABORTED");
  await waitFor(() => adapter.calls.some(c => c[0] === "aborted"), "the app's window hears it");
  await waitFor(() => adapter.live.size === 0, "nothing is left open");

  // The server has gone: the app closes what it had open for it.
  const open = await engine.inspect({ url:"http://127.0.0.1:9/", keepSession:true, screenshot:false });
  assert.ok(open.sessionId);
  window.close(); server.close();
  assert.equal(adapter.calls.at(-1)[0], "close");
  assert.equal(adapter.live.size, 0);
  assert.equal(engine.status().available, false);
  await assert.rejects(engine.inspect({ url:"http://127.0.0.1:9/", screenshot:false }), error => error.code === "DESKTOP_LINK_CLOSED");
});

test("a page the app no longer has is an error, not a wait", async () => {
  const [window, server] = linkPair();
  attachBrowserHost(window, { createAdapter:fakeAdapter });
  const adapter = new DesktopAdapter({ link:server });
  await assert.rejects(adapter.evaluate({ id:99 }, "1"), error => error.code === "BAD_SESSION" && error.status === 404);
  await assert.rejects(server.request("browser", { action:"constructor" }), /Unknown browser request/);
  await adapter.dispose({ id:99 });
});
