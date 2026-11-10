"use strict";
// Hand-drawn vector ink for example canvases: a small single-stroke font and an
// SVG path sampler. Output is deterministic (seeded) so examples look the same
// on every device and tests can compare them.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PENECHO_EXAMPLE_INK = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  // Glyph space: cap top y=0, x-height y=4, baseline y=10, descender y=14.
  const CAP = 10;

  function arc(cx, cy, rx, ry, from, to, steps) {
    const count = Math.max(4, steps || Math.ceil(Math.abs(to - from) / 18));
    const points = [];
    for (let i = 0; i <= count; i++) {
      const angle = ((from + ((to - from) * i) / count) * Math.PI) / 180;
      points.push([cx + rx * Math.cos(angle), cy - ry * Math.sin(angle)]);
    }
    return points;
  }
  const join = (...parts) => parts.flat();
  const dot = (x, y) => arc(x, y, 0.35, 0.35, 0, 540, 8);

  // Each glyph: [advance width, polylines]. Arcs use counter-clockwise degrees.
  const GLYPHS = {
    a: [6, [arc(2.5, 7, 2.5, 3, 20, 380), [[5, 4], [5, 10]]]],
    b: [6, [[[0, 0], [0, 10]], arc(2.5, 7, 2.5, 3, 180, 540)]],
    c: [5.4, [arc(2.7, 7, 2.6, 3, 50, 310)]],
    d: [6, [arc(2.5, 7, 2.5, 3, 0, 360), [[5, 0], [5, 10]]]],
    e: [5.8, [join([[0.2, 7], [5, 7]], arc(2.6, 7, 2.4, 3, 0, 320))]],
    f: [4.4, [join(arc(3.4, 2.2, 1.4, 1.8, 30, 180), [[2, 10]]), [[0.4, 4.4], [4, 4.4]]]],
    g: [6, [arc(2.5, 7, 2.5, 3, 20, 380), join([[5, 4], [5, 12]], arc(2.6, 12, 2.4, 2, 0, -150))]],
    h: [6, [[[0, 0], [0, 10]], join(arc(2.5, 6.7, 2.5, 2.6, 180, 0), [[5, 10]])]],
    i: [2, [[[0.6, 4], [0.6, 10]], dot(0.6, 2.2)]],
    j: [3, [join([[2, 4], [2, 12]], arc(0.9, 12, 1.1, 1.8, 0, -170)), dot(2, 2.2)]],
    k: [5.4, [[[0, 0], [0, 10]], [[4.6, 4], [0.2, 7.8]], [[1.6, 6.8], [5, 10]]]],
    l: [2, [[[0.5, 0], [0.5, 10]]]],
    m: [8, [[[0, 4], [0, 10]], join(arc(1.8, 6.4, 1.8, 2.2, 180, 0), [[3.6, 10]]), join(arc(5.4, 6.4, 1.8, 2.2, 180, 0), [[7.2, 10]])]],
    n: [6, [[[0, 4], [0, 10]], join(arc(2.5, 6.7, 2.5, 2.6, 180, 0), [[5, 10]])]],
    o: [6, [arc(2.7, 7, 2.6, 3, 100, 470)]],
    p: [6, [[[0, 4], [0, 14]], arc(2.5, 7, 2.5, 3, 180, 540)]],
    q: [6, [arc(2.5, 7, 2.5, 3, 0, 360), [[5, 4], [5, 14]]]],
    r: [4.4, [[[0, 4], [0, 10]], arc(2.4, 6.8, 2.4, 2.4, 180, 40)]],
    s: [5.2, [[[4.4, 4.8], [3.2, 4.05], [1.6, 4.05], [0.5, 4.9], [0.8, 6.1], [2.4, 6.8], [4.1, 7.6], [4.7, 8.8], [3.8, 9.85], [2, 10.1], [0.2, 9.3]]]],
    t: [4.4, [join([[1.8, 1.4]], arc(3.4, 8.6, 1.6, 1.4, 180, 270), [[4, 9.6]]), [[0, 4.4], [3.8, 4.4]]]],
    u: [6, [join([[0, 4]], arc(2.5, 7.4, 2.5, 2.6, 180, 360)), [[5, 4], [5, 10]]]],
    v: [5.6, [[[0, 4], [2.7, 10], [5.4, 4]]]],
    w: [7.6, [[[0, 4], [1.8, 10], [3.7, 5.4], [5.6, 10], [7.4, 4]]]],
    x: [5.6, [[[0, 4], [5.2, 10]], [[5.2, 4], [0, 10]]]],
    y: [5.6, [[[0, 4], [2.7, 9.6]], [[5.4, 4], [1.6, 14]]]],
    z: [5.6, [[[0.2, 4], [5.2, 4], [0, 10], [5.4, 10]]]],
    A: [7.6, [[[0, 10], [3.7, 0], [7.4, 10]], [[1.4, 6.4], [6, 6.4]]]],
    B: [6.4, [[[0, 0], [0, 10]], join([[0, 0], [3, 0]], arc(3, 2.5, 2.6, 2.5, 90, -90), [[0, 5]]), join([[0, 5], [3.4, 5]], arc(3.4, 7.5, 2.8, 2.5, 90, -90), [[0, 10]])]],
    C: [7, [arc(3.8, 5, 3.6, 5, 50, 310)]],
    D: [7, [[[0, 0], [0, 10]], join([[0, 0], [2.4, 0]], arc(2.4, 5, 4, 5, 90, -90), [[0, 10]])]],
    E: [5.6, [[[5, 0], [0, 0], [0, 10], [5.2, 10]], [[0, 5], [4, 5]]]],
    F: [5.4, [[[5, 0], [0, 0], [0, 10]], [[0, 5], [4, 5]]]],
    G: [7.4, [join(arc(3.8, 5, 3.6, 5, 50, 330), [[7, 5.4], [4.4, 5.4]])]],
    H: [7, [[[0, 0], [0, 10]], [[6.4, 0], [6.4, 10]], [[0, 5], [6.4, 5]]]],
    I: [2, [[[0.6, 0], [0.6, 10]]]],
    K: [6.4, [[[0, 0], [0, 10]], [[5.8, 0], [0.2, 6]], [[1.8, 4.4], [6, 10]]]],
    L: [5.4, [[[0, 0], [0, 10], [5, 10]]]],
    M: [8.6, [[[0, 10], [0.4, 0], [4.2, 7], [8, 0], [8.4, 10]]]],
    N: [7, [[[0, 10], [0, 0], [6.4, 10], [6.4, 0]]]],
    O: [8, [arc(4, 5, 3.8, 5, 100, 470)]],
    P: [6.2, [[[0, 10], [0, 0]], join([[0, 0], [3, 0]], arc(3, 2.7, 2.8, 2.7, 90, -90), [[0, 5.4]])]],
    Q: [8, [arc(4, 5, 3.8, 5, 100, 470), [[4.6, 7.4], [7.8, 10.6]]]],
    R: [6.4, [[[0, 10], [0, 0]], join([[0, 0], [3, 0]], arc(3, 2.7, 2.8, 2.7, 90, -90), [[0, 5.4]]), [[2.6, 5.4], [6, 10]]]],
    S: [6, [[[5.4, 1.2], [4, 0.1], [2, 0], [0.5, 1], [0.6, 2.8], [2.6, 4.4], [4.8, 5.6], [5.6, 7.4], [4.8, 9.4], [2.8, 10.1], [0.2, 9.1]]]],
    T: [6.4, [[[0, 0], [6.4, 0]], [[3.2, 0], [3.2, 10]]]],
    U: [7, [join([[0, 0]], arc(3.2, 6.8, 3.2, 3.2, 180, 360), [[6.4, 0]])]],
    V: [7, [[[0, 0], [3.4, 10], [6.8, 0]]]],
    W: [9.6, [[[0, 0], [2.3, 10], [4.7, 2], [7.1, 10], [9.4, 0]]]],
    X: [6.8, [[[0, 0], [6.4, 10]], [[6.4, 0], [0, 10]]]],
    Y: [6.8, [[[0, 0], [3.3, 5]], [[6.6, 0], [3.3, 5], [3.3, 10]]]],
    Z: [6.6, [[[0, 0], [6.2, 0], [0, 10], [6.4, 10]]]],
    0: [6, [arc(2.8, 5, 2.7, 5, 100, 470)]],
    1: [3.4, [[[0.2, 1.8], [2, 0], [2, 10]]]],
    2: [5.8, [join(arc(2.7, 2.8, 2.6, 2.6, 160, -30), [[0, 10], [5.6, 10]])]],
    3: [5.6, [join(arc(2.5, 2.5, 2.4, 2.4, 150, -90)), join(arc(2.5, 7.3, 2.8, 2.7, 90, -150))]],
    4: [6, [[[4.4, 10], [4.4, 0], [0, 7], [6, 7]]]],
    5: [5.6, [join([[5, 0], [0.8, 0], [0.4, 4.4]], arc(2.6, 7, 2.8, 3, 130, -150))]],
    6: [5.8, [join(arc(3, 2.4, 2.5, 2.4, 60, 180), arc(2.8, 7.2, 2.7, 2.8, 180, 540))]],
    7: [5.6, [[[0, 0], [5.4, 0], [1.6, 10]]]],
    8: [5.8, [join(arc(2.8, 2.5, 2.3, 2.5, 270, 630)), arc(2.8, 7.5, 2.7, 2.5, 90, 450)]],
    9: [5.8, [join(arc(2.8, 3, 2.6, 3, 0, 360), [[5.4, 3], [4.8, 10]])]],
    "°": [3, [arc(1.4, 1.5, 1.2, 1.2, 100, 470, 10)]],
    "²": [3.6, [join(arc(1.4, 1.4, 1.3, 1.3, 160, -30), [[0, 5], [2.8, 5]])]],
    "(": [3, [arc(3.2, 5, 2.6, 6.2, 125, 235)]],
    ")": [3, [arc(-0.2, 5, 2.6, 6.2, 55, -55)]],
    "=": [5.6, [[[0.2, 5.6], [5.2, 5.6]], [[0.2, 8.2], [5.2, 8.2]]]],
    "+": [5.6, [[[0.2, 7], [5.2, 7]], [[2.7, 4.5], [2.7, 9.5]]]],
    "-": [4.4, [[[0.2, 7], [4, 7]]]],
    "·": [2.4, [dot(1.1, 7)]],
    ".": [2, [dot(0.8, 9.8)]],
    ",": [2, [[[1, 9.6], [0.4, 11.4]]]],
    ":": [2, [dot(0.8, 5.4), dot(0.8, 9.6)]],
    "?": [5, [join(arc(2.4, 2.6, 2.3, 2.4, 160, -60), [[2.2, 6.8]]), dot(2.2, 9.6)]],
    "'": [1.8, [[[1, 0], [0.5, 3]]]],
    "′": [1.8, [[[1, 0], [0.5, 3]]]],
    "/": [4.4, [[[4, 0], [0.2, 11]]]],
    "→": [7.6, [[[0, 7], [7, 7]], [[4.8, 5], [7.2, 7], [4.8, 9]]]],
    "∘": [3.2, [arc(1.5, 7, 1.2, 1.2, 0, 360, 10)]],
    "×": [5, [[[0.4, 5], [4.4, 9]], [[4.4, 5], [0.4, 9]]]],
    "^": [4, [[[0.2, 3], [2, 0.4], [3.8, 3]]]],
    " ": [3.4, []],
  };

  function seededRandom(seed) {
    let value = (Number(seed) >>> 0) || 0x9e3779b9;
    return () => {
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      return ((value >>> 0) % 100000) / 100000;
    };
  }

  // Resamples a polyline so strokes have an even, pen-like point density.
  function resample(points, spacing) {
    if (points.length < 2) return points.map((point) => point.slice());
    const output = [points[0].slice()];
    let carry = 0;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1],
        [bx, by] = points[i],
        length = Math.hypot(bx - ax, by - ay);
      let distance = spacing - carry;
      while (distance <= length) {
        const t = distance / length;
        output.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
        distance += spacing;
      }
      carry = length - (distance - spacing);
    }
    const last = points[points.length - 1],
      tail = output[output.length - 1];
    if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > spacing * 0.2) output.push(last.slice());
    return output;
  }

  // Low-frequency wobble so lines look drawn by hand rather than plotted.
  function wobble(points, random, amount) {
    const phase = random() * Math.PI * 2,
      frequency = 0.08 + random() * 0.06;
    return points.map(([x, y], index) => [
      x + Math.sin(index * frequency + phase) * amount,
      y + Math.cos(index * frequency * 1.3 + phase) * amount,
    ]);
  }

  function round(points) {
    return points.map(([x, y]) => ({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }));
  }

  function hasGlyph(character) {
    return Object.prototype.hasOwnProperty.call(GLYPHS, character);
  }

  // Lays out text as strokes. `size` is the cap height in canvas px; the text
  // baseline sits at y + size.
  function textStrokes(text, options = {}) {
    const size = Number(options.size) || 40,
      scale = size / CAP,
      slant = options.slant ?? 0.12,
      random = seededRandom(options.seed ?? 7),
      spacing = Math.max(1.5, size / 14),
      letterGap = options.letterGap ?? 1.1,
      originX = Number(options.x) || 0,
      originY = Number(options.y) || 0;
    const strokes = [];
    let cursor = 0;
    for (const character of String(text)) {
      const glyph = GLYPHS[character] || GLYPHS["?"];
      const [advance, lines] = glyph,
        lift = (random() - 0.5) * 0.5,
        tilt = (random() - 0.5) * 0.05;
      for (const line of lines) {
        const placed = line.map(([gx, gy]) => {
          const yy = gy + lift,
            xx = gx + (yy - CAP / 2) * tilt;
          return [originX + (cursor + xx - (yy - CAP) * slant) * scale, originY + yy * scale];
        });
        strokes.push(round(wobble(resample(placed, spacing), random, size * 0.012)));
      }
      cursor += advance + letterGap + (random() - 0.5) * 0.3;
    }
    return { strokes, width: Math.max(0, (cursor - letterGap) * scale), height: size * 1.4 };
  }

  const PATH_ARG_COUNTS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 };

  function tokenizePath(d) {
    const tokens = String(d).match(/[MLHVCSQTZmlhvcsqtz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
    const commands = [];
    let index = 0,
      command = null;
    while (index < tokens.length) {
      if (/[A-Za-z]/.test(tokens[index])) command = tokens[index++];
      if (!command) break;
      const count = PATH_ARG_COUNTS[command.toUpperCase()];
      const args = tokens.slice(index, index + count).map(Number);
      index += count;
      commands.push([command, args]);
      if (count === 0) continue;
      if (command === "M") command = "L";
      else if (command === "m") command = "l";
    }
    return commands;
  }

  function cubic(p0, p1, p2, p3, steps) {
    const points = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps,
        u = 1 - t;
      points.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
    return points;
  }

  // Converts SVG path data (M L H V C S Q T Z, absolute or relative) into
  // polylines: one per subpath, the way a pen would draw them.
  function pathPolylines(d) {
    const lines = [];
    let current = [0, 0],
      start = [0, 0],
      line = null,
      lastControl = null,
      lastCommand = "";
    for (const [command, args] of tokenizePath(d)) {
      const upper = command.toUpperCase(),
        relative = command !== upper,
        ox = relative ? current[0] : 0,
        oy = relative ? current[1] : 0;
      if (upper === "M") {
        current = [ox + args[0], oy + args[1]];
        start = current.slice();
        line = [current.slice()];
        lines.push(line);
      } else if (upper === "L" || upper === "T") {
        current = [ox + args[0], oy + args[1]];
        line.push(current.slice());
      } else if (upper === "H") {
        current = [relative ? current[0] + args[0] : args[0], current[1]];
        line.push(current.slice());
      } else if (upper === "V") {
        current = [current[0], relative ? current[1] + args[0] : args[0]];
        line.push(current.slice());
      } else if (upper === "C" || upper === "S") {
        let c1, c2, end;
        if (upper === "C") {
          c1 = [ox + args[0], oy + args[1]];
          c2 = [ox + args[2], oy + args[3]];
          end = [ox + args[4], oy + args[5]];
        } else {
          c1 = lastControl && /[CS]/i.test(lastCommand) ? [2 * current[0] - lastControl[0], 2 * current[1] - lastControl[1]] : current.slice();
          c2 = [ox + args[0], oy + args[1]];
          end = [ox + args[2], oy + args[3]];
        }
        line.push(...cubic(current, c1, c2, end, 12));
        lastControl = c2;
        current = end;
      } else if (upper === "Q") {
        const control = [ox + args[0], oy + args[1]],
          end = [ox + args[2], oy + args[3]];
        const c1 = [current[0] + (2 / 3) * (control[0] - current[0]), current[1] + (2 / 3) * (control[1] - current[1])],
          c2 = [end[0] + (2 / 3) * (control[0] - end[0]), end[1] + (2 / 3) * (control[1] - end[1])];
        line.push(...cubic(current, c1, c2, end, 10));
        current = end;
      } else if (upper === "Z") {
        line.push(start.slice());
        current = start.slice();
      }
      if (!/[CS]/.test(upper)) lastControl = null;
      lastCommand = command;
    }
    return lines.filter((points) => points.length > 1);
  }

  // Places SVG path data on the canvas: scale, then offset by (x, y).
  function pathStrokes(d, options = {}) {
    const scale = Number(options.scale) || 1,
      x = Number(options.x) || 0,
      y = Number(options.y) || 0,
      random = seededRandom(options.seed ?? 11),
      spacing = Math.max(1.5, Number(options.spacing) || 3);
    return pathPolylines(d).map((points) =>
      round(wobble(resample(points.map(([px, py]) => [x + px * scale, y + py * scale]), spacing), random, options.wobble ?? 0.6))
    );
  }

  // A hand-drawn ellipse that slightly overshoots where it started.
  function ellipseStroke(cx, cy, rx, ry, options = {}) {
    const random = seededRandom(options.seed ?? 5),
      startAngle = options.start ?? 100;
    const points = arc(cx, cy, rx, ry, startAngle, startAngle + 372, 36).map(([px, py], index) => {
      const drift = 1 + Math.sin(index / 5) * 0.03;
      return [cx + (px - cx) * drift, cy + (py - cy) * drift];
    });
    return round(wobble(resample(points, Math.max(1.5, options.spacing || 3)), random, options.wobble ?? 0.5));
  }

  function bounds(strokes) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const stroke of strokes)
      for (const point of stroke) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
    return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : { x: 0, y: 0, width: 0, height: 0 };
  }

  return { GLYPHS, hasGlyph, textStrokes, pathPolylines, pathStrokes, ellipseStroke, bounds, seededRandom, resample };
});
