"use strict";
// Exercise canonical Canvas and Widget-host assets with isolated local data.
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{Readable}=require("node:stream");
const root=path.resolve(__dirname,".."),cloud=process.argv.includes("--cloud"),runtime=cloud?"cloud":"local",
  temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-widget-auto-fit-")),directory=path.join(root,"docs/verification/widget-auto-content-fit-20261002");
fs.mkdirSync(directory,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),
  HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",
  PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const readStream=fs.createReadStream,assetRoot=cloud?path.resolve(root,"../penecho_cloud/public/canvas"):path.join(root,"public");
fs.createReadStream=function(file,...args){
  const relative=path.relative(path.join(root,"public"),String(file));
  if(relative==="app.js")return Readable.from([fs.readFileSync(path.join(assetRoot,"app.js"),"utf8").replace(/\}\)\(\);\s*$/,`
    canvasAgentAssertToolExecution=()=>{};
    // The isolated local service serves the reviewed mirror at the root.
    if (${cloud}) canvasAssetUrl=name=>new URL(name,location.origin+'/').href;
    window.autoFitTest={state,canvasDocumentsReady,loadCanvasSettings,canvasAgentCreate,canvasAgentReplaceWidget,canvasAgentHash,widgetEditContext,mcpExecute,mcpPresentationSize,mcpRevealRegion,restoreWidgets,serializedWidgets,widgetRecord,render,setCanvasMode,closeCanvasAgent,undo,redo};
  })();`)]);
  if(cloud&&["widget-host.js","widget-host.html"].includes(relative))return readStream.call(this,path.join(assetRoot,relative),...args);
  return readStream.call(this,file,...args);
};
const report={runtime,checks:[],samples:[],errors:[]};let server,win;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let i=0;i<120;i++){if(await check())return;await pause(100);}throw Error(`Timed out: ${label}`);}
function html(name,height){return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;padding:0;width:100%;height:100%;font:16px/1.4 system-ui;background:#fafafa;color:#252a30}.panel{height:100vh;overflow:auto}.content{font:16px/1.4 system-ui;height:${height}px;padding:20px;position:relative;background:linear-gradient(#edf3f6,#f4f6ef)}h1{font:500 20px/1.4 system-ui;margin:0 0 12px}input{font:16px system-ui}footer{position:absolute;bottom:12px;left:20px}</style></head><body><main class="panel"><article class="content" data-case="${name}"><h1>${name}</h1><input value="Retained live input"><footer>Complete content ends here</footer></article></main></body></html>`;}
app.whenReady().then(async()=>{try{
  server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
  win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  win.webContents.on("console-message",(_event,level,message)=>{if(level>=3)report.errors.push(message);});
  const js=code=>win.webContents.executeJavaScript(code,true);
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);await until(()=>js("!!window.autoFitTest"),"startup");
  await js(`(async()=>{const t=autoFitTest;await t.canvasDocumentsReady();await t.loadCanvasSettings();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();t.closeCanvasAgent();if(document.querySelector('#studioNavigatorToggle')?.getAttribute('aria-expanded')==='true')document.querySelector('#studioNavigatorToggle').click();t.state.auto=false;t.state.scale=1;t.state.panX=0;t.state.panY=0;t.setCanvasMode('pen');${cloud?"window.PENECHO_CONFIG.runtime='cloud';":""}})()`);
  const geometry=id=>js(`(()=>{const w=autoFitTest.state.widgets.find(w=>w.id===${JSON.stringify(id)});return {id:w.id,w:w.w,h:w.h,contentW:w.contentW,contentH:w.contentH,fitContentAxes:w.fitContentAxes,hasRequest:!!w.contentFitRequest,hasAutomatic:!!w.autoContentHeight};})()`);
  const settle=id=>until(()=>js(`(()=>{const w=autoFitTest.state.widgets.find(w=>w.id===${JSON.stringify(id)});return w.mcpDocumentLoaded&&!w.autoContentHeight&&!w.contentFitRequest;})()`),`fit ${id}`);
  const metrics=async name=>{
    for(const frame of win.webContents.mainFrame.framesInSubtree.filter(frame=>frame.url==="about:srcdoc")){
      const facts=await frame.executeJavaScript(`(()=>{const c=document.querySelector('[data-case=${JSON.stringify(name)}]');if(!c)return null;const p=document.querySelector('.panel'),r=document.documentElement;return {viewport:{width:innerWidth,height:innerHeight},contentHeight:c.getBoundingClientRect().height,panelHeight:p.clientHeight,panelScroll:p.scrollHeight,rootHeight:r.clientHeight,rootScroll:r.scrollHeight,font:getComputedStyle(c).fontSize,input:document.querySelector('input').value,fitMarker:p.hasAttribute('data-penecho-fit-scroll')};})()`);
      if(facts)return facts;
    }
    throw Error(`Missing content frame: ${name}`);
  };
  const defaultSize=await js("autoFitTest.mcpPresentationSize({})"),threshold=defaultSize.contentHeight*2;
  report.defaultSize=defaultSize;
  for(const [name,height,expected] of [["Short",120,120],["Expanded",900,900],["Exact threshold",threshold,600],["Tall",threshold+50,600]]){
    const result=await js(`autoFitTest.canvasAgentCreate({baseRevision:autoFitTest.state.userRevision,items:[{type:'widget',widgetType:'html_widget',pluginId:'general',title:${JSON.stringify(name)},width:800,height:600,html:${JSON.stringify(html(name,height))},placement:{mode:'absolute',x:100,y:100}}]},{preserveView:true,controller:new AbortController()})`),id=result.receipts[0].objectId;
    await settle(id);await pause(150);const box=await geometry(id),facts=await metrics(name);
    assert.equal(box.contentH,expected);assert.equal(box.h,expected);assert.equal(box.w,800);assert.equal(box.contentW,800);
    assert.equal(facts.font,"16px");assert.equal(facts.input,"Retained live input");
    if(height<threshold){assert.ok(facts.rootScroll<=facts.rootHeight+1);assert.ok(facts.panelScroll<=facts.panelHeight+1);assert.equal(facts.fitMarker,true);}
    else{assert.ok(facts.panelScroll>facts.panelHeight);assert.equal(facts.fitMarker,false);}
    report.samples.push({name,box,facts});
    if(name==="Expanded")fs.writeFileSync(path.join(directory,`${runtime}-expanded.png`),(await win.webContents.capturePage()).toPNG());
  }
  report.checks.push("Agent short content shrinks, moderate content expands, exact/taller threshold retains scrolling; typography and live controls remain intact");
  const beforeUndo=await js("autoFitTest.serializedWidgets()");
  await js("autoFitTest.undo()");await until(()=>js(`autoFitTest.state.widgets.length===${beforeUndo.length-1}`),"Undo create");
  await js("autoFitTest.redo()");await until(()=>js(`autoFitTest.state.widgets.length===${beforeUndo.length}`),"Redo create");
  assert.deepEqual((await js("autoFitTest.serializedWidgets()")).map(w=>[w.id,w.contentH,w.fitContentAxes]),beforeUndo.map(w=>[w.id,w.contentH,w.fitContentAxes]));
  await js("autoFitTest.restoreWidgets(autoFitTest.serializedWidgets())");
  assert.equal(await js("autoFitTest.state.widgets[0].contentH"),120);report.checks.push("Undo/Redo and canonical serialized reload retain measured geometry, including content below 200px");
  await js(`(async()=>{const t=autoFitTest,w=t.state.widgets[0],context=t.widgetEditContext(w,'agent');await t.canvasAgentReplaceWidget({baseRevision:t.state.userRevision,objectId:w.id,expectedHash:await t.canvasAgentHash(context),command:{...context,...context.box,tool:'html_widget',html:w.html.replace('Short','Updated short')}},{controller:new AbortController()});})()`);
  assert.equal(await js("autoFitTest.state.widgets[0].contentH"),120);
  assert.equal(await js("autoFitTest.state.widgets[0].fitContentAxes"),"height");report.checks.push("Source replacement remains valid after a Widget shrinks below the ordinary 200px minimum");
  await js("autoFitTest.mcpExecute('mcp_start_session',{sessionId:'fit-session',title:'Height fit'}, {})");
  for(const [name,width,zoom,scale] of [["MCP wide",1200,1,1],["MCP narrow",700,1,.5],["MCP zoom",1200,2,1]]){
    win.setSize(width,900);win.webContents.setZoomFactor(zoom);await pause(200);
    await js(`autoFitTest.state.scale=${scale};autoFitTest.render()`);
    const size=await js("autoFitTest.mcpPresentationSize({})"),height=Math.floor(size.contentHeight*1.5);
    const result=await js(`autoFitTest.mcpExecute('mcp_present_widget',{sessionId:'fit-session',artifactId:${JSON.stringify(name)},title:${JSON.stringify(name)},html:${JSON.stringify(html(name,height))},presentation:{intent:'review',attention:'request'}},{controller:new AbortController()})`);
    await js(`autoFitTest.mcpRevealRegion(${JSON.stringify(result.box)},true)`);
    await settle(result.objectId);await pause(150);const box=await geometry(result.objectId),facts=await metrics(name);
    assert.equal(box.contentH,height);assert.equal(box.contentW,size.contentWidth);assert.equal(box.w,size.width);
    assert.equal(box.h/box.contentH,size.height/size.contentHeight);assert.equal(facts.viewport.height,height);
    assert.ok(facts.rootScroll<=facts.rootHeight+1);assert.ok(facts.panelScroll<=facts.panelHeight+1);assert.equal(facts.font,"16px");
    assert.equal(await js("document.documentElement.scrollWidth<=innerWidth+1"),true);
    report.samples.push({name,size,box,facts});fs.writeFileSync(path.join(directory,`${runtime}-${name.replace(/ /g,"-").toLowerCase()}.png`),(await win.webContents.capturePage()).toPNG());
  }
  report.checks.push("MCP viewport defaults auto-expand at wide/narrow widths, 50% Canvas scale and 200% browser zoom without internal or outer horizontal overflow");
  assert.deepEqual(report.errors,[]);report.ok=true;fs.rmSync(path.join(directory,`${runtime}-failure.png`),{force:true});
}catch(error){report.ok=false;report.error=error.stack;if(win){
  report.failureState=await win.webContents.executeJavaScript("autoFitTest.state.widgets.map(w=>({id:w.id,htmlLength:w.html.length,hostReady:w.hostReady,initialized:w.initialized,loaded:w.mcpDocumentLoaded,active:w.renderActive,automatic:w.autoContentHeight&&{documentReady:w.autoContentHeight.documentReady},fitRequest:w.contentFitRequest?.requestId,diagnostics:w.runtimeDiagnostics,src:w.frame?.src}))").catch(()=>null);
  report.frames=await Promise.all(win.webContents.mainFrame.framesInSubtree.map(frame=>frame.executeJavaScript("({url:location.href,ready:document.readyState,title:document.title,body:document.body?.textContent?.slice(0,120)})").catch(()=>null)));
  fs.writeFileSync(path.join(directory,`${runtime}-failure.png`),(await win.webContents.capturePage()).toPNG());
}}
finally{win?.destroy();if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}report.closed=!server?.listening;
  fs.writeFileSync(path.join(directory,`${runtime}-report.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));fs.rmSync(temporary,{recursive:true,force:true});app.exit(report.ok?0:1);}
});
