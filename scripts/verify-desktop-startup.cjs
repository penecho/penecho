"use strict";

// Exercise the shipped main process and preload with an isolated profile.
// Run with an Electron runtime: <electron> this-script <app.asar> <output-dir>
// [--squirrel-firstrun] [--suppress-ready-to-show] [--suppress-startup-ready-events].
const { app, BrowserWindow, Menu } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const archive = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
const suppressReady = process.argv.includes("--suppress-ready-to-show") || process.argv.includes("--suppress-startup-ready-events"),
  suppressLoad = process.argv.includes("--suppress-startup-ready-events");
const restoreReadiness = [];
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-desktop-smoke-"));
fs.mkdirSync(output, { recursive:true });
fs.writeFileSync(path.join(output, "temporary-profile.txt"), profile);
app.setPath("userData", profile);
app.disableHardwareAcceleration();
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_DISABLE_AUTO_UPDATE:"1" });
fs.writeFileSync(path.join(profile, "config.env"), [
  "HOST=127.0.0.1", "PORT=0", "AI_PROVIDER=api", "AI_API_URL=http://127.0.0.1:1/v1",
  "AI_API_KEY=isolated-test-fixture", "AI_API_MODEL=fixture", "PENECHO_REQUEST_TRACE=false", "",
].join("\n"));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label) {
  for (let n = 0; n < 200; n++) { if (await check()) return; await pause(150); }
  throw new Error(`Timed out: ${label}`);
}
const timeout = setTimeout(() => { console.error("Desktop startup timed out"); app.exit(1); }, 90000);
// Fault injection only in this isolated test process: exercise the production
// initial-show fallback even when Chromium never emits a readiness notification.
if (suppressReady) app.on("browser-window-created", (_event, window) => {
  const emit = window.emit;
  let pendingReady;
  restoreReadiness.push(() => { window.emit = emit; if (pendingReady) emit.call(window, "ready-to-show", ...pendingReady); });
  window.emit = function(event, ...args) { if (event === "ready-to-show") { pendingReady = args; return false; } return emit.call(this, event, ...args); };
  if (suppressLoad) {
    const emitContents = window.webContents.emit;
    let pendingLoad;
    restoreReadiness.push(() => { window.webContents.emit = emitContents; if (pendingLoad) emitContents.call(window.webContents, "did-finish-load", ...pendingLoad); });
    window.webContents.emit = function(event, ...args) { if (event === "did-finish-load") { pendingLoad = args; return false; } return emitContents.call(this, event, ...args); };
  }
});
require(path.join(archive, "desktop/main.js"));
(async () => {
  try {
    await app.whenReady();
    let win;
    await waitFor(() => {
      win = BrowserWindow.getAllWindows().find(window => /^http:/.test(window.webContents.getURL()));
      return win && !win.webContents.isLoading();
    }, "desktop window");
    await waitFor(() => win.isVisible() && !win.isMinimized(), "visible desktop window");
    // Fault injection covers the first display only. Later navigation needs its
    // real completion events (including those used by Electron's loadURL promise).
    for (const restore of restoreReadiness.splice(0)) restore();
    const js = code => win.webContents.executeJavaScript(code);
    assert.equal(await js("typeof window.penechoDesktop"), "object", "production preload is available");
    assert.ok(Menu.getApplicationMenu().items.length > 0, "native application menu is installed");
    fs.writeFileSync(path.join(output, "startup.png"), (await win.webContents.capturePage()).toPNG());
    const origin = new URL(win.webContents.getURL()).origin;
    await win.loadURL(`${origin}/projects.html#setup`);
    await waitFor(() => js("Boolean(document.querySelector('[data-agent=\"dsh\"]'))"), "Agent setup");
    assert(win.isVisible() && !win.isMinimized(), "the application stays visible after navigation");
    fs.writeFileSync(path.join(output, "agent-setup.png"), (await win.webContents.capturePage()).toPNG());
    const report = {
      platform:process.platform, arch:process.arch, electron:process.versions.electron,
      packagedSource:archive, desktopStartup:true, windowVisible:true, productionPreload:true, nativeMenu:true, agentSetup:true, paidModelRequests:0,
      squirrelFirstRun:process.argv.includes("--squirrel-firstrun"), suppressedReadyToShow:suppressReady, suppressedDidFinishLoad:suppressLoad,
    };
    fs.writeFileSync(path.join(output, "startup-report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    console.error(error.stack);
    clearTimeout(timeout);
    app.exit(1);
  }
})();
