"use strict";
// Real Canvas request, native draft, Keep and Undo with isolated test data.
// Run: tools/electron/node_modules/.bin/electron scripts/verify-finish-drawing.cjs
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{Readable}=require("node:stream");
const root=path.resolve(__dirname,".."),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"finish-drawing-")),
  output=path.join(root,"docs/verification/finish-drawing-20261002/implementation");
fs.mkdirSync(output,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const injection=`
  const finishFetch=fetch;
  window.finishTest={state,smartSuggest,tiles,canvasDocumentsReady,loadCanvasSettings,storeAiConnectionSelection,settings,stroke,save,undo,redo,render,acceptPending,rejectPending,executeAssistAction,captureSelection,cancelSelection,requests:[]};
  fetch=async(url,options)=>{
    if(String(url)==='/api/ai/command'){
      finishTest.requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({requestId:'finish-drawing-test',commands:[{tool:'draw',origin:[360,450],width:6,types:['smooth'],items:[[0,0,4,60,50,100,150,100,196,60,200,0]]}]}),{headers:{'content-type':'application/json'}});
    }
    if(String(url)==='/api/suggest/status')return new Response(JSON.stringify({configured:false}),{headers:{'content-type':'application/json'}});
    return finishFetch(url,options);
  };
  finishTest.hash=async(box)=>{
    const c=document.createElement('canvas');c.width=box.w;c.height=box.h;const ctx=c.getContext('2d');
    for(const [key,tile] of tiles){const [x,y]=key.split(',').map(Number);ctx.drawImage(tile,x*TILE-box.x,y*TILE-box.y);}
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',ctx.getImageData(0,0,c.width,c.height).data))].join(',');
  };
`;
const readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([fs.readFileSync(file,"utf8").replace(/\}\)\(\);\s*$/,injection+"})();")]);
  return readStream.call(this,file,...args);
};
const report={checks:[],errors:[]};let server,win;
app.whenReady().then(async()=>{
  try{
    server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
    win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    win.webContents.on("console-message",(_event,level,message)=>{if(level>=3)report.errors.push(message);});
    win.webContents.session.webRequest.onBeforeRequest({urls:["https://*/*"]},(_details,callback)=>callback({cancel:true}));
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const js=code=>win.webContents.executeJavaScript(code,true),
      waitFor=expression=>js(`(async()=>{const start=performance.now();while(!(${expression})){if(performance.now()-start>10000)throw Error('Timed out: '+${JSON.stringify(expression)});await new Promise(resolve=>setTimeout(resolve,20));}})()`),
      screenshot=async name=>fs.writeFileSync(path.join(output,name+".png"),(await win.webContents.capturePage()).toPNG());
    await js(`(async()=>{const t=finishTest;await t.canvasDocumentsReady();await t.loadCanvasSettings();t.storeAiConnectionSelection(t.settings.connections[0].id);document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();
      t.state.auto=false;t.state.scale=1;t.state.panX=0;t.state.panY=0;t.state.aiColor='#263443';t.smartSuggest.enabled=true;t.smartSuggest.available=false;
      const points=[[360,450],[365,400],[395,350],[425,385],[490,385],[525,350],[555,400],[560,450]].map(([x,y])=>({x,y}));
      for(let i=1;i<points.length;i++)t.stroke(points[i-1],points[i],false,6,true,'#263443');const entry=t.save();
      const source={id:1,points,size:6,historyEntry:entry,box:{x:357,y:347,w:206,h:106}};
      t.smartSuggest.strokes=[source];t.target={box:{x:340,y:330,w:240,h:250},newBox:source.box,strokes:[source]};
      t.stroke({x:850,y:360},{x:950,y:460},false,8,true,'#ff0000');const neighbor=t.save();
      t.smartSuggest.strokes.push({id:2,size:8,points:[{x:850,y:360},{x:950,y:460}],box:{x:846,y:356,w:108,h:108},historyEntry:neighbor});t.render();})()`);
    const full={x:340,y:330,w:240,h:250},upper={x:340,y:330,w:240,h:100},neighbor={x:830,y:340,w:150,h:150},
      original=await js(`finishTest.hash(${JSON.stringify(full)})`),upperBefore=await js(`finishTest.hash(${JSON.stringify(upper)})`),neighborBefore=await js(`finishTest.hash(${JSON.stringify(neighbor)})`);
    await screenshot("source");await js("finishTest.executeAssistAction({id:'finish_drawing'},finishTest.target)");
    await waitFor("finishTest.state.pending?.revealProgress===1");
    const request=await js("finishTest.requests[0]");
    assert.equal(request.suggestion,"finish_drawing");assert.equal(request.sourceInk.coordinateSpace,"canvas-world");assert.equal(request.sourceInk.strokeWidth,6);assert.equal(request.sourceInk.strokes.length,1);
    assert.deepEqual(request.sourceInk.strokes[0].points[0],[360,450]);assert.deepEqual(request.sourceInk.strokes[0].points.at(-1),[560,450]);
    assert.equal(await js(`finishTest.hash(${JSON.stringify(full)})`),original,"draft leaves source tiles unchanged");
    await screenshot("native-draft");await js("finishTest.acceptPending()");await waitFor("!finishTest.state.activeAI");
    const combined=await js(`finishTest.hash(${JSON.stringify(full)})`);
    assert.notEqual(combined,original);assert.equal(await js(`finishTest.hash(${JSON.stringify(upper)})`),upperBefore);assert.equal(await js(`finishTest.hash(${JSON.stringify(neighbor)})`),neighborBefore);
    await screenshot("accepted");await js("finishTest.undo()");assert.equal(await js(`finishTest.hash(${JSON.stringify(full)})`),original);
    await js("finishTest.redo()");assert.equal(await js(`finishTest.hash(${JSON.stringify(full)})`),combined);
    report.checks.push("Real Finish drawing request sends exact source endpoints and supported width, excluding unrelated strokes","Native draft preserves original source pixels; Keep adds only missing marks","Undo restores source pixels exactly; Redo restores completion; neighboring ink remains unchanged");
    await js("finishTest.smartSuggest.strokes=[];finishTest.target.strokes=[];finishTest.executeAssistAction({id:'finish_drawing'},finishTest.target)");await waitFor("finishTest.state.pending?.revealProgress===1");
    assert.equal(await js("Object.hasOwn(finishTest.requests.at(-1),'sourceInk')"),false);await js("finishTest.rejectPending()");
    await js("finishTest.captureSelection([{x:340,y:330},{x:580,y:330},{x:580,y:580},{x:340,y:580}]);finishTest.executeAssistAction({id:'finish_drawing'},{box:finishTest.state.selection.box,selection:finishTest.state.selection,selectionKey:'selection:'+finishTest.smartSuggest.selectionVersion,strokes:[]})");
    await waitFor("finishTest.state.pending?.revealProgress===1");assert.equal(await js("Object.hasOwn(finishTest.requests.at(-1),'sourceInk')"),false);assert.ok(await js("!!finishTest.requests.at(-1).selectionContext"));await js("finishTest.rejectPending()");
    report.checks.push("Raster-only and masked lasso requests retain screenshot fallback");
    assert.deepEqual(report.errors,[]);report.request=request;report.status="passed";
  }catch(error){report.status="failed";report.error=error.stack;console.error(error);process.exitCode=1;}
  finally{fs.writeFileSync(path.join(output,"renderer-verification.json"),JSON.stringify(report,null,2)+"\n");win?.destroy();server?.closeAllConnections?.();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});console.log(JSON.stringify({status:report.status,checks:report.checks,output}));app.quit();}
});
