"use strict";
// Isolated Canvas pixel/history acceptance. Model responses are deterministic;
// --cloud exercises the official Cloud client bundle on the same test server.
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{Readable}=require("node:stream"),{createHash}=require("node:crypto");
const root=path.resolve(__dirname,".."),cloud=process.argv.includes("--cloud"),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-dirty-history-")),
  clientFile=path.resolve(root,cloud?"../penecho_cloud/public/canvas/app.js":"public/app.js"),
  output=path.resolve(process.argv.find(arg=>arg.startsWith("--output="))?.slice(9)||temporary);
fs.mkdirSync(output,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
app.disableHardwareAcceleration();
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const source=fs.readFileSync(clientFile,"utf8"),compiled=require("./build-client.js").compiledSource();assert.ok(source===compiled,"test bundle must match canonical source; rebuild and synchronize before verification");
const injection=`
  if(${cloud})Object.assign(window.PENECHO_CONFIG,{runtime:'cloud',connectionAccountId:'test-only',linkedDeviceId:'test-only',linkedDeviceOnline:true});
  window.dirtyHistoryTest={state,tiles,smartSuggest,assistAgent,canvasAgent,canvasDocumentsCurrent,canvasDocumentsReady,loadCanvasSettings,loadHostedModels,loadPluginDocuments,settings,aiConnectionScope,storeAiConnectionSelection,
    stroke,save,saveUserCanvasChange,undo,redo,refreshDirtyHistoryAfter,smartSuggestRecordStroke,recomputeDirtyBounds,captureDirtyInput,consumeDirtyInput,
    clearPendingHistoryState,invalidateRecognition,restoreWidgets,requestAI,acceptPending,canvasAgentCreate,assistAgentFinishResult,render,response:'widget',requests:[]};
  dirtyHistoryTest.dismiss=()=>{markChangelogSeen();markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);closeFeatureTour({restore:false,scroll:false,changelog:false,retry:false});closeChangelog();};
  dirtyHistoryTest.alpha=(x,y,dirty=false)=>{const k=key(Math.floor(x/TILE),Math.floor(y/TILE)),c=(dirty?state.dirtyInkTiles:tiles).get(k),scale=dirty?DIRTY_MASK_SCALE:1;
    return c?c.getContext('2d',{willReadFrequently:true}).getImageData(Math.floor((x%TILE)*scale),Math.floor((y%TILE)*scale),1,1).data[3]:0;};
  dirtyHistoryTest.draw=(y,x0=80,x1=220)=>{state.userRevision++;stroke({x:x0,y},{x:x1,y},false,8,true,'#111827');state.autoEligible=true;recomputeDirtyBounds();
    const entry=saveUserCanvasChange(),record={id:smartSuggest.nextStrokeId++,points:[{x:x0,y},{x:x1,y}],size:8,color:'#111827',box:{x:x0-6,y:y-6,w:x1-x0+12,h:12},at:performance.now(),historyEntry:entry};
    smartSuggestRecordStroke(record);refreshDirtyHistoryAfter(entry);return record.id;};
  dirtyHistoryTest.reset=()=>{clearPendingHistoryState();invalidateRecognition();restoreWidgets([]);tiles.clear();state.history=[];state.future=[];state.historyBefore.clear();state.inkBounds.clear();
    state.animationHistoryBefore=state.widgetHistoryBefore=state.imageHistoryBefore=state.textBoxHistoryBefore=null;state.images=[];state.textBoxes=[];state.latestTypedInput=null;state.mode='pen';
    Object.assign(smartSuggest,{strokes:[],consumedStrokeId:0,dismissedStrokeId:0,dismissedObjectKey:'',writingMs:0});render();};
  dirtyHistoryTest.read=()=>({dirty:state.dirty,autoEligible:state.autoEligible,widgets:state.widgets.length,history:state.history.length,future:state.future.length,
    status:state.status,statusKey:state.statusKey,requestCount:dirtyHistoryTest.requests.length,
    consumed:smartSuggest.consumedStrokeId,strokes:smartSuggest.strokes.map(r=>({id:r.id,consumed:!!r.inputConsumed})),A:dirtyHistoryTest.alpha(100,100),dirtyA:dirtyHistoryTest.alpha(100,100,true),
    overlap:dirtyHistoryTest.alpha(180,100,true),dirtyC:dirtyHistoryTest.alpha(100,300,true)});
  const originalFetch=window.fetch;window.fetch=async(url,options)=>{
    const json=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
    if(url==='/api/v1/models')return json({accountId:'test-only',models:[],credits:{available:1}});
    if(String(url).endsWith('/suggest/status'))return json({configured:false});
    if(url==='/api/ai/command'){
      dirtyHistoryTest.requests.push(JSON.parse(options.body));
      return json({commands:dirtyHistoryTest.response==='widget'?[{tool:'html_widget',pluginId:'general',x:450,y:120,w:300,h:200,title:'Result B',refreshSeconds:0,html:'<!doctype html><html><body style="font:32px sans-serif;padding:24px">Result B</body></html>'}]:[{tool:'draw',origin:[450,120],types:['rect'],items:[[0,0,100,80]],width:4}]});
    }
    return originalFetch(url,options);
  };
`;
const readStream=fs.createReadStream;fs.createReadStream=function(file,...args){return path.resolve(String(file))===path.join(root,"public/app.js")?Readable.from([source.replace(/\}\)\(\);\s*$/,injection+"})();")]):readStream.call(this,file,...args);};
const report={runtime:cloud?"cloud-client":"local",clientFile,clientSha256:createHash("sha256").update(source).digest("hex"),syntheticModel:true,checks:[],errors:[],limitations:["Cloud client uses an isolated local server; deployed Cloud services and live models are not exercised."]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let server,win;
app.whenReady().then(async()=>{
  try{
    server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
    // Cloud asset URLs use /canvas/. Serve those paths from the isolated
    // canonical asset directory without changing any deployed Cloud route.
    if(cloud)server.prependListener("request",request=>{if(request.url.startsWith("/canvas/"))request.url=request.url.slice(7);});
    win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    win.webContents.on("console-message",event=>{if(event.level==='error')report.errors.push(event.message);});
    const js=code=>win.webContents.executeJavaScript(code,true),until=async condition=>{const deadline=Date.now()+20000;while(!await js(condition)){if(Date.now()>deadline)throw Error('Timed out: '+condition);await pause(40);}},
      read=()=>js("dirtyHistoryTest.read()"),history=action=>js(`(()=>{dirtyHistoryTest.state.userRevision++;dirtyHistoryTest.${action}();return true;})()`);
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await js(`(async()=>{const t=dirtyHistoryTest,s=t.state;await t.canvasDocumentsReady();await t.loadCanvasSettings();if(${cloud}){await t.loadHostedModels({accountChanged:true});t.settings.connections=[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',provider:'api',hasApiKey:true,apiUrl:'http://127.0.0.1:1/v1',apiModel:'test'}];t.settings.connectionScope=t.aiConnectionScope();}t.storeAiConnectionSelection(t.settings.connections[0].id);
      await t.loadPluginDocuments();t.dismiss();document.querySelector('#canvasWelcome').hidden=true;t.smartSuggest.enabled=false;s.auto=false;s.language='en';s.scale=1;s.panX=s.panY=0;s.viewInitialized=true;t.reset();})()`);
    await js("dirtyHistoryTest.draw(100)");const original=await read();assert.ok(original.dirtyA>0);
    await js("dirtyHistoryTest.requestAI('answer')");let value=await read();report.widgetResult=value;assert.equal(value.widgets,1,JSON.stringify(value));assert.equal(value.dirtyA,0);assert.ok(value.A>0);assert.equal(value.dirty,null);
    await history('undo');value=await read();assert.equal(value.widgets,0);assert.ok(value.dirtyA>0);assert.equal(value.consumed,0);assert.ok(value.autoEligible);assert.ok(value.A>0);
    report.checks.push({name:'real requestAI Widget: Undo B restores A and Suggest eligibility',state:value});
    await js("dirtyHistoryTest.dismiss()");await pause(80);fs.writeFileSync(path.join(output,'undo-input.png'),(await win.webContents.capturePage()).toPNG());
    await history('redo');value=await read();assert.equal(value.widgets,1);assert.equal(value.dirtyA,0);assert.equal(value.dirty,null);assert.ok(value.A>0);
    report.checks.push({name:'redo restores B and keeps input consumed',state:value});
    await js("dirtyHistoryTest.reset();dirtyHistoryTest.draw(100);dirtyHistoryTest.response='draw';void dirtyHistoryTest.requestAI('answer')");await until("dirtyHistoryTest.state.pending?.revealProgress===1");
    await js("dirtyHistoryTest.acceptPending()");await until("!dirtyHistoryTest.state.pending&&!dirtyHistoryTest.state.activeAI");assert.equal((await read()).dirtyA,0);
    await history('undo');value=await read();assert.ok(value.dirtyA>0);assert.equal(await js("!!dirtyHistoryTest.state.pending"),true);
    await history('redo');assert.equal((await read()).dirtyA,0);assert.equal(await js("!!dirtyHistoryTest.state.pending"),false);
    report.checks.push({name:'real requestAI raster draft consumption and pending history restore with input',state:await read()});
    await js("dirtyHistoryTest.reset();dirtyHistoryTest.draw(100);window.scopedInput=dirtyHistoryTest.captureDirtyInput(dirtyHistoryTest.state.dirty);dirtyHistoryTest.draw(100,150,250);dirtyHistoryTest.draw(300)");
    await js(`(async()=>{const t=dirtyHistoryTest,socket={readyState:WebSocket.OPEN,send(){}};t.canvasAgent.socket=socket;t.canvasAgent.sessionId='isolated-dirty-history';t.canvasAgent.sessionReady=true;
      const execution={socket,sessionId:t.canvasAgent.sessionId,generation:t.canvasAgent.sessionGeneration,controller:new AbortController(),preserveView:true};
      await t.canvasAgentCreate({baseRevision:t.state.userRevision,items:[{type:'widget',widgetType:'html_widget',pluginId:'general',title:'Agent B',width:300,height:200,html:'<!doctype html><p>Agent B</p>',placement:{x:450,y:120}}]},execution);
      t.assistAgent.resultTarget={generation:t.assistAgent.generation,documentId:t.canvasDocumentsCurrent().id,conversationId:t.canvasAgent.currentConversation?.id,resultBox:{x:450,y:120,w:300,h:200},inputSnapshot:scopedInput};t.assistAgentFinishResult(true);})()`);
    value=await read();assert.equal(value.dirtyA,0);assert.ok(value.overlap>0);assert.ok(value.dirtyC>0);
    await history('undo');await until("dirtyHistoryTest.state.widgets.length===0");value=await read();assert.ok(value.dirtyA>0);assert.ok(value.overlap>0);assert.ok(value.dirtyC>0);
    await history('redo');await until("dirtyHistoryTest.state.widgets.length===1");value=await read();assert.equal(value.dirtyA,0);assert.ok(value.overlap>0);assert.ok(value.dirtyC>0);
    report.checks.push({name:'actual Agent create/finish preserves later overlapping and unrelated ink through Undo/redo',state:value});
    fs.writeFileSync(path.join(output,'scoped-mask.png'),await js("(async()=>{const c=dirtyHistoryTest.state.dirtyInkTiles.values().next().value,b=await new Promise(resolve=>c.toBlob(resolve));return Array.from(new Uint8Array(await b.arrayBuffer()));})()").then(bytes=>Buffer.from(bytes)));
    assert.deepEqual(report.errors,[]);fs.rmSync(path.join(output,'failure.json'),{force:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,runtime:report.runtime,checks:report.checks.length,errors:report.errors}));
  }finally{win?.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));if(output!==temporary)fs.rmSync(temporary,{recursive:true,force:true});}
}).then(()=>app.exit(0),error=>{console.error(error);fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({...report,error:String(error.stack)},null,2));app.exit(1);});
