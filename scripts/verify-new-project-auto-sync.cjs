#!/usr/bin/env node
"use strict";
// A new project made with a code folder syncs its conversations by itself (PE-515); with none, or when the sync fails, its empty page stays.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-new-project-auto-sync.cjs [screenshot-folder]
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { encodeFolder } = require("../src/server/project-lines/conversations.js");
const root = path.resolve(__dirname, ".."), temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-auto-sync-")));
const shots = path.resolve(process.argv[2] || path.join(temp, "shots")); fs.mkdirSync(shots, { recursive:true });
const home = path.join(temp, "home");
const folder = name => { const p = path.join(temp, name); fs.mkdirSync(p, { recursive:true }); return p; };
const withChats = folder("code-with-chats"), quiet = folder("code-quiet"), broken = folder("code-broken");
// A Claude Code conversation had in a code folder before its project was made.
const chat = (cwd, id, text, hours) => {
  const dir = path.join(home, ".claude", "projects", encodeFolder(cwd)), at = new Date(Date.now() - hours * 3600000).toISOString();
  const rows = [{ type:"user", isSidechain:false, cwd, sessionId:id, gitBranch:"main", entrypoint:"claude-desktop", timestamp:at, origin:{ kind:"human" }, message:{ role:"user", content:[{ type:"text", text }] } },
    { type:"assistant", isSidechain:false, cwd, entrypoint:"claude-desktop", timestamp:at, message:{ content:[{ type:"text", text:"Done." }] } }];
  fs.mkdirSync(dir, { recursive:true }); fs.writeFileSync(path.join(dir, `${id}.jsonl`), rows.map(r => JSON.stringify(r)).join("\n") + "\n");
};
for (let i = 0; i < 3; i++) chat(withChats, `chat-${i}`, `Earlier conversation ${i}`, 5 - i);
const api = createProjectLines({ directory:path.join(temp, "state"), computerRounds:0,
  agents:{ available:() => [], nameOf:id => id, desktop:() => null, terminal:() => "" },
  serviceOptions:{ autoWatch:false, docsBase:path.join(temp, "projects"), memory:{ home, env:{} }, conversations:{ home, env:{}, idleMs:30 } },
  isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
  send:(res, status, body) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(body)); } });
const store = api.service.store;
store.create({ name:"Existing project", docsPath:path.join(temp, "projects/existing") });
let browser, server, passed = 0;
const errors = [], check = (label, ok) => { assert.ok(ok, label); passed++; console.log(`ok ${label}`); };
const mime = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml", ".webp":"image/webp" };
(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (await api.handle(req, res, url)) return;
    const file = path.resolve(root, "public", "." + url.pathname);
    if (!file.startsWith(path.join(root, "public") + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type":mime[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1440, height:1000 }, reducedMotion:"reduce" });
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", e => errors.push(e.message));
  const syncs = [];
  page.on("request", r => { if (r.method() === "POST" && /\/sync$/.test(r.url())) syncs.push(r.url()); });
  const form = () => page.locator("#startPanel .pls-form");
  const make = async (name, code) => {
    await page.goto(`${base}/projects.html#new`); await form().waitFor();
    await form().locator('[name="name"]').fill(name);
    await form().locator('[name="docs"]').fill(path.join(temp, "projects", name.toLowerCase().replace(/\W+/g, "-")));
    await form().locator('[name="code"]').fill(code);
    await form().locator('[type="submit"]').click();
    await page.waitForFunction(n => window.__lines?.project()?.name === n, name);
  };
  const lineCount = () => page.evaluate(() => { const p = window.__lines.project(); return p.lines.length + p.landed.length + p.backlog.length; });

  // With conversations: they come in with no click, and the page becomes the project's lines while the sync is still going (its answer held back 4 s here).
  await page.route("**/sync", async route => { const answer = await route.fetch(); await new Promise(r => setTimeout(r, 4000)); await route.fulfill({ response:answer }); });
  const t0 = Date.now();
  await make("With chats", withChats);
  await page.waitForFunction(() => document.querySelector("#pano"));
  const took = Date.now() - t0;
  check(`the lines map replaces the empty page before the sync has answered (${took} ms from Create)`, took < 3500 && await page.evaluate(() => window.__lines.S.syncing) && await page.locator(".start-two").count() === 0);
  await page.waitForFunction(() => !window.__lines.S.syncing);
  await page.unroute("**/sync");
  check("conversations sync by themselves after Create, with no click", syncs.length === 1 && await lineCount() === 3);
  await page.screenshot({ path:path.join(shots, "after-auto-sync.png") });

  // Nothing to bring in: the empty page stays, with Sync conversations ready to click again.
  await make("Quiet code", quiet);
  await page.waitForFunction(() => !window.__lines.S.syncing && document.querySelector(".start-code-btn:not([disabled])"));
  check("with no conversations the empty project page stays", syncs.length === 2 && await page.locator(".start-two .start-col").count() === 3 && await lineCount() === 0);
  check("its Sync conversations card is ready again", /Sync conversations/.test(await page.locator(".start-code-btn").innerText()));
  check("it says why nothing came", /No other conversations/.test(await page.locator("body").innerText()));
  await page.screenshot({ path:path.join(shots, "nothing-to-sync.png") });

  // A sync that fails: the empty page stays and says why.
  await page.route("**/sync", async route => { await new Promise(r => setTimeout(r, 1500)); await route.fulfill({ status:500, contentType:"application/json", body:JSON.stringify({ error:"Could not read the conversations." }) }); });
  await make("Broken sync", broken);
  await page.locator(".start-code-btn[disabled] .spin").waitFor();
  check("while it syncs, the card says Syncing… with a turning mark", /Syncing/.test(await page.locator(".start-code-btn").innerText()));
  await page.locator(".start-two").screenshot({ path:path.join(shots, "syncing.png") });
  await page.waitForFunction(() => !window.__lines.S.syncing && document.querySelector(".start-code-btn:not([disabled])"));
  check("when the sync fails the empty project page stays and says why", syncs.length === 3 && await page.locator(".start-two .start-col").count() === 3 && /Could not read the conversations/.test(await page.locator("body").innerText()));
  await page.unroute("**/sync");

  // Without a code folder nothing is synced.
  await page.goto(`${base}/projects.html#new`); await form().waitFor();
  await form().locator('[name="name"]').fill("No code");
  await form().locator('[name="docs"]').fill(path.join(temp, "projects", "no-code"));
  await form().locator('[type="submit"]').click();
  await page.waitForFunction(() => window.__lines?.project()?.name === "No code");
  await page.waitForTimeout(500);
  check("a project with no code folder does not sync", syncs.length === 3);

  // Made by the form with no page of its own to go to (the Canvas page's New project): the Lines page it opens syncs it.
  const again = folder("code-from-canvas");
  chat(again, "chat-canvas", "Asked before the Canvas made this project", 2);
  // A page of its own, as the Canvas is: only start.js and the form.
  await page.route("**/canvas-start.html", route => route.fulfill({ contentType:"text/html", body:`<!doctype html><link rel="stylesheet" href="/lines/start.css"><div id="plainStart"></div><script src="/lines/start.js"></script><script>PenEchoProjects.mount(document.querySelector("#plainStart"), { showExamples:false, showBenefits:false, showTitle:false });</script>` }));
  await page.goto(`${base}/canvas-start.html`);
  const plain = page.locator("#plainStart .pls-form");
  await plain.locator('[name="name"]').fill("From the Canvas");
  await plain.locator('[name="docs"]').fill(path.join(temp, "projects", "from-canvas"));
  await plain.locator('[name="code"]').fill(again);
  await plain.locator('[type="submit"]').click();
  await page.waitForFunction(() => window.__lines?.project()?.name === "From the Canvas" && document.querySelector("#pano"));
  check("a project made from the Canvas page's form syncs on the Lines page it opens", syncs.length === 4 && await lineCount() === 1 && await page.evaluate(() => !sessionStorage.getItem("penecho-lines-made")));
  check("no browser script errors", errors.length === 0);
  console.log(`${passed} checks passed. Screenshots: ${shots}`);
})().catch(error => { console.error(error); console.error(errors); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); api.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (!process.argv[2]) fs.rmSync(temp, { recursive:true, force:true, maxRetries:3 });
});
