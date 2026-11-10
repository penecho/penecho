"use strict";
// Replay real upstream answers for the exact synthetic images in the real UI.
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict"),{Readable}=require("node:stream");
const root=path.resolve(__dirname,".."),cloud=path.resolve(root,"../penecho_cloud/docs/verification/note-intent-20261003"),
  output=path.join(root,"docs/verification/note-classification-20261003"),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-note-classification-"));
fs.mkdirSync(output,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false"});
const readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([fs.readFileSync(file,"utf8").replace(/\}\)\(\);\s*$/,`
    window.noteClassificationTest={state,smartSuggest,canvasDocumentsReady,assistView,renderAssist,captureSelection,render,hideAssist,applyLanguage,smartSuggestCluster,syncSelectionSuggestions};
    hasSelectedAiConnection=()=>false;
  })();`)]);
  return readStream.call(this,file,...args);
};
const report={checkedAt:new Date().toISOString(),checks:[],errors:[]},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let server,win;
app.whenReady().then(async()=>{try{
  const cases=[];
  for(const group of ["final","holdout"]){const data=JSON.parse(fs.readFileSync(path.join(cloud,group,"report.json"),"utf8"));assert.equal(data.totals.completed,data.totals.planned);
    for(const sample of data.samples.filter(s=>s.mode==="selection")){assert.ok(sample.passed,sample.id);cases.push({...sample,dataUrl:"data:image/webp;base64,"+fs.readFileSync(path.join(cloud,group,sample.image)).toString("base64")});}}
  server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
  win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on("console-message",(_event,level,message)=>{if(level>=3)report.errors.push(message.replace(/data:image\/[^'"\s]+/g,"[synthetic image]"));});
  const js=code=>win.webContents.executeJavaScript(code,true);
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  await js(`(async()=>{const t=noteClassificationTest;await t.canvasDocumentsReady();t.state.auto=false;t.state.language='zh';t.applyLanguage();t.smartSuggest.available=false;t.state.scale=1;t.state.panX=0;t.state.panY=0;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();})()`);
  for(const sample of cases){
    await js(`(async()=>{const t=noteClassificationTest,s=t.state;t.hideAssist();s.selection=null;s.textBoxes=[];s.images=[];s.widgets=[];s.userRevision++;t.smartSuggest.strokes=[];t.smartSuggest.cooldown={};const url=${JSON.stringify(sample.dataUrl)},image=new Image();image.src=url;await image.decode();const blob=new Blob([Uint8Array.from(atob(url.split(',')[1]),c=>c.charCodeAt(0))],{type:'image/webp'});s.images=[{id:'synthetic-image',x:130,y:130,w:640,h:480,naturalW:640,naturalH:480,image,blob}];t.render();t.captureSelection([{x:140,y:140},{x:760,y:140},{x:760,y:600},{x:140,y:600}]);if(!s.selection)throw Error('Synthetic selection failed');t.syncSelectionSuggestions();const c=t.smartSuggestCluster();if(!c?.selection)throw Error('Selected cluster failed');t.smartSuggest.jev={key:c.key,selection:true,result:false,strokeIds:new Set(),answers:${JSON.stringify(sample.answers)}};const view=t.assistView(c);t.renderAssist({mode:'suggest',cluster:c,view,box:c.box});})()`);
    await js("window.PenEchoStudioNavigator?.updateDocument()");
    await pause(60);
    const state=await js(`(()=>{const e=document.querySelector('.assist-bar'),r=e.getBoundingClientRect(),t=noteClassificationTest;return {order:[...e.querySelectorAll(':scope > .assist-action')].map(b=>b.dataset.suggestion),viewOrder:t.smartSuggest.bar.view.items.map(i=>i.id),enabled:t.smartSuggest.enabled,notePriority:t.smartSuggest.bar.view.notePriority,source:t.smartSuggest.bar.view.source,left:r.left,right:r.right,width:innerWidth,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth};})()`);
    report.checks.push({id:sample.id,modelAction:sample.action,noteScopeProbability:sample.noteScopeProbability,noteTaskProbability:sample.noteTaskProbability,...state});
    assert.equal(state.order[0]==="note",sample.expected.noteFront,JSON.stringify(report.checks.at(-1)));if(sample.expected.action)assert.equal(state.order[0],sample.expected.action,sample.id);
    assert.ok(state.left>=-1&&state.right<=state.width+1);assert.ok(state.scrollWidth<=state.clientWidth+1);
    if(["selected-raster-en","selected-equation","selected-picture","holdout-explicit-organize","holdout-lecture-raster"].includes(sample.id))fs.writeFileSync(path.join(output,sample.id+".png"),(await win.webContents.capturePage()).toPNG());
  }
  assert.deepEqual(report.errors,[]);
}catch(error){report.failure=error.stack;process.exitCode=1;console.error(error);}finally{
  fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));if(win&&!win.isDestroyed())win.destroy();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode||0);
}});
