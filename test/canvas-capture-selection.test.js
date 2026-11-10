"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const functionSource = (source, name) => {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, name);
  return match[0];
};

test("whole-Canvas capture bounds include lifted ink at its moved and resized position", () => {
  const persistence = read("src/client/app/persistence.js"), agent = read("src/client/app/canvas-agent-runtime.js"),
    selection = { phase:"active", originalBox:{x:100,y:100,w:100,h:100}, box:{x:1000,y:2000,w:200,h:300},
      fragments:[{x:110,y:130,w:50,h:20}], objects:[] }, state = {selection};
  let widget = {x:200,y:400,w:100,h:100};
  const bounds = vm.runInNewContext([
    functionSource(persistence,"unionLocalBounds"), functionSource(persistence,"selectionContentBounds"),
    functionSource(agent,"canvasAgentContentBounds"), "canvasAgentContentBounds",
  ].join("\n"), { state, SIZE:20000, SELECT:require("../public/selection.js"),
    visibleInkBounds:()=>null, imageBounds:()=>null, textBoxBounds:()=>null, animationBounds:()=>null, widgetBounds:()=>widget });
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(bounds()),{x:200,y:400,w:920,h:1750});
  widget = null;
  assert.deepEqual(plain(bounds()),{x:1020,y:2090,w:100,h:60},"ink-only capture follows fragments rather than empty source tiles");
  assert.deepEqual(selection.box,{x:1000,y:2000,w:200,h:300},"bounds inspection leaves the lasso intact");
  selection.phase = "lasso";
  assert.equal(bounds(),null,"unfinished lasso geometry is not captured content");
  selection.phase = "active";
  selection.fragments = [];
  assert.equal(bounds(),null,"a blank read-only lasso does not expand content bounds");
  widget = {x:200,y:400,w:100,h:100};
  assert.deepEqual(plain(bounds()),widget);
});
