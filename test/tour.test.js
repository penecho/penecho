"use strict";
require("./helpers/safety.js");

const test = require("node:test");
const assert = require("node:assert/strict");
const tour = require("../public/tour.js");

test("tour progress tolerates malformed storage and preserves stable seen ids", () => {
  assert.deepEqual(tour.parseProgress(null), { schema: 1, seen: [] });
  assert.deepEqual(tour.parseProgress("not json"), { schema: 1, seen: [] });
  assert.deepEqual(tour.parseProgress('{"schema":99,"seen":["effort-v1","effort-v1",7,""]}'), { schema: 1, seen: ["effort-v1"] });
  const marked = tour.markSeen({ seen: ["effort-v1"] }, ["lasso-v1"]);
  assert.deepEqual(marked, { schema: 1, seen: ["effort-v1", "lasso-v1"] });
  assert.deepEqual(tour.parseProgress(tour.serializeProgress(marked)), marked);

  const saturated = { seen: Array.from({ length: 512 }, (_, index) => `old-${index}`) },
    refreshed = tour.markSeen(saturated, ["core-effort-v1", "core-lasso-v1"]);
  assert.equal(refreshed.seen.length, 512);
  assert.ok(refreshed.seen.includes("core-effort-v1"));
  assert.ok(refreshed.seen.includes("core-lasso-v1"));
  assert.equal(refreshed.seen.includes("old-0"), false);
  assert.equal(refreshed.seen.includes("old-1"), false);
  assert.deepEqual(tour.unseenSteps([{ id: "core-effort-v1" }, { id: "core-lasso-v1" }], refreshed), []);

  const coreIds = Array.from({ length: 8 }, (_, index) => `core-${index}`),
    batch = tour.markSeen({ seen: Array.from({ length: 511 }, (_, index) => `legacy-${index}`) }, coreIds);
  assert.equal(batch.seen.length, 512);
  assert.ok(coreIds.every((id) => batch.seen.includes(id)));
});

test("unseen tour steps support first visit, replay, and independent future features", () => {
  const steps = [{ id: "effort-v1" }, { id: "lasso-v1" }, { id: "future-feature-v2" }],
    progress = { seen: ["effort-v1", "lasso-v1"] };
  assert.deepEqual(tour.unseenSteps(steps, { seen: [] }).map((step) => step.id), ["effort-v1", "lasso-v1", "future-feature-v2"]);
  assert.deepEqual(tour.unseenSteps(steps, progress).map((step) => step.id), ["future-feature-v2"]);
  assert.deepEqual(tour.unseenSteps(steps, progress, true).map((step) => step.id), ["effort-v1", "lasso-v1", "future-feature-v2"]);

  const shown = tour.markSeen({ seen: [] }, ["lasso-v1"]),
    skippedAfterDynamicInsert = tour.markSeen(shown, ["effort-v1", "lasso-v1"]);
  assert.deepEqual(tour.unseenSteps(steps, skippedAfterDynamicInsert).map((step) => step.id), ["future-feature-v2"]);
});

test("initial language respects valid storage and otherwise defaults to English", () => {
  assert.equal(tour.resolveInitialLanguage(null, null), "en");
  assert.equal(tour.resolveInitialLanguage("en", "zh"), "en");
  assert.equal(tour.resolveInitialLanguage("zh", null), "zh");
  assert.equal(tour.resolveInitialLanguage("bad", "zh"), "zh");
  assert.equal(tour.resolveInitialLanguage("bad", "bad"), "en");
});

test("tour target rectangles combine grouped controls", () => {
  assert.deepEqual(
    tour.unionRects([
      { left: 120, top: 20, width: 30, height: 28 },
      { left: 154, top: 18, width: 30, height: 32 },
      { left: 188, top: 20, width: 30, height: 28 },
    ]),
    { left: 120, top: 18, right: 218, bottom: 50, width: 98, height: 32 },
  );
  assert.equal(tour.unionRects([]), null);
  assert.equal(tour.rectHasArea({ left: 10, top: 10, width: 0, height: 20 }), false);
  assert.equal(tour.rectHasArea({ left: 10, top: 10, width: 20, height: 0 }), false);
  assert.equal(tour.rectHasArea({ left: -500, top: 20, width: 40, height: 30 }), true);
});

test("coachmarks flip and clamp inside the visual viewport", () => {
  const viewport = { left: 0, top: 0, width: 800, height: 600 },
    card = { width: 240, height: 140 },
    below = tour.placeCoachmark({ left: 300, top: 80, width: 120, height: 40 }, card, viewport, "bottom", { margin: 12, gap: 12 }),
    above = tour.placeCoachmark({ left: 300, top: 530, width: 120, height: 40 }, card, viewport, "bottom", { margin: 12, gap: 12 }),
    rightEdge = tour.placeCoachmark({ left: 750, top: 80, width: 50, height: 40 }, card, viewport, "bottom", { margin: 12, gap: 12 });
  assert.deepEqual(below, { x: 240, y: 132, placement: "bottom", arrowOffset: 120 });
  assert.deepEqual(above, { x: 240, y: 378, placement: "top", arrowOffset: 120 });
  assert.equal(rightEdge.x, 548);
  assert.ok(rightEdge.arrowOffset >= 22 && rightEdge.arrowOffset <= card.width - 22);
  const narrow = tour.placeCoachmark({ left: 285, top: 210, width: 25, height: 30 }, { width: 290, height: 180 }, { left: 0, top: 0, width: 320, height: 480 }, "right", { margin: 12, gap: 12 });
  assert.ok(narrow.x >= 12 && narrow.y >= 12);
  assert.ok(narrow.x + 290 <= 308 && narrow.y + 180 <= 468);
  const offsetViewport = tour.placeCoachmark(
    { left: 110, top: 200, width: 40, height: 30 },
    { width: 300, height: 180 },
    { left: 96, top: 180, width: 360, height: 420 },
    "bottom",
    { margin: 12, gap: 12 },
  );
  assert.deepEqual(offsetViewport, { x: 108, y: 242, placement: "bottom", arrowOffset: 22 });
  assert.ok(offsetViewport.x >= 108 && offsetViewport.x + 300 <= 444);
  assert.ok(offsetViewport.y >= 192 && offsetViewport.y + 180 <= 588);
});

test("tour keyboard actions ignore composition and modified shortcuts", () => {
  assert.equal(tour.keyAction({ key: "Escape" }), "skip");
  assert.equal(tour.keyAction({ key: "ArrowRight" }), "next");
  assert.equal(tour.keyAction({ key: "Enter" }), "next");
  assert.equal(tour.keyAction({ key: "ArrowLeft" }), "back");
  assert.equal(tour.keyAction({ key: "ArrowRight", isComposing: true }), null);
  assert.equal(tour.keyAction({ key: "ArrowRight", ctrlKey: true }), null);
});
