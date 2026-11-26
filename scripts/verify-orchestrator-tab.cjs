#!/usr/bin/env node
"use strict";
// Real-browser check of the Orchestrator tab (PE-613), against its own server and a scratch folder. A stand-in orchestrator agent calls
// PenEcho's functions over HTTP with its pass: it makes two Lines, adds a task that runs beside the first Line's Work, waits, rates each
// Work and reports. Orchestrator shows the Works and ratings. Statistics shows the agent record and entered prices.
//   PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-orchestrator-tab.cjs [screenshot-folder]
//   Add --ratings-fixture to test the UI contract separately from the server's rating projections.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { createAgents } = require("../src/server/project-lines/agents.js");

// A verifier launched from a PenEcho Work must only expose the fixture's own orchestrator endpoint to its agents.
delete process.env.PENECHO_ORCH_URL;
delete process.env.PENECHO_ORCH_PASS;
const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-browser-"));
const args = process.argv.slice(2), fixture = args.includes("--ratings-fixture");
const shots = path.resolve(args.find(arg => !arg.startsWith("--")) || path.join(temp, fixture ? "ui-fixture" : "shots")); fs.mkdirSync(shots, { recursive:true });
let passed = 0;
const failures = [];
function check(label, value) {
  if (value) { passed++; console.log(`ok ${label}`); }
  else { failures.push(label); console.error(`FAIL ${label}`); }
}

// One stand-in for every agent, like Claude Code's stream-json. With an orchestrator pass it orchestrates; otherwise it works a moment.
const script = path.join(temp, "agent.js");
fs.writeFileSync(script, `
const say = o => console.log(JSON.stringify(o));
let prompt = "";
process.stdin.on("data", d => prompt += d).on("end", async () => {
  say({ type:"system", subtype:"init", session_id:"s-" + Math.random().toString(36).slice(2) });
  let text = "Finished the work.";
  const priceLookup = prompt.includes("<request>\\nLook up the current list prices,");
  if (priceLookup) {
    // Keep the fixture lookup active until the test stops it, including across a page reload.
    setInterval(() => {}, 60000);
    return;
  }
  if (process.env.PENECHO_ORCH_PASS) {
    const call = async body => { const r = await fetch(process.env.PENECHO_ORCH_URL, { method:"POST", headers:{ "content-type":"application/json", "x-penecho-pass":process.env.PENECHO_ORCH_PASS }, body:JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; };
    const { agents } = await call({ do:"agents" }), coder = agents.find(a => a.runner === "coder"), writer = agents.find(a => a.runner === "writer");
    const page = await call({ do:"create-line", task:"slow: build the settings page", agent:coder.id, kind:"code", title:"Settings page" });
    const tests = await call({ do:"add-task", line:page.line, task:"slow: write the settings page tests", agent:writer.id, kind:"test", parallel:true });
    const docs = await call({ do:"create-line", task:"write the release notes", agent:writer.id, kind:"docs", title:"Release notes" });
    await call({ do:"wait", lines:[page.line, docs.line], seconds:60 });
    await call({ do:"rate", line:page.line, work:page.work, score:5, note:"clean" });
    await call({ do:"rate", line:page.line, work:tests.work, score:3, note:"misses one case" });
    await call({ do:"rate", line:docs.line, work:docs.work, score:4 });
    text = "Settings page built by Coder (5/5) with tests by Writer beside it (3/5); release notes by Writer (4/5). All three wait for your review.";
  }
  const finish = () => { say({ type:"assistant", message:{ id:"req-" + process.pid, usage:{ input_tokens:10000, output_tokens:2000, cache_read_input_tokens:0, cache_creation_input_tokens:0 }, content:[{ type:"text", text }] } }); say({ type:"result", subtype:"success", is_error:false, result:text }); process.exit(0); };
  setTimeout(finish, /slow/i.test(prompt.split("<request>")[1] || "") ? 4500 : 200);
});
`);
const one = (name, color) => ({ name, mono:name.slice(0, 2), color, role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[script] }), command:launch => ({ command:launch.command, args:launch.prefixArgs }) });
const agentList = createAgents({ env:{ PATH:"" }, extra:{ boss:one("Boss", "#6d28d9"), coder:one("Coder", "#0f766e"), writer:one("Writer", "#b4532a") } });
const api = createProjectLines({ directory:path.join(temp, "state"), agents:agentList, serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, "home"), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
  send:(res, status, data) => { if (res.writableEnded || res.destroyed) return; res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
const s = api.service, p = s.store.create({ name:"Orchestra", docsPath:path.join(temp, "docs") });
p.follow = false; p.offerSkill = false; p.defaultAgent = "coder"; s.store.save();
s.presets.add({ agent:"boss", name:"Boss", model:"boss-1" });
s.presets.add({ agent:"coder", name:"Coder", model:"coder-2" });
s.presets.add({ agent:"writer", name:"Writer", model:"writer-mini" });

const mime = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml", ".webp":"image/webp", ".woff2":"font/woff2" };
let browser, server;
(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try { if (await api.handle(req, res, url)) return; } catch (error) { if (!res.writableEnded && !res.destroyed) { res.writeHead(error.status || 500, { "content-type":"application/json" }); res.end(JSON.stringify({ error:error.message, code:error.code })); } return; }
    const file = path.resolve(root, "public", `.${url.pathname}`);
    if (!file.startsWith(path.join(root, "public")) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type":mime[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  api.orchestrator.setBase(`${base}/api/lines/orchestrate`);
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const page = await (await browser.newContext({ viewport:{ width:1600, height:900 }, hasTouch:true })).newPage();
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  if (fixture) {
    console.log("UI fixture mode: supplying individual ratings from the stand-in agents' saved records.");
    await page.route(/\/orchestrator(?:\/stats)?(?:\?.*)?$/, async route => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch(), body = await response.json();
      const ratings = api.orchestrator.records(p).filter(r => r.score).map(r => ({
        ...r, agent:r.presetName, runner:r.agent, label:r.work.replace(/^work-/, "Work "),
        title:r.line === "settings-page" ? "Settings page" : "Release notes",
      }));
      for (const session of body.sessions || []) for (const line of session.lines) for (const w of line.works) {
        const rating = ratings.find(r => r.line === line.line && r.work === w.work);
        if (rating) Object.assign(w, { score:rating.score, note:rating.note });
      }
      const kind = new URL(route.request().url()).searchParams.get("kind");
      if (body.rows) body.ratings = ratings.reverse().filter(r => !kind || r.kind === kind);
      await route.fulfill({ response, json:body });
    });
  }

  await page.goto(`${base}/projects.html#${p.id}`); await page.reload();
  await page.waitForSelector(".subnav");
  check("Orchestrator sits immediately after Home", await page.locator('.subnav [data-view="home"] + [data-view="orchestrator"]').count() === 1);
  await page.click('.subnav [data-view="orchestrator"]');
  await page.waitForSelector("#orchGoal");
  check("the agent picker lists the saved agents", await page.locator("#orchAgent option").count() === 3);
  await page.waitForSelector(".orch-empty");
  check("the empty session explains how Works are assigned and rated", /Statistics.*rates each Work from 1 to 5/.test(await page.innerText(".orch-empty")));
  check("Orchestrator omits Agent record and Model prices", await page.locator("#orchRecord, #orchPrices, .orch-two").count() === 0);
  check("the functions are listed", await page.locator(".orch-fns tr").count() >= 15);
  await page.screenshot({ path:path.join(shots, "1-empty.png") });

  await page.selectOption("#orchAgent", { label:"Boss · boss-1" });
  await page.fill("#orchGoal", "Build the settings page with tests, and write the release notes.");
  await page.click('[data-act="orch-start"]');
  await page.waitForSelector(".orch-run");
  check("the orchestrator shows at once", (await page.textContent(".orch-run .orch-title")).length > 0);
  await page.waitForFunction(() => document.querySelectorAll(".orch-line").length === 2, null, { timeout:20000 });
  check("its two Lines show under it", true);
  await page.waitForSelector(".orch-run.running .orch-work.w-active", { timeout:10000 });
  await page.screenshot({ path:path.join(shots, "2-running.png") });
  await page.waitForFunction(() => document.querySelector(".orch-report"), null, { timeout:30000 });
  check("the Settings page Line has two Works, both finished", await page.locator('.orch-line:has-text("Settings page") .orch-work.w-done').count() === 2);
  check("the report shows", /Coder \(5\/5\)/.test(await page.textContent(".orch-report")));
  const ratings = page.locator("#orchSessions .orch-ratings .orch-rating");
  const scores = await ratings.locator(".orch-score").allTextContents();
  check("the three Works show their individual scores", scores.sort().join(",") === "3/5,4/5,5/5");
  check("the notes sit on their scored Work links", await ratings.filter({ hasText:"5/5" }).filter({ hasText:"clean" }).count() === 1 &&
    await ratings.filter({ hasText:"3/5" }).filter({ hasText:"misses one case" }).count() === 1);
  await page.screenshot({ path:path.join(shots, "3-finished.png") });
  await page.setViewportSize({ width:390, height:844 });
  await page.screenshot({ path:path.join(shots, "3-narrow.png") });
  check("the narrow Orchestrator fits its page", await page.locator("#view").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.setViewportSize({ width:1600, height:900 });

  const report = page.locator(".orch-report"), reportStep = await report.getAttribute("data-step");
  await report.click();
  check("the report opens its Work", await page.evaluate(step => S.route.view === "line" && S.route.step === step, reportStep));
  await page.click('.subnav [data-view="orchestrator"]');
  await page.click('.orch-run .orch-title');
  check("the session title opens the orchestrator's Line", await page.evaluate(() => S.route.view === "line"));
  await page.click('.subnav [data-view="orchestrator"]');
  await page.locator('.orch-top [data-view="stats"]').press("Enter");
  const record = page.locator("#statsRecord"), prices = page.locator("#statsPrices");
  const coder = record.locator("tr").filter({ hasText:"Coder" });
  await coder.waitFor();
  check("Statistics has Agents and Model prices", await record.getByRole("heading", { name:"Agents" }).isVisible() &&
    await prices.getByRole("heading", { name:"Model prices" }).isVisible());
  check("the record shows Coder’s average orchestrator score", /5\.0\s*\/5/.test(await coder.innerText()));
  const low = record.locator(".orch-rating").filter({ hasText:"misses one case" });
  const verdict = (await low.allTextContents()).join(" ");
  check("Statistics links the individual rating, agent, kind and note", /Writer/.test(verdict) && /Test/.test(verdict) && /3\/5/.test(verdict));
  check("the unpriced Work has no cost estimate", (await coder.locator("td").last().innerText()) === "—");
  const priceBox = field => prices.locator(`[data-price-row="coder-2"][data-price-field="${field}"]`);
  check("a model with no price has boxes to type it in", await priceBox("input").count() === 1);
  await priceBox("input").fill("3"); await priceBox("output").fill("15");
  const typingKept = await page.evaluate(() => {
    const input = document.activeElement;
    refreshStatsPrices();
    return input === document.activeElement && input.dataset.priceField === "output" && input.value === "15";
  });
  check("refresh keeps the active price input and its value", typingKept);
  await priceBox("output").press("Enter");
  await prices.locator('tr[data-price-model="coder-2"]:not(.is-missing)').waitFor();
  await coder.getByText("$0.06", { exact:true }).waitFor();
  check("saving coder-2 prices recalculates the measured Work cost to $0.06", (await coder.locator("td").last().innerText()) === "$0.06");
  await record.scrollIntoViewIfNeeded();
  await page.screenshot({ path:path.join(shots, "4-statistics.png") });
  await record.locator('[data-kind="test"]').click();
  check("the kind filter narrows both record and recent ratings", await record.locator(".orch-rating").count() === 1 && await low.isVisible() && !await coder.count());
  await record.locator('[data-kind=""]').click();
  await prices.locator('[data-act="price-remove"][data-key="coder-2"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll("#statsRecord tr")].some(row => row.textContent.includes("Coder") && row.cells[row.cells.length - 1].textContent === "—"));
  check("removing the price clears its cost estimate", (await coder.locator("td").last().innerText()) === "—");
  let openedRating = false;
  if (await low.count()) {
    const step = await low.getAttribute("data-step"), line = await low.getAttribute("data-line");
    await low.press("Enter");
    openedRating = await page.evaluate(([l, w]) => S.route.view === "line" && S.route.line === l && S.route.step === w, [line, step]);
  }
  check("the Statistics rating opens the matching Work", openedRating);
  await page.click('.subnav [data-view="stats"]');
  await page.setViewportSize({ width:390, height:844 });
  const ask = prices.getByRole("button", { name:"Look up with AI", exact:true });
  await ask.scrollIntoViewIfNeeded();
  await prices.locator(".sx-hd").screenshot({ path:path.join(shots, "5-price-action.png") });
  check("the AI action fits the narrow price card", await ask.evaluate(el => {
    const r = el.getBoundingClientRect(), card = el.closest("section").getBoundingClientRect();
    return r.left >= card.left && r.right <= Math.min(card.right, innerWidth) && r.height >= 24;
  }));
  let pricePosts = 0;
  page.on("request", req => { if (req.method() === "POST" && req.url().endsWith("/orchestrator") && req.postDataJSON()?.purpose === "model-prices") pricePosts++; });
  await ask.dblclick();
  const open = prices.getByRole("button", { name:"Open price lookup" });
  await open.waitFor();
  const lookup = await open.getAttribute("data-line");
  await page.reload();
  await open.waitFor();
  check("duplicate activation and reload keep one active lookup", pricePosts === 1 && await open.getAttribute("data-line") === lookup &&
    s.store.scan(p).topics.filter(t => t.doc.front.job === "model-prices").length === 1);
  await prices.locator(".sx-hd").screenshot({ path:path.join(shots, "6-price-active.png") });
  const statsUrl = page.url();
  await open.press("Enter");
  await page.waitForFunction(id => S.route.view === "line" && S.route.line === id, lookup);
  await api.orchestrator.call(p, { do:"stop", line:lookup });
  await page.goto(statsUrl);
  await ask.waitFor();
  check("stopping the lookup restores the AI action", await ask.isEnabled());
  await ask.tap();
  await open.waitFor();
  const next = await open.getAttribute("data-line");
  check("one tap starts a fresh lookup after the previous one stops", next !== lookup && pricePosts === 2);
  await api.orchestrator.call(p, { do:"stop", line:next });
  check("no page errors", errors.length === 0 || (console.log(errors), false));
  console.log(`\n${fixture ? "UI fixture" : "Server integration"}: ${passed} checks passed, ${failures.length} failed. Pictures in ${shots}`);
  assert.equal(failures.length, 0, failures.join("\\n"));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); server?.close(); api.close();
  setTimeout(() => process.exit(process.exitCode || 0), 200);
});
