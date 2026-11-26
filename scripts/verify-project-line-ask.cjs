#!/usr/bin/env node
"use strict";
// Real-browser check of Ask in project search: a saved agent answers a question about the project, against its own server, a scratch folder
// and a stand-in agent that prints an answer citing the Line it was given.
//   PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-project-line-ask.cjs [screenshot-folder]
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");

const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "line-ask-browser-"));
const shots = path.resolve(process.argv[2] || path.join(temp, "shots")); fs.mkdirSync(shots, { recursive:true });
let passed = 0;
const check = (label, value) => { assert.ok(value, label); passed++; console.log(`ok ${label}`); };
const pause = ms => new Promise(r => setTimeout(r, ms));

// The stand-in reads the prompt and answers after a moment, citing the first Line it was given in the unified format.
const script = path.join(temp, "answer.js");
fs.writeFileSync(script, `let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const ref=((s.split("<starting-hints")[1]||"").match(/\\[(PE-\\d+)\\]/)||[])[1]||"?";const slow=/slowly/.test(s.split("<question>")[1]||"");setTimeout(()=>process.stdout.write("The Canvas menu fix removed the extra item and is currently local and uncommitted ["+ref+"].\\n\\n### 1. Canvas menu cleanup ["+ref+"]\\nYou asked to remove Take off its line from the Canvas menu. The agent removed it in Work 1 and noted the edit is still local.\\n\\n## Progress & Status\\n- **Finished:** Removed Take off its line ["+ref+"]\\n- **To do:** Check the notice in a browser and commit changes\\n\\n## Key Lines\\n- ["+ref+"] **Canvas menu fixes** — removed Take off its line from the Canvas menu\\n"),slow?4000:700);});`);
const agents = { available:() => [{ id:"tester", name:"Test agent", mono:"Ts", color:"#3457c9", available:true, runs:true }, { id:"tester2", name:"Second agent", mono:"T2", color:"#b4532a", available:true, runs:true }],
  nameOf:id => id, desktop:() => null, terminal:() => "", env:process.env, canAnswer:id => id === "tester" || id === "tester2", answerer:() => ({ command:process.execPath, args:[script] }) };
const api = createProjectLines({ directory:path.join(temp, "state"), agents, serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, "home"), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
  send:(res, status, data) => { if (res.writableEnded || res.destroyed) return; res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
const s = api.service, p = s.store.create({ name:"Ask", docsPath:path.join(temp, "docs") });
p.follow = false; p.offerSkill = false; s.store.save();
const work = body => F.workStep({ who:"claude", done:true, took:"5 min", body:`${body}\n\n[Details](x.md)` });
s.writeDoc(p, "canvas-menu", F.setFront(F.initialLine({ title:"Canvas menu fixes", status:"done", steps:[F.askStep({ words:"Remove take off its line from the Canvas menu.", when:"2026-11-10 10:00" }), work("Removed.")] }), { id:"PE-584" }));
s.store.writeText(p, "works/canvas-menu/work-1.md", F.setResult(F.initialDetail({ slug:"canvas-menu", title:"canvas-menu", label:"Work 1", who:"claude", started:"2026-11-10 10:05", now:"" }), "Removed Take off its line, uncommitted."));
s.writeDoc(p, "other", F.setFront(F.initialLine({ title:"Windows installer", status:"done", steps:[F.askStep({ words:"Build the Windows installer.", when:"2026-11-12 10:00" }), work("Built.")] }), { id:"PE-571" }));
s.sync(p);

const mime = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml", ".webp":"image/webp" };
let browser, server;
(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try { if (await api.handle(req, res, url)) return; } catch (error) { if (!res.writableEnded && !res.destroyed) { res.writeHead(error.status || 500, { "content-type":"application/json" }); res.end(JSON.stringify({ error:error.message, code:error.code })); } return; }
    const file = path.resolve(root, "public", `.${url.pathname}`);
    if (!file.startsWith(path.join(root, "public")) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type":mime[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1280, height:820 } }), page = await context.newPage();
  const errors = []; page.on("pageerror", e => errors.push(e.message));

  await page.goto(`${base}/projects.html#${p.id}`); await page.reload();
  await page.waitForSelector(".subnav");
  check("the header offers Ask AI and the project tabs fit", (await page.locator('.bar-right [data-view="find"]').textContent()).trim() === "Ask AI" && await page.locator(".subnav").evaluate(n => n.scrollWidth <= n.clientWidth + 1));
  await page.click('.bar-right [data-view="find"]');
  await page.waitForSelector("#findInput");
  check("the box asks a question about this project", await page.getAttribute("#findInput", "placeholder") === "Ask a question about this project");
  check("an agent picker lists the saved agents that can answer", await page.locator("#findAgent option").count() === 2);
  check("an Ask button with an Enter hint sits in the box", await page.locator(".find-box .find-ask").isVisible() && (await page.locator(".find-ask kbd").textContent()) === "↵");

  await page.fill("#findInput", "what is done on the canvas menu?");
  await page.waitForFunction(() => FIND.data?.q === "what is done on the canvas menu?");
  check("typing still searches at once, with no answer yet", await page.locator(".fl").count() >= 1 && await page.locator(".find-answer").count() === 0);
  const asks = [];
  page.on("request", r => { if (r.method() === "POST" && new URL(r.url()).pathname.endsWith("/ask")) asks.push(r); });
  await Promise.all([page.waitForRequest(r => r.method() === "POST" && new URL(r.url()).pathname.endsWith("/ask")), page.press("#findInput", "Enter")]);
  check("Enter sends one question without a modifier", asks.length === 1);
  await page.waitForSelector(".find-answer.asking");
  check("while it answers, it shows who answers, the seconds and Stop", /Test agent/.test(await page.locator(".find-answer").textContent()) && await page.locator('[data-act="find-ask-stop"]').isVisible());
  await page.screenshot({ path:path.join(shots, "1-asking.png") });
  await page.waitForSelector(".find-answer:not(.asking)", { timeout:15000 });
  check("the answer has headings, status badges, and details", await page.locator(".fa-body .md-in-h").count() >= 3 && await page.locator(".fa-body .fa-badge.is-done").count() === 1 && await page.locator(".fa-body .fa-badge.is-todo").count() === 1);
  check("each cited Line is a link in the text", await page.locator(".fa-body .fa-ref").count() === 4 && (await page.locator(".fa-body .fa-ref").first().textContent()) === "PE-584");
  check("the cited Lines are listed under the answer with their state", await page.locator(".fa-line").count() === 1 && /Canvas menu fixes/.test(await page.locator(".fa-line").textContent()));
  check("the search results stay below", await page.locator("#findBody .fl").count() >= 1);
  await page.screenshot({ path:path.join(shots, "2-answer.png") });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  check("the header holds one Copy icon, so the answer gets no taller", await page.locator('.find-answer > header [data-act="find-answer-copy"]').count() === 1);
  await page.click('[data-act="find-answer-copy"]');
  await page.waitForFunction(() => navigator.clipboard.readText().then(t => t.startsWith("The Canvas menu fix")), null, { timeout:5000 });
  check("Copy puts the answer's Markdown on the clipboard", /## Key Lines/.test(await page.evaluate(() => navigator.clipboard.readText())));

  await page.click(".fa-line");
  await page.waitForFunction(() => S.route.view === "line" && S.route.line === "canvas-menu");
  check("a cited Line opens", true);
  await page.goBack();
  await page.waitForSelector(".find-answer");
  check("going back shows the answer again, with no new run", /Removed Take off its line/.test(await page.locator(".fa-body").textContent()));

  await page.selectOption("#findAgent", { index:1 });
  check("the picked agent is remembered", await page.evaluate(() => localStorage.getItem("penecho-ask-agent-v1")) === await page.inputValue("#findAgent"));
  await page.fill("#findInput", "canvas menu, slowly");
  await page.click(".find-ask");
  await page.waitForSelector(".find-answer.asking");
  check("the answer says which agent was picked", /Second agent/.test(await page.locator(".find-answer header").textContent()));
  await page.click('[data-act="find-ask-stop"]'); await pause(200);
  check("Stop takes the waiting answer away", await page.locator(".find-answer").count() === 0);

  // Asked before: the empty box lists the kept answers, to open, ask again or delete; they outlast a reload.
  await page.fill("#findInput", ""); await pause(200);
  check("the empty box lists what was asked, one row for the answered question", await page.locator(".find-asked .find-row").count() === 1 && /what is done on the canvas menu\?/.test(await page.locator(".find-asked").textContent()));
  await page.screenshot({ path:path.join(shots, "5-asked.png") });
  await page.reload(); await page.waitForSelector(".find-asked .find-row");
  check("the list is still there after a reload", await page.locator(".find-asked .find-row").count() === 1);
  await page.click(".find-asked .fr-open");
  await page.waitForSelector(".find-answer");
  check("opening one shows its kept answer, with no new run", await page.locator(".find-answer.asking").count() === 0 && /Removed Take off its line/.test(await page.locator(".fa-body").textContent()) && await page.locator(".fa-body .fa-ref").count() === 4);
  await page.click('.find-answer [data-act="find-ask"]');
  await page.waitForSelector(".find-answer.asking");
  check("Ask again runs the agent again", true);
  await page.waitForSelector(".find-answer:not(.asking)", { timeout:15000 });
  await page.click('.find-answer [data-act="find-asked-delete"]');
  await page.waitForFunction(() => !document.querySelector(".find-answer"));
  await page.fill("#findInput", ""); await pause(200);
  check("Delete takes it off the list and off the computer", await page.locator(".find-asked").count() === 0 && (await (await fetch(`${base}/api/lines/projects/${p.id}/asks`)).json()).asks.length === 0);

  await page.setViewportSize({ width:420, height:820 });
  await page.fill("#findInput", "what is done on the canvas menu?"); await pause(300);
  check("nothing spills sideways on a phone", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path:path.join(shots, "3-phone.png") });
  await page.evaluate(() => linesTheme.set("dark")); await page.setViewportSize({ width:1280, height:820 }); await pause(150);
  await page.screenshot({ path:path.join(shots, "4-dark.png") });
  await page.evaluate(() => linesTheme.set("light"));
  check("no page errors", errors.length === 0 || (console.log(errors), false));
  console.log(`\n${passed} checks passed. Pictures: ${shots}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); server?.close(); s.close(); });
