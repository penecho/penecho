"use strict";
// PenEcho scene runtime. Runs inside the sandboxed Widget document and renders
// the validated scene JSON with vendored MIT engines:
//   motion  → SVG + anime.js timeline
//   physics → canvas + matter-js
//   3d      → canvas + Zdog
// The Widget host injects this file (and only the engine it needs) when the
// document contains <script type="application/json" data-penecho-scene>.
(() => {
  const root = document.getElementById("penecho-scene") || document.body,
    source = document.querySelector("script[type='application/json'][data-penecho-scene]");
  if (!source || root.dataset.penechoSceneMounted === "1") return;
  root.dataset.penechoSceneMounted = "1";

  const PALETTE = Object.freeze({
    accent:"#2563eb", ink:"#1f2937", muted:"#6b7280", blue:"#2563eb", red:"#ef4444", green:"#10b981", orange:"#f59e0b",
    purple:"#8b5cf6", teal:"#14b8a6", yellow:"#eab308", pink:"#ec4899", gray:"#9ca3af", grey:"#9ca3af", white:"#ffffff",
    black:"#111827", paper:"#fffdf7", none:"none", transparent:"transparent",
  });
  const FONTS = Object.freeze({
    sans:'Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
    serif:'"Iowan Old Style", Georgia, "Songti SC", serif',
    mono:'"SFMono-Regular", Menlo, Consolas, monospace',
    hand:'"Comic Sans MS", "Chalkboard SE", "Kaiti SC", cursive',
  });
  const SVG_NS = "http://www.w3.org/2000/svg";
  const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const zh = /^zh/i.test(document.documentElement.lang || "");
  const copy = zh
    ? { replay:"重播", play:"播放", pause:"暂停", speed:"速度", error:"场景无法渲染：" }
    : { replay:"Replay", play:"Play", pause:"Pause", speed:"Speed", error:"This scene could not be rendered: " };
  const color = value => (value && PALETTE[value]) || value || undefined;
  let notified = false;
  function notifyUpdated() {
    if (notified) return;
    notified = true;
    try { parent.postMessage({ type:"penecho-widget-updated" }, "*"); } catch {}
  }
  function showError(error) {
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.className = "pes-error";
    message.textContent = copy.error + String(error?.message || error).slice(0, 240);
    root.append(message);
    notifyUpdated();
  }

  const style = document.createElement("style");
  style.textContent = `
#penecho-scene{position:relative;width:100%;height:100%;overflow:hidden;font-family:${FONTS.sans}}
#penecho-scene>.pes-stage{position:absolute;inset:0;width:100%;height:100%;display:block}
#penecho-scene .pes-actor{transform-box:fill-box;transform-origin:center}
#penecho-scene .pes-caption{position:absolute;left:50%;bottom:clamp(10px,3.2%,28px);max-width:86%;transform:translateX(-50%);padding:.35em .8em;border-radius:.6em;background:rgba(255,255,255,.86);color:#1f2937;font:600 clamp(14px,2.6cqw,30px)/1.35 ${FONTS.sans};text-align:center;box-shadow:0 1px 3px rgba(15,23,42,.12);transition:opacity .25s ease;pointer-events:none}
#penecho-scene .pes-caption:empty{opacity:0}
#penecho-scene .pes-controls{position:absolute;right:clamp(8px,2%,18px);bottom:clamp(8px,2%,18px);display:flex;align-items:center;gap:6px;padding:5px;border-radius:999px;background:rgba(255,255,255,.9);box-shadow:0 2px 10px rgba(15,23,42,.16);opacity:0;transition:opacity .2s ease;font:600 13px/1 ${FONTS.sans}}
#penecho-scene:hover .pes-controls,#penecho-scene .pes-controls:focus-within,#penecho-scene.pes-show-controls .pes-controls{opacity:1}
#penecho-scene .pes-controls button{display:grid;place-items:center;min-width:30px;height:30px;padding:0 8px;border:0;border-radius:999px;background:transparent;color:#1f2937;font:inherit;cursor:pointer}
#penecho-scene .pes-controls button:hover,#penecho-scene .pes-controls button:focus-visible{background:rgba(37,99,235,.12);color:#1d4ed8;outline:none}
#penecho-scene .pes-controls svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#penecho-scene .pes-progress{position:relative;width:clamp(60px,18cqw,160px);height:4px;border-radius:2px;background:rgba(31,41,55,.15);cursor:pointer}
#penecho-scene .pes-progress>i{position:absolute;inset:0 auto 0 0;width:0;border-radius:2px;background:#2563eb}
#penecho-scene .pes-error{position:absolute;inset:0;display:grid;place-items:center;margin:0;padding:24px;color:#b42318;font:600 16px/1.4 ${FONTS.sans};text-align:center}
`;
  document.head.append(style);

  const ICONS = {
    replay:'<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/></svg>',
    play:'<svg viewBox="0 0 24 24"><path d="M7 5v14l11-7L7 5Z"/></svg>',
    pause:'<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
  };
  // Shared transport: every engine exposes replay/play/pause/speed.
  function createControls(player, options = {}) {
    const bar = document.createElement("div");
    bar.className = "pes-controls";
    const button = (name, label, onClick) => {
      const element = document.createElement("button");
      element.type = "button";
      element.innerHTML = ICONS[name] || "";
      element.setAttribute("aria-label", label);
      element.title = label;
      element.addEventListener("click", event => { event.preventDefault(); onClick(); });
      return element;
    };
    const replay = button("replay", copy.replay, () => player.replay()),
      toggle = button("pause", copy.pause, () => player.toggle()),
      speeds = [0.5, 1, 1.5, 2],
      speed = document.createElement("button");
    speed.type = "button";
    speed.title = copy.speed;
    speed.setAttribute("aria-label", copy.speed);
    speed.addEventListener("click", event => {
      event.preventDefault();
      const next = speeds[(speeds.indexOf(player.localSpeed) + 1) % speeds.length] || 1;
      player.setLocalSpeed(next);
      sync();
    });
    const parts = [replay, toggle];
    let progress = null;
    if (options.progress) {
      progress = document.createElement("div");
      progress.className = "pes-progress";
      progress.append(document.createElement("i"));
      progress.addEventListener("pointerdown", event => {
        const rect = progress.getBoundingClientRect();
        player.seekFraction(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
      });
      parts.push(progress);
    }
    parts.push(speed);
    bar.append(...parts);
    function sync() {
      const playing = player.playing();
      toggle.innerHTML = playing ? ICONS.pause : ICONS.play;
      toggle.setAttribute("aria-label", playing ? copy.pause : copy.play);
      toggle.title = playing ? copy.pause : copy.play;
      speed.textContent = `${player.localSpeed}×`;
      if (progress) progress.firstChild.style.width = `${(player.fraction() * 100).toFixed(2)}%`;
    }
    root.append(bar);
    return { sync };
  }
  // Parent controls (header Replay) arrive through the Widget host relay.
  function listen(player) {
    addEventListener("message", event => {
      const data = event.data;
      if (data?.type !== "penecho-scene-control") return;
      if (data.action === "replay") player.replay();
      else if (data.action === "pause") player.pause();
      else if (data.action === "play") player.play();
      else if (data.action === "toggle") player.toggle();
    });
  }

  // ---------- Motion: SVG + anime.js ----------
  function mountMotion(scene) {
    const anime = globalThis.anime;
    if (!anime?.createTimeline) throw new Error("anime.js is not available");
    const [W, H] = scene.size;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "pes-stage");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("role", "img");
    if (scene.background && scene.background !== "transparent") {
      const backdrop = document.createElementNS(SVG_NS, "rect");
      Object.entries({ x:0, y:0, width:W, height:H, fill:color(scene.background) }).forEach(([key, value]) => backdrop.setAttribute(key, value));
      svg.append(backdrop);
    }
    const defs = document.createElementNS(SVG_NS, "defs");
    svg.append(defs);
    root.append(svg);
    const markers = new Map();
    function markerFor(stroke, size) {
      const key = `${stroke}:${size}`;
      if (markers.has(key)) return markers.get(key);
      const id = `pes-arrow-${markers.size}`,
        marker = document.createElementNS(SVG_NS, "marker"),
        head = document.createElementNS(SVG_NS, "path");
      marker.setAttribute("id", id);
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "8");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerUnits", "userSpaceOnUse");
      marker.setAttribute("markerWidth", String(size));
      marker.setAttribute("markerHeight", String(size));
      marker.setAttribute("orient", "auto-start-reverse");
      head.setAttribute("d", "M0 0L10 5L0 10Z");
      head.setAttribute("fill", stroke);
      marker.append(head);
      defs.append(marker);
      markers.set(key, id);
      return id;
    }
    const compile = globalThis.PENECHO_SCENE?.compileExpression;
    const actors = new Map(), elements = new Map();
    const set = (element, attributes) => { for (const [key, value] of Object.entries(attributes)) if (value !== undefined && value !== null) element.setAttribute(key, String(value)); };
    const make = (tag, attributes = {}) => { const element = document.createElementNS(SVG_NS, tag); set(element, attributes); return element; };
    function paint(element, actor, defaults) {
      const fill = actor.fill ?? defaults.fill, stroke = actor.stroke ?? defaults.stroke,
        width = actor.width ?? defaults.width;
      set(element, {
        fill:color(fill) || "none",
        stroke:color(stroke) || "none",
        "stroke-width":stroke && stroke !== "none" ? width : undefined,
        "stroke-linecap":"round",
        "stroke-linejoin":"round",
        "stroke-dasharray":actor.dash ? actor.dash.join(" ") : undefined,
      });
    }
    function axesMapper(axes) {
      const [bx, by, bw, bh] = axes.box, [x0, x1] = axes.xRange, [y0, y1] = axes.yRange;
      return {
        x:value => bx + (value - x0) / (x1 - x0) * bw,
        y:value => by + bh - (value - y0) / (y1 - y0) * bh,
      };
    }
    function niceStep(span, target) {
      const raw = span / Math.max(1, target), power = Math.pow(10, Math.floor(Math.log10(raw))), unit = raw / power;
      return (unit >= 5 ? 10 : unit >= 2 ? 5 : unit >= 1 ? 2 : 1) * power;
    }
    function buildAxes(actor) {
      const group = make("g"), map = axesMapper(actor), [bx, by, bw, bh] = actor.box,
        ink = color(actor.stroke) || PALETTE.muted, width = actor.width ?? 2,
        originX = Math.max(bx, Math.min(bx + bw, map.x(0))), originY = Math.max(by, Math.min(by + bh, map.y(0))),
        fontSize = Math.max(12, Math.min(28, Math.min(bw, bh) / 18));
      const xs = niceStep(actor.xRange[1] - actor.xRange[0], actor.ticks || 8), ys = niceStep(actor.yRange[1] - actor.yRange[0], actor.ticks || 6);
      if (actor.grid) {
        for (let v = Math.ceil(actor.xRange[0] / xs) * xs; v <= actor.xRange[1] + 1e-9; v += xs) group.append(make("line", { x1:map.x(v), y1:by, x2:map.x(v), y2:by + bh, stroke:ink, "stroke-opacity":.18, "stroke-width":1 }));
        for (let v = Math.ceil(actor.yRange[0] / ys) * ys; v <= actor.yRange[1] + 1e-9; v += ys) group.append(make("line", { x1:bx, y1:map.y(v), x2:bx + bw, y2:map.y(v), stroke:ink, "stroke-opacity":.18, "stroke-width":1 }));
      }
      const head = markerFor(ink, 12 + width * 2);
      group.append(make("line", { x1:bx, y1:originY, x2:bx + bw, y2:originY, stroke:ink, "stroke-width":width, "marker-end":`url(#${head})`, "stroke-linecap":"round" }));
      group.append(make("line", { x1:originX, y1:by + bh, x2:originX, y2:by, stroke:ink, "stroke-width":width, "marker-end":`url(#${head})`, "stroke-linecap":"round" }));
      if (actor.labels) {
        const format = v => Math.abs(v) < 1e-9 ? "0" : Number(v.toPrecision(4)).toString();
        for (let v = Math.ceil(actor.xRange[0] / xs) * xs; v <= actor.xRange[1] + 1e-9; v += xs) {
          if (Math.abs(v) < 1e-9) continue;
          group.append(make("line", { x1:map.x(v), y1:originY - 5, x2:map.x(v), y2:originY + 5, stroke:ink, "stroke-width":width }));
          const label = make("text", { x:map.x(v), y:originY + fontSize * 1.2, "font-size":fontSize, "text-anchor":"middle", "dominant-baseline":"middle", fill:ink });
          label.textContent = format(v);
          group.append(label);
        }
        for (let v = Math.ceil(actor.yRange[0] / ys) * ys; v <= actor.yRange[1] + 1e-9; v += ys) {
          if (Math.abs(v) < 1e-9) continue;
          group.append(make("line", { x1:originX - 5, y1:map.y(v), x2:originX + 5, y2:map.y(v), stroke:ink, "stroke-width":width }));
          const label = make("text", { x:originX - fontSize * .5, y:map.y(v), "font-size":fontSize, "text-anchor":"end", "dominant-baseline":"middle", fill:ink });
          label.textContent = format(v);
          group.append(label);
        }
      }
      for (const [key, x, y, anchor] of [["xLabel", bx + bw, originY - fontSize * 1.1, "end"], ["yLabel", originX + fontSize * .6, by + fontSize * .4, "start"]]) {
        if (!actor[key]) continue;
        const label = make("text", { x, y, "font-size":fontSize * 1.1, "text-anchor":anchor, "dominant-baseline":"middle", fill:ink, "font-style":"italic" });
        label.textContent = actor[key];
        group.append(label);
      }
      return group;
    }
    function fnPath(actor, time = 0) {
      const axes = actors.get(actor.axes), map = axesMapper(axes),
        evaluate = compile(actor.expr, ["x", "t"]),
        [d0, d1] = actor.domain || axes.xRange, [y0, y1] = axes.yRange, span = y1 - y0,
        parts = [];
      let open = false;
      for (let index = 0; index <= actor.samples; index++) {
        const x = d0 + (d1 - d0) * index / actor.samples, y = evaluate({ x, t:time });
        if (!Number.isFinite(y) || y < y0 - span * 2 || y > y1 + span * 2) { open = false; continue; }
        parts.push(`${open ? "L" : "M"}${map.x(x).toFixed(2)} ${map.y(y).toFixed(2)}`);
        open = true;
      }
      return parts.join("") || `M${map.x(d0)} ${map.y(0)}`;
    }
    for (const actor of scene.actors) {
      actors.set(actor.id, actor);
      let element;
      switch (actor.type) {
        case "rect": element = make("rect", { x:actor.x, y:actor.y, width:actor.w, height:actor.h, rx:actor.r || undefined }); paint(element, actor, { stroke:actor.fill ? undefined : "ink", width:3 }); break;
        case "circle": element = make("circle", { cx:actor.x, cy:actor.y, r:actor.r }); paint(element, actor, { stroke:actor.fill ? undefined : "ink", width:3 }); break;
        case "ellipse": element = make("ellipse", { cx:actor.x, cy:actor.y, rx:actor.rx, ry:actor.ry }); paint(element, actor, { stroke:actor.fill ? undefined : "ink", width:3 }); break;
        case "line":
        case "arrow": {
          element = make("line", { x1:actor.x1, y1:actor.y1, x2:actor.x2, y2:actor.y2 });
          paint(element, actor, { stroke:"ink", width:3 });
          if (actor.type === "arrow") {
            const id = markerFor(color(actor.stroke) || PALETTE.ink, actor.head);
            element.setAttribute("marker-end", `url(#${id})`);
            if (actor.bothEnds) element.setAttribute("marker-start", `url(#${id})`);
          }
          break;
        }
        case "path": element = make("path", { d:actor.d }); paint(element, actor, { stroke:actor.fill ? undefined : "ink", width:3 }); break;
        case "polyline": element = make("polyline", { points:actor.points.map(point => point.join(",")).join(" ") }); paint(element, actor, { stroke:"ink", width:3 }); break;
        case "polygon": element = make("polygon", { points:actor.points.map(point => point.join(",")).join(" ") }); paint(element, actor, { stroke:actor.fill ? undefined : "ink", width:3 }); break;
        case "text": {
          element = make("text", {
            x:actor.x, y:actor.y, "font-size":actor.size, "text-anchor":actor.anchor || "middle", "dominant-baseline":"middle",
            "font-weight":actor.weight || 500, "font-style":actor.italic ? "italic" : undefined, fill:color(actor.fill) || PALETTE.ink,
            stroke:actor.stroke ? color(actor.stroke) : undefined, "font-family":FONTS[actor.font || "sans"],
          });
          element.textContent = actor.text;
          break;
        }
        case "axes": element = buildAxes(actor); break;
        case "fn": element = make("path", { d:fnPath(actor) }); paint(element, { ...actor, fill:"none" }, { stroke:"accent", width:4 }); break;
        case "group": element = make("g"); break;
        default: continue;
      }
      element.classList.add("pes-actor");
      element.dataset.actor = actor.id;
      if (actor.opacity !== undefined) element.style.opacity = String(actor.opacity);
      elements.set(actor.id, element);
      svg.append(element);
    }
    for (const actor of scene.actors) if (actor.type === "group") for (const child of actor.children) elements.get(actor.id).append(elements.get(child));

    // Reference points for move:{to} (the point an author would call "its position").
    const reference = new Map();
    for (const actor of scene.actors) {
      const element = elements.get(actor.id);
      let point;
      if (["circle", "ellipse", "text"].includes(actor.type)) point = [actor.x, actor.y];
      else if (actor.type === "rect") point = [actor.x + actor.w / 2, actor.y + actor.h / 2];
      else if (actor.type === "line" || actor.type === "arrow") point = [(actor.x1 + actor.x2) / 2, (actor.y1 + actor.y2) / 2];
      else {
        try { const box = element.getBBox(); point = [box.x + box.width / 2, box.y + box.height / 2]; }
        catch { point = [0, 0]; }
      }
      reference.set(actor.id, point);
    }
    const geometry = element => element.matches("path,line,rect,circle,ellipse,polyline,polygon") ? [element] : [...element.querySelectorAll("path,line,rect,circle,ellipse,polyline,polygon")];
    const baseOpacity = id => actors.get(id)?.opacity ?? 1;
    const offsets = new Map(scene.actors.map(actor => [actor.id, { x:0, y:0, scale:1, rotate:actor.rotate || 0 }]));
    const drawables = new Map();
    const firstUse = new Map();
    for (const beat of scene.beats) for (const step of beat.steps) for (const id of step.target || []) if (!firstUse.has(id)) firstUse.set(id, step.do);
    const fullText = new Map(scene.actors.filter(actor => actor.type === "text").map(actor => [actor.id, actor.text]));

    // Initial state: anything that first appears is hidden until its step.
    function resetState() {
      for (const actor of scene.actors) {
        const element = elements.get(actor.id), first = firstUse.get(actor.id),
          hiddenStart = actor.hidden || ["fadeIn", "appear", "write", "count"].includes(first);
        anime.utils.set(element, { translateX:0, translateY:0, scale:1, rotate:actor.rotate || 0, opacity:hiddenStart ? 0 : baseOpacity(actor.id) });
        if (first === "write" && fullText.has(actor.id)) element.textContent = "";
        else if (fullText.has(actor.id)) element.textContent = fullText.get(actor.id);
        if (first === "draw") for (const drawable of drawablesFor(actor.id)) drawable.setAttribute("draw", "0 0");
      }
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      camera.x = 0; camera.y = 0; camera.w = W; camera.h = H;
    }
    function drawablesFor(id) {
      if (!drawables.has(id)) drawables.set(id, anime.svg.createDrawable(geometry(elements.get(id))));
      return drawables.get(id);
    }
    const camera = { x:0, y:0, w:W, h:H };
    const applyCamera = () => svg.setAttribute("viewBox", `${camera.x.toFixed(2)} ${camera.y.toFixed(2)} ${camera.w.toFixed(2)} ${camera.h.toFixed(2)}`);

    const timeline = anime.createTimeline({ autoplay:false, loop:scene.loop, defaults:{ ease:"inOutQuad" } });
    const revealed = new Set(), cameraState = { x:0, y:0, w:W, h:H };
    const beatStarts = [];
    let cursor = 0, previousStart = 0;
    const ms = seconds => Math.max(1, seconds * 1000);
    for (const beat of scene.beats) {
      beatStarts.push({ at:cursor, caption:beat.caption || "" });
      for (const step of beat.steps) {
        const start = (step.with ? previousStart : cursor) + (step.delay || 0) * 1000;
        previousStart = step.with ? previousStart : cursor;
        const duration = step.do === "appear" || step.do === "hide" ? 1 : ms(step.dur),
          ease = step.ease || (step.do === "draw" ? "inOutSine" : step.do === "move" && step.along ? "inOutSine" : "inOutQuad"),
          targets = step.target || [],
          stagger = (step.stagger || 0) * 1000;
        let end = start + (step.do === "wait" ? ms(step.dur) : duration) + stagger * Math.max(0, targets.length - 1);
        targets.forEach((id, index) => {
          const element = elements.get(id), at = start + stagger * index, state = offsets.get(id);
          // A hidden actor becomes visible at its first transforming step.
          const reveal = () => {
            if (revealed.has(id) || !actors.get(id)?.hidden) return;
            revealed.add(id);
            timeline.add(element, { opacity:[0, baseOpacity(id)], duration:1 }, at);
          };
          switch (step.do) {
            case "draw":
              if (actors.get(id)?.hidden && !revealed.has(id)) { revealed.add(id); timeline.add(element, { opacity:[0, baseOpacity(id)], duration:1 }, at); }
              timeline.add(drawablesFor(id), { draw:["0 0", "0 1"], duration, ease }, at);
              for (const text of element.matches("text") ? [element] : element.querySelectorAll("text")) timeline.add(text, { opacity:[0, 1], duration:Math.min(400, duration) }, at + duration * .6);
              break;
            case "fadeIn": timeline.add(element, { opacity:[0, baseOpacity(id)], duration, ease }, at); break;
            case "fadeOut": timeline.add(element, { opacity:[baseOpacity(id), 0], duration, ease }, at); break;
            case "appear": timeline.add(element, { opacity:[0, baseOpacity(id)], duration:1 }, at); break;
            case "hide": timeline.add(element, { opacity:[baseOpacity(id), 0], duration:1 }, at); break;
            case "move": {
              reveal();
              const ref = reference.get(id);
              if (step.along) {
                const guide = elements.get(step.along), path = geometry(guide)[0] || guide;
                let length = 0;
                try { length = path.getTotalLength(); } catch {}
                const proxy = { p:step.range[0] }, fromX = state.x, fromY = state.y;
                const point = progress => { try { return path.getPointAtLength(progress * length); } catch { return { x:ref[0], y:ref[1] }; } };
                const apply = () => {
                  const pt = point(proxy.p);
                  anime.utils.set(element, { translateX:pt.x - ref[0], translateY:pt.y - ref[1] });
                };
                timeline.add(proxy, { p:[step.range[0], step.range[1]], duration, ease, onRender:apply }, at);
                const last = point(step.range[1]);
                state.x = last.x - ref[0]; state.y = last.y - ref[1];
                void fromX; void fromY;
              } else {
                const targetX = step.to ? step.to[0] - ref[0] : state.x + step.by[0],
                  targetY = step.to ? step.to[1] - ref[1] : state.y + step.by[1];
                timeline.add(element, { translateX:[state.x, targetX], translateY:[state.y, targetY], duration, ease }, at);
                state.x = targetX; state.y = targetY;
              }
              break;
            }
            case "scale": reveal(); timeline.add(element, { scale:[state.scale, step.to], duration, ease }, at); state.scale = step.to; break;
            case "rotate": reveal(); timeline.add(element, { rotate:[state.rotate, step.to], duration, ease }, at); state.rotate = step.to; break;
            case "pulse":
              timeline.add(element, { scale:[state.scale, state.scale * step.to], duration:duration / 2, ease:"outQuad" }, at);
              timeline.add(element, { scale:[state.scale * step.to, state.scale], duration:duration / 2, ease:"inQuad" }, at + duration / 2);
              break;
            case "color": {
              const shapes = element.matches("text") ? [element] : geometry(element), params = { duration, ease };
              if (step.fill) params.fill = color(step.fill);
              if (step.stroke) params.stroke = color(step.stroke);
              timeline.add(shapes, params, at);
              break;
            }
            case "morph": reveal(); timeline.add(element, { d:anime.svg.morphTo(elements.get(step.to)), duration, ease }, at); break;
            case "write": {
              const full = fullText.get(id) || "", proxy = { n:0 };
              timeline.add(element, { opacity:[0, baseOpacity(id)], duration:1 }, at);
              timeline.add(proxy, { n:[0, full.length], duration, ease:"linear", onRender:() => { element.textContent = full.slice(0, Math.round(proxy.n)); } }, at);
              break;
            }
            case "count": {
              const proxy = { v:step.from }, render = () => { element.textContent = `${step.prefix || ""}${proxy.v.toFixed(step.decimals || 0)}${step.suffix || ""}`; };
              if (firstUse.get(id) === "count") timeline.add(element, { opacity:[0, baseOpacity(id)], duration:1 }, at);
              timeline.add(proxy, { v:[step.from, step.to], duration, ease, onRender:render }, at);
              break;
            }
          }
        });
        if (step.do === "camera") {
          let center = step.center;
          if (!center && step.target?.length) {
            const boxes = step.target.map(id => { try { return elements.get(id).getBBox(); } catch { return null; } }).filter(Boolean);
            if (boxes.length) {
              const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y)), x1 = Math.max(...boxes.map(b => b.x + b.width)), y1 = Math.max(...boxes.map(b => b.y + b.height));
              center = [(x0 + x1) / 2, (y0 + y1) / 2];
            }
          }
          center ||= [W / 2, H / 2];
          const w = W / step.zoom, h = H / step.zoom, next = { x:center[0] - w / 2, y:center[1] - h / 2, w, h };
          timeline.add(camera, {
            x:[cameraState.x, next.x], y:[cameraState.y, next.y], w:[cameraState.w, next.w], h:[cameraState.h, next.h],
            duration:ms(step.dur), ease:step.ease || "inOutCubic", onRender:applyCamera,
          }, start);
          Object.assign(cameraState, next);
        }
        cursor = Math.max(cursor, end);
      }
      cursor += (beat.pause || 0) * 1000;
    }
    const total = Math.max(1, cursor);
    // Hold the final frame a moment so the last beat can be read.
    timeline.call(() => {}, total + (scene.loop ? 900 : 1));

    let caption = null;
    if (beatStarts.some(beat => beat.caption) || scene.caption) {
      caption = document.createElement("div");
      caption.className = "pes-caption";
      caption.setAttribute("aria-live", "polite");
      root.append(caption);
    }
    function syncCaption() {
      if (!caption) return;
      const duration = timeline.duration || 1,
        time = scene.loop ? timeline.currentTime % duration : Math.min(timeline.currentTime, duration);
      let current = scene.caption || "";
      for (const beat of beatStarts) if (time + 1 >= beat.at && beat.caption) current = beat.caption;
      if (caption.textContent !== current) caption.textContent = current;
    }
    let localSpeed = 1;
    const player = {
      get localSpeed() { return localSpeed; },
      playing:() => !timeline.paused && !timeline.completed,
      fraction:() => Math.min(1, (timeline.currentTime % (timeline.duration + 1)) / (timeline.duration || 1)),
      replay() { resetState(); timeline.restart(); timeline.play(); controls?.sync(); },
      play() { if (timeline.completed) this.replay(); else timeline.play(); controls?.sync(); },
      pause() { timeline.pause(); controls?.sync(); },
      toggle() { this.playing() ? this.pause() : this.play(); },
      setLocalSpeed(value) { localSpeed = value; timeline.speed = scene.speed * localSpeed; },
      seekFraction(value) { timeline.seek(value * timeline.duration); syncCaption(); controls?.sync(); },
    };
    const controls = scene.controls ? createControls(player, { progress:true }) : null;
    timeline.speed = scene.speed;
    timeline.onUpdate = () => { syncCaption(); controls?.sync(); };
    timeline.onComplete = () => { syncCaption(); controls?.sync(); root.classList.add("pes-show-controls"); };
    listen(player);
    resetState();
    if (reducedMotion || !scene.autoplay) {
      timeline.seek(reducedMotion ? timeline.duration : 0);
      syncCaption();
      controls?.sync();
    } else {
      // Start once the Widget is on screen; a scene off screen waits.
      const start = () => { timeline.play(); controls?.sync(); };
      if (typeof IntersectionObserver === "function") {
        const observer = new IntersectionObserver(entries => {
          if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); start(); }
        });
        observer.observe(root);
      } else start();
    }
    notifyUpdated();
    return player;
  }

  // ---------- Physics: canvas + matter-js ----------
  function fitCanvas(canvas, W, H) {
    const rect = root.getBoundingClientRect(), dpr = Math.min(3, globalThis.devicePixelRatio || 1),
      width = Math.max(1, rect.width), height = Math.max(1, rect.height),
      scale = Math.min(width / W, height / H);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    return { dpr, scale, offsetX:(width - W * scale) / 2, offsetY:(height - H * scale) / 2 };
  }
  function mountPhysics(scene) {
    const Matter = globalThis.Matter;
    if (!Matter?.Engine) throw new Error("matter-js is not available");
    const [W, H] = scene.size, canvas = document.createElement("canvas"), context = canvas.getContext("2d");
    canvas.className = "pes-stage";
    root.append(canvas);
    let fit = fitCanvas(canvas, W, H);
    let engine, world, records, constraints, elapsed, frame = 0, running = false, localSpeed = 1, last = 0;
    const palette = ["blue", "orange", "green", "purple", "red", "teal", "pink", "yellow"];
    function build() {
      engine = Matter.Engine.create({ gravity:{ x:scene.gravity[0], y:scene.gravity[1], scale:0.001 } });
      world = engine.world;
      records = new Map();
      elapsed = 0;
      const statics = [];
      const thickness = 400;
      if (scene.walls !== "none") statics.push(Matter.Bodies.rectangle(W / 2, H + thickness / 2, W * 3, thickness, { isStatic:true, label:"wall" }));
      if (scene.walls === "box") {
        statics.push(Matter.Bodies.rectangle(-thickness / 2, H / 2, thickness, H * 3, { isStatic:true, label:"wall" }));
        statics.push(Matter.Bodies.rectangle(W + thickness / 2, H / 2, thickness, H * 3, { isStatic:true, label:"wall" }));
      }
      Matter.Composite.add(world, statics);
      scene.bodies.forEach((spec, index) => {
        const options = { isStatic:Boolean(spec.static), angle:(spec.angle || 0) * Math.PI / 180 };
        for (const key of ["restitution", "friction", "frictionAir", "density"]) if (spec[key] !== undefined) options[key] = spec[key];
        let body;
        if (spec.shape === "circle") body = Matter.Bodies.circle(spec.x, spec.y, spec.r, options);
        else if (spec.shape === "rect") body = Matter.Bodies.rectangle(spec.x, spec.y, spec.w, spec.h, options);
        else if (spec.shape === "polygon") body = Matter.Bodies.polygon(spec.x, spec.y, spec.sides, spec.r, options);
        else {
          const dx = spec.x2 - spec.x, dy = spec.y2 - spec.y, length = Math.hypot(dx, dy) || 1;
          body = Matter.Bodies.rectangle((spec.x + spec.x2) / 2, (spec.y + spec.y2) / 2, length, spec.thickness, { ...options, angle:Math.atan2(dy, dx) });
        }
        if (spec.velocity) Matter.Body.setVelocity(body, { x:spec.velocity[0] / 60, y:spec.velocity[1] / 60 });
        if (spec.angularVelocity) Matter.Body.setAngularVelocity(body, spec.angularVelocity / 60);
        Matter.Composite.add(world, body);
        records.set(spec.id, { spec, body, trail:[], fill:color(spec.fill) || (spec.static ? PALETTE.gray : PALETTE[palette[index % palette.length]]) });
      });
      constraints = scene.constraints.map(spec => {
        const options = { stiffness:spec.stiffness ?? 1, damping:spec.damping ?? 0.02 };
        const a = records.get(spec.a)?.body, b = records.get(spec.b)?.body;
        if (a && b) Object.assign(options, { bodyA:a, bodyB:b, pointA:spec.pointA ? { x:spec.pointA[0], y:spec.pointA[1] } : undefined, pointB:spec.pointB ? { x:spec.pointB[0], y:spec.pointB[1] } : undefined });
        else Object.assign(options, { pointA:{ x:spec.anchor[0], y:spec.anchor[1] }, bodyB:a || b, pointB:spec.pointA ? { x:spec.pointA[0], y:spec.pointA[1] } : undefined });
        if (spec.length !== undefined) options.length = spec.length;
        const constraint = Matter.Constraint.create(options);
        Matter.Composite.add(world, constraint);
        return { spec, constraint };
      });
    }
    function worldPoint(constraint, end) {
      const body = constraint[`body${end}`], point = constraint[`point${end}`] || { x:0, y:0 };
      return body ? { x:body.position.x + point.x, y:body.position.y + point.y } : point;
    }
    function draw() {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(fit.dpr * fit.scale, 0, 0, fit.dpr * fit.scale, fit.dpr * fit.offsetX, fit.dpr * fit.offsetY);
      if (scene.background && scene.background !== "transparent") { context.fillStyle = color(scene.background); context.fillRect(0, 0, W, H); }
      context.lineCap = context.lineJoin = "round";
      for (const { spec, constraint } of constraints) {
        if (spec.render === "none") continue;
        const a = worldPoint(constraint, "A"), b = worldPoint(constraint, "B");
        context.strokeStyle = PALETTE.muted;
        context.lineWidth = 3;
        context.beginPath();
        if (spec.render === "spring") {
          const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1, nx = -dy / length, ny = dx / length, coils = 12;
          context.moveTo(a.x, a.y);
          for (let index = 1; index < coils; index++) {
            const t = index / coils, side = index % 2 ? 1 : -1;
            context.lineTo(a.x + dx * t + nx * 10 * side, a.y + dy * t + ny * 10 * side);
          }
          context.lineTo(b.x, b.y);
        } else { context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); }
        context.stroke();
        if (!constraint.bodyA) { context.fillStyle = PALETTE.ink; context.beginPath(); context.arc(a.x, a.y, 5, 0, Math.PI * 2); context.fill(); }
      }
      for (const record of records.values()) {
        const { spec, body } = record;
        if (spec.trail && record.trail.length > 1) {
          context.strokeStyle = record.fill;
          context.globalAlpha = .35;
          context.lineWidth = 3;
          context.beginPath();
          record.trail.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
          context.stroke();
          context.globalAlpha = 1;
        }
        context.fillStyle = record.fill;
        context.strokeStyle = color(spec.stroke) || "rgba(15,23,42,.55)";
        context.lineWidth = 2;
        context.beginPath();
        if (spec.shape === "circle") {
          context.arc(body.position.x, body.position.y, spec.r, 0, Math.PI * 2);
          context.fill();
          context.stroke();
          context.beginPath();
          context.moveTo(body.position.x, body.position.y);
          context.lineTo(body.position.x + Math.cos(body.angle) * spec.r, body.position.y + Math.sin(body.angle) * spec.r);
          context.stroke();
        } else {
          body.vertices.forEach((vertex, index) => index ? context.lineTo(vertex.x, vertex.y) : context.moveTo(vertex.x, vertex.y));
          context.closePath();
          context.fill();
          context.stroke();
        }
        if (spec.label) {
          context.fillStyle = PALETTE.ink;
          context.font = `600 ${Math.max(14, Math.min(34, (spec.r || Math.min(spec.w || 40, spec.h || 40) / 2) * .8))}px ${FONTS.sans}`;
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(spec.label, body.position.x, body.position.y - (spec.r || (spec.h || 40) / 2) - 18);
        }
      }
      for (const label of scene.labels) {
        context.fillStyle = PALETTE.ink;
        context.font = `600 ${label.size}px ${FONTS.sans}`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(label.text, label.x, label.y);
      }
    }
    function tick(now) {
      frame = 0;
      if (!running) return;
      const delta = Math.min(50, now - (last || now));
      last = now;
      const step = 1000 / 60, speed = scene.speed * localSpeed;
      let budget = delta * speed;
      while (budget > 0.5) {
        const dt = Math.min(step, budget);
        Matter.Engine.update(engine, dt);
        budget -= dt;
        elapsed += dt / 1000;
      }
      for (const record of records.values()) if (record.spec.trail) {
        record.trail.push({ x:record.body.position.x, y:record.body.position.y });
        if (record.trail.length > 240) record.trail.shift();
      }
      draw();
      controls?.sync();
      if (scene.duration && elapsed >= scene.duration) {
        if (scene.loop) { build(); }
        else { running = false; controls?.sync(); root.classList.add("pes-show-controls"); return; }
      }
      frame = requestAnimationFrame(tick);
    }
    const player = {
      get localSpeed() { return localSpeed; },
      playing:() => running,
      fraction:() => scene.duration ? Math.min(1, elapsed / scene.duration) : 0,
      replay() { build(); draw(); this.play(); },
      play() { if (running) return; running = true; last = 0; frame ||= requestAnimationFrame(tick); controls?.sync(); },
      pause() { running = false; controls?.sync(); },
      toggle() { running ? this.pause() : this.play(); },
      setLocalSpeed(value) { localSpeed = value; },
      seekFraction() {},
    };
    const controls = scene.controls ? createControls(player) : null;
    build();
    draw();
    if (typeof ResizeObserver === "function") new ResizeObserver(() => { fit = fitCanvas(canvas, W, H); draw(); }).observe(root);
    listen(player);
    if (!reducedMotion && scene.autoplay) player.play();
    notifyUpdated();
    return player;
  }

  // ---------- Pseudo-3D: canvas + Zdog ----------
  function mount3d(scene) {
    const Zdog = globalThis.Zdog;
    if (!Zdog?.Illustration) throw new Error("Zdog is not available");
    const [W, H] = scene.size, canvas = document.createElement("canvas");
    canvas.className = "pes-stage";
    root.append(canvas);
    const radians = value => value * Math.PI / 180, vector = ([x, y, z]) => ({ x, y, z });
    let fit, dragging = false;
    const illo = new Zdog.Illustration({
      element:canvas,
      zoom:scene.zoom,
      rotate:vector(scene.view.map(radians)),
      dragRotate:scene.drag,
      onDragStart:() => { dragging = true; },
      onDragEnd:() => { dragging = false; },
    });
    const nodes = new Map(), palette = ["blue", "orange", "green", "purple", "red", "teal"];
    scene.shapes.forEach((spec, index) => {
      const addTo = spec.parent ? nodes.get(spec.parent) || illo : illo,
        shapeColor = color(spec.color) || PALETTE[palette[index % palette.length]],
        common = { addTo, translate:vector(spec.translate), rotate:vector(spec.rotate.map(radians)), color:shapeColor };
      if (spec.stroke !== undefined) common.stroke = spec.stroke;
      if (spec.filled !== undefined) common.fill = spec.filled;
      let node;
      switch (spec.type) {
        case "group": node = new Zdog.Group(common); break;
        case "box": {
          const faces = spec.faces || {};
          node = new Zdog.Box({ ...common, width:spec.width ?? 80, height:spec.height ?? 80, depth:spec.depth ?? 80, stroke:spec.stroke ?? false,
            frontFace:color(faces.front) || shapeColor, rearFace:color(faces.rear) || shapeColor, leftFace:color(faces.left) || shapeColor,
            rightFace:color(faces.right) || shapeColor, topFace:color(faces.top) || shapeColor, bottomFace:color(faces.bottom) || shapeColor });
          break;
        }
        case "sphere": node = new Zdog.Shape({ ...common, stroke:spec.diameter ?? spec.stroke ?? 80 }); break;
        case "cylinder": node = new Zdog.Cylinder({ ...common, diameter:spec.diameter ?? 60, length:spec.length ?? 80, stroke:spec.stroke ?? false }); break;
        case "cone": node = new Zdog.Cone({ ...common, diameter:spec.diameter ?? 60, length:spec.length ?? 80, stroke:spec.stroke ?? false }); break;
        case "hemisphere": node = new Zdog.Hemisphere({ ...common, diameter:spec.diameter ?? 80, stroke:spec.stroke ?? false }); break;
        case "ellipse": node = new Zdog.Ellipse({ ...common, diameter:spec.diameter, width:spec.width, height:spec.height, stroke:spec.stroke ?? 4 }); break;
        case "torus": node = new Zdog.Ellipse({ ...common, diameter:spec.diameter ?? 100, stroke:spec.stroke ?? 20 }); break;
        case "rect": node = spec.cornerRadius
          ? new Zdog.RoundedRect({ ...common, width:spec.width ?? 80, height:spec.height ?? 60, cornerRadius:spec.cornerRadius, stroke:spec.stroke ?? 4 })
          : new Zdog.Rect({ ...common, width:spec.width ?? 80, height:spec.height ?? 60, stroke:spec.stroke ?? 4 });
          break;
        case "polygon": node = new Zdog.Polygon({ ...common, radius:spec.radius ?? 50, sides:spec.sides ?? 6, stroke:spec.stroke ?? 4 }); break;
        case "line":
        case "path": node = new Zdog.Shape({ ...common, path:spec.path.map(vector), closed:spec.closed ?? false, stroke:spec.stroke ?? 4 }); break;
      }
      if (node) nodes.set(spec.id, node);
    });
    let running = false, localSpeed = 1, last = 0, frame = 0, start = scene.view.map(radians);
    function render() { illo.updateRenderGraph(); }
    function tick(now) {
      frame = 0;
      if (!running) return;
      const dt = Math.min(50, now - (last || now)) / 1000;
      last = now;
      if (!dragging) {
        const factor = dt * scene.speed * localSpeed;
        illo.rotate.x += radians(scene.spin[0]) * factor;
        illo.rotate.y += radians(scene.spin[1]) * factor;
        illo.rotate.z += radians(scene.spin[2]) * factor;
      }
      render();
      frame = requestAnimationFrame(tick);
    }
    const player = {
      get localSpeed() { return localSpeed; },
      playing:() => running,
      fraction:() => 0,
      replay() { illo.rotate.set(vector(start)); render(); this.play(); },
      play() { if (running) return; running = true; last = 0; frame ||= requestAnimationFrame(tick); controls?.sync(); },
      pause() { running = false; render(); controls?.sync(); },
      toggle() { running ? this.pause() : this.play(); },
      setLocalSpeed(value) { localSpeed = value; },
      seekFraction() {},
    };
    const controls = scene.controls ? createControls(player) : null;
    function resize() {
      const rect = root.getBoundingClientRect(), width = Math.max(1, rect.width), height = Math.max(1, rect.height),
        dpr = globalThis.devicePixelRatio || 1;
      if (fit && fit.width === width && fit.height === height && fit.dpr === dpr) return;
      fit = { width, height, dpr, scale:Math.min(width / W, height / H) };
      // Zdog applies DPR in setSize and its render transform. Supplying backing
      // pixels here would apply it twice and also enlarge the CSS viewport.
      illo.setSize(width, height);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      illo.zoom = scene.zoom * fit.scale;
      render();
    }
    resize();
    if (typeof ResizeObserver === "function") new ResizeObserver(resize).observe(root);
    addEventListener("resize", resize);
    listen(player);
    const moving = scene.spin.some(value => Math.abs(value) > 1e-6);
    if (!reducedMotion && scene.autoplay && moving) player.play();
    else render();
    notifyUpdated();
    return player;
  }

  // ---------- Puppet: the user's own ink, rigged (no vendor engine) ----------
  // Every motion is a periodic function of time, so the loop never jumps.
  // The sketch first redraws itself stroke by stroke, then eases into motion.
  function mountPuppet(scene) {
    const [W, H] = scene.size, svg = document.createElementNS(SVG_NS, "svg"), TAU = Math.PI * 2;
    svg.setAttribute("class", "pes-stage");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("role", "img");
    if (scene.subject) svg.setAttribute("aria-label", scene.subject);
    if (scene.background && scene.background !== "transparent") root.style.background = color(scene.background);
    const make = (tag, attributes = {}) => {
      const element = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attributes)) if (value !== undefined && value !== null) element.setAttribute(key, String(value));
      return element;
    };
    const parts = scene.parts, byId = new Map(parts.map(part => [part.id, part])), groups = new Map(), owned = new Set();
    const paths = scene.ink.map(item => make("path", { d:item.d, fill:"none", stroke:color(item.color) || PALETTE.ink, "stroke-width":item.width,
      "stroke-linecap":"round", "stroke-linejoin":"round", pathLength:1 }));
    // Shadow under the first root, drawn behind everything.
    const roots = parts.filter(part => !part.parent), mainRoot = roots[0];
    let shadow = null, shadowBase = null;
    if (scene.effects?.shadow && mainRoot) {
      const ground = Number.isFinite(scene.effects.ground) ? scene.effects.ground : H * 0.85;
      shadowBase = { x:mainRoot.pivot[0], y:ground + 4, rx:Math.max(12, W * 0.18), ry:Math.max(3, H * 0.025) };
      shadow = make("ellipse", { cx:shadowBase.x, cy:shadowBase.y, rx:shadowBase.rx, ry:shadowBase.ry, fill:"#0f172a", opacity:0.12 });
      svg.append(shadow);
    }
    for (const part of parts) {
      const group = make("g", { "data-part":part.id });
      groups.set(part.id, group);
      for (const index of part.ink) { group.append(paths[index]); owned.add(index); }
    }
    // Children nest inside their parent so they inherit its motion.
    const stage = make("g");
    paths.forEach((path, index) => { if (!owned.has(index)) stage.append(path); });
    for (const part of parts) (part.parent ? groups.get(part.parent) : stage).append(groups.get(part.id));
    svg.append(stage);
    root.append(svg);
    // Small cartoon accents in the sketch's own ink: speed lines behind a
    // travelling subject and a dust puff where a hop lands.
    const rootMotion = type => mainRoot?.motion.find(motion => motion.type === type),
      travelMotion = rootMotion("travel"), hopMotion = rootMotion("hop"),
      accentColor = color(scene.ink[mainRoot?.ink[0]]?.color) || PALETTE.ink,
      accentWidth = Math.max(1.5, Math.min(4, (scene.ink[mainRoot?.ink[0]]?.width || 3) * 0.6));
    let rootBox = null;
    try { rootBox = mainRoot ? groups.get(mainRoot.id).getBBox() : null; } catch {}
    const speedLines = travelMotion && rootBox && scene.effects?.accents !== false ? [0.3, 0.52, 0.74].map(() => {
      const line = make("line", { stroke:accentColor, "stroke-width":accentWidth, "stroke-linecap":"round", opacity:0 });
      svg.insertBefore(line, stage);
      return line;
    }) : [];
    const dust = hopMotion && rootBox && scene.effects?.accents !== false ? [-1, 1].map(() => {
      const puff = make("path", { fill:"none", stroke:accentColor, "stroke-width":accentWidth, "stroke-linecap":"round", opacity:0 });
      svg.insertBefore(puff, stage);
      return puff;
    }) : [];

    const introOn = scene.effects?.intro !== false && !reducedMotion,
      strokeDuration = Math.min(0.32, 1.6 / Math.max(1, paths.length)), introDuration = introOn ? Math.min(2.2, 0.15 + paths.length * strokeDuration * 0.7 + strokeDuration) : 0,
      rampDuration = 0.6;
    const smooth = value => value <= 0 ? 0 : value >= 1 ? 1 : value * value * (3 - 2 * value);
    const spinAngles = new Map();
    function motionState(part, time, envelope, dt) {
      const out = { tx:0, ty:0, r:0, k:0, sx:1, sy:1, o:1 };
      part.motion.forEach((motion, index) => {
        const amp = motion.amp * envelope, period = motion.period, frac = ((time / period + (motion.phase || 0)) % 1 + 1) % 1, p = frac * TAU;
        switch (motion.type) {
          case "swing": out.r += amp * Math.sin(p); break;
          case "flap": out.r += amp * Math.sin(p + 0.55 * Math.sin(p)); break;
          case "sway": out.r += amp * Math.sin(p); out.k += amp * 0.25 * Math.sin(p - 0.7); break;
          case "wiggle": out.r += amp * (0.65 * Math.sin(p) + 0.35 * Math.sin(2.7 * p + 1.3)); break;
          case "spin": {
            const key = `${part.id}:${index}`, angle = (spinAngles.get(key) || 0) + Math.sign(motion.amp || 1) * 360 * dt / period * envelope;
            spinAngles.set(key, angle % 360); out.r += angle % 360; break;
          }
          case "bob": out.ty += amp * Math.sin(p); break;
          case "float": out.ty += amp * Math.sin(p); out.tx += amp * 0.35 * Math.sin(p * 0.5 + 1); out.r += amp * 0.08 * Math.sin(p + 0.7); break;
          case "hop": {
            const air = Math.sin(Math.PI * frac), velocity = Math.cos(Math.PI * frac), contact = Math.max(0, 1 - air * 5) * envelope;
            out.ty -= amp * air;
            out.sy *= (1 + 0.1 * velocity * envelope * (air > 0.15 ? 1 : 0)) * (1 - 0.16 * contact);
            out.sx *= 1 + 0.12 * contact;
            break;
          }
          case "travel": {
            out.tx += amp * (frac - 0.5);
            const edge = Math.min(frac, 1 - frac);
            out.o *= envelope < 1 ? 1 : smooth(edge / 0.08);
            break;
          }
          case "shake": out.tx += amp * Math.sin(p); break;
          case "orbit": out.tx += amp * Math.cos(p); out.ty += amp * Math.sin(p); break;
          case "breathe": { const s = 1 + amp * Math.sin(p); out.sx *= s; out.sy *= s; break; }
          case "stretch": out.sy *= 1 + amp * Math.sin(p); out.sx *= 1 - amp * 0.5 * Math.sin(p); break;
          case "blink": { const closing = frac < 0.07 ? Math.sin(Math.PI * frac / 0.07) : 0; out.sy *= 1 - 0.9 * closing * envelope; break; }
          case "flicker": out.o *= 1 - Math.min(0.9, Math.abs(amp)) * (0.5 + 0.5 * Math.sin(p)) * (0.6 + 0.4 * Math.sin(3.1 * p + 2)); out.sy *= 1 + amp * 0.25 * Math.sin(2 * p); break;
        }
      });
      return out;
    }
    let elapsed = 0, last = 0, frame = 0, running = false, localSpeed = 1;
    function draw(dt = 0) {
      const time = Math.max(0, elapsed - introDuration), envelope = reducedMotion ? 0 : smooth(time / rampDuration);
      if (introOn) {
        paths.forEach((path, index) => {
          const start = index * strokeDuration * 0.7, progress = smooth((elapsed - start) / strokeDuration);
          path.style.strokeDasharray = progress >= 1 ? "" : "1 1";
          path.style.strokeDashoffset = progress >= 1 ? "" : String(1 - progress);
          // A round cap would show a dot before the stroke starts drawing.
          path.style.visibility = progress > 0 ? "" : "hidden";
        });
      }
      for (const part of parts) {
        const m = motionState(part, time, envelope, dt), [px, py] = part.pivot, group = groups.get(part.id);
        group.setAttribute("transform", `translate(${(px + m.tx).toFixed(2)} ${(py + m.ty).toFixed(2)}) rotate(${m.r.toFixed(3)}) skewX(${m.k.toFixed(3)}) scale(${m.sx.toFixed(4)} ${m.sy.toFixed(4)}) translate(${-px} ${-py})`);
        group.style.opacity = m.o < 0.999 ? m.o.toFixed(3) : "";
        if (part === mainRoot && speedLines.length) {
          const direction = Math.sign(travelMotion.amp) || 1, length = Math.max(14, rootBox.width * 0.28), back = direction > 0 ? rootBox.x - 6 : rootBox.x + rootBox.width + 6;
          speedLines.forEach((line, index) => {
            const y = rootBox.y + rootBox.height * [0.3, 0.52, 0.74][index] + m.ty, jitter = Math.sin(time * 9 + index * 2.1) * length * 0.18,
              x2 = back + m.tx, x1 = x2 - direction * (length * (index === 1 ? 1 : 0.7) + jitter);
            line.setAttribute("x1", x1.toFixed(1)); line.setAttribute("x2", (x2 - direction * 4).toFixed(1));
            line.setAttribute("y1", y.toFixed(1)); line.setAttribute("y2", y.toFixed(1));
            line.setAttribute("opacity", (0.35 * envelope * m.o).toFixed(3));
          });
        }
        if (part === mainRoot && dust.length) {
          const frac = ((time / hopMotion.period + (hopMotion.phase || 0)) % 1 + 1) % 1, k = frac < 0.22 ? frac / 0.22 : 1,
            groundY = (Number.isFinite(scene.effects?.ground) ? scene.effects.ground : rootBox.y + rootBox.height) - 2, cx = part.pivot[0] + m.tx,
            spread = rootBox.width * (0.42 + 0.25 * k), size = Math.max(5, rootBox.height * 0.07) * (0.6 + 0.6 * k);
          dust.forEach((puff, index) => {
            const side = index ? 1 : -1, x = cx + side * spread;
            puff.setAttribute("d", `M${(x - size).toFixed(1)} ${groundY.toFixed(1)}q${size.toFixed(1)} ${(-size * 1.3).toFixed(1)} ${(size * 2).toFixed(1)} 0`);
            puff.setAttribute("opacity", (k < 1 ? 0.45 * (1 - k) * envelope : 0).toFixed(3));
          });
        }
        if (part === mainRoot && shadow) {
          const height = Math.max(0, -m.ty), fade = Math.max(0.35, 1 - height / Math.max(40, H * 0.5));
          shadow.setAttribute("cx", (shadowBase.x + m.tx).toFixed(2));
          shadow.setAttribute("rx", (shadowBase.rx * fade * m.sx).toFixed(2));
          shadow.setAttribute("opacity", (0.12 * fade * m.o).toFixed(3));
        }
      }
    }
    function tick(now) {
      if (!running) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) * scene.speed * localSpeed : 0;
      last = now;
      elapsed += dt;
      draw(dt);
      frame = requestAnimationFrame(tick);
    }
    const player = {
      get localSpeed() { return localSpeed; },
      playing:() => running,
      fraction:() => 0,
      play() { if (running || reducedMotion) return; running = true; last = 0; frame = requestAnimationFrame(tick); controls?.sync(); },
      pause() { running = false; cancelAnimationFrame(frame); controls?.sync(); },
      toggle() { running ? this.pause() : this.play(); },
      replay() { elapsed = 0; spinAngles.clear(); draw(0); this.play(); controls?.sync(); },
      setLocalSpeed(value) { localSpeed = value; },
      seekFraction() {},
    };
    const controls = scene.controls ? createControls(player) : null;
    listen(player);
    if (reducedMotion) elapsed = introDuration;
    draw(0);
    controls?.sync();
    if (!reducedMotion && scene.autoplay) {
      if (typeof IntersectionObserver === "function") {
        const observer = new IntersectionObserver(entries => {
          if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); player.play(); }
        });
        observer.observe(root);
      } else player.play();
    }
    notifyUpdated();
    return player;
  }

  try {
    const runtime = globalThis.PENECHO_SCENE;
    const raw = JSON.parse(source.textContent || "{}");
    const scene = runtime?.normalize ? runtime.normalize(raw) : raw;
    if (scene.engine === "physics") mountPhysics(scene);
    else if (scene.engine === "3d") mount3d(scene);
    else if (scene.engine === "puppet") mountPuppet(scene);
    else mountMotion(scene);
  } catch (error) {
    showError(error);
  }
})();
