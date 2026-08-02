"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const LAYOUT = require("../public/layout.js");

const resolve = (options) => LAYOUT.resolveFlowOverlaps(options);

test("items in blank space keep their requested position", () => {
  const result = resolve({
    flow: [{ x: 100, y: 100, w: 200, h: 50 }],
    obstacles: [],
    gap: 40,
    maxY: 20000,
  });
  assert.deepEqual(result, [100]);
});

test("an item overlapping an obstacle flows below it", () => {
  const result = resolve({
    flow: [{ x: 100, y: 100, w: 200, h: 50 }],
    obstacles: [{ x: 50, y: 80, w: 300, h: 100 }],
    gap: 40,
    maxY: 20000,
  });
  assert.deepEqual(result, [80 + 100 + 40]);
});

test("existing content with only horizontal separation does not move the item", () => {
  const result = resolve({
    flow: [{ x: 500, y: 100, w: 200, h: 50 }],
    obstacles: [{ x: 100, y: 100, w: 300, h: 200 }],
    gap: 40,
    maxY: 20000,
  });
  assert.deepEqual(result, [100]);
});

test("cascading collisions stack items with the gap preserved", () => {
  const result = resolve({
    flow: [
      { x: 100, y: 100, w: 200, h: 50 },
      { x: 100, y: 110, w: 200, h: 60 },
    ],
    obstacles: [{ x: 100, y: 90, w: 200, h: 40 }],
    gap: 20,
    maxY: 20000,
  });
  // First item flows below the obstacle; second flows below the first.
  assert.deepEqual(result, [150, 220]);
});

test("an item pushed past several obstacles settles under the lowest one", () => {
  const result = resolve({
    flow: [{ x: 100, y: 0, w: 100, h: 100 }],
    obstacles: [
      { x: 100, y: 0, w: 100, h: 100 },
      { x: 100, y: 110, w: 100, h: 100 },
      { x: 100, y: 220, w: 100, h: 100 },
    ],
    gap: 10,
    maxY: 20000,
  });
  assert.deepEqual(result, [330]);
});

test("adjusted position clamps inside the canvas", () => {
  const result = resolve({
    flow: [{ x: 100, y: 19990, w: 100, h: 100 }],
    obstacles: [],
    gap: 40,
    maxY: 20000,
  });
  assert.deepEqual(result, [19900]);
});

test("an item blocked at the canvas bottom moves above the obstacle", () => {
  const result = resolve({
    flow: [{ x: 100, y: 19900, w: 100, h: 100 }],
    obstacles: [{ x: 100, y: 19850, w: 100, h: 150 }],
    gap: 40,
    maxY: 20000,
  });
  assert.deepEqual(result, [19710]);
});

test("degenerate and malformed obstacles are ignored", () => {
  const result = resolve({
    flow: [{ x: 100, y: 100, w: 200, h: 50 }],
    obstacles: [
      { x: 100, y: 100, w: 0, h: 300 },
      { x: 100, y: 100, w: 300, h: -5 },
      { x: NaN, y: 100, w: 300, h: 300 },
      null,
    ],
    gap: 40,
    maxY: 20000,
  });
  assert.deepEqual(result, [100]);
});

test("resolution terminates on pathological self-blocking input", () => {
  // An obstacle so tall the item can never fully clear it before the clamp:
  // the loop must still terminate and return a clamped value.
  const result = resolve({
    flow: [{ x: 0, y: 0, w: 100, h: 100 }],
    obstacles: [{ x: 0, y: 0, w: 100, h: 30000 }],
    gap: 0,
    maxY: 20000,
  });
  assert.equal(result.length, 1);
  assert.ok(result[0] >= 0 && result[0] <= 19900);
});
