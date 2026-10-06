"use strict";
// Render canonical assets with an instrumented response and an isolated profile.
// No saved user document, running service or model connection is used.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict"), { Readable } = require("node:stream");
const sharp = require("sharp");
const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-ink-stacking-"));
const directory = path.join(root, "docs/verification/widget-ink-stacking-20261001");
fs.mkdirSync(directory, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, {
  NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"),
  HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"isolated-ink-test",
  AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test",
  PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false",
});
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) {
    const code = fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/,
      "window.inkTest={state,restoreWidgets,render,setCanvasMode,setWidgetInteraction,setWidgetMaximized,focusHandObject,stroke,renderLiveInkDrawing,clearLiveInkLayer,createTextEditor,confirmTextEditor,clearWidgetRefineCandidate,updateWidgetRefinePointer,closeCanvasAgent};})();");
    return Readable.from([code]);
  }
  return readStream.call(this, file, ...args);
};
const report = { directory, checks:[], errors:[], samples:[] };
let server, win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await pause(100); }
  throw Error(`Timed out: ${label}`);
}
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:true, width:1200, height:900,
      webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:false } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    const js = code => win.webContents.executeJavaScript(code, true);
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await until(() => js("!!window.inkTest"), "application startup");
    await js(`document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();inkTest.closeCanvasAgent();if(document.querySelector('#studioNavigatorToggle')?.getAttribute('aria-expanded')==='true')document.querySelector('#studioNavigatorToggle').click();`);
    const html = `<!doctype html><style>html,body{margin:0;height:100%;font:18px system-ui}#surface{position:absolute;inset:0;background:#fee4b7}button{position:absolute;left:80px;top:110px;width:180px;height:44px;background:#fff;border:1px solid #888}</style><div id="surface"><button id="action">Widget action</button></div><script>window.actionCount=0;document.querySelector('#action').onclick=()=>actionCount++;<\/script>`;
    await js(`(()=>{const n=inkTest,s=n.state;s.auto=false;s.scale=1;s.panX=0;s.panY=0;n.restoreWidgets(${JSON.stringify([
      { id:"ink-widget", pluginId:"general", widgetType:"html_widget", x:150, y:200, w:550, h:350,
        contentW:550, contentH:350, title:"Widget beneath handwriting — 长标题检查", refreshSeconds:0, html },
    ])});n.setCanvasMode('pen');n.stroke({x:200,y:330},{x:650,y:330},false,18,false,'#ef163d');n.render();window.originalInkFrame=s.widgets[0].frame;})()`);
    await until(() => js("inkTest.state.widgets.every(w=>w.hostReady&&w.initialized&&w.contentVersion>0)"), "live Widget");
    await pause(700);
    await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();window.PenEchoStudioNavigator?.updateDocument()");
    const layers = () => js(`(()=>{const z=id=>Number(getComputedStyle(document.getElementById(id)).zIndex);return {widget:z('widgetLayer'),ink:z('inkLayer'),live:z('liveInkLayer'),chrome:z('objectChromeLayer'),interaction:z('interactionLayer'),editor:z('textEditorLayer'),materialHidden:document.querySelector('#selectedWidgetMaterial').hidden};})()`);
    const point = (x = 400, y = 330) => js(`(()=>{const r=document.querySelector('#viewport').getBoundingClientRect(),s=inkTest.state;return {x:r.x+s.panX+${x}*s.scale,y:r.y+s.panY+${y}*s.scale};})()`);
    const pixel = async (label, name, logicalX = 400, logicalY = 330) => {
      await pause(120);
      const capture = (await win.webContents.capturePage()).toPNG();
      if (name) fs.writeFileSync(path.join(directory, `${name}.png`), capture);
      const { data, info } = await sharp(capture).removeAlpha().raw().toBuffer({ resolveWithObject:true });
      const p = await point(logicalX, logicalY), [width, height] = await js("[innerWidth,innerHeight]");
      const x = Math.round(p.x * info.width / width), y = Math.round(p.y * info.height / height);
      assert.ok(x >= 0 && x < info.width && y >= 0 && y < info.height, `${label}: sample is visible`);
      const offset = (y * info.width + x) * info.channels;
      const rgb = [...data.subarray(offset, offset + 3)];
      report.samples.push({ label, rgb, layers:await layers() });
      return rgb;
    };
    const red = rgb => rgb[0] > 200 && rgb[1] < 65 && rgb[2] < 100;
    const assertInk = async (label, name) => assert.ok(red(await pixel(label, name)), `${label}: original ink stays sharp and on top`);
    await assertInk("ordinary Widget");
    win.webContents.debugger.attach("1.3");
    const mouse = (type, p, extra = {}) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type, ...p, ...extra });
    const click = async p => {
      await mouse("mouseMoved", p, { button:"none" });
      await mouse("mousePressed", p, { button:"left", buttons:1, clickCount:1 });
      await mouse("mouseReleased", p, { button:"left", buttons:0, clickCount:1 });
      await pause(100);
    };
    await mouse("mouseMoved", await point(), { button:"none" });
    await assertInk("Pen hover");
    await js("inkTest.setCanvasMode('hand');inkTest.focusHandObject('widget',inkTest.state.widgets[0],'stacking-test');inkTest.render()");
    assert.equal((await layers()).materialHidden, false);
    assert.ok((await layers()).chrome > (await layers()).ink);
    await assertInk("selected Widget and frosted material", "selected-widget");
    await js("inkTest.setWidgetInteraction(inkTest.state.widgets[0],{inPlace:true});inkTest.render()");
    await assertInk("inline interaction", "inline-interaction");
    report.input = await js("(()=>{const w=inkTest.state.widgets[0],p={x:300,y:document.querySelector('#viewport').getBoundingClientRect().y+330},e=document.elementFromPoint(p.x,p.y);return {mode:inkTest.state.mode,inPlace:inkTest.state.widgetInteractionInPlace,inert:w.frame.inert,pointerEvents:getComputedStyle(w.frame).pointerEvents,hit:e?.className};})()");
    await click(await point(300, 330));
    let actionCount = 0;
    for (const frame of win.webContents.mainFrame.framesInSubtree) {
      if (frame.url === "about:srcdoc") {
        const input = await frame.executeJavaScript("(()=>{const e=document.querySelector('#action'),r=e?.getBoundingClientRect();return {count:window.actionCount||0,button:r?{x:r.x,y:r.y,w:r.width,h:r.height}:null,interactive:document.documentElement.dataset};})()");
        report.input.content = input;
        actionCount += input.count;
      }
    }
    assert.equal(actionCount, 1, "ink does not intercept the Widget button beneath it");
    report.checks.push("Committed strokes cover ordinary, hovered, selected and interacting Widgets; frosted material stays below ink; native clicks pass through ink to Widget controls.");

    await js("inkTest.setWidgetInteraction(null);inkTest.focusHandObject('widget',inkTest.state.widgets[0],'stacking-test');inkTest.render()");
    const start = await js("(()=>{const r=document.querySelector('.widget-object-toolbar').getBoundingClientRect();return {x:r.x+6,y:r.y+r.height/2};})()"),
      end = { x:start.x + 25, y:start.y + 15 };
    await mouse("mousePressed", start, { button:"left", buttons:1, clickCount:1 });
    await mouse("mouseMoved", end, { button:"left", buttons:1 });
    await assertInk("dragging Widget");
    await mouse("mouseReleased", end, { button:"left", buttons:0, clickCount:1 });
    assert.ok(await js("inkTest.state.widgets[0].x > 150"), "native drag moves the Widget");
    await js("inkTest.renderLiveInkDrawing({color:'#ef163d',erase:false,samples:[{point:{x:200,y:360},size:18},{point:{x:650,y:360},size:18}]})");
    assert.equal((await layers()).live, (await layers()).ink);
    assert.ok(red(await pixel("live ink", undefined, 400, 360)), "live ink also covers the selected Widget");
    await js("inkTest.clearLiveInkLayer()");
    report.checks.push("Native object dragging preserves ink visibility and iframe identity; live and committed ink share the same foreground order.");

    await js("window.inkEditor=inkTest.createTextEditor({x:300,y:275},{widthCss:320,heightCss:170,fontCss:48});inkEditor.textarea.value='WWWWWW';inkTest.render()");
    assert.ok((await layers()).editor > (await layers()).ink);
    assert.equal(red(await pixel("active text editor", "text-editor")), false, "active editor covers ink in its input region");
    await js("inkTest.confirmTextEditor(inkEditor);inkTest.render()");
    await until(() => js("inkTest.state.textEditors.size===0 && inkTest.state.textBoxes.length===1"), "text commit");
    await js("inkTest.render()");
    await assertInk("committed text returns below ink");
    report.checks.push("Text input and caret remain above ink; committed text returns below ink.");

    await js("inkTest.setCanvasMode('select');inkTest.state.selection={phase:'lasso',points:[{x:400,y:330},{x:550,y:290},{x:550,y:420}],box:null};inkTest.render()");
    assert.ok((await layers()).interaction > (await layers()).ink);
    assert.ok((await layers()).interaction > (await layers()).chrome);
    await pixel("lasso foreground", "lasso");
    await js("inkTest.state.selection=null;inkTest.setWidgetInteraction(inkTest.state.widgets[0],{inPlace:true});inkTest.setWidgetMaximized(inkTest.state.widgets[0],true);inkTest.render()");
    assert.equal(await js("inkTest.state.widgets[0].shell.matches(':popover-open')"), true);
    assert.equal(red(await pixel("maximized Widget", "maximized-widget")), false, "maximized Widget covers main Canvas ink");
    await js("inkTest.setWidgetMaximized(inkTest.state.widgets[0],false);inkTest.setWidgetInteraction(null);inkTest.render()");
    await assertInk("return from maximized Widget");
    report.checks.push("Lasso is above ink and object chrome; maximized Widget uses the browser top layer, and returning restores foreground ink.");

    await mouse("mouseMoved", await point(900, 650), { button:"none" });
    await js("inkTest.setCanvasMode('hand');inkTest.updateWidgetRefinePointer(null);inkTest.clearWidgetRefineCandidate();inkTest.render()");
    for (const [name, width, height, zoom, scale] of [["narrow",430,820,1,.5],["zoom-200",1200,900,2,.35]]) {
      win.setContentSize(width, height); win.webContents.setZoomFactor(zoom);
      await pause(200);
      await js(`inkTest.state.scale=${scale};inkTest.state.panX=0;inkTest.state.panY=0;inkTest.render()`);
      await assertInk(name, name);
      assert.ok(await js("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"), `${name}: no page overflow`);
    }
    assert.equal(await js("inkTest.state.widgets[0].frame===window.originalInkFrame"), true);
    assert.deepEqual(report.errors, [], "no renderer console errors");
    report.checks.push("Narrow window and actual Electron 200% zoom preserve stacking without page overflow; live iframe identity is unchanged; no renderer console errors.");
    report.ok = true;
  } catch (error) {
    report.ok = false; report.error = error.stack;
    if (win) fs.writeFileSync(path.join(directory, "failure.png"), (await win.webContents.capturePage()).toPNG());
  } finally {
    fs.createReadStream = readStream;
    if (report.ok) fs.rmSync(path.join(directory, "failure.png"), { force:true });
    fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    win?.destroy();
    if (server) { server.closeAllConnections?.(); server.close(); }
    app.exit(report.ok ? 0 : 1);
  }
});
