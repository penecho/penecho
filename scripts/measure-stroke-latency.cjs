#!/usr/bin/env node
"use strict";
// Measures how late the Canvas is while you draw, in a real browser against a real server of its own.
// It draws the same strokes on a plain Canvas, on a Canvas opened from a project with the rail beside it, and on that Canvas with the rail hidden, and reports for each:
//   how long pointer moves waited before the page could handle them (the lag you feel),
//   how long frames were held up, and every long task with how long after pen-up it started.
//
//   NODE_PATH=/path/to/node_modules node scripts/measure-stroke-latency.cjs [--strokes=40] [--screens=4] [--json] [--only=plain|project|hidden]
//
// Nothing outside a temporary folder is touched.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const arg = (name, fallback) => { const hit = process.argv.find(a => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const STROKES = Number(arg("strokes", 40)), SCREENS = Number(arg("screens", 4)), ONLY = arg("only", ""), JSON_OUT = process.argv.includes("--json");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-latency-"));
const PORT = 4800 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const say = (...words) => { if (!JSON_OUT) console.log(...words); };

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

// Runs in the page before anything else: what the main thread was doing while strokes were drawn.
function watch() {
  const lat = window.__lat = { on:false, delay:[], down:[], frames:[], long:[], slow:[], ups:[], saves:[] };
  addEventListener("pointermove", e => { if (lat.on && e.buttons) lat.delay.push(performance.now() - e.timeStamp); }, { capture:true, passive:true });
  addEventListener("pointerdown", e => { if (lat.on) lat.down.push(performance.now() - e.timeStamp); }, { capture:true, passive:true });
  addEventListener("pointerup", () => { if (lat.on) lat.ups.push(performance.now()); }, { capture:true, passive:true });
  try { new PerformanceObserver(list => { for (const e of list.getEntries()) lat.long.push({ at:e.startTime, ms:e.duration }); }).observe({ type:"longtask", buffered:true }); } catch { /* Not in this browser. */ }
  try { new PerformanceObserver(list => { for (const e of list.getEntries()) if (/^pointer(down|move|up)$/.test(e.name)) lat.slow.push({ name:e.name, at:e.startTime, ms:e.duration, work:e.processingEnd - e.processingStart }); }).observe({ type:"event", durationThreshold:16, buffered:true }); } catch { /* Not in this browser. */ }
  let last = performance.now();
  const tick = now => { if (lat.on) lat.frames.push(now - last); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  // How big each save to the project folder is, and how long the request took.
  const send = window.fetch;
  window.fetch = async (input, init) => {
    const url = String(input?.url || input), started = performance.now(), saving = init?.method === "POST" && /\/api\/lines\/projects\/[^/]+\/canvas/.test(url);
    try { return await send(input, init); } finally { if (saving) lat.saves.push({ at:started, ms:performance.now() - started, bytes:String(init.body || "").length }); }
  };
}
const pick = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
const round = n => Math.round(n * 10) / 10;
function summary(lat) {
  const delay = [...lat.delay].sort((a, b) => a - b), frames = [...lat.frames].sort((a, b) => a - b), long = lat.long.filter(t => t.at >= lat.from);
  // Which timer a long task belongs to shows in how long after pen-up it starts.
  const after = task => { const before = lat.ups.filter(up => up <= task.at); return before.length ? task.at - before[before.length - 1] : -1; };
  // A save marks each of its parts as it starts; a long task belongs to the parts that started inside it, or the one running when it began.
  const part = task => {
    const inside = lat.marks.filter(m => m.at >= task.at && m.at <= task.at + task.ms).map(m => m.name);
    if (inside.length) return [...new Set(inside)].join("+");
    const before = lat.marks.filter(m => m.at < task.at).pop();
    return before && before.name !== "done" ? before.name : "";
  };
  return {
    moves:delay.length, moveWaitP50:round(pick(delay, .5)), moveWaitP95:round(pick(delay, .95)), moveWaitP99:round(pick(delay, .99)), moveWaitMax:round(delay[delay.length - 1] || 0),
    movesLate:delay.filter(d => d > 32).length, penDownWaitMax:round(Math.max(0, ...lat.down)),
    frameP95:round(pick(frames, .95)), frameMax:round(frames[frames.length - 1] || 0), framesHeld:frames.filter(f => f > 50).length,
    longTasks:long.length, longTotal:round(long.reduce((sum, t) => sum + t.ms, 0)), longMax:round(Math.max(0, ...long.map(t => t.ms))),
    worst:long.sort((a, b) => b.ms - a.ms).slice(0, 6).map(t => ({ ms:round(t.ms), afterPenUp:round(after(t)), part:part(t) })),
    slowEvents:lat.slow.filter(e => e.at >= lat.from).length, slowEventWorkMax:round(Math.max(0, ...lat.slow.filter(e => e.at >= lat.from).map(e => e.work))),
    saves:lat.saves.length, saveBytesMax:Math.max(0, ...lat.saves.map(s => s.bytes)), saveMsMax:round(Math.max(0, ...lat.saves.map(s => s.ms))),
  };
}

async function stroke(page, x, y, dx, dy, steps = 28, pace = 8) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x + dx * i / steps, y + dy * i / steps + Math.sin(i / 3) * 14); if (pace) await wait(pace); }
  await page.mouse.up();
}
async function clear(page) {
  await page.keyboard.press("Escape");
  const skip = page.getByRole("button", { name:"Skip tour" });
  if (await skip.isVisible().catch(() => false)) { await skip.click(); await wait(300); }
  const changes = page.locator("#changelogLayer button").first();
  if (await changes.isVisible().catch(() => false)) { await changes.click().catch(() => {}); await wait(300); }
  const back = page.locator("[data-pls-back]");
  if (await back.isVisible().catch(() => false)) { await back.click(); await wait(300); }
}
async function run(context, name, url) {
  const page = await context.newPage();
  // The rail beside a project's Canvas, hidden or shown. A page keeps its own choice, so each run sets it.
  await page.addInitScript(hidden => { try { localStorage.setItem("penecho-lines-projects-hidden", hidden ? "1" : "0"); } catch { /* It is then shown. */ } }, name === "project, rail hidden");
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector("#viewport");
  await wait(2500);
  await clear(page);
  await page.keyboard.press("p");
  // Every stroke starts on the Canvas, wherever its left edge is.
  const left = await page.evaluate(() => Math.round(document.querySelector("#viewport").getBoundingClientRect().left));
  // Ink over several screens, so there is as much to save as a page of real notes has.
  for (let screen = 0; screen < SCREENS; screen++) {
    for (let row = 0; row < 6; row++) await stroke(page, left + 220, 170 + row * 95, 980 - left, 30, 22, 0);
    if (screen < SCREENS - 1) { await page.mouse.move(left + 500, 450); await page.mouse.wheel(900, 0); await wait(250); }
  }
  await wait(4000);
  await page.evaluate(() => { const lat = window.__lat; lat.delay.length = lat.down.length = lat.frames.length = lat.ups.length = 0; lat.from = performance.now(); lat.on = true; });
  // Handwriting: short strokes with short pauses, and a longer pause now and then.
  for (let i = 0; i < STROKES; i++) {
    await stroke(page, left + 260 + (i % 8) * (left ? 80 : 110), 200 + (i % 5) * 110, 70, 46);
    await wait(i % 6 === 5 ? 1700 : 260 + (i * 97) % 380);
  }
  await wait(3500);
  const lat = await page.evaluate(() => { window.__lat.on = false; window.__lat.marks = performance.getEntriesByType("mark").filter(m => m.name.startsWith("penecho-lines-save:")).map(m => ({ name:m.name.slice(19), at:m.startTime })); return window.__lat; });
  await page.close();
  return { name, errors, ...summary(lat) };
}

(async () => {
  const until = Date.now() + 30000;
  while (!serverLog.includes("PenEcho:")) { if (Date.now() > until) throw new Error(`The server did not start.\n${serverLog.slice(-800)}`); await wait(100); }
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
  await context.addInitScript(watch);
  const made = await (await context.request.post(`${base}/api/lines/projects`, { data:{ name:"Latency", docsPath:path.join(temp, "docs") }, headers:{ origin:base } })).json();
  if (!made.project) throw new Error(`No project: ${JSON.stringify(made).slice(0, 300)}`);
  const id = made.project.id, results = [];
  // Any parameter keeps the plain Canvas: with none, PenEcho starts on a new Canvas in My Canvases.
  if (!ONLY || ONLY === "plain") results.push(await run(context, "plain", `${base}/?plain=1`));
  if (!ONLY || ONLY === "project") results.push(await run(context, "project", `${base}/?${new URLSearchParams({ linesProject:id, linesCanvas:"files/canvases/canvas-1.penecho.json", linesTitle:"Canvas 1", linesBack:id })}`));
  if (!ONLY || ONLY === "hidden") results.push(await run(context, "project, rail hidden", `${base}/?${new URLSearchParams({ linesProject:id, linesCanvas:"files/canvases/canvas-2.penecho.json", linesTitle:"Canvas 2", linesBack:id })}`));
  await browser.close();
  if (JSON_OUT) console.log(JSON.stringify(results, null, 2));
  else for (const r of results) {
    say(`\n${r.name} Canvas, ${r.moves} pen moves`);
    say(`  a move waited      p50 ${r.moveWaitP50} ms   p95 ${r.moveWaitP95} ms   p99 ${r.moveWaitP99} ms   worst ${r.moveWaitMax} ms   (${r.movesLate} over 32 ms)`);
    say(`  pen-down waited    worst ${r.penDownWaitMax} ms`);
    say(`  a frame took       p95 ${r.frameP95} ms   worst ${r.frameMax} ms   (${r.framesHeld} over 50 ms)`);
    say(`  long tasks         ${r.longTasks}, ${r.longTotal} ms in all, worst ${r.longMax} ms`);
    for (const t of r.worst) say(`    ${t.ms} ms, ${t.afterPenUp < 0 ? "before any stroke" : `${t.afterPenUp} ms after pen-up`}${t.part ? `, saving: ${t.part}` : ""}`);
    say(`  slow pointer events ${r.slowEvents}, handler worst ${r.slowEventWorkMax} ms`);
    if (r.saves) say(`  saves to the folder ${r.saves}, largest ${(r.saveBytesMax / 1048576).toFixed(1)} MB, slowest ${r.saveMsMax} ms`);
    if (r.errors.length) say(`  page errors: ${r.errors.slice(0, 3).join(" | ")}`);
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(() => { server.kill(); try { fs.rmSync(temp, { recursive:true, force:true }); } catch { /* Left for the system to clear. */ } });
