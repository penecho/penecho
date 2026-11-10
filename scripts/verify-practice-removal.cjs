"use strict";
// Run: tools/electron/node_modules/.bin/electron scripts/verify-practice-removal.cjs
// Exercise the canonical Canvas and its officially synchronized Cloud mirror.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-practice-removal-"));
const output = path.join(root, "docs/verification/practice-removal-20260929");
const cloudPublic = path.resolve(root, "../penecho_cloud/public/canvas");
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
app.on("window-all-closed", () => {});
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary,"state"), PENECHO_CONFIG_FILE:path.join(temporary,"config.json"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" });
let useCloudMirror = false, server, win;
const originalStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  const relative = path.relative(path.join(root, "public"), path.resolve(String(file)));
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    if (useCloudMirror && fs.existsSync(path.join(cloudPublic, relative))) file = path.join(cloudPublic, relative);
    if (relative === "app.js") {
      const source = fs.readFileSync(file,"utf8").replace(/\}\)\(\);\s*$/, "window.practiceRemovalTest={state,canvasDocumentsReady,canvasAgentSuppressesAutomaticAI,penGestureAllowed};})();");
      return Readable.from([source]);
    }
  }
  return originalStream.call(this, file, ...args);
};
const report = { checks:[], errors:[] }, pause = ms => new Promise(resolve => setTimeout(resolve,ms));
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening",resolve));
    for (const target of ["local", "cloud-mirror"]) {
      useCloudMirror = target === "cloud-mirror";
      win = new BrowserWindow({ show:true, width:1280, height:900, webPreferences:{ contextIsolation:true, nodeIntegration:false, partition:`practice-removal-${target}` } });
      const js = source => win.webContents.executeJavaScript(source,true);
      win.webContents.on("console-message", (_event,level,message) => { if (level>=3) report.errors.push({target,message}); });
      await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
      await js("practiceRemovalTest.canvasDocumentsReady().then(()=>{practiceRemovalTest.state.auto=false;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();})");
      for (const language of ["zh", "en"]) {
        await js(`practiceRemovalTest.state.language=${JSON.stringify(language)};document.querySelector('#assistToolsBtn').click()`);
        await pause(300);
        const menu = await js("[...document.querySelectorAll('.assist-tools [data-tool]')].map(e=>({tool:e.dataset.tool,label:e.textContent,visible:e.getBoundingClientRect().width>0}))");
        assert.ok(menu.length && menu.every(item => item.visible), "Tools menu renders");
        assert.ok(menu.some(item => item.tool === "search") && menu.some(item => item.tool === "graph") && menu.some(item => item.tool === "graph3d"));
        assert.ok(menu.every(item => item.tool !== "handwriting" && !/练字|Handwriting practice/.test(item.label)));
        report.checks.push({ target, language, menu });
        fs.writeFileSync(path.join(output,`${target}-${language}-tools.png`),(await win.webContents.capturePage()).toPNG());
        await js("document.querySelector('[data-tool=search]').click()");
        await pause(150);
        assert.equal(await js("Boolean(document.querySelector('.canvas-search-panel .canvas-search-input'))"),true);
        await js("document.querySelector('.canvas-search-panel .pen-intel-close').click()");
      }
      assert.equal(await js("document.querySelectorAll('[class*=handwriting-coach]').length"),0);
      assert.equal(await js("practiceRemovalTest.canvasAgentSuppressesAutomaticAI()"),false);
      report.checks.push({ target, search:"opens and closes", practiceUI:"absent", automaticAI:"not suppressed" });
      win.destroy(); win = null;
    }
    assert.deepEqual(report.errors,[]);
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.failure = error.stack;
    console.error(error);
    if (win && !win.isDestroyed()) {
      const screenshot = await win.webContents.capturePage().catch(() => null);
      if (screenshot) fs.writeFileSync(path.join(output,"failure.png"),screenshot.toPNG());
    }
  } finally {
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2)+"\n");
    console.log(JSON.stringify(report,null,2));
    if (win && !win.isDestroyed()) win.destroy();
    server?.close();
    app.exit(report.passed ? 0 : 1);
  }
});
