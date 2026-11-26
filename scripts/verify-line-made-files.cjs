"use strict";
// Real-browser check: a Work's panel lists only the files right in the line's folder, and each folder inside it as one chip that opens the Vault there. Never runs an agent.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-line-made-files.cjs [screenshot-folder]
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");
const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "line-made-files-"));
const shots = path.resolve(process.argv[2] || path.join(temp, "shots")); fs.mkdirSync(shots, { recursive:true });
const agents = { available:() => [], nameOf:id => id, desktop:() => null, terminal:() => "" };
const api = createProjectLines({ directory:path.join(temp, "state"), agents, serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, "home"), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
  send:(res, status, data) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
const s = api.service, p = s.store.create({ name:"Made files", docsPath:path.join(temp, "docs") });
p.follow = false; p.offerSkill = false; s.store.save();
s.writeDoc(p, "research", F.setFront(F.initialLine({ title:"Prompt research", status:"done", steps:[
  F.askStep({ words:"Find the best prompt.", when:"2026-11-16 09:00" }),
  F.workStep({ who:"claude", done:true, took:"40 min", body:"Ran three rounds." }),
] }), { finished:"2026-11-16 09:40" }));
// What an agent leaves in the line's folder: a result, a script, and hundreds of scratch files in folders.
const put = (rel, text) => { const at = path.join(p.docsPath, rel); fs.mkdirSync(path.dirname(at), { recursive:true }); fs.writeFileSync(at, text); };
put("files/research/findings.md", "# Findings\n");
put("files/research/run.py", "print(1)\n");
for (let i = 0; i < 40; i++) put(`files/research/runs/r${i % 4}/topic-${i}.md`, "x\n");
for (let i = 0; i < 6; i++) put(`files/research/__pycache__/m${i}.cpython-313.pyc`, "x");
s.sync(p);
let browser, server, passed = 0;
const check = (label, ok, info = "") => { assert.ok(ok, `${label} ${info}`); passed++; console.log(`ok ${label}`); };
const mime = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml", ".webp":"image/webp" };
(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (await api.handle(req, res, url)) return;
    const file = path.resolve(root, "public", `.${url.pathname}`);
    if (!file.startsWith(path.join(root, "public") + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type":mime[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1600, height:950 }, reducedMotion:"reduce" }), page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${base}/projects.html#${p.id}/line/research`); await page.reload();
  await page.locator("#lpThread .lp-work").first().waitFor();
  await page.locator("#lpThread .lp-work").first().click();
  await page.locator("#lppMade .file-ref").first().waitFor();
  const chips = await page.$$eval("#lppMade .file-ref", els => els.map(e => [e.dataset.act, e.textContent.trim()]));
  check("the panel lists folders first, then the files right in the line's folder", JSON.stringify(chips) === JSON.stringify([["open-folder", "__pycache__"], ["open-folder", "runs"], ["open-doc", "findings.md"], ["open-asset", "run.py"]]), JSON.stringify(chips));
  check("a folder says how many files it holds when pointed at", await page.getAttribute('#lppMade [data-path="files/research/runs"]', "title") === "40 files");
  await page.screenshot({ path:path.join(shots, "panel-made.png"), clip:{ x:800, y:0, width:800, height:600 } });
  await page.click('#lppMade [data-path="files/research/runs"]');
  await page.waitForFunction(() => S.route.view === "vault");
  check("the folder opens in the Vault, unfolded down to it", await page.evaluate(() => ["/files", "/files/research", "/files/research/runs"].every(d => document.querySelector(`#vaultTree details.tree-dir[data-dir="${d}"]`)?.open)));
  await page.screenshot({ path:path.join(shots, "vault-folder.png") });
  check("no page errors", errors.length === 0, errors.join("\n"));
  console.log(`${passed} checks passed. Pictures in ${shots}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); server?.close(); s.close?.(); fs.rmSync(path.join(temp, "state"), { recursive:true, force:true }); });
