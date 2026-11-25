#!/usr/bin/env node
"use strict";
// Real-browser check that a Work always shows who did it and the way to its conversation, with a result or without one.
//   PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-project-line-where.cjs [screenshot-folder]
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");

const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "line-where-browser-"));
const shots = path.resolve(process.argv[2] || path.join(temp, "shots")); fs.mkdirSync(shots, { recursive:true });
let passed = 0, browser, server;
const links = [], errors = [];
const check = (label, value) => { assert.ok(value, label); passed++; console.log(`ok ${label}`); };
const pause = ms => new Promise(r => setTimeout(r, ms));

// What actually runs when you click, without opening anything on this computer.
const spawnFn = (command, args) => { if (command === "open") links.push(args[0]); const child = new EventEmitter(); setImmediate(() => child.emit("close", 0)); return child; };
const agents = {
  available:() => [{ id:"claude", name:"Claude Code", mono:"Cl", color:"#a8502a", available:true }],
  nameOf:() => "Claude", terminal:() => "",
  desktop:(id, session) => (id === "claude" ? { command:"open", args:[`claude://resume?session=${session}`] } : null),
};
const api = createProjectLines({ directory:path.join(temp, "state"), agents, serviceOptions:{ autoWatch:false, spawnFn, memory:{ home:path.join(temp, "home"), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
  send:(res, status, data) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
const s = api.service, p = s.store.create({ name:"Where", docsPath:path.join(temp, "docs") });
p.follow = false; p.offerSkill = false; p.trunkCache = { git:true, name:"main" }; s.store.save();

const when = "2026-11-07 05:16", long = Array.from({ length:80 }, (_, i) => `Line ${i + 1} of a long result.`).join("\n\n");
s.writeDoc(p, "two-chats", F.initialLine({ title:"Two conversations with Claude", status:"working", created:when, steps:[
  F.askStep({ words:"First, please.", when }),
  { ...F.workStep({ who:"claude", done:true, took:"4 min" }), body:"Finished.\n\n[details](two-chats/work-1.md)" },
  F.askStep({ words:"Now the second.", when }),
  F.workStep({ who:"claude" }),
] }));
s.writeDoc(p, "two-chats", F.setFront(s.readDoc(p, "two-chats"), { branch:"claude/a-rather-long-branch-name", source:"Claude desktop", who:"@claude" }));
s.writeDoc(p, "not-yet", F.initialLine({ title:"No conversation yet", status:"working", created:when, steps:[F.askStep({ words:"Please begin.", when }), F.workStep({ who:"claude" })] }));
s.conversations.recordOf("claude", "chat-one"); s.conversations.recordOf("claude", "chat-two");
s.remember(p, "two-chats", "claude", "chat-one", "work", p.docsPath);
s.remember(p, "two-chats", "claude", "chat-two", "work", p.docsPath);
s.activity.add(p, "two-chats", { kind:"tool", id:"chat-one:a", state:"done", verb:"Read", target:"a.js", step:"work-1" });
s.activity.add(p, "two-chats", { kind:"tool", id:"chat-two:b", state:"running", verb:"Ran", target:"npm test", step:"work-2" });
const mime = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml", ".webp":"image/webp" };

(async () => {
  await s.closeDetail(p, "two-chats", "work-1", { result:long, took:"4 min" });
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
  const page = await (await browser.newContext({ viewport:{ width:1440, height:900 }, reducedMotion:"reduce" })).newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${base}/projects.html#${p.id}`);
  await page.waitForFunction(() => window.__lines?.project()?.lines.length === 2);
  const openLine = async (slug, step) => {
    await page.evaluate(([line, st]) => window.__lines.go({ view:"line", line, step:st }), [slug, step]);
    await page.waitForSelector("#linePage");
    await pause(450);
  };
  const chat = page.locator('#lppWhere [data-act="open-desktop"]'), file = page.locator("#lppWhere .lpp-doc");
  const inView = async sel => {
    const box = await page.locator(sel).boundingBox(), view = page.viewportSize();
    return Boolean(box) && box.height > 0 && box.y >= 0 && box.y + box.height <= view.height + 1;
  };

  // ---------- Working, with nothing to read yet ----------
  await openLine("two-chats", "work-2");
  await page.waitForSelector("#lppWhere .where-card");
  check("the working Work shows how to reach them and where", (await chat.count()) === 1 && (await page.locator("#lppWhere .wc-path").count()) === 1);
  check("the head says who", /Claude Code/.test(await page.locator("#lppHead").textContent()));
  check("the link says where it goes", /Open in Claude desktop/.test(await chat.innerText()));
  await page.screenshot({ path:path.join(shots, "where-working.png") });
  await page.locator("#lppFoot").click();
  await pause(200);
  check("closing Details leaves them showing", await page.locator("#lppDetails").isHidden() && await inView("#lppWhere .where-card"));
  await page.screenshot({ path:path.join(shots, "where-working-closed.png") });
  await chat.click();
  await pause(250);
  check("the click goes to this Work's conversation", links.at(-1) === "claude://resume?session=chat-two");
  check("and nothing goes wrong", (await page.locator("#toast").innerText().catch(() => "")).trim() === "");

  // ---------- A finished Work from an earlier conversation ----------
  await page.locator('[data-act="panel-go"]').first().click();
  await pause(450);
  check("a finished Work shows them with Details shut", await page.locator("#lppDetails").isHidden() && await inView("#lppWhere .where-card"));
  check("and names its own file", (await file.innerText()) === "work-1.md" && (await file.getAttribute("data-doc")) === "works/two-chats/work-1.md");
  const lines = await page.locator("#lppWhere .where-card > div").count(), height = (await page.locator("#lppWhere .where-card").boundingBox()).height;
  check("all of it fits on two lines", lines === 2 && height <= 72);
  check("the folder and branch share the second", /a-rather-long-branch-name/.test(await page.locator("#lppWhere .where-card > div").nth(1).innerText()) && await page.locator("#lppWhere .where-card > div").nth(1).locator(".wc-path").count() === 1);
  check("each line stays one line high", await page.locator("#lppWhere .where-card > div").evaluateAll(rows => rows.every(r => r.getBoundingClientRect().height <= 26)));
  check("a path reads left to right", await page.locator("#lppWhere .wc-path code").evaluate(el => {
    const text = el.firstChild, at = i => { const r = document.createRange(); r.setStart(text, i); r.setEnd(text, i + 1); return r.getBoundingClientRect().left; };
    return text.length > 4 && at(1) < at(text.length - 2);
  }));
  await page.locator("#lppWhere").screenshot({ path:path.join(shots, "where-two-lines.png") });
  await chat.click();
  await pause(250);
  check("its link goes to its own conversation, not the latest", links.at(-1) === "claude://resume?session=chat-one");

  // ---------- A long result scrolls past them ----------
  const before = await page.locator("#lppWhere").boundingBox();
  await page.locator("#lppScroll").evaluate(el => { el.scrollTop = el.scrollHeight; });
  await pause(150);
  const after = await page.locator("#lppWhere").boundingBox();
  check("a long result scrolls and they stay put", (await page.locator("#lppScroll").evaluate(el => el.scrollTop)) > 100 && before.y === after.y);
  await page.screenshot({ path:path.join(shots, "where-finished-scrolled.png") });

  // ---------- A short window ----------
  await page.setViewportSize({ width:1280, height:620 });
  await pause(200);
  check("in a short window they are still there", await inView("#lppWhere .where-card"));
  check("and the words keep most of the room", (await page.locator("#lppScroll").boundingBox()).height >= 240);
  await page.screenshot({ path:path.join(shots, "where-short-window.png") });
  await page.setViewportSize({ width:1440, height:900 });

  // ---------- The conversation arrives while you are looking ----------
  await openLine("not-yet", "work-1");
  await page.waitForSelector("#lppWhere .where-card");
  check("before a conversation is known, no link pretends", (await chat.count()) === 0);
  s.conversations.recordOf("claude", "chat-new");
  s.remember(p, "not-yet", "claude", "chat-new", "work", p.docsPath);
  s.sync(p);
  await page.evaluate(() => window.__lines.poll?.());
  await page.waitForFunction(() => document.querySelector("#lppWhere [data-act='open-desktop']"), null, { timeout:8000 });
  check("the link appears by itself", (await chat.count()) === 1);
  await chat.click();
  await pause(250);
  check("and goes there", links.at(-1) === "claude://resume?session=chat-new");

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
