#!/usr/bin/env node
"use strict";
// Project switching on real line pages, with isolated projects and no running agents.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-project-line-navigation.cjs [screenshot-folder]
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const assert = require("node:assert/strict"), { Readable } = require("node:stream");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");

const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "line-navigation-browser-"));
const shots = path.resolve(process.argv[2] || path.join(temp, "shots")); fs.mkdirSync(shots, { recursive:true });
let passed = 0;
const check = (label, value) => { assert.ok(value, label); passed++; console.log(`ok ${label}`); };
const agents = { available:() => [], nameOf:id => id, desktop:() => null, terminal:() => "" };
const api = createProjectLines({ directory:path.join(temp, "state"), agents, serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, "home"), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
  send:(res, status, data) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
const service = api.service;
const projects = ["Alpha", "Beta"].map(name => {
  const p = service.store.create({ name, docsPath:path.join(temp, name) });
  p.follow = false; p.offerSkill = false;
  const steps = [F.askStep({ words:`${name}: first request`, when:"2026-11-07 09:00" }), F.workStep({ who:"claude", done:true, took:"1 min", body:`${name}: first result` }), F.askStep({ words:Array.from({ length:45 }, (_, i) => `${name}: paragraph ${i + 1} with enough text to scroll through the conversation.`).join("\n\n"), when:"2026-11-07 09:10" }), F.workStep({ who:"claude", done:true, took:"2 min", body:`${name}: second result` })];
  // Identical slugs and step IDs deliberately exercise project isolation.
  service.writeDoc(p, "same-line", F.initialLine({ title:`${name} work`, id:`${name}-1`, status:"ready", steps }));
  for (const n of [1, 2]) service.store.writeText(p, `works/same-line/work-${n}.md`, F.initialDetail({ slug:"same-line", title:`${name} work`, label:`Work ${n}`, who:"claude", started:"2026-11-07 09:00", now:Array.from({ length:45 }, (_, i) => `${name} Work ${n}, detail paragraph ${i + 1}.`).join("\n\n") }));
  service.sync(p);
  return p;
});
service.store.save();
const mime = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml" };
let browser, server;
const verification = (async () => {
  try {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (await api.handle(req, res, url)) return;
      const file = path.resolve(root, "public", `.${url.pathname}`);
      if (!file.startsWith(path.join(root, "public") + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type":mime[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res);
    });
    // The in-process transport also runs where opening a local TCP port is unavailable.
    const listen = process.env.PENECHO_NAV_HTTP === "1";
    if (listen) await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const base = listen ? `http://127.0.0.1:${server.address().port}` : "http://penecho-navigation.test";
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
    const context = await browser.newContext({ viewport:{ width:1600, height:900 }, reducedMotion:"reduce" });
    const serveRoute = async route => {
      const request = route.request(), url = new URL(request.url());
      const req = Object.assign(Readable.from(request.postData() ? [request.postData()] : []), { method:request.method(), url:url.pathname + url.search, headers:request.headers(), socket:{ remoteAddress:"127.0.0.1" } });
      let status = 200, headers = {}, body;
      const res = { writeHead:(s, h) => { status = s; headers = h; }, end:b => { body = b || ""; } };
      if (await api.handle(req, res, url)) { await route.fulfill({ status, headers, body }); return; }
      const file = path.resolve(root, "public", `.${url.pathname}`);
      if (!file.startsWith(path.join(root, "public") + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { await route.fulfill({ status:404, body:"" }); return; }
      await route.fulfill({ contentType:mime[path.extname(file)] || "application/octet-stream", body:fs.readFileSync(file) });
    };
    if (!listen) await context.route(`${base}/**`, serveRoute);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    const [alpha, beta] = projects;
    const open = async (p, suffix = "/line/same-line/work-1") => { await page.goto(`${base}/projects.html#${p.id}${suffix}`); await page.waitForFunction(id => window.__lines?.S.cur === id && document.querySelector("#linePage"), p.id); };
    const switchTo = async p => { await page.locator(`.rail-row[data-p="${p.id}"]`).click(); await page.waitForFunction(id => window.__lines.S.cur === id, p.id); };
    const route = () => page.evaluate(() => window.__lines.S.route);
    const draft = () => page.locator(".lp-dock .cmp-input");
    const screenshot = name => page.screenshot({ path:path.join(shots, `${name}.png`) });

    await open(alpha);
    check("projects remain visible on a line", await page.locator("#rail").isVisible());
    check("another project is directly clickable", await page.locator(`.rail-row[data-p="${beta.id}"]`).isVisible());
    await screenshot("1-line-with-projects");

    await draft().fill("Alpha unfinished reply");
    const alphaTop = await page.locator("#lpScroll").evaluate(el => { el.scrollTop = 180; return el.scrollTop; });
    await switchTo(beta);
    check("an unvisited project opens at home", (await route()).view === "home");
    await open(beta, "/line/same-line/work-2");
    check("the same line name in another project has a separate draft", await draft().inputValue() === "");
    await draft().fill("Beta unfinished reply");
    await switchTo(alpha);
    check("returning restores the line and selected Work", (await route()).line === "same-line" && (await route()).step === "work-1");
    check("returning restores the outgoing reading position", Math.abs(await page.locator("#lpScroll").evaluate(el => el.scrollTop) - alphaTop) <= 2);
    check("returning restores Alpha's draft", await draft().inputValue() === "Alpha unfinished reply");
    await switchTo(beta);
    check("Beta resumes its own selected Work", (await route()).step === "work-2");
    check("Beta keeps its own unfinished reply", await draft().inputValue() === "Beta unfinished reply");
    await switchTo(alpha);

    const hide = page.getByRole("button", { name:"Hide projects", exact:true });
    await hide.focus(); await page.keyboard.press("Enter");
    check("the project toggle works from the keyboard", await page.locator("#rail").isHidden());
    check("hiding projects preserves the draft", await draft().inputValue() === "Alpha unfinished reply");
    await page.reload(); await page.waitForSelector("#linePage");
    check("reload remembers the hidden project rail", await page.locator("#rail").isHidden());
    check("reload keeps the line draft", await draft().inputValue() === "Alpha unfinished reply");
    await page.locator(".lp-back").click();
    check("returning home keeps projects hidden", await page.locator("#rail").isHidden() && (await route()).view === "home");
    await screenshot("home-projects-hidden");
    await page.getByRole("button", { name:"Show projects", exact:true }).click();
    check("home shows projects again from the bar", await page.locator("#rail").isVisible());
    await page.getByRole("button", { name:"Hide projects", exact:true }).click();
    check("Hide projects is there on the home too", await page.locator("#rail").isHidden());
    await page.getByRole("button", { name:"Show projects", exact:true }).click();
    // Every project's sidebar lists its same-line now: this one is the project on screen.
    await page.locator('#railList .rail-row.on').evaluate(row => row.closest('.rail-item').nextElementSibling.querySelector('.rail-line[data-line="same-line"]').click());
    await page.getByRole("button", { name:"Hide projects", exact:true }).click();
    check("returning to a line keeps the hiding choice", await page.locator("#rail").isHidden());
    check("only one Show projects on a line", await page.getByRole("button", { name:"Show projects", exact:true }).count() === 1);
    await page.getByRole("button", { name:"Show projects", exact:true }).click();
    check("the project rail can be shown directly", await page.locator("#rail").isVisible());

    await page.evaluate(() => window.__lines.go({ view:"line", line:"same-line", step:"work-1" }));
    await page.locator('[data-act="panel-close"]').click();
    await switchTo(beta); await switchTo(alpha);
    check("a deliberately closed Work panel stays closed", await page.locator("#lpPanel").isHidden());
    await page.goto(`${base}/projects.html?resume=1`);
    await page.waitForSelector("#linePage");
    check("opening Projects without a destination resumes the saved line", (await route()).line === "same-line");
    await page.goto(`${base}/projects.html#${alpha.id}`);
    await page.waitForFunction(() => window.__lines?.S.route.view === "home");
    check("an explicit home link takes precedence over saved work", (await route()).view === "home");
    await page.evaluate(() => { window.__lines.go({ view:"line", line:"same-line", step:"work-2" }); window.__lines.go({ view:"home" }); });
    await page.goBack(); await page.waitForSelector("#linePage");
    check("browser Back returns to its explicit line and Work", (await route()).step === "work-2");

    await page.evaluate(() => window.__lines.go({ view:"line", line:"same-line", step:"missing" }));
    check("a missing Work falls back to its line and fixes the URL", !(await route()).step && page.url().endsWith("/line/same-line"));
    await page.evaluate(() => window.__lines.go({ view:"line", line:"missing" }));
    check("a missing line falls back home and fixes the URL", (await route()).view === "home" && page.url().endsWith(`#${alpha.id}`));

    await open(alpha);
    for (const width of [1200, 1000, 390, 320]) {
      await page.setViewportSize({ width, height:900 });
      check(`${width}px keeps projects visible`, await page.locator("#rail").isVisible());
      check(`${width}px has no horizontal page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector("#view").scrollWidth <= document.querySelector("#view").clientWidth + 1));
      check(`${width}px Work overlay leaves project switching accessible`, await page.evaluate(() => document.querySelector("#lpPanel").getBoundingClientRect().left >= document.querySelector("#rail").getBoundingClientRect().right - 1));
      await screenshot(`width-${width}`);
    }
    await page.evaluate(() => window.__lines.go({ view:"home" }));
    check("the narrow home composer leaves the project rail clear", await page.evaluate(() => document.querySelector(".dock-wrap").getBoundingClientRect().left >= document.querySelector("#rail").getBoundingClientRect().right));
    await switchTo(beta); check("the compact rail switches directly to Beta's last Work", (await route()).step === "work-2");
    const touch = await browser.newContext({ viewport:{ width:390, height:844 }, hasTouch:true, reducedMotion:"reduce" });
    if (!listen) await touch.route(`${base}/**`, serveRoute);
      const phone = await touch.newPage(); await phone.goto(`${base}/projects.html#${alpha.id}/line/same-line/work-1`); await phone.waitForSelector("#linePage");
      await phone.getByRole("button", { name:"Hide projects", exact:true }).tap();
      check("touch can hide projects", await phone.locator("#rail").isHidden());
      await phone.getByRole("button", { name:"Show projects", exact:true }).tap();
      await phone.locator(`.rail-row[data-p="${beta.id}"]`).tap();
      await phone.waitForFunction(id => window.__lines.S.cur === id, beta.id);
      check("touch can switch projects directly", await phone.locator("#rail").isVisible());
    await touch.close();

    check("no page errors", errors.length === 0);
    console.log(`\n${passed} navigation checks passed. Screenshots: ${shots}`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server?.listening ? server.close(resolve) : resolve());
    await api.close();
  }
})();
module.exports = verification;
if (require.main === module) verification.catch(error => { console.error(error); process.exitCode = 1; });
