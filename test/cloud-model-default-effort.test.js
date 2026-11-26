require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { CloudConnector } = require("../src/server/cloud-connector.js");
const { createPenEchoSource } = require("../src/server/agent-core/penecho-source.js");
const { modelOf, defaultEffortWith } = require("../src/server/project-lines/agent-model.js");
const { createAgents } = require("../src/server/project-lines/agents.js");

const MODEL_A = "3ea3e82e-095e-4aa1-9c93-9eed1b963810";
const MODEL_B = "00000000-0000-4000-8000-000000000101";

function mockConnector(models) {
  const connector = new CloudConnector({ stateDir: fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "pe-effort-")) });
  connector.configuration = { origin: "https://penecho.ai", accountToken: "tok-test", accountExpiresAt: Date.now() + 60_000 };
  connector.account = { id: "acct-1", email: "user@example.com" };
  connector.hostedCatalog = { origin: "https://penecho.ai", token: "tok-test", models, loadedAt: Date.now() };
  connector.refreshHostedCatalog = async () => connector.hostedCatalog;
  return connector;
}

test("CloudConnector.hostedConnection inherits defaultEffort from catalog and falls back to medium when unset", () => {
  const connector = mockConnector([
    { id: MODEL_A, displayName: "DeepSeek Flash 4.1", apiFormat: "anthropic", defaultEffort: "max", worker: true, workerDefault: true },
    { id: MODEL_B, displayName: "Kimi K3", apiFormat: "openai", defaultEffort: null },
  ]);
  const a = connector.hostedConnection(`hosted:${MODEL_A}`);
  assert.equal(a.effort, "max");
  assert.equal(a.defaultEffort, "max");
  const b = connector.hostedConnection(`hosted:${MODEL_B}`);
  assert.equal(b.effort, "medium");
  assert.equal(b.defaultEffort, undefined);
});

test("PenEcho built-in agent exposes Cloud model defaultEffort through agent-model and agents.configuredEffort", async () => {
  const connector = mockConnector([
    { id: MODEL_B, displayName: "Kimi K3", apiFormat: "openai", sortOrder: 10, defaultEffort: "high", worker: true },
    { id: MODEL_A, displayName: "DeepSeek Flash 4.1", apiFormat: "anthropic", sortOrder: 20, defaultEffort: "max", worker: true, workerDefault: true },
  ]);
  const source = createPenEchoSource({ cloud: () => connector, publishEndpoint: false });
  try {
    const models = source.models();
    // workerDefault takes precedence over sortOrder so DeepSeek Flash 4.1 remains the default.
    assert.equal(models.name, "DeepSeek Flash 4.1");
    assert.deepEqual(models.choices, ["DeepSeek Flash 4.1", "Kimi K3"]);
    assert.equal(models.effort, "max");
    assert.deepEqual(models.defaultEffortFor, { "DeepSeek Flash 4.1": "max", "Kimi K3": "high" });

    const about = modelOf("penecho", {}, source);
    assert.equal(about.name, "DeepSeek Flash 4.1");
    assert.equal(about.effort, "max");
    assert.equal(defaultEffortWith("", about), "max");
    assert.equal(defaultEffortWith("DeepSeek Flash 4.1", about), "max");
    assert.equal(defaultEffortWith("Kimi K3", about), "high");

    const agents = createAgents({ env: {}, paths: { penecho: source } });
    assert.equal(agents.configuredEffort("penecho"), "max");
    assert.equal(agents.configuredEffort("penecho", "DeepSeek Flash 4.1"), "max");
    assert.equal(agents.configuredEffort("penecho", "Kimi K3"), "high");
  } finally {
    await source.close?.();
  }
});

test("Canvas and Cloud Lines client bundles include model defaultEffort visibility helpers", () => {
  const core = fs.readFileSync(path.join(__dirname, "..", "src", "client", "app", "core.js"), "utf8");
  const aiRuntime = fs.readFileSync(path.join(__dirname, "..", "src", "client", "app", "ai-runtime.js"), "utf8");
  const hosted = fs.readFileSync(path.join(__dirname, "..", "public", "lines", "hosted.js"), "utf8");
  const line = fs.readFileSync(path.join(__dirname, "..", "public", "lines", "line.js"), "utf8");
  const settings = fs.readFileSync(path.join(__dirname, "..", "public", "lines", "settings.js"), "utf8");
  assert.match(core, /function activeModelDefaultEffort\(\)/);
  assert.match(core, /defaultEffort:model\.defaultEffort \|\| ""/);
  assert.match(core, /effortConfiguredDefault/);
  assert.match(aiRuntime, /activeModelDefaultEffort/);
  assert.match(hosted, /function hostedWorkerModels\(\)/);
  assert.match(hosted, /function hostedModelLabel\(model\)/);
  assert.match(hosted, /modelId:pickedModelId/);
  assert.match(line, /hostedModelLabel\(hostedModelSelection\(l\.slug \|\| l\.id\)\)/);
  assert.match(settings, /a\.workers/);
});

test("hostedWorkerModels and hostedNamed never fall back to Canvas-only models when no worker is available", async () => {
  const vm = require("node:vm");
  const hostedSource = fs.readFileSync(path.join(__dirname, "..", "public", "lines", "hosted.js"), "utf8");
  const extractFn = (name) => {
    const start = hostedSource.indexOf(`function ${name}(`);
    const asyncStart = hostedSource.indexOf(`async function ${name}(`);
    const pos = asyncStart !== -1 && (start === -1 || asyncStart < start) ? asyncStart : start;
    assert.notEqual(pos, -1, `missing ${name}`);
    let depth = 0, end = pos;
    for (let i = hostedSource.indexOf("{", pos); i < hostedSource.length; i++) {
      if (hostedSource[i] === "{") depth++;
      else if (hostedSource[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    return hostedSource.slice(pos, end);
  };
  const snippet = [
    extractFn("hostedWorkerModels"),
    extractFn("hostedModelLabel"),
    extractFn("hostedModelSelection"),
    extractFn("hostedNamed"),
  ].join("\n");
  const ctx = { HOSTED: { onComputer: false, models: [], runModel: {} }, JSON };
  vm.runInNewContext(snippet, ctx);

  // When only Canvas-only models are listed (e.g., pinned worker unavailable), never show or send a Canvas-only modelId.
  ctx.HOSTED.models = [
    { id: MODEL_B, displayName: "Kimi K3", sortOrder: 10, defaultEffort: "high" },
  ];
  assert.deepEqual([...ctx.hostedWorkerModels()], []);
  assert.equal(ctx.hostedModelSelection("my-line"), null);
  const initNoWorker = await ctx.hostedNamed("my-line", { method: "POST", body: JSON.stringify({ step: "ask-1" }) });
  assert.deepEqual(JSON.parse(initNoWorker.body), { step: "ask-1" });

  // Stale runModel entry pointing to a non-worker model is ignored rather than sent.
  ctx.HOSTED.runModel = { "my-line": MODEL_B };
  const initStale = await ctx.hostedNamed("my-line", { method: "POST", body: JSON.stringify({ step: "ask-1" }) });
  assert.deepEqual(JSON.parse(initStale.body), { step: "ask-1" });

  // When worker models exist, workerDefault comes first and non-worker models stay excluded.
  ctx.HOSTED.models = [
    { id: MODEL_B, displayName: "Kimi K3", sortOrder: 10, defaultEffort: "high" },
    { id: MODEL_A, displayName: "DeepSeek Flash 4.1", sortOrder: 20, defaultEffort: "max", worker: true, workerDefault: true },
  ];
  assert.deepEqual([...ctx.hostedWorkerModels()].map(m => m.id), [MODEL_A]);
  assert.equal(ctx.hostedModelLabel(ctx.hostedModelSelection("my-line")), "DeepSeek Flash 4.1 · max effort");
  const initWorker = await ctx.hostedNamed("my-line", { method: "POST", body: JSON.stringify({ step: "ask-1" }) });
  assert.deepEqual(JSON.parse(initWorker.body), { step: "ask-1", modelId: MODEL_A });
});
