"use strict";
// Real-browser check for the redesigned Statistics page. Uses canonical public/ and server code; never runs an agent.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-lines-statistics.cjs [screenshot-folder]
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");
const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "lines-statistics-"));
const shots = path.resolve(process.argv[2] || path.join(temp, "shots")); fs.mkdirSync(shots, { recursive:true });
const agents = { available:() => [], nameOf:id => id, desktop:() => null, terminal:() => "" };
const api = createProjectLines({ directory:path.join(temp, "state"), agents, serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, "home"), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
  send:(res, status, data) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
const s = api.service, p = s.store.create({ name:"Statistics check", docsPath:path.join(temp, "docs") });
p.follow = false; p.offerSkill = false; s.store.save();
const label = ms => { const d = new Date(ms), z = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
const ago = h => label(Date.now() - h * 3600e3);
const LINES = [
  ["sync", "Fix sync deletion", "done", [["codex", true, 50, 12, "gpt-6.2-astra", { rating:"good", "rating note":"Clean diff, tests added", kind:"fix" }], ["claude", true, 26, 8, "claude-opus-5-5", { kind:"code" }]]],
  ["stats", "Statistics page", "done", [["claude", true, 5, 20, "claude-opus-5-5", { rating:"bad", "rating note":"Changed files I did not ask for", kind:"code" }], ["claude", true, 3, 6, "claude-opus-5-5", { kind:"docs" }], ["codex", true, 2, 9, "gpt-6.2-astra", { kind:"review" }]]],
  ["broke", "Desktop update hint", "stopped", [["codex", false, 1, 0, "gpt-6.2-astra", { "stop why":"limit", kind:"fix" }]]],
  ["ask", "Agent permissions", "waiting", [["claude", false, 0.5, 0, "claude-opus-5-5", { kind:"code" }]]],
  ["old", "Old settings modal", "closed", [["codex", true, 120, 15, "gpt-6.2-astra", { kind:"code" }]]],
];
for (const [slug, title, status, works] of LINES) {
  const steps = [];
  works.forEach(([who, done, h, min]) => { steps.push(F.askStep({ words:`Do part of ${title}.`, when:ago(h + 0.1) })); steps.push(F.workStep({ who, done, took:done ? `${min} min` : "", body:"Done." })); });
  s.writeDoc(p, slug, F.initialLine({ title, status, steps }));
  works.forEach(([who, done, h, min, model, extra], i) => {
    const front = { model, ...(done ? { took:`${min} min`, ended:label(Date.now() - h * 3600e3 + min * 60e3) } : {}), ...extra };
    s.store.writeText(p, `topics/${slug}/work-${i + 1}.md`, F.setFront(F.initialDetail({ slug, title, label:`Work ${i + 1}`, who, started:ago(h), now:"" }), front));
  });
}
api.orchestrator.setPrice({ model:"claude-opus-5-5", input:4, output:20, cached:0.2 });
api.orchestrator.setPrice({ model:"gpt-6.2-astra", input:8, output:40, cached:0.4 });
s.sync(p);

let browser, server, passed = 0;
const tall = async (page, file, width = 1600) => {
  const h = await page.evaluate(() => document.querySelector(".sx-page").scrollHeight + 80);
  await page.setViewportSize({ width, height:Math.max(820, h) });
  await page.waitForTimeout(300);
  await page.screenshot({ path:file });
};
const check = (name, ok, info = "") => { assert.ok(ok, `${name} ${info}`); passed++; console.log(`ok ${name}`); };
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
  const context = await browser.newContext({ viewport:{ width:1600, height:1000 }, reducedMotion:"reduce" }), page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${base}/projects.html#${p.id}/home`); await page.reload();
  await page.locator('#projbar .subnav [data-view="stats"]').waitFor();

  const views = await page.$$eval("#projbar .subnav [data-view]", els => els.map(e => e.dataset.view));
  check("Statistics is on the bar", views.includes("stats"), views.join());
  await page.click('#projbar .subnav [data-view="stats"]');
  await page.locator(".sx-sum").waitFor();
  await page.locator("#statsRecord table").waitFor();
  check("the Statistics tab is marked", await page.locator('#projbar .subnav [data-view="stats"].on').count() === 1);

  await page.click('[data-act="stats-period"][data-period="all"]');
  await page.waitForTimeout(250);
  const sum = (await page.locator(".sx-sum").innerText()).replace(/\s+/g, " ");
  check("overview has 5 KPI cells and no Finished rate", await page.locator(".sx-sum > div").count() === 5 && !/Finished/.test(sum), sum);
  check("totals count every Work", /Works 8 /i.test(sum), sum);
  check("combined rating appears in overview", /Rating 3\.3 \/5/i.test(sum), sum);
  check("exactly one Agents section and no Models/Now/Lines/Why/Days clutter",
    await page.locator(".sx-agents").count() === 1 &&
    await page.locator(".sx-models, .sx-now, .sx-lines, .sx-why-card").count() === 0);
  // PE-742: Works by day (kind of job or agent), the agents' share, and the Agent index across every project on this computer.
  check("Works by day chart and the agents' share are shown", await page.locator(".sx-daily .sx-days").count() === 1 && await page.locator(".sx-share-list li").count() >= 2);
  await page.locator(".sx-index h2").waitFor();
  await page.waitForFunction(() => !/Counting/.test(document.querySelector(".sx-index")?.innerText || ""));
  check("the Agent index says it counts every project on this computer", /on this computer/i.test(await page.locator(".sx-index .sx-eyebrow").first().innerText()));
  check("the Agent index table renders without a Follow-ups column or follow-up copy",
    await page.locator(".sx-ix-table tr").count() >= 2 &&
    !/follow-?up/i.test(await page.locator(".sx-index").innerText()));
  check("no NaN or undefined", !/NaN|undefined/.test(await page.locator(".sx-page").innerText()));
  await tall(page, path.join(shots, "statistics-desktop.png")); await page.setViewportSize({ width:1600, height:1000 });

  // Period filter hides older Works in Needs your rating.
  await page.click('[data-act="stats-period"][data-period="today"]');
  await page.waitForTimeout(250);
  check("Today leaves out older Works", !/Old settings modal/.test(await page.locator(".sx-page").innerText()));
  await page.click('[data-act="stats-period"][data-period="all"]');
  await page.waitForTimeout(250);

  // Agent filter narrows the unified Agents table and keeps keyboard focus.
  await page.click('[data-act="stats-agent"][data-agent="codex"]');
  const recordText = await page.locator("#statsRecord").innerText();
  check("Codex filter narrows unified Agents table to Codex", /Codex/i.test(recordText) && !/Claude/i.test(recordText), recordText);
  check("the filter keeps the keyboard on its button", await page.evaluate(() => document.activeElement?.dataset?.agent) === "codex");
  await page.click('[data-act="stats-agent"][data-agent="all"]');

  // Rating from Needs your rating saves and removes the row.
  const before = await page.locator(".sx-rq").count();
  await page.locator('.sx-rq [data-act="work-rate"][data-rating="good"]').first().click();
  await page.waitForFunction(n => document.querySelectorAll(".sx-rq").length === n - 1, before);
  const workFiles = dir => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { recursive:true }).filter(f => /work-\d+\.md$/.test(f)).map(f => fs.readFileSync(path.join(dir, f), "utf8"));
  const rated = ["works", "topics"].flatMap(d => workFiles(path.join(temp, "docs", d))).filter(t => /^rating: good$/m.test(t)).length;
  check("the rating is kept in the Work's file", rated === 2, String(rated));

  // Narrow viewport: Statistics leaves bar, zero sideways scroll.
  await page.setViewportSize({ width:390, height:844 }); await page.waitForTimeout(500);
  const narrowViews = await page.$$eval("#projbar .subnav [data-view]", els => els.map(e => e.dataset.view));
  check("on a narrow bar Statistics leaves the bar", !narrowViews.includes("stats"), narrowViews.join());
  check("narrow page does not scroll sideways", await page.evaluate(() => document.querySelector(".sx-page").scrollWidth <= document.querySelector(".sx-page").clientWidth + 1));
  await tall(page, path.join(shots, "statistics-narrow.png"), 390);
  await page.setViewportSize({ width:1600, height:1000 }); await page.waitForTimeout(500);

  // Dark mode screenshot.
  await page.evaluate(() => document.documentElement.setAttribute("data-mode", "dark"));
  await tall(page, path.join(shots, "statistics-dark.png"));

  // Example Statistics mode on a project with no ratings yet (local server with 0 rated Works across all projects).
  const exTemp = fs.mkdtempSync(path.join(os.tmpdir(), "lines-stats-example-"));
  const exApi = createProjectLines({ directory:path.join(exTemp, "state"), agents, serviceOptions:{ autoWatch:false, memory:{ home:path.join(exTemp, "home"), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
    readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
    send:(res, status, data) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const exSvc = exApi.service, exProj = exSvc.store.create({ name:"Fresh project", docsPath:path.join(exTemp, "docs") });
  exProj.follow = false; exProj.offerSkill = false; exSvc.store.save();
  exSvc.writeDoc(exProj, "unrated", F.initialLine({ title:"Initial setup", status:"done", steps:[
    F.askStep({ words:"Set up initial scaffold.", when:ago(2) }),
    F.workStep({ who:"claude", done:true, took:"4 min", body:"Done." }),
  ] }));
  exSvc.store.writeText(exProj, "topics/unrated/work-1.md", F.setFront(F.initialDetail({ slug:"unrated", title:"Initial setup", label:"Work 1", who:"claude", started:ago(2), now:"" }), { model:"claude-opus-5-5", took:"4 min", ended:ago(1.9), kind:"code" }));
  exSvc.sync(exProj);
  const exServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (await exApi.handle(req, res, url)) return;
    const file = path.resolve(root, "public", `.${url.pathname}`);
    if (!file.startsWith(path.join(root, "public") + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type":mime[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => { exServer.once("error", reject); exServer.listen(0, "127.0.0.1", resolve); });
  try {
    const exBase = `http://127.0.0.1:${exServer.address().port}`;
    await page.evaluate(() => document.documentElement.removeAttribute("data-mode"));
    await page.setViewportSize({ width:1600, height:1000 });
    await page.goto(`${exBase}/projects.html#${exProj.id}/stats`);
    await page.locator(".sx-page.is-example .sx-ex-banner").waitFor();
    const exText = (await page.locator(".sx-ex-banner").innerText()).replace(/\s+/g, " ");
    check("example statistics page appears when no ratings exist and clearly says it is an example",
      await page.locator(".sx-ex-pill").innerText() === "EXAMPLE" || /Example/i.test(await page.locator(".sx-ex-pill").innerText()),
      exText);
    check("example banner explains optional rating, Orchestrator auto-rate, and more accurate decisions",
      /optional/i.test(exText) && /auto-rate/i.test(exText) && /more and more accurate/i.test(exText), exText);
    check("example preview renders KPIs, daily chart, Agent index, heatmap and score-vs-cost while hiding empty #statsRecord",
      await page.locator(".sx-ex-frame .sx-sum > div").count() === 5 &&
      await page.locator(".sx-ex-frame .sx-heat").count() === 1 &&
      await page.locator(".sx-ex-frame .sx-value").count() === 1 &&
      await page.locator("#statsRecord").isHidden());
    check("real Needs your rating stays usable below the example preview", await page.locator("#statsRate .sx-rq").count() === 1);
    await tall(page, path.join(shots, "statistics-example-desktop.png"));
    await page.setViewportSize({ width:1600, height:1000 });
    await page.evaluate(() => document.documentElement.setAttribute("data-mode", "dark"));
    await tall(page, path.join(shots, "statistics-example-dark.png"));
    await page.evaluate(() => document.documentElement.removeAttribute("data-mode"));
    await page.setViewportSize({ width:390, height:844 }); await page.waitForTimeout(300);
    const narrowInfo = await page.evaluate(() => {
      const pg = document.querySelector(".sx-page"), pr = pg.getBoundingClientRect();
      const wide = [...pg.querySelectorAll("*")].map(el => ({ cls:el.className?.toString?.() || el.tagName, over:Math.round(el.getBoundingClientRect().right - pr.right), sw:el.scrollWidth, cw:el.clientWidth })).filter(x => x.over > 1).slice(0, 8);
      return { ok:pg.scrollWidth <= pg.clientWidth + 1, sw:pg.scrollWidth, cw:pg.clientWidth, wide };
    });
    check("example page has no sideways scroll on narrow viewport", narrowInfo.ok, JSON.stringify(narrowInfo));
    await tall(page, path.join(shots, "statistics-example-narrow.png"), 390);
    await page.setViewportSize({ width:1600, height:1000 });

    // Toggling to current stats and back to example works cleanly.
    await page.click('[data-act="stats-example-toggle"]');
    await page.locator(".sx-ex-mini").waitFor();
    check("Show my current stats exits example view and offers View example", await page.locator(".sx-page.is-example").count() === 0);
    await page.click('[data-act="stats-example-toggle"]');
    await page.locator(".sx-page.is-example .sx-ex-banner").waitFor();

    // Rating the real unrated Work automatically exits example mode into real Statistics.
    await page.locator('#statsRate [data-act="work-rate"][data-rating="good"]').first().click();
    await page.waitForFunction(() => !document.querySelector(".sx-page.is-example"));
    check("rating a Work exits example mode automatically", await page.locator(".sx-ex-banner").count() === 0);
  } finally {
    exServer.close(); exSvc.close?.(); fs.rmSync(exTemp, { recursive:true, force:true });
  }

  check("no page errors", !errors.length, errors.join("\n"));
  console.log(`${passed} checks passed. Pictures: ${shots}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); server?.close(); s.close?.(); fs.rmSync(path.join(temp, "state"), { recursive:true, force:true });
});
