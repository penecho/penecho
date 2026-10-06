"use strict";
// Canonical local and officially mirrored Cloud clients, disposable services,
// accounts and browser profiles. Hold list responses to verify cache-first UI.
// Run: tools/electron/node_modules/.bin/electron scripts/verify-note-library-cache.cjs [--cloud]
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict"),{Readable}=require("node:stream"),{pathToFileURL}=require("node:url");
const root=path.resolve(__dirname,".."),cloudRoot=path.resolve(root,"../penecho_cloud"),cloud=process.argv.includes("--cloud"),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-note-cache-"));
const output=path.join(root,"docs/verification/note-library-cache-20261004",cloud?"cloud":"local");fs.mkdirSync(output,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const expose=source=>source.replace(/\}\)\(\);\s*$/,`
  const realNoteFetch=noteLibraryFetch;
  window.noteCacheTest={state,noteCards,canvasDocumentsReady,noteLibraryLoad,noteLibraryDb,noteLibraryCachePut,noteLibraryRecoverPending,noteLibraryPut,noteLibraryPersist,noteLibraryRequestPage,noteLibraryRefreshServer,noteLibraryRender,openNoteLibrary,closeNoteLibrary,noteThumbKey,applyLanguage,closeCanvasAgent,held:[],hold:false,requests:[],rawFetch:realNoteFetch,
    release(){this.hold=false;for(const release of this.held.splice(0))release();},
    dismiss(){markChangelogSeen();markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);closeFeatureTour({restore:false,scroll:false,changelog:false,retry:false});closeChangelog();}};
  noteLibraryFetch=async(url,options={})=>{
    const t=noteCacheTest;if((options.method||'GET')==='GET'&&/[?].*limit=/.test(url)){
      t.requests.push({url,at:performance.now()});
      if(t.hold)await new Promise((resolve,reject)=>{t.held.push(resolve);options.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
    }
    return realNoteFetch(url,options);
  };
  noteLibraryThumb=()=>Promise.resolve('');penIntelRemote=()=>false;
})();`),readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){if(!cloud&&path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([expose(fs.readFileSync(file,"utf8"))]);return readStream.call(this,file,...args);};
let server,win;const report={runtime:cloud?"cloud":"local",checks:[],errors:[],timings:{}},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let i=0;i<150;i++){if(await check())return;await pause(50);}throw Error("Timed out: "+label);}
app.whenReady().then(async()=>{try{
  let url,origin,cookies=[],account;
  const createAccount=async email=>{
    const password="Isolated Notes cache A9",registration=await server.inject({method:"POST",url:"/api/v1/auth/register",payload:{name:"Cache verification",email,password,termsAccepted:true,privacyAccepted:true}});
    await server.inject({method:"POST",url:"/api/v1/auth/verify-email",payload:{email,code:registration.json().developmentCode}});
    const login=await server.inject({method:"POST",url:"/api/v1/auth/login",payload:{email,password}});
    return {account:login.json().account,cookies:[].concat(login.headers["set-cookie"]).map(cookie=>{const [name,value]=cookie.split(";",1)[0].split("=");return {url:origin,name,value,path:"/",httpOnly:name!=="penecho_csrf"};})};
  };
  if(cloud){
    const {buildApp}=await import(pathToFileURL(path.join(cloudRoot,"src/app.mjs")).href),reservation=require("node:net").createServer();
    await new Promise(resolve=>reservation.listen(0,"127.0.0.1",resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));origin=`http://127.0.0.1:${port}`;
    server=await buildApp({logger:false,env:{NODE_ENV:"test",AUTH_MODE:"development",DATA_MODE:"memory",SESSION_MODE:"memory",STORAGE_MODE:"memory",CLOUD_NATIVE_CANVAS_ENABLED:"true",APP_ORIGIN:origin}});
    server.get("/canvas/app.js",{config:{rateLimit:false},compress:false},async(_request,reply)=>reply.type("application/javascript").send(expose(fs.readFileSync(path.join(cloudRoot,"public/canvas/app.js"),"utf8"))));
    server.addHook("onSend",async(request,_reply,payload)=>request.url.startsWith("/api/config.js")?String(payload)+"\nwindow.PENECHO_CONFIG.browserCanvasEditing=true;":payload);
    ({account,cookies}=await createAccount("cache-a@notes.test"));
    const project=await server.services.repository.createProject(account.id,{name:"Cache verification"}),canvas=await server.services.repository.createCanvas(account.id,project.id,{name:"Empty Canvas"});
    await server.listen({port,host:"127.0.0.1"});url=`${origin}/canvas/${canvas.id}`;
  }else{server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));origin=`http://127.0.0.1:${server.address().port}`;url=origin;}
  win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  for(const cookie of cookies)await win.webContents.session.cookies.set(cookie);
  win.webContents.on("console-message",event=>{if(event.level==="error")report.errors.push(event.message);});
  const js=code=>win.webContents.executeJavaScript(code,true),shot=async name=>{await js("noteCacheTest.dismiss()");await pause(100);fs.writeFileSync(path.join(output,name+".png"),(await win.webContents.capturePage()).toPNG());};
  const initialize=()=>js(`(async()=>{const t=noteCacheTest;await t.canvasDocumentsReady();await t.noteLibraryLoad();t.state.auto=false;t.state.language='zh';t.applyLanguage();t.closeCanvasAgent();t.dismiss();})()`);
  await win.loadURL(url);await until(()=>js("!!window.noteCacheTest"),"boot");await initialize();
  assert.equal(await js("noteCacheTest.requests.length"),0);
  await js(`new Promise((resolve,reject)=>{const name='penecho-note-library'+(PENECHO_CONFIG.runtime==='cloud'?':'+noteCacheTest.noteCards.accountId:''),r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('notes',{keyPath:'id'});r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('notes','readwrite');tx.objectStore('notes').put({id:'legacy-copy',saved:false,localDirty:false,version:3});tx.oncomplete=()=>{db.close();resolve();};};})`);
  await js(`(async()=>{const t=noteCacheTest,preview=document.createElement('canvas');preview.width=90;preview.height=120;preview.getContext('2d').fillRect(8,8,74,104);for(let i=0;i<30;i++){const entry=PENECHO_NOTE_CARD.libraryEntry({id:'cache-'+String(i).padStart(2,'0'),note:{title:'缓存测试 '+String(i).padStart(2,'0'),style:i%2?'note':'card',category:i%2?'idea':'concept',tags:['缓存'],blocks:['完整正文 '+i],updated:1000+i},updatedAt:1000+i});entry.thumb=preview.toDataURL('image/png');entry.thumbDigest=t.noteThumbKey(entry);t.noteLibraryPut(entry);}await t.noteLibraryPersist();})()`);
  assert.deepEqual(await js(`(async()=>{const db=await noteCacheTest.noteLibraryDb();try{return await new Promise(resolve=>{const notes=db.transaction('notes','readonly').objectStore('notes'),r=notes.get('legacy-copy');r.onsuccess=()=>resolve({version:db.version,pendingIndex:notes.indexNames.contains('pending'),legacyVersion:r.result.version,indexValue:r.result.cachePending});});}finally{db.close();}})()`),{version:2,pendingIndex:true,legacyVersion:3,indexValue:0});
  report.checks.push("Upgrading the existing version-one recovery database preserves its records and adds the pending-only index.");
  await js("noteCacheTest.hold=true;noteCacheTest.started=performance.now();void (noteCacheTest.opening=noteCacheTest.openNoteLibrary())");
  await until(()=>js("noteCacheTest.held.length>0"),"cold request held");
  assert.equal(await js("document.querySelectorAll('.note-tile').length"),0);await shot("cold-pending");
  await js("noteCacheTest.release();noteCacheTest.opening");
  await js("noteCacheTest.noteCards.cachePersist");
  assert.equal(await js("document.querySelectorAll('.note-tile').length"),12);
  await js("noteCacheTest.noteLibraryRequestPage()");await js("noteCacheTest.noteCards.cachePersist");
  assert.equal(await js("noteCacheTest.noteCards.panel.page.ids.length"),24);
  await js("noteCacheTest.noteCards.panel.grid.scrollTop=240;noteCacheTest.scroll=noteCacheTest.noteCards.panel.grid.scrollTop;noteCacheTest.closeNoteLibrary({library:true});noteCacheTest.hold=true;noteCacheTest.started=performance.now();void (noteCacheTest.opening=noteCacheTest.openNoteLibrary())");
  await until(()=>js("noteCacheTest.held.length>0"),"warm refresh held");
  report.timings.warm=await js("({tiles:document.querySelectorAll('.note-tile').length,firstDisplayMs:Math.round(performance.now()-noteCacheTest.started),scroll:noteCacheTest.noteCards.panel.grid.scrollTop,expectedScroll:noteCacheTest.scroll,pending:!!noteCacheTest.noteCards.panel.page.pending})");
  assert.equal(report.timings.warm.tiles,24);assert.equal(report.timings.warm.scroll,report.timings.warm.expectedScroll);assert.equal(report.timings.warm.pending,true);
  const existing=await js("noteCacheTest.noteCards.panel.page.ids.slice()");
  await shot("warm-pending");await js("noteCacheTest.release();noteCacheTest.opening");
  assert.deepEqual(await js("noteCacheTest.noteCards.panel.page.ids.slice()"),existing);
  assert.equal(await js("noteCacheTest.noteCards.panel.grid.scrollTop"),report.timings.warm.scroll);
  report.checks.push("Cold load has no tiles while its response is held; reopening shows all 24 previously opened cards with the same scroll before the network is released.");
  await js("noteCacheTest.closeNoteLibrary({library:true});noteCacheTest.noteCards.cachePersist");
  await win.loadURL(url);await initialize();
  await js("noteCacheTest.hold=true;noteCacheTest.started=performance.now();void (noteCacheTest.opening=noteCacheTest.openNoteLibrary())");
  await until(()=>js("noteCacheTest.held.length>0"),"reload refresh held");
  report.timings.reload=await js("({tiles:document.querySelectorAll('.note-tile').length,firstDisplayMs:Math.round(performance.now()-noteCacheTest.started),entries:noteCacheTest.noteCards.entries.length,previews:document.querySelectorAll('.note-tile img').length})");
  assert.equal(report.timings.reload.tiles,24);assert.equal(report.timings.reload.entries,24);assert.equal(report.timings.reload.previews,24);
  await shot("reload-pending");await js("noteCacheTest.release();noteCacheTest.opening");
  report.checks.push("A full reload restores only the 24 opened IDs, complete sources and previews from IndexedDB before the server list responds; the other six cached sources are not loaded.");
  await js(`(async()=>{const t=noteCacheTest,entry=t.noteCards.entries.find(e=>e.id===${JSON.stringify(existing[0])});await t.rawFetch(${JSON.stringify(cloud?"/api/v1/notes/":"/api/notes/")}+encodeURIComponent(entry.id),{method:'PUT',body:JSON.stringify({entry:{...entry,saved:false},expectedVersion:entry.version,...${cloud?"{accountId:t.noteCards.accountId}":"{}"}})});await t.noteLibraryRefreshServer();})()`);
  assert.equal(await js(`noteCacheTest.noteCards.panel.page.ids.includes(${JSON.stringify(existing[0])})`),false);
  assert.equal(await js("noteCacheTest.noteCards.panel.page.ids.length"),24);assert.equal(await js("noteCacheTest.noteCards.panel.page.nextOffset"),24);
  await js("noteCacheTest.noteLibraryRequestPage()");assert.equal(await js("noteCacheTest.noteCards.panel.page.ids.length"),29);
  assert.equal(await js("new Set(noteCacheTest.noteCards.panel.page.ids).size"),29);
  report.checks.push("A server-side removal disappears after refresh; pagination continues at the fresh boundary with all remaining 29 IDs and no duplicates.");
  await js(`noteCacheTest.noteLibraryCachePut({...PENECHO_NOTE_CARD.libraryEntry({id:'indexed-offline-note',note:{title:'离线待同步笔记',blocks:['Complete offline source']}}),localDirty:true,version:0})`);
  const pendingIds=()=>js(`(async()=>{const db=await noteCacheTest.noteLibraryDb();try{return await new Promise(resolve=>{const r=db.transaction('notes','readonly').objectStore('notes').index('pending').getAll(1);r.onsuccess=()=>resolve(r.result.map(entry=>entry.id));});}finally{db.close();}})()`);
  assert.deepEqual(await pendingIds(),['indexed-offline-note']);
  await js("(async()=>{await noteCacheTest.noteLibraryRecoverPending();await noteCacheTest.noteLibraryPersist();})()");
  assert.deepEqual(await pendingIds(),[]);
  assert.equal(await js(`noteCacheTest.rawFetch(${JSON.stringify((cloud?"/api/v1/notes/":"/api/notes/")+"indexed-offline-note")}).then(body=>(body.note||body.entry).note.blocks[0].text)`),'Complete offline source');
  report.checks.push("The pending-only index restores an offline-only full source to the real server and clears its acknowledged outbox marker.");
  if(cloud){
    const second=await createAccount("cache-b@notes.test");for(const cookie of second.cookies)await win.webContents.session.cookies.set(cookie);
    await js("window.dispatchEvent(new CustomEvent('penecho:cloud-account-changed'))");
    assert.equal(await js("document.querySelectorAll('.note-tile').length"),0);
    await until(()=>js("noteCacheTest.noteCards.accountId!==null&&!noteCacheTest.noteCards.panel.page.pending"),"second account settled");
    assert.equal(await js("noteCacheTest.noteCards.accountId"),second.account.id);assert.equal(await js("noteCacheTest.noteCards.entries.length"),0);
    report.checks.push("A real Cloud cookie/account switch revokes visible rows immediately and restores no first-account notes into the second account.");
  }
  assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.failure=error.stack;console.error(error);}finally{
  win?.destroy();if(server){if(cloud)await server.close();else await new Promise(resolve=>server.close(resolve));}
  fs.rmSync(temporary,{recursive:true,force:true});report.cleanedUp=true;fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
}});
