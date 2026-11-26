"use strict";
// Draws one web page as a PNG.
// The desktop app draws it with its own Chromium in a hidden window, so the user's browser and keychain are never touched.
// Run without the desktop app (the `penecho` command), it borrows an installed Chromium-based browser, kept off the keychain and the network.
// With neither, it gives back null and the caller uses its own stand-in picture.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { callBrowser } = require("./browser-call.js");
const DesktopLink = require("../desktop-link.js");
const { PROBE, withProbe, readProbe, clean } = require("./prototype-check.js");

const SETTLE_MS = 1500, TIMEOUT_MS = 20000;
const pictureWindows = new Set();
let queue = Promise.resolve(), pictureSession = null, localBrowserAborted = false;

// In the app's own process, or in its server's process, which asks the app's (desktop/browser-host.js).
const inDesktopApp = () => (Boolean(process.versions.electron) && process.type === "browser") || Boolean(DesktopLink.active());
// Hidden drawing and pooled browser windows do not count as the person's desktop windows.
const registerPictureWindow = window => { pictureWindows.add(window); return window; };
const unregisterPictureWindow = window => { pictureWindows.delete(window); };
const isPictureWindow = window => pictureWindows.has(window);

// Inside a macOS Seatbelt sandbox (such as Codex workspace-write), launching installed Chrome aborts
// during _RegisterApplication and pops up macOS CrashReporter dialogs. Refuse direct launch there.
function localBrowserBlocked(env = process.env, platform = process.platform) {
  const mode = String(env.PENECHO_PAGE_RENDERER || "").toLowerCase();
  if (env.PENECHO_NO_LOCAL_BROWSER === "1" || mode === "off" || mode === "none" || mode === "hosted") return true;
  if (platform === "darwin" && (env.CODEX_SANDBOX || env.CODEX_SANDBOX_NETWORK_DISABLED === "1" || env.SANDBOX_RUNTIME || env.CLAUDE_SANDBOX === "1" || env.CLAUDE_CODE_SANDBOX === "1")) return true;
  return false;
}
function hostedBrowserConfigured(env = process.env) {
  const mode = String(env.PENECHO_PAGE_RENDERER || "").toLowerCase();
  if (mode === "off" || mode === "none" || mode === "local") return false;
  if (env.CODEX_SANDBOX_NETWORK_DISABLED === "1") return false;
  if (!env.PENECHO_BROWSER_URL || !env.PENECHO_BROWSER_PASS) return false;
  return Boolean((env.PENECHO_BROWSER_PROOF_KEY && env.PENECHO_BROWSER_INSTANCE) || env.PENECHO_BROWSER_ENDPOINT);
}
function browserPath(env = process.env, platform = process.platform) {
  if (localBrowserBlocked(env, platform)) return null;
  if (env === process.env && localBrowserAborted) return null;
  const home = os.homedir(), mac = name => [`/Applications/${name}.app/Contents/MacOS/${name}`, path.join(home, `Applications/${name}.app/Contents/MacOS/${name}`)];
  const win = (...parts) => [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean).map(root => path.join(root, ...parts));
  const candidates = [env.CHROME_PATH,
    ...(platform === "darwin" ? ["Google Chrome", "Chromium", "Microsoft Edge", "Brave Browser"].flatMap(mac) : []),
    ...(platform === "win32" ? [...win("Google", "Chrome", "Application", "chrome.exe"), ...win("Microsoft", "Edge", "Application", "msedge.exe"), ...win("BraveSoftware", "Brave-Browser", "Application", "brave.exe")] : []),
    ...(platform === "linux" ? ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"].flatMap(name => [`/usr/bin/${name}`, `/snap/bin/${name}`]) : [])];
  return candidates.find(file => { try { return file && fs.statSync(file).isFile(); } catch { return false; } }) || null;
}
// Started by an elevated PenEcho (a terminal run as administrator), Chrome and Edge start themselves again as the normal user and
// leave at once: the process PenEcho holds ends before it is ready, and the other one is never closed.
const browserArgs = (platform = process.platform) => (platform === "win32" ? ["--do-not-de-elevate"] : []);
function canRenderPages(env = process.env, platform = process.platform) {
  const mode = String(env.PENECHO_PAGE_RENDERER || "").toLowerCase();
  if (mode === "off" || mode === "none") return false;
  return inDesktopApp() || hostedBrowserConfigured(env) || Boolean(browserPath(env, platform));
}

// One picture at a time: each one is a whole page in its own process.
function pagePicture(html, size = {}) {
  return queued(html, size, false).then(r => r?.png || null);
}
// The picture and the layout check of a design prototype, measured in the same page: { png, checks }. checks is null when it could not be measured.
function pagePictureChecked(html, size = {}) {
  return queued(html, size, true).then(r => r || { png:null, checks:null });
}
function queued(html, size, check) {
  const run = queue.then(() => draw(html, { width:size.width || 1280, height:size.height || 800 }, check));
  queue = run.catch(() => null);
  return run.catch(() => null);
}
async function hostedBrowserPicture(html, { width, height }, check, env = process.env) {
  try {
    const res = await callBrowser({
      env,
      allowGlobalDiscovery:false,
      timeoutMs:TIMEOUT_MS,
      body:{
        html,
        viewport:{ width, height },
        offline:true,
        includeText:false,
        screenshot:{ includeBase64:true },
        layoutCheck:Boolean(check),
        settleMs:300,
        timeoutMs:TIMEOUT_MS,
      },
    });
    if (res?.status !== 200 || !res.json?.ok || typeof res.json.pngBase64 !== "string" || !res.json.pngBase64) {
      return { result:null, networkBlocked:false };
    }
    const png = Buffer.from(res.json.pngBase64, "base64");
    if (png.subarray(0, 4).toString("latin1") !== "\x89PNG") return { result:null, networkBlocked:false };
    return { result:{ png, checks:check ? clean(res.json.layoutChecks) : null }, networkBlocked:false };
  } catch (error) {
    return { result:null, networkBlocked:error?.code === "EPERM" || error?.code === "EACCES" };
  }
}
async function draw(html, size, check) {
  const mode = String(process.env.PENECHO_PAGE_RENDERER || "").toLowerCase();
  if (mode === "off" || mode === "none") return null;
  const desktop = inDesktopApp();
  if (!desktop && hostedBrowserConfigured()) {
    const hosted = await hostedBrowserPicture(html, size, check);
    if (hosted.result) return hosted.result;
    if (hosted.networkBlocked) return null;
  }
  if (!desktop && !browserPath()) return null;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-picture-")), page = path.join(temp, "page.html");
  // The desktop app asks the page directly; a borrowed browser hears it through its console.
  fs.writeFileSync(page, check && !desktop ? withProbe(html, size) : html);
  try {
    if (desktop) return await desktopPicture(page, size, check);
    return await browserPicture(page, temp, size, check);
  } finally { fs.rm(temp, { recursive:true, force:true, maxRetries:3 }, () => {}); }
}

// A session kept in memory only, where the page may load its own file and nothing from the network, and is granted nothing.
function quietSession(electron) {
  if (pictureSession) return pictureSession;
  pictureSession = electron.session.fromPartition("penecho-picture");
  pictureSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel:!/^(file|data|blob|about|devtools):/i.test(details.url) }));
  pictureSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  pictureSession.setPermissionCheckHandler(() => false);
  return pictureSession;
}
async function desktopPicture(page, { width, height }, check) {
  const link = DesktopLink.active();
  if (link) return link.request("picture", { page, width, height, check:Boolean(check) });
  const electron = require("electron");
  if (!electron.app.isReady()) return null;
  const window = new electron.BrowserWindow({ show:false, width, height, useContentSize:true, skipTaskbar:true, focusable:false, paintWhenInitiallyHidden:true,
    webPreferences:{ offscreen:true, session:quietSession(electron), sandbox:true, contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, spellcheck:false } });
  pictureWindows.add(window);
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action:"deny" }));
  contents.on("will-navigate", event => event.preventDefault());
  contents.on("will-prevent-unload", event => event.preventDefault());
  contents.setAudioMuted(true);
  let timer;
  try {
    return await Promise.race([
      (async () => {
        await contents.loadFile(page);
        await contents.executeJavaScript("document.fonts ? document.fonts.ready.then(() => true) : true", true).catch(() => null);
        await new Promise(resolve => setTimeout(resolve, SETTLE_MS));
        let image = await contents.capturePage();
        if (image.isEmpty()) return null;
        const drawn = image.getSize();
        if (drawn.width !== width || drawn.height !== height) image = image.resize({ width, height, quality:"best" });
        const checks = check ? clean(await contents.executeJavaScript(PROBE, true).catch(() => null)) : null;
        return { png:image.toPNG(), checks };
      })(),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), TIMEOUT_MS); }),
    ]);
  } finally {
    clearTimeout(timer);
    pictureWindows.delete(window);
    if (!window.isDestroyed()) window.destroy();
  }
}

// An installed browser, started headless with a throwaway profile, kept off the keychain and the network.
function browserPicture(page, temp, { width, height }, check) {
  const browser = browserPath();
  if (!browser) return Promise.resolve(null);
  const shot = path.join(temp, "shot.png");
  // The page's console lines go to the browser's log, which carries the layout check. Only its last part is kept.
  const logging = check ? ["--enable-logging=stderr", "--log-level=0"] : [];
  let log = "";
  return new Promise(resolve => {
    const child = spawn(browser, [...logging, ...browserArgs(), "--headless=new", "--use-mock-keychain", "--password-store=basic", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--proxy-server=http://127.0.0.1:9", "--host-resolver-rules=MAP * ~NOTFOUND", `--user-data-dir=${path.join(temp, "profile")}`, `--window-size=${width},${height}`, "--virtual-time-budget=4000", `--screenshot=${shot}`, pathToFileURL(page).href], { stdio:["ignore", "ignore", check ? "pipe" : "ignore"], windowsHide:true });
    if (check) child.stderr.on("data", chunk => { log = (log + chunk).slice(-200000); });
    let done = false;
    const finish = (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      let bytes = null;
      try { bytes = fs.readFileSync(shot); } catch { /* No picture this time. */ }
      if (!bytes && (signal === "SIGABRT" || signal === "SIGTRAP" || code === 134 || code === 133)) {
        localBrowserAborted = true;
      }
      resolve(bytes ? { png:bytes, checks:check ? readProbe(log) : null } : null);
    };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* It already ended. */ } }, 40000);
    child.on("error", () => finish(null, null)); child.on("close", (code, signal) => finish(code, signal));
  });
}

module.exports = { pagePicture, pagePictureChecked, desktopPicture, inDesktopApp, browserPath, browserArgs, canRenderPages, localBrowserBlocked, hostedBrowserConfigured, isPictureWindow, registerPictureWindow, unregisterPictureWindow };
