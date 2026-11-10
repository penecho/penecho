"use strict";
// Exercise the built Canvas in an isolated browser with recoverable status
// failures. No user Canvas, account session or upstream inference is used.
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const root = path.resolve(__dirname, ".."), cloud = process.argv.includes("--cloud");
const clientRoot = cloud ? path.resolve(root, "../penecho_cloud/public/canvas") : path.join(root, "public");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "suggest-status-recovery-"));
const output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9)
  || path.join(root, "docs/verification/suggest-status-recovery-20261006", cloud ? "cloud" : "local"));
fs.mkdirSync(output, { recursive:true });
Object.assign(process.env, {
  NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"),
  PENECHO_CLOUD_STATE_DIR:path.join(temporary, "cloud"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"),
  HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1",
  AI_API_MODEL:"test", PENECHO_JEVISION_ENABLED:"false", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false",
});
const server = require("../server.js");
const injection = `
  markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);markChangelogSeen();
  if (${cloud}) Object.assign(window.PENECHO_CONFIG, {runtime:'cloud',connectionAccountId:'test-only'});
  window.statusRecovery = {state,smartSuggest,penIntel,canvasDocumentsReady,loadCanvasSettings,stroke,save,render,
    smartSuggestDrawingStarted,smartSuggestDrawingFinished};
  statusRecovery.begin = (x,y) => {
    state.drawing = {start:{x,y},last:{x,y},bbox:{x,y,w:100,h:60},size:5,color:'#202938',samples:[]};
    smartSuggestDrawingStarted(state.drawing);
  };
  statusRecovery.finish = () => {
    const d=state.drawing,p=d.start,points=[p,{x:p.x+35,y:p.y+60},{x:p.x+65,y:p.y+5},{x:p.x+100,y:p.y+55}];
    for(let i=1;i<points.length;i++)stroke(points[i-1],points[i],false,5,true,d.color);
    d.samples=points.map(point=>({point,size:5}));state.drawing=null;save();smartSuggestDrawingFinished(d);render();
  };
`;
const app = fs.readFileSync(path.join(clientRoot, "app.js"), "utf8").replace(/\}\)\(\);\s*$/, injection + "})();");
const allowance = { signedIn:true, subscribed:true, remaining:null, reason:null };
const ranking = { ok:true, access:allowance, answers:{
  kind:{type:"choice",choice:"notes",probabilities:{notes:1}},
  action:{type:"choice",choice:"answer",probabilities:{answer:1}}, execution_answer:{type:"choice",choice:"canvas_ai"},
} };
const failures = ["http-503", "http-401", "unconfigured", "network"];
(async () => {
  let browser;
  const report = { runtime:cloud ? "cloud-mirror" : "local", mockedStatusAndInference:true, checks:[] };
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listening ? resolve() : server.once("listening", resolve); });
    browser = await chromium.launch({ headless:true });
    for (const failure of failures) {
      const context = await browser.newContext({ viewport:{width:1440,height:900} });
      const page = await context.newPage(), statusRequests = [], ranks = [], errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route(/^https:\/\//, route => route.abort());
      await page.route("**/app.js*", route => route.fulfill({ contentType:"application/javascript", body:app }));
      await page.route("**/suggest/status", async route => {
        statusRequests.push({ at:Date.now(), refresh:route.request().headers()["x-penecho-suggest-refresh"] === "1" });
        if (statusRequests.length <= 2) {
          if (failure === "network") return route.abort();
          const status = failure === "unconfigured" ? 200 : Number(failure.slice(5));
          return route.fulfill({ status, contentType:"application/json", body:JSON.stringify({configured:false,access:allowance}) });
        }
        return route.fulfill({ contentType:"application/json", body:JSON.stringify({configured:true,access:allowance}) });
      });
      await page.route("**/suggest", async route => {
        ranks.push({ at:Date.now(), mode:route.request().postDataJSON().mode });
        return route.fulfill({ contentType:"application/json", body:JSON.stringify(ranking) });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil:"domcontentloaded" });
      await page.waitForFunction(() => window.statusRecovery && statusRecovery.smartSuggest.availability.checkedAt
        && !statusRecovery.smartSuggest.availability.pending);
      await page.evaluate(async () => {
        const t=statusRecovery;await t.canvasDocumentsReady();await t.loadCanvasSettings();
        document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();
        Object.assign(t.state,{auto:false,mode:'pen',scale:1,panX:0,panY:0});
        t.smartSuggest.enabled=true;t.penIntel.settings.gestures=false;t.penIntel.settings.stepCheck=false;
      });
      assert.equal(statusRequests.length, 1);
      await page.evaluate(() => { statusRecovery.begin(300,240); statusRecovery.finish(); });
      await page.waitForTimeout(350);
      assert.equal(statusRequests.length, 1, "pen-up debounce must precede recovery");
      await page.waitForFunction(() => statusRecovery.smartSuggest.availability.failures
        || statusRecovery.smartSuggest.availability.authRequired || statusRecovery.smartSuggest.availability.nextAt > Date.now());
      await page.waitForTimeout(600);
      assert.equal(statusRequests.length, 2, "one due Suggest must retry the failed initialization");
      assert.equal(statusRequests[1].refresh, true);
      assert.equal(ranks.length, 0);
      assert.equal(await page.locator('.assist-bar[data-mode="suggest"]').isVisible(), true);
      await page.waitForTimeout(300);
      assert.equal(statusRequests.length, 2, "failed status must not poll while idle");
      await page.locator('.assist-spark').click();
      await page.screenshot({ path:path.join(output, failure + "-local.png") });
      await page.evaluate(() => { statusRecovery.begin(500,320); statusRecovery.finish(); });
      await page.waitForFunction(() => statusRecovery.smartSuggest.bar?.view?.source === 'penecho-llm');
      assert.equal(statusRequests.length, 3);
      assert.equal(statusRequests[2].refresh, true);
      assert.equal(ranks.length, 1, "recovery must continue into ranking without another input");
      assert.equal(ranks[0].mode, "ink");
      assert.ok(statusRequests[2].at - statusRequests[1].at < 5000, "new input must bypass the old cooldown");
      assert.equal(await page.locator('.assist-bar[data-rank="ranked"]').isVisible(), true);
      assert.equal(await page.locator('#changelogLayer').isVisible(), false);
      assert.deepEqual(errors, []);
      if (await page.locator('.assist-spark').getAttribute('aria-expanded') === 'false') await page.locator('.assist-spark').click();
      await page.screenshot({ path:path.join(output, failure + "-recovered.png") });
      report.checks.push({failure,statusRequests:statusRequests.length,inferenceRequests:ranks.length,
        recoveryMs:statusRequests[2].at-statusRequests[1].at,localHelpPreserved:true,noIdlePolling:true,ranked:true});
      await context.close();
    }
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser?.close();server.closeAllConnections();await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive:true, force:true });
  }
})().catch(error => { console.error(error);process.exitCode=1; });
