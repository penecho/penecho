"use strict";
// Isolated real browser/tool execution. Replies are replayed; this does not
// measure provider semantics. All input drawings and documents are synthetic.
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{Readable}=require("node:stream"),{createHash}=require("node:crypto");
const root=path.resolve(__dirname,".."),cloud=process.argv.includes("--cloud"),clientFile=cloud?path.resolve(root,"../penecho_cloud/public/canvas/app.js"):path.join(root,"public/app.js"),
  temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-assist-source-")),output=path.resolve(process.argv.find(a=>a.startsWith("--output="))?.slice(9)||temporary);
fs.mkdirSync(output,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const readStream=fs.createReadStream,injection=`
  if(${cloud})Object.assign(window.PENECHO_CONFIG,{runtime:'cloud',connectionAccountId:'test-only',linkedDeviceId:'test-only',linkedDeviceOnline:true});
  window.sourceAudit={state,tiles,smartSuggest,assistAgent,canvasAgent,canvasDocuments,canvasDocumentsReady,loadCanvasSettings,loadHostedModels,settings,aiConnectionScope,storeAiConnectionSelection,assistAgentRun,assistAgentToolContext,assistAgentToolContextCurrent,assistAgentFinishResult,canvasAgentExecuteTool,canvasAgentHandleEvent,canvasAgentBeginSessionTransition,canvasAgentSubmitMessage,canvasDocumentsCurrent,canvasDocumentsExecute,canvasDocumentsShow,canvasDocumentsCollisions,canvasDocumentsActiveSnapshot,saveSnapshot,readDeviceSnapshot,canvasAgentSetRunning,executeAssistAction,captureSelection,cancelSelection,save,undo,redo,render,updateCoordinates,viewportRect,wire:[],envelopes:[],commands:[],rejections:[]};
  const originalToolAssert=canvasAgentAssertToolExecution;
  canvasAgentAssertToolExecution=execution=>{try{return originalToolAssert(execution);}catch(error){sourceAudit.rejections.push({code:error.code,message:error.message});throw error;}};
  canvasAgentConnect=async()=>{canvasAgent.socket={readyState:WebSocket.OPEN};canvasAgent.sessionReady=true;canvasAgent.sessionId='source-audit';};
  canvasAgentEnsureSearchSession=async()=>{};
  canvasAgentStartNewConversation=async()=>{canvasAgent.currentConversation={id:crypto.randomUUID(),items:[]};canvasAgent.sessionGeneration++;};
  canvasAgentSendRequest=(type,payload)=>sourceAudit.wire.push({type,payload});
  canvasAgentSendEnvelope=(type,payload)=>sourceAudit.envelopes.push({type,payload});
  sourceAudit.tool=async(operation,args)=>{
    const key='agent-'+ 'a'.repeat(64),callId=crypto.randomUUID(),started=performance.now();
    await canvasAgentExecuteTool({name:'canvas_document',requestId:callId,callId,arguments:{bindingKey:key,operation,arguments:{sessionId:key,requestId:callId,...args}}});
    const envelope=sourceAudit.envelopes.find(e=>e.payload?.requestId===callId)?.payload;
    return envelope?{...envelope,elapsedMs:performance.now()-started}:null;
  };
  sourceAudit.seed=()=>{
    const s=state;s.userRevision++;s.auto=false;s.language='en';smartSuggest.enabled=false;smartSuggest.available=false;
    for(const c of tiles.values())c.width=c.height=1;tiles.clear();s.inkBounds.clear();s.textBoxes=[];for(const w of s.widgets)unmountWidget(w);s.widgets=[];s.images=[];s.history=[];s.future=[];
    s.scale=.17;s.panX=600-6600*s.scale;s.panY=600-13300*s.scale;
    const ink=(text,x,y,size)=>{forTiles(x,y-size,1800,size*1.4,(c,tx,ty)=>{recordBefore(tx,ty);const ctx=c.getContext('2d');ctx.font=size+'px cursive';ctx.fillStyle='#202938';ctx.fillText(text,x-tx*TILE,y-ty*TILE);state.inkBounds.delete(key(tx,ty));},true);};
    ink('hello',6600,13600,340);ink('x² + 2x = 8',5600,11600,180);ink('△ ⛵',9500,12200,260);
    const oldWidget=widgetRecord({tool:'html_widget',widgetType:'html_widget',pluginId:'general',x:8300,y:10800,w:1500,h:700,contentW:360,contentH:200,title:'Existing plot',refreshSeconds:0,html:'<!doctype html><html><body style="margin:0;background:transparent"><svg viewBox="0 0 360 168"><path d="M25 10V140H345M35 120Q140 5 180 75T330 55" fill="none" stroke="#48665b" stroke-width="3"/></svg></body></html>'});
    s.widgetHistoryBefore=[];s.widgets.push(oldWidget);mountWidget(oldWidget);
    save();s.dirty={x:6600,y:13300,w:1050,h:310};render();updateCoordinates();
    sourceAudit.target={box:{...s.dirty},newBox:{...s.dirty},strokes:[{id:1,historyEntry:s.history.at(-1)}]};
  };
  sourceAudit.start=async()=>{
    canvasAgent.running=false;canvasAgent.requestPending=false;canvasAgentSetRunning(false);assistAgentFinishResult(false);
    return assistAgentRun('answer',sourceAudit.target,{label:'Answer'});
  };
  sourceAudit.pauseText=()=>{
    const original=renderedTextBoxRecord;sourceAudit.releaseText=null;
    const held=new Promise(resolve=>sourceAudit.releaseText=resolve);
    renderedTextBoxRecord=async(...args)=>{const result=await original(...args);sourceAudit.textPrepared=true;await held;return result;};
    sourceAudit.restoreText=()=>{renderedTextBoxRecord=original;};
  };
  const originalFetch=window.fetch;
  window.fetch=async(url,options)=>{
    const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
    if(url==='/api/v1/models')return json({accountId:'test-only',models:[],credits:{available:1}});
    if(String(url).endsWith('/suggest/status'))return json({configured:false});
    if(url==='/api/ai/command'){sourceAudit.commands.push(JSON.parse(options.body));return json({commands:[]});}
    return originalFetch(url,options);
  };
`;
fs.createReadStream=function(file,...args){if(path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([fs.readFileSync(clientFile,"utf8").replace(/\}\)\(\);\s*$/,injection+'})();')]);return readStream.call(this,file,...args);};
let server,win;
const report={runtime:cloud?"cloud-client":"local",clientFile,clientSha256:createHash("sha256").update(fs.readFileSync(clientFile)).digest("hex"),syntheticOnly:true,providerSemantics:"not measured: deterministic tool replay",checks:[],errors:[]};
app.whenReady().then(async()=>{
 try{
  server=require("../server.js");server.prependListener("request",req=>{if(cloud&&req.url.startsWith('/canvas/'))req.url=req.url.slice('/canvas'.length);});
  await new Promise(r=>server.listening?r():server.once("listening",r));
  win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  win.webContents.on("console-message",(_e,level,message)=>{if(level>=3)report.errors.push(message);});
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  const run=async code=>{try{return await win.webContents.executeJavaScript(code);}catch(error){throw Error('Browser check failed: '+code+' '+String(error?.stack||error?.message||JSON.stringify(error)));}},wait=async expression=>{const until=Date.now()+15000;while(!await run(expression)){if(Date.now()>until)throw Error('Timed out: '+expression);await new Promise(r=>setTimeout(r,30));}},
    shot=async name=>{await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());};
  await run(`(async()=>{const t=sourceAudit;await t.canvasDocumentsReady();await t.loadCanvasSettings();if(window.PENECHO_CONFIG.runtime==='cloud'){await t.loadHostedModels({accountChanged:true});t.settings.connections=[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',provider:'api',hasApiKey:true,apiUrl:'http://127.0.0.1:1/v1',apiModel:'test'}];t.settings.connectionScope=t.aiConnectionScope();}t.storeAiConnectionSelection(t.settings.connections[0].id);document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();t.seed();})()`);
  assert.equal(await run('sourceAudit.start()'),'submitted');
  const prompt=await run('sourceAudit.wire.at(-1).payload.text');assert.match(prompt,/Reply naturally to greetings/);assert.match(prompt,/unless the user requests transcription/);
  await shot('source-before');
  const failed=await run("sourceAudit.tool('mcp_edit_canvas',{action:'create_text',text:'Hello! How can I help?',region:{x:6600,y:13400},width:400})");
  assert.equal(failed.ok,false);assert.equal(failed.error.code,'LAYOUT_CONFLICT');
  const retry=await run("sourceAudit.tool('mcp_edit_canvas',{action:'create_text',text:'Hello! How can I help?'})");
  assert.equal(retry.ok,true);assert.equal(retry.result.sourcePlacement.relation,'below');assert.ok(retry.result.box.y>=13610);
  assert.ok(retry.result.box.x>=6300&&retry.result.box.x<=6700);assert.ok(retry.result.box.h*.17>=20,'readable screen height at 17%');
  await run('sourceAudit.render()');await shot('forced-agent-retry');
  report.checks.push({name:'forced Agent shared create_text retries below synthetic hello at 17%',failed:failed.error,receipt:retry.result,elapsedMs:retry.elapsedMs,source:await run('sourceAudit.target.box'),screen:await run('({scale:sourceAudit.state.scale,panX:sourceAudit.state.panX,panY:sourceAudit.state.panY})')});
  await run('sourceAudit.undo()');await wait('!sourceAudit.state.textBoxes.length');await run('sourceAudit.redo()');await wait('sourceAudit.state.textBoxes.length===1');
  const saved=await run("sourceAudit.saveSnapshot({name:'Synthetic hello placement',location:'device'})");assert.ok(saved);
  const snapshot=await run(`sourceAudit.readDeviceSnapshot(${JSON.stringify(saved)})`);assert.ok(snapshot.item.textBoxes.some(t=>t.text==='Hello! How can I help?'&&t.y===retry.result.box.y));
  report.checks.push({name:'real Undo/redo and isolated device save retain exact output',snapshotId:saved,box:retry.result.box});
  await run('sourceAudit.assistAgentFinishResult(true)');assert.equal(await run('sourceAudit.assistAgentToolContext()'),null);
  // Start another bounded request, then pan/zoom: geometry and font scale must
  // still be tied to the original world source and invocation zoom.
  assert.equal(await run('sourceAudit.start()'),'submitted');
  await run('sourceAudit.state.scale=.22;sourceAudit.state.panX-=75;sourceAudit.state.panY-=90;sourceAudit.render();sourceAudit.updateCoordinates()');
  const defaultReply=await run("sourceAudit.tool('mcp_edit_canvas',{action:'create_text',text:'Hi! What would you like to explore?'})");
  assert.equal(defaultReply.ok,true);assert.equal(defaultReply.result.sourcePlacement.relation,'below');assert.equal(defaultReply.result.sourcePlacement.source.x,6600);
  await shot('default-after-pan-zoom');report.checks.push({name:'default output retains invocation source after pan/zoom',receipt:defaultReply.result,elapsedMs:defaultReply.elapsedMs});
  await run('sourceAudit.assistAgentFinishResult(true)');
  assert.equal(await run('sourceAudit.start()'),'submitted');
  const legacy=await run(`(async()=>{const t=sourceAudit,id=crypto.randomUUID();await t.canvasAgentExecuteTool({name:'canvas_create',requestId:id,callId:id,arguments:{baseRevision:t.state.userRevision,items:[{type:'text',text:'Hello again!'}]}});return t.envelopes.find(e=>e.payload?.requestId===id)?.payload;})()`);
  assert.equal(legacy.ok,true);assert.ok(['below','near'].includes(legacy.result.receipts[0].sourcePlacement.relation));report.checks.push({name:'legacy default create uses the same trusted source policy',receipt:legacy.result});
  await run('sourceAudit.assistAgentFinishResult(false)');
  const independent=await run("sourceAudit.tool('mcp_edit_canvas',{action:'create_text',text:'Independent MCP task'})");assert.equal(independent.ok,true);assert.equal(independent.result.sourcePlacement,null);
  report.checks.push({name:'completed anchor does not affect later ordinary MCP work',receipt:independent.result});
  assert.equal(await run('sourceAudit.start()'),'submitted');
  const construction=await run("sourceAudit.tool('mcp_edit_canvas',{action:'draw_ink',baseRevision:sourceAudit.state.userRevision,strokes:[{color:'#cc3344',width:12,points:[{x:6630,y:13605},{x:7550,y:13605}]}]})");
  assert.equal(construction.ok,true);assert.equal(await run("sourceAudit.canvasDocumentsCollisions(sourceAudit.canvasDocumentsCurrent(),{x:6620,y:13595,w:940,h:20}).length>0"),true);
  report.checks.push({name:'explicit native construction retains its original world coordinates',receipt:construction.result,points:[{x:6630,y:13605},{x:7550,y:13605}]});await run('sourceAudit.assistAgentFinishResult(true)');
  // Revoke the input before any tool arrives. Ownership must survive revocation,
  // otherwise a fresh late dispatch would be mistaken for ordinary Agent work.
  await run('sourceAudit.seed()');assert.equal(await run('sourceAudit.start()'),'submitted');
  await run('sourceAudit.undo()');
  const revoked=await run('({owned:!!sourceAudit.assistAgentToolContext(),valid:sourceAudit.assistAgentToolContextCurrent(sourceAudit.assistAgentToolContext()),history:sourceAudit.state.history.length})');
  assert.equal(revoked.owned,true);assert.equal(revoked.valid,false);assert.equal(revoked.history,0);
  const mutationState="({revision:sourceAudit.state.userRevision,text:sourceAudit.state.textBoxes.length,widgets:sourceAudit.state.widgets.length,images:sourceAudit.state.images.length,tiles:[...sourceAudit.tiles.keys()],history:sourceAudit.state.history.length})",beforeLate=await run(mutationState),rejectionsBefore=await run('sourceAudit.rejections.length');
  const late=await run("sourceAudit.tool('mcp_edit_canvas',{action:'create_text',text:'Late reply must not appear'})");
  assert.equal(late,null);assert.deepEqual(await run(mutationState),beforeLate);
  assert.ok(await run('sourceAudit.rejections.length')>rejectionsBefore);assert.equal(await run('sourceAudit.rejections.at(-1).code'),'SESSION_EXPIRED');
  report.checks.push({name:'Undo source before tool arrival rejects a fresh actual tool dispatch without any Canvas mutation',revoked,before:beforeLate,after:await run(mutationState),rejection:await run('sourceAudit.rejections.at(-1)')});
  await run("sourceAudit.canvasAgentHandleEvent({kind:'turn_end',turn:1,reason:{kind:'completed'}})");
  assert.equal(await run('sourceAudit.assistAgentToolContext()'),null);
  const afterTurn=await run("sourceAudit.tool('mcp_edit_canvas',{action:'create_text',text:'Ordinary work after turn end'})");assert.equal(afterTurn.ok,true);assert.equal(afterTurn.result.sourcePlacement,null);
  report.checks.push({name:'actual turn_end clears revoked ownership and permits later ordinary MCP work',receipt:afterTurn.result});
  await run('sourceAudit.seed()');assert.equal(await run('sourceAudit.start()'),'submitted');
  await run("document.querySelector('#assistAgentMini button:last-child').click();sourceAudit.canvasAgentBeginSessionTransition()");
  assert.equal(await run('sourceAudit.assistAgentToolContext()'),null);
  await run("sourceAudit.canvasAgent.sessionReady=true;sourceAudit.canvasAgent.sessionId='replacement-session';sourceAudit.canvasAgent.requestPending=false;sourceAudit.canvasAgentSetRunning(false)");
  const afterSession=await run("sourceAudit.tool('mcp_edit_canvas',{action:'create_text',text:'Ordinary work in replacement session'})");assert.equal(afterSession.ok,true);assert.equal(afterSession.result.sourcePlacement,null);
  report.checks.push({name:'actual session teardown retires cancelled ownership without turn_end and permits replacement-session MCP',receipt:afterSession.result});
  await run('sourceAudit.seed()');assert.equal(await run('sourceAudit.start()'),'submitted');
  await run("document.querySelector('#assistAgentMini button:last-child').click();sourceAudit.canvasAgentSetRunning(true)");
  assert.equal(await run("sourceAudit.canvasAgentSubmitMessage({textOverride:'Steer the same task',omitInitialCapture:true,includeDraftMedia:false,clearInput:false})"),true);
  assert.equal(await run('sourceAudit.wire.at(-1).type'),'steer');assert.equal(await run('!!sourceAudit.assistAgentToolContext()'),true);
  assert.equal(await run('sourceAudit.assistAgentToolContextCurrent(sourceAudit.assistAgentToolContext())'),false);
  await run('sourceAudit.canvasAgent.requestPending=false;sourceAudit.canvasAgentSetRunning(false)');
  assert.equal(await run("sourceAudit.canvasAgentSubmitMessage({textOverride:'A new ordinary task',omitInitialCapture:true,includeDraftMedia:false,clearInput:false})"),true);
  assert.equal(await run('sourceAudit.wire.at(-1).type'),'user_turn');assert.equal(await run('sourceAudit.assistAgentToolContext()'),null);
  const replacement=await run("sourceAudit.tool('mcp_edit_canvas',{action:'create_text',text:'Ordinary output for the replacement turn'})");assert.equal(replacement.ok,true);assert.equal(replacement.result.sourcePlacement,null);
  report.checks.push({name:'real submit keeps revoked ownership for steer, then retires it before a replacement user_turn',receipt:replacement.result});
  // Exercise asynchronous cancellation across the actual execution boundary.
  for(const reason of ['cancel','session','conversation','document']){
    await run('sourceAudit.seed()');assert.equal(await run('sourceAudit.start()'),'submitted');
    await run("sourceAudit.pauseText();sourceAudit.textPrepared=false;sourceAudit.staleWrite=sourceAudit.tool('mcp_edit_canvas',{action:'create_text',text:'Must not appear'});void 0");await wait('sourceAudit.textPrepared');
    if(reason==='cancel')await run("document.querySelector('#assistAgentMini button:last-child').click()");
    if(reason==='session')await run('sourceAudit.canvasAgent.sessionGeneration++');
    if(reason==='conversation')await run("sourceAudit.canvasAgent.currentConversation={id:'unrelated-conversation',items:[]}");
    if(reason==='document')await run(`(async()=>{const t=sourceAudit;document.querySelector('#assistAgentMini button:last-child').click();t.canvasAgent.requestPending=false;t.canvasAgentSetRunning(false);const e={socket:t.canvasAgent.socket,sessionId:t.canvasAgent.sessionId,generation:t.canvasAgent.sessionGeneration,controller:new AbortController()},result=await t.canvasDocumentsExecute('mcp_open_canvas',{instanceId:'synthetic',canvasId:'synthetic',create:true,title:'Other document',requestId:crypto.randomUUID(),show:false},e);await t.canvasDocumentsShow(result.documentId);})()`);
    await run('sourceAudit.releaseText();sourceAudit.staleWrite');await run('sourceAudit.restoreText()');
    assert.equal(await run("sourceAudit.state.textBoxes.some(t=>t.text==='Must not appear')||[...sourceAudit.canvasDocuments.records.values()].some(d=>d.stored?.item?.textBoxes?.some(t=>t.text==='Must not appear'))"),false,reason);
    assert.equal(await run('sourceAudit.assistAgentToolContextCurrent(sourceAudit.assistAgentToolContext())'),false,reason);
    assert.equal(await run('!!sourceAudit.assistAgentToolContext()'),reason!=='document',reason==='document'?'document switch tears down its old session':'revoked ownership survives until turn_end');
    await run("sourceAudit.canvasAgentHandleEvent({kind:'turn_end',turn:1,reason:{kind:'interrupted'}})");assert.equal(await run('sourceAudit.assistAgentToolContext()'),null);
    report.checks.push({name:'stale asynchronous '+reason+' cannot commit; '+(reason==='document'?'actual document session teardown retires ownership':'actual turn_end releases ownership')});
  }
  // The preexisting ordinary Answer shortcut remains immediate manual Auto.
  await run('sourceAudit.seed();sourceAudit.canvasAgent.running=false;sourceAudit.canvasAgent.requestPending=false');
  const manualBefore=await run('sourceAudit.commands.length');await run("sourceAudit.executeAssistAction({id:'answer'},{...sourceAudit.target,routing:{execution_answer:{type:'choice',choice:'penecho_agent'}}})");await wait(`sourceAudit.commands.length===${manualBefore+1}`);
  assert.equal(await run('sourceAudit.commands.at(-1).userAction'),'auto');report.checks.push({name:'ordinary Answer ignores recorded Agent misclassification and calls manual Canvas AI'});
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify({output,runtime:report.runtime,checks:report.checks.length,errors:report.errors}));
 }catch(error){report.failure={message:error.message,stack:error.stack};console.error(error);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');win?.destroy();if(server)await new Promise(r=>server.close(r));fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode||0);}
});
