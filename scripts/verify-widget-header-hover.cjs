"use strict";
// Real mouse routing across overlapping Widgets, with isolated local data.
// Run: tools/electron/node_modules/.bin/electron scripts/verify-widget-header-hover.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-header-hover-"));
const output = path.resolve(process.env.PENECHO_VERIFY_OUTPUT || path.join(root, "docs/verification/widget-header-hover-20260930"));
fs.mkdirSync(output, {recursive:true});
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary,"state"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" });
const originalStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) {
    const code = fs.readFileSync(file,"utf8").replace(/\}\)\(\);\s*$/, "window.headerTest={state,smartSuggest,canvasDocumentsReady,restoreWidgets,render,setCanvasMode,hideHandObjectToolbar,updateWidgetRefinePointer};})();");
    return Readable.from([code]);
  }
  return originalStream.call(this, file, ...args);
};
const report = {checks:[],layouts:[],errors:[]}, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, server;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({show:true,width:1200,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const js = code => win.webContents.executeJavaScript(code, true);
    win.webContents.on("console-message", (_event,level,message) => { if (level >= 3) report.errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await js("headerTest.canvasDocumentsReady().then(()=>{headerTest.state.auto=false;headerTest.smartSuggest.enabled=false;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();localStorage.setItem('penecho.widgetInteractionPresentation','canvas');})");
    win.webContents.debugger.attach("1.3");
    const mouse = (type,x,y,extra={}) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type,x,y,button:type === "mouseMoved" ? "none" : "left",...extra});
    const move = async (x,y) => { await mouse("mouseMoved",x,y); await pause(25); };
    const click = async (x,y) => { await move(x,y); await mouse("mousePressed",x,y,{buttons:1,clickCount:1}); await mouse("mouseReleased",x,y,{buttons:0,clickCount:1}); await pause(80); };
    const owner = () => js("({hover:headerTest.state.widgetRefineHoveredWidgetId,active:headerTest.state.handToolbarActiveKey})");
    const checkOwner = async label => assert.deepEqual(await owner(), {hover:"widget-2",active:"widget:widget-2"}, label);
    const rect = selector => js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};})()`);
    const body = () => rect('.canvas-widget[data-widget-id="widget-2"]');
    const header = () => rect('.object-toolbar-surface');
    const widget = (id,x,y,w,h,color) => ({id,pluginId:"general",widgetType:"html_widget",x,y,w,h,contentW:w,contentH:h,title:id,refreshSeconds:0,html:`<!doctype html><html><head><style>body{margin:0;height:${h}px;background:${color};font:20px system-ui}h2{margin:24px}button{margin:0 24px;padding:12px}</style></head><body><h2>${id === "widget-2" ? "Foreground Widget" : "Background Widget"}</h2><button id="action">Widget action</button><script>document.querySelector('#action').onclick=e=>e.currentTarget.textContent='Clicked';</script></body></html>`});
    async function setup({width=1200,scale=1,mode="pen",reversed=false}={}) {
      await move(1100,800);
      win.setContentSize(width,900); await pause(150);
      const widgets = [widget("widget-1",100,100,800,380,"#e8edf6"),widget("widget-2",220,300,600,300,"#f4f7ee")];
      if (reversed) widgets.reverse();
      await js(`(()=>{const t=headerTest,s=t.state;t.updateWidgetRefinePointer(null);t.hideHandObjectToolbar({animate:false,all:true});s.widgetHeaderHoverId=null;s.widgetHeaderPendingId=null;t.setCanvasMode(${JSON.stringify(mode)});s.scale=${scale};s.panX=${width<600?-90:0};s.panY=0;t.restoreWidgets(${JSON.stringify(widgets)});t.render();document.querySelector('#canvasWelcome').hidden=true;})()`);
      await pause(300);
      const b = await body();
      await move(Math.max(20,b.x+40), b.bottom-35); await pause(250);
      await checkOwner("hover reveals foreground header");
      return {b:await body(),h:await header()};
    }
    const cases = process.argv.includes("--interaction-only") ? [] : [{mode:"pen"},{mode:"hand"},{mode:"pen",scale:.65},{mode:"pen",width:390,scale:.65},{mode:"pen",reversed:true}];
    for (const settings of cases) {
      const {b,h} = await setup(settings), label = JSON.stringify(settings);
      report.layouts.push({settings,body:b,header:h,gap:b.y-h.bottom});
      assert.ok(Math.abs(b.y-h.bottom-10)<.15, `${label}: original 10 px visual gap is preserved`);
      const left = Math.max(b.x,h.x)+12, right = Math.min(b.right,h.right)-12;
      for (const x of [left,(left+right)/2,right]) {
        for (const y of [b.y+16,b.y+1,b.y-.5,(b.y+h.bottom)/2,h.bottom+.5,h.y+h.h/2,h.y+1,h.y+h.h/2,h.bottom+.5,(b.y+h.bottom)/2,b.y-.5,b.y+1,b.y+16]) {
          await move(x,y); await checkOwner(`${label}: seam x=${x} y=${y}`);
        }
        const hit = await js(`(()=>{const e=document.elementFromPoint(${x},${(b.y+h.bottom)/2});return {key:e?.closest('.object-chrome-button')?.penechoSpec?.handToolbarKey};})()`);
        assert.equal(hit.key,"widget:widget-2",`${label}: gap is a real foreground pointer target`);
      }
      // All header controls and the spaces between them keep one hover owner.
      for (let x=h.x+2; x<h.right-1; x+=5) { await move(x,h.y+h.h/2); await checkOwner(`${label}: across header`); }
      // The rounded corners are still inside the header's hover rectangle.
      for (const x of [h.x+.5,h.right-.5]) for (const y of [h.y+.5,h.bottom-.5]) {
        await move(x,y); await checkOwner(`${label}: header corner`);
      }
      await move((left+right)/2,h.y+h.h/2); await pause(1200); await checkOwner(`${label}: rests on header`);
      await move((left+right)/2,(b.y+h.bottom)/2); await pause(1200); await checkOwner(`${label}: rests in visual gap`);
      if (settings.reversed) assert.deepEqual(await js("headerTest.state.widgets.map(w=>w.id)"), ["widget-2","widget-1"], "passive hover leaves persistent stacking order unchanged");
      fs.writeFileSync(path.join(output,settings.width ? "narrow.png" : settings.reversed ? "raised-overlap.png" : `header-${settings.mode}-${settings.scale||1}.png`),(await win.webContents.capturePage()).toPNG());
      report.checks.push(`${label}: original 10 px spacing, gap pointer target, controls, corners and idle hover retain foreground ownership`);
    }
    let {b,h} = await setup();
    await click(h.x+16,(b.y+h.bottom)/2);
    assert.equal(await js("headerTest.state.selectedWidgetId"),"widget-2","pressing the gap selects the foreground Widget");
    assert.equal(await js("headerTest.state.drawing"),null,"gap press does not start a Canvas stroke");
    report.checks.push("Pressing the invisible gap targets the foreground Widget instead of underlying Canvas or Widgets");
    await move(h.x+16,h.y+h.h/2);
    await mouse("mousePressed",h.x+16,h.y+h.h/2,{buttons:1,clickCount:1});
    await mouse("mouseMoved",h.x+51,h.y+h.h/2+25,{button:"left",buttons:1});
    await mouse("mouseReleased",h.x+51,h.y+h.h/2+25,{buttons:0,clickCount:1}); await pause(150);
    const moved = await body();
    assert.ok(Math.abs(moved.x-b.x-35)<1 && Math.abs(moved.y-b.y-25)<1, "header grip still moves its Widget");
    const interact = await rect(".object-chrome-button.interact");
    await click(interact.x+interact.w/2,interact.y+interact.h/2);
    assert.equal(await js("headerTest.state.interactingWidgetId"), "widget-2");
    let foregroundFrame;
    for (const frame of win.webContents.mainFrame.framesInSubtree) if (frame.url === "about:srcdoc" && await frame.executeJavaScript("document.body.textContent.includes('Foreground Widget')")) foregroundFrame = frame;
    assert.ok(foregroundFrame);
    const frameRect = await rect('.canvas-widget[data-widget-id="widget-2"] iframe'),
      action = await foregroundFrame.executeJavaScript("(()=>{const r=document.querySelector('#action').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight};})()");
    const actionPoint = {x:frameRect.x+action.x*frameRect.w/action.width,y:frameRect.y+action.y*frameRect.h/action.height};
    report.interaction = {frameRect,action,actionPoint,host:await js(`(()=>{const w=headerTest.state.widgets.find(w=>w.id==='widget-2');return {hit:document.elementFromPoint(${actionPoint.x},${actionPoint.y})?.className,inert:w.frame.inert,hostStateKey:w.hostStateKey,classes:w.shell.className};})()`)};
    await foregroundFrame.executeJavaScript("window.inputEvents=[];document.addEventListener('pointerdown',e=>inputEvents.push({type:e.type,target:e.target.id,x:e.clientX,y:e.clientY}));");
    await click(actionPoint.x,actionPoint.y);
    report.interaction.inputEvents = await foregroundFrame.executeJavaScript("window.inputEvents");
    assert.equal(await foregroundFrame.executeJavaScript("document.querySelector('#action').textContent"), "Clicked");
    report.checks.push("Header grip drags the foreground Widget; Interact and the iframe button still work");
    // A fresh page avoids explicit interaction/selection holds in the leave check.
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await js("headerTest.canvasDocumentsReady().then(()=>{headerTest.state.auto=false;headerTest.smartSuggest.enabled=false;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();})");
    ({b,h} = await setup());
    await move(b.right+35,b.y-70); await pause(250);
    assert.equal((await owner()).active,"widget:widget-1", "outside both foreground regions, normal background hover resumes");
    await move(1100,800); await pause(1400);
    assert.equal(await js("!!document.querySelector('.object-toolbar-surface')"),false,"leaving the combined area hides the header");
    report.checks.push("Moving outside the combined area allows background hover; moving to blank Canvas hides the toolbar");
    assert.deepEqual(report.errors,[]);
    fs.rmSync(path.join(output,"failure.png"), {force:true});
    console.log(JSON.stringify(report,null,2));
  } catch (error) {
    report.failure = error.stack; console.error(error); process.exitCode = 1;
    if (win) fs.writeFileSync(path.join(output,"failure.png"),(await win.webContents.capturePage()).toPNG());
  } finally {
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
    win?.destroy(); server?.close(); app.exit(process.exitCode || 0);
  }
});
