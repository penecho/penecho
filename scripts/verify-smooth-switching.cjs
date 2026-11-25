#!/usr/bin/env node
"use strict";
// Moving around PenEcho stays smooth (PE-586). In a real browser, with Chrome's own trace:
// - the zoom when you switch project, or open My Canvases, runs only on the compositor (transform and opacity, no corner radius);
// - every moving part of the opening runs on the compositor, so nothing stalls while the page under it loads;
// - PenEcho opened by itself changes from the Canvas page to the Projects page only once the opening has stopped moving,
//   and the Projects page holds its last frame until it has drawn itself;
// - going between a project and its Canvas is a view transition (the old page stays until the new one has drawn), and coming
//   back from the Canvas shows the page you left at once, before the project has been read again.
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright node scripts/verify-smooth-switching.cjs
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-smooth-"));
const PORT = 6000 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const source = "files/canvases/canvas-1.penecho.json";
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 400)}` : ""}`); }
}
async function until(fn, label, ms = 15000) {
  const start = Date.now();
  for (;;) { if (await fn()) return true; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(50); }
}
// Animations Chrome could not hand to the compositor, from its trace: "<element> <properties>".
function mainThreadAnimations(buffer) {
  const out = [];
  for (const e of JSON.parse(buffer.toString()).traceEvents) {
    const d = e.name === "Animation" ? e.args?.data : null;
    if (d?.compositeFailed) out.push(`${d.nodeName || "?"} ${(d.unsupportedProperties || []).join("/")}`);
  }
  return out;
}

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000);
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
  const post = async (address, data) => (await context.request.post(`${base}${address}`, { data, headers:{ origin:base } })).json();
  const ids = {};
  for (const [key, name] of [["a", "Alpha"], ["b", "Beta"]]) {
    ids[key] = (await post("/api/lines/projects", { name, docsPath:path.join(temp, `docs-${key}`) })).project.id;
    for (const title of ["First idea", "Second idea", "Third idea"]) await post(`/api/lines/projects/${ids[key]}/yours`, { kind:"note", text:`${name} ${title}\n\nA few words.`, topic:"new" });
  }
  await context.addInitScript(() => {
    try { if (!localStorage.getItem("penecho-lines-panel")) localStorage.setItem("penecho-lines-panel", "0"); } catch { /* It only opens the panel. */ }
    // What each page saw when it was shown: whether a view transition brought it, and what it showed on its first frame.
    addEventListener("pagereveal", e => {
      const view = document.querySelector("#view");
      window.__reveal = { transition:Boolean(e.viewTransition), at:performance.now(), opening:Boolean(document.querySelector("#peOpening")), viewText:view ? view.textContent.trim().length : -1, viewInert:Boolean(document.querySelector(".shell")?.inert) };
    });
  });
  let slow = { state:{} };
  await context.route(/\/api\/lines\/projects\/[^/?]+\/state(\?.*)?$/, async route => {
    const m = /\/api\/lines\/projects\/([^/?]+)\/state/.exec(route.request().url());
    const ms = slow.state[decodeURIComponent(m[1])] || 0;
    if (ms) await wait(ms);
    await route.continue().catch(() => {});
  });
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  const S = () => page.evaluate(() => ({ cur:window.__lines?.S.cur, view:window.__lines?.S.route.view }));
  const traced = async fn => { await browser.startTracing(page, { categories:["devtools.timeline", "blink.animations"] }); await fn(); return mainThreadAnimations(await browser.stopTracing()); };

  console.log("\nThe opening");
  const opening = await traced(async () => { await page.goto(`${base}/projects.html?opening=1#${ids.a}`); await wait(2400); });
  check("every moving part of the opening runs on the compositor", opening.length === 0, opening.join(" | "));
  await until(async () => (await S()).cur === ids.a && !await page.locator("#peOpening").count(), "Alpha to open and the opening to end");

  console.log("\nSwitching project");
  await wait(2500);   // the page reads Beta ahead, so it opens from what it has, as it usually does
  const toBeta = await traced(async () => { await page.locator('#railList .rail-row:has(.rail-name:text-is("Beta"))').click(); await wait(500); });
  check("the zoom into another project runs on the compositor", toBeta.length === 0, toBeta.join(" | "));
  check("and Beta opened", (await S()).cur === ids.b);
  const zoomed = await page.evaluate(() => document.getAnimations().length);
  check("the zoom has ended by now", zoomed === 0, `${zoomed} running`);
  const toMine = await traced(async () => { await page.locator('[data-act="open-my-canvases"]').first().click(); await wait(700); });
  check("the zoom into My Canvases runs on the compositor", toMine.length === 0, toMine.join(" | "));
  check("and My Canvases opened", (await S()).view === "canvases");

  console.log("\nA project and its Canvas");
  await page.goto(`${base}/projects.html#${ids.a}`);
  await until(async () => (await S()).cur === ids.a, "Alpha to open");
  await wait(800);
  const homeText = await page.locator("#view").evaluate(el => el.textContent.trim().length);
  // As the page opens a Canvas: from the page itself, not the address bar (a typed address never has a view transition).
  await page.evaluate(url => location.assign(url), `/?${new URLSearchParams({ linesProject:ids.a, linesCanvas:source, linesTitle:"Canvas 1", linesBack:ids.a })}`);
  await page.waitForURL(url => url.pathname === "/", { timeout:15000, waitUntil:"commit" });
  await until(() => page.evaluate(() => Boolean(window.__reveal)), "the Canvas page to show");
  check("the Canvas page comes in with a view transition", (await page.evaluate(() => window.__reveal)).transition, JSON.stringify(await page.evaluate(() => window.__reveal)));
  await page.frameLocator("#projectLinesRail iframe").locator("#railList .rail-row").first().waitFor({ timeout:15000 });
  await until(() => page.frameLocator("#projectLinesRail iframe").locator("#rail").evaluate(el => !el.inert), "the rail beside the Canvas to be ready", 15000);
  await wait(500);
  // Back to the project from the Canvas, with the project slow to read: the page you left is there on the first frame.
  slow = { state:{ [ids.a]:2500 } };
  await page.evaluate(() => { const a = document.createElement("a"); a.href = `/projects.html#${new URLSearchParams(location.search).get("linesBack")}`; document.body.append(a); a.click(); });
  await page.waitForURL(url => url.pathname === "/projects.html", { timeout:15000, waitUntil:"commit" });
  await until(() => page.evaluate(() => Boolean(window.__reveal)), "the Projects page to show");
  const back = await page.evaluate(() => window.__reveal);
  check("the Projects page comes in with a view transition", back.transition, JSON.stringify(back));
  check("and shows the page you left on its first frame, before the project is read", back.viewText > homeText * .8 && back.viewInert, `${JSON.stringify(back)} (the page had ${homeText} letters)`);
  check("which cannot be clicked until it is the page's own", await page.locator(".shell").evaluate(el => el.inert));
  await until(async () => (await S()).cur === ids.a, "Alpha to be read", 15000);
  await until(() => page.locator(".shell").evaluate(el => !el.inert), "the page to be its own", 5000);
  check("then the page is its own and can be clicked", await page.locator("#view [data-line], #view [data-row]").count() > 0);
  slow = { state:{} };
  // The page kept is only for the place it was left: anywhere else waits for its project as before.
  await page.evaluate(() => { sessionStorage.setItem("penecho-lines-page-kept", JSON.stringify({ v:2, hash:"#elsewhere", at:Date.now(), html:"<main id=\"view\">old</main>", body:[], tops:[] })); });
  await page.reload();
  await until(() => page.evaluate(() => Boolean(window.__reveal)), "the page to show again");
  check("a page kept for another place is not shown", !(await page.evaluate(() => document.querySelector("#view")?.textContent === "old")));

  console.log("\nPenEcho opened by itself");
  const first = await browser.newContext({ viewport:{ width:1440, height:900 } });
  // The opening does not play for a browser driven by a test; this one is made to look like a person's.
  await first.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "webdriver", { get:() => false });
    addEventListener("pagereveal", () => { window.__revealAt = Date.now(); window.__openingOnFirstFrame = Boolean(document.querySelector("#peOpening")); });
  });
  const solo = await first.newPage();
  solo.on("pageerror", e => errors.push(e.message));
  const t0 = Date.now();
  await solo.goto(`${base}/`, { waitUntil:"commit" });
  const started = await solo.evaluate(() => Number(sessionStorage.getItem("penecho-opening-run")) || 0).catch(() => 0);
  await solo.waitForURL(url => url.pathname === "/projects.html", { timeout:20000, waitUntil:"commit" });
  const leftAt = Date.now();
  await until(() => solo.evaluate(() => Boolean(window.__revealAt)), "the Projects page to show");
  const into = (leftAt - (started || t0));
  check("the Canvas page goes on to the Projects page only after the opening stopped moving", into >= 1950, `${into} ms into the opening`);
  check("the Projects page carries the opening on from its first frame", await solo.evaluate(() => window.__openingOnFirstFrame));
  await until(() => solo.evaluate(() => !document.querySelector("#peOpening")), "the opening to fade", 6000);
  check("then the opening fades, with the page drawn under it", await solo.evaluate(() => Boolean(window.__lines?.S && document.querySelector("#rail #railList")?.children.length)));
  await first.close();

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exitCode = failures.length ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { server.kill(); });
