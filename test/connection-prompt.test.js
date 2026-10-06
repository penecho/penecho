"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(process.env.PENECHO_TEST_CLIENT_SOURCE || path.join(__dirname, "../src/client/app/core.js"), "utf8");
const local = "11111111-1111-4111-8111-111111111111";
const hosted = "22222222-2222-4222-8222-222222222222";
const connection = { id:local, provider:"api", hasApiKey:true, apiUrl:"https://provider.test/v1", apiModel:"Local model" };
const response = (body, status = 200) => ({ ok:status < 400, status, json:async () => body });
function fixture(runtime = "cloud", config = {}) {
  const data = new Map(), calls = [];
  const c = vm.createContext({
    window:{ PENECHO_CONFIG:{ runtime, connectionAccountId:"account-a", ...config } },
    location:{ origin:runtime === "cloud" ? "https://cloud.test" : "http://localhost:3888" },
    localStorage:{ getItem:key => data.get(key) ?? null, setItem:(key, value) => data.set(key, value) },
    AI_CONNECTION_STORAGE_KEY:"connection", AbortController, AbortSignal,
    settings:{ connections:[], configurationLoad:null, open:false },
    hostedSettings:{ models:[], loading:false, generation:0, signedIn:false, error:false },
    featureTour:{ active:false }, changelog:{ active:false },
    requestAnimationFrame:callback => setImmediate(callback),
    document:{ querySelector:() => null, activeElement:null },
    canvasSettingsForm:{}, settingsLayer:{ contains:() => false, setAttribute:() => {} },
    settingsButton:{ setAttribute:() => {} },
    authenticatedApiHeaders:() => ({}), t:key => key,
    renderHostedModels:() => {}, renderConnectionLists:() => {},
    selectSettingsPage:page => { calls.push(page); c.settings.activePage = page; },
    openSettings:() => { c.settings.open = true; calls.push("open"); void c.loadCanvasSettings(); return true; },
    fetch:async url => response(url.endsWith("models")
      ? { accountId:"account-a", models:[{ id:hosted, sortOrder:5, available:true, enabled:true, multiplier:1 }], credits:{ available:10 } }
      : { connections:[], provider:"api" }),
    setSettingsStatus:() => {}, fillApiEditor:() => {}, updateSearchSettingsState:() => {},
    canvasAgentSetSearchConfigured:() => {}, defaultConnectionEffort:() => "medium",
    updateSettingsEffortOptions:() => {}, updateTraceToggle:() => {},
    updateSettingsProviderFields:() => {}, routeStartupConnections:() => {},
  });
  for (const name of ["settingsProvider", "settingsApiKey", "settingsApiSaved", "settingsDeepSeekSearchApiKey",
    "settingsTavilyApiKey", "settingsEffort", "settingsMaxTokens", "settingsAgentTurnLimit", "settingsTimeout",
    "settingsAutoDelay", "settingsImageFormat", "settingsTraceLimit"]) c[name] = { dataset:{} };
  for (const name of ["aiConnectionScope", "aiConnectionStorageKey", "selectedAiConnectionId", "storeAiConnectionSelection", "aiConnectionSelectionError", "aiRequestHeaders",
    "syncLocalConnectionSelection", "hasSelectedAiConnection", "promptForAiConnectionSelection", "requireAiConnectionSelection", "closeSettings", "loadHostedModels", "loadHostedModelsOnce",
    "loadCanvasSettings", "performCanvasSettingsLoad"]) {
    const match = new RegExp(`  (?:async )?function ${name}\\(`).exec(source);
    assert.ok(match, name);
    vm.runInContext(source.slice(match.index, source.indexOf("\n  }", match.index) + 4), c);
  }
  return { c, data, calls };
}

function clientFunction(file, name) {
  const code = fs.readFileSync(path.join(__dirname, `../src/client/app/${file}.js`), "utf8");
  const match = new RegExp(`  (?:async )?function ${name}\\(`).exec(code);
  assert.ok(match, name);
  return code.slice(match.index, code.indexOf("\n  }", match.index) + 4);
}

test("first Cloud visit selects and persists the lowest-order available model without a prompt", async () => {
  const { c, data, calls } = fixture();
  const model = { available:true, enabled:true, multiplier:1 };
  let models = [
    { ...model, id:local, sortOrder:20 },
    { ...model, id:"unavailable", sortOrder:-5, available:false },
    { ...model, id:"disabled", sortOrder:-4, enabled:false },
    { ...model, id:"retired", sortOrder:-3, retiredAt:"2026-09-01" },
    { ...model, id:"unpriced", sortOrder:-2, multiplier:null },
    { ...model, id:hosted, sortOrder:0 },
  ];
  c.fetch = async url => response(url.endsWith("models")
    ? { accountId:"account-a", models, credits:{ available:10 } }
    : { connections:[], provider:"api" });
  await c.loadCanvasSettings();
  await c.loadHostedModels();
  const selected = `hosted:${hosted}`;
  assert.equal(c.selectedAiConnectionId(), selected);
  assert.equal(data.get(c.aiConnectionStorageKey(true)), selected);
  assert.equal(c.requireAiConnectionSelection(), true);
  assert.equal(c.aiRequestHeaders()["X-PenEcho-Connection"], selected);
  assert.deepEqual(calls, []);

  models = [{ ...model, id:local, sortOrder:-10 }, { ...model, id:hosted, sortOrder:0 }];
  await c.loadHostedModels({ accountChanged:true });
  assert.equal(c.selectedAiConnectionId(), selected, "refresh and order changes preserve the saved default");
  assert.equal(c.requireAiConnectionSelection(), true);
  assert.deepEqual(calls, []);

  models = [{ ...model, id:local, sortOrder:-10 }];
  await c.loadHostedModels();
  assert.equal(c.selectedAiConnectionId(), selected, "an unavailable saved default is not silently replaced");
  assert.equal(c.requireAiConnectionSelection(), false);
  assert.deepEqual(calls, ["connections", "open"]);
});

test("Cloud initialization preserves explicit choices made before or during catalog loading", async () => {
  for (const timing of ["before", "during"]) for (const selected of [local, `hosted:${local}`]) {
    const { c, calls } = fixture("cloud", { linkedDeviceId:"mac", linkedDeviceOnline:false });
    const fetch = c.fetch;
    let release;
    c.fetch = url => new Promise(resolve => { release = () => resolve(fetch(url)); });
    if (timing === "before") c.storeAiConnectionSelection(selected);
    const pending = c.loadHostedModels();
    if (timing === "during") c.storeAiConnectionSelection(selected);
    release();
    await pending;
    assert.equal(c.selectedAiConnectionId(), selected);
    assert.deepEqual(calls, []);
    assert.equal(c.requireAiConnectionSelection(), false, "the unavailable choice still needs the existing chooser");
    assert.deepEqual(calls, ["connections", "open"]);
  }
});

test("Cloud defaults do not replace unavailable legacy or disconnected-device selection history", async () => {
  for (const history of ["legacy", "legacy-local", "disconnected-device", "inactive-hosted"]) {
    const { c, data, calls } = fixture("cloud", { linkedDeviceId:"mac" });
    if (history === "legacy") data.set(c.AI_CONNECTION_STORAGE_KEY, `hosted:${local}`);
    else if (history === "legacy-local") data.set(c.AI_CONNECTION_STORAGE_KEY, local);
    else if (history === "inactive-hosted") data.set(c.aiConnectionStorageKey(true), `hosted:${local}`);
    else { c.storeAiConnectionSelection(local); delete c.window.PENECHO_CONFIG.linkedDeviceId; }
    await c.loadHostedModels();
    assert.equal(c.selectedAiConnectionId(), "default");
    assert.deepEqual(calls, []);
    assert.equal(c.requireAiConnectionSelection(), false);
    assert.deepEqual(calls, ["connections", "open"]);
  }
});

test("Cloud waits for an authenticated available catalog before assigning a default", async () => {
  for (const status of [200, 401, 503]) {
    const { c, data, calls } = fixture();
    const fetch = c.fetch;
    c.fetch = async () => response({ accountId:"account-a", models:[], credits:{ available:10 } }, status);
    await c.loadHostedModels();
    assert.equal(c.selectedAiConnectionId(), "default");
    assert.equal(data.size, 0);
    assert.deepEqual(calls, []);
    c.fetch = fetch;
    await c.loadHostedModels();
    assert.equal(c.selectedAiConnectionId(), `hosted:${hosted}`);
    assert.equal(c.requireAiConnectionSelection(), true);
    assert.deepEqual(calls, []);
  }
});

test("Cloud defaults are scoped to each account and guest canvases never get one", async () => {
  const { c, calls } = fixture();
  c.storeAiConnectionSelection(`hosted:${local}`);
  c.fetch = async () => response({ accountId:"account-b", models:[{ id:hosted, available:true, multiplier:1 }], credits:{ available:10 } });
  await c.loadHostedModels({ accountChanged:true });
  assert.equal(c.selectedAiConnectionId(), `hosted:${hosted}`);
  c.window.PENECHO_CONFIG.connectionAccountId = "account-a";
  assert.equal(c.selectedAiConnectionId(), `hosted:${local}`);
  assert.deepEqual(calls, []);
  const guest = fixture("cloud", { guestCanvas:true });
  await guest.c.loadHostedModels();
  assert.equal(guest.data.size, 0);
});

for (const runtime of ["local", "desktop"]) {
  test(`${runtime}: requests require a choice; catalog refresh and login never open Connections`, async () => {
    const { c, data, calls } = fixture(runtime);
    await c.loadCanvasSettings();
    await c.loadHostedModels();
    assert.deepEqual(calls, []);
    assert.equal(c.requireAiConnectionSelection(), false);
    assert.deepEqual(calls, ["connections", "open"]);
    assert.equal(c.selectedAiConnectionId(), "default");
    assert.equal(data.size, 0);
    c.closeSettings(false);
    await Promise.all([c.loadCanvasSettings(), c.loadHostedModels({ accountChanged:true })]);
    assert.equal(c.settings.open, false);
    assert.deepEqual(calls, ["connections", "open"]);
    assert.equal(c.requireAiConnectionSelection(), false, "a new request can ask again after dismissal");
    assert.deepEqual(calls, ["connections", "open", "connections", "open"]);
    c.storeAiConnectionSelection(`hosted:${hosted}`);
    assert.equal(c.requireAiConnectionSelection(), true, "an explicit choice permits the next request");
    assert.equal(calls.length, 4);
  });
}

test("available local connections do not implicitly authorize the first model", async () => {
  const { c, data, calls } = fixture("local");
  const fetch = c.fetch;
  c.fetch = url => url.endsWith("models") ? fetch(url) : Promise.resolve(response({ connections:[connection] }));
  await c.loadCanvasSettings();
  assert.equal(c.requireAiConnectionSelection(), false);
  assert.equal(c.settings.connections[0].active, false);
  assert.equal(data.size, 0);
  assert.throws(() => c.aiRequestHeaders(), error => error.code === "CONNECTION_STALE");
  c.storeAiConnectionSelection(local);
  assert.equal(c.requireAiConnectionSelection(), true);
  assert.equal(c.aiRequestHeaders()["X-PenEcho-Connection"], local);
  assert.deepEqual(calls, ["connections", "open"]);
});

test("missing local and hosted models prompt without silently replacing the saved selection", () => {
  for (const runtime of ["local", "cloud"]) for (const selected of [local, `hosted:${hosted}`]) {
    const { c, calls } = fixture(runtime, { linkedDeviceId:"mac", linkedDeviceOnline:false });
    c.storeAiConnectionSelection(selected);
    assert.equal(c.requireAiConnectionSelection(), false);
    assert.equal(c.selectedAiConnectionId(), selected);
    assert.deepEqual(calls, ["connections", "open"]);
  }
});

test("a stored ID permits requests only when present in the current usable catalog", async () => {
  for (const runtime of ["local", "cloud"]) for (const selected of [local, `hosted:${hosted}`]) {
    const { c, calls } = fixture(runtime, { linkedDeviceId:"mac", linkedDeviceOnline:true });
    c.storeAiConnectionSelection(selected);
    c.settings.connectionScope = c.aiConnectionScope();
    c.settings.connections = [connection];
    await c.loadHostedModels();
    assert.equal(c.requireAiConnectionSelection(), true);
    assert.deepEqual(calls, []);
    if (selected === local) c.settings.connections = [];
    else c.hostedSettings.models = [];
    assert.equal(c.requireAiConnectionSelection(), false);
    assert.deepEqual(calls, ["connections", "open"]);
  }
});

test("stale response recovery ignores a newer model or account and can reopen a cached selection", () => {
  const { c, calls } = fixture("local");
  c.storeAiConnectionSelection(local);
  c.settings.connectionScope = c.aiConnectionScope();
  c.settings.connections = [connection];
  const expected = { id:local, scope:c.aiConnectionScope() };
  assert.equal(c.promptForAiConnectionSelection({ ...expected, id:hosted }), false);
  assert.equal(c.promptForAiConnectionSelection({ ...expected, scope:"another-account" }), false);
  assert.deepEqual(calls, []);
  assert.equal(c.promptForAiConnectionSelection(expected), true);
  assert.deepEqual(calls, ["connections", "open"]);
});

test("legacy default requires complete configuration on the current local host", async () => {
  for (const provider of ["api", "kimi-cli", "codex-cli", "claude-cli"]) {
    const { c } = fixture("local");
    c.settings.connectionScope = c.aiConnectionScope();
    c.settings.connections = [{ ...connection, id:"default", provider }];
    assert.equal(c.requireAiConnectionSelection(), true);
    if (provider === "api") {
      c.settings.connections[0].hasApiKey = false;
      assert.equal(c.requireAiConnectionSelection(), false);
    }
    c.settings.connectionScope = "another-host";
    assert.equal(c.hasSelectedAiConnection(), false);
  }
});

test("read-only canvases and an in-progress configuration do not gain another modal", () => {
  for (const [runtime, config] of [["viewer", {}], ["cloud", { guestCanvas:true }], ["local", {}]]) {
    const { c, calls } = fixture(runtime, config);
    if (runtime === "local") c.settings.configurationMode = "api";
    assert.equal(c.requireAiConnectionSelection(), false);
    assert.deepEqual(calls, []);
  }
});

for (const action of ["assist", "answer", "normalize", "auto"]) {
  test(`${action}: a missing selection opens Connections before capture or model requests`, async () => {
    const { c, calls } = fixture();
    const dirty = { x:10, y:20, w:30, h:40 };
    c.state = { dirty, autoEligible:true, timer:123, userRevision:8 };
    c.clearTimeout = id => assert.equal(id, 123);
    c.setStatusKey = key => { c.state.statusKey = key; };
    c.clearWidgetRefineCandidate = () => assert.fail("must not begin preparation");
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/client/app/ai-runtime.js"), "utf8"), c);
    assert.equal(await c.requestAI(action), false);
    assert.deepEqual(calls, ["connections", "open"]);
    assert.equal(c.state.dirty, dirty);
    assert.equal(c.state.userRevision, 8);
    assert.equal(c.state.autoEligible, false);
    assert.equal(c.state.timer, 0);
    assert.equal(c.state.busy, undefined);
    assert.equal(c.state.statusKey, "canvasAgentChooseConnection");
  });
}

test("Auto AI does not reopen Connections for the same ink after dismissal", async () => {
  const { c, calls } = fixture();
  c.state = { auto:true, autoEligible:true, dirty:{ x:1, y:1, w:2, h:2 } };
  Object.assign(c, { clearTimeout(){}, setStatusKey(){}, canvasAgentSuppressesAutomaticAI:()=>false,
    currentWidgetRefineCandidate:()=>null, hasUnsettledToolbox:()=>false, clearWidgetRefineCandidate(){} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/client/app/ai-runtime.js"), "utf8"), c);
  c.supersedeActiveAI = () => {};
  c.hasUnsettledToolbox = () => false;
  c.launchAutomaticAI("new-stroke-deadline");
  c.closeSettings(false);
  c.launchAutomaticAI("new-stroke-deadline");
  assert.deepEqual(calls, ["connections", "open"]);
  assert.equal(c.settings.open, false);
  c.state.autoEligible = true;
  c.launchAutomaticAI("new-stroke-deadline");
  assert.deepEqual(calls, ["connections", "open", "connections", "open"]);
});

test("Agent can open the chooser without an execution host, keeping its full draft", async () => {
  const { c, calls } = fixture("cloud", { canvasAgent:false, hostedCanvasAgent:true });
  const draft = { attachments:[{ id:"image" }], inkPresent:true, attachmentBusy:false };
  Object.assign(c, {
    canvasAgent:draft, canvasAgentInput:{ value:"keep this draft", disabled:false },
    canvasAgentSend:{ setAttribute(){}, removeAttribute(){} }, canvasAgentPromptHasDraft:()=>true,
    canvasAgentExecutionAvailable:()=>false, canvasAgentBeginRequest:()=>assert.fail("must not begin request"),
  });
  for (const name of ["canvasAgentSyncSendAvailability", "canvasAgentSubmitMessage"]) vm.runInContext(clientFunction("canvas-agent-runtime", name), c);
  c.canvasAgentSyncSendAvailability();
  assert.equal(c.canvasAgentSend.disabled, false, "Send remains available to select a model");
  assert.equal(await c.canvasAgentSubmitMessage(), false);
  assert.deepEqual(calls, ["connections", "open"]);
  assert.equal(c.canvasAgentInput.value, "keep this draft");
  assert.equal(c.canvasAgentInput.disabled, false);
  assert.equal(c.canvasAgent, draft);
  assert.deepEqual(draft.attachments, [{ id:"image" }]);
  assert.equal(draft.inkPresent, true);
});

test("Agent empty submissions do not open Connections", async () => {
  const { c, calls } = fixture();
  Object.assign(c, { canvasAgent:{ attachments:[], inkPresent:false }, canvasAgentInput:{ value:"" } });
  vm.runInContext(clientFunction("canvas-agent-runtime", "canvasAgentSubmitMessage"), c);
  assert.equal(await c.canvasAgentSubmitMessage(), false);
  assert.deepEqual(calls, []);
});

test("Agent recovers a connection removed during submission without consuming or refocusing its draft", async () => {
  const { c, calls } = fixture("local");
  c.storeAiConnectionSelection(local);
  c.settings.connectionScope = c.aiConnectionScope();
  c.settings.connections = [connection];
  const control = () => ({ setAttribute(){}, removeAttribute(){}, focus(){ assert.fail("focus stays in Connections"); } });
  const statuses = [];
  Object.assign(c, {
    canvasAgent:{ attachments:[], inkPresent:false }, canvasAgentInput:{ value:"keep this draft", ...control() },
    canvasAgentSend:control(), canvasAgentAttach:control(), canvasAgentReference:control(), canvasAgentInkCanvas:control(),
    canvasAgentExecutionAvailable:()=>true, canvasAgentDidStartUserConversation(){}, canvasAgentBeginRequest(){},
    canvasAgentBeginSubmitExecution:()=>{ const value={};c.canvasAgent.activeSubmitExecution=value;return value; },
    canvasAgentAssertSubmitExecution(){}, canvasAgentSubmitExecutionCurrent:()=>true, canvasAgentRequestDidNotSend(){},
    canvasAgentConnect:async()=>{ throw Object.assign(Error("stale"),{code:"CONNECTION_STALE"}); },
    canvasAgentSyncSendAvailability(){}, canvasAgentSetStatus:text=>statuses.push(text),
  });
  vm.runInContext(clientFunction("canvas-agent-runtime", "canvasAgentSubmitMessage"), c);
  assert.equal(await c.canvasAgentSubmitMessage(), false);
  assert.deepEqual(calls, ["connections", "open"]);
  assert.equal(c.canvasAgentInput.value, "keep this draft");
  assert.equal(c.canvasAgentInput.disabled, false);
  assert.deepEqual(statuses, ["canvasAgentChooseConnection"]);
});

test("external MCP submissions bypass the internal model chooser entirely", async () => {
  const queued = [], options = { textOverride:"MCP task" };
  const submit = vm.runInNewContext(`(${clientFunction("canvas-agent-runtime", "canvasAgentSubmitMessage")})`, {
    canvasAgent:{},
    canvasDocumentsExternal:()=>true, canvasDocumentsQueueMessage:options=>{ queued.push(options); return true; },
    requireAiConnectionSelection:()=>assert.fail("MCP must not consult the built-in model chooser"),
  });
  assert.equal(await submit(options), true);
  assert.deepEqual(queued, [options]);
});

test("startup only loads configuration; opening or switching canvases has no connection prompt", async () => {
  const bootstrap = fs.readFileSync(path.join(__dirname, "../src/client/app/ui-bootstrap.js"), "utf8");
  const start = bootstrap.lastIndexOf("  requestAnimationFrame(() => {");
  const script = bootstrap.slice(start, bootstrap.lastIndexOf("})();"));
  for (const runtime of ["cloud", "local", "viewer"]) {
    const calls = [];
    vm.runInNewContext(script, {
      window:{ PENECHO_CONFIG:{ runtime } }, requestAnimationFrame:callback=>callback(),
      loadCanvasSettings:async()=>{ calls.push("load"); }, maybeStartOnboarding:()=>calls.push("onboarding"),
    });
    await new Promise(setImmediate);
    assert.deepEqual(calls, runtime === "viewer" ? [] : ["load", "onboarding"]);
  }
  assert.doesNotMatch(clientFunction("canvas-agent-runtime", "canvasAgentCanvasDidChange"), /promptForCanvasConnection|requireAiConnectionSelection|openSettings/);
  assert.doesNotMatch(bootstrap, /penecho:canvas-opened|promptForCanvasConnection/);
});
