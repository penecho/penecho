"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const {NoteLibrary}=require("../src/server/note-library.js"),NOTE=require("../public/note-card.js");
const {CloudConnector}=require("../src/server/cloud-connector.js");
const snapshot=(id="note-a",title="A note")=>NOTE.libraryEntry({id,note:{title,libraryId:id,created:1,updated:2,bookmarked:true,blocks:[{type:"image",src:"data:image/png;base64,AAAA",alt:"Original picture"},{type:"markdown",text:"Complete source"}]},documentId:"unsaved-canvas",objectId:"widget-1",createdAt:1,updatedAt:2});
async function fixture(t,connector) {const directory=await fs.mkdtemp(path.join(os.tmpdir(),"penecho-notes-test-"));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return new NoteLibrary(directory,()=>connector);}
function cloud() {
  const notes=new Map(),state={account:{id:"account-a"},accountSession:{signedIn:true}},calls=[];
  return {notes,state,calls,status:()=>state,
    async saveNote(id,entry,expectedVersion) {calls.push(id);const previous=notes.get(id);if((previous?.version||0)!==expectedVersion)throw Object.assign(Error("conflict"),{status:409});const result={entry:structuredClone(entry),version:expectedVersion+1};notes.set(id,result);return result;},
    async listNotes(){return {notes:[...notes].map(([id,row])=>({id,version:row.version})),nextCursor:null};},async getNote(id){return notes.get(id);}};
}
test("unsaved-Canvas notes, images and bookmarks survive a fresh service instance",async t=>{
  const library=await fixture(t),saved=await library.put(snapshot(),0);
  assert.equal(saved.storage.server,true);
  const restarted=new NoteLibrary(library.directory),all=await restarted.list();
  assert.equal(all.length,1);assert.equal(all[0].note.blocks[0].src,"data:image/png;base64,AAAA");assert.equal(all[0].note.bookmarked,true);
  assert.equal(all[0].note.blocks[1].text,"Complete source");
});
test("removal keeps a durable tombstone and can explicitly restore the library copy",async t=>{
  const library=await fixture(t);await library.put(snapshot(),0);
  const removed=await library.put({...snapshot(),saved:false},1);assert.equal(removed.saved,false);
  assert.equal((await new NoteLibrary(library.directory).list())[0].saved,false);
  const restored=await library.put({...snapshot(),saved:true},2);assert.equal(restored.saved,true);assert.equal(restored.version,3);
  assert.equal((await fs.readdir(path.join(library.directory,"history"))).length,1);
});
test("stale writers and failed disk writes cannot replace an acknowledged note",async t=>{
  const library=await fixture(t);await library.put(snapshot(),0);await library.put(snapshot("note-a","Updated"),1);
  await assert.rejects(library.put(snapshot("note-a","Stale"),1),{status:409});
  const atomic=library.atomic;library.atomic=async function(file,value){if(path.dirname(file)===this.directory)throw Error("disk full");return atomic.call(this,file,value);};
  await assert.rejects(library.put(snapshot("note-a","Failed write"),2),/disk full/);
  assert.equal((await new NoteLibrary(library.directory).list())[0].note.title,"Updated");
});
test("Cloud outbox survives restart, retries failures and propagates removals",async t=>{
  const connector=cloud(),library=await fixture(t,connector);await library.put(snapshot(),0);
  const save=connector.saveNote;connector.saveNote=async()=>{throw Error("offline");};await assert.rejects(library.syncCloud(),/offline/);
  connector.saveNote=save;const restarted=new NoteLibrary(library.directory,()=>connector);await restarted.syncCloud();
  assert.equal((await restarted.list())[0].storage.cloud,"saved");assert.equal(connector.notes.size,1);
  await restarted.put({...snapshot(),saved:false},1);await restarted.syncCloud();assert.equal(connector.notes.get("note-a").entry.saved,false);
});
test("a durable pending card retries through the actual Cloud connector and becomes saved",async t=>{
  const connector=Object.create(CloudConnector.prototype),state={account:{id:"account-a"},accountSession:{signedIn:true}},requests=[];
  connector.status=()=>state;
  connector.requireCloudAccount=()=>({origin:"https://cloud.example.test",accountToken:"notes-outbox-test-session"});
  const library=await fixture(t,connector),entry=snapshot("canvas:card /中文?"),originalFetch=global.fetch;
  let available=false,remote=null;
  try {
    global.fetch=async(url,options)=>{
      requests.push({url,method:options.method});
      assert.equal(options.headers.authorization,"Bearer notes-outbox-test-session");
      if(!available)return new Response(JSON.stringify({message:"Temporarily offline"}),{status:503});
      if(options.method==="PUT"){
        const body=JSON.parse(options.body);assert.equal(body.expectedVersion,0);assert.deepEqual(body.entry,entry);
        remote={entry:body.entry,version:1};
        return new Response(JSON.stringify(remote),{status:200});
      }
      return new Response(JSON.stringify({notes:[{id:entry.id,version:1}],nextCursor:null}),{status:200});
    };
    assert.equal((await library.put(entry,0)).storage.cloud,"pending");
    await assert.rejects(library.syncCloud(),{status:503});
    const restarted=new NoteLibrary(library.directory,()=>connector);
    assert.equal((await restarted.list())[0].storage.cloud,"pending");
    available=true;await restarted.syncCloud();
    assert.equal((await restarted.list())[0].storage.cloud,"saved");
    assert.deepEqual(remote.entry,entry);
    assert.deepEqual(requests.map(request=>request.method),["PUT","PUT","GET"]);
    assert.equal(requests[1].url,`https://cloud.example.test/api/v1/notes/${encodeURIComponent(entry.id)}`);
    const record=await restarted.read(entry.id);
    assert.equal(record.cloudPending,false);assert.equal(record.cloudVersion,1);assert.equal(record.cloudAccountId,"account-a");
  } finally {global.fetch=originalFetch;}
});
test("a second device restores notes independently and concurrent edits preserve both copies",async t=>{
  const connector=cloud(),first=await fixture(t,connector),second=await fixture(t,connector);
  await first.put(snapshot(),0);await first.syncCloud();await second.syncCloud();assert.equal((await second.list())[0].note.title,"A note");
  await first.put(snapshot("note-a","Device one"),1);await first.syncCloud();
  await second.put(snapshot("note-a","Device two"),1);await second.syncCloud();
  assert.equal((await second.list())[0].storage.cloud,"conflict");assert.equal((await second.list())[0].note.title,"Device two");assert.equal(connector.notes.get("note-a").entry.note.title,"Device one");
});
test("account changes do not upload another account's notes",async t=>{
  const connector=cloud(),library=await fixture(t,connector);await library.put(snapshot(),0);await library.syncCloud();
  await library.put(snapshot("note-a","Private change"),1);connector.state.account.id="account-b";connector.calls.length=0;await library.syncCloud();
  assert.deepEqual(connector.calls,[]);assert.equal((await library.list())[0].storage.cloud,"other-account");
});
test("metadata ranking has no image data, includes every candidate and excludes removed notes",()=>{
  const entries=Array.from({length:100},(_,index)=>snapshot(`note-${index}`,`Note ${index}`)),metadata=entries.map(NOTE.rankMetadata);
  assert.equal(metadata.length,100);assert.equal(/data:image|base64|Original picture/.test(JSON.stringify(metadata)),false);
  entries[0].saved=false;assert.equal(NOTE.rankNotes(entries).length,99);
  entries[1].llm={priority:0.99};entries[2].llm={priority:0.1};assert.equal(NOTE.rankNotes(entries)[0].entry.id,"note-1");
});
test("large searches select matching candidates but preserve the complete local library",()=>{
  const entries=Array.from({length:1000},(_,i)=>snapshot(`note-${i}`,`Ordinary ${i}`));
  entries[999].note.title="超长列表里的独特目标";
  assert.equal(NOTE.rankCandidates(entries,"独特目标")[0].id,"note-999");
  assert.equal(NOTE.rankCandidates(entries,"独特目标").length,64);
  assert.equal(NOTE.rankCandidates(entries).length,200);
  assert.equal(NOTE.rankNotes(entries).length,1000);
  const candidate=entries[999];candidate.llm={stale:true,priority:1,relevance:{"absent":1}};
  assert.equal(NOTE.rankNotes(entries,{query:"absent"}).length,0);
});
test("bounded pages traverse the full library and filters find notes beyond the first page",async t=>{
  const library=await fixture(t);
  for(let i=0;i<29;i++)await library.put({...snapshot(`page-${String(i).padStart(2,'0')}`,`Title ${String(i).padStart(2,'0')}`),
    note:{...snapshot().note,title:`Title ${String(i).padStart(2,'0')}`,bookmarked:i===28,category:{id:i===28?'idea':'concept',label:'Category'}}},0);
  await library.put({...snapshot('removed'),saved:false},0);
  let offset=0;const ids=[];
  do{const page=await library.page({limit:'2',offset:String(offset),sort:'title'});assert.ok(page.notes.length<=2);assert.equal(page.totalSaved,29);ids.push(...page.notes.map(entry=>entry.id));offset=page.nextOffset;}while(offset!==null);
  assert.equal(ids.length,29);assert.equal(new Set(ids).size,29);
  const found=await library.page({limit:2,query:'Title 28',bookmarked:'1',category:'idea'});
  assert.deepEqual(found.notes.map(entry=>entry.id),['page-28']);assert.equal(found.total,1);assert.equal(found.categories.find(category=>category.id==='concept').count,28);
  assert.equal((await library.page()).notes.length,12);assert.equal((await library.get('page-28')).note.title,'Title 28');
  for(const options of [{limit:0},{limit:49},{offset:-1},{sort:'arbitrary'},{bookmarked:'false'}])await assert.rejects(library.page(options),{status:400});
  await assert.rejects(library.get('missing'),{status:404});
});
test("recent edit order and reciprocal facets cover every saved card before paging",()=>{
  const entries=Array.from({length:29},(_,i)=>NOTE.libraryEntry({id:`tag-${i}`,updatedAt:1000+i,createdAt:2000-i,
    note:{title:`Card ${i}`,style:'card',category:i===28?'idea':'concept',tags:i>=27?['Research','research','进阶']:['Basics'],blocks:['Full source']}}));
  entries.push(NOTE.libraryEntry({id:'removed-tag',saved:false,updatedAt:9999}));
  const first=NOTE.libraryPage(entries,{limit:2});
  assert.deepEqual(first.notes.map(entry=>entry.id),['tag-28','tag-27']);
  assert.deepEqual(first.tags.find(tag=>tag.id==='research'),{id:'research',label:'Research',count:2});
  assert.equal(first.tags.find(tag=>tag.id==='basics').count,27);
  const combined=NOTE.libraryPage(entries,{limit:2,category:'idea',tag:' RESEARCH '});
  assert.deepEqual(combined.notes.map(entry=>entry.id),['tag-28']);
  assert.equal(combined.tags.some(tag=>tag.id==='basics'),false,'tags contain only the selected category');
  assert.equal(combined.tags.find(tag=>tag.id==='research').count,1);
  assert.equal(combined.tagTotal,1);assert.equal(combined.categoryTotal,2);
  assert.deepEqual(combined.categories.map(category=>[category.id,category.count]),[['concept',1],['idea',1]],'categories contain only the selected tag');
  const categoryOnly=NOTE.libraryPage(entries,{limit:2,category:'concept'});
  assert.equal(categoryOnly.tags.find(tag=>tag.id==='research').count,1,'facet counts include cards beyond the current page');
  assert.equal(categoryOnly.tagTotal,28);assert.equal(categoryOnly.categoryTotal,29);
  const tagOnly=NOTE.libraryPage(entries,{tag:'Basics'});
  assert.deepEqual(tagOnly.categories.map(category=>category.id),['concept']);assert.equal(tagOnly.categoryTotal,27);
  assert.equal(tagOnly.tags.length,3,'clearing category restores tags for the whole library');
  assert.equal(NOTE.libraryPage(entries,{category:'idea',tag:'Basics'}).total,0);
  assert.deepEqual(NOTE.libraryPage(entries,{category:'concept',tag:'进阶'}).notes.map(entry=>entry.id),['tag-27']);
  assert.equal(NOTE.libraryPage(entries,{tag:'Researcher'}).total,0,'tag matches an exact tag, not a substring');
  entries[0].updatedAt=9999;
  assert.equal(NOTE.libraryPage(entries,{limit:2}).notes[0].id,'tag-0','editing an older card moves it ahead of newer creations');
  const unicode=NOTE.libraryEntry({id:'unicode-tag',note:{title:'Unicode casing',tags:['İ'.repeat(24)],blocks:['Full source']}}),tagId=NOTE.libraryPage([unicode]).tags[0].id;
  assert.equal(tagId.length,48);assert.equal(NOTE.libraryPage([unicode],{tag:tagId}).total,1);
  assert.throws(()=>NOTE.libraryPage(entries,{tag:'a'.repeat(49)}),{status:400});
});
