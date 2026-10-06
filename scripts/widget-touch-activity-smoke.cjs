"use strict";
// Isolated browser acceptance; no user profile, saved document or model call.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-widget-touch-"));
app.setPath("userData", path.join(directory, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(directory, "state"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) {
    const code = fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, "window.touchTest={state,restoreWidgets,restoreImages,restoreTextBoxes,addAnimation,acceptImageEdit,cancelTextEditor,render,setCanvasMode,setWidgetInteraction,canvasWidgetInteractive,setSmartSuggestEnabled,hideHandObjectToolbar,updateWidgetRefinePointer,canvasAgentSetRunning,openCanvasAgent,closeCanvasAgent};})();");
    return Readable.from([code]);
  }
  return readStream.call(this, file, ...args);
};
const report = { directory, checks:[], errors:[], physicalTouchDeviceTested:false, contentControlCheck:"Programmatic button activation; Canvas double taps and iframe hit testing use native DevTools touch input." };
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
    await until(() => js("!!window.touchTest"), "application startup");
    await js(`document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelector('#studioNavigatorToggle')?.click();`);
    const html = `<!doctype html><style>html,body{margin:0;height:100%;background:#e7eef8;font:22px system-ui}body{padding:24px;box-sizing:border-box}button{position:absolute;left:80px;top:100px;width:220px;height:80px;font:inherit}</style><h2>Touch toolbar check</h2><button onclick="window.clickCount++">Widget content</button><script>window.pointerCount=0;window.clickCount=0;addEventListener('pointerdown',()=>pointerCount++);<\/script>`;
    await js(`(()=>{const n=touchTest,s=n.state;s.auto=false;n.setSmartSuggestEnabled(false);s.scale=1;s.panX=0;s.panY=0;n.restoreWidgets(${JSON.stringify([{ id:"touch-widget", pluginId:"general", widgetType:"html_widget", x:150, y:200, w:550, h:360, contentW:550, contentH:360, title:"Touch toolbar check", refreshSeconds:0, html }])});n.setCanvasMode('pen');n.render();})()`);
    await until(() => js("touchTest.state.widgets.every(w=>w.hostReady&&w.initialized&&w.contentVersion>0)"), "live Widget");
    await pause(700);
    await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();window.originalWidgetFrame=touchTest.state.widgets[0].frame");
    win.webContents.debugger.attach("1.3");
    const dispatch = (type, points = []) => win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", { type, touchPoints:points.map(([id, x, y]) => ({ id, x, y, radiusX:2, radiusY:2, force:1 })) });
    const point = () => js("(()=>{const r=touchTest.state.widgets[0].shell.getBoundingClientRect();return {x:r.x+160,y:r.y+130}})()");
    const toolbar = () => js("[...document.querySelectorAll('.object-chrome-button')].filter(e=>getComputedStyle(e).visibility==='visible'&&Number(getComputedStyle(e).opacity)>0).map(e=>['interact','suggest','refine','favorite','copy','echo','share','download','delete'].find(kind=>e.classList.contains(kind))||'surface')");
    const hasToolbar = () => js("!!document.querySelector('.object-chrome-button.interact')");
    const reset = async () => {
      await js("touchTest.setWidgetInteraction(null);touchTest.state.widgetTouchLastTap=null;touchTest.updateWidgetRefinePointer(null);touchTest.hideHandObjectToolbar({all:true,animate:false});touchTest.state.panX=0;touchTest.state.panY=0;touchTest.state.scale=1;touchTest.render()");
      await pause(250);
    };
    await reset();
    let p = await point();
    await dispatch("touchStart", [[1,p.x,p.y]]);
    assert.equal(await hasToolbar(), false, "touch down alone does not reveal the header");
    await dispatch("touchEnd");
    await until(hasToolbar, "touch header after release");
    const touchedToolbar = await toolbar();
    assert.ok(touchedToolbar.some(name => name.includes("refine")), "complete header includes Refine");
    assert.deepEqual(await js("({mode:touchTest.state.mode,selected:touchTest.state.selectedWidgetId,interacting:touchTest.state.interactingWidgetId,sameFrame:touchTest.state.widgets[0].frame===originalWidgetFrame})"), {mode:"pen",selected:null,interacting:null,sameFrame:true});
    await pause(1200);
    assert.equal(await hasToolbar(), true, "header remains actionable after the finger lifts");
    fs.writeFileSync(path.join(directory,"tablet-touch-toolbar.png"), (await win.webContents.capturePage()).toPNG());
    await reset();
    p = await point();
    await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type:"mouseMoved", x:p.x, y:p.y, button:"none"});
    await until(hasToolbar,"mouse hover header");
    assert.deepEqual(await toolbar(), touchedToolbar, "touch and mouse hover reveal the same tools");
    report.checks.push("Pen finger tap and mouse hover reveal the same complete toolbar; tool, selection and live iframe remain unchanged");

    await reset();
    p = await point();
    await dispatch("touchStart", [[1,p.x,p.y]]);
    await dispatch("touchMove", [[1,p.x+35,p.y+20]]);
    await dispatch("touchMove", [[1,p.x,p.y]]);
    await dispatch("touchEnd");
    await pause(300);
    assert.equal(await hasToolbar(),false,"dragging away and back cancels the tap");
    await reset();
    p = await point();
    await dispatch("touchStart", [[1,p.x,p.y]]);
    await dispatch("touchStart", [[1,p.x,p.y],[2,p.x+90,p.y]]);
    await dispatch("touchMove", [[1,p.x-15,p.y],[2,p.x+105,p.y]]);
    await dispatch("touchEnd", [[1,p.x-15,p.y]]);
    await dispatch("touchEnd");
    await pause(300);
    assert.equal(await hasToolbar(),false,"pinch does not become a tap after one finger lifts");
    assert.ok(await js("touchTest.state.scale>1"),"pinch still zooms the Canvas");
    await reset();
    p = await point();
    await dispatch("touchStart", [[1,p.x,p.y]]);
    await dispatch("touchCancel");
    await pause(300);
    assert.equal(await hasToolbar(),false,"cancelled touch cannot reveal the toolbar");
    report.checks.push("Drag, two-finger zoom and cancelled touches never reveal a toolbar");

    // Synthetic pen input exercises palm rejection while a real drawing exists.
    await js(`(()=>{const screen=document.querySelector('#screen');window.testPenEvent=type=>screen.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:91,pointerType:'pen',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,pressure:.5,clientX:${p.x},clientY:${p.y}}));testPenEvent('pointerdown')})()`);
    assert.equal(await js("touchTest.state.drawing?.pointerType"),"pen");
    await dispatch("touchStart", [[1,p.x+40,p.y+40]]);
    await dispatch("touchEnd");
    assert.equal(await hasToolbar(),false,"palm contact while writing cannot reveal a header");
    await js("testPenEvent('pointerup')");
    const frames = win.webContents.mainFrame.framesInSubtree.filter(frame => frame.url === "about:srcdoc");
    const counts = [];
    for (const frame of frames) {
      const count = await frame.executeJavaScript("window.pointerCount");
      if (typeof count === "number") counts.push(count);
    }
    assert.deepEqual(counts,[0],"taps never activate the instrumented Widget content");
    report.checks.push("Active pen writing rejects touch; embedded Widget controls never receive toolbar taps");

    for (const [name,width,height] of [["tablet",1024,900],["phone",390,844]]) {
      win.setSize(width,height);
      await pause(300);
      await reset();
      await js("localStorage.setItem('penecho.widgetInteractionPresentation','canvas')");
      p = await point();
      await dispatch("touchStart", [[1,p.x,p.y]]); await dispatch("touchEnd");
      assert.equal(await js("touchTest.state.interactingWidgetId"),null,"first tap only exposes the toolbar");
      await pause(100);
      await dispatch("touchStart", [[2,p.x+4,p.y+2]]); await dispatch("touchEnd");
      await until(()=>js("touchTest.state.interactingWidgetId===touchTest.state.widgets[0].id"),`${name} Widget double tap`);
      assert.deepEqual(await js("({mode:touchTest.state.mode,inPlace:touchTest.state.widgetInteractionInPlace,live:touchTest.canvasWidgetInteractive(touchTest.state.widgets[0]),sameFrame:touchTest.state.widgets[0].frame===originalWidgetFrame})"),{mode:"pen",inPlace:true,live:true,sameFrame:true});
      await pause(200);
      let content;
      for (const frame of win.webContents.mainFrame.framesInSubtree.filter(frame => frame.url === "about:srcdoc")) {
        if (typeof await frame.executeJavaScript("window.pointerCount") === "number") { content = frame; break; }
      }
      assert.ok(content,"the instrumented Widget document remains mounted");
      assert.equal(await content.executeJavaScript("window.pointerCount"),0,"activation taps are never replayed into content");
      const outer = await js("(()=>{const f=touchTest.state.widgets[0].frame,r=f.getBoundingClientRect();return {x:r.left,y:r.top,sx:r.width/f.clientWidth,sy:r.height/f.clientHeight}})()");
      const inner = await content.parent.executeJavaScript("(()=>{const f=document.querySelector('iframe'),r=f.getBoundingClientRect();return {x:r.left,y:r.top,sx:r.width/f.clientWidth,sy:r.height/f.clientHeight}})()");
      const button = await content.executeJavaScript("(()=>{const r=document.querySelector('button').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()");
      const buttonPoint = { x:outer.x+(inner.x+button.x*inner.sx)*outer.sx,y:outer.y+(inner.y+button.y*inner.sy)*outer.sy };
      assert.equal(await js(`document.elementFromPoint(${buttonPoint.x},${buttonPoint.y})===touchTest.state.widgets[0].frame`),true,"the live Widget receives native hit testing");
      // The root DevTools touch path verifies activation and native iframe hit
      // testing. Invoke the unchanged embedded handler directly: sandboxed
      // iframe touch routing requires separate physical-device coverage.
      await content.executeJavaScript("document.querySelector('button').click()");
      assert.equal(await content.executeJavaScript("window.clickCount"),1,"the existing Widget button handler works");
      assert.equal(await js("touchTest.state.interactingWidgetId===touchTest.state.widgets[0].id"),true,"content input keeps Widget interaction active");
      assert.equal(await js("touchTest.state.mode"),"pen","content input keeps the Pen tool");
      fs.writeFileSync(path.join(directory,`${name}-double-tap-interact.png`),(await win.webContents.capturePage()).toPNG());
      await content.executeJavaScript("window.pointerCount=0;window.clickCount=0");
      const blank = await js("(()=>{const r=document.querySelector('#screen').getBoundingClientRect();return {x:r.left+80,y:r.top+80}})()");
      assert.equal(await js(`document.elementFromPoint(${blank.x},${blank.y})===document.querySelector('#screen')`),true,"exit tap lands on blank Canvas rather than navigation controls");
      await dispatch("touchStart", [[4,blank.x,blank.y]]); await dispatch("touchEnd");
      assert.equal(await js("touchTest.state.interactingWidgetId"),null,"a blank Canvas tap exits interaction");
      assert.equal(await js("touchTest.state.drawing"),null,"exiting interaction leaves no stroke");
      await js("testPenEvent('pointerdown')");
      assert.equal(await js("touchTest.state.drawing?.pointerType"),"pen","writing resumes after interaction");
      await js("testPenEvent('pointerup')");
    }
    report.checks.push("Tablet and phone double taps activate a live Widget without changing Pen or its iframe; existing content handlers work, blank taps exit cleanly and writing resumes");
    win.setSize(1024,900); await pause(300); await reset();
    // An interrupted pair must not combine with a later tap.
    p = await point();
    await dispatch("touchStart", [[1,p.x,p.y]]); await dispatch("touchEnd");
    await dispatch("touchStart", [[2,p.x,p.y]]); await dispatch("touchMove", [[2,p.x+25,p.y]]); await dispatch("touchMove", [[2,p.x,p.y]]); await dispatch("touchEnd");
    await dispatch("touchStart", [[3,p.x,p.y]]); await dispatch("touchEnd");
    assert.equal(await js("touchTest.state.interactingWidgetId"),null,"an intervening drag breaks the double-tap pair");
    await reset(); p = await point();
    await dispatch("touchStart", [[1,p.x,p.y]]); await dispatch("touchEnd");
    await dispatch("touchStart", [[2,p.x,p.y]]); await dispatch("touchStart", [[2,p.x,p.y],[3,p.x+80,p.y]]); await dispatch("touchEnd");
    await dispatch("touchStart", [[4,p.x,p.y]]); await dispatch("touchEnd");
    assert.equal(await js("touchTest.state.interactingWidgetId"),null,"an intervening multi-touch gesture breaks the double-tap pair");
    report.checks.push("Drag and multi-touch between taps cannot activate a Widget");

    // Native images (including plots) share object controls rather than iframe
    // headers. A finger tap must expose those controls while Pen remains active.
    for (const [name,expression] of [["image",""],["plot","sin(x)"]]) {
      await reset();
      await js(`(async()=>{const n=touchTest,c=document.createElement('canvas');c.width=450;c.height=180;const ctx=c.getContext('2d');ctx.fillStyle='#edf2f7';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#4338ca';ctx.font='24px system-ui';ctx.fillText(${JSON.stringify(name+' touch controls')},24,70);const blob=await new Promise(resolve=>c.toBlob(resolve));n.restoreImages([{id:'image-1',image:c,blob,x:150,y:200,w:450,h:180,naturalW:450,naturalH:180,${expression?`plotExpression:${JSON.stringify(expression)},`:""}}]);n.state.frontCanvasObjectKind='image';n.render()})()`);
      const imagePoint = () => js("(()=>{const s=touchTest.state,i=s.images[0],r=document.querySelector('#viewport').getBoundingClientRect();return {x:r.left+s.panX+(i.x+120)*s.scale,y:r.top+s.panY+(i.y+80)*s.scale}})()");
      p=await imagePoint();
      await dispatch("touchStart",[[1,p.x,p.y]]);await dispatch("touchEnd");
      await until(()=>js("!!document.querySelector('[data-object-chrome-key=\"image:image-1:toolbar\"]')"),`${name} toolbar`);
      assert.equal(await js("touchTest.state.mode"),"pen");
      assert.equal(await js("touchTest.state.selectedImageId"),"image-1");
      assert.equal(await js(`!!document.querySelector('[data-object-chrome-key="image:image-1:${expression?"copy":"merge"}"]')`),true);
      if(name==="image") {
        const start=await js("touchTest.state.images[0].x"),handle=await js("(()=>{const r=document.querySelector('[data-object-chrome-key=\"image:image-1:toolbar\"]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()");
        await dispatch("touchStart",[[1,handle.x,handle.y]]);await dispatch("touchMove",[[1,handle.x+35,handle.y+20]]);await dispatch("touchEnd");
        assert.ok(await js(`touchTest.state.images[0].x>${start+30}`),"image toolbar remains draggable in Pen");
        assert.equal(await js("touchTest.state.mode"),"pen");
      }
      fs.writeFileSync(path.join(directory,`tablet-${name}-toolbar.png`),(await win.webContents.capturePage()).toPNG());
      if(name==="plot") {
        await js("testPenEvent('pointerdown')");
        assert.equal(await js("touchTest.state.selectedImageId"),null,"writing seals the image edit before the first ink sample");
        await until(()=>js("!document.querySelector('[data-object-chrome-key=\"image:image-1:toolbar\"]')"),"writing removes the native toolbar");
        await js("testPenEvent('pointerup')");
      }
      await js("touchTest.acceptImageEdit({restoreMode:false})");await reset();
      p=await imagePoint();
      await dispatch("touchStart",[[1,p.x,p.y]]);await dispatch("touchMove",[[1,p.x+25,p.y]]);await dispatch("touchEnd");await pause(200);
      assert.equal(await js("touchTest.state.selectedImageId"),null,`${name} body drag pans rather than selecting`);
      await js("touchTest.restoreImages([]);touchTest.render()");
    }
    report.checks.push("Native images and function plots reveal their own toolbar in Pen; image toolbar drag works and body drag remains Canvas navigation");

    await reset();
    await js("touchTest.restoreTextBoxes([{id:'text-box-1',text:'Native text touch check',x:150,y:200,maxWidth:450,fontSize:24,color:'#20242c'}]).then(()=>touchTest.render())");
    await until(()=>js("touchTest.state.textBoxes.length===1"),"native text");
    p=await js("(()=>{const s=touchTest.state,t=s.textBoxes[0],r=document.querySelector('#viewport').getBoundingClientRect();return {x:r.left+s.panX+(t.x+40)*s.scale,y:r.top+s.panY+(t.y+15)*s.scale}})()");
    await dispatch("touchStart",[[1,p.x,p.y]]);await dispatch("touchEnd");
    await until(()=>js("touchTest.state.textEditors.size===1"),"text toolbar");
    assert.equal(await js("touchTest.state.mode"),"pen");
    assert.equal(await js("[...touchTest.state.textEditors.values()][0].returnMode"),"pen");
    assert.equal(await js("!!document.querySelector('.text-editor-header .text-editor-button')"),true);
    await pause(350);
    const textChrome=await js("(()=>{const e=document.querySelector('.text-editor'),h=e?.querySelector('.text-editor-header'),s=h&&getComputedStyle(h);return {className:e?.className,visibility:s?.visibility,display:s?.display,active:document.activeElement?.className}})()");
    assert.equal(textChrome.visibility,"visible",JSON.stringify(textChrome));
    fs.writeFileSync(path.join(directory,"tablet-text-toolbar.png"),(await win.webContents.capturePage()).toPNG());
    await js("touchTest.cancelTextEditor([...touchTest.state.textEditors.values()][0]);touchTest.restoreTextBoxes([])");
    report.checks.push("Native text reveals its existing editing toolbar and retains the originating Pen tool");

    await reset();
    await js("touchTest.state.plugins.flowchart=true;touchTest.restoreWidgets([{id:'professional-widget',pluginId:'flowchart',widgetType:'diagram_source',x:150,y:200,w:450,h:300,contentW:450,contentH:300,title:'Professional source touch',refreshSeconds:0,sourceFormat:'dot',source:'digraph G { A -> B; }'}]);touchTest.render()");
    await until(()=>js("touchTest.state.widgets[0]?.hostReady&&touchTest.state.widgets[0]?.initialized"),"professional diagram");
    p=await point();await dispatch("touchStart",[[1,p.x,p.y]]);await dispatch("touchEnd");
    await until(hasToolbar,"professional diagram toolbar");
    assert.equal(await js("touchTest.state.widgets[0].widgetType"),"diagram_source");
    assert.equal(await js("touchTest.state.mode"),"pen");
    report.checks.push("Professional source diagrams use the same finger tap header as HTML Widgets");

    await reset();
    // Drive observable execution state without sending any request to a model.
    await js("touchTest.openCanvasAgent({focus:false,connect:false,animate:false});touchTest.canvasAgentSetRunning(true)");
    await until(() => js("document.querySelector('#canvasAgentActivityOverlay').classList.contains('is-visible')"),"running activity");
    p = await point();
    await dispatch("touchStart", [[1,p.x,p.y]]);
    await dispatch("touchEnd");
    assert.equal(await js("document.querySelector('#canvasAgentActivityOverlay').classList.contains('is-visible')"),true,"Canvas touch does not hide running activity");
    await js("touchTest.closeCanvasAgent({focus:false,animate:false})");
    await pause(250);
    assert.equal(await js("document.querySelector('#canvasAgentActivityOverlay').classList.contains('is-visible')"),true,"minimizing AI does not hide execution");
    for (const [name,width,height] of [["tablet",1024,900],["phone",390,844]]) {
      win.setSize(width,height);
      await pause(350);
      const stack = await js(`(()=>{const e=document.querySelector('#canvasAgentActivityOverlay'),r=e.querySelector('.canvas-agent-activity-core').getBoundingClientRect(),style=getComputedStyle(e),below=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {visible:style.visibility,opacity:Number(style.opacity),z:Number(style.zIndex),panelZ:Number(getComputedStyle(document.querySelector('#canvasAgentPanel')).zIndex),chromeZ:Number(getComputedStyle(document.querySelector('#objectChromeLayer')).zIndex),pointerEvents:style.pointerEvents,passesThrough:!e.contains(below),left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`);
      assert.equal(stack.visible,"visible");
      assert.equal(stack.opacity,1);
      assert.ok(stack.z>stack.panelZ&&stack.z>stack.chromeZ,JSON.stringify(stack));
      assert.equal(stack.pointerEvents,"none");
      assert.equal(stack.passesThrough,true);
      assert.ok(stack.left>=0&&stack.right<=stack.width&&stack.top>=0&&stack.bottom<=stack.height,JSON.stringify(stack));
      fs.writeFileSync(path.join(directory,`${name}-activity.png`),(await win.webContents.capturePage()).toPNG());
    }
    // Force a narrow overlap and hit-test the actual stacking order. Temporarily
    // enable pointer events only for the probe, then restore normal passthrough.
    await js("touchTest.openCanvasAgent({focus:false,connect:false,animate:false})");
    await pause(350);
    const narrowCard = await js("(()=>{const e=document.querySelector('#canvasAgentActivityOverlay'),r=e.querySelector('.canvas-agent-activity-core').getBoundingClientRect();return {onStage:e.parentElement.classList.contains('canvas-frame'),width:r.width,left:r.left,right:r.right,screenWidth:innerWidth,visible:getComputedStyle(e).visibility}})()");
    assert.equal(narrowCard.onStage,true);
    assert.equal(narrowCard.visible,"visible");
    assert.ok(narrowCard.width>=260&&narrowCard.left>=0&&narrowCard.right<=narrowCard.screenWidth,JSON.stringify(narrowCard));
    const foreground = await js(`(()=>{const e=document.querySelector('#canvasAgentActivityOverlay'),panel=document.querySelector('#canvasAgentPanel');const eStyle=e.getAttribute('style'),panelStyle=panel.getAttribute('style');for(const [key,value] of Object.entries({position:'absolute',left:'0',top:'0',width:'100%',height:'100%',transform:'none'}))panel.style.setProperty(key,value,'important');e.style.setProperty('left','50%','important');e.style.setProperty('top','50%','important');e.style.setProperty('pointer-events','auto','important');const r=e.querySelector('.canvas-agent-activity-core').getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),front=e.contains(hit);eStyle===null?e.removeAttribute('style'):e.setAttribute('style',eStyle);panelStyle===null?panel.removeAttribute('style'):panel.setAttribute('style',panelStyle);return front})()`);
    assert.equal(foreground,true,"activity paints in front of an overlapping Agent panel");
    await pause(250);
    fs.writeFileSync(path.join(directory,"phone-activity-panel.png"),(await win.webContents.capturePage()).toPNG());
    await js("touchTest.canvasAgentSetRunning(false)");
    await pause(250);
    assert.equal(await js("document.querySelector('#canvasAgentActivityOverlay').classList.contains('is-visible')"),false,"completion hides activity");
    report.checks.push("Running activity stays above Canvas controls on tablet/phone, survives Canvas focus and minimized AI, passes pointer input through and hides on completion");
    assert.deepEqual(report.errors,[]);
    report.ok=true;
  } catch(error) { report.failure=error.stack||String(error); }
  finally {
    win?.destroy();
    if(server) { server.closeAllConnections?.(); await new Promise(resolve=>server.close(resolve)); }
    report.serverClosed=!server?.listening;
    fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    app.exit(report.ok?0:1);
  }
});
