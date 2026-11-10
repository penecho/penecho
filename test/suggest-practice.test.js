"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const SMART = require("../public/smart-suggest.js");
const source = fs.readFileSync(require("node:path").join(__dirname, "../src/client/app/smart-suggestions.js"), "utf8");
const choice = (id, probabilities = { [id]:0.95, none:0.05 }) => ({ type:"choice", choice:id, confidence:probabilities[id], probabilities });
const plain = value => JSON.parse(JSON.stringify(value));

test("Practice is independently ranked for formulas and learning content", () => {
  const action = SMART.actionById("practice");
  assert.equal(SMART.label(action, "zh"), "练一题");
  assert.equal(SMART.label(action, "en"), "Try a problem");
  assert.deepEqual(action.exec, { type:"ai", action:"answer", suggestion:"practice" });
  for (const kind of ["math_expr", "math_step", "notes", "question", "diagram", "code"]) {
    const ranked = SMART.rankActions({ answers:{ kind:choice(kind), action:choice("practice") } });
    assert.equal(ranked.items[0].id, "practice", kind);
    assert.equal(ranked.confident, true);
  }
  for (const context of [{}, { selection:true }, { result:true }]) assert.ok(SMART.buildQuestions(context).action.criteria.practice);
});

test("formula predictions offer Practice through More without treating everyday notes as study", () => {
  const formula = SMART.rankActions({ local:SMART.localPredict({ strokes:6, rows:1, aspect:4.2 }) });
  assert.deepEqual(formula.items.map(item => item.id), ["typeset", "plot", "solve"]);
  assert.equal(formula.more[0].id, "practice");
  const notes = SMART.localPredict({ strokes:8, rows:3, aspect:3 });
  assert.equal(notes.probabilities.practice, undefined);
  assert.ok(SMART.localPredict({ strokes:8, rows:3, profile:{ math_expr:0.8 } }).probabilities.practice > 0);
});

test("new practice results leave the exercise for the learner even if the model ranks Solve", () => {
  const answers = { kind:choice("math_expr"), action:choice("solve") };
  assert.equal(SMART.rankResultActions(answers).items[0].id, "solve");
  assert.deepEqual(SMART.rankResultActions(answers, { previousAction:"practice" }).items, []);
  const start = source.indexOf("  function assistView("), end = source.indexOf("\n  function ", start + 1);
  const cluster = { result:true, key:"practice-result", previousAction:"practice" };
  const context = { SMART_SUGGEST:SMART, smartSuggest:{ jev:{ key:cluster.key, answers } } };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  assert.deepEqual(plain(context.assistView(cluster).items), []);
  const learningResult = { kind:choice("notes"), action:choice("practice") };
  assert.equal(SMART.rankResultActions(learningResult, { previousAction:"explain" }).items[0].id, "practice");
});

test("Practice click sends its own focus with the captured region or masked selection", async () => {
  const start = source.indexOf("  async function executeAssistAction("), end = source.indexOf("  // Kept for callers", start);
  for (const selection of [null, { phase:"active" }]) {
    const calls = [], packed = { atlasImage:"masked-image" }, box = { x:100, y:200, w:300, h:80 };
    const target = { box, newBox:box, strokes:[{ id:7 }], ...(selection ? { selection } : {}) };
    const context = {
      SMART_SUGGEST:SMART, state:{ language:"zh" }, smartSuggest:{ consumedStrokeId:0, cooldown:{} },
      assistSelectionTargetValid:() => true, clearTimeout(){}, cancelWidgetRefinement(){}, supersedeActiveAI(){},
      smartSuggestRecent(){}, debug(){}, renderAssist(){}, assistRequestOptions:() => ({ preserveInput:true }),
      buildSelectionImage:() => packed, requestAI:(...args) => calls.push(args), requestSelectionAI:(...args) => calls.push(args),
      invokeAIAction:() => assert.fail("Practice must not invoke manual Answer"),
    };
    vm.createContext(context); vm.runInContext(source.slice(start, end), context);
    await context.executeAssistAction({ id:"practice" }, target);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "answer");
    const options = calls[0].at(-1);
    assert.equal(options.suggestion, "practice");
    if (selection) { assert.equal(calls[0][1], selection); assert.equal(calls[0][2], packed); }
    else { assert.deepEqual(plain(options.attentionBox), box); assert.equal(options.focusAttention, true); }
    assert.equal(context.smartSuggest.consumedStrokeId, 0, "only successful output consumes the source");
  }
});

test("the offline fixture includes Practice's kind and saved execution verdict", () => {
  const answers = require("../src/server/jevision.js").mockModeAnswers({ mode:"ink", context:{} }, "practice");
  assert.equal(answers.action.choice, "practice");
  assert.equal(answers.kind.choice, "math_expr");
  assert.equal(answers.execution_practice.choice, "canvas_ai");
});
