"use strict";
// Run canonical assets with a disposable local server, notes and browser profile.
// Run: tools/electron/node_modules/.bin/electron scripts/verify-note-library-detail.cjs
const {app, BrowserWindow} = require("electron"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), {Readable} = require("node:stream");
const root = path.resolve(__dirname, ".."), cloudRoot = path.resolve(root, "../penecho_cloud"), cloudMode = process.argv.includes("--cloud"), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-note-review-")), output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || path.join(root, "docs/verification/note-library-detail-20261004", cloudMode ? "cloud" : "local"));
fs.mkdirSync(output, {recursive:true}); app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, {NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary,"state"), PENECHO_CONFIG_FILE:path.join(temporary,"config.env"), HOST:"127.0.0.1", PORT:"0", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false"});
const readStream = fs.createReadStream;
const exposeRuntime = source => source.replace(/\}\)\(\);\s*$/, `
    window.noteDetailTest={state,noteCards,canvasDocumentsReady,noteLibraryLoad,noteLibraryPut,noteLibraryPersist,noteLibraryRender,openNoteLibrary,closeNoteLibrary,noteCardInsert,applyLanguage,applyTheme,closeCanvasAgent};
    penIntelRemote=()=>false;
    maybeStartOnboarding=()=>false;
  })();`);
fs.createReadStream = function(file, ...args) {
  if (!cloudMode && path.resolve(String(file)) === path.join(root, "public/app.js")) return Readable.from([exposeRuntime(fs.readFileSync(file, "utf8"))]);
  return readStream.call(this, file, ...args);
};
const assetRoot = cloudMode ? path.join(cloudRoot,'public/canvas') : path.join(root,'public');
const report = {runtime:cloudMode ? "isolated Cloud" : "isolated local", inputs:Object.fromEntries(['app.js','cloud-connect.js','style.css','studio-shell.css'].map(file=>[file,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(assetRoot,file))).digest('hex')])), checks:[], navigation:[], layouts:[], errors:[]}, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { for (let i=0;i<120;i++) { if (await check()) return; await pause(100); } throw Error(`Timed out: ${label}`); }
let server, win;
app.whenReady().then(async () => { try {
  let url, cookies;
  if (cloudMode) {
    const {pathToFileURL} = require("node:url"), {buildApp} = await import(pathToFileURL(path.join(cloudRoot,"src/app.mjs")).href);
    const reservation = require("node:net").createServer(); await new Promise(resolve => reservation.listen(0,"127.0.0.1",resolve)); const port = reservation.address().port; await new Promise(resolve=>reservation.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    server = await buildApp({logger:false,env:{NODE_ENV:"test",AUTH_MODE:"development",DATA_MODE:"memory",SESSION_MODE:"memory",STORAGE_MODE:"memory",CLOUD_NATIVE_CANVAS_ENABLED:"true",APP_ORIGIN:origin}});
    const mirrored = exposeRuntime(fs.readFileSync(path.join(cloudRoot,"public/canvas/app.js"),"utf8"));
    server.get("/canvas/app.js",{config:{rateLimit:false},compress:false},async(_request,reply)=>reply.type("application/javascript").send(mirrored));
    server.addHook("onSend",async(request,_reply,payload)=>request.url.startsWith("/api/config.js") ? String(payload)+"\nwindow.PENECHO_CONFIG.browserCanvasEditing=true;" : payload);
    const email="review-ui@notes.test",password="Isolated review A9",registration=await server.inject({method:"POST",url:"/api/v1/auth/register",payload:{name:"Review UI",email,password,termsAccepted:true,privacyAccepted:true}});
    await server.inject({method:"POST",url:"/api/v1/auth/verify-email",payload:{email,code:registration.json().developmentCode}});
    const login=await server.inject({method:"POST",url:"/api/v1/auth/login",payload:{email,password}}),account=login.json().account;
    const project=await server.services.repository.createProject(account.id,{name:"Isolated review"}),canvas=await server.services.repository.createCanvas(account.id,project.id,{name:"Review source"});
    await server.listen({port,host:"127.0.0.1"}); url=`${origin}/canvas/${canvas.id}`;
    cookies=[].concat(login.headers["set-cookie"]).map(cookie=>{const [name,value]=cookie.split(";",1)[0].split("=");return {url:origin,name,value,path:"/",httpOnly:name!=="penecho_csrf"};});
  } else {
    server = require("../server.js"); await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve)); url=`http://127.0.0.1:${server.address().port}`;
  }
  win = new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  for (const cookie of cookies || []) await win.webContents.session.cookies.set(cookie);
  win.webContents.on("console-message", event => { if (event.level === "error") report.errors.push(event.message); });
  const js = code => win.webContents.executeJavaScript(code, true), shot = async name => {
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await pause(80);
    fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  await win.loadURL(url);
  await until(()=>js("!!window.noteDetailTest"),"Canvas startup");
  await js(`(async()=>{
    const t=noteDetailTest;await t.canvasDocumentsReady();await t.noteLibraryLoad();t.state.auto=false;t.state.language='en';t.applyLanguage();t.applyTheme('studio');t.closeCanvasAgent();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();
    const note=PENECHO_NOTE_CARD.normalize({title:'PenEcho 项目架构：四层分层、模型执行器与关键约束',style:'card',category:'reference',bookmarked:true,tags:['PenEcho','架构','画布','MCP','模型执行器'],summary:'PenEcho 空间化 AI 协作画布的分层架构（接入 / 服务 / 执行 / 外部）及客户端、请求流、Canvas Agent、MCP 与桌面构建要点。',blocks:[{type:'markdown',text:'## 分层结构\\n\\n接入层 → 服务层 → 执行层 → 外部。\\n\\nThe original card stays on its canvas when the library copy is removed.'}]});
    const widget=await t.noteCardInsert(note);window.detailWidgetId=widget.id;
    const entry=t.noteCards.entries.find(e=>e.objectId===widget.id);window.detailEntryId=entry.id;
    entry.documentTitle='Redundant source canvas label';t.noteLibraryPut(entry);
    t.noteLibraryPut(PENECHO_NOTE_CARD.libraryEntry({id:'standalone-work',documentId:'closed-canvas',documentTitle:'Another redundant canvas label',note:{title:'Work note without tags or summary',style:'note',category:'meeting',blocks:['Original work note']}}));
    await t.noteLibraryPersist();await t.openNoteLibrary({focusId:entry.id});
  })()`);
  await until(()=>js("document.querySelector('.note-detail-info h3')?.textContent.includes('PenEcho')"),"selected detail");
  const select=()=>js("document.querySelector('.note-tile[data-note-id=\"'+detailEntryId+'\"]').click()");
  // Host readiness and other render caches change asynchronously; compare the
  // editable source and geometry rather than the full live runtime record.
  const originalWidget=()=>js("(()=>{const w=noteDetailTest.state.widgets.find(w=>w.id===detailWidgetId);return Object.fromEntries(['id','title','copyText','sourceFormat','x','y','w','h'].map(key=>[key,w[key]]))})()");
  const original=await originalWidget();
  assert.equal(await js("document.querySelector('.note-detail-preview')"),null);
  assert.equal(await js("document.querySelector('.note-detail-info').textContent.includes('Redundant source canvas label')"),false);
  assert.equal(await js("document.querySelectorAll('.note-detail-tags span').length"),5);
  assert.equal(await js("document.querySelectorAll('.note-detail-actions button').length"),3);
  assert.equal(await js("document.querySelectorAll('.note-detail-secondary button').length"),3);
  assert.equal(await js("document.querySelector('.note-detail-category select').value"),'reference');
  const color=await js("(()=>{const b=document.querySelector('.note-detail-action.primary');return {label:getComputedStyle(b).color,icon:getComputedStyle(b.querySelector('.note-chip-icon')).color,background:getComputedStyle(b).backgroundColor}})()");
  assert.equal(color.icon,color.label);assert.equal(color.label,'rgb(255, 255, 255)');assert.notEqual(color.background,color.label);report.readColors=color;
  await shot('detail-wide-en');
  await js("document.querySelector('.note-detail-share').click()");
  await until(()=>js("!!document.querySelector('.penecho-live-share-dialog')"),"existing Widget share dialog");
  assert.match(await js("document.querySelector('.penecho-live-share-dialog h2').textContent"),/Share Widget/);
  assert.equal(await js("document.querySelector('.note-library')"),null);
  assert.deepEqual(await originalWidget(),original,'opening Share preserves the original note and geometry');
  await shot('share-dialog-en');
  await js("document.querySelector('.penecho-live-share-dialog .cloud-dialog-close').click();noteDetailTest.openNoteLibrary({focusId:detailEntryId})");
  await until(()=>js("!!document.querySelector('.note-detail-share')"),"library reopened after Share");
  report.checks.push('Share opens the existing Widget live-link dialog for the selected note without modifying its source or geometry.');
  await js("document.querySelector('.note-detail-action.primary').click()");
  await until(()=>js("document.querySelector('.note-reader')?.dataset.ready==='true'"),"reader ready");
  assert.deepEqual(await originalWidget(),original);
  await js("document.querySelector('.note-reader .note-library-close').click()");
  await until(()=>js("!document.querySelector('.note-reader')"),"reader closed");
  report.checks.push('Detail omits the duplicate preview and source title; tags, summary, category and action groups remain. Read icon has white text contrast and opens the full card without editing the original.');
  const layout=()=>js("(()=>{const detail=document.querySelector('.note-library-detail'),info=detail.querySelector('.note-detail-info'),library=document.querySelector('.note-library');return {viewport:{width:innerWidth,height:innerHeight},detail:detail.getBoundingClientRect().toJSON(),library:library.getBoundingClientRect().toJSON(),scrollWidth:detail.scrollWidth,clientWidth:detail.clientWidth,infoScrollWidth:info.scrollWidth,infoClientWidth:info.clientWidth,buttons:[...info.querySelectorAll('button')].map(b=>({text:b.textContent,rect:b.getBoundingClientRect().toJSON()}))}})()");
  for(const [name,width,height,language] of [['wide-zh',1440,1000,'zh'],['tablet-en',1024,768,'en'],['narrow-zh',390,844,'zh']]){
    win.setContentSize(width,height);await js(`noteDetailTest.state.language=${JSON.stringify(language)};noteDetailTest.applyLanguage();noteDetailTest.noteLibraryRender()`);await pause(180);
    const sample=await layout();assert.ok(sample.scrollWidth<=sample.clientWidth+1,JSON.stringify(sample));assert.ok(sample.infoScrollWidth<=sample.infoClientWidth+1,JSON.stringify(sample));assert.ok(sample.detail.width>200,JSON.stringify(sample));assert.ok(sample.detail.right<=sample.library.right+1,JSON.stringify(sample));
    report.layouts.push({name,...sample});await shot('detail-'+name);
    if(name==='wide-zh'){
      const bounds=sample.detail;fs.writeFileSync(path.join(output,'detail-panel-zh.png'),(await win.webContents.capturePage({x:Math.floor(bounds.x),y:Math.floor(bounds.y),width:Math.ceil(bounds.width),height:Math.ceil(bounds.height)})).toPNG());
    }
    const reachable=await js("(()=>{const d=document.querySelector('.note-library-detail');d.scrollTop=d.scrollHeight;const r=d.querySelector('.note-detail-remove').getBoundingClientRect(),p=d.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom+1})()");
    assert.equal(reachable,true,name+': the removal action is reachable by scrolling');
    await js("document.querySelector('.note-library-detail').scrollTop=0");
  }
  win.setContentSize(1440,1000);await js("noteDetailTest.state.language='en';noteDetailTest.applyLanguage();noteDetailTest.noteLibraryRender()");await pause(100);
  const saved=()=>js("noteDetailTest.noteCards.entries.find(e=>e.id===detailEntryId).saved!==false");
  const remove=()=>js("document.querySelector('.note-detail-remove').focus();document.querySelector('.note-detail-remove').click()");
  await remove();assert.equal(await saved(),true,'opening removal does not mutate the entry');
  assert.equal(await js("document.activeElement.value"),'cancel');
  assert.match(await js("document.querySelector('#noteRemoveDescription').textContent"),/original card will stay on its canvas/);
  await shot('remove-confirm-en');
  await js("document.querySelector('.note-remove-dialog button[value=cancel]').click()");await until(()=>js("!document.querySelector('.note-remove-dialog')"),"cancel cleanup");
  assert.equal(await saved(),true);assert.equal(await js("document.activeElement.matches('.note-detail-remove')"),true);
  await remove();win.webContents.debugger.attach('1.3');
  for(const type of ['keyDown','keyUp'])await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  win.webContents.debugger.detach();await until(()=>js("!document.querySelector('.note-remove-dialog')"),"Escape cancels native modal");assert.equal(await saved(),true);
  await js("noteDetailTest.state.language='zh';noteDetailTest.applyLanguage();noteDetailTest.noteLibraryRender()");await remove();await shot('remove-confirm-zh');
  assert.equal(await js("document.activeElement.textContent"),'取消');assert.match(await js("document.querySelector('#noteRemoveDescription').textContent"),/原画布中的卡片会保留/);
  await js("document.querySelector('.note-remove-dialog button[value=remove]').click()");await until(async()=>!await saved(),"confirmed removal");
  assert.equal(await js("document.querySelector('.note-tile[data-note-id=\"'+detailEntryId+'\"]')"),null);
  assert.deepEqual(await originalWidget(),original,'confirmed removal preserves the live original');
  await js("noteDetailTest.noteLibraryPersist()");
  const removed=await js(`(async()=>{const r=await fetch(${JSON.stringify(cloudMode?'/api/v1/notes/':'/api/notes')}${cloudMode?'+encodeURIComponent(detailEntryId)':''},{credentials:'same-origin'}),data=await r.json();return ${cloudMode?'data.entry':'data.notes.find(e=>e.id===detailEntryId)'};})()`);
  assert.equal(removed.saved,false,'server persists the removal marker');
  report.checks.push('English and Chinese removal confirmation focuses Cancel. Cancel and native Escape retain the entry and restore focus. Explicit Remove persists its synchronization marker and leaves the Canvas original unchanged.');
  await js("document.querySelector('.note-tile[data-note-id=standalone-work]').click()");
  assert.equal(await js("document.querySelector('.note-detail-tags')"),null);assert.equal(await js("document.querySelector('.note-detail-summary')"),null);
  assert.equal(await js("document.querySelectorAll('.note-detail-secondary button').length"),1);
  const countBeforeShare=await js("noteDetailTest.state.widgets.length");
  await js("document.querySelector('.note-detail-share').click()");
  await until(()=>js("noteDetailTest.noteCards.panel.status.textContent.includes('原画布已不可用')"),"unavailable source explanation");
  assert.equal(await js("noteDetailTest.state.widgets.length"),countBeforeShare);
  assert.equal(await js("document.querySelector('.penecho-live-share-dialog')"),null);
  report.checks.push('An unavailable source Canvas keeps the library open and explains how to restore the copy for sharing without adding content automatically.');
  const workBefore=await js("JSON.stringify(noteDetailTest.noteCards.entries.find(e=>e.id==='standalone-work').note)");
  await remove();await js("noteDetailTest.closeNoteLibrary()");await until(()=>js("!document.querySelector('.note-remove-dialog')"),"closing library cancels modal");
  assert.equal(await js("noteDetailTest.noteCards.entries.find(e=>e.id==='standalone-work').saved!==false"),true);
  assert.equal(await js("JSON.stringify(noteDetailTest.noteCards.entries.find(e=>e.id==='standalone-work').note)"),workBefore);
  report.checks.push('Wide, tablet and narrow detail panes fit without horizontal overflow. Work notes without tags, summary, review or an available source Canvas retain a complete layout; closing the Library cancels removal.');
  assert.deepEqual(report.errors,[]);report.ok=true;
} catch(error) {report.failure=error.stack;console.error(error);if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());}
finally {
  win?.destroy();if(server){if(cloudMode)await server.close();else{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}}fs.rmSync(temporary,{recursive:true,force:true});report.serviceClosed=true;
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,checks:report.checks,failure:report.failure,output},null,2));app.exit(report.ok?0:1);
}});
