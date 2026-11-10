"use strict";
// Isolated real Canvas rendering and button requests with deterministic model replies.
// Run with tools/electron/node_modules/.bin/electron.
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{Readable}=require("node:stream"),{createHash}=require("node:crypto");
const root=path.resolve(__dirname,".."),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-suggest-answer-"));
const cloud=process.argv.includes("--cloud"),clientFile=cloud?path.resolve(root,"../penecho_cloud/public/canvas/app.js"):path.join(root,"public/app.js");
const directory=path.resolve(process.argv.find(arg=>arg.startsWith("--output="))?.slice(9)||temporary);
fs.mkdirSync(directory,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([fs.readFileSync(clientFile,"utf8").replace(/\}\)\(\);\s*$/,`
    if(${cloud})Object.assign(window.PENECHO_CONFIG,{runtime:'cloud',connectionAccountId:'test-only',linkedDeviceId:'test-only',linkedDeviceOnline:true});
    window.answerTest={state,smartSuggest,canvasDocumentsReady,loadCanvasSettings,loadHostedModels,settings,aiConnectionScope,storeAiConnectionSelection,stroke,save,render,smartSuggestCluster,smartSuggestDrawingStarted,smartSuggestDrawingFinished,runSmartSuggest,assistRefresh,hideAssist,captureSelection,cancelSelection,syncSelectionSuggestions,acceptPending,commands:[],requests:[],agentCalls:[],output:'empty'};
    assistAgentRun=async(id)=>{answerTest.agentCalls.push(id);return 'submitted';};
    answerTest.addInk=(x,y)=>{
      const drawing={start:{x,y},last:{x:x+100,y:y+55},bbox:{x,y,w:100,h:60},size:5,color:'#202938',samples:[]};
      state.drawing=drawing;smartSuggestDrawingStarted(drawing);
      const points=[{x,y},{x:x+35,y:y+60},{x:x+65,y:y+5},{x:x+100,y:y+55}];
      for(let i=1;i<points.length;i++)stroke(points[i-1],points[i],false,5,true,drawing.color);
      drawing.samples=points.map(point=>({point,size:5}));state.drawing=null;save();smartSuggestDrawingFinished(drawing);render();
      clearTimeout(smartSuggest.timer);clearTimeout(smartSuggest.localTimer);smartSuggest.timer=smartSuggest.localTimer=0;
      assistRefresh('test-ink');
    };
    const originalFetch=window.fetch;
    window.fetch=async(url,options)=>{
      const t=answerTest,json=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
      if(url==='/api/v1/models')return json({accountId:'test-only',models:[],credits:{available:1}});
      if(String(url).endsWith('/suggest/status'))return json({configured:true,model:'PenEchoLLM'});
      if(String(url).endsWith('/suggest')){
        const request=JSON.parse(options.body);t.requests.push(request);
        const probabilities=request.mode==='result'?{explain:.95,vivid:.04,none:.01}:t.answerPosition==='second'?{organize:.65,answer:.3,typeset:.05}:{answer:.9,typeset:.06,organize:.04};
        return json({ok:true,model:'PenEchoLLM',answers:{kind:{type:'choice',choice:'notes',probabilities:{notes:1}},action:{type:'choice',choice:request.mode==='result'?'explain':t.answerPosition==='second'?'organize':'answer',probabilities},execution_answer:{type:'choice',choice:'penecho_agent'},execution_explain:{type:'choice',choice:'canvas_ai'}}});
      }
      if(url==='/api/ai/command'){
        t.commands.push(JSON.parse(options.body));
        const widget={tool:'html_widget',pluginId:'general',x:520,y:360,w:360,h:240,title:'Completed answer',refreshSeconds:0,html:'<!doctype html><html><body style="margin:0;padding:24px;background:white;color:#202938;font:20px sans-serif"><h2>Canvas AI result</h2><p>x = t − 3</p></body></html>'};
        const ink={tool:'draw',origin:[350,540],types:['rect','ellipse'],items:[[0,0,240,90],[70,130,110,40]],width:5};
        return json({requestId:'answer-'+t.commands.length,commands:t.output==='widget'?[widget]:t.output==='ink'?[ink]:[]});
      }
      return originalFetch(url,options);
    };
  })();`)]);
  return readStream.call(this,file,...args);
};
let server,win;
const report={runtime:cloud?"cloud":"local",clientFile,checks:[],errors:[]};
app.whenReady().then(async()=>{
  try{
    server=require("../server.js");server.prependListener("request",req=>{if(cloud&&req.url.startsWith("/canvas/"))req.url=req.url.slice("/canvas".length);});
    await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
    win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    win.webContents.on("console-message",(_event,level,message)=>{if(level>=3)report.errors.push(message);});
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const run=code=>win.webContents.executeJavaScript(code),wait=async expression=>{
      const until=Date.now()+15000;
      while(!await run(expression)){if(Date.now()>until)throw Error('Timed out: '+expression+' '+JSON.stringify(await run('({mode:answerTest.smartSuggest.bar?.mode,status:answerTest.state.statusKey,commands:answerTest.commands.length,requests:answerTest.requests.length})')));await new Promise(resolve=>setTimeout(resolve,50));}
    };
    const buttons=()=>run("[...document.querySelectorAll('.assist-bar > [data-suggestion]')].map(b=>b.dataset.suggestion)");
    const screenshot=async name=>{await wait("Number(getComputedStyle(document.querySelector('.assist-bar')).opacity)>.99");fs.writeFileSync(path.join(directory,name+'.png'),(await win.webContents.capturePage()).toPNG());};
    await run(`(async()=>{const t=answerTest,s=t.state;await t.canvasDocumentsReady();await t.loadCanvasSettings();if(window.PENECHO_CONFIG.runtime==='cloud'){await t.loadHostedModels({accountChanged:true});t.settings.connections=[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',provider:'api',hasApiKey:true,apiUrl:'http://127.0.0.1:1/v1',apiModel:'test'}];t.settings.connectionScope=t.aiConnectionScope();}t.storeAiConnectionSelection(t.settings.connections[0].id);document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();s.language='en';s.auto=false;s.scale=1;s.panX=0;s.panY=0;s.mode='pen';t.smartSuggest.enabled=true;t.smartSuggest.available=false;t.smartSuggestCluster();t.smartSuggest.cooldown.answer={count:2,until:performance.now()+45000};t.addInk(300,210);})()`);
    report.localButtons=await buttons();assert.equal(report.localButtons.length,3);assert.equal(report.localButtons[2],"answer");
    await screenshot("local-suggest");
    await run("(async()=>{answerTest.smartSuggest.available=true;answerTest.smartSuggest.inkReadyAt=0;await answerTest.runSmartSuggest();})()");
    report.rankedButtons=await buttons();assert.equal(report.rankedButtons.length,3);assert.equal(report.rankedButtons[2],"answer");
    await run("delete answerTest.smartSuggest.cooldown.answer;answerTest.smartSuggest.lastKey='';answerTest.smartSuggest.inkReadyAt=0;answerTest.runSmartSuggest()");
    report.promotedButtons=await buttons();assert.equal(report.promotedButtons[0],"answer");
    assert.equal(await run("answerTest.smartSuggest.bar.view.more.some(item=>item.id==='answer')"),false);
    await screenshot("ranked-suggest");
    await run("answerTest.answerPosition='second';answerTest.smartSuggest.lastKey='';answerTest.runSmartSuggest()");
    report.secondButtons=await buttons();assert.deepEqual(report.secondButtons.slice(0,2),["organize","answer"]);
    await screenshot("ranked-answer-second");
    report.checks.push("Local and cooled suggestions keep one Answer in third place; model-ranked Answer retains first or second place when available");
    await run("document.querySelector('.assist-bar [data-suggestion=answer]').click()");
    await wait("answerTest.commands.length===1 && !answerTest.state.activeAI && !answerTest.state.busy");
    await run("document.querySelector('#aiToolbarRun').click()");
    await wait("answerTest.commands.length===2 && !answerTest.state.activeAI && !answerTest.state.busy");
    const inkRequests=await run("answerTest.commands.slice(0,2)");assert.deepEqual(inkRequests[0],inkRequests[1]);assert.equal(inkRequests[0].userAction,"auto");assert.equal(inkRequests[0].suggestion,undefined);
    report.checks.push("Answer and the visible manual Canvas AI button send identical complete requests, including viewport pixels and action");
    await run("answerTest.smartSuggest.enabled=false;answerTest.hideAssist('selection-test');answerTest.captureSelection([{x:280,y:190},{x:420,y:190},{x:420,y:290},{x:280,y:290},{x:280,y:190}]);answerTest.syncSelectionSuggestions();answerTest.assistRefresh('selection-test')");
    assert.deepEqual(await buttons(),["typeset","answer"]);await screenshot("selection-suggest");
    await run("document.querySelector('.assist-bar [data-suggestion=answer]').click()");
    await wait("answerTest.commands.length===3 && !answerTest.state.activeAI && !answerTest.state.busy");
    await run("document.querySelector('#aiToolbarRun').click()");
    await wait("answerTest.commands.length===4 && !answerTest.state.activeAI && !answerTest.state.busy");
    const selectionRequests=await run("answerTest.commands.slice(2,4)");assert.deepEqual(selectionRequests[0],selectionRequests[1]);assert.equal(selectionRequests[0].userAction,"auto");
    report.checks.push("With automatic suggestions off, the two-action selection bar puts Answer last and matches manual selection requests");
    await run("answerTest.cancelSelection();answerTest.smartSuggest.enabled=true;answerTest.smartSuggest.available=true;answerTest.output='widget';answerTest.assistRefresh('widget-test');document.querySelector('.assist-bar [data-suggestion=answer]').click()");
    await wait("answerTest.smartSuggest.bar?.mode==='followup' && answerTest.smartSuggest.bar.view?.source==='penecho-llm' && answerTest.smartSuggest.status?.key===answerTest.smartSuggest.bar.cluster?.key && answerTest.smartSuggest.status?.state==='ranked' && !answerTest.state.activeAI");
    assert.deepEqual(await buttons(),["explain"]);assert.equal(await run("answerTest.state.dirty"),null);assert.equal(await run("answerTest.state.dirtyInkTiles.size"),0);await screenshot("widget-next");
    report.checks.push("Committed Widget output stays clean and its Next bar contains only classified follow-up actions");
    await run("answerTest.smartSuggest.available=false;answerTest.output='ink';answerTest.addInk(300,460);answerTest.smartSuggest.available=true;document.querySelector('.assist-bar [data-suggestion=answer]').click()");
    await wait("answerTest.smartSuggest.bar?.mode==='result' && answerTest.smartSuggest.bar.view?.source==='penecho-llm' && answerTest.smartSuggest.status?.key===answerTest.smartSuggest.bar.cluster?.key && answerTest.smartSuggest.status?.state==='ranked'");
    assert.equal(await run("document.querySelectorAll('.assist-bar [data-suggestion=answer]').length"),0);
    await run("answerTest.acceptPending()");
    await wait("answerTest.smartSuggest.bar?.mode==='followup' && !answerTest.state.activeAI");
    assert.deepEqual(await buttons(),["explain"]);assert.equal(await run("answerTest.state.dirty"),null);assert.equal(await run("answerTest.state.dirtyInkTiles.size"),0);await screenshot("ink-next");
    report.checks.push("Native ink previews and accepted Next suggestions omit the manual shortcut and leave no dirty output");
    assert.deepEqual(await run("answerTest.agentCalls"),[]);assert.deepEqual(report.errors,[]);
    const summarize=body=>({userAction:body.userAction,trigger:body.trigger,sourceRect:body.sourceRect,changedBox:body.changedBox,atlasSha256:createHash("sha256").update(body.atlasImage).digest("hex")});
    report.manualInk=summarize(inkRequests[0]);report.manualSelection=summarize(selectionRequests[0]);
    fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}));
  }finally{
    win?.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));
    if(directory!==temporary)fs.rmSync(temporary,{recursive:true,force:true});
  }
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
