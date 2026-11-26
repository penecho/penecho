#!/usr/bin/env node
"use strict";
// Real server and browser, isolated folders, deterministic agent telemetry; no external model requests.
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict"),{spawn}=require("node:child_process");
const {chromium}=require(process.env.PLAYWRIGHT_PATH || "playwright");
const root=path.resolve(__dirname,".."),temp=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-token-ui-")),shots=process.argv[2] || path.join(temp,"shots");
fs.mkdirSync(shots,{recursive:true});
const docs=path.join(temp,"docs"),agent=path.join(temp,"agent.cjs"),calls=path.join(temp,"calls.jsonl"),port=0;
let base="";
fs.writeFileSync(agent,`
const fs=require('fs'),rl=require('readline');let text='';
const say=o=>console.log(JSON.stringify(o));
process.stdin.on('data',d=>text+=d).on('end',()=>{
 fs.appendFileSync(${JSON.stringify(calls)},'run\\n');const id='fixture-'+Date.now();
 const current=text.split('\\n\\nCurrent PenEcho Work:')[0];const input=current.includes('First task')?500000:current.includes('Larger independent task')?60000:50000;
 say({type:'system',subtype:'init',session_id:id,model:'fixture-model'});
 say({type:'assistant',message:{id,model:'fixture-model',usage:{input_tokens:20,cache_read_input_tokens:input-40,cache_creation_input_tokens:20,output_tokens:100},content:[{type:'text',text:'Completed. Verified the requested behavior.'}]}});
 say({type:'result',session_id:id,is_error:false,result:'Completed.'});
});`);
const server=spawn(process.execPath,[path.join(root,"server.js")],{cwd:root,stdio:["ignore","pipe","pipe"],env:{...process.env,NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",HOME:temp,PENECHO_STATE_DIR:path.join(temp,"state"),PENECHO_CLOUD_STATE_DIR:path.join(temp,"cloud-state"),PENECHO_LINES_TEST_AGENT:agent,PORT:String(port),HOST:"127.0.0.1",CLAUDE_CLI_PATH:"/nonexistent",CODEX_CLI_PATH:"/nonexistent",PATH:"/usr/bin:/bin"}});
let logs="",browser;
const closed=new Promise(resolve=>server.once('close',resolve));
server.stdout.on("data",d=>logs+=d);server.stderr.on("data",d=>logs+=d);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const started=Date.now();while(!await fn()){if(Date.now()-started>20000)throw Error(`Timed out: ${label}\n${logs.slice(-1500)}`);await wait(60);}}
(async()=>{
  await until(()=>logs.includes("PenEcho:"),"isolated server");
  base=logs.match(/PenEcho: (http:\/\/127\.0\.0\.1:\d+)/)[1];
  browser=await chromium.launch({channel:"chrome"});const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"}),page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  const post=async(url,data)=>{const r=await context.request.post(base+"/api/lines"+url,{data,headers:{origin:base}});assert.ok(r.ok(),await r.text());return r.json();};
  const p=(await post("/projects",{name:"Token evidence acceptance",docsPath:docs,offerSkill:false})).project.id;
  const state=async()=>{const r=await context.request.get(`${base}/api/lines/projects/${p}/state`);return r.json();};
  const settled=async()=>{await until(async()=>!(await state()).lines.some(l=>l.running),"agent completes");};
  const works=async()=>(await state()).lines[0].stations.filter(s=>s.kind==='work');
  // The first conversation is long (500k), so the next Ask, with no mode given, starts fresh by itself.
  const first=await post(`/projects/${p}/topics`,{text:"First task",topic:"new",agent:"tester"});await settled();
  await post(`/projects/${p}/topics`,{text:"Smaller independent task",topic:first.slug,agent:"tester"});await settled();
  const fresh=(await works())[1];assert.equal(fresh.tokens.taskMode,"new");assert.equal(fresh.tokens.startup.difference,450000);assert.match(fresh.tokens.decision.why,/Long conversation/);
  await page.goto(`${base}/projects.html#${p}/home`);await page.waitForSelector("#hmTokens .tk-big");
  await until(async()=>/≈ 89% less cost/.test(await page.locator("#hmTokens .tk-big").textContent()),"project saving");
  assert.equal(await page.locator('#hmTokens [data-period="week"]').getAttribute("aria-pressed"),"true");
  assert.match(await page.locator("#hmTokens").innerText(),/≈ 450k fewer tokens \(90%\) · 1 fresh start/);
  // Each fixture Work's input is all cache reads but 40 new tokens; new input shows first, as Codex and Claude Code count it.
  assert.match(await page.locator("#hmTokens dl").innerText(),/New in\s+80\s+From cache\s+549\.9k\s+Out\s+200/);
  await page.screenshot({path:path.join(shots,"project-desktop.png")});
  const count=fs.readFileSync(calls,"utf8").trim().split("\n").length;
  await page.locator('#hmTokens [data-act="token-proof"]').click();await page.waitForSelector(".token-proof-dialog[open]");
  const proof=await page.locator(".token-proof-dialog").innerText();assert.match(proof,/500,000/);assert.match(proof,/50,000/);assert.match(proof,/Why a fresh start: Long conversation/);assert.match(proof,/No AI is called/);assert.match(proof,/Cache hit rate\s+99\.9%/);assert.match(proof,/New in \/ out\s+40 \/ 100\s+Tokens in, whole context\s+500,000/);
  // Fresh: 20 new + 49,960 cache hits × 0.1 + 20 written × 1.25 + 100 out × 5. Resumed within the hour: 500k cache hits × 0.1 + the same output.
  assert.match(proof,/Cost in new-input tokens: fresh \/ resumed\s+5,541 \/ ≈ 50,500 \(≈ 89% less cost\)/);assert.match(proof,/Had the cache been expired/);
  const evidence=page.locator('.token-proof-dialog a[download]').first(),href=await evidence.getAttribute("href");
  const evidenceResponse=await context.request.get(base+href);assert.equal(evidenceResponse.status(),200);assert.ok((await evidenceResponse.json()).attempts.length);
  await page.keyboard.press("Escape");await page.locator(".token-proof-dialog").waitFor({state:'detached'});
  await page.locator('#hmTokens [data-period="today"]').click();assert.equal(await page.locator('#hmTokens [data-period="today"]').getAttribute('aria-pressed'),"true");
  await page.locator('#hmTokens [data-period="all"]').click();
  assert.equal(fs.readFileSync(calls,"utf8").trim().split("\n").length,count,"proof and time filters never invoke the agent");
  await page.goto(`${base}/projects.html#${p}/line/${first.slug}`);await page.waitForSelector("#linePage .token-line");await wait(500);
  assert.match(await page.locator(".token-line").innerText(),/≈ 89% less cost on this Line\s+≈ 450k fewer tokens \(90%\) · 1 fresh start/);
  await page.waitForSelector(".token-work.saved");assert.match(await page.locator(".token-work.saved").first().innerText(),/≈ 89% less cost · ≈ 450k fewer tokens \(90%\)\s+than resuming the 500k conversation, cache still warm after 0 min/);
  assert.equal(await page.locator(".cmp-task-mode").count(),0,"the person is never asked to choose");
  assert.equal(await page.locator(".token-work").count(),await page.locator(".token-work.saved, .token-work.quiet").count());
  assert.match(await page.locator(".token-work.quiet").first().innerText(),/40 new in · 500k from cache · 100 out/);
  await page.screenshot({path:path.join(shots,"line-desktop.png")});
  await page.locator('.token-work.saved[data-act="token-proof"]').first().click();await page.waitForSelector(".token-proof-dialog[open]");
  await page.screenshot({path:path.join(shots,"work-evidence.png")});await page.keyboard.press("Escape");
  // A short conversation (50k) continues by itself, through the real composer: nothing about modes is sent.
  await page.locator('.lp-dock .cmp-input').fill('Make the heading bigger');
  const [saved] = await Promise.all([page.waitForResponse(r=>r.url().endsWith('/unsent') && r.request().method()==='POST'),page.locator('.lp-dock .send-btn[type="submit"]').click()]);
  assert.equal(saved.request().postDataJSON().taskMode,undefined);
  await post(`/projects/${p}/topics/${first.slug}/run-unsent`,{step:(await saved.json()).step,agent:'tester'});await settled();
  const afterContinuation=await works();
  assert.equal(afterContinuation.at(-1).tokens.taskId,afterContinuation.at(-2).tokens.taskId);
  assert.equal(afterContinuation.at(-1).tokens.startup.status,'continuation');assert.match(afterContinuation.at(-1).tokens.decision.why,/Short conversation/);
  assert.equal((await state()).tokens.tasks,2,'a continuation is not another fresh start');
  // Statistics counts new input and output, with cache reads apart: three Works of 40 new + 100 out.
  await page.goto(`${base}/projects.html#${p}/stats`);await page.waitForSelector(".sx-sum");
  await until(async()=>/Tokens\s*420\s*600K cache reads/.test(await page.locator(".sx-sum").innerText()),"statistics tokens");
  // A Work with no saved usage is read back from PenEcho's run log, with no model call.
  const firstEvidence=path.join(docs,"works",first.slug,"work-1.tokens.json");fs.rmSync(firstEvidence);
  await state();await until(async()=>{await state();return fs.existsSync(firstEvidence);},"run log read back");
  assert.equal(JSON.parse(fs.readFileSync(firstEvidence,"utf8")).backfilled.source,"PenEcho run log");
  assert.equal((await works())[1].tokens.startup.difference,450000);
  await page.goto(`${base}/projects.html#${p}/home`);await page.setViewportSize({width:390,height:844});
  await page.waitForSelector("#hmTokens .tk-big");await wait(1000);
  assert.ok(await page.locator("#hmTokens").isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"narrow layout has no horizontal overflow");
  await page.locator('#hmTokens [data-act="token-proof"]').focus();await page.keyboard.press("Enter");await page.waitForSelector(".token-proof-dialog[open]");
  assert.ok(await page.locator(".token-proof-dialog").evaluate(el=>el.getBoundingClientRect().width<=innerWidth));
  await page.keyboard.press("Escape");await wait(800);await page.screenshot({path:path.join(shots,"project-narrow.png")});
  await page.goto(`${base}/projects.html#${p}/line/${first.slug}`);await wait(800);
  assert.ok(await page.locator('.token-line').isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(shots,'line-narrow.png')});
  await post(`/projects/${p}/topics/${first.slug}/close`,{});
  await page.goto(`${base}/projects.html#${p}/home`);await page.waitForSelector('#hmTokens .tk-big');
  assert.match(await page.locator('#hmTokens .tk-big').innerText(),/89% less cost/,'archived Work evidence remains in the Project summary');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:["no task picker; long conversation starts fresh by itself","short conversation continues by itself via the real composer","saving on Work/Line/Project","run log read back for a Work without saved usage","local proof and JSON downloads","no model calls for proof or filters","390px layout","keyboard proof and Escape","no page errors"],shots},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill();await closed;fs.rmSync(temp,{recursive:true,force:true});});
