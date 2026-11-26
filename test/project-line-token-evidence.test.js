"use strict";
require("./helpers/safety.js");
const { test } = require("node:test"), assert = require("node:assert/strict");
const T = require("../src/server/project-lines/token-evidence.js");
const base = (input = 500000) => ({input,requestId:"old-request",model:"opus",agent:"claude",config:"same",at:10});
function fixture({ baseline = base(), agent = "claude", resumed = false, cumulative = null, mode = "new" } = {}) {
  const e = T.create({workId:"p/line/work-1",taskId:"task",taskMode:mode,baseline,at:20});
  const a = T.startAttempt(e,{agent,config:"same",resumed,cumulative,at:20});
  return {e,a};
}
const claude = (id,input,out = 100,model = "opus") => ({type:"assistant",message:{id,model,usage:{input_tokens:10,cache_read_input_tokens:input-20,cache_creation_input_tokens:10,output_tokens:out},content:[]}});
test("Claude includes all input categories, upserts snapshots and keeps a signed first-request comparison",()=>{
  const {e,a}=fixture();
  T.observe(e,a,claude("one",64000,2),{at:30}); T.observe(e,a,claude("one",64000,100),{at:31});
  T.observe(e,a,claude("two",65000,200),{at:40});
  assert.equal(T.summary(e).inputTokens,129000); assert.equal(T.summary(e).outputTokens,300);
  assert.equal(e.startup.difference,436000); assert.equal(e.startup.first.requestId,"one");
  assert.equal(T.summary(e).lastRequest.requestId,"two");
  assert.equal(a.events.reduce((s,x)=>s+x.inputTokens,0),129000);
});
test("verified Claude invocation usage replaces provisional request sums",()=>{
  const {e,a}=fixture();T.observe(e,a,claude("one",64000));
  T.observe(e,a,{type:"result",usage:{input_tokens:100,cache_read_input_tokens:100000,cache_creation_input_tokens:2000,output_tokens:400}});
  T.observe(e,a,{type:"result",usage:{input_tokens:100,cache_read_input_tokens:100000,cache_creation_input_tokens:2000,output_tokens:400}});
  assert.equal(T.summary(e).inputTokens,102100);assert.equal(T.summary(e).outputTokens,400);
  assert.equal(a.events.reduce((s,x)=>s+x.inputTokens,0),102100);
  assert.equal(T.summary(e).coverage,"reported totals");
});
test("negative and zero reductions are retained; missing categories, first requests and models remain unknown",()=>{
  for(const [n,diff] of [[600000,-100000],[500000,0]]){
    const {e,a}=fixture();T.observe(e,a,claude("one",n));assert.equal(e.startup.difference,diff);
  }
  const x=fixture();T.observe(x.e,x.a,{type:"assistant",message:{id:"one",model:"opus",usage:{input_tokens:2,output_tokens:4}}});T.finish(x.e,x.a);
  assert.equal(x.e.startup.status,"unavailable");assert.equal(T.summary(x.e).inputTokens,null);
  const y=fixture();T.observe(y.e,y.a,{type:"assistant",message:{id:"missing",model:"opus",content:[]}});T.observe(y.e,y.a,claude("later",5000));
  assert.equal(y.e.startup.status,"unavailable");
  // A resumed conversation carries its context to another model too, so a model change still compares; the model is recorded.
  const z=fixture();T.observe(z.e,z.a,claude("one",5000,100,"another-model"));assert.equal(z.e.startup.status,"compared");assert.equal(z.e.startup.first.model,"another-model");
  const first=fixture({baseline:null});T.observe(first.e,first.a,claude("one",5000));assert.match(first.e.startup.reason,/No earlier conversation/);
});
test("a recovery adds actual usage without manufacturing another startup comparison",()=>{
  const {e,a}=fixture();T.observe(e,a,claude("one",64000));T.finish(e,a,30);
  const retry=T.startAttempt(e,{agent:"claude",config:"same",at:40});T.observe(e,retry,claude("retry",70000));T.finish(e,retry,50);
  assert.equal(T.summary(e).inputTokens,134000);assert.equal(e.startup.difference,436000);assert.equal(e.startup.first.requestId,"one");
  const c=fixture({mode:"continue"});T.observe(c.e,c.a,claude("continue",100));assert.equal(c.e.startup.status,"continuation");
});
const codex = (total,last,turnId="turn",threadId="thread") => ({method:"thread/tokenUsage/updated",params:{threadId,turnId,tokenUsage:{total,last}}});
const count = (inputTokens,outputTokens=100) => ({inputTokens,outputTokens,cachedInputTokens:0,cacheWriteInputTokens:0});
test("Codex uses cumulative deltas, ignores other threads and does not double-count repeated snapshots",()=>{
  const {e,a}=fixture({agent:"codex",baseline:{...base(),agent:"codex",model:"gpt"},resumed:true,cumulative:{inputTokens:1000,outputTokens:100,cacheReadInputTokens:0,cacheWriteInputTokens:0}});
  T.recordModel(e,a,"gpt"); const ctx={threadId:"thread",turnId:"turn",at:30};
  T.observe(e,a,codex(count(1500,200),count(500)),ctx);T.observe(e,a,codex(count(1500,200),count(500)),ctx);
  assert.equal(T.summary(e).inputTokens,500);assert.equal(e.startup.first.input,500);
  T.observe(e,a,codex(count(999999),count(100),"helper","other"),ctx);assert.equal(T.summary(e).inputTokens,500);
  T.observe(e,a,codex(count(2200,300),count(700)),ctx);assert.equal(T.summary(e).inputTokens,1200);
  T.observe(e,a,codex(count(1500,200),count(500)),ctx);assert.equal(T.summary(e).inputTokens,1200);assert.equal(a.complete,false);
});
test("Codex without a resumed baseline never attributes historical totals to this Work",()=>{
  const {e,a}=fixture({agent:"codex",resumed:true});T.recordModel(e,a,"gpt");
  T.observe(e,a,codex(count(500000),count(40000)),{threadId:"thread",turnId:"turn"});T.finish(e,a);
  assert.equal(T.summary(e).inputTokens,null);assert.equal(e.startup.status,"unavailable");
});
test("late Codex settings can resolve its measured first model without altering its request counters",()=>{
  const {e,a}=fixture({agent:"codex",baseline:{...base(),agent:"codex",model:"gpt"}});
  T.observe(e,a,codex(count(5000),count(5000)),{threadId:"thread",turnId:"turn"});
  T.recordModel(e,a,"gpt");assert.equal(e.startup.difference,495000);assert.equal(e.startup.first.model,"gpt");
  assert.equal(T.summary(e).inputTokens,5000);
});
test("a resumed Codex thread's repeated earlier total is not counted as a request",()=>{
  const {e,a}=fixture({agent:"codex",baseline:{...base(),agent:"codex"},resumed:true,cumulative:count(1000,100)});
  const ctx={threadId:"thread",turnId:"turn"};
  T.observe(e,a,codex(count(1000,100),count(400)),ctx);assert.equal(T.summary(e).requests,0);
  T.observe(e,a,codex(count(1300,150),count(300)),ctx);
  assert.equal(T.summary(e).requests,1);assert.equal(e.startup.first.input,300);assert.equal(T.summary(e).inputTokens,300);
});
test("another agent's conversation is no baseline; the task estimate is the start difference per measured request",()=>{
  const other=fixture({baseline:{...base(),agent:"codex"}});T.observe(other.e,other.a,claude("one",5000));
  assert.equal(other.e.startup.status,"unavailable");assert.match(other.e.startup.reason,/different agent/);
  const {e,a}=fixture();T.observe(e,a,claude("one",50000));T.observe(e,a,claude("two",60000));
  const s=T.summary(e);assert.equal(s.startup.difference,450000);assert.equal(s.startup.percent,90);assert.equal(s.startup.requests,2);assert.equal(s.startup.taskEstimate,900000);
  assert.equal(T.aggregate([s]).taskEstimate,900000);
});
test("a new task stored without a baseline is compared when its agent's earlier conversation is known later",()=>{
  const {e,a}=fixture({baseline:null});T.observe(e,a,claude("one",40000));T.finish(e,a);
  const s=T.summary(e);assert.equal(s.startup.status,"unavailable");
  const later=T.withBaseline(s,base(400000));assert.equal(later.startup.status,"compared");assert.equal(later.startup.difference,360000);assert.equal(later.startup.taskEstimate,360000);
  assert.equal(T.withBaseline({...s,taskMode:"continue"},base()).startup.status,"unavailable","a continuation is never given a saving");
});
test("aggregation deduplicates merged Works, includes negative starts and attributes usage to recorded event dates",()=>{
  const a=fixture();T.observe(a.e,a.a,claude("one",64000),{at:Date.UTC(2026,10,14,23,59)});
  const b=fixture({baseline:base(100)});b.e.workId="p/line/work-2";T.observe(b.e,b.a,claude("two",1000),{at:Date.UTC(2026,10,15,0,1)});
  const rows=[T.summary(a.e),T.summary(b.e)];const s=T.aggregate([...rows,rows[0]]);
  assert.equal(s.difference,435100);assert.equal(s.inputTokens,65000);assert.equal(s.compared,2);
  const p=T.projectSummary(rows);assert.deepEqual(p.daily.map(x=>x.day),["2026-11-14","2026-11-15"]);
  assert.equal(T.aggregate(rows,Date.UTC(2026,10,15)).inputTokens,1000);
  assert.equal(T.aggregate([]).difference,null);assert.equal(T.aggregate([]).inputTokens,null);
});
const readTool = (id,file) => ({type:"assistant",message:{id,model:"opus",usage:{input_tokens:10,cache_read_input_tokens:0,cache_creation_input_tokens:0,output_tokens:1},content:[{type:"tool_use",id:`use-${id}`,name:"Read",input:{file_path:file}}]}});
const readResult = (id,chars) => ({type:"user",message:{content:[{type:"tool_result",tool_use_id:`use-${id}`,content:"x".repeat(chars)}]}});
// A fresh Work of three requests after a 300k conversation; its first request re-read a file that conversation had read (22,000 characters, 10k tokens).
function freshAfter(baselineAt) {
  const {e,a}=fixture({baseline:{...base(300000),at:baselineAt}});
  T.observe(e,a,readTool("one","/code/app.js"),{at:30});T.observe(e,a,claude("one",40000),{at:30});T.observe(e,a,readResult("one",22000));
  T.observe(e,a,claude("two",50000),{at:31});T.observe(e,a,claude("three",52000),{at:32});T.finish(e,a);
  const earlier=T.create({workId:"p/line/work-0",taskId:"old",taskMode:"earlier",baseline:null,at:1}),old=T.startAttempt(earlier,{agent:"claude",config:"same"});
  T.observe(earlier,old,readTool("old","/code/app.js"));T.observe(earlier,old,readResult("old",500));
  return {s:T.summary(e,{events:false}),prior:{keys:T.readKeysOf(T.summary(earlier))}};
}
test("a fresh start is compared with resuming in tokens and in cost, re-reads and cache state counted",()=>{
  const {s,prior}=freshAfter(10), k=T.withBaseline(s,null,prior).startup.cost;
  assert.equal(k.rereads,"matched");assert.equal(k.rereadTokens,10000);assert.equal(k.skippedRequests,0);
  // Resumed: 300k, then 300k + 10k grown - 10k not re-read, then 302k. Fresh: what ran.
  assert.equal(k.resumed.tokensIn,902000);assert.equal(k.fresh.tokensIn,142000);assert.equal(k.tokensPercent,84.3);
  // Weighed by list price: cache hit 0.1x (not Opus 5), write 2x, output 5x. Within the hour the old conversation is a cache hit.
  assert.equal(k.cache,"warm");assert.equal(k.fresh.cost,15784);assert.equal(k.resumed.cost,95500);assert.equal(k.costPercent,83.5);
  assert.deepEqual(k.otherCache,{cache:"expired",costPercent:97.3});
  const later=T.withBaseline(freshAfter(30-2*3600000).s,null,prior).startup.cost;
  assert.equal(later.cache,"expired");assert.equal(later.costPercent,97.3);assert.equal(later.idleMinutes,120);
  // Without the old conversation's reads, every read counts as a re-read: the saving can only come out smaller.
  assert.equal(T.withBaseline(s,null,null).startup.cost.rereads,"every read counted");
  assert.equal(T.forPage(s).series,undefined);assert.equal(T.forPage(s).reads,undefined);
  const total=T.aggregate([T.withBaseline(s,null,prior)]).cost;assert.equal(total.costPercent,83.5);assert.equal(total.tokensPercent,84.3);
});
// PE-927: what is shown must be sure. A saved record of the shape Antigravity leaves (no model on its requests, the attempt names it),
// compared with a 158k conversation last used `idleMinutes` before.
function geminiWork(idleMinutes, rows=[[12943,0,562],[15268,12944,382],[19810,15269,375]]) {
  const at=1e12, requests=rows.map(([input,cached,out],n)=>({id:`step:${n}`,model:"",at:at+n*1000,inputTokens:input,outputTokens:out,cacheReadInputTokens:cached,cacheWriteInputTokens:null}));
  const sum=k=>requests.reduce((n,r)=>n+r[k],0);
  return T.summary({schemaVersion:1,comparisonVersion:"previous-input-v1",readsVersion:2,workId:"p/line/work-9",taskId:"t",taskMode:"new",continuedFromWork:"",manifest:"",createdAt:at,
    attempts:[{id:"a",agent:"antigravity",config:"c",sessionId:"",resumed:false,startedAt:at,model:"gemini-4-neon",requests,events:[],reads:[],
      totals:{inputTokens:sum("inputTokens"),outputTokens:sum("outputTokens"),cacheReadInputTokens:sum("cacheReadInputTokens"),cacheWriteInputTokens:null},source:"Antigravity step usage",complete:false,endedAt:at+5000}],
    startup:{status:"compared",reason:"",baseline:{requestId:"old:91",input:158040,model:"",agent:"antigravity",at:at-idleMinutes*60000},first:{requestId:"step:0",input:12943,model:"",agent:"antigravity",at},difference:145097}},{events:false});
}
test("a cache whose life is not known is counted as still warm: the smaller saving is the one shown, the other is given beside it",()=>{
  const s=geminiWork(63), k=s.startup.cost;
  assert.equal(s.startup.first.model,"gemini-4-neon","the model is the one the attempt ran, when its requests name none");
  // Gemini's cache is taken as one hour for choosing a fresh start, but nobody publishes when it ends: 63 minutes is not known.
  assert.equal(k.cache,"unknown");assert.equal(k.idleMinutes,63);
  assert.deepEqual(Object.keys(k.otherCache),["cache","costPercent"]);assert.equal(k.otherCache.cache,"expired");
  assert.ok(k.costPercent<k.otherCache.costPercent,`${k.costPercent} is the smaller of the two (${k.otherCache.costPercent})`);
  const warm=geminiWork(30).startup.cost, gone=geminiWork(25*60).startup.cost;
  assert.equal(warm.cache,"warm");assert.equal(warm.costPercent,k.costPercent,"counted exactly as a warm cache is");
  assert.equal(gone.cache,"expired");assert.equal(gone.costPercent,k.otherCache.costPercent,"after a day no cache holds it");
  assert.equal(gone.otherCache.cache,"warm");
  // Claude Code's cache is known to end after its hour.
  assert.equal(T.weightsFor("claude","opus").cacheMost,60);assert.equal(T.weightsFor("antigravity","gemini-4-neon").cacheMost,24*60);
  // Codex's was measured: after three hours it is gone (PE-1180).
  assert.equal(T.weightsFor("codex","gpt-6.2-sol").cacheMost,180);assert.equal(T.weightsFor("codex","gpt-6.2-sol").cacheMinutes,60);
  // What each side's cost is made of adds up to it: the page's picture draws these.
  const sum=list=>list.reduce((n,x)=>n+x,0);
  assert.ok(Math.abs(sum(k.parts.fresh)-k.fresh.cost)<=2);assert.ok(Math.abs(sum(k.parts.resumed)-k.resumed.cost)<=2);
  assert.ok(k.parts.resumed[0]>k.parts.resumed[1],"most of resuming is the earlier conversation, sent again with every request");
  // The same three parts on both sides: what every request sends again, this Work's own context, output.
  assert.equal(k.parts.fresh.length,3);assert.equal(k.parts.fresh[2],k.parts.resumed[2],"the output is the same work on both sides");
  // The fresh start is 12,943 tokens: new input once, then a cache hit (0.1x) in each of the two later requests.
  assert.equal(k.parts.fresh[0],Math.round(12943+2*12943*0.1));
  assert.ok(k.parts.fresh[0]<k.parts.resumed[0]/3,"what is sent again with every request is where the saving is");
  assert.equal(k.fresh.usd,undefined);assert.equal(k.prices.source,"typical");
});
// PE-1180, "18% more cost": Work 1 ran on Fable 5.2 and Work 2 on Opus 5.5, whose cache has nothing of Fable's.
test("after a change of model nothing of the earlier conversation is in the cache, however short the pause",()=>{
  const costOf=(firstModel,baseline,prior)=>{
    const {e,a}=fixture({baseline:{...base(81500),at:10,...baseline}});
    for(const [id,input,cached] of [["one",36768,13472],["two",44071,36766],["three",49048,44069]])
      T.observe(e,a,{type:"assistant",message:{id,model:firstModel,usage:{input_tokens:2,cache_read_input_tokens:cached,cache_creation_input_tokens:input-cached-2,output_tokens:100},content:[]}},{at:30});
    T.finish(e,a);return T.withBaseline(T.summary(e,{events:false}),prior||null,{keys:new Set()}).startup.cost;
  };
  const same=costOf("claude-opus-5-5",{model:"claude-opus-5-5"}),changed=costOf("claude-opus-5-5",{model:"claude-fable-5-2"});
  assert.equal(same.cache,"warm");assert.ok(same.costPercent<0,"a fresh start this short costs more than a warm cache");
  assert.equal(changed.cache,"model");assert.equal(changed.otherCache,undefined,"no cache state to be unsure of");
  assert.equal(changed.fresh.cost,same.fresh.cost);assert.ok(changed.costPercent>0);assert.equal(changed.costPercent,same.otherCache.costPercent,"the whole conversation is written again, as when it expired");
  assert.ok(Math.abs(changed.parts.resumed.reduce((n,x)=>n+x,0)-changed.resumed.cost)<=2);
  // The same model under another name, and a name that does not say which model it is, are no sure change.
  for(const held of ["claude-opus-5-5[1m]","claude-opus-5-5-20260901","gateway/claude-opus-5-5","Claude-Opus-5-5","opus",""]) assert.equal(costOf("claude-opus-5-5",{model:held}).cache,"warm",held);
  assert.equal(costOf("opus",{model:"claude-fable-5-2"}).cache,"warm");
  assert.equal(costOf("gpt-6.1-sol#high",{model:"gpt-6.1-sol"}).cache,"warm","another effort is the same model");
  assert.equal(costOf("gpt-6.1-sol",{model:"gpt-6.2-astra"}).cache,"model");
  // A conversation that ran on both models has a part of it in this one's cache.
  assert.equal(costOf("claude-opus-5-5",{model:"claude-fable-5-2",models:["claude-opus-5-5","claude-fable-5-2"]}).cache,"warm");
  // A comparison saved before that was recorded takes it from the earlier Work, found again by its last request.
  const work=T.create({workId:"p/line/work-0",taskId:"old",taskMode:"earlier",baseline:null,at:1}),old=T.startAttempt(work,{agent:"claude",config:"same"});
  T.observe(work,old,claude("a",70000,10,"claude-opus-5-5"));T.observe(work,old,claude("old-request",81500,10,"claude-fable-5-2"));T.finish(work,old);
  const last=T.summary(work).lastRequest;assert.deepEqual(last.models,["claude-opus-5-5","claude-fable-5-2"]);
  assert.equal(costOf("claude-opus-5-5",{model:"claude-fable-5-2"},last).cache,"warm");
  const one=T.create({workId:"p/line/work-0",taskId:"old",taskMode:"earlier",baseline:null,at:1}),only=T.startAttempt(one,{agent:"claude",config:"same"});
  T.observe(one,only,claude("old-request",81500,10,"claude-fable-5-2"));assert.equal("models" in T.summary(one).lastRequest,false,"nothing to add when one model ran it");
});
test("a cache miss mid-Work and a helper's request cost the same on both sides, not only on the fresh one",()=>{
  // Work 4 of ask-all-your-sub-agents: Gemini found none of a 194k conversation in its cache once, and that alone made a fresh
  // start read as 16% dearer than resuming. Resuming would have lost this Work's own context there too; the earlier conversation,
  // cached long before, is counted as kept.
  const hit=geminiWork(30,[[12943,0,562],[15268,12944,382],[19810,15269,375],[21000,19811,300]]).startup.cost;
  const missed=geminiWork(30,[[12943,0,562],[15268,12944,382],[19810,0,375],[21000,19811,300]]).startup.cost;
  // Each side's cost is rounded, so a difference of two can be one off.
  assert.ok(Math.abs(missed.fresh.cost-hit.fresh.cost-15269*0.9)<=1,"the fresh side paid for all it lost");
  assert.ok(Math.abs(missed.resumed.cost-hit.resumed.cost-(15268-12943)*0.9)<=1,"resuming loses this Work's own context");
  // A request smaller than the conversation so far is a helper, or the conversation made shorter: it carries no earlier conversation.
  const helper=geminiWork(30,[[12943,0,562],[15268,12944,382],[3000,0,100],[16000,15269,300]]).startup.cost;
  const without=geminiWork(30,[[12943,0,562],[15268,12944,382],[16000,15269,300]]).startup.cost;
  assert.equal(helper.resumed.tokensIn-without.resumed.tokensIn,3000);
  assert.equal(helper.fresh.cost-without.fresh.cost,3000+100*6);assert.equal(helper.resumed.cost-without.resumed.cost,3000+100*6);
});
test("with the model's saved price the comparison is weighed by it and told in dollars; totals of Works on models priced apart are of dollars",t=>{
  t.after(()=>T.usePrices(null));
  const saved={ "gemini-4-neon":{model:"gemini-4-neon",input:3,cached:0.15,output:15}, opus:{model:"opus",input:4,cached:0.2,cacheWrite:5,output:20} };
  T.usePrices(model=>saved[model]||null);
  const k=geminiWork(63).startup.cost;
  assert.equal(k.prices.source,"saved");assert.equal(k.prices.model,"gemini-4-neon");
  assert.ok(Math.abs(k.prices.read-0.05)<1e-9);assert.equal(k.prices.output,5);assert.equal(k.prices.write,1,"Gemini charges nothing more to write its cache");
  // New input 19,808 at $3, cache hits 28,213 at $0.15, output 1,319 at $15, per million.
  assert.equal(k.fresh.usd,Math.round((19808*3+28213*0.15+1319*15)/1e6*1e4)/1e4);
  assert.ok(Math.abs(k.resumed.usd-k.resumed.cost*3/1e6)<1e-4);
  assert.ok(Math.abs(k.costPercent-100*(k.resumed.usd-k.fresh.usd)/k.resumed.usd)<0.3);
  // Claude Code writes its cache for an hour at twice new input, whatever the five-minute price saved for the model says.
  const {s,prior}=freshAfter(10), claudeRow=T.withBaseline(s,null,prior), c=claudeRow.startup.cost;
  assert.equal(c.prices.source,"saved");assert.equal(c.prices.write,2);assert.ok(Math.abs(c.prices.read-0.05)<1e-9);
  const both=T.aggregate([claudeRow,{...geminiWork(63),workId:"p/line/work-10"}]).cost;
  assert.equal(both.works,2);
  assert.ok(Math.abs(both.fresh.usd-(c.fresh.usd+k.fresh.usd))<1e-4);
  assert.ok(Math.abs(both.costPercent-100*(both.resumed.usd-both.fresh.usd)/both.resumed.usd)<0.06,"the percent is of dollars, not of each model's own tokens");
  // One Work with no saved price: the totals are of tokens weighed, as before, and name no dollars.
  delete saved.opus;
  const mixed=T.aggregate([T.withBaseline(freshAfter(10).s,null,prior),{...geminiWork(63),workId:"p/line/work-10"}]).cost;
  assert.equal(mixed.fresh.usd,undefined);assert.ok(mixed.costPercent>0);
});
test("a request that only re-read is left out of the resumed side, and Opus 5 cache hits weigh 0.05",()=>{
  const {e,a}=fixture({baseline:{...base(300000),at:10}});
  T.observe(e,a,claude("one",40000),{at:30});
  const two=claude("two",41000);two.message.content=readTool("two","/code/app.js").message.content;
  T.observe(e,a,two,{at:31});T.observe(e,a,readResult("two",2200));T.observe(e,a,claude("three",42000),{at:32});
  const k=T.withBaseline(T.summary(e),null,{keys:new Set(T.readKeysOf(T.summary(e)))}).startup.cost;
  // The re-read (1k tokens) and the request's own output (100) are not in the resumed context either.
  assert.equal(k.skippedRequests,1);assert.equal(k.resumed.tokensIn,300000+300000+42000-40000-1100);
  assert.equal(T.weightsFor("claude","claude-opus-5-5").read,0.05);assert.equal(T.weightsFor("codex","gpt-6.1-sol").cacheMinutes,60);
});
const shell = (id,command,result,model="opus") => [{type:"assistant",message:{id,model,usage:{input_tokens:10,cache_read_input_tokens:0,cache_creation_input_tokens:0,output_tokens:1},content:[{type:"tool_use",id:`use-${id}`,name:"Bash",input:{command}}]}},
  {type:"user",message:{content:[{type:"tool_result",tool_use_id:`use-${id}`,content:result}]}}];
test("the files a shell command reads are found after a cd too, as Claude Code reads most of them",()=>{
  const of=(command,cwd="/code")=>T.commandReads(command,cwd);
  assert.deepEqual(of("cd /repo; sed -n 1,20p src/a.js; rg -n foo src | head -40"),{files:["/repo/src/a.js"],parts:2,cwd:"/repo"});
  assert.deepEqual(of("cd /repo && cat a.md b.md | head -50; git status --short").files,["/repo/a.md","/repo/b.md"]);
  assert.deepEqual(of("cd ../docs && nl -ba x.md | sed -n '1,3p;5p' 2>/dev/null"),{files:["/docs/x.md"],parts:1,cwd:"/docs"});
  assert.deepEqual(of("sed -n -e 1,2p -e 4p /x/a.js; sed -ne 5p b.js; head -n 5 -- c.js; tail -20 d.js").files,["/x/a.js","/code/b.js","/code/c.js","/code/d.js"]);
  assert.deepEqual(of("ls | head; echo ===; cat \"/Users/h/线性 代数/a b.md\" '/lit/$Y'").files,["/Users/h/线性 代数/a b.md","/lit/$Y"]);
  assert.deepEqual(of("(cd /q; cat w); cat r; # cat no\ncat s").files,["/q/w","/code/r","/code/s"]);
  assert.deepEqual(of("git diff | sed -n 1,20p && if [ -f /p ]; then cat /p; fi"),{files:["/p"],parts:2,cwd:"/code"});
  // What the text does not say, and what is not shown, is no file read.
  for(const none of ["for f in a b; do sed -n 1p \"$f\"; done","cat /a/*.js","sed -i s/a/b/ /c","cat /o > /p","cat a &>/dev/null","cat > /tmp/x <<'EOF'\ncat /no/such\nEOF","ssh host 'cat /root/x'","echo cat /a/b","cat $(ls /a)","sed 's/a/b/'"])
    assert.deepEqual(of(none).files,[],none);
  assert.deepEqual(T.commandReads("cat a.md; cat /b.md").files,["/b.md"],"a relative name needs a known folder");
  assert.equal(of("cd \"$X\" && cat a").cwd,"");assert.deepEqual(T.commandReads("cat 'open; cd (","/code").files,["/code/open; cd ("],"half a command does no harm");
  // Claude Code's shell stays where a command left it, until it says it went back. The folder is kept only while the attempt runs.
  const {e,a}=fixture();T.observe(e,a,{type:"system",subtype:"init",session_id:"s",cwd:"/code"});
  const read=k=>a.reads.at(-1).k.includes(T.readKeyOfFile(k));
  for(const o of shell("one","cat a.js","x"))T.observe(e,a,o);assert.ok(read("/code/a.js"));
  for(const o of shell("two","cd /docs && cat b.md","x\nShell cwd was reset to /code"))T.observe(e,a,o);assert.ok(read("/docs/b.md"));
  for(const o of shell("three","cat c.js; cd sub","x"))T.observe(e,a,o);assert.ok(read("/code/c.js"));
  for(const o of shell("four","cat d.js","x"))T.observe(e,a,o);assert.ok(read("/code/sub/d.js"));
  T.finish(e,a);assert.equal("cwd" in a,false);
  // The other agents start each command in their own folder, which PenEcho gave them, or in the one the call names.
  const oc=fixture({agent:"opencode"}),b=T.startAttempt(oc.e,{agent:"opencode",config:"same",cwd:"/code"});
  const use=input=>T.observe(oc.e,b,{type:"tool_use",part:{tool:"bash",state:{status:"completed",input,output:"x"}}});
  use({command:"cd /docs && cat b.md"});use({command:"cat a.js"});use({command:"cat a.js",workdir:"/other"});
  assert.deepEqual(b.reads.map(x=>x.k[1]),["/docs/b.md","/code/a.js","/other/a.js"].map(T.readKeyOfFile));
  // Codex names the files of a command it can follow; one it cannot is read here.
  const cx=fixture({agent:"codex",baseline:{...base(),agent:"codex"}}),item=(command,commandActions)=>T.observe(cx.e,cx.a,{method:"item/completed",params:{threadId:"thread",item:{type:"commandExecution",command,cwd:"/code",commandActions,aggregatedOutput:"x"}}},{threadId:"thread"});
  const inner="git diff | head && nl -ba src/p.js | sed -n 1,9p";item(`/bin/zsh -lc "${inner}"`,[{type:"unknown",command:inner}]);
  assert.deepEqual(cx.a.reads[0].k.slice(1),[T.readKeyOfFile("/code/src/p.js")]);assert.equal(cx.a.reads[0].n,2);
});
test("a command that showed several things counts for the part read before, and its request is left out only when all of it was",()=>{
  const read=command=>{
    const {e,a}=fixture({baseline:{...base(300000),at:10}});T.observe(e,a,{type:"system",subtype:"init",cwd:"/code"});
    T.observe(e,a,claude("one",40000),{at:30});
    const [use,result]=shell("two",command,"x".repeat(22000)),two=claude("two",41000);two.message.content=use.message.content;
    T.observe(e,a,two,{at:31});T.observe(e,a,result);T.observe(e,a,claude("three",52000),{at:32});T.finish(e,a);
    return T.withBaseline(T.summary(e),null,{keys:new Set(["/code/a.js","/code/b.js"].map(T.readKeyOfFile))}).startup.cost;
  };
  const half=read("cat a.js; rg -n foo src"),both=read("cat a.js b.js"),none=read("cat c.js; rg -n foo src");
  assert.equal(half.rereadTokens,5000);assert.equal(half.skippedRequests,0,"its search was new");
  assert.equal(both.rereadTokens,10000);assert.equal(both.skippedRequests,1);
  assert.equal(none.rereadTokens,0);assert.equal(none.skippedRequests,0);
  // Reads recorded before the parts were (version 2) count whole, as they did.
  const {e,a}=fixture({baseline:{...base(300000),at:10}});T.observe(e,a,claude("one",40000),{at:30});a.reads=[{q:0,k:["c","f","g"],c:22000}];T.observe(e,a,claude("two",52000),{at:31});T.finish(e,a);
  assert.equal(T.withBaseline({...T.summary(e)},null,{keys:new Set(["f"])}).startup.cost.rereadTokens,10000);
});
test("Codex command reads are recorded from completed items of its own thread",()=>{
  const {e,a}=fixture({agent:"codex",baseline:{...base(),agent:"codex"}});
  const item=(threadId,type="commandExecution")=>({method:"item/completed",params:{threadId,item:{type,command:"cat /a/b.md",commandActions:[{type:"read",path:"/a/b.md"}],aggregatedOutput:"hello"}}});
  T.observe(e,a,item("thread"),{threadId:"thread"});T.observe(e,a,item("other"),{threadId:"thread"});T.observe(e,a,item("thread","fileChange"),{threadId:"thread"});
  assert.equal(a.reads.length,2);assert.equal(a.reads[0].k.length,2);assert.equal(a.reads[0].c,5);assert.deepEqual(a.reads[1].k,[]);
});
test("reads read back from the run log join saved usage only when each attempt matches",()=>{
  const B=require("../src/server/project-lines/token-backfill.js");
  const saved={...fixture().e,readsVersion:undefined,attempts:[{requests:[{id:"one"}],reads:undefined}]};
  const log={attempts:[{requests:[{id:"one"}],reads:[{q:0,k:["k"],c:9}]}]};
  assert.deepEqual(B.withReads(saved,log).attempts[0].reads,[{q:0,k:["k"],c:9}]);assert.equal(B.withReads(saved,log).readsVersion,T.READS_VERSION);
  assert.equal(B.withReads(saved,{attempts:[{requests:[{id:"else"},{id:"more"}],reads:[]}]}),null);
  // Reads already recorded are replaced by the log's only when it holds them all: a log cut short keeps what was recorded.
  const before={...saved,readsVersion:2,attempts:[{requests:[{id:"one"}],reads:[{q:0,k:["c"],c:9},{q:0,k:["d"],c:9}]}]};
  assert.equal(T.readsRecorded(before),true,"version 2 is still recorded");assert.equal(B.withReads(before,log),null);
  const full={attempts:[{requests:[{id:"one"}],reads:[{q:0,k:["c","f"],c:9},{q:0,k:["d"],c:9}]}]};
  assert.deepEqual(B.withReads(before,full).attempts[0].reads,full.attempts[0].reads);assert.equal(B.withReads(before,full).readsVersion,3);
});
// The shapes below are copied from real runs of each agent in PenEcho's run logs.
const other=agent=>fixture({agent,baseline:{...base(100000),agent}});
test("dsh, OpenCode, Antigravity and Kimi each count one request per usage report, with their reads",()=>{
  const dsh=other("dsh");
  T.observe(dsh.e,dsh.a,{type:"tool_call",callId:"c1",tool:"read",input:{file_path:"/a/b.md"}});
  T.observe(dsh.e,dsh.a,{type:"tool_result",callId:"c1",status:"completed",result:"x".repeat(220)});
  T.observe(dsh.e,dsh.a,{type:"status",phase:"step_end",turn:1,step:1,usage:{inputTokens:2302,outputTokens:132,cacheReadTokens:3200,cacheWriteTokens:0,totalTokens:5634}},{at:30});
  T.observe(dsh.e,dsh.a,{type:"status",phase:"step_end",turn:1,step:2,usage:{inputTokens:1056,outputTokens:169,cacheReadTokens:5632,totalTokens:6857}},{at:31});
  assert.equal(T.summary(dsh.e).inputTokens,5502+6688);assert.equal(T.summary(dsh.e).cacheReadInputTokens,8832);
  assert.equal(dsh.e.startup.status,"compared");assert.equal(dsh.e.startup.first.input,5502);
  // dsh gives a request's usage after its tools ran, so the read goes with that request.
  assert.deepEqual(dsh.a.reads.map(x=>[x.q,x.c]),[[0,220]]);
  const oc=other("opencode");
  T.observe(oc.e,oc.a,{type:"tool_use",part:{tool:"read",state:{status:"completed",input:{filePath:"/a/b.md"},output:"hello"}}});
  T.observe(oc.e,oc.a,{type:"step_finish",timestamp:1,part:{messageID:"m1",modelID:"opencode-go/deepseek-v4.1-flash",providerID:"magpie",tokens:{total:12400,input:1083,output:168,reasoning:13,cache:{write:0,read:11136}}}});
  assert.equal(oc.a.requests[0].model, "deepseek-v4.1-flash");
  assert.equal(T.summary(oc.e).inputTokens,12219);assert.equal(T.summary(oc.e).outputTokens,181,"reasoning is paid as output");
  assert.deepEqual(oc.a.reads.map(x=>[x.q,x.c]),[[0,5]]);assert.deepEqual(oc.a.reads[0].k,dsh.a.reads[0].k,"the same file is the same key for every agent");
  const ag=other("antigravity");
  T.observe(ag.e,ag.a,{event:"step_update",step_update:{conversation_id:"c",step_index:1,state:"DONE",step_type:"agent_response",usage:{input_tokens:12099,output_tokens:717,thinking_tokens:459,cache_read_tokens:0,total_tokens:12816}}});
  T.observe(ag.e,ag.a,{event:"step_update",step_update:{conversation_id:"c",step_index:2,state:"DONE",step_type:"tool",tool_name:"view_file",tool_info:{name:"view_file",parameters:{AbsolutePath:"\"/a/b.md\""},output:"hi"}}});
  T.observe(ag.e,ag.a,{event:"step_update",step_update:{conversation_id:"c",step_index:7,state:"DONE",step_type:"agent_response",usage:{input_tokens:9875,output_tokens:878,thinking_tokens:636,cache_read_tokens:12100,total_tokens:10753}}});
  // Its input leaves the cache out, and its output already holds the thinking.
  assert.equal(T.summary(ag.e).inputTokens,12099+21975);assert.equal(T.summary(ag.e).cacheReadInputTokens,12100);assert.equal(T.summary(ag.e).outputTokens,1595);
  assert.deepEqual(ag.a.reads.map(x=>x.q),[0]);assert.deepEqual(ag.a.reads[0].k,dsh.a.reads[0].k);
  const ki=other("kimi");
  T.observe(ki.e,ki.a,{type:"usage.record",model:"magpie/moonshot-cn/kimi-k3.1-pro",usage:{inputOther:4596,output:332,inputCacheRead:18944,inputCacheCreation:0},time:50},{at:50});
  T.observe(ki.e,ki.a,{type:"context.append_loop_event",event:{type:"tool.call",toolCallId:"R1",name:"Read",args:{path:"/a/b.md"}},time:51});
  T.observe(ki.e,ki.a,{type:"context.append_loop_event",event:{type:"tool.result",toolCallId:"R1",result:{output:"abc"}},time:52});
  T.observe(ki.e,ki.a,{type:"usage.record",model:"magpie/moonshot-cn/kimi-k3.1-pro",usage:{inputOther:1579,output:73,inputCacheRead:23296,inputCacheCreation:0},time:53},{at:53});
  assert.equal(T.summary(ki.e).requests,2);assert.equal(T.summary(ki.e).inputTokens,23540+24875);assert.equal(ki.e.startup.first.model,"kimi-k3.1-pro");
  assert.equal(T.summary(ki.e).lastRequest.model, "kimi-k3.1-pro");
  assert.deepEqual(ki.a.reads.map(x=>[x.q,x.c]),[[0,3]]);
});

test("Pi and omp record bare request model IDs and still read historical evidence", () => {
  for (const agent of ["pi", "omp"]) {
    const { e, a } = other(agent);
    T.observe(e, a, { type:"message_end", message:{ role:"assistant", id:"a", provider:"magpie", model:"opencode-go/deepseek-v4.1-flash",
      usage:{ input:100, output:10, cacheRead:0, cacheWrite:0 } } });
    assert.equal(a.requests[0].model, "deepseek-v4.1-flash");
    assert.equal(T.summary(e).lastRequest.model, "deepseek-v4.1-flash");
    a.requests[0].model = e.startup.first.model = "magpie/opencode-go/deepseek-v4.1-flash";
    e.startup.baseline.model = "deepseek/deepseek-flash";
    const summary = T.summary(e);
    assert.equal(summary.lastRequest.model, "deepseek-v4.1-flash");
    assert.equal(summary.requestModel, "deepseek-v4.1-flash");
    assert.equal(summary.requestModelId, "magpie/opencode-go/deepseek-v4.1-flash");
    assert.equal(summary.startup.first.model, "deepseek-v4.1-flash");
    assert.equal(summary.startup.baseline.model, "deepseek-flash");
  }
});
test("each agent's own price ratios, and reads counted as recorded only where PenEcho could see them",()=>{
  assert.equal(T.weightsFor("dsh","").name,"DeepSeek");assert.equal(T.weightsFor("antigravity","gemini-4-hydrogen").name,"Gemini");
  assert.equal(T.weightsFor("kimi","kimi-k3.1-pro").name,"Kimi");assert.equal(T.weightsFor("opencode","deepseek/deepseek-chat").name,"DeepSeek");
  // The model wins over the agent: Claude Code running a DeepSeek model pays DeepSeek's prices.
  assert.equal(T.weightsFor("claude","deepseek-v4").name,"DeepSeek");assert.equal(T.weightsFor("claude","").name,"Claude");
  assert.equal(T.weightsFor("opencode","").name,"Other agents");
  const v1=agent=>({readsVersion:1,attempts:[{agent,reads:[]}]});
  assert.equal(T.readsRecorded(v1("claude")),true);assert.equal(T.readsRecorded(v1("antigravity")),false);
  assert.equal(T.readsRecorded({readsVersion:T.READS_VERSION,attempts:[{agent:"antigravity",reads:[]}]}),true);
});
test("evidence saved with no usage is filled in from the run log and compared again",()=>{
  const B=require("../src/server/project-lines/token-backfill.js");
  const {e,a}=other("antigravity");T.finish(e,a);
  assert.equal(e.startup.status,"unavailable");assert.equal(T.hasUsage(e),false);
  const log=B.sections(["--- 2026-11-15 04:17 Work 1 (antigravity)",
    JSON.stringify({event:"init",conversation_id:"c",init:{model:"gemini-4-hydrogen"}}),
    JSON.stringify({event:"step_update",step_update:{conversation_id:"c",step_index:1,state:"DONE",step_type:"agent_response",usage:{input_tokens:12099,output_tokens:717,cache_read_tokens:0}}}),
    JSON.stringify({event:"step_update",step_update:{conversation_id:"c",step_index:7,state:"DONE",step_type:"agent_response",usage:{input_tokens:9875,output_tokens:878,cache_read_tokens:12100}}})].join("\n"));
  const fromLog=B.evidenceFor({workId:"w",runs:log});
  const filled=B.withUsage(JSON.parse(JSON.stringify(e)),fromLog);
  assert.equal(filled.startup.status,"compared");assert.equal(filled.startup.first.input,12099);assert.equal(filled.startup.baseline.input,100000);
  assert.equal(T.summary(filled).requests,2);assert.equal(T.summary(filled).readsKnown,true);
  assert.equal(filled.attempts[0].requests[0].at>=a.startedAt,true,"a request is never placed before its attempt began");
  assert.equal(B.withUsage(filled,fromLog),null,"saved usage is never replaced");
  // Kimi's usage is in its own log, found from the session the run log names.
  const kimiRun=B.sections(["--- 2026-11-15 04:17 Work 1 (kimi)",JSON.stringify({role:"meta",type:"session.resume_hint",session_id:"session_x"})].join("\n"));
  const asked=[];const kimi=(id,since,until)=>{asked.push([id,since,until]);return [{type:"usage.record",usage:{inputOther:10,output:2,inputCacheRead:90,inputCacheCreation:0},time:since+5}];};
  assert.equal(T.summary(B.evidenceFor({workId:"w",runs:kimiRun,kimi})).inputTokens,100);assert.equal(asked[0][0],"session_x");assert.equal(asked[0][2],Infinity);
});
test("PenEcho harness usage is disjoint input and cannot be counted as a Claude invocation aggregate",()=>{
  const {e,a}=fixture({agent:"penecho",baseline:null});
  T.observe(e,a,{type:"assistant",usage_format:"harness",message:{id:"one",model:"deepseek",usage:{inputTokens:100,cacheReadTokens:200,cacheWriteTokens:30,outputTokens:40}}});
  T.observe(e,a,{type:"result",usage:{inputTokens:1,outputTokens:2}});
  assert.equal(T.summary(e).inputTokens,330);assert.equal(T.summary(e).outputTokens,40);
  const complete=T.normalize({inputTokens:200,outputTokens:40,totalTokens:360,cacheReadTokens:120},"harness");
  assert.equal(complete.inputTokens,320);assert.equal(complete.cacheWriteInputTokens,null,"unreported categories are not fabricated");
  assert.equal(T.normalize({inputTokens:200,outputTokens:40,totalTokens:100,cacheReadTokens:120},"harness").inputTokens,null);
});
test("a Work done in Claude desktop gets its usage from the transcript, once per request and only in its own time",()=>{
  const B=require("../src/server/project-lines/token-backfill.js");
  const at=t=>new Date(t).toISOString(), usage=(i,o)=>({input_tokens:5,cache_read_input_tokens:i,cache_creation_input_tokens:5,output_tokens:o});
  const line=(t,id,u,more={})=>JSON.stringify({type:"assistant",timestamp:at(t),sessionId:"s1",message:{id,model:"claude-opus-5-5",usage:u,content:[{type:"text",text:"x"}]},...more});
  const text=[
    line(1000,"before",usage(900,9)),
    // One reply written as two content blocks, then a second request.
    line(5000,"m1",usage(100,10)),line(5001,"m1",usage(100,10)),line(6000,"m2",usage(200,20)),
    // A helper's request is not the conversation's.
    line(6500,"helper",usage(50,5),{isSidechain:true}),
    "not json",
    line(9000,"after",usage(900,9)),
  ].join("\n");
  const e=B.fromTranscript({workId:"p/line/work-3",text,since:4000,until:7000,via:"Claude desktop"});
  assert.deepEqual(e.attempts[0].requests.map(r=>r.id),["m1","m2"]);
  const s=T.summary(e,{events:false});
  assert.equal(s.inputTokens,110+210);assert.equal(s.cacheReadInputTokens,300);assert.equal(s.outputTokens,30);
  assert.equal(s.startup.status,"app");assert.match(s.startup.reason,/Claude desktop/);
  assert.equal(B.fromTranscript({workId:"x",text,since:7000,until:8000}),null,"nothing measured in that time");
});
test("a Work done in the Codex app gets its usage from the rollout, once per request and only in its own time (PE-503)",()=>{
  const B=require("../src/server/project-lines/token-backfill.js");
  const at=t=>new Date(t).toISOString(), u=(i,c,o)=>({input_tokens:i,cached_input_tokens:c,cache_write_input_tokens:0,output_tokens:o,reasoning_output_tokens:0,total_tokens:i+o});
  const count=(t,total,last)=>JSON.stringify({timestamp:at(t),type:"event_msg",payload:{type:"token_count",info:{total_token_usage:total,last_token_usage:last}}});
  const lines=[
    JSON.stringify({timestamp:at(500),type:"turn_context",payload:{model:"gpt-6.1-codex"}}),
    count(1000,u(1000,0,10),u(1000,0,10)),
    // The Work's two requests; Codex repeats the second total once.
    count(5000,u(3000,800,30),u(2000,800,20)),count(6000,u(6000,2600,70),u(3000,1800,40)),count(6001,u(6000,2600,70),u(3000,1800,40)),
    "not json",
    count(9000,u(9000,5000,90),u(3000,2400,20)),
  ];
  const e=B.fromRollout({workId:"p/line/work-5",lines,since:4000,until:7000,via:"Codex desktop",threadId:"t1"});
  assert.equal(e.attempts[0].requests.length,2);
  const s=T.summary(e,{events:false});
  assert.equal(s.inputTokens,5000);assert.equal(s.cacheReadInputTokens,2600);assert.equal(s.outputTokens,60);
  assert.equal(e.attempts[0].requests[0].model,"gpt-6.1-codex");
  assert.equal(s.startup.status,"app");assert.match(s.startup.reason,/Codex desktop/);
  assert.equal(B.fromRollout({workId:"x",lines,since:7000,until:8000}),null,"nothing measured in that time");
});
// From a real steered Work: each result covers its own turn only, one is all zero, and requests stream a placeholder output.
const turnResult=(uuid,read,out)=>({type:"result",uuid,usage:{input_tokens:5,cache_read_input_tokens:read,cache_creation_input_tokens:1000,output_tokens:out}});
test("a Claude Work of several turns adds up each turn's result, never counting less than its own requests",()=>{
  const {e,a}=fixture();
  T.observe(e,a,claude("one",64000,8));T.observe(e,a,turnResult("r1",60000,5000));
  T.observe(e,a,claude("two",70000,6));T.observe(e,a,turnResult("r2",0,0));T.observe(e,a,turnResult("r2",0,0));
  T.observe(e,a,{type:"result",uuid:"r3",usage:{input_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0,output_tokens:0}});
  T.observe(e,a,claude("three",80000,9));T.observe(e,a,turnResult("r4",75000,3000));T.observe(e,a,turnResult("r4",75000,3000));
  const s=T.summary(e);
  assert.equal(s.outputTokens,8000,"turns add up; a repeated result is one turn");
  assert.equal(s.inputTokens,214000,"input is never less than the requests' own");
  assert.equal(a.events.reduce((n,x)=>n+x.outputTokens,0),8000);
  // Evidence saved by the old rule kept only the last turn: its input reads back from its requests.
  const old=JSON.parse(JSON.stringify(e));old.attempts[0].totals={inputTokens:0,outputTokens:0,cacheReadInputTokens:0,cacheWriteInputTokens:0};
  assert.equal(T.summary(old).inputTokens,214000);
});
test("Claude totals cut to one turn are mended once from the run log, matched by first request",()=>{
  const B=require("../src/server/project-lines/token-backfill.js");
  const {e,a}=fixture();T.observe(e,a,claude("one",64000,8));T.observe(e,a,claude("two",70000,6));T.finish(e,a);
  // As the old rule left it: a zero last turn replaced the totals, and its event took them back out.
  const was=a.totals;e.attempts[0].events.push({at:50,...Object.fromEntries(Object.entries(was).map(([k,v])=>[k,-v]))});
  e.attempts[0].totals={inputTokens:0,outputTokens:0,cacheReadInputTokens:0,cacheWriteInputTokens:0};
  const log=B.sections(["--- 2026-11-15 04:17 Work 1 (claude)",JSON.stringify(claude("one",64000,8)),JSON.stringify(turnResult("r1",60000,5000)),
    JSON.stringify(claude("two",70000,6)),JSON.stringify(turnResult("r2",68000,2000)),JSON.stringify(turnResult("r3",0,0))].join("\n"));
  const fromLog=B.evidenceFor({workId:"w",runs:log});
  const mended=B.withTotals(JSON.parse(JSON.stringify(e)),fromLog);
  assert.equal(T.summary(mended).outputTokens,7000);assert.ok(mended.totalsMended);
  assert.equal(mended.attempts[0].events.reduce((n,x)=>n+(x.outputTokens||0),0),7000,"period totals follow the mended totals");
  assert.deepEqual(mended.startup,e.startup,"the comparison it was saved with stays");
  assert.equal(B.withTotals(mended,fromLog),null,"nothing changes the second time");
  assert.equal(B.withTotals(e,{attempts:[{requests:[{id:"else"}],totals:fromLog.attempts[0].totals,reported:fromLog.attempts[0].reported}]}),null);
});
test("a Work meant to continue that could not resume its conversation says it started a new one",()=>{
  const fresh=fixture({mode:"continue"});T.observe(fresh.e,fresh.a,claude("one",5000));
  assert.equal(T.summary(fresh.e).startup.status,"recovered");assert.match(T.summary(fresh.e).startup.reason,/started a new one/);
  const resumed=fixture({mode:"continue",resumed:true});T.observe(resumed.e,resumed.a,claude("one",5000));
  assert.equal(T.summary(resumed.e).startup.status,"continuation");
  assert.equal(T.withBaseline(T.summary(fresh.e),base()).startup.status,"recovered","no saving is claimed for it");
});
test("a running Claude Work takes each ended request's real output from the transcript, never an earlier Work's",()=>{
  const {e,a}=fixture();T.observe(e,a,claude("one",64000,2));T.observe(e,a,claude("two",65000,3));
  const before=T.summary(e);assert.equal(before.outputTokens,5);
  const {touched,unknown}=T.settleOutput(e,a,[{id:"one",usage:{output_tokens:724}},{id:"one",usage:{output_tokens:724}},{id:"earlier-work",usage:{output_tokens:9000}}],50);
  assert.equal(touched,true);assert.deepEqual(unknown,["earlier-work"]);
  const after=T.summary(e);assert.equal(after.outputTokens,727);assert.equal(after.series[0][3],724);
  assert.equal(a.events.reduce((n,x)=>n+(x.outputTokens||0),0),727,"period totals get the same output");
  assert.ok(after.startup.cost.costPercent<before.startup.cost.costPercent,"placeholder output had made the percent read high");
  assert.equal(T.settleOutput(e,a,[{id:"one",usage:{output_tokens:724}}]).touched,false,"settling again changes nothing");
  // The turn's result then agrees, and is not added on top.
  T.observe(e,a,{type:"result",usage:{input_tokens:20,cache_read_input_tokens:128960,cache_creation_input_tokens:20,output_tokens:727}});
  assert.equal(T.summary(e).outputTokens,727);
});
test("the service reads a running Claude Work's transcript in steps, including a request that arrives before its streamed event",async t=>{
  const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{ Service }=require("../src/server/project-lines/service.js");
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"settle-")),file=path.join(dir,"s.jsonl");t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const line=(id,out,when=new Date(10000).toISOString())=>JSON.stringify({type:"assistant",timestamp:when,message:{id,usage:{output_tokens:out}}})+"\n";
  fs.writeFileSync(file,line("earlier-work",9000,new Date(0).toISOString())+line("one",724)+line("two",50));
  const {e,a}=fixture();a.sessionId="s";a.startedAt=10000;T.observe(e,a,claude("one",64000,2));
  let saved=0;const self={claudeTranscript:()=>file,saveTokens:()=>saved++};self.settleClaudeOutput=Service.prototype.settleClaudeOutput.bind(self);
  const run={tokenEvidence:e,tokenAttempt:a};
  await self.settleClaudeOutput({}, "line", run, true);
  assert.equal(a.requests[0].outputTokens,724);assert.equal(saved,1);assert.deepEqual([...run.transcript.waiting.keys()],["two"],"an earlier Work's request is never kept");
  T.observe(e,a,claude("two",65000,3));fs.appendFileSync(file,'{"type":"assistant","timestamp":"');
  await self.settleClaudeOutput({}, "line", run, true);
  assert.equal(T.summary(e).outputTokens,774,"the request seen in the transcript first is settled once its event arrives");
  fs.appendFileSync(file,new Date(10000).toISOString()+'","message":{"id":"two","usage":{"output_tokens":60}}}\n');
  await self.settleClaudeOutput({}, "line", run, true);
  assert.equal(T.summary(e).outputTokens,784,"a line half written at one look is read whole at the next");
});
