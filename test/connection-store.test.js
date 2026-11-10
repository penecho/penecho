"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readConnectionStore, writeConnectionStore, isUsableConnection, connectionEnvironment } = require("../src/server/connection-store.js");
function fixture(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-connections-")); t.after(() => fs.rmSync(dir, { recursive:true, force:true })); return path.join(dir, "connections.json"); }
const legacy = { id:"default", provider:"api", apiFormat:"openai", apiUrl:"https://example.com/v1", apiModel:"model", apiKey:"private-key", effort:"high" };
test("fresh install persists an empty canonical store and never imports later environment values", t => {
  const file = fixture(t);
  assert.deepEqual(readConnectionStore(file), { version:1, connections:[] });
  assert.deepEqual(readConnectionStore(file, { legacyConnection:legacy }).connections, []);
});
test("legacy migration prepends default, preserves secrets and extra records, and is idempotent", t => {
  const file = fixture(t), extra = { id:"extra", provider:"codex-cli", cliModel:"custom", customSetting:true };
  fs.writeFileSync(file, JSON.stringify({ defaultName:"old name", connections:[extra], otherSetting:7 }));
  const store = readConnectionStore(file, { legacyConnection:legacy });
  assert.deepEqual(store.connections, [legacy, extra]);
  assert.equal(store.otherSetting, 7);
  const bytes = fs.readFileSync(file, "utf8");
  assert.deepEqual(readConnectionStore(file, { legacyConnection:{ ...legacy, apiKey:"stale" } }), store);
  assert.equal(fs.readFileSync(file, "utf8"), bytes);
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
test("default edits and deletion persist without ghost default after restart", t => {
  const file = fixture(t), store = readConnectionStore(file, { legacyConnection:legacy });
  store.connections[0].apiKey = "changed-key";
  writeConnectionStore(file, store);
  assert.equal(readConnectionStore(file, { legacyConnection:legacy }).connections[0].apiKey, "changed-key");
  writeConnectionStore(file, { ...store, connections:[] });
  assert.deepEqual(readConnectionStore(file, { legacyConnection:legacy }).connections, []);
});
test("malformed, unsupported and duplicate stores are never overwritten", t => {
  const file = fixture(t);
  for (const bytes of ["{broken", '{}', JSON.stringify({ version:2, connections:[] }), JSON.stringify({ connections:[legacy, legacy] })]) {
    fs.writeFileSync(file, bytes);
    assert.throws(() => readConnectionStore(file, { legacyConnection:legacy }));
    assert.throws(() => writeConnectionStore(file, { version:1, connections:[] }));
    assert.equal(fs.readFileSync(file, "utf8"), bytes);
  }
});
test("usable means configured API or explicit supported CLI without login probing", () => {
  assert.equal(isUsableConnection(legacy), true);
  for (const patch of [{ apiKey:"" }, { apiModel:"" }, { apiUrl:"ftp://host" }, { apiUrl:"https://secret@host" }, { apiFormat:"unknown" }, { apiUrl:"https://example.com/v1/messages" }]) assert.equal(isUsableConnection({ ...legacy, ...patch }), false);
  for (const provider of ["codex-cli", "kimi-cli", "claude-cli"]) assert.equal(isUsableConnection({ provider }), true);
  assert.equal(isUsableConnection({ provider:"unknown-cli" }), false);
});
test("canonical environment clears legacy API aliases and other CLI selections", () => {
  const env = { AI_API_KEY:"old", OPENAI_API_KEY:"old-alias", CODEX_CLI_MODEL:"old-model", ...connectionEnvironment({ provider:"kimi-cli", cliModel:"kimi-model" }) };
  assert.equal(env.AI_API_KEY, ""); assert.equal(env.OPENAI_API_KEY, ""); assert.equal(env.CODEX_CLI_MODEL, "");
  assert.equal(env.KIMI_CLI_MODEL, "kimi-model"); assert.equal(env.KIMI_CLI_PATH, "kimi");
  assert.equal(connectionEnvironment(null).AI_PROVIDER, "");
});
test("server connection actions treat migrated default as an ordinary record and permit the full limit", t => {
  const vm = require("node:vm"), source = fs.readFileSync(path.join(__dirname, "../src/server/main.js"), "utf8");
  const file = fixture(t);
  readConnectionStore(file, { legacyConnection:legacy });
  const context = vm.createContext({
    connectionStore:() => readConnectionStore(file),
    readConnectionsFile:() => readConnectionStore(file),
    writeConnectionsFile:store => writeConnectionStore(file, store),
    canvasSettings:() => ({ connections:readConnectionStore(file).connections }),
    findConnection:(store, id) => store.connections.find(item => item.id === id),
    normalizeConnection:(input, existing) => ({ ...input, id:existing?.id || "new" }),
    MAX_AI_CONNECTIONS:2,
  });
  vm.runInContext(source.slice(source.indexOf("function updateConnectionStore("), source.indexOf("function normalizeCanvasSettings(")), context);
  context.updateConnectionStore({ action:"save", id:"default", connection:{ ...legacy, apiModel:"edited" } });
  assert.equal(readConnectionStore(file).connections[0].apiModel, "edited");
  context.updateConnectionStore({ action:"save", connection:{ provider:"codex-cli" } });
  assert.equal(readConnectionStore(file).connections.length, 2);
  assert.throws(() => context.updateConnectionStore({ action:"save", connection:{ provider:"kimi-cli" } }), /up to 2/);
  context.updateConnectionStore({ action:"delete", id:"default" });
  context.updateConnectionStore({ action:"delete", id:"new" });
  assert.deepEqual(readConnectionStore(file, { legacyConnection:legacy }).connections, []);
});
test("explicit CLI overrides are transient for saved and empty stores", () => {
  const { withConnectionOverride } = require("../src/server/connection-store.js");
  const saved = { version:1, connections:[legacy] }, empty = { version:1, connections:[] };
  const override = { AI_PROVIDER:"codex-cli", CODEX_CLI_MODEL:"requested", AI_EFFORT:"low" };
  const result = withConnectionOverride(saved, override);
  assert.equal(result.connections[0].id, "default");
  assert.equal(result.connections[0].provider, "codex-cli");
  assert.equal(result.connections[0].cliModel, "requested");
  assert.equal(result.connections[0].effort, "low");
  assert.deepEqual(saved.connections, [legacy]);
  assert.equal(withConnectionOverride(empty, override).connections[0].provider, "codex-cli");
  assert.deepEqual(empty.connections, []);
  assert.equal(withConnectionOverride(empty, {}).connections.length, 0);
});
test("server request routing uses real saved or explicit transient connections and rejects empty state", async () => {
  const vm = require("node:vm"), source = fs.readFileSync(path.join(__dirname, "../src/server/main.js"), "utf8");
  const { withConnectionOverride } = require("../src/server/connection-store.js");
  let store = { version:1, connections:[] };
  const context = vm.createContext({
    browserRequestError:()=>null,
    cloudConnector:{prepareHostedConnection:async()=>{}},
    connectionStore:() => store,
    findConnection:(value, id) => value.connections.find(item => item.id === id),
    connectionProviderSnapshot:connection => connection,
  });
  vm.runInContext(source.slice(source.indexOf("async function requestProviderSnapshot("), source.indexOf("function providerRequest(")), context);
  await assert.rejects(() => context.requestProviderSnapshot({ headers:{} }), /unavailable/);
  store = withConnectionOverride(store, { AI_PROVIDER:"codex-cli" });
  assert.equal((await context.requestProviderSnapshot({ headers:{} })).id, "cli-override");
  store = { version:1, connections:[legacy, { id:"second", provider:"kimi-cli" }] };
  assert.equal((await context.requestProviderSnapshot({ headers:{ "x-penecho-connection":"second" } })).provider, "kimi-cli");
  assert.equal((await context.requestProviderSnapshot({ headers:{} })).id, "default");
  await assert.rejects(() => context.requestProviderSnapshot({ headers:{ "x-penecho-connection":"hosted:missing" } }), /unavailable/);
  await assert.rejects(() => context.requestProviderSnapshot({ headers:{ "x-penecho-connection":"123e4567-e89b-42d3-a456-426614174000" } }), /unavailable/);
});
