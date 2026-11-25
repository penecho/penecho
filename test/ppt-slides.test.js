"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const slides = require("../src/server/slides.js");
const templates = require("../src/shared/slide-templates.js");
const { GUIDANCE_IDS, getAuthoringGuidance, CANVAS_RENDERING_ROUTING, ROUTING } = require("../src/server/mcp/authoring-guidance.js");

const SLIDE = (template = "investor", body = '<div class="hd"><h1><b>Segments:</b> Revenue up 29%</h1></div><div class="body"><div class="col"><div id="c1" class="chart"></div></div></div>') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Segments</title><script src="penecho-slide-charts.js"></script></head><body>
<div class="slide" data-penecho-slide data-penecho-template="${template}" data-penecho-deck="FY2025 update">${body}</div>
<script>SC.bar('#c1', {categories:['2024','2025'], series:[{values:[6.95,8.42]}], axis:false, format:'\${}'});</script></body></html>`;

test("a saved slide gets its template's master CSS and the chart library, once", () => {
  const page = slides.expandSlide(SLIDE());
  assert.match(page, /<style data-penecho-master="investor">/);
  assert.ok(page.includes(templates.css("investor")), "the whole investor master is inlined");
  assert.ok(page.includes("/* PenEcho slide charts"), "the chart library is inlined");
  assert.doesNotMatch(page, /src=["']?penecho-slide-charts\.js/, "the placeholder script is gone");
  assert.ok(page.indexOf("data-penecho-master") < page.indexOf("<title>"), "the master comes first, so a slide's own style can adjust it");
  assert.equal(slides.expandSlide(page), page, "saving again changes nothing");
  assert.equal(slides.slideTemplate(page), "investor");
});

test("fragments, code fences and odd roots still become complete slides", () => {
  const fenced = slides.expandSlide('```html\n<div class="cover" data-penecho-slide data-penecho-template="market"><h1>Market Guide</h1></div>\n```');
  assert.match(fenced, /^<!doctype html><html><head>/);
  assert.match(fenced, /<div class="slide cover" data-penecho-slide/);
  assert.match(fenced, /<title>Market Guide<\/title>/);
  assert.match(fenced, /data-penecho-master="market"/);
  const wrapped = slides.expandSlide('<slide data-penecho-slide data-penecho-template="healthcare"><div class="hd"><h1>T</h1></div></slide>');
  assert.match(wrapped, /<div class="slide" data-penecho-slide/);
  assert.doesNotMatch(wrapped, /<\/?slide\b/);
  assert.equal(slides.expandSlide("<p>Not a slide</p>"), "<p>Not a slide</p>", "other Widgets pass through untouched");
  assert.match(slides.expandSlide('<div data-penecho-slide>x</div>'), /data-penecho-master="base"/, "an unknown template still gets the base master");
});

test("the chart library draws charts and fits the slide to a smaller frame", () => {
  const src = slides.slideChartsLibrary(), window = { innerWidth:1280, innerHeight:720, addEventListener() {} };
  vm.runInNewContext(src, { window, document:undefined });
  assert.equal(typeof window.SC.bar, "function");
  assert.equal(typeof window.SC.line, "function");
  assert.equal(typeof window.SC.donut, "function");
  assert.deepEqual(Array.from(window.SC.ticks(0, 62.4)), [0, 10, 20, 30, 40, 50, 60, 70], "axes hug the data");
  assert.deepEqual(Array.from(window.SC.ticks(-40, 32)), [-40, -20, 0, 20, 40]);
});

test("every template master styles the shared structure", () => {
  assert.deepEqual(templates.names, ["healthcare", "investor", "market"]);
  for (const name of templates.names) {
    const css = templates.css(name);
    for (const part of [".slide{", ".hd", ".body{", ".ft{", ".slide.cover", ".chart{"]) assert.ok(css.includes(part), `${name} styles ${part}`);
    assert.doesNotMatch(css, /::?(before|after)/, "nothing visible lives in pseudo-elements, which PowerPoint would lose");
  }
});

test("ppt-slides is guidance the Canvas agent and MCP agents load, and routing sends decks to it", () => {
  assert.ok(GUIDANCE_IDS.includes("ppt-slides"));
  const guide = getAuthoringGuidance("ppt-slides", "full");
  for (const words of ["data-penecho-slide", "data-penecho-template", "penecho-slide-charts.js", "SC.bar", "## Template: healthcare", "## Template: investor", "## Template: market", "penecho_present_widget", ".slide-01.html", "Download PPT"]) assert.ok(guide.document.includes(words), words);
  assert.equal(getAuthoringGuidance("ppt-slides").document, guide.document, "the default read is the whole contract");
  for (const routing of [CANVAS_RENDERING_ROUTING, ROUTING]) assert.match(routing, /penecho_get_guidance\(\{id:"ppt-slides"\}\)/);
});

test("a slide sent through penecho_present_widget is saved complete", () => {
  const { validateToolArguments } = require("../src/server/mcp/schema.js");
  const args = validateToolArguments("penecho_present_widget", { sessionId:"s", requestId:"r1", artifactId:"deck-01", title:"01 · Cover", html:SLIDE(), width:1280, height:720 });
  assert.match(args.html, /data-penecho-master="investor"/);
  assert.ok(args.html.includes("/* PenEcho slide charts"));
  assert.equal(args.width, 1280);
});

test("Lines turns deck.slide-NN.html files into one Canvas with the slides in a column", async () => {
  const { makePicture, slideUnchanged, checkPicture, SOURCE } = require("../src/server/project-lines/canvas-file.js");
  assert.match("files/x/deck.slide-01.html", SOURCE);
  assert.throws(() => checkPicture("files/x/deck.slide-01.html", "<div>no mark</div>"), /data-penecho-slide/);
  const first = await makePicture({ source:"files/x/deck.slide-01.html", text:SLIDE("investor", '<div class="hd"><h1>Cover</h1></div>'), existing:null, name:"deck", renderPage:() => null });
  assert.ok(first.png, "the first slide is the deck's picture");
  const second = await makePicture({ source:"files/x/deck.slide-02.html", text:SLIDE(), existing:JSON.stringify(first.bundle), name:"deck", renderPage:() => null });
  assert.equal(second.png, null, "later slides keep the first slide as the picture");
  const widgets = second.bundle.assets.filter(a => a.kind === "widget").map(a => JSON.parse(Buffer.from(a.dataBase64, "base64").toString()));
  assert.equal(widgets.length, 2);
  assert.equal(second.bundle.name, "FY2025 update", "the Canvas is named after the deck");
  assert.deepEqual(widgets.map(w => [w.contentW, w.contentH]), [[1280, 720], [1280, 720]]);
  assert.equal(widgets[0].x, widgets[1].x);
  assert.ok(widgets[1].y > widgets[0].y + widgets[0].h, "slide 2 sits below slide 1");
  assert.match(widgets[1].title, /^02 · /);
  assert.ok(widgets.every(w => w.html.includes("data-penecho-master")), "each saved slide is complete");
  assert.ok(slideUnchanged(JSON.stringify(second.bundle), "files/x/deck.slide-02.html", SLIDE()), "an unchanged slide is not drawn again");
  assert.ok(!slideUnchanged(JSON.stringify(second.bundle), "files/x/deck.slide-02.html", SLIDE("market")));
});

test("agents are told how to make slides, and the slide rules sit beside the skill", () => {
  const F = require("../src/server/project-lines/format.js");
  const skill = F.drawingSkill({ name:"Demo", drop:"/tmp/demo/.penecho/drawings" });
  assert.match(skill, /name\.slide-01\.html/);
  assert.match(skill, /ppt-slides\.md in this skill's folder/);
  assert.match(F.pictureHelp("/docs/files/x", "/docs/.penecho/ppt-slides.md"), /Read \/docs\/\.penecho\/ppt-slides\.md first/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ppt-rules-"));
  assert.equal(slides.installSlideRules(dir), true);
  assert.equal(fs.readFileSync(path.join(dir, "ppt-slides.md"), "utf8"), getAuthoringGuidance("ppt-slides", "full").document);
  assert.equal(slides.installSlideRules(dir), false, "an up-to-date copy is left alone");
  fs.rmSync(dir, { recursive:true, force:true });
});

test("a slide checks itself and the agent hears what it found", () => {
  const library = slides.slideChartsLibrary();
  assert.match(library, /function check\(\)/, "the chart library can list what a reader would notice");
  for (const words of ["px empty at the bottom", "is cut off by its box", "overlaps", "runs .* px into the footer", "chart labels were hidden", "failed:"]) assert.match(library, new RegExp(words));
  const host = fs.readFileSync(path.join(__dirname, "../public/widget-host.js"), "utf8");
  assert.match(host, /message\.check/, "the widget host runs the check on request");
  assert.match(host, /slide:\{ version:1, check:problems, items:\[\] \}/);
  const runtime = fs.readFileSync(path.join(__dirname, "../src/client/app/mcp-runtime.js"), "utf8");
  assert.match(runtime, /slideCheck:\{problems:slideProblems,ok:slideProblems\.length===0\}/, "penecho_present_widget returns the check for slides");
  assert.match(getAuthoringGuidance("ppt-slides", "full").document, /slideCheck/, "the skill tells the agent to fix what the check found");
});

test("templates set the house style of charts, so every slide of a deck matches", () => {
  assert.match(templates.css("investor"), /--sc-bar-axis:off/);
  assert.match(templates.css("healthcare"), /--sc-bar-axis:on/);
  for (const name of templates.names) assert.match(templates.css(name), /--sc-labels:all/);
  const library = slides.slideChartsLibrary();
  assert.match(library, /house\("--sc-bar-axis"\)/, "the chart library follows the template");
  assert.match(library, /createElement\("nobr"\)/, "numbers and ranges never break across lines");
});

// The PowerPoint builder the Canvas and the Lines pages share (it only needs pptxgenjs).
const slideBuilder = () => require("../src/shared/slides-pptx.js");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const chartItem = (spec, overlays = []) => ({ type:"chart", x:40, y:120, w:560, h:360, spec, fallback:PNG, overlays, catBold:false });
const years = ["2019", "2020", "2021", "2022", "2023", "2024"], plot = { x:0.08, y:0.1, w:0.88, h:0.8 };

test("Download PPT rebuilds slide charts as native PowerPoint charts with their data", async () => {
  const PptxGenJS = require("pptxgenjs"), JSZip = require("jszip"), { buildDeck } = slideBuilder();
  const items = [
    chartItem({ kind:"bar", categories:years, series:[{ name:"Growth", values:[12, 18.5, 51.2, 27.5, 15.4, 8.3], color:"#00A3E0", colors:["#9CC3EE", "#9CC3EE", "#9CC3EE", "#00A3E0", "#00A3E0", "#F28C1C"] }],
      format:"{}%", decimals:1, lo:0, hi:60, step:10, axis:true, nativeLabels:true, every:2, gap:47, legend:false, plot },
      [{ type:"rect", x:300, y:110, w:280, h:380, line:{ color:"1BA3D6", width:1.5 } }, { type:"text", x:400, y:96, w:60, h:14, textTop:96, textH:14, lineHeight:14, align:"center", runs:[{ text:"Forecast", color:"1BA3D6", size:12, font:"Arial" }] }]),
    chartItem({ kind:"bar", horizontal:true, catLabels:false, categories:["10-year", "2-year", "Fed funds"], series:[{ name:"Sep-26", values:[-15, -49, -100], color:"#1F6FD1" }, { name:"Oct-25", values:[3, 2, 1], color:"#5B5F63" }],
      format:"{} bp", decimals:0, lo:-110, hi:10, step:null, axis:false, nativeLabels:true, gap:80, legend:true, plot }),
    chartItem({ kind:"bar", categories:years, series:[{ name:"Revenue", values:[10, 12, 13, 15, 16, 18], color:"#1F6FD1" }], format:"${}Bn", lo:0, hi:20, step:5, axis:true, nativeLabels:true, plot,
      line:{ name:"Margin", values:[20, 21, 22, 22.5, 23, 24], color:"#0B4F7A", format:"{}%", decimals:1, lo:0, hi:30, step:10, title:"Margin, %" } }),
    chartItem({ kind:"line", categories:years, series:[{ name:"10-year", values:[4.1, 4.2, 4.4, 4.0, 3.9, 3.96], color:"#5B5F63" }, { name:"Spread", values:[1, 1.2, 1.1, 0.9, 0.8, 0.87], color:"#F28C1C", dashed:true, axis:"right" }],
      format:"{}%", rightFormat:"{} pt", decimals:2, rightDecimals:2, lo:3.5, hi:4.5, step:0.5, right:{ lo:0, hi:1.5, step:0.5 }, refLines:[{ value:4, label:"Average", color:"#7AA63A" }], plot }),
    chartItem({ kind:"line", categories:years, series:[{ name:"Fed funds", values:[4, 4, 3.75, 3.5, 3.25, 3], color:"#1F6FD1", step:true }], format:"{}%", lo:2.5, hi:4.5, step:0.5, plot }),
    chartItem({ kind:"donut", items:[{ label:"Americas", value:70, color:"#1F6FD1" }, { label:"EMEA", value:19, color:"#9CC3EE" }, { label:"Asia", value:11, color:"#0B4F7A" }], inner:0.6, plot:{ x:0.2, y:0.1, w:0.6, h:0.8 } }),
    chartItem({ kind:"bar", categories:years, series:[{ name:"No axis range", values:[1, 2, 3, 4, 5, 6] }] }),
  ];
  items.push({ ...chartItem({ kind:"line", categories:years, series:[{ name:"Old host", values:[1, 2, 3, 4, 5, 6], step:true }], lo:0, hi:6 }, [{ type:"text", x:50, y:130, w:60, h:14, runs:[{ text:"Twice?" }] }]) });
  items.push({ ...chartItem({ kind:"line", categories:years, series:[{ name:"New host", values:[1, 2, 3, 4, 5, 6], step:true }], lo:0, hi:6 }, [{ type:"text", x:50, y:130, w:60, h:14, runs:[{ text:"Once" }] }]), plain:true });
  const zip = await JSZip.loadAsync(await buildDeck(PptxGenJS, [{ data:{ width:1280, height:720, background:"FFFFFF", items }, title:"Charts" }], "Charts", { JSZip, type:"nodebuffer" }));
  const charts = await Promise.all(Object.keys(zip.files).filter(name => /^ppt\/charts\/chart\d+\.xml$/.test(name)).map(name => zip.file(name).async("string")));
  const slide = await zip.file("ppt/slides/slide1.xml").async("string");
  assert.equal(charts.length, 5, "bar, horizontal bar, bar with a line, line and donut become charts");
  // Apps that cannot draw native charts (Quick Look) show each chart's picture instead; PowerPoint and LibreOffice show the chart.
  const choices = slide.match(/<mc:AlternateContent xmlns:mc="[^"]+"><mc:Choice xmlns:p14="[^"]+" Requires="p14"><p:graphicFrame>[\s\S]*?<\/p:graphicFrame><\/mc:Choice><mc:Fallback><p:pic>[\s\S]*?<\/p:pic><\/mc:Fallback><\/mc:AlternateContent>/g) || [];
  assert.equal(choices.length, 5, "every native chart carries its picture as a fallback");
  assert.equal((slide.match(/<p:graphicFrame>/g) || []).length, 5);
  assert.equal((slide.replace(/<mc:AlternateContent[\s\S]*?<\/mc:AlternateContent>/g, "").match(/<p:pic>/g) || []).length, 4, "charts that stay pictures keep them in plain view");
  assert.doesNotMatch(slide, /penecho-chart-picture/);
  assert.doesNotMatch(slide, /Twice\?/, "a picture from an older Widget host already holds its marks");
  assert.match(slide, /Once/, "a plain picture gets its marks on top");
  assert.ok(Object.keys(zip.files).some(name => /^ppt\/embeddings\/.*\.xlsx$/.test(name)), "the data is editable in PowerPoint");
  assert.ok(charts.every(xml => !/<c:legend>/.test(xml)), "the slide's own legend is placed over the chart instead");
  const [column, horizontal, combo, line, donut] = ["Growth", "Fed funds", "Margin", "Spread", "Americas"].map(name => charts.find(xml => xml.includes(`<c:v>${name}</c:v>`)));
  assert.match(column, /<c:barDir val="col"\/>/);
  assert.equal((column.match(/<c:dPt>/g) || []).length, 6, "one series keeps a colour per bar");
  assert.match(column, /F28C1C/);
  assert.match(column, /<c:tickLblSkip val="2"\/>/, "crowded years are thinned as on the slide");
  assert.match(column, /formatCode="#,##0.0&quot;%&quot;"/);
  assert.match(column, /<c:max val="60"\/>/);
  assert.match(horizontal, /<c:barDir val="bar"\/>/);
  assert.match(horizontal, /<c:tickLblPos val="none"\/>/, "names of bars left of zero are placed beside the chart, clear of their labels");
  assert.ok(horizontal.indexOf("<c:v>Fed funds</c:v>") < horizontal.indexOf("<c:v>10-year</c:v>"), "rows are given bottom-up so the first category is on top");
  assert.ok(horizontal.indexOf("<c:v>Oct-25</c:v>") < horizontal.indexOf("<c:v>Sep-26</c:v>"), "the first series stays on top in each group");
  assert.match(combo, /<c:lineChart>/);
  assert.equal((combo.match(/<c:valAx>/g) || []).length, 2, "the line has its own axis on the right");
  assert.match(combo, /Margin, %/);
  assert.match(line, /<a:prstDash val="dash"\/>/);
  assert.match(line, /<c:v>Average<\/c:v>/, "reference lines stay in the chart");
  assert.match(donut, /<c:doughnutChart>/);
  assert.match(donut, /<c:holeSize val="60"\/>/);
  assert.match(slide, /Forecast/, "marks drawn over the plot come along as text and shapes");
});

test("chart specifications from a slide are checked before they reach PowerPoint", () => {
  const { chartSpec, chartNumberFormat } = slideBuilder();
  assert.equal(chartNumberFormat("{}%", 1), '#,##0.0"%"');
  assert.equal(chartNumberFormat("${1}Bn"), '"$"#,##0.0"Bn"');
  assert.equal(chartNumberFormat("{}x", 0), '#,##0"x"');
  assert.equal(chartNumberFormat('{}"\\', 0), "#,##0", "quotes cannot break the number format");
  assert.equal(chartSpec({ kind:"pie" }), null);
  assert.equal(chartSpec({ kind:"bar", categories:["a"], series:[{ values:[1] }], lo:5, hi:1 }), null, "a range must run upwards");
  const spec = chartSpec({ kind:"bar", categories:["a", "b".repeat(500)], series:[{ name:{ toString() { return "x"; } }, values:["7", "seven", true] }], lo:0, hi:10, step:-2, plot:{ x:3, y:0, w:1, h:1 } });
  assert.deepEqual(Array.from(spec.series[0].values), [7, null], "values are plain numbers, one per category");
  assert.equal(spec.categories[1].length, 160);
  assert.equal(spec.step, null);
  assert.equal(spec.plot, undefined, "a plot area outside the chart is ignored");
  assert.equal(chartSpec({ kind:"donut", items:[{ label:"a", value:-1 }] }), null);
});

test("the chart library records each chart so PowerPoint can rebuild it", () => {
  const library = slides.slideChartsLibrary();
  for (const kind of ["bar", "line", "donut"]) assert.match(library, new RegExp(`record\\(svg, \\{ kind: "${kind}"`));
  assert.match(library, /specs: specs/);
  assert.match(library, /\[\]\.forEach\.call\(g\.childNodes, over\)/, "legends are placed over the chart as drawn");
  assert.match(library, /function settle\(/, "highlighted bars go over the chart with one colour per series beneath");
  const host = fs.readFileSync(path.join(__dirname, "../public/widget-host.js"), "utf8");
  assert.match(host, /getAttribute\?\.\("data-sc"\)/, "the widget host sends the chart's specification with its picture");
  assert.match(host, /querySelectorAll\("\.sc-over"\)/);
});

test("a Canvas card offers Download PPT for every slide on that Canvas, in reading order", () => {
  const { canvasSlides, newBundle } = require("../src/server/project-lines/canvas-file.js");
  const { Service } = require("../src/server/project-lines/service.js");
  const bundle = newBundle({ id:"lines-test", name:"Board" });
  const widget = (title, html, x, y) => bundle.assets.push({ kind:"widget", contentType:"application/json", metadata:{ widgetId:title }, dataBase64:Buffer.from(JSON.stringify({ id:title, widgetType:"html_widget", title, html, x, y, w:1800, h:1013 })).toString("base64") });
  const slide = deck => `<div class="slide" data-penecho-slide data-penecho-deck="${deck}">x</div>`;
  widget("02 · Second", slide("Plan"), 2000, 3153);
  widget("Chart", "<div>not a slide</div>", 0, 0);
  widget("01 · First", slide("Plan"), 2000, 2000);
  widget("B1 · Other deck", slide("Other"), 6000, 1990);
  widget("03 · Third, beside the second", slide("Plan"), 4000, 3160);
  const found = canvasSlides(JSON.stringify(bundle));
  assert.deepEqual(found.map(s => s.title), ["01 · First", "02 · Second", "03 · Third, beside the second", "B1 · Other deck"], "deck by deck, rows top to bottom, left to right in a row");
  assert.deepEqual(canvasSlides("{not json"), []);
  // The state of a project says how many slides a Canvas holds, read again only when its file changes.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-ppt-card-")), file = path.join(dir, "files", "board.penecho.json");
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, JSON.stringify(bundle));
  const store = { resolve:(p, relative) => path.join(dir, relative), exists:(p, relative) => fs.existsSync(path.join(dir, relative)) };
  const service = Object.assign(Object.create(Service.prototype), { store, canvasMetas:new Map() }), project = { id:"p1" };
  const stat = fs.statSync(file), entry = { path:"files/board.penecho.json", mtime:stat.mtimeMs, size:stat.size };
  assert.equal(service.canvasMeta(project, entry).slides, 4);
  fs.writeFileSync(file, "{}");
  assert.equal(service.canvasMeta(project, entry).slides, 4, "an unchanged file is not read again");
  assert.equal(service.canvasMeta(project, { ...entry, mtime:entry.mtime + 1, size:2 }).slides, 0);
  fs.writeFileSync(file, JSON.stringify(bundle));
  const deck = service.canvasSlides(project, "files/board.penecho.json");
  assert.equal(deck.title, "Plan");
  assert.equal(deck.slides.length, 4);
  assert.throws(() => service.canvasSlides(project, "../board.penecho.json"), /not a Canvas file/);
  fs.rmSync(dir, { recursive:true, force:true });
  // Lines draws each slide in the Widget host and builds the file with the Canvas's own builder.
  const lines = fs.readFileSync(path.join(__dirname, "../public/lines/ppt.js"), "utf8"), server = fs.readFileSync(path.join(__dirname, "../src/server/main.js"), "utf8");
  assert.match(lines, /penecho-widget-slide-request/);
  assert.match(lines, /builder\.buildDeck\(/);
  assert.match(server, /url\.pathname === "\/lines\/slides-pptx\.js"/);
  for (const page of ["line.js", "pages.js", "markdown.js"]) assert.match(fs.readFileSync(path.join(__dirname, "../public/lines", page), "utf8"), /pptDownloadButton\(/, page);
});

test("a chart picture is only ever a fallback, never on top of its chart", () => {
  const { withChartPictures } = slideBuilder();
  const frame = '<p:graphicFrame><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId2"/></a:graphicData></p:graphicFrame>';
  const pic = name => `<p:pic><p:nvPicPr><p:cNvPr id="3" name="Image 1" descr="${name}"/></p:nvPicPr></p:pic>`;
  const paired = withChartPictures(`<p:spTree>${frame}${pic("penecho-chart-picture")}${pic("logo")}</p:spTree>`);
  assert.match(paired, /<mc:Choice xmlns:p14="http:\/\/schemas\.microsoft\.com\/office\/powerpoint\/2010\/main" Requires="p14"><p:graphicFrame>/);
  assert.match(paired, /<mc:Fallback><p:pic><p:nvPicPr><p:cNvPr id="3" name="Image 1"\/>/);
  assert.match(paired, /descr="logo"/, "other pictures stay as they are");
  assert.equal(withChartPictures(`<p:spTree>${pic("penecho-chart-picture")}${frame}</p:spTree>`), `<p:spTree>${frame}</p:spTree>`, "a picture that cannot be paired is dropped");
  const host = fs.readFileSync(path.join(__dirname, "../public/widget-host.js"), "utf8"), tools = fs.readFileSync(path.join(__dirname, "../src/client/ink-lab-tools.js"), "utf8");
  assert.match(host, /svgPicture\(chartSvg, svgRect\.width, svgRect\.height, placed\)/, "the picture leaves out marks placed on top");
  assert.match(tools, /JSZip,expression/, "the browser bundle offers JSZip for the fallbacks");
});
