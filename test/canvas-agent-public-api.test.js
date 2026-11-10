"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const CONTRACT_PATH = path.join(ROOT, "src/server/canvas-agent/public-api-discovery-contract.md");
const CATALOG_PATH = path.join(ROOT, "src/server/canvas-agent/public-api-data/catalog.json");
const DISCOVERY_MODULE_PATH = path.join(ROOT, "src/server/canvas-agent/public-api-discovery.mjs");

function waitFor(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() >= deadline) return reject(new Error("Timed out waiting for the public API test."));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function connection(id = "public-api-test") {
  return {
    id,
    provider: "codex-cli",
    name: "Public API Test CLI",
    cliPath: "codex-test",
    cliModel: "test-model",
    effort: "medium",
  };
}

function requestFor(call) {
  return JSON.parse(call.prompt);
}

function toolNames(request) {
  return request.availableTools.map(tool => tool.name);
}

function lastToolResult(call) {
  const request = requestFor(call);
  for (const message of [...(request.conversation || [])].reverse()) {
    for (const part of [...(message.content || [])].reverse()) {
      if (part?.type !== "tool_result") continue;
      const content = Array.isArray(part.content) ? part.content : [];
      const text = content.find(item => item?.type === "text")?.text;
      return { envelope:part, value:JSON.parse(String(text || "null")) };
    }
  }
  throw new Error("The Harness request did not contain a tool result.");
}

function countOccurrences(source, needle) {
  let count = 0, offset = 0;
  while (needle && (offset = source.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function discoveryFixture({ search, verify, contractDocument = "PUBLIC_API_GUIDANCE_FULL" } = {}) {
  const calls = { search:[], verify:[] };
  const service = {
    async search(args, signal) {
      calls.search.push({ args, signal });
      return search ? search(args, signal) : { action:"search", results:[] };
    },
    async verify(args, signal) {
      calls.verify.push({ args, signal });
      return verify ? verify(args, signal) : { action:"verify", runtime_verified:false };
    },
  };
  return {
    calls,
    discovery:{
      service,
      contract:{ hash:"a".repeat(64), document:contractDocument },
    },
  };
}

async function createNativeRuntimeFixture(t, { publicWebEnabled = true, webSearchEnabled = false, discovery } = {}) {
  const { createCanvasAgentNativeRuntime } = await import("../src/server/canvas-agent/runtime.mjs");
  const projectRuntimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-public-api-native-"));
  t.after(() => fs.rmSync(projectRuntimeDirectory, { recursive:true, force:true }));
  const session = {
    projectRuntimeDirectory,
    widgetCapabilities:{ professionalEnabled:false, privatePlugins:[] },
    generalHtmlContract:{ hash:"b".repeat(64), document:"GENERAL_HTML_CONTRACT" },
    professionalDiagramsContract:null,
    visualExplorerContract:{ hash:"c".repeat(64), document:"VISUAL_EXPLORER_CONTRACT" },
    visualSkillContracts:{},
    widgetContractsLoaded:new Set(),
    visualSkillsLoaded:new Set(),
    nextWidgetContractOrder:500,
    webSearch:{ enabled:webSearchEnabled },
    publicWebEnabled,
    loadPublicApiDiscovery:async () => discovery,
  };
  const runtime = await createCanvasAgentNativeRuntime({
    attachments:{ saveImages:async () => [] },
    session,
  });
  return { runtime, session };
}

test("public_api stays out of the cold prompt, loads bounded offline guidance once, and preserves web_read", async t => {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-public-api-cold-"));
  t.after(() => fs.rmSync(stateDirectory, { recursive:true, force:true }));
  const { CanvasHarnessHost } = await import("../src/server/canvas-agent/runtime.mjs");
  const contractDocument = "PUBLIC_API_GUIDANCE_FULL\nUse only the bounded public API discovery flow.";
  const fixture = discoveryFixture({
    contractDocument,
    search:async ({ query, limit, offline }) => ({
      action:"search",
      query,
      offline,
      sourceRevision:"snapshot-test",
      stale:false,
      results:[
        { id:"catalog-alpha", name:"Alpha", documentation_url:"https://alpha.example/docs" },
        { id:"catalog-beta", name:"Beta", documentation_url:"https://beta.example/docs" },
        { id:"catalog-never-returned", name:"Overflow", documentation_url:"https://overflow.example/docs" },
      ].slice(0, limit),
    }),
  });
  const calls = [], publicFetchCalls = [];
  const conn = connection("public-api-cold-cli");
  const decisions = [
    { type:"tool_call", name:"public_api", arguments:{ action:"search", query:"holidays", limit:2 } },
    { type:"tool_call", name:"public_api", arguments:{ action:"search", query:"weather", limit:1 } },
    { type:"final", text:"The bounded catalog results are ready." },
  ];
  const host = new CanvasHarnessHost({
    stateDirectory,
    rootDirectory:ROOT,
    resolveConnection:id => id === conn.id ? conn : null,
    listConnections:() => [conn],
    callCli:async request => {
      calls.push(request);
      return JSON.stringify(decisions.shift());
    },
    publicFetch:async (...args) => {
      publicFetchCalls.push(args);
      throw new Error("offline public_api search must not reach the network");
    },
  });
  host.loadPublicApiDiscovery = async () => fixture.discovery;
  t.after(() => host.dispose());
  const messages = [];
  const session = await host.connect({
    clientId:"public-api-cold-client",
    connectionId:conn.id,
    webSearchEnabled:false,
    binding:{},
    send:(type, payload) => messages.push({ type, payload }),
  });
  host.updateState(session, { revision:1, canvas:{ width:2048, height:2048 }, objects:[] });
  await host.submit(session, "Find a small keyless public API for a Widget.");
  await waitFor(() => messages.some(message => message.type === "session_event" && message.payload.kind === "turn_end"));

  assert.equal(calls.length, 3);
  const contract = fs.readFileSync(CONTRACT_PATH, "utf8").trim();
  const catalog = fs.readFileSync(CATALOG_PATH, "utf8");
  const coldPrompt = `${calls[0].systemPrompt}\n${calls[0].prompt}`;
  assert.equal(coldPrompt.includes(contract), false, "the full discovery contract must not be in the cold prompt");
  assert.equal(coldPrompt.includes(catalog), false, "the bundled catalog must not be in the cold prompt");

  const firstRequest = requestFor(calls[0]);
  const firstNames = toolNames(firstRequest);
  assert.ok(firstNames.includes("public_api"));
  assert.ok(firstNames.includes("web_read"), "direct URL reading remains available with Search off");
  assert.equal(firstNames.includes("duckduckgo_search"), false, "general web search is disabled for this conversation");
  assert.match(firstRequest.availableTools.find(tool => tool.name === "public_api").description, /Web search\/read remain alternatives/);

  const firstResult = lastToolResult(calls[1]);
  assert.equal(firstResult.envelope.isError, false);
  assert.equal(firstResult.value.offline, true);
  assert.equal(firstResult.value.results.length, 2, "the service result must obey the requested bound");
  assert.equal(fixture.calls.search.length, 2);
  assert.deepEqual(fixture.calls.search.map(call => ({ query:call.args.query, limit:call.args.limit, offline:call.args.offline })), [
    { query:"holidays", limit:2, offline:true },
    { query:"weather", limit:1, offline:true },
  ]);
  assert.equal(publicFetchCalls.length, 0, "offline catalog search must not invoke publicFetch");

  const secondResult = lastToolResult(calls[2]);
  assert.equal(secondResult.envelope.isError, false);
  assert.equal(secondResult.value.results.length, 1);
  assert.equal(countOccurrences(calls[0].systemPrompt, contractDocument), 0);
  assert.equal(countOccurrences(calls[1].systemPrompt, contractDocument), 1, "first use adds guidance once");
  assert.equal(countOccurrences(calls[2].systemPrompt, contractDocument), 1, "repeated use does not duplicate guidance");
});

test("public_api verify accepts an arbitrary HTTPS endpoint and keeps runtime verification unverified", async t => {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-public-api-verify-"));
  t.after(() => fs.rmSync(stateDirectory, { recursive:true, force:true }));
  const { CanvasHarnessHost } = await import("../src/server/canvas-agent/runtime.mjs");
  const publicFetchCalls = [];
  const fixture = discoveryFixture({
    verify:async ({ url, origin, expectedKeys }, signal) => {
      const response = await fakePublicFetch(url, signal, { allowHttp:false });
      return {
        action:"verify",
        url,
        origin,
        expectedKeys,
        catalog_match:false,
        status:response.status,
        runtime_verified:false,
      };
    },
  });
  async function fakePublicFetch(url, signal, options) {
    publicFetchCalls.push({ url, signal, options });
    return {
      status:200,
      contentType:"application/json; charset=utf-8",
      body:Buffer.from(JSON.stringify({ documentedField:"ok" })),
      finalUrl:url,
    };
  }
  const calls = [];
  const conn = connection("public-api-verify-cli");
  const decisions = [
    { type:"tool_call", name:"public_api", arguments:{
      action:"verify",
      url:"https://outside-the-catalog.example/v1/data?public=true",
      origin:"https://widget.example",
      expectedKeys:["documentedField"],
    } },
    { type:"final", text:"The endpoint was checked." },
  ];
  const host = new CanvasHarnessHost({
    stateDirectory,
    rootDirectory:ROOT,
    resolveConnection:id => id === conn.id ? conn : null,
    listConnections:() => [conn],
    callCli:async request => {
      calls.push(request);
      return JSON.stringify(decisions.shift());
    },
  });
  host.loadPublicApiDiscovery = async () => fixture.discovery;
  t.after(() => host.dispose());
  const messages = [];
  const session = await host.connect({
    clientId:"public-api-verify-client",
    connectionId:conn.id,
    webSearchEnabled:false,
    binding:{},
    send:(type, payload) => messages.push({ type, payload }),
  });
  host.updateState(session, { revision:1, canvas:{ width:2048, height:2048 }, objects:[] });
  await host.submit(session, "Verify the documented endpoint.");
  await waitFor(() => messages.some(message => message.type === "session_event" && message.payload.kind === "turn_end"));

  assert.equal(fixture.calls.verify.length, 1);
  assert.deepEqual(fixture.calls.verify[0].args, {
    url:"https://outside-the-catalog.example/v1/data?public=true",
    origin:"https://widget.example",
    expectedKeys:["documentedField"],
  });
  assert.equal(publicFetchCalls.length, 1);
  assert.equal(publicFetchCalls[0].url, fixture.calls.verify[0].args.url);
  assert.equal(publicFetchCalls[0].options.allowHttp, false);
  assert.equal(Object.hasOwn(publicFetchCalls[0].options, "headers"), false);
  const result = lastToolResult(calls[1]);
  assert.equal(result.envelope.isError, false);
  assert.equal(result.value.catalog_match, false);
  assert.equal(result.value.runtime_verified, false);
});

test("publicWeb capability keeps public_api while disabling web alternatives", async t => {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-public-api-capability-"));
  t.after(() => fs.rmSync(stateDirectory, { recursive:true, force:true }));
  const { CanvasHarnessHost } = await import("../src/server/canvas-agent/runtime.mjs");
  const conn = connection("public-api-capability-cli");
  const calls = [];
  const host = new CanvasHarnessHost({
    stateDirectory,
    rootDirectory:ROOT,
    capabilities:{ publicWeb:false },
    resolveConnection:id => id === conn.id ? conn : null,
    listConnections:() => [conn],
    callCli:async request => {
      calls.push(request);
      return JSON.stringify({ type:"final", text:"No public web tools." });
    },
  });
  t.after(() => host.dispose());
  const messages = [];
  const session = await host.connect({
    clientId:"public-api-disabled-client",
    connectionId:conn.id,
    webSearchEnabled:false,
    binding:{},
    send:(type, payload) => messages.push({ type, payload }),
  });
  host.updateState(session, { revision:1, canvas:{ width:2048, height:2048 }, objects:[] });
  await host.submit(session, "List the available tools.");
  await waitFor(() => messages.some(message => message.type === "session_event" && message.payload.kind === "turn_end"));
  const disabledNames = toolNames(requestFor(calls[0]));
  assert.ok(disabledNames.includes("public_api"));
  assert.equal(disabledNames.includes("web_read"), false);
  assert.equal(disabledNames.includes("duckduckgo_search"), false);
  await assert.rejects(
    host.connect({ clientId:"public-api-disabled-search-on", connectionId:conn.id, webSearchEnabled:true, binding:{}, send:() => {} }),
    /Internet tools are unavailable/,
  );

  const searchStateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-public-api-search-on-"));
  t.after(() => fs.rmSync(searchStateDirectory, { recursive:true, force:true }));
  const searchCalls = [];
  const searchHost = new CanvasHarnessHost({
    stateDirectory:searchStateDirectory,
    rootDirectory:ROOT,
    resolveConnection:id => id === conn.id ? conn : null,
    listConnections:() => [conn],
    callCli:async request => {
      searchCalls.push(request);
      return JSON.stringify({ type:"final", text:"Search tools remain available." });
    },
  });
  t.after(() => searchHost.dispose());
  const searchMessages = [];
  const searchSession = await searchHost.connect({
    clientId:"public-api-search-on-client",
    connectionId:conn.id,
    webSearchEnabled:true,
    binding:{},
    send:(type, payload) => searchMessages.push({ type, payload }),
  });
  searchHost.updateState(searchSession, { revision:1, canvas:{ width:2048, height:2048 }, objects:[] });
  await searchHost.submit(searchSession, "List the search alternatives.");
  await waitFor(() => searchMessages.some(message => message.type === "session_event" && message.payload.kind === "turn_end"));
  const enabledNames = toolNames(requestFor(searchCalls[0]));
  assert.ok(enabledNames.includes("public_api"));
  assert.ok(enabledNames.includes("web_read"));
  assert.ok(enabledNames.includes("duckduckgo_search"));
});

test("native runtime exposes public_api dynamically and returns first-use guidance once", async t => {
  const fixture = discoveryFixture({
    search:async ({ limit }) => ({ action:"search", results:[{ id:"native-result" }].slice(0, limit) }),
  });
  const { runtime, session } = await createNativeRuntimeFixture(t, { discovery:fixture.discovery });
  const namespace = runtime.dynamicTools().find(entry => entry.name === "penecho");
  const names = namespace.tools.map(tool => tool.name);
  assert.ok(names.includes("public_api"));
  assert.ok(names.includes("web_read"));
  assert.equal(names.includes("duckduckgo_search"), false);
  const schema = namespace.tools.find(tool => tool.name === "public_api").inputSchema;
  assert.deepEqual(schema.properties.action.enum, ["search", "verify"]);
  assert.ok(schema.properties.expectedKeys);
  assert.ok(Buffer.byteLength(JSON.stringify(namespace.tools.find(tool => tool.name === "public_api")), "utf8") <= 700);

  const coldInstructions = runtime.instructions();
  assert.equal(countOccurrences(coldInstructions, fixture.discovery.contract.document), 0);
  const tool = runtime.tool("public_api");
  const first = await tool.execute({ action:"search", query:"native", limit:1 }, { callId:"native-public-api-first", signal:new AbortController().signal });
  assert.equal(first.guidance, fixture.discovery.contract.document);
  assert.equal(first.results.length, 1);
  assert.equal(session.publicApiSkillLoaded, true);
  assert.equal(runtime.instructions(), coldInstructions, "lazy guidance must not mutate the native cold prefix");
  assert.equal(runtime.turnAdditionalContext().filter(context => context.value.includes(fixture.discovery.contract.document)).length, 1);
  const second = await tool.execute({ action:"search", query:"native", limit:1 }, { callId:"native-public-api-second", signal:new AbortController().signal });
  assert.equal(Object.hasOwn(second, "guidance"), false);
  assert.equal(runtime.instructions(), coldInstructions, "repeated native use must not mutate the native cold prefix");
  assert.equal(runtime.turnAdditionalContext().filter(context => context.value.includes(fixture.discovery.contract.document)).length, 1, "repeated native use does not duplicate guidance");

  const enabledFixture = discoveryFixture();
  const { runtime:enabledRuntime } = await createNativeRuntimeFixture(t, {
    webSearchEnabled:true,
    discovery:enabledFixture.discovery,
  });
  const enabledNames = enabledRuntime.dynamicTools().find(entry => entry.name === "penecho").tools.map(tool => tool.name);
  assert.ok(enabledNames.includes("public_api"));
  assert.ok(enabledNames.includes("web_read"));
  assert.ok(enabledNames.includes("duckduckgo_search"));

  const { runtime:disabledRuntime } = await createNativeRuntimeFixture(t, {
    publicWebEnabled:false,
    webSearchEnabled:true,
    discovery:fixture.discovery,
  });
  const disabledNames = disabledRuntime.dynamicTools().find(entry => entry.name === "penecho").tools.map(tool => tool.name);
  assert.ok(disabledNames.includes("public_api"));
  assert.equal(disabledNames.includes("web_read"), false);
  assert.equal(disabledNames.includes("duckduckgo_search"), false);

  const restrictedSearchCalls = [], restrictedVerifyCalls = [], restrictedFetchCalls = [];
  const restrictedFixture = discoveryFixture({
    search:async ({ query, limit, offline }) => {
      restrictedSearchCalls.push({ query, limit, offline });
      return { action:"search", query, offline, results:[{ id:"restricted-result" }].slice(0, limit) };
    },
    verify:async args => {
      restrictedVerifyCalls.push(args);
      restrictedFetchCalls.push(args.url);
      return { action:"verify", status:"ok", runtime_verified:false };
    },
  });
  const { runtime:restrictedRuntime, session:restrictedSession } = await createNativeRuntimeFixture(t, {
    publicWebEnabled:false,
    webSearchEnabled:true,
    discovery:restrictedFixture.discovery,
  });
  let discoveryLoads = 0;
  const loadDiscovery = restrictedSession.loadPublicApiDiscovery;
  restrictedSession.loadPublicApiDiscovery = async (...args) => {
    discoveryLoads += 1;
    return loadDiscovery(...args);
  };
  const restrictedTool = restrictedRuntime.tool("public_api");
  assert.ok(restrictedTool);
  const restrictedSearch = await restrictedTool.execute(
    { action:"search", query:"offline-only", limit:1 },
    { callId:"native-public-api-disabled-search", signal:new AbortController().signal },
  );
  assert.equal(restrictedSearch.offline, true, "publicWeb=false forces catalog search offline even when Search is enabled");
  assert.deepEqual(restrictedSearchCalls, [{ query:"offline-only", limit:1, offline:true }]);
  assert.equal(discoveryLoads, 1);

  const blockedVerify = await restrictedTool.execute(
    { action:"verify", url:"https://outside-the-catalog.example/v1/data" },
    { callId:"native-public-api-disabled-verify", signal:new AbortController().signal },
  );
  assert.deepEqual(blockedVerify, {
    status:"unavailable",
    reason:"public_web_disabled",
    runtime_verified:false,
  });
  assert.equal(discoveryLoads, 1, "disabled verify must not load public API discovery");
  assert.equal(restrictedVerifyCalls.length, 0, "disabled verify must not call the discovery service");
  assert.equal(restrictedFetchCalls.length, 0, "disabled verify must not fetch the endpoint");
});

test("Codex Native session wires public_api through the host discovery loader", async t => {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-public-api-codex-native-"));
  t.after(() => fs.rmSync(stateDirectory, { recursive:true, force:true }));
  const { CodexNativeHost } = await import("../src/server/canvas-agent/codex-native-host.mjs");
  const conn = connection("public-api-codex-native");
  const host = new CodexNativeHost({
    stateDirectory,
    rootDirectory:ROOT,
    resolveConnection:id => id === conn.id ? conn : null,
    resolveWebSearch:() => ({ apiKey:"" }),
    resolveWidgetCapabilities:async () => ({ professionalEnabled:false, privatePlugins:[] }),
    resolveProject:async () => null,
    publicFetch:async () => { throw new Error("offline native catalog search must not reach the network"); },
  });
  t.after(() => host.dispose());
  const session = await host.connect({
    clientId:"public-api-codex-native-client",
    connectionId:conn.id,
    webSearchEnabled:false,
    binding:{},
    send:() => {},
  });
  const nativeTools = host.nativeTools(session).find(entry => entry.name === "penecho");
  assert.ok(nativeTools.tools.some(tool => tool.name === "public_api"));
  const first = await session.native.tool("public_api").execute(
    { action:"search", query:"weather", limit:1 },
    { callId:"codex-native-public-api-first", signal:new AbortController().signal },
  );
  assert.equal(first.results.length, 1);
  assert.match(first.guidance, /public_api/);
  const second = await session.native.tool("public_api").execute(
    { action:"search", query:"weather", limit:1 },
    { callId:"codex-native-public-api-second", signal:new AbortController().signal },
  );
  assert.equal(Object.hasOwn(second, "guidance"), false);
});

test("public API discovery uses a real bounded snapshot and safe verify fetch", async t => {
  const { createPublicApiDiscovery } = await import(pathToFileURL(DISCOVERY_MODULE_PATH).href);
  assert.equal(typeof createPublicApiDiscovery, "function");
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-public-api-real-"));
  t.after(() => fs.rmSync(stateDirectory, { recursive:true, force:true }));
  const fetchCalls = [];
  const publicFetch = async (url, signal, options) => {
    fetchCalls.push({ url, signal, options });
    return {
      status:200,
      contentType:"application/json; charset=utf-8",
      body:Buffer.from(JSON.stringify({ documentedField:"ok" })),
      finalUrl:url,
    };
  };
  const service = createPublicApiDiscovery({ rootDirectory:ROOT, stateDirectory, publicFetch });
  const search = await service.search({ query:"weather", limit:3, offline:true }, new AbortController().signal);
  const entries = search.results || search.candidates || search.entries;
  assert.ok(Array.isArray(entries));
  assert.ok(entries.length > 0, "the bundled weather snapshot should produce a real match");
  assert.ok(entries.length <= 3);
  assert.equal(JSON.stringify(search).length < 32_000, true, "a search result cannot include the bundled catalog");
  assert.equal(fetchCalls.length, 0, "offline search cannot refresh the snapshot");

  const verified = await service.verify({
    url:"https://outside-the-catalog.example/v1/data",
    origin:"https://widget.example",
    expectedKeys:["documentedField"],
  }, new AbortController().signal);
  assert.equal(verified.status, "ok");
  assert.equal(verified.runtime_verified, false);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "https://outside-the-catalog.example/v1/data");
  assert.equal(fetchCalls[0].options?.allowHttp, false);
  assert.equal(Object.hasOwn(fetchCalls[0].options || {}, "headers"), false);
});
