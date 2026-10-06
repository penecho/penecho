"use strict";
// Animate sketch: the user's own strokes become a puppet. The model only rigs
// the drawing (rigid parts, joints and looping motion); PenEcho renders the
// original ink, so the animated picture is exactly the user's drawing.
// Shared by the Canvas client (bundled), the server (require) and node tests.
var PenEchoSketchPuppet = (() => {
  const MAX_STROKES = 64, MAX_STROKE_POINTS = 256, MAX_POINTS = 8000, VIEW_POINTS = 16,
    MAX_PARTS = 24, MAX_MOTIONS = 4, MAX_INK_CHARS = 52000, ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
  // unit, default amplitude, maximum amplitude, default period (seconds)
  const MOTIONS = Object.freeze({
    swing:["deg", 25, 120, 1.1], flap:["deg", 40, 120, 0.5], sway:["deg", 6, 45, 2.6], wiggle:["deg", 10, 60, 0.7],
    spin:["dir", 1, 1, 1.6], bob:["px", 6, 400, 0.9], float:["px", 8, 400, 3.2], hop:["px", 24, 600, 0.9],
    travel:["px", 240, 3000, 5], shake:["px", 3, 60, 0.12], orbit:["px", 12, 600, 3],
    breathe:["scale", 0.04, 0.4, 2.4], stretch:["scale", 0.08, 0.5, 0.8], blink:["none", 1, 1, 3.4], flicker:["scale", 0.25, 0.8, 0.5],
  });
  const policy = [
    "Animate the user's own sketch. PenEcho renders the user's original strokes from sketchInk; never redraw, trace or restyle them.",
    "Return exactly one html_widget command with pluginId \"general\", sourceFormat \"penecho-scene+json\", a short title and scene {\"engine\":\"puppet\",\"subject\":...,\"parts\":[...],\"effects\":{...}}. No HTML, actors, text or extra commands.",
    "First identify the subject and how it would naturally and charmingly move: a person walks or waves, a bird flaps, a fish swims, a car drives while its wheels spin, a tree or flower sways, the sun spins and glows, a cat swishes its tail and blinks.",
    "Split sketchInk strokes into rigid parts. Each part is {\"id\",\"ink\",\"parent\",\"pivot\":[x,y],\"motion\":[...]}. ink lists stroke indices i, or \"i:a-b\" for points a..b of stroke i when one stroke draws several limbs (for example both legs). Strokes you do not list stay on the first root part.",
    "parent makes a part move with another (hand with arm, wheel with car body, petals with stem); a part without parent is a root and carries whole-body motion. pivot is the joint in Canvas world coordinates where the part attaches and rotates: shoulder, hip, wing root, tail base, trunk base, neck or wheel centre; for a root use its ground contact point.",
    "motion items are {\"type\",\"amp\",\"period\",\"phase\"}. Types: swing (degrees; limbs, tail, pendulum), flap (degrees; wings), sway (degrees; plants, hair, ears), wiggle (degrees; lively jitter), spin (amp +1 clockwise or -1; wheels, propellers, sun rays), bob and float (pixels up/down), hop (pixels jump height, adds squash and stretch), travel (pixels moved forward, positive to the right; use the facing direction), shake (pixels), orbit (pixels radius), breathe and stretch (scale fraction 0.03-0.3), blink (eyes; amp ignored), flicker (fraction; flames, stars, glow).",
    "period is seconds (0.3-6). phase 0-1 shifts timing: alternate limbs use 0 and 0.5, and a child slightly later than its parent gives follow-through.",
    "Choose 2-6 moving parts with coordinated, characterful motion that suits the subject; keep the composition. Natural amplitudes: limbs 15-35 degrees, wings 30-60, sways 3-10, bobs 3-8% of the height. effects: {\"shadow\":true} for a grounded subject.",
    "If sketchInk is absent, animate the sketch as a PenEcho motion scene instead (engine motion), preserving its subject and composition, with grouped path actors, rotate/move/scale steps and loop:true.",
  ].join(" ");

  const finite = value => typeof value === "number" && Number.isFinite(value);
  const validBox = box => box && [box.x, box.y, box.w, box.h].every(finite) && box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0 && box.x + box.w <= 20000 && box.y + box.h <= 20000;
  const inside = (point, box) => Array.isArray(point) && point.length === 2 && point.every(finite)
    && point[0] >= box.x - 0.5 && point[0] <= box.x + box.w + 0.5 && point[1] >= box.y - 0.5 && point[1] <= box.y + box.h + 0.5;
  const cleanColor = value => typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
  const round = value => Math.round(value * 10) / 10;

  // Indexes of a corner-preserving subsample: endpoints first, then the point
  // with the greatest deviation from its current chord until the limit.
  function sampleIndexes(points, limit, tolerance = 0.75) {
    const count = points.length;
    if (count <= limit) return points.map((_, index) => index);
    const indexes = [0, count - 1], squared = tolerance * tolerance;
    while (indexes.length < limit) {
      let best = -1, error = squared;
      for (let span = 1; span < indexes.length; span++) {
        const start = points[indexes[span - 1]], end = points[indexes[span]], dx = end[0] - start[0], dy = end[1] - start[1], length = dx * dx + dy * dy;
        for (let index = indexes[span - 1] + 1; index < indexes[span]; index++) {
          const point = points[index], ratio = length ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length)) : 0,
            distance = (point[0] - start[0] - ratio * dx) ** 2 + (point[1] - start[1] - ratio * dy) ** 2;
          if (distance > error) { error = distance; best = index; }
        }
      }
      if (best < 0) break;
      indexes.push(best);
      indexes.sort((a, b) => a - b);
    }
    return indexes;
  }
  // The model reads a few anchors per stroke. Ranges in its rig refer to these
  // view indexes; both sides derive them from the same canonical ink.
  function viewIndexes(points) {
    if (points.length <= VIEW_POINTS) return points.map((_, index) => index);
    const corners = sampleIndexes(points, Math.ceil(VIEW_POINTS / 2), 1.5), set = new Set(corners);
    // Fill the remainder evenly by arc position so long smooth strokes still
    // expose their middle (where a single stroke often turns into a second limb).
    for (let k = 1; set.size < VIEW_POINTS && k < VIEW_POINTS; k++) set.add(Math.round(k * (points.length - 1) / VIEW_POINTS));
    return [...set].sort((a, b) => a - b).slice(0, VIEW_POINTS);
  }

  function canonicalInk(value, scope) {
    if (value === undefined || value === null) return null;
    if (!validBox(scope) || !value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some(key => !["coordinateSpace", "strokes"].includes(key))
      || value.coordinateSpace !== "canvas-world" || !Array.isArray(value.strokes) || !value.strokes.length || value.strokes.length > MAX_STROKES) return false;
    let total = 0;
    const strokes = [];
    for (const stroke of value.strokes) {
      if (!stroke || typeof stroke !== "object" || Array.isArray(stroke) || Object.keys(stroke).some(key => !["width", "color", "points"].includes(key))
        || !finite(stroke.width) || stroke.width <= 0 || stroke.width > 200 || !Array.isArray(stroke.points)
        || !stroke.points.length || stroke.points.length > MAX_STROKE_POINTS || !stroke.points.every(point => inside(point, scope))) return false;
      if (stroke.color !== undefined && !cleanColor(stroke.color)) return false;
      total += stroke.points.length;
      if (total > MAX_POINTS) return false;
      strokes.push({ width:round(stroke.width), ...(stroke.color ? { color:cleanColor(stroke.color) } : {}), points:stroke.points.map(point => [round(point[0]), round(point[1])]) });
    }
    return { coordinateSpace:"canvas-world", strokes };
  }
  // Canvas stroke records → bounded canonical ink, oldest first (drawing order).
  function sketchInk(records, scope) {
    if (!validBox(scope) || !Array.isArray(records)) return null;
    const eligible = records.filter(record => finite(record?.size) && record.size > 0 && record.size <= 200 && Array.isArray(record.points) && record.points.length >= 1
      && record.points.every(point => inside([point?.x, point?.y], scope))).slice(-MAX_STROKES);
    if (!eligible.length) return null;
    const limit = Math.max(8, Math.min(MAX_STROKE_POINTS, Math.floor(MAX_POINTS / eligible.length)));
    const strokes = eligible.map(record => {
      const raw = record.points.map(point => [point.x, point.y]).filter((point, index, list) => !index || point[0] !== list[index - 1][0] || point[1] !== list[index - 1][1]);
      const points = sampleIndexes(raw, limit, 0.4).map(index => raw[index]);
      return { width:record.size, ...(cleanColor(record.color) ? { color:cleanColor(record.color) } : {}), points };
    });
    return canonicalInk({ coordinateSpace:"canvas-world", strokes }, scope) || null;
  }
  function inkBox(strokes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const stroke of strokes) for (const [x, y] of stroke.points) {
      const r = (stroke.width || 0) / 2;
      x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r);
    }
    return Number.isFinite(x0) ? { x:x0, y:y0, w:Math.max(1, x1 - x0), h:Math.max(1, y1 - y0) } : null;
  }
  function modelView(ink) {
    if (!ink?.strokes?.length) return null;
    return {
      coordinateSpace:"canvas-world",
      note:"Stroke i lists sampled anchor points pts[0..n-1] in drawing order; \"i:a-b\" refers to pts a..b of stroke i.",
      strokes:ink.strokes.map((stroke, i) => {
        const box = inkBox([stroke]);
        return { i, box:[Math.round(box.x), Math.round(box.y), Math.round(box.w), Math.round(box.h)], pts:viewIndexes(stroke.points).map(index => stroke.points[index].map(Math.round)) };
      }),
    };
  }

  // ---------- Rig → renderable puppet scene ----------
  function motionList(value) {
    const list = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
    const motions = [];
    for (const item of list.slice(0, MAX_MOTIONS * 2)) {
      if (!item || typeof item !== "object") continue;
      const type = String(item.type || item.do || "").trim().toLowerCase(), spec = MOTIONS[type];
      if (!spec) continue;
      let amp = Number(item.amp ?? item.amplitude ?? item.angle ?? item.distance);
      if (!Number.isFinite(amp)) amp = spec[1];
      amp = spec[0] === "dir" ? (amp < 0 ? -1 : 1) : spec[0] === "none" ? 1 : Math.max(-spec[2], Math.min(spec[2], amp));
      const period = Math.max(0.12, Math.min(20, Number.isFinite(Number(item.period)) && Number(item.period) > 0 ? Number(item.period) : spec[3])),
        phase = ((Number(item.phase) || 0) % 1 + 1) % 1;
      motions.push({ type, amp:Math.round(amp * 1000) / 1000, period:Math.round(period * 1000) / 1000, ...(phase ? { phase:Math.round(phase * 1000) / 1000 } : {}) });
      if (motions.length >= MAX_MOTIONS) break;
    }
    return motions;
  }
  function parseRef(ref, ink) {
    const match = typeof ref === "number" ? [null, String(ref)] : /^\s*(\d+)\s*(?::\s*(\d+)\s*-\s*(\d+)\s*)?$/.exec(String(ref ?? ""));
    if (!match) return null;
    const stroke = Number(match[1]);
    if (!Number.isInteger(stroke) || !ink.strokes[stroke]) return null;
    if (match[2] === undefined) return { stroke, from:0, to:ink.strokes[stroke].points.length - 1 };
    const view = viewIndexes(ink.strokes[stroke].points), a = Math.min(Number(match[2]), Number(match[3])), b = Math.max(Number(match[2]), Number(match[3]));
    if (a >= view.length) return null;
    return { stroke, from:view[a], to:view[Math.min(b, view.length - 1)] };
  }
  // Ramer–Douglas–Peucker on one run, keeping endpoints.
  function simplify(points, tolerance) {
    if (points.length <= 2 || tolerance <= 0) return points;
    const keep = new Uint8Array(points.length), stack = [[0, points.length - 1]], squared = tolerance * tolerance;
    keep[0] = keep[points.length - 1] = 1;
    while (stack.length) {
      const [first, last] = stack.pop(), a = points[first], b = points[last], dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
      let best = -1, error = squared;
      for (let index = first + 1; index < last; index++) {
        const p = points[index], t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0,
          distance = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
        if (distance > error) { error = distance; best = index; }
      }
      if (best > 0) { keep[best] = 1; stack.push([first, best], [best, last]); }
    }
    return points.filter((_, index) => keep[index]);
  }
  const fmt = value => String(Math.round(value * 10) / 10);
  // Catmull-Rom through every retained sample, so the curve passes through
  // the user's points; a sharp turn (a joint or a corner) keeps its point.
  function pathData(points) {
    if (points.length === 1) { const [x, y] = points[0]; return `M${fmt(x)} ${fmt(y)}l0.1 0`; }
    if (points.length === 2) return `M${fmt(points[0][0])} ${fmt(points[0][1])}L${fmt(points[1][0])} ${fmt(points[1][1])}`;
    const tangents = points.map((point, index) => {
      if (!index || index === points.length - 1) return [0, 0];
      const previous = points[index - 1], next = points[index + 1],
        a = Math.atan2(point[1] - previous[1], point[0] - previous[0]), b = Math.atan2(next[1] - point[1], next[0] - point[0]),
        turn = Math.abs(((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      return turn > 1.05 ? [0, 0] : [(next[0] - previous[0]) / 6, (next[1] - previous[1]) / 6];
    });
    let d = `M${fmt(points[0][0])} ${fmt(points[0][1])}`;
    for (let index = 0; index < points.length - 1; index++) {
      const p = points[index], q = points[index + 1], t = tangents[index], u = tangents[index + 1];
      d += !t[0] && !t[1] && !u[0] && !u[1] ? `L${fmt(q[0])} ${fmt(q[1])}`
        : `C${fmt(p[0] + t[0])} ${fmt(p[1] + t[1])} ${fmt(q[0] - u[0])} ${fmt(q[1] - u[1])} ${fmt(q[0])} ${fmt(q[1])}`;
    }
    return d;
  }
  function rigError(message) { const error = new Error(message); error.code = "INVALID_PUPPET_RIG"; return error; }

  function rigToScene(rig, ink, options = {}) {
    if (!ink?.strokes?.length) throw rigError("sketchInk is required for a puppet scene");
    if (!rig || typeof rig !== "object") throw rigError("scene must be an object");
    const rawParts = Array.isArray(rig.parts) ? rig.parts.slice(0, MAX_PARTS * 2) : [], parts = [], ids = new Set();
    for (const raw of rawParts) {
      if (!raw || typeof raw !== "object") continue;
      let id = String(raw.id || raw.name || `part${parts.length + 1}`).trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^[^A-Za-z]+/, "");
      if (!ID_PATTERN.test(id)) id = `part${parts.length + 1}`;
      while (ids.has(id)) id = `${id.slice(0, 36)}_${parts.length + 1}`;
      ids.add(id);
      const refs = (Array.isArray(raw.ink) ? raw.ink : Array.isArray(raw.strokes) ? raw.strokes : []).map(ref => parseRef(ref, ink)).filter(Boolean),
        pivot = Array.isArray(raw.pivot) && raw.pivot.length >= 2 && raw.pivot.slice(0, 2).every(value => Number.isFinite(Number(value))) ? [Number(raw.pivot[0]), Number(raw.pivot[1])] : null;
      parts.push({ id, refs, parent:raw.parent == null ? "" : String(raw.parent), pivot, motion:motionList(raw.motion ?? raw.motions) });
      if (parts.length >= MAX_PARTS) break;
    }
    if (!parts.length || !parts.some(part => part.refs.length)) throw rigError("puppet scene needs parts whose ink lists sketchInk stroke indices");
    // Parents must exist and form a forest; break cycles at the offending link.
    const byId = new Map(parts.map(part => [part.id, part]));
    for (const part of parts) if (!byId.has(part.parent) || part.parent === part.id) part.parent = "";
    for (const part of parts) {
      const seen = new Set([part.id]);
      for (let cursor = byId.get(part.parent); cursor; cursor = byId.get(cursor.parent)) {
        if (seen.has(cursor.id)) { part.parent = ""; break; }
        seen.add(cursor.id);
      }
    }
    // Each sample point has one owner; unlisted ink belongs to the first root.
    const roots = parts.filter(part => !part.parent), rootIndex = parts.indexOf(roots[0]),
      owners = ink.strokes.map(stroke => new Int16Array(stroke.points.length).fill(-1));
    parts.forEach((part, partIndex) => {
      for (const ref of part.refs) for (let index = ref.from; index <= ref.to; index++) if (owners[ref.stroke][index] < 0) owners[ref.stroke][index] = partIndex;
    });
    const runs = [];
    ink.strokes.forEach((stroke, strokeIndex) => {
      const owner = owners[strokeIndex].map(value => value < 0 ? rootIndex : value);
      // Absorb one-point islands so a joint does not leave a speck behind.
      for (let index = 1; index < owner.length - 1; index++) if (owner[index] !== owner[index - 1] && owner[index] !== owner[index + 1]) owner[index] = owner[index - 1];
      let start = 0;
      for (let index = 1; index <= owner.length; index++) {
        if (index < owner.length && owner[index] === owner[start]) continue;
        // A run begins at the previous run's last sample, so adjacent parts
        // share their joint and stay visually connected.
        runs.push({ stroke:strokeIndex, part:owner[start], points:stroke.points.slice(Math.max(0, start - 1), index), width:stroke.width, color:stroke.color });
        start = index;
      }
    });
    const world = inkBox(ink.strokes), maxWidth = Math.max(...ink.strokes.map(stroke => stroke.width)),
      base = Math.max(16, Math.min(80, Math.max(world.w, world.h) * 0.1)) + maxWidth;
    // Room for the root's own displacement so motion is not clipped.
    let lift = 0, sideways = 0, drop = 0, travel = 0;
    for (const part of roots) for (const motion of part.motion) {
      const amp = Math.abs(motion.amp);
      if (motion.type === "hop") lift = Math.max(lift, Math.min(amp, world.h * 1.2));
      if (["bob", "float"].includes(motion.type)) { lift = Math.max(lift, Math.min(amp, world.h)); drop = Math.max(drop, Math.min(amp, world.h)); }
      if (motion.type === "orbit") { lift = Math.max(lift, amp); drop = Math.max(drop, amp); sideways = Math.max(sideways, amp); }
      if (motion.type === "shake" || motion.type === "float") sideways = Math.max(sideways, Math.min(amp, world.w * 0.5));
      if (motion.type === "travel") travel = Math.max(travel, Math.min(amp, world.w * 3));
    }
    const shadow = rig.effects?.shadow === true || rig.shadow === true,
      left = base + sideways + travel / 2, right = base + sideways + travel / 2, top = base + lift, bottom = base + drop + (shadow ? 10 : 0),
      origin = [world.x - left, world.y - top], size = [Math.round(world.w + left + right), Math.round(world.h + top + bottom)],
      local = point => [point[0] - origin[0], point[1] - origin[1]];
    // Bound the stored source: simplify progressively until it fits.
    let tolerance = 0.35, inkOut;
    for (let attempt = 0; attempt < 8; attempt++, tolerance *= 1.8) {
      inkOut = runs.map(run => ({ d:pathData(simplify(run.points.map(local), tolerance)), width:run.width, ...(run.color ? { color:run.color } : {}) }));
      if (inkOut.reduce((sum, item) => sum + item.d.length + 40, 0) <= MAX_INK_CHARS) break;
    }
    const partInk = parts.map(() => []);
    runs.forEach((run, index) => partInk[run.part].push(index));
    const centroid = indexes => {
      let x = 0, y = 0, n = 0;
      for (const index of indexes) for (const point of runs[index].points) { x += point[0]; y += point[1]; n++; }
      return n ? [x / n, y / n] : [world.x + world.w / 2, world.y + world.h / 2];
    };
    const outParts = parts.map((part, index) => {
      let pivot = part.pivot;
      if (!pivot) {
        if (!part.parent) {
          const box = partInk[index].length ? inkBox(partInk[index].map(run => runs[run])) : world;
          pivot = [box.x + box.w / 2, box.y + box.h];
        } else {
          // A limb hinges at its point nearest the parent's centre.
          const target = centroid(partInk[parts.indexOf(byId.get(part.parent))]);
          let best = null, distance = Infinity;
          for (const run of partInk[index]) for (const point of runs[run].points) {
            const d = (point[0] - target[0]) ** 2 + (point[1] - target[1]) ** 2;
            if (d < distance) { distance = d; best = point; }
          }
          pivot = best || target;
        }
      }
      return { id:part.id, ink:partInk[index], ...(part.parent ? { parent:part.parent } : {}), pivot:local(pivot).map(value => Math.round(value * 10) / 10), motion:part.motion };
    });
    // A root with no motion of its own still breathes a little, so the whole
    // picture never looks frozen while one small part moves.
    for (const part of outParts) if (!part.parent && !part.motion.length) part.motion.push({ type:"breathe", amp:0.025, period:2.6 });
    const subject = typeof rig.subject === "string" ? rig.subject.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 60) : "";
    const scene = {
      engine:"puppet", size, background:"transparent", loop:true, autoplay:true, controls:true,
      ...(subject ? { subject } : {}),
      ink:inkOut,
      parts:outParts,
      effects:{ shadow, ground:Math.round((world.y + world.h - origin[1]) * 10) / 10, intro:rig.effects?.intro !== false },
    };
    const gap = Math.max(24, Math.min(120, world.w * 0.15));
    return { scene, box:{ x:Math.round(world.x + world.w + gap), y:Math.round(world.y - top), w:size[0], h:size[1] }, sourceBox:world };
  }
  // Local rig when the model cannot supply one: the whole drawing hops with
  // squash and stretch. Still the user's own ink, never a redraw.
  function fallbackRig(ink) {
    const box = inkBox(ink.strokes);
    return { subject:"sketch", parts:[{ id:"sketch", ink:ink.strokes.map((_, index) => index), pivot:[box.x + box.w / 2, box.y + box.h], motion:[{ type:"hop", amp:Math.max(12, Math.round(box.h * 0.18)), period:1 }, { type:"wiggle", amp:4, period:2 }] }], effects:{ shadow:true } };
  }
  function widgetCommand(rig, ink, options = {}) {
    const { scene, box } = rigToScene(rig, ink, options);
    const title = String(options.title || (scene.subject ? `${scene.subject}` : "Animated sketch")).slice(0, 120);
    return { tool:"html_widget", pluginId:"general", title, sourceFormat:"penecho-scene+json", x:box.x, y:box.y, w:box.w, h:box.h, scene };
  }
  // Model commands → puppet commands. A non-puppet scene is rejected so the
  // caller can retry with the rig contract.
  function isRig(scene) { return scene && typeof scene === "object" && String(scene.engine || "").toLowerCase() === "puppet" && !Array.isArray(scene.ink); }

  return Object.freeze({ policy, MOTIONS, MAX_STROKES, MAX_STROKE_POINTS, MAX_POINTS, VIEW_POINTS, canonicalInk, sketchInk, modelView, viewIndexes, rigToScene, fallbackRig, widgetCommand, isRig, inkBox });
})();
if (typeof module === "object" && module.exports) module.exports = PenEchoSketchPuppet;
