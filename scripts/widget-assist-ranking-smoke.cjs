"use strict";
// Run with tools/electron/node_modules/.bin/electron. Uses isolated state and
// controlled JeVision responses; never edits a user's Canvas or calls a model.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-widget-ranking-"));
app.setPath("userData", path.join(directory, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(directory, "state"), PENECHO_CONFIG_FILE:path.join(directory, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) {
    const code = fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, `
      window.rankingTest={state,smartSuggest,restoreWidgets,render,setCanvasMode,showWidgetHeader,widgetAssist,widgetAssistEntry,widgetAssistPrefetch,runWidgetAssistLocal,enterWidgetInteraction,canvasDocumentsReady,refreshSmartSuggestAvailability};
      window.rankingRequests=[];
      const originalFetch=window.fetch;
      window.fetch=(url,options)=>{
        if(url==='/api/suggest/status') return Promise.resolve(new Response(JSON.stringify({configured:true}),{status:200,headers:{'Content-Type':'application/json'}}));
        if(url==='/api/suggest') {
          window.rankingRequests.push(JSON.parse(options.body));
          return new Promise(resolve=>{window.releaseRanking=data=>resolve(new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}}));});
        }
        return originalFetch(url,options);
      };
    })();`);
    return Readable.from([code]);
  }
  return readStream.call(this, file, ...args);
};
const report = { directory, checks:[], errors:[], resizeObserverWarnings:0 }, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, win;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1100, height:900, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    win.webContents.on("console-message", (_event, level, message) => {
      // Existing presentation resizing can defer observer notifications to the
      // next frame. Record this separately; layout and other errors still fail.
      if (message === "ResizeObserver loop completed with undelivered notifications.") report.resizeObserverWarnings++;
      else if (level >= 3) report.errors.push(message);
    });
    const js = code => win.webContents.executeJavaScript(code, true);
    const until = async (code, label) => {
      for (let i = 0; i < 100; i++) { if (await js(code)) return; await pause(100); }
      throw Error(`Timed out: ${label}`);
    };
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await until("!!window.rankingTest", "application startup");
    await js("rankingTest.canvasDocumentsReady().then(()=>true)");
    await js("rankingTest.refreshSmartSuggestAvailability().then(()=>true)");
    await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click()");
    const html = '<!doctype html><style>html,body{margin:0;height:100%;background:white}svg{width:100%;height:100%;transition:transform .2s}</style><svg viewBox="0 0 500 350" xmlns="http://www.w3.org/2000/svg"><ellipse cx="310" cy="230" rx="105" ry="60" fill="#f9b556"/><ellipse cx="195" cy="92" rx="20" ry="60" fill="#f9b556"/><ellipse cx="255" cy="92" rx="20" ry="60" fill="#f9b556"/><circle cx="220" cy="175" r="85" fill="#f9b556"/><circle cx="195" cy="163" r="6" fill="#57321e"/><circle cx="245" cy="163" r="6" fill="#57321e"/><path d="M195 190 Q220 220 245 190" fill="none" stroke="#57321e" stroke-width="5" stroke-linecap="round"/></svg>';
    await js(`(()=>{const t=rankingTest,s=t.state;s.language='en';s.auto=false;s.scale=1;s.panX=0;s.panY=0;t.smartSuggest.available=false;t.restoreWidgets(${JSON.stringify([{ id:"ranking-widget", pluginId:"general", widgetType:"html_widget", x:150, y:180, w:620, h:440, contentW:620, contentH:440, title:"Character illustration", refreshSeconds:0, html }])});t.setCanvasMode('pen');t.render()})()`);
    await until("rankingTest.state.widgets.every(w=>w.hostReady&&w.initialized&&w.contentVersion>0)", "live Widget");
    await js("rankingTest.showWidgetHeader(rankingTest.state.widgets[0]);rankingTest.render()");
    await until("!!document.querySelector('.object-chrome-button.refine')", "Refine button");
    await js("rankingTest.smartSuggest.enabled=true;rankingTest.smartSuggest.available=true;document.querySelector('.object-chrome-button.refine').click()");
    await until("!!document.querySelector('.widget-refine-panel-suggest')", "automatic ranking status");
    await until("rankingRequests.length===1&&!!window.releaseRanking", "Widget ranking request");
    const payload = await js("rankingRequests[0]");
    assert.ok(!payload.context.actions.includes("animate") && !payload.context.actions.includes("make_interactive"), "removed actions never reach ranking");
    assert.match(payload.image, /^data:image\/(png|webp);base64,/);
    await js("document.querySelector('.widget-refine-panel-ask input').value='Keep the colours'");
    const ranked = { ok:true, answers:{ action:{ choice:"note", probabilities:{ none:0.01, note:0.66, present:0.18, add_controls:0.1, larger_text:0.02, fix_layout:0.01, match_theme:0.01, simplify:0.005 } } } };
    await js(`releaseRanking(${JSON.stringify(ranked)})`);
    await until("rankingTest.widgetAssist.inflight.size===0&&document.querySelector('.widget-refine-panel-chip[data-source=penecho-llm]')?.textContent==='Make notes'", "JeVision order");
    assert.deepEqual(await js("[...document.querySelectorAll('.widget-refine-panel-chip[data-source=penecho-llm]')].map(e=>e.textContent)"), ["Make notes", "Present", "Add play controls"]);
    assert.equal(await js("document.querySelector('.widget-refine-panel-ask input').value"), "Keep the colours");
    await pause(200);
    fs.writeFileSync(path.join(directory, "ranked.png"), (await win.webContents.capturePage()).toPNG());
    report.checks.push("Opening Refine automatically requests its allowed actions; the top three model suggestions retain their order and typed input");
    await js("rankingTest.widgetAssist.cache.clear();void rankingTest.widgetAssistPrefetch(rankingTest.state.widgets[0],'verification')");
    await until("rankingRequests.length===2", "second ranking request");
    await js("releaseRanking({ok:true,answers:{action:{choice:'none',probabilities:{none:.98,note:.01,present:.01}}}})");
    await until("rankingTest.widgetAssist.inflight.size===0&&!document.querySelector('.widget-refine-panel-chip[data-source=penecho-llm]')&&!document.querySelector('.object-chrome-button.suggest')", "none removes suggestions");
    assert.equal(await js("!!document.querySelector('.widget-refine-panel-label')"), false);
    assert.equal(await js("!!document.querySelector('.object-chrome-button.suggest')"), false);
    assert.equal(await js("document.querySelector('.widget-refine-panel-ask input').value"), "Keep the colours");
    await pause(200);
    fs.writeFileSync(path.join(directory, "none.png"), (await win.webContents.capturePage()).toPNG());
    report.checks.push("None hides ranked panel and header suggestions while the vivid shortcut and typed draft remain");

    // Present must enter the same live interaction as the header's Interact.
    await js("document.querySelector('.widget-refine-panel-close').click();rankingTest.smartSuggest.available=false;rankingTest.widgetAssist.cache.clear();rankingTest.widgetAssist.cache.set(rankingTest.widgetAssistEntry(rankingTest.state.widgets[0]).key,{answers:{action:{choice:'present',probabilities:{present:1}}}});window.originalPresentFrame=rankingTest.state.widgets[0].frame");
    const interaction = () => js("(()=>{const s=rankingTest.state,w=s.widgets[0];return {id:s.interactingWidgetId,inPlace:s.widgetInteractionInPlace,mode:s.mode,maximized:!!w.maximized,popover:w.shell.matches(':popover-open'),sameFrame:w.frame===originalPresentFrame,geometry:[w.x,w.y,w.w,w.h,w.contentW,w.contentH]}})()");
    const open = async (mode, preference, action) => {
      await js(`localStorage.setItem('penecho.widgetInteractionPresentation',${JSON.stringify(preference)});rankingTest.setCanvasMode(${JSON.stringify(mode)});rankingTest.showWidgetHeader(rankingTest.state.widgets[0]);rankingTest.render()`);
      await until("!!document.querySelector('.object-chrome-button.interact')", "Widget header");
      if (action === "present") {
        await js("document.querySelector('.object-chrome-button.refine').click()");
        await until("!!document.querySelector('.widget-refine-panel-suggest')", "cached ranking status");
        await until("[...document.querySelectorAll('.widget-refine-panel-chip')].some(e=>e.textContent==='Present')", "Present suggestion");
        await js("[...document.querySelectorAll('.widget-refine-panel-chip')].find(e=>e.textContent==='Present').click()");
      } else await js("document.querySelector('.object-chrome-button.interact').click()");
      await pause(100);
      assert.equal(await js("!!rankingTest.state.widgetRefineConfirmation"), false, "Present closes Refine before entering interaction");
      return interaction();
    };
    const exit = async () => {
      await js("document.querySelector('.widget-presentation-toolbar button[aria-label=\"Exit interaction\"]').click()");
      await until("!rankingTest.state.interactingWidgetId&&!rankingTest.state.widgets[0].maximized", "exit interaction");
      assert.equal((await interaction()).popover, false);
    };
    for (const mode of ["pen", "hand"]) {
      for (const preference of ["maximized", "canvas"]) {
        const expected = await open(mode, preference, "interact");
        if (!expected.maximized) await js("document.querySelector('.widget-interaction-status button').click()");
        await exit();
        const actual = await open(mode, preference, "present");
        assert.deepEqual(actual, expected, `Present and Interact agree in ${mode}/${preference}`);
        assert.ok(actual.id);
        assert.equal(actual.sameFrame, true);
        if (!actual.maximized) await js("document.querySelector('.widget-interaction-status button').click()");
        await until("rankingTest.state.widgets[0].maximized", "maximized Present");
        await pause(250);
        if (mode === "pen" && preference === "maximized") fs.writeFileSync(path.join(directory, "present-maximized.png"), (await win.webContents.capturePage()).toPNG());
        await js("document.querySelector('.widget-presentation-toolbar button[aria-label=\"Interact on canvas\"]').click()");
        await until("!rankingTest.state.widgets[0].maximized&&document.querySelector('.widget-interaction-status')?.hidden===false", "return to canvas");
        await pause(250);
        assert.equal(await js("(()=>{const w=rankingTest.state.widgets[0],r=w.shell.getBoundingClientRect();return Math.abs(r.width-w.w*rankingTest.state.scale)<1&&Math.abs(r.height-w.h*rankingTest.state.scale)<1})()"), true, "rendered Widget returns to its canvas dimensions");
        const minimized = await interaction();
        assert.equal(minimized.id, actual.id, "returning to Canvas keeps the Widget live");
        assert.equal(minimized.popover, false);
        assert.deepEqual(minimized.geometry, actual.geometry);
        if (mode === "pen" && preference === "maximized") fs.writeFileSync(path.join(directory, "present-on-canvas.png"), (await win.webContents.capturePage()).toPNG());
        await js("document.querySelector('.widget-interaction-status button').click()");
        await exit();
      }
    }
    // The current persisted Select mode is Lasso, which deliberately rejects
    // Widget activation through both entry points.
    assert.deepEqual(await js("(()=>{rankingTest.setCanvasMode('select');const w=rankingTest.state.widgets[0];return {present:rankingTest.runWidgetAssistLocal(w,'present'),interact:rankingTest.enterWidgetInteraction(w)}})()"), {present:false,interact:false});
    await open("pen", "maximized", "present");
    win.webContents.sendInputEvent({ type:"keyDown", keyCode:"Escape" });
    win.webContents.sendInputEvent({ type:"keyUp", keyCode:"Escape" });
    await until("!rankingTest.state.interactingWidgetId&&!rankingTest.state.widgets[0].maximized", "Escape from Present");
    assert.equal((await interaction()).sameFrame, true);
    report.checks.push("Present matches Interact in Pen and Hand with both saved display modes; Lasso rejects both; return, re-maximize, exit and Escape preserve the live iframe and geometry");
    assert.deepEqual(report.errors, []);
    report.ok = true;
  } catch (error) { report.failure = error.stack || String(error); }
  finally {
    win?.destroy();
    if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
    report.serverClosed = !server?.listening;
    fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    app.exit(report.ok ? 0 : 1);
  }
});
