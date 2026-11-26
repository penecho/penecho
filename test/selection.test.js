"use strict";
require("./helpers/safety.js");

const test = require("node:test");
const assert = require("node:assert/strict");
const selection = require("../public/selection.js");

test("lasso bounds enclose a freehand path and stay inside the canvas", () => {
  const path = [{ x: -4, y: 8.8 }, { x: 18.7, y: 21.2 }, { x: 11.1, y: 4.2 }];
  assert.deepEqual(selection.polygonBounds(path, 20), { x: 0, y: 4, w: 19, h: 16 });
  assert.deepEqual(selection.clipPoint({ x: -3, y: 24 }, 20), { x: 0, y: 20 });
});

test("lasso point sampling follows drawn distance without flooding the path", () => {
  const path = [{ x: 2, y: 3 }, { x: 5, y: 7 }];
  assert.equal(selection.pathLength(path), 5);
  assert.equal(selection.shouldAddPoint(path, { x: 5.5, y: 7 }, 1), false);
  assert.equal(selection.shouldAddPoint(path, { x: 7, y: 7 }, 1), true);
});

test("lasso inclusion follows the path instead of its rectangular bounds", () => {
  const triangle = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 0, y: 12 }];
  assert.equal(selection.pointInPolygon({ x: 2, y: 2 }, triangle), true);
  assert.equal(selection.pointInPolygon({ x: 10, y: 10 }, triangle), false, "point is inside the bounds but outside the lasso");
  assert.equal(selection.pointInPolygon({ x: 13, y: 2 }, triangle), false);
});

test("selection movement stays within the logical canvas", () => {
  const box = { x: 20, y: 30, w: 40, h: 25 };
  assert.deepEqual(selection.moveBox(box, -100, 90, 100), { x: 0, y: 75, w: 40, h: 25 });
  assert.deepEqual(selection.moveBox(box, 12, -8, 100), { x: 32, y: 22, w: 40, h: 25 });
});

test("selection resize is uniform and respects minimum and canvas bounds", () => {
  const box = { x: 10, y: 20, w: 40, h: 20 };
  assert.deepEqual(selection.resizeBox(box, { x: 90, y: 35 }, 10, 100), { x: 10, y: 20, w: 80, h: 40 });
  assert.deepEqual(selection.resizeBox(box, { x: 11, y: 21 }, 10, 100), { x: 10, y: 20, w: 20, h: 10 });
  assert.deepEqual(selection.resizeBox({ x: 96, y: 96, w: 4, h: 4 }, { x: 97, y: 97 }, 20, 100), { x: 96, y: 96, w: 4, h: 4 });
});

test("selection fragments preserve their relative placement when transformed", () => {
  const source = { x: 100, y: 200, w: 80, h: 40 },
    target = { x: 20, y: 30, w: 160, h: 80 },
    fragment = { x: 120, y: 210, w: 15, h: 12 };
  assert.deepEqual(selection.mapFragment(fragment, source, target), { x: 60, y: 50, w: 30, h: 24 });
});

test("selection controls distinguish accept, cancel, resize, and body movement", () => {
  const box = { x: 100, y: 100, w: 80, h: 50 },
    controls = selection.controlPoints(box, 10);
  assert.equal(selection.hitTest(box, controls.accept, 10), "accept");
  assert.equal(selection.hitTest(box, controls.cancel, 10), "cancel");
  assert.equal(selection.hitTest(box, controls.resize, 10), "resize");
  assert.equal(selection.hitTest(box, { x: 130, y: 125 }, 10), "move");
  assert.equal(selection.hitTest(box, { x: 20, y: 20 }, 10), null);
});

test("selection exposes independent edge resize controls", () => {
  const box = { x: 100, y: 100, w: 80, h: 50 },
    controls = selection.controlPoints(box, 10);
  assert.deepEqual(controls.width, { x: 180, y: 125 });
  assert.deepEqual(controls.height, { x: 140, y: 150 });
  assert.equal(selection.hitTest(box, controls.width, 10), "width");
  assert.equal(selection.hitTest(box, controls.height, 10), "height");
  assert.deepEqual(selection.resizeBoxAxis(box, { x: 220, y: 0 }, "width", 24, 300), { x: 100, y: 100, w: 120, h: 50 });
  assert.deepEqual(selection.resizeBoxAxis(box, { x: 0, y: 190 }, "height", 24, 300), { x: 100, y: 100, w: 80, h: 90 });
  assert.deepEqual(selection.resizeBoxAxis(box, { x: 101, y: 101 }, "width", 24, 300), { x: 100, y: 100, w: 24, h: 50 });
});

test("path hit testing includes the closed boundary and maps with its box", () => {
  const path = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 50, y: 80 }],
    box = { x: 10, y: 10, w: 80, h: 70 },
    target = { x: 100, y: 200, w: 160, h: 140 };
  assert.equal(selection.pointNearPath({ x: 50, y: 10 }, path, 0.1), true);
  assert.equal(selection.hitTestPath(path, box, { x: 50, y: 40 }, 10), "move");
  assert.equal(selection.hitTestPath(path, box, { x: 20, y: 70 }, 1), null);
  assert.deepEqual(selection.mapPath(path, box, target), [
    { x: 100, y: 200 },
    { x: 260, y: 200 },
    { x: 180, y: 340 },
  ]);
});

test("selection hit testing can omit legacy corner actions when toolbar owns them", () => {
  const box = { x: 100, y: 100, w: 80, h: 50 },
    controls = selection.controlPoints(box, 10);
  assert.equal(selection.hitTest(box, controls.cancel, 10), "cancel");
  assert.equal(selection.hitTest(box, controls.cancel, 10, false), null);
  assert.equal(selection.hitTestPath([{ x: 120, y: 120 }, { x: 160, y: 120 }, { x: 140, y: 140 }], box, controls.cancel, 10, false), null);
});

test("selection transforms remain finite and inside the canvas across varied drags", () => {
  const limit = 20000,
    source = { x: 4200, y: 7300, w: 875, h: 460 };
  for (let index = 0; index < 200; index++) {
    const dx = Math.sin(index * 1.7) * 30000,
      dy = Math.cos(index * 0.9) * 30000,
      moved = selection.moveBox(source, dx, dy, limit),
      resized = selection.resizeBox(moved, { x: moved.x + (index - 40) * 37, y: moved.y + (180 - index) * 29 }, 24, limit);
    for (const box of [moved, resized]) {
      assert.ok(Object.values(box).every(Number.isFinite));
      assert.ok(box.x >= 0 && box.y >= 0);
      assert.ok(box.x + box.w <= limit + 1e-8);
      assert.ok(box.y + box.h <= limit + 1e-8);
      assert.ok(box.w > 0 && box.h > 0);
    }
  }
});
