"use strict";
// Isolated real-browser acceptance for Todo. Uses canonical public/ and server code; never runs an agent.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-project-line-todo.cjs [screenshot-folder]
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");
const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "line-todo-browser-"));
const shots = path.resolve(process.argv[2] || path.join(temp, "shots")); fs.mkdirSync(shots, { recursive:true });
const agents = { available:() => [], nameOf:id => id, desktop:() => null, terminal:() => "" };
const api = createProjectLines({ directory:path.join(temp, "state"), agents, serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, "home"), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
  send:(res, status, data) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
const s = api.service, p = s.store.create({ name:"Todo status", docsPath:path.join(temp, "docs") });
p.follow = false; p.offerSkill = false; s.store.save();
for (const [slug, title, reviewed] of [["uncertain", "Decide whether this idea is useful", false], ["review", "Search results need a review", false], ["finished", "Reviewed documentation", true]]) {
  s.writeDoc(p, slug, F.setFront(F.initialLine({ title, status:"done", steps:[F.askStep({ words:"Compare the search layout options.", when:"2026-11-07 09:00" }), F.workStep({ who:"codex", done:true, took:"2 min", body:"The comparison is ready. Keep the options available while deciding whether to use them." })] }), { finished:"2026-11-07 09:02" }));
  s.store.writeText(p, `topics/${slug}/work-1.md`, F.setFront(F.setResult(F.initialDetail({ slug, title, label:"Work 1", who:"codex", started:"2026-11-07 09:00", now:"" }), "Both options are available. The choice is still uncertain."), { reviewed:reviewed ? "2026-11-07 09:03" : null }));
}
s.sync(p);
const detail = () => s.store.readText(p, "topics/uncertain/work-1.md").text;
let browser, server, passed = 0;
const check = (label, ok) => { assert.ok(ok, label); passed++; console.log(`ok ${label}`); };
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
  const context = await browser.newContext({ viewport:{ width:1440, height:950 }, reducedMotion:"reduce" }), page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const open = async route => { await page.goto(`${base}/projects.html#${p.id}${route}`); await page.reload(); };
  const fresh = () => page.evaluate(async () => { await loadState(S.cur, { force:true }); refreshAfterChange(); });
  const beside = async (a, b) => {
    const [x, y] = await Promise.all([a.boundingBox(), b.boundingBox()]);
    return x && y && x.x + x.width <= y.x + 1 && Math.abs(x.y + x.height / 2 - y.y - y.height / 2) < 2
      && await a.evaluate(n => getComputedStyle(n).opacity === "1") && await b.evaluate(n => getComputedStyle(n).opacity === "1");
  };
  const foot = page.locator("#lpThread .lp-end"), todo = foot.locator(".lp-todo"), footWord = () => foot.locator("strong").innerText();
  const saved = () => /^(?:todo: yes)$/m.test(s.readDoc(p, "uncertain"));
  await open("/line/uncertain"); await todo.waitFor();
  const original = detail();
  await page.mouse.move(1, 1);
  check("Mark todo is visible beside Mark all reviewed without hover", await beside(todo, foot.locator(".lp-all-reviewed")));
  await foot.scrollIntoViewIfNeeded(); await page.screenshot({ path:path.join(shots, "review-actions-desktop.png") });
  check("Mark todo is beside the existing footer actions, and Mark outdated is only in ⋯", await todo.isVisible() && await foot.locator(".lp-all-reviewed").isVisible() && await foot.locator(".lp-outdated").count() === 0);
  let release;
  const held = new Promise(r => { release = r; });
  await page.route("**/topics/uncertain/todo", async route => { await held; await route.continue(); });
  await todo.click();
  check("Todo appears before the save finishes", await footWord() === "Todo" && !saved());
  check("another disposition cannot race the pending save", await todo.isDisabled() && await foot.locator(".lp-all-reviewed").isDisabled());
  check("header and sidebar show Todo too", (await page.locator("#lpHead .chip").first().innerText()) === "Todo" && await page.locator("#lpList .lps.k-end .lps-end").innerText() === "Todo");
  release();
  await page.waitForFunction(() => !S.lineMarkSaving?.size);
  await page.unroute("**/topics/uncertain/todo");
  check("Todo saves without changing the Work result or review mark", saved() && detail() === original);
  await page.reload(); await foot.locator(".lp-todo[aria-pressed=true]").waitFor();
  check("reload keeps Todo and all review remains available", await footWord() === "Todo" && await foot.locator(".lp-all-reviewed").isVisible());
  await foot.scrollIntoViewIfNeeded(); await page.screenshot({ path:path.join(shots, "todo-line.png") });

  await page.route("**/topics/uncertain/todo", route => route.fulfill({ status:500, json:{ error:"Todo save failed for this check." } }));
  await todo.click(); await page.waitForFunction(() => !S.lineMarkSaving?.size);
  check("failed clear restores Todo and explains the failure", await footWord() === "Todo" && (await page.locator("#toast").innerText()).includes("Todo save failed"));
  await page.unroute("**/topics/uncertain/todo");
  await todo.focus(); await page.keyboard.press("Space"); await page.waitForFunction(() => !S.lineMarkSaving?.size);
  check("Space clears Todo and preserves keyboard focus", await footWord() === "To review" && await todo.evaluate(n => n === document.activeElement));
  await todo.click(); await page.waitForFunction(() => !S.lineMarkSaving?.size);
  await page.route("**/topics/uncertain/review-all", route => route.fulfill({ status:500, json:{ error:"Review save failed for this check." } }));
  await foot.locator(".lp-all-reviewed").click();
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("Review save failed"));
  check("failed review-all restores Todo and the Work review mark", await footWord() === "Todo" && !(await page.locator("#item-work-1").evaluate(n => n.classList.contains("is-reviewed"))));
  await page.unroute("**/topics/uncertain/review-all");
  await foot.locator(".lp-all-reviewed").click();
  await page.waitForFunction(() => !project().lines.find(l => l.id === "uncertain").todo && project().lines.find(l => l.id === "uncertain").stations.find(s => s.kind === "work").reviewed);
  check("review-all clears Todo and marks the result reviewed", await footWord() === "Finished" && !saved());
  await todo.click(); await page.waitForFunction(() => !S.lineMarkSaving?.size);
  check("a reviewed line can also be kept Todo", await footWord() === "Todo");

  await open(""); await page.locator("#panoSum [data-f=todo]").waitFor();
  const row = page.locator('.hl-row[data-row="uncertain"]');
  check("old Todo stays visible on default Home, outside finished folds", await row.isVisible() && (await row.locator(".hl-state").innerText()) === "Todo");
  await page.locator("#panoSum [data-f=todo]").click();
  check("one click filters Home to Todo only", await page.locator(".hl-row").count() === 1 && await row.isVisible());
  await page.screenshot({ path:path.join(shots, "todo-home-filter.png") });
  await page.setViewportSize({ width:420, height:900 });
  check("Home Todo filter remains visible on narrow screens", await page.locator("#panoSum [data-f=todo]").isVisible());
  await page.setViewportSize({ width:1440, height:950 });
  await page.locator("#panoSum [data-f=todo]").click();
  const reviewRow = page.locator('.hl-row[data-row="review"]'), laneTodo = reviewRow.locator('[data-act="line-todo"]'), laneReview = reviewRow.locator('[data-act="lane-reviewed"]');
  await reviewRow.locator('[data-act="row-open"]').first().click();
  await page.mouse.move(1, 1);
  check("Home preview shows Mark todo beside Mark reviewed without hover", await beside(laneTodo, laneReview));
  await page.screenshot({ path:path.join(shots, "review-actions-home.png") });
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height:900 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (width === 390) await page.screenshot({ path:path.join(shots, "review-actions-home-narrow.png") });
    check(`${width}px Home preview keeps the review choices side by side`, await beside(laneTodo, laneReview));
    check(`${width}px Home actions fit their row`, await reviewRow.locator(".hd-acts").evaluate(n => n.getBoundingClientRect().right <= n.closest(".hl-detail").getBoundingClientRect().right + 1));
  }
  let homeRelease;
  const homeHeld = new Promise(r => { homeRelease = r; });
  await page.route("**/topics/review/todo", async route => { await homeHeld; await route.continue(); });
  await laneTodo.click();
  check("Home Todo updates immediately and keeps both actions disabled while saving", await laneTodo.getAttribute("aria-pressed") === "true" && await laneTodo.isDisabled() && await laneReview.isDisabled());
  homeRelease(); await page.waitForFunction(() => !S.lineMarkSaving?.size);
  await page.unroute("**/topics/review/todo");
  check("Home Todo preserves the Work review state", await page.evaluate(() => { const l = lineById(project(), "review"); return l.todo && !l.stations.find(s => s.kind === "work").reviewed; }));
  await laneReview.click(); await page.waitForFunction(() => !S.lineMarkSaving?.size);
  check("Home Mark reviewed clears Todo and reviews the Work", await page.evaluate(() => { const l = lineById(project(), "review"); return !l.todo && l.stations.find(s => s.kind === "work").reviewed; }));
  await page.setViewportSize({ width:1440, height:950 });
  await page.locator('.bar-right [data-view="find"]').click(); await page.locator("#findInput").fill("options");
  await page.locator('.find-status [data-status="todo"]').waitFor();
  await page.locator('.find-status [data-status="todo"]').click();
  await page.waitForFunction(() => FIND.data?.requestStatus === "todo" && !FIND.busy);
  check("Find Todo intersects the query and returns the pending line", await page.locator('.fl-state.s-todo').count() === 1 && (await page.locator("#findBody").innerText()).includes("Decide whether this idea is useful"));
  await page.screenshot({ path:path.join(shots, "todo-find-filter.png") });
  await page.setViewportSize({ width:420, height:900 });
  check("Find Todo filter remains visible on narrow screens", await page.locator('.find-status [data-status="todo"]').isVisible());

  await open("/line/uncertain"); await todo.waitFor();
  await s.act(p, "uncertain", "review", { step:"work-1", reviewed:false }); await fresh();
  for (const width of [1440, 1100, 860, 420, 390]) {
    await page.setViewportSize({ width, height:900 }); await foot.scrollIntoViewIfNeeded();
    await page.mouse.move(1, 1);
    const over = await foot.evaluate(n => n.scrollWidth > n.clientWidth + 2 || n.querySelector("header").scrollWidth > n.querySelector("header").clientWidth + 2);
    check(`${width}px footer keeps both controls visible without horizontal overflow`, !over && await todo.isVisible() && await foot.locator(".lp-all-reviewed").isVisible());
    check(`${width}px footer keeps the review choices side by side without hover`, await beside(todo, foot.locator(".lp-all-reviewed")));
    if (width === 390) await page.screenshot({ path:path.join(shots, "todo-narrow.png") });
  }
  await page.evaluate(() => document.documentElement.dataset.mode = "dark");
  await page.screenshot({ path:path.join(shots, "todo-dark.png") });
  const touch = await browser.newContext({ viewport:{ width:420, height:900 }, hasTouch:true, isMobile:true, reducedMotion:"reduce" }), phone = await touch.newPage();
  phone.on("pageerror", e => errors.push(e.message));
  await phone.goto(`${base}/projects.html#${p.id}/line/uncertain`);
  const touchTodo = phone.locator("#lpThread .lp-todo"); await touchTodo.waitFor();
  await touchTodo.tap(); await phone.waitForFunction(() => !S.lineMarkSaving?.size);
  check("touch can clear Todo directly", await phone.locator(".lp-end > header strong").innerText() === "To review");
  await touch.close();
  s.resumeWork(p, { slug:"uncertain", stepId:"work-1" }); s.sync(p); await fresh();
  check("new work shows Working without offering the Todo action", await page.locator("#lpThread .lp-todo").count() === 0 && (await page.locator("#lpHead .chip").first().innerText()) === "Working");
  check("no browser errors", errors.length === 0);
  console.log(`${passed} checks passed. Screenshots: ${shots}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); server?.close(); s.close(); fs.rmSync(temp, { recursive:true, force:true });
});
