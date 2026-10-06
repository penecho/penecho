"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PENECHO_SUMMON = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const TAU = Math.PI * 2,
    THINKING_LAYOUT = Object.freeze({
      viewportMargin:18,
      minPadding:34,
      maxPadding:76,
      innerGap:22,
      statusGap:16,
      statusHeight:28,
      statusWidth:360,
      fallbackWidth:460,
      fallbackHeight:220,
      samples:96,
      highlightFraction:0.14,
      cycleSeconds:12,
      fadeSeconds:0.32,
    });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  function normalizeRegion(region) {
    if (!region || ![region.x, region.y, region.w, region.h].every(Number.isFinite)
      || region.w <= 0 || region.h <= 0) return null;
    return { x:region.x, y:region.y, w:region.w, h:region.h };
  }

  function projectRegion(region, transform = {}) {
    const normalized = normalizeRegion(region),
      scale = Math.max(0.03, Number(transform.scale) || 1);
    if (!normalized) return null;
    return {
      x:normalized.x * scale + (Number(transform.panX) || 0),
      y:normalized.y * scale + (Number(transform.panY) || 0),
      w:normalized.w * scale,
      h:normalized.h * scale,
    };
  }

  function fallbackRegion(width, height) {
    const w = Math.min(THINKING_LAYOUT.fallbackWidth, Math.max(180, width * 0.52)),
      h = Math.min(THINKING_LAYOUT.fallbackHeight, Math.max(110, height * 0.28));
    return {
      x:(width - w) / 2,
      y:Math.max(THINKING_LAYOUT.viewportMargin, (height - h) * 0.42),
      w,
      h,
    };
  }

  function echoLayout(region, viewport = {}) {
    const width = Math.max(1, Number(viewport.width) || 1),
      height = Math.max(1, Number(viewport.height) || 1),
      margin = Math.min(THINKING_LAYOUT.viewportMargin, width / 4, height / 4),
      normalized = normalizeRegion(region),
      source = normalized || fallbackRegion(width, height),
      padding = clamp(Math.max(source.w, source.h) * 0.1, THINKING_LAYOUT.minPadding, THINKING_LAYOUT.maxPadding),
      // The viewport clips the effect; it must never move or reshape its anchor.
      outer = { x:source.x - padding, y:source.y - padding, w:source.w + padding * 2, h:source.h + padding * 2 },
      innerInset = Math.min(THINKING_LAYOUT.innerGap, Math.max(7, Math.min(outer.w, outer.h) * 0.08)),
      inner = {
        x:outer.x + innerInset,
        y:outer.y + innerInset,
        w:Math.max(1, outer.w - innerInset * 2),
        h:Math.max(1, outer.h - innerInset * 2),
      },
      statusWidth = Math.min(THINKING_LAYOUT.statusWidth, Math.max(1, width - margin * 2));
    return {
      source,
      outer,
      inner,
      fallback:!normalized,
      status:{
        x:outer.x + outer.w / 2,
        y:outer.y + outer.h + THINKING_LAYOUT.statusGap,
        w:statusWidth,
      },
    };
  }

  var SPECTRUM = [[34, 211, 238], [79, 70, 229], [168, 85, 247], [236, 72, 153], [245, 158, 11], [34, 211, 238]];

  function easeOutCubic(p) { return 1 - Math.pow(1 - p, 3); }
  // Theme tokens resolve to hex or rgb() colors before painting.
  function withAlpha(color, a) {
    var channels;
    if (typeof color === "string" && color.charAt(0) === "#") {
      var n = parseInt(color.slice(1), 16);
      channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    } else {
      var match = String(color).match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      channels = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [37, 99, 235];
    }
    return "rgba(" + channels[0] + "," + channels[1] + "," + channels[2] + "," + a.toFixed(4) + ")";
  }
  function paletteAt(u, lighten, alpha) {
    u = ((u % 1) + 1) % 1;
    var f = u * (SPECTRUM.length - 1), i = Math.floor(f), k = f - i;
    var a = SPECTRUM[i], b = SPECTRUM[Math.min(SPECTRUM.length - 1, i + 1)], out = [];
    for (var c = 0; c < 3; c++) {
      var v = a[c] + (b[c] - a[c]) * k;
      out.push(Math.round(v + (255 - v) * (lighten || 0)));
    }
    return alpha === undefined ? "rgb(" + out.join(",") + ")" : "rgba(" + out.join(",") + "," + alpha + ")";
  }

  function pillowOutline(box, r, bow) {
    var l = box.x, t = box.y, rt = box.x + box.w, bo = box.y + box.h, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    r = Math.max(0, Math.min(r, box.w / 2, box.h / 2));
    var pieces = [];
    pieces.push({ kind: "q", p0: { x: l + r, y: t }, c: { x: cx, y: t - bow }, p1: { x: rt - r, y: t } });
    pieces.push({ kind: "a", ox: rt - r, oy: t + r, start: -Math.PI / 2, end: 0 });
    pieces.push({ kind: "q", p0: { x: rt, y: t + r }, c: { x: rt + bow, y: cy }, p1: { x: rt, y: bo - r } });
    pieces.push({ kind: "a", ox: rt - r, oy: bo - r, start: 0, end: Math.PI / 2 });
    pieces.push({ kind: "q", p0: { x: rt - r, y: bo }, c: { x: cx, y: bo + bow }, p1: { x: l + r, y: bo } });
    pieces.push({ kind: "a", ox: l + r, oy: bo - r, start: Math.PI / 2, end: Math.PI });
    pieces.push({ kind: "q", p0: { x: l, y: bo - r }, c: { x: l - bow, y: cy }, p1: { x: l, y: t + r } });
    pieces.push({ kind: "a", ox: l + r, oy: t + r, start: Math.PI, end: Math.PI * 1.5 });
    var points = [], cum = [0], total = 0, prev = null;
    for (var p = 0; p < pieces.length; p++) {
      var piece = pieces[p];
      piece.r = r;
      var chord = piece.kind === "q"
        ? Math.hypot(piece.p1.x - piece.p0.x, piece.p1.y - piece.p0.y) * 1.02
        : Math.abs(piece.end - piece.start) * r;
      var steps = Math.max(4, Math.ceil(chord / 8));
      for (var i = 0; i <= steps; i++) {
        var u = i / steps, point;
        if (piece.kind === "q") {
          var w0 = (1 - u) * (1 - u), w1 = 2 * (1 - u) * u, w2 = u * u;
          point = { x: w0 * piece.p0.x + w1 * piece.c.x + w2 * piece.p1.x, y: w0 * piece.p0.y + w1 * piece.c.y + w2 * piece.p1.y };
        } else {
          var angle = piece.start + (piece.end - piece.start) * u;
          point = { x: piece.ox + Math.cos(angle) * r, y: piece.oy + Math.sin(angle) * r };
        }
        if (prev) { total += Math.hypot(point.x - prev.x, point.y - prev.y); cum.push(total); }
        points.push(point);
        prev = point;
      }
    }
    return { points: points, cum: cum, total: Math.max(1, total) };
  }
  function pointAtDistance(line, d) {
    var total = line.total;
    d = ((d % total) + total) % total;
    var lo = 0, hi = line.cum.length - 1;
    while (lo < hi - 1) {
      var mid = (lo + hi) >> 1;
      if (line.cum[mid] <= d) lo = mid; else hi = mid;
    }
    var span = (line.cum[hi] - line.cum[lo]) || 1, k = (d - line.cum[lo]) / span;
    var a = line.points[lo], b = line.points[hi];
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }
  function buildEchoLine(rect) {
    const box = normalizeRegion(rect);
    if (!box) return { points:[], cum:[], total:0 };
    const side = Math.min(box.w, box.h);
    return pillowOutline(box, clamp(side * 0.22, 14, 44), clamp(side * 0.018, 1.5, 9));
  }

  function buildEchoContour(rect) {
    return buildEchoLine(rect).points;
  }

  function traceEchoPath(ctx, line) {
    ctx.beginPath();
    ctx.moveTo(line.points[0].x, line.points[0].y);
    for (let i = 1; i < line.points.length; i++) ctx.lineTo(line.points[i].x, line.points[i].y);
    ctx.closePath();
  }

  // Light Sweep: a quiet stationary spectrum outline and one theme-tinted scan.
  function drawLightSweep(ctx, line, outer, elapsed, reducedMotion, tint, fade = 1) {
    if (line.points.length < 2) return;
    const entrance = reducedMotion ? 1 : easeOutCubic(clamp01(elapsed / 0.42)),
      opacity = fade * entrance,
      cx = outer.x + outer.w / 2,
      cy = outer.y + outer.h / 2,
      start = -Math.PI / 2 + 0.09;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.26 * opacity;
    if (typeof ctx.createConicGradient === "function") {
      const gradient = ctx.createConicGradient(start, cx, cy);
      for (let stop = 0; stop < SPECTRUM.length; stop++) {
        gradient.addColorStop(stop / (SPECTRUM.length - 1), paletteAt(stop / (SPECTRUM.length - 1)));
      }
      ctx.strokeStyle = gradient;
      traceEchoPath(ctx, line);
      ctx.stroke();
    } else {
      ctx.lineCap = "butt";
      for (let i = 0; i < line.points.length - 1; i++) {
        const p0 = line.points[i], p1 = line.points[i + 1];
        ctx.strokeStyle = paletteAt((Math.atan2(p0.y - cy, p0.x - cx) - start) / TAU);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }

    const progress = reducedMotion ? 0.5 : (elapsed / 3.2) % 1,
      x = outer.x + outer.w * progress,
      strength = Math.pow(Math.sin(Math.PI * progress), 0.7) * opacity,
      tailWidth = Math.min(32, outer.w * 0.2),
      leadingWidth = Math.min(3, outer.w * 0.02);
    traceEchoPath(ctx, line);
    ctx.clip();
    ctx.globalAlpha = 1;
    const scan = ctx.createLinearGradient(x - tailWidth, 0, x + leadingWidth, 0);
    scan.addColorStop(0, withAlpha(tint, 0));
    scan.addColorStop(0.8, withAlpha(tint, 0.09 * strength));
    scan.addColorStop(1, withAlpha(tint, 0.2 * strength));
    ctx.fillStyle = scan;
    ctx.fillRect(x - tailWidth, outer.y - 8, tailWidth + leadingWidth, outer.h + 16);
    ctx.strokeStyle = withAlpha(tint, 0.45 * strength);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, outer.y);
    ctx.lineTo(x, outer.y + outer.h);
    ctx.stroke();
    ctx.restore();
  }

  function create(options) {
    const canvas = options.fxCanvas,
      ctx = canvas?.getContext("2d"),
      textLayer = options.textLayer,
      t = options.t,
      getTransform = options.getTransform,
      getAiColor = options.getAiColor || (() => "#526ff1"),
      getReducedMotion = options.getReducedMotion || (() => false),
      styleFor = options.styleFor || (() => null);
    let model = null,
      rafId = 0,
      startTime = 0,
      hideAt = 0,
      copyEl = null,
      copyStyle = null,
      captionEl = null,
      tintKey = null,
      themeTint = "#4f46e5";

    function getThemeTint() {
      const body = canvas.ownerDocument?.body;
      if (!body || typeof getComputedStyle !== "function") return themeTint;
      // Palette changes are owned by the existing theme controls. Avoid a
      // computed-style read on every animation frame or a second observer.
      const key = `${body.dataset.theme || ""}:${body.dataset.studioPalette || ""}`;
      if (key !== tintKey) {
        const style = getComputedStyle(canvas);
        themeTint = (body.dataset.theme === "studio"
          ? style.getPropertyValue("--studio-accent")
          : style.getPropertyValue("--gold-bright")).trim() || "#4f46e5";
        tintKey = key;
      }
      return themeTint;
    }

    function now() {
      return performance.now() / 1000;
    }

    function applyText() {
      if (captionEl) captionEl.textContent = t("summonUnderstanding");
    }

    function buildText() {
      if (!textLayer) return;
      textLayer.textContent = "";
      copyEl = document.createElement("div");
      copyEl.className = "summon-copy";
      copyStyle = styleFor(copyEl);
      captionEl = document.createElement("div");
      captionEl.className = "summon-caption";
      copyEl.append(captionEl);
      textLayer.appendChild(copyEl);
      applyText();
    }

    function placeText(layout, fade, color) {
      if (!copyStyle) return;
      copyStyle.setProperty("left", `${layout.status.x}px`);
      copyStyle.setProperty("top", `${layout.status.y}px`);
      copyStyle.setProperty("width", `${layout.status.w}px`);
      copyStyle.setProperty("opacity", String(fade));
      copyStyle.setProperty("--summon-accent", color);
    }

    function stop() {
      cancelAnimationFrame(rafId);
      rafId = 0;
      model = null;
      hideAt = 0;
      copyEl = null;
      copyStyle = null;
      captionEl = null;
      if (textLayer) textLayer.textContent = "";
      if (ctx && canvas) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        delete canvas.dataset.effect;
        canvas.hidden = true;
      }
    }

    function frame() {
      if (!model) return;
      rafId = requestAnimationFrame(frame);
      const transform = getTransform(),
        dpr = Math.max(1, Number(transform.dpr) || 1),
        elapsed = now() - startTime,
        layout = echoLayout(projectRegion(model.region, transform), transform),
        color = getAiColor() || "#526ff1",
        tint = getThemeTint();
      let fade = 1;
      if (hideAt) {
        fade = clamp01(1 - (now() - hideAt) / THINKING_LAYOUT.fadeSeconds);
        if (fade <= 0) {
          stop();
          return;
        }
      }
      if (canvas.width !== Math.round(transform.width * dpr) || canvas.height !== Math.round(transform.height * dpr)) {
        canvas.width = Math.round(transform.width * dpr);
        canvas.height = Math.round(transform.height * dpr);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const outer = layout.outer;
      if (!model.outline || ["x", "y", "w", "h"].some((key) => model.outer[key] !== outer[key])) {
        model.outer = outer;
        model.outline = buildEchoLine(outer);
      }
      drawLightSweep(ctx, model.outline, outer, elapsed, getReducedMotion(), tint, fade);
      placeText(layout, fade, color);
    }

    function show(region) {
      if (!ctx || !canvas || !textLayer) return false;
      stop();
      model = { region:normalizeRegion(region) };
      if (!model.region) {
        // Resolve an unanchored request once, so later pans also move its echo.
        const transform = getTransform(),
          source = echoLayout(null, transform).source,
          scale = Math.max(0.03, Number(transform.scale) || 1);
        model.region = {
          x:(source.x - (Number(transform.panX) || 0)) / scale,
          y:(source.y - (Number(transform.panY) || 0)) / scale,
          w:source.w / scale,
          h:source.h / scale,
        };
      }
      buildText();
      canvas.dataset.effect = "spatial-echo";
      canvas.hidden = false;
      tintKey = null;
      startTime = now();
      hideAt = 0;
      rafId = requestAnimationFrame(frame);
      return true;
    }

    function hide() {
      if (model && !hideAt) hideAt = now();
      else if (!model) stop();
    }

    return {
      show,
      hide,
      refreshText:applyText,
      get type() {
        return model ? "spatial-echo" : "";
      },
      get active() {
        return Boolean(model);
      },
    };
  }

  return {
    THINKING_LAYOUT,
    normalizeRegion,
    projectRegion,
    echoLayout,
    buildEchoContour,
    buildEchoLine,
    pointAtDistance,
    drawLightSweep,
    create,
  };
});
