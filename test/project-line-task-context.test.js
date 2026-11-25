"use strict";
require("./helpers/safety.js");
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const F = require("../src/server/project-lines/format.js"), C = require("../src/server/project-lines/task-context.js"), { Service } = require("../src/server/project-lines/service.js");

test("141 Asks do not inflate the historical packet; UTF-8 excerpts stay bounded and source hashes change",()=>{
  const asks=Array.from({length:141},(_,i)=>F.askStep({words:`old-request-${i} `+"要求🐳".repeat(500)}));
  const md=F.initialLine({title:"A long Line",steps:[...asks.slice(0,-1),F.workStep({done:true,body:"Previous work"}),asks.at(-1),F.workStep({who:"claude"})]});
  const doc=F.parseLine(md),step=doc.steps.at(-1),previous=doc.steps.find(F.AGENT_LIKE);
  const args={slug:"long",doc,step,task:{id:"new-task",mode:"new"},topicText:md,previous,readDetail:()=>"## Result\n\n"+"Latest result 🐳".repeat(3000)};
  const a=C.historicalPacket(args),b=C.historicalPacket({...args,topicText:md+"\nChanged source"});
  assert.ok(a.historicalBytes <= 32768);assert.equal(Buffer.byteLength(a.text),a.historicalBytes);
  assert.doesNotMatch(a.text,/old-request-50/);assert.match(a.text,/Excerpt; open the source/);
  assert.ok(!a.text.includes("\ufffd"));assert.notEqual(a.sources[0].sha256,b.sources[0].sha256);
  const current="Current requirements: "+"keep every word 🐳 ".repeat(4000);
  const prompt=require("../src/server/project-lines/service.js").buildAsk({words:current,files:[],said:[]});
  assert.equal(prompt,current);assert.ok(Buffer.byteLength(prompt)>32768);
});
test("task-mode metadata survives Markdown round trips without changing the person's words",()=>{
  const md=F.initialLine({title:"Task modes",steps:[F.askStep({words:"Please continue.",taskMode:"continue"}),F.workStep({who:"fake"})]});
  const doc=F.parseLine(md);assert.equal(doc.asks[0].taskMode,"continue");assert.equal(doc.asks[0].text,"Please continue.");
  const after=F.parseLine(F.updateSteps(md,steps=>{steps.at(-1).done=true;}));assert.equal(after.asks[0].taskMode,"continue");
});
test('ended Work replacements resume the actual interrupted session, even above the fresh threshold', async t => {
  const { service, project, plan, settle, log, front } = fixture(t);
  plan({ id:'interrupted-session', inputs:[150000] });
  const { slug } = await service.request(project, { text:'Original task', topic:'new', agent:'fake' });
  await settle();
  const md = F.updateSteps(service.readDoc(project, slug), steps => {
    steps.find(step => step.id === 'work-1').off = 'ended';
    steps.push(F.workStep({ who:'fake', replaces:'work-1' }));
  });
  service.writeDoc(project, slug, F.setFront(md, {status:'working'}));
  const doc = F.parseLine(service.readDoc(project, slug));
  assert.equal(doc.steps.find(s => s.id === 'work-1').off, 'ended');
  plan({ id:'next', inputs:[200] });
  await service.launch(project, slug, doc.steps.at(-1), doc); await settle();
  assert.equal(front(slug, 2)['task mode'], 'continue');
  assert.equal(log()[1].resume, 'interrupted-session');
});
test('interrupted Grill/Prototype/Outline marked wait and ended still resumes its interrupted session', () => {
  const baseMd = F.initialLine({
    title:'Interrupted grill',
    steps:[
      F.askStep({ words:'Grill me first' }),
      F.workStep({ kind:'grill', who:'claude', wait:true }),
      F.askStep({ words:'Continue after interruption' }),
      F.workStep({ kind:'grill', who:'claude', replaces:'grill-1' }),
    ],
  });
  const md = F.updateSteps(baseMd, steps => { steps[1].done = true; steps[1].off = 'ended'; });
  const doc = F.parseLine(md), previous = doc.steps[1], step = doc.steps.at(-1);
  assert.equal(previous.wait, true);
  assert.equal(previous.off, 'ended');
  const decision = C.taskDecision({
    slug:'interrupted-grill', doc, step, previous,
    previousFront:{ 'task id':'grill-task-1', 'stop why':'stopped' },
    auto:{ agent:'claude', size:150000, endedAt:Date.now(), now:Date.now() },
  });
  assert.equal(decision.mode, 'continue');
  assert.equal(decision.id, 'grill-task-1');

  // Contrast: a normally finished waiting Grill (off is empty) uses autoMode and starts fresh at 150k.
  const finishedPrev = { ...previous, off:'' };
  const finishedDecision = C.taskDecision({
    slug:'interrupted-grill', doc, step, previous:finishedPrev,
    previousFront:{ 'task id':'grill-task-1' },
    auto:{ agent:'claude', size:150000, endedAt:Date.now(), now:Date.now() },
  });
  assert.equal(finishedDecision.mode, 'new');
});

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-task-context-")),script=path.join(dir,"agent.cjs"),planFile=path.join(dir,"plan.json"),calls=path.join(dir,"calls.jsonl");
  fs.writeFileSync(script,`
const fs=require('fs'),readline=require('readline');
const plan=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),say=o=>console.log(JSON.stringify(o));
readline.createInterface({input:process.stdin}).once('line',line=>{
 const prompt=JSON.parse(line).message.content.map(p=>p.text||'').join('');
 fs.appendFileSync(process.argv[3],JSON.stringify({prompt,resume:process.argv[4],instructions:process.argv[5]})+'\\n');
 const session=process.argv[4]||plan.id;
 say({type:'system',subtype:'init',session_id:session,model:'measured-model'});
 (plan.inputs||[100]).forEach((n,i)=>say({type:'assistant',message:{id:plan.id+'-'+i,model:'measured-model',usage:{input_tokens:10,cache_read_input_tokens:n-20,cache_creation_input_tokens:10,output_tokens:100},content:[{type:'text',text:'Done. Requirements and tests verified.'}]}}));
 say({type:'result',session_id:session,is_error:!!plan.fail,result:plan.fail?'Test failure':'Done.'});
 process.exit(plan.fail?1:0);
});`);
  const agents={available:()=>[{id:"fake",name:"Fake",available:true}],nameOf:()=>"Fake",desktop:()=>null,terminal:()=>"",
    command:(_agent,{workdir,resume,instructions})=>({command:process.execPath,args:[script,planFile,calls,resume||"",instructions||""],cwd:workdir,stdin:true,input:"stream-json",ownInstructions:true})};
  const service=new Service({directory:path.join(dir,"state"),agents,autoWatch:false,memory:{home:dir,env:{}},conversations:{home:dir,env:{}}});
  const project=service.store.create({name:"Context test",docsPath:path.join(dir,"docs")});project.defaultAgent="fake";
  t.after(()=>{service.close();fs.rmSync(dir,{recursive:true,force:true});});
  const plan=p=>fs.writeFileSync(planFile,JSON.stringify(p));
  const json=rel=>JSON.parse(service.store.readText(project,rel).text);
  const front=(slug,n)=>F.splitFront(service.store.readText(project,`works/${slug}/work-${n}.md`).text).front;
  const log=()=>fs.readFileSync(calls,"utf8").trim().split("\n").map(JSON.parse);
  const settle=async()=>{const start=Date.now();while(service.runs.size){if(Date.now()-start>6000)throw Error("run timeout");await new Promise(r=>setTimeout(r,20));}};
  return{service,project,plan,json,front,log,settle};
}
test("new tasks start fresh; explicit continuation reuses its session and receives the current Work path",async t=>{
  const f=fixture(t),{service,project,plan,settle,front,json,log}=f;
  plan({id:"one",inputs:[100000,150000]});const {slug}=await service.request(project,{text:"First task requirements",topic:"new",agent:"fake"});await settle();
  plan({id:"two",inputs:[160000]});await service.request(project,{text:"Also cover empty input",topic:slug,taskMode:"continue"});await settle();
  assert.equal(log()[1].resume,"one");assert.equal(front(slug,1)["task id"],front(slug,2)["task id"]);
  assert.match(log()[1].prompt,new RegExp(`Work file: works/${slug}/work-2.md`));
  assert.doesNotMatch(log()[0].instructions,/work-1\.md/);assert.equal(log()[0].instructions,log()[1].instructions);
  plan({id:"three",inputs:[20000]});await service.request(project,{text:"An independent task",topic:slug});await settle();
  assert.equal(log()[2].resume,"");assert.notEqual(front(slug,2)["task id"],front(slug,3)["task id"]);
  const e=json(C.taskFile(slug,"work-3"));assert.equal(e.startup.difference,140000);
  assert.equal(json(C.manifestFile(slug,"work-3")).attempts[0].currentAsk,"An independent task");
  const state=service.stateOf(project);assert.equal(state.lines[0].tokens.difference,140000);assert.equal(state.tokens.inputTokens,430000);assert.equal(state.tokens.compared,1);
  assert.equal(log().length,3,"making the evidence and aggregating state never calls the model");
  // A Work still going is not compared yet: part-way, a fresh start's cost reads far too high (PE-974).
  assert.equal(state.lines[0].stations.at(-1).tokens.startup.status,"compared");
  service.writeDoc(project,slug,F.setFront(F.updateSteps(service.readDoc(project,slug),steps=>{steps.at(-1).done=false;}),{status:"working"}));
  const going=service.stateOf(project).lines[0],last=going.stations.at(-1);
  assert.equal(last.state,"active");assert.equal(last.tokens.startup.status,"running");assert.equal(last.tokens.startup.cost,undefined);
  assert.equal(going.tokens.compared,0);assert.equal(going.tokens.inputTokens,430000,"its tokens still count");
});
test("a conversation carries on with the same real model, whatever name it was picked by (PE-1180)",async t=>{
  const f=fixture(t),{service,project,plan,settle,log}=f;
  const pick=(_slug,model,effort="")=>service.presetFor=(_p,_s,agent)=>({id:"",agent,model,effort,name:"x"});
  const ran=(slug,n,model,selected)=>{const rel=`works/${slug}/work-${n}.md`;service.store.writeText(project,rel,F.setFront(service.store.readText(project,rel).text,{model,"selected model":selected}));
    for(const rec of Object.values(service.sessions[service.key(project,slug)]))if(rec.workId===`work-${n}`)Object.assign(rec,{picked:selected,model,ranAt:n});};
  pick("","opus");plan({id:"one",inputs:[1000]});const {slug}=await service.request(project,{text:"First",topic:"new",agent:"fake"});await settle();
  ran(slug,1,"claude-opus-5-5","opus");
  const ask=async(id,n,model,real)=>{pick(slug,model);plan({id,inputs:[1000]});await service.request(project,{text:`Ask ${id}`,topic:slug,taskMode:"continue"});await settle();ran(slug,n,real,model);return log().at(-1).resume;};
  assert.equal(await ask("two",2,"claude-opus-5-5","claude-opus-5-5"),"one","opus, then the ID it runs as");
  assert.equal(await ask("three",3,"opus","claude-opus-5-5"),"one","and back");
  assert.equal(await ask("four",4,"claude-fable-5-2","claude-fable-5-2"),"","another model starts fresh");
  assert.equal(await ask("five",5,"opus","claude-opus-5-5"),"","and so does going back to the first");
  pick(slug,"claude-opus-5-5","high");plan({id:"six",inputs:[1000]});await service.request(project,{text:"Ask six",topic:slug,taskMode:"continue"});await settle();
  assert.equal(log().at(-1).resume,"","another effort still starts fresh");
});
test("sameRun compares model IDs, and says nothing where a name is no ID",()=>{
  const r=(a,b,x="",y="")=>C.sameRun({model:a,effort:x},{model:b,effort:y});
  assert.equal(r("claude-opus-5-5","claude-opus-5-5[1m]"),true);assert.equal(r("claude-opus-5-5","claude-opus-5-6"),false);
  assert.equal(r("claude-opus-5-5","claude-opus-5-5","medium","high"),false);
  assert.equal(r("opus","claude-opus-5-5"),null);assert.equal(r("","claude-opus-5-5"),null);
});
test("a task the orchestrator adds carries a short, recent conversation on; a parallel or independent one starts fresh (PE-1180)",async t=>{
  const f=fixture(t),{service,project,plan,settle,front,log}=f;
  plan({id:"one",inputs:[1000]});const {slug}=await service.request(project,{text:"First",topic:"new",agent:"fake"});await settle();
  const add=async(id,text,o={})=>{plan({id,inputs:[1000]});await service.addAgentTask(project,slug,{text,agent:"fake",...o});await settle();return log().at(-1).resume;};
  assert.equal(await add("two","Also cover empty input"),"one");assert.match(front(slug,2)["task why"],/Short conversation/);
  assert.equal(await add("three","Do an independent review"),"");
  assert.equal(await add("four","Propose a name",{parallel:true}),"");
  plan({id:"big",inputs:[300000]});await service.addAgentTask(project,slug,{text:"Long",agent:"fake"});await settle();
  assert.equal(await add("six","After a long one"),"","a long conversation is not carried");
});
test("PenEcho chooses continue or a fresh start by itself, from the conversation's size and how long it has been idle",()=>{
  const prev={who:"claude",done:true},now=Date.UTC(2026,10,14,12),min=60000,auto=(size,idle,agent="claude")=>C.autoMode({previous:prev,agent,size,endedAt:idle==null?0:now-idle*min,now}).mode;
  assert.equal(C.autoMode({previous:null}).mode,"new");
  assert.equal(auto(30000,50),"continue","a short conversation still in Claude's one-hour cache is cheap to carry");
  assert.equal(auto(30000,600),"new","after its cache has expired, a short conversation would be written to the cache again in full");
  assert.match(C.autoMode({previous:prev,agent:"claude",size:30000,endedAt:now-600*min,now}).why,/Short conversation \(30000 input tokens\), but idle 600 min: its cache has expired/);
  const codexPrev={who:"codex",done:true};
  assert.equal(C.autoMode({previous:codexPrev,agent:"codex",size:30000,endedAt:now-20*min,now}).mode,"continue");
  assert.equal(C.autoMode({previous:codexPrev,agent:"codex",size:30000,endedAt:now-45*min,now}).mode,"continue","Codex's cache was measured to hold for an hour (PE-974)");
  assert.equal(C.autoMode({previous:codexPrev,agent:"codex",size:30000,endedAt:now-75*min,now}).mode,"new");
  assert.equal(auto(200000,1),"new","a long conversation would be carried again in every request");
  assert.equal(auto(68409,53),"continue","68k idle 53 minutes is still in Claude's one-hour cache (PE-974)");assert.equal(auto(68409,70),"new");
  assert.equal(C.autoMode({previous:codexPrev,agent:"codex",size:68409,endedAt:now-53*min,now}).mode,"continue");
  // Each agent's limit is where past Works, replayed both ways, cost least: past it a fresh start costs less even with the cache warm (PE-974).
  assert.equal(auto(79000,10),"continue");assert.equal(auto(80000,10),"new","Claude's limit is 80k");assert.equal(auto(100000,10),"new");
  assert.match(C.autoMode({previous:prev,agent:"claude",size:120000,endedAt:now-5*min,now}).why,/Long conversation \(120000 input tokens, over 80k\)/);
  assert.equal(C.autoMode({previous:codexPrev,agent:"codex",size:110000,endedAt:now-10*min,now}).mode,"continue");
  assert.equal(C.autoMode({previous:codexPrev,agent:"codex",size:120000,endedAt:now-10*min,now}).mode,"new","Codex's limit is 120k");
  const otherPrev={who:"antigravity",done:true};
  assert.equal(C.autoMode({previous:otherPrev,agent:"antigravity",size:59000,endedAt:now-10*min,now}).mode,"continue");
  assert.equal(C.autoMode({previous:otherPrev,agent:"antigravity",size:60000,endedAt:now-10*min,now}).mode,"new","the others' limit is 60k");
  assert.equal(C.autoMode({previous:prev,agent:"claude",size:30000,endedAt:now-59*min,now}).mode,"continue","Claude's cache holds to the hour");
  assert.equal(auto(30000,1,"codex"),"new","after another agent's Work it starts fresh, even when short and warm");
  assert.equal(auto(null,5),"continue");assert.equal(auto(null,90),"new");
  const doc=F.parseLine(F.initialLine({title:"Auto",steps:[F.askStep({words:"First"}),F.workStep({who:"claude",done:true}),F.askStep({words:"Next"}),F.workStep({who:"claude"})]}));
  const step=doc.steps.at(-1),previous=doc.steps[1];
  assert.equal(C.taskDecision({slug:"a",doc,step,previous,previousFront:{"task id":"t1"},auto:{agent:"claude",size:20000,endedAt:now,now}}).id,"t1");
  const fresh=C.taskDecision({slug:"a",doc,step,previous,previousFront:{"task id":"t1"},auto:{agent:"claude",size:300000,endedAt:now,now}});
  assert.equal(fresh.mode,"new");assert.match(fresh.why,/Long conversation/);
});
test("an answer or the Ask after an unfinished Work continues while the cache holds, at any size, and starts fresh once it has expired",()=>{
  const now=Date.UTC(2026,10,23,12),min=60000;
  const md=F.updateSteps(F.initialLine({title:"Answer",steps:[F.askStep({words:"First"}),F.workStep({who:"claude",wait:true}),F.askStep({words:"Postgres"}),F.workStep({who:"claude"})]}),steps=>{steps[1].done=true;steps[1].off="ended";});
  const doc=F.parseLine(md),step=doc.steps.at(-1),previous=doc.steps[1];
  const decide=(size,idle,agent="claude")=>C.taskDecision({slug:"a",doc,step,previous,previousFront:{"task id":"t1"},auto:{agent,size,endedAt:now-idle*min,now}});
  const warm=decide(200000,20);
  assert.equal(warm.mode,"continue","a big conversation still in its cache keeps the agent's memory for the answer");assert.equal(warm.id,"t1");
  assert.equal(warm.why,"The last Work is unfinished or waiting for an answer");
  // In 14 of 15 past answers after the cache had expired, a fresh start cost less: together under half (PE-974).
  const cold=decide(200000,155);
  assert.equal(cold.mode,"new");assert.match(cold.why,/waiting for an answer, but idle 155 min: its cache has expired/);
  assert.equal(decide(37000,77).mode,"new","small ones too: the cache is written again either way");
  assert.equal(decide(150000,45,"codex").mode,"continue","Codex's cache holds for an hour");
  assert.equal(C.taskDecision({slug:"a",doc,step,previous,previousFront:{"task id":"t1"},auto:{agent:"claude",size:200000,endedAt:0,now}}).mode,"continue","with no end time known it continues as before");
});
test("an Ask with no mode continues a short conversation on its own",async t=>{
  const {service,project,plan,settle,front,log}=fixture(t);
  plan({id:"one",inputs:[20000,30000]});const {slug}=await service.request(project,{text:"Make the page",topic:"new",agent:"fake"});await settle();
  plan({id:"two",inputs:[32000]});await service.request(project,{text:"Make the title bigger",topic:slug});await settle();
  assert.equal(log()[1].resume,"one");assert.equal(front(slug,2)["task mode"],"continue");assert.match(front(slug,2)["task why"],/Short conversation/);
});
test("a Work without saved usage is read back from the run log, and a later fresh task is compared with it",async t=>{
  const {service,project,plan,settle,json}=fixture(t);
  plan({id:"old",inputs:[150000,250000]});const {slug}=await service.request(project,{text:"Old work",topic:"new",agent:"fake"});await settle();
  // As if this Work ran before PenEcho saved usage: only the run log has it.
  fs.rmSync(path.join(project.docsPath,C.taskFile(slug,"work-1")),{force:true});
  assert.equal(service.stateOf(project).lines[0].stations.find(s=>s.id==="work-1").tokens,null);
  const start=Date.now();while(!fs.existsSync(path.join(project.docsPath,C.taskFile(slug,"work-1")))){if(Date.now()-start>3000)throw Error("no backfill");await new Promise(r=>setTimeout(r,20));}
  const back=json(C.taskFile(slug,"work-1"));assert.equal(back.backfilled.source,"PenEcho run log");assert.equal(back.attempts[0].requests.length,2);
  plan({id:"new",inputs:[25000]});await service.request(project,{text:"Something else",topic:slug});await settle();
  const e=json(C.taskFile(slug,"work-2"));assert.equal(e.taskMode,"new");assert.equal(e.startup.difference,225000);
  const work=service.stateOf(project).lines[0].stations.find(s=>s.id==="work-2");assert.equal(work.tokens.startup.percent,90);
});
test("reads recorded before every file a command reads was found are read from the run log once more",async t=>{
  const {service,project,plan,settle,json}=fixture(t);
  plan({id:"old",inputs:[150000,250000]});const {slug}=await service.request(project,{text:"Old work",topic:"new",agent:"fake"});await settle();
  plan({id:"new",inputs:[25000]});await service.request(project,{text:"Something else",topic:slug});await settle();
  service.stateOf(project);
  const file=id=>C.taskFile(slug,id),back=id=>service.store.writeText(project,file(id),JSON.stringify({...json(file(id)),readsVersion:2}));
  back("work-1");back("work-2");
  service.tokenBackfill=null;fs.rmSync(path.join(service.directory,"token-backfill.json"),{force:true});
  service.stateOf(project);
  const start=Date.now();while(json(file("work-2")).readsVersion!==3){if(Date.now()-start>3000)throw Error("not read again");await new Promise(r=>setTimeout(r,20));}
  assert.equal(json(file("work-1")).readsVersion,3);assert.equal(json(file("work-2")).startup.difference,225000,"its usage is kept as it was");
  const work=service.stateOf(project).lines[0].stations.find(s=>s.id==="work-2");
  assert.equal(work.tokens.readsVersion,undefined,"not sent to the page");
});
test("retry keeps task identity, counts every attempt and retains both context manifests",async t=>{
  const f=fixture(t),{service,project,plan,settle,front,json,log}=f;
  plan({id:"fail",inputs:[30000],fail:true});const{slug}=await service.request(project,{text:"Finish this task",topic:"new",agent:"fake"});await settle();
  const task=front(slug,1)["task id"];plan({id:"retry",inputs:[40000]});await service.act(project,slug,"retry");await settle();
  assert.equal(front(slug,1)["task id"],task);assert.equal(log()[1].resume,"fail");
  const e=json(C.taskFile(slug,"work-1"));assert.equal(e.attempts.length,2);assert.equal(e.attempts.reduce((n,a)=>n+a.totals.inputTokens,0),70000);
  assert.equal(json(C.manifestFile(slug,"work-1")).attempts.length,2);assert.equal(e.startup.status,"unavailable");
});
test("legacy recovery retains its exact session and migrates on the next Work without splitting the logical task",async t=>{
  const {service,project,plan,settle,front,log}=fixture(t);
  plan({id:"legacy-session",inputs:[30000],fail:true});
  const {slug}=await service.request(project,{text:"Finish the interrupted task",topic:"new",agent:"fake"});await settle();
  const key=service.key(project,slug), saved=service.sessions[key].fake;
  service.sessions[key]={fake:{...saved,policyVersion:0}};
  const detail=`works/${slug}/work-1.md`;
  service.store.writeText(project,detail,F.setFront(service.store.readText(project,detail).text,{"task id":null,"task mode":null,"task continued from":null}));
  plan({id:"recovered",inputs:[35000]});await service.act(project,slug,"retry");await settle();
  assert.equal(log()[1].resume,"legacy-session","the interrupted Work preserves tool and conversation state");
  assert.equal(service.sessions[key].fake.policyVersion,0,"legacy recovery is not incorrectly marked migrated");
  const task=front(slug,1)["task id"];
  plan({id:"migrated",inputs:[20000]});
  await service.request(project,{text:"Continue after recovery",topic:slug,taskMode:"continue"});await settle();
  assert.equal(front(slug,2)["task id"],task);
  assert.equal(log()[2].resume,"","the next Work starts with the current prompt policy");
  assert.equal(service.sessions[key].fake.policyVersion,C.VERSION);
});

test("answering a Work's question sends only the reply Ask on resumed sessions and keeps original Ask historical on fresh continuations", async t => {
  const { service, project, plan, settle, log } = fixture(t);
  plan({ id:"grill-sess", inputs:[20000] });
  const { slug } = await service.request(project, { text:"Just grill me ONE question and return.", topic:"new", agent:"fake" });
  await settle();
  const detail1 = F.detailPath(slug, "work-1");
  service.store.writeText(project, detail1, `${service.store.readText(project, detail1).text}\n\n## Questions for you\n\n**Which path?** (@fake)\n- [ ] Option A\n- [ ] Option B\n`);
  const qs1 = service.lineQuestionsState(project, slug, F.parseLine(service.readDoc(project, slug)));
  plan({ id:"grill-sess", inputs:[25000] });
  await service.answer(project, slug, qs1.byStep.get("work-1")[0].id, "Option A", { stepId:"work-1", questionRev:qs1.revByStep.get("work-1") });
  await settle();

  const resumedPrompt = log()[1].prompt;
  assert.equal(log()[1].resume, "grill-sess", "warm reply resumes the existing session");
  assert.match(resumedPrompt, /Which path\?: Option A/);
  assert.doesNotMatch(resumedPrompt, /Just grill me ONE question and return\./, "resumed reply must not re-send the original grill prompt");

  // Fresh continuation (large >=150k session): <request> has only the reply Ask, while Original request sits in Historical context.
  plan({ id:"large-sess", inputs:[160000] });
  const { slug:slug2 } = await service.request(project, { text:"Just grill me ONE question and return.", topic:"new", agent:"fake" });
  await settle();
  const detail2 = F.detailPath(slug2, "work-1");
  service.store.writeText(project, detail2, `${service.store.readText(project, detail2).text}\n\n## Questions for you\n\n**Pick one?** (@fake)\n- [ ] First\n- [ ] Second\n`);
  const qs2 = service.lineQuestionsState(project, slug2, F.parseLine(service.readDoc(project, slug2)));
  plan({ id:"fresh-sess", inputs:[20000] });
  await service.answer(project, slug2, qs2.byStep.get("work-1")[0].id, "First", { stepId:"work-1", questionRev:qs2.revByStep.get("work-1") });
  await settle();

  const freshCall = log().at(-1);
  assert.equal(freshCall.resume, "", "large session starts fresh");
  assert.match(freshCall.prompt, /Pick one\?: First/);
  assert.match(freshCall.prompt, /Original request \(historical; the current request takes precedence\)\nSource: lines\/[^\n]+#ask-1\nJust grill me ONE question and return\./);
  assert.doesNotMatch(freshCall.prompt.split("Historical context")[0], /Just grill me ONE question and return\./, "fresh reply keeps original prompt out of current request");
});
