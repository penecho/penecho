#!/usr/bin/env node
"use strict";
// A plain text file is read where it is opened (PE-541): in the Files viewer, and from a link on a line page.
// A file over 1 MB shows its start and says so.
//   PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-lines-text-view.cjs [folder for screenshots]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-text-view-"));
const shots = process.argv[2] ? path.resolve(process.argv[2]) : path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
const PORT = 6400 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const docs = path.join(temp, "garden");
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, browser = null; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 400)}` : ""}`); }
}
async function until(fn, label, ms = 15000) {
  const start = Date.now();
  for (;;) { if (await fn()) return true; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(80); }
}
function put(rel, data) { const file = path.join(docs, rel); fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, data); }
const NOTES = "Seeds to buy:\n\ttomatoes\n\tbeans <b>not bold</b>\n";
const BIG = `${"x".repeat(99)}\n`.repeat(11000);
function seed() {
  put("lines/beds.md", `---\nid: G-1\nstatus: done\nwho: "@claude"\ncreated: 2026-11-16 10:30\n---\n\n# Plan the beds\n\n## Ask · 2026-11-16 10:30\n\nPlan the beds.\n\n## [x] Work 1 · @claude · 3 min\n\nThe list is in [notes](../files/notes.txt).\n`);
  put("files/notes.txt", NOTES);
  put("files/long.txt", BIG);
}

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000).catch(error => { throw new Error(`${error.message}\n${serverLog}`); });
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
  const errors = [];
  const send = async (method, address, data) => (await context.request[method](`${base}/api/lines${address}`, { data, headers:{ origin:base } })).json();
  const id = (await send("post", "/projects", { name:"Garden", docsPath:docs })).project.id;
  await send("patch", `/projects/${id}`, { offerSkill:false });
  // A new project needs an empty folder, so its files come after.
  seed();

  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|Permissions policy violation/.test(m.text())) errors.push(m.text()); });
  const card = name => page.locator(".fl-card").filter({ has:page.locator(".fl-tx b", { hasText:name }) }).first();
  const pre = sel => page.locator(sel).first().evaluate(el => el.textContent);

  console.log("\nThe Files viewer");
  await page.goto(`${base}/projects.html#${id}/files`);
  await until(async () => await card("notes.txt").count(), "the notes card", 30000);
  await card("notes.txt").click();
  await page.waitForSelector("#lightbox .fv");
  await until(async () => (await page.locator(".fv-stage .fv-text").count()) && await pre(".fv-stage .fv-text") === NOTES, "the text to show");
  check("a .txt file is read in the viewer, as it is (tabs, line breaks, no HTML)", await page.locator(".fv-stage .fv-text").isVisible() && !(await page.locator(".fv-stage .fv-text b").count()) && !(await page.locator(".fv-stage .fl-mark").count()));
  const style = await page.locator(".fv-stage .fv-text").evaluate(el => { const s = getComputedStyle(el); return { ws:s.whiteSpace, font:s.fontFamily }; });
  check("in a fixed-width font, long lines wrapped", style.ws === "pre-wrap" && /mono|menlo|courier/i.test(style.font), JSON.stringify(style));
  await page.screenshot({ path:path.join(shots, "viewer-text.png") });
  await page.keyboard.press("Escape");
  await card("long.txt").click();
  await until(async () => /Only the first 1 MB is shown/.test(await pre(".fv-stage .fv-text")), "the long file to show");
  const shown = await pre(".fv-stage .fv-text");
  check("a file over 1 MB shows its first 1 MB and says so", shown.startsWith("x".repeat(99)) && shown.length < BIG.length, `${shown.length} of ${BIG.length}`);
  await page.locator(".fv-stage .fv-doc").evaluate(el => { el.scrollTop = el.scrollHeight; });
  check("the long file scrolls in the viewer", await page.locator(".fv-stage .fv-doc").evaluate(el => el.scrollTop > 0));
  await page.keyboard.press("Escape");

  console.log("\nThe preview a line's file link opens");
  await page.goto(`${base}/projects.html#${id}/line/beds`);
  await page.waitForSelector("#item-work-1", { timeout:30000 });
  await page.evaluate(() => openLightbox(project(), "files/notes.txt"));
  await until(async () => (await page.locator("#lightbox .lb-text").count()) && await pre("#lightbox .lb-text") === NOTES, "the text in the preview");
  check("a text file linked from a line opens readable, not \"Download this file to open it\"", await page.locator("#lightbox .lb-text").isVisible() && !(await page.locator("#lightbox .lb-file").count()));
  await page.screenshot({ path:path.join(shots, "line-link-text.png") });

  check("no page errors", errors.length === 0, errors.join(" | "));
})().catch(error => { failures.push(error.message); console.log(`FAIL  ${error.stack || error.message}`); }).finally(async () => {
  await browser?.close().catch(() => {});
  server.kill();
  console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? `\n  ${failures.join("\n  ")}` : ""}\nScreenshots: ${shots}`);
  process.exitCode = failures.length ? 1 : 0;
});
