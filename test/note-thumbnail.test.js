"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const NOTE = require("../public/note-card.js");
const source = fs.readFileSync(require.resolve("../src/client/app/note-cards.js"), "utf8");
function harness() {
  const noteCards = { entries:[], accountId:"owner", thumbQueue:Promise.resolve(), thumbTasks:new Map() }, captures = [], writes = [];
  const context = { noteCards, window:{}, structuredClone, Promise, Map, JSON, noteCardRuntime:()=>NOTE, noteCardMathRenderer:()=>null,
    noteLibrarySnapshot:note=>new Promise((resolve, reject)=>captures.push({note,resolve,reject})), noteEncodeThumbnail:async()=>"data:image/webp;base64,AAAA",
    noteLibraryPut:entry=>writes.push(entry), debug(){} };
  vm.runInNewContext(source.slice(source.indexOf("  function noteThumbKey("), source.indexOf("  async function noteLibrarySnapshot("))
    + source.slice(source.indexOf("  function noteLibraryThumb("), source.indexOf("  async function noteCardThumb("))
    + "\nglobalThis.run=noteLibraryThumb;globalThis.key=noteThumbKey;", context);
  const entry = NOTE.libraryEntry({id:"old-card",note:{title:"Saved on a closed Canvas",blocks:["Original text"]},thumb:"data:image/jpeg;base64,AAAA",thumbDigest:"legacy"});
  noteCards.entries.push(entry);
  return { context, noteCards, captures, writes, entry, tick:()=>new Promise(resolve=>setImmediate(resolve)) };
}
test("legacy previews rebuild from saved source without a Canvas and deduplicate pending jobs", async()=>{
  const h=harness(), before=JSON.stringify(h.entry.note), first=h.context.run(h.entry), second=h.context.run(h.entry);
  assert.equal(first,second);await h.tick();assert.equal(h.captures.length,1);assert.notEqual(h.captures[0].note,h.entry.note);
  h.captures[0].resolve({});assert.equal(await first,"data:image/webp;base64,AAAA");assert.equal(h.writes.length,1);
  assert.equal(JSON.stringify(h.entry.note),before);assert.equal(h.entry.thumbDigest,h.context.key(h.entry));
  await h.context.run(h.entry);assert.equal(h.captures.length,1);assert.equal(h.noteCards.thumbTasks.size,0);
});
test("late captures cannot replace previews after edits, deletion or an account switch", async()=>{
  for (const change of [h=>{h.entry.note.title="New source";},h=>{h.entry.saved=false;},h=>{h.noteCards.accountId="other";},h=>{h.noteCards.entries=[];}]) {
    const h=harness(), pending=h.context.run(h.entry);await h.tick();change(h);h.captures[0].resolve({});
    assert.equal(await pending,"");assert.equal(h.writes.length,0);assert.equal(h.entry.thumbDigest,"legacy");
  }
});
test("preview rendering is serial and failed captures release the queue without discarding the previous image", async()=>{
  const h=harness(), other=NOTE.libraryEntry({id:"second",note:{title:"Second",blocks:["Second text"]}});h.noteCards.entries.push(other);
  const first=h.context.run(h.entry), second=h.context.run(other);await h.tick();assert.equal(h.captures.length,1);
  h.captures[0].reject(Error("Timed out"));assert.equal(await first,"");await h.tick();assert.equal(h.captures.length,2);
  assert.equal(h.entry.thumb,"data:image/jpeg;base64,AAAA");h.captures[1].resolve({});await second;
  assert.equal(h.writes.length,1);assert.equal(h.writes[0].id,"second");assert.equal(h.noteCards.thumbTasks.size,0);
});
test("a read-only viewer does not persist generated previews", async()=>{
  const h=harness();h.context.window.PENECHO_CONFIG={runtime:"viewer"};
  assert.equal(await h.context.run(h.entry),"");assert.equal(h.captures.length,0);assert.equal(h.writes.length,0);
});
test("previous full-resolution lossless previews regenerate under the WebP policy", async()=>{
  const h=harness();h.entry.thumb="data:image/png;base64,AAAA";
  h.entry.thumbDigest=h.context.key(h.entry).replace(":preview-900-webp96-v3:",":preview-900-v2:");
  const pending=h.context.run(h.entry);await h.tick();assert.equal(h.captures.length,1);
  h.captures[0].resolve({});await pending;assert.equal(h.entry.thumb,"data:image/webp;base64,AAAA");
  assert.equal(h.entry.thumbDigest,h.context.key(h.entry));
});
function encoderHarness(encode) {
  const calls=[], context={NOTE_THUMB_W:900,NOTE_THUMB_MAX_CHARS:700*1024,noteCardRuntime:()=>NOTE,
    offscreen(width,height){return {width,height,getContext:()=>({fillRect(){},drawImage(){}}),
      toBlob(resolve,type,quality){const request={width,height,type,quality};calls.push(request);resolve(encode(request));}};},
    canvasAgentReadDataUrl:async blob=>`data:${blob.type};base64,AAAA`};
  vm.runInNewContext(source.slice(source.indexOf("  async function noteEncodeThumbnail("),source.indexOf("  function noteLibraryThumb("))+"\nglobalThis.run=noteEncodeThumbnail;",context);
  return {calls,run:context.run};
}
test("previews prefer full-resolution WebP 0.96 without a lossless encode",async()=>{
  const h=encoderHarness(({type})=>({type,size:80000}));
  assert.equal(await h.run({}),"data:image/webp;base64,AAAA");
  assert.deepEqual(h.calls,[{width:900,height:1200,type:"image/webp",quality:.96}]);
});
test("unsupported WebP falls back to JPEG at full resolution",async()=>{
  const h=encoderHarness(({type})=>({type:type==="image/webp"?"image/png":type,size:80000}));
  assert.equal(await h.run({}),"data:image/jpeg;base64,AAAA");
  assert.equal(h.calls.at(-1).quality,.96);assert.ok(h.calls.every(c=>c.width===900&&c.height===1200));
});
test("oversized previews reduce quality before resolution and reject an unbounded result",async()=>{
  const h=encoderHarness(({type,quality})=>({type,size:quality===.9?100000:600000}));
  assert.equal(await h.run({}),"data:image/webp;base64,AAAA");
  assert.deepEqual(h.calls.map(c=>c.quality),[.96,.9]);assert.equal(h.calls.at(-1).width,900);
  const bounded=encoderHarness(({type,width})=>({type,size:width<900?100000:600000}));
  await bounded.run({});assert.equal(bounded.calls.at(-1).width,720);
  assert.ok(bounded.calls.slice(0,-1).every(c=>c.width===900));
  const impossible=encoderHarness(({type})=>({type,size:600000}));
  await assert.rejects(impossible.run({}),/encoded size limit/);
});
