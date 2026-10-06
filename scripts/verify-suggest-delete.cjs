"use strict";
// Real Canvas UI: standalone local Delete, no Suggest deletion action, isolated test data.
// Run with tools/electron/node_modules/.bin/electron [--cloud] [--client=...] [--output=...].
const { app, BrowserWindow } = require("electron"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-suggest-delete-")), cloud = process.argv.includes("--cloud"),
  clientArgument = process.argv.find(arg => arg.startsWith("--client=")),
  clientFile = clientArgument ? path.resolve(clientArgument.slice(9)) : cloud ? path.resolve(root, "../penecho_cloud/public/canvas/app.js") : path.join(root, "public/app.js"),
  directory = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || temporary);
fs.mkdirSync(directory, { recursive:true }); app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary,"state"), PENECHO_CONFIG_FILE:path.join(temporary,"config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) return Readable.from([fs.readFileSync(clientFile,"utf8").replace(/\}\)\(\);\s*$/, `
    if(${cloud})Object.assign(window.PENECHO_CONFIG,{runtime:'cloud',connectionAccountId:'test-only',linkedDeviceId:'test-only',linkedDeviceOnline:true});
    window.deleteTest={state,smartSuggest,penIntel,maxHistory:MAX_HISTORY,canvasDocumentsReady,loadCanvasSettings,loadHostedModels,settings,aiConnectionScope,storeAiConnectionSelection,save,render,assistRefresh,hideAssist,acceptPending,rejectPending,undo,redo,restoreWidgets,runSmartSuggest,resolvePenGesture,penIntelStrokeFinished,assistDetectDeletion,penUpTimings:[],rasterTimings:[],commands:[],requests:[],reply:'erase'};
    const originalRasterDeletion=penIntelRasterDeletion;
    penIntelRasterDeletion=(...args)=>{const t=performance.now();try{return originalRasterDeletion(...args);}finally{deleteTest.rasterTimings.push(performance.now()-t);}};
    deleteTest.addInk=points=>{
      const box=window.PENECHO_PEN_INTEL.bounds(points),drawing={start:points[0],last:points.at(-1),bbox:{x:box.x-3,y:box.y-3,w:box.w+6,h:box.h+6},size:5,color:'#202938',samples:points.map(point=>({point,size:5}))};
      state.mode='pen';state.drawing=drawing;smartSuggestDrawingStarted(drawing);
      for(let i=1;i<points.length;i++)stroke(points[i-1],points[i],false,5,true,drawing.color);
      state.drawing=null;save();const detectStart=performance.now();smartSuggestDrawingFinished(drawing);deleteTest.penUpTimings.push(performance.now()-detectStart);render();
      clearTimeout(smartSuggest.timer);clearTimeout(smartSuggest.localTimer);smartSuggest.timer=smartSuggest.localTimer=0;
      assistRefresh('test-ink');return smartSuggest.strokes.at(-1).id;
    };
    deleteTest.alpha=(x,y)=>{const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.translate(-x,-y);forTiles(x,y,1,1,(tile,tx,ty)=>ctx.drawImage(tile,tx*TILE,ty*TILE),false);return ctx.getImageData(0,0,1,1).data[3];};
    deleteTest.renderedAlpha=(x,y)=>inkCtx.getImageData(Math.round((x*state.scale+state.panX)*devicePixelRatio),Math.round((y*state.scale+state.panY)*devicePixelRatio),1,1).data[3];
    const originalFetch=window.fetch;
    window.fetch=async(url,options)=>{
      const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}),t=deleteTest;
      if(url==='/api/v1/models')return json({accountId:'test-only',models:[],credits:{available:1}});
      if(String(url).endsWith('/suggest/status'))return json({configured:true,model:'PenEchoLLM'});
      if(String(url).endsWith('/suggest')){const body=JSON.parse(options.body);t.requests.push(body);if(body.mode==='gesture')return json({ok:true,answers:{command:{type:'noul',noul:.98},gesture:{type:'choice',choice:t.gestureReply||'none',confidence:.98}}});return json({ok:true,answers:{kind:{type:'choice',choice:'deletion',probabilities:{deletion:1}},action:{type:'choice',choice:'delete',probabilities:{delete:.95,none:.05}},finished:{type:'noul',noul:1}}});}
      if(url==='/api/ai/command'){
        const body=JSON.parse(options.body);t.commands.push(body);
        if(t.reply==='failure')return json({error:'Controlled failure'},500);
        if(body.widgetEdit){const w=state.widgets.find(w=>w.id==='widget-1');return json({requestId:'delete-widget',commands:[{tool:'html_widget',pluginId:'general',title:w.title,x:w.x,y:w.y,w:w.w,h:w.h,refreshSeconds:0,html:w.html.replace('<p id="remove">Remove this line</p>','')}]});}
        return json({requestId:'delete-ink',commands:[{tool:'erase',mode:'rect',x:230,y:235,w:180,h:65},{tool:'erase',mode:'rect',x:0,y:0,w:20000,h:20000},{tool:'draw',origin:[100,100],types:['rect'],items:[[0,0,50,50]],width:5}]});
      }
      return originalFetch(url,options);
    };
  })();`)]);
  return readStream.call(this, file, ...args);
};
let server, win;
const report = { runtime:cloud ? "cloud" : "local", clientFile, checks:[], errors:[] };
app.whenReady().then(async () => {
  try {
    server = require("../server.js"); server.prependListener("request",req => { if(cloud && req.url.startsWith("/canvas/"))req.url=req.url.slice("/canvas".length); });
    await new Promise(resolve => server.listening ? resolve() : server.once("listening",resolve));
    win = new BrowserWindow({ show:false,width:1440,height:1000,webPreferences:{ contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true } });
    win.webContents.on("console-message",(_event,level,message) => { if(level>=3)report.errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const run = async code => {
      const expression = !code.startsWith("if(") && (!code.includes(";") || code.startsWith("(")),
        body = expression ? `return {ok:true,value:await (${code})};` : `${code};return {ok:true};`,
        result = await win.webContents.executeJavaScript(`(async()=>{try{${body}}catch(error){return {ok:false,error:String(error.stack||error)};}})()`);
      if (!result.ok) throw Error(result.error + "\nWhile running: " + code.slice(0,240));
      return result.value;
    }, wait = async condition => {
      const deadline = Date.now()+15000;
      while(!await run(condition)){if(Date.now()>deadline)throw Error("Timed out: "+condition+" "+JSON.stringify(await run('({status:deleteTest.state.statusKey,pending:!!deleteTest.state.pending,requests:deleteTest.commands.length})')));await new Promise(resolve=>setTimeout(resolve,50));}
    }, screenshot = async name => {
      await run("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      fs.writeFileSync(path.join(directory,name+".png"),(await win.webContents.capturePage()).toPNG());
    };
    await run(`(async()=>{const t=deleteTest,s=t.state;await t.canvasDocumentsReady();await t.loadCanvasSettings();if(window.PENECHO_CONFIG.runtime==='cloud'){await t.loadHostedModels({accountChanged:true});t.settings.connections=[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',provider:'api',hasApiKey:true,apiUrl:'http://127.0.0.1:1/v1',apiModel:'test'}];t.settings.connectionScope=t.aiConnectionScope();}t.storeAiConnectionSelection(t.settings.connections[0].id);document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelector('#canvasWelcome').hidden=true;s.language='zh';s.auto=false;s.scale=1;s.panX=s.panY=0;s.mode='pen';s.viewInitialized=true;t.smartSuggest.enabled=true;t.smartSuggest.available=false;t.penIntel.settings.gestures=true;})()`);
    const maxHistory = await run("deleteTest.maxHistory");
    await run(`(()=>{const t=deleteTest;t.addInk([{x:245,y:290},{x:245,y:240},{x:260,y:245},{x:275,y:280},{x:290,y:240},{x:305,y:280},{x:320,y:240},{x:335,y:280},{x:350,y:240},{x:370,y:270},{x:390,y:245}]);t.addInk([{x:245,y:365},{x:275,y:345},{x:305,y:365},{x:335,y:345},{x:370,y:365}]);for(const r of t.smartSuggest.strokes)r.at-=2000;t.addInk(Array.from({length:25},(_,i)=>({x:235+i*7,y:263})));})()`);
    assert.equal(await run("deleteTest.smartSuggest.strokes.at(-1).deletionGesture?.shape"),"strike");
    assert.equal(await run("window.PENECHO_SMART_SUGGEST.actionById('delete')"),null);
    assert.equal(await run("document.querySelector('.assist-bar [data-suggestion=delete]')"),null);
    await run("deleteTest.resolvePenGesture()");
    await wait("document.querySelector('.pen-gesture-offer [data-gesture=delete]')");
    assert.equal(await run("deleteTest.commands.length"),0);
    assert.equal(await run("deleteTest.requests.length"),0,"strong local crossings do not require AI recognition");
    assert.equal(await run("document.querySelector('.assist-bar')?.classList.contains('visible')||false"),false);
    await wait("Number(getComputedStyle(document.querySelector('.pen-gesture-offer')).opacity)>.99"); await screenshot("independent-delete");
    await run("document.querySelector('.pen-gesture-offer .pen-intel-quiet').click()");
    assert.equal(await run("deleteTest.alpha(245,250)>0 && deleteTest.alpha(400,263)>0"),true);
    await run("deleteTest.penIntelStrokeFinished(deleteTest.smartSuggest.strokes.at(-1));deleteTest.resolvePenGesture()");
    await wait("document.querySelector('.pen-gesture-offer [data-gesture=delete]')");
    const beforeDeleteHistory = await run("deleteTest.state.history.length");
    await run("document.querySelector('.pen-gesture-offer [data-gesture=delete]').click()");
    assert.equal(await run("deleteTest.commands.length"),0,"standalone Delete makes no Canvas AI request");
    assert.equal(await run("Boolean(deleteTest.state.pending || deleteTest.state.activeAI || deleteTest.state.busy)"),false);
    assert.equal(await run("deleteTest.state.history.length"),Math.min(maxHistory,beforeDeleteHistory+1));
    assert.equal(await run("deleteTest.alpha(245,250)"),0);
    assert.equal(await run("deleteTest.alpha(260,355)>0"),true);
    await screenshot("ink-deleted");
    await run("deleteTest.undo()"); assert.equal(await run("deleteTest.alpha(245,250)>0 && deleteTest.alpha(400,263)>0"),true);
    await run("deleteTest.redo()"); assert.equal(await run("deleteTest.alpha(245,250)===0 && deleteTest.alpha(400,263)===0 && deleteTest.alpha(260,355)>0"),true);
    await run("deleteTest.undo()");
    report.checks.push("Delete is absent from Suggest. The standalone offer works with Suggest enabled and offline. Keep as ink preserves content; Delete erases strokes and marks locally in one Undo/Redo step with zero AI requests, preserving the next row.");
    await run(`(()=>{const t=deleteTest;t.smartSuggest.strokes=[];t.smartSuggest.consumedStrokeId=0;t.addInk([{x:70,y:600},{x:70,y:650},{x:85,y:600},{x:100,y:650},{x:115,y:600},{x:130,y:650}]);t.addInk([{x:70,y:730},{x:100,y:750},{x:130,y:730}]);for(const r of t.smartSuggest.strokes)r.at-=2000;t.addInk([{x:50,y:630},{x:200,y:630}]);t.addInk([{x:50,y:657},{x:200,y:657}]);})()`);
    assert.equal(await run("deleteTest.penIntel.gesture.records.length"),2,"the second line retains both command marks, including when it misses the handwriting");
    await run("deleteTest.resolvePenGesture()");
    await wait("document.querySelector('.pen-gesture-offer [data-gesture=delete]')");
    const doubleInkHistory = await run("deleteTest.state.history.length");
    await screenshot("double-line-ink-offer");
    await run("document.querySelector('.pen-gesture-offer [data-gesture=delete]').click()");
    assert.equal(await run("deleteTest.alpha(70,610)===0 && deleteTest.alpha(180,630)===0 && deleteTest.alpha(180,657)===0 && deleteTest.alpha(100,750)>0"),true);
    assert.equal(await run("deleteTest.state.history.length"),Math.min(maxHistory,doubleInkHistory+1));
    await wait("deleteTest.renderedAlpha(70,610)===0 && deleteTest.renderedAlpha(180,630)===0 && deleteTest.renderedAlpha(180,657)===0 && deleteTest.renderedAlpha(100,750)>0");
    await screenshot("double-line-ink-deleted");
    await run("deleteTest.undo()");
    assert.equal(await run("deleteTest.alpha(70,610)>0 && deleteTest.alpha(180,630)>0 && deleteTest.alpha(180,657)>0"),true);
    await run("deleteTest.redo()");
    assert.equal(await run("deleteTest.alpha(70,610)===0 && deleteTest.alpha(180,630)===0 && deleteTest.alpha(180,657)===0 && deleteTest.alpha(100,750)>0"),true);
    report.checks.push("Two cancellation lines delete the original handwriting and both marks in one Undo/Redo step, even when the second line narrowly misses the content. Adjacent writing survives.");
    for (const count of [3,5,8]) {
      await run(`(()=>{const t=deleteTest;t.smartSuggest.strokes=[];t.smartSuggest.consumedStrokeId=0;t.addInk([{x:520,y:600},{x:520,y:650},{x:535,y:600},{x:550,y:650},{x:565,y:600},{x:580,y:650}]);t.addInk([{x:520,y:730},{x:550,y:750},{x:580,y:730}]);for(const r of t.smartSuggest.strokes)r.at-=2000;for(let i=0;i<${count};i++)t.addInk([{x:490,y:625+i*3},{x:650,y:625+i*3}]);})()`);
      assert.equal(await run("deleteTest.penIntel.gesture.records.length"),count);
      await run("deleteTest.resolvePenGesture()");
      await wait("document.querySelector('.pen-gesture-offer [data-gesture=delete]')");
      const before = await run("deleteTest.state.history.length");
      await screenshot(`${count}-line-ink-offer`);
      await run("document.querySelector('.pen-gesture-offer [data-gesture=delete]').click()");
      const erased = `deleteTest.alpha(520,610)===0 && Array.from({length:${count}},(_,i)=>deleteTest.alpha(630,625+i*3)).every(a=>a===0) && deleteTest.alpha(550,750)>0`,
        restored = `deleteTest.alpha(520,610)>0 && Array.from({length:${count}},(_,i)=>deleteTest.alpha(630,625+i*3)).every(a=>a>0) && deleteTest.alpha(550,750)>0`;
      assert.equal(await run(erased),true);
      assert.equal(await run("deleteTest.state.history.length"),Math.min(maxHistory,before+1));
      await wait(`deleteTest.renderedAlpha(520,610)===0 && Array.from({length:${count}},(_,i)=>deleteTest.renderedAlpha(630,625+i*3)).every(a=>a===0) && deleteTest.renderedAlpha(550,750)>0`);
      await screenshot(`${count}-line-ink-deleted`);
      await run("deleteTest.undo()"); assert.equal(await run(restored),true);
      await run("deleteTest.redo()"); assert.equal(await run(erased),true);
      report.checks.push(`${count} cancellation lines delete the original handwriting and every mark in one Undo/Redo step, with neighboring content preserved in stored and painted ink.`);
    }
    await run(`(()=>{const t=deleteTest;t.addInk([{x:320,y:600},{x:320,y:655}]);t.addInk([{x:400,y:600},{x:400,y:655}]);t.addInk([{x:360,y:605},{x:360,y:610}]);t.smartSuggest.strokes=[];t.smartSuggest.consumedStrokeId=0;t.addInk([{x:290,y:618},{x:440,y:638}]);t.addInk([{x:290,y:628},{x:440,y:628}]);})()`);
    await wait("deleteTest.smartSuggest.strokes.at(-1).deletionGesture?.raster===true");
    await wait("document.querySelector('.pen-gesture-offer [data-gesture=delete]')");
    assert.equal(await run("deleteTest.penIntel.offer.pending.records.length"),2,"rapid raster marks share the pre-first-mark snapshot");
    const doubleRasterHistory = await run("deleteTest.state.history.length");
    await screenshot("double-line-raster-offer");
    await run("document.querySelector('.pen-gesture-offer [data-gesture=delete]').click()");
    assert.equal(await run("deleteTest.alpha(320,605)===0 && deleteTest.alpha(400,605)===0 && deleteTest.alpha(365,628)===0 && deleteTest.alpha(425,636)===0 && deleteTest.alpha(360,608)>0"),true);
    assert.equal(await run("deleteTest.state.history.length"),Math.min(maxHistory,doubleRasterHistory+1));
    await wait("deleteTest.renderedAlpha(320,605)===0 && deleteTest.renderedAlpha(400,605)===0 && deleteTest.renderedAlpha(365,628)===0 && deleteTest.renderedAlpha(425,636)===0 && deleteTest.renderedAlpha(360,608)>0");
    await screenshot("double-line-raster-deleted");
    await run("deleteTest.undo()");
    assert.equal(await run("deleteTest.alpha(320,605)>0 && deleteTest.alpha(400,605)>0 && deleteTest.alpha(365,628)>0 && deleteTest.alpha(425,636)>0 && deleteTest.alpha(360,608)>0"),true);
    await run("deleteTest.redo()");
    assert.equal(await run("deleteTest.alpha(320,605)===0 && deleteTest.alpha(400,605)===0 && deleteTest.alpha(365,628)===0 && deleteTest.alpha(425,636)===0 && deleteTest.alpha(360,608)>0"),true);
    report.checks.push("Rapid intersecting cancellation lines over loaded raster ink delete the original crossed components and both marks, preserve unrelated ink inside their bounds, and restore all deleted ink with one Undo.");
    for (const count of [3,5,8]) {
      await run(`(()=>{const t=deleteTest;t.addInk([{x:320,y:600},{x:320,y:655}]);t.addInk([{x:400,y:600},{x:400,y:655}]);t.smartSuggest.strokes=[];t.smartSuggest.consumedStrokeId=0;t.addInk([{x:290,y:618},{x:440,y:638}]);for(let i=1;i<${count};i++)t.addInk([{x:290,y:628+(i-1)*2},{x:440,y:628+(i-1)*2}]);})()`);
      await wait("deleteTest.smartSuggest.strokes.at(-1).deletionGesture?.raster===true");
      await wait("document.querySelector('.pen-gesture-offer [data-gesture=delete]')");
      assert.equal(await run("deleteTest.penIntel.offer.pending.records.length"),count);
      const before = await run("deleteTest.state.history.length");
      await screenshot(`${count}-line-raster-offer`);
      await run("document.querySelector('.pen-gesture-offer [data-gesture=delete]').click()");
      const erased = `deleteTest.alpha(320,605)===0 && deleteTest.alpha(400,605)===0 && deleteTest.alpha(425,636)===0 && Array.from({length:${count-1}},(_,i)=>deleteTest.alpha(435,628+i*2)).every(a=>a===0) && deleteTest.alpha(360,608)>0`,
        restored = `deleteTest.alpha(320,605)>0 && deleteTest.alpha(400,605)>0 && deleteTest.alpha(425,636)>0 && Array.from({length:${count-1}},(_,i)=>deleteTest.alpha(435,628+i*2)).every(a=>a>0) && deleteTest.alpha(360,608)>0`;
      assert.equal(await run(erased),true);
      assert.equal(await run("deleteTest.state.history.length"),Math.min(maxHistory,before+1));
      await wait(`deleteTest.renderedAlpha(320,605)===0 && deleteTest.renderedAlpha(400,605)===0 && deleteTest.renderedAlpha(425,636)===0 && Array.from({length:${count-1}},(_,i)=>deleteTest.renderedAlpha(435,628+i*2)).every(a=>a===0) && deleteTest.renderedAlpha(360,608)>0`);
      await screenshot(`${count}-line-raster-deleted`);
      await run("deleteTest.undo()"); assert.equal(await run(restored),true);
      await run("deleteTest.redo()"); assert.equal(await run(erased),true);
      report.checks.push(`${count} rapid cancellation lines delete loaded crossed ink and every mark using the pre-first-mark snapshot, preserving unrelated ink and supporting one-step Undo/Redo.`);
    }
    await run("deleteTest.smartSuggest.enabled=false;deleteTest.smartSuggest.strokes=[];deleteTest.smartSuggest.consumedStrokeId=0;deleteTest.addInk(Array.from({length:25},(_,i)=>({x:235+i*7,y:263})))");
    await wait("deleteTest.smartSuggest.strokes.at(-1).deletionGesture?.shape==='strike'");
    await wait("document.querySelector('.pen-gesture-offer [data-gesture=delete]')");
    await run("document.querySelector('.pen-gesture-offer [data-gesture=delete]').click()");
    assert.equal(await run("deleteTest.alpha(245,250)===0 && deleteTest.alpha(260,355)>0 && deleteTest.commands.length===0 && !deleteTest.state.pending"),true);
    await run("deleteTest.undo()");
    await run("(()=>{const t=deleteTest;t.addInk([{x:70,y:530},{x:70,y:590}]);t.addInk([{x:130,y:530},{x:130,y:590}]);t.addInk([{x:100,y:540},{x:100,y:545}]);t.smartSuggest.strokes=[];t.smartSuggest.consumedStrokeId=0;t.addInk([{x:50,y:560},{x:160,y:560}]);})()");
    await wait("deleteTest.smartSuggest.strokes.at(-1).deletionGesture?.raster===true");
    await wait("document.querySelector('.pen-gesture-offer [data-gesture=delete]')");
    await run("document.querySelector('.pen-gesture-offer [data-gesture=delete]').click()");
    assert.equal(await run("deleteTest.alpha(70,550)===0 && deleteTest.alpha(130,550)===0 && deleteTest.alpha(100,543)>0 && deleteTest.commands.length===0"),true);
    await screenshot("raster-components-deleted");
    await run("deleteTest.undo()"); assert.equal(await run("deleteTest.alpha(70,550)>0 && deleteTest.alpha(130,550)>0 && deleteTest.alpha(100,543)>0"),true);
    report.checks.push("With Suggest disabled, raster ink deletes locally using only crossed connected components. Unrelated ink inside their combined bounds survives, and Undo restores the deleted components.");
    await run(`(()=>{const t=deleteTest;t.smartSuggest.strokes=[];t.smartSuggest.consumedStrokeId=0;t.addInk([{x:750,y:600},{x:750,y:650},{x:765,y:600},{x:780,y:650},{x:795,y:600},{x:810,y:650}]);t.addInk([{x:810,y:650},{x:900,y:650}]);t.addInk([{x:900,y:650},{x:1040,y:800}]);t.addInk([{x:1040,y:800},{x:1040,y:830}]);t.addInk([{x:880,y:590},{x:920,y:610}]);for(const r of t.smartSuggest.strokes)r.at-=2000;t.addInk([{x:720,y:625},{x:870,y:625}]);})()`);
    await run("deleteTest.resolvePenGesture()");
    await wait("document.querySelector('.pen-gesture-offer [data-gesture=delete]')");
    const connectedHistory = await run("deleteTest.state.history.length");
    await screenshot("connected-strokes-offer");
    await run("document.querySelector('.pen-gesture-offer [data-gesture=delete]').click()");
    const connectedErased = "deleteTest.alpha(750,610)===0 && deleteTest.alpha(865,650)===0 && deleteTest.alpha(970,725)===0 && deleteTest.alpha(1040,820)===0 && deleteTest.alpha(730,625)===0 && deleteTest.alpha(900,600)>0",
      connectedRestored = "deleteTest.alpha(750,610)>0 && deleteTest.alpha(865,650)>0 && deleteTest.alpha(970,725)>0 && deleteTest.alpha(1040,820)>0 && deleteTest.alpha(730,625)>0 && deleteTest.alpha(900,600)>0";
    assert.equal(await run(connectedErased),true,"Delete takes the full connected stroke chain beyond the mark's span");
    assert.equal(await run("deleteTest.state.history.length"),Math.min(maxHistory,connectedHistory+1));
    await wait("deleteTest.renderedAlpha(750,610)===0 && deleteTest.renderedAlpha(865,650)===0 && deleteTest.renderedAlpha(970,725)===0 && deleteTest.renderedAlpha(1040,820)===0 && deleteTest.renderedAlpha(730,625)===0 && deleteTest.renderedAlpha(900,600)>0");
    await screenshot("connected-strokes-deleted");
    await run("deleteTest.undo()"); assert.equal(await run(connectedRestored),true);
    await run("deleteTest.redo()"); assert.equal(await run(connectedErased),true);
    report.checks.push("Confirmed Delete follows a multi-stroke connected chain beyond the cancellation span, removes the original writing, indirect links and cancellation mark, preserves disconnected ink inside its combined bounds, and supports one-step Undo/Redo.");
    const html = '<!doctype html><html><body style="margin:0;padding:24px;background:white;color:#202938;font:24px sans-serif"><p id="remove">Remove this line</p><p id="keep">Keep this line</p><input id="live" value="Keep live behavior"></body></html>';
    await run(`(()=>{const t=deleteTest;t.hideAssist('widget-test');t.restoreWidgets(${JSON.stringify([{id:"widget-1",widgetType:"html_widget",pluginId:"general",x:650,y:200,w:480,h:300,contentW:480,contentH:300,title:"Deletion test",refreshSeconds:0,html}])});t.save();t.smartSuggest.consumedStrokeId=t.smartSuggest.strokes.at(-1)?.id||0;t.render();})()`);
    await wait("deleteTest.state.widgets[0]?.hostReady && deleteTest.state.widgets[0]?.initialized");
    await run("deleteTest.addInk([{x:680,y:242},{x:968,y:262}]);deleteTest.smartSuggest.strokes.at(-1).at-=1000;for(let i=0;i<7;i++)deleteTest.addInk([{x:680,y:252+i*2},{x:968,y:252+i*2}])");
    await run("deleteTest.smartSuggest.available=true;deleteTest.gestureReply='delete';deleteTest.smartSuggest.inkReadyAt=0;deleteTest.resolvePenGesture()");
    await wait("document.querySelector('.pen-gesture-offer [data-gesture=delete]')");
    assert.equal(await run("deleteTest.penIntel.offer.pending.records.length"),8,"every Widget cancellation mark remains part of the command");
    assert.equal(await run("deleteTest.requests.at(-1).mode"),"gesture");
    assert.equal(await run("deleteTest.commands.length"),0,"recognition never sends a deletion request");
    await wait("Number(getComputedStyle(document.querySelector('.pen-gesture-offer')).opacity)>.99"); await screenshot("widget-delete-offer");
    const beforeWidgetHistory = await run("deleteTest.state.history.length");
    await run("document.querySelector('.pen-gesture-offer [data-gesture=delete]').click()");
    assert.equal(await run("deleteTest.state.widgets.length"),0,"Widget Delete removes the object directly");
    assert.equal(await run("deleteTest.alpha(700,252)"),0);
    assert.equal(await run("deleteTest.alpha(700,243)"),0);
    assert.equal(await run("Array.from({length:7},(_,i)=>deleteTest.alpha(700,252+i*2)).every(a=>a===0)"),true);
    assert.equal(await run("deleteTest.commands.length===0 && !deleteTest.state.pending && !deleteTest.state.activeAI"),true);
    assert.equal(await run("deleteTest.state.history.length"),Math.min(maxHistory,beforeWidgetHistory+1));
    await wait("deleteTest.renderedAlpha(700,252)===0 && deleteTest.renderedAlpha(700,243)===0");
    await screenshot("widget-deleted");
    await run("deleteTest.undo()");
    assert.equal(await run("deleteTest.state.widgets[0].html.includes('Remove this line') && deleteTest.state.widgets[0].html.includes('id=\"live\"') && deleteTest.alpha(700,252)>0"),true);
    assert.equal(await run("deleteTest.alpha(700,243)>0"),true);
    assert.equal(await run("Array.from({length:7},(_,i)=>deleteTest.alpha(700,252+i*2)).every(a=>a>0)"),true);
    await run("deleteTest.redo()");
    assert.equal(await run("deleteTest.state.widgets.length===0 && deleteTest.alpha(700,252)===0"),true);
    await run("deleteTest.undo()");
    await wait("deleteTest.state.widgets[0]?.hostReady && deleteTest.state.widgets[0]?.initialized");
    report.checks.push("Confirmed standalone Widget Delete removes the original Widget and all eight cancellation lines immediately without Canvas AI. One Undo restores its complete source, live controls and every mark; Redo removes them again.");
    await run("deleteTest.gestureReply='none';deleteTest.addInk([{x:680,y:445},{x:1000,y:445}]);deleteTest.smartSuggest.inkReadyAt=0;deleteTest.resolvePenGesture()");
    await wait("!deleteTest.penIntel.gesture");
    assert.equal(await run("deleteTest.penIntel.offer"),null,"blank Widget space does not get an unconfirmed local offer");
    assert.equal(await run("deleteTest.requests.at(-1).mode"),"gesture");
    assert.equal(await run("deleteTest.commands.length"),0);
    report.checks.push("Ambiguous Widget bounds still require recognition before offering Delete; a none verdict leaves its content and ink untouched.");
    report.performance=await run("({penUpMs:deleteTest.penUpTimings,rasterIdleMs:deleteTest.rasterTimings})");
    assert.deepEqual(report.errors,[]);
    fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify(report,null,2)); console.log(JSON.stringify({directory,...report}));
  } finally {
    win?.destroy(); server?.closeAllConnections(); if(server)await new Promise(resolve=>server.close(resolve));
    if(directory!==temporary)fs.rmSync(temporary,{recursive:true,force:true});
  }
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
