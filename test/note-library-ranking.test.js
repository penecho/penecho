"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const NOTE = require("../public/note-card.js");
const source = fs.readFileSync(require.resolve("../src/client/app/note-cards.js"), "utf8");
function harness(request = async () => ({note_0:{noul:0.8}})) {
  const calls = [], writes = [], noteCards = {entries:[NOTE.libraryEntry({id:"saved", note:{title:"Research", blocks:["Original source"]}})],
    panel:{input:{value:""}, category:"", bookmarked:false}, rankBusy:false, rankAgain:false, rankKey:""};
  const context = {noteCards, noteCardRuntime:()=>NOTE, penIntelRemote:()=>true, noteLibraryRender(){}, noteLibraryPut:entry=>writes.push(entry),
    penechoLLMRequest:async (...args)=>{calls.push(args);return request(...args);}};
  vm.runInNewContext(source.slice(source.indexOf("  // ---------- PenEchoLLM ranking ----------"), source.indexOf("  async function noteRankWidget("))
    + "\nglobalThis.rank=noteRankLibrary;", context);
  return {noteCards, calls, writes, rank:context.rank};
}
test("opening an unfiltered library and clearing or whitespace searches never request PenEchoLLM", async () => {
  const h = harness();
  for (const query of [undefined, "", " \t\n "]) await h.rank(query);
  h.noteCards.panel = null;
  await h.rank();
  assert.equal(h.calls.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.noteCards.rankBusy, false);
});
test("search, category, tag and bookmark filters keep smart ranking available", async () => {
  for (const filter of [{query:" Research "}, {category:"concept"}, {tag:"research"}, {bookmarked:true}]) {
    const h = harness();
    Object.assign(h.noteCards.panel, filter);
    await h.rank(filter.query);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0][0], "note_rank");
    assert.equal(h.calls[0][1], null);
    assert.equal(h.calls[0][2].notes.length, 1);
    assert.equal(h.calls[0][2].query, filter.query ? "research" : undefined);
    assert.equal(h.writes.length, 1);
  }
});
test("clearing filters while a ranking is busy does not queue an unfiltered request", async () => {
  let resolve;
  const h = harness(() => new Promise(done => {resolve = done;}));
  h.noteCards.panel.input.value = "research";
  const pending = h.rank("research");
  h.noteCards.panel.input.value = "other";
  await h.rank("other");
  assert.equal(h.noteCards.rankAgain, true);
  h.noteCards.panel.input.value = "";
  await h.rank("");
  resolve({note_0:{noul:0.8}});
  await pending;
  assert.equal(h.calls.length, 1);
  assert.equal(h.noteCards.rankAgain, false);
  assert.equal(h.noteCards.rankBusy, false);
});
test("an empty query while busy cannot create a retry", async () => {
  const h = harness();
  h.noteCards.rankBusy = true;
  await h.rank("");
  assert.equal(h.noteCards.rankAgain, false);
  assert.equal(h.calls.length, 0);
});
