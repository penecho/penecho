"use strict";
// Canonical-source acceptance with an isolated profile and local service. The
// model transport uses the deterministic fixture; no Cloud account is touched.
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict"),{Readable}=require("node:stream");
const root=path.resolve(__dirname,".."),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-note-ui-"));
const pageSize=Number(process.argv.find(arg=>arg.startsWith("--page-size="))?.slice(12)||12);
assert.ok([2,12].includes(pageSize));
const output=path.resolve(process.argv.find(arg=>arg.startsWith("--output="))?.slice(9)||path.join(root,"docs/verification/notes-and-cards-20261003"));fs.mkdirSync(output,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"true",PENECHO_JEVISION_MOCK:"auto"});
const readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([fs.readFileSync(file,"utf8").replace("NOTE_LIBRARY_PAGE_SIZE = 12",`NOTE_LIBRARY_PAGE_SIZE = ${pageSize}`).replace(/\}\)\(\);\s*$/,`
    window.noteTest={state,noteCards,canvasDocumentsReady,canvasDocumentsCurrent,canvasDocumentsClose,noteLibraryLoad,noteLibraryCachePut,noteCardInsert,noteCardUpdate,noteLibraryUpsertWidget,noteLibraryPersist,noteLibrarySyncCurrent,noteLibraryForget,noteLibrarySaveWidget,noteLibraryAddToCanvas,noteLibraryReadEntry,noteLibraryRender,openNoteLibrary,closeNoteLibrary,noteRankLibrary,noteLibraryPut,applyLanguage,applyPageScale,applyTheme,requests:[]};
    penIntelRemote=()=>true;
    const noteFetch=window.fetch;window.fetch=(url,options)=>{if(String(url).endsWith('/api/suggest')&&options?.body)noteTest.requests.push(JSON.parse(options.body));return noteFetch(url,options);};
    window.prompt=(_message,value)=>value||'Saved note';
    window.alert=message=>console.error('Test alert: '+message);
  })();`)]);
  return readStream.call(this,file,...args);
};
let server,win;const report={pageSize,checks:[],layouts:[],errors:[],pages:[],mathjaxRequests:[]},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let n=0;n<120;n++){if(await check())return;await pause(100);}throw Error(`Timed out: ${label}`);}
app.whenReady().then(async()=>{try{
  server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
  const visible=process.argv.includes('--visible');
  win=new BrowserWindow({show:visible,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:!visible}});
  win.webContents.session.webRequest.onCompleted(details=>{
    const url=new URL(details.url);
    if(url.pathname==='/api/notes')report.pages.push({limit:url.searchParams.get('limit'),offset:url.searchParams.get('offset'),status:details.statusCode});
    if(/mathjax|mhchem/.test(url.pathname))report.mathjaxRequests.push({origin:url.origin,path:url.pathname,status:details.statusCode,fromCache:details.fromCache});
  });
  win.webContents.on("console-message",event=>{if(event.message.startsWith('note-'))console.log(event.message);if(event.level==='error')report.errors.push(event.message);});
  const js=code=>Promise.race([win.webContents.executeJavaScript(code,true),pause(15000).then(()=>{throw Error('Renderer action exceeded 15 seconds: '+code.slice(0,100));})]),shot=async name=>{
    report.lastCapture=name;
    for(let attempt=0;attempt<3;attempt++){
      await pause(150);
      try{fs.writeFileSync(path.join(output,`${name}.png`),(await win.webContents.capturePage()).toPNG());return;}
      catch(error){if(error.message!=='UnknownVizError'||attempt===2)throw Error(`Capture ${name}: ${error.message}`);}
    }
  };
  const initialize=()=>js(`(async()=>{const t=noteTest;await t.canvasDocumentsReady();await t.noteLibraryLoad();t.state.auto=false;t.state.language='zh';t.applyLanguage();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();})()`);
  console.log('Loading the isolated Canvas');
  await Promise.race([win.loadURL(`http://127.0.0.1:${server.address().port}`),pause(20000).then(()=>{throw Error('Canvas load exceeded 20 seconds');})]);
  console.log('Initializing Notes');await initialize();console.log('Creating a note');
  assert.deepEqual(report.pages,[],'Canvas startup must not fetch the library');
  await until(()=>js("Boolean(window.MathJax?.tex2svgPromise)"),'local MathJax ready');
  assert.equal(await js(`MathJax.tex2svgPromise('\\\\require{mhchem}\\\\ce{H2O}').then(node=>node.querySelector('svg')!==null)`),true);
  assert.ok(report.mathjaxRequests.every(request=>request.origin===`http://127.0.0.1:${server.address().port}`&&request.status===200));
  assert.ok(report.mathjaxRequests.some(request=>request.path.endsWith('/mhchem.js')));
  report.startup=await js(`(()=>{const navigation=performance.getEntriesByType('navigation')[0];return {libraryRequests:0,loadMs:Math.round(navigation.loadEventEnd),mathjax:performance.getEntriesByType('resource').filter(item=>item.name.includes('/vendor/mathjax-3.2.2/')).map(item=>({path:new URL(item.name).pathname,durationMs:Math.round(item.duration),transferredBytes:item.transferSize}))};})()`);
  const assetHeaders=await js("fetch('/vendor/mathjax-3.2.2/es5/tex-svg.js',{method:'HEAD'}).then(response=>({cache:response.headers.get('Cache-Control'),cdn:response.headers.get('Cloudflare-CDN-Cache-Control'),cookie:response.headers.has('Set-Cookie')}))");
  assert.equal(assetHeaders.cache,'public, max-age=31536000, immutable');assert.equal(assetHeaders.cdn,assetHeaders.cache);assert.equal(assetHeaders.cookie,false);
  const created=await js(`(async()=>{const t=noteTest,w=await t.noteCardInsert({title:'独立保存的研究笔记',summary:'Canvas 关闭以后也要保留。',style:'card',category:'concept',bookmarked:true,blocks:[{type:'markdown',text:'这是用户辛苦整理的内容，必须完整保留。'},{type:'formula',latex:'E=mc^2'}],created:Date.now(),updated:Date.now()});return {widgetId:w.id,id:JSON.parse(w.copyText).libraryId,canvasId:t.canvasDocumentsCurrent().id};})()`);
  const read=()=>js(`fetch('/api/notes?verification=durability').then(r=>r.json())`);
  assert.equal((await read()).notes[0].storage.server,true);
  await until(()=>js(`noteTest.state.widgets.find(w=>w.id===${JSON.stringify(created.widgetId)})?.mcpDocumentLoaded===true`),'note document load');
  await pause(250);
  await js(`window.dispatchEvent(new CustomEvent('penecho:community-widget-action',{detail:{action:'favorite',widgetId:${JSON.stringify(created.widgetId)}}}))`);
  await until(()=>js(`noteTest.state.widgets.find(w=>w.id===${JSON.stringify(created.widgetId)})?.favorite===true`),'favorite acknowledgement');
  assert.equal((await js(`fetch('/api/favorites').then(r=>r.json())`)).favorites.length,1);
  console.log('Closing the unsaved Canvas');await js(`(async()=>{await noteTest.canvasDocumentsClose(${JSON.stringify(created.canvasId)});})()`);assert.equal(await js('noteTest.state.widgets.length'),0);
  await js('noteTest.noteLibrarySyncCurrent()');await js('noteTest.noteLibraryPersist()');
  assert.equal((await read()).notes.find(entry=>entry.id===created.id).saved,true);
  await js(`noteTest.noteLibraryReadEntry(noteTest.noteCards.entries.find(e=>e.id===${JSON.stringify(created.id)}))`);
  await until(()=>js("document.querySelector('.note-reader')?.dataset.ready==='true'"),'standalone document load');
  let readerText='';for(const frame of win.webContents.mainFrame.framesInSubtree.filter(frame=>frame.url==='about:srcdoc')){const value=await frame.executeJavaScript('document.body.textContent');if(value.includes('必须完整保留'))readerText=value;}
  assert.match(readerText,/必须完整保留/);await pause(300);await shot('reader-without-canvas');await js('noteTest.noteCards.reader.close()');
  report.checks.push('Creation is acknowledged by the local server; Bookmark and Fav are retained. Closing the real unsaved Canvas keeps a complete independently browsable note.');
  await js(`noteTest.noteLibraryAddToCanvas(noteTest.noteCards.entries.find(e=>e.id===${JSON.stringify(created.id)}))`);
  assert.equal(await js('noteTest.state.widgets.length'),1);assert.equal(await js('JSON.parse(noteTest.state.widgets[0].copyText).bookmarked'),true);
  await js(`noteTest.noteLibraryForget(noteTest.noteCards.entries.find(e=>e.id===${JSON.stringify(created.id)}))`);await js('noteTest.noteLibraryPersist()');
  assert.equal(await js('noteTest.state.widgets.length'),1);await js('noteTest.noteLibrarySyncCurrent()');await js('noteTest.noteLibraryPersist()');
  assert.equal((await read()).notes.find(entry=>entry.id===created.id).saved,false);
  await js('noteTest.noteLibrarySaveWidget(noteTest.state.widgets[0])');assert.equal((await read()).notes.find(entry=>entry.id===created.id).saved,true);
  await js("void noteTest.noteCardUpdate(noteTest.state.widgets[0],note=>{note.title='修改也同步到独立备份';})");await js('noteTest.noteLibraryPersist()');
  await until(async()=>(await read()).notes.find(entry=>entry.id===created.id)?.note.title==='修改也同步到独立备份','edited source reaches backup');
  report.checks.push('Adding to the current Canvas restores full source. Removing the library copy preserves its Canvas widget and does not auto-revive. Explicit Save to Notes & Cards restores it; edits update the same snapshot.');
  assert.equal(await js(`(async()=>{const t=noteTest,w=t.state.widgets[0],source=JSON.parse(w.copyText);source.updated=1;source.blocks[0].text='MCP 编辑后的完整正文';w.copyText=JSON.stringify(source);const exact=w.copyText;await t.noteLibraryUpsertWidget(w,{sourceChanged:true});await t.noteLibraryPersist();return w.copyText===exact;})()`),true);
  report.checks.push('A source edit with an old authored timestamp updates the independent snapshot without rewriting the acknowledged Canvas source.');
  await js(`(async()=>{await noteTest.noteLibraryPersist();await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('penecho-note-library');r.onsuccess=resolve;r.onerror=()=>reject(r.error);});})()`);
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});await initialize();
  await js('noteTest.openNoteLibrary()');
  assert.equal(await js(`noteTest.noteCards.entries.find(e=>e.id===${JSON.stringify(created.id)}).note.title`),'修改也同步到独立备份');
  report.checks.push('Deleting the browser Notes cache and reloading restores the note from the independent server snapshot.');
  await js('noteTest.closeNoteLibrary({library:true})');
  await js("noteTest.noteLibraryCachePut({...PENECHO_NOTE_CARD.libraryEntry({id:'offline-recovery',note:{title:'Unacknowledged offline note',blocks:['Preserve this complete source']}}),localDirty:true})");
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});await initialize();
  assert.equal(await js("noteTest.noteCards.entries.some(entry=>entry.id==='offline-recovery')"),false,'startup does not eagerly open the recovery library');
  await js('noteTest.openNoteLibrary()');
  await until(()=>js("fetch('/api/notes/offline-recovery').then(async response=>response.ok&&(await response.json()).note.note.title==='Unacknowledged offline note')"),'recovering an offline-only note after opening its library');
  await js("noteTest.noteLibraryForget(noteTest.noteCards.entries.find(entry=>entry.id==='offline-recovery'))");await js('noteTest.noteLibraryPersist()');
  await js('noteTest.closeNoteLibrary({library:true})');
  report.checks.push('An offline-only recovery snapshot remains unopened at startup, then retries and reaches the server when Notes & Cards opens.');
  await js(`(async()=>{const t=noteTest,NOTE=PENECHO_NOTE_CARD;for(let i=1;i<100;i++)t.noteLibraryPut(NOTE.libraryEntry({id:'fixture-'+i,note:{title:(i===98?'BoundaryNeedle ':'')+'第 '+i+' 张笔记：很长的本地化标题用于检查窄屏展示',style:i%2?'card':'note',category:i%2?'concept':'idea',summary:'独立保存在 Notes & Cards。',tags:['研究','重要'],blocks:[{type:'markdown',text:'正文保留；排序只传标题和属性。'}],updated:Date.now()},updatedAt:Date.now()}));await t.noteLibraryPersist();t.noteCards.rankKey='';t.requests=[];await t.noteRankLibrary();})()`);
  assert.equal(await js("noteTest.requests.filter(r=>r.mode==='note_rank').length"),0);
  await js('noteTest.openNoteLibrary()');await pause(350);
  await js(`(()=>{const p=noteTest.noteCards.panel;p.sort.value='recent';p.sort.dispatchEvent(new Event('change'));p.sort.value='smart';p.sort.dispatchEvent(new Event('change'));p.input.value='   ';p.input.dispatchEvent(new Event('input'));})()`);await pause(250);
  assert.equal(await js("noteTest.requests.filter(r=>r.mode==='note_rank').length"),0);
  assert.match(await js('noteTest.noteCards.panel.status.textContent'),/本地排序/);
  assert.equal(await js('noteTest.noteCards.panel.sort.selectedOptions[0].textContent'),'智能');
  await shot('unfiltered-local-ranking');
  await js(`(()=>{const p=noteTest.noteCards.panel;p.input.value='研究';p.input.dispatchEvent(new Event('input'));})()`);
  await until(()=>js("noteTest.requests.some(r=>r.mode==='note_rank')&&!noteTest.noteCards.rankBusy"),'filtered ranking');
  const requests=await js("noteTest.requests.filter(r=>r.mode==='note_rank')");assert.equal(requests.length,1);assert.equal(requests[0].context.notes.length,pageSize);assert.equal(requests[0].context.query,'研究');assert.equal(Object.hasOwn(requests[0],'image'),false);
  await js(`(()=>{const p=noteTest.noteCards.panel;p.input.value='';p.input.dispatchEvent(new Event('input'));})()`);await pause(250);
  assert.equal(await js("noteTest.requests.filter(r=>r.mode==='note_rank').length"),1);
  assert.match(await js('noteTest.noteCards.panel.status.textContent'),/本地排序/);
  assert.equal(await js('noteTest.noteCards.panel.grid.querySelectorAll(".note-tile").length'),pageSize);
  report.ranking={unfilteredRequests:0,filteredRequests:requests.length,notes:requests[0].context.notes.length,hasImage:Object.hasOwn(requests[0],'image'),clearingRequests:0};
  report.checks.push(`Opening 100 saved notes fetches ${pageSize} cards. Smart and whitespace searches produce zero ranking POSTs; an active search ranks only the current page without images.`);
  for(const [name,width,language,theme,zoom,scale] of [['wide',1440,'zh','studio',1,1],['narrow-zh',390,'zh','studio',1,1],['narrow-en',390,'en','studio',1,1],['zoom-200',1440,'zh','studio',2,1],['scale-125',1024,'zh','studio',1,1.25],['dark',1440,'zh','scifi',1,1]]){
    win.webContents.setZoomFactor(zoom);win.setContentSize(width,1000);
    await js(`(async()=>{noteTest.state.language=${JSON.stringify(language)};noteTest.applyLanguage();noteTest.applyTheme(${JSON.stringify(theme)});noteTest.applyPageScale(${scale});noteTest.closeNoteLibrary({library:true});await noteTest.openNoteLibrary();})()`);await pause(300);
    const layout=await js(`(()=>{const e=document.querySelector('.note-library'),r=e.getBoundingClientRect(),tiles=[...e.querySelectorAll('.note-tile')];return {width:innerWidth,height:innerHeight,x:r.x,y:r.y,right:r.right,bottom:r.bottom,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,tiles:tiles.length,overflow:tiles.some(t=>t.scrollWidth>t.clientWidth+1),badges:[...e.querySelectorAll('.note-tile-storage')].slice(0,2).map(b=>b.textContent)};})()`);
    assert.ok(layout.x>=-1&&layout.right<=layout.width+1,name+JSON.stringify(layout));assert.equal(layout.overflow,false,name);assert.equal(layout.tiles,pageSize);assert.ok(layout.badges.length);report.layouts.push({name,...layout});await shot(name);
  }
  win.webContents.setZoomFactor(1);win.setContentSize(1440,1000);
  await js(`(async()=>{const t=noteTest;t.closeNoteLibrary({library:true});t.state.language='zh';t.applyLanguage();t.applyTheme('studio');t.applyPageScale(1);await t.openNoteLibrary();})()`);
  const before=report.pages.length;
  win.webContents.focus();
  report.scroll={initial:pageSize,afterGestures:[]};
  await js("window.noteScrollEvents=[];const grid=noteTest.noteCards.panel.grid;grid.addEventListener('wheel',event=>setTimeout(()=>noteScrollEvents.push({type:'wheel',delta:event.deltaY,prevented:event.defaultPrevented}),0));grid.addEventListener('scroll',()=>noteScrollEvents.push({type:'scroll',top:grid.scrollTop}));");
  await js("window.firstPageTile=noteTest.noteCards.panel.grid.querySelector('.note-tile')");
  await shot('first-page');
  for(let i=1;i<=3;i++){
    const previous=await js('noteTest.noteCards.panel.page.ids.length');
    for(let gesture=0;gesture<8;gesture++){
      win.focus();win.webContents.focus();await pause(100);
      const point=await js("(()=>{const r=noteTest.noteCards.panel.grid.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
      win.webContents.sendInputEvent({type:'mouseMove',...point});
      win.webContents.sendInputEvent({type:'mouseWheel',...point,deltaX:0,deltaY:-2000,canScroll:true});
      await pause(350);
      if(await js(`noteTest.noteCards.panel.page.ids.length>${previous}`))break;
    }
    report.scroll.lastGesture=await js("({events:noteScrollEvents,top:noteTest.noteCards.panel.grid.scrollTop,height:noteTest.noteCards.panel.grid.clientHeight,max:noteTest.noteCards.panel.grid.scrollHeight,tiles:noteTest.noteCards.panel.page.ids.length})");
    report.scroll.windowFocused=win.isFocused();
    await until(()=>js(`noteTest.noteCards.panel.grid.querySelectorAll('.note-tile').length>${previous}`),'next page '+i);
    const ids=await js('noteTest.noteCards.panel.page.ids');assert.equal(new Set(ids).size,ids.length);
    assert.equal(await js("firstPageTile===noteTest.noteCards.panel.grid.querySelector(`[data-note-id='${firstPageTile.dataset.noteId}']`)"),true,'paging and preview updates preserve existing tile nodes');
    report.scroll.afterGestures.push(ids.length);
  }
  assert.ok(report.pages.length-before>=3,'downward scrolling requests further pages');
  assert.deepEqual(report.pages.slice(before).map(page=>Number(page.offset)),Array.from({length:report.pages.length-before},(_,i)=>pageSize*(i+1)));
  assert.ok(report.pages.slice(before).every(page=>Number(page.limit)===pageSize));
  await shot('after-three-scrolls');
  await js(`(async()=>{const p=noteTest.noteCards.panel;p.input.value='BoundaryNeedle';p.sort.value='title';p.input.dispatchEvent(new Event('input'));})()`);
  await until(()=>js("noteTest.noteCards.panel.page.ids.length===1&&noteTest.noteCards.panel.page.ids[0]==='fixture-98'"),'search beyond the first page');
  await js(`(async()=>{const p=noteTest.noteCards.panel;p.input.value='';p.sort.value='title';p.category='concept';noteTest.noteLibraryRender();})()`);
  await until(()=>js(`!noteTest.noteCards.panel.page.pending&&noteTest.noteCards.panel.page.ids.length===${pageSize}`),'category page');
  await js("document.querySelector('.note-library-review').click()");
  await until(()=>js(`noteTest.noteCards.review?.queue.length===${pageSize}`),'paged review');
  for(let i=0;i<pageSize;i++){
    await js("document.querySelector('.note-review-reveal').click()");
    await js("document.querySelector('.grade-good').click()");
  }
  await until(()=>js(`noteTest.noteCards.review?.queue.length===${pageSize*2}&&!noteTest.noteCards.review.pending`),'next review batch');
  const reviewIds=await js('noteTest.noteCards.review.queue');assert.equal(new Set(reviewIds).size,reviewIds.length);
  report.checks.push('Search and category filters include the whole library. Review reads a bounded batch and continues after grading, without skipping remaining due cards.');
  await js("noteTest.closeNoteLibrary({library:true})");
  const closedRequests=report.pages.length;await pause(pageSize===12?31000:1500);assert.equal(report.pages.length,closedRequests);
  report.checks.push(`Native wheel input grows the library from ${pageSize} to ${report.scroll.afterGestures.join(', ')} cards. Every request returns at most ${pageSize} cards, offsets are continuous and IDs never repeat. Closing the panel stops reads.`);
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify({pageSize,checks:report.checks,scroll:report.scroll,startup:report.startup,errors:report.errors},null,2));
}catch(error){report.failure=error.stack;process.exitCode=1;console.error(error);}finally{
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');if(win&&!win.isDestroyed())win.destroy();if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}fs.rmSync(temporary,{recursive:true,force:true});app.exit(report.failure?1:0);
}});
