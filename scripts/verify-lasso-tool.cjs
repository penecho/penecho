"use strict";
// Real Canvas pointer routing and toolbar layout, using isolated local data.
// Run: tools/electron/node_modules/.bin/electron scripts/verify-lasso-tool.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lasso-"));
const output = path.resolve(process.env.PENECHO_VERIFY_OUTPUT || path.join(root, "docs/verification/lasso-tool-20260929"));
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(directory, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(directory,"state"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" });
const stream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root,"public/app.js")) {
    const source = fs.readFileSync(file,"utf8").replace(/\}\)\(\);\s*$/, "window.lassoTest={state,canvasDocumentsReady,restoreWidgets,render,stroke,save,commitSelection,cancelSelection,undo,redo,setCanvasMode,selectCanvasToolMode,canvasLassoToolActive,setWidgetInteraction,enterManualImageHandMode,beginImageEdit,addImageFile};})();");
    return Readable.from([source]);
  }
  return stream.call(this,file,...args);
};
const report = { checks:[], layouts:[], errors:[] }, pause = ms => new Promise(resolve => setTimeout(resolve,ms));
let server, win;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening",resolve));
    win = new BrowserWindow({ show:true,width:1440,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:false} });
    const js = source => win.webContents.executeJavaScript(source,true);
    win.webContents.on("console-message", (_event,level,message) => { if(level>=3) report.errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await js("lassoTest.canvasDocumentsReady().then(()=>{lassoTest.state.auto=false;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();localStorage.setItem('penecho.widgetInteractionPresentation','canvas');})");
    await pause(350);
    for (const width of [1440,1024,390]) {
      win.setContentSize(width,900);await pause(250);
      if(width<=700) await js("document.querySelector('#lassoToolBtn').scrollIntoView({block:'nearest',inline:'center'})");
      const layout = await js(`(()=>{const e=document.querySelector('#eraserToolControl'),t=document.querySelector('#textToolBtn'),l=document.querySelector('#lassoToolBtn'),a=t.getBoundingClientRect(),b=l.getBoundingClientRect(),c=e.getBoundingClientRect();return {width:innerWidth,eraser:{x:c.x,y:c.y,w:c.width,h:c.height},text:{x:a.x,y:a.y,w:a.width,h:a.height},lasso:{x:b.x,y:b.y,w:b.width,h:b.height},adjacent:e.nextElementSibling===l&&l.nextElementSibling===t,label:l.getAttribute('aria-label')};})()`);
      report.layouts.push(layout);
      assert.ok(layout.adjacent && layout.lasso.x >= layout.eraser.x+layout.eraser.w-1 && layout.text.x >= layout.lasso.x+layout.lasso.w-1
        && Math.abs(layout.text.y-layout.lasso.y)<1 && Math.abs(layout.eraser.y-layout.lasso.y)<1, "Lasso sits between Eraser and Text");
      assert.ok(layout.lasso.x+layout.lasso.w<=layout.width+1, "Lasso stays visible");
      fs.writeFileSync(path.join(output,`toolbar-${width}.png`),(await win.webContents.capturePage()).toPNG());
      if(width===1440) {
        const region=await js("(()=>{const r=document.querySelector('.mode-tools').getBoundingClientRect();return {x:Math.floor(r.x-8),y:Math.floor(r.y-8),width:Math.ceil(r.width+16),height:Math.ceil(r.height+16)};})()");
        fs.writeFileSync(path.join(output,"toolbar-detail.png"),(await win.webContents.capturePage(region)).toPNG());
      }
    }
    report.checks.push("Lasso sits between Eraser and Text at desktop/tablet widths and in the phone's existing horizontal toolbar");
    if (process.env.PENECHO_VERIFY_LAYOUT_ONLY === "1") return;
    win.setContentSize(1440,900);await pause(200);
    const widget={id:'widget-1',pluginId:'general',widgetType:'html_widget',x:220,y:210,w:440,h:280,contentW:440,contentH:280,title:'Lasso interaction test',refreshSeconds:0,html:`<!doctype html><html><body style="margin:0;background:#edf2f7;height:280px"><button id="action" style="margin:20px;padding:20px">Widget action</button><script>document.querySelector('#action').addEventListener('click',event=>event.currentTarget.textContent='Clicked');</script></body></html>`};
    await js(`(()=>{const t=lassoTest,s=t.state;s.scale=1;s.panX=0;s.panY=0;t.restoreWidgets([${JSON.stringify(widget)}]);t.stroke({x:300,y:280},{x:360,y:310},false,8,true,'#111111');t.save();t.render();document.querySelector('#lassoToolBtn').click();})()`);
    await pause(500);
    win.webContents.debugger.attach("1.3");
    const mouse = (type,x,y,extra={}) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type,x,y,button:type==='mouseMoved'?'none':'left',...extra});
    const point = (x,y) => js(`(()=>{const s=lassoTest.state,r=document.querySelector('#screen').getBoundingClientRect();return {x:r.x+s.panX+${x}*s.scale,y:r.y+s.panY+${y}*s.scale};})()`);
    const drag = async (a,b) => { await mouse('mouseMoved',a.x,a.y);await mouse('mousePressed',a.x,a.y,{buttons:1,clickCount:1});await mouse('mouseMoved',b.x,b.y,{button:'left',buttons:1});await mouse('mouseReleased',b.x,b.y,{buttons:0,clickCount:1});await pause(100); };
    const geometry = () => js("lassoTest.state.widgets.map(({x,y,w,h})=>({x,y,w,h}))");
    const camera = () => js("(({panX,panY,scale})=>({panX,panY,scale}))(lassoTest.state)");
    const original = await geometry(), initialCamera = await camera();
    const start = await point(270,250);
    await mouse('mouseMoved',start.x,start.y);await pause(350);
    assert.equal(await js("!!document.querySelector('.object-chrome-button.interact')"),false,"Lasso hover does not show Widget controls");
    await mouse('mousePressed',start.x,start.y,{buttons:1,clickCount:1});
    assert.equal(await js("lassoTest.state.selection?.phase"),'lasso',"Starting over Widget starts Lasso");
    assert.equal(await js("lassoTest.state.widgetGesture"),null);
    for (const [x,y] of [[400,250],[400,340],[270,340],[270,250]]) { const p=await point(x,y);await mouse('mouseMoved',p.x,p.y,{button:'left',buttons:1}); }
    await mouse('mouseReleased',start.x,start.y,{buttons:0,clickCount:1});await pause(150);
    assert.equal(await js("lassoTest.state.selection?.phase"),'active');
    assert.deepEqual(await geometry(),original);assert.deepEqual(await camera(),initialCamera);
    const selectionBefore = await js("({...lassoTest.state.selection.box})");
    await drag(await point(330,292),await point(355,312));
    const selectionAfter = await js("({...lassoTest.state.selection.box})");
    assert.ok(Math.abs(selectionAfter.x-selectionBefore.x-25)<1 && Math.abs(selectionAfter.y-selectionBefore.y-20)<1,"Lasso selection moves over Widget");
    await js("lassoTest.commitSelection();lassoTest.undo();lassoTest.redo();lassoTest.render()");
    assert.deepEqual(await geometry(),original);
    report.checks.push("Mouse Lasso starts over Widget, moves the enclosed ink, and preserves Widget geometry through Undo/Redo");
    await js("lassoTest.selectCanvasToolMode('select')");
    for (const count of [1,2]) { await mouse('mousePressed',start.x,start.y,{buttons:1,clickCount:count});await mouse('mouseReleased',start.x,start.y,{buttons:0,clickCount:count}); }
    await pause(100);
    assert.equal(await js("lassoTest.state.interactingWidgetId"),null);
    assert.equal(await js("lassoTest.state.selectedWidgetId"),null);
    report.checks.push("Lasso click and double-click never select or activate Widget");
    const touchStart=await point(290,280),touchCamera=await camera();
    const touch=(type,points)=>win.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type,touchPoints:points});
    await touch('touchStart',[{...touchStart,id:1}]);
    await touch('touchMove',[{x:touchStart.x+24,y:touchStart.y+18,id:1}]);
    await touch('touchEnd',[]);await pause(100);
    assert.equal(await js("lassoTest.state.selection"),null);
    assert.deepEqual(await geometry(),original);
    assert.ok(Math.abs((await camera()).panX-touchCamera.panX)>10,"One finger over Widget still pans Canvas in Lasso");
    await js(`Object.assign(lassoTest.state,${JSON.stringify(touchCamera)});lassoTest.render()`);
    const penStart=await point(280,250);
    await mouse('mouseMoved',penStart.x,penStart.y,{pointerType:'pen'});
    await mouse('mousePressed',penStart.x,penStart.y,{pointerType:'pen',buttons:1,clickCount:1});
    assert.equal(await js("lassoTest.state.selection?.phase"),'lasso');
    for(const [x,y] of [[430,250],[430,380],[280,380],[280,250]]) {const p=await point(x,y);await mouse('mouseMoved',p.x,p.y,{pointerType:'pen',button:'left',buttons:1});}
    await mouse('mouseReleased',penStart.x,penStart.y,{pointerType:'pen',buttons:0,clickCount:1});await pause(100);
    assert.equal(await js("lassoTest.state.selection?.phase"),'active');
    await js("lassoTest.cancelSelection()");
    report.checks.push("Injected touch pans without moving Widget; injected stylus creates an ink Lasso over Widget");
    await js("document.querySelector('#handToolBtn').click()");
    await drag(await point(280,270),await point(310,290));
    assert.deepEqual(await geometry(),original);assert.ok(Math.abs((await camera()).panX-initialCamera.panX-30)<1);
    const p=await point(300,300);
    await mouse('mousePressed',p.x,p.y,{buttons:1,clickCount:1});await mouse('mouseReleased',p.x,p.y,{buttons:0,clickCount:1});await pause(150);
    assert.equal(await js("lassoTest.state.selectedWidgetId"),'widget-1');
    const header = await js(`(()=>{const e=[...document.querySelectorAll('.object-chrome-button')].find(e=>e.penechoSpec?.kind==='toolbar'&&e.penechoSpec?.target==='widget'),r=e.getBoundingClientRect();return {x:r.x+12,y:r.y+r.height/2};})()`);
    await drag(header,{x:header.x+35,y:header.y+25});
    let moved=await geometry();assert.ok(Math.abs(moved[0].x-original[0].x-35)<1 && Math.abs(moved[0].y-original[0].y-25)<1);
    const resize=await js("(()=>{const r=document.querySelector('.canvas-widget-resize-handle.corner').getBoundingClientRect();return {x:r.right-4,y:r.bottom-4};})()");
    await drag(resize,{x:resize.x+30,y:resize.y+20});
    assert.ok((await geometry())[0].w>moved[0].w);
    await js("document.querySelector('.object-chrome-button.interact').click()");
    await pause(200);
    assert.equal(await js("lassoTest.state.mode"),'hand');assert.equal(await js("lassoTest.state.interactingWidgetId"),'widget-1');
    const action=await point((await geometry())[0].x+45,(await geometry())[0].y+45);
    report.nativeInput=await js(`(()=>{const w=lassoTest.state.widgets[0],r=w.frame.getBoundingClientRect();return {action:${JSON.stringify(action)},hit:document.elementFromPoint(${action.x},${action.y})?.tagName,frame:{x:r.x,y:r.y,w:r.width,h:r.height},interactive:w.shell.className,inert:w.frame.inert,policy:w.hostStateKey};})()`);
    await mouse('mouseMoved',action.x,action.y);await mouse('mousePressed',action.x,action.y,{buttons:1,clickCount:1});await mouse('mouseReleased',action.x,action.y,{buttons:0,clickCount:1});await pause(150);
    let frame;report.frames=[];
    for(const candidate of win.webContents.mainFrame.framesInSubtree) {
      if(candidate.url==='about:srcdoc') {
        const info=await candidate.executeJavaScript("(()=>{const b=document.querySelector('#action'),r=b?.getBoundingClientRect();return {button:!!b,text:b?.textContent,rect:r?{x:r.x,y:r.y,w:r.width,h:r.height}:null};})()");
        report.frames.push(info);if(info.button)frame=candidate;
      }
    }
    assert.ok(frame,"Live Widget document exists");
    assert.equal(await frame.executeJavaScript("document.querySelector('#action').textContent"),'Clicked');
    report.checks.push("Hand still pans over Widget, selects it, moves its header, resizes its handle and operates its native button");
    await js("document.querySelector('#lassoToolBtn').click()");
    assert.equal(await js("lassoTest.canvasLassoToolActive()"),true);
    assert.equal(await js("lassoTest.state.interactingWidgetId"),null);
    assert.equal(await js("lassoTest.state.widgetEdit"),null);
    assert.equal(await js("!!document.querySelector('.object-chrome-button.interact')"),false);
    report.checks.push("Switching from Widget interaction to Lasso clears interaction and object controls");
    fs.writeFileSync(path.join(output,"canvas-lasso.png"),(await win.webContents.capturePage()).toPNG());
    await js("(async()=>{const c=document.createElement('canvas');c.width=c.height=80;c.getContext('2d').fillRect(10,10,60,60);const b=await new Promise(resolve=>c.toBlob(resolve));await lassoTest.addImageFile(new File([b],'lasso-fixture.png',{type:'image/png'}));})()");
    assert.equal(await js("!!lassoTest.state.imageEdit"),true);
    assert.equal(await js("lassoTest.canvasLassoToolActive()"),false,"Image placement keeps its existing controls");
    await js("document.querySelector('#lassoToolBtn').click()");
    assert.equal(await js("lassoTest.state.images.length"),1);
    assert.equal(await js("lassoTest.state.imageEdit"),null);
    assert.equal(await js("lassoTest.canvasLassoToolActive()"),true);
    report.checks.push("Imported image retains placement controls; explicit Lasso commits placement and preserves the image");
    assert.deepEqual(report.errors,[]);
    console.log(JSON.stringify(report,null,2));
  } catch(error) { report.failure=error.stack;console.error(error);if(win)fs.writeFileSync(path.join(output,"failure.png"),(await win.webContents.capturePage()).toPNG());process.exitCode=1; }
  finally {
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
    win?.destroy();server?.close();app.exit(process.exitCode||0);
  }
});
