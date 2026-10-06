"use strict";
// Pen gestures, the step checker and Canvas search.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const PEN = require("../public/pen-intel.js");
const JEVISION = require("../src/server/jevision.js");

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  let depth = 0, index = source.indexOf("{", source.indexOf(")", start));
  for (; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) break;
  }
  const prefix = source.slice(Math.max(0, start - 6), start) === "async " ? "async " : "";
  return prefix + source.slice(start, index + 1);
}
const plain = value => JSON.parse(JSON.stringify(value));
const ellipse = (cx, cy, rx, ry) => Array.from({ length:41 }, (_, i) => ({ x:cx + rx * Math.cos(i / 40 * Math.PI * 2), y:cy + ry * Math.sin(i / 40 * Math.PI * 2) }));
const hline = (x, y, length) => Array.from({ length:21 }, (_, i) => ({ x:x + i * length / 20, y }));
const vline = (x, y, length) => Array.from({ length:21 }, (_, i) => ({ x, y:y + i * length / 20 }));
const formula = { x:60, y:95, w:140, h:28 };

test("local shape fits propose command marks and leave ordinary writing alone", () => {
  assert.equal(PEN.classifyGestureStroke(ellipse(130, 108, 90, 36), { size:4, contentBoxes:[formula] }).shape, "enclosure");
  const under = PEN.classifyGestureStroke(hline(50, 130, 160), { size:4, contentBoxes:[formula] });
  assert.equal(under.shape, "underline");
  assert.deepEqual(plain(under.target), formula);
  const second = PEN.classifyGestureStroke(hline(50, 139, 160), { size:4, contentBoxes:[formula] });
  assert.equal(PEN.combineUnderlines(under, second, { size:4 }).shape, "double_underline");
  assert.equal(PEN.classifyGestureStroke(hline(50, 109, 160), { size:4, contentBoxes:[formula] }).shape, "strike");
  const zigzag = Array.from({ length:31 }, (_, i) => ({ x:60 + (i % 2) * 60, y:95 + i }));
  assert.equal(PEN.classifyGestureStroke(zigzag, { size:4, contentBoxes:[{ x:60, y:95, w:60, h:28 }] }).shape, "scribble");
  const axes = [...vline(300, 100, 60), ...hline(300, 160, 60).slice(1)];
  assert.equal(PEN.classifyGestureStroke(axes, { size:4, contentBoxes:[{ x:200, y:110, w:80, h:30 }] }).shape, "axes");
  // A fraction bar has content below as well; the bottom stroke of 三 or the bar
  // of a t belongs to writing made moments ago; a loop around nothing is ink.
  assert.equal(PEN.classifyGestureStroke(hline(50, 130, 160), { size:4, contentBoxes:[formula, { x:60, y:140, w:140, h:28 }] }), null);
  assert.equal(PEN.classifyGestureStroke(hline(50, 130, 160), { size:4, now:1000, contentBoxes:[{ ...formula, at:900 }] }), null);
  assert.equal(PEN.classifyGestureStroke(ellipse(130, 108, 90, 36), { size:4, contentBoxes:[] }), null);
  assert.equal(PEN.classifyGestureStroke(hline(50, 109, 10), { size:4, contentBoxes:[formula] }), null);
  // A looped letter runs through its own middle; its raster ink is not a target.
  const glyph = Array.from({ length:13 }, (_, i) => ({ x:500 + 4 * Math.cos(i / 3 * Math.PI * 2) + i * 2, y:300 + 12 * Math.sin(i / 3 * Math.PI * 2) }));
  assert.equal(PEN.classifyGestureStroke(glyph, { size:4, contentBoxes:[], probe:() => 0.3 }), null);
  // Loaded ink has no vectors: the raster probe finds it inside the loop.
  assert.equal(PEN.classifyGestureStroke(ellipse(130, 108, 90, 36), { size:4, contentBoxes:[], probe:() => 0.2 }).shape, "enclosure");
});

test("a strike deletes whole crossed letters with a limited expansion, never a band of pixels", () => {
  // "he": h is one stroke (stem, then hump), e is a loop; a separate hump
  // stroke, a far word, the next line and a long divider are nearby.
  const stroke = (id, points) => ({ id, at:0, points, box:PEN.bounds(points) });
  const h = stroke(1, [...vline(105, 50, 110), ...Array.from({ length:8 }, (_, i) => ({ x:105 + i * 4, y:160 - Math.sin(i / 7 * Math.PI) * 35 }))]);
  const e = stroke(2, Array.from({ length:30 }, (_, i) => ({ x:175 + 30 * Math.cos(i / 29 * Math.PI * 1.8), y:140 + 12 * Math.sin(i / 29 * Math.PI * 1.8) })));
  const hump = stroke(3, Array.from({ length:8 }, (_, i) => ({ x:112 + i * 3, y:150 - Math.sin(i / 7 * Math.PI) * 20 })));
  const far = stroke(4, hline(400, 130, 40));
  const nextLine = stroke(5, hline(60, 230, 160));
  const divider = stroke(6, vline(150, -300, 800));
  const strokes = [h, e, hump, far, nextLine, divider];
  const strike = Array.from({ length:21 }, (_, i) => ({ x:55 + i * 8, y:130 + i * 0.4 }));
  const result = PEN.classifyGestureStroke(strike, { size:4, now:10000, strokes, contentBoxes:strokes.map(item => ({ ...item.box, at:0 })) });
  assert.equal(result.shape, "strike");
  assert.deepEqual([...result.strokeIds].sort(), [1, 2, 3]);
  assert.deepEqual(plain(result.target), plain(PEN.union(PEN.union(h.box, e.box), hump.box)));
  // A slanted strike still counts; strokes written moments ago do not.
  const slanted = Array.from({ length:21 }, (_, i) => ({ x:55 + i * 8, y:100 + i * 3 }));
  assert.ok(PEN.classifyGestureStroke(slanted, { size:4, now:10000, strokes, contentBoxes:[] }).strokeIds.includes(1));
  assert.equal(PEN.classifyGestureStroke(strike, { size:4, now:10000, strokes:strokes.map(item => ({ ...item, at:9900 })), contentBoxes:[] }), null);
  // A scribble takes the letters it covers the same way.
  const zigzag = Array.from({ length:31 }, (_, i) => ({ x:160 + (i % 2) * 50, y:125 + i * 0.8 }));
  assert.deepEqual(PEN.classifyGestureStroke(zigzag, { size:4, now:10000, strokes, contentBoxes:[] }).strokeIds, [2]);
});

test("Delete requires local evidence and stays optional, with an offline fallback for strong geometry", () => {
  const local = { shape:"enclosure", confidence:0.75 };
  assert.deepEqual(PEN.gestureDecision({ command:{ noul:0.92 }, gesture:{ choice:"explain", confidence:0.86 } }, local), { act:"run", gesture:"explain", source:"penecho-llm" });
  assert.equal(PEN.gestureDecision({ command:{ noul:0.55 }, gesture:{ choice:"explain", confidence:0.86 } }, local).act, "offer");
  assert.equal(PEN.gestureDecision({ command:{ noul:0.98 }, gesture:{ choice:"delete", confidence:0.99 } }, local).act, "ignore");
  assert.equal(PEN.gestureDecision({ command:{ noul:0.98 }, gesture:{ choice:"delete", confidence:0.99 } }, { shape:"strike", confidence:0.6 }).act, "offer");
  assert.equal(PEN.gestureDecision({ command:{ noul:0.98 }, gesture:{ choice:"delete", confidence:0.3 } }, { shape:"strike", confidence:0.6 }).act, "ignore");
  assert.equal(PEN.gestureDecision({ command:{ noul:0.2 }, gesture:{ choice:"explain", confidence:0.9 } }, local).act, "ignore");
  assert.equal(PEN.gestureDecision({ command:{ noul:0.9 }, gesture:{ choice:"none", confidence:0.9 } }, local).act, "ignore");
  assert.deepEqual(PEN.gestureDecision(null, local), { act:"offer", gesture:"explain", source:"local" });
  assert.equal(PEN.gestureDecision(null, { shape:"strike", confidence:0.9 }).act, "offer");
  assert.notEqual(PEN.gestureDecision(null, { shape:"double_underline", confidence:0.8 }).act, "run");
});

test("pen gestures never run or offer Solve, including responses from older Cloud versions", () => {
  for (const shape of PEN.GESTURE_SHAPES) {
    for (const score of [0.55, 0.99]) {
      const answers = { command:{ noul:score }, gesture:{ choice:"solve", confidence:score } };
      assert.deepEqual(PEN.gestureDecision(answers, { shape, confidence:0.9 }), { act:"ignore" });
    }
  }
});

test("the step checker flags only doubtful derivation lines", () => {
  assert.equal(PEN.stepCheckCandidate({ kind:{ choice:"math_step" } }, {}), true);
  assert.equal(PEN.stepCheckCandidate({ kind:{ choice:"math_expr" }, action:{ choice:"solve" } }, { newBelow:true, rows:2 }), true);
  assert.equal(PEN.stepCheckCandidate({ kind:{ choice:"notes" }, action:{ choice:"organize" } }, { newBelow:true, rows:3 }), false);
  assert.equal(PEN.stepDecision({ step:{ choice:"doubtful", confidence:0.8 }, error:{ noul:0.84 } }).flagged, true);
  assert.equal(PEN.stepDecision({ step:{ choice:"doubtful", confidence:0.4 }, error:{ noul:0.3 } }).flagged, false);
  assert.equal(PEN.stepDecision({ step:{ choice:"follows", confidence:0.9 }, error:{ noul:0.9 } }).flagged, false);
  assert.equal(PEN.stepDecision(null).flagged, false);
});

test("Canvas search matches kinds in either language, sketches by shape and keeps one entry per place", () => {
  const now = Date.now(), entries = [
    { id:"a", documentId:"d1", source:"scan", kind:"circuit", subject:"engineering", box:{ x:0, y:0, w:100, h:100 }, vector:[1, 0, 0], updatedAt:now },
    { id:"b", documentId:"d1", source:"ink", kind:"formula", subject:"math", box:{ x:300, y:0, w:100, h:40 }, vector:[0, 1, 0], updatedAt:now - 1000 },
    { id:"c", documentId:"d2", source:"widget", kind:"graph", title:"y = sin x", text:"", box:{ x:0, y:0, w:300, h:200 }, vector:[0, 0, 1], updatedAt:now },
  ];
  assert.deepEqual(PEN.searchIndex(entries, "电路").map(r => r.entry.id), ["a"]);
  assert.deepEqual(PEN.searchIndex(entries, "formula").map(r => r.entry.id), ["b"]);
  assert.equal(PEN.searchIndex(entries, "sin x")[0].entry.id, "c");
  assert.equal(PEN.searchIndex(entries, "", { sketch:{ vector:[0, 1, 0], kind:null } })[0].entry.id, "b");
  assert.equal(PEN.searchIndex(entries, "", { sketch:{ vector:[0.2, 0.2, 0.2], kind:"circuit" } })[0].entry.id, "a");
  assert.equal(PEN.searchIndex(entries, "").length, 3);
  const replaced = PEN.upsertIndexEntry(entries, { id:"b2", documentId:"d1", source:"ink", kind:"derivation", box:{ x:305, y:2, w:100, h:40 }, updatedAt:now + 1 });
  assert.deepEqual(replaced.map(entry => entry.id).sort(), ["a", "b2", "c"]);
  // The sketch signature ignores position and scale.
  const draw = (x0, size) => { const w = 60, h = 60, data = new Uint8ClampedArray(w * h * 4).fill(255); for (let i = 0; i < size; i++) { const k = ((x0 + i) * w + x0 + i) * 4; data[k] = data[k + 1] = data[k + 2] = 0; } return PEN.sketchVector(data, w, h); };
  assert.ok(PEN.vectorSimilarity(draw(2, 20), draw(20, 36)) > 0.9);
  assert.equal(PEN.indexKindFromInk("math_step"), "derivation");
  assert.equal(PEN.indexKindFromWidget({ sourceFormat:"penecho-scene+json" }), "animation");
});

test("the local PenEchoLLM mock answers every Cloud mode, including Widget ranking", () => {
  const widget = JEVISION.mockModeAnswers({ mode:"widget", context:{ actions:["scene_replay", "note"], marks:false } }, "auto");
  assert.equal(widget.action.choice, "scene_replay");
  assert.deepEqual(Object.keys(widget.action.probabilities).sort(), ["none", "note", "scene_replay"]);
  assert.equal(JEVISION.mockModeAnswers({ mode:"widget", context:{ actions:["apply_marks", "present"], marks:true } }, "auto").action.choice, "apply_marks");
  assert.equal(JEVISION.mockModeAnswers({ mode:"gesture", context:{ shape:"double_underline" } }, "auto").gesture.choice, "typeset");
  const underline = JEVISION.mockModeAnswers({ mode:"gesture", context:{ shape:"underline" } }, "auto");
  assert.equal(underline.gesture.choice, "none");
  assert.equal(Object.hasOwn(underline.gesture.probabilities, "solve"), false);
  assert.equal(JEVISION.mockModeAnswers({ mode:"ink", context:{ shapesFit:false } }, "solve").action.choice, "solve");
  assert.ok(JEVISION.mockModeAnswers({ mode:"step", context:{} }, "auto").step.choice);
  const index = JEVISION.mockModeAnswers({ mode:"index", context:{} }, "auto");
  assert.ok(index.kind.choice && index.subject.choice);
  assert.ok(JEVISION.mockModeAnswers({ mode:"ink", context:{ shapesFit:false } }, "auto").action);
});

test("pen gestures hold the stroke, ask PenEchoLLM, and run, offer or release it", async () => {
  const source = read("src/client/app/pen-intelligence.js"), calls = [];
  const context = vm.createContext({
    PEN_INTEL:PEN, setTimeout:(fn, ms) => ({ fn, ms }), clearTimeout() {}, performance:{ now:() => 5000 }, debug() {},
    state:{ mode:"pen", viewMode:false, selection:null, activeAI:null, scale:1, history:["h1", "h2"], widgets:[], images:[], textBoxes:[], timer:0 },
    smartSuggest:{ inkReadyAt:5500, strokes:[{ id:1, box:formula, at:1000, historyEntry:"h1" }] },
    penIntel:{ gesture:null, offer:null, settings:{ gestures:true } },
    answers:null,
    penIntelSetting:name => true, penIntelInkDensity:() => 0, widgetBox:b => b, imageBox:b => b, textBoxBox:b => b,
    hideAssist:() => calls.push("hide"), dismissPenGestureOffer() {}, canvasDocumentsCurrent:() => ({ id:"doc" }),
    penIntelRemote:() => true, smartSuggestCropRegion:cluster => cluster.box, smartSuggestRequiredWidgets:() => context.requiredWidgets || [], WIDGET_CLASSIFY_SNAPSHOT_TIMEOUT_MS:8000, ensureWidgetSnapshots:async widgets => { calls.push(`snapshot-preparation:${widgets.length}`); return context.snapshotResult; }, smartSuggestCrop:() => "data:image/png;base64,AAAA",
    penechoLLMRequest:async (mode, image, ctx) => { calls.push(`llm:${mode}:${ctx.shape}`); return context.answers; },
    runPenGesture:(pending, gesture) => calls.push(`run:${gesture}`), offerPenGesture:(pending, decision) => calls.push(`offer:${decision.gesture}`), releasePenGestureInk:() => calls.push("release"),
    AbortController, Set, Math,
  });
  vm.runInContext(["penGestureStrokes", "penGestureContentBoxes", "penGestureAllowed", "penGesturePending", "penIntelStrokeFinished", "clearPenGesture", "resolvePenGesture"].map(name => functionSource(source, name)).join("\n"), context);
  const record = { id:2, points:hline(50, 130, 160), size:4, box:{ x:50, y:128, w:160, h:4 }, historyEntry:"h2" };
  context.state.timer = 42;
  assert.equal(context.penIntelStrokeFinished(record), true);
  assert.equal(context.state.timer, 42, "gesture detection preserves the existing Auto AI deadline");
  assert.equal(context.penGesturePending(), true);
  assert.equal(context.penIntel.gesture.timer.ms, 500, "gesture classification shares the pen-up debounce");
  context.answers = { command:{ type:"noul", noul:0.9 }, gesture:{ type:"choice", choice:"solve", confidence:0.8 } };
  await context.resolvePenGesture();
  assert.deepEqual(calls, ["llm:gesture:underline", "release"]);
  assert.equal(context.penGesturePending(), false);
  calls.length = 0;
  context.state.auto = true;
  context.penIntelStrokeFinished(record);
  await context.resolvePenGesture();
  assert.deepEqual(calls, ["llm:gesture:underline", "release"], "Solve is not offered by gestures in Auto AI mode either");
  context.state.auto = false;
  calls.length = 0;
  context.penIntelStrokeFinished(record);
  const head = [{ x:192, y:116 }, { x:210, y:130 }, { x:192, y:144 }];
  assert.equal(context.penIntelStrokeFinished({ ...record, id:3, points:head, box:PEN.bounds(head) }), true);
  assert.equal(context.penIntel.gesture.records.length, 2, "the arrow head joins its underline-like shaft");
  await context.resolvePenGesture();
  assert.deepEqual(calls, ["llm:gesture:underline", "release"], "a two-stroke arrow stays ink even when the model returns Solve");
  const double = { ...record, id:3, points:hline(50, 139, 160), box:{ x:50, y:137, w:160, h:4 } };
  context.answers = { command:{ type:"noul", noul:0.9 }, gesture:{ type:"choice", choice:"typeset", confidence:0.8 } };
  for (const auto of [false, true]) {
    calls.length = 0;
    context.state.auto = auto;
    context.penIntelStrokeFinished(record);
    context.penIntelStrokeFinished(double);
    await context.resolvePenGesture();
    assert.deepEqual(calls, ["llm:gesture:double_underline", `${auto ? "offer" : "run"}:typeset`]);
  }
  context.state.auto = false;
  calls.length = 0;
  context.penIntelStrokeFinished({ ...record, id:3 });
  context.answers = { command:{ type:"noul", noul:0.99 }, gesture:{ type:"choice", choice:"delete", confidence:0.99 } };
  await context.resolvePenGesture();
  assert.deepEqual(calls, ["llm:gesture:underline", "release"]);
  calls.length = 0;
  context.penIntelStrokeFinished({ ...record, id:4 });
  context.answers = { command:{ type:"noul", noul:0.1 }, gesture:{ type:"choice", choice:"none", confidence:0.9 } };
  await context.resolvePenGesture();
  assert.deepEqual(calls, ["llm:gesture:underline", "release"]);
  // A gesture over a Widget waits for its pixels; without them the local
  // decision stands and no incomplete image is sent.
  for (const complete of [true, false]) {
    calls.length = 0;
    context.requiredWidgets = [{ id:"widget" }];
    context.snapshotResult = { complete, missing:complete ? 0 : 1, missingWidgets:complete ? [] : [{ id:"widget" }] };
    context.penIntelStrokeFinished({ ...record, id:complete ? 6 : 7 });
    await context.resolvePenGesture();
    assert.deepEqual(calls, complete ? ["snapshot-preparation:1", "llm:gesture:underline", "release"] : ["snapshot-preparation:1", "release"]);
  }
  context.requiredWidgets = [];
  // Ordinary writing is never held.
  assert.equal(context.penIntelStrokeFinished({ id:5, points:ellipse(600, 600, 8, 8), size:4, box:{ x:592, y:592, w:16, h:16 }, historyEntry:"h2" }), false);
  context.penIntelStrokeFinished(record);
  calls.length=0;
  context.performance.now=()=>7000;
  context.smartSuggest.inkReadyAt=8000;
  context.penIntelStrokeFinished({id:6,points:ellipse(600,600,8,8),size:4,box:{x:592,y:592,w:16,h:16},historyEntry:"h2"});
  assert.equal(context.penGesturePending(),false,"long continued writing cannot leave a paused gesture blocking suggestions");
  assert.deepEqual(calls,[],"the previous gesture cannot dispatch immediately at the latest pen-up");
});

test("the Canvas wires the features in without auto-firing checks or deletes", () => {
  const ai = read("src/client/app/ai-runtime.js"), smart = read("src/client/app/smart-suggestions.js"), pen = read("src/client/app/pen-intelligence.js"),
    html = read("public/index.html"), build = read("scripts/build-client.js"), server = read("src/server/main.js"),
    indexSource = read("src/client/app/canvas-index.js"), pkg = JSON.parse(read("package.json"));
  const launch = functionSource(ai, "launchAutomaticAI");
  assert.doesNotMatch(launch, /penGesturePending|smartAuto|autoRoute/);
  assert.doesNotMatch(ai + server + pen, /smartAutoIntercept|smartAutoRun|autoRoute|AUTO_ROUTES/);
  // The step checker only flags; the check runs from the flag's click handler.
  const consider = functionSource(pen, "stepCheckerConsider");
  assert.doesNotMatch(consider, /executeAssistAction|requestAI/);
  assert.match(functionSource(pen, "showStepFlag"), /penIntelButton\([^]*?executeAssistAction\(\{ id:"check_step"/);
  assert.match(smart, /stepCheckerConsider\(cluster, data\.answers, region\)/);
  assert.match(smart, /canvasIndexInk\(cluster, data\.answers\)/);
  assert.match(smart, /penIntelStrokeFinished\(record\);[\s\S]*?scheduleAssist\(\);/);
  // All PenEchoLLM calls use the Cloud action space: a mode, never prompts.
  assert.match(functionSource(pen, "penechoLLMRequest"), /JSON\.stringify\(\{ version:1, mode, \.\.\.\(image \? \{image\} : \{\}\), context:context \|\| \{\} \}\)/);
  for (const mode of ["gesture", "step"]) assert.match(pen, new RegExp(`penechoLLMRequest\\("${mode}"`));
  assert.match(indexSource, /penechoLLMRequest\("index"/);
  assert.doesNotMatch(pen + indexSource, /questions:|criteria:|facts:/);
  for (const id of ["penGesturesToggle", "stepCheckToggle"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /smartAutoToggle|settingsSmartAuto/);
  assert.ok(html.indexOf('src="pen-intel.js"') > html.indexOf('src="smart-suggest.js"') && html.indexOf('src="pen-intel.js"') < html.indexOf('src="app.js"'));
  assert.ok(build.indexOf("pen-intelligence.js") > build.indexOf("widget-assist.js") && build.indexOf("canvas-index.js") < build.indexOf("ui-bootstrap.js"));
  for (const file of ["public/pen-intel.js", "public/scene-spec.js", "public/scene-runtime.js"]) assert.ok(pkg.files.includes(file), file);
  // Canvas content search is deferred; Library and Navigator search remain available.
  const shortcuts = read("src/client/app/keyboard-shortcuts.js");
  assert.doesNotMatch(shortcuts, /canvas-content-search|openCanvasSearch/);
  assert.doesNotMatch(functionSource(smart, "assistToolsList"), /openCanvasSearch|dataset\.tool = "search"/);
  assert.match(shortcuts, /id:"search-work"[^\n]*defaultChord:"Mod\+k"/);
  assert.match(shortcuts, /id:"canvas-library"[^\n]*defaultChord:"Mod\+o"/);
  assert.doesNotMatch(indexSource, /window\.addEventListener\("keydown"/);
  // Flags and offers share Assist's complete raster/object avoidance.
  assert.match(functionSource(pen, "penIntelPlace"), /assistContentMask\(width, height\)/);
  assert.match(functionSource(pen, "penIntelPlace"), /assistFindPlacement/);
  // Independent Delete uses local Canvas edits, never a model deletion request.
  const run = functionSource(pen, "runPenGesture");
  assert.match(run, /executeAssistDeletion/);
  assert.doesNotMatch(run.slice(run.indexOf('if (gesture === "delete")'), run.indexOf('smartSuggest.consumedStrokeId')), /requestAI|deleteSelection|penIntelInkComponentBox/);
  assert.doesNotMatch(functionSource(smart, "executeAssistDeletion"), /requestAI|widgetEditContext|requireAiConnectionSelection/);
  assert.doesNotMatch(pen, /pen-delete-preview|function penIntelInkComponentBox/);
});
