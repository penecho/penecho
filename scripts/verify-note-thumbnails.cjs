"use strict";
// Render canonical local or Cloud assets with disposable service, account and profile.
// Run: tools/electron/node_modules/.bin/electron scripts/verify-note-thumbnails.cjs [--cloud]
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict"),sharp=require("sharp"),{Readable}=require("node:stream"),{pathToFileURL}=require("node:url");
const root=path.resolve(__dirname,".."),cloudRoot=path.resolve(root,"../penecho_cloud"),cloud=process.argv.includes("--cloud"),offscreen=cloud||process.argv.includes("--offscreen"),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-note-thumbnails-")),output=path.join(root,"docs/verification/note-thumbnails-webp96-20261004",cloud?"cloud":offscreen?"local-offscreen":"local");
fs.mkdirSync(output,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));app.commandLine.appendSwitch("force-device-scale-factor","2");
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const expose=source=>source.replace(/\}\)\(\);\s*$/,`
  const realNoteLibraryThumb=noteLibraryThumb;
  window.thumbnailTest={state,noteCards,canvasDocumentsReady,noteLibraryLoad,noteLibraryPut,noteLibraryPersist,noteLibraryRender,openNoteLibrary,noteThumbKey,noteLibrarySnapshot,noteEncodeThumbnail,applyLanguage,applyTheme,closeCanvasAgent,
    forceThumb:entry=>realNoteLibraryThumb(entry,{force:true}),migration(enabled){noteLibraryThumb=enabled?realNoteLibraryThumb:()=>Promise.resolve("");},
    dismissOnboarding(){markChangelogSeen();markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);closeFeatureTour({restore:false,scroll:false,changelog:false,retry:false});closeChangelog();}};
  penIntelRemote=()=>false;
})();`),readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){if(!cloud&&path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([expose(fs.readFileSync(file,"utf8"))]);return readStream.call(this,file,...args);};
let server,win;const assetRoot=path.join(cloud?cloudRoot:root,cloud?"public/canvas":"public"),report={runtime:cloud?"Cloud":"local",inputs:Object.fromEntries(["app.js","note-card.js","widget-host.js"].map(file=>[file,require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(assetRoot,file))).digest("hex")])),checks:[],codecs:[],errors:[]},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let i=0;i<200;i++){if(await check())return;await pause(100);}throw Error("Timed out: "+label);}
const bytes=url=>Buffer.from(url.slice(url.indexOf(",")+1),"base64");
app.whenReady().then(async()=>{try{
  let url,cookies=[];
  if(cloud){
    const {buildApp}=await import(pathToFileURL(path.join(cloudRoot,"src/app.mjs")).href),reservation=require("node:net").createServer();
    await new Promise(resolve=>reservation.listen(0,"127.0.0.1",resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const origin=`http://127.0.0.1:${port}`;
    server=await buildApp({logger:false,env:{NODE_ENV:"test",AUTH_MODE:"development",DATA_MODE:"memory",SESSION_MODE:"memory",STORAGE_MODE:"memory",CLOUD_NATIVE_CANVAS_ENABLED:"true",APP_ORIGIN:origin}});
    server.get("/canvas/app.js",{config:{rateLimit:false},compress:false},async(_request,reply)=>reply.type("application/javascript").send(expose(fs.readFileSync(path.join(cloudRoot,"public/canvas/app.js"),"utf8"))));
    server.addHook("onSend",async(request,_reply,payload)=>request.url.startsWith("/api/config.js")?String(payload)+"\nwindow.PENECHO_CONFIG.browserCanvasEditing=true;":payload);
    const email="thumbnail@notes.test",password="Isolated thumbnail A9",registration=await server.inject({method:"POST",url:"/api/v1/auth/register",payload:{name:"Thumbnail verification",email,password,termsAccepted:true,privacyAccepted:true}});
    await server.inject({method:"POST",url:"/api/v1/auth/verify-email",payload:{email,code:registration.json().developmentCode}});
    const login=await server.inject({method:"POST",url:"/api/v1/auth/login",payload:{email,password}}),account=login.json().account,project=await server.services.repository.createProject(account.id,{name:"Preview verification"}),canvas=await server.services.repository.createCanvas(account.id,project.id,{name:"Empty Canvas"});
    await server.listen({port,host:"127.0.0.1"});url=`${origin}/canvas/${canvas.id}`;
    cookies=[].concat(login.headers["set-cookie"]).map(cookie=>{const [name,value]=cookie.split(";",1)[0].split("=");return {url:origin,name,value,path:"/",httpOnly:name!=="penecho_csrf"};});
  }else{server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));url=`http://127.0.0.1:${server.address().port}`;}
  // Local widget hosts use a separate origin. Exercise their out-of-process
  // iframe layouts in a normal desktop window.
  win=new BrowserWindow({show:!offscreen,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen}});
  for(const cookie of cookies)await win.webContents.session.cookies.set(cookie);
  win.webContents.on("console-message",event=>{if(event.level==="error")report.errors.push(event.message);});
  const js=async code=>{const result=await win.webContents.executeJavaScript(`(async()=>{try{return {value:await (${code})};}catch(error){return {failure:error.stack||String(error)};}})()`,true);if(result.failure)throw Error(result.failure);return result.value;},shot=async name=>{await js("thumbnailTest.dismissOnboarding()");await pause(350);await js("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");assert.equal(await js("!!document.querySelector('#changelogLayer:not([hidden]), #tourLayer:not([hidden])')"),false,'onboarding does not obscure preview screenshots');fs.writeFileSync(path.join(output,name+".png"),(await win.webContents.capturePage()).toPNG());};
  await win.loadURL(url);await until(()=>js("!!window.thumbnailTest"),"startup");
  await js(`(async()=>{const t=thumbnailTest;await t.canvasDocumentsReady();await t.noteLibraryLoad();t.state.auto=false;t.state.language='zh';t.applyLanguage();t.applyTheme('studio');t.closeCanvasAgent();t.dismissOnboarding();await window.MathJax?.startup?.promise;t.migration(false);})()`);
  const fixtures=[
    {title:"量子力学核心公式与波函数 ψ",style:"card",category:"formula",blocks:[{type:"callout",title:"ψ 是什么？",text:"波函数描述量子系统的复值概率幅。概率密度与能量、动量是不同的概念。"},{type:"formula",latex:"i\\hbar\\frac{\\partial\\psi}{\\partial t}=\\hat H\\psi",caption:"含时薛定谔方程"},{type:"markdown",text:"**中文细字与英文公式**\n\nThe probability density is |ψ|². Keep every symbol sharp at Retina resolution."},{type:"graph",expression:"y = sin(x)^2"}]},
    {title:"项目工作笔记 · 清晰的文字与待办",style:"note",category:"meeting",blocks:[{type:"markdown",text:"## 本周计划\n\n讨论预览清晰度，保留每一条原始记录。\n\n**决定：** 优先完整尺寸，比较编码体积。"},{type:"todo",items:["检查文字与公式边缘","升级旧笔记预览","保留原画布与笔记内容"]},{type:"keypoints",items:["图片来自保存的笔记源","无需打开原画布","串行生成，避免同时渲染大量页面"]}]}
  ];
  const media=await js(`(()=>{const c=document.createElement('canvas');c.width=720;c.height=600;const ctx=c.getContext('2d'),pixels=ctx.createImageData(c.width,c.height);let seed=7;for(let i=0;i<pixels.data.length;i+=4){for(let channel=0;channel<3;channel++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i+channel]=seed>>>24;}pixels.data[i+3]=255;}ctx.putImageData(pixels,0,0);return c.toDataURL('image/webp',.76);})()`);
  fixtures.push({title:"图片资料 · 编码体积边界",style:"note",category:"reference",blocks:[{type:"image",src:media,w:720,h:600,caption:"Dense image fixture exercises bounded high-quality WebP fallback."}]});
  for(const [index,note] of fixtures.entries()){
    const sample=await js(`(async()=>{const t=thumbnailTest,note=PENECHO_NOTE_CARD.normalize(${JSON.stringify(note)}),image=await t.noteLibrarySnapshot(note),c=document.createElement('canvas');c.width=900;c.height=1200;const ctx=c.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,c.width,c.height);ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0);const data={};for(const [name,type,q] of [['png','image/png'],['webp100','image/webp',1],['webp96','image/webp',.96],['jpeg96','image/jpeg',.96]])data[name]=c.toDataURL(type,q);c.width=360;c.height=480;c.getContext('2d').drawImage(image,0,0,360,480);const thumb=c.toDataURL('image/jpeg',.84),entry=PENECHO_NOTE_CARD.libraryEntry({id:'legacy-${index}',documentId:'closed-original-canvas',thumb:${index===1?"data.png":"thumb"},thumbDigest:'legacy',note});if(${index===1})entry.thumbDigest=t.noteThumbKey(entry).replace(':preview-900-webp96-v3:',':preview-900-v2:');t.noteLibraryPut(entry);return {...data,legacy:thumb};})()`);
    const comparison={title:note.title};
    for(const [name,data] of Object.entries(sample)){
      const buffer=bytes(data),meta=await sharp(buffer).metadata();comparison[name]={bytes:buffer.length,width:meta.width,height:meta.height,format:meta.format};
      fs.writeFileSync(path.join(output,`${index}-${name}.${meta.format==='jpeg'?'jpg':meta.format}`),buffer);
      if(name==='webp100')comparison.webp100.lossless=buffer.includes(Buffer.from("VP8L"));
    }
    const reference=await sharp(bytes(sample.png)).ensureAlpha().raw().toBuffer(),decoded=await sharp(bytes(sample.webp100)).ensureAlpha().raw().toBuffer();
    comparison.webp100.exactPixels=reference.equals(decoded);report.codecs.push(comparison);
  }
  await js("thumbnailTest.noteLibraryPersist()");await js("thumbnailTest.openNoteLibrary()");await until(()=>js(`document.querySelectorAll('.note-tile-thumb').length===${fixtures.length}`),"legacy tiles");await shot("before");
  const before=await js("JSON.stringify(thumbnailTest.noteCards.entries.map(e=>({id:e.id,note:e.note})))");
  await js("(()=>{thumbnailTest.migration(true);return thumbnailTest.noteLibraryRender();})()");
  await until(()=>js("thumbnailTest.noteCards.entries.every(e=>e.thumbDigest===thumbnailTest.noteThumbKey(e))"),"legacy migration");
  await js("thumbnailTest.noteLibraryPersist()");assert.equal(await js("JSON.stringify(thumbnailTest.noteCards.entries.map(e=>({id:e.id,note:e.note})))"),before);
  assert.equal(await js("thumbnailTest.state.widgets.length"),0);assert.equal(await js("document.querySelectorAll('iframe[aria-hidden=true]').length"),0);
  report.tiles=await js("({dpr:devicePixelRatio,viewportWidth:innerWidth,images:[...document.querySelectorAll('.note-tile-thumb')].map(i=>({width:i.naturalWidth,height:i.naturalHeight,cssWidth:i.getBoundingClientRect().width,src:i.src.slice(0,22)}))})");
  report.tiles.rasterWidth=(await win.webContents.capturePage()).getSize().width;
  report.tiles.rasterScale=report.tiles.rasterWidth/report.tiles.viewportWidth;
  assert.equal(report.tiles.rasterScale,2,"the captured output exercises a 2× display surface");
  for(const image of report.tiles.images){assert.equal(image.width,900);assert.equal(image.height,1200);assert.ok(image.src.startsWith('data:image/webp;base64'));assert.ok(image.width>=image.cssWidth*Math.max(report.tiles.dpr,report.tiles.rasterScale));}
  report.encoded=await js("thumbnailTest.noteCards.entries.map(e=>({title:e.note.title,dataUrl:e.thumb}))");
  for(const [index,encoded] of report.encoded.entries()){
    const buffer=bytes(encoded.dataUrl);delete encoded.dataUrl;
    encoded.bytes=buffer.length;encoded.format=(await sharp(buffer).metadata()).format;
    const comparison=report.codecs.find(c=>c.title===encoded.title);
    assert.ok(buffer.equals(fs.readFileSync(path.join(output,`${report.codecs.indexOf(comparison)}-webp96.webp`))),'saved preview uses actual WebP 0.96 encoding');
    encoded.previousPolicyBytes=Math.min(comparison.png.bytes,comparison.webp100.bytes)<=Math.floor((700*1024-40)*3/4)?Math.min(comparison.png.bytes,comparison.webp100.bytes):comparison.webp96.bytes;
    fs.writeFileSync(path.join(output,`${index}-saved.webp`),buffer);
  }
  await shot("after");
  await js("document.querySelector('.note-tile').click()");assert.equal(await js("document.querySelector('.note-detail-preview')"),null,"details omit the duplicate thumbnail");await shot("detail");
  win.setSize(390,844);await pause(350);
  const scrolling=await js("(()=>{const g=thumbnailTest.noteCards.panel.grid;g.scrollTop=120;return {top:g.scrollTop,height:g.clientHeight,total:g.scrollHeight};})()");
  assert.ok(scrolling.top>0,JSON.stringify(scrolling));
  await js("thumbnailTest.forceThumb(thumbnailTest.noteCards.entries[0])");await js("thumbnailTest.noteLibraryPersist()");
  const scrolled=await js("thumbnailTest.noteCards.panel.grid.scrollTop");assert.equal(scrolled,scrolling.top,"background preview refresh preserves scrolling");report.scrolling={...scrolling,after:scrolled};await shot("narrow");
  const saved=await js(`(async()=>{const t=thumbnailTest,result=[];for(const e of t.noteCards.entries){const url=${JSON.stringify(cloud?"/api/v1/notes/":"/api/notes")}${cloud?"+encodeURIComponent(e.id)":""},r=await fetch(url,{credentials:'same-origin'});const data=await r.json(),entry=${cloud?"data.entry":"data.notes.find(n=>n.id===e.id)"};result.push({id:e.id,same:entry.thumb===e.thumb&&JSON.stringify(entry.note)===JSON.stringify(e.note),chars:entry.thumb.length});}return result;})()`);
  assert.ok(saved.every(e=>e.same&&e.chars<=700*1024));report.saved=saved;
  report.checks.push("Both 360×480 JPEG and previous 900×1200 lossless previews migrate to 900×1200 WebP 0.96 from independent saved sources on an empty Canvas","Saved previews match actual WebP 0.96 bytes; Retina list previews have enough source pixels; details omit the duplicate preview; before/after screenshots retained","Narrow-layout scroll position survives background preview refresh","Complete source survives migration and server round-trip; temporary capture frames are removed");
  assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.failure=error.stack;}
finally{win?.destroy();if(server){if(cloud)await server.close();else{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}}report.serviceClosed=true;fs.rmSync(temporary,{recursive:true,force:true});fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,failure:report.failure,checks:report.checks,codecs:report.codecs,output},null,2));app.exit(report.ok?0:1);}});
