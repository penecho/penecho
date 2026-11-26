#!/usr/bin/env node
"use strict";
// PenEcho's first open (N1, PE-416), on a fresh install with no account, in a real browser:
// "/" stays on the PenEcho Lines start page over a blank Canvas (Start a project, Back to my Canvas), with no tour and no What's new; a new Canvas has the eight examples with their badges and the one hint;
// an example that needs AI ends in its saved result with the bar under it; an agent example sends its Ask on the Canvas's line;
// Upgraded installs also open without release notes or a tour; with a project of your own, "/" opens it on the Projects page.
//   NODE_PATH=/path/to/node_modules node scripts/verify-first-open.cjs [folder for screenshots]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-first-open-"));
const shots = process.argv[2] ? path.resolve(process.argv[2]) : path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
const PORT = 5700 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const EIGHT = ["functions", "surface-3d", "diagram", "kids-homework", "photo-note", "class-3d", "prototype", "work-note"];
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 300)}` : ""}`); }
}
async function until(fn, label, ms = 15000) {
  const start = Date.now();
  for (;;) { if (await fn()) return true; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(80); }
}

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000);
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const errors = [];
  const open = async (context, address) => {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", e => errors.push(`${address}: ${e.message}`));
    await page.goto(address);
    return page;
  };
  const shown = (page, selector) => page.evaluate(s => { const el = document.querySelector(s); return Boolean(el && !el.closest("[hidden]") && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden"); }, selector);
  const projects = async () => (await (await fetch(`${base}/api/lines/projects`)).json());
  const widgets = page => page.evaluate(() => document.querySelectorAll("#widgetLayer [data-widget-id]").length);
  // A new, blank Canvas in My Canvases, at the address PenEcho gives one ("/" itself goes on to the Projects page).
  const blankCanvas = async context => {
    const call = (url, body) => fetch(`${base}${url}`, { method:"POST", headers:{ "content-type":"application/json", origin:base }, body:JSON.stringify(body) }).then(r => r.json());
    const mine = (await call("/api/lines/my-canvases", {})).project, made = await call(`/api/lines/projects/${encodeURIComponent(mine.id)}/canvases`, { title:"Canvas" });
    const page = await open(context, `${base}/?${new URLSearchParams({ linesProject:mine.id, linesCanvas:made.source, linesTitle:made.title || "Canvas", linesBack:mine.id })}`);
    await page.waitForSelector("#viewport");
    return page;
  };

  console.log("\nA fresh install opens on the PenEcho Lines start page");
  check("the server says it is a first open", (await projects()).firstOpen === true);
  const fresh = await browser.newContext({ viewport:{ width:1440, height:900 } });
  let page = await open(fresh, `${base}/`);
  await page.waitForSelector("#projectLinesEntry .pls-start-new", { state:"visible", timeout:20000 });
  await wait(1500);
  check("\"/\" stays on the start page, not New project", new URL(page.url()).pathname === "/" && await shown(page, "#projectLinesEntry") && (await page.locator("#projectLinesEntry .pls-start-new").getAttribute("href")) === "/projects.html#new", page.url());
  await wait(1500);
  check("nothing pops up over it", !(await shown(page, "#tourLayer")) && !(await shown(page, "#changelogLayer")) && !(await shown(page, "#peOpening")));
  await page.screenshot({ path:path.join(shots, "1-start-page-1440.png") });
  await page.close();

  console.log("\nA new Canvas: eight examples, each with what it needs, and one hint");
  page = await blankCanvas(fresh);
  const landed = new URL(page.url());
  await wait(2500);
  check("nothing pops up: no tour and no What's new", !(await shown(page, "#tourLayer")) && !(await shown(page, "#changelogLayer")));
  check("startup does not record a release-note version", await page.evaluate(() => localStorage.getItem("penecho-changelog-seen")) === null);
  await page.locator("#canvasWelcomeExampleList .example-card").first().waitFor({ timeout:10000 });
  const cards = await page.locator("#canvasWelcomeExampleList .example-card").evaluateAll(list => list.map(card => ({ id:card.dataset.exampleId, title:card.querySelector("strong").textContent, badge:card.querySelector(".example-badge")?.textContent })));
  check("the eight, in order, in two rows of four", JSON.stringify(cards.map(c => c.id)) === JSON.stringify(EIGHT) && await page.evaluate(() => { const tops = [...document.querySelectorAll("#canvasWelcomeExampleList .example-card")].map(c => Math.round(c.getBoundingClientRect().top)); return new Set(tops).size === 2 && tops.filter(t => t === tops[0]).length === 4; }), JSON.stringify(cards));
  check("their titles are the short ones", cards.map(c => c.title).join("|") === "Graph a function|See it in 3D|Sketch to diagram|Check homework|Photo to study notes|Show a class in 3D|Wireframe to prototype|Meeting notes to a work note");
  check("each says what it needs: Works now, Uses AI, or the agent", cards.map(c => c.badge).join("|") === "Works now|Works now|Works now|Uses AI|Uses AI|Uses an agent|Uses an agent|Uses AI", cards.map(c => c.badge).join("|"));
  check("the title and words above them are the new ones", (await page.locator("#canvasWelcome > strong").textContent()) === "Start with a sketch, or try one of these" && (await page.locator("#canvasWelcome > span").first().textContent()) === "Write or draw anywhere. Select it and press AI.");
  check("All 20 examples is under them", (await page.locator("#canvasWelcomeExamplesAll").textContent()) === "All 20 examples" && await shown(page, "#canvasWelcomeExamplesAll"));
  await until(() => shown(page, "#canvasAiHint"), "the hint", 5000).catch(() => {});
  check("one hint by the AI button, and still no tour", await shown(page, "#canvasAiHint") && (await page.locator("#canvasAiHint span").textContent()) === "Draw anywhere. Then select what you drew and press AI." && !(await shown(page, "#tourLayer")));
  const hintBox = await page.evaluate(() => { const h = document.querySelector("#canvasAiHint").getBoundingClientRect(), b = document.querySelector("#aiToolbarRun").getBoundingClientRect(); return { above:h.bottom <= b.top + 1, near:Math.abs(h.right - b.right) < 120 }; });
  check("the hint sits just above the AI button", hintBox.above && hintBox.near, JSON.stringify(hintBox));
  await page.screenshot({ path:path.join(shots, "2-canvas-examples-1440.png") });
  await page.locator("#canvasAiHintDone").click();
  check("Got it puts it away", !(await shown(page, "#canvasAiHint")) && await page.evaluate(() => localStorage.getItem("penecho-canvas-ai-hint")) === "done");

  console.log("\nAn AI example with no AI ends in its saved result");
  const before = await widgets(page);
  await page.locator('#canvasWelcomeExampleList [data-example-id="kids-homework"]').click();
  await until(() => shown(page, "#exampleSaved"), "the saved result's bar", 15000).catch(() => {});
  check("its saved result is put on the Canvas at once", await widgets(page) > before, `${before} -> ${await widgets(page)}`);
  check("with the bar: This is the example's saved result, and how to make your own", await shown(page, "#exampleSaved") && /This is the example's saved result\.\s*To make your own from a sketch:/.test((await page.locator("#exampleSaved p").textContent()).replace(/\s+/g, " ")) && (await page.locator("#exampleSaved [data-pls-setup]").textContent()) === "Set up an agent" && !(await page.locator("#exampleSaved [data-pls-guest]").isVisible()));
  const barBox = await page.evaluate(() => { const bar = document.querySelector("#exampleSaved").getBoundingClientRect(), frames = [...document.querySelectorAll("#widgetLayer [data-widget-id]")].map(f => f.getBoundingClientRect()).filter(r => r.width); const w = frames.at(-1); return w ? { under:bar.top >= w.bottom - 1 && bar.top - w.bottom < 40, w:Math.round(w.width) } : null; });
  check("the bar sits under the result", barBox?.under, JSON.stringify(barBox));
  check("no hint and no Suggest bar compete with it", !(await shown(page, "#canvasAiHint")) && !(await shown(page, "#exampleCoach")));
  await page.screenshot({ path:path.join(shots, "3-saved-result-homework-1440.png") });

  console.log("\nAn agent example with no agent ends in its saved result too, on a Canvas of its own");
  await page.locator("#exampleSavedClose").click();
  await page.evaluate(() => { void window.PenEchoExamples.open("class-3d"); });
  await page.waitForURL(url => url.searchParams.get("linesCanvas") !== landed.searchParams.get("linesCanvas"), { timeout:15000 });
  await until(() => shown(page, "#exampleSaved"), "the saved 3D model", 20000).catch(() => {});
  check("a Canvas that already holds something opens the example on a new Canvas in My Canvases", !new URL(page.url()).searchParams.has("linesExample") && await shown(page, "#exampleSaved"), page.url());
  check("the saved 3D model is a Widget on it", await widgets(page) >= 1);
  await wait(1200);
  await page.screenshot({ path:path.join(shots, "4-saved-result-3d-1440.png") });

  console.log("\nAll 20 examples, and the ? menu");
  await page.locator("#exampleSavedClose").click();
  await page.evaluate(() => { window.PenEchoExamples.openDialog(); });
  await page.locator("#examplesDialog[open] .example-card").first().waitFor({ timeout:5000 });
  check("All 20 examples has all twenty", await page.locator("#examplesDialog .example-card").count() === 20);
  await page.locator("#examplesDialogClose").click();
  await page.locator("#canvasMoreBtn").click(); await page.locator("#moreHelpTrigger").click();
  const items = (await page.locator("#canvasMoreMenu [data-more-help]").allTextContents()).map(t => t.trim());
  check("? offers shortcuts and feedback", items.join("|") === "Keyboard shortcuts|Send feedback", items.join("|"));
  await page.close();
  check("once something is kept, it is no longer a first open", !(await projects()).firstOpen);
  await fresh.close();

  console.log("\nThe hint goes with the first stroke, for good");
  const stroked = await browser.newContext({ viewport:{ width:1440, height:900 } });
  page = await blankCanvas(stroked); await wait(2500);
  check("a new Canvas opens as itself, with no first page over it", !(await shown(page, "#projectLinesEntry")));
  await until(() => shown(page, "#canvasAiHint"), "the hint", 5000).catch(() => {});
  check("a new browser on this install still gets the hint", await shown(page, "#canvasAiHint"));
  await page.mouse.move(360, 110); await page.mouse.down(); for (let i = 1; i <= 12; i++) await page.mouse.move(360 + i * 20, 110 + i * 4); await page.mouse.up();
  await wait(300);
  check("the first stroke puts it away", !(await shown(page, "#canvasAiHint")));
  await page.reload(); await page.waitForSelector("#viewport"); await wait(2500);
  check("and it does not come back", !(await shown(page, "#canvasAiHint")));
  await stroked.close();

  console.log("\nUpgraded installs open without release notes or a tour");
  for (const legacy of [{ "penecho-changelog-seen":"1.4.1", "penecho-tour-progress":"{}" }, { "penecho-tour-progress":"{}" }]) {
    const updated = await browser.newContext({ viewport:{ width:1440, height:900 } });
    await updated.addInitScript(values => { for (const [key,value] of Object.entries(values)) localStorage.setItem(key,value); }, legacy);
    page = await blankCanvas(updated); await wait(2500);
    check("old preferences do not show release notes, a tour or the first-install hint", !(await shown(page, "#changelogLayer")) && !(await shown(page, "#tourLayer")) && !(await shown(page, "#canvasAiHint")));
    await page.reload(); await page.waitForSelector("#viewport"); await wait(1000);
    check("reload still has no tour or release notes", !(await shown(page, "#changelogLayer")) && !(await shown(page, "#tourLayer")));
    await updated.close();
  }

  console.log("\nAn agent example sends its prompt as an Ask on the Canvas's line");
  const agentful = await browser.newContext({ viewport:{ width:1440, height:900 } });
  let asked = null;
  await agentful.route("**/api/lines/agents", route => route.fulfill({ json:{ agents:[{ id:"claude", name:"Claude Code", mono:"Cl", color:"#a8502a", available:true, runs:true }, { id:"codex", name:"Codex", mono:"Cx", color:"#2b303a", available:false }] } }));
  await agentful.route(/\/api\/lines\/projects\/[^/]+\/topics$/, async route => { if (route.request().method() !== "POST") return route.continue(); asked = route.request().postDataJSON(); await route.fulfill({ json:{ slug:"show-a-class-in-3d", added:false } }); });
  page = await blankCanvas(agentful);
  await page.locator("#canvasWelcomeExampleList .example-card").first().waitFor({ timeout:15000 });
  await until(async () => (await page.locator('#canvasWelcomeExampleList [data-example-id="class-3d"] .example-badge').textContent()) === "Uses Claude Code", "the agent's name on the badge", 5000).catch(() => {});
  check("the agent examples say which agent they use", (await page.locator('#canvasWelcomeExampleList [data-example-id="class-3d"] .example-badge').textContent()) === "Uses Claude Code");
  await page.locator('#canvasWelcomeExampleList [data-example-id="class-3d"]').click();
  await until(() => Boolean(asked), "the Ask", 15000).catch(() => {});
  check("its prompt goes as an Ask on this Canvas's line, to the default agent", asked && asked.canvas === new URL(page.url()).searchParams.get("linesCanvas") && /water molecule/.test(asked.text) && asked.agent === "" && asked.title === "Show a class in 3D", JSON.stringify(asked));
  await until(() => shown(page, "#projectLinesPanel"), "the line panel", 5000).catch(() => {});
  const lineState = { panel:await shown(page, "#projectLinesPanel"), line:await page.evaluate(() => document.querySelector("#projectLinesPanel iframe")?.getAttribute("src") || ""), saved:await shown(page, "#exampleSaved") };
  check("the line opens beside the Canvas, and no saved result is shown", lineState.panel && lineState.line.endsWith("/line/show-a-class-in-3d") && !lineState.saved, JSON.stringify(lineState));
  await agentful.close();

  console.log("\nChinese");
  const zh = await browser.newContext({ viewport:{ width:1440, height:900 } });
  await zh.addInitScript(() => { try { localStorage.setItem("penecho-language", "zh"); } catch { /* English then. */ } });
  page = await blankCanvas(zh);
  await page.locator("#canvasWelcomeExampleList .example-badge").first().waitFor({ timeout:15000 });
  const zhBadges = await page.locator("#canvasWelcomeExampleList .example-badge").allTextContents();
  check("the badges and the examples' words are in Chinese", zhBadges[0] === "现在就能用" && zhBadges[3] === "使用 AI" && zhBadges[5] === "使用 Agent" && (await page.locator("#canvasWelcome > strong").textContent()) === "从草图开始，或试试这些" && (await page.locator("#canvasWelcomeExamplesAll").textContent()) === "全部 20 个示例", zhBadges.join("|"));
  await until(() => shown(page, "#canvasAiHint"), "the hint", 5000).catch(() => {});
  check("the hint is in Chinese", (await page.locator("#canvasAiHint span").textContent()) === "在任意位置画。然后选中你画的内容，点 AI。" && (await page.locator("#canvasAiHintDone").textContent()) === "知道了");
  await page.locator("#canvasMoreBtn").click(); await page.locator("#moreHelpTrigger").click();
  check("so is the ? menu", (await page.locator('#canvasMoreMenu [data-more-help="shortcuts"]').textContent()).trim() === "键盘快捷键");
  await page.screenshot({ path:path.join(shots, "7-canvas-zh-1440.png") });
  await zh.close();

  console.log("\nWith a project of your own, \"/\" opens it on the Projects page");
  await fetch(`${base}/api/lines/projects`, { method:"POST", headers:{ "content-type":"application/json", origin:base }, body:JSON.stringify({ name:"Weather app", docsPath:path.join(temp, "docs") }) });
  const later = await browser.newContext({ viewport:{ width:1440, height:900 } });
  page = await open(later, `${base}/`);
  await page.waitForURL(/projects\.html#[^n]/, { timeout:20000 });
  await page.waitForSelector("#railList .rail-row.on");
  check("it lands on the project, not on New project or a Canvas", (await page.locator("#railList .rail-row.on .rail-name").textContent()) === "Weather app", page.url());
  await later.close();

  console.log("\nPhone width");
  const phoneHome = path.join(temp, "phone");
  const phone = await browser.newContext({ viewport:{ width:390, height:844 }, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  page = await blankCanvas(phone);
  await page.waitForSelector("#viewport"); await wait(3000);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check("the Canvas and its examples fit a phone", overflow <= 1, `${overflow}px wider`);
  await page.screenshot({ path:path.join(shots, "8-canvas-phone.png") });
  await page.evaluate(() => { void window.PenEchoExamples.open("prototype"); });
  await page.waitForURL(url => !url.searchParams.has("linesExample") && Boolean(url.searchParams.get("linesCanvas")), { timeout:15000 }).catch(() => {});
  await until(() => shown(page, "#exampleSaved"), "the saved prototype", 20000).catch(() => {});
  await wait(1000);
  check("a saved result and its bar fit a phone", await shown(page, "#exampleSaved") && await page.evaluate(() => { const r = document.querySelector("#exampleSaved").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
  await page.screenshot({ path:path.join(shots, "9-saved-result-phone.png") });
  await phone.close();
  void phoneHome;

  check("no page had an error", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  console.log(`Screenshots: ${shots}`);
  if (failures.length) { console.log(failures.map(f => ` - ${f}`).join("\n")); process.exitCode = 1; }
})().catch(error => { console.error(error); console.log(serverLog.slice(-1500)); process.exitCode = 1; }).finally(() => { server.kill(); try { fs.rmSync(path.join(temp, "state"), { recursive:true, force:true }); } catch { /* A temp folder. */ } });
