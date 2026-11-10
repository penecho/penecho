"use strict";
// Run with tools/electron/node_modules/.bin/electron. No user data or model calls.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lasso-capture-")),
  baseline = process.argv.includes("--baseline"),
  output = path.resolve(process.env.PENECHO_VERIFY_OUTPUT || path.join(root, "docs/verification/lasso-capture-20261003", baseline ? "before" : "after"));
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) {
    const injection = "window.lassoCapture={state,tiles,TILE,smartSuggest,canvasDocumentsReady,loadCanvasSettings,stroke,save,render,setCanvasMode,restoreWidgets,captureSelection,cancelSelection,commitSelection,undo,redo,applySelectionColor,selectionPathFor,updateSelectionObjects,canvasAgentCapture,canvasAgentContentBounds};";
    return Readable.from([fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, injection + "})();")]);
  }
  return readStream.call(this, file, ...args);
};
const report = { baseline, checks:[], captures:[], errors:[] }, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, win;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1440, height:1000, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false } });
    const js = code => win.webContents.executeJavaScript(code, true);
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await js("(async()=>{const t=lassoCapture;await t.canvasDocumentsReady();await t.loadCanvasSettings();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();t.state.auto=false;t.smartSuggest.enabled=false;t.state.scale=1;t.state.panX=t.state.panY=0;t.setCanvasMode('select');})()");
    const widget = { id:"widget-1", pluginId:"general", widgetType:"html_widget", x:430, y:210, w:320, h:240, contentW:320, contentH:240, title:"Context stays in place", refreshSeconds:0,
      html:'<!doctype html><html><body style="margin:0;background:#eef2ff"><h3>Widget context</h3><p>Moved handwriting stays visible beside this card.</p></body></html>' };
    await js(`(()=>{const t=lassoCapture;t.restoreWidgets([${JSON.stringify(widget)}]);t.stroke({x:480,y:285},{x:560,y:285},false,12,false,'#cc2277');t.save();t.captureSelection([{x:460,y:250},{x:580,y:250},{x:580,y:330},{x:460,y:330}]);t.render();})()`);
    const tilePixel = (x,y) => js(`(()=>{const t=lassoCapture,c=t.tiles.get(Math.floor(${x}/t.TILE)+','+Math.floor(${y}/t.TILE));return c?Array.from(c.getContext('2d').getImageData(${x}%t.TILE,${y}%t.TILE,1,1).data):[0,0,0,0];})()`);
    const selectionState = () => js("(()=>{const t=lassoCapture,s=t.state,l=s.selection;return {revision:s.userRevision,history:s.history.length,historyBefore:s.historyBefore.size,regionOnly:l.regionOnly,box:{...l.box},fragments:l.fragments.length,color:l.color,widgets:s.widgets.map(({id,x,y,w,h})=>({id,x,y,w,h}))};})()");
    const capture = async (name,args,sample,expected = [204,34,119]) => {
      const result = await js(`lassoCapture.canvasAgentCapture(${JSON.stringify({ ...args, coordinates:"none" })},{})`);
      fs.writeFileSync(path.join(output, name + "." + result.mediaType.split("/")[1]), Buffer.from(result.dataUrl.split(",")[1], "base64"));
      const pixels = await js(`(async()=>{const image=new Image();image.src=${JSON.stringify(result.dataUrl)};await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const q=c.getContext('2d');q.drawImage(image,0,0);const x=Math.floor((${sample.x}-${result.mapping.origin.x})*${result.mapping.pixelsPerLogicalUnit.x}),y=Math.floor((${sample.y}-${result.mapping.origin.y})*${result.mapping.pixelsPerLogicalUnit.y});return x<0||y<0||x>=c.width||y>=c.height?null:Array.from(q.getImageData(x,y,1,1).data);})()`);
      const matches = pixels && pixels[3] > 240 && expected.every((value,index) => Math.abs(value - pixels[index]) < 20);
      report.captures.push({ name, target:args.target, pixels, matches:Boolean(matches), region:result.logicalRegion });
      if (!baseline) assert.ok(matches, `${name} includes the current selection's ink at its displayed location`);
      return result;
    };
    const initial = await selectionState();
    await capture("unmoved-region", { target:"region", region:{x:460,y:250,w:120,h:80}, quality:"detail" }, {x:500,y:285});
    assert.deepEqual(await selectionState(), initial, "circling and capturing do not lift or mutate ink");
    win.webContents.debugger.attach("1.3");
    const point = (x,y) => js(`(()=>{const s=lassoCapture.state,r=document.querySelector('#screen').getBoundingClientRect();return {x:r.x+s.panX+${x}*s.scale,y:r.y+s.panY+${y}*s.scale};})()`),
      mouse = (type,p,extra={}) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type, x:p.x, y:p.y, button:type === "mouseMoved" ? "none" : "left", ...extra }),
      from = await point(520,285), to = await point(1020,385);
    await mouse("mouseMoved",from);await mouse("mousePressed",from,{buttons:1,clickCount:1});
    for(let i=1;i<=6;i++)await mouse("mouseMoved",{x:from.x+(to.x-from.x)*i/6,y:from.y+(to.y-from.y)*i/6},{button:"left",buttons:1});
    await mouse("mouseReleased",to,{buttons:0,clickCount:1});await pause(100);
    const moved = await selectionState();
    assert.equal(moved.regionOnly,false);assert.ok(moved.fragments >= 2,"the fixture lifts cross-tile ink");
    assert.equal((await tilePixel(500,285))[3],0,"source pixels are lifted from the backing tiles");
    fs.writeFileSync(path.join(output,"visible-selection.png"),(await win.webContents.capturePage()).toPNG());
    for(const [name,args] of [
      ["moved-selection",{target:"selection",quality:"basic"}],
      ["moved-region",{target:"region",region:{x:900,y:330,w:240,h:150},quality:"detail"}],
      ["moved-viewport",{target:"viewport",quality:"basic"}],
      ["moved-canvas",{target:"canvas",quality:"basic"}],
    ])await capture(name,args,{x:1000,y:385});
    assert.deepEqual(await selectionState(),moved,"all screenshot targets preserve the active lasso, geometry, revision and history");
    if (baseline) {
      assert.equal(report.captures.find(capture => capture.name === "moved-selection").matches,true);
      for (const name of ["moved-region","moved-viewport","moved-canvas"]) assert.equal(report.captures.find(capture => capture.name === name).matches,false);
      report.checks.push("Baseline reproduces missing moved ink in region, viewport and Canvas captures while the selection capture retains it");
    } else report.checks.push("Unmoved and moved lassos retain ink in selection, region, viewport and whole-Canvas captures without committing or cancelling them");
    if (!baseline) {
      await js("(()=>{const t=lassoCapture,l=t.state.selection;l.box.w*=1.5;l.box.h*=1.25;l.path=t.selectionPathFor(l);t.updateSelectionObjects(l);t.applySelectionColor('#228855');t.render();})()");
      const resized = await selectionState();
      await capture("resized-recolored-region",{target:"region",region:{x:900,y:330,w:300,h:180},quality:"detail"},{x:1020,y:394},[34,136,85]);
      assert.deepEqual(await selectionState(),resized);
      await js("lassoCapture.restoreWidgets([])");
      await capture("lifted-ink-only-canvas",{target:"canvas",quality:"basic"},{x:1020,y:394},[34,136,85]);
      const bounds = await js("lassoCapture.canvasAgentContentBounds()");
      assert.ok(bounds.x >= 980 && bounds.x+bounds.w > 1070,"whole-Canvas bounds follow lifted ink instead of its empty source tiles");
      await js("lassoCapture.cancelSelection()");
      assert.ok((await tilePixel(500,285))[3]>240,"cancellation restores original ink");
      assert.equal((await tilePixel(1020,394))[3],0);
      report.checks.push("Resized and recolored fragments render at current geometry; lifted-ink-only Canvas bounds are correct; cancellation retains original ink");
    }
    assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report,null,2));
  } catch(error) {
    report.failure = error.stack;console.error(error);
    if(win)fs.writeFileSync(path.join(output,"failure.png"),(await win.webContents.capturePage()).toPNG());
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
    win?.destroy();server?.close();app.exit(process.exitCode || 0);
  }
});
