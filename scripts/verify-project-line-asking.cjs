#!/usr/bin/env node
"use strict";
// Real-browser check of the Answer label: an agent stopped on a question says so in Unread's place, with no popup.
//   PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-project-line-asking.cjs [screenshot-folder]
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");
const { questionsOf } = require("../src/server/project-lines/activity.js");

const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "line-asking-browser-"));
const shots = path.resolve(process.argv[2] || path.join(temp, "shots")); fs.mkdirSync(shots, { recursive:true });
let passed = 0, browser, server;
const opened = [], errors = [];
const check = (label, value) => { assert.ok(value, label); passed++; console.log(`ok ${label}`); };
const pause = ms => new Promise(r => setTimeout(r, ms));

const agents = {
  available:() => [{ id:"claude", name:"Claude", mono:"Cl", color:"#a8502a", available:true }, { id:"dsh", name:"dsh", mono:"Ds", color:"#3457c9", available:true }],
  nameOf:id => (id === "claude" ? "Claude" : id), desktop:id => (id === "claude" ? "claude://x" : null), terminal:id => (id === "dsh" ? "dsh web" : ""),
};
const api = createProjectLines({ directory:path.join(temp, "state"), agents, serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, "home"), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
  send:(res, status, data) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
const s = api.service, p = s.store.create({ name:"Asking", docsPath:path.join(temp, "docs") });
p.follow = false; p.offerSkill = false; s.store.save();

const line = (slug, title, who, ask, status = "working", more = []) => s.writeDoc(p, slug, F.initialLine({ title, status, created:"2026-11-07 03:31", steps:[F.askStep({ words:ask, when:"2026-11-07 03:31" }), ...more, F.workStep({ who })] }));
line("by-dsh", "In line detail page, user can mark a work as reviewd", "dsh", "Please help to make 2 better prototypes");
line("by-claude", "Which header should we upload", "claude", "Upload the header");
line("still-running", "For grill me situations", "claude", "A stronger notify");
s.writeDoc(p, "was-finished", F.initialLine({ title:"Remove this part", status:"done", created:"2026-11-06 09:00", steps:[F.askStep({ words:"Remove it", when:"2026-11-06 09:00" }), { ...F.workStep({ who:"claude", done:true, took:"2 min" }), body:"Removed." }] }));
s.remember(p, "by-dsh", "dsh", "dsh-session", "work", p.docsPath);
s.remember(p, "by-claude", "claude", "claude-session", "work", p.docsPath);
s.remember(p, "still-running", "claude", "claude-other", "work", p.docsPath);
s.openConversation = async (project, slug, agent) => { opened.push({ slug, agent }); return { ok:true }; };
const dsh = { agent:"dsh", id:"dsh-session", via:"Claude desktop", slug:"by-dsh", projectId:p.id, lastAt:Date.now(), doneTurns:{}, lastSay:"", stepId:"work-1", active:true };
const claude = { agent:"claude", id:"claude-session", via:"Claude desktop", slug:"by-claude", projectId:p.id, lastAt:Date.now(), doneTurns:{}, lastSay:"", stepId:"work-1", active:true };
const running = { agent:"claude", id:"claude-other", via:"Claude desktop", slug:"still-running", projectId:p.id, lastAt:Date.now(), doneTurns:{}, lastSay:"", stepId:"work-1", active:true };
const ASKED = { questions:[
  { question:"In the Work 2 prototype, what felt weak?", options:[{ label:"No sense of progress" }, { label:"The mark is too hidden" }] },
  { question:"How should the two prototypes be presented?", options:[{ label:"One page, two looks on a switch" }] },
] };
const mime = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml", ".webp":"image/webp" };

(async () => {
  await s.conversationChanges(p, dsh, [{ add:{ kind:"say", text:"Before I build, one quick check." }, at:Date.now() }, { add:{ kind:"tool", id:"r1", state:"done", verb:"Read", target:"a.js" }, at:Date.now() }, { add:{ kind:"tool", id:"q1", state:"running", verb:"Asked you", target:"", questions:questionsOf(ASKED) }, at:Date.now() }]);
  await s.conversationChanges(p, claude, [{ add:{ kind:"tool", id:"q2", state:"running", verb:"Asked you", target:"", questions:questionsOf({ questions:[{ question:"Which header should I upload?", options:[{ label:"B: map card" }] }] }) }, at:Date.now() }]);
  await s.conversationChanges(p, running, [{ add:{ kind:"tool", id:"r9", state:"running", verb:"Read", target:"desk.js" }, at:Date.now() }]);
  s.sync(p);
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (await api.handle(req, res, url)) return;
    const file = path.resolve(root, "public", `.${url.pathname}`);
    if (!file.startsWith(path.join(root, "public") + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type":mime[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel:"chrome" });
  const ctx = await browser.newContext({ viewport:{ width:1440, height:900 }, reducedMotion:"reduce", permissions:["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${base}/projects.html#${p.id}`);
  await page.waitForFunction(() => window.__lines?.project()?.lines.length === 4);
  await page.waitForSelector(".row[data-row='by-dsh']", { state:"attached" });
  const row = id => page.locator(`.row[data-row="${id}"]`);
  const says = async (loc, words) => (await loc.innerText()).includes(words);

  // ---------- Home ----------
  check("the asking line says Answer", (await row("by-dsh").locator(".line-hint").innerText()) === "Answer");
  check("a finished line nobody has opened says Unread", (await row("was-finished").locator(".line-hint").innerText()) === "Unread");
  const place = async id => row(id).locator(".line-hint").evaluate(el => { const r = el.getBoundingClientRect(), name = el.closest(".row-name").getBoundingClientRect(); return { first:el === el.parentElement.firstElementChild, left:Math.round(r.left - name.left), height:Math.round(r.height) }; });
  const a = await place("by-dsh"), u = await place("was-finished");
  check("Answer and Unread sit in the same place", a.first && u.first && a.left === u.left && a.height === u.height);
  const colour = async id => row(id).locator(".line-hint").evaluate(el => getComputedStyle(el).color);
  check("and only their colour differs", (await colour("by-dsh")) !== (await colour("was-finished")));
  check("nothing pops up", (await page.locator(".call, .band, .ask-pill, [role=alertdialog], dialog[open]").count()) === 0);
  check("the tool's name is nowhere on the page", !(await page.locator("#view").innerText()).includes("ask_user_question"));
  check("the row no longer turns", (await row("by-dsh").locator(".spin").count()) === 0);
  check("the running line still does", (await row("still-running").locator(".spin").count()) > 0);
  check("its stop says the question", await says(row("by-dsh").locator(".st.st-wait").first(), "what felt weak?"));
  check("its running dash has stopped", (await row("by-dsh").locator(".st.st-active").count()) === 0);
  check("the asking lines left Now", !(await page.locator("#nowStrip").innerText()).includes("In line detail page"));
  check("the running one stayed", await says(page.locator("#nowStrip"), "For grill me situations"));
  check("Needs you says the question", await says(page.locator("#needStrip"), "?"));
  check("the row says it once, with no chip or button beside it", (await row("by-dsh").locator(".row-right .chip, .row-right .btn.primary").count()) === 0);
  await page.screenshot({ path:path.join(shots, "asking-home.png") });

  // The app that can be opened by a click is opened by the click.
  const needAnswer = page.locator('#needStrip [data-act="open-desktop"], #needStrip [data-act="copy-command"]').first();
  check("Needs you has a button that goes to the agent", await needAnswer.count() === 1 && /^Answer in /.test(await needAnswer.innerText()));

  // ---------- Its line ----------
  await row("by-dsh").locator(".row-name").click({ force:true });
  await page.waitForSelector("#linePage");
  await pause(700);
  const work = page.locator("#item-work-1");
  check("the Work box says Answer", (await work.locator(".line-answer").innerText()) === "Answer");
  check("and both questions", await says(work, "what felt weak?") && await says(work, "How should the two prototypes be presented?"));
  check("not the tool's name", !(await page.locator("#linePage").innerText()).includes("ask_user_question"));
  check("the Work box no longer turns", (await work.locator(".spin").count()) === 0);
  check("the page says Needs you", (await page.locator(".lp-meta .chip").innerText()).includes("Needs you"));
  check("the panel holds the choices", await says(page.locator(".lpp-asked"), "One page, two looks on a switch"));
  check("the panel has no spinning row", (await page.locator(".at-live").count()) === 0);
  check("what it said before asking stays in the panel", await says(page.locator("#lppRows"), "Before I build, one quick check."));
  check("the side stop asks", await says(page.locator(".lps.st-wait"), "what felt weak?"));
  check("the box says where the answer goes", (await page.locator(".lp-dock .cmp-input").getAttribute("placeholder")).includes("To answer dsh"));
  await page.screenshot({ path:path.join(shots, "asking-line.png") });
  await work.locator('[data-act="copy-command"]').click();
  await pause(150);
  check("dsh has no link, so the button copies its command", (await page.evaluate(() => navigator.clipboard.readText())).includes("dsh web"));
  check("the click stays on the page", (await page.locator("#linePage").count()) === 1);

  await page.locator('[data-act="line-back"]').click();
  await page.waitForSelector(".row[data-row='by-dsh']", { state:"attached" });
  await pause(500);
  check("opening the line does not clear Answer", (await row("by-dsh").locator(".line-hint").innerText()) === "Answer");

  // ---------- Claude can be opened ----------
  await row("by-claude").locator(".row-name").click({ force:true });
  await page.waitForSelector("#linePage");
  await pause(500);
  await page.locator('#item-work-1 [data-act="open-desktop"]').click();
  await pause(200);
  check("Answer in Claude opens that conversation", opened.some(o => o.slug === "by-claude" && o.agent === "claude"));
  await page.locator('[data-act="line-back"]').click();
  await page.waitForSelector(".row[data-row='by-dsh']", { state:"attached" });

  // ---------- The answer arrives ----------
  await s.conversationChanges(p, dsh, [{ patch:{ id:"q1", state:"done", output:"{}" } }]);
  s.sync(p);
  await page.evaluate(() => window.__lines.poll?.());
  await page.waitForFunction(() => !window.__lines.project().lines.find(l => l.id === "by-dsh").asking, null, { timeout:8000 });
  await pause(400);
  const hint = row("by-dsh").locator(".line-hint.line-answer");
  check("the answer ends it by itself", (await hint.count()) === 0);
  check("and it turns again", (await row("by-dsh").locator(".spin").count()) > 0);
  check("it is back in Now", await says(page.locator("#nowStrip"), "In line detail page"));
  await page.screenshot({ path:path.join(shots, "asking-answered.png") });

  check("no errors on the page", errors.length === 0);
  console.log(`${passed} checks passed`);
  await browser.close();
  server.close();
  s.close();
})().catch(async error => {
  console.error(error.message.slice(0, 900), errors);
  await browser?.close();
  server?.close();
  process.exit(1);
});
