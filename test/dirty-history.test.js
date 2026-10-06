"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const read = file => fs.readFileSync(require.resolve(`../src/client/app/${file}.js`), "utf8");
function fn(source, name) {
  const start = source.indexOf(`  function ${name}(`), next = source.indexOf("\n  function ", start + 1);
  assert.ok(start >= 0, name);
  return source.slice(start, next < 0 ? source.length : next);
}
// Small real RGBA buffers exercise exact mask copying and scoped consumption.
function canvas(width = 8, height = 8) {
  const result = { width, height, pixels:new Uint8ClampedArray(width * height * 4) };
  result.getContext = () => ({
    drawImage(source) { result.pixels.set(source.pixels); },
    getImageData() { return { data:result.pixels.slice() }; },
    putImageData(image) { result.pixels.set(image.data); },
  });
  return result;
}
function fixture() {
  const state = { history:[], future:[], historyBefore:new Map(), inkBounds:new Map(), dirtyInkTiles:new Map(), dirtyInkBounds:new Map(),
    dirtyImageIds:new Set(), dirtyTextBoxIds:new Set(), hotspotTrail:[], latestTypedInput:null, dirty:null, autoEligible:false,
    widgets:[], images:[], textBoxes:[], animations:[], textEditors:new Map(), mode:"pen", userRevision:0, recognitionGeneration:0, timer:0 },
    smartSuggest = { strokes:[], nextStrokeId:1, consumedStrokeId:0, dismissedStrokeId:0, dismissedObjectKey:"", writingMs:40, enabled:false },
    tiles = new Map(), dirtyInputSnapshots = new Set(), effects = [], assistAgent = { generation:1, resultTarget:null },
    context = { state, smartSuggest, tiles, dirtyInputSnapshots, effects, assistAgent, MAX_HISTORY:30, TILE:32, SIZE:1000, DIRTY_MASK_SCALE:.25,
      ASSIST_LOCAL_DELAY_MS:500, SMART_SUGGEST_RANK_DELAY_MS:100, SMART_SUGGEST_MAX_STROKES:64, AI_CANCELLED:"cancelled",
      window:{}, document:{ querySelector:() => null }, performance:{ now:() => 1000 }, clearTimeout(){},
      offscreen:canvas, dirtyHistoryMaskCopies:new WeakMap(), cloneCanvas:source => { if (!source) return null; const copy=canvas(source.width,source.height);copy.pixels.set(source.pixels);return copy; },
      key:(x,y) => `${x},${y}`, supersedeActiveAI(){ state.activeAI=null; }, clearWidgetRefineCandidate(){},
      clearSharpOverlays(){}, requestAnimationLayerRender(){}, render(){}, requestRender(){}, setStatusKey(){},
      schedule:() => effects.push("auto-scheduled"), scheduleAssist:() => effects.push("suggest-scheduled"), cancelSmartSuggest(){},
      serializedWidgets:() => state.widgets.map(item => ({ ...item })), imageHistoryState:() => state.images.map(item => ({ ...item })),
      textBoxHistoryState:() => state.textBoxes.map(item => ({ ...item })), serializedAnimations:() => [],
      restoreWidgets:items => { state.widgets=items.map(item => ({ ...item })); }, restoreImages:items => { state.images=items.map(item => ({ ...item })); },
      restoreTextBoxes:async items => { state.textBoxes=items.map(item => ({ ...item })); },
      restorePendingHistoryState(){ state.pending=null; state.pendingWidget=null; },
      capturePendingHistoryState:() => null, recordPendingHistory(){}, mountWidget(){}, widgetBox:item => item,
      requestInteractionLayerRender(){}, finishAIDraftHandMode(){}, showCanvasHint(){}, widgetInteractionPresentation:() => "inline",
      aiWidgetEditChanged:() => false, hideAssist(){}, smartSuggestResultCluster:() => null,
      imageBox:item => ({x:item.x,y:item.y,w:item.w,h:item.h}), textBoxBox:item => ({x:item.x,y:item.y,w:item.w,h:item.h}),
      unionDirtyBounds:(a,b) => !a ? {...b} : ({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.max(a.x+a.w,b.x+b.w)-Math.min(a.x,b.x),h:Math.max(a.y+a.h,b.y+b.h)-Math.min(a.y,b.y)}),
      intersection:(a,b) => {const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),w=Math.min(a.x+a.w,b.x+b.w)-x,h=Math.min(a.y+a.h,b.y+b.h)-y;return w>0&&h>0?{x,y,w,h}:null;},
      containsRect:(a,b) => b.x>=a.x&&b.y>=a.y&&b.x+b.w<=a.x+a.w&&b.y+b.h<=a.y+a.h,
      canvasDocumentsCurrent:() => ({id:"doc"}), canvasAgent:{currentConversation:{id:"conversation"}}, renderAssist(){},
    };
  vm.createContext(context);
  const persistence=read("persistence"), runtime=read("canvas-runtime"), ai=read("ai-runtime"), suggest=read("smart-suggestions");
  for (const name of ["recordBefore","hasPendingHistoryChanges","cloneDirtyHistoryMask","invalidateDirtyHistoryMask","captureDirtyHistoryMask","dirtyHistoryEntryId","captureDirtyHistorySuggest","captureDirtyHistoryState","recordDirtyHistoryBefore","refreshDirtyHistoryAfter","finishDirtyHistoryConsumption","restoreDirtyHistoryState","updateHistoryButtons","save","applyHistory","undo","redo"]) vm.runInContext(fn(persistence,name),context);
  for (const name of ["recordWidgetsBefore","recordImagesBefore","recordTextBoxesBefore","recordAnimationsBefore","dirtyMaskLocalBox","dirtyInputContains","captureDirtyInput","releaseDirtyInput","consumeDirtyInput","dirtyMaskAlphaBounds","recomputeDirtyBounds","clearDirtyContributionTracking","consumeAllDirtyInput","invalidateRecognition","acceptPendingWidget"]) vm.runInContext(fn(runtime,name),context);
  for (const name of ["consumeAIRequestInput","consumePendingInput"]) vm.runInContext(fn(ai,name),context);
  for (const name of ["smartSuggestRecordStroke","smartSuggestInputConsumed"]) vm.runInContext(fn(suggest,name),context);
  vm.runInContext(fn(read("assist-agent"),"assistAgentFinishResult"),context);
  const ink=(k,index=0) => {
    const [tx,ty]=k.split(",").map(Number);context.recordBefore(tx,ty);
    if (!tiles.has(k)) tiles.set(k,canvas());tiles.get(k).pixels[index*4+3]=255;
    state.inkBounds.set(k,{});
    if (!state.dirtyInkTiles.has(k)) state.dirtyInkTiles.set(k,canvas());context.invalidateDirtyHistoryMask(state.dirtyInkTiles.get(k));state.dirtyInkTiles.get(k).pixels[index*4+3]=255;
    state.dirtyInkBounds.delete(k);state.autoEligible=true;context.recomputeDirtyBounds();
    state.userRevision++;const entry=context.save(),record={id:smartSuggest.nextStrokeId++,historyEntry:entry,points:[],box:{x:tx*32+index%8*4,y:ty*32+Math.floor(index/8)*4,w:4,h:4},durationMs:40};
    context.smartSuggestRecordStroke(record);return record;
  };
  const widget=() => {context.recordWidgetsBefore();state.widgets.push({id:"B",x:80,y:80,w:20,h:20});return context.save();};
  const pixels=() => [...state.dirtyInkTiles].map(([k,c])=>[k,[...c.pixels].filter((_,i)=>i%4===3)]);
  return {context,state,smartSuggest,tiles,ink,widget,pixels,effects,assistAgent,dirtyInputSnapshots};
}

test("Undo an unrelated Widget preserves pending handwriting; redo and repeated history never mutate the saved masks",()=>{
  const h=fixture();h.ink("0,0");const entry=h.widget(),before=h.pixels();
  for(let i=0;i<3;i++){
    h.context.undo();assert.equal(h.state.widgets.length,0);assert.ok(h.state.dirty);assert.deepEqual(h.pixels(),before);assert.equal(h.state.autoEligible,true);
    h.state.dirtyInkTiles.get("0,0").pixels[3]=99;
    assert.equal(entry.dirtyBefore.ink.get("0,0").pixels[3],255,"live masks must be detached from history");
    h.context.redo();assert.equal(h.state.widgets.length,1);assert.deepEqual(h.pixels(),before);
  }
});

test("direct Canvas AI Widget consumption belongs to B: Undo restores A's dirty masks, input hints and Suggest eligibility",()=>{
  const h=fixture(),record=h.ink("0,0");
  h.state.hotspotTrail=[{x:1,y:1}];h.state.latestTypedInput={text:"A",box:{x:0,y:0,w:4,h:4}};
  const before=h.context.captureDirtyHistoryState();
  h.state.activeAI={recognitionGeneration:0,strokeId:record.id,hotspotCount:1,typedInput:h.state.latestTypedInput,requestBox:{x:0,y:0,w:4,h:4},inputCleared:true,dirtyHistoryBefore:before};
  h.state.dirty=null;h.state.autoEligible=false;h.state.pendingWidget={id:"B",x:80,y:80,w:20,h:20,recognitionGeneration:0};
  h.context.acceptPendingWidget({recordDraftHistory:false,restoreMode:false});
  assert.equal(h.state.dirtyInkTiles.size,0);assert.equal(h.smartSuggest.consumedStrokeId,record.id);
  h.context.undo();assert.equal(h.state.widgets.length,0);assert.ok(h.state.dirty);assert.equal(h.state.dirtyInkTiles.get("0,0").pixels[3],255);
  assert.equal(h.smartSuggest.consumedStrokeId,0);assert.equal(h.smartSuggest.strokes[0].historyEntry,record.historyEntry);
  assert.equal(h.state.hotspotTrail.length,1);assert.equal(h.state.latestTypedInput.text,"A");assert.ok(h.effects.includes("auto-scheduled"));
  h.context.redo();assert.equal(h.state.widgets.length,1);assert.equal(h.state.dirty,null);assert.equal(h.smartSuggest.consumedStrokeId,record.id);
});

test("raster draft consumption before save restores A on Undo and keeps AI output clean on redo",()=>{
  const h=fixture(),record=h.ink("0,0"),before=h.context.captureDirtyHistoryState();
  h.state.activeAI={inputCleared:true,inputConsumed:false,dirtyHistoryBefore:before,strokeId:record.id};h.state.dirty=null;h.state.autoEligible=false;
  h.context.recordBefore(1,0);h.tiles.set("1,0",canvas());h.tiles.get("1,0").pixels[3]=255;h.state.inkBounds.set("1,0",{});
  h.context.consumePendingInput({latestBox:record.box});h.context.save();
  h.context.undo();assert.equal(h.tiles.has("1,0"),false);assert.ok(h.state.dirty);assert.equal(h.state.dirtyInkTiles.size,1);
  h.context.redo();assert.equal(h.tiles.has("1,0"),true);assert.equal(h.state.dirty,null);assert.equal(h.state.dirtyInkTiles.size,0);
});

for(const kind of ["images","textBoxes"])test(`Undo B restores consumed manual ${kind} and leaves unrelated input C dirty`,async()=>{
  const h=fixture(),record=kind==="images"?h.context.recordImagesBefore:h.context.recordTextBoxesBefore,ids=kind==="images"?h.state.dirtyImageIds:h.state.dirtyTextBoxIds;
  record();h.state[kind].push({id:"A",text:"A",x:0,y:0,w:4,h:4},{id:"C",text:"C",x:40,y:0,w:4,h:4});ids.add("A");ids.add("C");h.state.autoEligible=true;h.context.recomputeDirtyBounds();h.context.save();
  const input=h.context.captureDirtyInput({x:0,y:0,w:4,h:4});h.widget();h.context.consumeDirtyInput(input);
  assert.equal(ids.has("A"),false);assert.equal(ids.has("C"),true);
  h.context.undo();assert.ok(h.state[kind==="images"?"dirtyImageIds":"dirtyTextBoxIds"].has("A"));assert.ok(h.state[kind==="images"?"dirtyImageIds":"dirtyTextBoxIds"].has("C"));
  h.context.redo();assert.equal(h.state[kind==="images"?"dirtyImageIds":"dirtyTextBoxIds"].has("A"),false);assert.ok(h.state[kind==="images"?"dirtyImageIds":"dirtyTextBoxIds"].has("C"));
});

test("successful Agent actions clear all dirty, including later input, and Undo restores it",()=>{
  const h=fixture();h.ink("0,0",0);h.ink("0,0",1);
  const input=h.context.captureDirtyInput({x:0,y:0,w:8,h:4});h.ink("1,0",0);
  h.widget();h.assistAgent.resultTarget={generation:1,documentId:"doc",conversationId:"conversation",resultBox:{x:80,y:80,w:20,h:20},inputTarget:{},inputSnapshot:input};
  h.context.assistAgentFinishResult(true);
  assert.equal(h.state.dirty,null);assert.equal(h.state.dirtyInkTiles.size,0);assert.equal(h.dirtyInputSnapshots.size,0);
  h.context.undo();assert.equal(h.state.dirtyInkTiles.get("0,0").pixels[7],255);assert.ok(h.state.dirtyInkTiles.has("1,0"));assert.equal(h.smartSuggest.consumedStrokeId,0);
  h.context.redo();assert.equal(h.state.dirtyInkTiles.size,0);assert.equal(h.state.dirty,null);assert.equal(h.smartSuggest.consumedStrokeId,3);
});

test("ordinary Agent completion clears all dirty masks and objects, including input written during its request",()=>{
  for(const outcome of ["completed","stopped","failed"]){
    const h=fixture();h.smartSuggest.requests=new Map();
    h.context.canvasAgent=h.context.canvasAgent||{};
    h.context.smartSuggestObjectInput=()=>({objects:[]});h.context.positionAssist=()=>{};h.context.assistRefresh=()=>{};
    const source=read("smart-suggestions");
    for(const name of ["assistRequestsActive","assistRequestModel","assistRequestStarted","assistRequestInputCaptured","assistRequestFinished"])vm.runInContext(fn(source,name),h.context);
    h.ink("0,0");h.context.assistRequestStarted(h.context.canvasAgent);
    h.context.assistRequestInputCaptured(h.context.canvasAgent,h.context.captureDirtyInput(h.state.dirty));
    h.ink("9,9");h.state.dirtyImageIds.add("far-image");h.state.dirtyTextBoxIds.add("far-text");
    h.smartSuggest.requests.get(h.context.canvasAgent).canvasWritten=true;
    h.context.assistRequestFinished(h.context.canvasAgent,outcome);
    assert.equal(h.state.dirtyInkTiles.size,outcome==="completed"?0:2,outcome);
    assert.equal(h.state.dirtyImageIds.size,outcome==="completed"?0:1,outcome);
    assert.equal(h.state.dirtyTextBoxIds.size,outcome==="completed"?0:1,outcome);
    assert.equal(h.dirtyInputSnapshots.size,0);
  }
});

test("Undo/redo handwriting itself restores only the corresponding dirty contributions and stroke records",()=>{
  const h=fixture(),a=h.ink("0,0"),c=h.ink("1,0");
  h.context.undo();assert.ok(h.state.dirtyInkTiles.has("0,0"));assert.equal(h.state.dirtyInkTiles.has("1,0"),false);assert.deepEqual(h.smartSuggest.strokes.map(r=>r.id),[a.id]);
  h.context.undo();assert.equal(h.state.dirty,null);assert.equal(h.smartSuggest.strokes.length,0);
  h.context.redo();h.context.redo();assert.equal(h.state.dirtyInkTiles.size,2);assert.deepEqual(h.smartSuggest.strokes.map(r=>r.id),[a.id,c.id]);
});

test("a failed Agent result leaves dirty input unconsumed and a stale capture cannot consume restored input",()=>{
  const h=fixture();h.ink("0,0");const input=h.context.captureDirtyInput(h.state.dirty);h.widget();
  h.assistAgent.resultTarget={generation:1,documentId:"doc",conversationId:"conversation",resultBox:{x:80,y:80,w:20,h:20},inputSnapshot:input};h.context.assistAgentFinishResult(false);
  assert.ok(h.state.dirty);h.context.undo();h.context.consumeDirtyInput(input);assert.ok(h.state.dirty);assert.equal(h.state.dirtyInkTiles.size,1);
});

test("asynchronous text restoration cannot reconcile dirty input after a newer edit",async()=>{
  const h=fixture();h.context.recordTextBoxesBefore();h.state.textBoxes=[{id:"A",x:0,y:0,w:4,h:4}];h.state.dirtyTextBoxIds.add("A");h.state.autoEligible=true;h.context.recomputeDirtyBounds();h.context.save();
  let finish;h.context.restoreTextBoxes=()=>new Promise(resolve=>{finish=resolve;});h.context.undo();
  h.state.userRevision++;h.state.dirty={x:100,y:100,w:4,h:4};h.effects.length=0;finish();await Promise.resolve();
  assert.equal(h.state.dirty.x,100);assert.equal(h.effects.length,0);
});

test("bounded history retains dirty pixels but does not retain evicted history entries through stroke snapshots",()=>{
  const h=fixture();h.context.MAX_HISTORY=3;
  for(let i=0;i<6;i++)h.ink(`${i},0`);
  assert.equal(h.state.history.length,3);
  for(const entry of h.state.history)for(const snapshot of [entry.dirtyBefore,entry.dirtyAfter]){
    assert.ok(snapshot.suggest.strokes.every(record=>!Object.hasOwn(record,"historyEntry")));
    assert.doesNotThrow(()=>JSON.stringify(snapshot.suggest));
  }
  h.widget();h.context.undo();assert.equal(h.state.dirtyInkTiles.size,6,"old pending pixels outlive the bounded vector/history caches");
});

test("unchanged mask tiles share immutable history storage and writing invalidates only the changed copy",()=>{
  const h=fixture();h.ink("0,0");const original=h.state.history[0].dirtyAfter.ink.get("0,0");
  h.widget();assert.equal(h.state.history[1].dirtyBefore.ink.get("0,0"),original);assert.equal(h.state.history[1].dirtyAfter.ink.get("0,0"),original);
  h.ink("0,0",1);const updated=h.state.history.at(-1).dirtyAfter.ink.get("0,0");
  assert.notEqual(updated,original);assert.equal(original.pixels[7],0);assert.equal(updated.pixels[7],255);
});
