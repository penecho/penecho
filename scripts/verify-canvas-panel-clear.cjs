#!/usr/bin/env node
"use strict";
// A project's Canvas opens with its line panel on the right. What the Canvas shows must not be under that panel.
// This draws across the whole width with the panel closed, frames it in the whole window, opens the Canvas again,
// and checks in a real browser that the drawing now sits beside the panel, whole.
//   PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-canvas-panel-clear.cjs [folder for screenshots]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-canvas-panel-"));
const shots = process.argv[2] ? path.resolve(process.argv[2]) : path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
const PORT = 5700 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const docs = path.join(temp, "docs"), source = "files/canvases/canvas-1.penecho.json", file = path.join(docs, source);
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 300)}` : ""}`); }
}
async function until(fn, label, ms = 15000) {
  const start = Date.now();
  for (;;) { if (await fn()) return true; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(100); }
}

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000);
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const errors = [];
  const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
  const post = async (address, data) => (await context.request.post(`${base}${address}`, { data, headers:{ origin:base } })).json();
  const made = await post("/api/lines/projects", { name:"Weather app", docsPath:docs });
  const id = made.project.id;
  const address = `${base}/?${new URLSearchParams({ linesProject:id, linesCanvas:source, linesTitle:"Canvas 1", linesBack:id })}`;
  const settle = async page => {
    await page.waitForSelector("#viewport");
    await wait(2500);
    await page.keyboard.press("Escape");
    for (const closer of [page.getByRole("button", { name:"Skip tour" }), page.locator("#changelogLayer button").first()]) if (await closer.isVisible().catch(() => false)) { await closer.click().catch(() => {}); await wait(300); }
  };
  const box = (page, selector) => page.evaluate(s => { const el = document.querySelector(s); if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom }; }, selector);
  // The ink seen on the Canvas, measured from a screenshot of the area left of the panel (the panel itself is light).
  const helper = await context.newPage();
  const inkBox = async (page, clip) => {
    const png = (await page.screenshot({ clip })).toString("base64");
    return helper.evaluate(async data => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const pen = canvas.getContext("2d"); pen.drawImage(image, 0, 0);
      const pixels = pen.getImageData(0, 0, canvas.width, canvas.height).data;
      let minX = Infinity, maxX = -1, count = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) { const i = (y * canvas.width + x) * 4; if (pixels[i] + pixels[i + 1] + pixels[i + 2] < 200) { count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); } }
      return { count, minX, maxX };
    }, png);
  };

  let page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(address);
  await settle(page);
  await page.waitForSelector("#projectLinesPanel:not([hidden])");
  check("the panel is open when the Canvas opens", Boolean(await box(page, "#projectLinesPanel")));
  await page.locator(".project-lines-panel-button").click();
  await until(async () => !await box(page, "#projectLinesPanel"), "the panel to close");
  const canvas = await box(page, "#viewport");
  // A line from near the left edge of the Canvas to near its right edge, under where the panel will be.
  await page.keyboard.press("p");
  for (const y of [300, 520]) {
    await page.mouse.move(canvas.left + 120, y); await page.mouse.down();
    for (let i = 1; i <= 30; i++) { await page.mouse.move(canvas.left + 120 + (canvas.right - canvas.left - 240) * i / 30, y); await wait(8); }
    await page.mouse.up();
    await wait(300);
  }
  await page.locator("#canvasFitContents").click();
  await wait(800);
  await page.screenshot({ path:path.join(shots, "1-framed-panel-closed.png") });
  const framed = await inkBox(page, { x:canvas.left, y:canvas.top, width:canvas.right - canvas.left, height:canvas.bottom - canvas.top });
  check("framed with the panel closed, the drawing reaches the right of the window", framed.count > 200 && framed.maxX > (canvas.right - canvas.left) - 200, JSON.stringify(framed));
  // Saved to the folder and the view remembered, then opened again: the panel opens with it.
  await until(() => fs.existsSync(file) && fs.readFileSync(file, "utf8").includes('"kind":"tile"'), "the Canvas to be saved", 30000);
  await wait(600);
  await page.close();

  page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(address);
  await settle(page);
  await page.waitForSelector("#projectLinesPanel:not([hidden])");
  await wait(800);
  const panel = await box(page, "#projectLinesPanel"), canvas2 = await box(page, "#viewport");
  await page.screenshot({ path:path.join(shots, "2-opened-panel-open.png") });
  const opened = await inkBox(page, { x:canvas2.left, y:canvas2.top, width:panel.left - canvas2.left, height:canvas2.bottom - canvas2.top });
  check("opened again, the drawing ends clear of the panel", opened.count > 200 && opened.maxX < panel.left - canvas2.left - 20, `${JSON.stringify(opened)} panel at ${panel.left - canvas2.left}`);
  check("and starts inside the Canvas", opened.minX > 10, JSON.stringify(opened));

  // Closing and opening the panel again leaves a view that is already clear as it is.
  await page.locator(".project-lines-panel-button").click();
  await wait(300);
  await page.locator(".project-lines-panel-button").click();
  await wait(600);
  const again = await inkBox(page, { x:canvas2.left, y:canvas2.top, width:panel.left - canvas2.left, height:canvas2.bottom - canvas2.top });
  check("closing and opening the panel keeps that view", Math.abs(again.minX - opened.minX) <= 2 && Math.abs(again.maxX - opened.maxX) <= 2, `${JSON.stringify(opened)} then ${JSON.stringify(again)}`);
  check("no page errors", errors.length === 0, errors.join(" | "));

  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed. Screenshots: ${shots}`);
  process.exitCode = failures.length ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { server.kill(); });
