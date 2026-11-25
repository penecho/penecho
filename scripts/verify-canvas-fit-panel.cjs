"use strict";
// Exercise the real Fit button and project line panel with isolated local data.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const root = path.resolve(__dirname, ".."), baseline = process.argv.includes("--baseline");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-fit-panel-"));
const output = process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || temporary;
fs.mkdirSync(output, { recursive:true });
Object.assign(process.env, {
  NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOST:"127.0.0.1", PORT:"0",
  PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temporary, "cloud"),
  PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), AI_PROVIDER:"api", AI_API_KEY:"test-only",
  AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false",
});
let client = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
if (baseline) {
  const start = client.indexOf("  function canvasFitViewportSize()"), end = client.indexOf("  function fitCanvasContents()", start);
  assert.ok(start > 0 && end > start);
  client = client.slice(0, start) + "  function canvasFitViewportSize() { const {width,height}=canvasViewportMetrics(); return {width,height}; }\n" + client.slice(end);
}
client = client.replace(/\}\)\(\);\s*$/, `
  window.fitPanelTest={state,canvasDocumentsReady,loadCanvasSettings,restoreWidgets,render,
    ready:()=>projectLinesRun.ready,
    read(){const metrics=canvasViewportMetrics(),box=widgetBounds();return {
      scale:state.scale,width:metrics.width,height:metrics.height,box,
      content:{left:state.panX+box.x*state.scale,top:state.panY+box.y*state.scale,
        right:state.panX+(box.x+box.w)*state.scale,bottom:state.panY+(box.y+box.h)*state.scale},
      panel:canvasElementLayoutRect(document.querySelector('#projectLinesPanel:not([hidden])')),
      widgets:state.widgets.map(w=>[w.x,w.y,w.w,w.h]),
    };}};
})();`);
const server = require("../server.js");
const report = { baseline, checks:[], samples:[], errors:[] };
let browser;
(async () => {
  try {
    await new Promise((resolve,reject) => { server.once("error",reject); server.listening ? resolve() : server.once("listening",resolve); });
    browser = await chromium.launch({ headless:true, channel:"chrome" });
    const page = await browser.newPage({ viewport:{width:1440,height:900}, hasTouch:true });
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => report.errors.push(error.message));
    await page.route(/^https:\/\//, route => route.abort());
    await page.route("**/app.js*", route => route.fulfill({contentType:"application/javascript",body:client}));
    const base = `http://127.0.0.1:${server.address().port}`;
    const made = await page.request.post(`${base}/api/lines/projects`, {
      headers:{origin:base}, data:{name:"Fit panel check",docsPath:path.join(temporary,"docs")},
    });
    assert.ok(made.ok(), await made.text());
    const { project } = await made.json();
    await page.goto(`${base}/?${new URLSearchParams({linesProject:project.id,linesCanvas:"files/canvases/fit.penecho.json",linesTitle:"Fit check",linesBack:project.id})}`, {waitUntil:"domcontentloaded"});
    await page.waitForFunction(() => window.fitPanelTest?.ready());
    await page.evaluate(async () => {
      const t=fitPanelTest;await t.canvasDocumentsReady();await t.loadCanvasSettings();
      document.querySelector("#tourSkip")?.click();document.querySelector("#changelogClose")?.click();
      t.state.auto=false;
      t.restoreWidgets([{id:"fit-check",pluginId:"general",widgetType:"html_widget",title:"Fit check",
        x:2000,y:2000,w:1800,h:900,contentW:1800,contentH:900,refreshSeconds:0,
        html:`<!doctype html><style>html,body{margin:0;height:100%;background:#edf5f4;font:48px system-ui;color:#193e38}body{box-sizing:border-box;border:12px solid #2c7065;padding:60px;display:flex;justify-content:space-between;align-items:center}strong{max-width:40%}</style><strong>Left edge<br>All content fits</strong><strong>Right edge<br>Must stay visible</strong>`}]);
      document.querySelector("#canvasWelcome").hidden=true;t.render();
    });
    await page.waitForFunction(() => fitPanelTest.state.widgets[0]?.hostReady);
    const checkFit = async (name, activation="click") => {
      const button=page.locator("#canvasFitContents");
      if (activation==="keyboard") { await button.focus(); await page.keyboard.press("Enter"); }
      else if (activation==="touch") await button.tap();
      else await button.click();
      await page.waitForTimeout(200);
      const sample=await page.evaluate(() => fitPanelTest.read());
      report.samples.push({name,...sample});
      await page.screenshot({path:path.join(output,`${name}.png`)});
      const available=sample.panel ? Math.min(sample.width,sample.panel.left) : sample.width;
      if (baseline) { assert.ok(sample.content.right>available,"baseline reproduces content covered by the panel"); return sample; }
      assert.ok(sample.content.left>=63.5 && sample.content.right<=available-63.5,`${name}: horizontal padding and panel clearance`);
      assert.ok(sample.content.top>=63.5 && sample.content.bottom<=sample.height-63.5,`${name}: vertical padding`);
      assert.ok(Math.abs((sample.content.left+sample.content.right)/2-available/2)<.5,`${name}: centered in visible width`);
      assert.ok(Math.abs((sample.content.top+sample.content.bottom)/2-sample.height/2)<.5,`${name}: vertically centered`);
      assert.deepEqual(sample.widgets,[[2000,2000,1800,900]],`${name}: document geometry retained`);
      report.checks.push(name);return sample;
    };
    await page.locator("#projectLinesPanel").waitFor({state:"visible"});
    const open=await checkFit(baseline ? "baseline-panel-open" : "desktop-panel-open");
    if (baseline) return;
    const toggle=page.locator(".project-lines-panel-button");
    await toggle.click();
    const closed=await checkFit("desktop-panel-closed");
    assert.ok(closed.scale>open.scale,"closing the panel gives Fit more usable space");
    await toggle.click();await checkFit("desktop-panel-reopened","keyboard");
    await page.setViewportSize({width:1024,height:768});await checkFit("tablet-panel-open","touch");
    await toggle.click();
    await page.setViewportSize({width:390,height:700});await checkFit("narrow-panel-closed","touch");
    await page.evaluate(() => {document.documentElement.style.zoom="1.25";});
    await page.setViewportSize({width:1440,height:900});await toggle.click();await checkFit("scaled-panel-open");
    assert.deepEqual(report.errors,[]);
  } catch (error) {report.failure=error.stack;process.exitCode=1;}
  finally {
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
    console.log(JSON.stringify({output,...report},null,2));
    await browser?.close();server.closeAllConnections();await new Promise(resolve => server.close(resolve));
    if (output!==temporary) fs.rmSync(temporary,{recursive:true,force:true});
  }
})();
