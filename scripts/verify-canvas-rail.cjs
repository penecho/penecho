#!/usr/bin/env node
"use strict";
// The Lines rail beside a project's Canvas, and PenEcho opened by itself. This checks them in a real browser:
// the rail is there and lists the projects, what is clicked in it saves the Canvas and goes there, it hides and comes back and remembers,
// the Canvas's own sidebar is gone, the pen lands where it is, "/" alone starts a new Canvas in My Canvases, and every other address is as it was.
//   NODE_PATH=/path/to/node_modules node scripts/verify-canvas-rail.cjs [folder for screenshots]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-canvas-rail-"));
const shots = process.argv[2] ? path.resolve(process.argv[2]) : path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
const PORT = 5400 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const docs = path.join(temp, "docs"), source = "files/canvases/canvas-1.penecho.json", file = path.join(docs, source);
const mineFolder = path.join(temp, "Documents", "PenEcho", "My Canvases");
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
const tilesIn = target => { try { return (fs.readFileSync(target, "utf8").match(/"kind":"tile"/g) || []).length; } catch { return 0; } };

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000);
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const errors = [];
  const open = async (context, address) => {
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(`${address}: ${e.message}`));
    await page.goto(address);
    return page;
  };
  // What greets a new browser on a Canvas is put away, so the Canvas itself can be used.
  const settle = async (page, ms = 2500) => {
    await page.waitForSelector("#viewport");
    await wait(ms);
    await page.keyboard.press("Escape");
    for (const closer of [page.getByRole("button", { name:"Skip tour" }), page.getByRole("button", { name:"跳过导览" }), page.locator("#changelogLayer button").first()]) if (await closer.isVisible().catch(() => false)) { await closer.click().catch(() => {}); await wait(300); }
  };
  const stroke = async (page, x, y, dx, dy, steps = 20) => {
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= steps; i++) { await page.mouse.move(x + dx * i / steps, y + dy * i / steps); await wait(8); }
    await page.mouse.up();
  };
  const post = async (context, address, data) => (await context.request.post(`${base}${address}`, { data, headers:{ origin:base } })).json();
  const left = (page, selector) => page.evaluate(s => { const el = document.querySelector(s); return el && el.getClientRects().length ? Math.round(el.getBoundingClientRect().left) : null; }, selector);
  const shown = (page, selector) => page.evaluate(s => { const el = document.querySelector(s); return Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden"); }, selector);
  const rail = page => page.frameLocator("#projectLinesRail iframe");

  const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
  const made = await post(context, "/api/lines/projects", { name:"Weather app", docsPath:docs });
  const id = made.project.id;
  const first = await post(context, `/api/lines/projects/${id}/yours`, { kind:"note", text:"Forecast screen layout\n\nThree cards across.", topic:"new" });
  const second = await post(context, `/api/lines/projects/${id}/yours`, { kind:"note", text:"Rain radar\n\nAnimate the frames.", topic:"new" });
  await post(context, "/api/lines/projects", { name:"Linear algebra", docsPath:path.join(temp, "docs2") });
  const canvasAddress = (extra = {}) => `${base}/?${new URLSearchParams({ linesProject:id, linesCanvas:source, linesTitle:"Canvas 1", linesBack:id, ...extra })}`;
  // The panel on the right starts closed here, so the Canvas is what is measured. It is opened for the pictures at the end.
  await context.addInitScript(() => { try { if (!localStorage.getItem("penecho-lines-panel")) localStorage.setItem("penecho-lines-panel", "0"); } catch { /* It only opens the panel. */ } });
  // The rail lists the lines opened last (and pinned ones). The second line was opened before this Canvas; the first is the line this Canvas is on.
  await context.addInitScript(({ id, slug }) => { try { if (!localStorage.getItem("penecho-line-opened-v1")) localStorage.setItem("penecho-line-opened-v1", JSON.stringify({ [id]:[slug] })); } catch { /* It only lists a line. */ } }, { id, slug:second.slug });

  console.log("\nThe rail beside a project's Canvas");
  let page = await open(context, canvasAddress({ linesDoc:`lines/${first.slug}.md` }));
  await settle(page);
  await rail(page).locator(".rail-row.on").waitFor({ timeout:15000 });
  const railWidth = await page.evaluate(() => Math.round(document.querySelector("#projectLinesRail").getBoundingClientRect().width));
  check("the rail is to the left of the Canvas, as wide as on the Projects page", railWidth === 280 && await rail(page).locator("#rail").evaluate(el => Math.round(el.getBoundingClientRect().width)) === 280, `${railWidth}px`);
  const names = await rail(page).locator(".rail-row .rail-name").allTextContents();
  check("it lists My Canvases and the projects", ["My Canvases", "Weather app", "Linear algebra"].every(name => names.includes(name)), names.join(", "));
  check("the project of this Canvas is open in it, with its newest lines", await rail(page).locator(".rail-row.on .rail-name").textContent() === "Weather app" && await rail(page).locator("#railList").evaluate(list => list.querySelector(".rail-row.on").closest(".rail-item").nextElementSibling.querySelectorAll(".rail-line[data-act='open-line']").length) === 2);
  check("the line this Canvas is on is marked", await rail(page).locator(".rail-line.on").count() === 1 && (await rail(page).locator(".rail-line.on .rail-title").textContent()).trim() === "Forecast screen layout", await rail(page).locator(".rail-line.on").allTextContents());
  check("only the rail is drawn in its frame", await rail(page).locator(".shell").evaluate(el => getComputedStyle(el).display) === "none" && await rail(page).locator("a.rail-canvas, a.brand").count() === 0);
  check("the Canvas's own sidebar and its button are not there", !await shown(page, "#studioNavigatorToggle") && !await shown(page, "#studioNavigator") && !await shown(page, "[data-project-lines-link]"));
  await page.evaluate(() => window.PenEchoStudioNavigator?.open?.("all"));
  await page.keyboard.press("Escape");
  check("nothing opens the old sidebar here", !await page.evaluate(() => document.body.classList.contains("studio-navigator-open")));
  const edges = { viewport:await left(page, "#viewport"), bar:await left(page, ".topbar"), tools:await left(page, ".primary-tools"), zoom:await left(page, "#canvasZoomControls") };
  check("the Canvas, its bar and its tools start where the rail ends", edges.viewport === railWidth && edges.bar === railWidth && edges.tools >= railWidth && edges.zoom >= railWidth, JSON.stringify(edges));
  check("Share, Collaborate and Notes & AI are where they were", await page.getByRole("button", { name:"Share" }).first().isVisible() && await page.getByRole("button", { name:"Collaborate" }).first().isVisible() && await shown(page, ".project-lines-panel-button"));

  console.log("\nThe pen beside the rail");
  await page.keyboard.press("p");
  // The first stroke puts the empty Canvas's welcome away. The second starts a few pixels from the rail.
  await stroke(page, railWidth + 420, 250, 200, 40);
  await wait(400);
  const clip = { x:railWidth, y:560, width:320, height:80 };
  const helper = await context.newPage();
  const inkBox = async () => {
    const png = (await page.screenshot({ clip })).toString("base64");
    return helper.evaluate(async data => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const pen = canvas.getContext("2d"); pen.drawImage(image, 0, 0);
      const pixels = pen.getImageData(0, 0, canvas.width, canvas.height).data;
      let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1, count = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) { const i = (y * canvas.width + x) * 4; if (pixels[i] + pixels[i + 1] + pixels[i + 2] < 300) { count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } }
      return { count, minX, maxX, minY, maxY };
    }, png);
  };
  await page.bringToFront();
  const clean = await inkBox();
  await stroke(page, railWidth + 8, 600, 200, 0);
  await wait(500);
  const ink = await inkBox();
  check("a stroke that starts beside the rail lands where the pen is", clean.count === 0 && ink.count > 100 && ink.minX <= 14 && ink.maxX >= 200 && ink.maxX <= 218 && ink.minY >= 30 && ink.maxY <= 50, `before ${JSON.stringify(clean)} after ${JSON.stringify(ink)}`);
  await helper.close();
  await page.screenshot({ path:path.join(shots, "rail-en-1440-panel-closed.png") });

  console.log("\nGoing somewhere from the rail");
  await stroke(page, railWidth + 300, 420, 260, 30);
  check("the last stroke is not in the folder yet", !fs.existsSync(file));
  await rail(page).locator(`.rail-line[data-line="${second.slug}"]`).click();
  await page.waitForURL(url => url.pathname === "/projects.html" && decodeURIComponent(url.hash) === `#${id}/line/${second.slug}`, { timeout:20000 });
  await page.waitForSelector("#linePage");
  check("a line in the rail opens that line", (await page.locator(".lp-head h1").first().textContent()).includes("Rain radar"), await page.locator(".lp-head h1").first().textContent());
  check("and the Canvas was saved first", tilesIn(file) >= 1, `${tilesIn(file)} tiles`);
  check("the Projects page has no link to a Canvas by itself", await page.locator("a.rail-canvas, a.bar-canvas, a.brand").count() === 0 && await page.locator(".rail .brand").count() === 1);
  await page.goto(canvasAddress());
  await settle(page, 1500);
  await rail(page).locator(".rail-mine .rail-row").click();
  await page.waitForURL(url => url.pathname === "/projects.html" && /\/canvases$/.test(url.hash), { timeout:20000 });
  await page.waitForSelector(".canvases-page");
  check("My Canvases in the rail opens My Canvases", (await page.locator(".canvases-page h2").first().textContent()).trim() === "My Canvases");
  await page.goto(canvasAddress());
  await settle(page, 1500);
  await rail(page).locator("[data-act='open-settings']").click();
  await page.waitForURL(url => url.pathname === "/projects.html" && url.hash === "#agents", { timeout:20000 });
  check("Settings in the rail opens Settings on Agents", await page.locator(".sysm #sysAgents").isVisible());
  await page.goBack();
  await page.waitForURL(url => url.searchParams.get("linesCanvas") === source, { timeout:20000 });
  check("Back comes back to the Canvas in one step", true);
  await settle(page, 1500);
  await rail(page).locator(".rail-row", { hasText:"Linear algebra" }).click();
  await page.waitForURL(url => url.pathname === "/projects.html" && url.hash.length > 1 && !url.hash.includes(id), { timeout:20000 });
  check("another project in the rail opens that project", (await page.title()).startsWith("Linear algebra"), await page.title());

  console.log("\nHiding the rail");
  await page.goto(canvasAddress());
  await settle(page, 1500);
  await rail(page).locator(".rail-hide").click();
  await until(() => page.evaluate(() => document.querySelector("#projectLinesRail").hidden), "the rail to hide");
  check("its own button hides it, and the Canvas takes the whole window", await left(page, "#viewport") === 0 && await page.locator("#projectLinesRail iframe").count() === 0 && await shown(page, "#projectLinesRailShow"));
  await page.screenshot({ path:path.join(shots, "rail-en-1440-hidden.png") });
  await page.reload();
  await settle(page, 1500);
  check("it is still hidden after a reload", await page.evaluate(() => document.querySelector("#projectLinesRail").hidden) && await left(page, "#viewport") === 0 && await shown(page, "#projectLinesRailShow"));
  await page.locator("#projectLinesRailShow").click();
  await rail(page).locator(".rail-row.on").waitFor({ timeout:15000 });
  check("the button on the Canvas brings it back", await left(page, "#viewport") === railWidth && !await shown(page, "#projectLinesRailShow"));
  await page.reload();
  await settle(page, 1500);
  await rail(page).locator(".rail-row.on").waitFor({ timeout:15000 });
  check("it is still shown after a reload", await left(page, "#viewport") === railWidth);
  const narrow = await browser.newContext({ viewport:{ width:800, height:900 } });
  const small = await open(narrow, canvasAddress());
  await settle(small);
  check("a narrow window starts without it", await small.evaluate(() => document.querySelector("#projectLinesRail").hidden) && await left(small, "#viewport") === 0 && await shown(small, "#projectLinesRailShow") && await small.evaluate(() => localStorage.getItem("penecho-lines-projects-hidden")) === null);
  await small.screenshot({ path:path.join(shots, "rail-en-800-start.png") });
  await narrow.close();

  console.log("\nA Canvas for the box");
  const box = await open(context, canvasAddress({ linesCanvas:"files/_incoming/drawing-x.penecho.json", linesDraft:"1" }));
  await settle(box, 1500);
  check("has no rail, and Done takes it back", await box.locator("#projectLinesRail").count() === 0 && await shown(box, "[data-project-lines-link]") && (await box.locator("[data-project-lines-label]").first().textContent()) === "Done");
  await box.close();

  console.log("\nPenEcho opened by itself");
  const fresh = await browser.newContext({ viewport:{ width:1440, height:900 } });
  const alone = await open(fresh, `${base}/`);
  await alone.waitForURL(url => Boolean(url.searchParams.get("linesCanvas")), { timeout:20000 });
  const landed = new URL(alone.url()), mine = landed.searchParams.get("linesProject"), blank = landed.searchParams.get("linesCanvas");
  await settle(alone);
  await rail(alone).locator(".rail-row.on").waitFor({ timeout:15000 });
  check("it lands on a new Canvas in My Canvases, with the rail", /^files\/[^/]+\/canvas\.penecho\.json$/.test(blank) && (await rail(alone).locator(".rail-row.on .rail-name").textContent()) === "My Canvases" && fs.existsSync(mineFolder), alone.url());
  check("nothing is written until something is drawn", !fs.existsSync(path.join(mineFolder, blank)));
  const once = await open(fresh, `${base}/`);
  await once.waitForURL(url => Boolean(url.searchParams.get("linesCanvas")), { timeout:20000 });
  check("opened again with nothing drawn, it is the same blank Canvas", new URL(once.url()).searchParams.get("linesCanvas") === blank, once.url());
  await once.close();
  await alone.bringToFront();
  await alone.keyboard.press("p");
  // Above the eight example cards, which take a press as a click.
  await stroke(alone, 700, 120, 300, 40);
  await until(() => fs.existsSync(path.join(mineFolder, blank)), "the Canvas in My Canvases", 9000).catch(() => {});
  check("its first stroke is kept in My Canvases", tilesIn(path.join(mineFolder, blank)) >= 1);
  await alone.screenshot({ path:path.join(shots, "alone-en-1440.png") });
  const next = await open(fresh, `${base}/`);
  await next.waitForURL(url => Boolean(url.searchParams.get("linesCanvas")), { timeout:20000 });
  check("opened again after that, it is another new Canvas", new URL(next.url()).searchParams.get("linesProject") === mine && new URL(next.url()).searchParams.get("linesCanvas") !== blank, next.url());
  // The tab that drew it had that Canvas in front. Opened by itself again, it does not bring a loose copy of it back.
  await wait(6500);
  await alone.goto(`${base}/`);
  await alone.waitForURL(url => Boolean(url.searchParams.get("linesCanvas")), { timeout:20000 }).catch(() => {});
  check("and in the tab that drew the first one too", new URL(alone.url()).searchParams.get("linesCanvas") === new URL(next.url()).searchParams.get("linesCanvas"), alone.url());
  await fresh.close();

  console.log("\nEvery other way the Canvas page is opened");
  // The page as it was: no rail, its own sidebar and button, PenEcho Lines over the empty Canvas, and the address untouched.
  const asBefore = async (target, address) => {
    const sidebar = await shown(target, "#studioNavigatorToggle");
    await target.locator("#studioNavigatorToggle").click().catch(() => {});
    const opens = await until(() => target.evaluate(() => document.body.classList.contains("studio-navigator-open")), "the sidebar", 4000).catch(() => false);
    return { ok:target.url() === address && sidebar && opens && await target.locator("#projectLinesRail").count() === 0 && !await target.evaluate(() => document.documentElement.classList.contains("project-lines-railed")), url:target.url(), sidebar, opens };
  };
  for (const [name, query] of [["?session=x", "?session=x"], ["a share-style address", "?share=5f0c2a1e"], ["any other parameter", "?renderTiming=0"]]) {
    const other = await browser.newContext({ viewport:{ width:1440, height:900 } });
    const plain = await open(other, `${base}/${query}`);
    await settle(plain);
    const lines = await shown(plain, "#projectLinesEntry");
    const was = await asBefore(plain, `${base}/${query}`);
    check(`${name} is the page it always was`, was.ok && lines, JSON.stringify({ ...was, lines }));
    await other.close();
  }
  // A browser that keeps a draft of the plain Canvas: "/" stays the plain Canvas, in the tab that drew it and in a new one.
  const kept = await browser.newContext({ viewport:{ width:1440, height:900 } });
  const drafting = await open(kept, `${base}/?session=x`);
  await settle(drafting);
  await drafting.keyboard.press("p");
  // Between the start page's cards, where a stroke starts drawing.
  await stroke(drafting, 300, 495, 300, 6);
  await wait(2500);
  check("a stroke on the plain Canvas is a draft there", await drafting.evaluate(() => document.querySelector("#canvasWelcome").hidden));
  await drafting.goto(`${base}/`);
  await settle(drafting);
  const sameTab = await asBefore(drafting, `${base}/`);
  check("with a draft kept in the browser, / is still the plain Canvas", sameTab.ok, JSON.stringify(sameTab));
  const newTab = await open(kept, `${base}/`);
  await settle(newTab);
  const inNewTab = await asBefore(newTab, `${base}/`);
  check("and in a new tab of that browser too, with the draft among its open Canvases", inNewTab.ok && await until(async () => await newTab.locator("#studioNavigatorOpenList .studio-navigator-open-canvas:not([aria-current])").count() >= 1, "the draft in the sidebar", 5000).catch(() => false), `${JSON.stringify(inNewTab)} ${await newTab.locator("#studioNavigatorOpenList").innerHTML().catch(() => "")}`);
  await kept.close();

  console.log("\nHow it looks");
  for (const [lang, width] of [["en", 1440], ["zh", 1440], ["en", 900], ["zh", 900]]) {
    const look = await browser.newContext({ viewport:{ width, height:900 } });
    await look.addInitScript(lang => { try { if (lang === "zh") localStorage.setItem("penecho-language", "zh"); } catch { /* English then. */ } }, lang);
    const seen = await open(look, canvasAddress({ linesDoc:`lines/${first.slug}.md` }));
    await settle(seen, 3000);
    await seen.screenshot({ path:path.join(shots, `rail-${lang}-${width}-panel-open.png`) });
    if (lang === "zh") check(`the button that brings the rail back is in Chinese (${width})`, await seen.locator("#projectLinesRailShow").getAttribute("title") === "显示项目");
    await seen.locator(".project-lines-panel-button").click();
    await wait(500);
    await seen.screenshot({ path:path.join(shots, `rail-${lang}-${width}-panel-closed.png`) });
    const overlap = await seen.evaluate(() => {
      const box = s => { const el = document.querySelector(s); return el && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" ? el.getBoundingClientRect() : null; };
      const railBox = box("#projectLinesRail"), parts = ["#viewport", ".topbar", ".primary-tools", "#canvasZoomControls", "#aiToolsSection"].map(box).filter(Boolean);
      const tools = box(".primary-tools"), zoom = box("#canvasZoomControls"), hit = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      return { underRail:railBox ? parts.filter(p => p.left < railBox.right - 0.5).length : 0, toolsOnZoom:hit(tools, zoom) };
    });
    check(`nothing sits under the rail, and the tools do not cover each other (${lang}, ${width})`, overlap.underRail === 0 && !overlap.toolsOnZoom, JSON.stringify(overlap));
    await look.close();
  }

  check("no page had an error", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  console.log(`Screenshots: ${shots}`);
  if (failures.length) { console.log(failures.map(f => ` - ${f}`).join("\n")); process.exitCode = 1; }
})().catch(error => { console.error(error); console.log(serverLog.slice(-1500)); process.exitCode = 1; }).finally(() => { server.kill(); try { fs.rmSync(path.join(temp, "state"), { recursive:true, force:true }); } catch { /* A temp folder. */ } });
