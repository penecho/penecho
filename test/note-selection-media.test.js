"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const NOTE = require("../public/note-card.js"), source = fs.readFileSync(require.resolve("../src/client/app/note-cards.js"), "utf8");
function sourceFunction(name) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const next = source.indexOf("\n  function ", start + 1), asyncNext = source.indexOf("\n  async function ", start + 1);
  return source.slice(start, Math.min(...[next, asyncNext, source.length].filter(index => index > start)));
}
const media = (length, fill = "A") => `data:image/png;base64,${fill.repeat(length - 22)}=`;
function partsFixture() {
  const note = title => NOTE.normalize({title,blocks:[{type:"markdown",text:"Keep this source text."},{type:"image",src:media(420000),w:900,h:600}]});
  return {items:[{kind:"note",note:note("First")},{kind:"note",note:note("Second")}],ink:{src:media(80000),w:800,h:500},box:{x:10,y:20,w:2000,h:3000}};
}
function fitHarness({decodeFailure = false} = {}) {
  const calls = [], context = vm.createContext({structuredClone, noteCardRuntime:()=>NOTE, debug(){},
    Image:class { naturalWidth=900;naturalHeight=600;async decode(){if(decodeFailure)throw Error("Unreadable image");} },
    offscreen:(w,h)=>({width:w,height:h,getContext:()=>({drawImage(){}})}),
    noteEncodeCanvas:(_canvas,options)=>{calls.push(options);return {src:media(options.budget-20,"ABC"[calls.length-1]),w:700,h:450};},
  });
  vm.runInContext(sourceFunction("noteFitCapturedMedia"),context);
  return {context,calls};
}
test("large selections budget nested Note media and handwriting together without dropping pictures or modifying originals", async () => {
  const parts = partsFixture(), before = JSON.stringify(parts), h = fitHarness();
  assert.throws(()=>NOTE.noteFromParts(parts), /inline images/);
  const fitted = await h.context.noteFitCapturedMedia(parts), note = NOTE.noteFromParts(fitted);
  assert.equal(JSON.stringify(parts),before);
  assert.equal(fitted.items.length,2);assert.equal(h.calls.length,3);
  assert.equal(note.blocks.filter(block=>block.type==="image").length,2);
  assert.equal(note.blocks.filter(block=>block.type==="ink").length,1);
  assert.equal(note.blocks.filter(block=>block.type==="markdown").length,2);
  assert.ok(note.blocks.reduce((sum,block)=>sum+(block.src?.length||0),0)<NOTE.MAX_MEDIA_CHARS);
  assert.ok(NOTE.formatSource(note).length<NOTE.MAX_SOURCE_CHARS);
  assert.ok(NOTE.documentFor(note).length<NOTE.MAX_DOCUMENT_CHARS);
  const model = NOTE.normalize({title:"Organized",blocks:[{type:"markdown",text:"Organized text."}]});
  Object.assign(h.context,{state:{language:"en"},noteCategories:()=>NOTE.CATEGORIES});
  vm.runInContext(sourceFunction("noteMergeModelNote"),h.context);
  const merged = h.context.noteMergeModelNote(model,fitted);
  assert.equal(merged.blocks.filter(block=>block.type==="image").length,2);
  assert.equal(merged.blocks.filter(block=>block.type==="ink").length,1);
});
test("small selections keep their original image encoding and failed decoding leaves captured content intact", async () => {
  const parts = {items:[{kind:"image",src:media(1000),w:40,h:30}],ink:null}, h = fitHarness();
  assert.deepEqual(await h.context.noteFitCapturedMedia(parts),parts);assert.equal(h.calls.length,0);
  const large = partsFixture(), failed = fitHarness({decodeFailure:true});
  assert.deepEqual(await failed.context.noteFitCapturedMedia(large),large);
});
function requestHarness({ai=true} = {}) {
  const calls=[], selection={phase:"active"}, inputSnapshot={}, parts=partsFixture();
  const context=vm.createContext({state:{language:"en",selection,widgets:[]},aiPreparationGeneration:1,
    noteCardRuntime:()=>NOTE,canvasDocumentsCurrent:()=>({id:"document"}),noteCategories:()=>NOTE.CATEGORIES,
    noteCardPlacement:box=>box,smartSuggestRecent(){},hasSelectedAiConnection:()=>ai,window:{PENECHO_CONFIG:{}},
    noteCards:{},smartSuggest:{bar:{action:{id:"note"}}},noteCategoryHint:()=>"Organize this selection.",noteCopy:en=>en,
    noteFinishLocal:()=>assert.fail("The oversized fallback must be rejected cleanly"),
    requestSelectionAI:(action,selected,packed,options)=>calls.push({action,selected,packed,options}),
    releaseDirtyInput:snapshot=>{assert.equal(snapshot,inputSnapshot);calls.push("release");},
    hideAssist:reason=>calls.push(reason),setStatus:message=>calls.push(message),
  });
  vm.runInContext(sourceFunction("organizeCapturedAsNote"),context);
  return {context,calls,selection,inputSnapshot,parts};
}
test("an oversized local fallback cannot block a selection AI request or escape as an unhandled error", () => {
  const h=requestHarness();
  assert.equal(h.context.organizeCapturedAsNote({selection:h.selection},h.parts,()=>({atlasImage:"selection"}),h.inputSnapshot),true);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.suggestion,"note");
  assert.equal(h.calls[0].selected,h.selection);assert.equal(h.calls[0].options.inputSnapshot,h.inputSnapshot);
  assert.doesNotThrow(()=>h.calls[0].options.onSettled({completed:false,started:true}));
  assert.equal(h.calls[1],"release");assert.equal(h.calls[2],"note-failed");assert.match(h.calls[3],/inline images/);
  assert.equal(h.context.state.selection,h.selection);
});
test("an invalid offline fallback releases captured input and preserves the selection", () => {
  const h=requestHarness({ai:false});
  assert.equal(h.context.organizeCapturedAsNote({selection:h.selection},h.parts,null,h.inputSnapshot),false);
  assert.equal(h.calls[0],"release");assert.equal(h.calls[1],"note-failed");
  assert.equal(h.context.state.selection,h.selection);
});
