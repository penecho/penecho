"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");

const source = name => fs.readFileSync(path.join(__dirname, "../public/lines", name + ".js"), "utf8");
const action = '[data-act="continue-work"]';
const work = (id, more) => ({ id, label:"Work " + id.slice(-1), kind:"work", agent:"fake", pictures:[], ...more });

function fixture() {
  const { document } = parseHTML("<html><body></body></html>");
  const p = { id:"p" }, line = { id:"slug", slug:"slug", status:"stopped", running:false, why:"Quota", stations:[] }, ACT = {};
  const c = vm.createContext({ ACT, document, l:line, p,
    S:{ route:{ view:"line" } }, pathFor:id => "/projects/" + id, project:() => p, lineById:() => line,
    esc:String, ic:name => `<svg data-icon="${name}"></svg>`, availableAgents:() => ["fake"],
    stationById:(l, id) => l.stations.find(s => s.id === id),
    lineState:l => l.status === "stopped" ? "error" : l.status, lineWorking:l => l.running,
    STATE_COLOR:{}, workWords:() => "Stopped with an error", workQuestions:() => [], workAsking:() => null, workWaitingReply:() => false,
    isReviewed:() => false, nodeIcon:() => "", stepLabel:s => s.label, ratingBadge:() => "", orchRatingBadge:() => "", reviewMark:() => "",
    outputsHTML:() => "", canvasPages:() => [], nodeTools:() => "", nodeTool:() => "", inlineSay:text => text, agentInfo:() => ({ name:"Fake" }), av:() => "",
    followedStopTarget:() => null, panelExpandButton:() => "", endStoppedButton:(_p, l) => `<button type="button" data-act="all-reviewed" data-line="${l.id}">Mark reviewed</button>`, fileEntry:() => null,
    location:{ search:"" }, URLSearchParams,
  });
  vm.runInContext(source("line-status"), c);
  const lineSrc = source("line");
  const evaluate = (start, end) => {
    const from = lineSrc.indexOf(start), to = lineSrc.indexOf(end, from);
    assert.ok(from >= 0 && to > from, start);
    vm.runInContext(lineSrc.slice(from, to), c);
  };
  evaluate("const topicApi", "const plainOut");
  evaluate("const isYours", "const waitingWhyOf");
  evaluate("const deletableHere", "\nconst deleteTool");
  evaluate("const deleteTool", "\n");
  evaluate("const isOrchReview", "\n");
  evaluate("function lineHeadActions", "// Saved split plans");
  evaluate("function workItem", "// What a Work made besides");
  evaluate("function panelHead", "function panelBody");
  evaluate("const STARTING", "function startingWork");
  evaluate("ACT['continue-work']", "ACT['line-do']");
  const hosted = source("hosted");
  vm.runInContext(hosted.slice(hosted.indexOf("const HOSTED_OFF"), hosted.indexOf("// A menu without")), c);
  vm.runInContext("let HOSTED = null; this.setHosted = value => { HOSTED = value; };", c);
  const render = (fn, s) => {
    c.s = s;
    const el = document.createElement("div");
    el.innerHTML = vm.runInContext(fn, c);
    return el;
  };
  return { c, ACT, line, render };
}

test("Continue is directly available in the Work panel and eligible stopped Work cards, while the stopped Line header omits Continue, Carry on with, and Retry", () => {
  const { line, render, c } = fixture();
  const primary = work("work-1", { state:"error", canContinue:true });
  const lane = work("work-2", { state:"off", off:"stopped", canContinue:true });
  const noSession = work("work-3", { state:"off", off:"stopped" });
  Object.assign(line, { continueStep:primary.id, stations:[primary, lane, noSession] });
  const head = () => render("lineHeadActions(p,l,'error')");
  const card = s => render("workItem(p,l,s)", s);
  const panel = s => render("panelHead(l,s)", s);
  assert.equal(head().querySelector(action), null);
  assert.equal(head().querySelector('[data-verb="retry"]'), null);
  assert.equal(head().querySelector('[data-act="carry-on"]'), null);
  assert.equal(head().querySelector('[data-act="all-reviewed"]')?.textContent, "Mark reviewed");
  const cardButton = card(primary).querySelector(action);
  assert.equal(cardButton.textContent, "Continue");
  assert.equal(cardButton.title, "Continue in the same session without dropping previous work");
  assert.equal(cardButton.dataset.step, primary.id);
  const panelButton = panel(primary).querySelector(action);
  assert.equal(panelButton.textContent, "Continue");
  assert.equal(panelButton.dataset.step, primary.id);
  assert.equal(card(lane).querySelector(action).dataset.step, lane.id);
  assert.equal(panel(lane).querySelector(action).dataset.step, lane.id);
  assert.equal(card(noSession).querySelector(action), null);
  assert.equal(panel(noSession).querySelector(action), null);
  c.setHosted({ read:false });
  assert.equal(head().querySelector(action), null);
  assert.equal(head().querySelector('[data-verb="retry"]'), null);
  assert.equal(head().querySelector('[data-act="carry-on"]'), null);
  assert.equal(card(primary).querySelector(action), null);
  assert.equal(card(lane).querySelector(action), null);
  assert.equal(panel(primary).querySelector(action), null);
});

test("Continue sends the selected Work ID, marks that Work active and restores the stopped state on conflict", async () => {
  const { line, render, ACT, c } = fixture();
  const primary = work("work-1", { state:"error", canContinue:true, stopWhy:"limit" });
  const lane = work("work-2", { state:"off", off:"stopped", canContinue:true });
  Object.assign(line, { continueStep:primary.id, stations:[primary, lane] });
  const snapshot = structuredClone(line), calls = [], notices = [];
  c.api = (url, opts) => {
    calls.push([url, opts.method, opts.body.step]);
    assert.equal(primary.state, "active");
    assert.equal(primary.stopWhy, "");
    assert.equal(line.status, "working");
    assert.equal(lane.state, "off");
    throw new Error("This session is already in use.");
  };
  c.toast = words => notices.push(words);
  c.refreshAfterChange = () => {};
  c.loadState = async () => Object.assign(line, snapshot);
  const btn = render("panelHead(l,s)", primary).querySelector(action);
  await ACT["continue-work"](btn);
  assert.deepEqual(calls, [["/projects/p/topics/slug/continue", "POST", "work-1"]]);
  assert.deepEqual(notices, ["This session is already in use."]);
  const restored = line.stations[0];
  assert.ok(render("panelHead(l,s)", restored).querySelector(action), "Continue comes back in the Work panel after the rejected request");
  assert.ok(render("workItem(p,l,s)", restored).querySelector(action), "Continue comes back on the Work card after the rejected request");
  assert.equal(render("lineHeadActions(p,l,'error')").querySelector(action), null);
});
