"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const SMART = require("../public/smart-suggest.js");
const JEVISION = require("../src/server/jevision.js");

const ROOT = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function noisy(points, amount = 5, seed = 7) {
  let value = seed;
  const random = () => ((value = (value * 16807) % 2147483647) / 2147483647) - 0.5;
  return points.map(point => ({ x:point.x + random() * amount, y:point.y + random() * amount }));
}
function polygonStroke(vertices, perEdge = 20) {
  const points = [];
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index], b = vertices[(index + 1) % vertices.length];
    for (let step = 0; step < perEdge; step++) points.push({ x:a[0] + (b[0] - a[0]) * step / perEdge, y:a[1] + (b[1] - a[1]) * step / perEdge });
  }
  points.push({ x:vertices[0][0] + 3, y:vertices[0][1] + 2 });
  return noisy(points);
}
function answer(probabilities) {
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
  return { type:"choice", choice, confidence:probabilities[choice], probabilities };
}

test("completed calculations and word forms can rank Check without a derivation kind penalty",()=>{
  for (const kind of ["math_expr", "math_step", "notes", "question", "code"]) {
    const ranked=SMART.rankActions({answers:{kind:answer({[kind]:1}),action:answer({check_step:.48,solve:.35,typeset:.10,none:.07})}});
    assert.equal(ranked.items[0].id,"check_step",kind);
  }
  assert.equal(SMART.actionById("check_step").exec.focus,undefined,"Check verifies its complete target, rather than only the last written line");
});

test("a negative checking verdict defers Check even when model and learned priors favor it", () => {
  const answers = { kind:answer({notes:1}), action:answer({check_step:.65, answer:.2, typeset:.1, none:.05}), check_applicable:{type:"noul",noul:.1} },
    local = {kind:"notes",probabilities:{check_step:.8,answer:.1,typeset:.07,organize:.03}},
    ranked = SMART.rankActions({local,answers});
  assert.equal(ranked.items.length,3,"ordinary suggestions remain available");
  assert.ok(!ranked.items.some(item => item.id === "check_step"));
  assert.equal(ranked.more[0].id,"check_step","manual checking remains in More");
  assert.equal(ranked.confident,false,"the rejected model winner cannot emphasize an alternative");
  answers.check_applicable.noul = .5;
  assert.ok(!SMART.rankActions({local,answers}).items.some(item=>item.id==="check_step"),"two tentative checking scores do not establish a task");
  answers.action=answer({check_step:.85,answer:.1,none:.05});
  assert.equal(SMART.rankActions({local,answers}).items[0].id,"check_step","strong action evidence retains real practice with moderate applicability");
  delete answers.check_applicable;
  assert.equal(SMART.rankActions({local,answers}).items[0].id,"check_step","older server replies remain compatible");
});

test("independent communication intent puts Answer first while explicit tasks and note scope retain priority", () => {
  const answers = {kind:answer({notes:1}),action:answer({check_step:.6,typeset:.2,answer:.1,note:.05,none:.05}),check_applicable:{type:"noul",noul:.1},conversation:{type:"noul",noul:.9}};
  let ranked = SMART.rankActions({answers});
  assert.equal(ranked.items[0].id,"answer"); assert.equal(ranked.confident,true);
  assert.ok(!ranked.items.some(item=>item.id === "check_step"));
  assert.equal(SMART.instantRankingEvidence(answers),null,"semantic promotion does not teach a contradictory raw ranking");
  assert.equal(SMART.instantRankingEvidence({...answers,action:answer({typeset:.7,answer:.2,none:.1})}),null,"a conflicting presentation verdict also cannot teach the prior");
  answers.conversation.noul = .79;
  assert.equal(SMART.rankActions({answers}).items[0].id,"typeset");
  answers.conversation.noul = .9; answers.check_applicable.noul = .9;
  assert.equal(SMART.rankActions({answers}).items[0].id,"check_step","practice context is not overridden");
  answers.check_applicable.noul = .1; answers.note_scope = {type:"noul",noul:1}; answers.note_task = {type:"noul",noul:0};
  assert.equal(SMART.rankActions({answers}).items[0].id,"note","preserving bounded notes takes priority");
});

test("model learning rejects uncertainty and excludes checking without evidence", () => {
  const verdict = (probabilities, confidence, applicable = .9) => ({action:{...answer(probabilities),confidence},check_applicable:{type:"noul",noul:applicable}});
  for (const answers of [
    verdict({check_step:.414,typeset:.30,answer:.17,none:.116},.38),
    verdict({check_step:.65,answer:.25,none:.1},.38),
    verdict({none:.45,answer:.55},.8),
    verdict({check_step:.65,answer:.25,none:.1},.8,.1),
  ]) assert.equal(SMART.instantRankingEvidence(answers),null);
  assert.deepEqual(SMART.instantRankingEvidence(verdict({answer:.7,check_step:.2,none:.1},.7,.1)),{answer:.7});
  assert.deepEqual(SMART.instantRankingEvidence(verdict({check_step:.7,answer:.2,none:.1},.7)),{check_step:.7,answer:.2});
});

test("new writing units exclude old ink and dismissed actions recover after 45 seconds",()=>{
  const old=Array.from({length:20},(_,i)=>({id:i+1,at:i*100})),next=[{id:21,at:12000},{id:22,at:12300},{id:23,at:12700}];
  assert.deepEqual(SMART.recentStrokeUnit([...old,...next]),next);
  const long=Array.from({length:40},(_,i)=>({id:i,at:i*1000}));assert.equal(SMART.recentStrokeUnit(long).length,31);
  const answers={kind:answer({shape:1}),finished:{type:"noul",noul:1},action:answer({snap_shapes:.95,none:.05})};
  let value=SMART.dismissAction(null,1000);assert.equal(SMART.decide(answers,{cooldown:{snap_shapes:value},now:2000}).reason,"ok");
  value=SMART.dismissAction(value,2000);assert.equal(SMART.decide(answers,{cooldown:{snap_shapes:value},now:3000}).reason,"cooldown");
  assert.equal(SMART.decide(answers,{cooldown:{snap_shapes:value},now:47000}).reason,"ok");assert.equal(SMART.dismissAction(value,48000).count,1);
});

function suggestionRuntime(fetchImpl, preferences = new Map(), statusFetch = null) {
  let now=1000,nextTimer=1,docId="first";const timers=new Map(),shown=[],events=[],snapped=[],state={history:[],widgets:[],images:[],textBoxes:[],dirtyImageIds:new Set(),dirtyTextBoxIds:new Set(),textEditors:new Map(),mode:"pen",scale:1,userRevision:0,touches:new Map()};
  const context={window:{PENECHO_SMART_SUGGEST:SMART,PENECHO_CONFIG:{smartSuggestions:true,smartSuggestionsTimeoutMs:2500}},document:{querySelector:selector=>selector==="#smartSuggestLayer"?{}:null,visibilityState:"visible"},
    localStorage:{getItem:key=>preferences.get(key) ?? null,setItem:(key,value)=>preferences.set(key,value)},performance:{now:()=>now},Date:class extends Date { static now(){return now;} },Math:Object.assign(Object.create(Math),{random:()=>0.5}),state,SIZE:20000,AbortController,
    canvasDocumentsCurrent:()=>({id:docId}),debug:(...args)=>events.push(args),authenticatedApiHeaders:x=>x,
    aiRequestHeaders:()=>assert.fail("background suggestions use their configured service without a selected Canvas model"),
    renderSelectionImage:selection=>({out:{width:200,height:150,toDataURL:()=>`data:image/png;base64,${selection.image}`}}),
    viewportRect:()=>({x:0,y:0,w:1200,h:800}),capturableWidgets:()=>[],widgetBox:item=>item,imageBox:item=>item,textBoxBox:item=>item,animationBox:item=>item,
    intersection:(a,b)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.w,b.x+b.w),bottom=Math.min(a.y+a.h,b.y+b.h);return right>x&&bottom>y?{x,y,w:right-x,h:bottom-y}:null;},
    unionLocalBounds:(a,b)=>{if(!a)return b;if(!b)return a;const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return {x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,h:Math.max(a.y+a.h,b.y+b.h)-y};},
    prepareVisibleWidgetSnapshots:async()=>({missing:0}),
    WIDGET_CLASSIFY_SNAPSHOT_TIMEOUT_MS:8000,WIDGET_CLASSIFY_SNAPSHOT_REUSE_MS:2000,widgetsRequiredForCapture:region=>context.capturableWidgets(region),widgetSnapshotFresh:widget=>Boolean(widget.snapshotImage),
    ensureWidgetSnapshots:async widgets=>{for(const widget of widgets)widget.snapshotImage||={};return {complete:true,missing:0,missingWidgets:[],pending:[]};},
    valid:point=>Boolean(point&&point.x>=0&&point.y>=0&&point.x<=20000&&point.y<=20000),handObjectToolbarTargetAtPoint:()=>null,
    selectionAIBusy:selection=>Boolean(selection?.aiRequest),
    selectionPathFor:selection=>selection.originalPath || [],SELECT:require("../public/selection.js"),
    stopAssistShapeTool(){},requestInteractionLayerRender(){},
    showSmartHoldPreview:(drawing,fit)=>context.renderAssist({mode:"hold",fit,box:drawing.bbox}),
    applySmartShapeSnap:groups=>{snapped.push(...groups);return true;},
    renderAssist:model=>{shown.push(model);context.runtime.data.bar={...context.runtime.data.bar,...model,element:{dataset:{rank:context.runtime.rank(model.cluster,model.view)},querySelector:()=>null,classList:{add(){},remove(){},toggle(){}}}};},hideAssist(){if(context.runtime)context.runtime.data.bar=null;},
    setTimeout:(fn,delay)=>{const id=nextTimer++;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),fetch:(url,options)=>url.endsWith('/status')?(statusFetch?statusFetch(url,options):Promise.resolve({ok:true,json:async()=>({configured:context.runtime.data.available})})):fetchImpl(url,options)};
  // Ranking must never take ownership of the Canvas action's dirty input.
  for (const name of ["captureDirtyInput", "captureSelectionDirtyInput", "consumeDirtyInput", "releaseDirtyInput"])
    context[name] = () => assert.fail("Suggest ranking must leave dirty input untouched");
  context.assistUnion=context.unionLocalBounds;context.assistPendingBox=()=>state.pending?.box||state.pendingWidget;context.pendingItemBounds=item=>item.box;
  vm.createContext(context);const source=read("src/client/app/smart-suggestions.js");
  const statusCode=source.slice(source.indexOf('  let smartSuggestStatusSequence'),source.indexOf('  void refreshSmartSuggestAvailability({ reason:"init" });'));
  const dismissCode=source.slice(source.indexOf('  function dismissAssist('),source.indexOf('  function assistBlankPoint(')),
    reopenCode=source.slice(source.indexOf('  function assistDirtyClusterAtPoint('),source.indexOf('  function beginAssistReopenTap('));
  vm.runInContext(source.slice(0,source.indexOf("  // ---------- Assist bar ----------"))+statusCode+dismissCode+reopenCode+"\nconst cropSelection=smartSuggestCrop,cropRegion=smartSuggestCropRegion;smartSuggestCropRegion=cluster=>cluster.box;smartSuggestCrop=cluster=>cluster.selection?cropSelection(cluster):'data:image/png;base64,AAAA';globalThis.runtime={data:smartSuggest,start:smartSuggestDrawingStarted,move:smartSuggestDrawingMoved,finish:smartSuggestDrawingFinished,consume:smartSuggestInputConsumed,cluster:smartSuggestCluster,region:cropRegion,run:runSmartSuggest,tier:smartSuggestWritingTier,rank:penechoLLMRankState,cancel:cancelSmartSuggest,dismiss:dismissAssist,reopen:reopenAssistAtPoint,toggle:setSmartSuggestEnabled,syncSelection:syncSelectionSuggestions,refresh:refreshSmartSuggestAvailability};",context);
  const runtime=context.runtime;runtime.start();
  function begin(offset=0){const points=[{x:100,y:100+offset},{x:300,y:100+offset},{x:300,y:250+offset},{x:100,y:250+offset},{x:100,y:100+offset}];state.drawing={samples:points.map(point=>({point})),bbox:{x:100,y:100+offset,w:200,h:150},size:4};runtime.start(state.drawing);return state.drawing;}
  function finish(){const drawing=state.drawing;state.drawing=null;state.history.push({});runtime.finish(drawing);}
  function stroke(offset=0,duration=0){begin(offset);now+=duration;finish();}
  async function tick(){const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0]||[];assert.ok(timer,"a timer is scheduled");timers.delete(id);now=Math.max(now,timer.at);timer.fn();await new Promise(resolve=>setImmediate(resolve));}
  async function drain(limit=20){for(let i=0;i<limit&&timers.size;i++)await tick();}
  return {runtime,state,shown,events,snapped,timers,stroke,begin,finish,tick,drain,context,setDocument:id=>docId=id,setTime:value=>now=value,setSnapshots:fn=>context.ensureWidgetSnapshots=fn};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const okAnswer=action=>({ok:true,json:async()=>({ok:true,answers:JEVISION.mockAnswers(SMART.buildQuestions({shapesFit:true}),"",action)})});

test("ordinary ink persists only a confident, applicable model ranking", async () => {
  for (const [probabilities,confidence,applicable,learns] of [
    [{check_step:.414,typeset:.3,answer:.17,none:.116},.38,.1,false],
    [{check_step:.65,answer:.25,none:.1},.8,.1,false],
    [{check_step:.7,answer:.2,none:.1},.7,.9,true],
    [{answer:.7,check_step:.2,none:.1},.7,.1,true],
  ]) {
    const preferences = new Map(), answers = {kind:answer({notes:1}),action:{...answer(probabilities),confidence},check_applicable:{type:"noul",noul:applicable}},
      h = suggestionRuntime(async () => ({ok:true,json:async () => ({ok:true,answers})}),preferences);
    h.stroke();
    // Use freehand strokes rather than the runtime fixture's fitted rectangle.
    const record = h.runtime.data.strokes[0];
    record.points = [{x:100,y:100},{x:120,y:125},{x:145,y:106},{x:170,y:130},{x:190,y:110}];
    record.box = {x:100,y:100,w:90,h:30};
    await h.drain();
    assert.equal(preferences.has("penecho-smart-suggestions-instant-prior"),learns);
    if (learns && applicable < .5) {
      const prior = JSON.parse(preferences.get("penecho-smart-suggestions-instant-prior"));
      assert.ok(Object.values(prior).every(bucket => !bucket.p.check_step));
    }
    if (applicable < .5) {
      assert.ok(!h.shown.at(-1).view.items.some(item => item.id === "check_step"));
      assert.ok(h.shown.at(-1).view.items.some(item => item.id === "answer"));
    }
  }
});

function manualObject(h, kind, id = `${kind}-1`) {
  const item = { id, x:100, y:100, w:300, h:160, ...(kind === "text" ? { text:"Explain this paragraph", image:{} } : { image:{} }) };
  h.state[kind === "text" ? "textBoxes" : "images"].push(item);
  h.state[kind === "text" ? "dirtyTextBoxIds" : "dirtyImageIds"].add(id);
  h.state.dirty = h.context.unionLocalBounds(h.state.dirty, item);
  h.context.smartSuggestObjectsChanged();
  return item;
}

test("manual text and images request and display PenEchoLLM ranking without a stroke", async () => {
  for (const kind of ["text", "image"]) {
    const requests = [], h = suggestionRuntime(async (_url, options) => { requests.push(JSON.parse(options.body)); return okAnswer("explain"); });
    manualObject(h, kind);
    await h.tick();
    assert.equal(h.shown.at(-1).view.source, "local");
    assert.equal(requests.length, 0);
    await h.drain();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].mode, "ink");
    assert.equal(requests[0].context.shapesFit, false);
    assert.equal(h.shown.at(-1).view.source, "penecho-llm");
    assert.equal(h.runtime.rank(h.runtime.cluster(), h.shown.at(-1).view), "ranked");
    assert.equal(h.runtime.data.strokes.length, 0);
    assert.ok(h.state.dirty, "successful ranking preserves the submitted manual input");
    assert.equal(h.state.dirtyTextBoxIds.size+h.state.dirtyImageIds.size,1);
    await h.runtime.run();
    assert.equal(requests.length, 1, "unchanged objects deduplicate normally");
  }
});

test("image placement and text drafts defer ranking until manual editing settles", async () => {
  for (const kind of ["text", "image"]) {
    let requests = 0;
    const h = suggestionRuntime(async () => { requests++; return okAnswer("explain"); });
    const item = manualObject(h, kind);
    h.state.mode = "select";
    if (kind === "text") h.state.textEditors.set(1, {});
    else h.state.imageEdit = { id:item.id };
    await h.drain();
    assert.equal(requests, 0);
    assert.equal(h.shown.length, 0);
    h.state.textEditors.clear(); h.state.imageEdit = null;
    h.context.smartSuggestObjectsChanged();
    await h.drain();
    assert.equal(requests, 1, "a completed object can rank while the Lasso tool is selected");
  }
});

test("dismissed ranked manual input stays dirty and new objects or edits restore suggestions", async () => {
  let requests = 0;
  const h = suggestionRuntime(async () => { requests++; return okAnswer("explain"); }), item = manualObject(h, "text");
  await h.drain(); h.runtime.dismiss("blank-tap");
  assert.equal(h.runtime.cluster(), null);
  assert.equal(h.state.dirtyTextBoxIds.has(item.id),true);
  await h.runtime.run(); assert.equal(requests, 1);
  item.text = "Explain the edited paragraph";
  h.state.dirtyTextBoxIds.add(item.id);
  h.context.smartSuggestObjectsChanged(); await h.drain();
  assert.equal(requests, 2);
  h.runtime.dismiss("blank-tap");
  manualObject(h, "image"); await h.drain();
  assert.equal(requests, 3);
});

test("manual input invalidates old rankings and stale object replies", async () => {
  const first = deferred(), requests = [], h = suggestionRuntime(async (_url, options) => {
    requests.push(options); return requests.length === 1 ? first.promise : okAnswer("explain");
  });
  const item = manualObject(h, "image");
  await h.tick(); await h.tick();
  assert.equal(requests.length, 1);
  item.x += 40;
  h.context.smartSuggestObjectsChanged();
  assert.equal(requests[0].signal.aborted, true);
  first.resolve(okAnswer("solve"));
  await h.drain();
  assert.equal(requests.length, 2);
  assert.equal(h.shown.at(-1).view.source, "penecho-llm");
  assert.equal(h.runtime.data.jev.objectKey, h.runtime.cluster().objectKey);
  manualObject(h, "text");
  assert.equal(h.runtime.data.bar, null);
  await h.tick();
  assert.equal(h.shown.at(-1).view.source, "local", "old object verdicts cannot label a new target");
  await h.drain(); assert.equal(requests.length, 3);
});

test("clean restored or AI-created objects never classify themselves", async () => {
  let requests = 0;
  const h = suggestionRuntime(async () => { requests++; return okAnswer("explain"); });
  h.state.images.push({ id:"image-clean", x:100, y:100, w:200, h:200, image:{} });
  h.state.textBoxes.push({ id:"text-clean", x:100, y:400, w:200, h:60, text:"AI output", image:{} });
  h.context.smartSuggestObjectsChanged(); await h.drain();
  assert.equal(h.runtime.cluster(), null);
  assert.equal(requests, 0);
  assert.equal(h.shown.length, 0);
});

test("a new manual object ranks together with all previously unprocessed ink", async () => {
  let requests = 0;
  const h = suggestionRuntime(async () => { requests++; return okAnswer("explain"); });
  h.stroke(); await h.drain();
  const oldKey = h.runtime.cluster().key, image = manualObject(h, "image");
  image.x = 800; image.y = 500;
  h.state.dirty = h.context.unionLocalBounds(h.state.dirty, image);
  await h.drain();
  const cluster = h.runtime.cluster(), region = h.runtime.region(cluster);
  assert.notEqual(cluster.key, oldKey);
  assert.equal(cluster.strokes.length, 1);
  assert.equal(cluster.objects.length, 1);
  assert.ok(region.x + region.w >= image.x + image.w);
  assert.ok(region.y + region.h >= image.y + image.h);
  assert.equal(requests, 2);
  assert.equal(h.shown.at(-1).view.source, "penecho-llm");
});

test("Widget annotations rank Refine and send the target identity and crop coordinates",async()=>{
  const requests=[], h=suggestionRuntime(async(_url,options)=>{requests.push(JSON.parse(options.body));return okAnswer("refine");});
  h.state.widgets=[{id:"target",title:"Editable chart",widgetType:"html_widget",shell:{},x:50,y:50,w:400,h:300}];
  h.state.dirty={x:100,y:100,w:200,h:150};
  h.stroke();await h.tick();
  assert.equal(h.shown.at(-1).view.items[0].id,"refine");
  await h.drain();
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0].context.widgetRefine,{id:"target",title:"Editable chart",type:"html_widget",box:{x:0,y:0,w:1,h:1}});
  assert.equal(h.runtime.data.consumedStrokeId,0,"classification preserves the pending annotations");
  h.state.widgets[0].pending=true;
  h.stroke(20);await h.drain();
  assert.equal(requests.at(-1).context.widgetRefine,undefined,"draft Widgets are not edit targets");
});

test("Refine is contextual and circles on Widgets are annotations rather than shape cleanup",()=>{
  const widgetRefine={id:"target"};
  const questions=SMART.buildQuestions({shapesFit:true,widgetRefine});
  assert.ok(questions.action.criteria.refine);
  assert.equal(questions.action.criteria.snap_shapes,undefined);
  assert.match(questions.action.instructions,/circles, arrows and replacement marks/);
  assert.equal(SMART.buildQuestions({shapesFit:true}).action.criteria.refine,undefined);
  assert.equal(SMART.buildQuestions({selection:true,widgetRefine}).action.criteria.refine,undefined);
  assert.equal(SMART.buildQuestions({result:true,widgetRefine}).action.criteria.refine,undefined);
  assert.equal(JEVISION.mockModeAnswers({mode:"ink",context:{widgetRefine}},"auto").action.choice,"refine");
  assert.equal(SMART.localPredict({widgetRefine:true,shapes:{closed:1}}).probabilities.refine,.9);
});

test("Widget overlap follows actual points and crossing segments, not a stroke's bounding rectangle",()=>{
  const box={x:100,y:100,w:100,h:100};
  assert.equal(SMART.strokeTouchesBox({points:[{x:0,y:150},{x:300,y:150}],size:4},box),true);
  assert.equal(SMART.strokeTouchesBox({points:[{x:99,y:150}],size:4},box),true,"pen thickness counts");
  assert.equal(SMART.strokeTouchesBox({points:[{x:0,y:0},{x:300,y:0},{x:300,y:300}],size:4},box),false,"a surrounding empty rectangle is not ink overlap");
  assert.equal(SMART.strokeTouchesBox({points:[{x:0,y:0},{x:0,y:300}],size:4},box),false);
});

test("Suggest resumes after Canvas AI settles without requiring another stroke",async()=>{
  let requests=0;
  const h=suggestionRuntime(async()=>{requests++;return okAnswer("solve");});
  h.state.activeAI={};h.stroke();await h.drain();
  assert.equal(requests,0);assert.equal(h.runtime.data.deferred,true);
  const core=read("src/client/app/core.js"),start=core.indexOf("  function setBusy("),end=core.indexOf("  function noteCanvasChromeInteraction(",start);
  Object.assign(h.context,{embodiment:{classList:{toggle(){}},setAttribute(){}},hideSummon(){},scheduleAIOrbIdle(){},updateEmbodimentLabel(){}});
  vm.runInContext(core.slice(start,end),h.context);
  h.state.activeAI=null;h.context.setBusy(false);await h.drain();
  assert.equal(requests,1);assert.equal(h.runtime.data.deferred,false);
  h.context.setBusy(false);await h.drain();assert.equal(requests,1,"settling again cannot duplicate the classification");
});

test("an open Agent panel leaves local Suggest visible at 500 ms before read-only ranking",async()=>{
  let requests=0;
  const h=suggestionRuntime(async()=>{requests++;return okAnswer("solve");});
  h.context.canvasAgentSuppressesAutomaticAI=()=>true;
  h.stroke();await h.tick();
  assert.equal(h.shown.length,1,"Agent execution policy must not suppress the local bar");
  assert.equal(h.shown[0].view.source,"local");assert.equal(requests,0);
  await h.drain();assert.equal(requests,1);
});

test("stalled suggestions stop after the queue-aware deadline and release the current request",async()=>{
  let signal;
  const h=suggestionRuntime((_url,options)=>{signal=options.signal;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));});
  h.stroke();await h.tick();await h.tick();
  assert.ok(h.runtime.data.controller);
  assert.equal([...h.timers.values()][0].at,45600,'the 1600 ms launch has a 44-second queue and transport deadline');
  await h.tick();
  assert.equal(signal.aborted,true);
  assert.equal(h.runtime.data.controller,null);
  assert.equal(h.runtime.data.request,null);
  assert.equal(h.runtime.data.failures,1);
  assert.equal(h.shown[0].view.source,'local','local help survives the remote timeout');
});

test("ordinary Suggest preserves a ranked Answer first/second and otherwise defaults to third/last",()=>{
  const source=read("src/client/app/smart-suggestions.js"),start=source.indexOf("  function assistAnswerView("),end=source.indexOf("  // What the bar should offer",start);
  const reserve=vm.runInNewContext(source.slice(start,end)+"\nassistAnswerView;");
  const ids=view=>Array.from(view.items,item=>item.id);
  for(const [before,after] of [
    [[],["answer"]],[["typeset"],["typeset","answer"]],
    [["plot","solve"],["plot","solve","answer"]],
    [["plot","solve","typeset"],["plot","solve","answer"]],
    [["answer","plot","solve"],["answer","plot","solve"]],
    [["plot","answer","solve"],["plot","answer","solve"]],
  ]) {
    const view={items:before.map(id=>({id,source:"penecho-llm"})),more:[],confident:true,source:"penecho-llm"};
    const fixed=reserve(view);
    assert.deepEqual(ids(fixed),after);
    assert.deepEqual(Array.from(fixed.more,item=>item.id),before.filter(id=>!after.includes(id)));
    assert.deepEqual(ids(view),before,"ranking data is not mutated");
    assert.equal(fixed.confident,before.length>0);
  }
  const sparse = reserve(SMART.rankActions({answers:{kind:answer({notes:1}),action:answer({check_step:.7,answer:.2,none:.1}),check_applicable:{type:"noul",noul:.1}}}));
  assert.deepEqual(ids(sparse),["answer"],"reserving Answer never promotes a deferred Check to fill empty slots");
  assert.deepEqual(Array.from(sparse.more,item=>item.id),["check_step"]);
  const fixed=reserve({items:[{id:"plot"},{id:"solve"},{id:"typeset"}],more:[{id:"answer"},{id:"explain"}],confident:true});
  assert.deepEqual(ids(fixed),["plot","solve","answer"]);
  assert.deepEqual(Array.from(fixed.more,item=>item.id),["typeset","explain"]);
  for(const source of ["local","penecho-llm"]) {
    for(const confident of [false,true]) {
      for(const before of [["answer","plot","solve"],["plot","answer","solve"]]) {
        const view={items:before.map(id=>({id,source})),more:[{id:"answer"},{id:"explain"}],confident,source};
        const output=reserve(view);
        assert.deepEqual(ids(output),before,"the calibrated instant order and PenEchoLLM both keep a top-two Answer");
        assert.equal(output.confident,confident&&output.items[0].id===before[0]);
        assert.equal(output.items.filter(item=>item.id==="answer").length,1);
        assert.deepEqual(Array.from(output.more,item=>item.id),["explain"]);
      }
    }
  }
});

test("visual Answer survives kind agreement and ranking for structured and pictorial input",()=>{
  for(const kind of ["diagram","shape","drawing","question"]) {
    const answers={kind:answer({[kind]:1}),action:answer({answer:.75,diagram:.2,none:.05}),finished:{type:"noul",noul:1}};
    assert.equal(SMART.decide(answers).chips[0].id,"answer",kind);
    const local={kind,probabilities:{diagram:.8,explain:.2}};
    const ranked=SMART.rankActions({local,answers});
    assert.equal(ranked.items[0].id,"answer",kind);
    assert.equal(ranked.confident,true);
  }
});

test("local, ranked, none and cooled input suggestions always retain the manual Answer shortcut",async()=>{
  for(const action of ["answer","diagram","none"]) {
    const h=suggestionRuntime(async()=>okAnswer(action));
    h.runtime.data.cooldown.answer={count:2,until:999999};
    h.stroke();await h.tick();
    assert.equal(h.shown.at(-1).view.items.at(-1).id,"answer","local suggestions include Answer despite cooldown");
    await h.tick();
    const view=h.shown.at(-1).view;
    assert.equal(view.source,"penecho-llm");
    assert.equal(view.items[2].id,"answer");
    assert.equal(view.items.filter(item=>item.id==="answer").length,1);
    assert.ok(!view.more.some(item=>item.id==="answer"));
    if(action==="none")assert.equal(view.confident,false);
  }
});

test("pen-up shows actions after 500 ms, then requests after 100 ms for short writing or 500 ms above 3 seconds",async()=>{
  let calls=0;
  const h=suggestionRuntime(async()=>{calls++;return okAnswer("diagram");});
  h.stroke();
  assert.equal(h.shown.length,0);
  assert.equal(h.timers.get(h.runtime.data.localTimer).at,1500);
  assert.equal(h.timers.get(h.runtime.data.timer).at,1600);
  h.setTime(1499);h.context.assistRefresh("late-reply");assert.equal(h.shown.length,0);
  await h.tick();assert.equal(h.shown.length,1);assert.equal(calls,0);
  h.setTime(1599);await h.runtime.run();assert.equal(calls,0);
  await h.tick();assert.equal(calls,1);
  h.setTime(1700);h.stroke(200,3001);
  assert.equal(h.timers.get(h.runtime.data.localTimer).at,5201);
  assert.equal(h.timers.get(h.runtime.data.timer).at,5701);
  await h.tick();assert.equal(h.shown.at(-1).cluster.strokes.length,2,"all unprocessed input stays in the complete scope after ranking");
  h.setTime(5300);h.stroke(300);
  assert.equal(h.timers.get(h.runtime.data.timer).at,6300,"each pen-up restarts the full quiet period");
  await h.tick();h.setTime(6299);await h.runtime.run();assert.equal(calls,1);
  await h.tick();assert.equal(calls,2);
  h.runtime.consume(h.runtime.data.strokes.at(-1).id);
  h.setTime(7000);h.stroke(600);
  assert.equal(h.timers.get(h.runtime.data.timer).at,7600,"successful consumption starts a fresh 600 ms cycle");
});

test("an early local timer is rearmed instead of leaving the bar absent until the model reply",async()=>{
  const reply=deferred();let requests=0;
  const h=suggestionRuntime(()=>{requests++;return reply.promise;});
  h.stroke();
  const id=h.runtime.data.localTimer,timer=h.timers.get(id);
  h.timers.delete(id);h.setTime(1499.6);timer.fn();
  assert.equal(h.shown.length,0,"the 500 ms quiet period is still respected");
  assert.ok(h.runtime.data.localTimer,"an early callback cannot discard the visibility deadline");
  assert.ok(h.timers.get(h.runtime.data.localTimer).at>=1500);
  assert.equal(h.timers.get(h.runtime.data.timer).at,1600,"rearming display leaves the request deadline unchanged");
  await h.tick();assert.equal(h.shown.length,1);assert.equal(requests,0);
  await h.tick();assert.equal(requests,1);assert.equal(h.shown.at(-1).view.source,"local");
  reply.resolve(okAnswer("solve"));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.shown.at(-1).view.source,"penecho-llm");
});

test("small ink, pending drafts and gesture classification cannot suppress the 500 ms local bar",async()=>{
  for(const condition of ["small-ink","pending-draft","gesture"]){
    const h=suggestionRuntime(()=>assert.fail("only the local visibility deadline is exercised"));
    if(condition==="pending-draft")h.state.pending={box:{x:600,y:400,w:200,h:100}};
    if(condition==="gesture"){
      h.context.penIntelStrokeFinished=()=>true;h.context.handwritingCoachActive=()=>true;
    }
    h.begin();
    if(condition==="small-ink"){h.state.scale=.1;h.state.drawing.bbox={x:100,y:100,w:1,h:1};h.state.drawing.samples=[{point:{x:100,y:100}}];}
    h.finish();await h.tick();
    assert.equal(h.shown.length,1,condition);
    assert.ok(h.shown[0].view.items.some(item=>item.id==="answer"),condition);
  }
});

test("hover over an old target cannot defer the local bar for newly finished ink",async()=>{
  const h=suggestionRuntime(async()=>okAnswer("solve"));
  h.stroke();await h.tick();await h.tick();h.stroke(400);
  h.runtime.data.bar.hovered=true;
  await h.tick();
  assert.equal(h.shown.at(-1).cluster.strokes.at(-1).id,h.runtime.data.strokes.at(-1).id);
  assert.equal(h.runtime.data.bar.deferred,null);
});

test("an old reply cannot bypass the newest pen-up deadline or hold local suggestions behind a gesture",async()=>{
  const reply=deferred();let calls=0;
  const h=suggestionRuntime(async()=>{calls++;return calls===1?reply.promise:okAnswer("diagram");});
  h.stroke(0,3100);await h.tick();await h.tick();
  h.setTime(5200);h.stroke(100);await h.tick();
  reply.resolve(okAnswer("diagram"));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.timers.get(h.runtime.data.timer).at,6200,"completion respects the new 1 s quiet period");
  h.state.activeAI={};h.setTime(5400);h.stroke(200);await h.tick();
  assert.equal(h.shown.at(-1).cluster.strokes.length,3,"new local actions include all unprocessed input");
});

test("continued strokes restart local visibility and late replies cannot reveal the bar during the 500 ms pause",async()=>{
  const reply=deferred();let calls=0;
  const h=suggestionRuntime(async()=>{calls++;return calls===1?reply.promise:okAnswer("plot");});
  h.stroke();h.setTime(1400);h.begin(50);
  assert.equal(h.runtime.data.localTimer,0);assert.equal(h.runtime.data.timer,0);
  h.context.assistRefresh("status-ready");assert.equal(h.shown.length,0);
  h.setTime(1500);h.finish();
  assert.equal(h.timers.get(h.runtime.data.localTimer).at,2000);
  h.setTime(1999);h.context.assistRefresh("status-ready");assert.equal(h.shown.length,0);
  await h.tick();await h.tick();assert.equal(calls,1);
  h.stroke(100);
  const shown=h.shown.length;
  reply.resolve(okAnswer("diagram"));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.shown.length,shown,"the saved default does not bypass the display deadline");
  await h.tick();assert.equal(h.shown.at(-1).view.source,"penecho-llm","the late answer remains a default while all input stays dirty");
  assert.equal(calls,1,"displaying the default does not make a second early request");
  await h.tick();assert.equal(calls,2);
});

test("writing tiers count pen-down duration, exclude pauses and do not depend on zoom",()=>{
  for(const [duration,tier,delay] of [[3000,"short",600],[3001,"medium",1000],[10000,"medium",1000],[10001,"long",1000]]){
    for(const scale of [.1,1,8]){
      const h=suggestionRuntime(()=>assert.fail("no request before the quiet period"));h.state.scale=scale;h.stroke(0,duration);
      assert.equal(h.runtime.tier(),tier);assert.equal(h.runtime.data.writingMs,duration);
      assert.equal(h.runtime.data.inkReadyAt,1000+duration+delay);
    }
  }
  const h=suggestionRuntime(()=>assert.fail("no request while writing"));
  h.stroke(0,1500);h.setTime(7500);h.stroke(50,1500);
  assert.equal(h.runtime.tier(),"short","six seconds of pauses do not count as writing");
  h.stroke(100,1);assert.equal(h.runtime.tier(),"medium");
  h.setTime(18000);h.stroke(200,100);
  assert.equal(h.runtime.data.writingMs,3101,"a long pause neither counts as writing nor consumes the existing input");
  h.runtime.consume(h.runtime.data.strokes.at(-1).id);h.stroke(250,100);
  assert.equal(h.runtime.tier(),"short","successful consumption starts a fresh writing count");
});

test("pen-down interrupts the entire quiet period and short writing stays at 600 ms after earlier requests",async()=>{
  let calls=0;const h=suggestionRuntime(async()=>{calls++;return okAnswer("diagram");});
  h.stroke(0,100);await h.tick();
  h.setTime(1699);h.begin();h.setTime(3000);await h.runtime.run();
  assert.equal(calls,0);assert.equal(h.runtime.data.timer,0);
  h.finish();await h.tick();h.setTime(3599);await h.runtime.run();assert.equal(calls,0);
  await h.tick();assert.equal(calls,1);
  h.stroke(50,100);assert.equal(h.runtime.data.inkReadyAt,4300,"having requested before does not change the short delay");
});

test("every writing tier displays its final answer and retains it as a default while refreshing the complete input",async()=>{
  for(const duration of [100,3001,10001]){
    const h=suggestionRuntime(async()=>okAnswer("diagram"));
    h.stroke(0,duration);await h.tick();assert.equal(h.shown.at(-1).view.source,"local");
    await h.tick();
    assert.equal(h.runtime.data.nextCandidate,null);assert.ok(h.runtime.data.jev);
    assert.equal(h.shown.at(-1).view.source,"penecho-llm");
    assert.equal(h.runtime.data.bar.element.dataset.rank,"ranked");
    assert.equal(h.timers.size,0,"the final answer needs no further input or timer");
    h.stroke(50,100);await h.tick();
    assert.equal(h.shown.at(-1).view.source,"penecho-llm");
    assert.equal(h.shown.at(-1).view.routing,null,"an old candidate cannot route execution for newly written content");
    assert.equal(h.runtime.data.nextCandidate,null);assert.equal(h.runtime.data.bar.element.dataset.rank,"refreshing");
  }
});

test("an interrupted successful response preserves its input and cannot replace a newer answer",async()=>{
  const replies=[],signals=[];const h=suggestionRuntime((_url,options)=>{const d=deferred();replies.push(d);signals.push(options.signal);return d.promise;});
  h.stroke(0,3100);await h.tick();await h.tick();
  h.begin(50);assert.equal(signals[0].aborted,true);
  replies[0].resolve(okAnswer("diagram"));await new Promise(resolve=>setImmediate(resolve));
  assert.ok(h.runtime.data.nextCandidate);assert.equal(h.runtime.data.jev,null);
  h.finish();await h.tick();assert.equal(h.shown.at(-1).view.source,"penecho-llm");
  await h.tick();assert.equal(replies.length,2);
  h.stroke(100);await h.tick();await h.tick();assert.equal(replies.length,3);
  replies[2].resolve(okAnswer("plot"));await new Promise(resolve=>setImmediate(resolve));
  replies[1].resolve(okAnswer("diagram"));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.runtime.data.nextCandidate,null);
  assert.equal(h.runtime.data.jev.answers.action.choice,"plot","an older late answer cannot replace the newer answer");
  h.stroke(150);await h.tick();assert.equal(h.shown.at(-1).view.items[0].id,"plot");
});

test("an interrupted answer supplies a default without routing newer pending input for any writing tier",async()=>{
  for(const duration of [100,3100,10100]){
    const replies=[],h=suggestionRuntime(()=>{const reply=deferred();replies.push(reply);return reply.promise;});
    h.stroke(0,duration);await h.tick();await h.tick();
    h.stroke(50);await h.tick();
    replies[0].resolve(okAnswer("diagram"));await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.shown.at(-1).view.source,"penecho-llm");
    assert.equal(h.shown.at(-1).view.routing,null,"a default does not route execution for newer ink");
    assert.equal(h.runtime.data.bar.element.dataset.rank,"refreshing");
    await h.tick();assert.equal(replies.length,2,"the final pen-up still requests the newest ink");
    replies[1].resolve(okAnswer("plot"));await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.shown.at(-1).view.items[0].id,"plot");
    assert.equal(h.runtime.data.bar.element.dataset.rank,"ranked");
    h.stroke(1000);await h.tick();assert.equal(h.shown.at(-1).view.source,"penecho-llm","pending input retains a default while its complete scope is refreshed");
  }
});

test("the real polynomial response displays after the last pen-up, including a hovered bar",async()=>{
  const data=JSON.parse(read("test/fixtures/penecho-llm-polynomial.json"));
  for(const duration of [100,3001,10001]){
    const h=suggestionRuntime(async()=>({ok:true,json:async()=>data}));
    h.stroke(0,duration);await h.tick();h.runtime.data.bar.hovered=true;await h.tick();
    assert.equal(h.state.drawing,null);
    assert.equal(h.runtime.data.nextCandidate,null);
    assert.equal(h.shown.at(-1).view.source,"penecho-llm");
    assert.equal(h.shown.at(-1).view.items[0].id,"typeset","display the actual model result, even before its prompt is corrected");
    assert.ok(h.shown.at(-1).view.items.some(item=>item.id==="solve"));
    assert.equal(h.runtime.data.bar.element.dataset.rank,"ranked");
    assert.equal(h.timers.size,0);
  }
});

test("ink classification sends immediately without Widget preparation and preserves the next pen-up deadline",async()=>{
  const reply=deferred();let preparations=0,calls=0;
  const h=suggestionRuntime(()=>++calls===1?reply.promise:Promise.resolve(okAnswer("diagram")));
  h.setSnapshots(()=>{preparations++;return new Promise(()=>{});});
  h.stroke();await h.tick();await h.tick();assert.equal(calls,1);assert.equal(preparations,0);
  h.begin(50);h.finish();await h.tick();
  reply.resolve(okAnswer("diagram"));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
  assert.equal(h.timers.get(h.runtime.data.timer).at,2200,"a late reply preserves the new pause deadline");
  h.setTime(2199);await h.runtime.run();assert.equal(calls,1);
  await h.tick();assert.equal(calls,2);assert.equal(preparations,0);
});

test("late candidates are invalidated by consumption, erasure, Undo, dismissal, selection and document changes",async()=>{
  for(const invalidate of [
    h=>h.runtime.consume(h.runtime.data.strokes.at(-1).id),
    h=>h.runtime.finish({erase:true}),
    h=>{h.state.history=[];},
    h=>h.runtime.cancel("dismissed"),
    h=>{h.state.selection={phase:"active",box:{x:100,y:100,w:200,h:150},image:"SELECTED"};h.runtime.syncSelection();},
    h=>{h.setDocument("second");h.runtime.start();},
    h=>h.runtime.toggle(false),
  ]){
    const reply=deferred();const h=suggestionRuntime(()=>reply.promise);
    h.stroke(0,3100);await h.tick();await h.tick();h.begin(50);invalidate(h);
    reply.resolve(okAnswer("diagram"));await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.runtime.data.nextCandidate,null);assert.equal(h.runtime.data.jev,null);
  }
});

test("ranking progress returns when a failed or ranked cluster is requested again",async()=>{
  let calls=0;const reply=deferred();const h=suggestionRuntime(()=>++calls===1?Promise.reject(Error("offline")):reply.promise);
  h.stroke();await h.tick();assert.equal(h.runtime.data.bar.element.dataset.rank,"pending");
  await h.tick();assert.equal(h.runtime.data.bar.element.dataset.rank,"pending","a retry timer takes precedence over an old failure");
  await h.tick();assert.equal(h.runtime.data.bar.element.dataset.rank,"pending","starting the request refreshes an unchanged bar");
  reply.resolve(okAnswer("diagram"));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.runtime.data.bar.element.dataset.rank,"ranked");
});

test("ranking preserves the complete pending input without time or distance grouping across cache eviction",async()=>{
  const h=suggestionRuntime(async()=>okAnswer("diagram"));
  h.stroke();h.state.dirty={x:95,y:95,w:210,h:1160};
  await h.drain();
  assert.deepEqual(h.state.dirty,{x:95,y:95,w:210,h:1160},"classification does not clear pending input");
  h.setTime(60000);h.stroke(1000);
  assert.equal(h.runtime.cluster().strokes.length,2,"a distant later line shares the complete unprocessed input");
  const contains=(box,point)=>point.x>=box.x&&point.y>=box.y&&point.x<=box.x+box.w&&point.y<=box.y+box.h;
  assert.ok(contains(h.runtime.region(h.runtime.cluster()),{x:100,y:100}),"the earlier line remains pending until its action succeeds");
  assert.ok(contains(h.runtime.region(h.runtime.cluster()),{x:300,y:1250}),"dirty input outside the viewport is retained");
  for(let i=0;i<80;i++)h.stroke(1000);
  h.state.history.splice(0,h.state.history.length-30);
  assert.equal(h.runtime.data.strokes.length,64);
  assert.ok(contains(h.runtime.region(h.runtime.cluster()),{x:100,y:1250}),"pending raster dirty bounds survive both bounded caches");
  assert.ok(contains(h.runtime.region(h.runtime.cluster()),{x:100,y:100}),"the old pending raster remains even after its vectors and history are evicted");
  h.state.dirty={x:95,y:1095,w:210,h:160};
  assert.equal(contains(h.runtime.region(h.runtime.cluster()),{x:100,y:100}),false,"consumed or erased input is not retained as dirty");
});

test("gesture crops include the complete dirty writing and stay within Canvas bounds",()=>{
  const h=suggestionRuntime(async()=>okAnswer("none"));
  h.state.dirty={x:290,y:210,w:260,h:460};
  const region=h.runtime.region({box:{x:390,y:630,w:25,h:25}});
  assert.ok(region.x<=290&&region.y<=210);
  assert.ok(region.x+region.w>=550&&region.y+region.h>=670);
  h.state.dirty={x:-10,y:-10,w:20030,h:20030};
  assert.deepEqual(JSON.parse(JSON.stringify(h.runtime.region({box:{x:100,y:100,w:10,h:10}}))),{x:0,y:0,w:20000,h:20000});
});

test("dismissed ink remains available for explicit recall, while accepted and undone ink does not",()=>{
  const h=suggestionRuntime(async()=>okAnswer("diagram"));
  h.stroke();
  const cluster=h.runtime.cluster();
  h.runtime.data.dismissedStrokeId=cluster.strokes.at(-1).id;
  assert.equal(h.runtime.cluster(),null,"dismissed ink cannot automatically reopen");
  assert.equal(h.runtime.cluster(true).key,cluster.key,"explicit recall keeps the original ink scope");
  h.runtime.data.consumedStrokeId=cluster.strokes.at(-1).id;
  assert.equal(h.runtime.cluster(true),null,"an accepted action consumes its ink");
  h.runtime.data.consumedStrokeId=0;
  h.state.history=[];
  assert.equal(h.runtime.cluster(true),null,"undone ink cannot be recalled");
  h.setDocument("second");h.runtime.start();
  assert.equal(h.runtime.data.dismissedStrokeId,0);
  assert.equal(h.runtime.cluster(true),null,"recall never crosses documents");
});

test("reopening unranked dirty ink immediately restarts cancelled ranking in Pen and Hand, then reuses its verdict",async()=>{
  for(const mode of ["pen","hand"]){
    const replies=[],signals=[],h=suggestionRuntime((_url,options)=>{const reply=deferred();replies.push(reply);signals.push(options.signal);return reply.promise;});
    h.stroke();h.state.dirty={x:96,y:96,w:208,h:158};await h.tick();await h.tick();
    assert.equal(replies.length,1);
    h.runtime.dismiss("blank-tap");
    assert.equal(signals[0].aborted,true,"blank taps still cancel ranking");
    replies[0].resolve(okAnswer("plot"));await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.runtime.data.bar,null,"cancelled replies cannot reopen help");
    h.state.mode=mode;
    h.runtime.data.localReadyAt=10000;h.runtime.data.inkReadyAt=10000;h.runtime.data.pausedUntil=10000;
    h.runtime.reopen({x:200,y:150});
    assert.equal(h.runtime.data.bar.mode,"suggest");
    assert.equal(h.runtime.data.bar.element.dataset.rank,"pending","the bar immediately shows the active ranking");
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(replies.length,2,"reopening starts the request without advancing time or running a debounce timer");
    h.runtime.reopen({x:200,y:150});assert.equal(replies.length,2,"pointer movement over visible help cannot duplicate requests");
    replies[1].resolve(okAnswer("diagram"));await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.shown.at(-1).view.source,"penecho-llm",mode);
    assert.equal(h.shown.at(-1).view.items[0].id,"diagram",mode);
    assert.equal(h.runtime.data.bar.element.dataset.rank,"ranked");
    h.runtime.dismiss("blank-tap");h.runtime.reopen({x:200,y:150});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(replies.length,2,"reopening ranked ink reuses the completed verdict");
    assert.equal(h.runtime.data.bar.element.dataset.rank,"ranked");
  }
});

test("lasso suggestions classify the masked selection without recent Canvas content",async()=>{
  const requests=[];
  const h=suggestionRuntime(async(_url,options)=>{requests.push(JSON.parse(options.body));return okAnswer("plot");});
  h.stroke();
  h.state.latestTypedInput={text:"OUTSIDE PRIVATE TEXT",box:{x:0,y:0,w:900,h:900}};
  h.runtime.data.profile={diagram:1};h.runtime.data.recent=["OUTSIDE RECENT ACTION"];
  h.state.widgets=[{x:100,y:100,w:200,h:150,title:"OUTSIDE WIDGET TITLE"}];
  h.state.mode="select";
  h.state.selection={phase:"active",box:{x:100,y:100,w:200,h:150},image:"SELECTED"};
  h.runtime.syncSelection();await h.drain();
  assert.equal(requests.length,1);
  assert.equal(requests[0].image,"data:image/png;base64,SELECTED");
  assert.deepEqual(Object.keys(requests[0]).sort(),["context","image","mode","version"]);
  assert.equal(requests[0].mode,"selection");
  assert.equal(requests[0].context.shapesFit,false);
  assert.ok(h.shown.some(model=>model.view?.source==="local"));
  assert.equal(h.shown.at(-1).view.items[0].id,"plot");
  assert.equal(h.shown.at(-1).cluster.selection,h.state.selection);
});

test("Widget-only lasso classification waits for the Widget's pixels under its own deadline before sending",async()=>{
  const requests=[],captures=[],widget={id:"lasso-widget",x:500,y:100,w:200,h:150,snapshotImage:null};
  const h=suggestionRuntime(async(_url,options)=>{requests.push(JSON.parse(options.body));return okAnswer("plot");});
  const originalBox={x:100,y:100,w:200,h:150};
  h.state.mode="select";
  h.context.capturableWidgets=()=>[widget];
  h.state.selection={phase:"active",regionOnly:true,originalBox,box:{...originalBox,x:500},fragments:[],image:"CURRENT"};
  let finish;const delays=[],schedule=h.context.setTimeout;h.context.setTimeout=(fn,delay)=>{delays.push(delay);return schedule(fn,delay);};
  h.setSnapshots((widgets,options)=>{captures.push({widgets,options});return new Promise(resolve=>{finish=()=>{widget.snapshotImage={};resolve({complete:true,missing:0,missingWidgets:[],pending:[]});};});});
  h.runtime.syncSelection();await h.tick();await h.tick();
  assert.equal(captures.length,1);assert.deepEqual(captures[0].widgets,[widget]);
  assert.equal(captures[0].options.timeoutMs,8000);assert.equal(captures[0].options.reuseWithinMs,0,"a lasso always captures the Widget as it looks now");assert.equal(captures[0].options.signal.aborted,false);
  assert.equal(captures[0].options.currentFrame,true,"lasso pixels do not wait for document load");
  assert.equal(requests.length,0,"nothing is sent before the Widget has pixels");
  assert.equal(h.runtime.data.status.state,"pending");
  assert.equal(delays.includes(44000),false,"the model deadline has not started yet");
  finish();await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,1);assert.equal(delays.includes(44000),true,"the model deadline starts when the request is sent");
  assert.equal(requests[0].mode,"selection");
  assert.equal(requests[0].image,"data:image/png;base64,CURRENT");
  assert.equal(h.runtime.data.strokes.length,0);
});

test("an incomplete Widget capture keeps local suggestions, ends pending, and retries once when the capture lands",async()=>{
  const requests=[],widget={id:"slow-widget",x:500,y:100,w:200,h:150,snapshotImage:null};let calls=0,land;
  const h=suggestionRuntime(async(_url,options)=>{requests.push(JSON.parse(options.body));return okAnswer("plot");});
  h.state.mode="select";h.context.capturableWidgets=()=>[widget];
  h.state.selection={phase:"active",regionOnly:true,originalBox:{x:500,y:100,w:200,h:150},box:{x:500,y:100,w:200,h:150},fragments:[],image:"CURRENT"};
  const background=new Promise(resolve=>{land=()=>{widget.snapshotImage={};resolve();};});
  h.setSnapshots(async()=>{calls++;return widget.snapshotImage?{complete:true,missing:0,missingWidgets:[],pending:[]}:{complete:false,missing:1,missingWidgets:[widget],pending:[background]};});
  h.runtime.syncSelection();await h.tick();await h.tick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,0,"an image with a missing Widget is never sent");
  assert.equal(h.runtime.data.status.state,"failed");assert.equal(h.runtime.data.status.reason,"snapshot-unavailable");
  assert.ok(h.shown.some(model=>model.view?.source==="local"),"local suggestions remain available");
  land();await new Promise(resolve=>setImmediate(resolve));await h.drain();
  assert.equal(calls,2);assert.equal(requests.length,1,"one bounded retry uses the completed capture");
  assert.equal(requests[0].image,"data:image/png;base64,CURRENT");
});

test("cancelling the lasso aborts Widget preparation immediately",async()=>{
  const requests=[],widget={id:"w",x:500,y:100,w:200,h:150,snapshotImage:null};let signal=null;
  const h=suggestionRuntime(async(_url,options)=>{requests.push(JSON.parse(options.body));return okAnswer("plot");});
  h.state.mode="select";h.context.capturableWidgets=()=>[widget];
  h.state.selection={phase:"active",regionOnly:true,originalBox:{x:500,y:100,w:200,h:150},box:{x:500,y:100,w:200,h:150},fragments:[],image:"CURRENT"};
  h.setSnapshots((_widgets,options)=>{signal=options.signal;return new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(Error("cancelled"))));});
  h.runtime.syncSelection();await h.tick();await h.tick();
  assert.equal(signal.aborted,false);
  h.state.selection=null;h.runtime.syncSelection();
  assert.equal(signal.aborted,true);
  await h.drain();assert.equal(requests.length,0);
});

test("reselection and transforms reject stale JeVision answers",async()=>{
  const responses=[],signals=[];
  const h=suggestionRuntime((_url,options)=>{const d=deferred();responses.push(d);signals.push(options.signal);return d.promise;});
  h.state.mode="select";
  h.state.selection={phase:"active",box:{x:100,y:100,w:200,h:150},image:"FIRST"};
  h.runtime.syncSelection();await h.tick();await h.tick();
  h.state.selection={phase:"active",box:{x:500,y:100,w:200,h:150},image:"SECOND"};
  h.runtime.syncSelection();
  assert.equal(signals[0].aborted,true);
  responses[0].resolve(okAnswer("prototype"));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.runtime.data.jev,null,"old selection cannot rerank the new one");
  await h.tick();await h.tick();
  h.state.selection.box.x+=50;h.state.selectionGesture={id:1};h.runtime.syncSelection();
  assert.equal(signals[1].aborted,true,"moving the selection invalidates its pending result");
  responses[1].resolve(okAnswer("diagram"));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.runtime.data.jev,null);
  h.state.selection=null;h.state.selectionGesture=null;h.runtime.syncSelection();
  await h.drain();assert.equal(responses.length,2,"cancel leaves no pending classifier work");
});

test("new pen-down aborts short requests and the next quiet period starts without waiting for them",async()=>{
  const replies=[];let calls=0,aborted=0;
  const h=suggestionRuntime((url,options)=>{calls++;options.signal.addEventListener("abort",()=>aborted++);const d=deferred();replies.push(d);return d.promise;});
  h.stroke();await h.tick();
  assert.equal(h.shown.length,1,"local help is shown before any network answer");assert.equal(h.shown[0].mode,"suggest");assert.equal(h.shown[0].view.source,"local");
  assert.ok(h.shown[0].view.items.length>=1&&h.shown[0].view.items.some(item=>item.id==="snap_shapes"),"a rough rectangle offers Clean up shapes instantly");
  await h.tick();assert.equal(calls,1,"JeVision is asked after the idle delay");
  h.setTime(2000);h.stroke(200);await h.tick();
  assert.equal(aborted,1,"new ink cancels the in-flight JeVision request");
  await h.tick();assert.equal(calls,2,"the next request does not wait for the old fetch to settle");
  replies[0].resolve(okAnswer("diagram"));await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  const ranked=h.shown.filter(model=>model.view?.source==="penecho-llm");
  assert.ok(ranked.length>0,"a late reply supplies a default while the complete input is still pending");
  assert.equal(h.runtime.data.nextCandidate,null);
  assert.equal(h.runtime.data.controller.signal.aborted,false,"the old finalizer cannot clear the new request");
  replies[1].resolve(okAnswer("diagram"));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.shown.at(-1).view.items[0].id,"diagram");
  assert.equal(h.timers.size,0);
});

test("unchanged ink retries once and stops until new input starts a fresh request",async()=>{
  let calls=0,offline=true;const h=suggestionRuntime(async()=>{calls++;if(offline)throw Error("offline");return okAnswer('plot');});h.stroke();
  await h.drain();assert.equal(calls,2);assert.equal(h.timers.size,0);
  assert.equal(h.runtime.data.status.state,"failed");assert.equal(h.runtime.data.status.reason,"network");
  assert.equal(h.runtime.data.bar.element.dataset.rank,"local","exhausted retries stop the waiting indicator");
  await h.runtime.run();await h.runtime.refresh();await h.drain();assert.equal(calls,2,"availability recovery cannot restart exhausted input");
  h.state.dirty={x:96,y:96,w:208,h:158};
  h.runtime.dismiss("blank-tap");h.runtime.reopen({x:200,y:150});await h.drain();
  assert.equal(calls,4,"an explicit manual recall receives one new retry, then stops again");assert.equal(h.timers.size,0);
  offline=false;h.stroke(50);await h.drain();assert.equal(calls,5);
  assert.equal(h.runtime.data.jev.answers.action.choice,'plot');
});

test("a timed-out request gets only one retry, with a fresh queue-aware deadline",async()=>{
  const signals=[];
  const h=suggestionRuntime((_url,{signal})=>{signals.push(signal);return new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}));});
  h.stroke();await h.drain();
  assert.equal(signals.length,2);assert.ok(signals.every(signal=>signal.aborted));
  assert.equal(h.runtime.data.controller,null);assert.equal(h.runtime.data.request,null);assert.equal(h.timers.size,0);
  assert.equal(h.runtime.data.status.reason,"timeout");assert.equal(h.runtime.data.bar.element.dataset.rank,"local");
});

test("dismissing ink stops outage retries, and temporary AI work does not lose recovery",async()=>{
  let calls=0;const h=suggestionRuntime(async()=>{calls++;throw Error('offline');});h.stroke();
  await h.tick();await h.tick();assert.equal(calls,1);
  h.state.activeAI={};await h.tick();assert.equal(calls,1);
  h.state.activeAI=null;await h.tick();assert.equal(calls,2);
  h.runtime.data.dismissedStrokeId=h.runtime.cluster().strokes.at(-1).id;
  await h.drain();assert.equal(calls,2);assert.equal(h.timers.size,0);
});

test("due new input recovers failed availability before cooldown expires and proceeds to ranking",async()=>{
  for (const status of [503,401,403,200]) {
    let probes=0,calls=0;
    const h=suggestionRuntime(async()=>{calls++;return okAnswer('plot');},new Map(),async()=>++probes===1?{ok:status===200,status,json:async()=>({configured:false})}:{ok:true,json:async()=>({configured:true})});
    await h.runtime.refresh();assert.equal(h.runtime.data.available,false);assert.equal(h.timers.size,0);
    h.stroke();assert.equal(probes,1,"recovery waits for pen-up quiet");await h.drain();
    assert.equal(probes,2);assert.equal(calls,1);assert.equal(h.runtime.data.available,true);
    assert.equal(h.runtime.data.jev.answers.action.choice,'plot');assert.equal(h.timers.size,0);
  }
});

test("every new input retries unavailable status without creating an idle retry loop",async()=>{
  let probes=0,calls=0;
  const h=suggestionRuntime(async()=>{calls++;return okAnswer('plot');},new Map(),async()=>({ok:++probes>=4,status:probes>=4?200:503,json:async()=>({configured:probes>=4})}));
  await h.runtime.refresh();
  for(let index=0;index<3;index++) {
    h.stroke(index*50);await h.drain();
    assert.equal(probes,index+2);assert.equal(h.timers.size,0);
  }
  assert.equal(calls,1);assert.equal(h.runtime.data.available,true);
});

test("lasso and explicit dirty-input recall recover unavailable ranking without a settings visit",async()=>{
  for (const intent of ['selection','recall']) {
    let probes=0,calls=0;
    const h=suggestionRuntime(async()=>{calls++;return okAnswer('plot');},new Map(),async()=>({ok:true,json:async()=>({configured:++probes>1})}));
    await h.runtime.refresh();h.stroke();
    if (intent==='selection') {
      h.state.mode='select';h.state.selection={phase:'active',box:{x:100,y:100,w:200,h:150},image:'SELECTED'};
      h.runtime.syncSelection();await h.drain();
    } else {
      h.state.dirty={x:96,y:96,w:208,h:158};h.state.mode='hand';h.runtime.reopen({x:200,y:150});
      await new Promise(resolve=>setImmediate(resolve));await h.drain();
    }
    assert.equal(probes,2);assert.equal(calls,1);assert.equal(h.runtime.data.jev.answers.action.choice,'plot');
  }
});

test("input changed during availability recovery cannot rank the old scope or start while drawing",async()=>{
  const status=deferred();let probes=0,calls=0;
  const h=suggestionRuntime(async()=>{calls++;return okAnswer('plot');},new Map(),async()=>{probes++;return status.promise;});
  h.runtime.data.available=false;h.stroke();await h.tick();await h.tick();
  assert.equal(probes,1);assert.equal(calls,0);
  h.begin(50);status.resolve({ok:true,json:async()=>({configured:true})});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,0,"obsolete recovery does not send a stale image while the pen is down");
  h.finish();await h.drain();assert.equal(calls,1);
  assert.equal(h.runtime.data.jev.strokes.at(-1).id,h.runtime.data.strokes.at(-1).id);
});

test("new input does not inherit an exhausted input's inference backoff",async()=>{
  let calls=0,offline=true;
  const h=suggestionRuntime(async()=>{calls++;if(offline)throw Error('offline');return okAnswer('plot');});
  h.stroke();await h.drain();assert.equal(calls,2);
  const pause=h.runtime.data.pausedUntil;
  offline=false;h.stroke(50);await h.tick();await h.tick();
  assert.equal(calls,3);assert.ok(h.context.performance.now()<pause,"fresh input runs before the old cooldown expires");
  assert.equal(h.runtime.data.jev.answers.action.choice,'plot');assert.equal(h.timers.size,0);
});

test("turning automatic suggestions off cancels ranking, suppresses new ink and persists across reloads",async()=>{
  const preferences=new Map(),reply=deferred();let calls=0,signal;
  const h=suggestionRuntime((_url,options)=>{calls++;signal=options.signal;return reply.promise;},preferences);
  h.stroke();await h.tick();await h.tick();
  assert.equal(calls,1);
  h.runtime.toggle(false);
  assert.equal(signal.aborted,true);
  assert.equal(h.runtime.data.timer,0);
  assert.equal(h.runtime.data.localTimer,0);
  assert.equal(h.runtime.data.holdTimer,0);
  const shown=h.shown.length;
  h.stroke(400);await h.drain();
  assert.equal(h.shown.length,shown,"new ink does not offer actions while disabled");
  reply.resolve(okAnswer("diagram"));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.runtime.data.jev,null,"late replies cannot restore suggestions");
  assert.equal(h.shown.length,shown);
  assert.equal(calls,1);
  const reloaded=suggestionRuntime(()=>assert.fail("disabled preference must survive reload"),preferences);
  assert.equal(reloaded.runtime.data.enabled,false);
  reloaded.stroke();await reloaded.drain();assert.equal(reloaded.shown.length,0);
});

test("manual selections stay available when automatic suggestions are off and re-enabling works offline",async()=>{
  const h=suggestionRuntime(()=>assert.fail("local suggestions need no relay"));
  h.runtime.data.available=false;
  h.runtime.toggle(false);h.stroke();await h.drain();
  assert.equal(h.shown.length,0);
  h.runtime.toggle(true);await h.drain();
  assert.equal(h.shown.at(-1).view.source,"local","enabling immediately restores local help");
  h.runtime.toggle(false);
  h.state.selection={phase:"active",box:{x:100,y:100,w:200,h:150},image:"SELECTED"};
  h.runtime.syncSelection();await h.drain();
  assert.equal(h.shown.at(-1).cluster.selection,h.state.selection);
  assert.deepEqual(Array.from(h.shown.at(-1).view.items,item=>item.id),["typeset","answer"],"explicit selection keeps Answer last with suggestions disabled");
});

test("suggestion state follows Canvas documents, Undo and erasing",()=>{
  const h=suggestionRuntime(async()=>{throw Error("unexpected request");});h.stroke();assert.equal(h.runtime.cluster().strokes.length,1);
  const entry=h.state.history.pop();assert.equal(h.runtime.cluster(),null);h.state.history.push(entry);assert.equal(h.runtime.cluster().strokes.length,1);
  h.runtime.data.cooldown={plot:{count:2,until:999999}};h.runtime.data.pausedUntil=999999;h.setDocument("second");h.runtime.start();
  assert.equal(h.runtime.cluster(),null);assert.equal(Object.keys(h.runtime.data.cooldown).length,0);assert.equal(h.runtime.data.pausedUntil,0);
  h.stroke();h.runtime.finish({erase:true});assert.equal(h.runtime.cluster(),null);assert.equal(h.timers.size,0);
});

test("rough strokes fit exact shapes and scribbles do not", () => {
  const circle = [];
  for (let index = 0; index <= 64; index++) circle.push({ x:400 + 180 * Math.cos(index / 64 * 6.4), y:300 + 176 * Math.sin(index / 64 * 6.4) });
  assert.equal(SMART.fitStroke(noisy(circle, 12)).type, "circle");
  const ellipse = circle.map(point => ({ x:400 + (point.x - 400) * 1.8, y:point.y }));
  assert.equal(SMART.fitStroke(noisy(ellipse, 10)).type, "ellipse");
  const rectangle = SMART.fitStroke(polygonStroke([[100, 100], [520, 106], [522, 330], [96, 326]]));
  assert.equal(rectangle.type, "rectangle");
  assert.equal(rectangle.outline.length, 5);
  assert.ok(Math.abs(rectangle.outline[0].y - rectangle.outline[1].y) < 1e-6, "near-axis rectangles snap level");
  assert.equal(SMART.fitStroke(polygonStroke([[100, 100], [400, 104], [398, 402], [102, 398]])).type, "square");
  assert.equal(SMART.fitStroke(polygonStroke([[100, 500], [300, 140], [500, 500]], 25)).type, "triangle");
  const line = [];
  for (let index = 0; index < 30; index++) line.push({ x:100 + index * 20, y:300 + index * 0.6 });
  assert.equal(SMART.fitStroke(noisy(line, 4)).type, "line");
  const scribble = [];
  for (let index = 0; index < 50; index++) scribble.push({ x:100 + index * 8, y:300 + Math.sin(index * 1.3) * 60 });
  assert.equal(SMART.fitStroke(scribble), null);
  const head = [{ x:652, y:292 }, { x:680, y:318 }, { x:652, y:346 }];
  const arrow = SMART.fitStrokes([noisy(line, 4), head]);
  assert.equal(arrow.length, 1);
  assert.equal(arrow[0].type, "arrow");
  assert.deepEqual(arrow[0].strokeIndexes, [0, 1]);
  assert.equal(arrow[0].head.length, 3);
});

test("shape fitting tolerates rough edges, small closure gaps and incidental corners at different sizes", () => {
  const circle = Array.from({length:65}, (_, i) => ({x:300 + 100 * Math.cos(i / 64 * Math.PI * 1.78), y:300 + 92 * Math.sin(i / 64 * Math.PI * 1.78)})),
    triangle = polygonStroke([[200,450],[300,230],[450,440]]).slice(0, -6),
    line = Array.from({length:31}, (_, i) => ({x:200 + i * 8, y:300 + Math.sin(i * .7) * 8}));
  for (const scale of [.4, 1, 3]) for (let seed = 1; seed <= 20; seed++) {
    for (const [type, points, noise] of [["circle", circle, 16], ["triangle", triangle, 24], ["line", line, 10]]) {
      const input = noisy(points, noise, seed).map(p => ({x:p.x * scale, y:p.y * scale})), fit = SMART.fitStroke(input);
      assert.equal(fit?.type, type, `${type}, scale ${scale}, seed ${seed}`);
      assert.ok(fit.outline.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
    }
  }
});

test("looser shape fitting still rejects waves, open arcs, figure eights, spirals and retracing", () => {
  const curves = {
    wave:t => ({x:100 + t * 50, y:300 + Math.sin(t * 3) * 35}),
    arc:t => ({x:300 + 100 * Math.cos(t * .7), y:300 + 100 * Math.sin(t * .7)}),
    figureEight:t => ({x:300 + 100 * Math.sin(t), y:300 + 70 * Math.sin(t * 2)}),
    spiral:t => ({x:300 + t * 16 * Math.cos(t * 2), y:300 + t * 16 * Math.sin(t * 2)}),
    doubleLoop:t => ({x:300 + 100 * Math.cos(t * 2), y:300 + 100 * Math.sin(t * 2)}),
  };
  for (const [type, point] of Object.entries(curves)) assert.equal(SMART.fitStroke(Array.from({length:100}, (_, i) => point(i / 99 * Math.PI * 2))), null, type);
  assert.equal(SMART.fitStroke([{x:100,y:100},{x:300,y:100},{x:120,y:100},{x:300,y:100}]), null, "repeated straight retracing");
});

function holdDrawing(h, points) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y), drawing = {
    start:points[0], last:points[0], samples:[{point:points[0]}], size:4,
    bbox:{x:Math.min(...xs), y:Math.min(...ys), w:Math.max(...xs) - Math.min(...xs), h:Math.max(...ys) - Math.min(...ys)},
  };
  h.state.drawing = drawing;
  h.runtime.start(drawing);
  for (const point of points.slice(1)) tremor(h, drawing, point.x, point.y);
  return drawing;
}
function tremor(h, drawing, x, y) {
  drawing.last = {x, y};
  drawing.samples.push({point:drawing.last});
  h.runtime.move(drawing);
}

test("hold recognition survives tremor during the pause and at release for lines, circles and triangles", async () => {
  for (const scale of [.25, 1, 3]) for (const type of ["line", "circle", "triangle"]) {
    const h = suggestionRuntime(() => assert.fail("hold recognition is local"));
    h.state.scale = scale;
    const points = type === "line" ? [{x:100,y:200},{x:300,y:200}]
      : type === "circle" ? Array.from({length:64}, (_, i) => ({x:300 + 100 * Math.cos(i / 63 * Math.PI * 1.9), y:300 + 100 * Math.sin(i / 63 * Math.PI * 1.9)}))
      : polygonStroke([[200,450],[300,230],[450,440]]),
      drawing = holdDrawing(h, points), anchor = {x:drawing.smartHold.x, y:drawing.smartHold.y}, timer = h.runtime.data.holdTimer;
    for (let i = 0; i < 20; i++) tremor(h, drawing, anchor.x + Math.sin(i) * 6 / scale, anchor.y + Math.cos(i) * 3 / scale);
    assert.equal(h.runtime.data.holdTimer, timer, `${type}: tremor does not reset the 520 ms pause`);
    await h.tick();
    const fit = drawing.smartHold.fit;
    assert.equal(fit?.type, type, `${type}: sparse samples and stationary tail fit`);
    for (let i = 0; i < 30; i++) tremor(h, drawing, anchor.x + Math.sin(i) * 12 / scale, anchor.y + Math.cos(i) * 8 / scale);
    assert.equal(drawing.smartHold.fit, fit, `${type}: recognized geometry stays fixed`);
    assert.equal(h.runtime.data.holdTimer, 0);
    h.finish();
    assert.equal(h.snapped.length, 1);
    assert.equal(h.snapped[0].outline, fit.outline, `${type}: pen-up applies the recognized shape`);
    assert.equal(h.snapped[0].strokes[0].points.length, drawing.samples.length, "all tremor ink is replaced");
  }
});

test("deliberate continuation cancels a held shape while quick release and disabled Suggest never snap", async () => {
  const line = [{x:100,y:200},{x:300,y:200}], h = suggestionRuntime(() => assert.fail("local only")), drawing = holdDrawing(h, line);
  await h.tick();
  assert.equal(drawing.smartHold.fit.type, "line");
  // Small consecutive steps must still be measured from the fixed anchor.
  for (const dx of [5, 10, 15, 20]) tremor(h, drawing, 300 + dx, 200);
  assert.equal(drawing.smartHold.fit, null);
  assert.notEqual(h.runtime.data.holdTimer, 0);
  assert.equal(h.runtime.data.bar, null);
  h.finish();assert.equal(h.snapped.length, 0);

  const quick = suggestionRuntime(() => assert.fail("local only"));
  holdDrawing(quick, line);quick.finish();assert.equal(quick.snapped.length, 0);
  const disabled = suggestionRuntime(() => assert.fail("local only"));
  holdDrawing(disabled, line);await disabled.tick();disabled.runtime.toggle(false);disabled.finish();assert.equal(disabled.snapped.length, 0);
  const tiny = suggestionRuntime(() => assert.fail("local only"));
  holdDrawing(tiny, [{x:100,y:200},{x:110,y:200}]);await tiny.tick();tiny.finish();assert.equal(tiny.snapped.length, 0);
});

test("questions form a closed action space with none as a first-class option", () => {
  const withShapes = SMART.buildQuestions({ shapesFit:true }), withoutShapes = SMART.buildQuestions({ shapesFit:false });
  assert.deepEqual(Object.keys(withShapes), ["kind", "action", "finished", "check_applicable", "conversation"]);
  assert.equal(Object.keys(withShapes.action.criteria)[0], "none");
  assert.ok(withShapes.action.criteria.snap_shapes);
  assert.equal(withoutShapes.action.criteria.snap_shapes, undefined, "shape snapping is offered only when strokes actually fit shapes");
  assert.equal(Object.keys(withShapes.action.criteria).length, 20);
  assert.equal(withShapes.finished.type, "noul");
  for (const action of SMART.ACTIONS) for (const kind of action.kinds) assert.ok(SMART.KINDS[kind], `${action.id} → ${kind}`);
});

test("the policy shows confident, agreeing, finished suggestions only", () => {
  const kind = answer({ none:0.02, math_expr:0.9, math_step:0.04, shape:0.01, diagram:0.01, ui_wireframe:0.005, notes:0.005, question:0.005, code:0.005 });
  const finished = { type:"noul", noul:0.92 };
  const good = SMART.decide({ kind, finished, action:answer({ none:0.05, plot:0.7, typeset:0.2, solve:0.05 }) });
  assert.deepEqual(good.chips.map(chip => chip.id), ["plot"]);
  const two = SMART.decide({ kind, finished, action:answer({ none:0.04, plot:0.62, typeset:0.28, solve:0.06 }) });
  assert.deepEqual(two.chips.map(chip => chip.id), ["plot", "typeset"]);
  assert.equal(SMART.decide({ kind, finished, action:answer({ none:0.5, plot:0.5 }) }).reason, "none");
  assert.equal(SMART.decide({ kind, finished:{ type:"noul", noul:0.2 }, action:answer({ none:0.05, plot:0.95 }) }).reason, "unfinished");
  assert.equal(SMART.decide({ kind, finished, action:answer({ none:0.05, plot:0.4, typeset:0.3, solve:0.25 }) }).reason, "low-confidence");
  assert.equal(SMART.decide({ kind, finished, action:answer({ none:0.05, prototype:0.9, plot:0.05 }) }).reason, "disagreement");
  assert.equal(SMART.decide({ kind, finished, action:answer({ none:0.05, plot:0.9, typeset:0.05 }) }, { cooldown:{ plot:2 } }).reason, "cooldown");
  assert.equal(SMART.decide({}).chips.length, 0);
});

test("facts are compact and the canvas profile is a bounded moving average", () => {
  const facts = SMART.formatFacts({ ink:{ strokes:7, closed:1, w:412, h:96 }, shape:{ type:"ellipse", residual:0.061 }, profile:{ math_expr:0.6, notes:0.02 }, persona:"research", locale:"zh", recent:["accepted plot"] });
  assert.match(facts, /new_ink: strokes=7 closed=1 bbox=412x96 aspect=4\.3/);
  assert.match(facts, /shape_fit: best=ellipse residual=0\.061/);
  assert.match(facts, /canvas_profile: math_expr 0\.60$/m);
  assert.ok(facts.length < 1500);
  const profile = SMART.updateProfile({ math_expr:0.5 }, answer({ none:0.1, math_expr:0.2, code:0.7 }));
  assert.equal(profile.none, undefined);
  assert.ok(profile.code > 0.15 && profile.math_expr < 0.5);
});

test("the plot suggestion becomes a self-contained interactive graph widget", () => {
  const widget = SMART.graphWidgetCommand({ tool:"plot_function", x:120, y:340, w:1200, h:800, expression:"y = a*sin(k*x)+1", parameters:{ a:2, k:1, x:5, bad:3 } }, { language:"en" });
  assert.equal(widget.tool, "html_widget");
  assert.equal(widget.pluginId, "general");
  assert.ok(widget.w >= 1500 && widget.h >= 1000 && widget.w / widget.h <= 1.8);
  assert.equal(widget.title, "y = a*sin(k*x)+1");
  assert.match(widget.copyText, /a = 2, k = 1/);
  assert.doesNotMatch(widget.copyText, /bad|x = 5/);
  assert.match(widget.html, /<canvas id="c">/);
  assert.doesNotMatch(widget.html, /\bfetch\(|XMLHttpRequest|https?:\/\//, "the graph runs offline without network access");
  assert.doesNotMatch(widget.html, /\beval\(|new Function/);
  const script = widget.html.slice(widget.html.indexOf("<script>") + 8, widget.html.lastIndexOf("</script>"));
  assert.doesNotThrow(() => new Function(script), "embedded runtime parses");
  assert.equal(SMART.graphWidgetCommand({ expression:"" }), null);
});

test("saved native graphs receive the viewport repair without replacing their content", () => {
  const original = fs.readFileSync(path.join(__dirname, "fixtures/graph-legacy.html"), "utf8"),
    repaired = SMART.upgradeGraphWidgetHtml(original);
  assert.notEqual(repaired, original);
  assert.match(repaired, /<meta name="penecho-widget-layout" content="viewport">/);
  assert.match(repaired, /state\.view2\.sy \*= h \/ plotSize\.h/);
  assert.match(repaired, /"expressions":\["y = x\^2-2\*x\+8"\]/);
  assert.doesNotThrow(() => new Function(repaired.slice(repaired.indexOf("<script>") + 8, repaired.lastIndexOf("</script>"))));
  assert.equal(SMART.upgradeGraphWidgetHtml(repaired), repaired, "repair is idempotent");
  const edited = original.replace("x^2-2*x+8", "x^2+99").replace("#2563eb", "#00ff00");
  const editedRepair = SMART.upgradeGraphWidgetHtml(edited);
  assert.ok(editedRepair.includes("x^2+99") && editedRepair.includes("#00ff00"), "unrelated authored changes survive");
  assert.match(editedRepair, /input\.contentEditable = "plaintext-only"/);
  assert.match(editedRepair, /row\.src = input\.innerText/);
  const viewportOnly = original.replace("</head>", '<meta name="penecho-widget-layout" content="viewport"></head>')
    .replace('del.title = "Remove"', 'del.title = "Remove this function"');
  const readable = SMART.upgradeGraphWidgetHtml(viewportOnly);
  assert.notEqual(readable, viewportOnly, "graphs with the earlier viewport repair still receive readable formulas");
  assert.match(readable, /function installReadableGraphUi\(\)/);
  assert.match(readable, /Remove this function/, "editor customizations survive targeted upgrades");
  assert.equal(SMART.upgradeGraphWidgetHtml(readable), readable);
  const custom = original.replace("function resize()", "function customResize()");
  assert.equal(SMART.upgradeGraphWidgetHtml(custom), custom, "a different graph runtime is left alone");
  const other = '<html><canvas id="c"></canvas><script>function resize(){}</script></html>';
  assert.equal(SMART.upgradeGraphWidgetHtml(other), other);
});

test("the Canvas wires suggestions silently into drawing, AI requests and settings", () => {
  const app = read("public/app.js"), html = read("public/index.html"), server = read("src/server/main.js");
  assert.match(html, /<script src="smart-suggest\.js"><\/script>\s*<script src="pen-intel\.js"><\/script>\s*<script src="note-card\.js"><\/script>\s*<script src="app\.js">/);
  assert.match(html, /id="smartSuggestLayer" class="smart-suggest-layer" hidden/);
  assert.match(html, /id="smartSuggestToggle"[^>]*role="switch"/);
  assert.match(app, /typeof smartSuggestDrawingStarted === "function"\) smartSuggestDrawingStarted\(state\.drawing\)/);
  assert.match(app, /typeof smartSuggestDrawingMoved === "function"\) smartSuggestDrawingMoved\(d\)/);
  assert.match(app, /typeof smartSuggestDrawingFinished === "function"\) smartSuggestDrawingFinished\(d\)/);
  assert.match(app, /runtimeElementStyle\(element, "assist-bar"\)/);
  assert.match(app, /typeof assistShapePointerDown === "function" && assistShapePointerDown\(e, point\)/);
  assert.match(app, /typeof assistShapePointerMove === "function" && assistShapePointerMove\(e\)/);
  assert.match(app, /typeof assistShapePointerUp === "function" && assistShapePointerUp\(e\)/);
  assert.match(html, /id="assistToolsBtn"[^>]*aria-haspopup="menu"/);
  assert.doesNotMatch(html, /id="livingInkToggle"/, "Ink Lab has no Canvas entry point");
  assert.doesNotMatch(app, /livingInkCreate|livingInkCaptureStroke|livingInkOffer|livingInkPanel|smartAssistOffer|assistInkLab/);
  assert.match(server, /\bask:\["answer",/);
  assert.doesNotMatch(read("src/client/app/smart-suggestions.js"), /\.style\.|innerHTML/);
  assert.match(app, /typeof requestOptions\.transformCommands === "function"\) data\.commands = requestOptions\.transformCommands/);
  assert.match(app, /suggestion:requestOptions\.suggestion/);
  assert.match(server, /url\.pathname === "\/api\/suggest"[\s\S]*?browserRequestError\(req\)/);
  assert.match(server, /jevision=currentJeVisionConfig\(\)/);
  assert.match(server, /smartSuggestions:jevision\.configured,smartSuggestionsTimeoutMs:jevision\.timeoutMs/);
  assert.doesNotMatch(server, /PENECHO_JEVISION_KEY[^\n]*accessSessionToken/);
  for (const action of SMART.ACTIONS.filter(item => ["ai", "animate"].includes(item.exec.type))) {
    assert.match(server, new RegExp(`\\b${action.exec.suggestion}:\\["${action.exec.action}",`), `${action.id} maps to a server focus`);
  }
});

test("short straight strokes inside handwriting do not count as shapes", () => {
  const bar = { type:"line", residual:0.01, outline:[{ x:0, y:0 }, { x:40, y:0 }], strokeIndexes:[0] },
    box = { x:0, y:0, w:400, h:120 };
  assert.equal(SMART.shapeSummary([bar], 5, box), null);
  const long = { type:"line", residual:0.01, outline:[{ x:0, y:0 }, { x:390, y:0 }], strokeIndexes:[0] },
    circle = { type:"circle", residual:0.02, outline:[], strokeIndexes:[1] };
  const summary = SMART.shapeSummary([long, circle], 2, box);
  assert.equal(summary.type, "line");
  assert.equal(summary.covers, 2);
  assert.match(SMART.formatFacts({ ink:{ strokes:2 }, shape:summary }), /covers=2\/2/);
});

test("arrows are recognised inside a larger sketch", () => {
  const circle = [];
  for (let index = 0; index <= 64; index++) circle.push({ x:200 + 100 * Math.cos(index / 64 * 6.4), y:300 + 100 * Math.sin(index / 64 * 6.4) });
  const shaft = [];
  for (let index = 0; index < 18; index++) shaft.push({ x:310 + index * 8, y:300 + (index % 3 - 1) * 2 });
  const head = [{ x:430, y:285 }, { x:448, y:300 }, { x:430, y:315 }];
  const box = polygonStroke([[470, 220], [700, 224], [698, 380], [472, 378]]);
  const fits = SMART.fitStrokes([circle, shaft, head, box]);
  assert.deepEqual(fits.map(fit => fit.type).sort(), ["arrow", "circle", "rectangle"]);
  const summary = SMART.shapeSummary(fits, 4, { x:100, y:200, w:600, h:200 });
  assert.equal(summary.covers, 4);
});

test("Assist ranks instead of gating: it always offers three actions and follows up", () => {
  const formula = SMART.localPredict({ strokes:6, rows:1, aspect:4.2 });
  assert.equal(formula.kind, "math_expr");
  const local = SMART.rankActions({ local:formula });
  assert.equal(local.items.length, 3);
  assert.deepEqual(local.items.map(item => item.id).sort(), ["plot", "solve", "typeset"]);
  // JeVision saying "none" no longer hides help; it only removes emphasis.
  const unsure = SMART.rankActions({ local:formula, answers:{ kind:answer({ math_expr:0.9, none:0.1 }), action:answer({ none:0.7, plot:0.2, typeset:0.1 }) } });
  assert.equal(unsure.items.length, 3);
  assert.equal(unsure.confident, false);
  assert.equal(unsure.items[0].id, "plot", "JeVision's ranking still orders the options");
  const sure = SMART.rankActions({ local:formula, answers:{ kind:answer({ math_expr:0.95, none:0.05 }), action:answer({ none:0.05, plot:0.85, solve:0.1 }) } });
  assert.equal(sure.items[0].id, "plot");
  assert.equal(sure.confident, true);
  assert.equal(sure.source, "penecho-llm");
  const step = SMART.localPredict({ strokes:4, rows:2, aspect:2, newBelow:true });
  assert.equal(SMART.rankActions({ local:step }).items[0].id, "check_step");
  const sketch = SMART.localPredict({ strokes:5, rows:1, aspect:2.5, shapes:{ closed:2, arrows:1, rectangles:1 } });
  assert.equal(SMART.rankActions({ local:sketch }).items[0].id, "snap_shapes");
  assert.ok(!SMART.rankActions({ local:sketch }).items.some(item => item.id === "diagram"), "plain geometry cannot establish a semantic diagram");
  const extra = SMART.rankActions({ local:sketch, extra:[{ id:"make_interactive", label:"Make 2 objects interactive" }] });
  assert.deepEqual(extra, SMART.rankActions({ local:sketch }), "retired Ink Lab offers cannot override the ranked suggestions");
  const cooled = SMART.rankActions({ local:formula, cooldown:{ typeset:{ count:2, until:5000 } }, now:1000 });
  assert.ok(!cooled.items.some(item => item.id === "typeset"));
  assert.equal(SMART.estimateRows([{ y:0, h:40 }, { y:6, h:30 }, { y:80, h:40 }]), 2);
});

test("shape tools produce exact canvas outlines with constraints", () => {
  const rect = SMART.shapeToolOutline("rectangle", { x:10, y:10 }, { x:110, y:60 }, { constrain:true });
  assert.deepEqual(rect[0][2], { x:110, y:110 }, "Shift makes a square");
  const ellipse = SMART.shapeToolOutline("ellipse", { x:0, y:0 }, { x:200, y:100 });
  assert.equal(ellipse[0].length, 97);
  const line = SMART.shapeToolOutline("line", { x:0, y:0 }, { x:100, y:8 }, { constrain:true });
  assert.ok(Math.abs(line[0][1].y) < 1e-9, "Shift snaps lines to 45° steps");
  const arrow = SMART.shapeToolOutline("arrow", { x:0, y:0 }, { x:100, y:0 });
  assert.equal(arrow.length, 2);
  assert.equal(arrow[1].length, 3);
  const axes = SMART.shapeToolOutline("axes", { x:0, y:0 }, { x:400, y:300 });
  assert.equal(axes.length, 4);
  assert.equal(SMART.shapeToolOutline("triangle", { x:0, y:0 }, { x:1, y:1 }, { minSize:6 }), null, "tiny drags draw nothing");
  assert.deepEqual([...SMART.SHAPE_TOOLS], ["rectangle", "ellipse", "line", "arrow", "triangle", "axes"]);
});

test("graphs open on a window that shows the axes and the interesting part of the curve", () => {
  const sample = (f, lo = -10, hi = 10) => Array.from({ length:201 }, (_, i) => f(lo + (hi - lo) * i / 200));
  const sin = SMART.graphYWindow(sample(Math.sin), 20);
  assert.ok(sin.lo < -1 && sin.hi > 1 && sin.lo > -3 && sin.hi < 3, "sin keeps a tight window around [-1, 1]");
  const shifted = SMART.graphYWindow(sample(x => x * x + 50), 20);
  assert.ok(shifted.lo <= 0 && shifted.hi >= 150, "the window keeps y = 0 so the x axis is on screen");
  const pole = SMART.graphYWindow(sample(x => 1 / x), 20);
  assert.ok(pole.hi - pole.lo <= 12 * 20 + 1e-9, "a pole does not flatten the rest of the curve");
  const parabola = SMART.graphXWindow(x => (x - 30) ** 2 + 50);
  assert.ok(parabola.xMin <= 0 && parabola.xMax >= 30, "the x window stretches to a distant vertex and keeps the origin");
  assert.deepEqual(SMART.graphXWindow(Math.sin), { xMin:-10, xMax:10 });
  assert.equal(SMART.expressionUsesY("sin(x)*cos(y)"), true);
  assert.equal(SMART.expressionUsesY("y = x^2"), false, "a leading y = is the curve's name, not a variable");
});

test("a formula in x and y becomes a rotatable 3D surface widget", () => {
  const widget = SMART.graphWidgetCommand({ x:100, y:100, w:1200, h:800, expression:"z = a*sin(x)*cos(y)", parameters:{ a:1 } }, { language:"en" });
  assert.equal(widget.tool, "html_widget");
  assert.equal(widget.title, "z = a*sin(x)*cos(y)");
  assert.match(widget.html, /"expressions":\["z = a\*sin\(x\)\*cos\(y\)"\]/);
  assert.match(widget.html, /"3D · "/, "the runtime switches to the 3D surface view");
  assert.match(widget.copyText, /^z = a\*sin\(x\)\*cos\(y\)/);
  const script = widget.html.slice(widget.html.indexOf("<script>") + 8, widget.html.lastIndexOf("</script>"));
  assert.doesNotThrow(() => new Function(script));
  assert.doesNotMatch(widget.html, /\beval\(|new Function|https?:\/\//);
});

test("round shapes use ordinary cleanup and retired falling-action scores are ignored", () => {
  const local = SMART.localPredict({ strokes:2, rows:2, aspect:1.2, ball:true, shapes:{ closed:1 } });
  assert.equal(Object.entries(local.probabilities).sort((a, b) => b[1] - a[1])[0][0], "snap_shapes");
  assert.equal(SMART.actionById("let_fall"), null);
  assert.equal(local.probabilities.let_fall, undefined);
  assert.equal(SMART.buildQuestions({ shapesFit:true, ball:true }).action.criteria.let_fall, undefined);
  const withJeVision = SMART.rankActions({ local, answers:{ kind:answer({ shape:0.8, none:0.2 }), action:answer({ none:0.05, snap_shapes:0.8, diagram:0.15 }) } });
  assert.equal(withJeVision.items[0].id, "snap_shapes");
  const stale = SMART.rankActions({ local:{ kind:"shape", probabilities:{ let_fall:1, snap_shapes:0.8 } }, answers:{ kind:answer({ shape:1 }), action:answer({ let_fall:0.9, snap_shapes:0.1 }) } });
  assert.equal(stale.items[0].id, "snap_shapes");
  assert.ok([...stale.items, ...stale.more].every(item => item.id !== "let_fall"));
});

test("a circle and distant ground share the full pending Suggest scope", () => {
  const h = suggestionRuntime(() => okAnswer("snap_shapes"));
  const circle = Array.from({ length:40 }, (_, i) => ({ x:300 + 40 * Math.cos(i / 39 * Math.PI * 2), y:200 + 40 * Math.sin(i / 39 * Math.PI * 2) }));
  const ground = [{ x:150, y:600 }, { x:750, y:680 }];
  const entries = [{}, {}];
  h.state.history.push(...entries);
  h.runtime.data.strokes = [
    { id:1, points:circle, box:{ x:260, y:160, w:80, h:80 }, size:4, at:1000, historyEntry:entries[0] },
    { id:2, points:ground, box:{ x:150, y:600, w:600, h:80 }, size:4, at:1000, historyEntry:entries[1] },
  ];
  assert.deepEqual(Array.from(h.runtime.cluster().strokes, stroke => stroke.id), [1,2]);
});

test("new input includes all earlier dismissed pending strokes without regrouping", async () => {
  const h=suggestionRuntime(()=>assert.fail('no request is needed to inspect pending scope'));
  h.stroke();await h.tick();h.runtime.dismiss('blank-tap');
  assert.equal(h.runtime.cluster(),null);
  h.setTime(60000);h.stroke(1000);
  assert.deepEqual(Array.from(h.runtime.cluster().strokes,stroke=>stroke.id),[1,2]);
  assert.ok(h.runtime.cluster().box.y<=100&&h.runtime.cluster().box.y+h.runtime.cluster().box.h>=1250);
});

test("freehand drawings get creative actions and math gets the 3B1B animation", () => {
  const drawing = SMART.localPredict({ strokes:9, rows:1, aspect:1.05 });
  const top = Object.entries(drawing.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
  assert.deepEqual(top.sort(), ["animate_sketch", "finish_drawing", "vivid"]);
  const math = SMART.localPredict({ strokes:6, rows:1, aspect:7.8 });
  assert.ok(math.probabilities.animate > 0, "a formula can be explained with an animation");
  const questions = SMART.buildQuestions({ shapesFit:true });
  assert.equal(Object.keys(questions.action.criteria).length, 20);
  assert.ok(questions.action.criteria.animate_sketch, "sketch motion is an independent model option");
  const ranked = SMART.rankActions({ local:drawing, answers:{ kind:answer({ drawing:0.9, none:0.1 }), action:answer({ none:0.05, vivid:0.6, finish_drawing:0.3, typeset:0.05 }) } });
  assert.deepEqual(ranked.items.map(item => item.id).sort(), ["animate_sketch", "finish_drawing", "vivid"]);
});


test("Next requires at least 80 percent raw probability and confidence without changing ordinary Suggest",()=>{
  assert.deepEqual(SMART.rankResultActions(null).items,[]);
  assert.deepEqual(SMART.rankResultActions({action:answer({none:.9,finish_drawing:.1})}).items,[]);
  for (const probabilities of [{none:.2,typeset:.7285866737365723,finish_drawing:.0714133262634277}, {none:.3,explain:.4,typeset:.3}, {none:.2001,explain:.7999}]) {
    assert.deepEqual(SMART.rankResultActions({action:answer(probabilities)}).items,[]);
  }
  assert.deepEqual(SMART.rankResultActions({action:{...answer({none:.1,typeset:.9}),confidence:.7092000075748989}}).items,[]);
  assert.deepEqual(SMART.rankResultActions({kind:answer({none:1}),action:answer({none:.1,typeset:.9})}).items,[]);
  const ordinary=SMART.rankActions({local:{kind:"notes",probabilities:{typeset:1}},answers:{kind:answer({notes:1}),action:answer({none:.3,typeset:.4,organize:.3})}});
  assert.ok(ordinary.items.length,"ordinary Suggest remains available at low confidence");
  const ranked=SMART.rankResultActions({kind:answer({drawing:1}),action:answer({none:.1,animate:.8,finish_drawing:.01,vivid:.09})});
  assert.deepEqual(ranked.items.map(item=>item.id),["animate"]);
  assert.equal(ranked.confident,true);
  assert.equal(ranked.source,"penecho-llm");
});

test("erasure previews do not rank the deleted source; Keep ranks the committed result",async()=>{
  const requests=[],h=suggestionRuntime(async(_url,options)=>{requests.push(JSON.parse(options.body));return okAnswer("none");});
  const box={x:200,y:300,w:300,h:200},owner={box};
  h.state.pending={box,items:[{erase:true,box}]};h.state.activeAI={};
  h.runtime.data.bar={mode:"result",box,target:owner,action:{id:"delete"}};
  assert.equal(h.runtime.cluster(),null);
  await h.runtime.run();assert.equal(requests.length,0,"red deletion masks cannot supply Next actions");
  owner.resultBox=box;h.state.pending=null;h.state.activeAI=null;h.state.history.push({});
  h.runtime.data.bar={mode:"followup",box,target:{previous:owner,box,followUp:true},action:{id:"delete"}};
  await h.runtime.run();
  assert.equal(requests.length,1);assert.equal(requests[0].mode,"result");
  assert.deepEqual(requests[0].context,{},"removed actions are not passed to result ranking");
  assert.deepEqual(h.shown.at(-1).view.items,[]);
});

test("completed results rank without dirty ink, with bounded context and no ink bookkeeping",async()=>{
  const requests=[],h=suggestionRuntime(async(_url,options)=>{requests.push(JSON.parse(options.body));return okAnswer("explain");});
  let preparations=0;const resultWidget={id:"result-widget",snapshotImage:null};
  h.context.capturableWidgets=()=>[resultWidget];
  h.setSnapshots(async widgets=>{preparations++;assert.deepEqual(widgets,[resultWidget]);resultWidget.snapshotImage={};return {complete:true,missing:0,missingWidgets:[],pending:[]};});
  const box={x:2000,y:1800,w:1400,h:1000},owner={box:{x:20,y:20,w:50,h:40},resultBox:box};
  h.state.history.push({});h.state.dirty=null;
  h.runtime.data.bar={mode:"followup",box,target:{previous:owner,box,followUp:true},action:{id:"vivid"}};
  const cluster=h.runtime.cluster(),region=h.runtime.region(cluster);
  assert.equal(cluster.result,true);
  assert.deepEqual(JSON.parse(JSON.stringify(region)),{x:1992,y:1792,w:1416,h:1016});
  h.state.dirty={x:10000,y:10000,w:50,h:50};
  assert.deepEqual(JSON.parse(JSON.stringify(h.runtime.region(cluster))),JSON.parse(JSON.stringify(region)),"distant dirty input cannot enlarge a result crop");
  await h.runtime.run();await h.runtime.run();
  assert.equal(requests.length,1);assert.equal(requests[0].mode,"result");
  assert.equal(preparations,1,"result ranking first captures the Widget inside its crop");
  assert.deepEqual(requests[0].context,{previousAction:"vivid"});
  assert.equal(h.runtime.data.evaluatedStrokeId,0);assert.deepEqual(JSON.parse(JSON.stringify(h.runtime.data.profile)),{});
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.dirty)),{x:10000,y:10000,w:50,h:50});
  assert.deepEqual(h.shown.at(-1).view.items.map(item=>item.id),["explain"]);
});

test("moving or rejecting a draft discards its late result ranking",async()=>{
  const reply=deferred(),requests=[],h=suggestionRuntime(async(_url,options)=>{requests.push(JSON.parse(options.body));return reply.promise;});
  const box={x:200,y:300,w:300,h:200};h.state.pending={box};h.state.activeAI={};
  h.runtime.data.bar={mode:"result",box,target:{box:{x:10,y:10,w:30,h:30}},action:{id:"vivid"}};
  const running=h.runtime.run();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,1,"a preview can rank while the AI request awaits Keep");
  h.state.pending.box={...box,x:600};
  reply.resolve(okAnswer("finish_drawing"));await running;
  assert.equal(h.runtime.data.jev,null,"the old geometry cannot supply the next action");
  h.state.pending=null;h.state.activeAI=null;
  assert.equal(h.runtime.cluster(),null,"rejected previews leave no result target");
});

test('a strong conversational turn wins over a marginal checking verdict', () => {
  const answers={kind:answer({notes:1}),action:answer({check_step:.65,answer:.2,typeset:.1,none:.05}),conversation:{type:'noul',noul:.99},check_applicable:{type:'noul',noul:.51}};
  const ranked=SMART.rankActions({answers});
  assert.equal(ranked.items[0].id,'answer');
  assert.ok(!ranked.items.some(item=>item.id==='check_step'));
  assert.ok(ranked.more.some(item=>item.id==='check_step'));
  answers.check_applicable.noul=.95;
  assert.equal(SMART.rankActions({answers}).items[0].id,'check_step','explicit checking evidence still wins');
});

test('confident math recognition retires an unsupported opposite geometric guess', () => {
  for(const [chosen,opposite] of [['plot','solve'],['solve','plot']]) {
    const local={kind:'math_expr',probabilities:{[opposite]:.8,[chosen]:.1,typeset:.1}},
      answers={kind:answer({math_expr:1}),action:answer({[chosen]:.98,[opposite]:.001,typeset:.019})},
      ranked=SMART.rankActions({local,answers});
    assert.equal(ranked.items[0].id,chosen);
    assert.ok(!ranked.items.some(item=>item.id===opposite));
    assert.ok(ranked.more.some(item=>item.id===opposite));
    answers.action=answer({[chosen]:.7,[opposite]:.2,typeset:.1});
    assert.ok(SMART.rankActions({local,answers}).items.some(item=>item.id===opposite),'a supported alternative remains available');
    assert.ok(SMART.rankActions({local}).items.some(item=>item.id===opposite),'offline prediction retains its choices');
  }
});

test('broad checking applicability cannot resurrect Check after a strong incompatible task verdict', () => {
  for(const chosen of ['solve','plot','answer','practice','diagram','prototype']) {
    const answers={kind:answer({question:1}),action:answer({[chosen]:.98,check_step:.01,none:.01}),check_applicable:{type:'noul',noul:.97}},
      local={kind:'question',probabilities:{check_step:.9,answer:.1}},ranked=SMART.rankActions({answers,local});
    assert.ok(!ranked.items.some(item=>item.id==='check_step'),chosen);
    assert.ok(ranked.more.some(item=>item.id==='check_step'),chosen);
    assert.ok(!SMART.instantRankingEvidence(answers).check_step,chosen);
  }
  const answers={kind:answer({math_step:1}),action:answer({solve:.5,check_step:.4,none:.1}),check_applicable:{type:'noul',noul:.97}};
  assert.ok(SMART.rankActions({answers}).items.some(item=>item.id==='check_step'),'credible checking alternatives remain');
});
