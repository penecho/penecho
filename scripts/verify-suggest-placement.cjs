"use strict";
// Isolated real Canvas acceptance; deterministic local suggestions, no model calls.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-suggest-placement-")),
  cloud = process.argv.includes("--cloud"), clientFile = cloud ? path.resolve(root, "../penecho_cloud/public/canvas/app.js") : path.join(root, "public/app.js"),
  directory = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || temporary);
fs.mkdirSync(directory, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  const absolute = path.resolve(String(file));
  if (cloud && absolute === path.join(root, "public/style.css")) return readStream.call(this, path.resolve(root, "../penecho_cloud/public/canvas/style.css"), ...args);
  if (absolute === path.join(root, "public/app.js")) return Readable.from([fs.readFileSync(clientFile, "utf8").replace(/\}\)\(\);\s*$/, `
    window.placementTest={state,smartSuggest,tiles,canvasDocumentsReady,loadCanvasSettings,stroke,save,render,insertAssistWidget,hideAssist,renderAssist,assistRefresh,assistView,positionAssist,assistContentMask,canvasViewportMetrics,smartSuggestDrawingStarted,smartSuggestDrawingFinished};
    placementTest.begin=(x,y)=>{
      state.userRevision++;
      const drawing={start:{x,y},last:{x:x+120,y:y+70},bbox:{x,y,w:120,h:70},size:5,color:'#202938',samples:[{point:{x,y},size:5},{point:{x:x+50,y:y+70},size:5},{point:{x:x+120,y:y+20},size:5}]};
      state.drawing=drawing;smartSuggestDrawingStarted(drawing);return drawing;
    };
    placementTest.finish=()=>{
      const d=state.drawing;
      for(let i=1;i<d.samples.length;i++)stroke(d.samples[i-1].point,d.samples[i].point,false,5,true,d.color);
      state.drawing=null;save();smartSuggestDrawingFinished(d);render();
      clearTimeout(smartSuggest.timer);smartSuggest.timer=0;
    };
    placementTest.bounds=()=>{
      const e=smartSuggest.bar.element,c=getComputedStyle(e);
      return {x:parseFloat(c.getPropertyValue('--assist-x')),y:parseFloat(c.getPropertyValue('--assist-y')),w:e.offsetWidth,h:e.offsetHeight,visibility:c.visibility,opacity:c.opacity,pointerEvents:c.pointerEvents,inert:e.inert};
    };
    placementTest.overlap=()=>{
      const b=placementTest.bounds(),c=document.createElement('canvas');c.width=b.w;c.height=b.h;const ctx=c.getContext('2d');
      const region={x:(b.x-state.panX)/state.scale,y:(b.y-state.panY)/state.scale,w:b.w/state.scale,h:b.h/state.scale};
      forTiles(region.x,region.y,region.w,region.h,(tile,tx,ty)=>ctx.drawImage(tile,tx*TILE*state.scale+state.panX-b.x,ty*TILE*state.scale+state.panY-b.y,TILE*state.scale,TILE*state.scale),false);
      const pixels=ctx.getImageData(0,0,c.width,c.height).data;let ink=0;
      for(let i=3;i<pixels.length;i+=4)if(pixels[i])ink++;
      return {ink,widgets:visibleWidgets().map(widgetBox).map(assistScreenBox).filter(r=>intersection(b,r)).length,bounds:b};
    };
    const originalFetch=window.fetch;
    window.fetch=(url,options)=>String(url).endsWith('/suggest/status')?Promise.resolve(new Response(JSON.stringify({configured:false}),{headers:{'Content-Type':'application/json'}})):originalFetch(url,options);
  })();`)]);
  return readStream.call(this, file, ...args);
};
let server, win;
const report = { runtime:cloud ? "cloud-client" : "local", clientFile, checks:[], errors:[] };
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1440, height:1000, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const run = code => win.webContents.executeJavaScript(code), wait = async expression => {
      const until = Date.now() + 10000;
      while (!await run(expression)) { if (Date.now() > until) throw Error("Timed out: " + expression); await new Promise(resolve => setTimeout(resolve, 30)); }
    }, snapshot = async name => {
      await wait("placementTest.smartSuggest.bar && placementTest.bounds().visibility==='visible' && Number(placementTest.bounds().opacity)>.99");
      fs.writeFileSync(path.join(directory, name + ".png"), (await win.webContents.capturePage()).toPNG());
    }, assertClear = async name => {
      const result = await run("placementTest.overlap()");
      assert.equal(result.ink, 0, name + ": raster ink"); assert.equal(result.widgets, 0, name + ": Widget");
      report.checks.push({ name, ...result });
    };
    await run(`(async()=>{const t=placementTest,s=t.state;await t.canvasDocumentsReady();await t.loadCanvasSettings();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();s.language='en';s.auto=false;s.scale=1;s.panX=0;s.panY=0;s.mode='pen';t.smartSuggest.enabled=true;t.smartSuggest.available=false;
      // Previously loaded/consumed ink has raster pixels but no recent-stroke record.
      t.stroke({x:410,y:370},{x:1000,y:370},false,100,false,'#2563eb');t.save();
      t.begin(300,200);t.finish();})()`);
    assert.equal(await run("placementTest.smartSuggest.strokes.length"), 1);
    await snapshot("older-ink");
    await assertClear("First display avoids older ink outside the stroke log");
    await run(`(async()=>{const t=placementTest,b=t.bounds();await t.insertAssistWidget({x:b.x,y:b.y,w:b.w+40,h:180,title:'Existing Widget',html:'<!doctype html><html><body style="margin:0;padding:24px;background:#edf4fb;font:24px system-ui;color:#334155">Existing Widget</body></html>'},{place:'exact'});t.positionAssist();t.render();})()`);
    await assertClear("Widget added at the former position triggers relocation");
    await snapshot("widget-avoidance");
    const hidden = await run(`(()=>{const t=placementTest,b=t.bounds(),before=t.smartSuggest.bar;t.previousElement=before.element;t.begin(b.x+10,b.y+10);const immediate=t.bounds(),cluster=before.cluster,view=before.view;
      // Re-render every request/result state while the same stroke is active.
      const states=['suggest','working','result','followup'].map(mode=>{t.renderAssist({mode,box:cluster.box,cluster,view:mode==='suggest'?{...view,source:'penecho-llm'}:view,target:{box:cluster.box,strokes:[]},action:{id:'answer'},label:'Working'});return {mode,...t.bounds()};});
      t.renderAssist({mode:'suggest',box:cluster.box,cluster,view});
      return {immediate,states};})()`);
    for (const entry of [hidden.immediate, ...hidden.states]) {
      assert.equal(entry.visibility, "hidden"); assert.equal(entry.opacity, "0"); assert.equal(entry.pointerEvents, "none"); assert.equal(entry.inert, true);
    }
    report.checks.push({ name:"Pen-down and late ranking/progress/result renders are immediately hidden", ...hidden });
    await run("placementTest.finish()");
    await snapshot("pen-up");
    assert.equal(await run("placementTest.previousElement===placementTest.smartSuggest.bar.element"), true);
    await assertClear("Pen-up recalculates after a stroke crosses the former bar position");
    const cached = await run(`(()=>{const t=placementTest,m=t.canvasViewportMetrics(),mask=t.assistContentMask(m.width,m.height),before=t.bounds(),at=performance.now();for(let i=0;i<100;i++)t.positionAssist();return {sameMask:mask===t.assistContentMask(m.width,m.height),before,after:t.bounds(),elapsedMs:performance.now()-at};})()`);
    assert.equal(cached.sameMask, true); assert.deepEqual(cached.before, cached.after);
    report.checks.push({ name:"Unchanged frames reuse occupancy and keep the same position", ...cached });
    await run("placementTest.state.scale=.7;placementTest.state.panX=40;placementTest.state.panY=70;placementTest.positionAssist();placementTest.render()");
    await new Promise(resolve=>setTimeout(resolve,180));
    await run("placementTest.positionAssist()");
    await assertClear("Pan and zoom recompute clear placement");
    await snapshot("pan-zoom");
    await run("placementTest.state.panX=-30000;placementTest.state.panY=-30000;placementTest.positionAssist()");
    await new Promise(resolve=>setTimeout(resolve,180));
    await run("placementTest.positionAssist()");
    await assertClear("Panning beyond the Canvas handles an empty viewport");
    await run("placementTest.state.scale=1;placementTest.state.panX=0;placementTest.state.panY=0;placementTest.state.userRevision++;placementTest.stroke({x:0,y:400},{x:1600,y:400},false,2400,false,'#e2e8f0');placementTest.save();placementTest.positionAssist();placementTest.render()");
    await new Promise(resolve=>setTimeout(resolve,180));
    await run("placementTest.positionAssist()");
    const dense = await run("placementTest.overlap()"); assert.ok(dense.ink > 0);
    assert.ok(dense.bounds.y + dense.bounds.h <= await run("placementTest.canvasViewportMetrics().height-84"));
    report.checks.push({ name:"Fully occupied viewport uses overlap only as a fallback and keeps toolbar clearance", ...dense });
    await snapshot("unavoidable-overlap");
    assert.deepEqual(report.errors, []);
    fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ directory, runtime:report.runtime, checks:report.checks.length, cachedFrameMs:cached.elapsedMs, errors:report.errors }));
  } finally {
    win?.destroy(); server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve));
    if (directory !== temporary) fs.rmSync(temporary, { recursive:true, force:true });
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
