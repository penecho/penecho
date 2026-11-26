"use strict";
// Isolated real-browser acceptance for Next in the same filter: open a line from a filtered Home or Find, review it, go on to the next one.
// Uses canonical public/ and server code; never runs an agent.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-lines-walk.cjs [screenshot-folder]
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");
const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "line-walk-browser-"));
const shots = path.resolve(process.argv[2] || path.join(temp, "shots")); fs.mkdirSync(shots, { recursive:true });
const agents = { available:() => [], nameOf:id => id, desktop:() => null, terminal:() => "" };
const api = createProjectLines({ directory:path.join(temp, "state"), agents, serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, "home"), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
  send:(res, status, data) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
const s = api.service, p = s.store.create({ name:"Walk", docsPath:path.join(temp, "docs") });
p.follow = false; p.offerSkill = false; s.store.save();
// Three to review (newest first on the Home: c, b, a) and one already reviewed.
const LINES = [["walk-a", "Alpha result to review", false, "09"], ["walk-b", "Bravo result to review", false, "10"], ["walk-c", "Charlie result to review", false, "11"], ["walk-d", "Delta reviewed already", true, "12"]];
for (const [slug, title, reviewed, hour] of LINES) {
  s.writeDoc(p, slug, F.setFront(F.initialLine({ title, status:"done", steps:[F.askStep({ words:`Compare the layout options for ${title}.`, when:`2026-11-07 ${hour}:00` }), F.workStep({ who:"codex", done:true, took:"2 min", body:"The comparison of layout options is ready." })] }), { finished:`2026-11-07 ${hour}:02` }));
  s.store.writeText(p, `topics/${slug}/work-1.md`, F.setFront(F.setResult(F.initialDetail({ slug, title, label:"Work 1", who:"codex", started:`2026-11-07 ${hour}:00`, now:"" }), "Layout options compared."), { reviewed:reviewed ? `2026-11-07 ${hour}:03` : null }));
}
s.sync(p);
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
  const walk = page.locator("#lpHead .lp-walk"), next = walk.locator(".btn"), prev = walk.locator(".icon-btn");
  const onLine = () => page.evaluate(() => S.route.view === "line" && S.route.line);

  await open(""); await page.locator("#panoSum [data-f=review]").waitFor();
  await page.locator('.hl-row[data-row="walk-a"] .hl-main').click(); await page.locator("#linePage").waitFor();
  check("a line opened from an unfiltered Home shows no Next", await walk.count() === 0);

  await open(""); await page.locator("#panoSum [data-f=review]").click();
  const order = await page.locator(".hl-row").evaluateAll(rows => rows.map(r => r.dataset.row));
  check("the To review filter lists the three lines to review", order.length === 3 && !order.includes("walk-d"));
  await page.locator(`.hl-row[data-row="${order[0]}"] .hl-main`).click(); await walk.waitFor();
  check("a line opened from the To review filter offers Next to review with how many are left", (await next.innerText()).replace(/\s+/g, " ").trim() === "Next to review 2" && await prev.count() === 1);
  check("Next is quiet while this line still needs review", !(await next.evaluate(n => n.classList.contains("primary"))));
  await page.screenshot({ path:path.join(shots, "walk-before-review.png") });

  await page.locator("#lpThread .lp-all-reviewed").click();
  await page.waitForFunction(() => !S.lineMarkSaving?.size);
  await page.locator("#lpHead .lp-walk .btn.primary").waitFor();
  check("after Mark all reviewed, Next becomes the main button and counts the others", (await next.innerText()).replace(/\s+/g, " ").trim() === "Next to review 2");
  check("the reviewed line leaves the filter, so Back is not needed to find the next", await prev.count() === 1);
  await page.screenshot({ path:path.join(shots, "walk-after-review.png") });

  await next.click(); await page.waitForFunction(id => S.route.line === id, order[1]);
  check("Next opens the line below it in the list", await onLine() === order[1]);
  check("it opens at the first Work not reviewed", await page.evaluate(() => S.route.step === "work-1"));
  check("on the next line only the one other line is left, so no Previous", (await next.innerText()).replace(/\s+/g, " ").trim() === "Next to review 1" && await prev.count() === 0);

  await page.locator("body").click({ position:{ x:5, y:5 } });
  await page.keyboard.press("Alt+ArrowDown"); await page.waitForFunction(id => S.route.line === id, order[2]);
  check("Alt+Down goes to the next line too", await onLine() === order[2]);
  await page.locator("#lpThread .lp-all-reviewed").click(); await page.waitForFunction(() => !S.lineMarkSaving?.size);
  await next.click(); await page.waitForFunction(id => S.route.line === id, order[1]);
  check("past the end it comes round to the one still to review", await onLine() === order[1]);
  await page.locator("#lpThread .lp-all-reviewed").click(); await page.waitForFunction(() => !S.lineMarkSaving?.size);
  await page.waitForFunction(() => !document.querySelector("#lpHead .lp-walk"));
  check("with nothing left to review, Next goes away", await walk.count() === 0);

  await page.setViewportSize({ width:420, height:900 });
  await s.act(p, "walk-a", "review", { step:"work-1", reviewed:false }); await s.act(p, "walk-b", "review", { step:"work-1", reviewed:false });
  await open(""); await page.locator(".hl-row .hl-main").first().click(); await walk.waitFor();
  const head = await page.locator("#lpHead .lp-head-row").evaluate(n => n.scrollWidth <= n.clientWidth + 2);
  check("narrow: Next keeps its arrow and count and the head does not overflow", head && await next.isVisible() && !(await walk.locator(".lp-walk-w").isVisible()));
  await page.screenshot({ path:path.join(shots, "walk-narrow.png") });
  await page.setViewportSize({ width:1440, height:950 });

  await page.evaluate(() => { setHomeChoice(project(), { f:"" }); });
  await open("/find"); await page.locator("#findInput").fill("layout");
  await page.locator('.find-status [data-status="review"]').click();
  await page.waitForFunction(() => FIND.data?.requestStatus === "review" && !FIND.busy);
  const found = await page.locator("#findBody .fl").evaluateAll(els => els.map(e => e.dataset.line));
  check("Find with To review lists the two lines to review", found.length === 2);
  await page.locator(`#findBody .fl[data-line="${found[0]}"] [data-act="find-open"]`).first().click(); await walk.waitFor();
  check("a line opened from Find's To review offers the other one", (await next.innerText()).replace(/\s+/g, " ").trim() === "Next to review 1");
  await next.click(); await page.waitForFunction(id => S.route.line === id, found[1]);
  check("Next from Find opens the other line found", await onLine() === found[1]);
  await page.locator('#lpList .lps').first().click().catch(() => {});
  await page.evaluate(() => go({ view:"line", line:"walk-d" }));
  check("opening a line outside the list ends it", await walk.count() === 0 && await page.evaluate(() => S.walk === null));
  await page.evaluate(() => document.documentElement.dataset.mode = "dark");
  check("no browser errors", errors.length === 0);
  console.log(`${passed} checks passed. Screenshots: ${shots}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); server?.close(); fs.rmSync(temp, { recursive:true, force:true, maxRetries:3 });
});
