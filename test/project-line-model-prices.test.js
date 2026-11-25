"use strict";
require("./helpers/safety.js");
// Model prices for the whole computer: which saved agents have none, the sync, an agent's answer left in a file, and the routes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-model-prices-test-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
let counter = 0;
function setup(t, records = []) {
  const directory = path.join(temp, `state-${++counter}`);
  fs.mkdirSync(path.join(directory, "orchestrator"), { recursive:true });
  if (records.length) fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const one = id => ({ name:id, mono:"Fk", color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[] }), command:launch => ({ command:launch.command, args:[] }) });
  const agents = createAgents({ env:{ PATH:"" }, extra:{ fake:one("Fake"), other:one("Other") } });
  const configured = { fake:"", other:"" };
  agents.configuredModel = id => configured[id] || "";
  const lines = createProjectLines({ directory, agents, serviceOptions:{ autoWatch:false }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => s += d).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  t.after(() => lines.close());
  const preset = (agent, model = "") => lines.service.presets.add({ agent, model }).id;
  return { lines, orchestrator:lines.orchestrator, presets:lines.service.presets, preset, configured, directory };
}
const record = (fields, i = 0) => ({ id:`r${i}`, at:new Date(Date.now() - 3600000 + i).toISOString(), project:"p", line:"l", work:`work-${i}`, ...fields });
const names = list => [...list].map(m => m.model);

test("a saved agent is marked when its model has no price, as the Orchestrator finds prices", t => {
  const { orchestrator, preset, configured } = setup(t, [
    record({ agent:"fake", model:"claude-opus-5-5", selectedModel:"opus" }, 1), record({ agent:"fake", model:"opus", selectedModel:"opus" }, 2),
    record({ agent:"other", model:"old-model", selectedModel:"old-model" }, 3), record({ agent:"other", model:"left-long-ago" , at:"2020-01-01T00:00:00.000Z" }, 4),
  ]);
  const base = preset("fake", "base"), pro = preset("fake", "base-pro"), routed = preset("fake", "router/maker/base"), alias = preset("fake", "opus"), unnamed = preset("other");
  const before = orchestrator.modelPrices();
  assert.deepEqual([base, pro, routed, alias].map(id => before.agents[id].priced), [false, false, false, false]);
  assert.equal(before.agents[unnamed], undefined, "a model nobody named cannot be priced, so nothing marks it");
  assert.deepEqual(names(before.missing), ["base", "base-pro", "opus", "claude-opus-5-5", "old-model"], "the saved agents' models first, then the recent Works' others; none from long ago");
  assert.equal(before.missing.find(m => m.model === "base").agents.length, 2, "one row for a model, whatever router it goes through");

  orchestrator.setPrice({ model:"base", input:1, output:2 });
  orchestrator.setPrice({ model:"claude-opus-5-5", input:4, output:20 });
  const now = orchestrator.modelPrices();
  assert.deepEqual([base, pro, routed, alias].map(id => now.agents[id].priced), [true, false, true, true], "another variant keeps its own mark, and opus has the price of the version it last ran");
  assert.deepEqual(names(now.missing), ["base-pro", "old-model"], "opus is priced through its version, so nobody is asked for it");

  configured.other = "house-model";
  assert.deepEqual(orchestrator.modelPrices().agents[unnamed], { model:"house-model", priced:false }, "with no model of its own, its app's default one");
  orchestrator.setPrice({ model:"house-model", input:0, output:0 });
  assert.equal(orchestrator.modelPrices().agents[unnamed].priced, true, "$0 is a price");
});

test("several prices are saved together or not at all", t => {
  const { orchestrator } = setup(t);
  orchestrator.setPrice({ model:"kept", input:1, output:2, cacheWrite:3 });
  assert.throws(() => orchestrator.setPrice({ models:[{ model:"a", input:1, output:2 }, { model:"b", input:"many", output:2 }] }), /Input and output prices/);
  assert.throws(() => orchestrator.setPrice({ models:[] }), /1 to 200/);
  assert.deepEqual(names(orchestrator.prices()), ["kept"]);
  orchestrator.setPrice({ models:[{ model:"B", input:1, output:2, source:"https://b.example" }, { model:"a", input:"3", output:"4", cached:"0.5" }, { model:"b", input:5, output:6 }] });
  assert.deepEqual(orchestrator.prices().map(({ updated, ...m }) => m), [{ model:"a", input:3, output:4, cached:.5 }, { model:"b", input:5, output:6 }, { model:"kept", input:1, output:2, cacheWrite:3 }]);
  orchestrator.setPrice({ model:"KEPT", remove:true });
  assert.deepEqual(names(orchestrator.prices()), ["a", "b"]);
  assert.throws(() => orchestrator.setPrice({ remove:true }), /Name the model/);
});

test("the sync prices Claude Code's short names and dated names from their models", async t => {
  const { orchestrator, preset } = setup(t);
  for (const model of ["opus", "claude-haiku-4-5-20251001", "nova"]) preset("fake", model);
  const files = { "/leaderboard.json":{ tables:{ all:{ ranked:[{ agent:"fake", model:"opus", effort:"", rating:4, rated:5 }] } } },
    "/model-prices.json":{ models:[{ model:"claude-opus-latest", input:4, output:20, cached:.2 }, { model:"claude-haiku-4.5", input:1, output:5 }, { model:"nova-latest", input:9, output:9 }] } };
  orchestrator.reviews.use({ fetch:async url => ({ ok:true, status:200, json:async () => files[new URL(url).pathname] }) });
  assert.equal((await orchestrator.sync()).addedPrices, 2);
  assert.deepEqual(orchestrator.prices().map(m => [m.model, m.input, m.source]), [["claude-haiku-4-5-20251001", 1, "penecho.ai"], ["opus", 4, "penecho.ai"]]);
  assert.deepEqual(names(orchestrator.modelPrices().missing), ["nova"], "a name that is no Claude short name is never guessed");
});

test("an agent's answer left in the file is taken in once, and one that cannot be read says so and stays", t => {
  const { orchestrator, preset } = setup(t);
  preset("fake", "nova");
  const { file } = orchestrator.modelPrices().inbox;
  fs.writeFileSync(file, "not yet{");
  assert.match(orchestrator.modelPrices().inbox.error, /Could not read .*new-prices\.json/);
  fs.writeFileSync(file, JSON.stringify({ prices:"none" }));
  assert.match(orchestrator.modelPrices().inbox.error, /no list of models/);
  assert.ok(fs.existsSync(file));
  fs.writeFileSync(file, JSON.stringify([{ model:"nova", input:1.5, output:6, cached:.15, source:"https://nova.example/pricing" }]));
  const taken = orchestrator.modelPrices();
  assert.deepEqual([taken.inbox.taken, taken.inbox.error, names(taken.models), names(taken.missing)], [1, undefined, ["nova"], []]);
  assert.equal(fs.existsSync(file), false);
  assert.equal(orchestrator.modelPrices().inbox.taken, 0);
});

test("the prices have routes of their own, with no project", async t => {
  const { lines, orchestrator, preset } = setup(t);
  preset("fake", "nova");
  const server = http.createServer(async (req, res) => {
    try { if (await lines.handle(req, res, new URL(req.url, "http://localhost"))) return; res.writeHead(404).end("{}"); }
    catch (error) { res.writeHead(error.status || 500, { "content-type":"application/json" }).end(JSON.stringify({ error:error.message })); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const call = async (where = "", options = {}) => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/lines/model-prices${where}`, { headers:{ "content-type":"application/json" }, ...options }); return { status:r.status, body:await r.json() }; };
  const post = (body, where = "") => call(where, { method:"POST", body:JSON.stringify(body) });
  assert.deepEqual(names((await call()).body.missing), ["nova"]);
  const saved = await post({ model:"nova", input:1, output:2 });
  assert.deepEqual([names(saved.body.models), saved.body.missing], [["nova"], []]);
  assert.equal((await post({ model:"nova" })).status, 400);
  assert.deepEqual((await post({ model:"nova", remove:true })).body.models, []);
  orchestrator.reviews.use({ fetch:async url => ({ ok:true, status:200, json:async () => (new URL(url).pathname === "/model-prices.json" ? { models:[{ model:"nova", input:3, output:4 }] } : { available:false }) }) });
  const synced = await post({}, "/sync");
  assert.deepEqual([synced.body.addedPrices, synced.body.models[0].source, synced.body.missing, Boolean(synced.body.sync.at)], [1, "penecho.ai", [], true]);
  assert.equal((await call("", { method:"DELETE" })).status, 405);
});
