"use strict";
// One completion policy and bounded geometry contract for Canvas AI and Agent.
var PenEchoFinishDrawing = (() => {
  const MAX_STROKES = 32, MAX_POINTS = 512, MAX_STROKE_POINTS = 32;
  const policy = "Finish the intended object in place in the same hand-drawn style using native ink and shapes. Make one brief plan: identify the subject and pose, identify all missing structural parts, then choose their anchors. Treat existing ink as fixed geometry. Preserve the existing composition, proportions and level of detail. Complete the object's main silhouette and missing repeated parts, not just the nearest local gap. For a radial or repeated pattern, compare the existing parts around their shared center or axis and fill the clearly missing sectors with matching size, orientation and spacing. Do not extend an already complete stem, mast or handle as a substitute for completing missing petals, hull or base. Add only necessary structural ink; omit decorative background, labels, accessories and new subjects. Start and end connecting strokes at the existing open endpoints and follow their local tangent smoothly. When sourceInk is supplied, use its exact endpoints as anchors and its strokeWidth for the native width. For a rounded contour use smooth with about 5–10 well-spaced on-curve points over its whole span, concentrating points only at real curvature changes; avoid a sparse three-point V-shaped curve or an oversized sag. Prefer ellipse or arc for a genuinely elliptical repeated part; use line for straight edges. Before emitting, mentally combine old and new ink and check that the whole object is complete, repeated parts are balanced, joints connect, proportions fit and no existing ink is traced. Do this check once; revisit the plan only for a specific geometry error. Return only the missing marks, at most 48 items, without moving, erasing or redrawing existing strokes. Do not create a separate illustration or replace the drawing with HTML. If sourceInk is absent, estimate anchors and width from the image. sourceInk contains only available sampled strokes, not a complete inventory; the image remains authoritative for the subject and all visible ink.";
  const canvasPrompt = `${policy} Use one draw command with a common global integer origin and integer relative coordinates. Native closed, fill and arrows are arrays of item indices, never booleans; omit unused optional fields.`;
  const agentPrompt = `${policy} Use the native drawing tool in Canvas world coordinates and follow its actual schema. Verify the combined figure after drawing, then stop.`;
  const validBox = box => box && [box.x, box.y, box.w, box.h].every(Number.isFinite) && box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0 && box.x + box.w <= 20000 && box.y + box.h <= 20000;
  const inside = (point, box) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
    && point[0] >= box.x && point[0] <= box.x + box.w && point[1] >= box.y && point[1] <= box.y + box.h;

  // Retain endpoints and their adjacent distinct samples. Refine the greatest
  // deviation first so sharp corners survive a long stroke's point budget.
  function samplePoints(points, limit) {
    const unique = points.filter((point, index) => !index || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]);
    if (unique.length <= limit) return unique.map(point => [...point]);
    const indexes = [0, 1, unique.length - 2, unique.length - 1];
    while (indexes.length < limit) {
      let best = -1, error = 0.75 ** 2;
      for (let span = 1; span < indexes.length; span++) {
        const start = unique[indexes[span - 1]], end = unique[indexes[span]], dx = end[0] - start[0], dy = end[1] - start[1], length = dx * dx + dy * dy;
        for (let index = indexes[span - 1] + 1; index < indexes[span]; index++) {
          const point = unique[index], ratio = length ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length)) : 0,
            distance = (point[0] - start[0] - ratio * dx) ** 2 + (point[1] - start[1] - ratio * dy) ** 2;
          if (distance > error) { error = distance; best = index; }
        }
      }
      if (best < 0) break;
      indexes.push(best); indexes.sort((a, b) => a - b);
    }
    return indexes.map(index => [...unique[index]]);
  }
  function canonicalInk(value, scope) {
    if (value === undefined || value === null) return null;
    if (!validBox(scope) || !value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some(key => !["coordinateSpace", "strokeWidth", "strokes"].includes(key))
      || value.coordinateSpace !== "canvas-world" || !Number.isInteger(value.strokeWidth) || value.strokeWidth < 2 || value.strokeWidth > 200
      || !Array.isArray(value.strokes) || !value.strokes.length || value.strokes.length > MAX_STROKES) return false;
    let count = 0;
    const strokes = [];
    for (const stroke of value.strokes) {
      if (!stroke || typeof stroke !== "object" || Array.isArray(stroke) || Object.keys(stroke).some(key => !["width", "points"].includes(key))
        || !Number.isFinite(stroke.width) || stroke.width <= 0 || stroke.width > 200 || !Array.isArray(stroke.points)
        || stroke.points.length < 2 || stroke.points.length > MAX_STROKE_POINTS || !stroke.points.every(point => inside(point, scope))) return false;
      count += stroke.points.length;
      if (count > MAX_POINTS) return false;
      strokes.push({ width:stroke.width, points:stroke.points.map(point => [...point]) });
    }
    return { coordinateSpace:"canvas-world", strokeWidth:value.strokeWidth, strokes };
  }
  function sourceInk(records, scope) {
    if (!validBox(scope) || !Array.isArray(records)) return null;
    // Never clip a crossing stroke: a clipped endpoint would be a false anchor.
    const eligible = records.filter(record => Number.isFinite(record?.size) && record.size > 0 && record.size <= 200
      && Array.isArray(record.points) && record.points.length >= 2
      && record.points.every(point => inside([point?.x, point?.y], scope))).slice(-MAX_STROKES);
    if (!eligible.length) return null;
    const limit = Math.min(MAX_STROKE_POINTS, Math.floor(MAX_POINTS / eligible.length)),
      strokes = eligible.map(record => ({ width:record.size, points:samplePoints(record.points.map(point => [point.x, point.y]), limit) })).filter(stroke => stroke.points.length >= 2),
      widths = strokes.map(stroke => stroke.width).sort((a, b) => a - b);
    if (!strokes.length) return null;
    return canonicalInk({ coordinateSpace:"canvas-world", strokeWidth:Math.max(2, Math.min(200, Math.round(widths[Math.floor(widths.length / 2)]))), strokes }, scope);
  }
  return Object.freeze({ canvasPrompt, agentPrompt, canonicalInk, sourceInk, MAX_STROKES, MAX_POINTS, MAX_STROKE_POINTS });
})();
if (typeof module === "object" && module.exports) module.exports = PenEchoFinishDrawing;
