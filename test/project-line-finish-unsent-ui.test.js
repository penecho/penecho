"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness() {
  const station = { id:"ask-1", kind:"ask", text:"Already handled by another worker.", when:"2026-11-12 14:53", unsent:true, canFinishUnsent:true, files:[], refers:[] };
  const line = { id:"one", slug:"one", topicPath:"topics/one.md", stations:[station] }, project = { id:"p", defaultAgent:"codex", lines:[line] };
  const requests = [], notices = [], events = [];
  const context = vm.createContext({
    HOSTED:null, S:{}, SEND:{}, KIND:{ ask:{ label:"Ask" } }, station, line, p:project,
    document:{ addEventListener() {} }, window:{}, addEventListener() {},
    availableAgents:() => [], can:() => true, fileEntry:() => null, filesApart:() => false,
    wordsMd:text => `<p>${text}</p>`,
    project:() => project, lineById:() => line, stationById:() => station,
    act:async (l, action, body) => { requests.push({ line:l.id, action, step:body.step }); },
    refreshAfterChange:() => events.push("refresh"), toast:message => notices.push(message),
  });
  for (const name of ["line-status", "core", "line"]) vm.runInContext(fs.readFileSync(path.join(__dirname, `../public/lines/${name}.js`), "utf8"), context);
  context.toast = message => notices.push(message);
  context.button = { dataset:{ line:"one", step:"ask-1" }, disabled:false };
  const run = code => vm.runInContext(code, context);
  return { context, station, requests, notices, events, run, click:() => run("ACT['unsent-finish'](button)") };
}

test("unsent completion is visible with no installed agent, and absent on an older server", () => {
  const h = harness();
  assert.match(h.run("unsentFoot(p, line, station)"), /Already completed elsewhere\?[\s\S]*<button[^>]+data-act="unsent-finish"[^>]*>[\s\S]*Mark finished &amp; reviewed/);
  h.station.canFinishUnsent = false;
  assert.doesNotMatch(h.run("unsentFoot(p, line, station)"), /data-act="unsent-finish"/);
  h.station.canFinishUnsent = true;
  h.station.held = { reason:"credits" };
  h.context.heldAskHTML = () => "<p>Waiting for credits</p>";
  assert.match(h.run("unsentFoot(p, line, station)"), /Waiting for credits[\s\S]*data-act="unsent-finish"/);
});

test("a credit-held Ask shows one completion button beside its credit options", () => {
  const h = harness();
  const cloud = fs.readFileSync(path.join(__dirname, "../public/lines/cloud.js"), "utf8");
  vm.runInContext(cloud.slice(cloud.indexOf("function heldAskHTML("), cloud.indexOf("ACT['held-credits']")), h.context);
  h.station.held = { reason:"credits" };
  const html = h.run("unsentFoot(p, line, station)");
  assert.match(html, /Get credits/);
  assert.equal(html.split('data-act="unsent-finish"').length - 1, 1);
});

test("a completed Ask shows its certification without unsent controls or a Work review toggle", () => {
  const h = harness();
  Object.assign(h.station, { unsent:false, finishedAsk:true, reviewed:true });
  const html = h.run("askItem(p, line, station)");
  assert.match(html, /role="status"[\s\S]*Finished &amp; reviewed[\s\S]*Marked by you\./);
  assert.match(html, /Already handled by another worker/);
  assert.doesNotMatch(html, /Not sent|data-act="unsent-|data-act="work-reviewed"/);
  assert.equal(h.run("stateWord(station)"), "finished and reviewed");
});

test("one activation saves once, waits for success and prevents a duplicate click", async () => {
  const h = harness();
  let resolve;
  h.context.act = async (line, action, body) => {
    h.requests.push({ line:line.id, action, step:body.step });
    await new Promise(yes => { resolve = yes; });
  };
  h.context.S.handed = { "one/ask-1":{ agent:"codex" } };
  const saving = h.click();
  assert.equal(h.context.button.disabled, true);
  assert.equal(h.station.unsent, true, "no optimistic certification before persistence");
  assert.equal(h.events.length, 0);
  await h.click();
  assert.deepEqual(h.requests, [{ line:"one", action:"finish-unsent", step:"ask-1" }]);
  resolve(); await saving;
  assert.deepEqual(h.events, ["refresh"]);
  assert.deepEqual(h.notices, ["Marked finished & reviewed"]);
  assert.equal(h.context.S.handed["one/ask-1"], undefined);
  assert.equal(h.context.button.disabled, false);
});

test("a failed certification keeps the unsent Ask and handoff and reports the error", async () => {
  const h = harness();
  h.context.S.handed = { "one/ask-1":{ agent:"codex" } };
  h.context.act = async () => { throw new Error("The Ask changed. Refresh the line."); };
  await h.click();
  assert.equal(h.station.unsent, true);
  assert.equal(h.station.finishedAsk, undefined);
  assert.ok(h.context.S.handed["one/ask-1"]);
  assert.equal(h.events.length, 0);
  assert.deepEqual(h.notices, ["The Ask changed. Refresh the line."]);
  assert.equal(h.context.button.disabled, false);
});
