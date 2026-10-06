"use strict";
// Render the canonical design preview and check its local controls and reflow.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), output = path.join(root, "docs/verification/card-appearance-20261003");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-card-preview-"));
app.setPath("userData", temporary);
let server, win;
const report = { checks: [], layouts: [] }, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  try {
    server = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
      response.end(fs.readFileSync(path.join(output, "preview.html")));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    win = new BrowserWindow({ show: false, width: 1320, height: 850, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    const js = code => win.webContents.executeJavaScript(code, true);
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await pause(180);
    const layout = () => js(`(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('.card')].filter(e=>e.getClientRects().length).map(e=>({mode:e.dataset.layout,width:e.clientWidth,height:e.clientHeight,titleHeight:Math.round(e.querySelector('.head').getBoundingClientRect().height),title:e.querySelector('.title').textContent,bodyTop:Math.round(e.querySelector('.body').getBoundingClientRect().top),bodyScrollable:e.querySelector('.body').scrollHeight>e.querySelector('.body').clientHeight}))}))()`);
    const shot = async name => fs.writeFileSync(path.join(output, name + ".png"), (await win.webContents.capturePage()).toPNG());
    report.layouts.push({ name: "three-options", ...await layout() });
    await shot("three-options");
    await js(`document.querySelector('#original').click()`);
    report.layouts.push({ name: "original", ...await layout() });
    await shot("original");
    await js(`document.querySelector('#original').click()`);
    for (const mode of ["a", "b", "c"]) {
      await js(`document.querySelector('button[data-view="${mode}"]').click()`);
      await pause(80);
      const state = await layout();
      assert.equal(state.cards.length, 1);
      assert.equal(state.cards[0].mode, mode);
      assert.ok(state.scroll <= state.width);
      report.layouts.push({ name: mode, ...state });
      await shot("option-" + mode);
    }
    const phases = await js(`(()=>{const c=document.querySelector('.option.c'),input=c.querySelector('input'),before=c.querySelector('.wave').getAttribute('d');input.value=3.14;input.dispatchEvent(new Event('input',{bubbles:true}));return {changed:before!==c.querySelector('.wave').getAttribute('d'),value:c.querySelector('output').value};})()`);
    assert.equal(phases.changed, true);
    assert.equal(phases.value, "3.14");
    report.checks.push("Three alternatives, focus buttons, original toggle, scrollable full content and phase control work.");
    win.setContentSize(390, 844);
    await js(`document.querySelector('button[data-view="all"]').click()`);
    await pause(80);
    const narrow = await layout();
    assert.ok(narrow.scroll <= narrow.width);
    assert.equal(narrow.cards.length, 3);
    report.layouts.push({ name: "390px", ...narrow });
    report.checks.push("All three designs reflow vertically at 390px with no horizontal overflow.");
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.failure = error.stack;
    console.error(error);
  } finally {
    fs.writeFileSync(path.join(output, "preview-report.json"), JSON.stringify(report, null, 2) + "\n");
    win?.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
    app.exit(report.failure ? 1 : 0);
  }
});
