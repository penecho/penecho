"use strict";
// Canonical client, isolated browser/data, deterministic tool replies. No model
// endpoint is called; prompt contents and actual Canvas behavior are measured.
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{Readable}=require("node:stream"),{createHash}=require("node:crypto");
const root=path.resolve(__dirname,".."),cloud=process.argv.includes("--cloud"),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-lasso-request-")),
  output=path.resolve(process.argv.find(a=>a.startsWith("--output="))?.slice(9)||path.join(root,"docs/verification/assist-lasso-request-20260930/local")),clientFile=cloud?path.resolve(root,"../penecho_cloud/public/canvas/app.js"):path.join(root,"public/app.js");
fs.mkdirSync(output,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const injection=`
  if(${cloud})Object.assign(window.PENECHO_CONFIG,{runtime:'cloud',connectionAccountId:'test-only',linkedDeviceId:'test-only',linkedDeviceOnline:true});
  window.lassoAudit={state,tiles,smartSuggest,assistAgent,canvasAgent,canvasDocuments,canvasDocumentsReady,loadCanvasSettings,loadHostedModels,aiConnectionScope,settings,canvasAgentSetRunning,canvasAgentStatus,storeAiConnectionSelection,assistAgentRun,assistAgentFinishResult,canvasAgentExecuteTool,captureSelection,cancelSelection,buildSelectionImage,requestSelectionAI,requestAI,setCanvasMode,stopActiveAIRequests,save,undo,redo,render,updateCoordinates,saveSnapshot,readDeviceSnapshot,canvasAgentDigest,wire:[],envelopes:[]};
  canvasAgentConnect=async()=>{canvasAgent.socket={readyState:WebSocket.OPEN};canvasAgent.sessionReady=true;canvasAgent.sessionId='lasso-audit';};
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
    markChangelogSeen();markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);closeFeatureTour({retry:false,changelog:false});document.querySelector('#changelogClose')?.click();
    clearTextEditors();
    const s=state;assistAgentFinishResult(false);canvasAgent.running=false;canvasAgent.requestPending=false;canvasAgentSetRunning(false);s.userRevision++;s.auto=false;s.language='en';smartSuggest.enabled=false;smartSuggest.available=false;
    s.drawing=null;s.selectionGesture=null;s.selection=null;s.imageEdit=null;s.widgetEdit=null;s.animationEdit=null;
    for(const c of tiles.values())c.width=c.height=1;tiles.clear();s.inkBounds.clear();s.textBoxes=[];for(const w of s.widgets)unmountWidget(w);s.widgets=[];s.images=[];s.history=[];s.future=[];
    s.scale=.35;s.panX=220-6000*s.scale;s.panY=160-9000*s.scale;
    forTiles(6100,9100,1000,400,(c,tx,ty)=>{recordBefore(tx,ty);const ctx=c.getContext('2d');ctx.font='180px cursive';ctx.fillStyle='#202938';ctx.fillText('3+2',6140-tx*TILE,9340-ty*TILE);state.inkBounds.delete(key(tx,ty));},true);
    const chart=widgetRecord({tool:'html_widget',widgetType:'html_widget',pluginId:'general',x:7250,y:9070,w:1200,h:850,contentW:360,contentH:255,title:'Project report',refreshSeconds:0,html:'<!doctype html><html><body style="margin:0;background:transparent;color:#263a36;font:20px sans-serif"><h3 style="margin:10px">Project report</h3><svg viewBox="0 0 360 160"><path d="M25 10V140H345M35 120L100 100L160 60L220 85L300 40" fill="none" stroke="#48665b" stroke-width="4"/></svg><p>visible report notes</p><p style="margin-top:800px">MASKED OUT: hidden financial assumption</p></body></html>'});
    s.widgetHistoryBefore=[];s.widgets.push(chart);mountWidget(chart);save();lassoAudit.chartId=chart.id;
    const points=[{x:6020,y:8980},{x:8640,y:8980},{x:8640,y:10350},{x:6020,y:10350}];
    captureSelection(points);smartSuggest.selectionVersion++;lassoAudit.selection=s.selection;
    lassoAudit.target={box:{...s.selection.box},selection:s.selection,selectionKey:'selection:'+smartSuggest.selectionVersion};setCanvasMode('select');render();updateCoordinates();
  };
  lassoAudit.pauseText=()=>{const original=renderedTextBoxRecord;lassoAudit.releaseText=null;const held=new Promise(resolve=>lassoAudit.releaseText=resolve);renderedTextBoxRecord=async(...args)=>{const result=await original(...args);lassoAudit.textPrepared=true;await held;return result;};lassoAudit.restoreText=()=>{renderedTextBoxRecord=original;};};
  const originalFetch=window.fetch;window.fetch=async(url,options)=>{
    if(url==='/api/ai/command'&&lassoAudit.responseMode){
      lassoAudit.commandStarted=true;
      await new Promise(resolve=>{lassoAudit.reply=resolve;options.signal.addEventListener('abort',()=>resolve(),{once:true});});
      if(options.signal.aborted)throw new DOMException('Stopped','AbortError');
      const mode=lassoAudit.responseMode,commands=mode==='empty'?[]:[{tool:'html_widget',pluginId:'general',title:'Generated Widget',refreshSeconds:0,x:6200,y:10400,w:1000,h:500,html:'<h2>Generated Widget</h2><button>Use result</button>'}];
      return new Response(JSON.stringify(mode==='failed'?{error:'Test response unavailable'}:{requestId:'lasso-hand-test',commands}),{status:mode==='failed'?503:200,headers:{'Content-Type':'application/json'}});
    }
    if(url==='/api/v1/models')return new Response(JSON.stringify({accountId:'test-only',models:[],credits:{available:1}}),{headers:{'Content-Type':'application/json'}});if(String(url).endsWith('/suggest/status'))return new Response(JSON.stringify({configured:false}),{headers:{'Content-Type':'application/json'}});return originalFetch(url,options);
  };
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
  await shot('lasso-before');
  assert.equal(await run("lassoAudit.assistAgentRun('solve',lassoAudit.target,{label:'Solve',instruction:'套索区域的内容是'})"),'submitted');
  const prompt=await run('lassoAudit.wire.at(-1).payload.text');fs.writeFileSync(path.join(output,'submitted-prompt.txt'),prompt+'\n');
  assert.match(prompt,/套索区域的内容是/);assert.doesNotMatch(prompt,/Complete missing values|including each unsolved problem for Solve|Keep visible text in English, unless/);
  report.checks.push({name:'explicit Chinese description overrides Solve and English UI',promptPath:'submitted-prompt.txt'});
  const text=await run("lassoAudit.tool('mcp_edit_canvas',{action:'create_text',text:'所选区域里有手写 3+2、项目折线图和报告文字。'})");assert.equal(text.ok,true);await retained();
  const widget=await run("lassoAudit.tool('mcp_present_widget',{artifactId:'description',title:'所选内容',html:'<p>手写 3+2 与项目报告图表</p>',width:480,height:360})");assert.equal(widget.ok,true);await retained();
  const drawing=await run("lassoAudit.tool('mcp_draw',{artifactId:'markers',title:'内容标记',items:[{id:'note',type:'text',text:'已描述可见内容',x:10,y:10}]})");assert.equal(drawing.ok,true);await retained();
  const ink=await run("lassoAudit.tool('mcp_edit_canvas',{action:'draw_ink',baseRevision:lassoAudit.state.userRevision,strokes:[{color:'#cc3344',width:12,points:[{x:6140,y:9390},{x:6510,y:9390}]}]})");assert.equal(ink.ok,true);await retained();
  report.checks.push({name:'text/widget/drawing/native ink writes use actual tool handler with retained lasso',text:text.result,widget:widget.result,drawing:drawing.result,ink:ink.result});
  await shot('lasso-after-writes');
  // Both text and Widget source edits remain possible while the lasso exists.
  const file=await run(`lassoAudit.tool('mcp_read_file',{path:'objects/${text.result.objectId}/content.txt'})`);assert.equal(file.ok,true);
  const replacement='所选内容已按可见元素描述。',patch=`--- a/objects/${text.result.objectId}/content.txt\n+++ b/objects/${text.result.objectId}/content.txt\n@@ -1 +1 @@\n-${file.result.content}\n+${replacement}\n`;
  const edit=await run(`lassoAudit.tool('mcp_patch_file',${JSON.stringify({path:`objects/${text.result.objectId}/content.txt`,expectedHash:file.result.contentHash,patch})})`);assert.equal(edit.ok,true);await retained();
  await run('lassoAudit.undo()');await wait(`lassoAudit.state.textBoxes.some(t=>t.id===${JSON.stringify(text.result.objectId)}&&t.text===${JSON.stringify(file.result.content)})`);
  await run('lassoAudit.redo()');await wait(`lassoAudit.state.textBoxes.some(t=>t.id===${JSON.stringify(text.result.objectId)}&&t.text===${JSON.stringify(replacement)})`);
  await retained();report.checks.push({name:'selected-region editing and real Undo/redo preserve content',receipt:edit.result});
  const widgetPath=`objects/${widget.result.objectId}/widget.html`,widgetFile=await run(`lassoAudit.tool('mcp_read_file',${JSON.stringify({path:widgetPath})})`);assert.equal(widgetFile.ok,true);
  const widgetContent=widgetFile.result.content.replace('项目报告图表','项目折线图'),widgetPatch=`--- a/${widgetPath}\n+++ b/${widgetPath}\n@@ -1 +1 @@\n-${widgetFile.result.content}\n+${widgetContent}\n`;
  const widgetEdit=await run(`lassoAudit.tool('mcp_patch_file',${JSON.stringify({path:widgetPath,expectedHash:widgetFile.result.contentHash,patch:widgetPatch})})`);assert.equal(widgetEdit.ok,true);await retained();
  report.checks.push({name:'Widget source patch preserves the selected region',receipt:widgetEdit.result});
  await run('lassoAudit.assistAgentFinishResult(false)');
  // A real in-progress gesture must still refuse writes without consuming
  // pending history. A later inspection observes its end at the same content revision.
  const before=await run('({revision:lassoAudit.state.userRevision,history:lassoAudit.state.history.length})');
  await run('lassoAudit.state.drawing={synthetic:true};lassoAudit.gestureBefore=lassoAudit.state.historyBefore;');
  const blocked=await run("lassoAudit.tool('mcp_edit_canvas',{action:'create_text',text:'Must not commit'})");assert.equal(blocked.ok,false);assert.equal(blocked.error.code,'CANVAS_BUSY');assert.equal(blocked.error.details.mutationGuard,'canvas-edit');assert.ok(blocked.error.details.mutationState.blockers.includes('drawing'));
  assert.deepEqual(await run('({revision:lassoAudit.state.userRevision,history:lassoAudit.state.history.length})'),before);assert.equal(await run('lassoAudit.state.historyBefore===lassoAudit.gestureBefore'),true);
  await run('lassoAudit.state.drawing=null');const inspected=await run("lassoAudit.tool('mcp_inspect_session',{})");assert.equal(inspected.ok,true);assert.deepEqual(inspected.result.mutationState.blockers,[]);assert.ok(inspected.result.mutationState.revision>blocked.error.details.mutationState.revision);
  report.checks.push({name:'actual gesture rejects writes and read-only inspection observes end without a content revision',blocked:blocked.error,inspected:inspected.result.mutationState,before});
  // Canceling a static lasso never restores old tiles over the committed ink.
  const stable=await run('({revision:lassoAudit.state.userRevision,history:lassoAudit.state.history.length,text:lassoAudit.state.textBoxes.map(t=>t.text),widgets:lassoAudit.state.widgets.map(w=>w.html),ink:[...lassoAudit.tiles].map(([k,c])=>[k,c.toDataURL()])})');
  await run('lassoAudit.cancelSelection()');assert.deepEqual(await run('({revision:lassoAudit.state.userRevision,history:lassoAudit.state.history.length,text:lassoAudit.state.textBoxes.map(t=>t.text),widgets:lassoAudit.state.widgets.map(w=>w.html),ink:[...lassoAudit.tiles].map(([k,c])=>[k,c.toDataURL()])})'),stable);
  const saved=await run("lassoAudit.saveSnapshot({name:'Synthetic lasso request',location:'device'})");assert.ok(saved);const snapshot=await run(`lassoAudit.readDeviceSnapshot(${JSON.stringify(saved)})`);assert.ok(snapshot.item.textBoxes.some(t=>t.text===replacement));assert.ok(snapshot.item.widgets.some(w=>w.title==='所选内容'));assert.ok(snapshot.tileEntries.length);
  report.checks.push({name:'cancel/save preserve actual text/Widget/ink results',snapshotId:saved});
  // Deferred writes are rejected after lasso cancellation or replacement.
  for(const retarget of [false,true]){
    await run(`lassoAudit.assistAgentFinishResult(false);lassoAudit.canvasAgent.running=false;lassoAudit.canvasAgent.requestPending=false;lassoAudit.canvasAgentSetRunning(false);lassoAudit.captureSelection([{x:6020,y:8980},{x:8640,y:8980},{x:8640,y:10350},{x:6020,y:10350}]);lassoAudit.smartSuggest.selectionVersion++;lassoAudit.target={box:{...lassoAudit.state.selection.box},selection:lassoAudit.state.selection,selectionKey:'selection:'+lassoAudit.smartSuggest.selectionVersion};void 0;`);const submitted=await run("lassoAudit.assistAgentRun('solve',lassoAudit.target,{instruction:'请描述所选内容'})");assert.equal(submitted,'submitted',JSON.stringify(await run('({status:lassoAudit.assistAgent.status.textContent,agentStatus:lassoAudit.canvasAgentStatus.textContent,requestPending:lassoAudit.canvasAgent.requestPending})')));
    await run("lassoAudit.pauseText();lassoAudit.textPrepared=false;lassoAudit.pending=lassoAudit.tool('mcp_edit_canvas',{action:'create_text',text:'Stale lasso write'});void 0");await wait('lassoAudit.textPrepared');
    await run(retarget?"lassoAudit.captureSelection([{x:3000,y:3000},{x:4000,y:3000},{x:4000,y:4000},{x:3000,y:4000}]);lassoAudit.smartSuggest.selectionVersion++":"lassoAudit.cancelSelection()");
    await run('lassoAudit.releaseText();lassoAudit.pending');await run('lassoAudit.restoreText()');assert.equal(await run("lassoAudit.state.textBoxes.some(t=>t.text==='Stale lasso write')"),false);
    report.checks.push({name:'deferred selected-region write rejected after '+(retarget?'retargeting':'cancellation')});
  }
  for(const outcome of ['success','failed','new-selection']){
    await run('lassoAudit.seed()');
    assert.equal(await run("lassoAudit.assistAgentRun('solve',lassoAudit.target,{instruction:'Create a Widget for the selected region.'})"),'submitted');
    const created=await run("lassoAudit.tool('mcp_present_widget',{artifactId:crypto.randomUUID(),title:'Generated Widget',html:'<h2>Generated Widget</h2><button>Use result</button>',width:480,height:360})");assert.equal(created.ok,true);
    assert.equal(await run('lassoAudit.state.mode'),'select','keep Lasso until the Agent completes');
    if(outcome==='new-selection')await run('lassoAudit.captureSelection([{x:3000,y:3000},{x:4000,y:3000},{x:4000,y:4000},{x:3000,y:4000}]);lassoAudit.newSelection=lassoAudit.state.selection;');
    await run(`lassoAudit.canvasAgent.running=false;lassoAudit.canvasAgent.requestPending=false;lassoAudit.canvasAgentSetRunning(false);lassoAudit.assistAgentFinishResult(${outcome!=='failed'});`);
    assert.equal(await run('lassoAudit.state.mode'),outcome==='success'?'hand':'select');
    if(outcome==='success'){
      assert.equal(await run('lassoAudit.state.selection'),null);
      assert.equal(await run('document.querySelector(\'[data-mode="hand"]\').getAttribute("aria-pressed")'),'true');
      await shot('agent-completed-hand');
    }else assert.equal(await run(outcome==='failed'?'lassoAudit.state.selection===lassoAudit.selection':'lassoAudit.state.selection===lassoAudit.newSelection'),true);
    report.checks.push({name:'Agent '+outcome+' tool transition',mode:await run('lassoAudit.state.mode')});
  }
  for(const outcome of ['success','failed','empty','stopped']){
    await run(`lassoAudit.seed();lassoAudit.responseMode=${JSON.stringify(outcome)};lassoAudit.commandStarted=false;lassoAudit.reply=null;lassoAudit.outcome=null;lassoAudit.requestSelectionAI('answer',lassoAudit.state.selection,lassoAudit.buildSelectionImage(lassoAudit.state.selection),{onSettled:result=>lassoAudit.outcome=result});`);
    await wait('lassoAudit.commandStarted');
    assert.equal(await run('lassoAudit.state.mode'),'select','keep Lasso until Canvas AI completes');
    await run(outcome==='stopped'?'lassoAudit.stopActiveAIRequests()':'lassoAudit.reply()');
    await wait('!lassoAudit.state.activeAI&&!lassoAudit.selection.aiRequest');
    await run('new Promise(requestAnimationFrame)');
    const transition=await run('({mode:lassoAudit.state.mode,status:lassoAudit.state.statusKey,statusText:lassoAudit.state.statusText,outcome:lassoAudit.outcome,widgets:lassoAudit.state.widgets.map(w=>w.title),selected:!!lassoAudit.state.selection,pending:!!lassoAudit.state.pending,pendingWidget:!!lassoAudit.state.pendingWidget})');
    assert.equal(transition.mode,outcome==='success'?'hand':'select',JSON.stringify(transition));
    if(outcome==='success'){
      assert.equal(await run('lassoAudit.state.selection'),null);
      assert.equal(await run('document.querySelector(\'[data-mode="hand"]\').getAttribute("aria-pressed")'),'true');
      await wait('lassoAudit.state.widgets.some(w=>w.title==="Generated Widget"&&w.hostReady)');
      await run('window.PenEchoStudioNavigator.updateDocument()');
      await run('document.querySelector("#screen").focus({preventScroll:true})');
      const point=await run('(()=>{const r=lassoAudit.state.widgets.find(w=>w.title==="Generated Widget").shell.getBoundingClientRect();return {x:r.x+r.width*.4,y:r.y+r.height*.4};})()');
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',button:'none',...point});
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...point});
      win.webContents.debugger.detach();
      const activation=await run('(()=>{const w=lassoAudit.state.widgets.find(w=>w.title==="Generated Widget");return {id:w.id,key:lassoAudit.state.handToolbarActiveKey,expanded:lassoAudit.state.handToolbarTargets.get("widget:"+w.id)?.expanded};})()');
      report.checks.push({name:'generated Widget native click',point,...activation});
      assert.equal(activation.expanded,true,'Hand directly reveals controls for the generated Widget: '+JSON.stringify(activation));
      await shot('canvas-ai-completed-hand-widget-selected');
    }else assert.equal(await run('lassoAudit.state.selection===lassoAudit.selection'),true);
    report.checks.push({name:'Canvas AI '+outcome+' tool transition',...transition});
  }
  await run("lassoAudit.seed();lassoAudit.cancelSelection();lassoAudit.responseMode='success';lassoAudit.commandStarted=false;lassoAudit.reply=null;void lassoAudit.requestAI('answer',null,{captureCurrentViewport:true});");
  await wait('lassoAudit.commandStarted');
  assert.equal(await run('lassoAudit.state.mode'),'select');
  await run('lassoAudit.reply()');await wait('!lassoAudit.state.activeAI');
  assert.equal(await run('lassoAudit.state.mode'),'hand','manual AI also enters Hand when Lasso has no active selection');
  report.checks.push({name:'manual Canvas AI in Lasso without selection enters Hand'});
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify({output,checks:report.checks.length,errors:report.errors}));
 }catch(error){report.failure={message:String(error.message||error),stack:error.stack};console.error(error);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');win?.destroy();if(server)await new Promise(r=>server.close(r));fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode||0);}
});
