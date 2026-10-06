"use strict";
// Replay model Widget output through the real server and Chromium with isolated data.
// Run with tools/electron/node_modules/.bin/electron and optional --trace=/path/to/trace.json.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http"),
  assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-multiple-widgets-")),
  output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || temporary),
  tracePath = process.argv.find(arg => arg.startsWith("--trace="))?.slice(8),
  modelResult = tracePath ? JSON.parse(fs.readFileSync(tracePath, "utf8")).attempts[0].response.parsed : {
    intent:"answer", commands:["Beijing", "New York", "London"].map((title, index) => ({
      tool:"html_widget", pluginId:"general", title, x:13746 + index * 512, y:10600, w:440, h:600,
      refreshSeconds:0, html:`<!doctype html><html><body><h1>${title}</h1></body></html>`,
    })),
  };
assert.equal(modelResult.commands.length, 3);
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, {
  NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"),
  PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0",
  AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_MODEL:"test",
  PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false",
});
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) {
    return Readable.from([fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, `
      window.multipleWidgetTest={state,smartSuggest,canvasDocumentsReady,loadCanvasSettings,loadPluginDocuments,
        storeAiConnectionSelection,settings,requestAI,render,undo,redo,saveSnapshot,readDeviceSnapshot};
    })();`)]);
  }
  return readStream.call(this, file, ...args);
};
const report = { clientFile:path.join(root, "public/app.js"), source:tracePath ? "request trace" : "synthetic fixture", checks:[], errors:[] };
let server, upstream, win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  try {
    upstream = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "Content-Type":"application/json" });
        res.end(JSON.stringify({ choices:[{ finish_reason:"stop", message:{ content:JSON.stringify(modelResult) } }] }));
      });
    });
    await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
    process.env.AI_API_URL = `http://127.0.0.1:${upstream.address().port}/v1`;
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1440, height:1000,
      webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    const run = code => win.webContents.executeJavaScript(code),
      until = async (condition, label) => {
        const deadline = Date.now() + 15000;
        while (!await run(condition)) {
          if (Date.now() > deadline) throw Error(`Timed out: ${label}`);
          await pause(100);
        }
      },
      screenshot = async name => fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await until("!!window.multipleWidgetTest", "application startup");
    await run(`(async()=>{const t=multipleWidgetTest,s=t.state;await t.canvasDocumentsReady();await t.loadCanvasSettings();
      await t.loadPluginDocuments();t.storeAiConnectionSelection(t.settings.connections[0].id);
      document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();
      document.querySelector('#canvasWelcome').hidden=true;t.smartSuggest.enabled=false;
      s.auto=false;s.mode='pen';s.scale=.65;s.panX=170-13746*s.scale;s.panY=210-10600*s.scale;s.viewInitialized=true;t.render();
      window.multipleWidgetRequest=t.requestAI('auto',null,{captureCurrentViewport:true});})()`);
    await until("multipleWidgetTest.state.widgets.length===3 && !multipleWidgetTest.state.activeAI", "three live Widgets");
    await run("multipleWidgetRequest");
    await until("multipleWidgetTest.state.widgets.every(w=>w.frame && w.contentVersion>0)", "iframe rendering");
    await pause(300);
    report.widgets = await run(`multipleWidgetTest.state.widgets.map(w=>({title:w.title,x:w.x,y:w.y,w:w.w,h:w.h,
      frameMounted:!!w.frame,contentVersion:w.contentVersion}))`);
    assert.deepEqual(report.widgets.map(({ title, x, y, w, h }) => ({ title, x, y, w, h })),
      modelResult.commands.map(({ title, x, y, w, h }) => ({ title, x, y, w, h })));
    await screenshot("three-live-widgets");
    report.checks.push("All three model Widgets pass the real server and client, retain their geometry, and mount live iframes.");
    await run("multipleWidgetTest.undo()");
    assert.equal(await run("multipleWidgetTest.state.widgets.length"), 2);
    await run("multipleWidgetTest.redo()");
    assert.equal(await run("multipleWidgetTest.state.widgets.length"), 3);
    report.checks.push("Existing Widget Undo and Redo retain the other two Widgets.");
    const snapshotId = await run("multipleWidgetTest.saveSnapshot({name:'Multiple Widget replay',location:'device'})"),
      snapshot = await run(`multipleWidgetTest.readDeviceSnapshot(${JSON.stringify(snapshotId)})`);
    assert.equal(snapshot.item.widgets.length, 3);
    report.checks.push("Device save retains all three Widgets.");
    assert.deepEqual(report.errors, []);
    report.ok = true;
  } catch (error) {
    report.failure = String(error.stack || error);
    process.exitCode = 1;
  } finally {
    fs.createReadStream = readStream;
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, ...report }));
    win?.destroy();
    for (const running of [server, upstream]) {
      running?.closeAllConnections();
      if (running?.listening) await new Promise(resolve => running.close(resolve));
    }
    if (output !== temporary) fs.rmSync(temporary, { recursive:true, force:true });
    app.exit(process.exitCode || 0);
  }
});
