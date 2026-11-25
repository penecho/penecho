"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), zlib = require("node:zlib");
const { test } = require("node:test");
const { rolloutTurnTimes, rolloutTurnEnds, rolloutTurnSpans, rolloutTurnSettings } = require("../src/server/project-lines/codex-history.js");
const { Conversations } = require("../src/server/project-lines/conversations.js");
const event = (id, started_at, timestamp = "2026-06-30T02:08:39.120Z") => JSON.stringify({ type:"event_msg", timestamp, payload:{ type:"task_started", turn_id:id, started_at } });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-codex-history-"));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const project = { id:"p", codePaths:[dir], docsPath:dir }, service = { store:{ deleted:{}, projects:[project] }, isSessionRunning:() => false };
  const reader = new Conversations({ directory:dir, home:dir, env:{}, service, codex:{} });
  const delivered = [];
  reader.deliver = async (_p, _r, changes) => delivered.push(...changes);
  return { dir, project, reader, delivered };
}
for (const compressed of [false, true]) test(`recover exact Codex turn timestamps from ${compressed ? "compressed" : "plain"} rollout`, async t => {
  const { dir } = fixture(t), file = path.join(dir, "history.jsonl");
  const data = [event("a", 1782785313), "invalid json", event("b", null), event("a", 1782789999)].join("\n");
  fs.writeFileSync(file + (compressed ? ".zst" : ""), compressed ? zlib.zstdCompressSync(data) : data);
  assert.deepEqual([...await rolloutTurnTimes(file)], [["a",1782785313000],["b",Date.parse("2026-06-30T02:08:39.120Z")]]);
});
test("missing/corrupt compressed history rejects without swallowing the failure", async t => {
  const { dir } = fixture(t), file = path.join(dir, "history.jsonl");
  await assert.rejects(rolloutTurnTimes(file));
  fs.writeFileSync(file + ".zst", "not a zstd frame");
  await assert.rejects(rolloutTurnTimes(file));
});
for (const compressed of [false, true]) test(`read settings only from the exact Codex turn in ${compressed ? "compressed" : "plain"} history`, async t => {
  const { dir } = fixture(t), file = path.join(dir, "settings.jsonl");
  const context = (turn_id, model, effort) => JSON.stringify({ type:"turn_context", payload:{ turn_id, model, effort } });
  const data = [context("old", "alias", "high"), "broken json", context("helper", "helper-model", "low"),
    context("old", "gpt-6.1-sol", "max"), context("latest", "other-model", "low"),
    JSON.stringify({ type:"response_item", payload:{ text:context("old", "invented", "low") } }),
  ].join("\n");
  fs.writeFileSync(file + (compressed ? ".zst" : ""), compressed ? zlib.zstdCompressSync(data) : data);
  assert.deepEqual(await rolloutTurnSettings(file, "old"), { model:"gpt-6.1-sol", effort:"max" });
  assert.deepEqual(await rolloutTurnSettings(file, "latest"), { model:"other-model", effort:"low" });
  assert.equal(await rolloutTurnSettings(file, "missing"), null);
});
test("missing or invalid turn fields remain unknown", async t => {
  const { dir } = fixture(t), file = path.join(dir, "partial.jsonl");
  fs.writeFileSync(file, [
    { type:"turn_context", payload:{ turn_id:"a", model:"gpt-6.1-sol", effort:null } },
    { type:"turn_context", payload:{ turn_id:"b", model:{ id:"do not stringify" }, effort:"high" } },
    { type:"turn_context", payload:{ turn_id:"c", model:"bad\nmodel", effort:false } },
  ].map(JSON.stringify).join("\n"));
  assert.deepEqual(await rolloutTurnSettings(file, "a"), { model:"gpt-6.1-sol" });
  assert.deepEqual(await rolloutTurnSettings(file, "b"), { effort:"high" });
  assert.equal(await rolloutTurnSettings(file, "c"), null);
  await assert.rejects(rolloutTurnSettings(path.join(dir, "gone"), "a"));
});
test("API times take precedence, recovered times obey cutoffs, and unknown turns remain retryable", async t => {
  const { dir, reader, project, delivered } = fixture(t), file = path.join(dir,"history.jsonl");
  fs.writeFileSync(file, [event("old",100),event("new",300),event("api",400)].join("\n"));
  const turns = [ ["old",null], ["new",null], ["api",500] ].map(([id,startedAt]) => ({ id, startedAt, status:"completed", items:[{ id:`u-${id}`, type:"userMessage", content:[{type:"text",text:id}] }] }));
  const client = { call:async () => ({thread:{path:file,turns}}) }, entry = {project}, thread = {cwd:dir,updatedAt:600};
  const rec = { doneTurns:{}, openItems:{}, skipUntil:200000 };
  reader.syncing = true;
  await reader.readCodex(client,entry,thread,rec,0);
  assert.deepEqual(delivered.map(c=>[c.me,c.at]), [["new",300000],["api",500000]]);
  turns.push({id:"missing",startedAt:null,status:"completed",items:[{id:"u-m",type:"userMessage",content:[{type:"text",text:"retry me"}]}]});
  await assert.rejects(reader.readCodex(client,entry,thread,rec,0), /timestamps/);
  assert.equal(rec.doneTurns.missing,undefined); assert.equal(rec.updated,undefined);
  fs.appendFileSync(file,"\n"+event("missing",700));
  await reader.readCodex(client,entry,thread,rec,0);
  assert.equal(delivered.length,3); assert.equal(delivered[2].at,700000);
  await reader.readCodex(client,entry,thread,rec,0);
  assert.equal(delivered.length,3);
});
test("explicit discovery paginates, deduplicates, excludes other projects and reports incomplete pages", async t => {
  const {dir,reader,project} = fixture(t), calls=[], warnings=[];
  reader.records["codex:owned"]={projectId:"other"};
  reader.codexOverride={call:async (_method,params)=>{calls.push(params); return !params.cursor ? {data:Array.from({length:60},(_,i)=>({id:`far${i}`,cwd:path.dirname(dir),updatedAt:100})),nextCursor:"second"} : {data:[{id:"match",cwd:dir,updatedAt:90},{id:"match",cwd:dir,updatedAt:90},{id:"owned",cwd:dir,updatedAt:90}],nextCursor:"second"};}};
  const found=await reader.recentCodex({project,roots:[dir]},0,warnings);
  assert.deepEqual(found.map(x=>x.id),["match"]);assert.equal(calls.length,2);assert.match(warnings[0],/repeated/);
  reader.codexOverride.call=async ()=>{throw Error("offline")};
  const failed=[];assert.deepEqual(await reader.recentCodex({project,roots:[dir]},0,failed),[]);assert.match(failed[0],/incomplete/);
});
test("Windows namespace paths match only their own folder", {skip:process.platform!=="win32"}, async t=>{
  const {reader,project}=fixture(t);
  reader.codexOverride={call:async ()=>({data:[{id:"same",cwd:"\\\\?\\C:\\repo",updatedAt:1},{id:"other",cwd:"\\\\?\\C:\\repo-other",updatedAt:1},{id:"unc",cwd:"\\\\?\\UNC\\server\\share\\repo",updatedAt:1}]})};
  assert.deepEqual((await reader.recentCodex({project,roots:["C:\\repo","\\\\server\\share\\repo"]},0)).map(t=>t.id),["same","unc"]);
});

test("each Codex turn's own end, from a compressed rollout, and turns cut off without one (PE-571)", async t => {
  const { dir } = fixture(t), file = path.join(dir, "ends.jsonl");
  const done = (type, id, completed_at, timestamp) => JSON.stringify({ type:"event_msg", timestamp, payload:{ type, turn_id:id, ...(completed_at ? { completed_at } : {}) } });
  const data = [event("a", 1782625015), done("task_complete", "a", 1782625116), event("b", 1782625200), done("turn_aborted", "b", null, "2026-06-28T05:41:00.000Z"), event("c", 1782625300)].join("\n");
  fs.writeFileSync(`${file}.zst`, zlib.zstdCompressSync(data));
  assert.deepEqual([...await rolloutTurnEnds(file)], [["a", 1782625116000], ["b", Date.parse("2026-06-28T05:41:00.000Z")]]);
  assert.deepEqual(await rolloutTurnSpans(file), [{ id:"a", started:1782625015000, ended:1782625116000 }, { id:"b", started:1782625200000, ended:Date.parse("2026-06-28T05:41:00.000Z") }, { id:"c", started:1782625300000, ended:0 }]);
});

test("followed Codex failures are delivered before a later Ask in the same import", async t => {
  const { dir, reader, project, delivered } = fixture(t);
  const turn = (id, startedAt, status) => ({ id, startedAt, completedAt:startedAt + 1, status,
    items:[{ id:`input-${id}`, type:"userMessage", content:[{ type:"text", text:id }] }],
  });
  const turns = [turn("first", 100, "failed"), turn("next", 200, "completed")];
  turns[0].error = { message:"Model interrupted" };
  const rec = { doneTurns:{}, openItems:{} };
  await reader.readCodex({ call:async () => ({ thread:{ turns } }) }, { project }, { cwd:dir, updatedAt:201 }, rec, 0);
  assert.deepEqual(delivered.map(change => change.me || change.codexFailure), ["first", "Model interrupted", "next"]);
  assert.equal(rec.turnError, "");
});
