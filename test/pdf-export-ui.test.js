"use strict";
// Download PDF entry points: the Canvas More menu, the Widget toolbar and a
// note in Notes & cards each run their own export through PenEchoPdf.
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const PDF = require("../src/client/app/pdf-document.js");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const slice = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} … ${end}`);
  return source.slice(from, to);
};
const run = (code, context) => { vm.createContext(context); vm.runInContext(code, context); return context; };
const plain = value => JSON.parse(JSON.stringify(value));
function pdfStub(calls, { fail = null } = {}) {
  const blob = { type:"application/pdf" };
  return { blob, PenEchoPdf:{
    MAX_TOTAL_PIXELS:PDF.MAX_TOTAL_PIXELS, POINTS_PER_CSS_PIXEL:PDF.POINTS_PER_CSS_PIXEL, filename:PDF.filename,
    fromImage:async (image, options) => { calls.push(["fromImage", image, options]); if (fail) throw Error(fail); return blob; },
    save:(value, name) => calls.push(["save", value, name]),
  } };
}

test("the More menu offers Download PDF right after Export PNG, without a toolbar icon", () => {
  const html = read("public/index.html"), menu = html.match(/<div id="canvasMoreMenu"[^>]*>([\s\S]*?)<\/div>/)[1],
    items = [...menu.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]),
    png = items.findIndex(item => item.includes('data-shell-forward="#exportPngBtn"')),
    pdf = items.findIndex(item => item.includes('id="exportPdfBtn"'));
  assert.ok(png >= 0);
  assert.equal(pdf, png + 1);
  assert.match(items[pdf], /^<button id="exportPdfBtn" type="button" role="menuitem" data-pe-button="menu-item"[^>]*><svg [^>]*aria-hidden="true">[\s\S]*<span data-i18n="downloadPdf">Download PDF<\/span><\/button>$/);
  assert.equal(html.match(/id="exportPdfBtn"/g).length, 1);
  assert.doesNotMatch(html.match(/<span id="canvasFileActions"[\s\S]*?<\/span>\s*<div id="canvasMoreControl"/)[0], /exportPdfBtn/);
  assert.match(read("src/client/app/core.js"), /downloadPdf: "Download PDF",\n\s*pdfPreparing: "Preparing PDF…",\n\s*pdfDownloaded: "PDF downloaded",\n\s*pdfFailed: "PDF could not be created",/);
  assert.match(read("public/locales/zh.js"), /downloadPdf: "下载 PDF",\n\s*pdfPreparing: "正在生成 PDF…",\n\s*pdfDownloaded: "PDF 已下载",\n\s*pdfFailed: "PDF 生成失败",/);
});

test("choosing Download PDF closes the More menu and runs exportCanvasPdf", async () => {
  const code = slice(read("src/client/app/ui-bootstrap.js"), "  // A direct More-menu item: close the menu, then export.", '  document.querySelector("#historyBtn").onclick');
  const control = {}, menu = { hidden:false }, more = { attributes:{}, setAttribute(name, value) { this.attributes[name] = value; } };
  let exports = 0;
  run(code, { document:{ querySelector:selector => ({ "#exportPdfBtn":control, "#canvasMoreMenu":menu, "#canvasMoreBtn":more })[selector] || null }, exportCanvasPdf:async () => { exports++; return true; } });
  assert.equal(await control.onclick(), true);
  assert.deepEqual([menu.hidden, more.attributes["aria-expanded"], exports], [true, "false", 1]);
  // Another surface may click the control while the menu is closed.
  await control.onclick();
  assert.equal(exports, 2);
});

function canvasHarness({ canvas = { width:3000, height:2000 }, fail = null, disabled = [] } = {}) {
  const calls = [], statuses = [], controls = { "#exportPdfBtn":{ disabled:false }, "#exportPngBtn":{ disabled:false } }, view = { disabled:false }, { blob, PenEchoPdf } = pdfStub(calls, { fail });
  for (const selector of disabled) (controls[selector] || view).disabled = true;
  const context = run(slice(read("src/client/app/persistence.js"), "  // The PNG export's rendering, within the PDF pixel budget", "  async function exportSelectionPng("), {
    document:{ querySelector:selector => controls[selector] || null }, canvasViewDownloadButton:view, PenEchoPdf, CANVAS_DOWNLOAD_RESOLUTION_SCALE:1.5,
    renderExportCanvas:async (...args) => {
      calls.push(["render", ...args]);
      assert.deepEqual([controls["#exportPdfBtn"].disabled, controls["#exportPngBtn"].disabled, view.disabled], [true, true, true], "exports are locked while rendering");
      return canvas;
    },
    exportFilename:() => "penecho-20261101-093005.png", currentCanvasDisplayName:() => "Roadmap",
    setStatusKey:key => statuses.push(key), setStatus:message => statuses.push(message), t:key => key,
  });
  return { context, calls, statuses, controls, view, blob };
}

test("exportCanvasPdf reuses the PNG rendering within the PDF pixel budget and saves a .pdf", async () => {
  const h = canvasHarness();
  assert.equal(await h.context.exportCanvasPdf(), true);
  assert.deepEqual(h.calls[0], ["render", null, null, PDF.MAX_TOTAL_PIXELS]);
  assert.equal(h.calls[1][0], "fromImage");
  assert.deepEqual(plain(h.calls[1][1]), { width:1, height:1 }, "the rendered canvas is released afterwards");
  assert.deepEqual(plain(h.calls[1][2]), { opaque:true, pointsPerPixel:0.5, title:"Roadmap" });
  assert.deepEqual(h.calls[2], ["save", h.blob, "penecho-20261101-093005.pdf"]);
  assert.deepEqual(h.statuses, ["pdfPreparing", "pdfDownloaded"]);
  assert.deepEqual([h.controls["#exportPdfBtn"].disabled, h.controls["#exportPngBtn"].disabled, h.view.disabled], [false, false, false]);
});

test("exportCanvasPdf waits for a running export, reports an empty Canvas and failures", async () => {
  for (const busy of ["#exportPngBtn", "#exportPdfBtn", "view"]) {
    const h = canvasHarness({ disabled:[busy] });
    assert.equal(await h.context.exportCanvasPdf(), false);
    assert.deepEqual(h.calls, []);
  }
  const empty = canvasHarness({ canvas:null });
  assert.equal(await empty.context.exportCanvasPdf(), false);
  assert.deepEqual(empty.statuses, ["pdfPreparing", "emptyCanvas"]);
  assert.equal(empty.calls.some(call => call[0] === "save"), false);
  const failed = canvasHarness({ fail:"JPEG unavailable" });
  assert.equal(await failed.context.exportCanvasPdf(), false);
  assert.deepEqual(failed.statuses, ["pdfPreparing", "pdfFailed: JPEG unavailable"]);
  assert.equal(failed.controls["#exportPdfBtn"].disabled, false);
});

test("the Widget toolbar places Download PDF next to the image download", () => {
  const code = slice(read("src/client/app/canvas-runtime.js"), "  function addWidgetToolSpecs(", "  function objectToolbarMinimumWidth(");
  const activated = [], context = run(code, {
    state:{ mode:"hand" }, widgetBox:() => ({ x:0, y:0, w:300, h:200 }), widgetCopySourceLabel:() => "", t:key => key, widgetAssistChipWidth:() => 80,
    noteCardWidget:() => false, deleteWidget() {}, enterWidgetInteraction() {},
    downloadWidgetImage:widget => activated.push(["png", widget]), downloadWidgetPdf:widget => activated.push(["pdf", widget]),
  });
  const widget = { id:"w1" }, specs = [];
  context.addWidgetToolSpecs(specs, widget, { download:true, objectToolbarKey:"toolbar" });
  assert.deepEqual(specs.map(spec => spec.kind), ["interact", "download", "downloadpdf", "delete"]);
  const pdf = specs.find(spec => spec.kind === "downloadpdf");
  assert.deepEqual([pdf.label, pdf.iconOnly, pdf.busy, pdf.baseWidth], ["downloadPdf", true, false, 28]);
  pdf.activate();
  assert.deepEqual(activated, [["pdf", widget]]);
  widget.pdfBusy = true;
  const busy = [];
  context.addWidgetToolSpecs(busy, widget, { download:true, objectToolbarKey:"toolbar" });
  assert.deepEqual(busy.filter(spec => spec.kind.startsWith("download")).map(spec => [spec.kind, spec.busy]), [["download", false], ["downloadpdf", true]]);
  const runtime = read("src/client/app/canvas-runtime.js");
  assert.match(runtime, /downloadpdf:'<svg viewBox="0 0 24 24" aria-hidden="true">/);
  assert.match(runtime, /if \(kind === "downloadpdf"\) return t\("downloadPdf"\);/);
});

function widgetHarness({ fail = null } = {}) {
  const calls = [], statuses = [], { blob, PenEchoPdf } = pdfStub(calls), snapshot = { image:{ naturalWidth:1350 }, contentWidth:900, contentHeight:2400 };
  let chrome = 0;
  const context = run(slice(read("src/client/app/canvas-runtime.js"), "  // A PDF of the complete Widget content.", "  async function downloadWidgetImage("), {
    PenEchoPdf, WIDGET_SNAPSHOT_TIMEOUT_MS:18000, t:key => key, syncObjectChrome:() => chrome++,
    setStatusKey:key => statuses.push(key), setStatus:message => statuses.push(message),
    noteCardWidget:widget => widget.note === true, noteCardSource:widget => ({ title:widget.title, blocks:[] }),
    noteCardPdfSnapshot:async note => { calls.push(["note", note]); return { image:{ naturalWidth:1350 }, contentWidth:900, contentHeight:1800 }; },
    requestWidgetSnapshot:async (...args) => {
      calls.push(["snapshot", ...args]);
      assert.equal(args[0].pdfBusy, true);
      if (fail) throw Error(fail);
      return snapshot;
    },
  });
  return { context, calls, statuses, blob, chrome:() => chrome, snapshot };
}

test("downloadWidgetPdf captures the full Widget content and names the file after it", async () => {
  const h = widgetHarness(), widget = { id:"w1", title:"Quarterly report" };
  assert.equal(await h.context.downloadWidgetPdf(widget), true);
  assert.deepEqual(h.calls[0], ["snapshot", widget, 18000, true, null, true, true]);
  assert.deepEqual([h.calls[1][0], h.calls[1][1]], ["fromImage", h.snapshot.image]);
  assert.deepEqual(plain(h.calls[1][2]), { title:"Quarterly report", pointsPerPixel:0.5 });
  assert.deepEqual(h.calls[2], ["save", h.blob, "Quarterly report.pdf"]);
  assert.deepEqual(h.statuses, ["pdfPreparing", "pdfDownloaded"]);
  assert.equal(widget.pdfBusy, false);
  assert.equal(h.chrome(), 2);
  // A second request while one is running is ignored.
  widget.pdfBusy = true;
  assert.equal(await h.context.downloadWidgetPdf(widget), false);
});

test("a note card on the Canvas downloads the whole note from its source", async () => {
  const h = widgetHarness(), widget = { id:"n1", title:"Weekly sync", note:true };
  assert.equal(await h.context.downloadWidgetPdf(widget), true);
  assert.equal(h.calls.some(call => call[0] === "snapshot"), false);
  assert.deepEqual(plain(h.calls[0]), ["note", { title:"Weekly sync", blocks:[] }]);
  assert.deepEqual(h.calls.at(-1), ["save", h.blob, "Weekly sync.pdf"]);
  const failed = widgetHarness({ fail:"Widget snapshot timed out" }), other = { id:"w2", title:"" };
  assert.equal(await failed.context.downloadWidgetPdf(other), false);
  assert.deepEqual(failed.statuses, ["pdfPreparing", "pdfFailed: Widget snapshot timed out"]);
  assert.equal(other.pdfBusy, false);
});

function snapshotHarness() {
  const posted = [], listeners = new Map(), frame = {
    style:{}, attributes:{}, setAttribute(name, value) { this.attributes[name] = value; },
    contentWindow:{ postMessage:(message, origin) => posted.push([message, origin]) }, remove() { this.removed = true; },
  };
  const context = run(slice(read("src/client/app/note-cards.js"), "  async function noteLibrarySnapshot(", "  async function noteEncodeThumbnail("), {
    state:{ language:"en" }, setTimeout, clearTimeout, URL,
    document:{ createElement:tag => { assert.equal(tag, "iframe"); return frame; }, body:{ append() {} } },
    window:{ addEventListener:(type, listener) => listeners.set(type, listener), removeEventListener:type => listeners.delete(type) },
    noteCardRuntime:() => ({ CONTENT:{ w:900, h:1200 }, FORMAT:"penecho-note-card+json", MAX_DOCUMENT_CHARS:700000 }),
    noteCardDocument:() => "<!doctype html><html><head><title>Note</title></head><body><article class=\"nc\"></article></body></html>",
    widgetHostUrl:() => "http://127.0.0.1:3888/widget-host.html", canvasClientId:() => "id-1",
    decodeWidgetSnapshot:async dataUrl => ({ naturalWidth:1350, dataUrl }),
  });
  const deliver = data => listeners.get("message")({ source:frame.contentWindow, origin:"http://127.0.0.1:3888", data });
  return { context, posted, deliver, frame, listeners };
}

test("a note PDF renders the whole note at high resolution, while previews stay unchanged", async () => {
  const note = { title:"Cell membranes" }, h = snapshotHarness(), pending = h.context.noteCardPdfSnapshot(note);
  h.deliver({ type:"penecho-widget-host-ready" });
  const [init] = h.posted[0];
  assert.equal(init.type, "penecho-widget-init");
  assert.match(init.html, /<style>html,body\{height:auto!important;overflow:visible!important;scrollbar-width:none!important\}html::-webkit-scrollbar\{display:none!important\}\.nc\{position:relative!important;inset:auto!important;min-height:100vh\}[^<]*\.nc-body\{overflow:visible!important\}<\/style><\/head>/);
  h.deliver({ type:"penecho-widget-capture-ready" });
  const [request] = h.posted[2];
  assert.deepEqual(plain(request), { type:"penecho-widget-snapshot-request", requestId:"note-pdf-id-1", width:900, height:1200, waitForViewport:true, timeoutMs:17000, highResolution:true, fullContent:true });
  h.deliver({ type:"penecho-widget-snapshot", requestId:"note-pdf-id-1", dataUrl:"data:image/png;base64,AAAA", width:1350, height:3600, contentWidth:900, contentHeight:2400 });
  assert.deepEqual(plain(await pending), { image:{ naturalWidth:1350, dataUrl:"data:image/png;base64,AAAA" }, contentWidth:900, contentHeight:2400 });
  assert.equal(h.frame.removed, true);
  assert.equal(h.listeners.size, 0);

  const preview = snapshotHarness(), image = preview.context.noteLibrarySnapshot(note);
  preview.deliver({ type:"penecho-widget-host-ready" });
  assert.doesNotMatch(preview.posted[0][0].html, /<style>/);
  preview.deliver({ type:"penecho-widget-capture-ready" });
  assert.deepEqual(plain(preview.posted[2][0]), { type:"penecho-widget-snapshot-request", requestId:"note-preview-id-1", width:900, height:1200, waitForViewport:true, timeoutMs:10000 });
  preview.deliver({ type:"penecho-widget-snapshot", requestId:"note-preview-id-1", dataUrl:"data:image/png;base64,BBBB", width:900, height:1200 });
  assert.deepEqual(plain(await image), { naturalWidth:1350, dataUrl:"data:image/png;base64,BBBB" });
});

function libraryHarness({ fail = null } = {}) {
  const calls = [], statuses = [], panel = { status:{ textContent:"" } }, noteCards = { panel }, { blob, PenEchoPdf } = pdfStub(calls);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const context = run(slice(read("src/client/app/note-cards.js"), "  // Renders the library copy, so notes whose canvas is closed download too.", "  function noteLibraryRequestForget("), {
    noteCards, PenEchoPdf, structuredClone, t:key => key,
    setStatusKey:key => statuses.push(key), setStatus:message => statuses.push(message),
    noteCardPdfSnapshot:async note => { calls.push(["note", note]); await gate; if (fail) throw Error(fail); return { image:{ naturalWidth:1350 }, contentWidth:900, contentHeight:1800 }; },
  });
  return { context, calls, statuses, panel, noteCards, blob, release };
}

test("Notes & cards downloads a note PDF from its library copy", async () => {
  const h = libraryHarness(), entry = { id:"doc:w1", note:{ title:"Cell membranes", style:"card", blocks:[{ type:"text", text:"Lipid bilayer" }] } }, button = { disabled:false };
  const pending = h.context.noteLibraryDownloadPdf(entry, button);
  assert.equal(button.disabled, true);
  assert.equal(await h.context.noteLibraryDownloadPdf(entry), false, "one note PDF at a time");
  h.release();
  assert.equal(await pending, true);
  assert.deepEqual(plain(h.calls[0][1]), plain(entry.note));
  assert.notEqual(h.calls[0][1], entry.note, "renders a copy of the library note");
  assert.deepEqual(plain(h.calls[1][2]), { title:"Cell membranes", pointsPerPixel:0.5 });
  assert.deepEqual(h.calls[2], ["save", h.blob, "Cell membranes.pdf"]);
  assert.deepEqual([button.disabled, h.noteCards.pdfBusy, h.statuses], [false, false, ["pdfPreparing", "pdfDownloaded"]]);

  const failed = libraryHarness({ fail:"Note preview capture timed out." });
  failed.release();
  assert.equal(await failed.context.noteLibraryDownloadPdf(entry), false);
  assert.equal(failed.panel.status.textContent, "pdfFailed: Note preview capture timed out.");
  assert.equal(failed.noteCards.pdfBusy, false);
});

test("the note detail panel offers Download PDF beside Share", () => {
  const detail = slice(read("src/client/app/note-cards.js"), "  function noteLibraryDetailRender() {", "  function noteLibraryToggleBookmark(");
  assert.match(detail, /actions\.append\([\s\S]*?share,\n\s*noteChip\(t\("downloadPdf"\), "↓", "note-detail-action note-detail-pdf", event => void noteLibraryDownloadPdf\(entry, event\.currentTarget\)\),\n\s*\);/);
});
