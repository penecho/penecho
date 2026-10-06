"use strict";
// Run with tools/electron/node_modules/.bin/electron. Uses isolated local data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const root = path.resolve(__dirname,".."), directory = fs.mkdtempSync(path.join(os.tmpdir(),"penecho-lasso-move-"));
const output = path.resolve(process.env.PENECHO_VERIFY_OUTPUT || path.join(root,"docs/verification/lasso-content-move-20261002"));
fs.mkdirSync(output,{recursive:true});
app.setPath("userData",path.join(directory,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(directory,"state"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false"});
const stream = fs.createReadStream;
fs.createReadStream = function(file,...args) {
  if (path.resolve(String(file)) === path.join(root,"public/app.js")) {
    const source = fs.readFileSync(file,"utf8").replace(/\}\)\(\);\s*$/,"window.lassoMove={state,tiles,TILE,smartSuggest,canvasDocumentsReady,restoreWidgets,render,stroke,save,captureSelection,commitSelection,cancelSelection,deleteSelection,undo,redo,mergeImage,addImageFile,acceptImageEdit,renderedTextBoxRecord,recordTextBoxesBefore,saveUserCanvasChange,buildSelectionImage,saveSnapshot,readDeviceSnapshot,decodeSnapshotTilesInBatches,finishSelectionGesture,finalizeCanvasForSnapshot};})();");
    return Readable.from([source]);
  }
  return stream.call(this,file,...args);
};
const report={checks:[],errors:[],pixels:{}}, pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let win,server;
app.whenReady().then(async()=>{
  try {
    server=require("../server.js");
    await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
    win=new BrowserWindow({show:true,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const js=source=>win.webContents.executeJavaScript(source,true);
    win.webContents.on("console-message",(_event,level,message)=>{if(level>=3)report.errors.push(message);});
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await js("lassoMove.canvasDocumentsReady().then(()=>{lassoMove.state.auto=false;lassoMove.smartSuggest.enabled=false;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();})");
    await pause(200);
    win.webContents.debugger.attach("1.3");
    const mouse=(type,x,y,extra={})=>win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type,x,y,button:type==='mouseMoved'?'none':'left',...extra});
    const point=(x,y)=>js(`(()=>{const s=lassoMove.state,r=document.querySelector('#screen').getBoundingClientRect();return {x:r.x+s.panX+${x}*s.scale,y:r.y+s.panY+${y}*s.scale};})()`);
    const drag=async(a,b,pointerType="mouse")=>{
      await mouse("mouseMoved",a.x,a.y,{pointerType});await mouse("mousePressed",a.x,a.y,{pointerType,buttons:1,clickCount:1});
      for(let i=1;i<=6;i++)await mouse("mouseMoved",a.x+(b.x-a.x)*i/6,a.y+(b.y-a.y)*i/6,{pointerType,button:"left",buttons:1});
      await mouse("mouseReleased",b.x,b.y,{pointerType,buttons:0,clickCount:1});await pause(80);
    };
    const lasso=async(points)=>{
      const a=await point(...points[0]);await mouse("mouseMoved",a.x,a.y);await mouse("mousePressed",a.x,a.y,{buttons:1,clickCount:1});
      for(const xy of points.slice(1)){const p=await point(...xy);await mouse("mouseMoved",p.x,p.y,{button:"left",buttons:1});}
      await mouse("mouseReleased",a.x,a.y,{buttons:0,clickCount:1});await pause(80);
      assert.equal(await js("lassoMove.state.selection?.phase"),"active");
    };
    const pixel=(x,y)=>js(`(()=>{const t=lassoMove,c=t.tiles.get(Math.floor(${x}/t.TILE)+','+Math.floor(${y}/t.TILE));return c?Array.from(c.getContext('2d').getImageData(${x}%t.TILE,${y}%t.TILE,1,1).data):[0,0,0,0];})()`);
    const widgetGeometry=()=>js("lassoMove.state.widgets.map(({x,y,w,h,html})=>({x,y,w,h,html}))");
    const rectangle=[[460,240],[580,240],[580,330],[460,330],[460,240]];
    const widget={id:"widget-1",pluginId:"general",widgetType:"html_widget",x:430,y:210,w:320,h:240,contentW:320,contentH:240,title:"Stays in place",refreshSeconds:0,html:'<!doctype html><html><body style="margin:0;background:#eee">Widget stays in place</body></html>'};
    await js(`(()=>{const t=lassoMove,s=t.state;s.scale=1;s.panX=0;s.panY=0;t.restoreWidgets([${JSON.stringify(widget)}]);t.stroke({x:480,y:285},{x:560,y:285},false,8,true,'#111111');t.stroke({x:480,y:370},{x:560,y:370},false,8,true,'#008800');t.save();t.render();document.querySelector('#lassoToolBtn').click();})()`);
    await pause(200);
    const originalWidget=await widgetGeometry();
    assert.equal(originalWidget.length,1,"the Widget fixture is admitted");
    assert.equal(await js("!!lassoMove.state.widgets[0].frame"),true,"the live Widget frame is mounted");
    await js("window.lassoWidgetFrame=lassoMove.state.widgets[0].frame");
    const beforeHistory=await js("lassoMove.state.history.length");
    await lasso(rectangle);
    assert.equal(await js("lassoMove.state.selection.regionOnly"),true);
    assert.equal(await js("lassoMove.state.history.length"),beforeHistory);
    await drag(await point(520,285),await point(670,385));
    assert.equal(await js("lassoMove.state.selection.regionOnly"),false);
    assert.ok(await js("lassoMove.state.selection.fragments.length")>=2,"ink crosses a tile boundary");
    assert.equal((await pixel(500,285))[3],0,"source ink is lifted during preview");
    assert.ok((await pixel(500,370))[3]>200,"unselected stroke stays in place");
    await js("lassoMove.commitSelection()");
    assert.ok((await pixel(650,385))[3]>200,"ink arrives at the destination");
    assert.equal(await js("lassoMove.state.history.length"),beforeHistory+1);
    assert.deepEqual(await widgetGeometry(),originalWidget);
    assert.equal(await js("lassoMove.state.widgets[0].frame===window.lassoWidgetFrame"),true,"movement and history preserve the live iframe");
    await js("lassoMove.undo()");assert.ok((await pixel(500,285))[3]>200);assert.equal((await pixel(650,385))[3],0);
    await js("lassoMove.redo()");assert.equal((await pixel(500,285))[3],0);assert.ok((await pixel(650,385))[3]>200);
    await js("lassoMove.undo()");
    report.checks.push("Real pointer lasso moves cross-tile ink, removes source pixels, preserves unselected ink and Widget geometry, and creates one reversible history entry");
    await lasso(rectangle);await drag(await point(520,285),await point(670,385));
    await js("lassoMove.cancelSelection()");assert.ok((await pixel(500,285))[3]>200);assert.equal((await pixel(650,385))[3],0);
    assert.equal(await js("lassoMove.state.historyBefore.size"),0);
    await js("lassoMove.captureSelection([{x:460,y:250},{x:580,y:250},{x:460,y:330}])");
    await drag(await point(480,270),await point(600,350));await js("lassoMove.commitSelection()");
    assert.equal((await pixel(480,285))[3],0);assert.ok((await pixel(530,285))[3]>200,"outside polygon stays in place");assert.ok((await pixel(600,365))[3]>200);
    await js("lassoMove.undo()");
    report.checks.push("Cancellation restores source pixels and irregular lassos move only ink inside the polygon");
    await js("(async()=>{const t=lassoMove,c=document.createElement('canvas');c.width=c.height=40;c.getContext('2d').fillStyle='#cc2233';c.getContext('2d').fillRect(0,0,40,40);const b=await new Promise(resolve=>c.toBlob(resolve));await t.addImageFile(new File([b],'merged.png',{type:'image/png'}));const item=t.state.images.at(-1);Object.assign(item,{x:100,y:420,w:40,h:40});t.acceptImageEdit({restoreMode:false});t.mergeImage(item);document.querySelector('#lassoToolBtn').click();})()");
    assert.equal(await js("lassoMove.state.images.length"),0);
    const mergedColor=await pixel(120,440);
    await lasso([[90,410],[150,410],[150,470],[90,470],[90,410]]);
    await drag(await point(120,440),await point(260,490),"pen");await js("lassoMove.commitSelection()");
    assert.equal((await pixel(120,440))[3],0);assert.deepEqual(await pixel(260,490),mergedColor);
    await js("lassoMove.undo()");assert.deepEqual(await pixel(120,440),mergedColor);await js("lassoMove.redo()");
    report.checks.push("A merged image moves as ink with stylus input, including source removal and Undo/Redo");
    await js("(async()=>{const t=lassoMove,c=document.createElement('canvas');c.width=c.height=40;c.getContext('2d').fillStyle='#2255cc';c.getContext('2d').fillRect(0,0,40,40);const b=await new Promise(resolve=>c.toBlob(resolve));await t.addImageFile(new File([b],'editable.png',{type:'image/png'}));Object.assign(t.state.images.at(-1),{x:120,y:140,w:40,h:40});t.acceptImageEdit({restoreMode:false});const text=await t.renderedTextBoxRecord({id:'text-box-1',x:190,y:145,text:'Editable text',fontSize:20,maxWidth:120,color:'#111111'});t.recordTextBoxesBefore();t.state.textBoxes.push(text);t.saveUserCanvasChange();document.querySelector('#lassoToolBtn').click();t.render();})()");
    const objects=()=>js("({image:(({x,y,w,h,id})=>({x,y,w,h,id}))(lassoMove.state.images[0]),text:(({x,y,w,h,id,text})=>({x,y,w,h,id,text}))(lassoMove.state.textBoxes[0])})");
    const originals=await objects();
    await js("lassoMove.state.scale=1.5;lassoMove.render()");
    await lasso([[100,120],[340,120],[340,210],[100,210],[100,120]]);
    await drag(await point(160,170),await point(210,200));
    const preview=await objects();assert.equal(preview.image.x,originals.image.x+50);assert.equal(preview.text.y,originals.text.y+30);
    assert.ok(await js("lassoMove.buildSelectionImage(lassoMove.state.selection).atlasImage.length")>1000);
    await js("lassoMove.cancelSelection()");assert.deepEqual(await objects(),originals);
    await lasso([[100,120],[340,120],[340,210],[100,210],[100,120]]);await drag(await point(160,170),await point(210,200));
    await js("lassoMove.commitSelection()");const movedObjects=await objects();assert.deepEqual(movedObjects,preview);
    await js("lassoMove.undo()");await pause(200);assert.deepEqual(await objects(),originals);
    await js("lassoMove.redo()");await pause(200);assert.deepEqual(await objects(),movedObjects);
    assert.deepEqual(await widgetGeometry(),originalWidget);
    report.checks.push("Unmerged images and editable text move together at 150% zoom and retain identity, content, cancellation and Undo/Redo");
    await js("lassoMove.captureSelection([{x:600,y:500},{x:700,y:500},{x:700,y:600},{x:600,y:600}]);lassoMove.cancelSelection()");
    const stored=await js("(async()=>{const t=lassoMove,id=await t.saveSnapshot({location:'device',name:'Lasso move acceptance'}),saved=await t.readDeviceSnapshot(id),decoded=await t.decodeSnapshotTilesInBatches(saved.tileEntries,()=>true);return {id,images:saved.item.images.map(({x,y,w,h,id})=>({x,y,w,h,id})),text:saved.item.textBoxes.map(({x,y,id,text})=>({x,y,id,text})),tiles:[...decoded].map(([k,canvas])=>({k,pixel:k==='0,0'?Array.from(canvas.getContext('2d').getImageData(260,490,1,1).data):null}))};})()");
    assert.equal(stored.images[0].x,movedObjects.image.x);assert.equal(stored.text[0].y,movedObjects.text.y);
    assert.deepEqual(stored.tiles.find(tile=>tile.k==='0,0').pixel,mergedColor);
    report.checks.push("Device save and decoded snapshot retain moved image/text coordinates and merged-image destination pixels");
    report.pixels={sourceStroke:await pixel(500,285),mergedDestination:await pixel(260,490)};
    await js("lassoMove.render()");await pause(150);
    fs.writeFileSync(path.join(output,"moved-content.png"),(await win.webContents.capturePage()).toPNG());
    assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report,null,2));
  }catch(error){report.failure=error.stack;console.error(error);if(win)fs.writeFileSync(path.join(output,"failure.png"),(await win.webContents.capturePage()).toPNG());process.exitCode=1;}
  finally{fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));win?.destroy();server?.close();app.exit(process.exitCode||0);}
});
