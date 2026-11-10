"use strict";
// Canonical client, isolated profile/data/service; no existing app is restarted.
// Run: tools/electron/node_modules/.bin/electron scripts/verify-note-images.cjs
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict"),{Readable}=require("node:stream"),{execFileSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-note-images-")),output=path.join(root,"docs/verification/note-images-20261003");
const nativeUi=process.env.PENECHO_NOTE_NATIVE_UI==="1";
fs.mkdirSync(output,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const baseline=execFileSync("git",["show","HEAD:src/client/app/note-cards.js"],{cwd:root,encoding:"utf8"});
function extract(name){const start=baseline.indexOf(`  function ${name}(`),end=baseline.indexOf("\n  }",start)+4;return baseline.slice(start,end);}
const oldEncode=extract("noteEncodeCanvas").replace("function noteEncodeCanvas(","function oldNoteEncodeCanvas("),oldInk=extract("noteSelectionInk").replace("function noteSelectionInk(","function oldNoteSelectionInk(").replaceAll("noteEncodeCanvas(","oldNoteEncodeCanvas(");
const originalRead=fs.createReadStream;
fs.createReadStream=function(file,...args){if(path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([fs.readFileSync(file,"utf8").replace(/\}\)\(\);\s*$/,`
${oldEncode}\n${oldInk}
window.noteImagesTest={state,noteCards,canvasDocumentsReady,loadCanvasSettings,noteCardInsert,noteCaptureSelection,noteSelectionInk,noteEncodeCanvas,oldNoteEncodeCanvas,oldNoteSelectionInk,noteLibraryReadEntry,noteLibraryPersist,noteImageOpen,setCanvasMode,closeCanvasAgent,enterWidgetInteraction,setWidgetMaximized,setWidgetInteraction,render,applyLanguage};
})();`)]);return originalRead.call(this,file,...args);};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),report={checks:[],errors:[],layouts:[]};let server,win;
async function until(check,label,attempts=120){for(let i=0;i<attempts;i++){if(await check())return;await pause(100);}throw Error(`Timed out: ${label}`);}
app.whenReady().then(async()=>{try{
  server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
  win=new BrowserWindow({show:nativeUi,width:1440,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:!nativeUi}});
  win.webContents.on("console-message",event=>{if(event.level==="error")report.errors.push(event.message);});
  const js=code=>win.webContents.executeJavaScript(code,true),shot=async name=>fs.writeFileSync(path.join(output,`${name}.png`),(await win.webContents.capturePage()).toPNG());
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  win.setTitle("PenEcho Note Image Verification");
  await js(`(async()=>{const t=noteImagesTest;await t.canvasDocumentsReady();await t.loadCanvasSettings();t.state.auto=false;t.state.language='zh';t.applyLanguage();t.closeCanvasAgent();t.setCanvasMode('hand');document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();})()`);
  report.capture=await js(`(async()=>{
    const t=noteImagesTest,c=document.createElement('canvas');c.width=3000;c.height=2200;const ctx=c.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#1d2330';ctx.font='32px serif';
    for(let y=80;y<2150;y+=65)ctx.fillText('原始研究笔记  ∂ψ/∂t = Hψ   E = mc²   f(x) = sin(x)   0123456789',80,y);
    const old=t.oldNoteEncodeCanvas(c,{maxSide:760,budget:60000,alpha:false});const image=new Image();image.src=c.toDataURL();await image.decode();
    const item={id:'original',image,naturalW:3000,naturalH:2200,w:1200,h:880,x:100,y:100};
    const box={x:100,y:100,w:1200,h:880},path=[{x:100,y:100},{x:1300,y:100},{x:1300,y:980},{x:100,y:980}],selection={box,originalBox:box,path,originalPath:path,objects:[{kind:'images',item,box}],fragments:[],regionOnly:false};
    const captured=await t.noteCaptureSelection(selection),picture=captured.items.find(p=>p.kind==='image');
    const inkCanvas=document.createElement('canvas');inkCanvas.width=2400;inkCanvas.height=1600;const inkCtx=inkCanvas.getContext('2d');inkCtx.fillStyle='#172033';inkCtx.font='italic 42px serif';
    for(let y=80;y<1500;y+=100)inkCtx.fillText('Original ink:   E = mc²   ∂ψ/∂t = Hψ    0123456789',60,y);
    const fragment={image:inkCanvas,renderImage:inkCanvas,x:100,y:100,w:1200,h:800};
    const inkSelection={box:{x:100,y:100,w:1200,h:800},originalBox:{x:100,y:100,w:1200,h:800},fragments:[fragment],objects:[],regionOnly:false};
    const oldInk=t.oldNoteSelectionInk(inkSelection,path),ink=t.noteSelectionInk(inkSelection,path);
    window.noteImageFixture=PENECHO_NOTE_CARD.normalize({title:'原始截图 · 高清查看',style:'note',blocks:[{type:'ink',src:ink.src,w:ink.w,h:ink.h},{type:'image',src:picture.src,w:picture.w,h:picture.h,alt:'原始截图'}]});
    window.noteImageWidget=await t.noteCardInsert(noteImageFixture);
    return {picture:{old:[old.w,old.h],current:[picture.w,picture.h],chars:picture.src.length},ink:{old:[oldInk.w,oldInk.h],current:[ink.w,ink.h],chars:ink.src.length,type:ink.src.slice(0,22)}};
  })()`);
  for(const kind of ["ink","picture"]){const sample=report.capture[kind];assert.ok(sample.current[0]>=sample.old[0]*2-2,JSON.stringify(sample));assert.ok(sample.current[1]>=sample.old[1]*2-2,JSON.stringify(sample));}
  report.checks.push("Real handwriting and picture capture pixels are at least doubled on both axes against the previous encoder");
  await until(()=>js("noteImageWidget.mcpDocumentLoaded"),"Note document ready");
  await js("noteImagesTest.noteLibraryPersist()");
  assert.equal(await js("fetch('/api/notes').then(r=>r.json()).then(r=>r.notes.find(e=>e.note.title===noteImageFixture.title).note.blocks[0].src===noteImageFixture.blocks[0].src)"),true);
  assert.equal(await js(`(async()=>{const entry=PENECHO_NOTE_CARD.libraryEntry({id:'large-request',note:{...noteImageFixture,libraryId:'large-request'},thumb:'data:image/png;base64,'+'A'.repeat(650000)}),payload={entry,expectedVersion:0};if(JSON.stringify(payload).length<=1024*1024)throw Error('Expected a large request');const r=await fetch('/api/notes/large-request',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return r.ok&&(await r.json()).note.note.blocks[0].src===noteImageFixture.blocks[0].src})()`),true);
  const contentFrame=async()=>{for(const frame of win.webContents.mainFrame.framesInSubtree.filter(f=>f.url==="about:srcdoc"))if(await frame.executeJavaScript("document.querySelector('.nc')?.getAttribute('aria-label')==='原始截图 · 高清查看'&&document.querySelector('.nc-ink img')?.getAttribute('role')==='button'"))return frame;throw Error("Missing active Note content frame");};
  const clickImage=async(frame,reader)=>{
    win.focus();win.webContents.focus();
    await js("window.noteImageEvents=[];window.addEventListener('message',e=>{if(e.data?.type==='penecho-note-image-open')noteImageEvents.push({index:e.data.index,origin:e.origin})})");
    await frame.executeJavaScript("window.noteImageClicks=[];window.addEventListener('click',e=>noteImageClicks.push({tag:e.target.tagName,x:e.clientX,y:e.clientY}),true)");
    const local=await frame.executeJavaScript("(()=>{const i=document.querySelector('.nc-ink img'),r=i.getBoundingClientRect(),b=document.querySelector('.nc-body').getBoundingClientRect();return {x:r.x+r.width/2,y:(Math.max(r.top,b.top)+Math.min(r.bottom,b.bottom))/2,role:i.getAttribute('role'),meta:!!document.querySelector('meta[name=penecho-note-card]'),innerWidth,innerHeight}})()");
    const outer=await js(reader?"document.querySelector('.note-reader iframe').getBoundingClientRect().toJSON()":"noteImageWidget.frame.getBoundingClientRect().toJSON()");
    const factor=win.webContents.getZoomFactor(),x=Math.round((outer.x+local.x*outer.width/900)*factor),y=Math.round((outer.y+local.y*outer.height/1200)*factor);
    report.clicks||=[];report.clicks.push({local,outer,x,y,reader,factor,state:await js(`({mode:noteImagesTest.state.mode,interacting:noteImagesTest.state.interactingWidgetId,maximized:noteImageWidget.maximized,inert:noteImageWidget.frame.inert,innerWidth,innerHeight,hit:document.elementFromPoint(${x/factor},${y/factor})?.tagName,pointer:getComputedStyle(noteImageWidget.frame).pointerEvents,ancestorInert:!!noteImageWidget.frame.closest('[inert]')})`)});
    if(nativeUi&&await js("innerWidth>1000")){
      console.log(JSON.stringify({nativeUiReady:true,reader,title:win.getTitle()}));
      await until(()=>js("!!document.querySelector('.note-image-viewer[open] img')?.naturalWidth"),"operating-system image click",600);
      report.nativeUiClicks||=[];report.nativeUiClicks.push({reader,opened:true});await pause(2000);
    }else if(report.nativePointerInjectionAvailable!==false){win.webContents.sendInputEvent({type:"mouseMove",x,y});win.webContents.sendInputEvent({type:"mouseDown",x,y,button:"left",clickCount:1});win.webContents.sendInputEvent({type:"mouseUp",x,y,button:"left",clickCount:1});}
    await pause(200);report.clicks.at(-1).events=await js("noteImageEvents");report.clicks.at(-1).innerClicks=await frame.executeJavaScript("noteImageClicks");
    if(!await js("!!document.querySelector('.note-image-viewer[open]')")) {
      // Electron's main WebContents injection may stop at the cross-origin host.
      // Exercise the real rendered document click handler and message bridge.
      report.nativePointerInjectionAvailable=false;
      await frame.executeJavaScript("document.querySelector('.nc-ink img').click()");await pause(200);
      report.clicks.at(-1).domClickOpened=await js("!!document.querySelector('.note-image-viewer[open]')");
    }
    await until(()=>js("!!document.querySelector('.note-image-viewer[open] img')?.naturalWidth"),"image viewer open");
  };
  for(const reader of [false,true])for(const [width,height] of [[1440,900],[390,844]]){
    win.setContentSize(width,height);await pause(200);
    if(reader){await js("noteImagesTest.noteLibraryReadEntry(PENECHO_NOTE_CARD.libraryEntry({id:'reader',note:noteImageFixture}))");await until(()=>js("noteImagesTest.noteCards.reader?.dataset.ready==='true'"),"library reader ready");}
    else {await js("noteImagesTest.enterWidgetInteraction(noteImageWidget);noteImagesTest.setWidgetMaximized(noteImageWidget,true)");await pause(200);}
    const frame=await contentFrame(),scroll=await frame.executeJavaScript("document.querySelector('.nc-body').scrollTop");
    await clickImage(frame,reader);await pause(100);
    const metrics=await js("(()=>{const d=document.querySelector('.note-image-viewer'),s=d.querySelector('.note-image-stage'),i=d.querySelector('img');return {dialog:d.getBoundingClientRect().toJSON(),stage:s.getBoundingClientRect().toJSON(),image:i.getBoundingClientRect().toJSON(),natural:[i.naturalWidth,i.naturalHeight],scrollWidth:s.scrollWidth,clientWidth:s.clientWidth,scrollHeight:s.scrollHeight,clientHeight:s.clientHeight}})()");
    assert.ok(metrics.dialog.x>=0&&metrics.dialog.right<=width+1);assert.ok(metrics.image.width<=metrics.stage.width);assert.ok(metrics.scrollWidth<=metrics.clientWidth+1&&metrics.scrollHeight<=metrics.clientHeight+1,JSON.stringify(metrics));
    report.layouts.push({reader,width,height,...metrics});await shot(`${reader?"library":"canvas"}-${width}`);
    await js("document.querySelector('.note-image-controls button[aria-label=原始大小]').click()");
    assert.equal(await js("parseFloat(document.querySelector('.note-image-viewer img').style.width)"),report.capture.ink.current[0]);
    assert.ok(await js("(()=>{const s=document.querySelector('.note-image-stage');return s.scrollWidth>s.clientWidth||s.scrollHeight>s.clientHeight})()"));
    await js("document.querySelector('.note-image-controls button[aria-label=放大]').click()");
    assert.ok(await js("parseFloat(document.querySelector('.note-image-viewer img').style.width)")>report.capture.ink.current[0]);
    win.webContents.sendInputEvent({type:"keyDown",keyCode:"Escape"});win.webContents.sendInputEvent({type:"keyUp",keyCode:"Escape"});await until(()=>js("!document.querySelector('.note-image-viewer')"),"Escape closes only image viewer");
    assert.equal(await frame.executeJavaScript("document.querySelector('.nc-body').scrollTop"),scroll);
    assert.equal(await js(reader?"!!noteImagesTest.noteCards.reader?.open":"noteImageWidget.maximized"),true);
    await frame.executeJavaScript("document.querySelector('.nc-image img').focus();document.querySelector('.nc-image img').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))");
    await until(()=>js("!!document.querySelector('.note-image-viewer[open] img')?.naturalWidth"),"picture keyboard open");
    assert.equal(await js("document.querySelector('.note-image-viewer img').src===noteImageFixture.blocks[1].src"),true);
    await js("document.querySelector('.note-image-viewer').close()");
    if(reader)await js("noteImagesTest.noteCards.reader.close()");else await js("noteImagesTest.setWidgetInteraction(null)");
  }
  report.checks.push("Rendered image click handlers open originals from Canvas and library maximization on desktop and mobile layouts",
    "Actual-size and zoom controls expose original pixels with scrolling; Escape preserves the underlying maximized Note and reading position",
    "Picture Enter activation opens its own source; local server backup preserves original media exactly");
  assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.ok=false;report.error=error.stack;if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,"failure.png"),(await win.webContents.capturePage()).toPNG());}
finally{win?.destroy();if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}report.closed=!server?.listening;fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));fs.rmSync(temporary,{recursive:true,force:true});app.exit(report.ok?0:1);}});
