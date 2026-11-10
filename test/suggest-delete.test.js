"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const SMART = require("../public/smart-suggest.js"), PEN = require("../public/pen-intel.js");
const source = fs.readFileSync(require.resolve("../src/client/app/smart-suggestions.js"), "utf8");
function fn(name) {
  const start = source.indexOf(`  function ${name}(`), next = source.indexOf("\n  function ", start + 1), asyncNext = source.indexOf("\n  async function ", start + 1);
  assert.ok(start >= 0);
  return source.slice(start, Math.min(...[next, asyncNext].filter(index => index >= 0)));
}
function harness() {
  const calls = [], commits = [], history = [{}], state = { history, widgets:[], textBoxes:[], scale:1, userRevision:0 }, smartSuggest = { strokes:[], consumedStrokeId:0 },
    context = { state, smartSuggest, SMART_SUGGEST:SMART, window:{ PENECHO_PEN_INTEL:PEN }, SIZE:20000,
      intersection:PEN.overlap, widgetBox:item => item, textBoxBox:item => item,
      requestAI:(...args) => { calls.push(args); return Promise.resolve(); }, requireAiConnectionSelection:() => true,
      widgetEditContext:(widget, instructionMode, options) => ({ html:widget.html, instructionMode, ...options }),
      renderAssist:model => calls.push(model), hideAssist:reason => calls.push(reason), setStatus:message => calls.push(message),
      requestCommittedInkRender(){},requestRender(){},canvasDocumentsCurrent:()=>({id:"test"}),assistRefresh(){}, suggestionCopy:en => en, smartSuggestRecent(){}, stroke:(...args) => calls.push(args),
      cancelPenRasterDeletion(){},clearPenGesture(){},dismissPenGestureOffer(){},cancelSmartSuggest(){},clearTimeout(){},save(){},
      saveUserCanvasChange:()=>commits.push("saved"),recomputeDirtyBounds(){},filterErasedDirtyHotspots(){},scheduleAssist(){},
      deleteWidget:widget => { state.widgets = state.widgets.filter(item => item !== widget); state.userRevision++; commits.push("saved"); },
      eraseBounds:command => command.mode === "path" ? { x:Math.min(...command.points.map(p => p[0])) - command.size / 2, y:Math.min(...command.points.map(p => p[1])) - command.size / 2, w:command.size, h:command.size } : command,
    };
  vm.createContext(context);
  for (const name of ["assistUnion", "assistRequestOptions", "assistDeletionMarks", "assistDetectDeletion", "assistDeletionDetails", "executeAssistInkDeletion", "executeAssistDeletion"]) vm.runInContext(fn(name), context);
  const record = (id, points, at) => ({ id, points, at, box:{ ...PEN.bounds(points), h:Math.max(4, PEN.bounds(points).h) }, size:4, historyEntry:history[0] });
  const text = record(1, Array.from({ length:21 }, (_, i) => ({ x:100 + i * 2, y:100 + i * 2 })), 1000),
    mark = record(2, Array.from({ length:21 }, (_, i) => ({ x:90 + i * 3, y:120 })), 3000);
  smartSuggest.strokes.push(text, mark);
  mark.deletionGesture = context.assistDetectDeletion(mark);
  return { context, calls, commits, state, smartSuggest, text, mark, target:{ box:PEN.union(text.box, mark.box), newBox:mark.box, strokes:[text, mark] } };
}
test("Delete is absent from Suggest's registry, local ranking and stale remote answers", () => {
  const local = SMART.localPredict({ deletionMark:true, shapes:{ closed:4 }, profile:{ math_expr:1 } });
  const answers = { kind:{ type:"choice", choice:"deletion" }, action:{ type:"choice", probabilities:{ delete:.95, none:.05 } }, finished:{ noul:1 } };
  assert.equal(SMART.actionById("delete"), null);
  assert.equal(SMART.decide(answers).chips.length, 0);
  for (const view of [SMART.rankActions({ local }), SMART.rankActions({ local, answers }), SMART.rankResultActions(answers)]) {
    assert.ok([...view.items, ...view.more].every(item => item.id !== "delete"));
  }
  for (const shapesFit of [false, true]) for (const deletionMark of [false, true]) {
    const questions = SMART.buildQuestions({ shapesFit, deletionMark });
    assert.ok(Object.keys(questions.action.criteria).length <= 20);
    assert.equal(questions.action.criteria.delete, undefined);
    assert.equal(Boolean(questions.action.criteria.snap_shapes), shapesFit && !deletionMark);
  }
});
test("local detection respects writing pauses, underlines and stale vector history", () => {
  const h = harness();
  assert.equal(h.mark.deletionGesture.shape, "strike");
  const tooSoon = { ...h.mark, at:1100 };
  assert.equal(h.context.assistDetectDeletion(tooSoon), null);
  const underline = { ...h.mark, points:h.mark.points.map(p => ({ ...p, y:150 })), box:{ ...h.mark.box, y:150 } };
  h.smartSuggest.strokes = [h.text, underline];
  assert.equal(h.context.assistDetectDeletion(underline), null);
  h.state.history = [];
  assert.equal(h.context.assistDetectDeletion(h.mark), null);
});
test("raster analysis is deferred and Widget edge candidates require visual confirmation", () => {
  const h = harness(); h.smartSuggest.strokes = [h.mark];
  const scheduled = [];
  h.context.schedulePenRasterDeletion = (...args) => scheduled.push(args);
  assert.equal(h.context.assistDetectDeletion(h.mark), null);
  assert.equal(scheduled.length, 1, "pen-up schedules work without reading pixels");
  const ordinary = {...h.mark, points:[{x:90,y:100},{x:90,y:150}]};
  assert.equal(h.context.assistDetectDeletion(ordinary), null);
  assert.equal(scheduled.length, 1, "ordinary writing never schedules pixel analysis");
  h.state.widgets = [{x:80,y:105,w:400,h:800}];
  const candidate = h.context.assistDetectDeletion(h.mark);
  assert.equal(candidate.shape, "strike", "text need not be at the Widget's vertical center");
  assert.equal(PEN.gestureDecision(null, candidate).act, "ignore");
});
test("stroke Delete erases whole crossed strokes and its mark locally without a model selection or draft", () => {
  const h = harness();
  const neighbor = { ...h.text, id:3, points:h.text.points.map(p=>({...p,y:p.y+100})), box:{...h.text.box,y:h.text.box.y+100} };
  h.smartSuggest.strokes.push(neighbor);
  h.context.requireAiConnectionSelection = () => { throw Error("Stroke deletion must not require Canvas AI."); };
  h.context.requestAI = () => { throw Error("Stroke deletion must not call Canvas AI."); };
  h.context.executeAssistDeletion(h.target);
  const erased = h.calls.filter(Array.isArray);
  assert.equal(erased.length, 40, "both full polylines erase immediately");
  assert.ok(erased.every(call => call[2] === true && call[4] === true), "local erasure updates dirty coverage");
  assert.deepEqual(h.smartSuggest.strokes.map(record=>record.id), [3], "neighbor remains available as input");
  assert.equal(h.state.pending, undefined);
  assert.equal(h.state.userRevision, 1);
  assert.deepEqual(h.commits, ["saved"], "one user change owns the deletion");
});
test("Delete also erases every connected stroke transitively, preserving disconnected ink", () => {
  const h = harness(), make = (id,points) => ({id,points,size:4,at:1000,box:PEN.bounds(points),historyEntry:h.state.history[0]}),
    first = make(3,[{x:140,y:140},{x:200,y:170}]), second = make(4,[{x:200,y:170},{x:260,y:200}]),
    neighbor = make(5,[{x:200,y:100},{x:240,y:100}]);
  h.smartSuggest.strokes.push(first,second,neighbor);
  assert.equal(h.context.executeAssistDeletion(h.target),true);
  assert.deepEqual(h.smartSuggest.strokes.map(item=>item.id),[5],"the chain beyond the crossed area disappears, while unrelated ink remains");
  assert.deepEqual(h.commits,["saved"],"the connected chain is part of the same deletion step");
});
test("standalone Widget Delete removes the object and its marks locally in one change", () => {
  const h = harness(), widget = { id:"target", x:80, y:80, w:100, h:100, html:"<p>remove</p><input value='live'>" },
    neighbor = { id:"neighbor", x:400, y:400, w:100, h:100 };
  h.state.widgets.push(widget, neighbor); h.smartSuggest.strokes = [h.mark]; h.mark.deletionGesture = h.context.assistDetectDeletion(h.mark);
  h.context.requireAiConnectionSelection = () => { throw Error("Widget deletion must not require Canvas AI."); };
  h.context.requestAI = () => { throw Error("Widget deletion must not call Canvas AI."); };
  assert.equal(h.context.executeAssistDeletion(h.target), true);
  assert.deepEqual(h.state.widgets, [neighbor]);
  assert.equal(h.calls.filter(Array.isArray).length, 20, "only cancellation marks are erased from ink");
  assert.deepEqual(h.smartSuggest.strokes, []);
  assert.equal(h.state.userRevision, 1);
  assert.deepEqual(h.commits, ["saved"]);
});
test("a second cancellation line retains the original Widget target instead of targeting the first line", () => {
  const h = harness(), widget = { id:"target", x:80, y:80, w:100, h:100 };
  h.state.widgets = [widget];
  h.mark.points = [{x:90,y:110},{x:150,y:122}];
  h.mark.box = PEN.bounds(h.mark.points);
  h.smartSuggest.strokes = [h.mark];
  h.mark.deletionGesture = h.context.assistDetectDeletion(h.mark);
  assert.equal(h.mark.deletionGesture.shape, "strike");
  const second = {...h.mark, id:3, at:4000, points:[{x:90,y:116},{x:150,y:116}], box:{x:90,y:114,w:60,h:4}, deletionGesture:null};
  h.smartSuggest.strokes.push(second);
  second.deletionGesture = h.context.assistDetectDeletion(second);
  assert.deepEqual(Array.from(second.deletionGesture.strokeIds || []), [], "cancellation lines are not target content");
  h.context.executeAssistDeletion({...h.target, strokes:[h.mark, second], newBox:PEN.union(h.mark.box, second.box)});
  assert.deepEqual(h.state.widgets, [], "the original Widget is removed with both marks");
  assert.deepEqual(h.smartSuggest.strokes, []);
  assert.deepEqual(h.commits, ["saved"]);
});
test("a nearby second line keeps the crossed handwriting even when it does not cross that handwriting itself", () => {
  const h = harness(), second = {...h.mark, id:3, at:3500, points:[{x:90,y:143},{x:150,y:143}], box:{x:90,y:141,w:60,h:4}, deletionGesture:null};
  h.smartSuggest.strokes.push(second);
  second.deletionGesture = h.context.assistDetectDeletion(second);
  assert.equal(second.deletionGesture?.shape, "strike");
  assert.deepEqual(Array.from(second.deletionGesture.strokeIds), [h.text.id]);
  h.context.executeAssistDeletion({...h.target, strokes:[h.mark, second], newBox:PEN.union(h.mark.box, second.box)});
  assert.deepEqual(h.smartSuggest.strokes, [], "both lines and the original handwriting are erased");
  assert.deepEqual(h.commits, ["saved"]);
});
test("three, five and eight lines remove the original content and every cancellation mark", () => {
  for (const count of [3, 5, 8]) {
    const h = harness(), marks = [h.mark];
    for (let i = 1; i < count; i++) {
      const record = {...h.mark, id:2+i, at:3000+i*100, deletionGesture:null, deletionMarkIds:undefined};
      h.smartSuggest.strokes.push(record);
      record.deletionGesture = h.context.assistDetectDeletion(record);
      marks.push(record);
    }
    assert.deepEqual(Array.from(marks.at(-1).deletionMarkIds).sort((a,b)=>a-b), marks.map(item=>item.id));
    h.context.executeAssistDeletion({...h.target, strokes:marks});
    assert.deepEqual(h.smartSuggest.strokes, [], `${count} lines and their content are erased`);
    assert.deepEqual(h.commits, ["saved"]);
  }
});
test("three, five and eight Widget cancellation lines remove the Widget and all marks", () => {
  for (const count of [3, 5, 8]) {
    const h = harness(), widget = {id:"target",x:80,y:80,w:100,h:100}, marks = [h.mark];
    h.state.widgets = [widget]; h.smartSuggest.strokes = marks.slice();
    h.mark.deletionGesture = h.context.assistDetectDeletion(h.mark);
    for (let i = 1; i < count; i++) {
      const record = {...h.mark, id:2+i, at:3000+i*100, deletionGesture:null, deletionMarkIds:undefined};
      h.smartSuggest.strokes.push(record); marks.push(record);
      record.deletionGesture = h.context.assistDetectDeletion(record);
    }
    h.context.executeAssistDeletion({...h.target, strokes:marks});
    assert.deepEqual(h.state.widgets, []);
    assert.deepEqual(h.smartSuggest.strokes, []);
    assert.deepEqual(h.commits, ["saved"]);
  }
});
test("a third line retains the full previous group when its position drifts or it crosses after a pause", () => {
  for (const paused of [false, true]) {
    const h = harness(), second = {...h.mark, id:3, at:3500, deletionGesture:null, deletionMarkIds:undefined};
    second.points = paused ? [{x:90,y:112},{x:150,y:124}] : [{x:90,y:143},{x:150,y:143}];
    second.box = {...PEN.bounds(second.points), h:Math.max(4,PEN.bounds(second.points).h)};
    h.smartSuggest.strokes.push(second);
    second.deletionGesture = h.context.assistDetectDeletion(second);
    const third = {...h.mark, id:4, at:paused ? 10000 : 4000, deletionGesture:null, deletionMarkIds:undefined,
      points:[{x:90,y:paused ? 116 : 166},{x:150,y:paused ? 116 : 166}], box:{x:90,y:paused ? 114 : 164,w:60,h:4}};
    h.smartSuggest.strokes.push(third);
    third.deletionGesture = h.context.assistDetectDeletion(third);
    assert.deepEqual(Array.from(third.deletionMarkIds).sort((a,b)=>a-b), [2,3,4], "the first line remains part of the gesture");
    h.context.executeAssistDeletion({...h.target, strokes:[h.mark,second,third]});
    assert.deepEqual(h.smartSuggest.strokes, []);
    assert.deepEqual(h.commits, ["saved"]);
  }
});
test("double-line grouping stops at ordinary writing, another row, a long pause or stale history", () => {
  for (const reason of ["writing", "row", "pause", "undo"]) {
    const h = harness(), second = {...h.mark, id:3, at:3500, deletionGesture:null};
    if (reason === "writing") h.smartSuggest.strokes.push({...h.text, id:4, at:3200});
    if (reason === "row") second.box = {...second.box, y:220};
    if (reason === "pause") second.at = 6000;
    if (reason === "undo") h.mark.historyEntry = {};
    h.smartSuggest.strokes.push(second);
    assert.deepEqual(Array.from(h.context.assistDeletionMarks(second), item => item.id), [second.id], reason);
  }
});
test("a long second stroke uses its pen-down gap, and crossing a known mark after a pause retains its content target", () => {
  const h = harness(), second = {...h.mark, id:3, at:5700, durationMs:2500, deletionGesture:null};
  h.smartSuggest.strokes.push(second);
  assert.deepEqual(Array.from(h.context.assistDeletionMarks(second), item => item.id), [h.mark.id, second.id]);
  h.mark.points = [{x:90,y:110},{x:150,y:122}];
  h.mark.box = PEN.bounds(h.mark.points);
  second.at = 10000; second.durationMs = 0;
  second.points = [{x:90,y:116},{x:150,y:116}]; second.box = {x:90,y:114,w:60,h:4};
  second.deletionGesture = h.context.assistDetectDeletion(second);
  assert.deepEqual(Array.from(second.deletionGesture.strokeIds), [h.text.id], "an explicitly crossed command retains the original target even after a pause");
  assert.deepEqual(Array.from(second.deletionMarkIds), [second.id, h.mark.id]);
  h.context.executeAssistDeletion({...h.target, strokes:[h.mark, second]});
  assert.deepEqual(h.smartSuggest.strokes, []);
});
test("quick raster cancellation lines share the pre-first-mark analysis and retain masks through confirmation", () => {
  const h = harness(), scheduled = [];
  h.smartSuggest.strokes = [h.mark];
  h.context.schedulePenRasterDeletion = (...args) => scheduled.push(args);
  h.mark.deletionGesture = h.context.assistDetectDeletion(h.mark);
  const second = {...h.mark, id:3, at:3500, deletionGesture:null};
  h.smartSuggest.strokes.push(second);
  second.deletionGesture = h.context.assistDetectDeletion(second);
  assert.deepEqual(Array.from(scheduled.at(-1)[2], item => item.id), [h.mark.id, second.id]);
  const mask = {width:1,height:1,data:new Uint8Array([1]),region:{x:100,y:100,w:40,h:40}};
  h.mark.deletionGesture = {shape:"strike",confidence:.82,target:h.text.box,mask};
  second.deletionGesture = h.context.assistDetectDeletion(second);
  assert.equal(second.deletionGesture.masks[0], mask);
  // The offer assigns its merged candidate to every command mark.
  h.mark.deletionGesture = second.deletionGesture;
  const erasedMasks = [];
  h.context.assistEraseDeletionMask = value => erasedMasks.push(value);
  assert.equal(h.context.executeAssistDeletion({...h.target, strokes:[h.mark, second]}), true);
  assert.deepEqual(erasedMasks, [mask]);
  assert.deepEqual(h.smartSuggest.strokes, []);
});
test("Undo, pending Widgets and ambiguous Widget targets cannot consume or delete ink", () => {
  for (const reason of ["undo", "pending", "ambiguous"]) {
    const h = harness();
    if (reason === "undo") h.state.history = [];
    else {
      h.state.widgets.push({ x:80,y:80,w:100,h:100,pending:reason === "pending" });
      if (reason === "ambiguous") h.state.widgets.push({ x:90,y:90,w:100,h:100 });
      h.smartSuggest.strokes = [h.mark]; h.mark.deletionGesture = h.context.assistDetectDeletion(h.mark);
    }
    assert.equal(h.context.executeAssistDeletion(h.target), false);
    assert.equal(h.calls.filter(Array.isArray).length, 0);
    assert.equal(h.smartSuggest.consumedStrokeId, 0);
    assert.equal(h.commits.length, 0);
  }
});
test("stale crossed-stroke IDs and unrecognized raster targets never call Canvas AI or erase guesses", () => {
  for (const stale of [true, false]) {
    const h=harness();
    h.mark.deletionGesture = stale ? {shape:"strike",strokeIds:[999],target:h.text.box} : null;
    h.context.executeAssistDeletion(h.target);
    assert.equal(h.calls.filter(Array.isArray).length,0);
    assert.equal(h.commits.length,0);
  }
});
