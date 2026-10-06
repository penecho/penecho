"use strict";
// Run canonical Canvas assets with isolated documents, server state and profile.
// Run: tools/electron/node_modules/.bin/electron scripts/verify-note-presentation.cjs
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict"),{Readable}=require("node:stream");
const root=path.resolve(__dirname,".."),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-note-presentation-")),
  directory=path.join(root,"docs/verification/note-presentation-20261003"),report={checks:[],samples:[],errors:[]};
fs.mkdirSync(directory,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),
  HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",
  PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([fs.readFileSync(file,"utf8").replace(/\}\)\(\);\s*$/,`
    window.notePresentationTest={state,canvasDocumentsReady,loadCanvasSettings,noteCardInsert,setCanvasMode,closeCanvasAgent,enterWidgetInteraction,setWidgetInteraction,setWidgetMaximized,serializedWidgets,render};
  })();`)]);
  return readStream.call(this,file,...args);
};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let i=0;i<120;i++){if(await check())return;await pause(100);}throw Error(`Timed out: ${label}`);}
let server,win;
app.whenReady().then(async()=>{try{
  server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
  win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  win.webContents.on("console-message",event=>{if(event.level==="error")report.errors.push(event.message);});
  const js=code=>win.webContents.executeJavaScript(code,true);
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);await until(()=>js("!!window.notePresentationTest"),"startup");
  await js(`(async()=>{const t=notePresentationTest;await t.canvasDocumentsReady();await t.loadCanvasSettings();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();t.closeCanvasAgent();t.state.auto=false;t.setCanvasMode('hand');})()`);
  const metrics=()=>js(`(()=>{const w=notePresentationTest.state.widgets.find(w=>w.maximized),s=w.shell,f=w.frame,t=w.presentationToolbar;return {
    zoom:w.presentationZoom,autoFit:w.presentationAutoFit,shell:s.getBoundingClientRect().toJSON(),frame:f.getBoundingClientRect().toJSON(),toolbar:t.getBoundingClientRect().toJSON(),
    scrollHeight:s.scrollHeight,clientHeight:s.clientHeight,scrollWidth:s.scrollWidth,clientWidth:s.clientWidth,
    contentW:w.contentW,contentH:w.contentH,label:w.presentationZoomControls.label.textContent,
    sameFrame:w.frame===w.testFrame,geometry:[w.w,w.h,w.contentW,w.contentH]};})()`);
  const contentFrame=async title=>{
    for(const frame of win.webContents.mainFrame.framesInSubtree.filter(f=>f.url==="about:srcdoc")){
      if(await frame.executeJavaScript(`document.querySelector('.nc')?.getAttribute('aria-label')===${JSON.stringify(title)}`))return frame;
    }
    throw Error(`Missing card document: ${title}`);
  };
  function fullCard(sample){
    assert.ok(sample.frame.y>=sample.toolbar.bottom-1,JSON.stringify(sample));
    assert.ok(sample.frame.bottom<=sample.shell.bottom+1,JSON.stringify(sample));
    assert.ok(sample.frame.x>=sample.shell.x-1&&sample.frame.right<=sample.shell.right+1,JSON.stringify(sample));
    assert.ok(sample.scrollHeight<=sample.clientHeight+1,JSON.stringify(sample));
    assert.ok(sample.scrollWidth<=sample.clientWidth+1,JSON.stringify(sample));
    assert.ok(Math.abs(sample.frame.height/sample.frame.width-sample.contentH/sample.contentW)<.01);
    assert.equal(sample.sameFrame,true);
  }
  for(const style of ["card","note"]){
    const title=style==="card"?"知识卡片 · 完整高度":"工作笔记 · 完整高度";
    await js(`(async()=>{const t=notePresentationTest;const w=await t.noteCardInsert(PENECHO_NOTE_CARD.normalize({title:${JSON.stringify(title)},style:${JSON.stringify(style)},styleChosen:true,blocks:Array.from({length:24},(_,i)=>({type:'markdown',text:'## '+(i+1)+' · 阅读内容\\n\\n正文保留独立滚动，卡片边界在默认缩放下完整显示。'}))}));w.testFrame=w.frame;})()`);
    await until(()=>js("notePresentationTest.state.widgets.at(-1).mcpDocumentLoaded"),"card load");
    const geometry=await js("(()=>{const w=notePresentationTest.state.widgets.at(-1);return [w.w,w.h,w.contentW,w.contentH]})()");
    await js("notePresentationTest.enterWidgetInteraction(notePresentationTest.state.widgets.at(-1))");await pause(250);
    for(const [name,width,height,zoom,canvasScale] of [["wide",1440,900,1,.05],["short",1440,500,1,4],["narrow",700,600,1,1],["mobile",390,844,1,1],["browser-zoom",1440,900,2,1]]){
      win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);
      await js(`notePresentationTest.state.scale=${canvasScale};notePresentationTest.render()`);await pause(250);
      const sample=await metrics();fullCard(sample);assert.deepEqual(sample.geometry,geometry);
      if(name==="wide"||name==="short")assert.ok(sample.zoom<50);
      const frame=await contentFrame(title),inside=await frame.executeJavaScript("(()=>{const b=document.querySelector('.nc-body'),f=document.querySelector('.nc-foot');return {height:innerHeight,bodyHeight:b.clientHeight,bodyScroll:b.scrollHeight,footerBottom:f.getBoundingClientRect().bottom}})()");
      assert.equal(inside.height,1200);assert.ok(inside.bodyScroll>inside.bodyHeight);assert.ok(inside.footerBottom<=1201);
      report.samples.push({style,name,...sample,inside});
      fs.writeFileSync(path.join(directory,`${style}-${name}.png`),(await win.webContents.capturePage()).toPNG());
    }
    win.setContentSize(1440,900);win.webContents.setZoomFactor(1);await pause(250);
    const fitted=await metrics();
    await js("notePresentationTest.state.widgets.at(-1).presentationZoomControls.zoomIn.click()");await pause(200);
    assert.ok((await metrics()).scrollHeight>(await metrics()).clientHeight);
    await js("notePresentationTest.state.widgets.at(-1).presentationZoomControls.zoomOut.click()");await pause(200);
    fullCard(await metrics());assert.ok(Math.abs((await metrics()).zoom-fitted.zoom)<1e-6);
    const frame=await contentFrame(title);await frame.executeJavaScript("document.querySelector('.nc-body').scrollTop=180");
    win.setContentSize(1440,500);await pause(250);
    assert.ok(await frame.executeJavaScript("document.querySelector('.nc-body').scrollTop>=179"));fullCard(await metrics());
    await js("(()=>{const t=notePresentationTest,w=t.state.widgets.at(-1);t.setWidgetMaximized(w,false);t.setWidgetMaximized(w,true)})()");await pause(200);fullCard(await metrics());
    assert.deepEqual((await metrics()).geometry,geometry);
    await js("notePresentationTest.setWidgetInteraction(null)");
  }
  report.checks.push("Both card styles show their full height without outer scrolling at wide, short, narrow and mobile sizes and 200% browser zoom",
    "Manual zoom restores outer scrolling for close reading and zoom-out returns to automatic fitting",
    "Resize and reopen preserve Canvas geometry, iframe identity and the card body's scroll position");
  assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.ok=false;report.error=error.stack;if(win)fs.writeFileSync(path.join(directory,"failure.png"),(await win.webContents.capturePage()).toPNG());}
finally{win?.destroy();if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}report.closed=!server?.listening;
  fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,checks:report.checks,error:report.error,errors:report.errors,closed:report.closed,directory},null,2));fs.rmSync(temporary,{recursive:true,force:true});app.exit(report.ok?0:1);}
});
