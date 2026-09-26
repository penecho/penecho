"use strict";
// Isolated browser acceptance; runtime hooks exist only in the test response.
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || "playwright");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-canvas-hints-"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(directory,"state"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" });
const server = require("../server.js");
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listening ? resolve() : server.once("listening",resolve));
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:1440,height:900}}), errors = [], checks = [];
    page.on("pageerror", error => errors.push(error.message));
    const source = fs.readFileSync(path.resolve(__dirname,"../public/app.js"),"utf8")
      .replace(/\}\)\(\);\s*$/, "window.hintTest={showCanvasHint,renderCanvasHint,setNavigating,keyboardShortcutCanvasHint,setCanvasNavigationLocked,state,applyLanguage};})();");
    await page.route("**/app.js", route => route.fulfill({contentType:"application/javascript",body:source}));
    await page.addInitScript(() => { if (window.top === window) localStorage.setItem("penecho-language","en"); });
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:"networkidle"});
    await page.waitForSelector("body[data-shell-dock-layout]");
    async function showHints() {
      await page.evaluate(() => {
        hintTest.showCanvasHint("canvasHintHand");
        const notice = document.querySelector("#mcpCanvasNotice");
        notice.hidden = false;
        document.querySelector("#mcpActivityLabel").textContent = "Codex added 3 items to Roadmap Q4";
        const button = document.querySelector("#mcpShowNewContent");
        button.hidden = false; button.textContent = "3 new · Open";
      });
      await page.waitForTimeout(100);
    }
    for (const [name,width,nav,agent] of [["wide",1440,false,false],["navigator",1440,true,false],["both",1440,true,true],["agent",1440,false,true],["compact",1100,false,true],["narrow",760,false,false]]) {
      await page.setViewportSize({width,height:900});
      for (const [id,open] of [["studioNavigatorToggle",nav],["canvasAgentToggle",agent]]) {
        if ((await page.locator(`#${id}`).getAttribute("aria-expanded") === "true") !== open) await page.locator(`#${id}`).click();
      }
      await page.waitForTimeout(450);
      await showHints();
      const geometry = await page.evaluate(() => {
        const rect = selector => { const r=document.querySelector(selector).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,center:r.x+r.width/2}; };
        return {layout:document.body.dataset.shellDockLayout,view:rect("#viewport"),dock:rect(".primary-tools"),hint:rect("#canvasHint"),mcp:rect("#mcpCanvasNotice"),hintVisible:getComputedStyle(document.querySelector("#canvasHint")).visibility};
      });
      assert.ok(Math.abs(geometry.hint.center-geometry.dock.center)<1,`${name}: hint follows dock center`);
      assert.ok(Math.abs(geometry.mcp.center-geometry.view.center)<1,`${name}: MCP follows visible canvas center`);
      assert.ok(Math.abs(geometry.mcp.y-geometry.view.y-16)<1,`${name}: MCP stays at canvas top`);
      assert.ok(geometry.hint.bottom<geometry.dock.y,`${name}: hint clears dock`);
      if (geometry.layout !== "rows") assert.ok(Math.abs(geometry.dock.y-geometry.hint.bottom-12)<1,`${name}: hint sits twelve pixels above dock`);
      assert.equal(geometry.hintVisible,"visible");
      checks.push({name,...geometry});
      await page.screenshot({path:path.join(directory,`${name}.png`)});
    }
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(350); await showHints();
    const mobile=await page.locator("#mcpCanvasNotice").boundingBox();
    const mobileView=await page.locator("#viewport").boundingBox();
    const mobileToolbar=await page.locator(".topbar .toolbar").boundingBox();
    assert.ok(Math.abs(mobile.y-Math.max(mobileView.y,mobileToolbar.y+mobileToolbar.height)-64)<1,"mobile MCP clears the top toolbar and corner actions");
    await page.screenshot({path:path.join(directory,"mobile.png")});
    await page.setViewportSize({width:1440,height:900});
    await page.waitForTimeout(350);
    for (const language of ["en", "zh"]) {
      await page.evaluate(language => { hintTest.state.language=language;hintTest.applyLanguage(); }, language);
      for (const example of ["hand", "agent", "locked"]) {
        await page.evaluate(example => {
          hintTest.setCanvasNavigationLocked(example === "locked");
          if (example === "agent") hintTest.showCanvasHint(hintTest.keyboardShortcutCanvasHint("focus-agent", "canvasHintShortcutAgent"));
          else hintTest.showCanvasHint("canvasHintHand");
        }, example);
        await page.waitForTimeout(50);
        const hint=page.locator(example === "locked" ? "#canvasNavigationLockHint" : "#canvasHint");
        assert.equal(await hint.isVisible(),true);
        assert.doesNotMatch(await hint.textContent(),/^(Hint|提示):/);
        if (example === "agent") assert.equal(await hint.locator("kbd").textContent(),"Tab");
        const style=await hint.evaluate(node => { const css=getComputedStyle(node);return {shadow:css.boxShadow,border:css.borderTopWidth,radius:css.borderRadius}; });
        assert.deepEqual(style,{shadow:"none",border:"0px",radius:"999px"});
        await page.screenshot({path:path.join(directory,`hint-${example}-${language}.png`)});
      }
    }
    await page.evaluate(() => { hintTest.setCanvasNavigationLocked(false);hintTest.state.language="en";hintTest.applyLanguage(); });
    await page.evaluate(() => { document.querySelector("#mcpCanvasNotice").hidden=true; hintTest.setNavigating(true); hintTest.showCanvasHint("canvasHintHand"); });
    await page.waitForTimeout(50);
    assert.equal(await page.locator("#canvasHint").isVisible(),true,"tool hint takes priority over generic navigation guidance");
    await page.waitForTimeout(2950);
    await page.evaluate(() => hintTest.showCanvasHint("canvasHintHandAlt"));
    await page.waitForTimeout(2200);
    assert.equal(await page.locator("#canvasHint").isVisible(),true,"previous timer cannot hide the next hint");
    await page.waitForTimeout(3000);
    assert.equal(await page.locator("#canvasHint").isVisible(),false,"next hint expires after five seconds");
    await page.evaluate(() => hintTest.renderCanvasHint(false));
    assert.equal(await page.locator("#canvasHint").isVisible(),false,"localization refresh cannot resurrect an expired hint");
    await page.evaluate(() => hintTest.showCanvasHint("canvasHintHand"));
    assert.equal(await page.locator("#canvasHint").isVisible(),true,"another hint appears after expiry");
    await page.waitForTimeout(5200);
    assert.equal(await page.locator("#canvasHint").isVisible(),false,"each new hint gets its own five seconds");
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify({checks,timers:"passed",errors},null,2));
    console.log(JSON.stringify({directory,layouts:checks.length+1,timers:"passed",errors}));
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().then(() => process.exit(0), error => { console.error(error);process.exit(1); });
