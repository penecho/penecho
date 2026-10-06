"use strict";
// Real Canvas UI and request payloads with deterministic question-only replies.
// Run with tools/electron/node_modules/.bin/electron; --cloud uses the official mirror.
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{Readable}=require("node:stream");
const root=path.resolve(__dirname,".."),cloud=process.argv.includes("--cloud"),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-practice-"));
const clientFile=cloud?path.resolve(root,"../penecho_cloud/public/canvas/app.js"):path.join(root,"public/app.js");
const output=path.resolve(process.argv.find(arg=>arg.startsWith("--output="))?.slice(9)||path.join(root,"docs/verification/suggest-practice-20261002",cloud?"cloud":"local"));
fs.mkdirSync(output,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([fs.readFileSync(clientFile,"utf8").replace(/\}\)\(\);\s*$/,`
    if(${cloud})Object.assign(window.PENECHO_CONFIG,{runtime:'cloud',connectionAccountId:'test-only',linkedDeviceId:'test-only',linkedDeviceOnline:true});
    window.practiceTest={state,smartSuggest,canvasDocumentsReady,loadCanvasSettings,loadHostedModels,settings,aiConnectionScope,storeAiConnectionSelection,stroke,save,render,smartSuggestCluster,smartSuggestDrawingStarted,smartSuggestDrawingFinished,runSmartSuggest,assistRefresh,hideAssist,captureSelection,cancelSelection,acceptPending,commands:[],requests:[],kind:'math_expr'};
    practiceTest.addFormula=()=>{
      const paths=[[[0,5],[25,45]],[[25,5],[0,45]],[[45,25],[75,25]],[[60,10],[60,40]],[[95,5],[120,5],[105,25],[120,25],[120,45],[95,45]],[[145,18],[175,18]],[[145,32],[175,32]],[[195,5],[225,5],[205,45]]];
      for(const points of paths){
        const samples=points.map(([x,y])=>({x:x+300,y:y+240})),drawing={start:samples[0],last:samples.at(-1),bbox:{x:300+Math.min(...points.map(p=>p[0])),y:240+Math.min(...points.map(p=>p[1])),w:Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])),h:Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]))},size:4,color:'#202938',samples:[]};
        state.drawing=drawing;smartSuggestDrawingStarted(drawing);
        for(let i=1;i<samples.length;i++)stroke(samples[i-1],samples[i],false,4,true,drawing.color);
        drawing.samples=samples.map(point=>({point,size:4}));state.drawing=null;save();smartSuggestDrawingFinished(drawing);
      }
      render();clearTimeout(smartSuggest.timer);clearTimeout(smartSuggest.localTimer);smartSuggest.timer=smartSuggest.localTimer=0;smartSuggest.inkReadyAt=0;assistRefresh('fixture');
    };
    const originalFetch=window.fetch;
    window.fetch=async(url,options)=>{
      const t=practiceTest,json=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
      if(url==='/api/v1/models')return json({accountId:'test-only',models:[],credits:{available:1}});
      if(String(url).endsWith('/suggest/status'))return json({configured:true,model:'PenEchoLLM'});
      if(String(url).endsWith('/suggest')){
        const request=JSON.parse(options.body);t.requests.push(request);
        const id=request.mode==='result'?'solve':'practice';
        return json({ok:true,model:'PenEchoLLM',answers:{kind:{type:'choice',choice:t.kind},action:{type:'choice',choice:id,confidence:.95,probabilities:{[id]:.95,none:.05}},execution_practice:{type:'choice',choice:'canvas_ai'}}});
      }
      if(url==='/api/ai/command'){
        t.commands.push(JSON.parse(options.body));
        return json({requestId:'practice-'+t.commands.length,commands:[{tool:'write_text',x:300,y:375,text:'练一题：求解 2x + 5 = 17。',fontSize:28,maxWidth:620,lineHeight:1.35}]});
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
      const deadline=Date.now()+15000;
      while(!await run(expression)){if(Date.now()>deadline)throw Error('Timed out: '+expression+' '+JSON.stringify(await run('({mode:practiceTest.smartSuggest.bar?.mode,status:practiceTest.state.statusKey,requests:practiceTest.requests.length,commands:practiceTest.commands.length})')));await new Promise(resolve=>setTimeout(resolve,50));}
    };
    const screenshot=async name=>{fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());};
    await run(`(async()=>{const t=practiceTest;await t.canvasDocumentsReady();await t.loadCanvasSettings();if(${cloud}){await t.loadHostedModels({accountChanged:true});t.settings.connections=[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',provider:'api',hasApiKey:true,apiUrl:'http://127.0.0.1:1/v1',apiModel:'test'}];t.settings.connectionScope=t.aiConnectionScope();}t.storeAiConnectionSelection(t.settings.connections[0].id);document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();Object.assign(t.state,{language:'zh',auto:false,scale:1,panX:0,panY:0,mode:'pen'});Object.assign(t.smartSuggest,{enabled:true,available:false});t.smartSuggestCluster();t.addFormula();t.smartSuggest.available=true;await t.runSmartSuggest();})()`);
    await wait("document.querySelector('.assist-bar > [data-suggestion=practice]') && Number(getComputedStyle(document.querySelector('.assist-bar')).opacity)>.99");
    assert.equal(await run("document.querySelector('[data-suggestion=practice]').textContent.includes('练一题')"),true);
    await screenshot("practice-suggestion");
    await run("document.querySelector('.assist-bar > [data-suggestion=practice]').click()");
    await wait("practiceTest.commands.length===1 && practiceTest.smartSuggest.bar?.mode==='result' && !practiceTest.smartSuggest.bar.view?.items.length");
    await run("practiceTest.smartSuggest.lastKey='';practiceTest.runSmartSuggest()");
    assert.equal(await run("practiceTest.requests.some(r=>r.mode==='result' && r.context.previousAction==='practice')"),true);
    assert.equal(await run("practiceTest.commands[0].suggestion"),"practice");
    assert.equal(await run("practiceTest.commands[0].userAction"),"answer");
    assert.equal(await run("document.querySelectorAll('.assist-bar [data-suggestion=solve],.assist-bar [data-suggestion=answer]').length"),0);
    await screenshot("practice-question-preview");
    await run("practiceTest.acceptPending()");
    await wait("!practiceTest.state.activeAI && !practiceTest.state.pending && practiceTest.state.dirty===null");
    assert.equal(await run("document.querySelector('.assist-bar').classList.contains('visible')"),false);
    assert.equal(await run("practiceTest.state.dirtyInkTiles.size"),0);
    await screenshot("practice-question-kept");
    report.checks.push("Formula ranks Practice, click sends practice focus, question-only preview retains Keep/Retry, and Keep consumes input without offering Solve or dirtying the question");
    await run("practiceTest.captureSelection([{x:280,y:220},{x:550,y:220},{x:550,y:310},{x:280,y:310},{x:280,y:220}]);practiceTest.smartSuggest.lastKey='';practiceTest.runSmartSuggest()");
    await wait("document.querySelector('.assist-bar > [data-suggestion=practice]')");
    await run("document.querySelector('.assist-bar > [data-suggestion=practice]').click()");
    await wait("practiceTest.commands.length===2 && practiceTest.smartSuggest.bar?.mode==='result'");
    assert.equal(await run("practiceTest.commands[1].suggestion"),"practice");
    assert.ok(await run("!!practiceTest.commands[1].selectionContext"));
    await run("practiceTest.acceptPending()");
    await wait("!practiceTest.state.activeAI && !practiceTest.state.pending");
    report.checks.push("Lasso Practice preserves the masked selection in the request");
    await run("practiceTest.cancelSelection();practiceTest.kind='notes';practiceTest.addFormula();practiceTest.smartSuggest.lastKey='';practiceTest.runSmartSuggest()");
    await wait("document.querySelector('.assist-bar > [data-suggestion=practice]')");
    report.checks.push("A model-ranked learning-notes Practice action remains usable after fresh input");
    assert.deepEqual(report.errors,[]);
    report.requests=await run("practiceTest.requests.map(r=>({mode:r.mode,context:r.context}))");
    report.commands=await run("practiceTest.commands.map(r=>({suggestion:r.suggestion,userAction:r.userAction,selection:!!r.selectionContext}))");
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({output,...report}));
  }finally{
    win?.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temporary,{recursive:true,force:true});
  }
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
