"use strict";
// Isolated acceptance against the canonical generated client; no model calls.
// Run with tools/electron/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lasso-widget-")),
  output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || temporary);
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) {
    const client = fs.readFileSync(file, "utf8");
    report.clientSha256 = require("node:crypto").createHash("sha256").update(client).digest("hex");
    const injection = "window.lassoWidgetTest={state,canvasDocumentsReady,loadCanvasSettings,restoreWidgets,render,setCanvasMode,setWidgetInteraction,canvasWidgetInteractive,setSmartSuggestEnabled,hideHandObjectToolbar,updateWidgetRefinePointer,cancelSelection};";
    return Readable.from([client.replace(/\}\)\(\);\s*$/, injection + "})();")]);
  }
  return readStream.call(this, file, ...args);
};
const report = { checks:[], errors:[], physicalTouchDeviceTested:false };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await pause(100); }
  throw Error(`Timed out: ${label}`);
}
let server, win;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1024, height:900, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    const js = code => win.webContents.executeJavaScript(code, true);
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await until(() => js("!!window.lassoWidgetTest"), "application startup");
    const html = '<!doctype html><style>html,body{margin:0;height:100%;background:#e7eef8;font:22px system-ui}body{padding:24px;box-sizing:border-box}</style><h2>Lasso Widget interaction</h2><button>Live content</button><script>window.activationPointerCount=0;addEventListener("pointerdown",()=>activationPointerCount++);<\/script>';
    await js(`(async()=>{const t=lassoWidgetTest,s=t.state;await t.canvasDocumentsReady();await t.loadCanvasSettings();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();s.auto=false;t.setSmartSuggestEnabled(false);s.scale=1;s.panX=0;s.panY=0;t.restoreWidgets(${JSON.stringify([{ id:"lasso-widget", pluginId:"general", widgetType:"html_widget", x:150, y:200, w:550, h:360, contentW:550, contentH:360, title:"Lasso Widget interaction", refreshSeconds:0, html }])});t.setCanvasMode('select');t.render();window.originalLassoWidgetFrame=s.widgets[0].frame;})()`);
    await until(() => js("lassoWidgetTest.state.widgets.every(w=>w.hostReady&&w.initialized&&w.contentVersion>0)"), "live Widget");
    await js("window.PenEchoStudioNavigator.updateDocument()");
    assert.equal(await js("document.querySelector('#canvasWelcome').hidden"),true,"fixture content dismisses the empty Canvas welcome layer");
    win.webContents.debugger.attach("1.3");
    const touch = (type, points = []) => win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", { type, touchPoints:points.map(([id, x, y]) => ({ id, x, y, radiusX:2, radiusY:2, force:1 })) });
    const tap = async (p, id = 1) => { await touch("touchStart", [[id,p.x,p.y]]); await touch("touchEnd"); };
    const mouse = (type, p, extra = {}) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type, x:p.x, y:p.y, button:type === "mouseMoved" ? "none" : "left", ...extra });
    const click = async (p, count = 1) => { await mouse("mousePressed",p,{buttons:1,clickCount:count}); await mouse("mouseReleased",p,{buttons:0,clickCount:count}); };
    const point = () => js("(()=>{const r=lassoWidgetTest.state.widgets[0].shell.getBoundingClientRect();return {x:r.x+r.width*.4,y:r.y+r.height*.4}})()");
    const center = selector => js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    const hasToolbar = () => js("!!document.querySelector('.object-chrome-button.interact')");
    const capture = async name => {
      await pause(250);
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      fs.writeFileSync(path.join(output,name),(await win.webContents.capturePage()).toPNG());
    };
    const reset = async () => {
      await js("(()=>{const t=lassoWidgetTest,s=t.state;t.setWidgetInteraction(null);if(s.selection)t.cancelSelection(true);s.widgetTouchLastTap=null;t.updateWidgetRefinePointer(null);t.hideHandObjectToolbar({all:true,animate:false});s.panX=0;s.panY=0;s.scale=1;t.setCanvasMode('select');localStorage.setItem('penecho.widgetInteractionPresentation','maximized');t.render();})()");
      await pause(250);
    };
    const assertActive = async (maximized = true) => {
      await until(() => js("lassoWidgetTest.state.interactingWidgetId===lassoWidgetTest.state.widgets[0].id"), "Widget activation");
      assert.deepEqual(await js("(()=>{const t=lassoWidgetTest,s=t.state,w=s.widgets[0];return {mode:s.mode,inPlace:s.widgetInteractionInPlace,live:t.canvasWidgetInteractive(w),maximized:w.maximized,sameFrame:w.frame===originalLassoWidgetFrame}})()"), {mode:"select",inPlace:true,live:true,maximized,sameFrame:true});
      assert.equal(await js("lassoWidgetTest.state.widgets[0].shell.matches(':popover-open')"),maximized,"presentation uses the visible top layer");
      for (const frame of win.webContents.mainFrame.framesInSubtree.filter(frame => frame.url === "about:srcdoc")) {
        const count = await frame.executeJavaScript("window.activationPointerCount");
        if (typeof count === "number") assert.equal(count,0,"activation input is never replayed into Widget content");
      }
    };
    const exit = async () => {
      await click(await center(".widget-presentation-toolbar button:last-child"));
      await until(() => js("!lassoWidgetTest.state.interactingWidgetId"), "presentation exit");
      assert.equal(await js("lassoWidgetTest.state.mode"),"select");
    };
    for (const [name,width,height] of [["tablet",1024,900],["phone",390,844]]) {
      win.setSize(width,height); await pause(300); await reset();
      await js(`(()=>{const w=lassoWidgetTest.state.widgets[0];w.x=${name === "phone" ? 40 : 150};w.y=${name === "phone" ? 140 : 200};w.w=${name === "phone" ? 280 : 550};w.h=${name === "phone" ? 230 : 360};lassoWidgetTest.render();})()`);
      let p = await point();
      await tap(p);
      await until(hasToolbar,"finger tap header");
      assert.equal(await js("lassoWidgetTest.state.interactingWidgetId"),null);
      assert.equal(await js("lassoWidgetTest.state.selectedWidgetId"),null);
      await capture(`${name}-touch-toolbar.png`);
      await tap(await center(".object-chrome-button.interact"),2);
      await assertActive(); await exit();
      report.checks.push(`${name}: finger tap reveals the toolbar and native touch on Interact maximizes the same live Widget, retaining Lasso after exit`);

      await reset(); p = await point();
      await tap(p); await pause(100); await tap({x:p.x+4,y:p.y+2},2);
      await assertActive();
      await capture(`${name}-double-tap-maximized.png`);
      await exit();
      report.checks.push(`${name}: native finger double tap maximizes without selecting the Widget or replaying input into its iframe`);

      await reset(); p = await point();
      await mouse("mouseMoved",{x:p.x+20,y:p.y+10}); await mouse("mouseMoved",p);
      await until(hasToolbar,"mouse hover toolbar");
      const control = await center(".object-chrome-button.interact");
      assert.equal(await js(`document.elementFromPoint(${control.x},${control.y})?.closest('.object-chrome-button')?.classList.contains('interact')`),true,"hover toolbar accepts input");
      await click(control); await assertActive(); await exit();
      await reset(); p = await point();
      await click(p); await click(p,2); await assertActive(); await exit();
      report.checks.push(`${name}: native mouse hover exposes an actionable toolbar and native mouse double click maximizes while Lasso remains active`);

      await reset(); p = await point();
      await tap(p); await touch("touchStart",[[2,p.x,p.y]]); await touch("touchMove",[[2,p.x+30,p.y+20]]); await touch("touchEnd");
      assert.ok(await js("lassoWidgetTest.state.panX>=29"),"finger drag still pans");
      p = await point(); await tap(p,3);
      assert.equal(await js("lassoWidgetTest.state.interactingWidgetId"),null,"drag breaks the double-tap pair");
      await reset(); p = await point();
      await tap(p); await touch("touchStart",[[2,p.x,p.y]]); await touch("touchStart",[[2,p.x,p.y],[3,p.x+60,p.y]]);
      await touch("touchMove",[[2,p.x-10,p.y],[3,p.x+70,p.y]]); await touch("touchEnd");
      assert.ok(await js("lassoWidgetTest.state.scale>1"),"two fingers still zoom");
      p = await point(); await tap(p,4);
      assert.equal(await js("lassoWidgetTest.state.interactingWidgetId"),null,"multi-touch breaks the pair");
      report.checks.push(`${name}: finger pan and two-finger zoom retain navigation and interrupt pending double taps`);
    }
    win.setSize(1024,900); await pause(300); await reset();
    let p = await point();
    await mouse("mousePressed",p,{buttons:1,clickCount:1});
    for (const [dx,dy] of [[80,0],[80,90],[-40,90],[-40,0],[0,0]]) await mouse("mouseMoved",{x:p.x+dx,y:p.y+dy},{button:"left",buttons:1});
    await mouse("mouseReleased",p,{buttons:0,clickCount:1});
    assert.equal(await js("lassoWidgetTest.state.selection?.phase"),"active","mouse drag over a Widget still captures a lasso");
    assert.equal(await js("lassoWidgetTest.state.selectedWidgetId"),null);
    assert.equal(await js("lassoWidgetTest.state.interactingWidgetId"),null);
    // A finger can activate the Widget while an existing lasso remains intact.
    await js("window.previousLassoSelection=lassoWidgetTest.state.selection");
    await tap(p); await pause(100); await tap(p,2); await assertActive(); await exit();
    assert.equal(await js("lassoWidgetTest.state.selection===previousLassoSelection"),true,"presentation preserves the existing lasso");
    report.checks.push("Mouse drag still captures Lasso over Widget content; subsequent touch presentation and exit preserve that selection");

    await reset(); await js("localStorage.setItem('penecho.widgetInteractionPresentation','canvas')"); p = await point();
    await tap(p); await pause(100); await tap(p,2); await assertActive(false);
    // Keep the exit tap outside the existing edge-swipe navigation strip.
    const blank = await js("(()=>{const r=document.querySelector('#screen').getBoundingClientRect();return {x:r.left+80,y:r.top+80}})()");
    assert.equal(await js(`document.elementFromPoint(${blank.x},${blank.y})===document.querySelector('#screen')`),true,"exit tap hits blank Canvas");
    await tap(blank,3);
    assert.equal(await js("lassoWidgetTest.state.interactingWidgetId"),null);
    assert.equal(await js("lassoWidgetTest.state.selection"),null,"exit tap leaves no stray lasso");
    assert.equal(await js("lassoWidgetTest.state.mode"),"select");
    report.checks.push("Saved in-place presentation preference is retained; blank Canvas exit leaves no stray lasso and retains the Lasso tool");
    assert.deepEqual(report.errors,[]);
    fs.rmSync(path.join(output,"failure.png"),{force:true});
    report.ok = true;
  } catch (error) {
    report.failure = error.stack || String(error);
    if (win && !win.isDestroyed()) {
      report.failureState = await win.webContents.executeJavaScript("(()=>{const s=window.lassoWidgetTest?.state,w=s?.widgets[0],r=w?.shell.getBoundingClientRect(),hit=r&&document.elementFromPoint(r.x+r.width*.4,r.y+r.height*.4);return {mode:s?.mode,viewMode:s?.viewMode,selection:s?.selection?.phase,gesture:s?.selectionGesture?.hit,touches:s?.touches.size,handTap:!!s?.handToolbarTap,pending:!!s?.pending,pendingWidget:!!s?.pendingWidget,imageEdit:!!s?.imageEdit,animationEdit:!!s?.animationEdit,rect:r?.toJSON(),hit:hit&&{tag:hit.tagName,id:hit.id}}})()");
      fs.writeFileSync(path.join(output,"failure.png"),(await win.webContents.capturePage()).toPNG());
    }
  }
  finally {
    win?.destroy();
    if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
    report.serverClosed = !server?.listening;
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    if (output !== temporary) fs.rmSync(temporary,{recursive:true,force:true});
    app.exit(report.ok ? 0 : 1);
  }
});
