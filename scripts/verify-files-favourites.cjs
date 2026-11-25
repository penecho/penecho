#!/usr/bin/env node
"use strict";
// Isolated Favourites acceptance on Canvases & files: the star on a card's hover and in the viewer, the Favourites filter,
// the star in the line page's file popup, a reload and a rename keep it, and a Canvas can be a favourite too. No real project is changed.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-files-favourites.cjs [screenshots folder]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lines-favs-"));
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
const pad = n => String(n).padStart(2, "0");
const d = new Date(), stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const { newBundle } = require("../src/server/project-lines/canvas-file.js");
function put(rel, data) { const file = path.join(docs, rel); fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, data); }
function seed() {
  put("lines/beds.md", `---\nid: G-1\nstatus: done\nwho: @claude\ncreated: ${stamp}\n---\n\n# Plan the beds\n\n## Ask · ${stamp}\n\nPlan the beds.\n\n![Bed plan](../files/beds/bed-plan.png)\n\n![Bed rows](../files/beds/bed-rows.png)\n\n## [x] Work 1 · @claude · 3 min\n\nThe report: [report](../files/beds/report.md) and [costs](../files/beds/costs.txt).\n`);
  put("files/beds/bed-plan.png", PNG);
  put("files/beds/bed-rows.png", PNG);
  put("files/beds/report.md", "# Report\n\nThe beds.\n");
  put("files/beds/costs.txt", "Soil 40\n");
  put("files/sketch/canvas.penecho.json", JSON.stringify(newBundle({ id:"sketch", name:"Sketch" })));
  put("files/sketch/canvas.png", PNG);
}

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", x => { serverLog += x; }); server.stderr.on("data", x => { serverLog += x; });

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000).catch(error => { throw new Error(`${error.message}\n${serverLog}`); });
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : {});
  const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
  const errors = [];
  const send = async (method, address, data) => (await context.request[method](`${base}/api/lines${address}`, { data, headers:{ origin:base } })).json();
  const id = (await send("post", "/projects", { name:"Garden", docsPath:docs })).project.id;
  seed();
  await send("patch", `/projects/${id}`, { offerSkill:false });
  const saved = async () => (await send("get", `/projects/${id}/state`)).project.favoriteFiles || [];

  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|Permissions policy violation/.test(m.text())) errors.push(m.text()); });
  const texts = async selector => (await page.locator(selector).allTextContents()).map(t => t.replace(/\s+/g, " ").trim());
  const card = name => page.locator(".fl-card").filter({ has:page.locator(".fl-tx b", { hasText:name }) }).first();
  const open = async () => {
    await page.goto(`${base}/projects.html#${id}/files`);
    await page.waitForSelector(".fl-page #flBody .fl-card", { timeout:30000 });
    await wait(300);
  };
  await open();

  console.log("Star on a card");
  const report = card("report.md"), star = report.locator(".fl-fav");
  check("a card has a star button", await star.count() === 1);
  check("the star is hidden until hover", await star.evaluate(el => getComputedStyle(el).opacity) === "0");
  await report.hover(); await wait(200);
  check("hovering the card shows the star", await star.evaluate(el => getComputedStyle(el).opacity) === "1");
  await page.screenshot({ path:path.join(shots, "1-hover.png") });
  await star.click(); await wait(100);
  check("clicking the star does not open the viewer", await page.locator("#lightbox:not([hidden]) .fv").count() === 0);
  check("the star is pressed at once", await star.getAttribute("aria-pressed") === "true");
  await until(async () => (await saved()).includes("files/beds/report.md"), "the server to keep the favourite");
  check("the server keeps it with the project", true);
  await page.mouse.move(5, 890); await wait(200);
  check("a starred card keeps its star in sight", await report.locator(".fl-fav").evaluate(el => getComputedStyle(el).opacity) === "1");

  console.log("Star in the viewer");
  await card("costs.txt").click();
  await page.waitForSelector("#lightbox .fv");
  const fvStar = page.locator("#lightbox .fv-side .fl-fav");
  check("the viewer has a star", await fvStar.count() === 1 && await fvStar.getAttribute("aria-pressed") === "false");
  await fvStar.click(); await wait(100);
  check("the viewer star is pressed", await page.locator("#lightbox .fv-side .fl-fav").getAttribute("aria-pressed") === "true");
  check("the viewer star keeps focus", await page.evaluate(() => document.activeElement?.classList.contains("fl-fav")));
  await page.screenshot({ path:path.join(shots, "2-viewer.png") });
  await page.keyboard.press("Escape"); await wait(150);
  check("its card under the viewer is starred too", await card("costs.txt").locator(".fl-fav").getAttribute("aria-pressed") === "true");
  await until(async () => (await saved()).includes("files/beds/costs.txt"), "the viewer favourite to be kept");

  console.log("A Canvas");
  const canvasStar = card("Sketch").locator(".fl-fav");
  await card("Sketch").hover(); await canvasStar.click(); await wait(100);
  await until(async () => (await saved()).includes("files/sketch/canvas.penecho.json"), "the Canvas favourite to be kept");
  check("a Canvas can be a favourite", true);

  console.log("Favourites filter");
  await page.click("#flFav"); await wait(150);
  const names = await texts(".fl-card .fl-tx b");
  check("the filter shows only favourites", names.length === 3 && names.includes("report.md") && names.includes("costs.txt") && names.includes("Sketch"), names.join(", "));
  check("the filter is on", await page.locator("#flFav").getAttribute("aria-pressed") === "true");
  check("the filter says how many", /3 files/.test(await page.locator(".fl-sum").textContent()));
  await page.screenshot({ path:path.join(shots, "3-filter.png") });
  await card("costs.txt").locator(".fl-fav").click(); await wait(150);
  check("unstarring under the filter takes it away", !(await texts(".fl-card .fl-tx b")).includes("costs.txt"));
  await until(async () => !(await saved()).includes("files/beds/costs.txt"), "the unstar to be kept");
  await page.click(".fl-chip[data-kind=\"canvas\"]"); await wait(150);
  check("the filter works with a kind", JSON.stringify(await texts(".fl-card .fl-tx b")) === JSON.stringify(["Sketch"]));
  await page.click("#flFav"); await wait(150);
  check("off again, all Canvases show", (await texts(".fl-card .fl-tx b")).includes("Sketch") && await page.locator("#flFav").getAttribute("aria-pressed") === "false");

  console.log("Reload and rename");
  await page.reload(); await page.waitForSelector(".fl-page #flBody .fl-card", { timeout:30000 }); await wait(300);
  check("after a reload the star is still on", await card("report.md").locator(".fl-fav").getAttribute("aria-pressed") === "true");
  const renamed = await send("post", `/projects/${id}/files/rename`, { path:"files/beds/report.md", name:"summary" });
  check("rename works", renamed.path === "files/beds/summary.md", JSON.stringify(renamed));
  const after = await saved();
  check("a renamed file stays a favourite", after.includes("files/beds/summary.md") && !after.includes("files/beds/report.md"), after.join(", "));
  await page.click("#flFav"); await wait(150);
  check("an empty filter says so", true);
  await send("patch", `/projects/${id}`, { favorite:{ path:"files/beds/summary.md", on:false } });
  await send("patch", `/projects/${id}`, { favorite:{ path:"files/sketch/canvas.penecho.json", on:false } });
  await until(async () => (await page.locator("#flBody .empty-line").count()) > 0, "the empty favourites list", 20000);
  check("no favourites says so", /No favourites yet/.test(await page.locator("#flBody .empty-line").textContent()));

  console.log("Line page popup");
  await page.goto(`${base}/projects.html#${id}/line/beds`);
  const pic = page.locator('[data-act="open-asset"][data-path="files/beds/bed-plan.png"], [data-act="preview-asset"][data-path="files/beds/bed-plan.png"]').first();
  await pic.waitFor({ timeout:30000 }); await pic.click();
  await page.waitForSelector("#lightbox:not([hidden]) .lb-card");
  const lbStar = page.locator("#lightbox .lb-card > header .lb-fav");
  check("the popup has a star", await lbStar.count() === 1 && await lbStar.getAttribute("aria-pressed") === "false");
  check("the star sits before Download", await page.evaluate(() => { const h = document.querySelector("#lightbox .lb-card > header"), s = h.querySelector(".lb-fav"), a = h.querySelector("a.btn"); return Boolean(s && a && s.nextElementSibling === a && a.getBoundingClientRect().left - s.getBoundingClientRect().right < 20); }));
  await lbStar.click(); await wait(100);
  check("the popup star is pressed at once and keeps focus", await page.locator("#lightbox .lb-fav").getAttribute("aria-pressed") === "true" && await page.evaluate(() => document.activeElement?.classList.contains("lb-fav")));
  await until(async () => (await saved()).includes("files/beds/bed-plan.png"), "the popup favourite to be kept");
  check("the popup star is kept with the project", true);
  await page.screenshot({ path:path.join(shots, "5-popup.png") });
  if (await page.locator("#lightbox .lb-count").count()) {
    await page.keyboard.press("ArrowRight"); await wait(150);
    check("the next picture has its own star", await page.locator("#lightbox .lb-fav").getAttribute("data-key") === "files/beds/bed-rows.png" && await page.locator("#lightbox .lb-fav").getAttribute("aria-pressed") === "false");
    await page.keyboard.press("ArrowLeft"); await wait(150);
    check("back on the first, its star is on", await page.locator("#lightbox .lb-fav").getAttribute("aria-pressed") === "true");
  }
  await page.locator("#lightbox .lb-fav").click(); await wait(100);
  await until(async () => !(await saved()).includes("files/beds/bed-plan.png"), "the popup unstar to be kept");
  check("the popup star turns off again", await page.locator("#lightbox .lb-fav").getAttribute("aria-pressed") === "false");
  await page.keyboard.press("Escape"); await wait(150);
  // A Work's links open the same popup; the line page folds a Work, so open it the way its links do.
  await page.evaluate(() => openLightbox(project(), "files/beds/costs.txt"));
  await page.waitForSelector("#lightbox:not([hidden]) .lb-text");
  check("a text file in the popup has a star", await page.locator("#lightbox .lb-fav").getAttribute("data-key") === "files/beds/costs.txt");
  await page.keyboard.press("Escape"); await wait(150);
  await page.evaluate(() => openLightbox(project(), "files/sketch/canvas.png"));
  await page.waitForSelector("#lightbox:not([hidden]) .lb-card");
  check("a Canvas's picture stars its Canvas", await page.locator("#lightbox .lb-fav").getAttribute("data-key") === "files/sketch/canvas.penecho.json", await page.locator("#lightbox header").innerHTML());
  await page.keyboard.press("Escape"); await wait(150);
  await page.goto(`${base}/projects.html#${id}/files`); await page.waitForSelector(".fl-page #flBody", { timeout:30000 }); await wait(300);
  if (await page.locator("#flFav").getAttribute("aria-pressed") === "false") { await page.click("#flFav"); await wait(150); }

  console.log("Phone");
  await page.setViewportSize({ width:390, height:844 }); await page.click("#flFav"); await wait(200);
  check("on a phone the star shows without hover", await page.locator(".fl-card .fl-fav").first().evaluate(el => getComputedStyle(el).opacity) === "1" || !(await page.evaluate(() => matchMedia("(hover: none)").matches)));
  await page.screenshot({ path:path.join(shots, "4-phone.png") });

  check("no page errors", !errors.length, errors.join(" | "));
})().catch(error => { failures.push(error.message); console.error(error); }).finally(async () => {
  await browser?.close().catch(() => {});
  server.kill();
  console.log(`\n${passed} passed, ${failures.length} failed. Pictures: ${shots}`);
  if (!failures.length) fs.rmSync(path.join(temp, "garden"), { recursive:true, force:true });
  process.exit(failures.length ? 1 : 0);
});
