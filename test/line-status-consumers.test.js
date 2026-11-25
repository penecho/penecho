"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");
const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");

const work = (id, state, fields = {}) => ({ id, kind:"work", agent:"codex", state, ...fields });
const toolQuestion = (text, fields = {}) => ({ kind:"tool", questions:[{ text }], ...fields });
const child = (id, status, fields = {}) => ({ id, status, stations:[], ...fields });

function orchestratorFixture(t, lines, act) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "line-status-consumers-"));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const project = { id:"p" };
  const service = {
    stateOf:() => ({ lines }),
    parsedDoc:() => ({ front:{} }),
    key:(_p, slug) => slug,
    startsNow:new Map(),
    act,
  };
  const orchestrator = createOrchestrator({ service, directory });
  return { directory, call:(args, options) => orchestrator.call(project, args, options) };
}

test("wait settles live blocking tool questions and returns both kinds of open question text", async t => {
  const tool = toolQuestion("Which export should I use?");
  const external = child("external", "waiting", {
    elsewhere:true, running:true, asking:{ ...tool, answerable:false },
    questions:[{ text:"Which project?" }, ...tool.questions],
  });
  const local = child("local", "waiting", { running:true, asking:{ ...tool, answerable:true } });
  const { call } = orchestratorFixture(t, [external, local]);
  const result = await call({ do:"wait", lines:[external.id, local.id] }, { signal:AbortSignal.abort() });
  assert.deepEqual(result, {
    done:true,
    lines:[
      { line:"external", status:"waiting", running:true, questions:["Which project?", "Which export should I use?"] },
      { line:"local", status:"waiting", running:true, questions:["Which export should I use?"] },
    ],
  });
});

test("wait settles archived live children and preserves their live status", async t => {
  const closed = child("closed", "closed", { archived:true, running:true });
  const landed = child("landed", "landed", { archived:true, running:true });
  const { call } = orchestratorFixture(t, [closed, landed]);
  assert.deepEqual(await call({ do:"wait", lines:["closed", "landed"] }, { signal:AbortSignal.abort() }), {
    done:true,
    lines:[
      { line:"closed", status:"closed", running:true },
      { line:"landed", status:"landed", running:true },
    ],
  });
});

test("wait keeps pending work live unless it has a blocking tool question or is archived", async t => {
  const nonblocking = child("nonblocking", "working", { running:true, asking:toolQuestion("Optional?", { isBlocking:false }) });
  const stopped = child("stopped", "stopped", { running:true, stations:[work("work-1", "error"), work("work-2", "active")] });
  const documentWait = child("document-wait", "waiting", { running:true, questions:[{ text:"Which project?" }] });
  const { call } = orchestratorFixture(t, [nonblocking, stopped, documentWait]);
  for (const l of [nonblocking, stopped, documentWait]) {
    const { done, lines:[current] } = await call({ do:"wait", lines:l.id }, { signal:AbortSignal.abort() });
    assert.equal(done, false, l.id);
    assert.equal(current.running, true, l.id);
    assert.deepEqual(current.questions, l.questions?.map(q => q.text), l.id);
  }
});

test("retry reports no launch for a historical Work or an unrelated live lane", async t => {
  const historical = child("historical", "stopped", { stations:[work("work-1", "done")] });
  const live = child("live", "stopped", { running:true, stations:[work("work-1", "off", { off:"stopped" }), work("work-2", "active")] });
  const { call } = orchestratorFixture(t, [historical, live], (_p, slug) => slug === "historical" ? { step:"work-1" } : {});
  assert.deepEqual(await call({ do:"retry", line:"historical" }), {
    line:"historical", work:"work-1", status:"stopped", state:"done", started:false,
  });
  assert.deepEqual(await call({ do:"retry", line:"live", work:"work-1" }), {
    line:"live", work:"", status:"stopped", state:"", started:false,
  });
});

test("retry reports the changed Work for active, quickly completed, waiting and failed attempts", async t => {
  const cases = [
    ["active", "active", {}, true],
    ["already done", "done", {}, true],
    ["waiting on its tool question", "wait", { asking:toolQuestion("Choose?") }, true],
    ["idle document wait", "wait", {}, false],
    ["immediate failure", "error", {}, false],
  ];
  for (const [name, state, fields, started] of cases) {
    await t.test(name, async t => {
      const station = work("work-1", "off", { off:"stopped" });
      const l = child("line", "stopped", { stations:[station] });
      const { call } = orchestratorFixture(t, [l], (_p, _slug, action, options) => {
        assert.equal(action, "retry");
        assert.equal(options.step, station.id);
        Object.assign(station, { state, off:"", ...fields });
        return { step:station.id };
      });
      assert.deepEqual(await call({ do:"retry", line:l.id, work:station.id }), {
        line:l.id, work:station.id, status:"stopped", state, started,
      });
    });
  }
});

test("retry keeps the replacement Work's identity and original task kind", async t => {
  const line = child("line", "stopped", { stations:[work("work-1", "off", { off:"stopped" })] });
  const { directory, call } = orchestratorFixture(t, [line], () => {
    line.stations.push(work("work-2", "done"));
    line.status = "done";
    return { step:"work-2", replaced:"work-1" };
  });
  fs.mkdirSync(path.join(directory, "orchestrator"), { recursive:true });
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({
    records:[{ id:"assignment", project:"p", line:line.id, work:"work-1", kind:"research" }],
  }));
  assert.deepEqual(await call({ do:"retry", line:line.id }), {
    line:line.id, work:"work-2", kind:"research", status:"done", state:"done", started:true,
  });
});

function uiFixture(line) {
  const { document, window } = parseHTML("<html><body><main></main></body></html>");
  const p = { id:"p", lines:[line], landed:[], backlog:[], files:[] };
  const context = vm.createContext({
    document, window, addEventListener() {}, ACT:{}, SEND:{}, S:{ agents:[] }, HOSTED:false, KIND:{ ask:{ label:"Ask" }, note:{ label:"Note" } },
    p, line, project:() => p, plan:[], availableAgents:() => [],
    currentStation:l => l.stations.at(-1), openQuestions:l => l.questions || [],
    lineOfDoc:() => line, lineById:() => line, fileEntry:() => null,
  });
  const load = name => vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/lines", `${name}.js`), "utf8"), context, { filename:`${name}.js` });
  for (const name of ["core", "line-status", "markdown", "panorama", "line"]) load(name);
  vm.runInContext("const { lineState, lineWorking, lineNeedsYou, canMarkReviewed } = LINE_STATUS;", context);
  return {
    context, run:code => vm.runInContext(code, context),
    render(code) {
      const host = document.querySelector("main");
      host.innerHTML = vm.runInContext(code, context);
      return host;
    },
  };
}

test("stopped Line and collapsed Home lane offer Stop while the parallel Work runs", () => {
  const line = child("line", "stopped", { slug:"line", running:true, stations:[work("work-1", "error"), work("work-2", "active")] });
  const ui = uiFixture(line);
  const head = () => ui.render("lineHeadActions(p, line, lineState(line), currentStation(line))");
  const lane = () => ui.render("laneStateHTML(p, line)");
  const detail = () => ui.render("rowActions(p, line)");
  const stop = '[data-act="line-do"][data-verb="stop"]';
  const retry = '[data-act="line-do"][data-verb="retry"]';
  assert.equal(head().querySelector(stop)?.textContent, "Stop");
  assert.match(lane().textContent, /Stopped/);
  assert.equal(lane().querySelector(stop)?.dataset.line, line.id);
  assert.equal(head().querySelector(retry), null);
  assert.equal(detail().querySelector(retry), null);
  line.elsewhere = true;
  assert.equal(head().querySelector(stop), null, "followed Works use the stop control for their own app");
  assert.equal(head().querySelector(retry), null);
  delete line.elsewhere;
  line.running = false;
  line.stations.pop();
  assert.equal(head().querySelector(retry), null);
  assert.equal(head().querySelector('[data-act="continue-work"]'), null);
  assert.equal(head().querySelector('[data-act="carry-on"]'), null);
  assert.equal(detail().querySelector(retry)?.textContent, "Retry");
  assert.equal(lane().querySelector(stop), null);
});

test("landed Line keeps historical content and reopening, with node deletion on the computer only", () => {
  const note = { id:"note-1", kind:"note", text:"- [ ] Saved checklist", state:"done" };
  const ask = { id:"ask-1", kind:"ask", text:"Prior draft", state:"todo", unsent:true };
  const line = child("line", "landed", { slug:"line", archived:true, landed:true, closed:false, stations:[note, ask] });
  const ui = uiFixture(line);
  ui.context.note = note;
  ui.context.doc = { kind:"topic", path:"archive/line.md", md:note.text };
  ui.context.S.editNote = `${line.id}/${note.id}`;
  const head = ui.render("lineHeadActions(p, line, lineState(line), currentStation(line))");
  assert.equal(head.querySelector('[data-act="reopen-line"]')?.textContent, "Back to lines");
  assert.equal(ui.run("lineDockHTML(p, line)"), "");
  const thread = ui.render("threadHTML(p, line)");
  assert.match(thread.textContent, /Saved checklist/);
  assert.match(thread.textContent, /Not sent yet/);
  assert.ok(thread.querySelector('input[type="checkbox"][disabled]'));
  const editControls = '[data-act="note-edit"], [data-act="note-save"], [data-act="line-draw"], [data-act="unsent-edit"]';
  const deleteControls = '[data-act="yours-drop"], [data-act="unsent-drop"]';
  assert.equal(thread.querySelector(editControls), null);
  assert.deepEqual([...thread.querySelectorAll(deleteControls)].map(button => [button.dataset.act, button.dataset.line, button.dataset.step, button.getAttribute("aria-label")]), [
    ["yours-drop", line.id, note.id, "Delete"],
    ["unsent-drop", line.id, ask.id, "Delete"],
  ]);
  ui.context.HOSTED = {};
  assert.equal(ui.render("threadHTML(p, line)").querySelector(`${editControls}, ${deleteControls}`), null);
  ui.context.HOSTED = false;
  const reader = ui.render("Reader.html(doc, p)");
  assert.ok(reader.querySelector('input[type="checkbox"][disabled]'));
  assert.ok(reader.querySelector('[data-act="reader-download"]'));
  assert.equal(reader.querySelector('[data-act="reader-edit"], [data-act="add-visual"], [data-act="draw-doc"]'), null);
  line.archived = false;
  line.status = "done";
  assert.ok(ui.render("Reader.html(doc, p)").querySelector('[data-act="reader-edit"]'));
  assert.ok(ui.render("noteItem(p, line, note)").querySelector('[data-act="note-save"]'));
});

test("a finished Line under active Orchestrator review stays Working rather than switching to To review until the review finishes", () => {
  const reviewingWork = work("work-1", "done", { reviewed:false, reviewing:true, label:"Work 1", out:"Done." });
  const line = child("line", "done", { slug:"line", landed:true, stations:[{ id:"ask-1", kind:"ask", text:"Do it", state:"done" }, reviewingWork] });
  const ui = uiFixture(line);
  ui.context.STATE_TEXT = { notes:"Notes", working:"Working", wait:"Needs you", ready:"Finished", todo:"Todo", review:"To review", reviewed:"Reviewed", error:"Stopped", landed:"Finished" };
  ui.run("for (const [k, v] of Object.entries(LINE_STATUS)) if (!(k in this)) this[k] = v;");

  // Pure rules and filters treat an active background review as working, not To review.
  assert.equal(ui.run("LINE_STATUS.lineReviewing(line)"), true);
  assert.equal(ui.run("LINE_STATUS.isReviewPending(line)"), true);
  assert.equal(ui.run("LINE_STATUS.toReview(line)"), false);
  assert.equal(ui.run("LINE_STATUS.shownState(line)"), "working");
  assert.equal(ui.run("LINE_STATUS.matches(line, 'working')"), true);
  assert.equal(ui.run("LINE_STATUS.matches(line, 'review')"), false);

  // Header chip, Home row/filters, Line filters, and sub-Line views never say To review while reviewing.
  const chip = ui.render("stateChip(lineState(line), line)");
  assert.match(chip.textContent, /Working/);
  assert.doesNotMatch(chip.textContent, /To review/);
  assert.ok(chip.querySelector(".chip.c-working .spin"));
  // Line header and Panorama lane offer Stop while a background review is active on a finished Line.
  assert.equal(ui.run("canStop(line)"), true);
  assert.equal(ui.render("lineHeadActions(p, line, lineState(line), currentStation(line))").querySelector('[data-act="line-do"][data-verb="stop"]')?.textContent, "Stop");
  assert.equal(ui.render("rowActions(p, line, rowMark(p, line))").querySelector('[data-act="line-do"][data-verb="stop"]')?.textContent, "Stop");
  assert.equal(ui.run("rowMark(p, line)"), "run");
  assert.equal(ui.run("MAP_FILTERS.working(p, line)"), true);
  assert.equal(ui.run("MAP_FILTERS.review(p, line)"), false);
  assert.equal(ui.run("MAP_FILTERS.done(p, line)"), false);
  const filterBar = ui.render("filtersHTML(line)");
  assert.match(filterBar.textContent, /1 working/);
  assert.doesNotMatch(filterBar.textContent, /to review/i);
  assert.equal(ui.run("subLineStatusInfo(line).label"), "Working");
  assert.equal(ui.run("subLineStatusInfo(line).key"), "working");
  const subRow = ui.render("subLineRowHTML(p, line, line)");
  assert.match(subRow.textContent, /Reviewing Work 1/);
  assert.doesNotMatch(subRow.textContent, /to review/i);

  // Once the background review finishes, the Line moves to To review everywhere.
  delete reviewingWork.reviewing;
  reviewingWork.review = { score:5 };
  assert.equal(ui.run("LINE_STATUS.isReviewPending(line)"), false);
  assert.equal(ui.run("LINE_STATUS.toReview(line)"), true);
  assert.equal(ui.run("LINE_STATUS.shownState(line)"), "review");
  assert.equal(ui.run("LINE_STATUS.matches(line, 'working')"), false);
  assert.equal(ui.run("LINE_STATUS.matches(line, 'review')"), true);
  assert.match(ui.render("stateChip(lineState(line), line)").textContent, /To review/);
  assert.equal(ui.run("rowMark(p, line)"), "review");
  assert.match(ui.render("filtersHTML(line)").textContent, /1 to review/);
  assert.equal(ui.run("subLineStatusInfo(line).label"), "To review");

  // Manually marking reviewed (or Todo / Needs you) while reviewing still takes effect immediately.
  reviewingWork.reviewing = true;
  reviewingWork.reviewed = true;
  assert.equal(ui.run("LINE_STATUS.isReviewPending(line)"), false);
  assert.equal(ui.run("LINE_STATUS.toReview(line)"), false);
  assert.equal(ui.run("LINE_STATUS.shownState(line)"), "landed");
  assert.match(ui.render("stateChip(lineState(line), line)").textContent, /Reviewed/);
});
