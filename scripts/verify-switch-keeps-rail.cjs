#!/usr/bin/env node
"use strict";
// Switching projects keeps the sidebar in place (PE-586). In a real browser, with the server made slow on purpose:
// a project not read yet is lit in the sidebar at once and only its page waits, the rows stay the same elements,
// a quick second click wins over a slow first one, and going from a project to a Canvas and back never shows a blank sidebar.
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright node scripts/verify-switch-keeps-rail.cjs [folder for screenshots]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-switch-rail-"));
const shots = process.argv[2] ? path.resolve(process.argv[2]) : path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
const PORT = 5700 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const source = "files/canvases/canvas-1.penecho.json";
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 300)}` : ""}`); }
}
async function until(fn, label, ms = 15000) {
  const start = Date.now();
  for (;;) { if (await fn()) return true; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(60); }
}

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000);
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
  const post = async (address, data) => (await context.request.post(`${base}${address}`, { data, headers:{ origin:base } })).json();
  const ids = {};
  for (const [key, name] of [["a", "Alpha"], ["b", "Beta"], ["c", "Gamma"]]) {
    ids[key] = (await post("/api/lines/projects", { name, docsPath:path.join(temp, `docs-${key}`) })).project.id;
    for (const title of ["First idea", "Second idea"]) await post(`/api/lines/projects/${ids[key]}/yours`, { kind:"note", text:`${name} ${title}\n\nA few words.`, topic:"new" });
  }
  await context.addInitScript(() => { try { if (!localStorage.getItem("penecho-lines-panel")) localStorage.setItem("penecho-lines-panel", "0"); } catch { /* It only opens the panel. */ } });

  // The server is made slow for what is named, in every frame of the page.
  let slow = { list:0, state:{} };
  await context.route(/\/api\/lines\/projects(\/[^/?]+\/state)?(\?.*)?$/, async route => {
    const m = /\/api\/lines\/projects\/([^/?]+)\/state/.exec(route.request().url());
    const ms = m ? slow.state[decodeURIComponent(m[1])] || 0 : route.request().method() === "GET" ? slow.list : 0;
    if (ms) await wait(ms);
    await route.continue().catch(() => {});
  });
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  const S = () => page.evaluate(() => ({ cur:window.__lines?.S.cur, view:window.__lines?.S.route.view }));
  const lit = (where = page) => where.locator("#railList .rail-row.on .rail-name").allTextContents();
  // The page reads other projects ahead in the background; what it has read of one is forgotten, so clicking it has to wait.
  const forget = id => page.evaluate(id => { delete window.__lines.S.data[id]; }, id);
  const row = name => `#railList .rail-row:has(.rail-name:text-is("${name}"))`;

  console.log("\nBetween projects, on the Projects page");
  await page.goto(`${base}/projects.html#${ids.a}`);
  await until(async () => (await S()).cur === ids.a && await page.locator("#railList .rail-row").count() >= 3, "Alpha to open");
  await wait(600);
  // Each row gets a mark only an element can carry. A row written again would lose it.
  await page.evaluate(() => { for (const el of document.querySelectorAll("#railList .rail-row, #railList .rail-line")) el.__kept = true; });
  slow.state[ids.b] = 1500;
  await forget(ids.b);
  const clickedAt = Date.now();
  await page.locator(row("Beta")).click();
  await page.waitForTimeout(150);
  check("a project not read yet is lit in the sidebar at once", JSON.stringify(await lit()) === JSON.stringify(["Beta"]) && Date.now() - clickedAt < 1200, await lit());
  check("only its page waits", (await S()).cur === ids.a && await page.locator("#view.view-wait").count() === 1);
  await until(async () => (await S()).cur === ids.b, "Beta to open", 10000);
  await wait(300);
  check("then it opens, and the page no longer waits", await page.locator("#view.view-wait").count() === 0 && JSON.stringify(await lit()) === JSON.stringify(["Beta"]));
  const kept = await page.evaluate(() => [...document.querySelectorAll("#railList .rail-row")].map(el => Boolean(el.__kept)));
  check("every project row is still the same element", kept.length >= 3 && kept.every(Boolean), JSON.stringify(kept));
  check("the row that was clicked still has the focus", await page.evaluate(() => document.activeElement?.closest?.(".rail-row")?.textContent?.includes("Beta")));

  console.log("\nA quick second click wins");
  slow.state[ids.c] = 2500;
  await forget(ids.c);
  await page.locator(row("Gamma")).click();
  await page.waitForTimeout(150);
  check("the slow project is lit at once", JSON.stringify(await lit()) === JSON.stringify(["Gamma"]), await lit());
  await page.locator(row("Alpha")).click();
  await page.waitForTimeout(150);
  check("a project already read, clicked next, is lit and open at once", JSON.stringify(await lit()) === JSON.stringify(["Alpha"]) && (await S()).cur === ids.a, `${await lit()} ${JSON.stringify(await S())}`);
  await wait(2800);
  check("the slow answer coming late does not take you back", (await S()).cur === ids.a && JSON.stringify(await lit()) === JSON.stringify(["Alpha"]) && await page.locator("#view.view-wait").count() === 0, `${await lit()} ${JSON.stringify(await S())}`);
  slow = { list:0, state:{} };
  await page.goBack();
  await until(async () => (await S()).cur === ids.b, "Back to Beta", 10000);
  check("Back goes to the project before, and the sidebar follows", JSON.stringify(await lit()) === JSON.stringify(["Beta"]), await lit());

  console.log("\nFrom a project to its Canvas");
  await page.goto(`${base}/projects.html#${ids.a}`);
  await until(async () => (await S()).cur === ids.a, "Alpha to open");
  await wait(800);
  slow = { list:2500, state:{ [ids.a]:2500 } };
  await page.goto(`${base}/?${new URLSearchParams({ linesProject:ids.a, linesCanvas:source, linesTitle:"Canvas 1", linesBack:ids.a })}`, { waitUntil:"commit" });
  const frame = page.frameLocator("#projectLinesRail iframe");
  const start = Date.now();
  await frame.locator("#railList .rail-row").first().waitFor({ timeout:2000 });
  const early = Date.now() - start;
  check("the sidebar beside the Canvas shows its projects before the server has answered", early < 2000 && await frame.locator("#railList .rail-row").count() >= 3, `${early} ms`);
  check("with the Canvas's project lit", JSON.stringify(await lit(frame)) === JSON.stringify(["Alpha"]), await lit(frame));
  check("and it waits to be clicked until the page is ready", await frame.locator("#rail").evaluate(el => el.inert));
  await page.screenshot({ path:path.join(shots, "switch-canvas-early.png") });
  await until(() => frame.locator("#rail").evaluate(el => !el.inert), "the rail to be ready", 15000);
  check("then it is ready, with the same projects", JSON.stringify(await lit(frame)) === JSON.stringify(["Alpha"]) && await frame.locator("#railList .rail-row").count() >= 3);

  console.log("\nFrom the Canvas to another project");
  await wait(800);
  slow = { list:2500, state:{ [ids.c]:2500 } };
  await frame.locator(row("Gamma")).click();
  await page.waitForURL(url => url.pathname === "/projects.html", { timeout:20000, waitUntil:"commit" });
  const start2 = Date.now();
  await page.locator("#railList .rail-row").first().waitFor({ timeout:2000 });
  const early2 = Date.now() - start2;
  check("the Projects page shows the sidebar before the server has answered", early2 < 2000 && await page.locator("#railList .rail-row").count() >= 3, `${early2} ms`);
  check("with the project you clicked lit", JSON.stringify(await lit()) === JSON.stringify(["Gamma"]), await lit());
  await page.screenshot({ path:path.join(shots, "switch-project-early.png") });
  await until(async () => (await S()).cur === ids.c, "Gamma to open", 15000);
  await until(() => page.locator("#rail").evaluate(el => !el.inert), "the rail to be ready", 15000);
  check("then the project opens and its sidebar is ready", JSON.stringify(await lit()) === JSON.stringify(["Gamma"]));
  check("no page errors", errors.length === 0, errors.join(" | "));

  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exitCode = failures.length ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { server.kill(); });
