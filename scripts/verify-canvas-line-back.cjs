#!/usr/bin/env node
"use strict";
// Open a Canvas from an actual line/Work, then return using its header link.
// Uses canonical public files, isolated project data and a temporary local server.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-canvas-line-back.cjs [screenshot-folder]
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const F = require("../src/server/project-lines/format.js");
const { newBundle } = require("../src/server/project-lines/canvas-file.js");
const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-line-back-"));
const shots = path.resolve(process.argv[2] || path.join(temp, "shots"));
const docs = path.join(temp, "docs"), slug = "forecast-layout", source = `files/${slug}/canvas.penecho.json`;
const picture = `files/${slug}/canvas.png`, file = path.join(docs, source);
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
fs.mkdirSync(shots, { recursive:true });
fs.mkdirSync(path.dirname(file), { recursive:true });
fs.mkdirSync(path.join(docs, "lines", slug), { recursive:true });
const drawing = `![Weather cards](../${picture})`;
fs.writeFileSync(path.join(docs, "lines", `${slug}.md`), F.initialLine({ title:"Forecast layout", id:"BACK-1", status:"ready", steps:[
  F.askStep({ words:"Sketch the weather cards.", when:"2026-11-13 09:00" }),
  F.workStep({ who:"codex", done:true, took:"1 min", body:drawing }),
] }));
fs.writeFileSync(path.join(docs, "works", slug, "work-1.md"), F.initialDetail({ slug, title:"Forecast layout", label:"Work 1", who:"codex", started:"2026-11-13 09:00", now:drawing }));
const bundle = newBundle({ id:"forecast-canvas", name:"Weather cards" });
bundle.manifest.textBoxes = [{ id:"weather-title", x:1800, y:1800, w:420, h:100, maxWidth:420, fontSize:32, color:"#172033", text:"Weather cards" }];
bundle.assets.push({ kind:"preview", contentType:"image/png", metadata:{ width:1, height:1 }, dataBase64:png });
fs.writeFileSync(file, JSON.stringify(bundle));
fs.writeFileSync(path.join(docs, picture), Buffer.from(png, "base64"));
Object.assign(process.env, {
  NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOST:"127.0.0.1", PORT:"0",
  PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud"),
  PENECHO_CONFIG_FILE:path.join(temp, "config.env"), AI_PROVIDER:"api", AI_API_KEY:"test-only",
  AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false",
  CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent",
});
const server = require("../server.js");
let browser, passed = 0;
const errors = [], check = (label, value) => { assert.ok(value, label); console.log(`ok ${label}`); passed++; };
(async () => {
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listening ? resolve() : server.once("listening", resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
    const context = await browser.newContext({ viewport:{ width:1440, height:900 }, reducedMotion:"reduce", hasTouch:true });
    await context.route(/^https:\/\//, route => route.abort());
    // Observe readiness only; all editing and navigation use the normal UI.
    await context.route("**/app.js*", route => route.fulfill({ contentType:"application/javascript", body:fs.readFileSync(path.join(root, "public/app.js"), "utf8").replace(/\}\)\(\);\s*$/, 'window.lineBackTest={ready:()=>projectLinesRun.ready};})();') }));
    await context.addInitScript(() => { if (top === window && !localStorage.getItem("penecho-language")) localStorage.setItem("penecho-language", "en"); });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => errors.push(error.message));
    const made = await context.request.post(`${base}/api/lines/projects`, { headers:{ origin:base }, data:{ name:"Weather app", docsPath:docs } });
    assert.ok(made.ok(), await made.text());
    const { project } = await made.json();
    const lineHash = `${project.id}/line/${slug}/work-1`, lineUrl = `${base}/projects.html#${lineHash}`;
    const back = page.locator("[data-project-lines-link]");
    const openFromLine = async () => {
      await page.goto(lineUrl);
      await page.locator('#lpPanel [data-act="open-canvas"]').first().click();
      await page.waitForFunction(() => window.lineBackTest?.ready());
      for (const selector of ["#tourSkip", "#changelogClose"]) if (await page.locator(selector).isVisible()) await page.locator(selector).click();
      check("the actual line entry preserves its exact return route", new URL(page.url()).searchParams.get("linesBack") === lineHash);
    };
    const visibleBack = async label => {
      check(`${label}: Back to line is visible by default`, await back.isVisible());
      check(`${label}: its destination includes the selected Work`, await back.getAttribute("href") === `/projects.html#${lineHash}`);
      check(`${label}: it has an accessible name`, await back.getAttribute("aria-label") === "Back to line");
      check(`${label}: it is on screen and unobstructed`, await back.evaluate(el => {
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && el.contains(hit);
      }));
    };
    const returned = async label => {
      await page.waitForURL(lineUrl);
      await page.waitForSelector("#linePage");
      check(`${label}: one activation returns to the same line and Work`, await page.evaluate(() => window.__lines.S.route.line === "forecast-layout" && window.__lines.S.route.step === "work-1"));
    };

    await openFromLine();
    await visibleBack("desktop");
    check("desktop: the return link precedes the Canvas title", await back.evaluate(el => el.getBoundingClientRect().right <= document.querySelector("#canvasDocumentMeta").getBoundingClientRect().left));
    await page.screenshot({ path:path.join(shots, "desktop.png") });
    await page.locator(".project-lines-panel-button").click();
    await page.keyboard.press("p");
    await page.mouse.move(500, 350); await page.mouse.down();
    await page.mouse.move(640, 400, { steps:12 }); await page.mouse.up();
    await back.click(); await returned("mouse");
    check("returning saves the stroke in the project's Canvas", JSON.parse(fs.readFileSync(file, "utf8")).assets.some(asset => asset.kind === "tile"));

    await openFromLine();
    await page.locator("#projectLinesRailShow").isVisible().then(async visible => { if (!visible) await page.frameLocator("#projectLinesRail iframe").getByRole("button", { name:"Hide projects", exact:true }).click(); });
    await visibleBack("projects hidden");
    await page.reload(); await page.waitForFunction(() => window.lineBackTest?.ready());
    await visibleBack("reload");
    await back.focus(); await page.keyboard.press("Enter"); await returned("keyboard");

    await page.setViewportSize({ width:390, height:844 });
    await openFromLine();
    await visibleBack("phone");
    check("phone: the return target is at least 44 pixels", await back.evaluate(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }));
    await page.screenshot({ path:path.join(shots, "phone.png") });
    await page.setViewportSize({ width:320, height:844 });
    await visibleBack("320px");
    await back.tap(); await returned("touch");

    await page.setViewportSize({ width:1024, height:768 });
    await openFromLine(); await visibleBack("tablet");
    const headerFits = async () => {
      const controls = await page.evaluate(() => ["#shareCanvasBtn", "#canvasMoreBtn", ".project-lines-panel-button"].map(selector => {
        const el = document.querySelector(selector), r = el.getBoundingClientRect();
        return { selector, left:r.left, right:r.right, fits:r.left >= 0 && r.right <= innerWidth && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
      }));
      if (controls.some(control => !control.fits)) console.log("Header overflow:", JSON.stringify(controls));
      return controls.every(control => control.fits);
    };
    check("tablet: existing header actions remain on screen", await headerFits());
    await page.locator("#projectLinesRailShow").click();
    await page.waitForFunction(() => document.documentElement.classList.contains("project-lines-rail-open") && document.querySelector("#projectLinesRail").getBoundingClientRect().width === 58);
    await visibleBack("tablet with projects");
    await page.screenshot({ path:path.join(shots, "tablet.png") });
    check("tablet with projects: existing header actions remain on screen", await headerFits());
    await page.evaluate(() => localStorage.setItem("penecho-language", "zh"));
    await page.reload(); await page.waitForFunction(() => window.lineBackTest?.ready());
    check("Chinese: the return control is translated", await back.getAttribute("aria-label") === "返回工作线");

    const address = new URL(page.url());
    address.searchParams.set("linesBack", `${project.id}/files`);
    await page.goto(address.href); await page.waitForFunction(() => window.lineBackTest?.ready());
    check("Files retains its visible return link", await back.isVisible() && (await back.getAttribute("href")).endsWith(`#${project.id}/files`));
    address.searchParams.set("linesBack", project.id);
    await page.goto(address.href); await page.waitForFunction(() => window.lineBackTest?.ready());
    check("project-only navigation keeps the existing rail behavior", await back.isHidden());
    address.searchParams.set("linesBack", lineHash); address.searchParams.set("linesDraft", "1");
    await page.goto(address.href); await page.waitForFunction(() => window.lineBackTest?.ready());
    check("a drawing attachment still uses Done", await back.isVisible() && await back.getAttribute("aria-label") === "完成");
    check("no page errors", errors.length === 0);
    console.log(`${passed} checks passed. Screenshots: ${shots}`);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
