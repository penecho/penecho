"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { pathToFileURL } = require("node:url");
const { test, after } = require("node:test");
const { createBrowser } = require("../src/server/browser.js");
const {
  createBrowserEngine, normalizeInput, requestPolicy, publicTarget, staticFile, ChromiumAdapter, saveScreenshot,
} = require("../src/server/project-lines/browser-engine.js");
const { createContextProxy, resolveNetworkDestination, STATIC_ORIGIN } = require("../src/server/project-lines/browser-proxy.js");
const { callBrowser, BROWSER_HELPER_PATH } = require("../src/server/project-lines/browser-call.js");
const { browserPath, isPictureWindow, registerPictureWindow, unregisterPictureWindow } = require("../src/server/project-lines/page-picture.js");
const { PROBE } = require("../src/server/project-lines/prototype-check.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { CodexServer, declined } = require("../src/server/project-lines/codex-server.js");
const { buildInstructions } = require("../src/server/project-lines/service.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-browser-test-")));
const installedBrowser = browserPath();
const closers = [];
let counter = 0, sharedLive = null;
const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
after(async () => {
  for (const close of closers.splice(0).reverse()) await close().catch(() => {});
  fs.rmSync(temp, { recursive:true, force:true });
});
function listen(server) { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); }
function closeServer(server) { return new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); }); }
async function raw(port, { method = "POST", headers = {}, body = "", route = "/api/browser" } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host:"127.0.0.1", port, path:route, method, headers:{ "content-length":Buffer.byteLength(body), ...headers } }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* Raw response. */ }
        resolve({ httpStatus:res.statusCode, status:res.statusCode, text, ...(json ? json : {}) });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}
async function setup({ live = false, discoveryFile = null, engineOptions = {} } = {}) {
  const n = ++counter, stateDirectory = path.join(temp, `state-${n}`), home = path.join(temp, `home-${n}`);
  fs.mkdirSync(stateDirectory, { recursive:true }); fs.mkdirSync(home, { recursive:true });
  const browser = createBrowser({ stateDirectory, home, browserFile:discoveryFile || path.join(home, ".penecho", "browser.json"), engineOptions:{
    idleMs:300, sessionTtlMs:5000,
    ...(live ? {} : { inDesktopAppFn:() => false, browserPathFn:() => null }),
    ...engineOptions,
  } });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (await browser.handle(req, res, url)) return;
    res.writeHead(404); res.end();
  });
  await listen(server);
  const port = server.address().port;
  await browser.announce(port);
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await browser.close(); await closeServer(server); };
  closers.push(close);
  const post = async (body, headers = {}) => raw(port, { headers:{ "content-type":"application/json", "x-penecho-token":browser.token, ...headers }, body:typeof body === "string" ? body : JSON.stringify(body) });
  const get = async (headers = {}) => raw(port, { method:"GET", headers:{ "x-penecho-token":browser.token, ...headers } });
  return { browser, server, port, home, stateDirectory, token:browser.token, file:browser.homeFile, endpointFile:browser.endpointFile, post, get, close };
}
async function live() {
  if (!sharedLive) sharedLive = await setup({ live:true });
  return sharedLive;
}
const requireBrowserTests = process.env.PENECHO_REQUIRE_BROWSER_TESTS === "1";
const liveOptions = installedBrowser || requireBrowserTests ? { timeout:45000 } : { skip:"No direct local Chromium-based browser available here" };

test("HTTP auth, canonical Origin, Host DNS-rebinding guards, identity endpoint and capabilities", async () => {
  const t = await setup();
  assert.equal((await t.get()).httpStatus, 200);
  const noToken = await raw(t.port, { method:"GET" });
  assert.equal(noToken.httpStatus, 401); assert.equal(noToken.code, "BAD_TOKEN");
  const wrong = await raw(t.port, { method:"GET", headers:{ "x-penecho-token":"0".repeat(64) } });
  assert.equal(wrong.httpStatus, 401);
  const ok = await t.get();
  assert.equal(ok.ok, true); assert.equal(ok.available, false);
  assert.deepEqual(ok.stepOps, ["click", "fill", "type", "select", "press", "hover", "scroll", "wait", "navigate", "viewport", "eval"]);
  assert.equal((await t.post("{bad json")).code, "BAD_JSON");
  assert.equal((await t.post({ action:"unknown" })).code, "BAD_ACTION");
  assert.equal((await t.post({ html:"<p>x</p>", unknown:true })).code, "BAD_ARGUMENT");
  assert.equal((await t.post({ html:"<p>x</p>" }, { "content-type":"text/plain" })).code, "BAD_JSON");
  for (const headers of [
    { origin:"https://evil.example" },
    { origin:`https://127.0.0.1:${t.port}` }, // scheme mismatch rejected
    { "sec-fetch-site":"cross-site" },
    { "sec-fetch-site":"same-site" },
  ]) {
    const refused = await t.post({ action:"status" }, headers);
    assert.equal(refused.httpStatus, 403); assert.equal(refused.code, "CROSS_SITE");
  }
  const sameOrigin = await t.post({ action:"status" }, { origin:`http://127.0.0.1:${t.port}` });
  assert.equal(sameOrigin.httpStatus, 200);
  const rebinding = await t.post({ action:"status" }, { host:"evil.example" });
  assert.equal(rebinding.httpStatus, 403); assert.equal(rebinding.code, "LOCAL_ONLY");
  const idRes = await raw(t.port, { method:"GET", route:"/api/browser/identity?nonce=abc123" });
  assert.equal(idRes.httpStatus, 200); assert.equal(idRes.instanceId, t.browser.instanceId); assert.ok(idRes.proof);
  const help = await t.post({ action:"help" });
  assert.equal(help.httpStatus, 200); assert.match(help.usage.curl, /PENECHO_BROWSER_PASS/);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(t.stateDirectory, "browser-token.json")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(t.file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(t.endpointFile).mode & 0o777, 0o600);
  }
  const ep = JSON.parse(fs.readFileSync(t.endpointFile, "utf8"));
  assert.equal(ep.token, undefined, "endpointFile must not contain the global token");
});

test("Work-scoped tokens strictly confine file/dir roots and isolate kept sessions", async () => {
  const t = await setup();
  const allowed = path.join(temp, "scope-allowed"), forbidden = path.join(temp, "scope-forbidden");
  fs.mkdirSync(allowed, { recursive:true }); fs.mkdirSync(forbidden, { recursive:true });
  const okFile = path.join(allowed, "ok.html"), secretFile = path.join(forbidden, "secret.html");
  fs.writeFileSync(okFile, "<p>ok</p>"); fs.writeFileSync(secretFile, "<p>secret</p>");
  const escapeLink = path.join(allowed, "link.html");
  try { fs.symlinkSync(secretFile, escapeLink); } catch { /* Skip symlink assertion if OS disallows. */ }

  const scopedToken = t.browser.issueScope({ roots:[allowed], workId:"proj/line/work-1" });
  const verified = t.browser.verifyToken(scopedToken);
  assert.equal(verified.kind, "scoped");
  assert.equal(t.browser.verifyToken(`${scopedToken}x`), null, "tampered scope token rejected");

  const deniedFile = await t.post({ file:secretFile }, { "x-penecho-token":scopedToken });
  assert.equal(deniedFile.httpStatus, 403); assert.equal(deniedFile.code, "PATH_OUTSIDE_SCOPE");
  const deniedDir = await t.post({ dir:forbidden }, { "x-penecho-token":scopedToken });
  assert.equal(deniedDir.httpStatus, 403); assert.equal(deniedDir.code, "PATH_OUTSIDE_SCOPE");
  if (fs.existsSync(escapeLink)) {
    const deniedLink = await t.post({ file:escapeLink }, { "x-penecho-token":scopedToken });
    assert.equal(deniedLink.httpStatus, 403); assert.equal(deniedLink.code, "PATH_OUTSIDE_SCOPE");
  }
  // Allowed file passes normalization/scope check (fails later only because no browser in non-live setup).
  const allowedAttempt = await t.post({ file:okFile }, { "x-penecho-token":scopedToken });
  assert.notEqual(allowedAttempt.code, "PATH_OUTSIDE_SCOPE");
  assert.equal(allowedAttempt.code, "BROWSER_UNAVAILABLE");

  // Replacing a signed root directory with a symlink later must NOT widen the signed scope.
  const replaceable = path.join(temp, "scope-replaceable"), swappedTarget = path.join(temp, "scope-swapped");
  fs.mkdirSync(replaceable, { recursive:true }); fs.mkdirSync(swappedTarget, { recursive:true });
  fs.writeFileSync(path.join(swappedTarget, "stolen.html"), "<p>stolen</p>");
  const pinnedScope = t.browser.issueScope({ roots:[replaceable], workId:"proj/line/work-swap" });
  fs.rmSync(replaceable, { recursive:true, force:true });
  let swapped = false;
  try { fs.symlinkSync(swappedTarget, replaceable); swapped = true; } catch { /* Skip if OS disallows symlinks. */ }
  if (swapped) {
    const deniedSwap = await t.post({ file:path.join(replaceable, "stolen.html") }, { "x-penecho-token":pinnedScope });
    assert.equal(deniedSwap.httpStatus, 403); assert.equal(deniedSwap.code, "PATH_OUTSIDE_SCOPE");
  }
});

test("discovery verifies live owner identity, ignores non-PenEcho TCP listeners, and withdraws only its owner", async () => {
  const discoveryFile = path.join(temp, "shared", "browser.json");
  const first = await setup({ discoveryFile }), second = await setup({ discoveryFile });
  const announced = await second.browser.announce(second.port);
  assert.equal(announced.written, false);
  assert.equal(JSON.parse(fs.readFileSync(discoveryFile, "utf8")).token, first.token);
  second.browser.withdraw();
  assert.equal(fs.existsSync(discoveryFile), true, "standby never removes owner's discovery file");
  first.browser.withdraw();
  assert.equal(fs.existsSync(discoveryFile), false);

  // A foreign TCP listener sitting on a stale port must NOT block a real PenEcho from taking over.
  const decoy = http.createServer((_req, res) => { res.writeHead(200); res.end("not penecho"); });
  await listen(decoy); closers.push(() => closeServer(decoy));
  fs.mkdirSync(path.dirname(discoveryFile), { recursive:true });
  fs.writeFileSync(discoveryFile, JSON.stringify({ port:decoy.address().port, token:"a".repeat(64), url:`http://127.0.0.1:${decoy.address().port}/api/browser`, instanceId:"stale-id", proofKey:"b".repeat(64), pid:999999 }));
  const takeover = await second.browser.announce(second.port);
  assert.equal(takeover.written, true, "stale/non-PenEcho listener is replaced");
  assert.equal(JSON.parse(fs.readFileSync(discoveryFile, "utf8")).instanceId, second.browser.instanceId);
});

test("SSRF, UNC, blob, and proxy egress policies reject local/private/metadata/nested/unauthenticated destinations", async () => {
  for (const url of ["http://127.0.0.1/", "http://localhost/", "http://127.0.0.2/", "http://0.0.0.0/", "http://169.254.169.254/", "http://10.0.0.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://192.168.1.4/", "http://100.64.0.1/"]) {
    await assert.rejects(publicTarget(url), error => error.status === 403, url);
  }
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "chrome://settings", "edge://settings", "devtools://x", "about:blank", "http://user:pass@example.com/"]) {
    assert.throws(() => normalizeInput({ url }), /HTTP\(S\)|credentials/, url);
  }
  assert.throws(() => normalizeInput({ file:"\\\\server\\share\\x.html" }), /absolute local path/);
  assert.throws(() => normalizeInput({ dir:"//server/share" }), /absolute local path/);

  const external = normalizeInput({ url:"http://example.com/" }), policy = requestPolicy(external);
  for (const url of ["http://127.0.0.1:3000/", "http://169.254.169.254/latest", "file:///etc/passwd", "http://user:pass@example.com/", "blob:blob:http://example.com/1", "blob:null/12345678-1234-1234-1234-123456789abc"]) {
    assert.equal(await policy(url), false, url);
  }

  // Opaque blob:null/... is allowed for file/html opaque origins, while nested blob:blob: is always rejected.
  const htmlPolicy = requestPolicy(normalizeInput({ html:"<p>x</p>" }));
  assert.equal(await htmlPolicy("blob:null/12345678-1234-1234-1234-123456789abc"), true);
  assert.equal(await htmlPolicy("blob:blob:null/12345678-1234-1234-1234-123456789abc"), false);

  // Proxy egress checks: offline rejects everything, loopback rejects plain external HTTP and private LAN.
  assert.equal(await resolveNetworkDestination({ mode:"file", urlString:"http://127.0.0.1:3000/" }), null);
  assert.equal(await resolveNetworkDestination({ mode:"html", host:"127.0.0.1", port:3000, isConnect:true }), null);
  assert.equal(await resolveNetworkDestination({ mode:"loopback", urlString:"http://192.168.1.5/" }), null);
  assert.equal(await resolveNetworkDestination({ mode:"loopback", urlString:"http://example.com/" }), null);
  assert.equal((await resolveNetworkDestination({ mode:"loopback", urlString:"http://127.0.0.1:3889/" }))?.kind, "loopback");

  // Unauthenticated proxy requests (both HTTP and CONNECT) must return 407.
  const root = path.join(temp, "proxy-auth-dir");
  fs.mkdirSync(root, { recursive:true }); fs.writeFileSync(path.join(root, "index.html"), "SECRET_STATIC");
  const proxy = await createContextProxy({ mode:"dir", source:{ root, entry:"index.html" } });
  closers.push(() => proxy.close());
  const unauthHttp = await new Promise(resolve => http.get({ host:"127.0.0.1", port:proxy.port, path:`${STATIC_ORIGIN}/index.html` }, res => { res.resume(); resolve(res.statusCode); }));
  assert.equal(unauthHttp, 407, "unauthenticated local client cannot read static dir via proxy");
  const authHeader = `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`;
  const authHttp = await new Promise(resolve => http.get({ host:"127.0.0.1", port:proxy.port, path:`${STATIC_ORIGIN}/index.html`, headers:{ "proxy-authorization":authHeader } }, res => { let s = ""; res.on("data", d => { s += d; }); res.on("end", () => resolve({ status:res.statusCode, body:s })); }));
  assert.equal(authHttp.status, 200); assert.equal(authHttp.body, "SECRET_STATIC");
});

test("browser proxy reuses keep-alive sockets without accumulating close listeners or MaxListenersExceededWarning", async () => {
  const root = path.join(temp, "proxy-keepalive-dir");
  fs.mkdirSync(root, { recursive:true });
  fs.writeFileSync(path.join(root, "index.html"), "KEEPALIVE_OK");
  const proxy = await createContextProxy({ mode:"dir", source:{ root, entry:"index.html" } });
  closers.push(() => proxy.close());
  const authHeader = `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`;
  const agent = new http.Agent({ keepAlive:true, maxSockets:1 });
  const warnings = [];
  const onWarning = warning => { warnings.push(warning); };
  process.on("warning", onWarning);
  try {
    let reusedCount = 0;
    for (let i = 0; i < 15; i++) {
      const result = await new Promise((resolve, reject) => {
        const req = http.request({
          host:"127.0.0.1",
          port:proxy.port,
          agent,
          method:"GET",
          path:`${STATIC_ORIGIN}/index.html?n=${i}`,
          headers:{ "proxy-authorization":authHeader, connection:"keep-alive" },
        }, res => {
          let body = "";
          res.on("data", chunk => { body += chunk; });
          res.on("end", () => resolve({ status:res.statusCode, body, reused:Boolean(req.reusedSocket) }));
        });
        req.on("error", reject);
        req.end();
      });
      assert.equal(result.status, 200);
      assert.equal(result.body, "KEEPALIVE_OK");
      if (result.reused) reusedCount++;
    }
    assert.ok(reusedCount >= 10, `expected keep-alive socket reuse across requests, got ${reusedCount}`);
    const listenerWarnings = warnings.filter(w => w?.name === "MaxListenersExceededWarning");
    assert.equal(listenerWarnings.length, 0, `unexpected MaxListenersExceededWarning: ${listenerWarnings.map(w => w.message).join("; ")}`);
  } finally {
    process.off("warning", onWarning);
    agent.destroy();
  }
});

test("static path confinement rejects traversal, encoded dots, and symlink escapes at open time", () => {
  const root = path.join(temp, "confinement"), outside = path.join(temp, "outside-secret.txt");
  fs.mkdirSync(root, { recursive:true });
  fs.writeFileSync(path.join(root, "index.html"), "<p>safe</p>");
  fs.writeFileSync(outside, "secret");
  assert.throws(() => staticFile(root, "/../outside-secret.txt"), /outside/);
  assert.throws(() => staticFile(root, "/%2e%2e/outside-secret.txt"), /outside/);
  const link = path.join(root, "escape.txt");
  try { fs.symlinkSync(outside, link); } catch { /* Skip if OS disallows symlinks. */ }
  if (fs.existsSync(link)) assert.throws(() => staticFile(root, "/escape.txt"), /outside|Symlinks/);
});

test("CDP navigate cleans up on Page.navigate failure/errorText without unhandled rejection, and dispose passes sessionId='' before timeoutMs", async () => {
  const unhandled = [];
  const onUnhandled = err => unhandled.push(err);
  process.on("unhandledRejection", onUnhandled);
  try {
    const adapter = new ChromiumAdapter({ stateDirectory:temp, browserPathFn:() => null });
    const calls = [];
    const client = Object.assign(new EventEmitter(), {
      async send(method, params, sessionId, timeoutMs) {
        calls.push({ method, params, sessionId, timeoutMs });
        if (method === "Page.navigate" && params.url === "http://err.invalid/") return { errorText:"net::ERR_NAME_NOT_RESOLVED", frameId:"f1" };
        if (method === "Page.navigate" && params.url === "http://same.invalid/#hash") return { frameId:"f1" }; // no loaderId -> same-document
        return {};
      },
    });
    const context = { pool:{ client, contexts:new Map(), byBrowserContext:new Map(), childSessions:new Map() }, sessionId:"s1", targetId:"t1", browserContextId:"bc1", mainFrameId:"f1", inflight:new Set(), networkAt:0, status:null };
    await assert.rejects(adapter.navigate(context, "http://err.invalid/", "load", 60), /ERR_NAME_NOT_RESOLVED/);
    assert.equal(client.listenerCount("event"), 0, "event listener removed on errorText");
    assert.equal(client.listenerCount("disconnect"), 0, "disconnect listener removed on errorText");
    await sleep(100);
    assert.equal(unhandled.length, 0, "no deferred unhandled rejection from navigation timer");

    // Same-document navigation resolves immediately without waiting for loadEventFired.
    await adapter.navigate(context, "http://same.invalid/#hash", "load", 5000);
    assert.equal(client.listenerCount("event"), 0);

    await adapter.dispose(context);
    const closeCall = calls.find(c => c.method === "Target.closeTarget");
    const disposeCall = calls.find(c => c.method === "Target.disposeBrowserContext");
    assert.equal(closeCall.sessionId, "", "Target.closeTarget must use browser sessionId ''");
    assert.equal(closeCall.timeoutMs, 5000);
    assert.equal(disposeCall.sessionId, "", "Target.disposeBrowserContext must use browser sessionId ''");
    assert.equal(disposeCall.timeoutMs, 5000);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("inline HTML (including >1.5 MiB payload) renders via temp file and blocks HTTP and WebSocket egress", liveOptions, async () => {
  const t = await live();
  let localHits = 0;
  const localSpy = http.createServer((_req, res) => { localHits++; res.end("LEAKED"); });
  localSpy.on("upgrade", (_req, sock) => { localHits++; sock.destroy(); });
  await listen(localSpy); closers.push(() => closeServer(localSpy));
  const spyPort = localSpy.address().port;

  // 1.6 MiB HTML would produce >2.13 MiB base64 data: URL (above Chromium's 2 MiB Mojo URL limit).
  const padding = "<!--" + "x".repeat(1_600_000) + "-->";
  const html = `<!doctype html><title>Large offline</title>${padding}<p id="out">Hello agent</p><script>
    console.error("console bad");
    setTimeout(()=>{throw new Error("page bad")}, 0);
    fetch("http://127.0.0.1:${spyPort}/http-probe").catch(()=>{});
    try { new WebSocket("ws://127.0.0.1:${spyPort}/ws-probe"); } catch {}
  </script>`;
  const result = await t.post({ html, includeHtml:true, layoutCheck:true, settleMs:200 });
  assert.equal(result.httpStatus, 200, result.error);
  assert.equal(result.ok, true);
  assert.equal(result.engine, "chromium-cdp");
  assert.equal(result.title, "Large offline");
  assert.match(result.text, /Hello agent/);
  assert.ok(result.html.length <= 65536, "HTML capped before IPC");
  assert.ok(result.consoleErrors.some(line => line.includes("console bad")));
  assert.ok(result.pageErrors.some(line => line.includes("page bad")));
  assert.equal(localHits, 0, "offline HTML must not reach loopback HTTP or WebSocket servers");
  assert.equal(fs.readFileSync(result.png).subarray(1, 4).toString(), "PNG");
});

test("a local file renders sibling CSS/JS while blocking outside-root file:// reads and external/WebSocket traffic", liveOptions, async () => {
  const t = await live();
  const parent = path.join(temp, "file-confinement-live");
  const dir = path.join(parent, "site");
  fs.mkdirSync(dir, { recursive:true });
  const secretFile = path.join(parent, "outside.txt");
  fs.writeFileSync(secretFile, "TOP_SECRET_OUTSIDE");
  const secretUrl = pathToFileURL(secretFile).href;

  let localHits = 0;
  const spy = http.createServer((_req, res) => { localHits++; res.end("LEAK"); });
  await listen(spy); closers.push(() => closeServer(spy));

  fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><title>File site</title><link rel="stylesheet" href="style.css"><p id="answer">waiting</p><p id="escape">clean</p><iframe id="f" src="${secretUrl}"></iframe><script src="app.js"></script><script>
    fetch("https://example.com/never").catch(()=>{});
    fetch("http://127.0.0.1:${spy.address().port}/never").catch(()=>{});
    try { new WebSocket("ws://127.0.0.1:${spy.address().port}/never"); } catch {}
    fetch(${JSON.stringify(secretUrl)}).then(r=>r.text()).then(t=>{document.getElementById("escape").textContent=t;}).catch(()=>{});
  </script>`);
  fs.writeFileSync(path.join(dir, "style.css"), "#answer{color:rgb(1, 2, 3);font-size:23px}");
  fs.writeFileSync(path.join(dir, "app.js"), "document.querySelector('#answer').textContent='sibling worked'");

  const result = await t.post({ file:path.join(dir, "index.html"), settleMs:250 });
  assert.equal(result.httpStatus, 200, result.error);
  assert.match(result.text, /sibling worked/);
  assert.doesNotMatch(result.text, /TOP_SECRET_OUTSIDE/, "outside-root file:// fetch must be blocked");
  assert.equal(localHits, 0, "file mode must block loopback HTTP and WebSocket egress");
  assert.ok(result.requestFailures.some(item => item.error.includes("BlockedByClient")), JSON.stringify(result.requestFailures));
});

test("a static directory serves ES modules via authenticated proxy and blocks external traffic", liveOptions, async () => {
  const t = await live(), dir = path.join(temp, "static-site");
  fs.mkdirSync(path.join(dir, "assets"), { recursive:true });
  fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><title>Static modules</title><p id="out">loading</p><script type="module" src="/main.js"></script>`);
  fs.writeFileSync(path.join(dir, "main.js"), `import { message } from "./assets/message.js";document.querySelector("#out").textContent=message;`);
  fs.writeFileSync(path.join(dir, "assets", "message.js"), "export const message='module assets worked';");
  const result = await t.post({ dir, waitUntil:"networkidle", settleMs:50 });
  assert.equal(result.httpStatus, 200, result.error);
  assert.match(result.text, /module assets worked/);
  assert.equal(result.url, `${STATIC_ORIGIN}/index.html`);
});

test("loopback apps support fill, click, wait, eval, viewport, screenshot and main-frame HTTP status", liveOptions, async () => {
  const t = await live();
  const app = http.createServer((req, res) => {
    if (req.url === "/frame") { res.writeHead(404, { "content-type":"text/html" }); res.end("<p>missing frame</p>"); return; }
    res.writeHead(200, { "content-type":"text/html; charset=utf-8" });
    res.end(`<!doctype html><title>Interactive</title><input id="name"><button id="go">Go</button><output id="out"></output><iframe src="/frame"></iframe><script>go.onclick=()=>{out.textContent='Hello '+document.querySelector('#name').value}</script>`);
  });
  await listen(app); closers.push(() => closeServer(app));
  const result = await t.post({ url:`http://127.0.0.1:${app.address().port}/`, viewport:"800x600", steps:[
    { op:"fill", selector:"#name", text:"Ada" },
    { op:"click", selector:"#go" },
    { op:"wait", ms:50 },
    { op:"eval", expression:"document.querySelector('#out').textContent" },
    { op:"viewport", width:900, height:700 },
  ], screenshot:{ fullPage:true, includeBase64:true } });
  assert.equal(result.httpStatus, 200, result.error);
  assert.equal(result.status, 200, "iframe 404 must not overwrite main-frame 200 status");
  assert.match(result.text, /Hello Ada/);
  assert.deepEqual(result.viewport, { width:900, height:700 });
  assert.equal(result.steps[3].result, "Hello Ada");
  assert.equal(Buffer.from(result.pngBase64, "base64").subarray(1, 4).toString(), "PNG");
});

test("keepSession preserves state, isolates across scopes, and enforces atomic maxSessions capacity", liveOptions, async () => {
  const t = await setup({ live:true, engineOptions:{ maxSessions:1, maxConcurrent:2, sessionTtlMs:5000 } });
  // Two concurrent keepSession creations with maxSessions=1 must never produce 2 sessions.
  const [a, b] = await Promise.all([
    t.post({ html:"<title>A</title><p>A</p>", keepSession:true, settleMs:150, screenshot:false }),
    t.post({ html:"<title>B</title><p>B</p>", keepSession:true, settleMs:150, screenshot:false }),
  ]);
  const statuses = [a.httpStatus, b.httpStatus].sort();
  assert.deepEqual(statuses, [200, 429], `expected one 200 and one 429, got ${JSON.stringify([a, b])}`);
  const winner = a.httpStatus === 200 ? a : b;
  assert.equal((await t.get()).activeSessions, 1);

  // A different scope cannot read or close the global kept session.
  const otherScope = t.browser.issueScope({ roots:[temp], workId:"other" });
  const crossAccess = await t.post({ sessionId:winner.sessionId, screenshot:false }, { "x-penecho-token":otherScope });
  assert.equal(crossAccess.httpStatus, 404); assert.equal(crossAccess.code, "BAD_SESSION");
  const crossClose = await t.post({ action:"close", sessionId:winner.sessionId }, { "x-penecho-token":otherScope });
  assert.equal(crossClose.closed, false);

  // Follow-up from owner works, then close removes it.
  const followup = await t.post({ sessionId:winner.sessionId, steps:[{ op:"eval", expression:"21*2" }], screenshot:false });
  assert.equal(followup.httpStatus, 200); assert.equal(followup.steps[0].result, 42);
  assert.equal((await t.post({ action:"close", sessionId:winner.sessionId })).closed, true);
  assert.equal((await t.post({ sessionId:winner.sessionId })).httpStatus, 404);
  await t.close();
});

test("layoutCheck auto and true report rendered prototype defects", liveOptions, async () => {
  const t = await live(), html = `<!doctype html><html data-penecho-prototype><title>Defect</title><style>[hidden]{display:block!important}</style><p hidden>Should be hidden</p>`;
  const automatic = await t.post({ html, layoutCheck:"auto", screenshot:false });
  assert.equal(automatic.httpStatus, 200, automatic.error);
  assert.ok(automatic.layoutChecks.some(item => item.kind === "hidden-shown"), JSON.stringify(automatic.layoutChecks));
  const forced = await t.post({ html:html.replace(" data-penecho-prototype", ""), layoutCheck:"true", screenshot:false });
  assert.ok(forced.layoutChecks.some(item => item.kind === "hidden-shown"));
});

test("pooled Chromium idles away, cleans temp profiles, and queued follow-up never expires during active wait", liveOptions, async () => {
  const t = await setup({ live:true, engineOptions:{ idleMs:150, sessionTtlMs:150 } });
  const first = await t.post({ html:"<p>TTL</p>", keepSession:true, screenshot:false });
  assert.ok(first.sessionId);
  const [second, third] = await Promise.all([
    t.post({ sessionId:first.sessionId, steps:[{ op:"wait", ms:220 }, { op:"eval", expression:"10+1" }], screenshot:false }),
    t.post({ sessionId:first.sessionId, steps:[{ op:"eval", expression:"10+2" }], screenshot:false }),
  ]);
  assert.equal(second.httpStatus, 200, second.error); assert.equal(second.steps[1].result, 11);
  assert.equal(third.httpStatus, 200, third.error); assert.equal(third.steps[0].result, 12);
  await t.post({ action:"close", sessionId:first.sessionId });
  await sleep(450);
  assert.equal((await t.get()).pooled, 0, "idle timer closes Chromium");
  await t.close();
  const temporary = path.join(t.stateDirectory, "browser-tmp");
  assert.ok(!fs.existsSync(temporary) || fs.readdirSync(temporary).length === 0, "no throwaway browser profile or html temp dir remains");
});

test("same-session cancel aborts promptly while queued, same-session timeout enforces total budget, and Electron networkidle fails on stuck inflight", liveOptions, async () => {
  const t = await setup({ live:true, engineOptions:{ idleMs:5000, sessionTtlMs:5000, maxQueue:2 } });
  const opened = await t.browser.engine.inspect({ html:"<p>q</p>", keepSession:true, screenshot:false });
  const slow = t.browser.engine.inspect({ sessionId:opened.sessionId, steps:[{ op:"wait", ms:1200 }], screenshot:false });
  const ac = new AbortController();
  const started = Date.now();
  setTimeout(() => ac.abort(), 50);
  const aborted = t.browser.engine.inspect({ sessionId:opened.sessionId, steps:[{ op:"eval", expression:"1+1" }], screenshot:false }, { signal:ac.signal });
  await assert.rejects(aborted, err => err.code === "ABORTED");
  assert.ok(Date.now() - started < 600, `queued cancel should abort promptly, took ${Date.now() - started}ms`);
  const timedOut = t.browser.engine.inspect({ sessionId:opened.sessionId, timeoutMs:1000, steps:[{ op:"eval", expression:"2+2" }], screenshot:false });
  await assert.rejects(timedOut, err => err.code === "TIMEOUT");
  await slow;
  await t.close();

  // Electron networkidle must fail with TIMEOUT when an inflight request never completes.
  const stuckMock = electronMock();
  const stuckEngine = createBrowserEngine({ stateDirectory:path.join(temp, "electron-stuck"), electronModule:stuckMock.electron, inDesktopAppFn:() => true });
  closers.push(() => stuckEngine.close());
  await assert.rejects(
    stuckEngine.inspect({ html:"<p>stuck</p>", waitUntil:"networkidle", timeoutMs:1000, screenshot:false }),
    err => err.code === "TIMEOUT",
  );
  await stuckEngine.close();
});

test("closing Chromium during startup rejects cleanly and removes its throwaway profile", liveOptions, async () => {
  const stateDirectory = path.join(temp, "startup-close");
  const adapter = new ChromiumAdapter({ stateDirectory, browserPathFn:() => installedBrowser });
  closers.push(() => adapter.close());
  const starting = adapter.start();
  const rejected = assert.rejects(starting, /closed|exited|unavailable/i);
  await new Promise(resolve => setImmediate(resolve));
  await adapter.close();
  await rejected;
  assert.equal(adapter.pooled(), 0);
  const temporary = path.join(stateDirectory, "browser-tmp");
  assert.ok(!fs.existsSync(temporary) || fs.readdirSync(temporary).length === 0);
});

function electronMock({ failBlank = false } = {}) {
  const windows = [], sessions = new Map();
  let nextId = 1;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  class Contents extends EventEmitter {
    constructor(id, session) { super(); this.id = id; this.session = session; this.url = ""; this.calls = []; }
    setWindowOpenHandler(handler) { this.openHandler = handler; }
    setAudioMuted(value) { this.muted = value; }
    setWebRTCIPHandlingPolicy(policy) { this.webrtcPolicy = policy; }
    stop() {}
    async loadURL(url) {
      this.calls.push(["loadURL", url]);
      // Run the real registered webRequest.onBeforeRequest interceptor!
      if (this.session.requestHandler) {
        const verdict = await new Promise(resolve => this.session.requestHandler({ webContentsId:this.id, url, id:1 }, resolve));
        if (verdict?.cancel) throw new Error(`Blocked by interceptor: ${url}`);
      }
      if (failBlank && url === "about:blank") throw new Error("Blanking failed");
      this.url = url;
      this.emit("did-navigate", {}, url, url.startsWith("http") ? 201 : 0);
      this.emit("console-message", {}, 2, "legacy console error", 1, "mock");
      this.emit("console-message", { message:"modern console error", level:"error" });
      this.emit("did-fail-load", {}, -3, "Mock blocked load", url, true);
      this.emit("dom-ready");
      this.emit("did-finish-load");
    }
    async executeJavaScript(expression) {
      const source = String(expression); this.calls.push(["eval", source]);
      if (source.startsWith("Array.isArray(window.__penechoBrowserErrors)")) return ["Uncaught mocked page error"];
      if (source === PROBE) return [{ kind:"hidden-shown", where:"p", detail:"mock layout defect" }];
      if (source.startsWith("({url:String(location.href")) {
        return {
          url:this.url, title:"Mock Electron",
          ...(source.includes("innerText") ? { text:"mock text" } : {}),
          ...(source.includes("outerHTML") ? { html:"<html data-penecho-prototype></html>" } : {}),
          prototype:true,
        };
      }
      if (source === "location.href") return this.url;
      if (source.includes("getBoundingClientRect")) return { x:0, y:0, width:100, height:100 };
      if (source.includes("scrollWidth")) return { width:800, height:600 };
      return true;
    }
    async capturePage(rect) { this.calls.push(["capture", rect || null]); return { isEmpty:() => false, toPNG:() => png }; }
    sendInputEvent(event) { this.calls.push(["input", event]); }
  }
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new Contents(nextId++, options.webPreferences.session);
      this.destroyed = false;
      this.size = [options.width, options.height];
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit("closed"); } }
    setContentSize(width, height) { this.size = [width, height]; }
    setSize(width, height) { this.size = [width, height]; }
  }
  function sessionFor(partition) {
    if (sessions.has(partition)) return sessions.get(partition);
    const events = new EventEmitter();
    const session = Object.assign(events, {
      partition,
      proxyConfig:null,
      webRequest:{
        onBeforeRequest(handler) { session.requestHandler = handler; },
        onCompleted(handler) { session.completedHandler = handler; },
        onErrorOccurred(handler) { session.errorHandler = handler; },
      },
      setPermissionRequestHandler(handler) { session.permissionRequest = handler; },
      setPermissionCheckHandler(handler) { session.permissionCheck = handler; },
      async setProxy(cfg) { session.proxyConfig = cfg; },
      async clearStorageData() { session.clears = (session.clears || 0) + 1; },
      async clearCache() { session.cacheClears = (session.cacheClears || 0) + 1; },
    });
    sessions.set(partition, session);
    return session;
  }
  return { windows, sessions, electron:{ app:{ isReady:() => true }, BrowserWindow, session:{ fromPartition:sessionFor } } };
}

test("Electron offscreen adapter isolates concurrent partitions, preserves about:blank during reset, uses keyCode, and enforces proxy/policy", async () => {
  const stateDirectory = path.join(temp, "electron-state"), mock = electronMock();
  const engine = createBrowserEngine({ stateDirectory, electronModule:mock.electron, inDesktopAppFn:() => true, idleMs:10000, maxConcurrent:2, maxSessions:2 });
  closers.push(() => engine.close());

  // Two concurrent non-kept requests must use distinct slot partitions (zero clearStorageData interference).
  const [r1, r2] = await Promise.all([
    engine.inspect({ html:"<p>c1</p>", settleMs:80, includeText:false, includeHtml:false, steps:[{ op:"press", key:"Control+Enter" }] }),
    engine.inspect({ html:"<p>c2</p>", settleMs:80 }),
  ]);
  assert.equal(r1.text, undefined, "disabled text not serialized");
  assert.equal(r1.html, undefined, "disabled html not serialized");
  assert.equal(r2.text, "mock text");
  assert.equal(mock.windows.length, 2);
  const partitions = mock.windows.map(w => w.options.webPreferences.session.partition).sort();
  assert.deepEqual(partitions, ["penecho-browser-slot-0", "penecho-browser-slot-1"]);
  // Verify proper Electron keyCode dispatch.
  const keyEvents = mock.windows[0].webContents.calls.filter(c => c[0] === "input").map(c => c[1]);
  assert.ok(keyEvents.some(e => e.type === "keyDown" && e.keyCode === "Return" && e.modifiers.includes("control")), JSON.stringify(keyEvents));
  // Verify reset loaded about:blank cleanly under interceptor and cleared storage.
  assert.ok(mock.windows[0].webContents.calls.some(c => c[0] === "loadURL" && c[1] === "about:blank"));
  assert.equal(mock.sessions.get("penecho-browser-slot-0").proxyConfig.proxyBypassRules, "<-loopback>");
  assert.equal(mock.windows[0].webContents.webrtcPolicy, "disable_non_proxied_udp");
  assert.equal(isPictureWindow(mock.windows[0]), true);

  // Kept session + failed blanking destroys instead of recycling.
  const kept = await engine.inspect({ url:"http://127.0.0.1:9999/", keepSession:true, layoutCheck:true });
  assert.equal(kept.status, 201, "uses real did-navigate HTTP status");
  assert.equal(kept.layoutChecks[0].kind, "hidden-shown");
  const keptWin = mock.windows[2];
  assert.equal(isPictureWindow(keptWin), true);
  await engine.closeSession(kept.sessionId);
  assert.equal(keptWin.destroyed, true); assert.equal(isPictureWindow(keptWin), false);
  await engine.close();
  assert.equal(mock.windows.every(w => w.destroyed && !isPictureWindow(w)), true);

  // Blanking failure destroys window instead of recycling stale document.
  const failMock = electronMock({ failBlank:true });
  const failEngine = createBrowserEngine({ stateDirectory:path.join(temp, "electron-fail"), electronModule:failMock.electron, inDesktopAppFn:() => true });
  closers.push(() => failEngine.close());
  await failEngine.inspect({ html:"<p>x</p>", screenshot:false });
  assert.equal(failMock.windows[0].destroyed, true, "broken window destroyed instead of pooled");
  assert.equal(failEngine.status().pooled, 0);
  await failEngine.close();
});

test("browser-call verifies server identity on keep-alive socket, recovers same-instance port changes, and refuses foreign listeners", async () => {
  const first = await setup(), oldPort = first.port, oldToken = first.token, discoveryFile = first.file, endpointFile = first.endpointFile;
  const direct = await callBrowser({
    url:`http://127.0.0.1:${oldPort}/api/browser`,
    pass:oldToken,
    endpointFile,
    proofKey:first.browser.proofKey,
    instanceId:first.browser.instanceId,
    allowGlobalDiscovery:false,
    body:{ action:"status" },
    env:{},
  });
  assert.equal(direct.status, 200); assert.equal(direct.json.ok, true);

  // A decoy listener on a dead port with wrong identity must NEVER receive the token.
  let decoySawToken = false;
  const decoy = http.createServer((req, res) => {
    if (req.headers["x-penecho-token"]) decoySawToken = true;
    res.writeHead(200, { "content-type":"application/json" });
    res.end(JSON.stringify({ ok:true, instanceId:"fake", proof:"wrong" }));
  });
  await listen(decoy); closers.push(() => closeServer(decoy));
  await assert.rejects(callBrowser({
    url:`http://127.0.0.1:${decoy.address().port}/api/browser`,
    pass:oldToken,
    proofKey:first.browser.proofKey,
    instanceId:first.browser.instanceId,
    allowGlobalDiscovery:false,
    body:{ action:"status" },
    env:{},
  }), /verify/i);
  assert.equal(decoySawToken, false, "token must never be sent to an unverified listener");

  // Port-change recovery through same-owner discoveryFile (without stale foreign initialPass)
  // and refusal to send credentials when proof metadata is missing.
  await assert.rejects(callBrowser({
    url:`http://127.0.0.1:${oldPort}/api/browser`,
    pass:oldToken,
    allowGlobalDiscovery:false,
    body:{ action:"status" },
    env:{},
  }), /Missing PenEcho browser endpoint identity/i);

  await first.close();
  const second = await setup({ discoveryFile });
  // Discovery-only caller recovers seamlessly to the new running owner.
  const recovered = await callBrowser({ browserFile:discoveryFile, body:{ action:"status" }, env:{} });
  assert.equal(recovered.status, 200, recovered.text); assert.equal(recovered.json.ok, true);
  // Pinned initialPass from a DIFFERENT instance must NOT silently switch to a foreign owner's discovery file.
  await assert.rejects(callBrowser({ url:`http://127.0.0.1:${oldPort}/api/browser`, pass:oldToken, browserFile:discoveryFile, proofKey:first.browser.proofKey, instanceId:first.browser.instanceId, body:{ action:"status" }, env:{} }));

  const { stdout } = await exec(process.execPath, [BROWSER_HELPER_PATH, "--status"], {
    env:{ ...process.env, PENECHO_BROWSER_URL:`http://127.0.0.1:${second.port}/api/browser`, PENECHO_BROWSER_PASS:second.token, PENECHO_BROWSER_FILE:discoveryFile, PENECHO_BROWSER_ENDPOINT:second.endpointFile, PENECHO_BROWSER_PROOF_KEY:second.browser.proofKey, PENECHO_BROWSER_INSTANCE:second.browser.instanceId },
  });
  assert.equal(JSON.parse(stdout).ok, true);
  const { stdout:usage } = await exec(process.execPath, [BROWSER_HELPER_PATH, "--help"]);
  assert.match(usage, /PENECHO_BROWSER_HELPER/);
});

test("Codex server declines all command approvals for both new and resumed Works without auto-approving browser helpers", async () => {
  const { PassThrough } = require("node:stream");
  function fakeCodexChild() {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.sent = [];
    let buf = "";
    child.stdin.on("data", chunk => {
      buf += String(chunk);
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) if (line.trim()) child.sent.push(JSON.parse(line));
    });
    child.kill = () => {};
    return child;
  }

  const approvalCandidates = [
    { method:"item/commandExecution/requestApproval", params:{ command:`node "$PENECHO_BROWSER_HELPER" '{"url":"http://127.0.0.1:3000"}'` }, expect:{ decision:"decline" } },
    { method:"item/commandExecution/requestApproval", params:{ command:["/bin/zsh", "-lc", `node "$PENECHO_BROWSER_HELPER" --status`] }, expect:{ decision:"decline" } },
    { method:"item/commandExecution/requestApproval", params:{ command:["./sh", "-c", `node "$PENECHO_BROWSER_HELPER" --status`] }, expect:{ decision:"decline" } },
    { method:"item/commandExecution/requestApproval", params:{ command:`${process.execPath} "${BROWSER_HELPER_PATH}" --help` }, expect:{ decision:"decline" } },
    { method:"item/commandExecution/requestApproval", params:{ command:[process.execPath, BROWSER_HELPER_PATH, "--status"] }, expect:{ decision:"decline" } },
    { method:"item/commandExecution/requestApproval", params:{ parsedCmd:`node "$PENECHO_BROWSER_HELPER" --status` }, expect:{ decision:"decline" } },
    { method:"execCommandApproval", params:{ command:`node "$PENECHO_BROWSER_HELPER" --status` }, expect:{ decision:"denied" } },
    { method:"execCommandApproval", params:{ command:["/bin/sh", "-c", `node "${BROWSER_HELPER_PATH}" --status`] }, expect:{ decision:"denied" } },
    { method:"item/permissions/requestApproval", params:{ permissions:{ network:true } }, expect:{ permissions:{}, scope:"turn" } },
  ];

  // Test both a freshly spawned CodexServer (new Work) and an attached CodexServer (resumed/reattached Work),
  // even when approvedHelpers is explicitly supplied.
  for (const mode of ["new", "resumed"]) {
    const child = fakeCodexChild();
    const userInputRequests = [];
    const server = mode === "new"
      ? new CodexServer({ command:"codex", args:["app-server"], cwd:temp, spawnFn:() => child, approvedHelpers:[BROWSER_HELPER_PATH], onServerRequest:msg => userInputRequests.push(msg) })
      : new CodexServer({ child, approvedHelpers:[BROWSER_HELPER_PATH], onServerRequest:msg => userInputRequests.push(msg) });
    if (mode === "new") {
      const initReq = child.sent.find(m => m.method === "initialize");
      assert.ok(initReq, "new CodexServer sends initialize");
      child.stdout.write(`${JSON.stringify({ id:initReq.id, result:{} })}\n`);
      await server.ready;
    }
    let reqId = 100;
    for (const item of approvalCandidates) {
      const id = ++reqId;
      child.stdout.write(`${JSON.stringify({ id, method:item.method, params:item.params })}\n`);
      await new Promise(resolve => setImmediate(resolve));
      const reply = child.sent.find(m => m.id === id);
      assert.deepEqual(reply?.result, item.expect, `${mode} Work must decline ${item.method}: ${JSON.stringify(item.params)}`);
      assert.deepEqual(reply?.result, declined(item.method));
    }
    // Interactive user-input requests still reach onServerRequest unaffected.
    child.stdout.write(`${JSON.stringify({ id:999, method:"item/tool/requestUserInput", params:{ questions:[] } })}\n`);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(userInputRequests.length, 1);
    assert.equal(userInputRequests[0].id, 999);
    server.close();
  }

  // Verify service.js does not wire approvedHelpers on new or resumed Codex servers.
  const serviceSource = fs.readFileSync(path.join(__dirname, "../src/server/project-lines/service.js"), "utf8");
  assert.doesNotMatch(serviceSource, /\bapprovedHelpers\b/, "service.js must not configure Codex helper auto-approval");
  assert.doesNotMatch(serviceSource, /sandboxed helper approval/i, "prompt must not claim Codex auto-approves the helper");

  // Verify scoped browser access still works via endpointFile and enforces folder confinement.
  const t = await setup();
  const allowedDir = path.join(temp, "scoped-call-allowed"), deniedDir = path.join(temp, "scoped-call-denied");
  fs.mkdirSync(allowedDir, { recursive:true }); fs.mkdirSync(deniedDir, { recursive:true });
  const allowedHtml = path.join(allowedDir, "ok.html"), deniedHtml = path.join(deniedDir, "secret.html");
  fs.writeFileSync(allowedHtml, "<p>ok</p>"); fs.writeFileSync(deniedHtml, "<p>secret</p>");
  const scopedPass = t.browser.issueScope({ roots:[allowedDir], workId:"proj/line/work-scoped" });
  const statusRes = await callBrowser({
    url:`http://127.0.0.1:${t.port}/api/browser`,
    pass:scopedPass,
    endpointFile:t.endpointFile,
    proofKey:t.browser.proofKey,
    instanceId:t.browser.instanceId,
    allowGlobalDiscovery:false,
    body:{ action:"status" },
    env:{},
  });
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.json?.ok, true);
  const outsideRes = await callBrowser({
    url:`http://127.0.0.1:${t.port}/api/browser`,
    pass:scopedPass,
    endpointFile:t.endpointFile,
    proofKey:t.browser.proofKey,
    instanceId:t.browser.instanceId,
    allowGlobalDiscovery:false,
    body:{ file:deniedHtml },
    env:{},
  });
  assert.equal(outsideRes.status, 403);
  assert.equal(outsideRes.json?.code, "PATH_OUTSIDE_SCOPE");
});

test("prompt routing, scoped built-in runner env, and screenshot retention work as specified", () => {
  const ctx = { project:"Demo", docs:"/docs", code:false, slug:"a", base:"main", topicPath:"lines/a.md", detailPath:"works/a/work-1.md", words:"Fix it", files:[], said:[], note:"", moved:false, continuing:false };
  for (const canvas of [null, { title:"Canvas", file:"/docs/files/a/canvas.penecho.json", name:"canvas", project:"p1", live:false, widgets:[] }]) {
    // One line in every run; the whole of the routing is in .penecho/agent-help.md, read when a check needs it (PE-916).
    const ext = buildInstructions({ ...ctx, agent:"codex", ...(canvas ? { canvas } : {}) }, { kind:"work" });
    assert.match(ext, /Browser: use your own tools as the person asks/);
    assert.match(ext, /headless check they did not ask to do in their own browser, see \/docs\/\.penecho\/agent-help\.md/);
    assert.doesNotMatch(ext, /Never use the person's own Chrome|Do not start a browser/i);
    const help = require("../src/server/project-lines/agent-help.js").text();
    assert.match(help, /opened Chrome, Edge or another browser for you/);
    assert.match(help, /computer use, Playwright or CDP, use your own tools as asked/);
    assert.match(help, /PenEcho does not block it/);
    assert.match(help, /do not disturb their Chrome\/Edge window unasked/);
    assert.match(help, /\$PENECHO_BROWSER_HELPER/);
    assert.match(help, /\$PENECHO_BROWSER_URL/);

    const builtIn = buildInstructions({ ...ctx, agent:"penecho", ...(canvas ? { canvas } : {}) }, { kind:"work" });
    assert.match(builtIn, /native `browser` tool/);
    assert.doesNotMatch(builtIn, /\$PENECHO_BROWSER_PASS/, "built-in runner is not told to use shell creds absent from its bash");
  }

  // Screenshot retention preserves the just-written file even on identical timestamps.
  const shotDir = path.join(temp, "shot-prune");
  const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const last = saveScreenshot(shotDir, pngBytes);
  assert.ok(fs.existsSync(last));

  // Verify built-in runner strips PENECHO_BROWSER_* and disables global discovery.
  const home = path.join(temp, "built-in-home"); fs.mkdirSync(home, { recursive:true });
  const env = { HOME:home, PATH:"", PENECHO_BROWSER_URL:"http://127.0.0.1:1234/api/browser", PENECHO_BROWSER_PASS:"v1.abc.def", PENECHO_BROWSER_ENDPOINT:"/tmp/ep.json", API_KEY:"blank-me" };
  const source = { ready:() => true, open:() => ({ id:"run-1", url:"http://127.0.0.1:9999/", secret:"model-secret" }) };
  const agents = createAgents({ env, paths:{ penecho:source, stateDir:home }, appFolders:[] });
  const command = agents.command("penecho", { workdir:home, docs:home, env });
  assert.equal(command.env.API_KEY, "");
  assert.equal({ ...env, ...command.env }.PENECHO_BROWSER_PASS, "v1.abc.def");
  const runner = fs.readFileSync(path.join(__dirname, "../src/server/project-lines/penecho-runner.mjs"), "utf8");
  assert.match(runner, /\^PENECHO_BROWSER/);
  assert.match(runner, /allowGlobalDiscovery:false/);
  assert.doesNotMatch(/const SHELL_ENV = \[([^\]]+)\]/.exec(runner)[1], /PENECHO_BROWSER/);
});

test("the shared picture-window registry remains backward compatible", () => {
  const fake = {};
  assert.equal(isPictureWindow(fake), false);
  assert.equal(registerPictureWindow(fake), fake);
  assert.equal(isPictureWindow(fake), true);
  unregisterPictureWindow(fake);
  assert.equal(isPictureWindow(fake), false);
});

test("a borrowed browser on Windows stays the process PenEcho started, elevated or not", () => {
  const { browserArgs } = require("../src/server/project-lines/page-picture.js");
  assert.deepEqual(browserArgs("win32"), ["--do-not-de-elevate"]);
  assert.deepEqual(browserArgs("darwin"), []);
});

test("browser help documents Windows PowerShell piping and browser-call strips a UTF-8 BOM from stdin", async () => {
  const stateDir = path.join(temp, "bom-browser");
  const server = createBrowser({ stateDirectory:stateDir, browserFile:path.join(stateDir, "browser.json"), engineOptions:{ browserPathFn:() => null, inDesktopAppFn:() => false } });
  const srv = http.createServer(async (req, res) => {
    if (await server.handle(req, res, new URL(req.url, `http://127.0.0.1:${srv.address().port}`))) return;
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address();
  server.announce(port);
  try {
    const out = await new Promise((resolve, reject) => {
      const child = require("node:child_process").spawn(process.execPath, [BROWSER_HELPER_PATH], {
        env:{ ...process.env, PENECHO_BROWSER_URL:`http://127.0.0.1:${port}/api/browser`, PENECHO_BROWSER_PASS:server.token, PENECHO_BROWSER_PROOF_KEY:server.proofKey, PENECHO_BROWSER_INSTANCE:server.instanceId },
        stdio:["pipe", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", d => { stdout += d; });
      child.stderr.on("data", d => { stderr += d; });
      child.on("error", reject);
      child.on("close", code => resolve({ code, stdout, stderr }));
      child.stdin.end("\uFEFF" + JSON.stringify({ action:"help" }));
    });
    assert.equal(out.code, 0, out.stderr);
    const data = JSON.parse(out.stdout);
    assert.equal(data.ok, true);
    assert.match(data.usage.powershell, /\| node "\$env:PENECHO_BROWSER_HELPER"/);
  } finally {
    await new Promise(resolve => srv.close(resolve));
    await server.close();
  }
});
