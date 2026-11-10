"use strict";
// Exercise canonical auto-fit and presentation with an isolated local service.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const { architectureHtml } = require("../src/architecture/schema.js");
const root = path.resolve(__dirname, ".."), cloud = process.argv.includes("--cloud"), recordOnly = process.argv.includes("--record-only");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-fit-margins-"));
const output = path.resolve(process.argv.find(value => value.startsWith("--output="))?.slice(9) || path.join(root, "docs/verification/widget-fit-margins-20261004"));
const assetRoot = cloud ? path.resolve(root, "../penecho_cloud/public/canvas") : path.join(root, "public");
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  const relative = path.relative(path.join(root, "public"), String(file));
  if (relative === "app.js") return Readable.from([fs.readFileSync(path.join(assetRoot, relative), "utf8").replace(/\}\)\(\);\s*$/, `
    canvasAgentAssertToolExecution=()=>{};
    window.fitMarginsTest={state,canvasDocumentsReady,loadCanvasSettings,canvasAgentCreate,mcpExecute,mcpRevealRegion,render,setCanvasMode,closeCanvasAgent,setWidgetMaximized,setWidgetPresentationZoom,serializedWidgets,undo,redo};
  })();`)]);
  if (cloud && !relative.startsWith("..") && fs.existsSync(path.join(assetRoot, relative))) return readStream.call(this, path.join(assetRoot, relative), ...args);
  return readStream.call(this, file, ...args);
};
const sha256 = file => require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(assetRoot, file))).digest("hex");
const report = { runtime:cloud ? "cloud" : "local", recordOnly, checks:[], samples:[], errors:[], inputs:Object.fromEntries(["app.js", "widget-host.js", "vendor/architecture-runtime.js"].map(file => [file, sha256(file)])) };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { for (let i=0; i<160; i++) { if (await check()) return; await pause(100); } throw Error(`Timed out: ${label}`); }
let win, server;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1600, height:1200, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    const js = code => win.webContents.executeJavaScript(code, true);
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await js("(async()=>{const t=fitMarginsTest;await t.canvasDocumentsReady();await t.loadCanvasSettings();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();t.closeCanvasAgent();t.state.auto=false;t.state.scale=1;t.state.panX=0;t.state.panY=0;t.setCanvasMode('pen');})()");
    const geometry = id => js(`(()=>{const w=fitMarginsTest.state.widgets.find(w=>w.id===${JSON.stringify(id)});return {w:w.w,h:w.h,contentW:w.contentW,contentH:w.contentH,fitContentAxes:w.fitContentAxes,version:w.contentVersion,maximized:!!w.maximized};})()`);
    const metrics = async name => {
      for (const frame of win.webContents.mainFrame.framesInSubtree.filter(frame => frame.url === "about:srcdoc")) {
        const facts = await frame.executeJavaScript(`(()=>{if(document.body.dataset.fitCase!==${JSON.stringify(name)})return null;const b=document.body,r=document.documentElement,s=getComputedStyle(b),a=document.querySelector('[data-penecho-architecture]');return {viewport:{width:innerWidth,height:innerHeight},body:{offsetHeight:b.offsetHeight,scrollHeight:b.scrollHeight,bottom:b.getBoundingClientRect().bottom,marginTop:s.marginTop,marginBottom:s.marginBottom},root:{height:r.clientHeight,scrollHeight:r.scrollHeight,width:r.clientWidth,scrollWidth:r.scrollWidth},architecture:a&&{height:a.getBoundingClientRect().height,layoutCount:a.dataset.layoutCount,ready:a.dataset.architectureReady},input:document.querySelector('input')?.value};})()`);
        if (facts) return facts;
      }
      throw Error(`Missing content frame: ${name}`);
    };
    const complex = JSON.parse(fs.readFileSync(path.join(root, "test/fixtures/diagrams/architecture/height-fit.json"), "utf8"));
    const cases = [
      ["default-margin", "<!doctype html><html><body><section style='height:320px;border:1px solid #888;box-sizing:border-box'>Complete content<input value='Live input retained'></section></body></html>"],
      ["fractional-margin", "<!doctype html><html><head><style>body{margin:3.25px 8px 17.5px}main{height:320.25px;background:#e9f5f3}</style></head><body><main>Complete content<input value='Live input retained'></main></body></html>"],
      ["no-margin", "<!doctype html><html><body style='margin:0'><main style='height:120px'>Short content<input value='Live input retained'></main></body></html>"],
      ["collapsed-margin", "<!doctype html><html><body style='margin:8px'><main style='height:320px;margin-bottom:36px'>Trailing collapsed margin<input value='Live input retained'></main></body></html>"],
      ["architecture", architectureHtml(complex, { language:"zh-CN" })],
    ];
    for (const [name, source] of cases) {
      const html = source.replace(/<body(?=[ >])/, `<body data-fit-case="${name}"`);
      const created = await js(`fitMarginsTest.canvasAgentCreate({baseRevision:fitMarginsTest.state.userRevision,items:[{type:'widget',widgetType:'html_widget',pluginId:'general',title:${JSON.stringify(name)},width:1299,height:1039,html:${JSON.stringify(html)},placement:{mode:'absolute',x:100,y:100}}]},{preserveView:true,controller:new AbortController()})`);
      const id = created.receipts[0].objectId;
      await js(`fitMarginsTest.mcpRevealRegion({x:100,y:100,w:1299,h:1039},true)`);
      await until(() => js(`(()=>{const w=fitMarginsTest.state.widgets.find(w=>w.id===${JSON.stringify(id)});return w.mcpDocumentLoaded&&!w.autoContentHeight&&!w.contentFitRequest;})()`), `fit ${name}`);
      await pause(300);
      const before = await geometry(id), facts = await metrics(name);
      report.samples.push({ name, box:before, facts });
      if (!recordOnly) {
        assert.equal(before.fitContentAxes, "height", `${name}: automatically fitted`);
        assert.ok(facts.root.scrollHeight <= facts.root.height+1, `${name}: no document vertical overflow (${facts.root.scrollHeight-facts.root.height}px)`);
        assert.ok(facts.root.scrollWidth <= facts.root.width+1, `${name}: no document horizontal overflow`);
        if (name !== "architecture") assert.equal(facts.input, "Live input retained");
      }
      for (let cycle=0; cycle<3; cycle++) {
        await js(`fitMarginsTest.setWidgetMaximized(fitMarginsTest.state.widgets.find(w=>w.id===${JSON.stringify(id)}),true)`);
        await pause(250);
        for (const zoom of [70,40,100]) {
          await js(`fitMarginsTest.setWidgetPresentationZoom(fitMarginsTest.state.widgets.find(w=>w.id===${JSON.stringify(id)}),${zoom})`);
          await pause(100);
          const presentation = await js(`(()=>{const w=fitMarginsTest.state.widgets.find(w=>w.id===${JSON.stringify(id)});return {zoom:w.presentationZoom,label:w.presentationZoomControls.label.textContent,disabled:w.presentationZoomControls.zoomOut.disabled};})()`);
          assert.deepEqual(presentation, {zoom,label:`${zoom}%`,disabled:zoom===40});
          if (name === "architecture" && zoom === 40 && cycle === 2) fs.writeFileSync(path.join(output, "architecture-maximized-40.png"), (await win.webContents.capturePage()).toPNG());
        }
        await js(`fitMarginsTest.setWidgetMaximized(fitMarginsTest.state.widgets.find(w=>w.id===${JSON.stringify(id)}),false)`);
        await pause(250);
        const after = await geometry(id);
        assert.deepEqual(after, before, `${name}: maximize/zoom cycle ${cycle} preserves fitted geometry`);
      }
      for (let sample=0; sample<4; sample++) { await pause(150); assert.deepEqual(await geometry(id), before, `${name}: settled geometry stays constant`); }
      if (name === "architecture") {
        report.architectureSettled = await metrics(name);
        fs.writeFileSync(path.join(output, "architecture.png"), (await win.webContents.capturePage()).toPNG());
      }
      report.checks.push(`${name}: measurement and stable geometry through three maximize/zoom cycles`);
    }
    assert.deepEqual(report.errors, []);
    report.ok = true;
  } catch (error) { report.failure = error.stack; }
  finally {
    win?.destroy();
    if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
    report.serverClosed = !server?.listening;
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok:report.ok, checks:report.checks, failure:report.failure, samples:report.samples, serverClosed:report.serverClosed, output }, null, 2));
    fs.rmSync(temporary, { recursive:true, force:true });
    app.exit(report.ok ? 0 : 1);
  }
});
