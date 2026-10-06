"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync("src/client/app/core.js", "utf8").match(/function requestSelectionAI\([^]*?\n  \}/)[0];

function fixture(mode = "select") {
  const selection = { phase:"active", box:{ x:10, y:20, w:100, h:80 } },
    state = { mode, selection }, calls = [];
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const context = { state, aiPreparationGeneration:0, supersedeActiveAI(){}, setStatusKey(){}, selectionAIStatusKey:() => "observing",
    updateSelectionToolbar(){}, renderInteractionLayer(){}, captureSelectionDirtyInput:() => ({}), releaseDirtyInput(){},
    setCanvasMode:mode => { assert.equal(selection.aiRequest, null, "release the request lock before changing tools"); state.mode = mode; calls.push(mode); },
    requestAI:(_action, _packed, options) => { context.options = options; return pending; },
  };
  const request = vm.runInNewContext(`(${source})`, context);
  return { state, selection, calls, context, start:callback => request("answer", selection, { sourceRect:selection.box }, callback ? { onSettled:callback } : null),
    async finish(outcome) { if (outcome) context.options.onSettled(outcome); finish(); await pending; await Promise.resolve(); },
  };
}

test("successful lasso Canvas AI switches to Hand after releasing its request lock", async () => {
  for (const sourceReleased of [false, true]) {
    const h = fixture(), outcomes = [];
    assert.equal(h.start(outcome => outcomes.push(outcome)), true);
    assert.equal(h.state.mode, "select", "keep Lasso while waiting");
    if (sourceReleased) { h.selection.aiRequest = null; h.state.selection = null; }
    const outcome = { completed:true, superseded:false };
    await h.finish(outcome);
    assert.equal(h.state.mode, "hand");
    assert.deepEqual(h.calls, ["hand"]);
    assert.deepEqual(outcomes, [outcome], "preserve the caller's completion callback");
  }
});

test("failed, stopped, superseded and unstarted lasso requests retain Lasso", async () => {
  for (const outcome of [null, { completed:false }, { completed:false, superseded:true }, { completed:true, superseded:true }]) {
    const h = fixture(); h.start(); await h.finish(outcome);
    assert.equal(h.state.mode, "select");
    assert.equal(h.selection.aiRequest, null);
    assert.deepEqual(h.calls, []);
  }
});

test("lasso completion preserves newer tools, selections, requests and pending work", async () => {
  for (const change of ["tool", "selection", "request", "drawing", "gesture", "pending", "pendingWidget", "viewMode"]) {
    const h = fixture(); h.start();
    if (change === "tool") h.state.mode = "pen";
    else if (change === "selection") h.state.selection = { phase:"active" };
    else if (change === "request") h.selection.aiRequest = { token:{}, action:"plot" };
    else if (change === "gesture") h.state.selectionGesture = {};
    else h.state[change] = {};
    const mode = h.state.mode, selection = h.state.selection;
    await h.finish({ completed:true, superseded:false });
    assert.equal(h.state.mode, mode, change);
    assert.equal(h.state.selection, selection, change);
    assert.deepEqual(h.calls, [], change);
  }
});

test("selection AI started from Pen keeps the user's tool", async () => {
  const h = fixture("pen"); h.start();
  h.state.mode = "select";
  await h.finish({ completed:true, superseded:false });
  assert.equal(h.state.mode, "select", "draft controls do not turn a Pen request into a Lasso request");
  assert.deepEqual(h.calls, []);
});
