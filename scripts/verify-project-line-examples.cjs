#!/usr/bin/env node
"use strict";
// A computer with no project of its own, in a real browser: PenEcho opens on New project with the three example projects in the
// sidebar, the opening plays when asked for, and each example holds what it should: a drawing made into a prototype and built,
// a marked-up bug fixed and merged, a feature on a branch of a branch; class notes with Canvas AI's answers; a deck from a
// spreadsheet that downloads as PowerPoint. Then the empty project's cards, bringing back one that was removed, and a phone.
//   PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-project-line-examples.cjs [screenshot-folder]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (shots) fs.mkdirSync(shots, { recursive:true });
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lines-examples-")));
const PORT = 4700 + Math.floor(Math.random() * 200), base = `http://127.0.0.1:${PORT}`;
const NAMES = ["Timeline app (Demo)", "Calculus class notes (Demo)", "Sales review deck (Demo)"];
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 300)}` : ""}`); }
}
async function until(fn, label, ms = 15000) {
  const start = Date.now();
  for (;;) {
    let value; try { value = await fn(); } catch { value = false; }
    if (value) return value;
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`);
    await wait(60);
  }
}
const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_LINES_EXAMPLES:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });
const shot = async (page, name) => { if (shots) await page.screenshot({ path:path.join(shots, `${name}.png`) }); };
const api = async (method, url, body) => { const r = await fetch(`${base}/api/lines${url}`, { method, headers:{ "content-type":"application/json", origin:base }, body:body && JSON.stringify(body) }); return r.json(); };
const railNames = page => page.locator("#railList .rail-item:not(.rail-meetcue) .rail-row .rail-name").allTextContents();
const text = page => page.locator("#view").textContent();
async function open(page, name) {
  if (await page.locator("#linePage").count()) { await page.locator('[data-act="go-view"][data-view="home"]').first().click(); await page.waitForSelector("#railList .rail-row"); }
  await page.locator("#railList .rail-row", { hasText:name }).click();
  await until(async () => (await page.locator("#railList .rail-row.on").textContent()).includes(name), `${name} to open`);
  await page.waitForSelector("#panoRows .hl-main, .empty-page", { timeout:8000 }).catch(() => {});
}
async function line(page, slug) {
  await page.locator(`#panoRows .hl-main[data-line="${slug}"]`).first().click();
  await page.waitForSelector("#linePage");
  await page.waitForTimeout(400);
}

let browser;
(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000);
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1440, height:900 }, acceptDownloads:true });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const problems = [];
  page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) problems.push(m.text()); });
  page.on("pageerror", e => problems.push(`pageerror: ${e.message}`));

  console.log("\nPenEcho opens with no project of your own");
  await page.goto(`${base}/`);
  await page.waitForURL(/projects\.html#new$/, { timeout:20000 });
  await page.waitForSelector(".np-page");
  await page.waitForSelector("#railList .rail-item .rail-row");
  check("\"/\" goes on to New project", /projects\.html#new$/.test(page.url()));
  check("the three examples are in the sidebar, the code project first", JSON.stringify(await railNames(page)) === JSON.stringify(NAMES), await railNames(page));
  check("New project has no example cards: they are in the sidebar", await page.locator(".np-page .examples, .np-page [data-act=open-example]").count() === 0);
  check("the 8 equal feature points sit above the centered Create project form", await page.evaluate(() => {
    const f = document.querySelector(".np-card").getBoundingClientRect();
    const g = document.querySelector(".np-gives").getBoundingClientRect();
    const pts = [...document.querySelectorAll(".np-gives .pls-point")];
    return pts.length === 8 && g.bottom <= f.top + 4 && f.width <= 700;
  }));
  check("a browser driven by a test is not shown the opening", await page.locator("#peOpening").count() === 0);
  await shot(page, "01-new-project");

  console.log("\nThe opening");
  const opening = await context.newPage();
  await opening.goto(`${base}/projects.html?opening=1#new`);
  check("it covers the page from the first frame, with the name", await opening.locator("#peOpening").count() === 1 && /PenEcho Lines/.test(await opening.locator("#peOpening .po-ttl").textContent()));
  check("its day headers are today's", (await opening.locator("#peOpening .po-dw").first().textContent()).includes(new Date().toLocaleDateString("en-GB", { day:"numeric", month:"short" }).replace(/,/g, "")));
  await opening.waitForTimeout(450);
  await shot(opening, "02-opening-0.45s");
  await opening.waitForTimeout(1300);
  await shot(opening, "03-opening-1.75s");
  await until(async () => await opening.locator("#peOpening").count() === 0, "the opening to end", 3000);
  check("it is gone within 2.7 seconds, leaving the page", await opening.locator(".np-page").count() === 1);
  await opening.reload();
  await opening.waitForSelector("#peOpening");
  await opening.mouse.click(700, 450);
  await until(async () => await opening.locator("#peOpening").count() === 0, "a click to end it", 1000);
  check("a click ends it at once", true);
  await opening.close();

  console.log("\nTimeline app (Demo)");
  await open(page, "Timeline app (Demo)");
  const map = await page.locator("#pano").textContent();
  check("its map shows the three lines, each on its branch", /Time labels overlap/.test(map) && /Homepage from my drawing/.test(map) && /Dark mode/.test(map) && /fix-time-labels/.test(map) && /dark-mode/.test(map), map.slice(0, 300));
  check("dark mode's branch says it was made from the homepage's", await until(() => page.locator(".bh-from").count(), "the branch tree", 10000).then(() => page.locator(".bh-from").first().textContent()).then(t => /from homepage/.test(t)).catch(() => false));
  check("nothing in an example reads as unread", await page.locator(".line-unread, .line-hint, [class*=unread]").count() === 0);
  await shot(page, "04-timeline-app");
  await line(page, "homepage-from-my-drawing");
  check("the homepage line: your drawing, Claude's prototype on a Canvas, and the page Codex built", await page.locator("#linePage img[src*='sketch.png']").count() >= 1 && await page.locator("#linePage img[src*='prototype.png']").count() >= 1 && await page.locator("#linePage img[src*='homepage.png']").count() >= 1);
  check("the homepage works show Edit on canvas and HTML page links", await page.locator("#linePage .lp-work .line-pic-edit[data-act='open-canvas']").count() >= 2 && await page.locator("#linePage .lp-work .lp-out[data-kind='page'][data-path$='prototype.explorer.html']").count() === 1 && await page.locator("#linePage .lp-work .lp-out[data-kind='page'][data-path$='homepage.explorer.html']").count() === 1);
  check("Claude and Codex are both on it", await page.locator("#linePage .av[title='Claude Code'], #linePage .av[title='Claude']").count() >= 1 && await page.locator("#linePage .av[title='Codex']").count() >= 1);
  await shot(page, "05-homepage-line");
  await open(page, "Timeline app (Demo)");
  await line(page, "dark-mode");
  const dark = await text(page);
  check("dark mode: Claude, then Codex twice, and it merges into homepage, the branch it was made from", await page.locator("#linePage .av[title='Codex']").count() >= 1 && /dark-mode/.test(dark) && /Merge\s*into homepage/.test(dark), dark.slice(0, 200));
  check("dark mode Work 3 shows Edit on canvas and dark-mode.explorer.html link at bottom", await page.locator("#linePage .lp-work .line-pic-edit[data-act='open-canvas']").count() === 1 && await page.locator("#linePage .lp-work .lp-out[data-kind='page'][data-path$='dark-mode.explorer.html']").count() === 1);
  await shot(page, "06-dark-mode-line");

  console.log("\nCalculus class notes (Demo)");
  await open(page, "Calculus class notes (Demo)");
  check("two classes, two lines", await page.locator("#panoRows .hl-main").count() === 2);
  await line(page, "class-1-limits");
  check("class 1: the handwritten Canvas with Canvas AI's answers, then dsh's notes", await page.locator("#linePage img[src*='class-1.png']").count() >= 1 && /dsh/i.test(await page.locator("#linePage").textContent()));
  await page.locator("#linePage").getByText("Work 1", { exact:true }).first().click();
  check("dsh's notes keep their formulas, typeset", await until(() => page.locator("#view mjx-container").count(), "MathJax", 15000).then(n => n > 3).catch(() => false));
  await shot(page, "07b-class-1-work");
  await shot(page, "07-class-1-line");
  await open(page, "Calculus class notes (Demo)");
  await line(page, "class-2-derivatives");
  check("class 2 ends with the practice exam on a Canvas", await page.locator("#linePage img[src*='practice-exam.png']").count() >= 1);
  await shot(page, "08-class-2-line");

  console.log("\nSales review deck (Demo)");
  await open(page, "Sales review deck (Demo)");
  await line(page, "q3-sales-review-deck");
  const deck = await page.locator("#linePage").textContent();
  check("the first Ask attaches the spreadsheet; both versions of the deck are shown", /sales-2026\.xlsx/.test(deck) && await page.locator("#linePage img[src*='first-version.png']").count() >= 1 && await page.locator("#linePage img[src*='sales-review.png']").count() >= 1);
  await shot(page, "09-deck-line");
  const button = page.locator(".ppt-download").first();
  check("the deck's picture offers Download PPT", await button.count() >= 1);
  if (await button.count()) {
    const [download] = await Promise.all([page.waitForEvent("download", { timeout:60000 }), button.click()]);
    const file = path.join(temp, download.suggestedFilename());
    await download.saveAs(file);
    check("Download PPT gives a PowerPoint file of the six slides", /\.pptx$/.test(file) && fs.statSync(file).size > 30000, `${download.suggestedFilename()} ${fs.statSync(file).size}`);
  }

  console.log("\nAn empty project links to them");
  const docs = path.join(temp, "Documents", "PenEcho", "Field trip");
  const made = await api("POST", "/projects", { name:"Field trip", docsPath:docs });
  await page.goto(`${base}/projects.html#${made.project.id}`);
  await page.reload();
  await page.waitForSelector(".empty-page");
  const cards = page.locator('.examples [data-act="open-example"]');
  check("the empty project shows the three examples", JSON.stringify(await cards.locator("strong").allTextContents()) === JSON.stringify(NAMES));
  check("the page does not scroll sideways", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await shot(page, "10-empty-project");
  const notes = (await api("GET", "/projects")).projects.find(p => p.example === "class");
  await api("DELETE", `/projects/${notes.id}`);
  await page.reload();
  await page.waitForSelector(".empty-page");
  check("a removed example leaves the sidebar", !(await railNames(page)).includes("Calculus class notes (Demo)"));
  await page.locator('.examples [data-kind="class"]').click();
  await until(async () => (await page.locator("#railList .rail-row.on").textContent()).includes("Calculus class notes (Demo)"), "the class notes to come back");
  check("its card brings it back, with its lines", await until(() => page.locator("#panoRows .hl-main").count(), "its lines").then(n => n === 2).catch(() => false));

  console.log("\nWith a project of your own");
  await page.goto(`${base}/`);
  await page.waitForURL(/projects\.html#/, { timeout:20000 });
  await page.waitForSelector("#railList .rail-row.on");
  check("\"/\" opens your last project, not New project", !/#new$/.test(page.url()), page.url());

  console.log("\nA phone");
  await page.setViewportSize({ width:390, height:844 });
  await page.goto(`${base}/projects.html#${made.project.id}`);
  await page.reload();
  await page.waitForSelector(".empty-page");
  check("on a phone the examples stack and nothing scrolls sideways", await page.evaluate(() => { const c = [...document.querySelectorAll(".ex-card")].map(e => e.getBoundingClientRect()); return c.length === 3 && c[1].top > c[0].bottom - 1 && document.documentElement.scrollWidth <= innerWidth + 1; }));
  await shot(page, "11-phone");

  check("no errors on the page", problems.length === 0, problems.join(" | "));
})().catch(error => { failures.push(error.message); console.log(`FAIL  ${error.message}`); }).finally(async () => {
  await browser?.close().catch(() => {});
  server.kill();
  fs.rmSync(temp, { recursive:true, force:true, maxRetries:3 });
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
});
