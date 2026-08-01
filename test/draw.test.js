"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const DRAW = require("../public/draw.js");

function fakeCanvas(width, height) {
  const calls = [];
  const context = new Proxy(
    { calls },
    {
      get(target, property) {
        if (property in target) return target[property];
        return (...args) => calls.push([property, ...args]);
      },
      set(target, property, value) {
        target[property] = value;
        return true;
      },
    },
  );
  return { width, height, calls, getContext: () => context };
}

test("normalizes a mixed drawing into one union draft", () => {
  const command = DRAW.normalize({
    tool: "draw",
    origin: [1000, 1000],
    types: ["line", "smooth", "rect", "ellipse", "circle", "arc"],
    items: [
      [0, 0, 100, 0, 100, 100],
      [200, 100, 250, 0, 300, 100],
      [400, 0, 80, 40],
      [600, 40, 60, 30],
      [800, 40, 30],
      [1000, 100, 80, 40, 180, 90],
    ],
    closed: [0],
    fill: [0, 2],
    arrows: [1, 5],
    width: 20,
    tension: 40,
  });

  assert.ok(command);
  assert.equal(command.tool, "draw");
  assert.deepEqual(command.types, ["line", "smooth", "rect", "ellipse", "circle", "arc"]);
  assert.deepEqual(command.closed, [0]);
  assert.deepEqual(command.fill, [0, 2]);
  assert.deepEqual(command.arrows, [1, 5]);
  assert.equal(command._draw.primitives.length, 6);
  assert.ok(command.x < 1000);
  assert.ok(command.y < 1000);
  assert.ok(command._draw.bounds.right > 2000);
  assert.ok(command._draw.bounds.bottom > 1100);
});

test("uses the swept arc rather than a full ellipse for bounds", () => {
  const command = DRAW.normalize({ tool: "draw", origin: [1000, 1000], types: ["arc"], items: [[0, 0, 100, 50, 0, 90]] });
  assert.ok(command);
  assert.deepEqual(command._draw.bounds, { x: 981, y: 981, right: 1119, bottom: 1069, w: 138, h: 88 });
});

test("rejects malformed, fractional, incompatible, and out-of-canvas data", () => {
  assert.equal(DRAW.normalize({ tool: "draw", origin: [0.5, 0], types: ["line"], items: [[0, 0, 10, 10]] }), null);
  assert.equal(DRAW.normalize({ tool: "draw", origin: [0, 0], types: ["line"], items: [[0, 0, 10.5, 10]] }), null);
  assert.equal(DRAW.normalize({ tool: "draw", origin: [0, 0], types: ["line", "rect"], items: [[0, 0, 10, 10]] }), null);
  assert.equal(DRAW.normalize({ tool: "draw", origin: [100, 100], types: ["line"], items: [[0, 0, 10, 10]], fill: [0] }), null);
  assert.equal(DRAW.normalize({ tool: "draw", origin: [100, 100], types: ["circle"], items: [[0, 0, 20]], arrows: [0] }), null);
  assert.equal(DRAW.normalize({ tool: "draw", origin: [10, 10], types: ["circle"], items: [[0, 0, 20]] }), null);
  assert.equal(DRAW.normalize({ tool: "draw", origin: [100, 100], types: ["smooth"], items: [[0, 0, 0, 0, 0, 0]], arrows: [0], tension: 0 }), null);
  assert.ok(DRAW.normalize({ tool: "draw", origin: [100, 100], types: ["rect"], items: [[0, 0, 4000, 4000]] }));
});

test("renders mixed primitives and preserves logical size when rasterized smaller", () => {
  const created = [];
  const command = DRAW.normalize({
    tool: "draw",
    origin: [100, 100],
    types: ["smooth", "rect", "ellipse", "circle", "arc"],
    items: [
      [0, 0, 2000, 1800, 5000, 0],
      [0, 0, 5000, 2000],
      [2500, 1000, 500, 400],
      [4000, 600, 250],
      [2500, 1000, 1000, 500, 0, 180],
    ],
    fill: [1, 2],
    arrows: [0, 4],
  });
  const made = DRAW.render(command, (width, height) => {
    const canvas = fakeCanvas(width, height);
    created.push(canvas);
    return canvas;
  });

  assert.ok(made);
  assert.equal(created.length, 1);
  assert.ok(made.image.width <= 4096);
  assert.ok(made.image.height <= 4096);
  assert.ok(made.image.width * made.image.height <= 12000000);
  assert.ok(made.image.logicalWidth > made.image.width);
  assert.ok(made.image.logicalHeight > made.image.height);
  assert.ok(created[0].calls.some(([name]) => name === "bezierCurveTo"));
  assert.ok(created[0].calls.some(([name]) => name === "rect"));
  assert.ok(created[0].calls.some(([name]) => name === "ellipse"));
  assert.ok(created[0].calls.some(([name]) => name === "fill"));
  assert.ok(created[0].calls.some(([name]) => name === "stroke"));
});

test("uses independent raster transforms so extreme aspect ratios preserve geometry", () => {
  let canvas;
  const command = DRAW.normalize({ tool: "draw", origin: [100, 100], types: ["line"], items: [[0, 0, 19800, 0]] });
  const made = DRAW.render(command, (width, height) => (canvas = fakeCanvas(width, height)));
  const transform = canvas.calls.find(([name]) => name === "setTransform");

  assert.ok(made);
  assert.ok(made.image.logicalWidth > made.image.width);
  assert.equal(transform[1], made.image.width / made.image.logicalWidth);
  assert.equal(transform[4], made.image.height / made.image.logicalHeight);
  assert.notEqual(transform[1], transform[4]);
});

test("finds a nonzero terminal direction for zero-tension smooth arrows", () => {
  const command = DRAW.normalize({
    tool: "draw",
    origin: [100, 100],
    types: ["smooth"],
    items: [[0, 0, 0, 100, 0, 200]],
    arrows: [0],
    tension: 0,
  });
  const arrow = command._draw.primitives[0].arrowPoints;

  assert.ok(command);
  assert.equal(arrow[0].x, 100);
  assert.equal(arrow[0].y, 300);
  assert.ok(arrow[1].y < arrow[0].y);
  assert.ok(arrow[2].y < arrow[0].y);
});

test("accepts large in-canvas drawings without an aggregate destination budget", () => {
  const wide = DRAW.normalize({ tool: "draw", origin: [100, 100], types: ["line"], items: [[0, 0, 19800, 0]] });
  const tall = DRAW.normalize({ tool: "draw", origin: [100, 100], types: ["line"], items: [[0, 0, 0, 10000]] });
  const large = DRAW.normalize({ tool: "draw", origin: [100, 100], types: ["rect"], items: [[0, 0, 19800, 19800]] });

  assert.ok(wide);
  assert.ok(tall);
  assert.ok(large);
  assert.ok(large._draw.bounds.w * large._draw.bounds.h > 300000000);
});
