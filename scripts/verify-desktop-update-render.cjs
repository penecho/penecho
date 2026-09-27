"use strict";

// Isolated Electron smoke test: production HTML/CSS/preloads, simulated updater
// states, no downloads or installation, and a temporary profile.
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), output = path.resolve(process.argv[2] || path.join(root, "output", "desktop-update-smoke"));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-update-smoke-"));
app.setPath("userData", profile);
app.setName("PenEcho Update Verification");
// SSH has no interactive GPU desktop; verify layout with software rendering.
if (process.platform === "win32") app.disableHardwareAcceleration();
fs.mkdirSync(output, { recursive:true });
let server, updateWindow, canvasWindow, state = {
  status:"idle", updateAvailable:false, visible:false, language:"zh", currentVersion:"1.1.0", version:"1.3.5", progress:0,
  releaseUrl:"https://github.com/penecho/penecho/releases/tag/v1.3.5",
  notes:fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8").split("## 1.3.5")[1].split("## 1.3.3")[0].trim(),
};
if (process.argv[3]) {
  const release = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  Object.assign(state, { version:release.tag_name.replace(/^v/, ""), notes:release.body, releaseUrl:release.html_url });
}
const report = { platform:process.platform, architecture:process.arch, states:[] };
const settle = () => new Promise(resolve => setTimeout(resolve, 250));
function broadcast() {
  for (const win of [updateWindow, canvasWindow]) if (win && !win.isDestroyed()) win.webContents.send("penecho:update-state", state);
}
ipcMain.handle("penecho:get-update-state", () => state);
ipcMain.handle("penecho:update-show-window", () => { updateWindow.show(); state.windowOpen = true; broadcast(); return true; });
ipcMain.handle("penecho:update-window-close", () => { updateWindow.hide(); state.windowOpen = false; broadcast(); return true; });
for (const channel of ["check", "download", "install", "open-release-page"]) {
  ipcMain.handle(`penecho:update-${channel}`, () => { report.lastAction = channel; return true; });
}
ipcMain.on("penecho:set-language", () => {});

async function run() {
  await app.whenReady();
  server = http.createServer((req, res) => {
    const relative = new URL(req.url, "http://localhost").pathname === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]).slice(1);
    const file = path.resolve(root, "public", relative);
    if (!file.startsWith(path.join(root, "public") + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    const types = { ".css":"text/css", ".html":"text/html", ".png":"image/png", ".webp":"image/webp", ".svg":"image/svg+xml" };
    res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
    let content = fs.readFileSync(file);
    if (relative === "index.html") content = content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    res.end(content);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  canvasWindow = new BrowserWindow({ width:1200, height:760, show:false, webPreferences:{ offscreen:process.platform === "win32", preload:path.join(root, "desktop/canvas-preload.js"), sandbox:true, contextIsolation:true } });
  updateWindow = new BrowserWindow({ width:520, height:580, show:false, autoHideMenuBar:true, webPreferences:{ offscreen:process.platform === "win32", preload:path.join(root, "desktop/update-window-preload.js"), sandbox:true, contextIsolation:true } });
  await Promise.all([
    canvasWindow.loadURL(`http://127.0.0.1:${server.address().port}/`),
    updateWindow.loadFile(path.join(root, "desktop/update-window.html")),
  ]);
  report.hiddenStates = [];
  for (const status of ["idle", "checking", "error", "up-to-date"]) {
    state = { ...state, status, updateAvailable:false, visible:true };
    broadcast();
    await settle();
    const layout = await canvasWindow.webContents.executeJavaScript(`(() => {
      const prompt = document.querySelector('#desktopUpdatePrompt');
      return { hidden:prompt.hidden, display:getComputedStyle(prompt).display, width:prompt.getBoundingClientRect().width, titleX:document.querySelector('#canvasDocumentMeta').getBoundingClientRect().x };
    })()`);
    assert.equal(layout.hidden, true);
    assert.equal(layout.display, "none");
    assert.equal(layout.width, 0, "Hidden update entry must not reserve title-bar space");
    if (report.hiddenStates.length) assert.equal(layout.titleX, report.hiddenStates[0].titleX);
    report.hiddenStates.push({ status, ...layout });
  }
  fs.writeFileSync(path.join(output, `topbar-no-update-${process.platform}.png`), (await canvasWindow.webContents.capturePage({ x:0, y:0, width:1200, height:140 })).toPNG());
  for (const status of ["available", "downloading", "ready"]) {
    state = { ...state, status, updateAvailable:true, progress:62, ready:status === "ready", windowOpen:true };
    broadcast();
    await settle();
    const bounds = await updateWindow.webContents.executeJavaScript(`(() => {
      const notes = document.querySelector('#release-notes'), footer = document.querySelector('.update-footer'), image = document.querySelector('.update-mark');
      return { status:document.body.dataset.state, logo:image.complete && image.naturalWidth > 0,
        notes:notes.textContent, notesHeight:notes.clientHeight, scrollHeight:notes.scrollHeight,
        notesBottom:notes.getBoundingClientRect().bottom, footerTop:footer.getBoundingClientRect().top,
        footerBottom:footer.getBoundingClientRect().bottom, height:innerHeight };
    })()`);
    assert.equal(bounds.status, status);
    assert(bounds.logo, "Local logo must load");
    assert(bounds.notes.length > 0);
    assert(bounds.notesHeight > 100 && bounds.notesBottom <= bounds.footerTop);
    assert(bounds.footerBottom <= bounds.height);
    report.states.push(bounds);
    fs.writeFileSync(path.join(output, `update-${status}-${process.platform}.png`), (await updateWindow.webContents.capturePage()).toPNG());
    const placement = await canvasWindow.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('#desktopUpdatePrompt button'), brand = document.querySelector('.brand'), title = document.querySelector('#canvasDocumentMeta');
      button.focus();
      const rect = node => { const r = node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right}; };
      return { button:rect(button), brand:rect(brand), title:rect(title), visible:!button.parentElement.hidden, label:button.getAttribute('aria-label') };
    })()`);
    assert(placement.visible && placement.button.x >= placement.brand.right && placement.button.right <= placement.title.x);
    assert.equal(placement.button.width, 26);
    report.states.at(-1).placement = placement;
    await settle();
    fs.writeFileSync(path.join(output, `topbar-${status}-${process.platform}.png`), (await canvasWindow.webContents.capturePage({ x:0, y:0, width:1200, height:140 })).toPNG());
  }
  // Closing the window must leave the completed-download indicator available.
  await updateWindow.webContents.executeJavaScript("document.querySelector('#close-button').click()");
  await settle();
  assert.equal(state.status, "ready");
  assert.equal(state.windowOpen, false);
  await canvasWindow.webContents.executeJavaScript("document.querySelector('#desktopUpdatePrompt button').click()");
  await settle();
  assert.equal(state.windowOpen, true);
  assert.equal(report.lastAction, undefined);
  updateWindow.setSize(400, 480);
  state = { ...state, status:"downloading", ready:false };
  broadcast();
  await settle();
  const compact = await updateWindow.webContents.executeJavaScript(`({ notesHeight:document.querySelector('#release-notes').clientHeight, footerBottom:document.querySelector('.update-footer').getBoundingClientRect().bottom, height:innerHeight })`);
  assert(compact.notesHeight > 60 && compact.footerBottom <= compact.height);
  report.compact = compact;
  fs.writeFileSync(path.join(output, "render-verification.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ success:true, output, states:report.states.length }));
}
let exitCode = 0;
run().catch(error => { console.error(error); exitCode = 1; }).finally(() => {
  if (server) server.close();
  for (const win of [canvasWindow, updateWindow]) if (win && !win.isDestroyed()) win.destroy();
  try { fs.rmSync(profile, { recursive:true, force:true }); }
  catch (error) {
    // Windows may retain Chromium file handles until the process exits.
    fs.writeFileSync(path.join(output, "temporary-profile.txt"), profile);
    console.warn(`Temporary profile cleanup deferred: ${error.code}`);
  }
  app.exit(exitCode);
});
