/* PenEcho slide charts 1. Draws presentation charts as SVG inside a sized box: SC.bar, SC.line, SC.donut. */
(function (root) {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs, parent, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function box(target) {
    var node = typeof target === "string" ? document.querySelector(target) : target;
    if (!node) throw new Error("Chart box not found: " + target);
    node.innerHTML = "";
    var w = node.clientWidth || 600, h = node.clientHeight || 360;
    var svg = el("svg", { width: w, height: h, viewBox: "0 0 " + w + " " + h, "font-family": "Arial, Helvetica, sans-serif" }, node);
    svg.style.display = "block"; svg.style.overflow = "hidden";
    return { svg: svg, w: w, h: h };
  }
  function ticksFor(lo, hi, count) {
    var raw = (hi - lo) / count, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
    var step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
    var a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, out = [];
    for (var v = a; v <= b + step / 2; v += step) out.push(Math.round(v / step) * step);
    return out;
  }
  // Axis ticks that hug the data: of 3 to 6 steps, the set that wastes the least room.
  function ticks(lo, hi, count) {
    if (hi === lo) hi = lo + 1;
    if (count) return ticksFor(lo, hi, count);
    // Every round step from 1, 2, 2.5, 5 x 10^k that gives 3 to 7 intervals; keep the one that wastes the least room.
    var best = null, p = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4)));
    [0.1, 1, 10].forEach(function (k) {
      [1, 2, 2.5, 5].forEach(function (m) {
        var step = m * p * k, a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, n = Math.round((b - a) / step);
        if (n < 3 || n > 7) return;
        var waste = ((b - a) - (hi - lo)) / (b - a) + (n === 7 ? 0.03 : 0);
        if (!best || waste < best.waste - 0.01) { var t = []; for (var i = 0; i <= n; i++) t.push(Math.round((a + i * step) / step) * step); best = { t: t, waste: waste }; }
      });
    });
    return best ? best.t : ticksFor(lo, hi, 4);
  }
  function auto(v) {
    var a = Math.abs(v);
    return a >= 1000 ? Math.round(v).toLocaleString("en-US") : a >= 100 ? String(Math.round(v)) : a >= 10 ? (Math.round(v * 10) / 10).toString() : (Math.round(v * 100) / 100).toString();
  }
  // Labels keep the data's own precision: 0.55 stays 0.55, and 7 shows as 7.0 beside 6.1.
  function decimalsOf(values) {
    var d = 0;
    (values || []).forEach(function (v) { if (v == null || isNaN(v)) return; var m = /\.(\d+)/.exec(String(v)); if (m) d = Math.max(d, Math.min(2, m[1].length)); });
    return d;
  }
  function fixed(v, d) { var n = Number(v); return Math.abs(n) >= 1000 ? n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : n.toFixed(d); }
  function fmtOf(f, values) {
    if (typeof f === "function") return f;
    var d = values ? decimalsOf(values) : null, plain = function (v) { return d == null ? auto(v) : fixed(v, d); };
    if (typeof f === "string") {
      var m = /^(.*?)\{(\d)?\}(.*)$/.exec(f);
      if (m) return function (v) { return m[1] + (m[2] != null ? fixed(v, +m[2]) : plain(v)) + m[3]; };
    }
    return plain;
  }
  function textWidth(svg, s, size, weight) {
    var t = el("text", { x: -9999, y: -9999, "font-size": size, "font-weight": weight || 400 }, svg, s);
    var w = t.getComputedTextLength(); svg.removeChild(t); return w;
  }
  // White text on dark fills, dark text on light ones.
  function ink(fill) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(fill || "")); if (!m) return "#fff";
    var n = parseInt(m[1], 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#1d252c" : "#fff";
  }
  function halo(t) { if (!t.getAttribute("class")) t.setAttribute("class", "dl"); t.setAttribute("paint-order", "stroke"); t.setAttribute("stroke", "#fff"); t.setAttribute("stroke-width", 3); t.setAttribute("stroke-linejoin", "round"); return t; }
  function overlaps(a, b) { return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height; }
  // Data labels never sit on each other: a later label moves up a step, or is left out.
  function dodge(svg, labels, keep) {
    var placed = (keep || []).slice();
    labels.forEach(function (t) {
      var r = t.getBBox(), tries = 0;
      while (placed.some(function (o) { return overlaps(r, o); }) && tries++ < 3) { t.setAttribute("y", +t.getAttribute("y") - r.height * 0.9); r = t.getBBox(); }
      if (placed.some(function (o) { return overlaps(r, o); })) { t.parentNode.removeChild(t); hidden++; } else placed.push(r);
    });
  }
  function legend(svg, items, x, y, maxW) {
    var cx = x, cy = y, g = el("g", {}, svg);
    items.forEach(function (it) {
      var w = 22 + textWidth(svg, it.name, 12) + 18;
      if (cx + w > x + maxW && cx > x) { cx = x; cy += 18; }
      if (it.kind === "dash") el("line", { x1: cx, y1: cy + 6, x2: cx + 16, y2: cy + 6, stroke: it.color, "stroke-width": 2, "stroke-dasharray": "4 3" }, g);
      else if (it.kind === "line") { el("line", { x1: cx, y1: cy + 6, x2: cx + 16, y2: cy + 6, stroke: it.color, "stroke-width": 2.5, "stroke-dasharray": it.dashed ? "4 3" : null }, g); el("circle", { cx: cx + 8, cy: cy + 6, r: 3, fill: it.color }, g); }
      else if (it.kind === "dot") el("circle", { cx: cx + 7, cy: cy + 6, r: 4.5, fill: it.color }, g);
      else if (it.kind === "outline") el("rect", { x: cx + 1, y: cy + 1, width: 13, height: 10, fill: "none", stroke: it.color, "stroke-width": 1.5 }, g);
      else el("rect", { x: cx, y: cy, width: 14, height: 12, fill: it.color }, g);
      el("text", { x: cx + 20, y: cy + 10.5, "font-size": 12, fill: "#4a5560" }, g, it.name);
      cx += w;
    });
    [].forEach.call(g.childNodes, over);
    return cy + 18 - y;
  }
  function num(v) { return v == null || v === "" ? NaN : Number(v); }
  var hidden = 0, failures = [], pending = [], settled = false, specs = [];
  // Each chart leaves its specification on its box, so PowerPoint export can rebuild it as a native, editable chart;
  // marks drawn on top of the plot (forecast box, callouts, end labels) are tagged so they can be placed over it.
  function record(svg, spec) { specs.push(spec); svg.parentNode.setAttribute("data-sc", String(specs.length - 1)); }
  function over(node) { if (node) node.setAttribute("class", ((node.getAttribute("class") || "") + " sc-over").trim()); return node; }
  function plainSeries(series) { return series.map(function (s) { return { name: s.name, values: s.values.map(function (v) { return v == null || isNaN(v) ? null : v; }), color: s.nativeColor || s.color, colors: s.fills || s.colors || null, type: s.type || null, dashed: !!s.dashed, step: !!s.step, axis: s.axis || null }; }); }
  // A native chart gives each series one colour (a colour per bar only for a single series of bars): the most common colour
  // becomes the series colour, and bars painted otherwise (highlights) are placed over the chart with their labels.
  function settle(series, fills, marks, perPoint) {
    series.forEach(function (s, k) {
      if (s.type === "dot") return;
      var count = {}, best = null;
      fills[k].forEach(function (f) { if (!f) return; count[f] = (count[f] || 0) + 1; if (!best || count[f] > count[best]) best = f; });
      s.nativeColor = best || s.color; s.fills = fills[k];
      if (!perPoint) marks[k].forEach(function (m) { if (m.rect.getAttribute("fill") !== s.nativeColor) { over(m.rect); if (m.label) over(m.label); } });
    });
  }
  // Problems a reader would notice, found from the rendered slide: empty space in panels, clipped or overlapping text,
  // labels the charts had to hide, content running into the footer. Returns plain sentences.
  function check() {
    var out = [], slide = document.querySelector("[data-penecho-slide]");
    if (!slide || /\bcover\b/.test(slide.className)) return out;
    var base = slide.getBoundingClientRect(), body = slide.querySelector(".body"), foot = slide.querySelector(".ft");
    var visible = function (e) { var cs = getComputedStyle(e); return cs.display !== "none" && cs.visibility !== "hidden" && e.getBoundingClientRect().height > 0; };
    var inked = function (e) {
      if (/^(svg|img|canvas|table)$/i.test(e.tagName)) return true;
      var cs = getComputedStyle(e);
      if (cs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) && e !== slide) return true;
      for (var c = e.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && c.textContent.trim()) return true;
      return false;
    };
    var name = function (e) { var h = e.querySelector("h2, .bar, h3, .cap"); return h ? "\u201c" + h.textContent.trim().slice(0, 40) + "\u201d" : "the " + (e.className || e.tagName.toLowerCase()) + " panel"; };
    if (body) {
      var br = body.getBoundingClientRect();
      [].forEach.call(body.children, function (panel) {
        if (!visible(panel) || /\bsep\b/.test(panel.className)) return;
        var pr = panel.getBoundingClientRect(); if (pr.height < 160 || pr.width < 60) return;
        var bottom = pr.top;
        [].forEach.call(panel.querySelectorAll("*"), function (e) { if (visible(e) && inked(e)) bottom = Math.max(bottom, e.getBoundingClientRect().bottom); });
        var gap = Math.round(Math.min(pr.bottom, br.bottom) - bottom);
        if (gap > 70) out.push(name(panel) + " leaves " + gap + " px empty at the bottom (" + Math.round(gap / pr.height * 100) + "% of its height): add a chart or content from the data there, or let a chart grow into it.");
      });
    }
    var texts = [].filter.call(slide.querySelectorAll("h1,h2,h3,p,span,b,i,em,strong,td,th,li,div"), function (e) {
      if (!visible(e) || e.closest("svg")) return false;
      for (var c = e.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && c.textContent.trim()) return true;
      return false;
    });
    texts.forEach(function (e) {
      var r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      if (r.right > base.right + 1 || r.bottom > base.bottom + 1) out.push("Text \u201c" + e.textContent.trim().slice(0, 50) + "\u201d runs off the slide.");
      else if ((e.scrollHeight > e.clientHeight + 3 && cs.overflowY !== "visible") || (e.scrollWidth > e.clientWidth + 3 && cs.overflowX !== "visible" && cs.textOverflow !== "clip")) out.push("Text \u201c" + e.textContent.trim().slice(0, 50) + "\u201d is cut off by its box.");
    });
    for (var a = 0; a < texts.length; a++) for (var b = a + 1; b < texts.length; b++) {
      var A = texts[a], B = texts[b];
      if (A.contains(B) || B.contains(A)) continue;
      var ra = A.getBoundingClientRect(), rb = B.getBoundingClientRect();
      if (ra.left < rb.right - 2 && rb.left < ra.right - 2 && ra.top < rb.bottom - 2 && rb.top < ra.bottom - 2) out.push("Text \u201c" + A.textContent.trim().slice(0, 40) + "\u201d overlaps \u201c" + B.textContent.trim().slice(0, 40) + "\u201d.");
    }
    if (foot && body) {
      var ft = foot.getBoundingClientRect().top, lowest = 0;
      [].forEach.call(body.querySelectorAll("*"), function (e) { if (visible(e) && inked(e)) lowest = Math.max(lowest, e.getBoundingClientRect().bottom); });
      if (lowest > ft + 1) out.push("Content runs " + Math.round(lowest - ft) + " px into the footer.");
    }
    failures.forEach(function (f) { out.push(f); });
    [].forEach.call(slide.querySelectorAll(".chart, [id^='c']"), function (c) { if (c.tagName !== "svg" && !c.querySelector("svg") && c.getBoundingClientRect().height > 100 && !c.textContent.trim()) out.push("The box #" + (c.id || "chart") + " is empty: draw its chart or remove it."); });
    if (hidden) out.push(hidden + " chart labels were hidden because they would overlap: give the chart more room or show fewer labels (labels:'last' or format).");
    var h1 = slide.querySelector(".hd h1");
    if (h1 && h1.getAttribute("data-shrunk")) out.push("The title is too long for its line and had to shrink: shorten it.");
    return out.filter(function (x, i, all) { return all.indexOf(x) === i; }).slice(0, 12);
  }
  var PALETTE = ["#1F6FD1", "#9CC3EE", "#0B4F7A", "#00BFB3", "#F28C1C", "#7AA63A", "#4B2A99", "#A58BE0"];
  function seriesOf(o) { return (o.series || []).map(function (s, i) { return { name: s.name || "", values: s.values.map(num), color: s.color || PALETTE[i % PALETTE.length], colors: s.colors, dashed: s.dashed, axis: s.axis, step: s.step, type: s.type, labels: s.labels, legendColor: s.color || (s.colors && s.colors[s.colors.length - 1]) }; }); }

  // The template decides the house style of charts (CSS custom properties on the slide), so every slide matches.
  function house(name) {
    try { var slide = document.querySelector("[data-penecho-slide]"); return slide ? getComputedStyle(slide).getPropertyValue(name).trim() : ""; } catch (e) { return ""; }
  }
  // Axis ticks speak the same unit as the data labels: '{}%' gives ticks like 20%, '${}Bn' gives $20Bn.
  function axisFmtOf(o, tickValues) {
    if (o.axisFormat) return fmtOf(o.axisFormat);
    var d = tickValues ? decimalsOf(tickValues.map(function (t) { return Math.round(t * 100) / 100; })) : null;
    var plain = function (v) { return d == null ? auto(v) : fixed(v, d); };
    var m = typeof o.format === "string" && /^(.*?)\{\d?\}(.*)$/.exec(o.format);
    return m ? function (v) { return m[1] + plain(v) + m[2]; } : plain;
  }
  // Bars: vertical (default) or horizontal, grouped or stacked, with an optional line on a right axis.
  function bar(target, o) {
    if (house("--sc-bar-axis") === "off" && o.axis !== true) o.axis = false;
    if (house("--sc-labels") === "all" && o.labels === "none" && !o.stacked) o.labels = "all";
    var B = box(target), svg = B.svg, series = seriesOf(o), cats = o.categories.map(String), stacked = !!o.stacked, horiz = !!o.horizontal;
    var fmt = fmtOf(o.format, [].concat.apply([], series.map(function (s) { return s.values; })));
    var lineS = o.line ? { name: o.line.name || "", values: o.line.values.map(num), color: o.line.color || "#0B4F7A", format: fmtOf(o.line.format, o.line.values), title: o.line.title } : null;
    var fills = series.map(function () { return cats.map(function () { return null; }); }), marks = series.map(function () { return []; });
    var paint = function (k, i, rect, label) { fills[k][i] = rect.getAttribute("fill"); marks[k].push({ rect: rect, label: label }); return rect; };
    var legendItems = o.legend === false || (series.length + (lineS ? 1 : 0) < 2 && o.legend !== true && !(o.highlight && o.highlight.label)) ? [] : series.filter(function (s) { return s.name; }).map(function (s) { return { name: s.name, color: s.legendColor || s.color, kind: s.type === "dot" ? "dot" : null }; });
    if (lineS && lineS.name && o.legend !== false) legendItems.push({ name: lineS.name, color: lineS.color, kind: "line" });
    if (o.forecastFrom != null && o.legend !== false && o.forecastLegend) legendItems.push({ name: o.forecastLegend, color: "#1BA3D6", kind: "outline" });
    if (o.highlight && o.highlight.label && o.legend !== false) legendItems.push({ name: o.highlight.label, color: o.highlight.color || "#F28C1C" });
    (o.refLines || []).forEach(function (r) { if (r.label && !r.inline) legendItems.push({ name: r.label, color: r.color || "#5F6B73", kind: "dash" }); });
    var top = legendItems.length ? legend(svg, legendItems, 0, 0, B.w) + 10 : 6;
    var vals = [];
    if (stacked) cats.forEach(function (_, i) { var p = 0, n = 0; series.forEach(function (s) { var v = s.values[i] || 0; if (v >= 0) p += v; else n += v; }); vals.push(p, n); });
    else series.forEach(function (s) { vals = vals.concat(s.values); });
    (o.refLines || []).forEach(function (r) { vals.push(r.value); });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
    if (o.max != null) hi = o.max; if (o.min != null) lo = o.min;
    // Room for the labels of negative bars below them, and of positive bars above.
    var T, hasNeg = vals.some(function (v) { return v < 0; });
    if (o.axis === false && o.max == null && o.min == null) { var span = hi - lo || 1; lo = lo < 0 ? lo - span * 0.1 : lo; hi = hi > 0 ? hi + span * 0.12 : hi; T = [lo, hi]; }
    else { T = ticks(lo, hi, o.ticks); lo = T[0]; hi = T[T.length - 1]; }
    var labelSize = o.labelSize || 12, catSize = o.categorySize || 12.5;
    var showAxis = o.axis !== false;
    if (horiz) {
      var catW = Math.min(B.w * 0.36, Math.max.apply(null, cats.map(function (c) { return textWidth(svg, c, catSize, o.boldCategories ? 700 : 400); })) + 10);
      var wrapCat = function (c) {
        if (textWidth(svg, c, catSize, 700) <= catW - 10 || c.indexOf(" ") < 0) return [c];
        var words = c.split(" "), best = [c];
        for (var k = 1; k < words.length; k++) { var a = words.slice(0, k).join(" "), b2 = words.slice(k).join(" "); if (Math.max(textWidth(svg, a, catSize, 700), textWidth(svg, b2, catSize, 700)) <= catW - 10) { best = [a, b2]; break; } }
        if (best.length === 1) { var mid = Math.ceil(words.length / 2); best = [words.slice(0, mid).join(" "), words.slice(mid).join(" ")]; }
        return best;
      };
      var maxLab = Math.max.apply(null, vals.map(function (v) { return textWidth(svg, fmt(v), labelSize, 700); }));
      var negLab = lo < 0 ? Math.max.apply(null, vals.filter(function (v) { return v < 0; }).map(function (v) { return textWidth(svg, fmt(v), labelSize, 700); }).concat([0])) + 8 : 0;
      var L = catW + 6 + negLab, R = B.w - maxLab - 10, Tp = top, Bt = B.h - (showAxis ? 22 : 4);
      var X = function (v) { return L + (v - lo) / (hi - lo) * (R - L); };
      if (showAxis) T.forEach(function (t) { el("line", { x1: X(t), x2: X(t), y1: Tp, y2: Bt, stroke: "#E6E8EA" }, svg); el("text", { x: X(t), y: Bt + 16, "font-size": 11.5, fill: "#6b7680", "text-anchor": "middle" }, svg, axisFmtOf(o, T)(t)); });
      var band = (Bt - Tp) / cats.length, gw = o.barWidth > 1 ? Math.min(o.barWidth, band * 0.9) : band * (o.barWidth || 0.7), labels = [];
      cats.forEach(function (c, i) {
        var y0 = Tp + band * i + (band - gw) / 2;
        var lines2 = wrapCat(c);
        lines2.forEach(function (part, j) { el("text", { "class": "cat", x: L - 8 - negLab, y: Tp + band * i + band / 2 + 4.5 + (j - (lines2.length - 1) / 2) * (catSize + 1), "font-size": catSize, fill: "#2b333b", "text-anchor": "end", "font-weight": o.boldCategories || (o.highlight && o.highlight.index === i) ? 700 : 400 }, svg, part); });
        if (stacked) {
          var p = 0, n = 0;
          series.forEach(function (s) {
            var v = s.values[i] || 0, a = v >= 0 ? p : n + v, wpx = Math.abs(X(v) - X(0)), x0 = X(a);
            var seg = el("rect", { x: x0, y: y0, width: Math.max(0, wpx), height: gw, fill: (s.colors && s.colors[i]) || s.color }, svg);
            paint(series.indexOf(s), i, seg, o.segmentLabels !== false && wpx >= textWidth(svg, fmt(v), 11, 700) + 8 && v ? el("text", { x: x0 + wpx / 2, y: y0 + gw / 2 + 4, "font-size": 11, "font-weight": 700, fill: ink((s.colors && s.colors[i]) || s.color), "text-anchor": "middle" }, svg, fmt(v)) : null);
            if (v >= 0) p += v; else n += v;
          });
          if (o.labels !== "none") labels.push(halo(el("text", { x: X(p) + 6, y: y0 + gw / 2 + 4.5, "font-size": labelSize, "font-weight": 700, fill: "#2b333b" }, svg, fmt(p))));
        } else {
          var hbars = series.filter(function (x) { return x.type !== "dot"; }), bh = gw / Math.max(1, hbars.length);
          hbars.forEach(function (s, k) {
            var v = s.values[i]; if (v == null || isNaN(v)) return;
            var x0 = Math.min(X(0), X(v)), wpx = Math.abs(X(v) - X(0));
            var col = (o.highlight && o.highlight.index === i && k === (o.highlight.series || 0)) ? o.highlight.color : (s.colors && s.colors[i]) || s.color;
            paint(series.indexOf(s), i, el("rect", { x: x0, y: y0 + bh * k, width: Math.max(0, wpx), height: bh - (hbars.length > 1 ? 2 : 0), fill: col }, svg));
            if (o.labels !== "none") labels.push(halo(el("text", { x: v >= 0 ? X(v) + 5 : X(v) - 5, y: y0 + bh * k + bh / 2 + 4.2, "font-size": labelSize, "font-weight": 700, fill: "#2b333b", "text-anchor": v >= 0 ? "start" : "end" }, svg, fmt(v))));
          });
          // Dots (a second measure on the same scale) sit on the bars; PowerPoint cannot mix them into a bar chart, so they go on top.
          series.forEach(function (s) {
            if (s.type !== "dot") return;
            var v = s.values[i]; if (v == null || isNaN(v)) return;
            over(el("circle", { cx: X(v), cy: y0 + gw / 2, r: 4.5, fill: s.color, stroke: "#fff", "stroke-width": 1.2 }, svg));
          });
        }
      });
      el("line", { x1: X(0), x2: X(0), y1: Tp, y2: Bt, stroke: "#9aa3ab" }, svg);
      (o.refLines || []).forEach(function (r) { over(el("line", { x1: X(r.value), x2: X(r.value), y1: Tp - 4, y2: Bt, stroke: r.color || "#5F6B73", "stroke-dasharray": "5 4", "stroke-width": 1.5 }, svg)); if (r.label && r.inline) over(halo(el("text", { x: X(r.value) + 4, y: Tp + 8, "font-size": 11.5, fill: r.color || "#5F6B73", "font-weight": 700 }, svg, r.label))); });
      var nativeLabels = !stacked && (o.labels || "all") === "all";
      dodge(svg, labels, []);
      if (!nativeLabels) labels.forEach(function (t) { if (t.parentNode) over(t); });
      settle(series, fills, marks, !stacked && series.filter(function (x) { return x.type !== "dot"; }).length === 1);
      // With bars to the left of zero, names sit clear of their labels in their own column; a native axis would put them in the way.
      if (lo < 0) [].forEach.call(svg.querySelectorAll("text.cat"), over);
      record(svg, { kind: "bar", horizontal: true, catLabels: lo >= 0, stacked: stacked, categories: o.categories.map(String), series: plainSeries(series), format: typeof o.format === "string" ? o.format : "{}", decimals: decimalsOf(vals), lo: lo, hi: hi, step: T.length > 2 ? T[1] - T[0] : null, axis: showAxis, nativeLabels: nativeLabels, segmentLabels: stacked && o.segmentLabels !== false, highlight: o.highlight || null, refLines: (o.refLines || []).map(function (r) { return { value: r.value, label: r.label || "", color: r.color || "#5F6B73" }; }), gap: Math.round((band - gw) / (gw / (stacked ? 1 : Math.max(1, series.filter(function (x) { return x.type !== "dot"; }).length))) * 100), legend: legendItems.length > 0, plot: { x: L / B.w, y: Tp / B.h, w: (R - L) / B.w, h: (Bt - Tp) / B.h } });
      return svg;
    }
    var axisW = showAxis ? Math.max.apply(null, T.map(function (t) { return textWidth(svg, axisFmtOf(o, T)(t), 11.5); })) + 10 : 0;
    var rightW = 8, yTitle = o.yTitle ? 16 : 0;
    if (lineS) {
      var lvals = lineS.values.filter(function (v) { return v != null && !isNaN(v); });
      var LTpre = ticks(Math.min(0, Math.min.apply(null, lvals)), Math.max.apply(null, lvals) * 1.08, Math.max(3, Math.min(7, T.length - 1)));
      rightW = Math.max.apply(null, LTpre.map(function (t) { return textWidth(svg, lineS.format(t), 11.5); })) + 12 + (lineS.title ? 18 : 0);
    }
    var catLines = cats.some(function (c) { return /\n/.test(c); }) ? 2 : 1;
    // Long names wrap onto two lines before any are left out (years and quarters are thinned instead).
    var estBand = (B.w - axisW - yTitle - rightW) / cats.length;
    var widest = function () { return Math.max.apply(null, cats.map(function (c) { return Math.max.apply(null, c.split("\n").map(function (part) { return textWidth(svg, part, catSize, 700); })); })); };
    if (widest() > estBand - 4 && cats.some(function (c) { return / /.test(c) && !/\n/.test(c); }) && !cats.every(function (c) { return /^[\d'QH\s-]+$/.test(c); })) {
      cats = cats.map(function (c) { if (/\n/.test(c) || textWidth(svg, c, catSize, 700) <= estBand - 4) return c; var w = c.split(" "), best = c, score = Infinity; for (var k = 1; k < w.length; k++) { var a2 = w.slice(0, k).join(" "), b2 = w.slice(k).join(" "), sc = Math.max(textWidth(svg, a2, catSize, 700), textWidth(svg, b2, catSize, 700)); if (sc < score) { score = sc; best = a2 + "\n" + b2; } } return best; });
      catLines = 2;
    }
    var L = axisW + yTitle, R = B.w - rightW, Tp = top + 20 + (o.forecastFrom != null ? 22 : 0), Bt = B.h - 8 - 15 * catLines - (hasNeg ? 16 : 0);
    var Y = function (v) { return Bt - (v - lo) / (hi - lo) * (Bt - Tp); };
    if (o.yTitle) el("text", { x: 9, y: (Tp + Bt) / 2, "font-size": 11.5, fill: "#6b7680", "text-anchor": "middle", transform: "rotate(-90 9 " + (Tp + Bt) / 2 + ")" }, svg, o.yTitle);
    if (showAxis) T.forEach(function (t) { if (o.grid !== false) el("line", { x1: L, x2: R, y1: Y(t), y2: Y(t), stroke: "#E6E8EA" }, svg); el("text", { x: L - 6, y: Y(t) + 4, "font-size": 11.5, fill: "#6b7680", "text-anchor": "end" }, svg, axisFmtOf(o, T)(t)); });
    var band = (R - L) / cats.length, gw = Math.min(o.barWidth > 1 ? Math.min(o.barWidth, band * 0.9) : band * (o.barWidth || 0.68), o.maxBarWidth || 90), labels = [], keep = [];
    if (o.forecastFrom != null && o.forecastFrom < cats.length) {
      var fx = L + band * o.forecastFrom + 2, fw = R - fx - 2;
      // The box starts just above the plot and its label sits on top of it, clear of the bars' labels.
      over(el("rect", { x: fx, y: Tp - 18, width: fw, height: Bt - Tp + 18 + 15 * catLines + 2 + (hasNeg ? 16 : 0), fill: "none", stroke: "#1BA3D6", "stroke-width": 1.5 }, svg));
      var ft = over(el("text", { x: fx + fw / 2, y: Tp - 23, "font-size": 12.5, fill: "#1BA3D6", "text-anchor": "middle" }, svg, o.forecastLabel || "Forecast"));
      keep.push(ft.getBBox());
    }
    var catMax = widest();
    var catEvery = catMax > band - 4 ? Math.ceil((catMax + 8) / band) : 1;
    cats.forEach(function (c, i) {
      var cx = L + band * i + band / 2;
      if (i % catEvery === 0 || (i === cats.length - 1 && (i % catEvery) * band >= catMax + 8)) c.split("\n").forEach(function (part, j) { el("text", { "class": "cat", x: cx, y: Bt + 16 + j * 14 + (hasNeg ? 16 : 0), "font-size": catSize, fill: "#2b333b", "text-anchor": "middle", "font-weight": o.boldCategories || (o.highlight && o.highlight.index === i) ? 700 : 400 }, svg, part); });
      if (stacked) {
        var p = 0, n = 0;
        series.forEach(function (s) {
          var v = s.values[i] || 0, a = v >= 0 ? p + v : n, hpx = Math.abs(Y(0) - Y(v));
          var seg = el("rect", { x: cx - gw / 2, y: Y(a), width: gw, height: Math.max(0, hpx), fill: (s.colors && s.colors[i]) || s.color }, svg);
          paint(series.indexOf(s), i, seg, o.segmentLabels !== false && hpx >= 16 && v ? el("text", { x: cx, y: Y(a) + hpx / 2 + 4, "font-size": 11, "font-weight": 700, fill: ink((s.colors && s.colors[i]) || s.color), "text-anchor": "middle" }, svg, fmt(v)) : null);
          if (v >= 0) p += v; else n += v;
        });
        if (o.labels !== "none") labels.push(halo(el("text", { x: cx, y: Y(p) - 6, "font-size": labelSize, "font-weight": 700, fill: "#2b333b", "text-anchor": "middle" }, svg, fmt(p))));
      } else {
        var bars = series.filter(function (x) { return x.type !== "dot"; }), bw = gw / Math.max(1, bars.length);
        series.forEach(function (s) {
          if (s.type !== "dot") return;
          var v = s.values[i]; if (v == null || isNaN(v)) return;
          el("circle", { cx: cx, cy: Y(v), r: 4.5, fill: s.color, stroke: "#fff", "stroke-width": 1.2 }, svg);
          keep.push({ x: cx - 5, y: Y(v) - 5, width: 10, height: 10 });
          if (o.labels !== "none" && s.labels !== "none") labels.push(over(halo(el("text", { x: cx, y: v < 0 ? Y(v) + 16 : Y(v) - 9, "font-size": 11, "font-weight": 700, fill: s.color, "text-anchor": "middle" }, svg, fmt(v)))));
        });
        bars.forEach(function (s, k) {
          var v = s.values[i]; if (v == null || isNaN(v)) return;
          var x0 = cx - gw / 2 + bw * k, y0 = Math.min(Y(0), Y(v)), hpx = Math.abs(Y(v) - Y(0));
          var col = (o.highlight && o.highlight.index === i && k === (o.highlight.series || 0)) ? o.highlight.color : (s.colors && s.colors[i]) || s.color;
          paint(series.indexOf(s), i, el("rect", { x: x0 + (bars.length > 1 ? 1 : 0), y: y0, width: Math.max(1, bw - (bars.length > 1 ? 2 : 0)), height: Math.max(0, hpx), fill: col }, svg));
          if (lineS) keep.push({ x: x0, y: y0, width: bw, height: hpx });
          if (o.labels === "none" || (o.labels === "last" && i !== cats.length - 1)) return;
          if (o.labelsInside && hpx > 22 && v >= 0 && textWidth(svg, fmt(v), labelSize, 700) <= bw - 4) over(el("text", { x: x0 + bw / 2, y: y0 + 16, "font-size": labelSize, "font-weight": 700, fill: ink(col), "text-anchor": "middle" }, svg, fmt(v)));
          else labels.push(halo(el("text", { x: x0 + bw / 2, y: v >= 0 ? y0 - 6 : y0 + hpx + 14, "font-size": labelSize, "font-weight": 700, fill: "#2b333b", "text-anchor": "middle" }, svg, fmt(v))));
        });
      }
    });
    el("line", { x1: L, x2: R, y1: Y(0), y2: Y(0), stroke: "#9aa3ab" }, svg);
    (o.refLines || []).forEach(function (r) {
      var x1 = r.from != null ? L + band * r.from + 4 : L, x2 = r.to != null ? L + band * (r.to + 1) - 4 : R;
      el("line", { x1: x1, x2: x2, y1: Y(r.value), y2: Y(r.value), stroke: r.color || "#5F6B73", "stroke-dasharray": "5 4", "stroke-width": 1.5 }, svg);
      keep.push({ x: x1, y: Y(r.value) - 1.5, width: x2 - x1, height: 3 });
      if (r.label && r.inline) keep.push(over(halo(el("text", { x: x1 + 2, y: Y(r.value) - 5, "font-size": 11.5, fill: r.color || "#5F6B73", "font-weight": 700 }, svg, r.label))).getBBox());
    });
    if (lineS) {
      var lv = lineS.values.filter(function (v) { return v != null && !isNaN(v); });
      var LT = ticks(Math.min(0, Math.min.apply(null, lv)), Math.max.apply(null, lv) * 1.08, Math.max(3, Math.min(7, T.length - 1))), llo = LT[0], lhi = LT[LT.length - 1];
      var Y2 = function (v) { return Bt - (v - llo) / (lhi - llo) * (Bt - Tp); };
      LT.forEach(function (t) { el("text", { x: R + 6, y: Y2(t) + 4, "font-size": 11.5, fill: "#6b7680" }, svg, lineS.format(t)); });
      if (lineS.title) el("text", { x: B.w - 8, y: (Tp + Bt) / 2, "font-size": 11.5, fill: "#6b7680", "text-anchor": "middle", transform: "rotate(90 " + (B.w - 8) + " " + (Tp + Bt) / 2 + ")" }, svg, lineS.title);
      var d = "", pts = [];
      lineS.values.forEach(function (v, i) { if (v == null || isNaN(v)) return; var x = L + band * i + band / 2, y = Y2(v); d += (d ? "L" : "M") + x + " " + y; pts.push([x, y, v]); });
      el("path", { d: d, fill: "none", stroke: lineS.color, "stroke-width": 2.5 }, svg);
      pts.forEach(function (p) { el("circle", { cx: p[0], cy: p[1], r: 4, fill: lineS.color, stroke: "#fff", "stroke-width": 1.5 }, svg); keep.push({ x: p[0] - 5, y: p[1] - 5, width: 10, height: 10 }); });
      if (o.line.labels !== "none") pts.forEach(function (p, i) { if (o.line.labels === "ends" && i !== 0 && i !== pts.length - 1) return; labels.push(over(halo(el("text", { x: p[0], y: p[1] - 10, "font-size": 11.5, "font-weight": 700, fill: lineS.color, "text-anchor": "middle" }, svg, lineS.format(p[2]))))); });
    }
    dodge(svg, labels, keep);
    var nativeBarLabels = !stacked && (o.labels || "all") === "all" && !o.labelsInside;
    if (!nativeBarLabels) [].forEach.call(svg.querySelectorAll("text.dl"), function (t) { over(t); });
    settle(series, fills, marks, !stacked && series.filter(function (x) { return x.type !== "dot"; }).length === 1);
    record(svg, { kind: "bar", horizontal: false, stacked: stacked, categories: o.categories.map(String), series: plainSeries(series), format: typeof o.format === "string" ? o.format : "{}", decimals: decimalsOf(vals), lo: lo, hi: hi, step: T.length > 2 ? T[1] - T[0] : null, axis: showAxis, nativeLabels: nativeBarLabels, segmentLabels: stacked && o.segmentLabels !== false, every: catEvery, highlight: o.highlight || null,
      refLines: (o.refLines || []).map(function (r) { return { value: r.value, label: r.label || "", color: r.color || "#5F6B73", from: r.from == null ? null : r.from, to: r.to == null ? null : r.to }; }),
      line: lineS ? { name: lineS.name, values: lineS.values.map(function (v) { return v == null || isNaN(v) ? null : v; }), color: lineS.color, format: typeof o.line.format === "string" ? o.line.format : "{}", decimals: decimalsOf(lineS.values), lo: llo, hi: lhi, step: LT.length > 2 ? LT[1] - LT[0] : null, title: lineS.title || "" } : null,
      gap: Math.round((band - gw) / (gw / (stacked ? 1 : Math.max(1, series.filter(function (x) { return x.type !== "dot"; }).length))) * 100), legend: legendItems.length > 0, plot: { x: L / B.w, y: Tp / B.h, w: (R - L) / B.w, h: (Bt - Tp) / B.h } });
    return svg;
  }

  // Lines over time, with optional shaded band, reference lines and callouts on chosen points.
  function line(target, o) {
    var B = box(target), svg = B.svg, series = seriesOf(o), cats = o.categories.map(String);
    var fmt = fmtOf(o.format, [].concat.apply([], series.filter(function (s) { return s.axis !== "right"; }).map(function (s) { return s.values; })));
    var legendItems = o.legend === false || series.length < 2 ? [] : series.map(function (s) { return { name: s.name, color: s.color, kind: "line", dashed: s.dashed }; });
    var top = legendItems.length ? legend(svg, legendItems, 0, 0, B.w) + 10 : 6;
    // Each axis is scaled to its own series: left by default, right for series marked axis:'right'.
    var scaleOf = function (list, refs, min, max, zero) {
      var vals = [];
      list.forEach(function (s) { vals = vals.concat(s.values.filter(function (v) { return v != null && !isNaN(v); })); });
      (refs || []).forEach(function (r) { vals.push(r.value); });
      if (!vals.length) vals = [0, 1];
      var dlo = Math.min.apply(null, vals), dhi = Math.max.apply(null, vals), pad = (dhi - dlo) * 0.08 || 1;
      var T = ticks(min != null ? min : (zero ? Math.min(0, dlo) : dlo - pad), max != null ? max : dhi + pad, o.ticks);
      return { T: T, lo: T[0], hi: T[T.length - 1] };
    };
    var rightSeries = series.filter(function (s) { return s.axis === "right"; }), leftSeries = series.filter(function (s) { return s.axis !== "right"; });
    var leftScale = scaleOf(leftSeries, (o.refLines || []).filter(function (r) { return r.axis !== "right"; }), o.min, o.max, o.zero);
    var rightScale = rightSeries.length ? scaleOf(rightSeries, (o.refLines || []).filter(function (r) { return r.axis === "right"; }), o.rightMin, o.rightMax, o.rightZero) : null;
    var T = leftScale.T, lo = leftScale.lo, hi = leftScale.hi;
    var axisW = Math.max.apply(null, T.map(function (t) { return textWidth(svg, axisFmtOf(o, T)(t), 11.5); })) + 10, yTitle = o.yTitle ? 16 : 0;
    var fmtR = fmtOf(o.rightFormat || o.format, [].concat.apply([], series.filter(function (s) { return s.axis === "right"; }).map(function (s) { return s.values; }))), fmtFor = function (s) { return s.axis === "right" ? fmtR : fmt; };
    var endW = o.endLabels === false ? 12 : Math.max.apply(null, series.map(function (s) { var v = s.values.filter(function (x) { return x != null && !isNaN(x); }); return textWidth(svg, fmtFor(s)(v[v.length - 1]), 12, 700); })) + 14;
    var rightAxisW = rightScale ? Math.max.apply(null, rightScale.T.map(function (t) { return textWidth(svg, fmtOf(o.rightAxisFormat || o.rightFormat)(t), 11.5); })) + 10 + (o.rightTitle ? 20 : 0) : 0;
    var L = axisW + yTitle, R = B.w - endW - rightAxisW, Tp = top + 6, Bt = B.h - 24;
    var X = function (i) { return cats.length < 2 ? (L + R) / 2 : L + i * (R - L) / (cats.length - 1); };
    var Y = function (v) { return Bt - (v - lo) / (hi - lo) * (Bt - Tp); };
    var YR = rightScale ? function (v) { return Bt - (v - rightScale.lo) / (rightScale.hi - rightScale.lo) * (Bt - Tp); } : Y;
    var Yof = function (s) { return s.axis === "right" ? YR : Y; };
    if (o.yTitle) el("text", { x: 9, y: (Tp + Bt) / 2, "font-size": 11.5, fill: "#6b7680", "text-anchor": "middle", transform: "rotate(-90 9 " + (Tp + Bt) / 2 + ")" }, svg, o.yTitle);
    if (rightScale) {
      var ax = R + endW;
      rightScale.T.forEach(function (t) { el("text", { x: ax + 6, y: YR(t) + 4, "font-size": 11.5, fill: "#6b7680" }, svg, fmtOf(o.rightAxisFormat || o.rightFormat)(t)); });
      if (o.rightTitle) el("text", { x: B.w - 8, y: (Tp + Bt) / 2, "font-size": 11.5, fill: "#6b7680", "text-anchor": "middle", transform: "rotate(90 " + (B.w - 8) + " " + (Tp + Bt) / 2 + ")" }, svg, o.rightTitle);
    }
    if (o.band) over(el("rect", { x: X(o.band.from), y: Tp, width: Math.max(2, X(o.band.to) - X(o.band.from)), height: Bt - Tp, fill: o.band.color || "#E9EBEE", "fill-opacity": 0.6 }, svg));
    T.forEach(function (t) { el("line", { x1: L, x2: R, y1: Y(t), y2: Y(t), stroke: "#E6E8EA" }, svg); el("text", { x: L - 6, y: Y(t) + 4, "font-size": 11.5, fill: "#6b7680", "text-anchor": "end" }, svg, axisFmtOf(o, T)(t)); });
    var every = Math.max(1, Math.ceil(cats.length / (o.maxCategoryLabels || Math.floor((R - L) / 46))));
    cats.forEach(function (c, i) {
      if (!(i % every === 0 || i === cats.length - 1 && (cats.length - 1) % every >= Math.ceil(every * 0.75))) return;
      var w = textWidth(svg, c, 11.5), x = X(i), anchor = x + w / 2 > B.w ? "end" : x - w / 2 < 0 ? "start" : "middle";
      el("text", { "class": "cat", x: anchor === "end" ? B.w - 1 : anchor === "start" ? 1 : x, y: Bt + 17, "font-size": 11.5, fill: "#4a5560", "text-anchor": anchor }, svg, c);
    });
    el("line", { x1: L, x2: R, y1: Bt, y2: Bt, stroke: "#9aa3ab" }, svg);
    var keep = [], labels = [], ends = [];
    if (o.band && o.band.label) keep.push(over(el("text", { x: X(o.band.from) + 4, y: Tp + 12, "font-size": 11.5, fill: "#5F6B73" }, svg, o.band.label)).getBBox());
    (o.refLines || []).forEach(function (r) {
      var Yr = r.axis === "right" ? YR : Y;
      el("line", { x1: L, x2: R, y1: Yr(r.value), y2: Yr(r.value), stroke: r.color || "#5F6B73", "stroke-dasharray": "5 4", "stroke-width": 1.5 }, svg);
      keep.push({ x: L, y: Yr(r.value) - 1.5, width: R - L, height: 3 });
      if (r.label) keep.push(over(halo(el("text", { x: L + 6, y: Yr(r.value) - 5, "font-size": 11.5, fill: r.color || "#5F6B73", "font-weight": 700 }, svg, r.label))).getBBox());
    });
    series.forEach(function (s) {
      var d = "", last = null, Y = Yof(s), fmt = fmtFor(s);
      s.values.forEach(function (v, i) { if (v == null || isNaN(v)) return; if (d && s.step && last) d += "L" + X(i).toFixed(1) + " " + last[1].toFixed(1); d += (d ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); last = [X(i), Y(v), v]; });
      if (o.area && series.length === 1) el("path", { d: d + "L" + X(s.values.length - 1) + " " + Bt + "L" + X(0) + " " + Bt + "Z", fill: s.color, "fill-opacity": 0.12 }, svg);
      el("path", { d: d, fill: "none", stroke: s.color, "stroke-width": o.strokeWidth || 2.5, "stroke-dasharray": s.dashed ? "6 4" : null, "stroke-linejoin": "round" }, svg);
      if (o.markers) s.values.forEach(function (v, i) { if (v != null && !isNaN(v)) el("circle", { cx: X(i), cy: Y(v), r: 3.5, fill: s.color, stroke: "#fff", "stroke-width": 1.2 }, svg); });
      if (o.pointLabels) s.values.forEach(function (v, i) { if (v != null && !isNaN(v) && i !== s.values.length - 1) labels.push(halo(el("text", { x: X(i), y: Y(v) - 9, "font-size": 11, "font-weight": 700, fill: s.color, "text-anchor": "middle" }, svg, fmt(v)))); });
      var calledOut = (o.callouts || []).some(function (c) { return (c.series || 0) === series.indexOf(s) && c.index >= s.values.length - 1; });
      if (last && o.endLabels !== false) { el("circle", { cx: last[0], cy: last[1], r: 4.5, fill: s.color, stroke: "#fff", "stroke-width": 1.5 }, svg); if (!calledOut) ends.push(over(halo(el("text", { x: last[0] + 8, y: last[1] + 4, "font-size": 12, "font-weight": 700, fill: s.color }, svg, fmt(last[2]))))); }
    });
    ends.sort(function (a, b) { return +a.getAttribute("y") - +b.getAttribute("y"); });
    for (var e = 1; e < ends.length; e++) { var prev = +ends[e - 1].getAttribute("y"), cur = +ends[e].getAttribute("y"); if (cur - prev < 14) ends[e].setAttribute("y", prev + 14); }
    ends.forEach(function (t) { keep.push(t.getBBox()); });
    (o.callouts || []).forEach(function (c) {
      var s = series[c.series || 0], v = s.values[c.index], x = X(c.index), y = Yof(s)(v), up = c.below ? 1 : -1, fmt = fmtFor(s);
      el("circle", { cx: x, cy: y, r: 4, fill: s.color, stroke: "#fff", "stroke-width": 1.2 }, svg);
      var t = over(halo(el("text", { x: x, y: y + up * 14 + (up > 0 ? 6 : 0), "font-size": 11.5, "font-weight": 700, fill: "#2b333b", "text-anchor": x > R - 60 ? "end" : x < L + 60 ? "start" : "middle" }, svg, c.text || fmt(v))));
      labels.unshift(t);
    });
    dodge(svg, labels, keep);
    record(svg, { kind: "line", categories: cats, series: plainSeries(series), format: typeof o.format === "string" ? o.format : "{}", rightFormat: typeof (o.rightFormat || o.format) === "string" ? (o.rightFormat || o.format) : "{}",
      decimals: decimalsOf([].concat.apply([], leftSeries.map(function (s) { return s.values; }))), rightDecimals: decimalsOf([].concat.apply([], rightSeries.map(function (s) { return s.values; }))),
      lo: lo, hi: hi, step: T.length > 2 ? T[1] - T[0] : null, right: rightScale ? { lo: rightScale.lo, hi: rightScale.hi, step: rightScale.T.length > 2 ? rightScale.T[1] - rightScale.T[0] : null } : null,
      markers: !!o.markers, pointLabels: !!o.pointLabels, area: !!o.area && series.length === 1, every: every, width: o.strokeWidth || 2.5,
      refLines: (o.refLines || []).map(function (r) { return { value: r.value, label: r.label || "", color: r.color || "#5F6B73", axis: r.axis || null }; }),
      legend: legendItems.length > 0, plot: { x: L / B.w, y: Tp / B.h, w: (R - L) / B.w, h: (Bt - Tp) / B.h } });
    return svg;
  }

  // A ring with labelled shares; the centre can hold a short figure.
  function donut(target, o) {
    var B = box(target), svg = B.svg, items = o.items, total = items.reduce(function (a, b) { return a + Number(b.value); }, 0), fmt = fmtOf(o.format || "{0}%");
    var r = Math.min(B.h / 2 - 8, B.w * 0.26), cx = r + 8, cy = B.h / 2, inner = r * (o.inner || 0.58), a0 = -Math.PI / 2;
    items.forEach(function (it, i) {
      var a1 = a0 + Number(it.value) / total * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0, col = it.color || PALETTE[i % PALETTE.length];
      var p = function (a, rr) { return (cx + rr * Math.cos(a)).toFixed(2) + " " + (cy + rr * Math.sin(a)).toFixed(2); };
      el("path", { d: "M" + p(a0, r) + "A" + r + " " + r + " 0 " + large + " 1 " + p(a1, r) + "L" + p(a1, inner) + "A" + inner + " " + inner + " 0 " + large + " 0 " + p(a0, inner) + "Z", fill: col, stroke: "#fff", "stroke-width": 2 }, svg);
      var share = Number(it.value) / total * 100, ly = 18 + i * 26, lx = cx + r + 28;
      over(el("rect", { x: lx, y: ly - 11, width: 14, height: 14, fill: col }, svg));
      var valueText = o.share === false ? fmtOf(o.format)(it.value) : fmt(Math.round(share * 10) / 10), room = B.w - 4 - textWidth(svg, valueText, 13, 700) - 10 - (lx + 22), size = 13;
      while (size > 10.5 && textWidth(svg, it.label, size) > room) size -= 0.5;
      over(el("text", { x: lx + 22, y: ly + 1, "font-size": size, fill: "#2b333b" }, svg, it.label));
      over(el("text", { x: B.w - 4, y: ly + 1, "font-size": 13, "font-weight": 700, fill: "#2b333b", "text-anchor": "end" }, svg, o.share === false ? fmtOf(o.format)(it.value) : fmt(Math.round(share * 10) / 10)));
      a0 = a1;
    });
    if (o.center) { var lines = String(o.center).split("\n"); lines.forEach(function (s, j) { over(el("text", { x: cx, y: cy + (j - (lines.length - 1) / 2) * 22 + 7, "font-size": j ? 13 : 22, "font-weight": j ? 400 : 700, fill: "#2b333b", "text-anchor": "middle" }, svg, s)); }); }
    record(svg, { kind: "donut", items: items.map(function (it, i) { return { label: String(it.label), value: Number(it.value), color: it.color || PALETTE[i % PALETTE.length] }; }), inner: o.inner || 0.58, plot: { x: (cx - r) / B.w, y: (cy - r) / B.h, w: 2 * r / B.w, h: 2 * r / B.h } });
    return svg;
  }
  // Titles keep to their line budget (one line where the master says nowrap, else two) by shrinking a little.
  function fitTitles() {
    var titles = document.querySelectorAll("[data-penecho-slide] .hd h1");
    for (var i = 0; i < titles.length; i++) {
      var h = titles[i], cs = window.getComputedStyle(h), size = parseFloat(cs.fontSize), min = Math.max(20, size * 0.78);
      var oneLine = cs.whiteSpace === "nowrap", lines = function () { return h.getBoundingClientRect().height / (parseFloat(window.getComputedStyle(h).lineHeight) || size * 1.2); };
      var over = function () { return oneLine ? h.scrollWidth > h.clientWidth + 1 : lines() > 2.2; };
      var start = size;
      while (over() && size > min) { size -= 1; h.style.fontSize = size + "px"; }
      if (size < start * 0.9) h.setAttribute("data-shrunk", "1");
    }
  }
  function keepNumbersTogether() {
    var slide = document.querySelector("[data-penecho-slide]"); if (!slide) return;
    var walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT, null), nodes = [], n;
    while ((n = walker.nextNode())) if (!n.parentNode.closest("svg, script, style, nobr") && /\d\s*[\u2013\u2014-]\s*\d|[$\u00a3\u20ac]\s?\d|[~\u2248+]\s?\S*\d/.test(n.textContent)) nodes.push(n);
    var pattern = /[~\u2248<>+\u2212-]{0,2}\s?(?:[A-Z]{0,3}[$\u00a3\u20ac])?\d[\d.,]*(?:\s?[\u2013\u2014-]\s?(?:[A-Z]{0,3}[$\u00a3\u20ac])?\d[\d.,]*)?\s?(?:%|pp|bp|bps|x|Bn|Tn|M|K|bn|tn)?/g;
    nodes.forEach(function (node) {
      var text = node.textContent, out = document.createDocumentFragment(), last = 0, m;
      pattern.lastIndex = 0;
      while ((m = pattern.exec(text))) {
        // Only pieces a line could break inside: a range, a sign or currency before the number, a space before a unit.
        if (m[0].length < 3 || !/\d/.test(m[0]) || !/[\s\u2013\u2014~\u2248<>+\u2212$\u00a3\u20ac-]/.test(m[0].trim())) continue;
        if (m.index > last) out.appendChild(document.createTextNode(text.slice(last, m.index)));
        var keep = document.createElement("nobr"); keep.textContent = m[0]; out.appendChild(keep);
        last = m.index + m[0].length;
      }
      if (last === 0) return;
      if (last < text.length) out.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(out, node);
    });
  }
  function fitBody() {
    var slide = document.querySelector("[data-penecho-slide]"), hd = slide && slide.querySelector(".hd"), body = slide && slide.querySelector(".body");
    if (!hd || !body || /\bcover\b/.test(slide.className)) return;
    var gapWanted = parseFloat(getComputedStyle(slide).getPropertyValue("--title-gap")) || 36;
    var hdBottom = hd.getBoundingClientRect().bottom - slide.getBoundingClientRect().top, top = body.offsetTop, spare = top - hdBottom - gapWanted;
    if (spare > 12 && getComputedStyle(body).position === "absolute") { body.style.top = (top - spare) + "px"; body.style.height = (body.offsetHeight + spare) + "px"; }
  }
  // A slide is authored at 1280x720. In a smaller frame it is shown scaled down, never cut off.
  function fit() {
    var slide = document.querySelector("[data-penecho-slide]");
    if (!slide) return;
    var k = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    slide.style.transformOrigin = "0 0";
    slide.style.transform = k > 0 && k < 0.999 ? "scale(" + k + ")" : "";
    document.documentElement.style.overflow = "hidden";
  }
  if (typeof document !== "undefined") {
    window.addEventListener("resize", fit);
    var ready = function () { keepNumbersTogether(); fitTitles(); fitBody(); settled = true; var todo = pending; pending = []; todo.forEach(function (f) { f(); }); fit(); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready); else ready();
  }
  // Charts wait until the slide's layout has settled (title fitted, body moved), so they are drawn at their final size.
  function guarded(kind, draw) {
    return function (target, o) {
      if (!settled && typeof document !== "undefined" && document.readyState === "loading") { pending.push(function () { safe(target, o); }); return null; }
      return safe(target, o);
    };
    function safe(target, o) {
      try { return draw(target, o || {}); }
      catch (error) {
        failures.push("Chart " + target + " (" + kind + ") failed: " + String(error && error.message || error).slice(0, 160) + ". Check its options against the SC reference.");
        try { var n = typeof target === "string" ? document.querySelector(target) : target; if (n) n.innerHTML = ""; } catch (e) {}
        return null;
      }
    }
  }
  root.SC = { bar: guarded("bar", bar), line: guarded("line", line), donut: guarded("donut", donut), ticks: ticks, fit: fit, check: check, specs: specs, version: 2 };
})(typeof window !== "undefined" ? window : this);
