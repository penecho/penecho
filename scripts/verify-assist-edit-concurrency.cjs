"use strict";
// Canonical client, isolated browser/data, deterministic tool replies. No model
// endpoint is called; prompt contents and actual Canvas behavior are measured.
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{Readable}=require("node:stream"),{createHash}=require("node:crypto");
const root=path.resolve(__dirname,".."),cloud=process.argv.includes("--cloud"),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-edit-concurrency-")),
  output=path.resolve(process.argv.find(a=>a.startsWith("--output="))?.slice(9)||path.join(root,"docs/verification/assist-edit-concurrency-20260930/local")),clientFile=cloud?path.resolve(root,"../penecho_cloud/public/canvas/app.js"):path.join(root,"public/app.js");
fs.mkdirSync(output,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const injection=`
  if(${cloud})Object.assign(window.PENECHO_CONFIG,{runtime:'cloud',connectionAccountId:'test-only',linkedDeviceId:'test-only',linkedDeviceOnline:true});
  window.lassoAudit={beginWidgetEdit,cancelWidgetEdit,acceptWidgetEdit,beginImageEdit,cancelImageEdit,acceptImageEdit,createTextEditor,cancelTextEditor,confirmTextEditor,removeTextEditor,canvasAgentMutationState,addImageFile,dataUrlBlob,state,tiles,smartSuggest,assistAgent,canvasAgent,canvasDocuments,canvasDocumentsReady,loadCanvasSettings,loadHostedModels,aiConnectionScope,settings,canvasAgentSetRunning,canvasAgentStatus,storeAiConnectionSelection,assistAgentRun,assistAgentFinishResult,canvasAgentExecuteTool,captureSelection,cancelSelection,save,undo,redo,render,updateCoordinates,saveSnapshot,readDeviceSnapshot,canvasAgentDigest,wire:[],envelopes:[]};
  canvasAgentConnect=async()=>{canvasAgent.socket={readyState:WebSocket.OPEN};canvasAgent.sessionReady=true;canvasAgent.sessionId='lasso-audit';};
  lassoAudit.connect=()=>canvasAgentConnect();
  lassoAudit.execution=()=>({socket:canvasAgent.socket,sessionId:canvasAgent.sessionId,generation:canvasAgent.sessionGeneration,controller:new AbortController()});
  lassoAudit.progress=()=>{const session=[...mcpRuntime.sessions.values()].find(s=>s.internalAgent);return mcpExecute('mcp_update_session',{sessionId:session.sessionId,status:'done',summary:'Synthetic completion'},lassoAudit.execution());};
  lassoAudit.revert=()=>canvasAgentRevert({changeId:canvasAgent.latestChange.changeId},lassoAudit.execution());
  canvasAgentEnsureSearchSession=async()=>{};
  canvasAgentStartNewConversation=async()=>{canvasAgent.currentConversation={id:crypto.randomUUID(),items:[]};canvasAgent.sessionGeneration++;};
  canvasAgentSendRequest=(type,payload)=>lassoAudit.wire.push({type,payload});
  canvasAgentSendEnvelope=(type,payload)=>lassoAudit.envelopes.push({type,payload});
  lassoAudit.tool=async(operation,args)=>{
    const key='agent-'+ 'b'.repeat(64),callId=crypto.randomUUID();
    await canvasAgentExecuteTool({name:'canvas_document',requestId:callId,callId,arguments:{bindingKey:key,operation,arguments:{sessionId:key,requestId:callId,...args}}});
    return lassoAudit.envelopes.find(e=>e.payload?.requestId===callId)?.payload;
  };
  lassoAudit.seed=()=>{
    const s=state;assistAgentFinishResult(false);canvasAgent.running=false;canvasAgent.requestPending=false;canvasAgentSetRunning(false);s.userRevision++;s.auto=false;s.language='en';smartSuggest.enabled=false;smartSuggest.available=false;
    s.drawing=null;s.selectionGesture=null;s.selection=null;s.imageEdit=null;s.widgetEdit=null;s.animationEdit=null;
    for(const c of tiles.values())c.width=c.height=1;tiles.clear();s.inkBounds.clear();s.textBoxes=[];for(const w of s.widgets)unmountWidget(w);s.widgets=[];s.images=[];s.history=[];s.future=[];
    s.scale=.35;s.panX=220-6000*s.scale;s.panY=160-9000*s.scale;
    forTiles(6100,9100,1000,400,(c,tx,ty)=>{recordBefore(tx,ty);const ctx=c.getContext('2d');ctx.font='180px cursive';ctx.fillStyle='#202938';ctx.fillText('3+2',6140-tx*TILE,9340-ty*TILE);state.inkBounds.delete(key(tx,ty));},true);
    const chart=widgetRecord({tool:'html_widget',widgetType:'html_widget',pluginId:'general',x:7250,y:9070,w:1200,h:850,contentW:360,contentH:255,title:'Project report',refreshSeconds:0,html:'<!doctype html><html><body style="margin:0;background:transparent;color:#263a36;font:20px sans-serif"><h3 style="margin:10px">Project report</h3><svg viewBox="0 0 360 160"><path d="M25 10V140H345M35 120L100 100L160 60L220 85L300 40" fill="none" stroke="#48665b" stroke-width="4"/></svg><p>visible report notes</p><p style="margin-top:800px">MASKED OUT: hidden financial assumption</p></body></html>'});
    s.widgetHistoryBefore=[];s.widgets.push(chart);mountWidget(chart);save();lassoAudit.chartId=chart.id;
    const points=[{x:6020,y:8980},{x:8640,y:8980},{x:8640,y:10350},{x:6020,y:10350}];
    captureSelection(points);smartSuggest.selectionVersion++;lassoAudit.selection=s.selection;
    lassoAudit.target={box:{...s.selection.box},selection:s.selection,selectionKey:'selection:'+smartSuggest.selectionVersion};render();updateCoordinates();
  };
  lassoAudit.holdImageImport=()=>{const original=prepareImportedImage;let release;const wait=new Promise(r=>release=r);prepareImportedImage=async(...args)=>{const value=await original(...args);lassoAudit.importReady=true;await wait;return value;};return {release,restore:()=>{prepareImportedImage=original;}};};
  lassoAudit.pauseText=()=>{const original=renderedTextBoxRecord;lassoAudit.releaseText=null;const held=new Promise(resolve=>lassoAudit.releaseText=resolve);renderedTextBoxRecord=async(...args)=>{const result=await original(...args);lassoAudit.textPrepared=true;await held;return result;};lassoAudit.restoreText=()=>{renderedTextBoxRecord=original;};};
  const originalFetch=window.fetch;window.fetch=async(url,options)=>{if(url==='/api/v1/models')return new Response(JSON.stringify({accountId:'test-only',models:[],credits:{available:1}}),{headers:{'Content-Type':'application/json'}});if(String(url).endsWith('/suggest/status'))return new Response(JSON.stringify({configured:false}),{headers:{'Content-Type':'application/json'}});return originalFetch(url,options);};
`;
const readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){if(path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([fs.readFileSync(clientFile,"utf8").replace(/\}\)\(\);\s*$/,injection+'})();')]);return readStream.call(this,file,...args);};
let server,win;
const report={runtime:cloud?"cloud-client":"local",clientFile,clientSha256:createHash("sha256").update(fs.readFileSync(clientFile)).digest("hex"),syntheticOnly:true,providerSemantics:"not measured",checks:[],errors:[]};
app.whenReady().then(async()=>{
 try{
  server=require("../server.js");server.prependListener("request",req=>{if(cloud&&req.url.startsWith('/canvas/'))req.url=req.url.slice('/canvas'.length);});await new Promise(r=>server.listening?r():server.once("listening",r));
  win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  win.webContents.on("console-message",(_e,level,message)=>{if(level>=3)report.errors.push(message);});
  await win.loadURL('http://127.0.0.1:'+server.address().port);
  const run=async code=>{try{return await win.webContents.executeJavaScript(code);}catch(error){throw Error('Browser check failed: '+code+' '+String(error?.stack||error?.message||error));}},wait=async expression=>{const until=Date.now()+15000;while(!await run(expression)){if(Date.now()>until)throw Error('Timed out: '+expression);await new Promise(r=>setTimeout(r,30));}},
    shot=async name=>{await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());},
    retained=async()=>assert.equal(await run('lassoAudit.state.selection===lassoAudit.selection&&lassoAudit.selection.phase==="active"'),true,'static lasso remains active');
  await run(`(async()=>{const t=lassoAudit;await t.canvasDocumentsReady();await t.loadCanvasSettings();if(window.PENECHO_CONFIG.runtime==='cloud'){await t.loadHostedModels({accountChanged:true});t.settings.connections=[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',provider:'api',hasApiKey:true,apiUrl:'http://127.0.0.1:1/v1',apiModel:'test'}];t.settings.connectionScope=t.aiConnectionScope();}t.storeAiConnectionSelection(t.settings.connections[0].id);document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();t.seed();})()`);
  await run('lassoAudit.connect()');
  await wait('lassoAudit.state.widgets.every(w=>w.hostReady&&w.initialized)');
  await run('lassoAudit.cancelSelection();lassoAudit.originalWidget=lassoAudit.state.widgets[0];lassoAudit.originalFrame=lassoAudit.originalWidget.frame;lassoAudit.originalX=lassoAudit.originalWidget.x;lassoAudit.beginWidgetEdit(lassoAudit.originalWidget);void 0');
  const create=async(text,x,y)=>{const r=await run(`lassoAudit.tool('mcp_edit_canvas',${JSON.stringify({action:'create_text',text,region:{x,y,w:600,h:120}})})`);assert.equal(r.ok,true,JSON.stringify(r));return r.result;};
  const first=await create('Agent output while Widget selected',4000,9000);
  assert.equal(await run('lassoAudit.state.widgetEdit.id===lassoAudit.originalWidget.id&&lassoAudit.originalWidget.frame===lassoAudit.originalFrame'),true);
  report.checks.push({name:'unchanged Widget selection allows writing and preserves iframe/selection',objectId:first.objectId});
  const move=await run("lassoAudit.tool('mcp_edit_canvas',{action:'move',objectId:lassoAudit.originalWidget.id,baseRevision:lassoAudit.state.userRevision,region:{x:7400,y:9070,w:1200,h:850}})");assert.equal(move.ok,true,JSON.stringify(move));
  await run('lassoAudit.cancelWidgetEdit()');assert.equal(await run('lassoAudit.originalWidget.x'),7400);
  report.checks.push({name:'Agent can edit unchanged selected Widget; cancel does not revert Agent geometry'});
  await run('lassoAudit.beginWidgetEdit(lassoAudit.originalWidget);lassoAudit.originalWidget.x+=100;lassoAudit.state.widgetEdit.changed=true;void 0');
  const busy=await run("lassoAudit.tool('mcp_edit_canvas',{action:'move',objectId:lassoAudit.originalWidget.id,baseRevision:lassoAudit.state.userRevision,region:{x:7600,y:9070,w:1200,h:850}})");assert.equal(busy.error.code,'OBJECT_EDIT_CONFLICT');
  const added=await run("lassoAudit.tool('mcp_present_widget',{artifactId:'unrelated-widget',title:'Independent result',html:'<p>Separate Agent result</p>',width:480,height:360})");assert.equal(added.ok,true,JSON.stringify(added));
  assert.equal(await run('lassoAudit.originalWidget.x'),7500);
  await run('lassoAudit.pendingWidgetHistory=lassoAudit.state.widgetHistoryBefore;lassoAudit.pendingHistoryLength=lassoAudit.state.history.length;void 0');
  const progress=await run('lassoAudit.progress()');assert.equal(progress.applied,true,JSON.stringify(progress));
  assert.equal(await run('lassoAudit.state.widgetHistoryBefore===lassoAudit.pendingWidgetHistory&&lassoAudit.state.history.length===lassoAudit.pendingHistoryLength'),true);
  const revertible=await run("lassoAudit.tool('mcp_present_widget',{artifactId:'temporary-widget',title:'Temporary result',html:'<p>Revert only me</p>',width:480,height:360})");assert.equal(revertible.ok,true);
  await run('lassoAudit.revert()');assert.equal(await run('lassoAudit.originalWidget.x===7500&&lassoAudit.state.widgetEdit.changed'),true);
  report.checks.push({name:'completion status and Agent revert preserve unrelated pending user history'});
  await run('lassoAudit.cancelWidgetEdit()');assert.equal(await run('lassoAudit.originalWidget.x'),7400);
  assert.equal(await run('lassoAudit.originalWidget.frame===lassoAudit.originalFrame'),true);
  await run('lassoAudit.undo()');assert.equal(await run(`lassoAudit.state.widgets.some(w=>w.id===${JSON.stringify(added.result.objectId)})`),false);
  assert.equal(await run('lassoAudit.originalWidget.frame===lassoAudit.originalFrame&&lassoAudit.originalWidget.x===7400'),true);
  await run('lassoAudit.redo()');assert.equal(await run(`lassoAudit.state.widgets.some(w=>w.id===${JSON.stringify(added.result.objectId)})`),true);
  report.checks.push({name:'dirty Widget locks only itself; cancel plus Agent Undo/redo preserve unrelated live iframe'});
  // New drafts have no existing object to lock. Undo of an Agent output must not close them.
  await run("lassoAudit.editor=lassoAudit.createTextEditor({x:3900,y:9400});lassoAudit.editor.textarea.value='Unsubmitted user draft';void 0");
  const second=await create('Agent text beside an open draft',4000,9700);
  await run('lassoAudit.undo()');assert.equal(await run("lassoAudit.state.textEditors.has(lassoAudit.editor.id)&&lassoAudit.editor.textarea.value==='Unsubmitted user draft'"),true);
  await run('lassoAudit.redo()');await run('lassoAudit.confirmTextEditor(lassoAudit.editor)');
  assert.equal(await run(`lassoAudit.state.textBoxes.some(t=>t.id===${JSON.stringify(second.objectId)})`),true);
  await run('lassoAudit.undo()');assert.equal(await run(`lassoAudit.state.textBoxes.some(t=>t.id===${JSON.stringify(second.objectId)})`),true);
  report.checks.push({name:'new text draft survives unrelated Agent writes and Undo/redo; confirming draft has separate Undo'});
  await run(`lassoAudit.sourceText=lassoAudit.state.textBoxes.find(t=>t.id===${JSON.stringify(first.objectId)});lassoAudit.editor=lassoAudit.createTextEditor({x:3900,y:9400},{sourceTextBoxId:lassoAudit.sourceText.id,sourceX:lassoAudit.sourceText.x,sourceY:lassoAudit.sourceText.y,sourceFontSize:lassoAudit.sourceText.fontSize,sourceMaxWidth:lassoAudit.sourceText.maxWidth});lassoAudit.editor.textarea.value='User is editing existing text';void 0`);
  const unrelated=await create('Other text remains writable',4000,10000);
  const conflict=await run("lassoAudit.tool('mcp_edit_canvas',{action:'delete',objectId:lassoAudit.sourceText.id,baseRevision:lassoAudit.state.userRevision})");assert.equal(conflict.error.code,'OBJECT_EDIT_CONFLICT');
  await run('lassoAudit.cancelTextEditor(lassoAudit.editor)');assert.equal(await run(`lassoAudit.state.textBoxes.some(t=>t.id===${JSON.stringify(unrelated.objectId)})`),true);
  report.checks.push({name:'existing text draft protects only its source; cancellation retains unrelated Agent output'});
  // The editor can open while text rendering is awaiting; commit checks must
  // observe that new ownership even when the document revision is unchanged.
  await run(`lassoAudit.sourceText=lassoAudit.state.textBoxes.find(t=>t.id===${JSON.stringify(second.objectId)});void 0`);
  const sourcePath=`objects/${second.objectId}/content.txt`,source=await run(`lassoAudit.tool('mcp_read_file',${JSON.stringify({path:sourcePath})})`);
  assert.equal(source.ok,true,JSON.stringify(source));
  const latePatch={path:sourcePath,expectedHash:source.result.contentHash,patch:`--- a/${sourcePath}\n+++ b/${sourcePath}\n@@ -1 +1 @@\n-${source.result.content}\n+Late Agent replacement\n`};
  await run(`lassoAudit.pauseText();lassoAudit.textPrepared=false;lassoAudit.earlyReply=null;lassoAudit.pending=lassoAudit.tool('mcp_patch_file',${JSON.stringify(latePatch)}).then(result=>(lassoAudit.earlyReply=result));void 0`);await wait('lassoAudit.textPrepared||lassoAudit.earlyReply');
  assert.equal(await run('lassoAudit.textPrepared'),true,JSON.stringify(await run('lassoAudit.earlyReply')));
  await run("lassoAudit.editor=lassoAudit.createTextEditor({x:3900,y:9400},{sourceTextBoxId:lassoAudit.sourceText.id,sourceX:lassoAudit.sourceText.x,sourceY:lassoAudit.sourceText.y,sourceFontSize:lassoAudit.sourceText.fontSize,sourceMaxWidth:lassoAudit.sourceText.maxWidth});lassoAudit.editor.textarea.value='Newly opened draft';lassoAudit.releaseText();void 0");
  const late=await run('lassoAudit.pending');assert.equal(late.error.code,'OBJECT_EDIT_CONFLICT',JSON.stringify(late));
  assert.equal(await run("lassoAudit.sourceText.text==='Agent text beside an open draft'&&lassoAudit.editor.textarea.value==='Newly opened draft'"),true);
  await run('lassoAudit.restoreText();lassoAudit.cancelTextEditor(lassoAudit.editor)');
  report.checks.push({name:'editor opened during asynchronous text preparation prevents only the conflicting late commit'});
  const image=await run("(async()=>{const c=document.createElement('canvas');c.width=120;c.height=80;c.getContext('2d').fillRect(0,0,120,80);lassoAudit.png=c.toDataURL();return lassoAudit.tool('mcp_place_image',{source:lassoAudit.png,region:{x:5200,y:9000,w:400,h:267},width:400,height:267});})()");assert.equal(image.ok,true,JSON.stringify(image));
  await run(`lassoAudit.image=lassoAudit.state.images.find(i=>i.id===${JSON.stringify(image.result.objectId)});lassoAudit.beginImageEdit(lassoAudit.image);lassoAudit.image.x+=100;lassoAudit.state.imageEdit.changed=true;void 0`);
  const native=await run("lassoAudit.tool('mcp_draw',{artifactId:'new-native',items:[{id:'box',type:'rect',width:120,height:80}]})");assert.equal(native.ok,true,JSON.stringify(native));
  await run('lassoAudit.cancelImageEdit()');assert.equal(await run('lassoAudit.image.x'),5200);
  await run('lassoAudit.undo()');assert.equal(await run('lassoAudit.state.images.includes(lassoAudit.image)&&lassoAudit.image.x===5200'),true);await run('lassoAudit.redo()');
  report.checks.push({name:'dirty image edit remains cancelable across native Agent drawing and Undo/redo'});
  await run('lassoAudit.state.drawing={synthetic:true};lassoAudit.pendingInk=lassoAudit.state.historyBefore;lassoAudit.historyLength=lassoAudit.state.history.length;void 0');
  const upload=await run("lassoAudit.tool('mcp_upload_image',{source:lassoAudit.png,name:'Synthetic attachment'})");assert.equal(upload.ok,true,JSON.stringify(upload));
  assert.equal(await run('lassoAudit.state.historyBefore===lassoAudit.pendingInk&&lassoAudit.state.history.length===lassoAudit.historyLength'),true);
  const drawingBusy=await run("lassoAudit.tool('mcp_edit_canvas',{action:'create_text',text:'Must wait for active stroke'})");assert.equal(drawingBusy.error.code,'CANVAS_BUSY');await run('lassoAudit.state.drawing=null');
  report.checks.push({name:'immutable upload works during a stroke without consuming history; spatial write still protects the stroke'});
  // Exercise the real delayed manual image-import path with a held decode.
  await run("lassoAudit.holdImport=lassoAudit.holdImageImport();lassoAudit.importPromise=lassoAudit.addImageFile(lassoAudit.dataUrlBlob(lassoAudit.png));void 0");
  await wait('lassoAudit.importReady');const whileImport=await create('Agent writes during image decoding',4000,10400);
  await run('lassoAudit.holdImport.release();lassoAudit.importPromise');await run('lassoAudit.holdImport.restore()');
  assert.equal(await run(`lassoAudit.state.textBoxes.some(t=>t.id===${JSON.stringify(whileImport.objectId)})`),true);
  report.checks.push({name:'actual manual image import permits Agent work during decode and preserves both results'});
  await shot('concurrent-edits');
  const saved=await run("lassoAudit.saveSnapshot({name:'Synthetic concurrent edits',location:'device'})");assert.ok(saved);
  const snapshot=await run(`lassoAudit.readDeviceSnapshot(${JSON.stringify(saved)})`);assert.ok(snapshot.item.textBoxes.some(t=>t.id===whileImport.objectId));assert.ok(snapshot.item.widgets.some(w=>w.id===added.result.objectId));assert.ok(snapshot.item.images.length>=3);
  report.checks.push({name:'save preserves user and Agent results',snapshotId:saved});
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify({output,checks:report.checks.length,errors:report.errors}));
 }catch(error){report.failure={message:String(error.message||error),stack:error.stack};console.error(error);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');win?.destroy();if(server)await new Promise(r=>server.close(r));fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode||0);}
});
