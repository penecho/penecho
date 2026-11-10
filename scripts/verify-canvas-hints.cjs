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
    page.on("pageerror", error => { errors.push(error.message);console.error(error.stack); });
    const source = fs.readFileSync(path.resolve(__dirname,"../public/app.js"),"utf8")
      .replace(/\}\)\(\);\s*$/, "window.hintTest={showCanvasHint,renderCanvasHint,setNavigating,keyboardShortcutCanvasHint,setCanvasNavigationLocked,state,applyLanguage,showAutoDelayControl,hideAutoDelayControl,showEffortControl,hideEffortControl};})();");
    await page.route(/^https:\/\//, route => route.abort());
    await page.route("**/app.js*", route => route.fulfill({contentType:"application/javascript",body:source}));
    await page.addInitScript(() => { if (window.top === window) localStorage.setItem("penecho-language","en"); });
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:"domcontentloaded"});
    await page.waitForFunction(() => Boolean(window.hintTest)).catch(async error => {
      console.error(JSON.stringify(await page.evaluate(() => ({url:location.href,title:document.title,scripts:[...document.scripts].map(s=>s.src),body:document.body.innerText.slice(0,500)}))));
      throw error;
    });
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
    const hint = page.locator("#canvasHint"), popovers = [];
    for (const width of [1440, 760, 390]) {
      await page.setViewportSize({width,height:900});
      await page.locator("#eraserToolBtn").click();
      await page.locator("#eraserAreaBtn").click();
      await page.evaluate(() => hintTest.showCanvasHint("canvasHintAreaEraser"));
      assert.equal(await page.locator("#eraserToolMenu").isVisible(),true);
      assert.equal(await hint.isVisible(),false,`${width}: eraser menu suppresses its tool hint`);
      await page.screenshot({path:path.join(directory,`eraser-open-${width}.png`)});
      await page.keyboard.press("Escape");
      assert.equal(await hint.isVisible(),true,`${width}: Escape resumes the latest hint`);
      assert.equal(await hint.textContent(),"Drag a box to erase ink inside.");
      await page.screenshot({path:path.join(directory,`eraser-closed-${width}.png`)});
      popovers.push(`eraser-${width}`);
    }
    await page.setViewportSize({width:1440,height:900});
    await page.locator("#eraserToolBtn").click();
    await page.waitForTimeout(5200);
    assert.equal(await page.locator("#eraserToolMenu").isVisible(),false,"eraser menu closes on its own timeout");
    assert.equal(await hint.isVisible(),true,"hint starts after the menu timeout rather than expiring behind it");
    await page.locator("#penToolBtn").click();
    await page.locator('[data-color-control="ink"] .color-orb-trigger').click();
    await page.evaluate(() => hintTest.showCanvasHint("canvasHintHand"));
    await page.waitForTimeout(5200);
    assert.equal(await hint.isVisible(),false,"hint stays deferred while a color panel remains open");
    await page.evaluate(() => hintTest.showCanvasHint("canvasHintHandAlt"));
    await page.locator('[data-color-control="ink"] .color-orb-trigger').click();
    assert.equal(await hint.isVisible(),true);
    assert.equal(await hint.locator("kbd").textContent(),"Space","the newest deferred hint replaces the previous one");
    for (const [trigger,panel] of [
      ['[data-color-control="ai"] .color-orb-trigger',"#aiColorPopover"],
      ["#penSizeTrigger","#penSizePopover"],
      ["#assistToolsBtn",'#smartSuggestLayer > .assist-bar[data-mode="tools"]'],
    ]) {
      await page.evaluate(() => hintTest.showCanvasHint("canvasHintHand"));
      await page.locator(trigger).click();
      assert.equal(await page.locator(panel).isVisible(),true);
      assert.equal(await hint.isVisible(),false,`${panel}: panel takes priority over hints`);
      if (trigger !== "#penSizeTrigger") await page.locator(trigger).click();
      else await page.keyboard.press("Escape");
      assert.equal(await hint.isVisible(),true,`${panel}: closing restores hint`);
      popovers.push(panel);
    }
    await page.evaluate(() => { hintTest.showAutoDelayControl();hintTest.showEffortControl(); });
    assert.equal(await hint.isVisible(),false);
    await page.evaluate(() => hintTest.hideAutoDelayControl());
    assert.equal(await hint.isVisible(),false,"closing one of two panels does not resume hints");
    await page.evaluate(() => hintTest.hideEffortControl());
    assert.equal(await hint.isVisible(),true,"closing the last panel resumes hints");
    await page.evaluate(() => hintTest.setCanvasNavigationLocked(true));
    await page.locator("#eraserToolBtn").click();
    assert.equal(await page.locator("#canvasNavigationLockHint").isVisible(),false,"panels suppress persistent navigation guidance too");
    await page.locator("#penToolBtn").click();
    assert.equal(await page.locator("#canvasNavigationLockHint").isVisible(),true,"outside click restores persistent guidance");
    await page.evaluate(() => hintTest.setCanvasNavigationLocked(false));
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
    await page.locator("#penSizeTrigger").click();
    await page.keyboard.press("Escape");
    assert.equal(await hint.isVisible(),false,"closing a panel cannot resurrect an expired hint");
    // Exercise the restored entry with real ink and pointer gestures.
    await page.evaluate(() => { hintTest.state.auto=false; });
    await page.locator("#penToolBtn").click();
    const canvas = await page.locator("#viewport").boundingBox(), x=canvas.x+canvas.width/2, y=canvas.y+240;
    await page.mouse.move(x+20,y+30); await page.mouse.down();
    await page.mouse.move(x+60,y+60,{steps:8}); await page.mouse.move(x+100,y+30,{steps:8});
    await page.mouse.up();
    await page.locator("#lassoToolBtn").click();
    assert.equal(await page.locator("#lassoToolBtn").getAttribute("aria-pressed"),"true");
    assert.match(await page.locator("#lassoToolBtn").getAttribute("aria-label"),/Lasso/);
    await page.mouse.move(x,y); await page.mouse.down();
    for (const [dx,dy] of [[120,0],[120,90],[0,90],[0,0]]) await page.mouse.move(x+dx,y+dy,{steps:12});
    await page.mouse.up();
    const selection = await page.evaluate(() => ({phase:hintTest.state.selection?.phase,fragments:hintTest.state.selection?.fragments?.length || 0}));
    assert.equal(selection.phase,"active","the visible lasso entry captures a closed loop");
    assert.ok(selection.fragments>0,"lasso captures the enclosed ink");
    assert.equal(await page.locator("#selectionToolbar").isVisible(),false);
    await page.locator('.assist-bar[data-scope="selection"]').waitFor();
    await page.screenshot({path:path.join(directory,"lasso-selection.png")});
    await page.locator('.assist-bar[data-scope="selection"] .assist-close').click();
    assert.equal(await page.evaluate(() => hintTest.state.selection),null,"cancel releases the lasso selection");
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify({checks,popovers,lasso:selection,timers:"passed",errors},null,2));
    console.log(JSON.stringify({directory,layouts:checks.length+1,popovers,lasso:selection,timers:"passed",errors}));
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().then(() => process.exit(0), error => { console.error(error);process.exit(1); });
