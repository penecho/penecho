"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const SMART = require("../public/smart-suggest.js");
const FINISH_DRAWING = require("../src/shared/finish-drawing.js");
const SKETCH_PUPPET = require("../src/shared/sketch-puppet.js");
const NOTE_CARD = require("../public/note-card.js");
const ILLUSTRATION_STYLE = require("../src/shared/illustration-style.js");

test("Make diagram has the same semantic task in ranking and both executors", () => {
  const server = fs.readFileSync("src/server/main.js", "utf8"), agent = fs.readFileSync("src/client/app/assist-agent.js", "utf8");
  const focus = server.match(/const SUGGESTION_FOCUS = Object\.freeze\((\{[\s\S]*?\n\})\);/);
  const tasks = agent.match(/const ASSIST_AGENT_TASKS = Object\.freeze\((\{[\s\S]*?\n  \})\);/);
  assert.ok(focus && tasks, "inspect the actual prompt maps used by the executors");
  const policy = server.slice(server.indexOf("const CREATE_VISUAL_POLICY ="),server.indexOf("const SUGGESTION_FOCUS ="));
  const canvas = vm.runInNewContext(`${policy}\n(${focus[1]})`, { FINISH_DRAWING, SKETCH_PUPPET, NOTE_CARD, ILLUSTRATION_STYLE });
  const delegated = vm.runInNewContext(`(${tasks[1]})`, { PenEchoFinishDrawing:FINISH_DRAWING, PenEchoIllustrationStyle:ILLUSTRATION_STYLE });
  const criterion = SMART.actionById("diagram").criteria;
  assert.equal(canvas.diagram[0], "plot");
  assert.equal(canvas.diagram[1], criterion);
  assert.equal(delegated.diagram, criterion);
  for (const type of ["workflow", "sequence", "architecture", "state", "entity relationship", "mind map"]) assert.ok(criterion.includes(type), type);
  assert.match(criterion, /Nodes represent[\s\S]*connections express their relationships/);
  assert.doesNotMatch(criterion, /flowchart plugin|diagram_source|General HTML|maze|route|entrance|exit/i);
  assert.deepEqual(SMART.actionById("diagram").kinds, ["diagram", "notes", "question", "code"]);
  assert.equal(SMART.actionById("diagram").label.zh, "生成结构图");
});

test("geometric fitting and old Canvas profile never invent a semantic diagram", () => {
  for (const shapes of [{ arrows:2, closed:0 }, { arrows:2, closed:4 }, { arrows:0, closed:5, rectangles:0 }]) {
    const predicted = SMART.localPredict({ shapes, profile:{ diagram:1 } });
    assert.equal(predicted.kind, "shape");
    assert.equal(predicted.probabilities.diagram, undefined);
    assert.ok(predicted.probabilities.answer > 0);
    assert.equal(SMART.rankActions({ local:predicted }).items[0].id, "snap_shapes");
  }
  assert.equal(SMART.localPredict({ strokes:4, rows:3, profile:{ diagram:1 } }).probabilities.diagram, undefined);
  assert.doesNotMatch(SMART.KINDS.diagram, /geometric construction|circuit|spatial puzzle/);
  assert.match(SMART.KINDS.shape, /spatial figures/);
});

test("the general Answer and manual AI policies contain no dedicated visual-puzzle instruction", () => {
  const server = fs.readFileSync("src/server/main.js", "utf8"), agent = fs.readFileSync("src/client/app/assist-agent.js", "utf8");
  for (const text of [SMART.actionById("answer").criteria, server, agent]) assert.doesNotMatch(text, /maze|corridors|entrance and exit|valid route|entry\/exit/);
  assert.match(SMART.actionById("answer").criteria, /Answer general questions and requests when no specialized action fits/);
  assert.equal(SMART.actionById("find_route"), null);
});
