"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const presets = require("../src/providers/api-presets.js");
const { catalogModels, discoverPresetModels, presetRequestHeaders } = require("../src/providers/preset-discovery.js");
const { resolveApiConfig } = require("../src/server/api-config.js");
const core = fs.readFileSync(require.resolve("../src/client/app/core.js"), "utf8");
const server = fs.readFileSync(require.resolve("../src/server/main.js"), "utf8");
function sourceFunction(source, name, indent = "") {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const rest = source.slice(start), end = rest.indexOf(`\n${indent}}`);
  assert.ok(end > 0, name);
  return rest.slice(0, end + indent.length + 2);
}
function uiContext() {
  const { document } = require("linkedom").parseHTML(fs.readFileSync(require.resolve("../public/index.html"), "utf8"));
  const c = { document, PenEchoApiPresets:presets, t:key => key, peButton:()=>{}, settings:{ configurationMode:"api", fetchedApiModels:[], cli:{} } };
  for (const element of document.querySelectorAll('[id^="settings"]')) {
    c[element.id] = element;
    if (element.tagName === "SELECT") Object.defineProperty(element, "value", { value:"", writable:true });
    element.focus = () => {};
    element.checkValidity = () => true;
  }
  c.settingsProvider.value = "api";
  c.settingsApiRegion.value = "global";
  c.settingsApiService.value = "api";
  c.settingsEffort.value = "medium";
  c.settingsFetchModelsLabel = c.settingsFetchModels.querySelector("span");
  c.settingsFetchModels.disabled = false;
  c.authenticatedApiHeaders = headers => headers;
  c.setConnectionTestBusy = busy => { c.settings.connectionActionBusy = busy; c.updateConnectionModelFetchState(); };
  const context = vm.createContext(c);
  vm.runInContext(core.slice(core.indexOf("  const API_PRESETS ="), core.indexOf("  const AI_FONT_STORAGE_KEY")), context);
  for (const name of ["apiPresetForConnection", "selectedApiPreset", "updateKimiSignup", "apiModelSuggestions", "updateApiModelChoices", "updateApiModelSelection", "clearFetchedApiModels", "hideApiModelOptions", "showApiModelOptions", "chooseApiModel", "updateApiPresetFields", "fillApiEditor", "connectionEditorPayload", "connectionModelDiscoverySignature", "updateConnectionModelFetchState", "normalizeFetchedApiModels", "fetchConnectionModels", "setSettingsStatus"]) {
    vm.runInContext(sourceFunction(core, name, "  "), context);
  }
  return context;
}

test("every added service has one menu option, HTTPS default and no hard-coded model", () => {
  const c = uiContext();
  for (const preset of Object.values(presets.presets)) {
    assert.equal(c.settingsApiFormat.querySelectorAll(`option[value="${preset.family}"]`).length, 1);
    assert.equal(new URL(preset.url).protocol, "https:");
    c.settingsApiFormat.value = preset.family;
    c.settingsApiRegion.value = "china";
    c.settingsApiService.value = "coding";
    c.settingsApiModel.value = "previous-provider-model";
    c.updateApiPresetFields(true, true);
    assert.equal(c.settingsApiUrl.value, preset.url);
    assert.equal(c.settingsApiModel.value, "");
    assert.equal(c.settingsApiModel.readOnly, false);
    assert.equal(c.selectedApiPreset().id, preset.id);
    assert.equal(c.settingsApiPresetFields.hidden, true);
  }
});

test("saved OpenCode models reopen, remain selectable and accept manual IDs absent from the catalog", () => {
  const c = uiContext(), connection = presets.route({ provider:"api", apiPreset:"opencode-go-global-api", apiUrl:"https://opencode.ai/zen/go/v1", apiModel:"minimax-m3" });
  c.fillApiEditor(connection);
  assert.equal(c.settingsApiUrl.value, "https://opencode.ai/zen/go/v1");
  c.clearFetchedApiModels(); // Provider-field refresh must preserve the saved model.
  assert.equal(c.settingsApiModel.value, "minimax-m3");
  assert.equal(c.connectionEditorPayload().apiUrl, "https://opencode.ai/zen/go/v1/messages");
  c.settings.fetchedApiModels = ["glm-5.3", "minimax-m3"];
  c.updateApiModelChoices();
  c.chooseApiModel("glm-5.3");
  assert.equal(c.connectionEditorPayload().apiFormat, "openai");
  c.settingsApiModel.value = "minimax-custom-model";
  c.updateApiModelSelection();
  assert.equal(c.settingsApiModelOptions.querySelector('[aria-selected="true"]'), null);
  c.clearFetchedApiModels();
  assert.equal(c.settingsApiModel.value, "minimax-custom-model");
  c.fillApiEditor(c.connectionEditorPayload());
  assert.equal(c.settingsApiModel.value, "minimax-custom-model");
  assert.equal(c.settingsApiModel.readOnly, false);
});

test("legacy custom, Kimi and MiniMax defaults retain their original editing semantics", () => {
  const c = uiContext();
  for (const family of ["openai", "anthropic", "kimi", "minimax"]) {
    c.settingsApiFormat.value = family;
    c.updateApiPresetFields(true, true);
    assert.equal(c.settingsApiModel.readOnly, false);
    assert.ok(c.settingsApiModel.value);
    const model = c.settingsApiModel.value;
    c.clearFetchedApiModels();
    assert.equal(c.settingsApiModel.value, model);
  }
  c.fillApiEditor({ apiFormat:"openai", apiUrl:"https://opencode.ai/zen/v1", apiModel:"gpt-custom" });
  assert.equal(c.settingsApiFormat.value, "openai", "existing custom connections are not silently converted");
  assert.equal(c.connectionEditorPayload().apiPreset, "");
  const legacy = { apiFormat:"openai", apiUrl:"https://api.openai.com/v1", apiModel:"gpt" };
  assert.equal(presets.route(legacy), legacy);
  assert.deepEqual(presetRequestHeaders(legacy), {});
});

test("model discovery preserves manual input before, during and after fetch, including incomplete OpenCode IDs", async () => {
  for (const family of ["opencode-go", "opencode-zen", "deepseek", "openrouter"]) {
    const c = uiContext();
    c.settingsApiFormat.value = family;
    c.updateApiPresetFields(true, true);
    c.settingsApiKey.value = "fixture-key";
    c.settingsApiModel.value = "minimax-custom-model";
    const signature = c.connectionModelDiscoverySignature();
    c.fetch = async (_url, options) => {
      const { connection } = JSON.parse(options.body);
      assert.equal(connection.apiUrl, c.selectedApiPreset().url);
      assert.equal(connection.apiFormat, c.selectedApiPreset().format);
      return { ok:true, json:async () => ({ models:["deepseek-flash", "minimax-m3"] }) };
    };
    await c.fetchConnectionModels();
    assert.equal(c.settingsApiModel.value, "minimax-custom-model");
    let respond;
    c.fetch = () => new Promise(resolve => { respond = resolve; });
    const pending = c.fetchConnectionModels();
    c.settingsApiModel.value = "unfinished-model-id";
    assert.equal(c.connectionModelDiscoverySignature(), signature);
    respond({ ok:true, json:async () => ({ models:["glm-5.3", "minimax-m3"] }) });
    await pending;
    assert.equal(c.settingsApiModel.value, "unfinished-model-id");
    assert.deepEqual(Array.from(c.settings.fetchedApiModels), ["glm-5.3", "minimax-m3"]);
    c.chooseApiModel("glm-5.3");
    assert.equal(c.connectionEditorPayload().apiModel, "glm-5.3");
    c.settingsApiModel.value = "deepseek-manual-model";
    c.fetch = async () => ({ ok:false, json:async () => ({ error:"Fixture upstream error" }) });
    await c.fetchConnectionModels();
    assert.equal(c.settingsApiModel.value, "deepseek-manual-model");
    assert.equal(c.settingsSaveStatus.textContent, "Fixture upstream error");
    assert.equal(c.settingsFetchModels.disabled, false);
    c.settingsApiKey.value = "replacement-key";
    c.clearFetchedApiModels();
    assert.notEqual(c.connectionModelDiscoverySignature(), signature);
    assert.equal(c.settingsApiModel.value, "deepseek-manual-model");
  }
});

test("changing endpoint during model discovery discards the old catalog without clearing the typed model", async () => {
  const c = uiContext();
  c.settingsApiFormat.value = "openrouter";
  c.updateApiPresetFields(true, true);
  c.settingsApiKey.value = "fixture-key";
  let respond;
  c.fetch = () => new Promise(resolve => { respond = resolve; });
  const pending = c.fetchConnectionModels();
  c.settingsApiUrl.value = "https://other.test/v1";
  c.settingsApiModel.value = "manual-model";
  c.clearFetchedApiModels();
  respond({ ok:true, json:async () => ({ models:["old-provider-model"] }) });
  await pending;
  assert.deepEqual(Array.from(c.settings.fetchedApiModels), []);
  assert.equal(c.settingsApiModel.value, "manual-model");
});

test("OpenCode routes only documented protocol families and rejects unsupported protocols", () => {
  for (const id of ["opencode-go-global-api", "opencode-zen-global-api"]) {
    const preset = presets.get(id);
    for (const model of ["glm-5.3", "kimi-k3", "deepseek-v4-flash", "qwen3.8-max", "minimax-m3", "claude-opus-4-8"]) {
      const route = presets.route({ apiPreset:id, apiUrl:preset.url, apiModel:model });
      assert.equal(resolveApiConfig(route.apiUrl, route.apiFormat).endpoint, `${preset.url}/${route.apiFormat === "openai" ? "chat/completions" : "messages"}`);
    }
    for (const model of ["gpt-5.6-luna", "gemini-3.8-flash", "grok-4.6", "unknown-alpha"]) assert.throws(() => presets.route({ apiPreset:id, apiModel:model }), /unsupported protocol/);
    assert.throws(() => presets.route({ apiPreset:id, apiUrl:"https://other.test/v1", apiModel:"glm-5.3" }), /preset OpenCode base URL/);
  }
});

test("large catalogs load only on added presets and filter incompatible model types", async () => {
  const data = Array.from({ length:900 }, (_, i) => ({ id:`vendor/model-${i}`, architecture:{ output_modalities:["text"] } }));
  data.push({ id:"image-generator", architecture:{ output_modalities:["image"] } }, { id:"text-embedding-3" }, { id:"mistral-embed", capabilities:{ completion_chat:false } });
  const request = { apiPreset:"openrouter-global-api", apiUrl:"https://openrouter.ai/api/v1", apiKey:"test-only" };
  const models = await discoverPresetModels(request, { fetchImpl:async (url, options) => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/models");
    assert.equal(options.headers.Authorization, "Bearer test-only");
    assert.equal(options.redirect, "error");
    return Response.json({ data });
  } });
  assert.equal(models.length, 900);
  const c = uiContext(); c.settingsApiFormat.value = "openrouter";
  assert.equal(c.normalizeFetchedApiModels(models).length, 900);
  c.settingsApiFormat.value = "openai";
  assert.throws(() => c.normalizeFetchedApiModels(models));
  assert.deepEqual(catalogModels({ data:[{ id:"glm-5.3" }, { id:"qwen3.8-max" }, { id:"gpt-5.6-luna" }, { id:"gemini-3.8-flash" }] }, "opencode-go-global-api"), ["glm-5.3", "qwen3.8-max"]);
});

test("preset discovery covers actual models URLs and fails safely without catalog fallbacks", async () => {
  for (const preset of Object.values(presets.presets)) {
    await discoverPresetModels({ apiPreset:preset.id, apiUrl:preset.url, apiKey:"test-only" }, { fetchImpl:async (url, options) => {
      assert.equal(url.origin + url.pathname, `${preset.url}/models`);
      assert.equal(options.headers["x-opencode-session"] !== undefined, presets.isOpenCode(preset.id));
      return Response.json({ data:[{ id:"glm-5.3" }] });
    } });
  }
  const request = { apiPreset:"zai-global-api", apiUrl:presets.get("zai-global-api").url, apiKey:"do-not-leak" };
  for (const response of [new Response("bad-key-secret", { status:401 }), new Response("oops", { headers:{ "content-type":"application/json" } }), new Response("html")]) {
    await assert.rejects(discoverPresetModels(request, { fetchImpl:async () => response }), error => !error.message.includes("secret") && error.status === 502);
  }
  await assert.rejects(discoverPresetModels(request, { timeoutMs:5, fetchImpl:async (_, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("do-not-leak")))) }), { status:504 });
});

test("OpenCode request headers have stable session identity and never follow a different host", () => {
  const connection = { apiPreset:"opencode-go-global-api", apiUrl:"https://opencode.ai/zen/go/v1" };
  assert.equal(presetRequestHeaders(connection, "conversation-a")["x-opencode-session"], "conversation-a");
  assert.deepEqual(presetRequestHeaders({ ...connection, apiUrl:"https://unrelated.test/v1" }, "conversation-a"), {});
  assert.deepEqual(presetRequestHeaders({ ...connection, apiPreset:"" }, "conversation-a"), {});
  assert.throws(() => presetRequestHeaders(connection, "bad\nsession"));
});

test("server normalization persists preset routing and legacy inference remains opt-in", () => {
  const c = vm.createContext({ additionalApiPresets:presets, crypto, URL, DEFAULT_REASONING_EFFORT:"medium", normalizeAiProvider:x => x });
  vm.runInContext(server.slice(server.indexOf("const API_PRESETS ="), server.indexOf("const DEEPSEEK_SEARCH_PROVIDER_IDS")), c);
  for (const name of ["inferredApiPreset", "connectionTitle", "connectionEffort", "normalizeConnection"]) vm.runInContext(sourceFunction(server, name), c);
  const connection = c.normalizeConnection({ provider:"api", apiPreset:"opencode-zen-global-api", apiFormat:"openai", apiUrl:"https://opencode.ai/zen/v1", apiModel:"claude-opus-4-8", apiKey:"test-only" });
  assert.equal(connection.apiFormat, "anthropic");
  assert.equal(connection.apiUrl, "https://opencode.ai/zen/v1/messages");
  assert.throws(() => c.normalizeConnection({ ...connection, apiKey:"", apiPreset:"opencode-go-global-api", apiUrl:"https://opencode.ai/zen/go/v1" }, connection), /newly selected service/);
  assert.equal(c.normalizeConnection({ ...connection, apiKey:"" }, connection).apiKey, "test-only");
  assert.equal(c.inferredApiPreset("openai", "https://opencode.ai/zen/v1"), "");
  assert.equal(c.inferredApiPreset("openai", "https://api.moonshot.ai/v1"), "kimi-global-api");
});

test("Agent OpenCode profiles isolate conversations while all old effort paths remain unchanged", async () => {
  const { connectionProfile } = await import("../src/server/canvas-agent/runtime.mjs");
  const source = fs.readFileSync(require.resolve("../src/server/canvas-agent/runtime.mjs"), "utf8");
  const c = vm.createContext({ additionalApiPresets:presets, CANVAS_AGENT_HARNESS_REASONING_EFFORTS:new Set(["low", "medium", "high"]), hash:x => crypto.createHash("sha256").update(String(x)).digest("hex") });
  vm.runInContext(sourceFunction(source, "requestEffortConnection"), c);
  const connection = { id:"go", provider:"api", apiFormat:"openai", apiPreset:"opencode-go-global-api", apiUrl:"https://opencode.ai/zen/go/v1", apiModel:"glm-5.3", effort:"medium" };
  for (const sessionId of ["conversation-a", "conversation-b"]) {
    const session = { id:sessionId, connection };
    for (const effort of [{ selected:"config", effective:"medium" }, { selected:"high", effective:"high" }, { selected:"custom", effective:"custom" }]) {
      const route = c.requestEffortConnection(session, effort);
      const profile = connectionProfile(route);
      assert.equal(profile.config.headers["x-opencode-session"], sessionId);
      assert.equal(profile.config.api, "openai-completions");
    }
  }
  const old = { ...connection, apiPreset:"" };
  assert.equal(c.requestEffortConnection({ id:"old", connection:old }, { selected:"config", effective:"medium" }), null);
  assert.equal(connectionProfile(old).config.headers, undefined);
});

test("actual Agent adapters send OpenCode session headers on Chat and Messages requests", async t => {
  const os = require("node:os"), path = require("node:path");
  const { CanvasHarnessHost } = await import("../src/server/canvas-agent/runtime.mjs");
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-preset-wire-"));
  const connections = ["glm-5.3-flash", "minimax-m3"].map((model, i) => presets.route({
    id:`go-${i}`, provider:"api", apiPreset:"opencode-go-global-api", apiUrl:"https://opencode.ai/zen/go/v1",
    apiModel:model, apiKey:"fixture-only", effort:"medium",
  }));
  const host = new CanvasHarnessHost({ stateDirectory, rootDirectory:path.resolve(__dirname, ".."), listConnections:() => connections, resolveConnection:id => connections.find(c => c.id === id) });
  const requests = [], originalFetch = globalThis.fetch;
  t.after(async () => { globalThis.fetch = originalFetch; await host.dispose(); fs.rmSync(stateDirectory, { recursive:true, force:true }); });
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init), body = JSON.parse(await request.clone().text());
    requests.push({ url:request.url, headers:Object.fromEntries(request.headers), body });
    if (request.url.endsWith("/messages")) {
      const events = [
        { type:"message_start", message:{ id:"msg-fixture", type:"message", role:"assistant", model:body.model, content:[], usage:{ input_tokens:1, output_tokens:0 } } },
        { type:"content_block_start", index:0, content_block:{ type:"text", text:"" } },
        { type:"content_block_delta", index:0, delta:{ type:"text_delta", text:"OK" } },
        { type:"content_block_stop", index:0 },
        { type:"message_delta", delta:{ stop_reason:"end_turn", stop_sequence:null }, usage:{ output_tokens:1 } },
        { type:"message_stop" },
      ];
      return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { headers:{ "content-type":"text/event-stream" } });
    }
    return new Response(`data: ${JSON.stringify({ id:"chat-fixture", object:"chat.completion.chunk", model:body.model, choices:[{ index:0, delta:{ role:"assistant", content:"OK" }, finish_reason:null }] })}\n\ndata: ${JSON.stringify({ choices:[{ index:0, delta:{}, finish_reason:"stop" }] })}\n\ndata: [DONE]\n\n`, { headers:{ "content-type":"text/event-stream" } });
  };
  const sessionIds = [];
  for (const connection of connections) {
    const messages = [], session = await host.connect({ clientId:crypto.randomUUID(), connectionId:connection.id, binding:{}, send:(type, payload) => messages.push({ type, payload }) });
    sessionIds.push(session.id);
    host.updateState(session, { revision:1, canvas:{ width:1024, height:768 }, objects:[] });
    for (let turn = 1; turn <= 2; turn++) {
      await host.submit(session, "Reply OK.", false, [], {}, null, [], false, turn === 1 ? "config" : "high");
      const deadline = Date.now() + 5000;
      while (messages.filter(m => m.type === "session_event" && m.payload.kind === "turn_end").length < turn) {
        assert.ok(Date.now() < deadline, JSON.stringify(messages.slice(-3)));
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }
  assert.equal(requests.length, 4);
  for (let i = 0; i < requests.length; i++) {
    assert.equal(requests[i].headers["x-opencode-session"], sessionIds[Math.floor(i / 2)]);
    assert.match(requests[i].headers["user-agent"], /(?:PenEcho|deepseek-harness)\//);
    assert.equal(requests[i].url, `https://opencode.ai/zen/go/v1/${i < 2 ? "chat/completions" : "messages"}`);
  }
  assert.notEqual(sessionIds[0], sessionIds[1]);
});
