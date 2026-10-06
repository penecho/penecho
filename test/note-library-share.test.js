"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../src/client/app/note-cards.js"), "utf8");
const share = source.slice(source.indexOf("  async function noteLibraryShareEntry("), source.indexOf("  // Open above either maximized surface"));
const note = (id, libraryId) => ({id, libraryId, isNote:true, copyText:"Unchanged full note source"});
function harness({activeId="source", widgets=[note("widget-1", "note-a")], records=[], show, load} = {}) {
  let currentId=activeId;
  const events=[], switches=[], loads=[], statuses=[], panel={status:{textContent:""}}, state={widgets}, noteCards={panel};
  const context={state,noteCards,window:{PenEchoCommunityUI:{},dispatchEvent:event=>events.push(event)},
    CustomEvent:class {constructor(type,{detail}){this.type=type;this.detail=detail;}},
    canvasDocuments:{records:new Map(records.map(id=>[id,{}]))},canvasDocumentsCurrent:()=>({id:currentId}),
    canvasDocumentsShow:async id=>{switches.push(id);await show?.(id);currentId=id;},
    requestCanvasTransition:async transition=>{loads.push(transition);await load?.(transition);},
    noteCardWidget:widget=>widget.isNote,noteLibraryId:(_documentId,id)=>state.widgets.find(widget=>widget.id===id)?.libraryId,
    noteCopy:english=>english,closeNoteLibrary:()=>{noteCards.panel=null;},setStatus:message=>statuses.push(message)};
  vm.runInNewContext(share,context);
  return {context,state,noteCards,panel,events,switches,loads,statuses,setCurrent:id=>{currentId=id;},
    run:entry=>context.noteLibraryShareEntry({id:"note-a",documentId:"source",objectId:"widget-1",...entry})};
}
test("sharing the selected library note reuses its Widget action without editing source",async()=>{
  const h=harness(),before=JSON.stringify(h.state);
  await h.run();
  assert.equal(JSON.stringify(h.state),before);
  assert.equal(h.events.length,1);
  assert.equal(h.events[0].type,"penecho:community-widget-action");
  assert.deepEqual(JSON.parse(JSON.stringify(h.events[0].detail)),{action:"share",widgetId:"widget-1"});
  assert.equal(h.noteCards.panel,null);
});
test("a parked source is restored before resolving colliding Widget ids",async()=>{
  const h=harness({activeId:"other",records:["source"],widgets:[note("widget-1","private-other-note")],show:async()=>{
    h.state.widgets=[note("widget-1","note-a")];
  }});
  await h.run();
  assert.deepEqual(h.switches,["source"]);assert.equal(h.events.length,1);
  assert.equal(h.state.widgets[0].libraryId,"note-a");
});
test("a saved source loads through its locator and preserves the share target",async()=>{
  const h=harness({activeId:"other",load:async()=>h.setCurrent("source")});
  await h.run({locator:{location:"cloud",id:"saved-source"}});
  assert.deepEqual(JSON.parse(JSON.stringify(h.loads)),[{type:"load",id:"saved-source",location:"cloud"}]);
  assert.equal(h.events.length,1);
});
test("an interrupted source load cannot share another Canvas's Widget",async()=>{
  const h=harness({activeId:"other"});
  await h.run({locator:{location:"server",id:"saved-source"}});
  assert.equal(h.events.length,0);assert.equal(h.noteCards.panel,h.panel);assert.equal(h.noteCards.sharing,false);
});
test("missing sources and replaced Widget ids leave the library intact and explain recovery",async()=>{
  for(const h of [harness({activeId:"other"}),harness({widgets:[note("widget-1","different-note")]})]){
    const before=JSON.stringify(h.state);await h.run();
    assert.equal(h.events.length,0);assert.equal(JSON.stringify(h.state),before);assert.equal(h.noteCards.panel,h.panel);
    assert.match(h.panel.status.textContent,/Add .*current canvas, then share/);
  }
});
test("repeated clicks cannot race source navigation and failed navigation can be retried",async()=>{
  let finish;
  const h=harness({activeId:"other",records:["source"],show:()=>new Promise(resolve=>{finish=resolve;})});
  const pending=h.run();await h.run();assert.equal(h.switches.length,1);
  finish();await pending;assert.equal(h.events.length,1);assert.equal(h.noteCards.sharing,false);
  let failing=true;
  const retry=harness({activeId:"other",records:["source"],show:async()=>{if(failing)throw Error("Offline");}});
  await retry.run();assert.match(retry.panel.status.textContent,/Offline/);assert.equal(retry.noteCards.sharing,false);
  failing=false;await retry.run();assert.equal(retry.events.length,1);
});
