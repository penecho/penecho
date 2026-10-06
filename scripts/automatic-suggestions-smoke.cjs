"use strict";
// Isolated UI acceptance. No user documents or real model requests are used.
// Run with tools/electron/node_modules/.bin/electron.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-auto-suggestions-"));
app.setPath("userData", path.join(directory, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(directory, "state"), PENECHO_CONFIG_FILE:path.join(directory, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) {
    const code = fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, `
      window.suggestionTest={state,smartSuggest,restoreWidgets,render,setCanvasMode,showWidgetHeader,widgetAssist,widgetAssistPrefetch,smartSuggestDrawingStarted,smartSuggestDrawingFinished,canvasDocumentsReady,refreshSmartSuggestAvailability,openSettings,selectSettingsPage,closeSettings,applyLanguage,assistRefresh,renderAssist,stroke,clientPoint};
      window.suggestionRequests=[];
      const originalFetch=window.fetch;
      window.fetch=(url,options)=>{
        if(url==='/api/suggest/status') return Promise.resolve(new Response(JSON.stringify({configured:true}),{status:200,headers:{'Content-Type':'application/json'}}));
        if(url==='/api/suggest') return new Promise(resolve=>suggestionRequests.push({signal:options.signal,resolve:data=>resolve(new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}}))}));
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
      if (message === "ResizeObserver loop completed with undelivered notifications.") report.resizeObserverWarnings++;
      else if (level >= 3) report.errors.push(message);
    });
    const js = code => win.webContents.executeJavaScript(code, true);
    const until = async (code, label) => {
      for (let i = 0; i < 100; i++) { if (await js(code)) return; await pause(100); }
      throw Error(`Timed out: ${label}`);
    };
    const ready = async () => {
      await until("!!window.suggestionTest", "application startup");
      await js("suggestionTest.canvasDocumentsReady().then(()=>true)");
      await js("suggestionTest.refreshSmartSuggestAvailability().then(()=>true)");
      await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();suggestionTest.state.auto=false");
    };
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await ready();
    assert.equal(await js("document.querySelector('#smartSuggestToggle').getAttribute('aria-checked')"), "true");
    const html = '<!doctype html><style>html,body{margin:0;height:100%;background:white}svg{width:100%;height:100%}</style><svg viewBox="0 0 500 350"><circle cx="250" cy="175" r="110" fill="#4f46e5"/></svg>';
    await js(`(()=>{const t=suggestionTest,s=t.state;s.scale=1;s.panX=0;s.panY=0;t.smartSuggest.available=false;t.restoreWidgets(${JSON.stringify([{ id:"toggle-widget", pluginId:"general", widgetType:"html_widget", x:150, y:180, w:620, h:440, contentW:620, contentH:440, title:"Illustration", refreshSeconds:0, html }])});t.setCanvasMode('pen');t.render()})()`);
    await until("suggestionTest.state.widgets.every(w=>w.hostReady&&w.initialized&&w.contentVersion>0)", "live Widget");
    await js("suggestionTest.showWidgetHeader(suggestionTest.state.widgets[0]);suggestionTest.render()");
    await until("!!document.querySelector('.object-chrome-button.suggest')", "enabled header suggestions");
    await js("suggestionTest.smartSuggest.available=true;document.querySelector('.object-chrome-button.refine').click()");
    await until("!!document.querySelector('.widget-refine-panel-suggest')", "manual ranking button");
    await js("document.querySelector('.widget-refine-panel-suggest').click()");
    await until("suggestionRequests.length===1", "first ranking request");
    await js("document.querySelector('#smartSuggestToggle').click();suggestionTest.render()");
    assert.equal(await js("suggestionRequests[0].signal.aborted"), false, "automatic toggle leaves the explicit request running");
    assert.equal(await js("suggestionTest.widgetAssist.inflight.size"), 1);
    assert.equal(await js("!!document.querySelector('.object-chrome-button.suggest')"), false);
    assert.equal(await js("!!document.querySelector('.object-chrome-button.refine')"), true);
    await js("document.querySelector('.object-chrome-button.refine').click()");
    assert.equal(await js("suggestionRequests[0].signal.aborted"), true, "closing Refine aborts its request");
    await until("!document.querySelector('.widget-refine-panel')", "closed Refine panel");
    await js("suggestionTest.showWidgetHeader(suggestionTest.state.widgets[0]);suggestionTest.render()");
    await js("document.querySelector('.object-chrome-button.refine').click()");
    await until("!!document.querySelector('.widget-refine-panel-ask input')", "manual Refine while disabled");
    assert.equal(await js("suggestionRequests.length"), 1);
    report.checks.push("Turning off hides automatic Widget suggestions while manual ranking stays available; closing Refine aborts its request");

    await js("document.querySelector('.widget-refine-panel-suggest').click()");
    await until("suggestionRequests.length===2", "replacement ranking request");
    const answer = { ok:true, answers:{ action:{ choice:"animate", probabilities:{ animate:0.9, none:0.1 } } } };
    await js(`suggestionRequests[0].resolve(${JSON.stringify(answer)})`);
    await pause(100);
    assert.equal(await js("suggestionTest.widgetAssist.cache.size"), 0);
    assert.equal(await js("suggestionTest.widgetAssist.inflight.size"), 1);
    await js(`suggestionRequests[1].resolve(${JSON.stringify(answer)})`);
    await until("suggestionTest.widgetAssist.inflight.size===0", "new ranking completes");
    assert.equal(await js("suggestionTest.widgetAssist.cache.size"), 1);
    report.checks.push("Late cancelled replies cannot restore suggestions or remove a newer pending request");
    await js("document.querySelector('#smartSuggestToggle').click()");

    await js("suggestionTest.state.language='zh';suggestionTest.applyLanguage();suggestionTest.openSettings();suggestionTest.selectSettingsPage('canvas')");
    await pause(100);
    await js("document.querySelector('#smartSuggestToggle').focus()");
    assert.equal(await js("document.activeElement.id"), "smartSuggestToggle");
    win.webContents.sendInputEvent({ type:"keyDown", keyCode:"Space" });
    win.webContents.sendInputEvent({ type:"keyUp", keyCode:"Space" });
    await until("document.querySelector('#smartSuggestToggle').getAttribute('aria-checked')==='false'", "keyboard switch activation");
    assert.equal(await js("document.querySelector('#smartSuggestToggleLabel').textContent"), "自动提示");
    assert.equal(await js("localStorage.getItem('penecho-smart-suggestions')"), "false");
    await pause(200);
    fs.writeFileSync(path.join(directory, "desktop-zh.png"), (await win.webContents.capturePage()).toPNG());
    win.setSize(390, 844);
    await js("suggestionTest.state.language='en';suggestionTest.applyLanguage();document.querySelector('#smartSuggestToggle').scrollIntoView({block:'center'})");
    await pause(300);
    assert.equal(await js("document.querySelector('#smartSuggestToggleLabel').textContent"), "Automatic suggestions");
    const bounds = await js("(()=>{const r=document.querySelector('#smartSuggestToggle').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight}})()");
    assert.ok(bounds.left>=0 && bounds.right<=bounds.w && bounds.top>=0 && bounds.bottom<=bounds.h, JSON.stringify(bounds));
    fs.writeFileSync(path.join(directory, "phone-en.png"), (await win.webContents.capturePage()).toPNG());
    report.checks.push("Chinese/English labels, keyboard activation, and desktop/mobile switch layout pass");

    await new Promise(resolve => { win.webContents.once("did-finish-load", resolve); win.reload(); });
    await until("document.readyState==='complete' && !!window.suggestionTest", "reload");
    await ready();
    assert.equal(await js("suggestionTest.smartSuggest.enabled"), false);
    assert.equal(await js("document.querySelector('#smartSuggestToggle').getAttribute('aria-checked')"), "false");
    await js("(()=>{const t=suggestionTest,s=t.state;t.closeSettings();t.setCanvasMode('pen');t.smartSuggest.available=false;t.smartSuggestDrawingStarted();s.history.push({});t.smartSuggestDrawingFinished({samples:[{point:{x:100,y:100}},{point:{x:350,y:100}},{point:{x:350,y:220}}],bbox:{x:100,y:100,w:250,h:120},size:4});})()");
    await pause(700);
    assert.equal(await js("suggestionTest.smartSuggest.bar?.mode==='suggest'"), false);
    assert.equal(await js("suggestionRequests.length"), 0);
    await js("document.querySelector('#smartSuggestToggle').click()");
    await until("suggestionTest.smartSuggest.bar?.mode==='suggest'", "offline suggestions after enabling");
    report.checks.push("Reload keeps the preference off, new ink stays quiet, and re-enabling restores local suggestions without a relay");

    win.setSize(1100, 900);
    await js(`(()=>{const t=suggestionTest,s=t.state;t.restoreWidgets([]);s.scale=1;s.panX=0;s.panY=0;
      t.stroke({x:100,y:100},{x:350,y:100},false,4);t.stroke({x:350,y:100},{x:350,y:220},false,4);t.render();
      window.assistClockOffset=0;const clock=performance.now.bind(performance);performance.now=()=>clock()+assistClockOffset;
      window.retainedAssist=t.smartSuggest.bar;assistClockOffset+=120000;
    })()`);
    await pause(150);
    assert.equal(await js("suggestionTest.smartSuggest.bar===retainedAssist"), true, "suggestions survive two minutes idle");
    await js("Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});suggestionTest.assistRefresh('test-hidden')");
    await pause(100);
    assert.equal(await js("suggestionTest.smartSuggest.bar===retainedAssist"), true, "hidden tabs retain suggestions");
    await js("delete document.visibilityState;suggestionTest.setCanvasMode('hand');suggestionTest.assistRefresh('test-navigation')");
    await pause(100);
    assert.equal(await js("suggestionTest.smartSuggest.bar===retainedAssist"), true, "switching to Hand retains suggestions");
    await js("suggestionTest.state.activeAI={test:true}");
    await pause(100);
    assert.equal(await js("suggestionTest.smartSuggest.bar===retainedAssist && [...retainedAssist.element.querySelectorAll('.assist-action')].every(b=>b.disabled) && !retainedAssist.element.querySelector('.assist-close').disabled"), true);
    await js("suggestionTest.state.activeAI=null");
    await pause(100);
    assert.equal(await js("[...retainedAssist.element.querySelectorAll('.assist-action')].every(b=>!b.disabled)"), true);
    fs.writeFileSync(path.join(directory, "persistent-suggestions.png"), (await win.webContents.capturePage()).toPNG());
    report.checks.push("Suggestions survive idle time, background tabs, tool changes and AI work; actions recover when AI finishes");

    const pointer = async (type, x, y, options = {}) => js(`document.querySelector('#screen').dispatchEvent(new PointerEvent(${JSON.stringify(type)},{bubbles:true,pointerId:71,pointerType:'touch',isPrimary:true,button:0,clientX:${x},clientY:${y},...${JSON.stringify(options)}}))`);
    // Test the actual document listeners without triggering unrelated Canvas gestures.
    await js("window.suppressTestPointer=e=>{if(!e.isTrusted)e.stopPropagation()};document.querySelector('#screen').addEventListener('pointerdown',suppressTestPointer,true);document.querySelector('#screen').addEventListener('pointermove',suppressTestPointer,true)");
    await pointer("pointerdown", 850, 500);
    await pointer("pointermove", 880, 500);
    await pointer("pointerup", 850, 500);
    assert.equal(await js("suggestionTest.smartSuggest.bar===retainedAssist"), true, "a drag returning to its origin is not a tap");
    await pointer("pointerdown", 850, 500);
    await pointer("pointerdown", 900, 500, { pointerId:72, isPrimary:false });
    await pointer("pointerup", 850, 500);
    assert.equal(await js("suggestionTest.smartSuggest.bar===retainedAssist"), true, "multi-touch cannot dismiss");
    await pointer("pointerdown", 850, 500);
    await pointer("pointercancel", 850, 500);
    assert.equal(await js("suggestionTest.smartSuggest.bar===retainedAssist"), true, "cancelled touches cannot dismiss");
    await js("(()=>{const t=suggestionTest,p=t.clientPoint({clientX:855,clientY:500});t.stroke({x:p.x-10,y:p.y},{x:p.x+10,y:p.y},false,4)})()");
    await pointer("pointerdown", 855, 500);
    await pointer("pointerup", 855, 500);
    assert.equal(await js("suggestionTest.smartSuggest.bar===retainedAssist"), true, "tapping raster ink does not dismiss");
    await js("document.querySelector('#screen').removeEventListener('pointerdown',suppressTestPointer,true);document.querySelector('#screen').removeEventListener('pointermove',suppressTestPointer,true)");
    win.webContents.sendInputEvent({ type:"mouseDown", x:850, y:550, button:"left", clickCount:1 });
    win.webContents.sendInputEvent({ type:"mouseUp", x:850, y:550, button:"left", clickCount:1 });
    await until("!suggestionTest.smartSuggest.bar", "real blank Canvas click dismisses");
    report.checks.push("Dragging, multi-touch, cancellation and raster-ink taps retain help; a real blank Canvas click dismisses it");

    await js("suggestionTest.setCanvasMode('pen');suggestionTest.smartSuggest.available=true;suggestionTest.smartSuggestDrawingStarted();suggestionTest.state.history.push({});suggestionTest.stroke({x:150,y:300},{x:350,y:350},false,4,true);suggestionTest.smartSuggestDrawingFinished({samples:[{point:{x:150,y:300}},{point:{x:350,y:350}}],bbox:{x:150,y:300,w:200,h:50},size:4});suggestionTest.render()");
    await until("suggestionTest.smartSuggest.bar?.mode==='suggest' && suggestionRequests.length===1", "new ink restores suggestions and starts ranking");
    await js("document.querySelector('.assist-close').click()");
    assert.equal(await js("suggestionRequests[0].signal.aborted"), true);
    await js(`suggestionRequests[0].resolve(${JSON.stringify(answer)})`);
    await pause(250);
    assert.equal(await js("suggestionTest.smartSuggest.bar"), null, "late ranking cannot reopen dismissed suggestions");
    report.checks.push("New ink restores suggestions; closing aborts ranking and rejects late replies");

    await js("suggestionTest.smartSuggest.available=false;suggestionTest.setCanvasMode('hand')");
    const dirtyPoint = await js("(()=>{const t=suggestionTest,a=t.clientPoint({clientX:0,clientY:0}),b=t.clientPoint({clientX:1,clientY:1});return {x:Math.round((250-a.x)/(b.x-a.x)),y:Math.round((325-a.y)/(b.y-a.y))}})()");
    const mouse = (type, point = dirtyPoint, extra = {}) => win.webContents.sendInputEvent({ type, ...point, ...extra });
    const escape = async () => {
      await js("document.activeElement?.blur()");
      mouse("keyDown", {}, { keyCode:"Escape" });mouse("keyUp", {}, { keyCode:"Escape" });
      await until("!suggestionTest.smartSuggest.bar", "Escape closes restored help");
    };
    mouse("mouseDown", dirtyPoint, { button:"left", clickCount:1 });
    mouse("mouseUp", dirtyPoint, { button:"left", clickCount:1 });
    await until("suggestionTest.smartSuggest.bar?.mode==='suggest'", "Hand click reopens dirty suggestions");
    await escape();
    mouse("mouseMove", {x:950,y:550});
    await pause(100);
    assert.equal(await js("suggestionTest.smartSuggest.bar"), null, "hovering blank space stays quiet");
    mouse("mouseMove");
    await until("suggestionTest.smartSuggest.bar?.mode==='suggest'", "mouse hover in Hand reopens dirty suggestions");
    await pause(100);
    fs.writeFileSync(path.join(directory, "dirty-hover-suggestions.png"), (await win.webContents.capturePage()).toPNG());
    await escape();
    await js("suggestionTest.setCanvasMode('pen')");
    mouse("mouseMove", {x:950,y:550});mouse("mouseMove");
    await until("suggestionTest.smartSuggest.bar?.mode==='suggest'", "mouse hover in Pen reopens dirty suggestions");
    await escape();
    await pointer("pointerdown", dirtyPoint.x, dirtyPoint.y);
    await pointer("pointerup", dirtyPoint.x, dirtyPoint.y);
    await until("suggestionTest.smartSuggest.bar?.mode==='suggest'", "finger tap in Pen reopens dirty suggestions");
    await escape();
    report.checks.push("Hand clicks, mouse hover in Hand/Pen and finger taps restore dirty suggestions; blank hover stays quiet");

    await js("suggestionTest.setCanvasMode('hand')");
    mouse("mouseDown", dirtyPoint, {button:"left",clickCount:1});
    await pause(50);
    mouse("mouseMove", {x:dirtyPoint.x+40,y:dirtyPoint.y}, {button:"left"});
    await pause(50);
    mouse("mouseMove", dirtyPoint, {button:"left"});
    await pause(50);
    mouse("mouseUp", dirtyPoint, {button:"left",clickCount:1});
    await pause(100);
    assert.equal(await js("suggestionTest.smartSuggest.bar"), null, "drag returning to dirty region does not reopen");
    await pointer("pointerdown", dirtyPoint.x, dirtyPoint.y);
    await pointer("pointercancel", dirtyPoint.x, dirtyPoint.y);
    assert.equal(await js("suggestionTest.smartSuggest.bar"), null, "cancelled tap does not reopen");
    await pointer("pointerdown", dirtyPoint.x, dirtyPoint.y);
    await pointer("pointerdown", dirtyPoint.x+30, dirtyPoint.y, {pointerId:72,isPrimary:false});
    await pointer("pointerup", dirtyPoint.x+30, dirtyPoint.y, {pointerId:72,isPrimary:false});
    await pointer("pointerup", dirtyPoint.x, dirtyPoint.y);
    assert.equal(await js("suggestionTest.smartSuggest.bar"), null, "multi-touch does not reopen");
    assert.equal(await js("suggestionRequests.length"), 1, "recalling help starts no ranking request");
    await js("document.querySelector('#smartSuggestToggle').click()");
    mouse("mouseMove", {x:950,y:550});mouse("mouseMove");
    await pause(100);
    assert.equal(await js("suggestionTest.smartSuggest.bar"), null, "disabled suggestions stay hidden on hover");
    await js("document.querySelector('#smartSuggestToggle').click()");
    await pause(250);
    assert.equal(await js("suggestionTest.smartSuggest.bar"), null, "re-enabling does not undo dismissal");
    report.checks.push("Dragging, cancelled taps, multi-touch and disabled suggestions do not reopen help; recall sends no model request");
    await js("suggestionTest.setCanvasMode('pen')");

    await js("suggestionTest.smartSuggest.available=false;suggestionTest.renderAssist({mode:'followup',box:{x:100,y:100,w:250,h:120},target:{box:{x:100,y:100,w:250,h:120},strokes:[]},action:{id:'plot'}});window.retainedAssist=suggestionTest.smartSuggest.bar;assistClockOffset+=120000");
    await pause(150);
    assert.equal(await js("suggestionTest.smartSuggest.bar===retainedAssist"), true, "follow-ups survive two minutes idle");
    win.webContents.sendInputEvent({ type:"mouseDown", x:900, y:650, button:"left", clickCount:1 });
    win.webContents.sendInputEvent({ type:"mouseUp", x:900, y:650, button:"left", clickCount:1 });
    await until("!suggestionTest.smartSuggest.bar", "blank click in Pen dismisses follow-ups");
    await pause(700);
    assert.equal(await js("suggestionTest.smartSuggest.bar"), null, "a mouse tap's new dot cannot reopen suggestions");
    const followup = "suggestionTest.renderAssist({mode:'followup',box:{x:100,y:100,w:250,h:120},target:{box:{x:100,y:100,w:250,h:120},strokes:[]},action:{id:'plot'}})";
    await js(followup);
    await pointer("pointerdown", 900, 600);
    await pointer("pointerup", 900, 600);
    await until("!suggestionTest.smartSuggest.bar", "finger tap on blank Canvas dismisses follow-ups");
    await js(followup);
    await js("document.activeElement?.blur()");
    win.webContents.sendInputEvent({ type:"keyDown", keyCode:"Escape" });
    win.webContents.sendInputEvent({ type:"keyUp", keyCode:"Escape" });
    await until("!suggestionTest.smartSuggest.bar", "Escape dismisses follow-ups");
    report.checks.push("Follow-ups have no idle timeout; Pen-mode mouse clicks, finger taps, and Escape dismiss them without reopening");
    assert.deepEqual(report.errors, []);
    report.ok = true;
  } catch (error) {
    report.failure = error.stack || String(error);
    try { report.suggestions = await win.webContents.executeJavaScript("(()=>{const {state:s,smartSuggest:a}=suggestionTest;return {mode:s.mode,dirty:s.dirty,pan:s.panGesture,touches:s.touches.size,pending:!!s.pending,pendingWidget:!!s.pendingWidget,refine:!!s.widgetRefineConfirmation,selection:!!s.selection,enabled:a.enabled,reopenTap:a.reopenTap,consumed:a.consumedStrokeId,dismissed:a.dismissedStrokeId,strokes:a.strokes.map(v=>({id:v.id,box:v.box,valid:s.history.includes(v.historyEntry)}))}})()"); } catch {}
  }
  finally {
    win?.destroy();
    if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
    report.serverClosed = !server?.listening;
    fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    app.exit(report.ok ? 0 : 1);
  }
});
