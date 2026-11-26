#!/usr/bin/env node
"use strict";
// New project: real form + real creation/import routes, isolated data, no agents or native folder dialogs.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-project-folder-guard.cjs [screenshot-folder]
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const root = path.resolve(__dirname, ".."), temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-folder-ui-")));
const shots = path.resolve(process.argv[2] || path.join(temp, "shots")); fs.mkdirSync(shots, { recursive:true });
const api = createProjectLines({ directory:path.join(temp, "state"), computerRounds:0,
  agents:{ available:() => [], nameOf:id => id, desktop:() => null, terminal:() => "" },
  serviceOptions:{ autoWatch:false, docsBase:path.join(temp, "projects"), memory:{ home:path.join(temp, "home"), env:{} } },
  isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
  send:(res, status, body) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(body)); } });
const store = api.service.store, existing = store.create({ name:"Existing project", docsPath:path.join(temp, "projects/existing") });
const nonempty = path.join(temp, "notes"); fs.mkdirSync(nonempty); fs.writeFileSync(path.join(nonempty, "mine.txt"), "Keep this.\n");
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
  const context = await browser.newContext({ viewport:{ width:1440, height:1000 }, reducedMotion:"reduce", hasTouch:true });
  const page = await context.newPage(); page.setDefaultTimeout(12000); page.on("pageerror", e => errors.push(e.message));
  let chosen = nonempty;
  await page.route("**/api/lines/pick-folder", route => route.fulfill({ json:{ path:chosen } }));
  const form = () => page.locator("#startPanel .pls-form");
  const open = async () => { await page.goto(`${base}/projects.html#new`); await form().waitFor(); };
  await open();
  const rule = form().locator(".pls-folder-rule");
  const docsDesc = form().locator(".pls-docs-desc");
  const codeDesc = form().locator(".pls-code-desc");
  check("docs and code descriptions clearly explain the difference", await docsDesc.isVisible() && /Lines.*Markdown \(\.md\) files.*read anywhere.*lifecycles/i.test(await docsDesc.innerText()) && await codeDesc.isVisible() && /source code or repository folder/i.test(await codeDesc.innerText()));
  check("folder rule is visible by default", await rule.isVisible() && /empty folder outside.*PenEcho manages/.test(await rule.innerText()));
  const docsDescribedBy = (await form().locator('[name="docs"]').getAttribute("aria-describedby") || "").split(/\s+/);
  check("the docs input describes its purpose and empty-folder requirement", docsDescribedBy.includes(await docsDesc.getAttribute("id")) && docsDescribedBy.includes(await rule.getAttribute("id")));
  await page.locator(".np-card").screenshot({ path:path.join(shots, "initial-card.png") });
  await form().locator('[name="name"]').fill("My new project");
  await form().locator('[data-pick="docs"]').click();
  await page.waitForFunction(folder => document.querySelector('#startPanel [name="docs"]')?.value === folder, nonempty);
  check("choosing a custom folder keeps the requirement visible", await rule.isVisible() && await form().locator('[name="docs"]').inputValue() === nonempty);
  await form().screenshot({ path:path.join(shots, "default-form.png") });
  for (const [folder, code, message] of [[nonempty, "FOLDER_NOT_EMPTY", /not empty/], [existing.docsPath, "PROJECT_EXISTS", /Existing project/], [path.join(existing.docsPath, "new"), "PROJECT_OVERLAP", /inside the project/]]) {
    await form().locator('[name="docs"]').fill(folder);
    const response = page.waitForResponse(r => r.url() === `${base}/api/lines/projects` && r.request().method() === "POST");
    await form().locator('[type="submit"]').click();
    const refused = await response;
    check(`${code}: server refuses creation`, refused.status() === 409 && (await refused.json()).code === code);
    const error = form().locator(".pls-error"); await error.waitFor();
    check(`${code}: visible reason and retained input`, message.test(await error.innerText()) && await form().locator('[name="docs"]').inputValue() === folder && await form().locator('[name="name"]').inputValue() === "My new project");
    check(`${code}: no new project or navigation`, store.projects.length === 1 && page.url().endsWith("#new"));
  }
  check("original files were left intact", fs.readFileSync(path.join(nonempty, "mine.txt"), "utf8") === "Keep this.\n" && fs.readdirSync(nonempty).length === 1 && !fs.existsSync(path.join(existing.docsPath, "new")));
  await form().screenshot({ path:path.join(shots, "blocked-form.png") });
  await page.setViewportSize({ width:390, height:844 });
  check("narrow form has no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check("import and create remain directly visible controls on touch", await form().locator('[data-import]').isVisible() && await form().locator('[type="submit"]').isVisible());
  await page.evaluate(() => window.linesTheme.set("dark"));
  await form().screenshot({ path:path.join(shots, "blocked-narrow-dark.png") });
  const safe = path.join(temp, "projects/safe"); fs.mkdirSync(safe);
  await form().locator('[name="docs"]').fill(safe);
  await form().locator('[name="docs"]').press("Enter");
  await page.waitForFunction(() => window.__lines?.project()?.name === "My new project");
  check("corrected empty folder creates with Enter", store.projects.length === 2 && fs.existsSync(path.join(safe, "MEMORY.md")));
  await open(); chosen = existing.docsPath;
  await form().locator('[data-import]').tap();
  await page.waitForFunction(id => window.__lines?.project()?.id === id, existing.id);
  check("Open existing docs folder reopens without duplication", store.projects.length === 2);
  await open();
  await page.evaluate(() => window.PenEchoProjects.mount(document.querySelector("#startPanel"), { lang:"zh", showExamples:false, showBenefits:false, showTitle:false }));
  await form().locator('[name="name"]').fill("新项目");
  await form().locator('[name="docs"]').fill(nonempty);
  await form().locator('[type="submit"]').tap();
  await page.waitForFunction(() => document.querySelector("#startPanel .pls-error")?.textContent.includes("不是空的"));
  check("Chinese helper and failure explain the same requirement", /空文件夹/.test(await form().locator(".pls-folder-rule").innerText()) && /Markdown.*生命周期/.test(await form().locator(".pls-docs-desc").innerText()) && /源代码或仓库文件夹/.test(await form().locator(".pls-code-desc").innerText()));
  check("no browser script errors", errors.length === 0);
  console.log(`${passed} checks passed. Screenshots: ${shots}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); api.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  fs.rmSync(temp, { recursive:true, force:true, maxRetries:3 });
});
