#!/usr/bin/env node
"use strict";
// Verify the default line panel and last-view restoration against canonical source,
// using a temporary server and project. No agent or external account is needed.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { newBundle } = require("../src/server/project-lines/canvas-file.js");

const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-canvas-opening-"));
const docs = path.join(temp, "docs"), shots = path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
const port = 5400 + Math.floor(Math.random() * 200), base = `http://127.0.0.1:${port}`;
const source = "files/opening/canvas.penecho.json", other = "files/other/canvas.penecho.json";
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(port), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent" } });
let log = "", browser, serverEnded = false, passed = 0;
server.stdout.on("data", data => { log += data; }); server.stderr.on("data", data => { log += data; });
server.on("exit", () => { serverEnded = true; });
async function until(fn, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!await fn()) { if (Date.now() > end) throw Error(`Timed out: ${label}`); await wait(50); }
}
function check(name, actual) { assert.ok(actual, name); passed++; console.log(`ok ${name}`); }
const camera = page => page.evaluate(() => window.openingTest.camera());
function sameCamera(a, b) { return ["scale", "panX", "panY"].every(key => Math.abs(a[key] - b[key]) < 1e-8); }

(async () => {
  await until(() => { if (serverEnded) throw Error(`Test server stopped before startup: ${log.slice(-1000)}`); return log.includes("PenEcho:"); }, "server start", 30000);
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1440, height:900 }, hasTouch:true });
  // Read-only test observation inside the existing app closure. All navigation
  // below still uses the real buttons, wheel, keyboard and rail.
  await context.route("**/app.js*", route => route.fulfill({ contentType:"application/javascript", body:fs.readFileSync(path.join(root, "public/app.js"), "utf8").replace(/\}\)\(\);\s*$/, 'window.openingTest={camera:()=>({scale:state.scale,panX:state.panX,panY:state.panY}),ready:()=>projectLinesRun.ready,revision:()=>state.userRevision};})();') }));
  await context.addInitScript(() => {
    if (top !== window) return;
    localStorage.setItem("penecho-language", "en");
    localStorage.setItem("penecho-lines-panel", "0");
    sessionStorage.setItem("penecho-lines-opening", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==");
  });
  const post = async (route, data) => {
    const response = await context.request.post(`${base}${route}`, { data, headers:{ origin:base } });
    assert.equal(response.ok(), true, await response.text()); return response.json();
  };
  const { project } = await post("/api/lines/projects", { name:"Canvas opening", docsPath:docs });
  const line = await post(`/api/lines/projects/${project.id}/yours`, { kind:"note", text:"Plan the forecast screen\n\nShow the weather cards and rain radar.", topic:"new" });
  const initial = { scale:.65, panX:-850, panY:-900, navigationLocked:false };
  for (const [file, transform] of [[source, initial], [other, { scale:.4, panX:-250, panY:-450, navigationLocked:false }]]) {
    const bundle = newBundle({ id:file, name:"Small drawing" });
    bundle.manifest.view = transform;
    bundle.manifest.textBoxes = [{ id:"text-1", x:1800, y:1800, w:280, h:100, maxWidth:280, fontSize:24, color:"#172033", text:"Weather cards" }];
    // Every saved Canvas carries its small preview, and the Canvas page will not open one without it.
    bundle.assets.push({ kind:"preview", contentType:"image/png", metadata:{ width:1, height:1 }, dataBase64:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==" });
    fs.mkdirSync(path.dirname(path.join(docs, file)), { recursive:true });
    fs.writeFileSync(path.join(docs, file), JSON.stringify(bundle));
  }
  const address = file => `${base}/?${new URLSearchParams({ linesProject:project.id, linesCanvas:file, linesDoc:`lines/${line.slug}.md`, linesTitle:"Small drawing", linesBack:project.id })}`;
  const errors = [], page = await context.newPage(), saves = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === `/api/lines/projects/${project.id}/canvas`) saves.push(request.url()); });
  const settle = async () => {
    await page.waitForFunction(() => window.openingTest?.ready());
    await page.locator("#projectLinesCover").waitFor({ state:"detached" });
    await page.keyboard.press("Escape");
    for (const closer of [page.getByRole("button", { name:"Skip tour" }), page.locator("#changelogLayer button").first()]) if (await closer.isVisible()) await closer.click();
  };
  await page.goto(address(source)); await settle();
  check("opens the saved camera even when launched from a picture", sameCamera(await camera(page), initial));
  const panel = page.locator("#projectLinesPanel"), toggle = page.getByRole("button", { name:"Notes & AI", exact:true });
  check("Notes & AI opens despite an old closed preference", await panel.isVisible() && await toggle.getAttribute("aria-expanded") === "true");
  await page.frameLocator("#projectLinesPanel iframe").getByRole("heading", { name:"Plan the forecast screen" }).waitFor();
  check("the default panel shows this canvas's line", true);

  for (const width of [1440, 900, 768, 390]) {
    await page.setViewportSize({ width, height:900 }); await wait(350);
    const layout = await page.evaluate(() => {
      const button = document.querySelector(".project-lines-panel-button"), rect = button.getBoundingClientRect(), bar = document.querySelector(".topbar").getBoundingClientRect();
      const peers = [...document.querySelectorAll(".topbar button, .topbar a")].filter(el => el !== button && !button.contains(el)).map(el => el.getBoundingClientRect()).filter(r => r.width && r.height && r.top < bar.bottom && r.bottom > bar.top && r.left >= 0 && r.right <= innerWidth)
        // On a phone the bar wraps onto more rows: the button is the last of its own row.
        .filter(r => r.top < rect.bottom && r.bottom > rect.top);
      return { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom, width:innerWidth, last:peers.every(r => r.right <= rect.left + 1), overflow:document.documentElement.scrollWidth > innerWidth };
    });
    check(`Notes & AI is visible at the far right at ${width}px`, layout.left >= 0 && layout.right <= width && layout.last && !layout.overflow);
    await page.screenshot({ path:path.join(shots, `opening-${width}.png`) });
    await toggle.focus(); await page.keyboard.press("Enter");
    check(`keyboard closes the panel in one activation at ${width}px`, !await panel.isVisible());
    await toggle.tap();
    check(`touch opens the panel in one activation at ${width}px`, await panel.isVisible());
  }
  await page.setViewportSize({ width:1440, height:900 }); await wait(300);
  const revision = await page.evaluate(() => window.openingTest.revision());
  const view = await page.locator("#viewport").boundingBox();
  await page.mouse.move(view.x + 220, view.y + 220);
  await page.mouse.wheel(120, -80);
  await page.locator("#canvasZoomIn").click();
  const moved = await camera(page);
  check("real pan and zoom controls change the camera", !sameCamera(moved, initial));
  check("navigation does not revise the canvas contents", await page.evaluate(() => window.openingTest.revision()) === revision);
  await toggle.click();
  await page.reload(); await settle();
  check("reload immediately after navigation restores the exact camera", sameCamera(await camera(page), moved));
  check("the panel opens again after being closed", await panel.isVisible());
  check("navigation and reload do not save the canvas contents", saves.length === 0);

  await page.goto(address(other)); await settle();
  check("another canvas has its own camera", sameCamera(await camera(page), { scale:.4, panX:-250, panY:-450 }));
  await page.goto(address(source)); await settle();
  check("returning to the first canvas restores its last view", sameCamera(await camera(page), moved));
  await page.locator("#canvasFitContents").click();
  const fitted = await camera(page);
  check("manual Fit All still works", !sameCamera(fitted, moved));
  await page.locator("#projectLinesRail iframe").waitFor();
  await page.frameLocator("#projectLinesRail iframe").locator(".rail-row.on .rail-name").click();
  await page.waitForURL(url => url.pathname === "/projects.html");
  await page.goto(address(source)); await settle();
  check("leaving through the project rail preserves the camera", sameCamera(await camera(page), fitted));
  await page.locator("#canvasZoomOut").click();
  const closedView = await camera(page);
  await page.close();
  const reopened = await context.newPage(); reopened.on("pageerror", error => errors.push(error.message));
  await reopened.goto(address(source));
  await reopened.waitForFunction(() => window.openingTest?.ready());
  check("closing and reopening the tab preserves its last view", sameCamera(await camera(reopened), closedView));
  await reopened.close();

  const topicsBefore = fs.readdirSync(path.join(docs, "lines")).filter(file => file.endsWith(".md")).sort();
  const blankSource = "files/blank/canvas.penecho.json", blankAddress = new URL(address(blankSource));
  blankAddress.searchParams.delete("linesDoc");
  const blankPage = await context.newPage(); blankPage.on("pageerror", error => errors.push(error.message));
  await blankPage.goto(blankAddress.href);
  await blankPage.waitForFunction(() => window.openingTest?.ready());
  const blankFile = path.join(docs, blankSource), topicsNow = () => JSON.stringify(fs.readdirSync(path.join(docs, "lines")).filter(file => file.endsWith(".md")).sort());
  const box = blankPage.frameLocator("#projectLinesPanel iframe").locator(".cmp-input").first();
  await box.waitFor();
  await wait(1500);
  check("a blank panel opens the new-line composer", (await blankPage.locator("#projectLinesPanel iframe").getAttribute("src")).endsWith("/newline"));
  check("opening a blank panel writes nothing to the folder", !fs.existsSync(blankFile));
  check("opening a blank panel creates no line or Ask", topicsNow() === JSON.stringify(topicsBefore));
  // What you write in it makes this Canvas's line, and the Canvas a file, then.
  await box.fill("Sketch the settings page");
  await box.press("Enter");
  await until(() => fs.existsSync(blankFile) && topicsNow() !== JSON.stringify(topicsBefore), "the blank Canvas's line", 10000);
  check("writing in a blank panel makes the Canvas a file and its line", true);
  await blankPage.close();
  check("no canvas page errors", errors.length === 0);
  await context.close();
  console.log(`${passed} checks passed. Screenshots: ${shots}`);
})().catch(error => { console.error(error); console.error(log.slice(-1500)); process.exitCode = 1; }).finally(async () => { await browser?.close(); server.kill(); });
