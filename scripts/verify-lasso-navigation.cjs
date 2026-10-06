"use strict";
// Isolated renderer acceptance and navigation cost comparison. Run --baseline
// before changing the client; --output=<directory> retains the report and images.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "lasso-navigation-")),
  baseline = process.argv.includes("--baseline"),
  output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || temporary);
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const injection = `
  const navigationCounts={full:0,ink:0,placed:0,interaction:0,preview:[]};
  const renderOriginal=render,inkOriginal=renderInkLayer,placedOriginal=renderPlacedContentLayer,interactionOriginal=renderInteractionLayer;
  render=(...args)=>{navigationCounts.full++;return renderOriginal(...args);};
  renderInkLayer=(...args)=>{navigationCounts.ink++;return inkOriginal(...args);};
  renderPlacedContentLayer=(...args)=>{navigationCounts.placed++;return placedOriginal(...args);};
  renderInteractionLayer=(...args)=>{navigationCounts.interaction++;return interactionOriginal(...args);};
  const previewOriginal=applyCanvasNavigationPreview;
  applyCanvasNavigationPreview=()=>{const start=performance.now();previewOriginal();navigationCounts.preview.push(performance.now()-start);};
  window.lassoNavigation={state,canvasDocumentsReady,loadCanvasSettings,stroke,save,render,setCanvasMode,captureSelection,captureInkSelection,cancelSelection,moveCanvas,zoomCanvasAt,renderInteractionLayer,finishCanvasNavigationPreview,navigationCounts};
  lassoNavigation.snapshot=()=>{
    const matrix=new DOMMatrix(getComputedStyle(interactionLayer).transform),inkMatrix=new DOMMatrix(getComputedStyle(inkLayer).transform),
      data=interactionCtx.getImageData(0,0,interactionLayer.width,interactionLayer.height),d=devicePixelRatio||1;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(let y=0;y<data.height;y++)for(let x=0;x<data.width;x++){
      const i=(y*data.width+x)*4;
      if(data.data[i+3]>100&&data.data[i]<90&&data.data[i+1]>70&&data.data[i+2]>130){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    }
    return{preview:view.classList.contains('canvas-navigation-previewing'),camera:{x:state.panX,y:state.panY,scale:state.scale},
      matrix:[matrix.a,matrix.d,matrix.e,matrix.f],inkMatrix:[inkMatrix.a,inkMatrix.d,inkMatrix.e,inkMatrix.f],
      raw:{x:minX/d,y:minY/d,w:(maxX-minX+1)/d,h:(maxY-minY+1)/d},
      displayed:{x:minX/d*matrix.a+matrix.e,y:minY/d*matrix.d+matrix.f},counts:{...navigationCounts,preview:undefined},fragments:state.selection.fragments.length};
  };
  lassoNavigation.prepare=lift=>{
    if(state.selection)cancelSelection(true);
    state.panX=20;state.panY=30;state.scale=1;setCanvasMode('select');
    const points=[{x:300,y:220},{x:500,y:220},{x:500,y:380},{x:300,y:380}];
    captureSelection(points);if(lift)captureInkSelection(points,state.selection);render();
    navigationCounts.full=navigationCounts.ink=navigationCounts.placed=navigationCounts.interaction=0;navigationCounts.preview=[];
  };
  lassoNavigation.measure=async(lift,refresh)=>{
    lassoNavigation.prepare(lift);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    navigationCounts.full=navigationCounts.ink=navigationCounts.placed=navigationCounts.interaction=0;navigationCounts.preview=[];
    const frames=[];let previous=0;
    for(let i=0;i<60;i++){
      await new Promise(requestAnimationFrame);const now=performance.now();if(previous)frames.push(now-previous);previous=now;
      moveCanvas(2,1);if(refresh)renderInteractionLayer();
    }
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    const snapshot=lassoNavigation.snapshot(),sample=values=>{values.sort((a,b)=>a-b);return{medianMs:values[Math.floor(values.length*.5)],p95Ms:values[Math.floor(values.length*.95)],maxMs:values.at(-1)}};
    const result={lift,refresh,snapshot,previewWork:sample(navigationCounts.preview),frames:sample(frames)};
    finishCanvasNavigationPreview();return result;
  };
`;
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) return Readable.from([fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, injection + "})();")]);
  return readStream.call(this, file, ...args);
};
let server, win;
const report = { baseline, cases:[], checks:[], errors:[] };
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:true, width:1440, height:900, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const js = code => win.webContents.executeJavaScript(code, true);
    await js(`(async()=>{const t=lassoNavigation,s=t.state;await t.canvasDocumentsReady();await t.loadCanvasSettings();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();s.auto=false;
      for(let y=80;y<1600;y+=100)for(let x=80;x<2200;x+=150)t.stroke({x,y},{x:x+90,y:y+35},false,5,false,'#111827');t.save();t.render();})()`);
    for (const lift of [false, true]) for (const refresh of [false, true]) {
      const result = await js(`lassoNavigation.measure(${lift},${refresh})`);
      report.cases.push(result);
      assert.equal(result.snapshot.counts.full, 0, "no full Canvas redraw during small navigation steps");
      assert.equal(result.snapshot.counts.ink, 0, "no ink redraw during small navigation steps");
      assert.equal(result.snapshot.counts.placed, 0, "no placed-content redraw during small navigation steps");
      assert.equal(result.snapshot.counts.interaction, refresh ? 60 : 0, "navigation adds no interaction redraws");
      if (!baseline) {
        assert.deepEqual(result.snapshot.matrix, result.snapshot.inkMatrix, "lasso and ink share the same compositor transform");
        assert.ok(Math.abs(result.snapshot.displayed.x - (result.snapshot.camera.x + 300 - 1)) < 3, "lasso stays over its selected content");
      }
      if (lift) assert.ok(result.snapshot.fragments > 0, "selected ink remains present");
    }
    report.checks.push("60-frame pans retain the preview path without full, ink or placed-content redraws, including lifted ink and interaction refreshes");
    win.webContents.debugger.attach("1.3");
    const mouse = (type, x, y, extra = {}) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type,x,y,button:type === "mouseMoved" ? "none" : "left",...extra });
    await js("lassoNavigation.prepare(false);document.activeElement?.blur()");
    const point = await js("(()=>{const r=document.querySelector('#viewport').getBoundingClientRect();return{x:r.x+720,y:r.y+430}})()");
    win.webContents.sendInputEvent({ type:"keyDown",keyCode:"Space" });
    await mouse("mousePressed", point.x, point.y, { buttons:1,clickCount:1 });
    for (let i = 1; i <= 8; i++) {
      await mouse("mouseMoved", point.x+i*8, point.y+i*4, { button:"left",buttons:1 });
      await js("new Promise(requestAnimationFrame)");
    }
    report.mouseDuring = await js("lassoNavigation.snapshot()");
    assert.ok(report.mouseDuring.preview, "inspect while the mouse is still dragging");
    if (!baseline) assert.deepEqual(report.mouseDuring.matrix, report.mouseDuring.inkMatrix);
    fs.writeFileSync(path.join(output, "mouse-during.png"), (await win.webContents.capturePage()).toPNG());
    await mouse("mouseReleased", point.x+64, point.y+32, { buttons:0,clickCount:1 });
    win.webContents.sendInputEvent({ type:"keyUp",keyCode:"Space" });
    report.mouseAfter = await js("lassoNavigation.snapshot()");
    assert.equal(report.mouseAfter.preview, false);
    if (!baseline) assert.ok(Math.abs(report.mouseAfter.displayed.x-report.mouseDuring.displayed.x)<2, "release does not jump the lasso");
    fs.writeFileSync(path.join(output, "mouse-after.png"), (await win.webContents.capturePage()).toPNG());
    report.checks.push("native Space + mouse pan moves the lasso before release and settles without jumping");
    if (!baseline) {
      const touch = (type, touchPoints) => win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", { type,touchPoints });
      for (const fingers of [1, 2]) {
        await js("lassoNavigation.prepare(false)");
        const points = Array.from({ length:fingers }, (_, i) => ({ x:point.x+i*80,y:point.y,id:i+1 }));
        await touch("touchStart", points);
        for (let step = 1; step <= 8; step++) {
          await touch("touchMove", points.map((p, i) => ({ ...p,x:p.x+step*(i ? 7 : 4),y:p.y+step*3 })));
          await js("new Promise(requestAnimationFrame)");
        }
        const during = await js("lassoNavigation.snapshot()");
        assert.ok(during.preview, "touch navigation remains active before release");
        assert.deepEqual(during.matrix, during.inkMatrix, "touch lasso and ink stay aligned");
        assert.ok(Math.abs(during.displayed.x-(during.camera.x+299*during.camera.scale))<3);
        await touch("touchEnd", []);
        const settled = await js("lassoNavigation.snapshot()");
        assert.equal(settled.preview, false);
        assert.ok(Math.abs(settled.displayed.x-during.displayed.x)<2, "touch release does not jump the lasso");
        report.cases.push({ fingers,during,settled });
      }
      report.checks.push("native one-finger pan and two-finger pan/zoom keep lasso alignment before and after release");
    }
    for (const width of [1440, 390]) {
      win.setContentSize(width, 900);
      await js("new Promise(resolve=>setTimeout(resolve,150))");
      await js(`(async()=>{lassoNavigation.prepare(false);lassoNavigation.moveCanvas(45,30);await new Promise(requestAnimationFrame);lassoNavigation.zoomCanvasAt(180,250,-50);await new Promise(requestAnimationFrame);lassoNavigation.renderInteractionLayer();})()`);
      const zoom = await js("lassoNavigation.snapshot()");
      report.cases.push({ width,zoom });
      if (!baseline) {
        assert.deepEqual(zoom.matrix, zoom.inkMatrix, "zoom shares the same transform");
        assert.ok(Math.abs(zoom.displayed.x-(zoom.camera.x+299*zoom.camera.scale))<3, "refresh during zoom applies the camera once");
      }
      await js("lassoNavigation.finishCanvasNavigationPreview()");
    }
    report.checks.push("wide and narrow zooms preserve alignment during an interaction-layer refresh");
    assert.deepEqual(report.errors, []);
    report.ok = true;
  } catch (error) {
    report.ok = false; report.failure = error.stack;
  } finally {
    fs.createReadStream = readStream;
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    win?.destroy(); server?.closeAllConnections?.();
    if (server) await new Promise(resolve => server.close(resolve));
    if (output !== temporary) fs.rmSync(temporary, { recursive:true,force:true });
    app.exit(report.ok ? 0 : 1);
  }
});
