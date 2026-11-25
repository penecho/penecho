"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");
const examples = require("../public/example-scenarios.js");
const ink = require("../public/example-ink.js");
const graph = require("../public/smart-suggest.js");
const notes = require("../public/note-card.js");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const script = read("src/client/app/example-canvases.js");
const core = read("src/client/app/core.js");
const guestRules = core.slice(core.indexOf("  function canvasGuest()"), core.indexOf("  function setCanvasGuestAi"));
const plainDraft = { runtime:"cloud", browserCanvasEditing:true, browserDraftId:"draft", guestCanvas:true };

// Run the gallery on its real HTML with a small in-memory drawing surface.
function gallery(config = plainDraft, { companion = false, language = "en" } = {}) {
  const { document } = parseHTML(read("public/index.html"));
  const tiles = new Map(), requests = [], storage = new Map(), errors = [];
  const state = { language, widgets:[], images:[], textBoxes:[], animations:[], preservedSnapshotAnimations:[],
    mode:"pen", scale:1, pen:2, userRevision:0 };
  let active = 1;
  const noop = () => {};
  const window = { PENECHO_CONFIG:config, PENECHO_EXAMPLE_SCENARIOS:examples, PENECHO_EXAMPLE_INK:ink,
    PenEchoBrowserDraft:{open:async () => {}}, addEventListener:noop };
  const runtime = { window, document, state, CANVAS_COMPANION_REQUESTED:companion, tiles, SMART_SUGGEST:graph,
    smartSuggest:{strokes:[]}, SIZE:20000, File, addEventListener:noop, clearTimeout:noop, clearInterval:noop, setInterval:noop,
    localStorage:{getItem:key => storage.get(key), setItem:(key, value) => storage.set(key,value)},
    peButton:noop, projectLinesLocal:() => false, canvasDocumentsCurrent:() => ({id:active}),
    openNewCanvasDialog:async () => { active++; tiles.clear(); state.widgets = []; state.images = []; return true; },
    applyCurrentCanvasGeneratedName:noop, setCanvasMode:mode => { state.mode = mode; },
    invalidateCanvasViewportMetrics:noop, viewportRect:() => ({x:9000,y:9000,w:980,h:650}),
    canvasViewportMetrics:() => ({width:980,height:650}), smartSuggestSyncDocument:noop,
    stroke:() => tiles.set("ink",1), dot:() => tiles.set("ink",1), saveUserCanvasChange:noop,
    requestCommittedInkRender:noop, requestRender:noop, requestCoordinatesUpdate:noop, requestCanvasNavigationPreview:noop,
    imageBox:item => item, widgetBox:item => item, hideAssist:noop, consumeDirtyInputScope:noop, smartSuggestInputConsumed:noop,
    addImageFile:async () => state.images.push({x:9000,y:9000,w:800,h:500}),
    noteCardRuntime:() => notes, noteCategories:() => [], noteCardDocument:note => notes.documentFor(note),
    insertAssistWidget:async (spec, options) => { options.assertCurrent(); const widget = {...spec,id:"w"}; state.widgets.push(widget); return widget; },
    fetch:async address => { requests.push(address); return new Response(fs.readFileSync(path.join(root,"public",address))); },
    pageLayoutRect:() => null, runtimeElementStyle:() => null, setStatus:message => errors.push(message), getActive:() => active };
  const dialog = document.querySelector("#examplesDialog");
  dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
  vm.runInNewContext(guestRules + script, runtime);
  return { document, state, window, runtime, tiles, requests, errors };
}

test("an empty guest trial offers the eight illustrated examples and the whole gallery", () => {
  const h = gallery(), welcome = h.document.querySelector("#canvasWelcomeExamples");
  assert.equal(welcome.hidden, false);
  assert.deepEqual([...welcome.querySelectorAll("button[data-example-id]")].map(el => el.dataset.exampleId), examples.first().map(s => s.id));
  const preview = welcome.querySelector("img").getAttribute("src");
  assert.equal(preview, examples.get("photo-note").image.preview);
  assert.ok(fs.statSync(path.join(root, "public", preview)).size < 10000);
  assert.deepEqual([...welcome.querySelectorAll(".example-badge")].map(el => el.textContent),
    [...Array(3).fill("Works now"), ...Array(5).fill("Saved result")]);
  welcome.querySelector("#canvasWelcomeExamplesAll").click();
  assert.equal(h.document.querySelector("#examplesDialog").open, true);
  assert.equal(h.document.querySelectorAll("#examplesDialogList button[data-example-id]").length, 20);
  assert.deepEqual(h.requests, []);
  const zh = gallery(plainDraft, {language:"zh"});
  assert.equal(zh.document.querySelector("#canvasWelcomeExamplesAll").textContent,"全部 20 个示例");
});

test("viewers, companion, MCP, folder, shared and playground guest Canvases keep their own welcome", () => {
  for (const extra of [{runtime:"viewer"},{browserDraftId:""},{browserDraftConnected:true},{browserDraftBlocked:true},
    {folderProject:{}},{liveShare:{}},{playground:"liveclay"}]) {
    assert.equal(gallery({...plainDraft,...extra}).document.querySelector("#canvasWelcomeExamples").hidden,true,JSON.stringify(extra));
  }
  assert.equal(gallery(plainDraft, {companion:true}).document.querySelector("#canvasWelcomeExamples").hidden,true);
  assert.equal(gallery({runtime:"local"}).document.querySelector("#canvasWelcomeExamples").hidden,false);
});

test("activating a featured button opens its result once, even with a second click while opening", async () => {
  const h = gallery();
  const button = h.document.querySelector('#canvasWelcomeExampleList button[data-example-id="functions"]');
  assert.equal(button.type, "button");
  assert.match(button.getAttribute("aria-label"), /Graph a function/);
  button.click();
  button.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.errors, []);
  assert.equal(h.state.widgets.length, 1);
  assert.equal(h.runtime.getActive(), 1);
});

test("all 20 guest examples open with their real data and no AI, agent or account library", async () => {
  for (const scenario of examples.SCENARIOS) {
    const h = gallery();
    const opened = await h.window.PenEchoExamples.open(scenario.id);
    assert.equal(opened,true,scenario.id + " " + h.errors.join(" "));
    assert.equal(h.runtime.getActive(),1,"reuse the empty draft");
    assert.ok(h.tiles.size || h.state.images.length,scenario.id);
    const file = examples.savedResult(scenario.id), expectResult = scenario.route === "instant" || Boolean(file);
    assert.deepEqual(h.requests,[scenario.image?.src,file].filter(Boolean));
    assert.equal(h.state.widgets.length,expectResult ? 1 : 0);
    if (expectResult) {
      assert.match(h.state.widgets[0].html,/<(?:html|!doctype)/i);
      assert.equal(h.state.mode,"hand");
    }
    assert.equal(h.document.querySelector("#exampleSaved").hidden,!file);
    assert.equal(h.document.querySelector("#exampleDone").hidden,Boolean(file));
    assert.equal(h.window.PenEchoExamples.progress().tried.includes(scenario.id),true);
  }
});

test("the guest waits for a returning draft and opens the example in another document when it has content", async () => {
  const h = gallery();
  h.window.PenEchoBrowserDraft.open = async () => { h.state.animations.push({id:"previous-animation"}); };
  assert.ok(await h.window.PenEchoExamples.open("functions"));
  assert.equal(h.runtime.getActive(),2);
});

test("a delayed result cannot land on a different canvas", async () => {
  const h = gallery();
  const fetch = h.runtime.fetch;
  h.runtime.fetch = async url => { const response = await fetch(url); await h.runtime.openNewCanvasDialog(); return response; };
  assert.equal(await h.window.PenEchoExamples.open("prototype"),false);
  assert.match(h.errors.join(" "),/active canvas changed/i);
  assert.equal(h.state.widgets.length,0);
  assert.equal(h.window.PenEchoExamples.progress().tried.length,0);
});
