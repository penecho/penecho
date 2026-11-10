"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const SMART = require("../public/smart-suggest.js"), PEN = require("../public/pen-intel.js"), SELECT = require("../public/selection.js");
const NOTE = require("../public/note-card.js");
const suggestions = fs.readFileSync(require.resolve("../src/client/app/smart-suggestions.js"), "utf8"),
  notes = fs.readFileSync(require.resolve("../src/client/app/note-cards.js"), "utf8"),
  between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const choice = probabilities => ({ type:"choice", choice:Object.keys(probabilities).sort((a,b)=>probabilities[b]-probabilities[a])[0], probabilities });
const answers = (scope, probabilities = { note:0.9, typeset:0.07, none:0.03 }) => ({ kind:choice({ notes:1 }), action:choice(probabilities), ...(scope == null ? {} : { note_scope:{ type:"noul", noul:scope } }) });

test("a long single paragraph is preserved as note body instead of being truncated to its title", () => {
  const text = "A substantial passage of meaningful notes about the research question, supporting evidence, conclusions, and the next experiment.";
  const note = NOTE.noteFromParts({items:[{kind:"text",text}]});
  assert.ok(note.title.length<=80);
  assert.equal(note.blocks.find(block=>block.type==="markdown").text,text);
});

test("Note stays secondary for ordinary ink and small selections even with a high action score", () => {
  for (const features of [{ strokes:3, aspect:3 }, { selection:true, objects:4 }]) {
    const local = SMART.localPredict(features), ranked = SMART.rankActions({ local, answers:answers(features.selection ? 0.1 : null) });
    assert.notEqual(ranked.items[0].id, "note");
    assert.equal(ranked.notePriority, false);
  }
  assert.ok(SMART.buildQuestions({}).action.criteria.note);
  assert.equal(SMART.buildQuestions({ result:true }).action.criteria.note, undefined);
  assert.equal(SMART.rankResultActions(answers(1)).items.length, 0);
});

test("a substantial text selection or content-filled enclosure can rank Note first", () => {
  const enclosed = SMART.rankActions({ local:SMART.localPredict({ shapes:{ closed:1 }, notePriority:true }) });
  assert.equal(enclosed.items[0].id, "note");
  // Image classification also covers loaded handwriting without vector history.
  const loaded = SMART.rankActions({ local:SMART.localPredict({ selection:true }), answers:answers(0.95) });
  assert.equal(loaded.items[0].id, "note");
  // A picture verdict corrects a geometric local guess after recognition.
  const picture = SMART.rankActions({ local:SMART.localPredict({ selection:true, notePriority:true }), answers:answers(0.1) });
  assert.notEqual(picture.items[0].id, "note");
});

test("an enclosure targets its content while empty circles and Widget edits retain their action space", () => {
  const enclosure=SMART.buildQuestions({shapesFit:true,noteScope:"enclosed"});
  assert.equal(enclosure.action.criteria.snap_shapes,undefined);
  assert.match(enclosure.kind.instructions,/enclosed content/);
  assert.match(enclosure.action.instructions,/explicitly requests another task/);
  assert.ok(SMART.buildQuestions({shapesFit:true}).action.criteria.snap_shapes);
  const widget=SMART.buildQuestions({shapesFit:true,noteScope:"enclosed",widgetRefine:{id:"w"}});
  assert.ok(widget.action.criteria.refine);
  assert.match(widget.action.instructions,/in place/);
  assert.match(SMART.buildQuestions({selection:true}).note_scope.instructions,/80 characters/);
});

test("large raster selections prioritize preservation while explicit operations retain their rank", () => {
  const local=SMART.localPredict({selection:true,objects:1}),
    classified={...answers(0.99,{organize:0.7,note:0.05,typeset:0.15,none:0.1}),note_task:{type:"noul",noul:0.01}};
  assert.equal(SMART.rankActions({local,answers:classified}).items[0].id,"note");
  assert.equal(SMART.rankActions({local,answers:{...classified,note_task:{type:"noul",noul:0.99}}}).items[0].id,"organize");
  assert.notEqual(SMART.rankActions({local,answers:{...classified,note_scope:{type:"noul",noul:0.1}}}).items[0].id,"note");
});

function scopeRuntime() {
  const state = { history:[], userRevision:0, textBoxes:[] }, smartSuggest = { strokes:[] },
    env = { state, smartSuggest, SMART_SUGGEST:SMART, PEN_INTEL:PEN, SELECT,
      canvasDocumentsCurrent:()=>({ id:"doc" }), selectionPathFor:selection=>selection.originalPath,
      textBoxBox:box=>box, penIntelInkDensity:()=>0,
      penGestureStrokes:excluded=>smartSuggest.strokes.filter(stroke=>!excluded.has(stroke.id)),
      penGestureContentBoxes:excluded=>[...smartSuggest.strokes.filter(stroke=>!excluded.has(stroke.id)).map(stroke=>({ ...stroke.box, stroke:true, at:stroke.at })), ...state.textBoxes],
    };
  const scope = vm.runInNewContext(between(suggestions, "  function assistNoteScope(", "  function assistLocalFeatures(") + "\nassistNoteScope", env);
  return { state, smartSuggest, scope };
}
const rectangle = [{ x:100, y:100 }, { x:500, y:100 }, { x:500, y:400 }, { x:100, y:400 }];

test("large text selection uses content rather than the size of empty space", () => {
  const h = scopeRuntime(), selection = { regionOnly:true, originalPath:rectangle }, cluster = { key:"s", selection, box:{ x:100,y:100,w:400,h:300 } };
  assert.equal(h.scope(cluster), null);
  h.state.textBoxes = [{ x:130,y:140,w:300,h:100,text:"a\nb\nc" }]; h.state.userRevision++;
  assert.equal(h.scope(cluster), null, "three isolated words are not a substantial passage");
  h.state.textBoxes[0].text = "A substantial passage of meaningful notes about a research question, the supporting evidence, and the next experiment."; h.state.userRevision++;
  assert.equal(h.scope(cluster).kind, "large_text");
});

test("a pen enclosure needs prior content and retains its actual polygon", () => {
  const h = scopeRuntime(), points = Array.from({length:65}, (_,i)=>({ x:300+200*Math.cos(i/64*Math.PI*2), y:250+150*Math.sin(i/64*Math.PI*2) })),
    stroke = { id:2, at:1000, size:4, points, box:{x:100,y:100,w:400,h:300}, historyEntry:{} }, cluster = { key:"loop", strokes:[stroke] };
  h.smartSuggest.strokes = [stroke]; h.state.history = [stroke.historyEntry];
  assert.equal(h.scope(cluster), null, "an empty geometric loop is not an enclosure of content");
  h.state.textBoxes = [{x:200,y:200,w:100,h:60,text:"Keep this"}, {x:700,y:200,w:100,h:60,text:"Outside"}]; h.state.userRevision++;
  const scope = h.scope(cluster);
  assert.equal(scope.kind, "enclosed");
  assert.deepEqual(JSON.parse(JSON.stringify(scope.path)), points);
  assert.equal(SELECT.pointInPolygon({x:750,y:230},scope.path),false);
});

test("Suggest exposes Note through ranking without inserting a permanent shortcut", () => {
  const stroke = {id:1}, cluster = {key:"input",strokes:[stroke]},
    smartSuggest = {enabled:true,cooldown:{},jev:null},
    env = {SMART_SUGGEST:SMART,smartSuggest,performance:{now:()=>1000},
      assistAnalyze:()=>({rough:[]}),assistLocalFeatures:()=>({strokes:8,rows:1,aspect:4}),
      assistDeletionDetails:()=>null,assistWidgetRefineTarget:()=>null,assistNoteScope:()=>null};
  const view = vm.runInNewContext(between(suggestions, "  function assistAnswerView(", "  function assistSuggestBlocked(") + "\nassistView", env);
  const local = view(cluster);
  assert.equal(local.items.length,3);
  assert.ok(!local.items.some(item=>item.id==="note"),"ordinary local suggestions do not add Note");
  smartSuggest.jev = {key:cluster.key,strokeIds:new Set([1]),answers:{kind:choice({math_expr:1}),action:choice({plot:0.8,explain:0.1,note:0.001,none:0.099})}};
  const formula = view(cluster);
  assert.equal(formula.items[0].id,"plot");
  assert.equal(formula.items.length,3);
  assert.ok(!formula.items.some(item=>item.id==="note"),"a formula verdict does not add Note");
  smartSuggest.jev.answers = answers(0.99);
  assert.equal(view(cluster).items[0].id,"note","a qualified model ranking still surfaces Note");
  smartSuggest.jev.answers = {...answers(0.99,{organize:0.9,note:0.05,none:0.05}),note_task:{type:"noul",noul:0.99}};
  assert.equal(view(cluster).items[0].id,"organize","explicit operations retain their ranking");
  smartSuggest.enabled = false;
  assert.ok(!view({...cluster,selection:{}}).items.some(item=>item.id==="note"),"disabled suggestions do not inject Note into lasso controls");
});

test("pen Note captures all dirty input without turning the enclosure into a lasso", async () => {
  const dirty={x:10,y:20,w:1500,h:1000}, state={history:[],selection:null,dirty}, source={historyEntry:{}}, captures=[];
  state.history.push(source.historyEntry);
  const run=vm.runInNewContext(between(notes,"  async function organizeSuggestAsNote(","  async function organizeSelectionAsNote(")+"\norganizeSuggestAsNote",{
    state,aiPreparationGeneration:1,noteCardRuntime:()=>({}),canvasDocumentsCurrent:()=>({id:"doc"}),
    supersedeActiveAI(){},clearTimeout(){},clearPenGesture(){},dismissPenGestureOffer(){},renderAssist(){},noteCopy:en=>en,
    captureDirtyInput:(box,path)=>{captures.push({box,path});return {};},
    noteCaptureSelection:async scope=>({scope}),organizeCapturedAsNote:(target,parts,pack,snapshot)=>({target,parts,pack,snapshot}),
    captureSelection:()=>assert.fail("a handwritten loop must not create a lasso"),
  });
  const result=await run({strokes:[source],noteScope:{box:{x:100,y:100,w:400,h:300},path:rectangle},box:{x:100,y:100,w:400,h:300}});
  assert.deepEqual(JSON.parse(JSON.stringify(captures[0].box)),dirty);
  assert.equal(captures[0].path,undefined,"all dirty input is captured without a polygon mask");
  assert.equal(state.selection,null);assert.equal(result.target.canvasInput,true);assert.equal(result.pack,null);
  assert.deepEqual(JSON.parse(JSON.stringify(result.parts.scope.box)),dirty);
  state.history=[];assert.equal(await run({strokes:[source]}),false,"stale source is rejected before capture");
});

test("only the newest loop counts raster ink as enclosed content", () => {
  // A drawing's earlier loop (a body segment or a face drawn before its eyes)
  // has later ink inside it; that ink is not prior content to save as a note.
  const state = { history:[], userRevision:0, textBoxes:[] }, smartSuggest = { strokes:[] };
  const env = { state, smartSuggest, SMART_SUGGEST:SMART, PEN_INTEL:PEN, SELECT,
    canvasDocumentsCurrent:()=>({ id:"doc" }), selectionPathFor:selection=>selection.originalPath, textBoxBox:box=>box,
    penIntelInkDensity:()=>0.08,
    penGestureStrokes:excluded=>smartSuggest.strokes.filter(stroke=>!excluded.has(stroke.id)),
    penGestureContentBoxes:excluded=>smartSuggest.strokes.filter(stroke=>!excluded.has(stroke.id)).map(stroke=>({ ...stroke.box, stroke:true, at:stroke.at })) };
  const scope = vm.runInNewContext(between(suggestions, "  function assistNoteScope(", "  function assistLocalFeatures(") + "\nassistNoteScope", env);
  const ring = (id, cx, cy) => ({ id, at:id * 1000, size:4, historyEntry:{}, box:{ x:cx - 200, y:cy - 150, w:400, h:300 },
    points:Array.from({ length:65 }, (_, i) => ({ x:cx + 200 * Math.cos(i / 64 * Math.PI * 2), y:cy + 150 * Math.sin(i / 64 * Math.PI * 2) })) });
  const loop = ring(1, 300, 250), eye = { id:2, at:2000, size:4, historyEntry:{}, box:{ x:280, y:230, w:12, h:12 }, points:[{ x:280, y:230 }, { x:292, y:242 }] };
  smartSuggest.strokes = [loop, eye]; state.history = [loop.historyEntry, eye.historyEntry];
  assert.equal(scope({ key:"face", strokes:[loop, eye] }), null, "a loop drawn before its inner details is part of the picture");
  const circle = ring(3, 300, 250);
  smartSuggest.strokes = [eye, circle]; state.history = [eye.historyEntry, circle.historyEntry]; state.userRevision++;
  assert.equal(scope({ key:"circle", strokes:[eye, circle] }).kind, "enclosed", "the newest loop around earlier ink still groups it");
});



test("Suggest More keeps one manual Note without reserving a main slot",()=>{
  const createNode=()=>({children:[],append(...items){this.children.push(...items);},setAttribute(){},classList:{toggle(){}}}),
    env={document:{createElement:createNode},t:key=>key,smartSuggest:{bar:{view:{items:[{id:"plot"},{id:"solve"},{id:"answer"}]}}},assistButton:createNode,assistActionButton:item=>({id:item.id}),assistToolsList:()=>({id:"tools"})};
  const start=suggestions.indexOf("  function assistMoreControl("),end=suggestions.indexOf("\n  function ",start+1),
    create=vm.runInNewContext(suggestions.slice(start,end)+"\nassistMoreControl",env), target={box:{x:0,y:0,w:100,h:100}};
  const ids=more=>Array.from(create(more,target).children[1].children,item=>item.id);
  assert.deepEqual(ids([]),["note","tools"]);
  assert.deepEqual(ids([{id:"note"}]),["note","tools"]);
  env.smartSuggest.bar.view.items=[{id:"note"},{id:"answer"}];
  assert.deepEqual(ids([]),["tools"]);
});
