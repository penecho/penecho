"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = name => fs.readFileSync(path.join(__dirname, "../public/lines", name), "utf8");

function panelFixture() {
  const { document } = require("./helpers/dom.js").parseHTML(`<html><body><main id="view"><div id="linePage">
    <aside id="lpSide"><div id="lpTopicSide"></div></aside>
    <div id="lpTopic"></div><aside id="lpPanel"></aside>
  </div></main></body></html>`);
  const $ = selector => document.querySelector(selector);
  const work = { id:"work-1", kind:"work", label:"Work 1", state:"done", out:"The totals match.", pictures:[] };
  const line = { id:"report", slug:"report", stations:[work], pictures:[], ask:{ files:[], later:[] } };
  const topic = { title:"Reports", path:"topics/reports.md", lines:["report"], goal:"Read the report.", left:["Review the totals."] };
  const project = { id:"garden", knowledge:[topic], lines:[line], files:[] };
  let destination;
  const c = vm.createContext({
    document, $, $$:selector => document.querySelectorAll(selector), innerWidth:1400,
    ACT:{}, SEND:{}, S:{ route:{ view:"line", line:line.id } }, EMBED:null, HOSTED:null, project:() => project,
    lineById:(p, id) => p.lines.find(l => l.id === id), stationById:(l, id) => l.stations.find(s => s.id === id),
    openQuestions:l => l.questions || [],
    addEventListener() {}, syncHash() {}, clearTimeout, setTimeout,
    go:route => { destination = route; },
    ic:() => "", esc:String, allLines:p => p.lines, MAP_FILTERS:{ done:() => false },
    stepLabel:s => s.label, fileEntry:(p, path) => p.files.find(f => f.path === path),
    api:async () => ({ rows:[], seq:0 }), pathFor:() => "/projects/garden",
    getComputedStyle:() => ({ position:$("#view").clientWidth <= 860 ? "absolute" : "static" }),
  });
  for (const name of ["line-status.js", "markdown.js", "desk.js", "line.js", "merge.js"]) vm.runInContext(read(name), c, { filename:name });
  return { document, $, c, work, line, topic, project, destination:() => destination };
}

test("Cloud Lines show the synced Topic in the local panel for owners and shared readers", () => {
  const { document, $, c, work, line, topic, project, destination } = panelFixture();
  const open = () => c.panelInto(project, line, c.selectedStep(line, c.S.route));
  const present = where => {
    assert.equal(document.querySelectorAll(".sim-topic").length, 1);
    assert.equal($(where + " .sim-topic-name").dataset.doc, topic.path);
    assert.match($(where).textContent, /Reports.*1 open.*Read the report\..*Review the totals\./s);
  };
  for (const mode of [null, { key:"garden" }, { key:"share", shared:true, read:true }]) {
    c.HOSTED = mode;
    $("#view").clientWidth = 1400;
    open();
    present("#lpPanel");
    assert.equal($("#lpPanel").hidden, false);
    c.ACT["open-doc"]($("#lpPanel .sim-topic-name"));
    assert.equal(destination().view, "doc");
    assert.equal(destination().doc, topic.path);
    assert.equal(c.selectedStep(line, { step:work.id }), work);
    c.ACT["line-work"]({ dataset:{ line:line.id, step:work.id } });
    assert.equal($("#lpPanel .lpp-title h2").textContent, "Work 1");
    assert.match($("#lppResult").textContent, /The totals match/);
    c.ACT["panel-close"]();
    present("#lpPanel");
    $("#view").clientWidth = 1180;
    open();
    present("#lpPanel");
    $("#view").clientWidth = 1050;
    open();
    present("#lpTopicSide");
    $("#view").clientWidth = 390;
    open();
    present("#lpTopic");
    assert.equal($("#lpPanel").hidden, true);
    $("#view").clientWidth = 1400;
    project.knowledge = [];
    c.S.panelShut = null;
    assert.equal(c.selectedStep(line, {}), work, "an unfiled Line defaults to its latest Work");
    project.knowledge = [topic];
  }
  c.EMBED = { canvas:"files/report.penecho.json" };
  assert.equal(c.sidePanelHTML(project, line), "", "the compact Canvas embed keeps its own layout");
});

test("refreshing a Line keeps the Work being read when its Topic or Works change", () => {
  const { $, c, work, line, topic, project } = panelFixture();
  Object.assign(c, { HOSTED:null, STATE_COLOR:{}, lineState:() => "ready", boxWords:() => "", lineHeadHTML:() => "" });
  project.knowledge = [];
  const open = () => c.panelInto(project, line, c.selectedStep(line, c.S.route));
  open();
  assert.equal($("#lpPanel").dataset.step, work.id);
  const scroller = $("#lppScroll");
  scroller.scrollTop = 125;

  project.knowledge = [topic];
  c.refreshLine();
  assert.equal($("#lpPanel").dataset.step, work.id, "filing the Line must not replace the open Work with its Topic");
  const updated = { ...work, out:"Updated totals." }, newer = { ...work, id:"work-2", label:"Work 2" };
  line.stations = [updated, newer];
  c.refreshLine();
  assert.equal(c.S.lineSel, updated, "the reader takes fresh data for the same Work");
  assert.match($("#lppResult").textContent, /Updated totals/);
  assert.equal($("#lppScroll"), scroller);
  assert.equal(scroller.scrollTop, 125);

  c.ACT["line-work"]({ dataset:{ line:line.id, step:newer.id } });
  topic.goal = "Review the new figures.";
  $("#view").clientWidth = 390;
  c.refreshLine();
  assert.equal($("#lpPanel").dataset.step, newer.id);
  c.ACT["panel-close"]();
  $("#view").clientWidth = 1400;
  c.refreshLine();
  assert.equal($("#lpPanel").dataset.step, "");
  assert.match($("#lpPanel").textContent, /Review the new figures/);
  project.knowledge = [];
  c.refreshLine();
  assert.equal($("#lpPanel").hidden, true, "a refresh must also respect closing the reader");
});

test("the retained Work belongs to this Line visit and must still exist", () => {
  const { c, line, work, project, topic } = panelFixture();
  project.knowledge = [];
  c.panelInto(project, line, c.selectedStep(line, c.S.route));
  const next = { ...work, id:"work-2", label:"Work 2" };
  line.stations.push(next);
  assert.equal(c.selectedStep(line, c.S.route), work, "a newer Work arriving leaves the current reader alone");
  assert.equal(c.selectedStep(line, { view:"line", line:line.id }), next, "a fresh visit uses the current default");

  const other = { ...line, id:"other", slug:"other" };
  project.knowledge = [{ ...topic, lines:[line.id, other.id] }];
  assert.equal(c.selectedStep(other, { view:"line", line:other.id }), null, "Work numbers repeat across Lines");
  line.stations = [next];
  assert.equal(c.selectedStep(line, c.S.route), null, "a removed Work yields to the Line's Topic");
});

test("the Share dialog can create and copy a published link during background sync", async () => {
  const { document } = require("./helpers/dom.js").parseHTML("<html><body></body></html>");
  const create = document.createElement.bind(document);
  document.createElement = tag => {
    const el = create(tag);
    if (tag === "dialog") el.showModal = () => { el.open = true; };
    return el;
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => root.querySelectorAll(selector);
  const state = { signedIn:true, plus:true, remote:{ rev:2 }, progress:{ phase:"uploading" }, error:"An earlier sync failed" };
  const link = "https://cloud.test/l/test", copied = [], calls = [];
  const c = vm.createContext({ document, $, $$, ACT:{}, esc:String, ic:() => "", project:() => ({ id:"garden", name:"Garden" }),
    pathFor:() => "/projects/garden", clearTimeout, setTimeout, copyText:value => copied.push(value),
    api:async (url, options) => {
      calls.push([url, options?.method || "GET"]);
      return options?.method === "POST" ? { ...state, remote:{ rev:2, share:{ url:link } }, link } : state;
    } });
  vm.runInContext(read("share.js"), c);
  await c.ACT["project-share"]();
  assert.equal($(".command-error").hidden, true);
  $("[data-share-create]").click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [["/projects/garden/cloud", "GET"], ["/projects/garden/share", "POST"]]);
  assert.equal($("[data-share-link]").value, link);
  assert.equal($(".command-error").hidden, true);
  $("[data-share-copy]").click();
  assert.deepEqual(copied, [link, link]);
});
