"use strict";
// A small, local-only browser service for agents. It borrows the desktop's Chromium or one already
// installed browser; nothing is downloaded and no browser profile belonging to the person is used.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { resolvedPublicFetchTarget } = require("../public-fetch.js");
const {
  STATIC_ORIGIN,
  isNetworkBackedPath,
  isLoopbackAddress,
  staticFile,
  createContextProxy,
} = require("./browser-proxy.js");
const { browserPath, browserArgs, inDesktopApp, registerPictureWindow, unregisterPictureWindow } = (() => {
  const picture = require("./page-picture.js");
  return {
    browserPath:picture.browserPath,
    browserArgs:picture.browserArgs,
    inDesktopApp:picture.inDesktopApp,
    registerPictureWindow:picture.registerPictureWindow,
    unregisterPictureWindow:picture.unregisterPictureWindow,
  };
})();
const { PROBE, clean } = require("./prototype-check.js");
const DesktopLink = require("../desktop-link.js");

const ACTIONS = ["inspect", "close", "status", "help"];
const STEP_OPS = ["click", "fill", "type", "select", "press", "hover", "scroll", "wait", "navigate", "viewport", "eval"];
const INPUT_KEYS = new Set(["action", "url", "file", "html", "dir", "entry", "sessionId", "viewport", "waitUntil", "waitFor", "settleMs", "waitMs", "steps", "screenshot", "includeText", "includeHtml", "layoutCheck", "offline", "allowExternal", "keepSession", "timeoutMs"]);
const SAFE_SCHEMES = new Set(["data:", "about:"]);
const MAX_EVENTS = 100, MAX_FAILURES = 60, MAX_STEPS = 30;
const MAX_TEXT_CHARS = 32768, MAX_HTML_CHARS = 65536;
const MAX_CAPTURE_WIDTH = 4096, MAX_CAPTURE_HEIGHT = 8192, MAX_CAPTURE_PIXELS = 4096 * 4096;
const MAX_SHOT_FILES = 100, MAX_SHOT_BYTES = 50 * 1024 * 1024;
const ERROR_LISTENERS = `(()=>{window.__penechoBrowserErrors=[];addEventListener("error",e=>{window.__penechoBrowserErrors.push(String(e.message||e.error||"Page error").slice(0,2000))});addEventListener("unhandledrejection",e=>{window.__penechoBrowserErrors.push("Unhandled rejection: "+String(e.reason&&e.reason.message||e.reason||"unknown").slice(0,2000))});})();true`;
const READ_ERRORS = "Array.isArray(window.__penechoBrowserErrors)?window.__penechoBrowserErrors.splice(0):[]";

function browserError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
const fail = (code, message, status) => { throw browserError(code, message, status); };
const clamp = (value, low, high, fallback) => Number.isFinite(Number(value)) ? Math.max(low, Math.min(high, Math.round(Number(value)))) : fallback;
const inside = (child, parent) => Boolean(child && parent) && (child === parent || child.startsWith(parent + path.sep));
const hostnameOf = url => String(url.hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
const loopbackUrl = url => isLoopbackAddress(hostnameOf(url));
const real = value => { try { return fs.realpathSync(value); } catch { return ""; } };
const delay = (ms, signal = null) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(browserError("ABORTED", "The browser request was cancelled.", 499)); return; }
  const onAbort = () => { clearTimeout(timer); reject(browserError("ABORTED", "The browser request was cancelled.", 499)); };
  const timer = setTimeout(() => { signal?.removeEventListener?.("abort", onAbort); resolve(); }, Math.max(0, ms));
  timer.unref?.();
  signal?.addEventListener?.("abort", onAbort, { once:true });
});
function clipText(value, bytes) {
  if (value === undefined || value === null) return "";
  return Buffer.from(String(value), "utf8").subarray(0, bytes).toString("utf8");
}
function pushBounded(list, value, limit = MAX_EVENTS) { if (list.length < limit) list.push(value); }
function printable(value) {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  try { return JSON.stringify(value); } catch { return String(value); }
}
async function withTimeout(promise, ms, message = "The browser operation timed out.", signal = null) {
  if (signal?.aborted) throw browserError("ABORTED", "The browser request was cancelled.", 499);
  let timer, onAbort;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(browserError("TIMEOUT", message, 504)), Math.max(1, ms));
        timer.unref?.();
        if (signal) {
          onAbort = () => reject(browserError("ABORTED", "The browser request was cancelled.", 499));
          signal.addEventListener("abort", onAbort, { once:true });
        }
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}
function booleanOption(value, fallback, name) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail("BAD_ARGUMENT", `${name} must be true or false.`);
  return value;
}
function viewportOf(value) {
  if (value === undefined) return { width:1280, height:800 };
  let width, height;
  if (typeof value === "string") {
    const match = /^(\d+)\s*[x,]\s*(\d+)$/i.exec(value.trim());
    if (!match) fail("BAD_VIEWPORT", "viewport must be {width,height} or WIDTHxHEIGHT.");
    width = Number(match[1]); height = Number(match[2]);
  } else if (value && typeof value === "object" && !Array.isArray(value)) ({ width, height } = value);
  else fail("BAD_VIEWPORT", "viewport must be {width,height} or WIDTHxHEIGHT.");
  if (!Number.isFinite(Number(width)) || !Number.isFinite(Number(height))) fail("BAD_VIEWPORT", "viewport needs numeric width and height.");
  return { width:clamp(width, 200, 3840, 1280), height:clamp(height, 200, 2160, 800) };
}
function selectorOf(value, name = "selector") {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) fail("BAD_STEP", `${name} must be a non-empty CSS selector of at most 2000 characters.`);
  return value;
}
function normalizeStep(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("BAD_STEP", `Step ${index + 1} must be an object.`);
  const op = String(raw.op || raw.action || raw.type || "");
  if (!STEP_OPS.includes(op)) fail("BAD_STEP", `Step ${index + 1} has an unsupported op.`);
  const allowed = new Set(["op", "action", "type", "selector", "text", "value", "key", "expression", "script", "url", "x", "y", "ms", "timeoutMs", "width", "height", "viewport", "fullPage"]);
  if (Object.keys(raw).some(key => !allowed.has(key))) fail("BAD_STEP", `Step ${index + 1} has an unknown option.`);
  const out = { op };
  if (["click", "fill", "type", "select", "hover"].includes(op)) out.selector = selectorOf(raw.selector);
  if (op === "scroll" && raw.selector !== undefined) out.selector = selectorOf(raw.selector);
  if (["fill", "type"].includes(op)) {
    out.text = raw.text !== undefined ? raw.text : raw.value;
    if (typeof out.text !== "string" || out.text.length > 100000) fail("BAD_STEP", `${op} needs a text string of at most 100000 characters.`);
  }
  if (op === "select") {
    out.value = raw.value;
    if (!["string", "number", "boolean"].includes(typeof out.value) && !Array.isArray(out.value)) fail("BAD_STEP", "select needs a value.");
    if (JSON.stringify(out.value).length > 10000) fail("BAD_STEP", "The select value is too large.");
  }
  if (op === "press") {
    if (typeof raw.key !== "string" || !raw.key || raw.key.length > 100) fail("BAD_STEP", "press needs a key such as Enter, Tab or Control+A.");
    out.key = raw.key;
    if (raw.selector !== undefined) out.selector = selectorOf(raw.selector);
  }
  if (op === "eval") {
    out.expression = raw.expression !== undefined ? raw.expression : raw.script;
    if (typeof out.expression !== "string" || !out.expression.trim() || out.expression.length > 65536) fail("BAD_STEP", "eval needs a non-empty expression of at most 65536 characters.");
  }
  if (op === "navigate") {
    if (typeof raw.url !== "string" || !raw.url || raw.url.length > 16384) fail("BAD_STEP", "navigate needs a URL.");
    out.url = raw.url;
  }
  if (op === "viewport") out.viewport = viewportOf(raw.viewport || { width:raw.width, height:raw.height });
  if (op === "scroll") { out.x = clamp(raw.x, -100000, 100000, 0); out.y = clamp(raw.y, -100000, 100000, 0); }
  if (op === "wait") out.ms = clamp(raw.ms, 0, 10000, 250);
  if (raw.timeoutMs !== undefined) out.timeoutMs = clamp(raw.timeoutMs, 100, 45000, 5000);
  return out;
}
function checkScopeRoot(target, scope) {
  if (!scope?.roots) return;
  // Signed roots were canonicalized when the token was issued; never re-follow a newly planted symlink on a root.
  const allowed = scope.roots.filter(r => typeof r === "string" && path.isAbsolute(r)).map(r => path.resolve(r));
  if (!allowed.some(root => inside(target, root))) {
    fail("PATH_OUTSIDE_SCOPE", "That path is outside the folders this run may access.", 403);
  }
}
function normalizeInput(raw, { scope = null } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("BAD_REQUEST", "Send a JSON object.");
  if (Object.keys(raw).some(key => !INPUT_KEYS.has(key))) fail("BAD_ARGUMENT", "The browser request has an unknown option.");
  const sessionId = raw.sessionId === undefined ? "" : String(raw.sessionId);
  if (sessionId && !/^[a-f0-9-]{16,64}$/i.test(sessionId)) fail("BAD_SESSION", "sessionId is not a PenEcho browser session.");
  const sources = ["url", "file", "html", "dir"].filter(key => raw[key] !== undefined);
  if (sessionId && sources.length) fail("BAD_ARGUMENT", "A kept session is inspected with sessionId and steps; do not send a new url, file, html or dir.");
  if (!sessionId && sources.length !== 1) fail("BAD_ARGUMENT", "Send exactly one of url, file, html or dir.");
  if (sources.length > 1) fail("BAD_ARGUMENT", "Send only one of url, file, html or dir.");
  const input = {
    sessionId,
    viewport:viewportOf(raw.viewport),
    waitUntil:raw.waitUntil === undefined ? "load" : String(raw.waitUntil),
    waitFor:raw.waitFor === undefined ? "" : selectorOf(raw.waitFor, "waitFor"),
    settleMs:clamp(raw.settleMs !== undefined ? raw.settleMs : raw.waitMs, 0, 10000, 250),
    steps:[],
    includeText:booleanOption(raw.includeText, true, "includeText"),
    includeHtml:booleanOption(raw.includeHtml, false, "includeHtml"),
    offline:booleanOption(raw.offline, false, "offline"),
    allowExternal:booleanOption(raw.allowExternal, false, "allowExternal"),
    keepSession:booleanOption(raw.keepSession, false, "keepSession"),
    layoutCheck:raw.layoutCheck === "true" ? true : raw.layoutCheck === "false" ? false : raw.layoutCheck === undefined ? "auto" : raw.layoutCheck,
    timeoutMs:clamp(raw.timeoutMs, 1000, 45000, 20000),
    screenshot:{ enabled:true, fullPage:false, selector:"", includeBase64:false },
    source:null,
  };
  if (!["load", "domcontentloaded", "networkidle"].includes(input.waitUntil)) fail("BAD_ARGUMENT", "waitUntil must be load, domcontentloaded or networkidle.");
  if (![true, false, "auto"].includes(input.layoutCheck)) fail("BAD_ARGUMENT", "layoutCheck must be auto, true or false.");
  if (raw.steps !== undefined) {
    if (!Array.isArray(raw.steps) || raw.steps.length > MAX_STEPS) fail("BAD_STEP", `steps must be an array of at most ${MAX_STEPS} operations.`);
    input.steps = raw.steps.map(normalizeStep);
  }
  if (raw.screenshot !== undefined) {
    if (typeof raw.screenshot === "boolean") input.screenshot.enabled = raw.screenshot;
    else if (raw.screenshot && typeof raw.screenshot === "object" && !Array.isArray(raw.screenshot)) {
      if (Object.keys(raw.screenshot).some(key => !["fullPage", "selector", "includeBase64"].includes(key))) fail("BAD_ARGUMENT", "screenshot has an unknown option.");
      input.screenshot = {
        enabled:true,
        fullPage:booleanOption(raw.screenshot.fullPage, false, "screenshot.fullPage"),
        selector:raw.screenshot.selector === undefined ? "" : selectorOf(raw.screenshot.selector, "screenshot.selector"),
        includeBase64:booleanOption(raw.screenshot.includeBase64, false, "screenshot.includeBase64"),
      };
    } else fail("BAD_ARGUMENT", "screenshot must be a boolean or an object.");
  }
  if (raw.url !== undefined) {
    if (typeof raw.url !== "string" || !raw.url || raw.url.length > 16384) fail("BAD_URL", "url must be an HTTP(S) URL.");
    let url;
    try { url = new URL(raw.url); } catch { fail("BAD_URL", "url must be a valid HTTP(S) URL."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) fail("BAD_URL", "Only HTTP(S) URLs without embedded credentials are supported.", 403);
    url.hash = "";
    input.source = { kind:"url", url:url.href, loopback:loopbackUrl(url) };
  } else if (raw.file !== undefined) {
    if (typeof raw.file !== "string" || !path.isAbsolute(raw.file) || isNetworkBackedPath(raw.file)) fail("BAD_FILE", "file must be an absolute local path to an existing regular file.", isNetworkBackedPath(raw.file) ? 403 : 400);
    // Check lexical scope before touching disk for restricted scopes.
    checkScopeRoot(path.resolve(raw.file), scope);
    const target = real(raw.file);
    let stat;
    try { stat = fs.statSync(target); } catch { /* Covered by the message below. */ }
    if (!target || !stat?.isFile()) fail("BAD_FILE", "file must name an existing regular file.", 404);
    checkScopeRoot(target, scope);
    input.source = { kind:"file", file:target, root:path.dirname(target), url:pathToFileURL(target).href };
  } else if (raw.html !== undefined) {
    if (typeof raw.html !== "string" || !raw.html.trim() || Buffer.byteLength(raw.html) > 2 * 1024 * 1024 || raw.html.includes("\0")) fail("BAD_HTML", "html must be non-empty text of at most 2 MiB without NUL bytes.");
    input.source = { kind:"html", html:raw.html, file:"", url:"" };
  } else if (raw.dir !== undefined) {
    if (typeof raw.dir !== "string" || !path.isAbsolute(raw.dir) || isNetworkBackedPath(raw.dir)) fail("BAD_DIRECTORY", "dir must be an absolute local path to an existing directory.", isNetworkBackedPath(raw.dir) ? 403 : 400);
    checkScopeRoot(path.resolve(raw.dir), scope);
    const root = real(raw.dir);
    let stat;
    try { stat = fs.statSync(root); } catch { /* Covered below. */ }
    if (!root || !stat?.isDirectory()) fail("BAD_DIRECTORY", "dir must name an existing directory.", 404);
    checkScopeRoot(root, scope);
    const entry = raw.entry === undefined ? "index.html" : raw.entry;
    if (typeof entry !== "string" || !entry || entry.length > 500 || path.isAbsolute(entry) || /[\\\0]/.test(entry) || entry.split("/").some(part => !part || part === "." || part === "..")) fail("BAD_ENTRY", "entry must be a relative file path inside dir (index.html by default).");
    input.source = { kind:"dir", root, entry, allowExternal:input.allowExternal };
  }
  return input;
}

async function publicTarget(value, allowHttp = true) {
  try { return await resolvedPublicFetchTarget(value, { allowHttp }); }
  catch (error) { throw browserError(error.code || "SSRF_BLOCKED", error.message || "That destination is not public.", error.status || 403); }
}
async function validateInitialUrl(source) {
  if (source.kind !== "url") return;
  if (!source.loopback) await publicTarget(source.url, true);
}
// Enforces file/blob/scheme policy inside CDP Fetch and Electron webRequest.
// Network egress & IP pinning are additionally enforced below the page target by createContextProxy.
function requestPolicy(input, staticOrigin = STATIC_ORIGIN) {
  const source = input.source;
  const opaqueOrigin = source?.kind === "html" || source?.kind === "file";
  const allowUrl = async (value, depth = 0) => {
    let url;
    try { url = new URL(value); } catch { return false; }
    if (url.username || url.password) return false;
    if (SAFE_SCHEMES.has(url.protocol)) return true;
    if (url.protocol === "blob:") {
      // Reject nested blob:blob:... wrappers explicitly.
      if (depth > 0 || /^blob:/i.test(url.pathname)) return false;
      // Opaque-origin documents (file:// and local html temp file) create blob:null/<uuid> URLs.
      if (/^null\/[0-9a-f-]+$/i.test(url.pathname)) return opaqueOrigin;
      let inner;
      try { inner = new URL(url.pathname); } catch { return false; }
      if (!["http:", "https:"].includes(inner.protocol)) return false;
      return allowUrl(inner.origin + "/", depth + 1);
    }
    if (url.protocol === "file:") {
      if (source?.kind === "html") {
        if (!source.file) return false;
        try { return fs.realpathSync(fileURLToPath(url)) === source.file; } catch { return false; }
      }
      if (source?.kind !== "file") return false;
      try { return inside(fs.realpathSync(fileURLToPath(url)), source.root); } catch { return false; }
    }
    if (!["http:", "https:"].includes(url.protocol)) return false;
    if (source?.kind === "html" || source?.kind === "file") return false;
    if (source?.kind === "dir") {
      if (url.protocol === "http:" && url.origin === staticOrigin) return true;
      if (!source.allowExternal) return false;
      try { await publicTarget(url.href, true); return true; } catch { return false; }
    }
    if (source?.kind === "url" && source.loopback) {
      if (loopbackUrl(url)) return true;
      if (input.offline || url.protocol !== "https:") return false;
      try { await publicTarget(url.href, false); return true; } catch { return false; }
    }
    if (source?.kind === "url") {
      if (input.offline) return false;
      try { await publicTarget(url.href, true); return true; } catch { return false; }
    }
    return false;
  };
  return value => allowUrl(value, 0);
}
async function assertNavigation(policy, value) {
  let allowed = false;
  try { allowed = await policy(value); } catch { /* Turn resolver failures into the same refusal. */ }
  if (!allowed) fail("SSRF_BLOCKED", "The browser request was blocked by PenEcho's local network and file policy.", 403);
}
function clampCaptureClip(rect) {
  const width = Math.min(MAX_CAPTURE_WIDTH, Math.max(1, Math.round(rect.width)));
  let height = Math.min(MAX_CAPTURE_HEIGHT, Math.max(1, Math.round(rect.height)));
  if (width * height > MAX_CAPTURE_PIXELS) height = Math.max(1, Math.floor(MAX_CAPTURE_PIXELS / width));
  return { x:Math.max(0, Math.round(rect.x)), y:Math.max(0, Math.round(rect.y)), width, height };
}

class CdpClient extends EventEmitter {
  constructor(socket) {
    super();
    this.setMaxListeners(64);
    this.socket = socket;
    this.serial = 0;
    this.pending = new Map();
    this.closed = false;
    socket.on("message", data => this.message(data));
    socket.on("error", error => this.emit("socketError", error));
    socket.on("close", () => this.disconnect());
  }
  static connect(url, timeoutMs = 10000) {
    const WebSocket = require("ws");
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { maxPayload:64 * 1024 * 1024, handshakeTimeout:timeoutMs });
      let done = false;
      const finish = (error, client) => { if (done) return; done = true; clearTimeout(timer); socket.off("open", onOpen); socket.off("error", onError); if (error) { socket.terminate(); reject(error); } else resolve(client); };
      const onOpen = () => finish(null, new CdpClient(socket));
      const onError = error => finish(error);
      const timer = setTimeout(() => finish(browserError("BROWSER_UNAVAILABLE", "The browser debugging connection timed out.", 503)), timeoutMs);
      timer.unref?.();
      socket.once("open", onOpen);
      socket.once("error", onError);
    });
  }
  message(data) {
    let message;
    try { message = JSON.parse(String(data)); } catch { return; }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(browserError("CDP_ERROR", `${pending.method}: ${message.error.message || "Browser command failed"}.`, 500));
      else pending.resolve(message.result || {});
      return;
    }
    if (message.method) this.emit("event", message);
  }
  send(method, params = {}, sessionId = "", timeoutMs = 20000) {
    if (this.closed) return Promise.reject(browserError("BROWSER_CLOSED", "The browser is no longer connected.", 503));
    const id = ++this.serial;
    const message = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(browserError("TIMEOUT", `${method} timed out.`, 504)); }, Math.max(1, timeoutMs));
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.socket.send(JSON.stringify(message), error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  disconnect() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(browserError("BROWSER_CLOSED", "The browser disconnected.", 503)); }
    this.pending.clear();
    this.emit("disconnect");
  }
  close() { try { this.socket.close(); } catch { /* Already gone. */ } this.disconnect(); }
}

function remoteValue(arg) {
  if (!arg) return "undefined";
  if (arg.value !== undefined) return printable(arg.value);
  if (arg.unserializableValue !== undefined) return String(arg.unserializableValue);
  return arg.description || arg.type || "undefined";
}

class ChromiumAdapter {
  constructor(options) {
    this.options = options;
    this.name = "chromium-cdp";
    this.browser = browserPathSafe(options.browserPathFn);
    this.pool = null;
    this.starting = null;
    this.launching = null;
    this.closed = false;
  }
  available() { return Boolean(this.browser); }
  pooled() { return this.pool ? 1 : 0; }
  async start() {
    if (this.closed) fail("BROWSER_CLOSED", "The browser engine is closed.", 503);
    if (this.pool) return this.pool;
    if (this.starting) return this.starting;
    const attempt = this.launch().then(pool => {
      if (this.starting === attempt) this.starting = null;
      return pool;
    }, error => {
      if (this.starting === attempt) this.starting = null;
      throw error;
    });
    this.starting = attempt;
    const pool = await attempt;
    if (this.closed) {
      if (!this.pool) this.pool = pool;
      await this.stop();
      fail("BROWSER_CLOSED", "The browser engine was closed while Chromium started.", 503);
    }
    this.pool = pool;
    return this.pool;
  }
  async launch() {
    if (!this.browser) fail("BROWSER_UNAVAILABLE", "No installed Chrome, Chromium, Edge or Brave browser was found.", 503);
    const temporaryRoot = path.join(this.options.stateDirectory, "browser-tmp");
    fs.mkdirSync(temporaryRoot, { recursive:true, mode:0o700 });
    const temp = fs.mkdtempSync(path.join(temporaryRoot, "run-"));
    const profile = path.join(temp, "profile");
    const args = [
      ...browserArgs(), "--headless=new", "--remote-debugging-port=0", "--use-mock-keychain", "--password-store=basic", "--disable-gpu",
      "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update",
      "--disable-sync", "--disable-extensions", "--mute-audio", "--no-pings", "--disable-default-apps",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--enforce-webrtc-ip-permission-check",
      `--user-data-dir=${profile}`,
    ];
    const child = spawn(this.browser, args, { stdio:["ignore", "ignore", "pipe"], windowsHide:true });
    let stderr = "", settled = false, client = null, timer = null;
    const state = { child, temp, client:null, contexts:new Map(), byBrowserContext:new Map(), childSessions:new Map() };
    this.launching = state;
    const cleanup = () => { fs.rm(temp, { recursive:true, force:true, maxRetries:3 }, () => {}); };
    const lost = () => {
      if (this.pool === state) this.pool = null;
      if (this.launching === state) this.launching = null;
      if (client) client.close();
      try { child.kill("SIGTERM"); } catch { /* Already gone. */ }
      cleanup();
    };
    child.once("error", lost);
    child.once("close", lost);
    try {
      const wsUrl = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(browserError("BROWSER_UNAVAILABLE", "Chromium did not announce its debugging endpoint in time.", 503)), 15000);
        timer.unref?.();
        child.stderr.on("data", chunk => {
          stderr = (stderr + String(chunk)).slice(-65536);
          const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-f0-9-]+)/i.exec(stderr);
          if (match && !settled) { settled = true; clearTimeout(timer); resolve(match[1]); }
        });
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("close", () => { if (!settled) { clearTimeout(timer); reject(browserError("BROWSER_UNAVAILABLE", `Chromium exited before it was ready${stderr ? `: ${stderr.slice(-500)}` : "."}`, 503)); } });
      });
      client = await CdpClient.connect(wsUrl);
      state.client = client;
      client.once("disconnect", lost);
      client.on("event", message => this.event(state, message));
      await client.send("Target.setDiscoverTargets", { discover:true }, "", 5000).catch(() => {});
      return state;
    } catch (error) { lost(); throw error; }
  }
  event(state, message) {
    // Gate any unexpected popup pages created inside one of our BrowserContexts immediately.
    if (message.method === "Target.targetCreated") {
      const info = message.params?.targetInfo;
      if (info?.browserContextId && info.type === "page") {
        const owner = state.byBrowserContext.get(info.browserContextId);
        if (owner && owner.targetId && info.targetId !== owner.targetId) {
          state.client.send("Target.closeTarget", { targetId:info.targetId }, "", 5000).catch(() => {});
        }
      }
      return;
    }
    if (message.method === "Target.attachedToTarget") {
      const { sessionId:childSession, targetInfo, waitingForDebugger } = message.params || {};
      const owner = (targetInfo?.browserContextId && state.byBrowserContext.get(targetInfo.browserContextId))
        || (message.sessionId && (state.contexts.get(message.sessionId) || state.childSessions.get(message.sessionId)));
      if (owner && childSession && childSession !== owner.sessionId && targetInfo.targetId !== owner.targetId) {
        if (targetInfo.type === "page") {
          state.client.send("Target.closeTarget", { targetId:targetInfo.targetId }, "", 5000).catch(() => {});
          return;
        }
        // Attach the same Fetch auth + file/scheme policy to worker/iframe targets before resuming them.
        // Fail closed: only resume a paused target when Fetch.enable succeeds; otherwise close it.
        state.childSessions.set(childSession, owner);
        state.client.send("Fetch.enable", { patterns:[{ urlPattern:"*" }], handleAuthRequests:true }, childSession, 5000)
          .then(() => {
            if (waitingForDebugger) return state.client.send("Runtime.runIfWaitingForDebugger", {}, childSession, 5000).catch(() => {});
          })
          .catch(() => {
            state.childSessions.delete(childSession);
            if (targetInfo?.targetId) state.client.send("Target.closeTarget", { targetId:targetInfo.targetId }, "", 5000).catch(() => {});
          });
      }
      return;
    }
    if (message.method === "Target.detachedFromTarget") {
      if (message.params?.sessionId) state.childSessions.delete(message.params.sessionId);
      return;
    }

    const context = message.sessionId && (state.contexts.get(message.sessionId) || state.childSessions.get(message.sessionId));
    if (message.method === "Fetch.authRequired") {
      const { requestId, authChallenge } = message.params || {};
      const proxy = context?.proxy;
      const matched = Boolean(proxy && authChallenge?.source === "Proxy" && authChallenge.origin === proxy.origin);
      const authChallengeResponse = matched
        ? { response:"ProvideCredentials", username:proxy.username, password:proxy.password }
        : { response:"CancelAuth" };
      state.client.send("Fetch.continueWithAuth", { requestId, authChallengeResponse }, message.sessionId, 5000).catch(() => {});
      return;
    }
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request, resourceType, frameId } = message.params;
      const respond = allowed => state.client.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", allowed ? { requestId } : { requestId, errorReason:"BlockedByClient" }, message.sessionId, 5000).catch(() => {});
      if (!context) { respond(false); return; }
      Promise.resolve(context.policy(request.url, { resourceType, frameId })).then(allowed => {
        if (!allowed) pushBounded(context.events.requestFailures, { url:clipText(request.url, 1000), error:"BlockedByClient" }, MAX_FAILURES);
        respond(allowed);
      }).catch(() => { pushBounded(context.events.requestFailures, { url:clipText(request.url, 1000), error:"BlockedByClient" }, MAX_FAILURES); respond(false); });
      return;
    }
    if (!context || message.sessionId !== context.sessionId) return;
    const params = message.params || {};
    if (message.method === "Page.javascriptDialogOpening") {
      state.client.send("Page.handleJavaScriptDialog", { accept:false }, message.sessionId, 5000).catch(() => {});
    } else if (message.method === "Runtime.consoleAPICalled") {
      const text = `${params.type || "log"}: ${(params.args || []).map(remoteValue).join(" ")}`;
      pushBounded(context.events.console, clipText(text, 4000));
      if (["error", "assert"].includes(params.type)) pushBounded(context.events.consoleErrors, clipText(text, 4000));
    } else if (message.method === "Runtime.exceptionThrown") {
      const detail = params.exceptionDetails || {};
      pushBounded(context.events.pageErrors, clipText(detail.exception?.description || detail.exception?.value || detail.text || "Page error", 4000));
    } else if (message.method === "Log.entryAdded") {
      const entry = params.entry || {};
      const text = `${entry.level || "log"}: ${entry.text || ""}`;
      if (entry.level === "error") pushBounded(context.events.consoleErrors, clipText(text, 4000));
      else if (entry.source !== "network") pushBounded(context.events.console, clipText(text, 4000));
    } else if (message.method === "Network.responseReceived" && params.type === "Document") {
      if (!context.mainFrameId || params.frameId === context.mainFrameId) {
        context.status = Number(params.response?.status) || null;
      }
    } else if (message.method === "Network.requestWillBeSent") {
      context.inflight.add(params.requestId); context.networkAt = Date.now();
    } else if (message.method === "Network.loadingFinished" || message.method === "Network.loadingFailed") {
      context.inflight.delete(params.requestId); context.networkAt = Date.now();
      if (message.method === "Network.loadingFailed") pushBounded(context.events.requestFailures, { url:clipText(params.request?.url || "", 1000), error:clipText(params.errorText || "Failed", 500) }, MAX_FAILURES);
    }
  }
  async create({ policy, proxy, viewport, left = () => 20000, signal = null }) {
    const pool = await withTimeout(this.start(), left(), "Chromium startup timed out.", signal);
    const createParams = {
      disposeOnDetach:true,
      ...(proxy ? { proxyServer:proxy.proxyServer, proxyBypassList:proxy.proxyBypassList } : {}),
    };
    const { browserContextId } = await pool.client.send("Target.createBrowserContext", createParams, "", left());
    let targetId = "", attached = "";
    const context = { pool, browserContextId, targetId, sessionId:"", mainFrameId:"", policy, proxy, events:freshEvents(), inflight:new Set(), networkAt:Date.now(), status:null };
    pool.byBrowserContext.set(browserContextId, context);
    try {
      ({ targetId } = await pool.client.send("Target.createTarget", { url:"about:blank", browserContextId }, "", left()));
      context.targetId = targetId;
      ({ sessionId:attached } = await pool.client.send("Target.attachToTarget", { targetId, flatten:true }, "", left()));
      context.sessionId = attached;
      pool.contexts.set(attached, context);
      await pool.client.send("Browser.setDownloadBehavior", { behavior:"deny", browserContextId }, "", Math.min(left(), 5000)).catch(() => {});
      for (const domain of ["Page", "Runtime", "Log", "Network"]) await pool.client.send(`${domain}.enable`, {}, attached, left());
      const tree = await pool.client.send("Page.getFrameTree", {}, attached, Math.min(left(), 5000)).catch(() => null);
      if (tree?.frameTree?.frame?.id) context.mainFrameId = tree.frameTree.frame.id;
      await pool.client.send("Target.setAutoAttach", { autoAttach:true, waitForDebuggerOnStart:true, flatten:true }, attached, Math.min(left(), 5000)).catch(() => {});
      await pool.client.send("Fetch.enable", { patterns:[{ urlPattern:"*" }], handleAuthRequests:true }, attached, left());
      await pool.client.send("Page.addScriptToEvaluateOnNewDocument", { source:ERROR_LISTENERS }, attached, left());
      await this.setViewport(context, viewport, left());
      return context;
    } catch (error) { await this.dispose(context).catch(() => {}); throw error; }
  }
  send(context, method, params, timeoutMs) { return context.pool.client.send(method, params, context.sessionId, timeoutMs); }
  async navigate(context, url, waitUntil, timeoutMs, signal = null) {
    context.status = null;
    const event = waitUntil === "domcontentloaded" ? "Page.domContentLoadedEventFired" : "Page.loadEventFired";
    const client = context.pool.client;
    let timer = null, settled = false, resolveWait, rejectWait;
    const cleanup = () => {
      clearTimeout(timer);
      client.off("event", onEvent);
      client.off("disconnect", onDisconnect);
      signal?.removeEventListener?.("abort", onAbort);
    };
    const done = (error = null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) rejectWait(error); else resolveWait();
    };
    const onEvent = message => {
      if (message.sessionId !== context.sessionId) return;
      if (message.method === event) done();
      else if (message.method === "Page.navigatedWithinDocument" && (!context.mainFrameId || message.params?.frameId === context.mainFrameId)) done();
    };
    const onDisconnect = () => done(browserError("BROWSER_CLOSED", "The browser disconnected during navigation.", 503));
    const onAbort = () => done(browserError("ABORTED", "The browser navigation was cancelled.", 499));
    const loaded = new Promise((resolve, reject) => { resolveWait = resolve; rejectWait = reject; });
    // Prevent an unhandled rejection if Page.navigate rejects before `loaded` is awaited.
    loaded.catch(() => {});
    timer = setTimeout(() => done(browserError("TIMEOUT", "The page did not finish loading.", 504)), Math.max(1, timeoutMs));
    timer.unref?.();
    client.on("event", onEvent);
    client.once("disconnect", onDisconnect);
    signal?.addEventListener?.("abort", onAbort, { once:true });
    try {
      const navigation = await this.send(context, "Page.navigate", { url }, timeoutMs);
      if (navigation.frameId) context.mainFrameId = navigation.frameId;
      if (navigation.errorText) fail("NAVIGATION_FAILED", navigation.errorText, 502);
      // Same-document navigation returns no loaderId and will not emit a new load event.
      if (!navigation.loaderId) { done(); return; }
      await loaded;
      if (waitUntil === "networkidle") await this.networkIdle(context, Math.min(timeoutMs, 10000), signal);
    } finally {
      cleanup();
    }
  }
  async networkIdle(context, timeoutMs, signal = null) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (signal?.aborted) fail("ABORTED", "The browser request was cancelled.", 499);
      if (!context.inflight.size && Date.now() - context.networkAt >= 500) return;
      await delay(50, signal);
    }
    fail("TIMEOUT", "The page did not become network-idle.", 504);
  }
  async evaluate(context, expression, timeoutMs = 20000) {
    const result = await this.send(context, "Runtime.evaluate", { expression, awaitPromise:true, returnByValue:true, userGesture:true }, timeoutMs);
    if (result.exceptionDetails) throw browserError("EVAL_FAILED", result.exceptionDetails.exception?.description || result.exceptionDetails.text || "The page expression failed.");
    return result.result?.value;
  }
  async setViewport(context, viewport, timeoutMs = 10000) {
    await this.send(context, "Emulation.setDeviceMetricsOverride", { width:viewport.width, height:viewport.height, deviceScaleFactor:1, mobile:false }, timeoutMs);
  }
  async press(context, key, timeoutMs = 5000) {
    const parts = key.split("+"), main = parts.pop(), modifiers = parts.reduce((n, part) => n | ({ alt:1, control:2, meta:4, shift:8 }[part.toLowerCase()] || 0), 0);
    const map = { Enter:{ key:"Enter", code:"Enter", windowsVirtualKeyCode:13, text:"\r" }, Tab:{ key:"Tab", code:"Tab", windowsVirtualKeyCode:9 }, Escape:{ key:"Escape", code:"Escape", windowsVirtualKeyCode:27 }, Backspace:{ key:"Backspace", code:"Backspace", windowsVirtualKeyCode:8 }, Delete:{ key:"Delete", code:"Delete", windowsVirtualKeyCode:46 }, ArrowUp:{ key:"ArrowUp", code:"ArrowUp", windowsVirtualKeyCode:38 }, ArrowDown:{ key:"ArrowDown", code:"ArrowDown", windowsVirtualKeyCode:40 }, ArrowLeft:{ key:"ArrowLeft", code:"ArrowLeft", windowsVirtualKeyCode:37 }, ArrowRight:{ key:"ArrowRight", code:"ArrowRight", windowsVirtualKeyCode:39 } };
    const detail = map[main] || { key:main, code:main.length === 1 ? `Key${main.toUpperCase()}` : main, ...(main.length === 1 ? { text:main } : {}) };
    await this.send(context, "Input.dispatchKeyEvent", { type:"keyDown", modifiers, ...detail }, timeoutMs);
    await this.send(context, "Input.dispatchKeyEvent", { type:"keyUp", modifiers, ...detail, text:undefined }, timeoutMs);
  }
  async capture(context, screenshot, timeoutMs = 20000) {
    let clip;
    if (screenshot.selector) {
      const rect = await this.evaluate(context, `(()=>{const e=document.querySelector(${JSON.stringify(screenshot.selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height}})()`, Math.min(timeoutMs, 5000));
      if (!rect || rect.width < 1 || rect.height < 1) fail("NOT_FOUND", "The screenshot selector did not match a visible element.", 404);
      clip = { ...clampCaptureClip(rect), scale:1 };
    } else if (screenshot.fullPage) {
      const metrics = await this.send(context, "Page.getLayoutMetrics", {}, Math.min(timeoutMs, 10000));
      const size = metrics.cssContentSize || metrics.contentSize;
      if (size?.width && size?.height) clip = { ...clampCaptureClip({ x:0, y:0, width:size.width, height:size.height }), scale:1 };
    }
    const result = await this.send(context, "Page.captureScreenshot", { format:"png", fromSurface:true, captureBeyondViewport:Boolean(clip), ...(clip ? { clip } : {}) }, timeoutMs);
    return Buffer.from(result.data || "", "base64");
  }
  async reset(context) { await this.dispose(context); }
  async dispose(context) {
    const pool = context.pool;
    if (context.sessionId) pool.contexts?.delete(context.sessionId);
    if (context.browserContextId) pool.byBrowserContext?.delete(context.browserContextId);
    for (const [sid, owner] of [...(pool.childSessions?.entries() || [])]) {
      if (owner === context) pool.childSessions.delete(sid);
    }
    // Pass empty sessionId so 5000 is the 4th argument (timeoutMs), not sessionId!
    if (context.targetId) await pool.client.send("Target.closeTarget", { targetId:context.targetId }, "", 5000).catch(() => {});
    if (context.browserContextId) await pool.client.send("Target.disposeBrowserContext", { browserContextId:context.browserContextId }, "", 5000).catch(() => {});
  }
  async closePool() { await this.stop(); }
  async stop() {
    const pool = this.pool || this.launching;
    this.pool = null;
    this.launching = null;
    this.starting = null;
    if (!pool) return;
    pool.client?.close();
    const exited = new Promise(resolve => { if (pool.child.exitCode !== null || pool.child.signalCode) resolve(); else pool.child.once("close", resolve); });
    try { pool.child.kill("SIGTERM"); } catch { /* Already gone. */ }
    const killer = setTimeout(() => { try { pool.child.kill("SIGKILL"); } catch { /* Already gone. */ } }, 250);
    killer.unref?.();
    await Promise.race([exited, delay(1500)]);
    clearTimeout(killer);
    await fs.promises.rm(pool.temp, { recursive:true, force:true, maxRetries:3 }).catch(() => {});
  }
  async close() { this.closed = true; await this.stop(); }
}

function freshEvents() { return { console:[], consoleErrors:[], pageErrors:[], requestFailures:[] }; }
function browserPathSafe(fn) { try { return fn() || null; } catch { return null; } }

class ElectronAdapter {
  constructor(options) {
    this.options = options;
    this.electron = options.electronModule || require("electron");
    this.name = "electron-offscreen";
    this.browser = "Electron Chromium";
    this.policies = new Map();
    this.handles = new Set();
    this.freeSlots = [];
    this.freeKeptSlots = [];
    for (let i = 0; i < (options.maxConcurrent || 2); i++) this.freeSlots.push(`penecho-browser-slot-${i}`);
    for (let i = 0; i < (options.maxSessions || 4); i++) this.freeKeptSlots.push(`penecho-browser-kept-${i}`);
    this.pooledBySlot = new Map();
    this.prepared = new WeakSet();
    this.inflightByWebContents = new Map();
    this.lastMainStatus = new Map();
  }
  available() { try { return !this.electron.app?.isReady || this.electron.app.isReady(); } catch { return false; } }
  pooled() { return this.pooledBySlot.size; }
  prepare(session) {
    if (this.prepared.has(session)) return session;
    this.prepared.add(session);
    session.webRequest.onBeforeRequest((details, callback) => {
      const policy = this.policies.get(details.webContentsId);
      if (!policy) { callback({ cancel:true }); return; }
      const set = this.inflightByWebContents.get(details.webContentsId);
      if (set && details.id !== undefined) set.add(details.id);
      Promise.resolve(policy(details.url, details)).then(allowed => {
        if (!allowed && set && details.id !== undefined) set.delete(details.id);
        callback({ cancel:!allowed });
      }, () => {
        if (set && details.id !== undefined) set.delete(details.id);
        callback({ cancel:true });
      });
    });
    session.webRequest.onCompleted?.(details => {
      const set = this.inflightByWebContents.get(details.webContentsId);
      if (set && details.id !== undefined) set.delete(details.id);
      if (details.resourceType === "mainFrame" && Number.isFinite(Number(details.statusCode))) {
        this.lastMainStatus.set(details.webContentsId, Number(details.statusCode));
      }
    });
    session.webRequest.onErrorOccurred?.(details => {
      const set = this.inflightByWebContents.get(details.webContentsId);
      if (set && details.id !== undefined) set.delete(details.id);
    });
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.on("will-download", (event, item) => { event.preventDefault(); try { item?.cancel?.(); } catch { /* Already gone. */ } });
    return session;
  }
  makeHandle(slotName, kept, viewport) {
    const session = this.prepare(this.electron.session.fromPartition(slotName));
    const win = new this.electron.BrowserWindow({
      show:false, width:viewport.width, height:viewport.height, useContentSize:true, skipTaskbar:true, focusable:false, paintWhenInitiallyHidden:true,
      webPreferences:{ offscreen:true, session, sandbox:true, contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, spellcheck:false },
    });
    registerPictureWindow(win);
    const contents = win.webContents;
    const handle = { win, contents, session, slotName, kept:Boolean(kept), current:null, listeners:[], proxy:null };
    this.handles.add(handle);
    this.inflightByWebContents.set(contents.id, new Set());
    contents.setWindowOpenHandler(() => ({ action:"deny" }));
    contents.on("will-prevent-unload", event => event.preventDefault());
    contents.setAudioMuted(true);
    contents.setWebRTCIPHandlingPolicy?.("disable_non_proxied_udp");
    const on = (name, listener) => { contents.on(name, listener); handle.listeners.push([name, listener]); };
    on("console-message", (event, level, message) => {
      const context = handle.current;
      if (!context) return;
      const modern = event && typeof event === "object" && typeof event.message === "string";
      const text = modern ? event.message : message;
      const kind = modern ? String(event.level || "log") : ({ 0:"log", 1:"warning", 2:"error" }[level] || "log");
      const formatted = `${kind}: ${text}`;
      pushBounded(context.events.console, clipText(formatted, 4000));
      if (["error", "assert"].includes(kind) || (!modern && Number(level) >= 2)) pushBounded(context.events.consoleErrors, clipText(formatted, 4000));
    });
    on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!handle.current || isMainFrame === false) return;
      pushBounded(handle.current.events.requestFailures, { url:clipText(validatedURL || "", 1000), error:clipText(`${errorCode}: ${errorDescription || "Load failed"}`, 500) }, MAX_FAILURES);
    });
    on("did-navigate", (_event, _url, httpResponseCode) => {
      if (handle.current && Number.isFinite(Number(httpResponseCode)) && Number(httpResponseCode) > 0) {
        handle.current.status = Number(httpResponseCode);
      }
    });
    on("render-process-gone", (_event, details) => {
      if (handle.current) pushBounded(handle.current.events.pageErrors, clipText(`Renderer gone: ${details?.reason || "unknown"}`, 4000));
    });
    on("dom-ready", () => { if (handle.current) contents.executeJavaScript(ERROR_LISTENERS, true).catch(() => {}); });
    on("login", (event, _details, authInfo, callback) => {
      event.preventDefault();
      const proxy = handle.proxy;
      if (typeof callback !== "function") return;
      if (proxy && authInfo?.isProxy && authInfo.host === "127.0.0.1" && Number(authInfo.port) === proxy.port) {
        callback(proxy.username, proxy.password);
      } else {
        callback();
      }
    });
    win.on?.("closed", () => {
      this.policies.delete(contents.id);
      this.inflightByWebContents.delete(contents.id);
      this.lastMainStatus.delete(contents.id);
      this.handles.delete(handle);
      if (this.pooledBySlot.get(slotName) === handle) this.pooledBySlot.delete(slotName);
      unregisterPictureWindow(win);
    });
    return handle;
  }
  async create({ policy, proxy, sessionId, viewport }) {
    if (!this.available()) fail("BROWSER_UNAVAILABLE", "Electron is not ready to create a browser window.", 503);
    const kept = Boolean(sessionId);
    const slotList = kept ? this.freeKeptSlots : this.freeSlots;
    const slotName = slotList.shift();
    if (!slotName) fail("TOO_MANY_SESSIONS", "All Electron browser slots are busy.", 429);
    let handle = !kept ? this.pooledBySlot.get(slotName) || null : null;
    if (handle) {
      this.pooledBySlot.delete(slotName);
      if (handle.win.isDestroyed()) { this.handles.delete(handle); handle = null; }
    }
    try {
      if (!handle) handle = this.makeHandle(slotName, kept, viewport);
      handle.proxy = proxy || null;
      if (proxy && typeof handle.session.setProxy === "function") {
        await handle.session.setProxy({ proxyRules:proxy.proxyServer, proxyBypassRules:proxy.proxyBypassList });
      }
      const context = { handle, sessionId:sessionId || "", policy, proxy, events:freshEvents(), status:null, viewport:{ ...viewport }, slotReleased:false };
      handle.current = context;
      this.policies.set(handle.contents.id, policy);
      await this.setViewport(context, viewport);
      return context;
    } catch (error) {
      if (handle && !handle.win.isDestroyed()) {
        unregisterPictureWindow(handle.win);
        handle.win.destroy();
      }
      if (handle) this.handles.delete(handle);
      slotList.push(slotName);
      throw error;
    }
  }
  async navigate(context, url, waitUntil, timeoutMs, signal = null) {
    const { contents } = context.handle;
    context.status = null;
    this.lastMainStatus.delete(contents.id);
    const inflight = this.inflightByWebContents.get(contents.id);
    if (inflight) inflight.clear();
    let timer = null, onDomReady = null, onFinish = null, onAbort = null;
    const cleanup = () => {
      clearTimeout(timer);
      if (onDomReady) contents.off("dom-ready", onDomReady);
      if (onFinish) contents.off("did-finish-load", onFinish);
      if (onAbort && signal) signal.removeEventListener("abort", onAbort);
    };
    const eventReady = new Promise((resolve, reject) => {
      onAbort = () => reject(browserError("ABORTED", "The browser navigation was cancelled.", 499));
      signal?.addEventListener?.("abort", onAbort, { once:true });
      timer = setTimeout(() => reject(browserError("TIMEOUT", "The page did not finish loading.", 504)), Math.max(1, timeoutMs));
      timer.unref?.();
      if (waitUntil === "domcontentloaded") {
        onDomReady = () => resolve();
        contents.once("dom-ready", onDomReady);
      } else {
        onFinish = () => resolve();
        contents.once("did-finish-load", onFinish);
      }
    });
    eventReady.catch(() => {});
    try {
      const loadPromise = contents.loadURL(url);
      if (waitUntil === "domcontentloaded") {
        loadPromise.catch(() => {});
        await Promise.race([eventReady, withTimeout(loadPromise, timeoutMs, "The page did not finish loading.", signal)]);
      } else {
        await withTimeout(loadPromise, timeoutMs, "The page did not finish loading.", signal);
      }
      if (context.status === null && this.lastMainStatus.has(contents.id)) {
        context.status = this.lastMainStatus.get(contents.id);
      }
      if (waitUntil === "networkidle") {
        const deadline = Date.now() + Math.min(timeoutMs, 10000);
        let quietSince = Date.now(), settledIdle = false;
        while (Date.now() < deadline) {
          if (signal?.aborted) fail("ABORTED", "The browser request was cancelled.", 499);
          if ((inflight?.size || 0) === 0) {
            if (Date.now() - quietSince >= 500) { settledIdle = true; break; }
          } else {
            quietSince = Date.now();
          }
          await delay(50, signal);
        }
        if (!settledIdle) fail("TIMEOUT", "The page did not become network-idle.", 504);
      }
    } finally {
      cleanup();
    }
  }
  async evaluate(context, expression, timeoutMs = 20000) {
    return withTimeout(context.handle.contents.executeJavaScript(expression, true), timeoutMs, "The page expression timed out.");
  }
  async setViewport(context, viewport) {
    context.viewport = { ...viewport };
    const { win } = context.handle;
    if (win.isDestroyed()) return;
    if (typeof win.setContentSize === "function") win.setContentSize(viewport.width, viewport.height);
    else win.setSize(viewport.width, viewport.height);
  }
  async press(context, key) {
    const parts = key.split("+"), main = parts.pop();
    const modifiers = parts.map(part => part.toLowerCase()).filter(part => ["alt", "control", "meta", "shift"].includes(part));
    const map = { Enter:"Return", Tab:"Tab", Escape:"Escape", Backspace:"Backspace", Delete:"Delete", ArrowUp:"Up", ArrowDown:"Down", ArrowLeft:"Left", ArrowRight:"Right" };
    const keyCode = map[main] || main;
    context.handle.contents.sendInputEvent({ type:"keyDown", keyCode, modifiers });
    if (main.length === 1) context.handle.contents.sendInputEvent({ type:"char", keyCode:main, modifiers });
    context.handle.contents.sendInputEvent({ type:"keyUp", keyCode, modifiers });
  }
  async capture(context, screenshot, timeoutMs = 20000) {
    const { contents } = context.handle;
    let rect, previous = null;
    if (screenshot.selector) {
      const measured = await this.evaluate(context, `(()=>{const e=document.querySelector(${JSON.stringify(screenshot.selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`, Math.min(timeoutMs, 5000));
      if (!measured || measured.width < 1 || measured.height < 1) fail("NOT_FOUND", "The screenshot selector did not match a visible element.", 404);
      rect = clampCaptureClip(measured);
    } else if (screenshot.fullPage) {
      const size = await this.evaluate(context, "({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight})", Math.min(timeoutMs, 5000));
      previous = { ...context.viewport };
      const full = clampCaptureClip({ x:0, y:0, width:Math.max(200, Math.ceil(size?.width || previous.width)), height:Math.max(200, Math.ceil(size?.height || previous.height)) });
      await this.setViewport(context, { width:full.width, height:full.height });
      await delay(50);
    }
    try {
      const image = await withTimeout(contents.capturePage(rect), timeoutMs, "The screenshot timed out.");
      if (!image || image.isEmpty()) fail("SCREENSHOT_FAILED", "Chromium returned an empty screenshot.", 500);
      return image.toPNG();
    } finally { if (previous) await this.setViewport(context, previous); }
  }
  releaseSlot(context) {
    if (context.slotReleased) return;
    context.slotReleased = true;
    const slotList = context.handle.kept ? this.freeKeptSlots : this.freeSlots;
    if (!slotList.includes(context.handle.slotName)) slotList.push(context.handle.slotName);
  }
  async reset(context) {
    const handle = context.handle;
    handle.proxy = null;
    try {
      if (!handle.win.isDestroyed()) {
        // Keep an explicit about:blank-only policy active during blanking so onBeforeRequest permits it.
        this.policies.set(handle.contents.id, url => url === "about:blank");
        handle.contents.stop();
        await withTimeout(handle.contents.loadURL("about:blank"), 5000, "Blanking timed out.");
        await handle.session.clearStorageData();
        await handle.session.clearCache?.().catch(() => {});
        await this.setViewport(context, { width:1280, height:800 });
        this.policies.delete(handle.contents.id);
        handle.current = null;
        this.pooledBySlot.set(handle.slotName, handle);
        this.releaseSlot(context);
        return;
      }
    } catch { /* A broken pooled window is destroyed instead of recycled. */ }
    await this.dispose(context);
  }
  async dispose(context) {
    const handle = context.handle;
    this.policies.delete(handle.contents.id);
    this.inflightByWebContents.delete(handle.contents.id);
    this.lastMainStatus.delete(handle.contents.id);
    handle.current = null;
    handle.proxy = null;
    this.handles.delete(handle);
    if (this.pooledBySlot.get(handle.slotName) === handle) this.pooledBySlot.delete(handle.slotName);
    await handle.session.clearStorageData?.().catch(() => {});
    await handle.session.clearCache?.().catch(() => {});
    unregisterPictureWindow(handle.win);
    if (!handle.win.isDestroyed()) handle.win.destroy();
    if (context.slotReleased !== undefined) this.releaseSlot(context);
  }
  async closePool() {
    for (const [slotName, handle] of [...this.pooledBySlot.entries()]) {
      this.pooledBySlot.delete(slotName);
      await this.dispose({ handle, slotReleased:true });
    }
  }
  async close() {
    for (const handle of [...this.handles]) await this.dispose(handle.current || { handle, slotReleased:true });
    this.pooledBySlot.clear();
    this.policies.clear();
  }
}

// The desktop app's Chromium, used from its server's process: the windows are the app's (desktop/browser-host.js, an
// ElectronAdapter), and everything an agent's request may do is still decided here.
class DesktopAdapter {
  constructor({ link }) {
    this.link = link;
    this.name = "electron-offscreen";
    this.browser = "Electron Chromium";
    this.contexts = new Map();
    this.serial = 0;
    this.pooledCount = 0;
    link.handle("browser-policy", ({ context, url }) => this.contexts.get(context)?.policy?.(url) ?? false);
    link.handle("browser-event", ({ context, kind, value, limit }) => {
      const events = this.contexts.get(context)?.events;
      if (Array.isArray(events?.[kind])) pushBounded(events[kind], value, limit);
    });
    link.handle("browser-status", ({ context, status }) => { const entry = this.contexts.get(context); if (entry) entry.status = status; });
    link.handle("browser-pooled", ({ pooled }) => { this.pooledCount = pooled; });
  }
  available() { return this.link.open(); }
  pooled() { return this.pooledCount; }
  ask(action, params, options) { return this.link.request("browser", { action, ...params }, options); }
  async create({ policy, proxy, sessionId, viewport }) {
    const id = ++this.serial, link = this.link;
    let events = freshEvents();
    const context = {
      id, policy, sessionId:sessionId || "", viewport:{ ...viewport }, status:null,
      // Emptied for each request of a kept session; the app's process then counts from zero too.
      get events() { return events; },
      set events(value) { events = value; link.notify("browser-events", { context:id }); },
    };
    this.contexts.set(id, context);
    try {
      await this.ask("create", { context:id, sessionId:context.sessionId, viewport, proxy:proxy ? { port:proxy.port, username:proxy.username, password:proxy.password, proxyServer:proxy.proxyServer, proxyBypassList:proxy.proxyBypassList } : null });
    } catch (error) { this.contexts.delete(id); throw error; }
    return context;
  }
  async navigate(context, url, waitUntil, timeoutMs, signal = null) {
    context.status = null;
    await this.ask("navigate", { context:context.id, url, waitUntil, timeoutMs }, { signal });
  }
  evaluate(context, expression, timeoutMs = 20000) { return this.ask("evaluate", { context:context.id, expression, timeoutMs }); }
  async setViewport(context, viewport) {
    context.viewport = { ...viewport };
    await this.ask("viewport", { context:context.id, viewport });
  }
  press(context, key) { return this.ask("press", { context:context.id, key }); }
  async capture(context, screenshot, timeoutMs = 20000) {
    const bytes = await this.ask("capture", { context:context.id, screenshot, timeoutMs });
    return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  }
  async finish(action, context) {
    try { await this.ask(action, { context:context.id }); } finally { this.contexts.delete(context.id); }
  }
  reset(context) { return this.finish("reset", context); }
  dispose(context) { return this.finish("dispose", context); }
  closePool() { return this.ask("close-pool", {}); }
  async close() { try { await this.ask("close", {}); } catch { /* The app has gone, and its windows with it. */ } this.contexts.clear(); }
}

function cleanEvents(events) {
  const unique = list => [...new Set(list.map(value => String(value)))].slice(0, MAX_EVENTS).map(value => clipText(value, 4000));
  return {
    console:unique(events.console),
    consoleErrors:unique(events.consoleErrors),
    pageErrors:unique(events.pageErrors),
    requestFailures:events.requestFailures.slice(0, MAX_FAILURES).map(item => ({ url:clipText(item.url, 1000), error:clipText(item.error, 500) })),
  };
}
function saveScreenshot(stateDirectory, bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) fail("SCREENSHOT_FAILED", "Chromium returned no PNG data.", 500);
  const directory = path.join(stateDirectory, "browser-shots");
  fs.mkdirSync(directory, { recursive:true, mode:0o700 });
  const fileName = `${crypto.randomUUID()}.png`;
  const file = path.join(directory, fileName);
  fs.writeFileSync(file, bytes, { mode:0o600 });
  try {
    const now = Date.now(), names = fs.readdirSync(directory).filter(name => /^[a-f0-9-]+\.png$/i.test(name));
    const freshGraceMs = 60000;
    const rows = [];
    for (const name of names) {
      if (name === fileName) continue; // Always preserve the screenshot just captured.
      const target = path.join(directory, name);
      let stat;
      try { stat = fs.statSync(target); } catch { continue; }
      if (now - stat.mtimeMs > 86400000) { try { fs.rmSync(target, { force:true }); } catch { /* Concurrent prune. */ } }
      else rows.push({ target, mtime:stat.mtimeMs, size:stat.size, fresh:now - stat.mtimeMs < freshGraceMs });
    }
    rows.sort((a, b) => b.mtime - a.mtime);
    let keptBytes = bytes.length, keptCount = 1;
    for (const row of rows) {
      // Preserve fresh shots from concurrent processes unless directory exceeds 2x emergency byte ceiling.
      const overSoft = keptCount >= MAX_SHOT_FILES || keptBytes + row.size > MAX_SHOT_BYTES;
      const overHard = keptBytes + row.size > MAX_SHOT_BYTES * 2;
      if (overHard || (overSoft && !row.fresh)) {
        try { fs.rmSync(row.target, { force:true }); } catch { /* Concurrent prune. */ }
      } else {
        keptCount++;
        keptBytes += row.size;
      }
    }
  } catch { /* A cleanup failure never loses the picture just captured. */ }
  return file;
}

function createBrowserEngine({
  stateDirectory,
  idleMs = 60000,
  sessionTtlMs = 120000,
  maxSessions = 4,
  maxConcurrent = 2,
  maxQueue = 32,
  electronModule = null,
  browserPathFn = browserPath,
  inDesktopAppFn = inDesktopApp,
  desktopLink = electronModule ? null : DesktopLink.active(),
} = {}) {
  if (typeof stateDirectory !== "string" || !stateDirectory) throw new TypeError("createBrowserEngine needs stateDirectory.");
  stateDirectory = path.resolve(stateDirectory);
  idleMs = clamp(idleMs, 100, 3600000, 60000);
  sessionTtlMs = clamp(sessionTtlMs, 100, 3600000, 120000);
  maxSessions = clamp(maxSessions, 1, 32, 4);
  maxConcurrent = clamp(maxConcurrent, 1, 16, 2);
  maxQueue = clamp(maxQueue, 1, 128, 32);
  const desktop = Boolean(inDesktopAppFn());
  const adapter = desktopLink ? new DesktopAdapter({ link:desktopLink }) : desktop ? new ElectronAdapter({ stateDirectory, electronModule, maxConcurrent, maxSessions }) : new ChromiumAdapter({ stateDirectory, browserPathFn });
  const sessions = new Map(), activeContexts = new Set(), inFlightCreations = new Set(), queue = [];
  let active = 0, reservedSessions = 0, totalWaiting = 0, closed = false, idleTimer = null;

  function status() {
    return {
      ok:true,
      available:!closed && adapter.available(),
      engine:adapter.name,
      browser:adapter.browser,
      activeSessions:sessions.size,
      pooled:adapter.pooled(),
      actions:ACTIONS,
      stepOps:STEP_OPS,
    };
  }
  function clearIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }
  function scheduleIdle() {
    clearIdle();
    if (closed || active || sessions.size || reservedSessions || !adapter.pooled()) return;
    idleTimer = setTimeout(() => { idleTimer = null; void adapter.closePool().catch(() => {}); }, idleMs);
    idleTimer.unref?.();
  }
  function pump() {
    while (!closed && active < maxConcurrent && queue.length) {
      const next = queue.shift();
      if (next.cancelled) continue;
      if (next.signal && next.onAbort) next.signal.removeEventListener("abort", next.onAbort);
      active++;
      Promise.resolve().then(next.run).then(next.resolve, next.reject).finally(() => { active--; pump(); });
      return;
    }
    if (closed || (active === 0 && !queue.length)) scheduleIdle();
  }
  function slot(run, signal = null) {
    if (closed) return Promise.reject(browserError("BROWSER_CLOSED", "PenEcho's browser service is closed.", 503));
    if (signal?.aborted) return Promise.reject(browserError("ABORTED", "The browser request was cancelled.", 499));
    clearIdle();
    if (active < maxConcurrent) {
      active++;
      return Promise.resolve().then(run).finally(() => { active--; pump(); });
    }
    if (queue.length + totalWaiting >= maxQueue) return Promise.reject(browserError("BUSY", "Too many queued browser requests; retry shortly.", 503));
    return new Promise((resolve, reject) => {
      const entry = { run, resolve, reject, signal, cancelled:false, onAbort:null };
      if (signal) {
        entry.onAbort = () => {
          entry.cancelled = true;
          const idx = queue.indexOf(entry);
          if (idx >= 0) queue.splice(idx, 1);
          reject(browserError("ABORTED", "The browser request was cancelled.", 499));
        };
        signal.addEventListener("abort", entry.onAbort, { once:true });
      }
      queue.push(entry);
    });
  }
  async function disposeContext(context, kept) {
    if (!context || context.disposed) return;
    context.disposed = true;
    activeContexts.delete(context);
    clearTimeout(context.ttlTimer);
    try { await (kept ? adapter.dispose(context.adapterContext) : adapter.reset(context.adapterContext)); } catch { /* Teardown continues below. */ }
    if (context.proxy) await context.proxy.close().catch(() => {});
    if (context.htmlTempDir) await fs.promises.rm(context.htmlTempDir, { recursive:true, force:true, maxRetries:3 }).catch(() => {});
  }
  async function closeSession(id, { scope = null } = {}) {
    const session = sessions.get(id);
    if (!session) return false;
    if (scope && session.ownerScope !== scope.id) return false;
    sessions.delete(id);
    session.closed = true;
    clearTimeout(session.ttlTimer);
    await disposeContext(session, true);
    scheduleIdle();
    return true;
  }
  async function closeScopeSessions(scopeId) {
    if (!scopeId) return;
    for (const [id, session] of [...sessions.entries()]) {
      if (session.ownerScope === scopeId) await closeSession(id);
    }
  }
  function armSession(session) {
    clearTimeout(session.ttlTimer);
    session.lastUsed = Date.now();
    if (session.pendingCount > 0 || session.closed) return;
    session.ttlTimer = setTimeout(() => { if (session.pendingCount === 0) void closeSession(session.id); }, sessionTtlMs);
    session.ttlTimer.unref?.();
  }
  async function createContext(input, scope, left, signal) {
    let creationDone;
    const creationPromise = new Promise(resolve => { creationDone = resolve; });
    inFlightCreations.add(creationPromise);
    try {
      await validateInitialUrl(input.source);
      let htmlTempDir = "", initialUrl = input.source.url;
      const mode = input.source.kind === "url" ? (input.source.loopback ? "loopback" : "external") : input.source.kind;
      if (input.source.kind === "html") {
        const tmpRoot = path.join(stateDirectory, "browser-tmp");
        fs.mkdirSync(tmpRoot, { recursive:true, mode:0o700 });
        htmlTempDir = fs.mkdtempSync(path.join(tmpRoot, "html-"));
        const htmlFile = path.join(htmlTempDir, "index.html");
        fs.writeFileSync(htmlFile, input.source.html, { mode:0o600 });
        input.source.file = fs.realpathSync(htmlFile);
        initialUrl = pathToFileURL(input.source.file).href;
      } else if (input.source.kind === "dir") {
        initialUrl = `${STATIC_ORIGIN}/${input.source.entry.split("/").map(encodeURIComponent).join("/")}`;
      }

      let proxy = null, adapterContext = null;
      const context = {
        id:input.keepSession ? crypto.randomUUID() : "",
        ownerScope:scope?.id || "global",
        input,
        source:input.source,
        initialUrl,
        htmlTempDir,
        proxy:null,
        policy:null,
        adapterContext:null,
        viewport:input.viewport,
        ttlTimer:null,
        lastUsed:Date.now(),
        pendingCount:0,
        disposed:false,
        closed:false,
        tail:Promise.resolve(),
      };
      try {
        proxy = await createContextProxy({
          mode,
          source:input.source,
          offline:input.offline,
          allowExternal:input.allowExternal,
          onBlocked:blockedUrl => {
            if (context.adapterContext?.events) {
              pushBounded(context.adapterContext.events.requestFailures, { url:clipText(blockedUrl, 1000), error:"BlockedByClient" }, MAX_FAILURES);
            }
          },
        });
        context.proxy = proxy;
        context.policy = requestPolicy(input, proxy.staticOrigin);
        await assertNavigation(context.policy, initialUrl);
        adapterContext = await adapter.create({ policy:context.policy, proxy, sessionId:context.id, viewport:input.viewport, left, signal });
        context.adapterContext = adapterContext;
        if (closed) fail("BROWSER_CLOSED", "PenEcho's browser service closed during startup.", 503);
        activeContexts.add(context);
        return context;
      } catch (error) {
        if (adapterContext) await adapter.dispose(adapterContext).catch(() => {});
        if (proxy) await proxy.close().catch(() => {});
        if (htmlTempDir) await fs.promises.rm(htmlTempDir, { recursive:true, force:true, maxRetries:3 }).catch(() => {});
        throw error;
      }
    } finally {
      inFlightCreations.delete(creationPromise);
      creationDone();
    }
  }
  async function waitForSelector(context, selector, timeoutMs, left, signal) {
    const deadline = Math.min(Date.now() + timeoutMs, Date.now() + left());
    for (;;) {
      if (signal?.aborted) fail("ABORTED", "The browser request was cancelled.", 499);
      const found = await adapter.evaluate(context.adapterContext, `(()=>{try{return Boolean(document.querySelector(${JSON.stringify(selector)}))}catch(e){throw new Error(e.message)}})()`, Math.max(1, left()));
      if (found) return;
      if (Date.now() >= deadline) fail("WAIT_FAILED", `Timed out waiting for selector: ${selector}`, 504);
      await delay(Math.min(75, Math.max(1, deadline - Date.now())), signal);
    }
  }
  async function navigate(context, url, input, left, signal) {
    await assertNavigation(context.policy, url);
    await adapter.navigate(context.adapterContext, url, input.waitUntil, left(), signal);
  }
  async function runStep(context, step, left, signal) {
    const ac = context.adapterContext;
    if (step.op === "wait") { await delay(Math.min(step.ms, left()), signal); return { waited:step.ms }; }
    if (step.op === "navigate") {
      const current = await adapter.evaluate(ac, "location.href", left());
      let target;
      try { target = new URL(step.url, current).href; } catch { fail("BAD_URL", "The navigate step has an invalid URL."); }
      await navigate(context, target, { waitUntil:"load" }, left, signal);
      return { url:target };
    }
    if (step.op === "viewport") {
      context.viewport = step.viewport;
      await adapter.setViewport(ac, step.viewport, left());
      return step.viewport;
    }
    if (step.op === "press") {
      if (step.selector) {
        const found = await adapter.evaluate(ac, `(()=>{const e=document.querySelector(${JSON.stringify(step.selector)});if(!e)return false;e.focus();return true})()`, left());
        if (!found) fail("NOT_FOUND", `No element matches ${step.selector}.`, 404);
      }
      await adapter.press(ac, step.key, Math.min(left(), 5000));
      return { key:step.key };
    }
    if (step.op === "eval") return await adapter.evaluate(ac, step.expression, left());
    const selector = step.selector ? JSON.stringify(step.selector) : "null";
    if (step.op === "click" || step.op === "hover") {
      const events = step.op === "click" ? "e.focus();e.click()" : "for(const t of [\"mouseover\",\"mouseenter\",\"mousemove\"])e.dispatchEvent(new MouseEvent(t,{bubbles:t!==\"mouseenter\",view:window}))";
      const found = await adapter.evaluate(ac, `(()=>{const e=document.querySelector(${selector});if(!e)return false;e.scrollIntoView({block:"center",inline:"center"});${events};return true})()`, left());
      if (!found) fail("NOT_FOUND", `No element matches ${step.selector}.`, 404);
      return { selector:step.selector };
    }
    if (step.op === "fill" || step.op === "type") {
      const found = await adapter.evaluate(ac, `(()=>{const e=document.querySelector(${selector});if(!e)return false;e.focus();const text=${JSON.stringify(step.text)};${step.op === "fill" ? "e.value=text" : "e.value=String(e.value||\"\")+text"};e.dispatchEvent(new Event(\"input\",{bubbles:true}));e.dispatchEvent(new Event(\"change\",{bubbles:true}));return true})()`, left());
      if (!found) fail("NOT_FOUND", `No element matches ${step.selector}.`, 404);
      return { selector:step.selector };
    }
    if (step.op === "select") {
      const found = await adapter.evaluate(ac, `(()=>{const e=document.querySelector(${selector});if(!e)return false;const wanted=${JSON.stringify(step.value)},values=Array.isArray(wanted)?wanted.map(String):[String(wanted)];for(const o of e.options)o.selected=values.includes(o.value);e.dispatchEvent(new Event(\"input\",{bubbles:true}));e.dispatchEvent(new Event(\"change\",{bubbles:true}));return values.some(v=>[...e.options].some(o=>o.value===v))})()`, left());
      if (!found) fail("NOT_FOUND", "The select element or requested option was not found.", 404);
      return { selector:step.selector, value:step.value };
    }
    if (step.op === "scroll") {
      await adapter.evaluate(ac, `(()=>{const s=${selector};if(s){const e=document.querySelector(s);if(!e)return false;e.scrollIntoView({block:"center",inline:"center"});return true}window.scrollBy(${step.x},${step.y});return true})()`, left());
      return { x:step.x, y:step.y };
    }
    fail("BAD_STEP", `Unsupported step: ${step.op}`);
  }
  async function execute(context, input, initial, left, signal) {
    const ac = context.adapterContext;
    ac.events = freshEvents();
    if (initial) ac.status = null;
    const steps = [];
    if (initial) await navigate(context, context.initialUrl, input, left, signal);
    if (input.waitFor) await waitForSelector(context, input.waitFor, left(), left, signal);
    for (const step of input.steps) {
      if (signal?.aborted) fail("ABORTED", "The browser request was cancelled.", 499);
      try {
        const result = await runStep(context, step, left, signal);
        const bounded = step.op === "eval" && (result === null || ["number", "boolean"].includes(typeof result)) ? result : step.op !== "eval" && typeof result === "object" && result !== null ? result : clipText(printable(result), 8000);
        pushBounded(steps, { op:step.op, ok:true, ...(result !== undefined ? { result:bounded } : {}) }, MAX_STEPS);
      } catch (error) {
        pushBounded(steps, { op:step.op, ok:false, error:clipText(error.message, 1000) }, MAX_STEPS);
        error.browserSteps = steps;
        throw error;
      }
    }
    if (input.settleMs) await delay(Math.min(input.settleMs, left()), signal);
    const extraErrors = await adapter.evaluate(ac, READ_ERRORS, left()).catch(() => []);
    if (Array.isArray(extraErrors)) for (const error of extraErrors) pushBounded(ac.events.pageErrors, clipText(error, 4000));
    // Cap text/HTML inside the renderer before IPC and skip reading disabled fields entirely.
    const identityExpr = `({url:String(location.href||"").slice(0,16384),title:String(document.title||"").slice(0,4000),${input.includeText ? `text:document.body?String(document.body.innerText||"").slice(0,${MAX_TEXT_CHARS}):"",` : ""}${input.includeHtml ? `html:document.documentElement?String(document.documentElement.outerHTML||"").slice(0,${MAX_HTML_CHARS}):"",` : ""}prototype:Boolean(document.documentElement&&document.documentElement.hasAttribute("data-penecho-prototype"))})`;
    const identity = await adapter.evaluate(ac, identityExpr, left());
    let layoutChecks = null;
    if (input.layoutCheck === true || (input.layoutCheck === "auto" && identity?.prototype)) layoutChecks = clean(await adapter.evaluate(ac, PROBE, left()).catch(() => [])) || [];
    let png = "", pngBase64;
    if (input.screenshot.enabled) {
      const bytes = await adapter.capture(ac, input.screenshot, left());
      png = saveScreenshot(stateDirectory, bytes);
      if (input.screenshot.includeBase64) pngBase64 = bytes.toString("base64");
    }
    return {
      ok:true,
      engine:adapter.name,
      url:clipText(identity?.url || context.initialUrl || "", 16384),
      title:clipText(identity?.title || "", 4000),
      status:ac.status ?? null,
      viewport:context.viewport,
      png,
      ...(pngBase64 !== undefined ? { pngBase64 } : {}),
      ...(input.includeText ? { text:clipText(identity?.text || "", MAX_TEXT_CHARS) } : {}),
      ...(input.includeHtml ? { html:clipText(identity?.html || "", MAX_HTML_CHARS) } : {}),
      ...cleanEvents(ac.events),
      steps,
      layoutChecks,
      ...(context.id ? { sessionId:context.id } : {}),
    };
  }
  async function inspect(raw, { scope = null, signal = null } = {}) {
    const ownerScope = scope?.id || "global";
    const input = normalizeInput(raw, { scope });
    const deadline = Date.now() + input.timeoutMs;
    const left = () => { const ms = deadline - Date.now(); if (ms <= 0) fail("TIMEOUT", "The browser request timed out.", 504); return ms; };
    if (input.sessionId) {
      if (closed) fail("BROWSER_CLOSED", "PenEcho's browser service is closed.", 503);
      if (signal?.aborted) fail("ABORTED", "The browser request was cancelled.", 499);
      const existing = sessions.get(input.sessionId);
      if (!existing || existing.ownerScope !== ownerScope) fail("BAD_SESSION", "That browser session is gone or expired.", 404);
      if (queue.length + totalWaiting >= maxQueue) fail("BUSY", "Too many queued browser requests; retry shortly.", 503);
      // Mark active and disarm TTL synchronously before queueing so an idle timer cannot race with this follow-up.
      existing.pendingCount++;
      totalWaiting++;
      let waitingCounted = true;
      const releaseWaitCount = () => { if (waitingCounted) { waitingCounted = false; totalWaiting = Math.max(0, totalWaiting - 1); } };
      clearTimeout(existing.ttlTimer);
      let cancelledBeforeTurn = false;
      const prevTail = existing.tail;
      let releaseSelf;
      const selfDone = new Promise(resolve => { releaseSelf = resolve; });
      // Chain both prevTail and selfDone so if this request aborts early, a later caller still waits for prevTail!
      existing.tail = Promise.all([prevTail, selfDone]).then(() => {});
      try {
        try {
          await withTimeout(prevTail, left(), "The browser request timed out waiting for the session.", signal);
        } catch (err) {
          cancelledBeforeTurn = true;
          throw err;
        }
        releaseWaitCount();
        return await slot(async () => {
          if (cancelledBeforeTurn || signal?.aborted) fail("ABORTED", "The browser request was cancelled.", 499);
          if (existing.closed || !sessions.has(existing.id)) fail("BAD_SESSION", "That browser session is gone or expired.", 404);
          return await execute(existing, input, false, left, signal);
        }, signal);
      } finally {
        releaseWaitCount();
        releaseSelf();
        existing.pendingCount = Math.max(0, existing.pendingCount - 1);
        if (!existing.closed && sessions.has(existing.id) && existing.pendingCount === 0) armSession(existing);
      }
    }
    return slot(async () => {
      if (signal?.aborted) fail("ABORTED", "The browser request was cancelled.", 499);
      let reserved = false;
      if (input.keepSession) {
        // Reserve capacity atomically before any await; evict only an idle session.
        if (sessions.size + reservedSessions >= maxSessions) {
          const idle = [...sessions.values()].filter(s => s.pendingCount === 0).sort((a, b) => a.lastUsed - b.lastUsed)[0];
          if (!idle) fail("TOO_MANY_SESSIONS", "All kept browser sessions are active; close one or retry shortly.", 429);
          sessions.delete(idle.id);
          idle.closed = true;
          clearTimeout(idle.ttlTimer);
          reservedSessions++;
          reserved = true;
          try { await disposeContext(idle, true); } catch { /* Best-effort eviction cleanup. */ }
        } else {
          reservedSessions++;
          reserved = true;
        }
      }
      let context = null, kept = false;
      try {
        context = await createContext(input, scope, left, signal);
        const result = await execute(context, input, true, left, signal);
        if (input.keepSession && !closed) {
          sessions.set(context.id, context);
          armSession(context);
          kept = true;
        }
        return result;
      } finally {
        if (reserved) reservedSessions = Math.max(0, reservedSessions - 1);
        if (context && !kept) await disposeContext(context, false);
      }
    }, signal);
  }
  async function close() {
    if (closed) return;
    closed = true;
    clearIdle();
    for (const pending of queue.splice(0)) {
      if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
      pending.reject(browserError("BROWSER_CLOSED", "PenEcho's browser service is closed.", 503));
    }
    const adapterClosing = adapter.close();
    await Promise.allSettled([...inFlightCreations]);
    for (const id of [...sessions.keys()]) await closeSession(id);
    for (const context of [...activeContexts]) await disposeContext(context, true);
    await adapterClosing;
  }
  return { inspect, closeSession, closeScopeSessions, status, close, normalizeInput, requestPolicy, get engine() { return adapter.name; } };
}

module.exports = {
  ACTIONS,
  STEP_OPS,
  browserError,
  normalizeInput,
  requestPolicy,
  publicTarget,
  validateInitialUrl,
  staticFile,
  createBrowserEngine,
  CdpClient,
  ChromiumAdapter,
  ElectronAdapter,
  DesktopAdapter,
  saveScreenshot,
};
