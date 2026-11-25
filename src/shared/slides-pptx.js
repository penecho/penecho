"use strict";
// Turns what a 1280x720 slide Widget reports about itself (its text, boxes, pictures and SC charts) into one
// PowerPoint slide with PptxGenJS. The Canvas (Download PPT on a slide) and the Lines pages (Download PPT on a
// Canvas card) both use it, so a deck downloads the same from either place.
var PenEchoSlidesPptx = (() => {
  const PPT_PX_PER_INCH = 96;
  const pptPoints = value => Math.round(value * 0.75 * 10) / 10;
  function addSlideText(pptx, slide, item, scaleX, scaleY) {
    const runs = [];
    for (const run of item.runs || []) {
      if (run.br) { if (runs.length) runs[runs.length - 1].options.breakLine = true; continue; }
      if (typeof run.text !== "string") continue;
      runs.push({ text:run.text, options:{ bold:run.bold === true, italic:run.italic === true, color:/^[0-9A-F]{6}$/.test(run.color) ? run.color : "000000",
        fontSize:pptPoints((Number(run.size) || 14) * scaleY), fontFace:String(run.font || "Arial").slice(0, 60), ...(run.sup ? { superscript:true } : {}) } });
    }
    if (!runs.length) return;
    const lineHeight = Number(item.lineHeight) || 16, textHeight = Number(item.textH) || Number(item.h) || lineHeight,
      lines = Math.max(1, Math.round(textHeight / lineHeight)),
      // PowerPoint wraps slightly earlier than the browser; give single lines room so they never wrap.
      slack = lines === 1 ? Math.max(12, item.w * 0.08) : item.w * 0.03;
    let x = item.x, width = item.w + slack;
    if (item.align === "center") x -= slack / 2;
    else if (item.align === "right") x -= slack;
    const middle = item.valign === "middle", top = middle ? item.y : Number.isFinite(item.textTop) ? Math.max(item.y, item.textTop) : item.y,
      options = { x:x * scaleX / PPT_PX_PER_INCH, y:top * scaleY / PPT_PX_PER_INCH, w:width * scaleX / PPT_PX_PER_INCH, h:(middle ? Math.max(item.h, lineHeight) : Math.max(textHeight, lineHeight)) * scaleY / PPT_PX_PER_INCH,
        margin:0, align:item.align || "left", valign:middle ? "middle" : "top", wrap:lines > 1, fit:"none", lineSpacing:pptPoints(lineHeight * scaleY), ...(item.letterSpacing ? { charSpacing:pptPoints(item.letterSpacing) } : {}) };
    if (item.vertical) {
      // Vertical text, such as a section tab: PowerPoint's own vertical text in the element's box.
      Object.assign(options, { x:item.x * scaleX / PPT_PX_PER_INCH, y:item.y * scaleY / PPT_PX_PER_INCH, w:item.w * scaleX / PPT_PX_PER_INCH, h:item.h * scaleY / PPT_PX_PER_INCH,
        vert:/sideways-lr|vertical-lr/.test(item.vertical) ? "vert270" : "vert", align:"center", valign:"middle", wrap:false });
    }
    slide.addText(runs, options);
  }
  // ---------- Native charts ----------
  const CHART_PICTURE = "penecho-chart-picture";
  // Charts drawn by the SC library are rebuilt as PowerPoint charts from their recorded specification: the data stays
  // editable in PowerPoint (Edit Data), with the same colours, number formats, axis range and plot area. Marks drawn over
  // the plot (legend, forecast box, highlights, callouts, end labels) are placed on top as shapes and text, where they were
  // on the slide. Anything else falls back to the picture.
  const chartHex = value => (/^#?([0-9a-f]{6})$/i.exec(String(value || ""))?.[1] || "5B5F63").toUpperCase();
  const chartNumber = value => value === null || value === "" || typeof value === "boolean" || !Number.isFinite(Number(value)) ? null : Number(value);
  const chartText = value => String(value ?? "").slice(0, 160);
  // The slide wrote the specification, so it is checked like any other slide content: plain numbers, short text, sane sizes.
  function chartSpec(raw) {
    if (!raw || typeof raw !== "object" || !["bar", "line", "donut"].includes(raw.kind)) return null;
    const plot = raw.plot && ["x", "y", "w", "h"].every(key => Number.isFinite(raw.plot[key]) && raw.plot[key] >= -0.05 && raw.plot[key] <= 1.05) ? raw.plot : undefined;
    const format = value => typeof value === "string" ? value.slice(0, 40) : "{}";
    if (raw.kind === "donut") {
      const items = Array.isArray(raw.items) ? raw.items.slice(0, 60).map(entry => ({ label:chartText(entry?.label), value:chartNumber(entry?.value), color:entry?.color })) : [];
      return items.length && items.every(entry => entry.value != null && entry.value >= 0) ? { kind:"donut", items, inner:chartNumber(raw.inner), plot } : null;
    }
    const categories = Array.isArray(raw.categories) ? raw.categories.slice(0, 400).map(chartText) : [];
    const series = Array.isArray(raw.series) ? raw.series.slice(0, 24).map(entry => ({ name:chartText(entry?.name), values:categories.map((_, index) => chartNumber(entry?.values?.[index])), color:entry?.color,
      colors:Array.isArray(entry?.colors) ? categories.map((_, index) => entry.colors[index]) : null, type:entry?.type === "dot" ? "dot" : null, dashed:entry?.dashed === true, step:entry?.step === true, axis:entry?.axis === "right" ? "right" : null })) : [];
    if (!categories.length || !series.length) return null;
    const range = (lo, hi, step) => { lo = chartNumber(lo); hi = chartNumber(hi); step = chartNumber(step); return lo != null && hi != null && hi > lo ? { lo, hi, step:step > 0 && (hi - lo) / step <= 50 ? step : null } : null; };
    const main = range(raw.lo, raw.hi, raw.step);
    if (!main) return null;
    const refLines = Array.isArray(raw.refLines) ? raw.refLines.slice(0, 8).filter(ref => chartNumber(ref?.value) != null).map(ref => ({ value:chartNumber(ref.value), label:chartText(ref.label), color:ref.color,
      from:chartNumber(ref.from), to:chartNumber(ref.to), axis:ref.axis === "right" ? "right" : null })) : [];
    const spec = { kind:raw.kind, categories, series, refLines, ...main, format:format(raw.format), decimals:chartNumber(raw.decimals) || 0, axis:raw.axis !== false, every:Math.max(1, Math.min(50, Math.round(chartNumber(raw.every) || 1))), plot };
    if (raw.kind === "bar") {
      const line = raw.line && typeof raw.line === "object" ? { ...range(raw.line.lo, raw.line.hi, raw.line.step), name:chartText(raw.line.name), values:categories.map((_, index) => chartNumber(raw.line.values?.[index])), color:raw.line.color,
        format:format(raw.line.format), decimals:chartNumber(raw.line.decimals) || 0, title:chartText(raw.line.title) } : null;
      if (line && line.lo == null) return null;
      return { ...spec, horizontal:raw.horizontal === true, catLabels:raw.catLabels !== false, stacked:raw.stacked === true, nativeLabels:raw.nativeLabels === true, segmentLabels:raw.segmentLabels === true, gap:chartNumber(raw.gap), line };
    }
    const right = raw.right && typeof raw.right === "object" ? range(raw.right.lo, raw.right.hi, raw.right.step) : null;
    return { ...spec, rightFormat:format(raw.rightFormat), rightDecimals:chartNumber(raw.rightDecimals) || 0, right, markers:raw.markers === true, pointLabels:raw.pointLabels === true, area:raw.area === true, width:chartNumber(raw.width) };
  }
  // An SC label format ('{}%', '${1}Bn', '{}x') as an Excel number format; values are plain numbers (24.1 means 24.1%).
  function chartNumberFormat(format, decimals) {
    const parts = /^(.*?)\{(\d)?\}(.*)$/.exec(String(format || "{}")) || [null, "", null, ""],
      places = parts[2] != null ? Number(parts[2]) : Math.max(0, Math.min(2, Number(decimals) || 0)),
      quote = text => { const clean = String(text || "").replace(/["\\]/g, ""); return clean ? `"${clean}"` : ""; };
    return `${quote(parts[1])}#,##0${places > 0 ? "." + "0".repeat(places) : ""}${quote(parts[3])}`;
  }
  const tickDecimals = (lo, step) => [lo, step].filter(Number.isFinite).reduce((most, value) => Math.max(most, (/\.(\d+)/.exec(String(Math.round(value * 100) / 100))?.[1] || "").length), 0);
  const CATEGORY_AXIS = { catAxisLabelFontFace:"Arial", catAxisLabelFontSize:9.5, catAxisLabelColor:"2B333B", catAxisLineShow:true, catAxisLineColor:"9AA3AB", catAxisMajorTickMark:"none", catGridLine:{ style:"none" } };
  function chartBase(item, box, spec) {
    // The legend is drawn over the chart where the slide had it, with the slide's own entries (highlights, ranges, dots).
    return { ...box, layout:spec.plot, showLegend:false, ...CATEGORY_AXIS, catAxisLabelFontBold:item.catBold === true,
      dataLabelFontFace:"Arial", dataLabelFontSize:9, dataLabelFontBold:true, dataLabelColor:"2B333B" };
  }
  function valueAxis(lo, hi, step, format, decimals, hidden) {
    return { valAxisHidden:hidden, valAxisMinVal:lo, valAxisMaxVal:hi, ...(step ? { valAxisMajorUnit:step } : {}), valAxisLabelFormatCode:chartNumberFormat(String(format || "{}").replace(/\{\d?\}/, `{${tickDecimals(lo, step)}}`), decimals),
      valAxisLabelFontFace:"Arial", valAxisLabelFontSize:9, valAxisLabelColor:"6B7680", valAxisLineShow:false, valAxisMajorTickMark:"none", valGridLine:hidden ? { style:"none" } : { color:"E6E8EA", size:0.75 } };
  }
  const lineType = (pptx, name, labels, values, color, options) => ({ type:pptx.ChartType.line, data:[{ name:name || " ", labels, values }], options:{ chartColors:[chartHex(color)], showValue:false, ...options } });
  function barChart(pptx, slide, item, box) {
    const spec = item.spec, flip = spec.horizontal, code = chartNumberFormat(spec.format, spec.decimals);
    // A horizontal chart lists its first category at the top: the rows are given bottom-up rather than reversing the axis,
    // which presentation apps place differently. Grouped bars also swap so the first series stays on top in each group.
    const order = spec.categories.map((_, index) => index);
    if (flip) order.reverse();
    const pick = list => order.map(index => list?.[index] ?? null), cats = pick(spec.categories);
    let bars = spec.series.filter(series => series.type !== "dot");
    const dots = flip ? [] : spec.series.filter(series => series.type === "dot");
    if (!bars.length) return false;
    if (flip && !spec.stacked) bars = bars.slice().reverse();
    let colors = bars.map(series => chartHex(series.color));
    if (bars.length === 1 && !spec.stacked && bars[0].colors) {
      const perBar = pick(bars[0].colors).map(value => chartHex(value || bars[0].color));
      if (new Set(perBar).size > 1) colors = perBar;
    }
    const base = chartBase(item, box, spec), axis = valueAxis(spec.lo, spec.hi, spec.step, spec.format, spec.decimals, !spec.axis),
      barOptions = { barDir:flip ? "bar" : "col", barGrouping:spec.stacked ? "stacked" : "clustered", barGapWidthPct:Math.max(0, Math.min(500, Number.isFinite(spec.gap) ? spec.gap : 50)), chartColors:colors,
        showValue:Boolean(spec.nativeLabels || spec.segmentLabels), dataLabelFormatCode:code, dataLabelPosition:spec.stacked ? "ctr" : "outEnd", dataLabelColor:spec.stacked ? "FFFFFF" : "2B333B", dataLabelFontBold:true, dataLabelFontSize:9 },
      catOptions = { catAxisLabelPos:spec.catLabels ? "low" : "none", ...(spec.every > 1 ? { catAxisLabelFrequency:spec.every } : {}) },
      data = bars.map(series => ({ name:series.name || " ", labels:cats, values:pick(series.values) })),
      refs = flip ? [] : spec.refLines;
    if (!spec.line && !dots.length && !refs.length) { slide.addChart(pptx.ChartType.bar, data, { ...base, ...axis, ...barOptions, ...catOptions }); return true; }
    const types = [{ type:pptx.ChartType.bar, data, options:barOptions }];
    for (const dot of dots) types.push(lineType(pptx, dot.name, cats, dot.values, dot.color, { lineSize:0, lineDataSymbol:"circle", lineDataSymbolSize:7 }));
    for (const ref of refs) types.push(lineType(pptx, ref.label, cats, cats.map((_, index) => (ref.from == null || index >= ref.from) && (ref.to == null || index <= ref.to) ? ref.value : null), ref.color, { lineSize:1.5, lineDash:"dash", lineDataSymbol:"none" }));
    if (!spec.line) { slide.addChart(types, { ...base, ...barOptions, ...axis, ...catOptions }); return true; }
    types.push(lineType(pptx, spec.line.name, cats, spec.line.values, spec.line.color, { lineSize:2, lineDataSymbol:"circle", lineDataSymbolSize:6, secondaryValAxis:true, secondaryCatAxis:true }));
    const right = { ...valueAxis(spec.line.lo, spec.line.hi, spec.line.step, spec.line.format, spec.line.decimals, false), valGridLine:{ style:"none" },
      ...(spec.line.title ? { showValAxisTitle:true, valAxisTitle:spec.line.title, valAxisTitleFontSize:9, valAxisTitleColor:"6B7680", valAxisTitleRotate:90 } : {}) };
    slide.addChart(types, { ...base, ...barOptions, valAxes:[axis, right], catAxes:[{ ...CATEGORY_AXIS, ...catOptions, catAxisLabelFontBold:item.catBold === true }, { catAxisHidden:true }] });
    return true;
  }
  function lineChart(pptx, slide, item, box) {
    const spec = item.spec, cats = spec.categories;
    // PowerPoint has no step line; such a chart keeps its picture.
    if (spec.series.some(series => series.step)) return false;
    const base = chartBase(item, box, spec), left = valueAxis(spec.lo, spec.hi, spec.step, spec.format, spec.decimals, false),
      common = { lineDataSymbol:spec.markers ? "circle" : "none", lineDataSymbolSize:6, lineSize:Math.max(1, Math.round((spec.width || 2.5) * 0.75 * 4) / 4), dataLabelPosition:"t" },
      catOptions = spec.every > 1 ? { catAxisLabelFrequency:spec.every } : {}, types = [];
    if (spec.area) types.push({ type:pptx.ChartType.area, data:[{ name:spec.series[0].name || " ", labels:cats, values:spec.series[0].values }], options:{ chartColors:[chartHex(spec.series[0].color)], chartColorsOpacity:12, showValue:false } });
    for (const series of spec.series) types.push(lineType(pptx, series.name, cats, series.values, series.color, { ...common, showValue:spec.pointLabels, dataLabelFormatCode:chartNumberFormat(series.axis === "right" ? spec.rightFormat : spec.format, series.axis === "right" ? spec.rightDecimals : spec.decimals),
      ...(series.dashed ? { lineDash:"dash" } : {}), ...(series.axis === "right" && spec.right ? { secondaryValAxis:true, secondaryCatAxis:true } : {}) }));
    for (const ref of spec.refLines) types.push(lineType(pptx, ref.label, cats, cats.map(() => ref.value), ref.color, { lineSize:1.5, lineDash:"dash", lineDataSymbol:"none", ...(ref.axis === "right" && spec.right ? { secondaryValAxis:true, secondaryCatAxis:true } : {}) }));
    const right = spec.right ? valueAxis(spec.right.lo, spec.right.hi, spec.right.step, spec.rightFormat, spec.rightDecimals, false) : null;
    slide.addChart(types, { ...base, ...(right ? { valAxes:[left, { ...right, valGridLine:{ style:"none" } }], catAxes:[{ ...CATEGORY_AXIS, ...catOptions }, { catAxisHidden:true }] } : { ...left, ...catOptions }) });
    return true;
  }
  function donutChart(pptx, slide, item, box) {
    const spec = item.spec;
    slide.addChart(pptx.ChartType.doughnut, [{ name:" ", labels:spec.items.map(entry => entry.label), values:spec.items.map(entry => entry.value) }],
      { ...box, layout:spec.plot, holeSize:Math.max(10, Math.min(90, Math.round((spec.inner || 0.58) * 100))), chartColors:spec.items.map(entry => chartHex(entry.color)), showLegend:false, showPercent:false, showValue:false, showLabel:false, dataBorder:{ pt:1.5, color:"FFFFFF" }, firstSliceAng:0 });
    return true;
  }
  function addSlideChart(pptx, slide, item, scaleX, scaleY) {
    const box = { x:item.x * scaleX / PPT_PX_PER_INCH, y:item.y * scaleY / PPT_PX_PER_INCH, w:Math.max(item.w, 1) * scaleX / PPT_PX_PER_INCH, h:Math.max(item.h, 1) * scaleY / PPT_PX_PER_INCH };
    let native = false;
    try {
      const spec = chartSpec(item.spec), chart = { ...item, spec };
      native = !spec ? false : spec.kind === "bar" ? barChart(pptx, slide, chart, box) : spec.kind === "line" ? lineChart(pptx, slide, chart, box) : donutChart(pptx, slide, chart, box);
    } catch { native = false; }
    const picture = typeof item.fallback === "string" && item.fallback.startsWith("data:image/");
    // The picture leaves out the marks drawn over the plot (plain); they are placed on top either way. A picture from an
    // older Widget host holds them already. Beside a native chart, the picture becomes its fallback (see withChartPictures).
    if (!native) {
      if (!picture) return false;
      slide.addImage({ data:item.fallback, ...box });
      if (item.plain !== true) return false;
    } else if (picture) slide.addImage({ data:item.fallback, ...box, altText:CHART_PICTURE });
    for (const mark of Array.isArray(item.overlays) ? item.overlays.slice(0, 600) : []) {
      if (![mark?.x, mark?.y, mark?.w, mark?.h].every(Number.isFinite)) continue;
      const at = { x:mark.x * scaleX / PPT_PX_PER_INCH, y:mark.y * scaleY / PPT_PX_PER_INCH, w:Math.max(mark.w, 0.5) * scaleX / PPT_PX_PER_INCH, h:Math.max(mark.h, 0.5) * scaleY / PPT_PX_PER_INCH };
      if (mark.type === "text") addSlideText(pptx, slide, mark, scaleX, scaleY);
      // A straight rule keeps a zero side, so it stays exactly horizontal or vertical.
      else if (mark.type === "line") slide.addShape(pptx.ShapeType.line, { ...at, ...(mark.w < 1 ? { w:0 } : {}), ...(mark.h < 1 ? { h:0 } : {}), line:{ color:chartHex(mark.color), width:pptPoints(mark.width), ...(mark.dash ? { dashType:"dash" } : {}) } });
      else if (mark.type === "rect") slide.addShape(mark.ellipse ? pptx.ShapeType.ellipse : pptx.ShapeType.rect, { ...at, fill:mark.fill ? { color:chartHex(mark.fill), transparency:mark.fillAlpha < 1 ? Math.round((1 - mark.fillAlpha) * 100) : 0 } : { type:"none" }, line:mark.line ? { color:chartHex(mark.line.color), width:pptPoints(mark.line.width) } : { type:"none" } });
    }
    return native;
  }
  function addPptSlide(pptx, data, notes) {
    const slide = pptx.addSlide(), scaleX = 1280 / (Number(data.width) || 1280), scaleY = 720 / (Number(data.height) || 720),
      hex = value => /^[0-9A-F]{6}$/.test(value || "") ? value : null;
    slide.background = { color:hex(data.background) || "FFFFFF" };
    for (const item of data.items) {
      if (![item.x, item.y, item.w, item.h].every(Number.isFinite)) continue;
      const box = { x:item.x * scaleX / PPT_PX_PER_INCH, y:item.y * scaleY / PPT_PX_PER_INCH, w:Math.max(item.w, 0.01) * scaleX / PPT_PX_PER_INCH, h:Math.max(item.h, 0.01) * scaleY / PPT_PX_PER_INCH };
      if (item.type === "image" && typeof item.data === "string" && item.data.startsWith("data:image/")) slide.addImage({ data:item.data, ...box });
      else if (item.type === "rect") {
        const rounded = item.radius > 0.5,
          shape = item.ellipse ? pptx.ShapeType.ellipse : rounded ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
        slide.addShape(shape, { ...box, fill:hex(item.fill) ? { color:item.fill, transparency:item.fillAlpha < 1 ? Math.round((1 - item.fillAlpha) * 100) : 0 } : { type:"none" },
          line:item.line && hex(item.line.color) ? { color:item.line.color, width:pptPoints(item.line.width) } : { type:"none" }, ...(rounded ? { rectRadius:item.radius * Math.min(scaleX, scaleY) / PPT_PX_PER_INCH } : {}) });
      } else if (item.type === "line" && hex(item.color)) slide.addShape(pptx.ShapeType.line, { ...box, line:{ color:item.color, width:pptPoints(item.width) } });
      else if (item.type === "text") addSlideText(pptx, slide, item, scaleX, scaleY);
      else if (item.type === "chart") addSlideChart(pptx, slide, item, scaleX, scaleY);
    }
    if (notes) slide.addNotes(notes);
  }
  const PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  // A file name from a deck or Canvas name, safe on every system.
  function pptFilename(name) {
    return `${String(name || "").replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-").replace(/[.\s]+$/g, "").trim().slice(0, 120) || "PenEcho slides"}.pptx`;
  }
  // One PowerPoint file from slides in reading order: each slide's own report and its title, kept as the speaker notes.
  // Apps that cannot draw charts, such as the Mac's Quick Look preview, show nothing where a native chart is. Each chart
  // therefore carries its picture as a fallback, the way PowerPoint keeps a picture beside ink: PowerPoint 2010 and later
  // and LibreOffice show the editable chart, and other apps show the picture. A picture that cannot be paired is dropped,
  // so it never covers its chart.
  const FRAME = /<p:graphicFrame>(?:(?!<\/p:graphicFrame>)[\s\S])*<\/p:graphicFrame>/.source,
    PICTURE = /<p:pic>(?:(?!<\/p:pic>)[\s\S])*<\/p:pic>/.source,
    MC = "http://schemas.openxmlformats.org/markup-compatibility/2006", P14 = "http://schemas.microsoft.com/office/powerpoint/2010/main";
  function withChartPictures(xml) {
    const marked = picture => picture.includes(`descr="${CHART_PICTURE}"`);
    xml = xml.replace(new RegExp(`(${FRAME})\s*(${PICTURE})`, "g"), (all, frame, picture) => !marked(picture) || !frame.includes("drawingml/2006/chart") ? all
      : `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:p14="${P14}" Requires="p14">${frame}</mc:Choice><mc:Fallback>${picture.replace(` descr="${CHART_PICTURE}"`, "")}</mc:Fallback></mc:AlternateContent>`);
    return xml.replace(new RegExp(PICTURE, "g"), picture => marked(picture) ? "" : picture);
  }
  // One PowerPoint file from slides in reading order: each slide's own report and its title, kept as the speaker notes.
  async function buildDeck(PptxGenJS, slides, title, { JSZip = globalThis.PENECHO_INK_TOOLS?.JSZip, type = "blob" } = {}) {
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.title = String(title || "PenEcho slides").slice(0, 200);
    pptx.author = "PenEcho";
    for (const slide of slides) addPptSlide(pptx, slide.data, slide.title);
    const file = await pptx.write({ outputType:"arraybuffer" }), zip = JSZip ? await JSZip.loadAsync(file) : null;
    if (!zip) return type === "blob" ? new Blob([file], { type:PPTX_TYPE }) : file;
    for (const name of Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))) zip.file(name, withChartPictures(await zip.file(name).async("string")));
    return zip.generateAsync({ type, mimeType:PPTX_TYPE, compression:"DEFLATE" });
  }
  return Object.freeze({ addPptSlide, chartSpec, chartNumberFormat, pptFilename, buildDeck, withChartPictures });
})();
if (typeof module === "object" && module.exports) module.exports = PenEchoSlidesPptx;
