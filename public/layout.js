"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PENECHO_LAYOUT = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const MAX_PASSES = 100;

  function validRect(rect) {
    return (
      rect &&
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.w) &&
      Number.isFinite(rect.h) &&
      rect.w > 0 &&
      rect.h > 0
    );
  }

  function overlaps(x, y, w, h, prior) {
    const horizontal = Math.min(x + w, prior.x + prior.w) - Math.max(x, prior.x),
      vertical = Math.min(y + h, prior.y + prior.h) - Math.max(y, prior.y);
    return horizontal > 0 && vertical > 0;
  }

  // Flow the given items downward past every obstacle they collide with.
  // `flow` is an array of {x, y, w, h} in the order the caller wants them
  // placed (earlier items become obstacles for later ones); `obstacles` are
  // fixed rectangles that never move (other draft items, existing ink,
  // images). Returns one adjusted y per flow item, in input order. Items are
  // normally moved only downward, so deliberate placement in blank space is
  // preserved. When the canvas bottom blocks that route, the nearest clear
  // position above the request is used instead.
  function resolveFlowOverlaps({ flow = [], obstacles = [], gap = 0, maxY = Infinity }) {
    const fixed = obstacles.filter(validRect),
      placed = [],
      result = [];
    for (const item of flow) {
      const blockers = [...fixed, ...placed],
        maxTop = Math.max(0, maxY - item.h),
        requestedY = Math.max(0, Math.min(maxTop, item.y));
      let y = requestedY;
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        const collisions = blockers.filter((prior) => overlaps(item.x, y, item.w, item.h, prior));
        if (!collisions.length) break;
        const next = Math.max(...collisions.map((prior) => prior.y + prior.h)) + gap;
        if (next <= y) break;
        y = next;
      }
      if (y > maxTop) {
        const candidates = blockers
          .filter((prior) => Math.min(item.x + item.w, prior.x + prior.w) > Math.max(item.x, prior.x))
          .map((prior) => prior.y - gap - item.h)
          .filter((candidate) => candidate >= 0 && candidate <= requestedY)
          .sort((a, b) => b - a);
        const fallback = candidates.find(
          (candidate) => !blockers.some((prior) => overlaps(item.x, candidate, item.w, item.h, prior)),
        );
        y = fallback === undefined ? maxTop : fallback;
      }
      placed.push({ x: item.x, y, w: item.w, h: item.h });
      result.push(y);
    }
    return result;
  }

  return { resolveFlowOverlaps };
});
