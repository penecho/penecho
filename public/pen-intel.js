// PenEcho pen intelligence: pure, deterministic helpers shared by the Canvas
// and tests. Nothing here talks to the network. PenEchoLLM (Cloud) answers the
// visual questions; these helpers decide locally what to do with the answers.
//
//   1. Pen gestures      — local shape fit proposes a command mark.
//   2. Step checker      — flag a doubtful derivation line (suggestion only).
//   3. Canvas index      — labels, synonyms, sketch vectors and search ranking.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PENECHO_PEN_INTEL = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  // ---------- Geometry ----------
  function bounds(points) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of points || []) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
    return Number.isFinite(x0) ? { x:x0, y:y0, w:x1 - x0, h:y1 - y0 } : null;
  }
  function union(a, b) {
    if (!a) return b ? { ...b } : null;
    if (!b) return { ...a };
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w:Math.max(a.x + a.w, b.x + b.w) - x, h:Math.max(a.y + a.h, b.y + b.h) - y };
  }
  function overlap(a, b) {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), r = Math.min(a.x + a.w, b.x + b.w), btm = Math.min(a.y + a.h, b.y + b.h);
    return r > x && btm > y ? { x, y, w:r - x, h:btm - y } : null;
  }
  function inflate(box, dx, dy = dx) { return { x:box.x - dx, y:box.y - dy, w:box.w + dx * 2, h:box.h + dy * 2 }; }
  function pathLength(points) {
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    return length;
  }
  // Bound pairwise geometry work independently of device sampling frequency.
  function gestureSamples(points, limit = 96) {
    if (points.length <= limit) return points;
    return Array.from({ length:limit }, (_, i) => points[Math.round(i * (points.length - 1) / (limit - 1))]);
  }
  function deletionMarkShape(points, size = 4) {
    if (!points || points.length < 2) return null;
    points = gestureSamples(points);
    const box = bounds(points), line = lineFit(points), angle = Math.abs(((line.angle % 180) + 180) % 180);
    if (box.w < Math.max(28, size * 7)) return null;
    if (line.straightness >= 0.86 && Math.min(angle, 180 - angle) <= 35) return "strike";
    return reversals(points) >= 4 && pathLength(points) >= Math.hypot(box.w, box.h) * 2.5 ? "scribble" : null;
  }
  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y || 1e-9) + a.x) inside = !inside;
    }
    return inside;
  }
  // Direction reversals along the dominant axis: a zigzag scribble has many.
  function reversals(points) {
    const box = bounds(points);
    if (!box) return 0;
    const horizontal = box.w >= box.h, step = Math.max(2, Math.max(box.w, box.h) * 0.04);
    let count = 0, last = 0, anchor = points[0];
    for (const point of points) {
      const delta = horizontal ? point.x - anchor.x : point.y - anchor.y;
      if (Math.abs(delta) < step) continue;
      const sign = Math.sign(delta);
      if (last && sign !== last) count++;
      last = sign;
      anchor = point;
    }
    return count;
  }
  // A single straight segment: chord / path length, and its angle in degrees.
  function lineFit(points) {
    const first = points[0], last = points.at(-1), chord = Math.hypot(last.x - first.x, last.y - first.y), length = pathLength(points);
    return { straightness:length ? chord / length : 0, angle:Math.atan2(last.y - first.y, last.x - first.x) * 180 / Math.PI, chord, from:first, to:last };
  }
  // An L-shaped stroke (small axes): two straight legs meeting near 90°.
  function cornerFit(points) {
    if (points.length < 6) return null;
    const first = points[0], last = points.at(-1);
    let best = -1, index = -1;
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i], d = Math.abs((last.y - first.y) * p.x - (last.x - first.x) * p.y + last.x * first.y - last.y * first.x) / (Math.hypot(last.x - first.x, last.y - first.y) || 1);
      if (d > best) { best = d; index = i; }
    }
    if (index < 2 || index > points.length - 3) return null;
    const a = lineFit(points.slice(0, index + 1)), b = lineFit(points.slice(index));
    if (a.straightness < 0.9 || b.straightness < 0.9) return null;
    const turn = Math.abs(((b.angle - a.angle + 540) % 360) - 180);
    return { corner:points[index], legs:[a, b], turn };
  }

  // Distance from a point to a segment.
  function segmentDistance(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  function segmentsCross(a, b, c, d) {
    const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
    return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
  }
  // True when two polylines cross or pass within `tolerance` of each other.
  function polylinesTouch(first, second, tolerance) {
    first = gestureSamples(first); second = gestureSamples(second);
    for (let i = 1; i < first.length; i++) for (let j = 1; j < second.length; j++) if (segmentsCross(first[i - 1], first[i], second[j - 1], second[j])) return true;
    const near = (points, other) => points.some(point => { for (let j = 1; j < other.length; j++) if (segmentDistance(point, other[j - 1], other[j]) <= tolerance) return true; return other.length === 1 && Math.hypot(point.x - other[0].x, point.y - other[0].y) <= tolerance; });
    return near(first, second) || near(second, first);
  }
  // After Delete is confirmed, remove the full connected stroke component.
  // Follow real segment/endpoint contact, including ink width, beyond the
  // recognition mark's bounds. Bounding-box proximity alone is insufficient.
  function connectedStrokes(seeds, strokes) {
    const valid = stroke => stroke?.points?.length && stroke.box,
      available = (strokes || []).filter(valid), selected = new Set((seeds || []).filter(valid)), queue = [...selected];
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      for (const stroke of available) {
        if (selected.has(stroke)) continue;
        const tolerance = (Math.max(0.5, Number(current.size) || 4) + Math.max(0.5, Number(stroke.size) || 4)) / 2 + 0.5;
        if (overlap(inflate(current.box, tolerance), inflate(stroke.box, tolerance)) && polylinesTouch(current.points, stroke.points, tolerance)) {
          selected.add(stroke); queue.push(stroke);
        }
      }
    }
    return available.filter(stroke => selected.has(stroke));
  }
  // Whole earlier strokes that a strike or scribble actually crosses, plus a
  // limited one-step expansion to the rest of the same letters (the hump of an
  // h written as a second stroke, the dot of an i). It never chains outward,
  // never takes strokes outside the mark's horizontal span, and never takes a
  // stroke far taller than the crossed writing.
  function strokesUnderMark(markPoints, strokes, options) {
    options ||= {};
    markPoints = gestureSamples(markPoints);
    const tolerance = Math.max(0.5, Number(options.tolerance) || 4), markBox = bounds(markPoints), scribble = options.scribble === true;
    if (!markBox || markPoints.length < 2) return [];
    const line = lineFit(markPoints);
    const span = Math.max(markBox.w, tolerance), candidates = (strokes || []).filter(stroke => stroke?.points?.length && stroke.box
      && stroke.box.h <= span * 0.9 && stroke.box.w <= span * 1.3
      && overlap(inflate(stroke.box, tolerance), inflate(markBox, tolerance)));
    // Proximity alone confuses underlines with strikes. A straight cancellation
    // must pass through the interior of a stroke, with substantial ink on BOTH
    // sides of its axis. Distances use geometry, not the number of pen samples.
    const crossesInterior = stroke => {
      if (scribble) return true;
      const dx = (line.to.x - line.from.x) / line.chord, dy = (line.to.y - line.from.y) / line.chord;
      let low = Infinity, high = -Infinity;
      for (const p of gestureSamples(stroke.points)) {
        const distance = (p.y - line.from.y) * dx - (p.x - line.from.x) * dy;
        low = Math.min(low, distance); high = Math.max(high, distance);
      }
      const depth = Math.max(tolerance * 0.65, (high - low) * 0.16);
      return low <= -depth && high >= depth;
    };
    const crossed = candidates.filter(stroke => crossesInterior(stroke) && polylinesTouch(markPoints, stroke.points, tolerance));
    if (!crossed.length) return [];
    const heights = crossed.map(stroke => stroke.box.h).sort((a, b) => a - b), median = heights[Math.floor(heights.length / 2)] || 1;
    const spanX0 = markBox.x - tolerance, spanX1 = markBox.x + markBox.w + tolerance, reach = Math.max(tolerance, median * 0.2),
      ids = new Set(crossed.map(stroke => stroke.id));
    for (const stroke of candidates.length ? strokes : []) {
      if (ids.has(stroke.id) || !stroke?.box) continue;
      const cx = stroke.box.x + stroke.box.w / 2;
      if (cx < spanX0 || cx > spanX1 || stroke.box.h > Math.min(median * 2.5, span * 0.9) || stroke.box.w > span * 1.3) continue;
      // Only complete the same glyph, not another nearby word or row.
      if (crossed.some(item => stroke.box.x <= item.box.x + item.box.w + tolerance && stroke.box.x + stroke.box.w >= item.box.x - tolerance
        && overlap(inflate(item.box, tolerance, reach), inflate(stroke.box, 0.5)))) ids.add(stroke.id);
    }
    return (strokes || []).filter(stroke => ids.has(stroke.id));
  }

  // Connected components of ink BEFORE the mark. A fraction has separate ink
  // above/below; a strike crosses a component's interior. Transparent pixels
  // and the new mark itself must not be passed as target ink.
  function rasterDeletionTarget(data, width, height, region, points, size) {
    if (!data || !width || !height || width * height > 32768 || points.length < 2) return null;
    points = gestureSamples(points, 48);
    const line = lineFit(points), box = bounds(points), scribble = reversals(points) >= 4 && pathLength(points) >= Math.hypot(box.w, box.h) * 2.5,
      angle = Math.abs(((line.angle % 180) + 180) % 180);
    if (!scribble && (line.straightness < 0.86 || Math.min(angle, 180 - angle) > 35 || line.chord < Math.max(28, size * 7))) return null;
    const seen = new Uint8Array(width * height), queue = new Int32Array(width * height), dx = (line.to.x - line.from.x) / (line.chord || 1), dy = (line.to.y - line.from.y) / (line.chord || 1),
      sx = region.w / width, sy = region.h / height, tolerance = Math.max(size * 0.6, sx, sy);
    // Rasterize the scribble once. Component traversal stays linear in pixels,
    // rather than comparing every pixel with every segment of a dense stroke.
    const mark = scribble ? new Uint8Array(width * height) : null;
    if (mark) for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], steps = Math.ceil(Math.max(Math.abs(b.x - a.x) / sx, Math.abs(b.y - a.y) / sy));
      for (let step = 0; step <= steps; step++) {
        const x = Math.floor((a.x + (b.x - a.x) * step / (steps || 1) - region.x) / sx), y = Math.floor((a.y + (b.y - a.y) * step / (steps || 1) - region.y) / sy);
        for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) mark[yy * width + xx] = 1;
      }
    }
    const mask = new Uint8Array(width * height);
    let target = null, components = 0, writing = false;
    for (let start = 0; start < seen.length; start++) {
      if (seen[start] || data[start * 4 + 3] <= 40) continue;
      let head = 0, tail = 1, x0 = width, y0 = height, x1 = 0, y1 = 0, low = Infinity, high = -Infinity, touches = 0;
      queue[0] = start; seen[start] = 1;
      while (head < tail) {
        const index = queue[head++], x = index % width, y = Math.floor(index / width), p = { x:region.x + (x + 0.5) * sx, y:region.y + (y + 0.5) * sy };
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        const signed = (p.y - line.from.y) * dx - (p.x - line.from.x) * dy;
        low = Math.min(low, signed); high = Math.max(high, signed);
        const along = (p.x - line.from.x) * dx + (p.y - line.from.y) * dy;
        if (mark ? mark[index] : Math.abs(signed) <= tolerance && along >= 0 && along <= line.chord) touches++;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
          const next = yy * width + xx;
          if (!seen[next] && data[next * 4 + 3] > 40) { seen[next] = 1; queue[tail++] = next; }
        }
      }
      const component = { x:region.x + x0 * sx, y:region.y + y0 * sy, w:(x1 - x0 + 1) * sx, h:(y1 - y0 + 1) * sy }, depth = Math.max(tolerance, (high - low) * 0.16);
      // A component clipped by the sampling window may be a frame/divider.
      if (x0 === 0 || y0 === 0 || x1 === width - 1 || y1 === height - 1 || touches < 2 || tail * sx * sy < size * size
        || component.h > box.w * 0.9 || component.w > box.w * 1.3 || (!scribble && (low > -depth || high < depth))) continue;
      target = union(target, component);
      // Retain only the crossed components for local deletion. Include their
      // antialiased edges without taking another component inside the union box.
      for (let i = 0; i < tail; i++) {
        const index = queue[i], x = index % width, y = Math.floor(index / width);
        mask[index] = 1;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
          const next = yy * width + xx;
          if (data[next * 4 + 3] <= 40) mask[next] = 1;
        }
      }
      components++;
      writing ||= component.w >= component.h * 0.35 && component.h >= size * 2;
    }
    return target ? { shape:scribble ? "scribble" : "strike", confidence:scribble || writing || components > 1 ? 0.82 : 0.62, box, target, raster:true,
      mask:{ data:mask, width, height, region:{ ...region } } } : null;
  }

  // ---------- 1. Pen gestures ----------
  const GESTURE_SHAPES = Object.freeze(["enclosure", "underline", "double_underline", "strike", "scribble", "arrow", "axes", "question", "check"]);
  const GESTURE_FOLLOW_MS = 900, GESTURE_PAUSE_MS = 700;
  // Classify one finished stroke as a candidate command mark. `probe(box)`
  // returns the fraction (0..1) of the box covered by earlier content;
  // `contentBoxes` lists earlier objects and strokes. Returns null for ink.
  function classifyGestureStroke(points, options) {
    options ||= {};
    points = gestureSamples(points || []);
    const box = bounds(points), size = Math.max(1, Number(options.size) || 4), minSide = Math.max(18, size * 5),
      probe = typeof options.probe === "function" ? options.probe : () => 0,
      now = Number(options.now) || 0, pauseMs = Number.isFinite(options.pauseMs) ? options.pauseMs : GESTURE_PAUSE_MS,
      // A command mark follows a pause: content written moments ago belongs to
      // the same writing (the bottom stroke of 三, the bar of a t), not a target.
      contents = (options.contentBoxes || []).filter(item => item && item.w > 0 && item.h > 0 && (!now || !Number.isFinite(item.at) || now - item.at >= pauseMs)),
      objects = contents.filter(item => !item.stroke && !(options.strokes || []).some(stroke => stroke.box && ["x", "y", "w", "h"].every(key => stroke.box[key] === item[key]))),
      earlierStrokes = (options.strokes || []).filter(stroke => stroke?.points?.length && stroke.box && (!now || !Number.isFinite(stroke.at) || now - stroke.at >= pauseMs)),
      tolerance = Math.max(size * 0.75, Math.min(size * 1.5, Number(options.tolerance) || size)),
      strokeTarget = found => ({ strokeIds:found.map(stroke => stroke.id), target:found.reduce((acc, stroke) => union(acc, stroke.box), null) });
    if (!box || points.length < 2 || Math.max(box.w, box.h) < minSide) return null;
    const length = pathLength(points), diagonal = Math.hypot(box.w, box.h), first = points[0], last = points.at(-1),
      gap = Math.hypot(last.x - first.x, last.y - first.y), line = lineFit(points), flips = reversals(points);
    // Enclosure: a closed loop that surrounds earlier content.
    if (gap <= Math.max(size * 4, diagonal * 0.28) && length >= diagonal * 2 && box.w >= minSide && box.h >= minSide * 0.6 && flips <= 3) {
      const inner = inflate(box, -box.w * 0.14, -box.h * 0.14),
        // A command loop runs around its target; a letter such as e, @ or a
        // spiral runs through its own middle, so its ink is not a target.
        crossing = points.filter(point => ((point.x - box.x - box.w / 2) / (box.w / 2 || 1)) ** 2 + ((point.y - box.y - box.h / 2) / (box.h / 2 || 1)) ** 2 < 0.36).length / points.length,
        enclosed = contents.filter(item => pointInPolygon({ x:item.x + item.w / 2, y:item.y + item.h / 2 }, points) && item.w <= box.w * 1.1 && item.h <= box.h * 1.1),
        density = inner.w > 0 && inner.h > 0 ? probe(inner) : 0;
      if (crossing <= 0.08 && (enclosed.length || density >= 0.015)) {
        const target = enclosed.reduce((acc, item) => union(acc, item), null) || inner;
        return { shape:"enclosure", confidence:Math.min(0.9, 0.55 + (enclosed.length ? 0.2 : 0) + Math.min(0.15, density * 3)), box, target:overlap(target, box) || target };
      }
    }
    // Scribble: many reversals over earlier content.
    if (flips >= 4 && length >= diagonal * 2.5) {
      // Only earlier vector strokes or objects count: the scribble's own raster
      // ink would otherwise make every zigzag letter look like a deletion.
      const under = strokesUnderMark(points, earlierStrokes, { tolerance, scribble:true });
      if (under.length) return { shape:"scribble", confidence:0.88, box, ...strokeTarget(under) };
      const covered = objects.filter(item => overlap(item, box));
      if (covered.length) return { shape:"scribble", confidence:0.6, box, target:covered.reduce((acc, item) => union(acc, overlap(item, box)), null) || box };
    }
    // Straight horizontal marks: underline (content above) or strike (through).
    if (line.straightness >= 0.86 && line.chord >= minSide * 1.4) {
      const angle = Math.abs(((line.angle + 180) % 180 + 180) % 180), flat = Math.min(angle, 180 - angle);
      // A strike deletes the whole strokes it crosses, not a band of pixels.
      const struck = flat <= 35 ? strokesUnderMark(points, earlierStrokes, { tolerance }) : [];
      if (struck.length) {
        const writing = struck.length > 1 || struck.some(stroke => pathLength(gestureSamples(stroke.points)) > Math.max(stroke.box.w, stroke.box.h) * 1.6);
        return { shape:"strike", confidence:writing ? 0.86 : 0.62, box, ...strokeTarget(struck) };
      }
      if (flat <= 14 && line.straightness >= 0.9) {
        const y = (first.y + last.y) / 2, span = { x:box.x, w:box.w }, band = Math.max(size * 3, line.chord * 0.25),
          through = objects.filter(item => item.y + item.h * 0.2 <= y && item.y + item.h * 0.8 >= y && span.w >= item.h * 1.5 && overlap({ x:span.x, y:item.y, w:span.w, h:item.h }, item)?.w >= Math.min(item.w, span.w) * 0.5),
          below = contents.some(item => item.y >= y - size && item.y <= y + band * 0.8 && overlap({ x:span.x, y:item.y, w:span.w, h:item.h }, item)?.w >= Math.min(item.w, span.w) * 0.4),
          above = contents.filter(item => item.y + item.h <= y + size * 2 && item.y + item.h >= y - band && overlap({ x:span.x, y:item.y, w:span.w, h:item.h }, item)?.w >= Math.min(item.w, span.w) * 0.4);
        if (through.length) return { shape:"strike", confidence:0.6, box, target:through.reduce((acc, item) => union(acc, item), null) };
        const aboveBox = { x:box.x, y:y - band, w:box.w, h:Math.max(1, band - size * 1.5) }, density = probe(aboveBox);
        // Content directly below as well makes it a fraction bar, not an underline.
        if (!below && (above.length || density >= 0.02)) return { shape:"underline", confidence:0.55, box, target:above.reduce((acc, item) => union(acc, item), null) || aboveBox, lineY:y };
      }
    }
    // Small axes (an L) beside earlier content: a request to plot it.
    const corner = cornerFit(points);
    if (corner && corner.turn >= 60 && corner.turn <= 120 && Math.max(box.w, box.h) <= Math.max(160, size * 40)) {
      const near = contents.filter(item => overlap(inflate(box, box.w * 1.5, box.h), item) && !overlap(box, item));
      if (near.length) return { shape:"axes", confidence:0.5, box, target:near.reduce((acc, item) => union(acc, item), null) };
    }
    return null;
  }
  // Two underlines in quick succession, parallel and close, form a double underline.
  function combineUnderlines(first, second, options) {
    options ||= {};
    if (first?.shape !== "underline" || second?.shape !== "underline") return null;
    const size = Math.max(1, Number(options.size) || 4), dy = Math.abs((second.lineY ?? second.box.y) - (first.lineY ?? first.box.y)),
      shared = overlap({ x:first.box.x, y:0, w:first.box.w, h:1 }, { x:second.box.x, y:0, w:second.box.w, h:1 })?.w || 0;
    if (dy > Math.max(size * 6, 26) || shared < Math.min(first.box.w, second.box.w) * 0.6) return null;
    return { shape:"double_underline", confidence:Math.min(0.9, first.confidence + 0.25), box:union(first.box, second.box), target:first.target };
  }
  // Strong local geometry can offer a deletion even offline. Ambiguous object
  // bounds need visual confirmation. Neither path ever auto-executes Delete.
  function gestureDecision(answers, local) {
    const command = Number(answers?.command?.noul), gesture = answers?.gesture?.choice, confidence = Number(answers?.gesture?.confidence) || 0;
    // Solve is an explicit action, never an inferred pen command. Older Cloud
    // responses may still name it, so reject it before running or offering it.
    if (gesture === "solve") return { act:"ignore" };
    const deletion = ["strike", "scribble"].includes(local?.shape);
    if (!answers || !Number.isFinite(command)) {
      if (deletion && local.confidence >= 0.8) return { act:"offer", gesture:"delete", source:"local" };
      const offer = { double_underline:"typeset", enclosure:"explain", axes:"plot" }[local?.shape];
      return offer && (local?.confidence || 0) >= 0.7 ? { act:"offer", gesture:offer, source:"local" } : { act:"ignore" };
    }
    if (!gesture || gesture === "none" || command < 0.45) return { act:"ignore" };
    if (gesture === "delete") return deletion && command >= 0.75 && confidence >= 0.75 ? { act:"offer", gesture, source:"penecho-llm" } : { act:"ignore" };
    if (deletion) return { act:"ignore" };
    return { act:command >= 0.7 && confidence >= 0.6 ? "run" : "offer", gesture, source:"penecho-llm" };
  }

  // ---------- 2. Step checker ----------
  function stepCheckCandidate(inkAnswers, features) {
    const kind = inkAnswers?.kind?.choice, action = inkAnswers?.action?.choice;
    if (kind === "math_step" || action === "check_step") return true;
    return Boolean(features?.newBelow && (features.rows || 0) >= 2 && (kind === "math_expr" || action === "next_step" || action === "solve"));
  }
  function stepDecision(answers) {
    const step = answers?.step, error = Number(answers?.error?.noul);
    if (step?.choice !== "doubtful") return { flagged:false };
    const confidence = Number(step.confidence) || 0, score = Number.isFinite(error) ? Math.max(error, confidence * 0.9) : confidence;
    return { flagged:score >= 0.55, score:Math.round(score * 100) / 100 };
  }

  // ---------- 3. Canvas index and search ----------
  const INDEX_KINDS = Object.freeze({
    formula:{ en:"Formula", zh:"公式", icon:"∑", words:["formula", "equation", "expression", "math", "公式", "方程", "等式", "表达式"] },
    derivation:{ en:"Derivation", zh:"推导", icon:"⋮", words:["derivation", "proof", "calculation", "steps", "推导", "证明", "计算", "步骤"] },
    graph:{ en:"Graph", zh:"图像", icon:"∿", words:["graph", "plot", "chart", "function", "curve", "图像", "函数图", "曲线", "图表"] },
    geometry:{ en:"Geometry", zh:"几何", icon:"△", words:["geometry", "triangle", "circle", "angle", "shape", "几何", "三角形", "圆", "角"] },
    circuit:{ en:"Circuit", zh:"电路", icon:"⏚", words:["circuit", "resistor", "voltage", "current", "电路", "电阻", "电压", "电流"] },
    chemistry:{ en:"Chemistry", zh:"化学", icon:"⚗", words:["chemistry", "reaction", "molecule", "化学", "反应", "分子", "方程式"] },
    diagram:{ en:"Diagram", zh:"示意图", icon:"⇄", words:["diagram", "flowchart", "flow", "architecture", "mind map", "arrows", "流程图", "架构", "示意图", "思维导图"] },
    wireframe:{ en:"Wireframe", zh:"线框图", icon:"▣", words:["wireframe", "ui", "screen", "page", "app", "layout", "mockup", "界面", "线框", "页面", "原型"] },
    table:{ en:"Table", zh:"表格", icon:"▦", words:["table", "grid", "data", "numbers", "表格", "数据"] },
    todo:{ en:"To-do", zh:"待办", icon:"☑", words:["todo", "to-do", "task", "checklist", "待办", "任务", "清单"] },
    notes:{ en:"Notes", zh:"笔记", icon:"≡", words:["notes", "note", "text", "ideas", "笔记", "文字", "想法"] },
    question:{ en:"Question", zh:"问题", icon:"?", words:["question", "ask", "why", "how", "问题", "提问", "为什么"] },
    code:{ en:"Code", zh:"代码", icon:"{}", words:["code", "program", "function", "algorithm", "代码", "程序", "算法"] },
    drawing:{ en:"Drawing", zh:"绘画", icon:"✎", words:["drawing", "sketch", "picture", "doodle", "绘画", "素描", "草图", "画"] },
    music:{ en:"Music", zh:"乐谱", icon:"♪", words:["music", "notes", "score", "乐谱", "音乐"] },
    map:{ en:"Map", zh:"地图", icon:"⌖", words:["map", "route", "floor plan", "地图", "路线", "平面图"] },
    animation:{ en:"Animation", zh:"动画", icon:"▶", words:["animation", "animate", "scene", "simulation", "动画", "模拟"] },
    widget:{ en:"Widget", zh:"组件", icon:"▭", words:["widget", "app", "组件", "小程序"] },
    image:{ en:"Image", zh:"图片", icon:"▨", words:["image", "photo", "picture", "图片", "照片"] },
    text:{ en:"Text", zh:"文本", icon:"T", words:["text", "typed", "文本", "文字"] },
  });
  const INDEX_SUBJECTS = Object.freeze({
    math:{ en:"Math", zh:"数学", words:["math", "maths", "mathematics", "algebra", "calculus", "数学", "代数", "微积分"] },
    physics:{ en:"Physics", zh:"物理", words:["physics", "mechanics", "force", "物理", "力学"] },
    chemistry:{ en:"Chemistry", zh:"化学", words:["chemistry", "化学"] },
    biology:{ en:"Biology", zh:"生物", words:["biology", "cell", "生物", "细胞"] },
    computing:{ en:"Computing", zh:"计算机", words:["computing", "software", "programming", "data", "计算机", "编程", "软件"] },
    engineering:{ en:"Engineering", zh:"工程", words:["engineering", "electrical", "mechanical", "工程", "电子"] },
    business:{ en:"Business", zh:"商业", words:["business", "finance", "plan", "project", "商业", "财务", "计划", "项目"] },
    language:{ en:"Language", zh:"语言", words:["language", "writing", "vocabulary", "english", "chinese", "语言", "写作", "词汇", "英语", "语文"] },
    art:{ en:"Art", zh:"艺术", words:["art", "design", "illustration", "艺术", "设计", "插画"] },
    other:{ en:"Other", zh:"其他", words:[] },
  });
  // Assist's ink classification doubles as a free index label.
  const INK_KIND_TO_INDEX = Object.freeze({ math_expr:"formula", math_step:"derivation", shape:"geometry", diagram:"diagram", ui_wireframe:"wireframe", notes:"notes", question:"question", code:"code", drawing:"drawing" });
  function indexKindFromInk(kind) { return INK_KIND_TO_INDEX[kind] || null; }
  function indexKindFromWidget(widget) {
    const format = String(widget?.sourceFormat || ""), type = String(widget?.widgetType || "");
    if (format === "penecho-graph") return "graph";
    if (format === "penecho-scene+json") return "animation";
    if (type === "diagram_source" || widget?.pluginId === "flowchart") return "diagram";
    return "widget";
  }
  function normalizeText(text) { return String(text || "").toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim(); }
  function parseQuery(text) {
    const q = normalizeText(text), kinds = new Set(), subjects = new Set();
    if (!q) return { text:"", kinds, subjects, words:[] };
    for (const [id, item] of Object.entries(INDEX_KINDS)) if ([id, item.en.toLowerCase(), item.zh, ...item.words].some(word => word && q.includes(word.toLowerCase()))) kinds.add(id);
    for (const [id, item] of Object.entries(INDEX_SUBJECTS)) if (id !== "other" && [id, item.en.toLowerCase(), item.zh, ...item.words].some(word => word && q.includes(word.toLowerCase()))) subjects.add(id);
    const words = q.split(/[\s,，。;；]+/).filter(word => word.length >= 1);
    return { text:q, kinds, subjects, words };
  }
  // 12×12 ink-density vector from RGBA pixels: a cheap, local sketch signature.
  const SKETCH_GRID = 12;
  function sketchVector(data, width, height) {
    if (!data || !width || !height) return null;
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    const ink = (i) => data[i + 3] > 40 && data[i] + data[i + 1] + data[i + 2] < 600;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (ink((y * width + x) * 4)) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const side = Math.max(x1 - x0 + 1, y1 - y0 + 1), ox = x0 - (side - (x1 - x0 + 1)) / 2, oy = y0 - (side - (y1 - y0 + 1)) / 2,
      cells = new Array(SKETCH_GRID * SKETCH_GRID).fill(0);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!ink((y * width + x) * 4)) continue;
      const cx = Math.min(SKETCH_GRID - 1, Math.floor((x - ox) / side * SKETCH_GRID)), cy = Math.min(SKETCH_GRID - 1, Math.floor((y - oy) / side * SKETCH_GRID));
      cells[cy * SKETCH_GRID + cx]++;
    }
    const norm = Math.hypot(...cells) || 1;
    return cells.map(value => Math.round(value / norm * 1000) / 1000);
  }
  function vectorSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return Math.max(0, Math.min(1, dot));
  }
  // Rank index entries for a text query and/or a sketch (its PenEchoLLM kind,
  // subject and local vector). Recent entries win ties.
  function searchIndex(entries, query, options) {
    options ||= {};
    const parsed = typeof query === "string" ? parseQuery(query) : query || parseQuery(""), sketch = options.sketch || null, now = Number(options.now) || Date.now(), results = [];
    for (const entry of entries || []) {
      let score = 0;
      const text = normalizeText(`${entry.title || ""} ${entry.text || ""} ${entry.documentTitle || ""}`);
      if (parsed.kinds.size && parsed.kinds.has(entry.kind)) score += 3;
      if (parsed.subjects.size && parsed.subjects.has(entry.subject)) score += 2;
      for (const word of parsed.words) if (word.length >= 2 && text.includes(word)) score += 1.5;
      if (parsed.text && parsed.text.length >= 2 && text.includes(parsed.text)) score += 2;
      if (sketch) {
        if (sketch.kind && sketch.kind === entry.kind) score += 2.5;
        if (sketch.subject && sketch.subject !== "other" && sketch.subject === entry.subject) score += 1;
        score += 3 * vectorSimilarity(sketch.vector, entry.vector);
      }
      if (!parsed.text && !sketch) score = 0.1;
      if (score <= 0) continue;
      const age = Math.max(0, now - (Number(entry.updatedAt) || 0)) / 86400000;
      results.push({ entry, score:score + Math.max(0, 0.3 - age * 0.01) });
    }
    return results.sort((a, b) => b.score - a.score || (b.entry.updatedAt || 0) - (a.entry.updatedAt || 0));
  }
  // Keep one entry per place: a new label for an overlapping box replaces the old one.
  function upsertIndexEntry(entries, entry, limit) {
    limit ||= 800;
    const area = box => Math.max(1, box.w * box.h);
    const kept = (entries || []).filter(item => {
      if (item.documentId !== entry.documentId || item.source !== entry.source && !(item.source === "ink" && entry.source === "ink")) return true;
      if (entry.objectId && item.objectId === entry.objectId) return false;
      const shared = overlap(item.box, entry.box);
      return !shared || area(shared) < Math.min(area(item.box), area(entry.box)) * 0.5;
    });
    kept.push(entry);
    kept.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return kept.slice(0, limit);
  }

  return {
    bounds, union, overlap, inflate, pathLength, reversals, lineFit, cornerFit, pointInPolygon, deletionMarkShape,
    GESTURE_SHAPES, GESTURE_FOLLOW_MS, GESTURE_PAUSE_MS, classifyGestureStroke, strokesUnderMark, rasterDeletionTarget, polylinesTouch, connectedStrokes, combineUnderlines, gestureDecision,
    stepCheckCandidate, stepDecision,
    INDEX_KINDS, INDEX_SUBJECTS, indexKindFromInk, indexKindFromWidget, parseQuery, SKETCH_GRID, sketchVector, vectorSimilarity, searchIndex, upsertIndexEntry,
  };
});
