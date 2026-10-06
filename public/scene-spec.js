"use strict";
// PenEcho scene source: a compact, validated JSON description of an animation,
// a physics simulation or a pseudo-3D illustration. The model writes this small
// spec instead of hand-written HTML; PenEcho owns the document and the vendored
// MIT runtimes (anime.js, matter-js, Zdog) that render it inside the Widget.
// Shared by the browser (window.PENECHO_SCENE) and the server (require).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PENECHO_SCENE = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const FORMAT = "penecho-scene+json",
    FRAMEWORK_VERSION = "penecho-scene/1 anime.js/4.5.0 matter-js/0.20.0 zdog/1.1.3 puppet/1",
    COPY_LABEL = "Copy scene",
    PLACEHOLDER_HTML = "<!-- PenEcho renders this Widget from its scene source. -->",
    MAX_SOURCE_BYTES = 64 * 1024,
    ENGINES = new Set(["motion", "physics", "3d", "puppet"]),
    ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/,
    PATH_PATTERN = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/,
    COLOR_TOKENS = new Set(["accent", "ink", "muted", "blue", "red", "green", "orange", "purple", "teal", "yellow", "pink", "gray", "grey", "white", "black", "none", "transparent", "paper"]),
    FONTS = new Set(["sans", "serif", "mono", "hand"]),
    ACTOR_TYPES = new Set(["rect", "circle", "ellipse", "line", "arrow", "path", "polyline", "polygon", "text", "axes", "fn", "group"]),
    STEP_TYPES = new Set(["draw", "fadeIn", "fadeOut", "appear", "hide", "move", "scale", "rotate", "color", "morph", "pulse", "write", "count", "wait", "camera"]),
    EASES = new Set(["linear", "inQuad", "outQuad", "inOutQuad", "inCubic", "outCubic", "inOutCubic", "inSine", "outSine", "inOutSine", "inExpo", "outExpo", "inOutExpo", "inBack", "outBack", "inOutBack", "outElastic", "outBounce"]),
    BODY_SHAPES = new Set(["circle", "rect", "polygon", "segment"]),
    SHAPE_TYPES = new Set(["box", "sphere", "cylinder", "cone", "hemisphere", "ellipse", "rect", "polygon", "line", "path", "torus", "group"]),
    LIMITS = Object.freeze({ actors:80, children:40, beats:24, steps:160, bodies:80, constraints:60, shapes:140, labels:24, text:240, caption:200, points:400, pathLength:6000, expression:200 });

  function sceneError(message, path = "") {
    const error = new Error(path ? `${path}: ${message}` : message);
    error.code = "INVALID_SCENE";
    return error;
  }
  const isObject = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  function number(value, fallback, min = -1e6, max = 1e6) {
    const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
  }
  function optionalNumber(value, min, max) {
    const parsed = number(value, NaN, min, max);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  function text(value, limit, fallback = "") {
    if (value === undefined || value === null) return fallback;
    return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, limit);
  }
  function color(value, fallback) {
    if (typeof value !== "string") return fallback;
    const candidate = value.trim().toLowerCase();
    if (COLOR_TOKENS.has(candidate)) return candidate;
    if (/^#[0-9a-f]{3,8}$/i.test(candidate)) return candidate;
    if (/^(?:rgb|hsl)a?\(\s*[-\d.]+%?\s*[, ]\s*[-\d.]+%?\s*[, ]\s*[-\d.]+%?(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i.test(candidate)) return candidate;
    return fallback;
  }
  function pair(value, fallback, min = -1e5, max = 1e5) {
    return Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(item => Number.isFinite(Number(item)))
      ? [number(value[0], 0, min, max), number(value[1], 0, min, max)]
      : fallback;
  }
  function triple(value, fallback) {
    if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(item => Number.isFinite(Number(item)))) return value.slice(0, 3).map(item => number(item, 0, -1e5, 1e5));
    if (isObject(value)) return [number(value.x, 0, -1e5, 1e5), number(value.y, 0, -1e5, 1e5), number(value.z, 0, -1e5, 1e5)];
    return fallback;
  }
  function points(value, path) {
    if (!Array.isArray(value) || value.length < 2 || value.length > LIMITS.points) throw sceneError(`needs 2 to ${LIMITS.points} [x,y] points`, path);
    return value.map((point, index) => {
      const parsed = pair(point, null);
      if (!parsed) throw sceneError("each point must be [x, y]", `${path}[${index}]`);
      return parsed;
    });
  }

  // ---------- Safe math expressions (no eval) ----------
  const FUNCTIONS = Object.freeze({
    sin:Math.sin, cos:Math.cos, tan:Math.tan, asin:Math.asin, acos:Math.acos, atan:Math.atan, arcsin:Math.asin, arccos:Math.acos, arctan:Math.atan,
    sinh:Math.sinh, cosh:Math.cosh, tanh:Math.tanh, sqrt:Math.sqrt, cbrt:Math.cbrt, abs:Math.abs, exp:Math.exp, ln:Math.log, log:Math.log10, log10:Math.log10, log2:Math.log2,
    floor:Math.floor, ceil:Math.ceil, round:Math.round, sign:Math.sign, min:Math.min, max:Math.max, pow:Math.pow, atan2:Math.atan2,
  });
  const CONSTANTS = Object.freeze({ pi:Math.PI, e:Math.E, tau:Math.PI * 2 });
  function tokenize(source) {
    const tokens = [], input = String(source).replace(/π/g, "pi").replace(/×|·/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/\*\*/g, "^");
    let index = 0;
    while (index < input.length) {
      const char = input[index];
      if (/\s/.test(char)) { index++; continue; }
      const numberMatch = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(input.slice(index));
      if (numberMatch) { tokens.push({ type:"num", value:Number(numberMatch[0]) }); index += numberMatch[0].length; continue; }
      const nameMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(index));
      if (nameMatch) { tokens.push({ type:"name", value:nameMatch[0].toLowerCase() }); index += nameMatch[0].length; continue; }
      if ("+-*/^(),".includes(char)) { tokens.push({ type:char }); index++; continue; }
      throw sceneError(`unexpected "${char}" in expression`);
    }
    return tokens;
  }
  // Grammar: sum := product (("+"|"-") product)* ; product := unary (("*"|"/"|implicit) unary)* ;
  // unary := "-" unary | power ; power := atom ("^" unary)? ; atom := num | name | name "(" args ")" | "(" sum ")"
  function compileExpression(source, variables = ["x"]) {
    const expression = text(source, LIMITS.expression).trim();
    if (!expression) throw sceneError("expression is empty");
    const tokens = tokenize(expression), allowed = new Set(variables);
    let position = 0;
    const peek = () => tokens[position], take = type => (peek()?.type === type ? tokens[position++] : null);
    const startsAtom = token => token && (token.type === "num" || token.type === "name" || token.type === "(");
    function atom() {
      const token = tokens[position++];
      if (!token) throw sceneError("expression ends early");
      if (token.type === "num") return () => token.value;
      if (token.type === "(") {
        const inner = sum();
        if (!take(")")) throw sceneError("missing )");
        return inner;
      }
      if (token.type === "name") {
        if (Object.hasOwn(FUNCTIONS, token.value)) {
          const fn = FUNCTIONS[token.value];
          if (take("(")) {
            const args = [sum()];
            while (take(",")) args.push(sum());
            if (!take(")")) throw sceneError("missing )");
            return scope => fn(...args.map(arg => arg(scope)));
          }
          const argument = power();
          return scope => fn(argument(scope));
        }
        if (Object.hasOwn(CONSTANTS, token.value)) { const value = CONSTANTS[token.value]; return () => value; }
        if (allowed.has(token.value)) { const name = token.value; return scope => scope[name]; }
        throw sceneError(`unknown name "${token.value}"`);
      }
      throw sceneError("unexpected symbol in expression");
    }
    function power() {
      const base = atom();
      if (take("^")) { const exponent = unary(); return scope => Math.pow(base(scope), exponent(scope)); }
      return base;
    }
    function unary() {
      if (take("-")) { const value = unary(); return scope => -value(scope); }
      if (take("+")) return unary();
      return power();
    }
    function product() {
      let left = unary();
      for (;;) {
        if (take("*")) { const l = left, r = unary(); left = scope => l(scope) * r(scope); }
        else if (take("/")) { const l = left, r = unary(); left = scope => l(scope) / r(scope); }
        else if (startsAtom(peek())) { const l = left, r = unary(); left = scope => l(scope) * r(scope); }
        else return left;
      }
    }
    function sum() {
      let left = product();
      for (;;) {
        if (take("+")) { const l = left, r = product(); left = scope => l(scope) + r(scope); }
        else if (take("-")) { const l = left, r = product(); left = scope => l(scope) - r(scope); }
        else return left;
      }
    }
    const evaluate = sum();
    if (position !== tokens.length) throw sceneError("unexpected text at end of expression");
    return scope => {
      const value = evaluate(scope);
      return Number.isFinite(value) ? value : NaN;
    };
  }

  // ---------- Motion (anime.js) ----------
  function normalizeActor(value, index, ids) {
    const path = `actors[${index}]`;
    if (!isObject(value)) throw sceneError("must be an object", path);
    const type = String(value.type || "").trim();
    if (!ACTOR_TYPES.has(type)) throw sceneError(`unknown type "${type}" (use ${[...ACTOR_TYPES].join(", ")})`, path);
    const id = String(value.id || "").trim();
    if (!ID_PATTERN.test(id)) throw sceneError("needs an id of letters, digits, - or _", path);
    if (ids.has(id)) throw sceneError(`duplicate id "${id}"`, path);
    ids.add(id);
    const actor = { id, type };
    const style = {
      fill:color(value.fill, undefined),
      stroke:color(value.stroke ?? value.color, undefined),
      width:optionalNumber(value.width ?? value.strokeWidth, 0, 80),
      opacity:optionalNumber(value.opacity, 0, 1),
      dash:Array.isArray(value.dash) ? value.dash.slice(0, 6).map(item => number(item, 4, 0, 200)) : value.dash === true ? [8, 6] : undefined,
    };
    for (const [key, entry] of Object.entries(style)) if (entry !== undefined) actor[key] = entry;
    if (value.hidden === true) actor.hidden = true;
    if (value.rotate !== undefined) actor.rotate = number(value.rotate, 0, -3600, 3600);
    if (type === "rect") Object.assign(actor, { x:number(value.x, 0), y:number(value.y, 0), w:number(value.w ?? value.width, 100, 0), h:number(value.h ?? value.height, 60, 0), r:number(value.r, 0, 0, 1e4) });
    else if (type === "circle") Object.assign(actor, { x:number(value.x ?? value.cx, 0), y:number(value.y ?? value.cy, 0), r:number(value.r, 20, 0) });
    else if (type === "ellipse") Object.assign(actor, { x:number(value.x ?? value.cx, 0), y:number(value.y ?? value.cy, 0), rx:number(value.rx, 40, 0), ry:number(value.ry, 24, 0) });
    else if (type === "line" || type === "arrow") {
      const from = pair(value.from, null), to = pair(value.to, null);
      Object.assign(actor, from && to ? { x1:from[0], y1:from[1], x2:to[0], y2:to[1] } : { x1:number(value.x1, 0), y1:number(value.y1, 0), x2:number(value.x2, 100), y2:number(value.y2, 0) });
      if (type === "arrow") actor.head = number(value.head, 14, 4, 80);
      if (value.bothEnds === true) actor.bothEnds = true;
    } else if (type === "path") {
      const d = text(value.d, LIMITS.pathLength).trim();
      if (!d || !PATH_PATTERN.test(d)) throw sceneError("d must be SVG path data (M, L, C, Q, A, Z and numbers)", path);
      actor.d = d;
      if (value.closed === true) actor.closed = true;
    } else if (type === "polyline" || type === "polygon") actor.points = points(value.points, `${path}.points`);
    else if (type === "text") {
      Object.assign(actor, { x:number(value.x, 0), y:number(value.y, 0), text:text(value.text ?? value.value, LIMITS.text), size:number(value.size ?? value.fontSize, 32, 6, 400) });
      if (["start", "middle", "end"].includes(value.anchor)) actor.anchor = value.anchor;
      if (value.weight !== undefined) actor.weight = number(value.weight, 500, 100, 900);
      if (FONTS.has(value.font)) actor.font = value.font;
      if (value.italic === true) actor.italic = true;
    } else if (type === "axes") {
      const box = Array.isArray(value.box) && value.box.length >= 4 ? value.box.slice(0, 4).map(item => number(item, 0)) : [80, 60, 800, 420];
      if (box[2] <= 0 || box[3] <= 0) throw sceneError("box needs positive width and height", path);
      const xRange = pair(value.x ?? value.xRange, [-5, 5]), yRange = pair(value.y ?? value.yRange, [-3, 3]);
      if (xRange[0] >= xRange[1] || yRange[0] >= yRange[1]) throw sceneError("x and y ranges must be [min, max] with min < max", path);
      Object.assign(actor, { box, xRange, yRange, grid:value.grid === true, labels:value.labels !== false, ticks:number(value.ticks, 0, 0, 40) });
      if (value.xLabel !== undefined) actor.xLabel = text(value.xLabel, 40);
      if (value.yLabel !== undefined) actor.yLabel = text(value.yLabel, 40);
    } else if (type === "fn") {
      actor.expr = text(value.expr ?? value.expression, LIMITS.expression).trim();
      try { compileExpression(actor.expr, ["x", "t"]); } catch (error) { throw sceneError(error.message, `${path}.expr`); }
      actor.axes = String(value.axes || value.on || "").trim();
      if (!actor.axes) throw sceneError("needs axes: the id of an axes actor", path);
      const domain = pair(value.domain, null);
      if (domain) actor.domain = domain;
      actor.samples = number(value.samples, 240, 24, 1200);
    } else if (type === "group") {
      if (!Array.isArray(value.children) || !value.children.length || value.children.length > LIMITS.children) throw sceneError(`children must list 1 to ${LIMITS.children} actor ids`, path);
      actor.children = value.children.map(item => String(item));
    }
    return actor;
  }
  function targetList(value, path) {
    const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
    if (list.length > 40) throw sceneError("targets at most 40 actors", path);
    return list.map(item => String(item));
  }
  function normalizeStep(value, path, ids) {
    if (!isObject(value)) throw sceneError("must be an object", path);
    const type = String(value.do ?? value.action ?? value.type ?? "").trim();
    if (!STEP_TYPES.has(type)) throw sceneError(`unknown step "${type}" (use ${[...STEP_TYPES].join(", ")})`, path);
    const step = { do:type, dur:number(value.dur ?? value.duration, type === "wait" ? 0.6 : type === "appear" || type === "hide" ? 0 : 0.8, 0, 30) };
    const targets = targetList(value.target ?? value.targets, `${path}.target`);
    if (!["wait", "camera"].includes(type)) {
      if (!targets.length) throw sceneError("needs target: an actor id or a list of ids", path);
      for (const target of targets) if (!ids.has(target)) throw sceneError(`unknown target "${target}"`, path);
      step.target = targets;
    }
    if (value.delay !== undefined) step.delay = number(value.delay, 0, 0, 30);
    if (value.stagger !== undefined) step.stagger = number(value.stagger, 0, 0, 5);
    if (value.with === true || value.parallel === true) step.with = true;
    if (typeof value.ease === "string" && EASES.has(value.ease)) step.ease = value.ease;
    if (type === "move") {
      const to = pair(value.to, null), by = pair(value.by, null), along = value.along === undefined ? "" : String(value.along);
      if (along) {
        if (!ids.has(along)) throw sceneError(`unknown along "${along}"`, path);
        step.along = along;
        const range = pair(value.range, [0, 1], 0, 1);
        step.range = range;
      } else if (to) step.to = to;
      else if (by) step.by = by;
      else throw sceneError("move needs to:[x,y], by:[dx,dy] or along:<path id>", path);
    } else if (type === "scale") step.to = number(value.to ?? value.scale, 1, 0, 50);
    else if (type === "rotate") step.to = number(value.to ?? value.angle, 0, -36000, 36000);
    else if (type === "color") {
      const fill = color(value.fill, undefined), stroke = color(value.stroke ?? value.color, undefined);
      if (!fill && !stroke) throw sceneError("color needs fill or stroke", path);
      if (fill) step.fill = fill;
      if (stroke) step.stroke = stroke;
    } else if (type === "morph") {
      const into = String(value.to ?? value.into ?? "");
      if (!ids.has(into)) throw sceneError("morph needs to: the id of a path actor", path);
      step.to = into;
    } else if (type === "count") {
      step.from = number(value.from, 0);
      step.to = number(value.to, 100);
      step.decimals = number(value.decimals, 0, 0, 6);
      if (value.prefix !== undefined) step.prefix = text(value.prefix, 20);
      if (value.suffix !== undefined) step.suffix = text(value.suffix, 20);
    } else if (type === "camera") {
      step.zoom = number(value.zoom, 1, 0.1, 20);
      const center = pair(value.center, null);
      if (center) step.center = center;
      if (value.target !== undefined) {
        for (const target of targets) if (!ids.has(target)) throw sceneError(`unknown target "${target}"`, path);
        if (targets.length) step.target = targets;
      }
    } else if (type === "pulse") step.to = number(value.to ?? value.scale, 1.2, 0.2, 5);
    return step;
  }
  function normalizeMotion(value) {
    if (!Array.isArray(value.actors) || !value.actors.length || value.actors.length > LIMITS.actors) throw sceneError(`actors must list 1 to ${LIMITS.actors} actors`);
    const ids = new Set(), actors = value.actors.map((actor, index) => normalizeActor(actor, index, ids)),
      byId = new Map(actors.map(actor => [actor.id, actor])), grouped = new Set();
    for (const actor of actors) {
      if (actor.type === "fn" && byId.get(actor.axes)?.type !== "axes") throw sceneError(`fn "${actor.id}" needs axes to name an axes actor`);
      if (actor.type !== "group") continue;
      for (const child of actor.children) {
        const target = byId.get(child);
        if (!target || child === actor.id) throw sceneError(`group "${actor.id}" has unknown child "${child}"`);
        if (target.type === "group") throw sceneError(`group "${actor.id}" cannot contain another group`);
        if (grouped.has(child)) throw sceneError(`actor "${child}" belongs to more than one group`);
        grouped.add(child);
      }
    }
    const rawBeats = Array.isArray(value.beats) ? value.beats : Array.isArray(value.steps) ? [{ steps:value.steps }] : [];
    if (rawBeats.length > LIMITS.beats) throw sceneError(`beats at most ${LIMITS.beats}`);
    let stepCount = 0;
    const beats = rawBeats.map((beat, beatIndex) => {
      const path = `beats[${beatIndex}]`;
      if (!isObject(beat)) throw sceneError("must be an object", path);
      const steps = Array.isArray(beat.steps) ? beat.steps : [];
      stepCount += steps.length;
      if (stepCount > LIMITS.steps) throw sceneError(`at most ${LIMITS.steps} steps in total`);
      const normalized = { steps:steps.map((step, stepIndex) => normalizeStep(step, `${path}.steps[${stepIndex}]`, ids)) };
      if (beat.caption !== undefined) normalized.caption = text(beat.caption, LIMITS.caption);
      if (beat.pause !== undefined) normalized.pause = number(beat.pause, 0, 0, 30);
      for (const step of normalized.steps) if (step.do === "morph" && (byId.get(step.to)?.type !== "path" || step.target.some(id => byId.get(id)?.type !== "path"))) throw sceneError("morph works between path actors", `${path}`);
      for (const step of normalized.steps) if (step.along && !["path", "fn", "line", "arrow", "polyline", "polygon", "circle", "ellipse", "rect"].includes(byId.get(step.along)?.type)) throw sceneError("along needs a path-like actor", path);
      return normalized;
    });
    return { actors, beats };
  }

  // ---------- Physics (matter-js) ----------
  function normalizePhysics(value) {
    if (!Array.isArray(value.bodies) || !value.bodies.length || value.bodies.length > LIMITS.bodies) throw sceneError(`bodies must list 1 to ${LIMITS.bodies} bodies`);
    const ids = new Set();
    const bodies = value.bodies.map((body, index) => {
      const path = `bodies[${index}]`;
      if (!isObject(body)) throw sceneError("must be an object", path);
      const shape = String(body.shape || body.type || "circle");
      if (!BODY_SHAPES.has(shape)) throw sceneError(`unknown shape "${shape}" (use circle, rect, polygon, segment)`, path);
      const id = String(body.id || `body${index + 1}`);
      if (!ID_PATTERN.test(id) || ids.has(id)) throw sceneError("needs a unique id", path);
      ids.add(id);
      const result = { id, shape, x:number(body.x, 100), y:number(body.y, 100) };
      if (shape === "circle") result.r = number(body.r, 20, 1, 2000);
      if (shape === "rect") Object.assign(result, { w:number(body.w ?? body.width, 60, 1, 10000), h:number(body.h ?? body.height, 40, 1, 10000) });
      if (shape === "polygon") Object.assign(result, { sides:Math.round(number(body.sides, 5, 3, 12)), r:number(body.r, 30, 1, 2000) });
      if (shape === "segment") {
        const to = pair(body.to, null);
        Object.assign(result, to ? { x2:to[0], y2:to[1] } : { x2:number(body.x2, result.x + 200), y2:number(body.y2, result.y) }, { thickness:number(body.thickness, 10, 1, 200) });
        result.static = body.static !== false;
      } else if (body.static === true) result.static = true;
      for (const key of ["angle"]) if (body[key] !== undefined) result[key] = number(body[key], 0, -3600, 3600);
      for (const [key, min, max] of [["restitution", 0, 1.5], ["friction", 0, 1], ["frictionAir", 0, 1], ["density", 0.00001, 1], ["angularVelocity", -5, 5]]) if (body[key] !== undefined) result[key] = number(body[key], 0, min, max);
      const velocity = pair(body.velocity, null, -500, 500);
      if (velocity) result.velocity = velocity;
      const fill = color(body.fill ?? body.color, undefined), stroke = color(body.stroke, undefined);
      if (fill) result.fill = fill;
      if (stroke) result.stroke = stroke;
      if (body.label !== undefined) result.label = text(body.label, 60);
      if (body.trail === true) result.trail = true;
      return result;
    });
    const constraints = (Array.isArray(value.constraints) ? value.constraints : []).slice(0, LIMITS.constraints).map((item, index) => {
      const path = `constraints[${index}]`;
      if (!isObject(item)) throw sceneError("must be an object", path);
      const a = item.a === undefined ? "" : String(item.a), b = item.b === undefined ? "" : String(item.b);
      if (a && !ids.has(a) || b && !ids.has(b)) throw sceneError("a and b must be body ids", path);
      const anchor = pair(item.anchor, null);
      if (!a && !b || !b && !anchor && !a) throw sceneError("needs a body a and either a body b or an anchor [x, y]", path);
      const result = { a, b };
      if (anchor) result.anchor = anchor;
      for (const [key, min, max] of [["length", 0, 1e4], ["stiffness", 0, 1], ["damping", 0, 1]]) if (item[key] !== undefined) result[key] = number(item[key], 0, min, max);
      const pointA = pair(item.pointA, null), pointB = pair(item.pointB, null);
      if (pointA) result.pointA = pointA;
      if (pointB) result.pointB = pointB;
      result.render = ["line", "spring", "none"].includes(item.render) ? item.render : "line";
      return result;
    });
    const labels = (Array.isArray(value.labels) ? value.labels : []).slice(0, LIMITS.labels).map(item => ({ text:text(item?.text, 80), x:number(item?.x, 0), y:number(item?.y, 0), size:number(item?.size, 24, 8, 120) })).filter(item => item.text);
    const walls = value.walls === false ? "none" : ["floor", "box", "none"].includes(value.walls) ? value.walls : "box";
    return {
      bodies,
      constraints,
      labels,
      gravity:pair(value.gravity, [0, 1], -10, 10),
      walls,
      duration:optionalNumber(value.duration, 1, 600),
    };
  }

  // ---------- Puppet: the user's own ink, rigged ----------
  // Ink is stored once as SVG paths in stage coordinates. Parts group ink and
  // move rigidly about a pivot, nested under their parent part.
  const PUPPET_MOTIONS = Object.freeze({
    swing:120, flap:120, sway:45, wiggle:60, spin:1, bob:400, float:400, hop:600, travel:3000, shake:60, orbit:600,
    breathe:0.4, stretch:0.5, blink:1, flicker:0.8,
  });
  function normalizePuppet(value) {
    if (!Array.isArray(value.ink) || !value.ink.length || value.ink.length > 400) throw sceneError("puppet ink must list 1 to 400 stroke paths (PenEcho fills it from sketchInk)");
    const ink = value.ink.map((item, index) => {
      const path = `ink[${index}]`;
      if (!isObject(item)) throw sceneError("must be an object", path);
      const d = text(item.d, 20000).trim();
      if (!d || !PATH_PATTERN.test(d)) throw sceneError("d must be SVG path data", path);
      const result = { d, width:number(item.width, 3, 0.1, 200) };
      const stroke = color(item.color, undefined);
      if (stroke) result.color = stroke;
      return result;
    });
    if (!Array.isArray(value.parts) || !value.parts.length || value.parts.length > 32) throw sceneError("puppet parts must list 1 to 32 parts");
    const ids = new Set(), owned = new Set();
    const parts = value.parts.map((part, index) => {
      const path = `parts[${index}]`;
      if (!isObject(part)) throw sceneError("must be an object", path);
      const id = String(part.id ?? "");
      if (!ID_PATTERN.test(id) || ids.has(id)) throw sceneError("needs a unique id", path);
      ids.add(id);
      const inkList = (Array.isArray(part.ink) ? part.ink : []).map(item => Number(item));
      for (const item of inkList) {
        if (!Number.isInteger(item) || item < 0 || item >= ink.length) throw sceneError(`unknown ink index ${item}`, path);
        if (owned.has(item)) throw sceneError(`ink ${item} belongs to more than one part`, path);
        owned.add(item);
      }
      const motion = (Array.isArray(part.motion) ? part.motion : []).slice(0, 4).map((item, motionIndex) => {
        const type = String(item?.type || "");
        if (!Object.hasOwn(PUPPET_MOTIONS, type)) throw sceneError(`unknown motion "${type}" (use ${Object.keys(PUPPET_MOTIONS).join(", ")})`, `${path}.motion[${motionIndex}]`);
        const limit = PUPPET_MOTIONS[type], result = { type, amp:number(item.amp, 1, -limit, limit), period:number(item.period, 1, 0.1, 30) };
        const phase = number(item.phase, 0, 0, 1);
        if (phase) result.phase = phase;
        return result;
      });
      const result = { id, ink:inkList, pivot:pair(part.pivot, [0, 0]), motion };
      if (part.parent !== undefined && part.parent !== "") result.parent = String(part.parent);
      return result;
    });
    const byId = new Map(parts.map(part => [part.id, part]));
    for (const part of parts) {
      if (!part.parent) continue;
      if (!byId.has(part.parent) || part.parent === part.id) throw sceneError(`part "${part.id}" has unknown parent "${part.parent}"`);
      const seen = new Set([part.id]);
      for (let cursor = byId.get(part.parent); cursor; cursor = byId.get(cursor.parent)) {
        if (seen.has(cursor.id)) throw sceneError(`part "${part.id}" has a parent cycle`);
        seen.add(cursor.id);
      }
    }
    const effects = isObject(value.effects) ? value.effects : {};
    const result = { ink, parts, effects:{ shadow:effects.shadow === true, intro:effects.intro !== false, accents:effects.accents !== false } };
    const ground = optionalNumber(effects.ground, -1e5, 1e5);
    if (ground !== undefined) result.effects.ground = ground;
    if (value.subject !== undefined) result.subject = text(value.subject, 60);
    return result;
  }

  // ---------- Pseudo-3D (Zdog) ----------
  function normalize3d(value) {
    if (!Array.isArray(value.shapes) || !value.shapes.length || value.shapes.length > LIMITS.shapes) throw sceneError(`shapes must list 1 to ${LIMITS.shapes} shapes`);
    const ids = new Set();
    const shapes = value.shapes.map((shape, index) => {
      const path = `shapes[${index}]`;
      if (!isObject(shape)) throw sceneError("must be an object", path);
      const type = String(shape.type || "");
      if (!SHAPE_TYPES.has(type)) throw sceneError(`unknown type "${type}" (use ${[...SHAPE_TYPES].join(", ")})`, path);
      const id = shape.id === undefined ? `shape${index + 1}` : String(shape.id);
      if (!ID_PATTERN.test(id) || ids.has(id)) throw sceneError("needs a unique id", path);
      ids.add(id);
      const result = { id, type, translate:triple(shape.translate ?? shape.position, [0, 0, 0]), rotate:triple(shape.rotate, [0, 0, 0]) };
      if (shape.parent !== undefined) result.parent = String(shape.parent);
      const shapeColor = color(shape.color ?? shape.fill, undefined);
      if (shapeColor) result.color = shapeColor;
      if (shape.stroke !== undefined) result.stroke = number(shape.stroke, 2, 0, 1000);
      if (typeof shape.filled === "boolean") result.filled = shape.filled;
      else if (shape.fill !== undefined) result.filled = shape.fill !== false;
      for (const key of ["width", "height", "depth", "diameter", "length", "radius", "cornerRadius"]) if (shape[key] !== undefined) result[key] = number(shape[key], 20, 0, 1e4);
      if (shape.sides !== undefined) result.sides = Math.round(number(shape.sides, 6, 3, 24));
      if (Array.isArray(shape.path)) result.path = shape.path.slice(0, LIMITS.points).map((point, pointIndex) => {
        const parsed = triple(point, null);
        if (!parsed) throw sceneError("path points must be [x, y, z]", `${path}.path[${pointIndex}]`);
        return parsed;
      });
      if (type === "line" && (!result.path || result.path.length < 2)) throw sceneError("line needs path with 2 or more [x, y, z] points", path);
      if (type === "path" && (!result.path || result.path.length < 2)) throw sceneError("path needs 2 or more [x, y, z] points", path);
      if (shape.closed !== undefined) result.closed = shape.closed === true;
      if (isObject(shape.faces)) {
        result.faces = {};
        for (const face of ["front", "rear", "left", "right", "top", "bottom"]) {
          const faceColor = color(shape.faces[face], undefined);
          if (faceColor) result.faces[face] = faceColor;
        }
      }
      return result;
    });
    for (const shape of shapes) if (shape.parent && (!ids.has(shape.parent) || shape.parent === shape.id)) throw sceneError(`shape "${shape.id}" has unknown parent "${shape.parent}"`);
    return {
      shapes,
      zoom:number(value.zoom, 1, 0.05, 40),
      spin:triple(value.spin, [0, 20, 0]),
      view:triple(value.view ?? value.rotate, [-12, 24, 0]),
      drag:value.drag !== false,
    };
  }

  function normalize(value) {
    let spec = value;
    if (typeof spec === "string") {
      if (new TextEncoder().encode(spec).length > MAX_SOURCE_BYTES) throw sceneError(`scene source exceeds ${MAX_SOURCE_BYTES / 1024} KB`);
      try { spec = JSON.parse(spec); } catch { throw sceneError("scene source is not valid JSON"); }
    }
    if (!isObject(spec)) throw sceneError("scene must be a JSON object");
    const engine = spec.engine === undefined ? (spec.bodies ? "physics" : spec.shapes ? "3d" : spec.parts && spec.ink ? "puppet" : "motion") : String(spec.engine);
    if (!ENGINES.has(engine)) throw sceneError(`engine must be motion, physics, 3d or puppet`);
    const size = pair(spec.size, [960, 540], 60, 8000);
    const common = {
      engine,
      size,
      background:color(spec.background, "transparent"),
      speed:number(spec.speed, 1, 0.1, 8),
      loop:spec.loop === true,
      autoplay:spec.autoplay !== false,
      controls:spec.controls !== false,
    };
    if (spec.caption !== undefined) common.caption = text(spec.caption, LIMITS.caption);
    const body = engine === "physics" ? normalizePhysics(spec) : engine === "3d" ? normalize3d(spec) : engine === "puppet" ? normalizePuppet(spec) : normalizeMotion(spec);
    const result = { ...common, ...body };
    if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_SOURCE_BYTES) throw sceneError(`scene source exceeds ${MAX_SOURCE_BYTES / 1024} KB`);
    return result;
  }
  // Stable, diff-friendly source: one actor, beat step, body or shape per line,
  // so a refinement patch touches only the lines that change.
  function formatSource(value) {
    const scene = normalize(value);
    const multiline = item => Array.isArray(item) && item.some(entry => isObject(entry));
    const format = (item, indent) => {
      if (multiline(item)) return `[\n${item.map(entry => indent + "  " + format(entry, indent + "  ")).join(",\n")}\n${indent}]`;
      if (isObject(item) && Object.values(item).some(multiline)) {
        const entries = Object.entries(item).filter(([, entry]) => entry !== undefined)
          .map(([key, entry]) => `${indent}  ${JSON.stringify(key)}: ${format(entry, indent + "  ")}`);
        return `{\n${entries.join(",\n")}\n${indent}}`;
      }
      return JSON.stringify(item);
    };
    return `${format(scene, "")}\n`;
  }
  function validate(value) {
    try { return { ok:true, scene:normalize(value) }; }
    catch (error) { return { ok:false, error:String(error?.message || error) }; }
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);
  }
  function scriptJson(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  // The Widget document carries only the validated scene; the Widget host adds
  // the pinned runtime scripts when it sees data-penecho-scene.
  function documentFor(value, options = {}) {
    const scene = normalize(value),
      title = text(options.title, 120) || "Scene",
      language = options.language === "zh" || /[\u3400-\u9fff]/.test(title) ? "zh-CN" : "en";
    return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}#penecho-scene{position:relative;width:100%;height:100%}</style>
</head>
<body>
  <main id="penecho-scene" data-penecho-scene-engine="${scene.engine}" aria-label="${escapeHtml(title)}"></main>
  <script type="application/json" data-penecho-scene>${scriptJson(scene)}</script>
</body>
</html>`;
  }
  function isSceneFormat(value) {
    return String(value || "").trim().toLowerCase() === FORMAT;
  }
  return Object.freeze({
    FORMAT,
    FRAMEWORK_VERSION,
    COPY_LABEL,
    PLACEHOLDER_HTML,
    MAX_SOURCE_BYTES,
    ENGINES,
    EASES,
    LIMITS,
    compileExpression,
    normalize,
    validate,
    documentFor,
    formatSource,
    isSceneFormat,
  });
});
