"use strict";
// Isolated full graph iframe -> Widget host -> Canvas regression. No model calls
// or user storage. Serve canonical compiled source in memory without rebuilding.
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{Readable}=require("node:stream");
const root=path.resolve(__dirname,".."),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-graph-history-")),
  output=path.resolve(process.argv.find(arg=>arg.startsWith("--output="))?.slice(9)||temporary),report={checks:[],errors:[],canonicalSource:true};
fs.mkdirSync(output,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const compiled=require("./build-client.js").compiledSource().replace(/\}\)\(\);\s*$/,`
  window.graphHistoryTest={state,tiles,stroke,save,undo,redo,recordWidgetsBefore,restoreWidgets,serializedWidgets,enterWidgetInteraction,canvasDocumentsReady,saveSnapshot,readDeviceSnapshot,serverSnapshotPayload,render};
})();`),readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){return path.resolve(String(file))===path.join(root,"public/app.js")?Readable.from([compiled]):readStream.call(this,file,...args);};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let server,win;
app.whenReady().then(async()=>{
  try {
    server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
    win=new BrowserWindow({show:false,width:1300,height:950,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    win.webContents.on("console-message",event=>{if(event.level==="error"&&!event.message.includes("ResizeObserver loop"))report.errors.push(event.message);});
    const js=code=>win.webContents.executeJavaScript(code,true),until=async(expression,label)=>{
      const deadline=Date.now()+15000;while(!await js(expression)){if(Date.now()>deadline)throw Error(`Timed out: ${label}`);await pause(30);}
    },graphFrame=async()=>{
      const deadline=Date.now()+15000;
      while(Date.now()<deadline){
        for(const frame of win.webContents.mainFrame.framesInSubtree.filter(frame=>frame.url==="about:srcdoc")){
          if(await frame.executeJavaScript("!!document.getElementById('parameter-a')"))return frame;
        }
        await pause(30);
      }
      throw Error("Timed out: inner graph frame");
    };
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);await until("!!window.graphHistoryTest","app startup");
    await js("graphHistoryTest.canvasDocumentsReady().then(()=>true)");
    const old=fs.readFileSync(path.join(root,"test/fixtures/graph-v2-before-interactions.html"),"utf8"),other='<!doctype html><p>Older AI result</p>';
    await js(`(()=>{const t=graphHistoryTest,s=t.state;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();s.auto=false;s.language='en';s.scale=1;s.panX=0;s.panY=0;s.history=[];s.future=[];
      t.stroke({x:40,y:75},{x:220,y:75},false,5,false,'#2563eb');s.userRevision++;t.save();
      t.recordWidgetsBefore();t.restoreWidgets(${JSON.stringify([{id:"widget-1",pluginId:"general",widgetType:"html_widget",title:"Saved graph",x:240,y:140,w:900,h:600,contentW:900,contentH:600,refreshSeconds:0,html:old,copyText:"y=a*x\na=2"},{id:"widget-2",pluginId:"general",widgetType:"html_widget",title:"Older AI",x:40,y:180,w:300,h:200,contentW:300,contentH:200,refreshSeconds:0,html:other}])});s.userRevision++;t.save();t.enterWidgetInteraction(s.widgets[0]);t.render();})()`);
    await until("graphHistoryTest.state.widgets[0].hostReady&&graphHistoryTest.state.widgets[0].initialized&&graphHistoryTest.state.widgets[0].contentVersion>0","graph host");
    let frame=await graphFrame();assert.ok(frame,"inner graph frame");
    assert.equal(await frame.executeJavaScript("!!document.getElementById('parameter-a')"),true);
    assert.equal(await js("graphHistoryTest.state.widgets[0].html.includes('interactionSequence')"),true,"saved v2 upgraded on actual restore path");
    const read=()=>js("(()=>{const t=graphHistoryTest,w=t.state.widgets[0];return {history:t.state.history.length,future:t.state.future.length,data:PENECHO_SMART_SUGGEST.graphDocumentData(w.html).data,transaction:w.graphHistoryInteraction?.id||null,ink:t.tiles.size,other:t.state.widgets[1]?.html};})()"),
      wheel=async(count)=>frame.executeJavaScript(`(()=>{const c=document.getElementById('c'),r=c.getBoundingClientRect();for(let i=0;i<${count};i++)c.dispatchEvent(new WheelEvent('wheel',{deltaY:2,clientX:r.x+r.width/2,clientY:r.y+r.height/2,bubbles:true,cancelable:true}));return true;})()`);
    await wheel(140);await until("graphHistoryTest.state.history.length===3","first wheel burst");await pause(230);
    let value=await read();assert.equal(value.history,3);assert.equal(value.transaction,null);assert.ok(value.data.window2[1]-value.data.window2[0]>10);assert.ok(value.ink>0);assert.equal(value.other,other);
    report.checks.push({name:"140 saved-v2 wheel ticks retain older ink/AI history in one entry",...value});
    const firstWindow=value.data.window2;await wheel(80);await pause(230);value=await read();assert.equal(value.history,4);
    await js("graphHistoryTest.undo()");value=await read();assert.deepEqual(value.data.window2,firstWindow);assert.equal(value.history,3);assert.equal(value.future,1);
    await js("graphHistoryTest.redo();graphHistoryTest.enterWidgetInteraction(graphHistoryTest.state.widgets[0]);graphHistoryTest.render()");
    await until("graphHistoryTest.state.widgets[0].hostReady&&graphHistoryTest.state.widgets[0].initialized&&graphHistoryTest.state.widgets[0].contentVersion>0","redone graph host");frame=await graphFrame();
    report.checks.push({name:"separate wheel burst has separate Undo/Redo",...(await read())});
    await frame.executeJavaScript("(()=>{const r=document.getElementById('parameter-a');r.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,bubbles:true}));for(let i=0;i<120;i++){r.value=2+i/100;r.dispatchEvent(new InputEvent('input',{bubbles:true}));}return true;})()");
    await until("PENECHO_SMART_SUGGEST.graphDocumentData(graphHistoryTest.state.widgets[0].html).data.parameters.a>3","live slider update");
    value=await read();assert.equal(value.history,5);assert.equal(value.data.parameters.a,3.2);assert.ok(value.transaction);
    const persisted=await js("(async()=>{const t=graphHistoryTest,id=await t.saveSnapshot({name:'Graph during slider drag',location:'device'}),saved=await t.readDeviceSnapshot(id),bundle=await t.serverSnapshotPayload(saved.item,saved.tileEntries),asset=bundle.assets.find(a=>a.kind==='widget'&&a.metadata.widgetId===saved.item.widgets[0].id),widget=asset?JSON.parse(atob(asset.dataBase64)):null;if(!widget)throw Error(JSON.stringify(bundle.assets.map(a=>({kind:a.kind,metadata:a.metadata}))));return {saved:PENECHO_SMART_SUGGEST.graphDocumentData(saved.item.widgets[0].html).data.parameters.a,exported:PENECHO_SMART_SUGGEST.graphDocumentData(widget.html).data.parameters.a,history:t.state.history.length};})()");
    assert.equal(persisted.saved,3.2);assert.equal(persisted.exported,3.2);assert.equal(persisted.history,5);report.checks.push({name:"device save and exported bundle include live drag state",...persisted});
    await frame.executeJavaScript("(()=>{const r=document.getElementById('parameter-a');r.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,bubbles:true}));r.value=3.75;r.dispatchEvent(new InputEvent('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
    await pause(80);value=await read();assert.equal(value.history,5);assert.equal(value.data.parameters.a,3.75);assert.equal(value.transaction,null);
    report.checks.push({name:"final input after pointerup stays in same drag entry",...value});
    await frame.executeJavaScript("(()=>{const r=document.getElementById('parameter-a');r.dispatchEvent(new PointerEvent('pointerdown',{pointerId:2,bubbles:true}));r.value=4;r.dispatchEvent(new InputEvent('input',{bubbles:true}));r.dispatchEvent(new PointerEvent('pointercancel',{pointerId:2,bubbles:true}));return true;})()");
    await pause(60);value=await read();assert.equal(value.history,6);assert.equal(value.data.parameters.a,4);assert.equal(value.transaction,null);
    await js("graphHistoryTest.undo()");value=await read();assert.equal(value.data.parameters.a,3.75);assert.equal(value.history,5);report.checks.push({name:"cancel keeps final value and closes a separate reversible range interaction",...value});
    await js("graphHistoryTest.redo();graphHistoryTest.enterWidgetInteraction(graphHistoryTest.state.widgets[0]);graphHistoryTest.render()");
    await until("graphHistoryTest.state.widgets[0].hostReady&&graphHistoryTest.state.widgets[0].initialized&&graphHistoryTest.state.widgets[0].contentVersion>0","keyboard graph host");frame=await graphFrame();
    await frame.executeJavaScript("(()=>{const r=document.getElementById('parameter-a');r.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));for(let i=0;i<12;i++){r.value=4+i/40;r.dispatchEvent(new InputEvent('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}));}r.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight',bubbles:true}));return true;})()");
    await pause(70);value=await read();assert.equal(value.history,7);assert.equal(value.transaction,null);report.checks.push({name:"keyboard key repeats share one reversible parameter interaction",...value});
    fs.writeFileSync(path.join(output,"graph.png"),(await win.webContents.capturePage()).toPNG());
    assert.deepEqual(report.errors,[]);fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({output,checks:report.checks.length,errors:report.errors}));
  } finally {
    win?.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));
    if(output!==temporary)fs.rmSync(temporary,{recursive:true,force:true});
  }
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
