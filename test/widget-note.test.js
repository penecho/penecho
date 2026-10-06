"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const NOTE = require("../public/note-card.js"), SELECT = require("../public/selection.js");
const read = file => fs.readFileSync(require.resolve(file), "utf8");
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function harness({ ai = false, capture, earlyReturn = false } = {}) {
  const snapshot = { width:600, height:400 }, widget = { id:"source", title:"Lesson", x:100, y:200, w:600, h:400, html:"<p>Lesson</p>", snapshotImage:snapshot },
    selection = { phase:"active", id:"existing-lasso" }, dirty = { x:130, y:220, w:50, h:30 }, draws = [], requests = [], created = [], scopes = [];
  const context = {
    aiPreparationGeneration:0,
    state:{ widgets:[widget], language:"en", userRevision:1, selection, dirty },
    noteCardRuntime:()=>NOTE, noteCardWidget:item=>NOTE.isNoteFormat(item.sourceFormat),
    widgetBox:item=>({x:item.x,y:item.y,w:item.w,h:item.h}), canvasDocumentsCurrent:()=>({id:"document"}),
    noteCopy:en=>en, renderAssist(){}, hideAssist(){}, setStatus(){}, setStatusKey(){}, debug(){},
    noteWidgetPart:capture || (async item=>({kind:"widget",src:PNG,w:600,h:400,title:item.title,x:item.x,y:item.y})),
    noteCategories:()=>NOTE.CATEGORIES, noteCardPlacement:box=>({...box,x:box.x+box.w+40}),
    smartSuggestRecent(){}, hasSelectedAiConnection:()=>ai, window:{PENECHO_CONFIG:{}}, noteCards:{}, smartSuggest:{bar:{action:{id:"note"}}},
    noteFinishLocal:async (note,placement,selected)=>{created.push({note,placement,selected});return true;},
    requestSelectionAI:()=>assert.fail("Widget notes must not consume or replace a lasso"),
    supersedeActiveAI:reason=>requests.push({reason}), requestAI:(action,packed,options)=>{
      const request={action,packed,options};requests.push(request);
      return earlyReturn ? Promise.resolve(false) : new Promise(resolve=>{request.finish=resolve;});
    },
    noteCategoryHint:()=>"Organize the captured content as one PenEcho note card.", noteTransformModelCommands:()=>[], noteWatchAccepted(){},
    SELECT, SIZE:20000, MAX_ATLAS_WIDTH:2048, MAX_ATLAS_HEIGHT:2048,
    selectionPathFor:item=>item.path,
    offscreen:(width,height)=>({width,height,getContext:()=>({fillRect(){},setTransform(){},drawImage:(...args)=>draws.push(args)}),toDataURL:()=>PNG}),
  };
  const aiSource = read("../src/client/app/ai-runtime.js"), persistence = read("../src/client/app/persistence.js"), notes = read("../src/client/app/note-cards.js");
  vm.runInNewContext(between(persistence,"  function selectionContentBounds(","  function movableSelectionObjects(")
    + between(aiSource,"  function renderSelectionImage(","  function drawFocusInset(")
    + between(notes,"  async function organizeWidgetAsNote(","  async function noteFinishLocal(")
    + "\nglobalThis.run=organizeWidgetAsNote;",context);
  const pack = context.buildSelectionImage;
  context.buildSelectionImage = scope=>{scopes.push(scope);return pack(scope);};
  return {context,widget,selection,dirty,draws,requests,created,scopes};
}

test("Widget notes capture the original snapshot alone and preserve overlapping input and an existing lasso", async () => {
  const h = harness({ai:true}), before = JSON.stringify(h.widget);
  assert.equal(await h.context.run(h.widget),true);
  assert.equal(h.context.state.selection,h.selection); assert.equal(h.context.state.dirty,h.dirty);
  assert.equal(JSON.stringify(h.widget),before);
  assert.equal(h.draws.length,1); assert.equal(h.draws[0][0],h.widget.snapshotImage);
  assert.equal(h.scopes[0].objects.length,1); assert.equal(h.scopes[0].fragments.length,0);
  const request = h.requests.find(item=>item.action);
  assert.equal(request.action,"answer"); assert.equal(request.options.suggestion,"note");
  assert.equal(request.options.isolatedSelection,true); assert.equal(request.options.selection,undefined);
  assert.equal(request.options.inputSnapshot,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(request.packed.sourceRect)),{x:100,y:200,w:600,h:400});
  assert.equal(h.created.length,0);
  request.options.onSettled({completed:false,started:true});
  request.finish();
  assert.equal(h.created.length,1); assert.equal(h.created[0].selected,null);
  assert.ok(h.created[0].note.blocks.some(block=>block.type==="image"&&block.src===PNG));
});

test("Widget notes work locally and preserve their source when AI is unavailable", async () => {
  const h = harness();
  assert.equal(await h.context.run(h.widget),true); assert.equal(h.requests.length,0);
  assert.equal(h.created.length,1); assert.equal(h.created[0].selected,null);
  assert.ok(h.created[0].note.blocks.some(block=>block.type==="image"&&block.src===PNG));
  assert.equal(h.context.state.widgets[0],h.widget); assert.equal(h.context.state.selection,h.selection);
});

test("Widget note capture discards removed or changed targets and superseded requests", async () => {
  let finish;
  const h = harness({ai:true,capture:()=>new Promise(resolve=>{finish=resolve;})});
  const pending = h.context.run(h.widget);
  h.context.state.userRevision++;
  finish({kind:"widget",src:PNG,w:600,h:400,title:"Lesson"});
  assert.equal(await pending,false); assert.equal(h.requests.length,0); assert.equal(h.created.length,0);
  h.context.state.widgets=[];
  assert.equal(await h.context.run(h.widget),false);
  const active = harness({ai:true});
  await active.context.run(active.widget);
  active.requests.find(item=>item.action).options.onSettled({completed:false,superseded:true});
  active.requests.find(item=>item.action).finish();
  assert.equal(active.created.length,0);
});

test("a Widget note request that cannot start still creates the local fallback", async () => {
  const h = harness({ai:true,earlyReturn:true});
  assert.equal(await h.context.run(h.widget),true);
  assert.equal(h.created.length,1);assert.equal(h.context.noteCards.awaiting,null);
  assert.equal(h.created[0].selected,null);assert.equal(h.context.state.dirty,h.dirty);
});
