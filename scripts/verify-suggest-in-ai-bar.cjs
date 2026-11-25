"use strict";
// Suggestions for new ink sit inside the Canvas AI bar on a wide Canvas, in
// place of its settings, with three choices; selections and narrow windows keep
// the floating bar. Isolated data, no AI requests.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "suggest-in-ai-bar-"));
const output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || temporary);
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:9/v1" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) return Readable.from([fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, `
    // An empty test profile would otherwise go on to the Projects page.
    projectLinesNothingKept=()=>false;
    window.aiBarTest={state,smartSuggest,canvasDocumentsReady,smartSuggestSyncDocument,smartSuggestRecordStroke,assistRefresh,renderAssist,hideAssist,dismissAssist,clearDirtyContributionTracking,stroke,tiles,restoreWidgets,cancelSelection,captureSelection,t};
  })();`)]);
  return readStream.call(this, file, ...args);
};
let server, win;
const report = { checks:[], errors:[] };
const frame = () => win.webContents.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
const shot = async name => fs.writeFileSync(path.join(output, name + ".png"), (await win.webContents.capturePage()).toPNG());
const page = source => win.webContents.executeJavaScript(`(async()=>{const t=window.aiBarTest,s=t.state,a=t.smartSuggest,section=document.querySelector('#aiToolsSection');
  const shown=element=>Boolean(element&&element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden');
  const runPosition=()=>{const {x,y}=section.querySelector('#aiToolbarRun').getBoundingClientRect();return {x,y};};
  const settings=()=>['#aiModelControl','#effortControl','#autoControl','[data-color-control="ai"]'].map(selector=>shown(section.querySelector(selector)));
  const seed=()=>{
    t.hideAssist('test-reset');t.cancelSelection(true);t.tiles.clear();s.inkBounds.clear();t.clearDirtyContributionTracking();
    s.history=[];t.restoreWidgets([]);s.images=[];s.textBoxes=[];s.dirty=null;s.mode='pen';s.scale=1;s.panX=0;s.panY=0;
    a.documentId=null;t.smartSuggestSyncDocument();a.requests.clear();a.localReadyAt=0;a.inkReadyAt=0;a.enabled=true;a.available=false;
    const entry={},points=[{x:360,y:360},{x:560,y:430}];s.history.push(entry);
    t.stroke(points[0],points[1],false,6,true,'#111827');
    t.smartSuggestRecordStroke({id:a.nextStrokeId++,points,box:{x:360,y:360,w:200,h:70},at:Date.now(),size:6,historyEntry:entry});
    t.assistRefresh('test-seed');
  };
  ${source}
})()`);

app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1280, height:860, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/index.html`);
    // Pictures of the Canvas, not of PenEcho's opening film.
    await win.webContents.executeJavaScript(`sessionStorage.setItem('penecho-opening-seen',(document.cookie.match(/(?:^|;\\s*)penecho-boot=([^;]+)/)||[])[1]||'played')`);
    await win.loadURL(`http://127.0.0.1:${server.address().port}/index.html`);
    await page(`await t.canvasDocumentsReady();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();
      document.querySelector('#changelogDialog')?.close?.();s.language='en';`);
    await frame();

    const before = await page(`return {width:section.getBoundingClientRect().width,settings:settings(),runPosition:runPosition()};`);
    assert.deepEqual(before.settings, [true, true, true, true], "the AI bar shows its settings with no suggestion");

    const docked = await page(`seed();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const bar=a.bar.element,chips=[...bar.querySelectorAll(':scope > .assist-action')].filter(shown),outline=document.querySelector('.assist-target-outline');
      return {mode:a.bar.mode,inBar:bar.parentElement===section&&bar.classList.contains('in-ai-bar'),settings:settings(),run:shown(section.querySelector('#aiToolbarRun')),
        chips:chips.map(c=>c.textContent.trim()),askInMenu:Boolean(bar.querySelector('.assist-menu > .assist-ask')),width:section.getBoundingClientRect().width,runPosition:runPosition(),
        height:section.getBoundingClientRect().height,outline:Boolean(outline),layerHidden:document.querySelector('#smartSuggestLayer').hidden};`);
    report.docked = docked;
    assert.equal(docked.mode, "suggest");
    assert.ok(docked.inBar, "new-ink suggestions sit inside the AI bar");
    assert.deepEqual(docked.settings, [false, false, false, false], "suggestions take the settings' place");
    assert.ok(docked.run, "AI stays in the bar");
    assert.deepEqual(docked.runPosition, before.runPosition, "AI does not move when suggestions replace the settings");
    assert.equal(docked.chips.length, 3, "three suggestions show: " + docked.chips.join(", "));
    assert.ok(docked.askInMenu, "Ask is inside ⋯");
    assert.ok(docked.height <= 42, "the bar keeps one row");
    assert.equal(docked.outline, false, "no box is drawn around the ink");
    report.checks.push(`Suggest: inside the AI bar, settings hidden, 3 suggestions (${docked.chips.join(" · ")}), bar ${Math.round(before.width)} → ${Math.round(docked.width)} px, no box around the ink`);
    await shot("suggest");

    const menu = await page(`a.bar.element.querySelector('.assist-more > button').click();await new Promise(r=>requestAnimationFrame(r));
      const m=a.bar.element.querySelector('.assist-menu'),rect=m.getBoundingClientRect();
      const ask=m.querySelector('.assist-ask > button');ask.click();await new Promise(r=>requestAnimationFrame(r));
      const input=m.querySelector('.assist-ask input');
      await new Promise(r=>requestAnimationFrame(r));
      return {shown:shown(m),inside:rect.left>=0&&rect.right<=innerWidth+1,first:m.firstElementChild.classList.contains('assist-ask'),input:Boolean(input)&&document.activeElement===input,
        chips:[...a.bar.element.querySelectorAll(':scope > .assist-action')].filter(shown).length};`);
    assert.ok(menu.shown && menu.inside && menu.first && menu.input, "⋯ opens below the bar with Ask first, and Ask opens its box: " + JSON.stringify(menu));
    assert.equal(menu.chips, 3, "the three suggestions stay on the bar while Ask is open");
    report.checks.push("⋯ opens inside the window with Ask first; Ask opens its text box there");
    await shot("menu-ask");

    const auto = await page(`seed();document.querySelector('#auto').classList.add('active');await new Promise(r=>requestAnimationFrame(r));
      const dot=getComputedStyle(document.querySelector('#aiToolbarRun'),'::after').content;document.querySelector('#auto').classList.remove('active');
      const none=getComputedStyle(document.querySelector('#aiToolbarRun'),'::after').content;return {dot,none};`);
    assert.ok(auto.dot !== "none" && auto.none === "none", "a dot on AI shows Auto while its control is hidden: " + JSON.stringify(auto));
    report.checks.push("A dot on AI shows Auto is on while the settings are hidden");

    const closed = await page(`a.bar.element.querySelector('.assist-close').click();await new Promise(r=>requestAnimationFrame(r));
      return {bar:Boolean(a.bar),inSection:Boolean(section.querySelector('.assist-bar')),settings:settings(),outline:Boolean(document.querySelector('.assist-target-outline')),width:section.getBoundingClientRect().width,runPosition:runPosition()};`);
    assert.deepEqual([closed.bar, closed.inSection, closed.outline], [false, false, false], "× removes the suggestion");
    assert.deepEqual(closed.settings, [true, true, true, true], "the settings come back after ×");
    assert.ok(Math.abs(closed.width - before.width) < 1, "the AI bar returns to its width");
    assert.deepEqual(closed.runPosition, before.runPosition, "AI does not move when suggestions close");
    report.checks.push("× brings model, reasoning, Auto and colour back at the original width");

    const working = await page(`seed();s.activeAI={test:true};const target=a.bar.target;t.renderAssist({mode:'working',label:'Plotting graph',box:target.box,target});
      await new Promise(r=>requestAnimationFrame(r));const bar=a.bar.element;
      return {inBar:bar.parentElement===section,settings:settings(),text:bar.textContent,outline:Boolean(document.querySelector('.assist-target-outline')),runPosition:runPosition()};`);
    assert.ok(working.inBar && working.settings.every(value => !value) && /Plotting graph/.test(working.text), "Working shows in the AI bar");
    assert.equal(working.outline, false, "no box is drawn around the ink");
    assert.deepEqual(working.runPosition, before.runPosition, "AI does not move when the bar shows progress");
    report.checks.push("Working shows inside the AI bar");
    await shot("working");
    await page(`s.activeAI=null;t.hideAssist('test');`);

    const writing = await page(`seed();a.bar.element.classList.add('is-writing');const style=getComputedStyle(a.bar.element);
      const out={visibility:style.visibility,opacity:style.opacity,settings:settings()};a.bar.element.classList.remove('is-writing');return out;`);
    assert.ok(writing.visibility === "visible" && Number(writing.opacity) < 1 && writing.settings.every(value => !value), "writing dims the bar without bringing the settings back");
    report.checks.push("While writing the bar dims in place instead of swapping back to the settings");

    const selection = await page(`seed();t.captureSelection([{x:330,y:330},{x:600,y:330},{x:600,y:460},{x:330,y:460}]);
      for(let i=0;i<100&&!(a.bar?.mode==='suggest'&&a.bar.target?.selection);i++)await new Promise(r=>setTimeout(r,20));
      await new Promise(r=>requestAnimationFrame(r));
      return {mode:a.bar?.mode,inLayer:a.bar?.element.parentElement===document.querySelector('#smartSuggestLayer'),settings:settings()};`);
    assert.ok(selection.mode === "suggest" && selection.inLayer && selection.settings.every(Boolean), "a lasso selection keeps its own bar beside the selection: " + JSON.stringify(selection));
    report.checks.push("A lasso selection keeps its floating bar beside the selection, AI bar unchanged");
    await page(`t.cancelSelection(true);t.hideAssist('test');`);

    win.setSize(640, 860);
    await frame();
    const narrow = await page(`seed();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      return {inLayer:a.bar.element.parentElement===document.querySelector('#smartSuggestLayer'),inAiBar:a.bar.element.classList.contains('in-ai-bar')};`);
    assert.deepEqual(narrow, { inLayer:true, inAiBar:false }, "a narrow window keeps the floating bar");
    report.checks.push("A narrow window (640 px) keeps the floating bar beside the ink");

    win.setSize(1280, 860);
    await frame();
    const back = await page(`await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const bar=a.bar.element;
      return {inBar:bar.parentElement===section,chips:[...bar.querySelectorAll(':scope > .assist-action')].filter(shown).length,ask:Boolean(bar.querySelector('.assist-menu > .assist-ask'))};`);
    assert.deepEqual(back, { inBar:true, chips:3, ask:true }, "widening the window moves the open suggestion into the AI bar");
    report.checks.push("Widening the window moves an open suggestion into the AI bar with its three choices");

    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.failure = error.stack;
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    win?.destroy(); server?.close(); if (output !== temporary) fs.rmSync(temporary, { recursive:true, force:true }); app.exit(process.exitCode || 0);
  }
});
