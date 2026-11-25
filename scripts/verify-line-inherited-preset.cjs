"use strict";
// Real browser/API regression for PE-509. Isolated documents and fake runners; no AI task is executed.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-line-inherited-preset.cjs
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http"), assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const F = require("../src/server/project-lines/format.js");
const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "inherited-preset-"));
const bin = path.join(temp, "bin"); fs.mkdirSync(bin);
for (const id of ["codex", "claude"]) fs.writeFileSync(path.join(bin, id), "#!/bin/sh\necho 1.0.0\n", { mode:0o755 });
const agents = createAgents({ env:{ HOME:temp, PATH:bin }, appFolders:[] });
const api = createProjectLines({ directory:path.join(temp, "state"), agents, serviceOptions:{ autoWatch:false, memory:{ home:temp, env:{} }, conversations:{ home:temp, env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
  send:(res, status, data) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
const s = api.service, p = s.store.create({ name:"Historical agent", docsPath:path.join(temp, "docs") });
p.follow = false; p.offerSkill = false; s.store.save();
agents.pickModel("codex", "gpt-6.1-sol", "max");
s.presets.add({ agent:"codex", model:"gpt-6-astra", effort:"medium" });
s.presets.add({ agent:"codex", model:"gpt-6.1-sol", effort:"xhigh" });
s.presets.add({ agent:"claude", model:"opus", effort:"high", default:true });
s.writeDoc(p, "historical", F.initialLine({ title:"Sidebar and Home redesign", who:"@codex", status:"done", steps:[
  F.askStep({ words:"Pls fix it as proposed." }), { ...F.workStep({ who:"codex" }), done:true, took:"3 min" },
] }));
const work = F.parseLine(s.readDoc(p, "historical")).steps[1];
s.startDetail(p, "historical", work, "codex", { title:"Sidebar and Home redesign", steps:[] });
s.store.writeText(p, F.detailPath("historical", work.id), F.setFront(s.store.readText(p, F.detailPath("historical", work.id)).text, {
  "saved agent":"Codex · gpt-6-astra · high effort", model:"gpt-6-astra", effort:"high", ended:"2026-11-13 20:04",
}));
let browser, server, launch;
s.launch = async (project, slug) => {
  const preset = s.presetFor(project, slug, "codex");
  const cmd = agents.command("codex", { workdir:temp, docs:temp, gitDir:"", also:[], ...s.presets.handOver(preset) });
  launch = { model:cmd.thread.model, effort:cmd.turn.effort };
};
(async () => {
  await s.saveUnsent(p, { topic:"historical", text:"test" });
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (await api.handle(req, res, url)) return;
    const file = path.resolve(root, "public", `.${url.pathname}`);
    if (!file.startsWith(path.join(root, "public") + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type":({ ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml" })[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  browser = await chromium.launch({ channel:"chrome", ...(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport:{ width:1440, height:1000 } }), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/projects.html#${p.id}/line/historical`);
  const button = page.locator('.run-main[data-act="unsent-run"]');
  await button.waitFor();
  const expected = "Run with Codex · gpt-6-astra · high effort";
  assert.equal(await button.innerText(), expected);
  await page.evaluate(() => refreshRunLabels());
  assert.equal(await button.innerText(), expected, "agent refresh preserves inherited facts");
  await page.reload(); await button.waitFor();
  assert.equal(await button.innerText(), expected, "browser reload preserves inheritance");
  assert.equal(await button.getAttribute("data-preset"), "", "no invented saved preset ID");
  // Shared Home/panorama controls derive the same choice, and narrow layouts keep Run visible.
  assert.ok(await page.evaluate(() => { const l = lineById(project(), "historical"), ask = l.stations.at(-1); return [unsentRowHTML(project(), { l, s:ask, at:1 }), laneSendHTML(project(), l, ask)].every(html => html.includes('title="Run with Codex · gpt-6-astra · high effort"')); }));
  await page.setViewportSize({ width:390, height:844 }); await button.scrollIntoViewIfNeeded();
  assert.equal(await button.isVisible(), true);
  await button.focus(); await page.keyboard.press("Enter");
  for (let i = 0; i < 50 && !launch; i++) await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(launch, { model:"gpt-6-astra", effort:"high" }, "one keyboard activation reaches server launch with the shown settings");
  assert.deepEqual(errors, []);
  console.log("PASS: inherited label, delayed refresh, reload, Home/panorama, narrow view, keyboard Run, and server adapter configuration");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); s.close(); if (server) await new Promise(resolve => server.close(resolve)); fs.rmSync(temp, { recursive:true, force:true });
});
