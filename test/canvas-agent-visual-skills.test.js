const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function withResolvers() {
    let resolve, reject;
    const promise = new Promise((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    return { promise, resolve, reject };
  };
}

const ROOT = path.resolve(__dirname, "..");
const SKILLS = ["math-2d", "physics-2d", "math-3d"];
const MANIM_URL = "https://cdn.jsdelivr.net/npm/manim-web@0.3.24/dist/manim-web.browser.js";

function waitFor(predicate, timeoutMs = 4000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error("Timed out waiting for condition."));
      setTimeout(tick, 20);
    };
    tick();
  });
}

function readText(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("scientific visual skills stay out of the cold prompt and load into durable system content", async t => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "penecho-visual-skills-prompt-"));
  t.after(() => rmSync(stateDirectory, { recursive: true, force: true }));
  const { CanvasHarnessHost } = await import("../src/server/canvas-agent/runtime.mjs");
  const explorerContract = readText("src/server/canvas-agent/visual-explorer-contract.md").trim();
  assert.equal(explorerContract.length > 0, true);
  assert.equal(Buffer.byteLength(explorerContract, "utf8") <= 16_000, true);
  const skillDocuments = new Map(SKILLS.map(skill => {
    const document = readText(`src/server/canvas-agent/visual-skills/${skill}.md`).trim();
    assert.equal(document.length > 0, true);
    assert.equal(Buffer.byteLength(document, "utf8") <= 16_000, true);
    assert.equal(document.includes(`<meta name="penecho-visual-skill" content="${skill}">`), true);
    assert.equal(document.includes(MANIM_URL), true);
    const manimUrls = [...document.matchAll(/https?:\/\/[^\s`"<>]+manim-web@[^\s`"<>]+/g)].map(match => match[0]);
    assert.equal(manimUrls.length > 0, true);
    assert.deepEqual([...new Set(manimUrls)], [MANIM_URL]);
    assert.match(document, /complete[^.]*static[^.]*(?:HTML|render)|static first render/s);
    assert.match(document, /prefers-reduced-motion/);
    assert.match(document, /window\.penechoWidgetReady\(\)/);
    return [skill, document];
  }));

  const calls = [], messages = [];
  const connection = { id:"visual-skill-cli", provider:"codex-cli", name:"Visual Skill CLI", cliPath:"codex-test", cliModel:"model-test", effort:"medium" };
  const host = new CanvasHarnessHost({
    stateDirectory,
    rootDirectory:ROOT,
    resolveConnection:id => id === connection.id ? connection : null,
    listConnections:() => [connection],
    callCli:async request => {
      calls.push(request);
      return calls.length === 1
        ? JSON.stringify({ type:"tool_call", name:"load_visual_skill", arguments:{ skill:"math-2d" } })
        : JSON.stringify({ type:"final", text:"Loaded the selected skill." });
    },
  });
  t.after(() => host.dispose());
  let session;
  const send = (type, payload) => {
    messages.push({ type, payload });
    if (type === "tool_request") queueMicrotask(() => host.resolveToolResult(session, { requestId:payload.requestId, ok:true, result:{} }));
  };
  session = await host.connect({ clientId:"visual-skill-client", connectionId:connection.id, binding:{}, send });
  host.updateState(session, { revision:1, canvas:{ width:2000, height:2000 }, objects:[], counts:{ inkTiles:0, widgets:0, textBoxes:0, images:0 } });
  await host.submit(session, "Load the math visualization skill.");
  await waitFor(() => messages.some(message => message.type === "session_event" && message.payload.kind === "turn_end"));

  assert.equal(calls.length, 2);
  const firstRequest = JSON.parse(calls[0].prompt), secondRequest = JSON.parse(calls[1].prompt);
  const schema = firstRequest.availableTools.find(tool => tool.name === "load_visual_skill");
  assert.equal(schema.description.includes("durable session system prompt"), true);
  assert.equal(schema.description.includes("before authoring a matching scientific Visual Explorer"), true);
  assert.deepEqual(schema.parameters.properties.skill, { type:"string", enum:SKILLS });
  assert.deepEqual(schema.parameters.required, ["skill"]);
  assert.match(calls[0].systemPrompt, /call `load_visual_skill` with the closest available skill before authoring/i);
  assert.notEqual(calls[1].systemPrompt, calls[0].systemPrompt);
  assert.deepEqual(secondRequest.availableTools, firstRequest.availableTools);
  for (const [skill, document] of skillDocuments) {
    assert.equal(calls[0].systemPrompt.includes(document), false);
    assert.equal(JSON.stringify(firstRequest.availableTools).includes(document), false);
    assert.equal(calls[1].systemPrompt.includes(document), skill === "math-2d");
  }
  const selectedDocument = skillDocuments.get("math-2d");
  const selectedHash = createHash("sha256").update(selectedDocument).digest("hex");
  assert.equal(calls[1].systemPrompt.includes(`<penecho_visual_skill id="math-2d" sha256="${selectedHash}">`), true);
  const toolResult = secondRequest.conversation.flatMap(message => message.content).find(part => part.type === "tool_result");
  const persistedResult = JSON.parse(toolResult.content[0].text);
  assert.deepEqual(persistedResult, {
    skill:"math-2d",
    loadedSkills:["math-2d"],
    sha256:selectedHash,
    loaded:true,
    alreadyLoaded:false,
  });
  assert.equal(Object.hasOwn(persistedResult, "contract"), false);
  assert.equal(JSON.stringify(secondRequest.conversation).includes(selectedDocument), false);
});

test("scientific Visual Explorer contracts make Manim-Web the default explanatory language", () => {
  const policy = [
    "Default to Manim-Web as the primary explanatory rendering/motion language",
    "at least as clearly as a static alternative",
    "faithfully, legibly, accessibly, or efficiently improve",
  ];
  const skillDocuments = SKILLS.map(skill => readText(`src/server/canvas-agent/visual-skills/${skill}.md`));
  const sharedContracts = [
    readText("src/server/canvas-agent/visual-explorer-contract.md"),
    readText("docs/canvas-agent-visual-explorer.md"),
  ];

  for (const document of skillDocuments) {
    for (const requirement of policy) assert.equal(document.includes(requirement), true);
    assert.doesNotMatch(document, /enhancement is optional|if and only if (?:3-D |explanatory )?motion is needed/i);
  }
  for (const document of sharedContracts) {
    assert.match(document, /Manim-Web (?:is the|as the) default explanatory rendering\/motion language/i);
    assert.match(document, /at least as clear(?:ly)? as a static alternative/i);
    assert.match(document, /faithfully, legibly, accessibly, or efficiently improve|fidelity, legibility, accessibility, or efficiency/i);
    assert.doesNotMatch(document, /optional Manim-Web enhancement|optional enhancement/i);
  }
});

test("math-3d contract provides bounded interactive camera exploration with visible controls", () => {
  const document = readText("src/server/canvas-agent/visual-skills/math-3d.md");
  for (const requirement of [
    "enableOrbitControls:true",
    "orbitControlsOptions",
    "enableRotate:true",
    "enableZoom:true",
    "enablePan:false",
    "minDistance:10",
    "maxDistance:28",
    "data-reset-view",
    "listenToKeyEvents(layer)",
    "scene.orbitControls?.reset()",
    "beforeSnapshot",
    "afterSnapshot",
  ]) assert.equal(document.includes(requirement), true);
  assert.match(document, /Drag to rotate.*Wheel or pinch to zoom.*Shift\+Arrow keys to rotate.*Reset view/s);
  assert.match(document, /Manual bounded orbit controls may remain enabled after readiness/);
  assert.doesNotMatch(document, /unconstrained user reorientation/);
});

test("load_visual_skill returns only load metadata and tracks state per session", async t => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "penecho-visual-skills-tool-"));
  t.after(() => rmSync(stateDirectory, { recursive: true, force: true }));
  const { CanvasHarnessHost } = await import("../src/server/canvas-agent/runtime.mjs");
  const connection = { id:"api", provider:"api", apiFormat:"openai", apiUrl:"http://127.0.0.1:9/v1", apiModel:"test-model", apiKey:"test-key" };
  const host = new CanvasHarnessHost({
    stateDirectory,
    rootDirectory:ROOT,
    resolveConnection:id => id === connection.id ? connection : null,
    listConnections:() => [connection],
  });
  t.after(() => host.dispose());
  const first = await host.connect({ clientId:"first", connectionId:connection.id, binding:{}, send:() => {} });
  const second = await host.connect({ clientId:"second", connectionId:connection.id, binding:{}, send:() => {} });
  const registry = first.handle.agent.ctx.tools;
  const tool = registry.get("load_visual_skill", first.handle.agent);
  const document = readText("src/server/canvas-agent/visual-skills/math-2d.md").trim();
  const result = await tool.execute({ skill:"math-2d" }, { callId:"visual-skill-call" });
  assert.deepEqual(result, {
    skill:"math-2d",
    loadedSkills:["math-2d"],
    sha256:createHash("sha256").update(document).digest("hex"),
    loaded:true,
    alreadyLoaded:false,
  });
  assert.equal(Object.hasOwn(result, "contract"), false);
  assert.deepEqual(await tool.execute({ skill:"math-2d" }, { callId:"visual-skill-repeat" }), {
    ...result,
    alreadyLoaded:true,
  });
  assert.deepEqual([...first.visualSkillsLoaded], ["math-2d"]);
  assert.deepEqual([...second.visualSkillsLoaded], []);
});

test("Visual Explorer scientific markers and manim imports are gated per loaded session", async t => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "penecho-visual-skills-gate-"));
  t.after(() => rmSync(stateDirectory, { recursive: true, force: true }));
  const { CanvasHarnessHost, validateVisualExplorerSkillMarkup } = await import("../src/server/canvas-agent/runtime.mjs");
  const marker = '<meta name="penecho-visual-skill" content="math-2d">';
  const importScript = `<script type="module">import { Scene } from "${MANIM_URL}";</script>`;
  assert.deepEqual(validateVisualExplorerSkillMarkup("<!doctype html><p>ordinary</p>"), { skill:"", markers:[], manimImports:[] });
  assert.deepEqual(validateVisualExplorerSkillMarkup(`<!-- ${marker}${importScript} -->`), { skill:"", markers:[], manimImports:[] });
  assert.deepEqual(validateVisualExplorerSkillMarkup(`<a href="${MANIM_URL}">Manim-Web docs</a>`), { skill:"", markers:[], manimImports:[] });
  assert.throws(() => validateVisualExplorerSkillMarkup(importScript), /requires the matching penecho-visual-skill/i);
  assert.throws(() => validateVisualExplorerSkillMarkup('<meta name="penecho-visual-skill" content="chemistry">'), /supported skill/i);
  assert.throws(() => validateVisualExplorerSkillMarkup(`${marker}${marker}`), /exactly one/i);
  assert.throws(() => validateVisualExplorerSkillMarkup(marker), /Load the math-2d visual skill/i);
  assert.throws(() => validateVisualExplorerSkillMarkup(marker, new Set(["math-3d"])), /Load the math-2d visual skill/i);
  assert.throws(() => validateVisualExplorerSkillMarkup(`<meta name="PENECHO-VISUAL-SKILL" content="math-2d">${importScript}`, new Set(["math-2d"])), /matching penecho-visual-skill marker/i);
  assert.throws(() => validateVisualExplorerSkillMarkup(`${marker}<script type="module" src="${MANIM_URL}"></script>`, new Set(["math-2d"])), /inline script\[type="module"\]/i);
  assert.throws(() => validateVisualExplorerSkillMarkup(`${marker}<script>import("${MANIM_URL}")</script>`, new Set(["math-2d"])), /classic, computed, and non-import/i);
  assert.throws(() => validateVisualExplorerSkillMarkup(`${marker}<script type="module">const source = "${MANIM_URL}"; import(source)</script>`, new Set(["math-2d"])), /classic, computed, and non-import/i);
  assert.throws(() => validateVisualExplorerSkillMarkup(`${marker}<script type="module">import "https://cdn.jsdelivr.net/npm/manim-web@latest/dist/manim-web.browser.js";</script>`, new Set(["math-2d"])), /exact pinned 0\.3\.24/i);
  assert.deepEqual(validateVisualExplorerSkillMarkup(`${marker}${importScript}`, new Set(["math-2d"])), {
    skill:"math-2d",
    markers:["math-2d"],
    manimImports:[MANIM_URL],
  });
  assert.deepEqual(validateVisualExplorerSkillMarkup(`<meta name=penecho-visual-skill content=math-2d>${importScript}`, new Set(["math-2d"])), {
    skill:"math-2d",
    markers:["math-2d"],
    manimImports:[MANIM_URL],
  });
  assert.deepEqual(validateVisualExplorerSkillMarkup(`${marker}<script type="module">import("${MANIM_URL}", { with:{ type:"javascript" } })</script>`, new Set(["math-2d"])), {
    skill:"math-2d",
    markers:["math-2d"],
    manimImports:[MANIM_URL],
  });
  assert.deepEqual(validateVisualExplorerSkillMarkup(`${marker}<script type="module">import(/* authored */ "${MANIM_URL}")</script>`, new Set(["math-2d"])), {
    skill:"math-2d",
    markers:["math-2d"],
    manimImports:[MANIM_URL],
  });

  const connection = { id:"api", provider:"api", apiFormat:"openai", apiUrl:"http://127.0.0.1:9/v1", apiModel:"test-model", apiKey:"test-key" };
  const host = new CanvasHarnessHost({
    stateDirectory,
    rootDirectory:ROOT,
    resolveConnection:id => id === connection.id ? connection : null,
    listConnections:() => [connection],
  });
  t.after(() => host.dispose());
  const session = await host.connect({ clientId:"gate-client", connectionId:connection.id, binding:{}, send:() => {} });
  host.updateState(session, { revision:1, canvas:{ width:2000, height:2000 }, objects:[], counts:{ inkTiles:0, widgets:0, textBoxes:0, images:0 } });
  session.visualExplorerBudget.proposal = { revision:1, width:1200, height:800, placement:{ mode:"absolute", x:10, y:10 } };
  session.rpc = async () => ({ revision:2, receipts:[{ objectId:"scientific-widget" }] });
  const create = session.handle.agent.ctx.tools.get("canvas_create", session.handle.agent);
  const item = {
    type:"widget", pluginId:"general", widgetType:"html_widget", title:"Calibrated 2-D field",
    html:`<!doctype html><head>${marker}${importScript}</head><p>Static final state</p>`,
    sourceFormat:"penecho-visual-explorer+html", frameworkVersion:"penecho-visual-explorer/1",
    refreshSeconds:0, width:1200, height:800, placement:{ mode:"absolute", x:10, y:10 },
  };
  await assert.rejects(create.execute({ baseRevision:1, items:[item] }, { callId:"blocked" }), error => {
    assert.equal(error.code, "VISUAL_EXPLORER_SKILL_NOT_LOADED");
    return true;
  });
  session.visualSkillsLoaded.add("math-2d");
  const result = await create.execute({ baseRevision:1, items:[item] }, { callId:"allowed" });
  assert.equal(result.receipts[0].objectId, "scientific-widget");
  assert.equal(session.visualExplorerBudget.objectIds.has("scientific-widget"), true);
});
