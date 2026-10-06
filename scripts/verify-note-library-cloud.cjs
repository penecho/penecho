"use strict";
// Verify officially mirrored Canvas against an isolated real Cloud application.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),cloudRoot=path.resolve(root,'../penecho_cloud'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-note-cloud-ui-')),output=path.join(root,'docs/verification/notes-and-cards-20261003');
app.setPath('userData',path.join(temporary,'profile'));let service,win;const report={checks:[],errors:[]},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<150;i++){if(await fn())return;await pause(100);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{try{
  const {buildApp}=await import(pathToFileURL(path.join(cloudRoot,'src/app.mjs')).href);
  const reservation=require('node:net').createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port,origin='http://127.0.0.1:'+port;await new Promise(resolve=>reservation.close(resolve));
  service=await buildApp({logger:false,env:{NODE_ENV:'test',AUTH_MODE:'development',DATA_MODE:'memory',SESSION_MODE:'memory',STORAGE_MODE:'memory',CLOUD_NATIVE_CANVAS_ENABLED:'true',APP_ORIGIN:origin}});
  const mirrored=fs.readFileSync(path.join(cloudRoot,'public/canvas/app.js'),'utf8');
  service.get('/canvas/app.js',{config:{rateLimit:false},compress:false},async(_request,reply)=>reply.type('application/javascript').send(mirrored.replace(/\}\)\(\);\s*$/,`window.noteCloudTest={state,noteCards,canvasDocumentsReady,canvasDocumentsCurrent,canvasDocumentsClose,noteCardInsert,noteLibraryPersist,noteLibraryLoad,noteLibraryRefreshServer,noteLibraryReadEntry,noteLibraryForget,openNoteLibrary};})();`)));
  service.addHook('onSend',async(request,reply,payload)=>request.url.startsWith('/api/config.js')?String(payload)+'\nwindow.PENECHO_CONFIG.browserCanvasEditing=true;':payload);
  const email='cloud-ui@notes.test',password='Isolated Cloud notes A9';
  const registration=await service.inject({method:'POST',url:'/api/v1/auth/register',payload:{name:'Notes UI',email,password,termsAccepted:true,privacyAccepted:true}});
  await service.inject({method:'POST',url:'/api/v1/auth/verify-email',payload:{email,code:registration.json().developmentCode}});
  const login=await service.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password}}),account=login.json().account;
  const project=await service.services.repository.createProject(account.id,{name:'Isolated UI'}),canvas=await service.services.repository.createCanvas(account.id,project.id,{name:'Cloud original'});
  await service.listen({port,host:'127.0.0.1'});
  win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  for(const cookie of [].concat(login.headers['set-cookie'])){const [name,value]=cookie.split(';',1)[0].split('=');await win.webContents.session.cookies.set({url:origin,name,value,path:'/',httpOnly:name!=='penecho_csrf'});}
  win.webContents.on('console-message',event=>{if(event.level==='error')report.errors.push(event.message);});
  const js=code=>win.webContents.executeJavaScript(code,true);
  console.log('Loading isolated native Cloud Canvas');await win.loadURL(origin+'/canvas/'+canvas.id);await until(()=>js('!!window.noteCloudTest'),'Cloud Canvas boot');
  console.log('Creating and saving through Cloud');const id=await js(`(async()=>{const t=noteCloudTest;await t.canvasDocumentsReady();await t.noteLibraryLoad();t.state.auto=false;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();const w=await t.noteCardInsert(PENECHO_NOTE_CARD.normalize({title:'云端独立笔记',blocks:[{type:'markdown',text:'云端数据不依赖原画布。'}]}));return JSON.parse(w.copyText).libraryId;})()`);
  const stored=await service.services.repository.getNote(account.id,id);assert.equal(stored.entry.note.title,'云端独立笔记');
  assert.equal(await js(`noteCloudTest.noteCards.entries.find(e=>e.id===${JSON.stringify(id)}).storage.cloud`),'saved');
  await js(`(async()=>{await noteCloudTest.canvasDocumentsClose(noteCloudTest.canvasDocumentsCurrent().id);})()`);
  await service.services.repository.trashCanvas(account.id,canvas.id);
  await service.services.repository.permanentlyDeleteCanvas(account.id,canvas.id,null,async()=>{});
  await js(`(async()=>{await noteCloudTest.noteLibraryPersist();const name='penecho-note-library:'+noteCloudTest.noteCards.accountId;await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error);});noteCloudTest.noteCards.entries=null;noteCloudTest.noteCards.loading=null;await noteCloudTest.noteLibraryLoad();})()`);
  assert.equal(await js(`noteCloudTest.noteCards.entries.find(e=>e.id===${JSON.stringify(id)}).note.title`),'云端独立笔记');
  await js(`void noteCloudTest.noteLibraryReadEntry(noteCloudTest.noteCards.entries.find(e=>e.id===${JSON.stringify(id)}))`);
  await until(()=>js("document.querySelector('.note-reader')?.dataset.ready==='true'"),'Cloud standalone reader');
  fs.writeFileSync(path.join(output,'cloud-reader.png'),(await win.webContents.capturePage()).toPNG());
  report.checks.push('The officially mirrored Cloud Canvas writes a full independent snapshot using real login cookies and CSRF; the Cloud badge reflects the acknowledged write.');
  report.checks.push('Deleting the original Cloud Canvas and the account-scoped browser cache preserves the note and standalone rendering.');
  await js('noteCloudTest.noteCards.reader.close()');
  const secondEmail='second-cloud-ui@notes.test',registration2=await service.inject({method:'POST',url:'/api/v1/auth/register',payload:{name:'Other account',email:secondEmail,password,termsAccepted:true,privacyAccepted:true}});
  await service.inject({method:'POST',url:'/api/v1/auth/verify-email',payload:{email:secondEmail,code:registration2.json().developmentCode}});
  const login2=await service.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:secondEmail,password}});
  for(const cookie of [].concat(login2.headers['set-cookie'])){const [name,value]=cookie.split(';',1)[0].split('=');await win.webContents.session.cookies.set({url:origin,name,value,path:'/',httpOnly:name!=='penecho_csrf'});}
  await js('noteCloudTest.noteLibraryRefreshServer()');assert.equal(await js('noteCloudTest.noteCards.entries.length'),0);
  assert.equal(await js('noteCloudTest.noteCards.accountId'),login2.json().account.id);
  report.checks.push('Switching the Cloud login clears the previous account library and uses a separate browser recovery cache.');
  assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.failure=error.stack;console.error(error);}finally{win?.destroy();await service?.close();fs.rmSync(temporary,{recursive:true,force:true});fs.writeFileSync(path.join(output,'cloud-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);}});
