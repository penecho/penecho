"use strict";
require("./helpers/safety.js");

const assert = require("node:assert/strict");
const test = require("node:test");
const ANIMATION = require("../public/animation.js");

function solarSystem() {
  return {
    tool: "animate_scene",
    x: 5000,
    y: 4000,
    w: 1800,
    h: 1200,
    durationMs: 12000,
    loop: true,
    objects: [
      { id: "sun", type: "circle", cx: 900, cy: 600, r: 90, fill: "#f59e0b" },
      { id: "earth", type: "circle", cx: 1330, cy: 600, r: 28, fill: "#2563eb" },
    ],
    motions: [
      { type: "orbit", target: "earth", center: "sun", rx: 430, ry: 180, periodMs: 12000 },
      { type: "spin", target: "sun", periodMs: 5000 },
    ],
  };
}

function fakeCanvas(width, height) {
  const calls = [];
  const context = new Proxy(
    { calls, globalAlpha: 1 },
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

test("normalizes a compact declarative animation scene", () => {
  const scene = ANIMATION.normalize(solarSystem());
  assert.ok(scene);
  assert.equal(scene.tool, "animate_scene");
  assert.equal(scene.objects.length, 2);
  assert.equal(scene.motions.length, 2);
  assert.equal(scene.dynamicObjectCount, 2);
  assert.equal(scene.objects[0].fill, "#f59e0b");
});

test("forces animation scenes and serialized snapshots to keep a transparent background", () => {
  const scene = ANIMATION.normalize({ ...solarSystem(), background: "#000000" }),
    saved = ANIMATION.serialize({ ...scene, background: "black" }),
    canvas = fakeCanvas(1800, 1200);
  assert.equal(Object.hasOwn(scene, "background"), false);
  assert.equal(Object.hasOwn(saved, "background"), false);
  ANIMATION.render(canvas.getContext("2d"), { ...scene, background: "black" });
  assert.equal(canvas.calls.some(([name]) => name === "fillRect"), false);
});

test("rejects executable or oversized animation data", () => {
  assert.equal(ANIMATION.normalize({ ...solarSystem(), javascript: "alert(1)", objects: [] }), null);
  assert.equal(ANIMATION.normalize({ ...solarSystem(), w: 7000 }), null);
  assert.equal(ANIMATION.MAX_OBJECTS, 32);
  assert.equal(ANIMATION.MAX_MOTIONS, 32);
  assert.equal(ANIMATION.normalize({ ...solarSystem(), objects: Array.from({ length: 33 }, (_, index) => ({ id: "o" + index, type: "circle", cx: 10, cy: 10, r: 2 })) }), null);
  assert.equal(ANIMATION.normalize({ ...solarSystem(), motions: Array.from({ length: 33 }, () => ({ type: "spin", target: "sun", periodMs: 1000 })) }), null);
  assert.equal(ANIMATION.normalize({ ...solarSystem(), motions: [{ type: "orbit", target: "missing", center: "sun", rx: 10, ry: 10 }] }), null);
  assert.equal(ANIMATION.normalize({ ...solarSystem(), motions: [] }), null);
});

test("computes orbit positions directly from the playhead", () => {
  const scene = ANIMATION.normalize(solarSystem()),
    start = ANIMATION.animationStates(scene, 0).get("earth"),
    quarter = ANIMATION.animationStates(scene, 3000).get("earth");
  assert.ok(Math.abs(start.dx) < 1e-9);
  assert.ok(Math.abs(start.dy) < 1e-9);
  assert.ok(Math.abs(quarter.dx + 430) < 1e-9);
  assert.ok(Math.abs(quarter.dy - 180) < 1e-9);
});

test("raster preview keeps logical dimensions while respecting pixel limits", () => {
  let canvas;
  const scene = ANIMATION.normalize(solarSystem()),
    image = ANIMATION.rasterize(scene, (width, height) => (canvas = fakeCanvas(width, height)), 1500, 2);
  assert.ok(image);
  assert.equal(image.logicalWidth, 1800);
  assert.equal(image.logicalHeight, 1200);
  assert.ok(image.width <= 2048);
  assert.ok(image.height <= 1536);
  assert.ok(canvas.calls.some(([name]) => name === "arc"));
  assert.ok(canvas.calls.some(([name]) => name === "setTransform"));
});

test("rejects duplicate ownership and cyclic animation groups", () => {
  const dot = { id: "dot", type: "circle", cx: 20, cy: 20, r: 5 };
  assert.equal(ANIMATION.normalize({ ...solarSystem(), objects: [{ id: "group", type: "group", children: ["dot", "dot"] }, dot], motions: [] }), null);
  assert.equal(
    ANIMATION.normalize({
      ...solarSystem(),
      objects: [
        { id: "a", type: "group", children: ["b"] },
        { id: "b", type: "group", children: ["a"] },
      ],
      motions: [],
    }),
    null,
  );
});

test("non-looping keyframes hold their final state", () => {
  const scene = ANIMATION.normalize({
    tool: "animate_scene",
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    durationMs: 1000,
    loop: false,
    objects: [{ id: "dot", type: "circle", cx: 20, cy: 20, r: 5 }],
    motions: [{ type: "keyframes", target: "dot", periodMs: 1000, frames: [{ at: 0, x: 0 }, { at: 1, x: 100 }] }],
  });
  assert.equal(ANIMATION.animationStates(scene, 1000).get("dot").dx, 100);
  assert.equal(ANIMATION.animationStates(scene, 1500).get("dot").dx, 100);
});

test("serialized scenes contain data only and can be normalized again", () => {
  const scene = ANIMATION.normalize(solarSystem()),
    saved = ANIMATION.serialize(scene);
  assert.equal(saved.dynamicObjectCount, undefined);
  assert.doesNotThrow(() => JSON.stringify(saved));
  assert.ok(ANIMATION.normalize(saved));
});
