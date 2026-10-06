"use strict";
// Real Electron acceptance with isolated data and intercepted model responses.
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{Readable}=require("node:stream");
const root=path.resolve(__dirname,".."),cloud=process.argv.includes("--cloud"),routing=process.argv.includes("--routing"),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-widget-refine-"));
const placement=process.argv.includes("--placement"),
  directory=path.resolve(process.argv.find(arg=>arg.startsWith("--output="))?.slice(9)||path.join(root,`docs/verification/${routing?'widget-refine-routing-20261002':'widget-ink-refine-20261001'}`)),prefix=cloud?"cloud":"local";
fs.mkdirSync(directory,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const clientArgument=process.argv.find(arg=>arg.startsWith("--client=")),
  clientFile=clientArgument?path.resolve(clientArgument.slice(9)):cloud?path.resolve(root,"../penecho_cloud/public/canvas/app.js"):path.join(root,"public/app.js"),readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([fs.readFileSync(clientFile,"utf8").replace(/\}\)\(\);\s*$/,`
    requireAiConnectionSelection=()=>true;selectedAiConnectionId=()=>"test-connection";aiConnectionScope=()=>"test-scope";
    window.refineTest={state,smartSuggest,penIntel,canvasDocumentsReady,loadCanvasSettings,restoreWidgets,setCanvasMode,closeCanvasAgent,render,undo,acceptPending,rejectPending,activeWidgetRefinement,assistWidgetRefineTarget,offerWidgetInkRefinement,executeSmartSuggestion,offerPenGesture,canvasDocumentsCurrent,canvasElementLayoutRect,showStepFlag,clearStepFlag,hideAssist,penIntelPlace,positionAssist,requests:[],commands:[],agentSubmissions:[],
      enableAgentTest(){
        dismissPenGestureOffer();dismissWidgetInkRefineOffer();hideAssist();state.dirty=null;
        canvasAgentExecutionAvailable=()=>true;allAiConnections=()=>[{id:'test-connection'}];canvasDocumentsExternal=()=>false;
        // The isolated service serves the verified mirror's shared assets at /.
        // Keep Cloud client semantics while adapting this test-only asset root.
        if(${cloud})canvasAssetUrl=name=>new URL(name,location.origin+'/').href;
        canvasAgent.currentConversation={id:'test-agent-conversation',items:[]};
        canvasAgentSubmitMessage=async options=>{options.assertCurrent();options.beforeSend();refineTest.agentSubmissions.push(options);return true;};
      },
      async finishAgent(success){
        if(success){
          const doc=canvasDocumentsCurrent(),path='objects/widget-1000/widget.html',read=await canvasDocumentsReadFile(doc,{path},true);
          const content=read.content.replace('"label":"Client"','"label":"Browser"');
          canvasAgentAssertToolExecution=()=>{};
          const result=await canvasDocumentsApplyFile(doc,{path,expectedHash:read.contentHash,content,requestId:'test-agent-refine'},{});
          assistAgentRecordResult('canvas_document',{operation:'mcp_patch_file',arguments:{path}},{...result,documentId:doc.id});
        }
        assistAgentFinishResult(success);assistAgent.active=false;
      },
    };
    if(${placement}){refineTest.placementTimings=[];const place=penIntelPlace;penIntelPlace=(...args)=>{const started=performance.now();try{return place(...args);}finally{refineTest.placementTimings.push(performance.now()-started);}};}
    const originalFetch=window.fetch;
    window.fetch=(url,options)=>{
      if(String(url).endsWith('/suggest')){
        refineTest.requests.push(JSON.parse(options.body));
        return Promise.resolve(new Response(JSON.stringify({ok:true,answers:{kind:{type:'choice',choice:'shape',probabilities:{shape:1}},action:{type:'choice',choice:'refine',confidence:.95,probabilities:{refine:.95,none:.05}},finished:{type:'noul',noul:1}}})));
      }
      if(url==='/api/ai/command'){
        refineTest.commands.push(JSON.parse(options.body));
        return new Promise((resolve,reject)=>{
          options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
          refineTest.finishCommand=(mode)=>resolve(mode==='failure'?new Response(JSON.stringify({error:'Test refinement failure'}),{status:503}):new Response(JSON.stringify({commands:[{tool:'html_widget',pluginId:'general',x:150,y:200,w:500,h:300,title:'Refined chart',refreshSeconds:0,html:'<!doctype html><html><body><h2>Changed element</h2><button>Preserved control</button></body></html>'}]}),{headers:{'Content-Type':'application/json'}}));
        });
      }
      return originalFetch(url,options);
    };
  })();`)]);
  return readStream.call(this,file,...args);
};
let server,win;const report={runtime:prefix,clientFile,checks:[],errors:[]},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let i=0;i<120;i++){if(await check())return;await pause(100);}throw Error(`Timed out: ${label}`);}
app.whenReady().then(async()=>{try{
  server=require('../server.js');
  // Cloud Canvas assets normally live at /canvas; this isolated canonical
  // server mounts the same verified assets at /.
  if(cloud)server.prependListener('request',req=>{if(req.url.startsWith('/canvas/'))req.url=req.url.slice('/canvas'.length);});
  await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
  win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)report.errors.push(message);});
  const js=code=>win.webContents.executeJavaScript(code,true),shot=async name=>fs.writeFileSync(path.join(directory,`${prefix}-${name}.png`),(await win.webContents.capturePage()).toPNG());
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);await until(()=>js('!!window.refineTest'),'startup');
  const html='<!doctype html><style>html,body{margin:0;height:100%;background:#fff;font:16px system-ui}.row{margin:50px 80px;padding:12px;border:1px solid #ccd}button{margin:0 80px}</style><div class="row">Revenue: $120</div><button>Original control</button>';
  await js(`(async()=>{const t=refineTest,s=t.state;await t.canvasDocumentsReady();await t.loadCanvasSettings();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();t.closeCanvasAgent();if(document.querySelector('#studioNavigatorToggle')?.getAttribute('aria-expanded')==='true')document.querySelector('#studioNavigatorToggle').click();s.auto=false;s.scale=1;s.panX=0;s.panY=0;s.language='en';t.smartSuggest.enabled=true;t.smartSuggest.available=true;t.penIntel.settings.gestures=true;t.penIntel.settings.stepCheck=false;t.restoreWidgets([{id:'target-widget',pluginId:'general',widgetType:'html_widget',title:'Editable chart with a deliberately long localized title — 修改其中的元素',x:150,y:200,w:500,h:300,contentW:500,contentH:300,refreshSeconds:0,html:${JSON.stringify(html)}}]);t.setCanvasMode('pen');t.render();})()`);
  await until(()=>js('refineTest.state.widgets.every(w=>w.hostReady&&w.initialized&&w.contentVersion>0)'),'Widget render');
  if(cloud)await js("window.PENECHO_CONFIG.runtime='cloud'");
  win.webContents.debugger.attach('1.3');
  const mouse=(type,p,extra={})=>win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type,...p,...extra});
  const point=async(x,y)=>js(`(()=>{const r=document.querySelector('#viewport').getBoundingClientRect(),s=refineTest.state;return {x:r.x+s.panX+${x}*s.scale,y:r.y+s.panY+${y}*s.scale};})()`);
  const circle=async(cx=310,cy=280,r=40)=>{
    const start=await point(cx+r,cy);await mouse('mouseMoved',start,{button:'none'});await mouse('mousePressed',start,{button:'left',buttons:1,clickCount:1});
    for(let i=1;i<=32;i++)await mouse('mouseMoved',await point(cx+Math.cos(i/32*Math.PI*2)*r,cy+Math.sin(i/32*Math.PI*2)*r),{button:'left',buttons:1});
    await mouse('mouseReleased',start,{button:'left',buttons:0,clickCount:1});
  };
  const click=async selector=>{const p=await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await mouse('mouseMoved',p,{button:'none'});await mouse('mousePressed',p,{button:'left',buttons:1,clickCount:1});await mouse('mouseReleased',p,{button:'left',buttons:0,clickCount:1});};
  const geometry=selector=>js(`(()=>{const t=refineTest,e=document.querySelector(${JSON.stringify(selector)}),rect=t.canvasElementLayoutRect(e),box=${selector.startsWith('.assist-bar')?'t.smartSuggest.bar.box':selector==='.pen-step-flag'?'t.penIntel.step.lineBox':'t.penIntel.refineOffer?.target.box||t.penIntel.offer?.box'},s=t.state,anchor={x:box.x*s.scale+s.panX,y:box.y*s.scale+s.panY,w:box.w*s.scale,h:box.h*s.scale},style=getComputedStyle(e);return {rect,anchor,distance:Math.max(0,anchor.x-rect.right,rect.left-anchor.x-anchor.w,anchor.y-rect.bottom,rect.top-anchor.y-anchor.h),visible:style.visibility==='visible'&&Number(style.opacity)>0,inert:e.inert};})()`);
  await circle();
  assert.equal(await js('!!document.querySelector(".pen-widget-refine-offer [data-widget-refine]")'),true,'immediate local offer at pen-up');
  assert.equal(await js('refineTest.requests.length'),0,'does not wait for inference');
  assert.equal(await js('!!refineTest.penIntel.gesture'),false,'circle remains Widget annotation');
  const immediateDirty=await js('refineTest.state.dirty');assert.ok(immediateDirty);
  if(placement){
    await until(async()=>(await geometry('.pen-widget-refine-offer')).visible,'immediate offer fade-in');
    const initial=await geometry('.pen-widget-refine-offer');assert.ok(initial.visible);assert.ok(initial.distance>=79,JSON.stringify(initial));
    report.placement={immediate:initial};
  }
  await pause(900);await shot('wide');
  assert.equal(await js('!!document.querySelector(".assist-bar [data-suggestion=refine]")'),true);
  await until(()=>js('refineTest.requests.some(r=>r.context.widgetRefine)'),'ranked target context');
  report.context=await js('refineTest.requests.find(r=>r.context.widgetRefine).context');
  assert.equal(report.context.widgetRefine.id,await js('refineTest.state.widgets[0].id'));
  if(placement){
    report.placement.suggest=await geometry('.assist-bar');assert.ok(report.placement.suggest.distance>=79,JSON.stringify(report.placement.suggest));
    await js(`(()=>{const t=refineTest,record=t.smartSuggest.strokes.at(-1);t.showStepFlag({strokes:[record],recentIds:new Set([record.id]),box:record.box,newBox:record.box},{score:.9},t.canvasDocumentsCurrent().id);})()`);
    await pause(100);await shot('step-flag');
    report.placement.step=await geometry('.pen-step-flag');assert.ok(report.placement.step.distance>=79,JSON.stringify(report.placement.step));
    const start=await point(350,290);await mouse('mouseMoved',start,{button:'none'});await mouse('mousePressed',start,{button:'left',buttons:1,clickCount:1});
    const writing=await js(`(()=>{const t=refineTest,step=document.querySelector('.pen-step-flag'),bar=document.querySelector('.assist-bar');return {drawing:!!t.state.drawing,refine:!!document.querySelector('.pen-widget-refine-offer'),stepVisible:getComputedStyle(step).visibility,stepInert:step.inert,assistVisible:getComputedStyle(bar).visibility,assistInert:bar.inert};})()`);
    assert.deepEqual(writing,{drawing:true,refine:false,stepVisible:'hidden',stepInert:true,assistVisible:'hidden',assistInert:true});
    for(let i=1;i<=16;i++)await mouse('mouseMoved',await point(350+i*5,290+i/2),{button:'left',buttons:1});
    await shot('writing-yields');await mouse('mouseReleased',await point(430,298),{button:'left',buttons:0,clickCount:1});
    assert.ok(await js('refineTest.smartSuggest.strokes.at(-1).points.length>10'),'continued stroke records through the old nearby offer location');
    await pause(700);assert.equal((await geometry('.pen-step-flag')).visible,true,'step flag returns after pen-up quiet');
    await js('refineTest.clearStepFlag("test-complete")');
    report.placement.writing=writing;report.checks.push('Refine, Suggest and step hints keep an 80 CSS-pixel writing clearance; real Canvas pointer-down immediately removes Refine and fully hides/inerts the other hints, then pen-up quiet restores step feedback.');
  }
  await click('.pen-widget-refine-offer [data-widget-refine]');
  await until(()=>js('refineTest.commands.length===1'),'direct refinement request');
  const request=await js('refineTest.commands[0]');report.widgetEdit=request.widgetEdit;
  assert.equal(report.widgetEdit.mode,'replace');assert.equal(report.widgetEdit.instructionMode,'nearby-dirty');assert.equal(report.widgetEdit.actionId,'apply_marks');assert.ok(report.widgetEdit.html.includes('Original control'));
  await js('refineTest.finishCommand()');await until(()=>js('!refineTest.activeWidgetRefinement()'),'request completion');
  await until(()=>js('refineTest.state.widgets.length===1&&refineTest.state.widgets[0].title==="Refined chart"'),'replacement');
  assert.equal(await js('refineTest.state.dirty'),null,'committed refinement consumes its input');
  report.checks.push('Real pen circle immediately offers Refine, stays dirty, and reaches the existing replacement flow with original source and apply_marks. Successful replacement clears the annotations.');
  await circle();await pause(650);
  await click('.assist-bar [data-suggestion=refine]');await until(()=>js('refineTest.commands.length===2'),'Suggest refinement request');
  await js("refineTest.finishCommand('failure')");await until(()=>js('!refineTest.activeWidgetRefinement()'),'second request completion');
  assert.ok(await js('refineTest.state.dirty'),'failed refinement preserves the original annotations');
  report.checks.push('The real Suggest Refine button invokes the same replacement request; a failed request preserves dirty ink.');
  await circle(370,290,30);await js('refineTest.undo()');await pause(150);
  assert.equal(await js('!!document.querySelector(".pen-widget-refine-offer")'),false,'Undo retires the immediate offer');
  report.checks.push('Undo invalidates an immediate offer.');
  for(const scenario of [{name:'narrow-zh',width:560,height:850,zoom:1,language:'zh'},{name:'zoom-200',width:1200,height:900,zoom:2,language:'en'}]){
    win.setContentSize(scenario.width,scenario.height);win.webContents.setZoomFactor(scenario.zoom);await pause(200);
    await js(`(()=>{const t=refineTest,s=t.state;s.language=${JSON.stringify(scenario.language)};s.scale=.7;s.panX=-70;s.panY=-40;t.render();})()`);
    await circle(310,280,25);await pause(800);await shot(scenario.name);
    const bounds=await js(`(()=>{const e=document.querySelector('.pen-widget-refine-offer'),b=e.getBoundingClientRect(),v=document.querySelector('#viewport').getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,v:{left:v.left,right:v.right,top:v.top,bottom:v.bottom},text:e.innerText};})()`);
    assert.ok(bounds.left>=bounds.v.left&&bounds.right<=bounds.v.right+1&&bounds.top>=bounds.v.top&&bounds.bottom<=bounds.v.bottom+1,scenario.name+' offer stays inside viewport');
    if(placement){const detail=await geometry('.pen-widget-refine-offer');assert.ok(detail.visible);assert.ok(detail.distance>=79,scenario.name+JSON.stringify(detail));report.placement[scenario.name]=detail;}
    const hit=await js(`(()=>{const e=document.querySelector('.assist-bar [data-suggestion=refine]'),r=e.getBoundingClientRect(),p=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {visible:e.contains(p),cover:p?.className,bar:{x:r.x,y:r.y,w:r.width,h:r.height},top:document.querySelector('.topbar').getBoundingClientRect().toJSON(),minY:refineTest.smartSuggest.bar.placement?.mask?.minY};})()`);
    assert.equal(hit.visible,true,scenario.name+' Suggest Refine is unobstructed: '+JSON.stringify(hit));
    report.checks.push(scenario.name+' renders a visible, bounded offer: '+bounds.text.replace(/\n/g,' / '));
  }
  win.webContents.setZoomFactor(1);win.setContentSize(1200,900);await js('refineTest.state.scale=1;refineTest.state.panX=0;refineTest.state.panY=0;refineTest.render()');await circle();
  await js(`(()=>{const t=refineTest,record=t.smartSuggest.strokes.at(-1);t.offerPenGesture({records:[record],local:{shape:'strike',target:record.box},box:record.box,documentId:t.canvasDocumentsCurrent().id,revision:t.state.userRevision},{gesture:'delete'});})()`);
  assert.equal(await js('!!document.querySelector(".pen-gesture-offer [data-gesture=delete]")&&!!document.querySelector(".pen-gesture-offer [data-widget-refine]")'),true);
  assert.equal(await js('!!document.querySelector(".pen-widget-refine-offer")'),false);
  await shot('delete-and-refine');report.checks.push('Delete and Refine share one cancellation offer without duplicate popups.');
  if(placement){
    await pause(250);
    const detail=await geometry('.pen-gesture-offer');assert.ok(detail.visible&&detail.distance>=79,JSON.stringify(detail));report.placement.gesture=detail;
    await js(`(()=>{const t=refineTest,s=t.state;s.language='zh';s.scale=1;s.panX=s.panY=0;t.hideAssist('cramped');t.penIntel.offer.box={x:8,y:60,w:1500,h:900};t.penIntelPlace(t.penIntel.offer.element,t.penIntel.offer.box);})()`);
    const cramped=await js(`(()=>{const t=refineTest,e=document.querySelector('.pen-gesture-offer'),rect=t.canvasElementLayoutRect(e),style=getComputedStyle(e);return {rect,visible:style.visibility==='visible'&&Number(style.opacity)>0,inert:e.inert};})()`);
    assert.ok(cramped.visible&&!cramped.inert,'insufficient clearance keeps the chip displayed');report.placement.cramped=cramped;
    await shot('crowded-visible');report.checks.push('Delete/Refine retains its visible on-screen fallback when the source leaves insufficient writing clearance.');
  }
  if(routing){
    const structured='<!doctype html><html><body><section data-penecho-architecture><script type="application/json" data-architecture-source>{"version":1,"title":"Request flow","nodes":[{"id":"client","label":"Client"},{"id":"api","label":"API"}],"edges":[{"from":"client","to":"api"}]}</script></section></body></html>';
    await js(`(()=>{const t=refineTest;t.enableAgentTest();t.restoreWidgets([{id:'widget-1000',widgetType:'html_widget',pluginId:'general',title:'Request flow',refreshSeconds:0,x:150,y:200,w:500,h:300,contentW:500,contentH:300,sourceFormat:'penecho-mcp+html',html:${JSON.stringify(structured)}}]);t.render();})()`);
    await until(()=>js('refineTest.state.widgets.every(w=>w.hostReady&&w.initialized&&w.contentVersion>0)'),'structured Widget render');
    await circle(450,360,40);
    report.routingInvocation=await js(`(()=>{const t=refineTest,s=t.state,r=t.smartSuggest.strokes.at(-1);return {mode:s.mode,dirty:s.dirty,pending:!!s.pending,pendingWidget:!!s.pendingWidget,activeRefine:!!t.activeWidgetRefinement(),widgets:s.widgets.map(w=>({id:w.id,x:w.x,y:w.y,w:w.w,h:w.h,pending:w.pending,renderActive:w.renderActive,hiddenForReplacement:w.hiddenForReplacement})),lastStroke:r?{id:r.id,box:r.box,inputConsumed:r.inputConsumed,deletionGesture:r.deletionGesture}:null,consumedStrokeId:t.smartSuggest.consumedStrokeId,target:!!t.assistWidgetRefineTarget({strokes:r?[r]:[]})};})()`);
    await until(()=>js('!!document.querySelector("[data-widget-refine]")'),'structured Widget Refine offer');
    await click('[data-widget-refine]');
    await until(()=>js('refineTest.agentSubmissions.length===1'),'Agent Refine submission');
    report.agent=await js(`(()=>{const q=refineTest.agentSubmissions[0];return {prompt:q.textOverride,references:q.referencesOverride,images:q.imageOverrides.map(i=>({name:i.name,width:i.width,height:i.height}))};})()`);
    assert.equal(report.agent.images.length,2);assert.deepEqual(report.agent.references.objectIds,['widget-1000']);
    assert.match(report.agent.prompt,/penecho_get_guidance\(\{id:"architecture",detail:"full"\}\)/);
    assert.equal(await js('refineTest.commands.length'),2,'structured Refine must not invoke Canvas AI');
    assert.equal(await js('refineTest.requests.some(r=>r.mode==="route")'),false,'Widget routing must not invoke PenEchoLLM');
    assert.ok(await js('refineTest.state.dirty'),'Agent submission does not consume ink');
    await js('refineTest.finishAgent(true)');
    await until(()=>js('!refineTest.activeWidgetRefinement()'),'Agent completion');
    await until(()=>js('refineTest.state.widgets.every(w=>w.hostReady&&w.initialized&&w.contentVersion>0)'),'patched Widget render');
    assert.equal(await js('refineTest.state.dirty'),null);assert.equal(await js('refineTest.state.widgets[0].id'),'widget-1000');
    assert.equal(await js('refineTest.state.widgets[0].html.includes("Browser")'),true);
    await pause(300);await shot('agent-refine');await js('refineTest.undo()');
    assert.equal(await js('refineTest.state.widgets[0].html.includes("Client")'),true,'Undo restores the structured source');
    report.checks.push('Actual Refine click routes a General HTML architecture Widget to Agent with scoped guidance and two captured images; a source commit retains its identity, consumes ink, and supports Undo. Model submission and returned patch content are intercepted.');
    await circle(320,310,18);await pause(800);await click('.assist-bar [data-suggestion=refine]');
    await until(()=>js('refineTest.agentSubmissions.length===2'),'Suggest Agent submission');await js('refineTest.finishAgent(false)');
    assert.ok(await js('refineTest.state.dirty'),'failed Agent keeps annotations');
    report.checks.push('The real Suggest Refine uses the same Agent route; failure preserves dirty marks and no executor-classification request is sent.');
  }
  if(placement)report.placement.timings=await js(`(()=>{const times=refineTest.placementTimings.slice().sort((a,b)=>a-b);return {calls:times.length,p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],maximum:times.at(-1)};})()`);
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report,null,2));
}catch(error){report.failure=error.stack;process.exitCode=1;console.error(error);}finally{
  fs.writeFileSync(path.join(directory,`${prefix}-report.json`),JSON.stringify(report,null,2)+'\n');
  if(win&&!win.isDestroyed())win.destroy();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode||0);
}});
