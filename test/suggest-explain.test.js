"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const SMART = require("../public/smart-suggest.js");
const choice = value => ({ type:"choice", choice:value });

test("Canvas Explain carries the text-or-Widget requirement without changing Check step", () => {
  const source = fs.readFileSync("src/server/main.js", "utf8");
  const focus = source.match(/const SUGGESTION_FOCUS = Object\.freeze\((\{[\s\S]*?\n\})\);/);
  const policy = source.slice(source.indexOf("const CREATE_VISUAL_POLICY ="),source.indexOf("const SUGGESTION_FOCUS ="));
  const actions = vm.runInNewContext(`${policy}\n(${focus[1]})`, {
    FINISH_DRAWING:require("../src/shared/finish-drawing.js"),
    SKETCH_PUPPET:require("../src/shared/sketch-puppet.js"),
    NOTE_CARD:require("../public/note-card.js"),
    ILLUSTRATION_STYLE:require("../src/shared/illustration-style.js"),
  });
  assert.equal(actions.explain[0], "explain");
  assert.match(actions.explain[1], /purely textual[\s\S]*native text and math notation without a Widget/);
  assert.match(actions.explain[1], /source or explanation involves a figure, diagram, chart[\s\S]*Widget combining the relevant graphics/);
  assert.match(actions.explain[1], /Mathematical notation alone is not a graphic/);
  assert.match(actions.explain[1], /exactly one html_widget with pluginId general/);
  assert.match(actions.explain[1], /independently of the executor selected by PenEchoLLM according to task complexity/);
  assert.match(source, /For the Explain action \(suggestion explain, or userAction explain without a different suggestion\)/);
  assert.match(actions.check_step[1], /draw_formula for math and write_text for language/);
  assert.doesNotMatch(actions.check_step[1], /explanatory Widget/);
});

test("Explain clicks honor PenEchoLLM complexity verdicts for text and graphics in ink and lasso scopes", async () => {
  const source = fs.readFileSync("src/client/app/smart-suggestions.js", "utf8");
  const start = source.indexOf("  async function executeAssistAction("), end = source.indexOf("  // Kept for callers", start);
  for (const kind of ["notes", "math_expr", "diagram"]) for (const selection of [null, { phase:"active" }]) {
    for (const executor of [null, "canvas_ai", "penecho_agent"]) {
      const calls = [], box = { x:100, y:200, w:300, h:100 }, packed = { atlasImage:"masked-selection" };
      const target = { box, strokes:[], selection, routing:{ kind:choice(kind), ...(executor ? { execution_explain:choice(executor) } : {}) } };
      const context = {
        SMART_SUGGEST:SMART, state:{ language:"zh" }, smartSuggest:{ cooldown:{} },
        assistSelectionTargetValid:() => true, clearTimeout(){}, cancelWidgetRefinement(){}, supersedeActiveAI(){},
        renderAssist(){}, debug(){}, smartSuggestRecent(){}, hideAssist(){}, assistRequestOptions:() => ({}),
        buildSelectionImage:() => packed,
        requestAI:(...args) => calls.push(["canvas_ai", ...args]),
        requestSelectionAI:(...args) => calls.push(["canvas_ai", ...args]),
        assistAgentRun:async id => { calls.push(["penecho_agent", id]); return "submitted"; },
        assistClassifyRequest:() => assert.fail("Explain must use its saved verdict without a second classification"),
      };
      vm.createContext(context); vm.runInContext(source.slice(start, end), context);
      await context.executeAssistAction({ id:"explain" }, target);
      assert.equal(calls.length, 1, `${kind}/${Boolean(selection)}/${executor}`);
      assert.equal(calls[0][0], executor || "canvas_ai");
      assert.equal(calls[0][1], "explain");
      if (executor !== "penecho_agent") {
        assert.equal(calls[0].at(-1).suggestion, "explain");
        if (selection) { assert.equal(calls[0][2], selection); assert.equal(calls[0][3], packed); }
      }
    }
  }
});
