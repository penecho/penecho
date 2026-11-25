"use strict";
// PE-539: an agent sees what the person sees on an open Canvas with one call (GET /api/draw?view=1), answered by the real page.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-view-picture-"));
const output = process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || temporary;
fs.mkdirSync(output, { recursive:true });
Object.assign(process.env, {
  NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOST:"127.0.0.1", PORT:"0",
  PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temporary, "cloud"),
  PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), AI_PROVIDER:"api", AI_API_KEY:"test-only",
  AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false",
});
const server = require("../server.js");
let browser;
(async () => {
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listening ? resolve() : server.once("listening", resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const made = await fetch(`${base}/api/lines/projects`, { method:"POST", headers:{ origin:base, "content-type":"application/json" }, body:JSON.stringify({ name:"View check", docsPath:path.join(temporary, "docs") }) });
    const madeText = await made.text();
    assert.ok(made.ok, madeText);
    const { project } = JSON.parse(madeText);
    const { token } = JSON.parse(fs.readFileSync(path.join(temporary, "state", "penecho-draw.json"), "utf8"));
    const headers = { "x-penecho-token":token };
    const form = new FormData();
    form.append("project", project.id);
    form.append("file", new Blob([JSON.stringify({ type:"workflow", title:"Seen", nodes:[{ id:"s", label:"Start", type:"start" }, { id:"e", label:"Done", type:"end" }], edges:[{ from:"s", to:"e" }] })]), "seen.diagram.json");
    const drawn = await (await fetch(`${base}/api/draw`, { method:"POST", headers, body:form })).json();
    assert.ok(drawn.path, JSON.stringify(drawn));

    const closed = await (await fetch(`${base}/api/draw?view=1`, { headers })).json();
    assert.equal(closed.png, "", "no page open yet");

    browser = await chromium.launch({ headless:true, channel:"chrome" });
    const page = await browser.newPage({ viewport:{ width:1280, height:800 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https:\/\//, route => route.abort());
    await page.goto(`${base}/?${new URLSearchParams({ linesProject:project.id, linesCanvas:drawn.path, linesTitle:"Seen", linesBack:project.id })}`, { waitUntil:"domcontentloaded" });
    await page.waitForTimeout(6000);
    const started = Date.now();
    const seen = await (await fetch(`${base}/api/draw?view=1`, { headers })).json();
    const took = Date.now() - started;
    console.log(JSON.stringify({ seen, took, errors }, null, 2));
    assert.ok(seen.png, seen.why || "a picture");
    assert.equal(fs.readFileSync(seen.png).subarray(1, 4).toString(), "PNG");
    assert.equal(seen.project, project.id);
    assert.ok(seen.box.w > 0 && seen.box.h > 0);
    assert.ok(took < 6000, "answered on the page's next look");
    fs.copyFileSync(seen.png, path.join(output, "view.png"));
    await page.screenshot({ path:path.join(output, "page.png") });
    console.log(`ok: view picture in ${took} ms, ${path.join(output, "view.png")}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server.close();
    setTimeout(() => process.exit(), 200).unref();
  }
})();
