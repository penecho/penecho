"use strict";
// Note cards: the note source, rendering, deck geometry, ranking, review, the
// Organize as Note action and the Canvas AI / Agent / MCP creation paths.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const NOTE = require("../public/note-card.js");
const SMART = require("../public/smart-suggest.js");
const JEVISION = require("../src/server/jevision.js");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X6ZKcAAAAASUVORK5CYII=";

test("the note source is validated, canonicalized and forgiving about aliases", () => {
  const note = NOTE.normalize({ name:"Chain rule", look:"knowledge", category:"Formula", tags:"#calculus, derivative", extra:"dropped",
    blocks:["Differentiate the outside, then the inside.", { type:"latex", tex:"$$\\frac{d}{dx}f(g(x))$$" }, { type:"bullets", points:["a", "b"] }, { type:"tip", text:"Radians" }, { type:"todo", items:["- [x] read", "write"] }, { type:"flashcard", front:"Q?", back:"A." }, { type:"plot", fn:"y = a*x^2", parameters:{ a:2, x:3, bad:1 } }] });
  assert.equal(note.title, "Chain rule");
  assert.equal(note.style, "card");
  assert.deepEqual(note.category, { id:"formula", label:"Formula", color:"#7c3aed", icon:"∑" });
  assert.equal(note.categorySource, "model");
  assert.deepEqual(note.tags, ["calculus", "derivative"]);
  assert.equal(note.extra, undefined);
  assert.deepEqual(note.blocks.map(block => block.type), ["markdown", "formula", "keypoints", "callout", "checklist", "qa", "graph"]);
  assert.equal(note.blocks[1].latex, "\\frac{d}{dx}f(g(x))");
  assert.equal(note.blocks[3].tone, "tip");
  assert.deepEqual(note.blocks[4].items, [{ text:"read", done:true }, { text:"write", done:false }]);
  assert.deepEqual(note.blocks[6].parameters, { a:2 });
  // Round trip is stable and the format is recognized.
  assert.deepEqual(NOTE.parseSource(NOTE.formatSource(note)), note);
  assert.ok(NOTE.isNoteFormat(" PENECHO-NOTE-CARD+JSON "));
  // Errors name what the model must fix.
  assert.match(NOTE.validate({ blocks:["x"] }).error, /title is required/);
  assert.match(NOTE.validate({ title:"x", blocks:[{ type:"video" }] }).error, /unsupported block type "video"/);
  assert.match(NOTE.validate({ title:"x", blocks:[{ type:"image", src:"javascript:alert(1)" }] }).error, /https URL or an inline/);
  assert.match(NOTE.validate({ title:"x", blocks:Array.from({ length:3 }, () => ({ type:"image", src:`data:image/png;base64,${"A".repeat(200000)}` })) }).error, /keep them under/);
  // A heading can supply the title; Chinese sets the language.
  assert.equal(NOTE.normalize({ blocks:["## 牛顿第二定律\nF = ma"] }).title, "牛顿第二定律");
  assert.equal(NOTE.normalize({ title:"牛顿第二定律", blocks:["F=ma"] }).language, "zh");
  // Pictures may be held back as references while a model edits text.
  assert.equal(NOTE.normalize({ title:"x", blocks:[{ type:"image", src:"penecho-note-media:3" }] }).blocks[0].src, "penecho-note-media:3");
  assert.equal(NOTE.normalize({ title:"x", style:"note", styleChosen:true, blocks:["a"] }).styleChosen, true);
});

test("card documents are fixed portrait cards, escape content and render math through the host", () => {
  const note = NOTE.normalize({ title:"<img src=x onerror=alert(1)>", style:"note", category:"meeting", bookmarked:true, created:Date.UTC(2026, 9, 2),
    blocks:[{ type:"markdown", text:"**Bold** $x^2$ [ok](https://penecho.ai) [bad](javascript:alert(1)) <script>alert(1)</script>" }, { type:"formula", latex:"E=mc^2" }, { type:"graph", expression:"y = sin(x)" }, { type:"qa", question:"Q", answer:"A" }] });
  const html = NOTE.documentFor(note);
  assert.match(html, /<meta name="penecho-note-card" content="1">/);
  assert.match(html, /<meta name="penecho-note-math" content="pending">/);
  assert.ok(!html.includes("<img src=x") && !html.includes("<script>alert"));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<a href="https:\/\/penecho.ai"/);
  assert.ok(!/href="javascript/i.test(html));
  assert.match(html, /class="nc nc--note is-bookmarked"/);
  assert.match(html, /<path d="M[\d.]+ [\d.]+L/, "graph blocks plot a curve with the eval-free parser");
  assert.match(html, /nc-qa-toggle/, "flashcards reveal without scripts");
  assert.ok(!/<script/i.test(html.replace(/&lt;script/gi, "")), "card documents carry no scripts");
  const rendered = NOTE.documentFor(note, { renderMath:(latex, display) => `<svg data-tex="${latex}" data-display="${display}"></svg>` });
  assert.match(rendered, /penecho-note-math" content="ready"/);
  assert.match(rendered, /<svg data-tex="E=mc\^2" data-display="true">/);
  // Unsafe renderer output falls back to readable LaTeX.
  assert.match(NOTE.documentFor(note, { renderMath:() => "<svg onload=alert(1)></svg>" }), /<code class="nc-tex">E=mc\^2<\/code>/);
  assert.equal(NOTE.CONTENT.w, 900);
  assert.equal(NOTE.CONTENT.h, 1200);
});

test("Review renders the complete source and opens every answer without changing the saved card", () => {
  const note = NOTE.normalize({ title:"Review content", blocks:[
    {type:"qa", question:"First question", answer:"First answer"},
    {type:"markdown", text:"Full body ".repeat(100) + "END OF BODY"},
    {type:"qa", question:"Second question", answer:"Second answer"},
    {type:"formula", latex:"E=mc^2"},
    {type:"image", src:PNG},
  ] });
  const source = NOTE.formatSource(note), normal = NOTE.documentFor(note), review = NOTE.documentFor(note, {review:true});
  assert.match(review, /class="nc-review"/);
  assert.equal((review.match(/class="nc-qa-toggle" checked/g) || []).length, 2);
  assert.ok(!normal.includes('class="nc-qa-toggle" checked'));
  assert.match(review, /END OF BODY/);
  assert.match(review, /First answer/); assert.match(review, /Second answer/);
  assert.match(review, /E=mc\^2/); assert.ok(review.includes(PNG));
  assert.equal(NOTE.formatSource(note), source);
  assert.deepEqual(NOTE.CONTENT, {w:900, h:1200});
});

test("knowledge cards and work notes omit the subtitle row without losing source or searchable context", () => {
  const note = NOTE.normalize({ title:"含时薛定谔方程与叠加态", subtitle:"笔记第一式 · 动态演示", style:"card",
    blocks:[{ type:"formula", latex:"i\\hbar \\frac{\\partial\\psi}{\\partial t}=\\hat H\\psi", caption:"含时薛定谔方程" }] });
  const original = NOTE.formatSource(note), html = NOTE.documentFor(note);
  assert.ok(!html.includes('<p class="nc-sub">'));
  assert.ok(html.includes('<h1 class="nc-title">含时薛定谔方程与叠加态</h1>'));
  assert.ok(html.includes("含时薛定谔方程</figcaption>"));
  assert.equal(NOTE.formatSource(note), original);
  const entry = NOTE.libraryEntry({ id:"subtitle-fixture", note });
  assert.equal(NOTE.rankMetadata(entry).subtitle, note.subtitle);
  assert.equal(NOTE.rankNotes([entry], { query:"动态演示" }).length, 1);
  assert.ok(!NOTE.documentFor({ ...note, style:"note" }).includes('<p class="nc-sub">'));
});

test("Organize as Note builds a card from Canvas parts and guesses a category for PenEchoLLM to refine", () => {
  const note = NOTE.noteFromParts({ now:Date.UTC(2026, 9, 2), items:[
    { kind:"text", text:"Kinematics", y:0 }, { kind:"text", text:"$v = u + at$", y:40 },
    { kind:"graph", expressions:["y = 2x"], y:80 }, { kind:"image", src:PNG, w:1, h:1, y:120 },
  ], ink:{ src:PNG, w:1, h:1, y:60 } });
  assert.equal(note.title, "Kinematics");
  assert.deepEqual(note.blocks.map(block => block.type), ["formula", "ink", "graph", "image"]);
  assert.equal(note.category.id, "formula");
  assert.equal(note.categorySource, "local");
  assert.equal(NOTE.guessCategory("Sprint sync", [{ type:"markdown", text:"Agenda and attendees" }]), "meeting");
  assert.equal(NOTE.guessCategory("Launch", [{ type:"checklist", items:[{ text:"a" }] }]), "todo");
  assert.match(NOTE.noteFromParts({ ink:{ src:PNG, w:1, h:1 }, now:Date.UTC(2026, 9, 2) }).title, /^Note · Oct 2, 2026$/);
  assert.match(NOTE.noteFromParts({ ink:{ src:PNG }, language:"zh", now:Date.UTC(2026, 9, 2) }).title, /^笔记 · 2026年10月2日$/);
});

test("every card on a Canvas shares one size and lands beside its source without covering content", () => {
  const first = NOTE.cardSize([], { x:0, y:0, w:6000, h:3600 });
  assert.equal(Math.round(first.h / first.w * 1000), 1333);
  assert.deepEqual(NOTE.cardSize([{ w:1500, h:2000 }, { w:1500, h:2000 }, { w:900, h:400 }], { w:100, h:100 }), { w:1500, h:2000 });
  const source = { x:1000, y:1000, w:800, h:600 }, size = { w:1500, h:2000 }, beside = NOTE.placeBeside(source, size, [], 20000);
  assert.ok(beside.x >= source.x + source.w);
  const blocked = NOTE.placeBeside(source, size, [{ x:1800, y:900, w:3000, h:3000 }], 20000);
  assert.ok(!(blocked.x < 4800 && blocked.x + blocked.w > 1800 && blocked.y < 3900 && blocked.y + blocked.h > 900));
});

test("ranking blends text, PenEchoLLM signals, recency, bookmarks and review; review uses Leitner boxes", () => {
  const now = Date.UTC(2026, 9, 3), day = 86400000, make = (id, note, extra = {}) => ({ id, note:NOTE.normalize({ blocks:["x"], ...note }), updatedAt:now - day, ...extra });
  const entries = [
    make("a", { title:"Derivative rules", tags:["calculus"] }, { llm:{ importance:0.9, complete:0.9, review:0.8 } }),
    make("b", { title:"Grocery list", style:"note" }, { llm:{ importance:0.1, complete:0.4, review:0.1 } }),
    make("c", { title:"导数的定义", bookmarked:true }, { review:{ box:3, due:now + 5 * day } }),
  ];
  assert.equal(NOTE.rankNotes(entries, { now })[0].entry.id, "a");
  assert.deepEqual(NOTE.rankNotes(entries, { now, query:"derivative" }).map(item => item.entry.id), ["a"]);
  assert.deepEqual(NOTE.rankNotes(entries, { now, query:"导数" }).map(item => item.entry.id), ["c"]);
  assert.deepEqual(NOTE.rankNotes(entries, { now, bookmarked:true }).map(item => item.entry.id), ["c"]);
  assert.deepEqual(NOTE.rankNotes(entries, { now, sort:"title" }).map(item => item.entry.id), ["a", "b", "c"]);
  // PenEchoLLM relevance can surface a card without a textual match.
  entries[1].llm.relevance = { "shopping": 0.8 };
  assert.deepEqual(NOTE.rankNotes(entries, { now, query:"shopping" }).map(item => item.entry.id), ["b"]);
  const first = NOTE.nextReview({}, "good", now), again = NOTE.nextReview(first, "again", now), easy = NOTE.nextReview(first, "easy", now);
  assert.deepEqual([first.box, again.box, easy.box], [1, 0, 3]);
  assert.equal(first.due, now + day);
  assert.equal(again.due, now + 10 * 60000);
  assert.equal(easy.due, now + 7 * day);
});

test("PenEchoLLM note mode: bounded category context, mock answers and signals", () => {
  const context = NOTE.rankContext([...NOTE.CATEGORIES, { id:"lab", label:'Lab "notes" {x}' }, { id:"Bad Id", label:"x" }], { query:" chain rule " });
  assert.equal(context.categories.length, 9);
  assert.deepEqual(context.categories.at(-1), { id:"lab", label:"Lab notes x" });
  assert.equal(context.query, "chain rule");
  const answers = JEVISION.mockModeAnswers({ mode:"note", context }, "auto");
  assert.ok(answers.category.probabilities.concept > 0 && answers.relevance.type === "noul");
  const signals = NOTE.llmSignals(answers, { query:"chain rule" });
  assert.equal(signals.kind, "concept");
  assert.equal(signals.category, "concept");
  assert.ok(signals.importance > 0.5);
  assert.ok(signals.relevance["chain rule"] > 0.5);
  assert.deepEqual(Object.keys(JEVISION.MOCK_MODE_OPTIONS.note.kind.reduce((all, id) => ({ ...all, [id]:1 }), {})), Object.keys(NOTE.NOTE_KINDS));
});

test("Organize as Note ranks bounded ink and selections, but not AI result follow-ups", () => {
  const action = SMART.actionById("note");
  assert.equal(action.requires, "input");
  assert.equal(action.exec.type, "note");
  assert.equal(SMART.buildQuestions({ shapesFit:false }).action.criteria.note, action.criteria);
  assert.equal(SMART.buildQuestions({ selection:true }).action.criteria.note, action.criteria);
  assert.equal(SMART.buildQuestions({ result:true, selection:true }).action.criteria.note, undefined);
  assert.ok(SMART.localPredict({ selection:true, notePriority:true, aspect:1, objects:2 }).probabilities.note > 0.3);
  assert.ok(SMART.localPredict({ aspect:1, strokes:3 }).probabilities.note < 0.1);
  assert.equal(SMART.widgetRefineRoute({ sourceFormat:NOTE.FORMAT, pluginId:"general", html:"x".repeat(90000) }).executor, "canvas_ai");
});

test("Canvas AI, PenEcho Agent and MCP create note cards from the same source", async () => {
  const main = read("src/server/main.js");
  assert.match(main, /note:\["answer",`The user chose Organize as Note/);
  assert.match(main, /function normalizedNoteCommand/);
  assert.match(main, /invalidNote\?`Your note card failed PenEcho validation/);
  const { validateToolArguments } = require("../src/server/mcp/schema.js");
  const valid = validateToolArguments("penecho_present_widget", { sessionId:"s", artifactId:"a", title:"Chain rule", requestId:"r", note:{ blocks:[{ type:"formula", latex:"f'(g)g'" }] } });
  assert.equal(valid.sourceFormat, NOTE.FORMAT);
  assert.equal(JSON.parse(valid.copyText).title, "Chain rule");
  assert.equal(JSON.parse(valid.copyText).source.kind, "mcp");
  assert.match(valid.html, /nc-title/);
  assert.throws(() => validateToolArguments("penecho_present_widget", { sessionId:"s", artifactId:"a", title:"x", requestId:"r", note:{ blocks:[] } }));
  assert.throws(() => validateToolArguments("penecho_present_widget", { sessionId:"s", artifactId:"a", title:"x", requestId:"r", note:{ blocks:["a"] }, html:"<p>x</p>" }));
  const { getAuthoringGuidance, GUIDANCE_IDS, NATIVE_DRAWING_ROUTING } = require("../src/server/mcp/authoring-guidance.js");
  assert.ok(GUIDANCE_IDS.includes("note-card"));
  assert.match(getAuthoringGuidance("note-card", "full").document, /penecho_present_widget\(\{artifactId:"chain-rule"/);
  assert.match(NATIVE_DRAWING_ROUTING, /penecho_get_guidance\(\{id:"note-card"\}\)/);
  const { hostCompiledWidget } = require("../src/server/widget-patch.js");
  assert.ok(hostCompiledWidget({ widgetType:"html_widget", sourceFormat:NOTE.FORMAT }));
  // The Agent runtime loads native image modules; check its schema where they load.
  let runtime = null;
  try { runtime = await import("../src/server/canvas-agent/runtime.mjs"); }
  catch (error) { if (!/sharp/i.test(String(error?.message))) throw error; }
  if (runtime) {
    const branch = runtime.createItemSchema({ widgetCapabilities:{ privatePlugins:[] } }).oneOf.find(item => item.properties?.type?.const === "note");
    assert.ok(branch?.properties?.note?.properties?.blocks);
  } else assert.match(read("src/server/canvas-agent/runtime.mjs"), /properties:\{ type:\{ type:'string', const:'note', required:true \}, note:\{ \.\.\.NOTE_SCHEMA, required:true \}/);
  const agent = read("src/client/app/canvas-agent-runtime.js");
  assert.match(agent, /item\?\.type!=="note"\)return item;[\s\S]*noteCardCreateItem\(item,"agent"\)/);
});

test("the Canvas wires cards into widgets, the Suggest Bar, the Library and history", () => {
  const build = read("scripts/build-client.js"), html = read("public/index.html"), pkg = JSON.parse(read("package.json"));
  assert.ok(build.indexOf("src/client/app/canvas-index.js") < build.indexOf("src/client/app/note-cards.js"));
  assert.ok(html.indexOf('<script src="note-card.js">') > 0 && html.indexOf('<script src="note-card.js">') < html.indexOf('<script src="app.js">'));
  assert.ok(pkg.files.includes("public/note-card.js"));
  assert.match(pkg.scripts.check, /node --check public\/note-card\.js/);
  // Same place as the Library's Recent and Favorites, plus the … menu.
  assert.match(html, /id="historyNotesNav"[^>]*aria-controls="historyNotesView"/);
  assert.match(html, /<section id="historyNotesView" class="history-notes-view"/);
  assert.match(html, /id="canvasMoreMenu"[\s\S]*?data-shell-forward="#historyNotesNav"/);
  const runtime = read("src/client/app/canvas-runtime.js");
  assert.match(runtime, /noteCard = Boolean\(noteRuntime\?\.isNoteFormat\(item\.sourceFormat\)\)/);
  assert.match(runtime, /item = \{ \.\.\.item, contentW:noteRuntime\.CONTENT\.w, contentH:noteRuntime\.CONTENT\.h \}/);
  assert.match(runtime, /noteCardWidget\(result\.widget\) && \["width", "height"\]\.includes\(result\.hit\) \? "resize"/);
  const cards = read("src/client/app/note-cards.js");
  assert.match(cards, /recordWidgetsBefore\(\);[\s\S]*?saveUserCanvasChange\(\);/, "card edits are undoable");
  assert.match(cards, /note\.categorySource === "user"/, "a category the person picks is never replaced automatically");
  const docs = read("src/client/app/canvas-documents.js");
  assert.match(docs, /Note card HTML is generated\. Patch widget\.source/);
  const css = read("public/style.css");
  assert.match(css, /#historyPanel\[data-library-view="notes"\] \.history-library-main > :not\(#historyNotesView\)/);
  assert.match(css, /\.canvas-widget\.canvas-note-card \.canvas-widget-resize-handle:is\(\.width, \.height\) \{ display: none; \}/);
});

test('cards near a viewport edge fit on screen and keep their portrait proportions', () => {
  for(const view of [{x:1000,y:1000,w:1200,h:800},{x:10000,y:8000,w:500,h:900},{x:19000,y:19000,w:1000,h:1000}]) {
    const source={x:view.x+view.w*.8,y:view.y+view.h*.1,w:view.w*.1,h:view.h*.2},
      placed=NOTE.placeBeside(source,{w:1500,h:2000},[source],20000,null,view);
    assert.ok(placed.x>=view.x && placed.y>=view.y && placed.x+placed.w<=view.x+view.w+1 && placed.y+placed.h<=view.y+view.h+1);
    assert.equal(placed.w/placed.h,.75);
  }
  const view={x:1000,y:1000,w:1600,h:1000},source={x:2300,y:1300,w:200,h:300};
  const placed=NOTE.placeBeside(source,{w:300,h:400},[source],20000,null,view);
  assert.ok(placed.x+placed.w<=source.x || placed.x>=source.x+source.w || placed.y+placed.h<=source.y || placed.y>=source.y+source.h,'free visible space is preferred over the source');
});
