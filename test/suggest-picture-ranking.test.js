"use strict";
// Recorded PenEchoLLM answers for real drawings (2026-10-04 request logs): a tall
// caterpillar that stroke geometry reads as text rows and as a note enclosure.
const test = require("node:test"), assert = require("node:assert/strict");
const SMART = require("../public/smart-suggest.js");
const choice = probabilities => ({ type:"choice", choice:Object.keys(probabilities).sort((a, b) => probabilities[b] - probabilities[a])[0], probabilities });
const noul = value => ({ type:"noul", noul:value });
const caterpillar = { none:0.145, check_step:0.015, hint:0.008, practice:0.01, diagram:0.019, organize:0.006, answer:0.197, create_visual:0.204, explain:0.011, animate:0.063, finish_drawing:0.12, vivid:0.092, animate_sketch:0.072, note:0.032 };
const recorded = (action, { kind = { drawing:0.9996, none:0.0002, notes:0.0002 }, finished = 0.998, ...more } = {}) =>
  ({ kind:choice(kind), action:choice(action), finished:noul(finished), note_task:noul(0.0095), ...more });
// The Suggest bar: a ranked Answer keeps first/second place; otherwise it is third.
const bar = view => {
  const index = view.items.findIndex(item => item.id === "answer"), ranked = index >= 0 && index < 2;
  const rest = [...view.items, ...view.more].filter(item => item.id !== "answer"), items = rest.slice(0, 2).map(item => item.id);
  items.splice(ranked ? index : items.length, 0, "answer");
  return items;
};
const textRows = { strokes:22, rows:6, aspect:0.35, cues:{ equals:0, openEquals:0, lineArt:false, dashes:0 } };

test("a recognised finished picture offers its illustration first even when geometry looked like enclosed notes", () => {
  const local = SMART.localPredict({ ...textRows, notePriority:true });
  assert.equal(local.bucket, "text_rows", "a tall caterpillar is outside the drawing aspect range");
  const ranked = SMART.rankActions({ local, answers:recorded(caterpillar), exclude:["refine", "snap_shapes"] });
  assert.deepEqual(bar(ranked), ["vivid", "finish_drawing", "answer"]);
  assert.equal(ranked.notePriority, false, "a picture's own loops are not a grouping of notes");
  assert.ok(!ranked.items.concat(ranked.more).some(item => item.id === "create_visual"), "an unworded picture does not request a different new visual");
  // The same answers on a lasso selection of the drawing.
  const selection = SMART.rankActions({ local:SMART.localPredict({ selection:true, aspect:0.62, notePriority:true }), answers:recorded(caterpillar, { note_scope:noul(0.02) }) });
  assert.equal(selection.items[0].id, "vivid");
});

test("the picture verdict needs a confident, finished drawing without typed words", () => {
  const local = SMART.localPredict({ ...textRows, notePriority:true });
  const uncertain = SMART.rankActions({ local, answers:recorded(caterpillar, { kind:{ drawing:0.6, notes:0.4 } }) });
  assert.equal(uncertain.items[0].id, "note", "an uncertain picture keeps the enclosure's note priority");
  const unfinished = SMART.rankActions({ local, answers:recorded(caterpillar, { finished:0.2 }) });
  assert.ok(unfinished.items.concat(unfinished.more).some(item => item.id === "create_visual"));
  const typed = SMART.rankActions({ local:SMART.localPredict({ ...textRows, typedText:"draw a garden around it" }), answers:recorded(caterpillar) });
  assert.ok(typed.items.concat(typed.more).some(item => item.id === "create_visual"), "a written request keeps Create visual");
  const words = SMART.rankActions({ local:SMART.localPredict(textRows), answers:recorded(caterpillar, { kind:{ question:0.9, drawing:0.1 } }) });
  assert.ok(words.items.some(item => item.id === "create_visual"), "words asking for a visual keep Create visual");
  assert.notEqual(words.items[0].id, "vivid");
});

test("explicit enclosed notes and motion cues keep their own priority", () => {
  const notes = SMART.rankActions({ local:SMART.localPredict({ ...textRows, notePriority:true }),
    answers:recorded({ none:0.1, note:0.5, organize:0.2, typeset:0.2 }, { kind:{ notes:0.95, drawing:0.05 } }) });
  assert.equal(notes.items[0].id, "note");
  const motion = SMART.localPredict({ strokes:8, rows:1, aspect:1, cues:{ equals:0, openEquals:0, lineArt:false }, motionCue:{ type:"speed-lines" } });
  const moving = SMART.rankActions({ local:motion, answers:recorded({ none:0.05, animate_sketch:0.5, vivid:0.3, finish_drawing:0.15 }) });
  assert.equal(moving.items[0].id, "animate_sketch");
});

test("the illustration label follows the selected illustration style", () => {
  const vivid = SMART.actionById("vivid");
  assert.equal(SMART.label(vivid, "en"), "Storybook illustration");
  assert.equal(SMART.label(vivid, "zh", { illustrationStyle:"storybook" }), "绘本插画");
  assert.equal(SMART.label(vivid, "en", { illustrationStyle:"3d" }), "3D illustration");
  assert.equal(SMART.label(vivid, "zh", { illustrationStyle:"3d" }), "立体插画");
  assert.equal(SMART.label(SMART.actionById("solve"), "en", { illustrationStyle:"3d" }), "Solve");
  assert.doesNotMatch(vivid.criteria, /as requested by|children's picture-book/, "ranking does not wait for an explicit colour request or assume one style");
  assert.match(vivid.criteria, /finished picture without written instructions invites this/);
});
