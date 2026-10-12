"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");
const SMART = require("../public/smart-suggest.js");
const EXAMPLES = require("../public/example-scenarios.js");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const html = read("public/index.html");
const moduleSource = read("src/client/app/example-canvases.js");
const suggestSource = read("src/client/app/smart-suggestions.js");

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  let depth = 0, index = source.indexOf("{", source.indexOf(")", start));
  for (; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) break;
  }
  return `${source.slice(Math.max(0, start - 6), start) === "async " ? "async " : ""}${source.slice(start, index + 1)}`;
}

test("example canvases load their ink and scenarios before the app, and their styles before the Studio shell", () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(scripts.indexOf("example-ink.js") >= 0 && scripts.indexOf("example-ink.js") < scripts.indexOf("example-scenarios.js"));
  assert.ok(scripts.indexOf("example-scenarios.js") < scripts.indexOf("app.js"));
  const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(styles.indexOf("example-canvases.css") >= 0 && styles.indexOf("example-canvases.css") < styles.indexOf("studio-shell.css"));
  const pkg = JSON.parse(read("package.json"));
  for (const file of ["public/example-ink.js", "public/example-scenarios.js", "public/example-canvases.css"]) assert.ok(pkg.files.includes(file), file);
});

test("the empty canvas leads with examples and every entry point opens the same dialog", () => {
  const { document } = parseHTML(html);
  const welcome = document.querySelector("#canvasWelcome");
  const children = [...welcome.children].map((child) => child.id);
  assert.ok(children.indexOf("canvasWelcomeExamples") >= 0 && children.indexOf("canvasWelcomeExamples") < children.indexOf("canvasWelcomeActions"));
  assert.equal(document.querySelector("#canvasWelcomeExamples").hasAttribute("hidden"), true, "shown only when examples are available");
  assert.equal(document.querySelector("#canvasWelcomeGoals").getAttribute("data-pe-control"), "segmented");
  const entries = [...document.querySelectorAll("[data-open-examples]")];
  assert.ok(entries.some((entry) => entry.closest("#canvasMoreMenu")?.id === "canvasMoreMenu" && entry.getAttribute("role") === "menuitem"));
  assert.ok(entries.some((entry) => entry.closest(".studio-navigator-foot")));
  assert.equal(document.querySelector("#examplesDialog").tagName, "DIALOG");
  const coach = document.querySelector("#exampleCoach");
  assert.equal(coach.getAttribute("aria-modal"), "false", "the coachmark never blocks the canvas");
  for (const id of ["examplesDialogClose", "exampleCoachAll", "exampleCoachHide", "exampleDoneNext", "exampleDoneOwn", "exampleDoneClose"])
    assert.ok(document.querySelector(`#${id}`).getAttribute("data-pe-button"), id);
});

test("Suggest and its executor defer to an active example without changing other canvases", () => {
  assert.match(suggestSource, /return typeof exampleCanvasesAssistView === "function" \? exampleCanvasesAssistView\(view, cluster\) : view;/);
  assert.match(suggestSource, /if \(action && typeof exampleCanvasesActionStarted === "function" && await exampleCanvasesActionStarted\(id, target\)\) return;\n\s+if \(!action\) return;/);
  const order = read("scripts/build-client.js");
  assert.ok(order.indexOf("smart-suggestions.js") < order.indexOf("example-canvases.js") && order.indexOf("example-canvases.js") < order.indexOf("ui-bootstrap.js"));
});

test("an example canvas puts its action first and highlights it; other canvases keep their ranking", () => {
  const context = vm.createContext({ EXAMPLES, SMART_SUGGEST: SMART, session: null, documentId: "doc-a" });
  vm.runInContext(`
    function exampleSessionCurrent() { return session && session.documentId === documentId ? session : null; }
    ${functionSource(moduleSource, "exampleCanvasesAssistView")}
  `, context);
  const view = { items: [{ id: "solve", source: "local" }, { id: "typeset", source: "local" }, { id: "answer", source: "local" }], more: [{ id: "plot", source: "local" }], confident: false, source: "local" };
  assert.equal(context.exampleCanvasesAssistView(view, {}), view, "no example: unchanged");
  context.session = { id: "functions", documentId: "doc-a", status: "waiting" };
  const steered = context.exampleCanvasesAssistView(view, {});
  assert.deepEqual(Array.from(steered.items, (item) => item.id), ["plot", "solve", "typeset"]);
  assert.deepEqual(Array.from(steered.more, (item) => item.id), ["answer"]);
  assert.equal(steered.confident, true);
  assert.equal(context.exampleCanvasesAssistView(view, { result: true }), view, "results keep their own next steps");
  context.documentId = "doc-b";
  assert.equal(context.exampleCanvasesAssistView(view, {}), view, "another canvas: unchanged");
  context.documentId = "doc-a";
  context.session = { id: "functions", documentId: "doc-a", status: "running" };
  assert.equal(context.exampleCanvasesAssistView(view, {}), view, "after the tap: unchanged");
});

test("example ink is recorded as Suggest input in one Undo step, without training on example taps", () => {
  const draw = functionSource(moduleSource, "drawExampleInk");
  assert.equal((draw.match(/saveUserCanvasChange\(\)/g) || []).length, 1, "one history entry for the whole example");
  assert.match(draw, /stroke\(points\[index - 1\], points\[index\], false, size, true, color\)/, "strokes are user input (dirty)");
  assert.match(draw, /smartSuggestRecordStroke\(\{[^}]*historyEntry[^}]*exact:true/);
  assert.ok(draw.indexOf("smartSuggestRecordStroke") < draw.lastIndexOf("refreshDirtyHistoryAfter"), "history captures the recorded strokes");
  assert.doesNotMatch(draw, /assistDetectDeletion|penIntelStrokeFinished/, "drawn ink never reads as a delete or gesture mark");
  const started = functionSource(moduleSource, "exampleCanvasesActionStarted");
  assert.match(started, /graphWidgetCommand\(scenario\.graph/, "instant examples insert their known graph");
  assert.match(started, /graphPlacement\(\{\}, \{ anchor, visible, canvasSize:SIZE \}\)[\s\S]*?EXAMPLES\.architectureDocument\(scenario\.architecture, state\.language\)/, "the diagram example inserts its known local architecture diagram");
  assert.match(started, /consumeDirtyInputScope/);
  assert.match(started, /target\.example = true/);
  assert.match(functionSource(moduleSource, "finishExample"), /setCanvasMode\("hand", \{ preserveSelection:true, skipDraftFinalize:true/, "results open in Hand so widgets respond");
  assert.match(functionSource(suggestSource, "assistLearnInstantTap"), /\|\| target\.example\) return;/, "example taps do not train the device prior");
});

test("coachmarks quote the real Suggest labels in both languages", () => {
  for (const scenario of EXAMPLES.SCENARIOS) {
    const action = SMART.actionById(scenario.action);
    if (!action) continue;
    const en = SMART.label(action, "en", { illustrationStyle: "storybook" }), zh = SMART.label(action, "zh", { illustrationStyle: "storybook" });
    // Tips may point at other places in the app; the coachmark names the chip to tap.
    for (const [, quoted] of scenario.coach.zh.matchAll(/“([^”]+)”/g)) {
      const known = SMART.ACTIONS ? SMART.ACTIONS.map((item) => SMART.label(item, "zh", { illustrationStyle: "storybook" })) : [zh];
      assert.ok(known.includes(quoted), `${scenario.id} quotes “${quoted}”, which is not a Suggest label`);
    }
    if (/\bTap /.test(scenario.coach.en)) assert.ok(scenario.coach.en.includes(`Tap ${en}`), `${scenario.id} must name the chip “${en}”`);
  }
});

test("the current tool is filled like the Share action", () => {
  const css = read("public/studio-shell.css");
  assert.match(css, /\.primary-tools :is\(#pe-button-contract, button\)\[data-mode\]:is\(\.active, \[aria-pressed="true"\]\)[\s\S]{0,160}\{\s*color: #fff;[\s\S]{0,60}background: var\(--pe-accent, var\(--studio-accent\)\);/);
});

test("a click on an example card opens it, including inside the grouped dialog", () => {
  const click = functionSource(moduleSource, "exampleCardClick");
  // Only the tab buttons choose a category; sections and cards never match it.
  assert.match(click, /closest\?\.\("button\[data-example-goal\]"\)/);
  assert.match(click, /closest\?\.\("\[data-example-id\]"\)/);
  const dialog = functionSource(moduleSource, "renderExamplesDialog");
  assert.doesNotMatch(dialog, /dataset\.exampleGoal/, "dialog sections must not look like tab buttons");
  const calls = [];
  const context = vm.createContext({ chooseExampleGoal: (goal) => calls.push(["goal", goal]), openExampleCanvas: (id) => calls.push(["open", id]) });
  vm.runInContext(click, context);
  const card = { dataset: { exampleId: "code-bug" } }, section = { dataset: { exampleGroup: "code" } };
  const target = { closest: (selector) => (selector === "button[data-example-goal]" ? null : selector === "[data-example-id]" ? card : section) };
  context.exampleCardClick({ target });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [["open", "code-bug"]]);
});

test("examples that need a model ask for one instead of showing a stand-in result", () => {
  const ready = functionSource(moduleSource, "exampleModelReady");
  assert.match(ready, /route === "instant"\) return true/);
  assert.match(ready, /canvasAgentExecutionAvailable\(\)/);
  assert.match(ready, /hasSelectedAiConnection\(\)/);
  const started = functionSource(moduleSource, "exampleCanvasesActionStarted");
  assert.ok(started.indexOf("exampleModelReady") < started.indexOf('session.status = "running"'), "no try is recorded without a model");
  assert.match(started, /openExampleAiSetup\(\);\s*return true;/, "the local photo-only note is never offered as the example's result");
  const submitted = functionSource(moduleSource, "exampleAgentSubmitted");
  assert.match(submitted, /preventDefault\(\)[\s\S]*stopImmediatePropagation\(\)[\s\S]*openExampleAiSetup/);
  assert.match(functionSource(moduleSource, "openExampleAiSetup"), /#settingsNavConnections/);
  const { document } = parseHTML(html);
  const setup = document.querySelector("#exampleCoachSetup");
  assert.ok(setup && setup.hasAttribute("hidden") && setup.getAttribute("data-pe-button") === "primary");
});

test("Agent examples require a selected model even when the execution service is available", () => {
  let connected = false, available = true;
  const context = vm.createContext({ hasSelectedAiConnection:() => connected, canvasAgentExecutionAvailable:() => available });
  vm.runInContext(functionSource(moduleSource, "exampleModelReady"), context);
  assert.equal(context.exampleModelReady({ route:"instant" }), true);
  assert.equal(context.exampleModelReady({ route:"ai" }), false);
  assert.equal(context.exampleModelReady({ route:"agent" }), false);
  connected = true;
  assert.equal(context.exampleModelReady({ route:"ai" }), true);
  assert.equal(context.exampleModelReady({ route:"agent" }), true);
  available = false;
  assert.equal(context.exampleModelReady({ route:"agent" }), false);
  assert.equal(context.exampleModelReady({ route:"ai" }), true);
  assert.equal(context.exampleModelReady({ route:"instant" }), true);
});
