"use strict";

// Run with tools/electron/node_modules/.bin/electron. Uses isolated local data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-favorite-loading-"));
const baseline = process.argv.includes("--baseline"), mirror = process.argv.includes("--mirror");
const name = baseline ? "before" : mirror ? "cloud-mirror" : "after";
const output = path.resolve(process.env.PENECHO_VERIFY_OUTPUT || path.join(root, "docs/verification/widget-favorite-loading-20261002"));
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, {
  NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"),
  HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only",
  AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false",
});
const originalStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) {
    return Readable.from([fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, "window.favoriteTest={state,smartSuggest,canvasDocumentsReady,restoreWidgets,render,setCanvasMode,hideHandObjectToolbar,updateWidgetRefinePointer};})();")]);
  }
  if (mirror && path.resolve(String(file)) === path.join(root, "public/style.css")) {
    return originalStream.call(this, path.resolve(root, "../penecho_cloud/public/canvas/style.css"), ...args);
  }
  return originalStream.call(this, file, ...args);
};
const report = { name, checks:[], cases:[], errors:[] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 150; i++) { if (await check()) return; await pause(100); }
  throw new Error(`Timed out: ${label}`);
}
let win, server;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1200, height:900, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    const js = code => win.webContents.executeJavaScript(code, true);
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await until(() => js("!!window.favoriteTest && !!window.PenEchoCommunityCanvas"), "Canvas startup");
    await js("favoriteTest.canvasDocumentsReady().then(()=>{favoriteTest.state.auto=false;favoriteTest.smartSuggest.enabled=false;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();if(document.body.classList.contains('studio-navigator-open'))document.querySelector('#studioNavigatorToggle')?.click();})");
    await js(`(() => {
      const bridge = window.PenEchoCommunityCanvas;
      window.PenEchoCommunityCanvas = {...bridge, widgetArtifact:async (...args) => {
        window.favoriteSnapshotWaiting = true;
        await new Promise(resolve => { window.releaseFavoriteSnapshot = resolve; });
        window.favoriteSnapshotWaiting = false;
        return bridge.widgetArtifact(...args);
      }};
    })()`);
    win.webContents.debugger.attach("1.3");
    const inspect = () => js(`(() => {
      const button=document.querySelector('.object-chrome-button.favorite'), rect=button.getBoundingClientRect();
      const pseudo=which=>{const s=getComputedStyle(button,which);return {content:s.content,display:s.display,width:s.width,height:s.height,animation:s.animationName,position:s.position,border:s.borderTopWidth};};
      return {busy:button.getAttribute('aria-busy'),pressed:button.getAttribute('aria-pressed'),disabled:button.disabled,
        before:pseudo('::before'),after:pseudo('::after'),svgDisplay:getComputedStyle(button.querySelector('svg')).display,
        rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
    })()`);
    const settings = baseline ? [{width:1200,scale:1,zoom:1,theme:"studio"}] : [
      {width:1200,scale:1,zoom:1,theme:"studio"},
      {width:390,scale:.65,zoom:1,theme:"studio"},
      {width:1200,scale:.8,zoom:1.25,theme:"studio"},
      {width:1200,scale:1,zoom:1,theme:"classic"},
    ];
    for (const [index, config] of settings.entries()) {
      win.setContentSize(config.width, 900);
      win.webContents.setZoomFactor(config.zoom);
      await js(`(() => {
        const t=favoriteTest,s=t.state;t.updateWidgetRefinePointer(null);t.hideHandObjectToolbar({all:true,animate:false});
        s.widgetHeaderHoverId=null;s.widgetHeaderPendingId=null;t.setCanvasMode('pen');
        s.scale=${config.scale};s.panX=0;s.panY=0;document.body.dataset.theme=${JSON.stringify(config.theme)};
        t.restoreWidgets([{id:'favorite-widget-${index}',pluginId:'general',widgetType:'html_widget',x:30,y:180,w:480,h:260,contentW:480,contentH:260,refreshSeconds:0,title:'Favorite loading',html:'<!doctype html><style>body{margin:0;padding:24px;background:#eef2f6;font:20px system-ui}</style><h2>Favorite loading</h2><p>Isolated verification Widget</p>'}]);
        t.render();document.querySelector('#canvasWelcome').hidden=true;
      })()`);
      await until(() => js("favoriteTest.state.widgets[0]?.hostReady && favoriteTest.state.widgets[0]?.initialized"), "Widget ready");
      const point = await js("(()=>{const r=favoriteTest.state.widgets[0].shell.getBoundingClientRect();return {x:r.x+20,y:r.y+40};})()");
      await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type:"mouseMoved",...point,button:"none"});
      await until(() => js("!!document.querySelector('.object-chrome-button.favorite')"), "Favorite button");
      const idle = await inspect();
      await js("document.querySelector('.object-chrome-button.favorite').click()");
      await until(() => js("window.favoriteSnapshotWaiting===true"), "Real favorite snapshot pause");
      const busy = await inspect();
      assert.equal(busy.busy, "true");
      assert.equal(busy.disabled, true);
      assert.deepEqual(busy.rect, idle.rect, "Favorite button geometry stays stable");
      assert.equal(busy.before.animation, "pe-public-spin", "Existing catalog loading ring keeps rotating");
      assert.equal(busy.before.width, "11px");
      assert.equal(busy.before.height, "11px");
      if (baseline) assert.equal(busy.after.animation, "history-save-spin", "Reproduce the rotating toolbar separator");
      else {
        assert.equal(busy.after.animation, "none", "Toolbar separator stays stationary");
        assert.deepEqual(busy.after, idle.after, "Busy state does not change the toolbar separator");
      }
      await pause(150);
      fs.writeFileSync(path.join(output, `${name}-${index}-loading.png`), (await win.webContents.capturePage()).toPNG());
      await js("document.querySelector('.object-chrome-button.favorite').click();releaseFavoriteSnapshot()");
      await until(() => js("favoriteTest.state.widgets[0].favorite && !favoriteTest.state.widgets[0].favoriteBusy"), "Favorite saved");
      const saved = await inspect();
      assert.equal(saved.pressed, "true");
      assert.equal(saved.busy, null);
      assert.equal(saved.disabled, false);
      assert.equal(saved.after.animation, "none", "Saved button has no loading animation");
      assert.equal(await js("getComputedStyle(document.querySelector('.object-chrome-button.favorite svg')).fill === getComputedStyle(document.querySelector('.object-chrome-button.favorite')).color"), true, "Saved star stays filled");
      await js("document.querySelector('.object-chrome-button.favorite').click()");
      await until(() => js("!favoriteTest.state.widgets[0].favorite && !favoriteTest.state.widgets[0].favoriteBusy"), "Unfavorite");
      assert.equal((await inspect()).pressed, "false");
      report.cases.push({config,idle,busy,saved});
    }
    if (!baseline) {
      const generic = await js(`(() => {const b=document.createElement('button');b.dataset.peButton='secondary';b.setAttribute('aria-busy','true');document.body.append(b);const s=getComputedStyle(b,'::before'),result={content:s.content,animation:s.animationName};b.remove();return result;})()`);
      assert.equal(generic.animation, "pe-public-spin", "Other busy buttons retain their catalog spinner");
      report.checks.push("Generic busy button spinner remains available");
      await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {features:[{name:"prefers-reduced-motion",value:"reduce"}]});
      await js("PenEchoCommunityCanvas.setWidgetFavorite(favoriteTest.state.widgets[0].id,undefined,true)");
      const reduced = await inspect();
      assert.equal(reduced.after.animation, "none");
      report.checks.push("Reduced motion also leaves the toolbar separator stationary");
    }
    report.checks.push("Real favorite click, snapshot busy state, repeated click, saved filled star and unfavorite pass in every case");
    assert.deepEqual(report.errors, []);
    fs.rmSync(path.join(output, `${name}-failure.png`), {force:true});
    console.log(JSON.stringify({name,checks:report.checks,cases:report.cases.length,errors:report.errors},null,2));
  } catch (error) {
    report.failure = error.stack;
    process.exitCode = 1;
    console.error(error);
    if (win) fs.writeFileSync(path.join(output, `${name}-failure.png`), (await win.webContents.capturePage()).toPNG());
  } finally {
    fs.writeFileSync(path.join(output, `${name}-report.json`), JSON.stringify(report,null,2));
    if (win && !win.isDestroyed()) win.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, {recursive:true,force:true});
    app.exit(report.failure ? 1 : 0);
  }
});
