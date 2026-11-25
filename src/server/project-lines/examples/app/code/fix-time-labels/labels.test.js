// Run with: node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const { placeLabels } = require("./labels.js");

test("labels far apart all stay on the first row", () => {
  assert.deepEqual(placeLabels([0, 60, 120]).map(l => l.row), [0, 0, 0]);
});

test("a label that would touch the one before it goes to the second row", () => {
  assert.deepEqual(placeLabels([100, 108, 160]).map(l => l.row), [0, 1, 0]);
});

test("four steps eight minutes apart: two rows, and the rest wait for the pointer", () => {
  assert.deepEqual(placeLabels([160, 168, 175, 183]).map(l => l.row), [0, 1, -1, -1]);
});
