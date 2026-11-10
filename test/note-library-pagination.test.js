"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),NOTE=require("../public/note-card.js");
const source=fs.readFileSync(require.resolve("../src/client/app/note-cards.js"),"utf8");
const entry=id=>NOTE.libraryEntry({id,note:{title:id,blocks:["Complete source"]}});
function harness(fetch,cache=[],pages=new Map()){
  const requests=[],writes=[],renders=[],cached=new Map(cache.map(entry=>[entry.id,entry]));
  const panel={input:{value:""},sort:{value:"title"},category:"",bookmarked:false,count:{textContent:""},grid:{scrollTop:0,clientHeight:500,scrollHeight:500},
    detail:{hidden:true},page:{ids:[],nextOffset:0,key:"",generation:0,pending:null,total:null,categories:[]}},
    noteCards={panel,entries:[],accountId:"a",dirty:new Set(),entryLoads:new Map(),loadedIds:new Set(),pageCache:new Map(),lastView:null,cachePersist:Promise.resolve()};
  panel.grid.replaceChildren=()=>{};
  const request=result=>{const r={result};queueMicrotask(()=>r.onsuccess?.());return r;};
  const context={noteCards,NOTE_LIBRARY_PAGE_SIZE:2,NOTE_LIBRARY_STORE:"notes",NOTE_LIBRARY_PAGE_STORE:"pages",NOTE_LIBRARY_CACHE_VIEWS:8,NOTE_LIBRARY_CACHE_ROWS:120,URLSearchParams,AbortController,setTimeout,clearTimeout,
    noteCardRuntime:()=>NOTE,noteCopy:english=>english,noteLibraryApi:()=>"/api/notes",noteLibraryLoad:async()=>{},noteLibraryRender:()=>renders.push({ids:[...panel.page.ids],scrollTop:panel.grid.scrollTop}),
    noteLibraryPersistSoon:()=>writes.push("persist"),noteLibraryCachePut:async entry=>cached.set(entry.id,entry),
    requestResult:r=>Promise.resolve(r.result),noteLibraryDb:async()=>({close(){},transaction:()=>{
      const tx={objectStore:name=>{const rows=name==='pages'?pages:cached;return {get:id=>request(rows.get(id)),getAll:()=>request([...rows.values()]),put:value=>rows.set(value.id,structuredClone(value)),delete:id=>rows.delete(id)};}};
      setImmediate(()=>tx.oncomplete?.());return tx;
    }}),
    noteLibraryFetch:async(url,options)=>{requests.push({url,options});return fetch(url,options);}};
  vm.runInNewContext(source.slice(source.indexOf("  function noteLibrarySetAccount("),source.indexOf("  function noteLibraryDb("))+
    source.slice(source.indexOf("  function noteLibraryViewKey("),source.indexOf("  async function openNoteLibrary("))+"\nglobalThis.page=noteLibraryRequestPage;",context);
  return {context,noteCards,panel,requests,writes,cached,pages,renders};
}
test("one request per page and no eager continuation when the first page fits",async()=>{
  const notes=Array.from({length:5},(_,i)=>entry(`note-${i}`));
  const h=harness(async url=>NOTE.libraryPage(notes,Object.fromEntries(new URL(url,"http://local").searchParams)));
  await h.context.page({reset:true});assert.equal(h.requests.length,1);assert.equal(h.panel.page.ids.length,2);
  await Promise.all([h.context.page(),h.context.page()]);assert.equal(h.requests.length,2);assert.equal(h.panel.page.ids.length,4);
  await h.context.page();await h.context.page();assert.equal(h.requests.length,3);assert.equal(h.panel.page.ids.length,5);assert.equal(h.panel.page.nextOffset,null);
  assert.equal(new Set(h.panel.page.ids).size,5);
});
test("changing a filter aborts the previous request and ignores its late response",async()=>{
  const pending=[];const h=harness(()=>new Promise(resolve=>pending.push(resolve)));
  const first=h.context.page({reset:true});await new Promise(setImmediate);
  h.panel.input.value="new";const second=h.context.page({reset:true});await new Promise(setImmediate);
  assert.equal(h.requests[0].options.signal.aborted,true);
  pending[1](NOTE.libraryPage([entry("new")],{limit:2}));await second;
  pending[0](NOTE.libraryPage([entry("old")],{limit:2}));await first;
  assert.deepEqual(Array.from(h.panel.page.ids),["new"]);assert.equal(h.noteCards.entries.some(entry=>entry.id==="old"),false);
});
test("a pending offline edit survives paging and is retried without replacing its recovery copy",async()=>{
  const local={...entry("same"),localDirty:true,version:7,note:{...entry("same").note,title:"Offline edit"}};
  const h=harness(async()=>NOTE.libraryPage([entry("same")],{limit:2}),[local]);await h.context.page({reset:true});
  assert.equal(h.noteCards.entries[0].note.title,"Offline edit");assert.equal(h.noteCards.entries[0].version,7);assert.equal(h.cached.get("same").note.title,"Offline edit");
  assert.equal(h.noteCards.dirty.has("same"),true);assert.equal(h.writes.length,1);
});
test("cached recovery remains paged during an outage",async()=>{
  const h=harness(async()=>{throw Error("offline");},Array.from({length:5},(_,i)=>entry(`cached-${i}`)));
  await h.context.page({reset:true});assert.equal(h.panel.page.ids.length,2);assert.ok(h.panel.page.error);
  await h.context.page();assert.equal(h.panel.page.ids.length,4);await h.context.page();assert.equal(h.panel.page.ids.length,5);assert.equal(h.panel.page.nextOffset,null);
});
test("closing the library or switching accounts prevents an in-flight page from entering state",async()=>{
  for(const close of [true,false]){
    let resolve;const h=harness(()=>new Promise(done=>{resolve=done;}));const pending=h.context.page({reset:true});await new Promise(setImmediate);
    if(close){h.panel.page.controller.abort();h.noteCards.panel=null;}else h.noteCards.accountId="b";
    resolve(NOTE.libraryPage([entry("private-a")],{limit:2}));await pending;assert.equal(h.noteCards.entries.length,0);
  }
});
test("category and tag are sent together and tag changes discard the previous page",async()=>{
  const pending=[],h=harness(()=>new Promise(resolve=>pending.push(resolve)));
  h.panel.category='concept';h.panel.tag='research';
  const first=h.context.page({reset:true});await new Promise(setImmediate);
  const params=new URL(h.requests[0].url,'http://local').searchParams;
  assert.equal(params.get('category'),'concept');assert.equal(params.get('tag'),'research');
  h.panel.tag='advanced';const second=h.context.page({reset:true});await new Promise(setImmediate);
  assert.equal(h.requests[0].options.signal.aborted,true);
  const advanced=NOTE.libraryEntry({id:'advanced',note:{title:'Advanced',category:'concept',tags:['advanced'],blocks:['Full source']}});
  pending[1](NOTE.libraryPage([advanced],{category:'concept',tag:'advanced'}));await second;
  pending[0](NOTE.libraryPage([entry('old')]));await first;
  assert.deepEqual(Array.from(h.panel.page.ids),['advanced']);assert.equal(h.panel.page.tags[0].id,'advanced');
  assert.equal(h.noteCards.entries.some(entry=>entry.id==='old'),false);
});
test("offline pages compute reciprocal facets from the whole cache",async()=>{
  const notes=['concept','idea'].map((category,index)=>NOTE.libraryEntry({id:`cached-tag-${index}`,note:{title:`Cached ${index}`,category,tags:['研究'],blocks:['Full source']}}));
  const h=harness(async()=>{throw Error('offline');},notes);h.panel.category='idea';h.panel.tag='研究';
  await h.context.page({reset:true});
  assert.deepEqual(Array.from(h.panel.page.ids),['cached-tag-1']);assert.equal(h.panel.page.tags[0].count,1);
  assert.equal(h.panel.page.tagTotal,1);assert.equal(h.panel.page.categoryTotal,2);
});
test("a cached view is visible before a slow refresh and survives its failure",async()=>{
  const h=harness(async()=>NOTE.libraryPage([entry('cached-first'),entry('cached-second')],{limit:2,sort:'title'}));
  await h.context.page({reset:true});await h.noteCards.cachePersist;
  let reject;h.context.noteLibraryFetch=()=>new Promise((_resolve,no)=>{reject=no;});
  h.panel.grid.scrollTop=240;
  const refreshing=h.context.page({reset:true});await new Promise(setImmediate);
  assert.deepEqual(Array.from(h.panel.page.ids),['cached-first','cached-second']);
  assert.equal(h.panel.grid.scrollTop,240);assert.ok(h.panel.page.pending);
  reject(Error('offline'));await refreshing;
  assert.deepEqual(Array.from(h.panel.page.ids),['cached-first','cached-second']);
  assert.equal(h.panel.grid.scrollTop,240);assert.ok(h.panel.page.error);
});
test("reload restores the last filter, full source and preview without fetching or scanning all notes",async()=>{
  const note={...entry('kept'),thumb:'data:image/webp;base64,preview'};
  note.note.tags=['research'];
  const h=harness(async()=>NOTE.libraryPage([note],{limit:2,tag:'research'}));h.panel.tag='research';
  await h.context.page({reset:true});h.panel.grid.scrollTop=180;h.panel.selectedId='kept';h.context.noteLibraryCachePage();await h.noteCards.cachePersist;
  const reloaded=harness(()=>{throw Error('must not fetch during cache restore');},[...h.cached.values()],h.pages);
  await reloaded.context.noteLibraryRestorePage(reloaded.panel,{last:true});
  assert.equal(reloaded.panel.tag,'research');assert.equal(reloaded.panel.restoreScrollTop,180);assert.equal(reloaded.panel.selectedId,'kept');
  assert.deepEqual(Array.from(reloaded.panel.page.ids),['kept']);assert.equal(reloaded.noteCards.entries[0].thumb,note.thumb);
  assert.equal(reloaded.noteCards.entries[0].note.blocks[0].text,'Complete source');assert.equal(reloaded.requests.length,0);
});
test("background refresh replaces deleted IDs, revalidates just the opened prefix and resumes at its boundary",async()=>{
  let notes=Array.from({length:7},(_,i)=>entry(`note-${i}`));
  const h=harness(async url=>NOTE.libraryPage(notes,Object.fromEntries(new URL(url,'http://local').searchParams)));
  await h.context.page({reset:true});await h.context.page();await h.noteCards.cachePersist;
  assert.equal(h.panel.page.ids.length,4);
  notes=notes.filter(note=>note.id!=='note-1');notes[0]={...notes[0],note:{...notes[0].note,title:'Changed'}};
  const before=h.requests.length;h.panel.grid.scrollTop=130;await h.context.page({reset:true});
  assert.equal(h.requests.length-before,2);assert.equal(h.panel.grid.scrollTop,130);
  assert.deepEqual(Array.from(h.panel.page.ids),['note-0','note-2','note-3','note-4']);assert.equal(h.panel.page.nextOffset,4);
  await h.context.page();assert.deepEqual(Array.from(h.panel.page.ids),['note-0','note-2','note-3','note-4','note-5','note-6']);
});
test("returning to a cached filter restores it before the response and ignores an older filter",async()=>{
  const h=harness(async()=>NOTE.libraryPage([entry('all')],{limit:2}));await h.context.page({reset:true});await h.noteCards.cachePersist;
  const pending=[];h.context.noteLibraryFetch=()=>new Promise(resolve=>pending.push(resolve));
  h.panel.input.value='other';const other=h.context.page({reset:true});await new Promise(setImmediate);
  h.panel.input.value='';const all=h.context.page({reset:true});await new Promise(setImmediate);
  assert.deepEqual(Array.from(h.panel.page.ids),['all']);
  pending[1](NOTE.libraryPage([entry('fresh')],{limit:2}));await all;
  pending[0](NOTE.libraryPage([entry('other')],{limit:2}));await other;
  assert.deepEqual(Array.from(h.panel.page.ids),['fresh']);
});
test("authorization failure revokes cached notes and never falls back to the old account",async()=>{
  const h=harness(async()=>NOTE.libraryPage([entry('private')],{limit:2}));await h.context.page({reset:true});await h.noteCards.cachePersist;
  h.context.noteLibraryFetch=async()=>{throw Object.assign(Error('signed out'),{status:401});};
  await h.context.page({reset:true});
  assert.equal(h.noteCards.accountId,'anonymous');assert.equal(h.noteCards.entries.length,0);assert.equal(h.noteCards.pageCache.size,0);
  assert.equal(h.panel.page.ids.length,0);assert.equal(h.panel.page.error,'Sign in to read your notes.');
});
test("initial account discovery preserves an explicitly requested card focus",()=>{
  const h=harness(async()=>({notes:[],nextOffset:null}));h.noteCards.accountId=null;
  h.panel.focusId=h.panel.selectedId='requested-card';h.context.noteLibrarySetAccount('first-account');
  assert.equal(h.panel.focusId,'requested-card');assert.equal(h.panel.selectedId,'requested-card');
  h.context.noteLibrarySetAccount('second-account');assert.equal(h.panel.focusId,'');assert.equal(h.panel.selectedId,'');
});
test("persistent view metadata is bounded and cannot overwrite a pending recovery snapshot",async()=>{
  const dirty={...entry('dirty'),localDirty:true,version:8};
  const h=harness(async()=>NOTE.libraryPage([entry('dirty')],{limit:2}),[dirty]);
  await h.context.page({reset:true});await h.noteCards.cachePersist;
  h.noteCards.entries=[entry('dirty')];h.context.noteLibraryCachePage();await h.noteCards.cachePersist;
  assert.equal(h.cached.get('dirty').localDirty,true);assert.equal(h.cached.get('dirty').version,8);
  for(let i=0;i<11;i++){h.panel.input.value=`view-${i}`;h.panel.page.key=h.context.noteLibraryViewKey(h.panel);h.context.noteLibraryCachePage();}
  await h.noteCards.cachePersist;assert.equal(h.noteCards.pageCache.size,8);assert.equal(h.pages.size,9);
  h.panel.page.ids=Array.from({length:125},(_,i)=>`id-${i}`);h.panel.grid.scrollTop=999;h.context.noteLibraryCachePage();await h.noteCards.cachePersist;
  const saved=h.pages.get(h.panel.page.key);assert.equal(saved.page.ids.length,120);assert.equal(saved.page.nextOffset,120);assert.equal(saved.scrollTop,0);
});
