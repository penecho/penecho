"use strict";
require("./helpers/safety.js");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { parseHTML } = require("./helpers/dom.js");

const { hasOwnProjects, initialDesktopUrl } = require("../desktop/startup-route.js");
const {
  WINDOW_COLORS,
  normalizeThemePreference,
  resolveWindowColors,
  readWindowTheme,
  writeWindowTheme,
  titleBarOverlay,
  titleBarOptionsForPlatform,
} = require("../desktop/window-theme.js");

const ROOT = path.resolve(__dirname, "..");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("desktop startup route boots directly into Projects when personal projects exist without reading project folders", () => {
  const dir = tempDir("penecho-startup-route-");
  try {
    assert.equal(hasOwnProjects(dir), false);
    assert.equal(
      initialDesktopUrl("http://127.0.0.1:3888/", { stateDir:dir, desktopLaunch:"abc" }),
      "http://127.0.0.1:3888/?desktopLaunch=abc"
    );

    const regDir = path.join(dir, "project-lines");
    fs.mkdirSync(regDir, { recursive:true });
    fs.writeFileSync(path.join(regDir, "projects.json"), JSON.stringify({
      projects:[
        { id:"ex", example:"weather", docsPath:"/nonexistent/ex" },
        { id:"mine", myCanvases:true, docsPath:"/nonexistent/mine" },
        { id:"old", archived:true, docsPath:"/nonexistent/old" },
      ],
    }));
    assert.equal(hasOwnProjects(dir), false, "examples, My Canvases, and archived projects stay on first-run welcome");

    fs.writeFileSync(path.join(regDir, "projects.json"), JSON.stringify({
      projects:[
        { id:"ex", example:"weather", docsPath:"/nonexistent/ex" },
        { id:"real", name:"My App", docsPath:"/nonexistent/Documents/MyApp" },
      ],
    }));
    assert.equal(hasOwnProjects(dir), true);
    assert.equal(
      initialDesktopUrl("http://127.0.0.1:3888/", { stateDir:dir, desktopLaunch:"xyz" }),
      "http://127.0.0.1:3888/projects.html?desktopLaunch=xyz"
    );
  } finally {
    fs.rmSync(dir, { recursive:true, force:true });
  }
});

test("window theme persistence and platform titlebar options stay synchronized with light and dark modes", () => {
  const dir = tempDir("penecho-window-theme-");
  try {
    assert.equal(readWindowTheme(dir), "system");
    assert.equal(normalizeThemePreference("invalid"), "system");
    assert.deepEqual(resolveWindowColors("system", false), WINDOW_COLORS.light);
    assert.deepEqual(resolveWindowColors("system", true), WINDOW_COLORS.dark);
    assert.deepEqual(resolveWindowColors("dark", false), WINDOW_COLORS.dark);
    assert.deepEqual(resolveWindowColors("light", true), WINDOW_COLORS.light);

    assert.equal(writeWindowTheme(dir, "dark"), "dark");
    assert.equal(readWindowTheme(dir), "dark");
    assert.equal(writeWindowTheme(dir, "light"), "light");
    assert.equal(readWindowTheme(dir), "light");

    const mac = titleBarOptionsForPlatform("darwin", WINDOW_COLORS.dark);
    assert.equal(mac.titleBarStyle, "hiddenInset");
    assert.deepEqual(mac.trafficLightPosition, { x:14, y:15 });

    const winDark = titleBarOptionsForPlatform("win32", WINDOW_COLORS.dark);
    assert.equal(winDark.titleBarStyle, "hidden");
    assert.deepEqual(winDark.titleBarOverlay, {
      color:WINDOW_COLORS.dark.titleBarColor,
      symbolColor:WINDOW_COLORS.dark.symbolColor,
      height:45,
    });
    assert.deepEqual([0.9, 1, 1.1, 1.2].map(scale => titleBarOverlay(WINDOW_COLORS.light, scale).height), [40, 45, 49, 54]);
    assert.deepEqual(titleBarOptionsForPlatform("linux", WINDOW_COLORS.light), {});
  } finally {
    fs.rmSync(dir, { recursive:true, force:true });
  }
});

test("desktop main process and preload wire native titlebar, dynamic theme sync, and shell menu page switching", () => {
  const main = fs.readFileSync(path.join(ROOT, "desktop", "main.js"), "utf8");
  const preload = fs.readFileSync(path.join(ROOT, "desktop", "canvas-preload.js"), "utf8");
  assert.match(main, /initialDesktopUrl\(url, \{ stateDir, desktopLaunch:randomUUID\(\) \}\)/);
  assert.match(main, /titleBarOptionsForPlatform\(process\.platform, colors\)/);
  assert.match(main, /setTitleBarOverlay\(titleBarOverlay\(colors, mainWindow\.webContents\.getZoomFactor\(\)\)\)/);
  assert.match(main, /setZoomFactor\(scale\);\s*applyMainWindowTheme\(\)/);
  const linesCss = fs.readFileSync(path.join(ROOT, "public", "lines", "lines.css"), "utf8"), studioCss = fs.readFileSync(path.join(ROOT, "public", "studio-shell.css"), "utf8");
  for (const css of [linesCss, studioCss]) assert.match(css, /html\[data-desktop="win32"\] [^{]*\.(projbar|topbar) \{ padding-right: calc\(138px \/ var\(--window-scale, 1\) \+ 10px\); \}/);
  assert.doesNotMatch(linesCss, /data-desktop="win32"\] \.lp-head/);
  assert.match(main, /nativeTheme\.on\("updated"/);
  assert.match(main, /ipcMain\.on\("penecho:set-theme"/);
  assert.match(main, /ipcMain\.handle\("penecho:is-fullscreen"/);
  assert.match(main, /obj\.page === "projects" \|\| obj\.page === "canvas"/);
  assert.match(preload, /platform:process\.platform/);
  assert.match(preload, /titleBarInset:\["darwin", "win32"\]\.includes\(process\.platform\)/);
  assert.match(preload, /setTheme:mode => ipcRenderer\.send\("penecho:set-theme", mode\)/);
  assert.match(preload, /onFullscreenChange:listener/);
});

test("direct desktop launch to projects.html plays opening animation waiting for native window visibility", () => {
  const openingSource = fs.readFileSync(path.join(ROOT, "public", "lines", "opening.js"), "utf8");
  const { document } = parseHTML("<html><body></body></html>");
  document.cookie = "penecho-boot=test";
  document.currentScript = { dataset:{ play:"self" } };
  const items = new Map();
  const storage = { getItem:k => items.get(k) ?? null, setItem:(k, v) => items.set(k, v), removeItem:k => items.delete(k) };
  let reveal;
  const whenShown = new Promise(resolve => { reveal = resolve; });
  const win = { penechoDesktop:{ whenStartupVisible:() => whenShown } };
  win.top = win;
  const frames = [];
  vm.runInNewContext(openingSource, {
    window:win, document, sessionStorage:storage, localStorage:storage, URLSearchParams,
    location:{ search:"?desktopLaunch=direct-projects-1" }, navigator:{},
    matchMedia:() => ({ matches:false }), Date, innerWidth:1440, innerHeight:900,
    addEventListener() {}, removeEventListener() {}, setTimeout:() => 1, clearTimeout() {},
    requestAnimationFrame:fn => frames.push(fn),
  });
  const root = document.getElementById("peOpening");
  assert.ok(root, "opening plays directly on projects.html desktop launch without index.html redirect");
  assert.equal(root.classList.contains("po-paused"), true, "waits for native window visibility before animating");
  reveal(true);
});

test("persistent Canvas shell reuses one warm iframe, hot-switches canvases, opens settings in place, and reconciles drawings on close", async () => {
  const { document, window } = parseHTML(
    '<!doctype html><html><head></head><body><div id="app"><aside id="rail"></aside><div class="shell"><div id="projbar"></div><main id="view"></main><section id="canvasStage" class="canvas-stage" hidden></section></div></div></body></html>'
  );
  const posted = [], historyOps = [], settingsOpened = [], loadStateCalls = [], tookDrawings = [], listeners = [];
  let menuSyncs = 0, railRenders = 0;

  const origCreate = document.createElement.bind(document);
  document.createElement = tag => {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === "iframe") {
      el.contentWindow = {
        postMessage:(msg, origin) => posted.push({ msg, origin }),
      };
    }
    return el;
  };

  const loc = { href:"http://127.0.0.1:3889/projects.html#p1/line/demo", origin:"http://127.0.0.1:3889", pathname:"/projects.html", search:"", hash:"#p1/line/demo" };
  const S = { cur:"p1", route:{ view:"line", line:"demo" }, projects:[{ id:"p1", name:"Demo" }], data:{ p1:{ id:"p1", name:"Demo", files:[], pictures:[] } }, newPage:false, shelfPage:false, hashWrite:"" };
  const pending = { current:{ project:"p1", file:"drawing.png" } };

  const ctx = {
    window, document, location:loc, URL, URLSearchParams, S, EMBED:null, HOSTED:null,
    lineProjectsHidden:false,
    history:{
      pushState:(st, _t, url) => { historyOps.push(["push", url, st]); loc.hash = url; },
      replaceState:(st, _t, url) => { historyOps.push(["replace", url, st]); loc.hash = url; },
      back:() => historyOps.push(["back"]),
    },
    addEventListener:(type, fn) => { if (type === "message") listeners.push(fn); },
    setTimeout:(fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
    clearTimeout,
    summaryOf:id => S.projects.find(p => p.id === id),
    project:id => S.data[id || S.cur],
    routeToHash:r => (r.view === "line" ? `p1/line/${r.line}` : "p1"),
    renderRail:() => { railRenders++; },
    render:() => {},
    refreshAfterChange:() => {},
    openSettings:tab => { settingsOpened.push(tab); },
    settingsUp:() => false,
    dropSettingsModal:() => {},
    pendingDrawing:() => pending.current,
    takeDrawing:async p => { tookDrawings.push(p.id); pending.current = null; },
    boxUrls:() => {},
    loadState:async (id, opts) => { loadStateCalls.push({ id, opts }); return true; },
    outsidePage:h => h.startsWith("#settings") || h.startsWith("#agents"),
    parseShelfPage:h => (h.startsWith("#settings") ? "settings" : "agents"),
    SETTINGS_PAGES:new Set(["settings", "agents", "providers", "archived"]),
    hashToRoute:() => ({ cur:"p1", route:{ view:"line", line:"demo" } }),
    go:() => {},
    switchProject:async () => {},
  };
  window.top = window;
  window.PenEchoDesktopMenuSync = () => { menuSyncs++; };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "public", "lines", "canvas-shell.js"), "utf8"), ctx);

  const shell = window.PenEchoCanvasShell;
  assert.equal(shell.enabled(), true);

  // 1. First Canvas open mounts ONE iframe in shell mode without reloading the page.
  await shell.open("/?linesProject=p1&linesCanvas=files%2Fcanvases%2Fc1.penecho.json&linesTitle=First&linesDoc=lines%2Fdemo.md");
  const frame1 = document.getElementById("canvasFrame");
  assert.ok(frame1, "creates persistent canvasFrame");
  assert.match(frame1.getAttribute("src"), /^\/index\.html\?shell=1&linesProject=p1&linesCanvas=files%2Fcanvases%2Fc1\.penecho\.json/);
  assert.equal(document.body.classList.contains("canvas-open"), true);
  assert.equal(document.getElementById("canvasStage").hidden, false);
  assert.equal(shell.active, true);
  assert.equal(shell.activeLine, "demo");
  assert.equal(historyOps.at(-1)[0], "push");
  assert.match(historyOps.at(-1)[1], /^#p1\/canvas\//);

  // Simulate Canvas booting and signalling ready.
  for (const fn of listeners) fn({ origin:loc.origin, source:frame1.contentWindow, data:{ source:"penecho-canvas-shell", ready:true } });
  assert.equal(shell.booted, true);
  assert.equal(frame1.classList.contains("is-ready"), true);

  // 2. Second Canvas open hot-switches via postMessage WITHOUT recreating or reloading the iframe.
  const srcBefore = frame1.getAttribute("src");
  await shell.open("/?linesProject=p1&linesCanvas=files%2Fcanvases%2Fc2.penecho.json&linesTitle=Second");
  assert.strictEqual(document.getElementById("canvasFrame"), frame1, "reuses same warm iframe");
  assert.equal(frame1.getAttribute("src"), srcBefore, "iframe src is never reloaded on hot-switch");
  assert.equal(posted.some(p => p.msg.action === "open" && p.msg.target.source === "files/canvases/c2.penecho.json"), true);

  // 3. Settings opened from Canvas opens modal OVER live Canvas and closes back without reloading.
  for (const fn of listeners) fn({ origin:loc.origin, source:frame1.contentWindow, data:{ source:"penecho-canvas-shell", openSettings:"#settings/canvas" } });
  assert.deepEqual(settingsOpened, ["canvas"]);
  assert.equal(shell.active, true, "Canvas stays mounted and active underneath Settings");
  shell.onSettingsClosed(true);
  assert.equal(historyOps.at(-1)[0], "back");
  assert.equal(posted.some(p => p.msg.action === "sync-settings"), true);

  // 4. Closing Canvas waits for Canvas save-and-leave ack, hides stage, keeps iframe alive, and reconciles drawing after loadState.
  const closing = shell.close();
  const leaveMsg = posted.find(p => p.msg.action === "leave");
  assert.ok(leaveMsg, "asks Canvas to flush and save before hiding");
  for (const fn of listeners) fn({ origin:loc.origin, source:frame1.contentWindow, data:{ source:"penecho-canvas-shell", left:true, requestId:leaveMsg.msg.requestId } });
  await closing;
  await new Promise(r => setImmediate(r));
  assert.equal(shell.active, false);
  assert.equal(document.getElementById("canvasStage").hidden, true);
  assert.strictEqual(document.getElementById("canvasFrame"), frame1, "iframe stays warm after close");
  assert.equal(loadStateCalls.length, 1);
  assert.equal(JSON.stringify(loadStateCalls[0].opts.needs), JSON.stringify({ parts:["files"] }), "reads the folder's files before attaching pending drawing");
  assert.deepEqual(tookDrawings, ["p1"]);
  assert.ok(menuSyncs >= 3 && railRenders >= 3);
});

test("server serves content-hashed Lines bundles immutably, revalidates unversioned assets, and allows same-origin framing of Canvas", async () => {
  const temp = tempDir("penecho-native-server-");
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd:ROOT,
    stdio:["ignore", "pipe", "ignore"],
    env:{
      ...process.env,
      NODE_ENV:"test",
      HOST:"127.0.0.1",
      PORT:"0",
      PENECHO_TEST_OPEN_ACCESS:"1",
      PENECHO_STATE_DIR:path.join(temp, "state"),
      PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud"),
      PENECHO_CONFIG_FILE:path.join(temp, "config.env"),
    },
  });
  try {
    const origin = await new Promise((resolve, reject) => {
      let out = "";
      const timer = setTimeout(() => reject(new Error("server timeout")), 15000);
      child.stdout.on("data", chunk => {
        out += chunk;
        const m = out.match(/PenEcho: http:\/\/127\.0\.0\.1:(\d+)/);
        if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${m[1]}`); }
      });
    });

    const canvasRes = await fetch(`${origin}/index.html`);
    assert.equal(canvasRes.status, 200);
    assert.match(canvasRes.headers.get("content-security-policy") || "", /frame-ancestors 'self'/);

    const projectsHtml = await (await fetch(`${origin}/projects.html`)).text();
    const bundleMatch = projectsHtml.match(/src="(lines\/bundle\.js\?v=([a-f0-9]{10}))"/);
    assert.ok(bundleMatch, "projects.html references content-hashed lines/bundle.js");

    const hashedRes = await fetch(`${origin}/${bundleMatch[1]}`);
    assert.equal(hashedRes.status, 200);
    assert.equal(hashedRes.headers.get("cache-control"), "public, max-age=31536000, immutable");

    const unhashedRes = await fetch(`${origin}/lines/bundle.js`);
    assert.equal(unhashedRes.status, 200);
    assert.equal(unhashedRes.headers.get("cache-control"), "public, max-age=0, must-revalidate");

    const staleHashRes = await fetch(`${origin}/lines/bundle.js?v=0000000000`);
    assert.equal(staleHashRes.status, 200);
    assert.equal(staleHashRes.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  } finally {
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill();
    await exited;
    fs.rmSync(temp, { recursive:true, force:true });
  }
});

test("desktop shell opens same-origin local pages in the system browser and clears titlebar drag regions for lightbox overlays", () => {
  const main = fs.readFileSync(path.join(ROOT, "desktop", "main.js"), "utf8");
  const linesCss = fs.readFileSync(path.join(ROOT, "public", "lines", "lines.css"), "utf8");
  const filesCss = fs.readFileSync(path.join(ROOT, "public", "lines", "files.css"), "utf8");

  const fnMatch = main.match(/function canOpenExternalWindowUrl\([\s\S]*?\n\}/);
  assert.ok(fnMatch, "desktop/main.js defines canOpenExternalWindowUrl");
  assert.match(main, /setWindowOpenHandler\(\(\{ url \}\) => \{\s*if \(canOpenExternalWindowUrl\(url, allowed\)\) void shell\.openExternal\(url\);/);
  const canOpen = vm.runInNewContext(`(${fnMatch[0]})`);
  const sameOrigin = candidate => { try { return new URL(candidate).origin === "http://127.0.0.1:3888"; } catch { return false; } };
  assert.equal(canOpen("http://127.0.0.1:3888/api/lines/projects/p1/file?path=files%2Fdemo.html", sameOrigin), true);
  assert.equal(canOpen("https://penecho.ai/docs", sameOrigin), true);
  assert.equal(canOpen("http://example.com/page.html", sameOrigin), false);
  assert.equal(canOpen("file:///etc/passwd", () => true), false);
  assert.equal(canOpen("javascript:alert(1)", () => true), false);

  // Popups open below the 46px window bar, take their own clicks, and leave the bar itself to move the window (PE-1127).
  const studioCss = fs.readFileSync(path.join(ROOT, "public", "studio-shell.css"), "utf8");
  const lineCss = fs.readFileSync(path.join(ROOT, "public", "lines", "line.css"), "utf8");
  const bundle = fs.readFileSync(path.join(ROOT, "public", "lines", "bundle.css"), "utf8");
  assert.match(linesCss, /\.projbar \{[^}]*height: 46px/);
  assert.match(linesCss, /html\[data-desktop="win32"\], html\[data-desktop="darwin"\]:not\(\.is-desktop-fullscreen\) \{ --win-bar: 46px; \}/);
  for (const popup of ["#lightbox", ".sysm-layer", ".sw-overlay"]) assert.match(linesCss, new RegExp(`html\\[data-desktop\\] ${popup.replace(".", "\\.")} \\{ padding-top: max\\([^;]*var\\(--win-bar, 0px\\)`));
  for (const popup of [".lp-panel.is-popped", ":is(.line-command-dialog, .token-proof-dialog)"]) assert.ok(linesCss.includes(`html[data-desktop] ${popup} { top: var(--win-bar, 0px);`), popup);
  const cards = linesCss.match(/html\[data-desktop\] :is\((#lightbox > \*[^\n]*)\) \{ -webkit-app-region: no-drag; \}/)?.[1].split(", ") || [];
  for (const card of [".sw-panel", ".sysm", ".menu", "dialog", ".lp-panel.is-popped", ".lp-review-pop"]) assert.ok(cards.includes(card), card);
  const under = linesCss.match(/html\[data-desktop\]:has\(([^\n]*)\) :is\(([^)]*)\) \{ -webkit-app-region: no-drag; \}/);
  assert.ok(under?.[1].includes("#lightbox:not([hidden])") && under[1].includes("dialog[open]"));
  assert.deepEqual(under[2].split(", "), [".rail-top", ".lp-head", ".lp-side-top"]);
  assert.ok(lineCss.includes("html[data-desktop] .lp-side-top, html[data-desktop] .lp.side-open .lp-head { -webkit-app-region: none; }"));
  assert.match(linesCss, /html\[data-desktop="darwin"\]:not\(\.is-desktop-fullscreen\) \.rail \{ --rail-pad-top: 40px; \}/);
  assert.match(linesCss, /html\[data-desktop\] \.rail-top \{[^}]*margin: calc\(-1 \* var\(--rail-pad-top\)\) calc\(-1 \* var\(--rail-pad-inline\)\) 0;[^}]*-webkit-app-region: drag;/);
  assert.match(linesCss, /html\[data-desktop\] :is\(\.rail-top,[^)]*\) :is\(button,[^)]*\) \{ -webkit-app-region: no-drag; \}/);
  assert.match(studioCss, /html\[data-desktop\] body\[data-theme="studio"\] :is\(\.settings-panel,[^)]*\.plugin-modal,[^)]*dialog, \[popover\]\) \{ -webkit-app-region: no-drag; \}/);
  assert.match(bundle, /--win-bar:\s*46px/);
  assert.match(filesCss, /\.fv-head \.fv-fav\s*\{[^}]*margin:\s*0;/);
});
