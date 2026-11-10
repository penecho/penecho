"use strict";
// Real Canvas rendering and request lifecycle, with deterministic model responses.
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{Readable}=require("node:stream"),sharp=require("sharp");
const root=path.resolve(__dirname,".."),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-result-suggestions-"));
const cloud=process.argv.includes("--cloud"),clientFile=cloud?path.resolve(root,"../penecho_cloud/public/canvas/app.js"):path.join(root,"public/app.js");
const directory=path.resolve(process.argv.find(arg=>arg.startsWith("--output="))?.slice(9)||temporary);
fs.mkdirSync(directory,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([fs.readFileSync(clientFile,"utf8").replace(/\}\)\(\);\s*$/,`
    if(${cloud})Object.assign(window.PENECHO_CONFIG,{runtime:'cloud',connectionAccountId:'test-only',linkedDeviceId:'test-only',linkedDeviceOnline:true});
    window.resultTest={state,smartSuggest,canvasDocumentsReady,loadCanvasSettings,loadHostedModels,settings,aiConnectionScope,storeAiConnectionSelection,stroke,save,render,executeAssistAction,requestAI,smartSuggestCluster,smartSuggestCropRegion,smartSuggestCrop,smartSuggestEncodeImage,runSmartSuggest,assistRefresh,acceptPending,acceptPendingWidget,rejectPending,hideAssist,undo,commands:[],requests:[],hold:false,release:null,none:false,low:false,erase:false};
    const originalFetch=window.fetch;
    window.fetch=async(url,options)=>{
      const t=resultTest;
      if(url==='/api/v1/models')return new Response(JSON.stringify({accountId:'test-only',models:[],credits:{available:1}}),{status:200,headers:{'Content-Type':'application/json'}});
      if(String(url).endsWith('/suggest/status'))return new Response(JSON.stringify({configured:true,model:'PenEchoLLM'}),{status:200,headers:{'Content-Type':'application/json'}});
      if(url===${JSON.stringify(cloud?"/api/v1/apps/penecho-llm/suggest":"/api/suggest")}){
        t.requests.push(JSON.parse(options.body));
        if(t.hold)await new Promise(resolve=>{t.release=resolve;});
        if(t.low)return new Response(JSON.stringify({ok:true,model:'PenEchoLLM',answers:{kind:{type:'choice',choice:'notes',probabilities:{notes:.6355689167976379,deletion:.34381452202796936,none:.0206165611743927}},action:{type:'choice',choice:'typeset',confidence:.7092000075748989,probabilities:{typeset:.7285866737365723,none:.20672182738780975,finish_drawing:.06469149887561795}}}}),{status:200,headers:{'Content-Type':'application/json'}});
        const pick=t.none?'none':'explain';
        return new Response(JSON.stringify({ok:true,model:'PenEchoLLM',answers:{kind:{type:'choice',choice:'drawing',probabilities:{drawing:1}},action:{type:'choice',choice:pick,probabilities:{[pick]:.95,finish_drawing:.01,vivid:.04}},execution_explain:{type:'choice',choice:'canvas_ai'}}}),{status:200,headers:{'Content-Type':'application/json'}});
      }
      if(url==='/api/ai/command'){
        t.commands.push(JSON.parse(options.body));
        const widget={tool:'html_widget',pluginId:'general',x:500,y:350,w:360,h:300,title:'Result test',refreshSeconds:0,
          html:'<!doctype html><html><body style="margin:0;background:white"><svg width="100%" height="100%" viewBox="0 0 360 300" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="340" height="130" fill="#e02020"/><rect x="10" y="220" width="340" height="70" fill="#2020e0"/></svg></body></html>'};
        const native={tool:'draw',origin:[1700,900],types:['rect','ellipse'],items:[[0,0,260,120],[130,180,120,40]],width:6};
        return new Response(JSON.stringify({requestId:'result-'+t.commands.length,commands:t.erase?[{tool:'erase',mode:'rect',x:200,y:200,w:280,h:160}]:t.commands.length===1?[widget]:t.commands.length===2?[]:[native]}),{status:200,headers:{'Content-Type':'application/json'}});
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
    server=require("../server.js");server.prependListener("request",req=>{if(cloud&&req.url.startsWith("/canvas/"))req.url=req.url.slice("/canvas".length);});await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
    win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    win.webContents.on("console-message",(_event,level,message)=>{if(level>=3)report.errors.push(message);});
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const run=code=>win.webContents.executeJavaScript(code),wait=async expression=>{
      const until=Date.now()+15000;
      while(!await run(expression)){if(Date.now()>until)throw Error('Timed out: '+expression+' '+JSON.stringify(await run('({mode:resultTest.smartSuggest.bar?.mode,status:resultTest.state.statusKey,rank:resultTest.smartSuggest.status,requests:resultTest.requests.length,commands:resultTest.commands.length,pending:!!resultTest.state.pending,pendingWidget:!!resultTest.state.pendingWidget})')));await new Promise(resolve=>setTimeout(resolve,80));}
    };
    await run(`(async()=>{const t=resultTest,s=t.state;await t.canvasDocumentsReady();await t.loadCanvasSettings();if(window.PENECHO_CONFIG.runtime==='cloud'){await t.loadHostedModels({accountChanged:true});t.settings.connections=[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',provider:'api',hasApiKey:true,apiUrl:'http://127.0.0.1:1/v1',apiModel:'test'}];t.settings.connectionScope=t.aiConnectionScope();}t.storeAiConnectionSelection(t.settings.connections[0].id);document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();s.auto=false;s.scale=1;s.panX=0;s.panY=0;s.mode='pen';t.smartSuggest.enabled=true;t.smartSuggest.available=true;await t.runSmartSuggest();t.stroke({x:100,y:100},{x:350,y:140},false,8,true,'#111111');t.save();t.stroke({x:870,y:430},{x:885,y:520},false,8,false,'#20b020');t.stroke({x:3000,y:3000},{x:3100,y:3100},false,10,false,'#e020e0');t.executeAssistAction({id:'vivid'},{box:{...s.dirty},newBox:{...s.dirty},strokes:[]});})()`);
    await wait("resultTest.smartSuggest.bar?.mode==='followup' && resultTest.smartSuggest.status?.state==='ranked'");
    const first=await run("({request:resultTest.requests.at(-1),region:resultTest.smartSuggestCropRegion(resultTest.smartSuggestCluster()),dirty:resultTest.state.dirty,buttons:[...document.querySelectorAll('.assist-bar [data-suggestion]')].map(b=>b.dataset.suggestion)})");
    assert.equal(first.request.mode,"result");assert.deepEqual(first.request.context,{previousAction:"vivid"});assert.deepEqual(first.buttons,["explain"]);assert.equal(first.dirty,null);
    async function inspect(image,name){
      const bytes=Buffer.from(image.split(',')[1],'base64');fs.writeFileSync(path.join(directory,name+'.webp'),bytes);
      const {data,info}=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});let red=0,blue=0,green=0,magenta=0;
      for(let i=0;i<data.length;i+=info.channels){const [r,g,b]=data.subarray(i,i+3);if(r>g+40&&r>b+40)red++;if(b>r+40&&b>g+40)blue++;if(g>r+30&&g>b+30)green++;if(r>g+40&&b>g+40)magenta++;}
      assert.ok(Math.max(info.width,info.height)<=512);assert.ok(image.length<=256*1024);
      return {width:info.width,height:info.height,imageBytes:bytes.length,dataUrlChars:image.length,red,blue,green,magenta};
    }
    const noisy=await run(`(()=>{const c=document.createElement('canvas');c.width=2000;c.height=1500;const ctx=c.getContext('2d'),p=ctx.createImageData(c.width,c.height);let n=7;for(let i=0;i<p.data.length;i+=4){for(let j=0;j<3;j++){n=(Math.imul(n,1664525)+1013904223)>>>0;p.data[i+j]=n>>>24;}p.data[i+3]=255;}ctx.putImageData(p,0,0);return resultTest.smartSuggestEncodeImage(c);})()`);
    report.imageBudget=await inspect(noisy,"image-budget");
    report.preview=await inspect(first.request.image,"preview");
    assert.ok(report.preview.red>100&&report.preview.blue>100&&report.preview.green>10);assert.equal(report.preview.magenta,0);
    report.checks.push("Widget ranking sees the complete result and nearby context, excludes distant content, and respects image budgets");
    await run("document.querySelector('.assist-bar [data-suggestion=explain]').click()");
    await wait("resultTest.commands.length===2 && !resultTest.state.activeAI && !resultTest.state.busy");
    const follow=await run("({command:resultTest.commands[1],dirty:resultTest.state.dirty})"),b=follow.command.changedBox;
    assert.ok(b.x<=500&&b.y<=350&&b.x+b.w>=860&&b.y+b.h>=650);assert.equal(follow.dirty,null);
    report.checks.push("Clicking a new action includes the committed widget result while keeping dirty state empty");
    await run("resultTest.hideAssist('test');resultTest.hold=true;void resultTest.requestAI('answer',null,{attentionBox:{x:1600,y:900,w:200,h:100}})");
    await wait("!!resultTest.release && !!resultTest.state.pending");
    const native=await run("({request:resultTest.requests.at(-1),region:resultTest.smartSuggestCropRegion(resultTest.smartSuggestCluster()),dirty:resultTest.state.dirty})");
    assert.equal(native.request.mode,"result");assert.ok(native.region.x+native.region.w>1900);assert.ok(native.region.w<700);assert.equal(native.dirty,null);
    report.native=await inspect(native.request.image,"native");
    const firstKey=await run("resultTest.smartSuggestCluster().key");
    await run("for(const item of resultTest.state.pending.items){item.x+=100;item.scaleX*=1.2;}resultTest.render();void resultTest.smartSuggestCluster()");
    assert.notEqual(await run("resultTest.smartSuggestCluster().key"),firstKey);
    await run("resultTest.rejectPending();resultTest.hold=false;resultTest.release();resultTest.release=null");
    await wait("!resultTest.state.activeAI && !resultTest.state.pending && !resultTest.smartSuggest.bar");
    report.checks.push("Ordinary Canvas requests also rank new native output beyond the viewport; rejection discards late suggestions");
    await run("resultTest.none=true;void resultTest.requestAI('answer',null,{attentionBox:{x:1600,y:900,w:200,h:100}})");
    await wait("resultTest.smartSuggest.bar?.mode==='result' && resultTest.smartSuggest.bar?.view?.source==='penecho-llm'");
    assert.equal(await run("document.querySelectorAll('.assist-bar [data-suggestion]').length"),0);
    const beforeKeep=await run("resultTest.requests.length");
    await run("resultTest.acceptPending()");
    await wait("resultTest.smartSuggest.bar?.mode==='followup' && !resultTest.state.activeAI");
    assert.equal(await run("document.querySelector('#smartSuggestLayer').hidden"),true,"none hides the entire Next bar");
    assert.equal(await run("document.querySelector('.assist-bar').textContent"),"");
    assert.equal(await run("resultTest.state.dirty"),null);
    assert.equal(await run("resultTest.requests.length"),beforeKeep,"Keep reuses the verdict for unchanged pixels");
    await run("resultTest.undo()");
    await wait("!resultTest.smartSuggest.bar");
    report.checks.push("None produces no forced next action, Keep preserves clean state, and Undo removes stale result suggestions");
    await run("resultTest.rejectPending();resultTest.none=false;void resultTest.requestAI('answer',null,{attentionBox:{x:600,y:550,w:200,h:100}})");
    await wait("resultTest.smartSuggest.bar?.mode==='result' && resultTest.smartSuggest.bar?.view?.source==='penecho-llm'");
    fs.writeFileSync(path.join(directory,"canvas.png"),(await win.webContents.capturePage()).toPNG());
    await run("resultTest.acceptPending()");
    await wait("resultTest.smartSuggest.bar?.mode==='followup' && !resultTest.state.activeAI");
    assert.equal(await run("document.querySelector('#smartSuggestLayer').hidden"),false,"a confident Next action appears");
    await run("resultTest.smartSuggest.bar.hovered=true;resultTest.smartSuggest.jev.answers.action={type:'choice',choice:'typeset',confidence:.7092000075748989,probabilities:{typeset:.7285866737365723,none:.20672182738780975}};resultTest.assistRefresh('penecho-llm')");
    assert.equal(await run("document.querySelector('#smartSuggestLayer').hidden"),true,"low confidence removes stale actions even while hovered");
    report.checks.push("Only confident Next actions appear; low confidence hides all controls even under the pointer");
    await run("resultTest.hideAssist('test');resultTest.low=true;resultTest.erase=true;resultTest.hold=true;resultTest.stroke({x:180,y:230},{x:500,y:230},false,5,true,'#111111');resultTest.save();void resultTest.requestAI('answer',null,{suggestion:'delete',attentionBox:{x:180,y:200,w:320,h:160}})");
    await wait("resultTest.smartSuggest.bar?.mode==='result' && !!resultTest.state.pending");
    const beforeDeleteKeep=await run("resultTest.requests.length");
    assert.equal(await run("resultTest.smartSuggestCluster()"),null,"no result ranking of red erasure masks");
    assert.equal(await run("document.querySelectorAll('.assist-bar .assist-spark, .assist-bar [data-suggestion]').length"),0);
    await run("resultTest.acceptPending()");
    await wait("resultTest.smartSuggest.bar?.mode==='followup' && !!resultTest.release && !resultTest.state.activeAI");
    assert.equal(await run("document.querySelector('#smartSuggestLayer').hidden"),true,"pending classification has no Next placeholder");
    await run("resultTest.hold=false;resultTest.release();resultTest.release=null");
    await wait("resultTest.smartSuggest.status?.state==='ranked'");
    assert.equal(await run("resultTest.requests.length"),beforeDeleteKeep+1,"Keep classifies the committed erasure result");
    assert.equal(await run("resultTest.requests.at(-1).context.previousAction"),"delete");
    assert.equal(await run("document.querySelector('#smartSuggestLayer').hidden"),true,"the reported 70.92% confidence does not show Next");
    assert.equal(await run("document.querySelector('.assist-bar').textContent"),"");
    report.deleted=await inspect(await run("resultTest.requests.at(-1).image"),"deleted-result");
    fs.writeFileSync(path.join(directory,"next-hidden.png"),(await win.webContents.capturePage()).toPNG());
    await run("resultTest.undo()");
    await wait("!resultTest.smartSuggest.bar");
    report.checks.push("Deletion ranks actual committed pixels; pending and the observed 70.92% response show no Next bar, with Undo intact");
    assert.deepEqual(report.errors,[]);
    fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}));
  }catch(error){console.error(error);process.exitCode=1;}
  finally{win?.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));app.exit(process.exitCode||0);}
});
