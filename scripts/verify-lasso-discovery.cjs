"use strict";
// Isolated Electron UI acceptance. No user data or model requests.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lasso-discovery-"));
const output = path.resolve(process.env.PENECHO_VERIFY_OUTPUT || path.join(root, "docs/verification/lasso-discovery-20261003"));
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) {
    const source = fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, "window.lassoDiscovery={state,smartSuggest,canvasDocumentsReady,applyLanguage,applyPageScale,setCanvasHintsEnabled};})();");
    return Readable.from([source]);
  }
  return readStream.call(this, file, ...args);
};
const report = { checks:[], layouts:[], errors:[] }, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, win;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1440, height:900, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false } });
    const js = source => win.webContents.executeJavaScript(source, true);
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    const initialize = async () => {
      await js("(async()=>{const t=lassoDiscovery;await t.canvasDocumentsReady();t.state.auto=false;t.smartSuggest.enabled=false;t.state.language='zh';t.applyLanguage();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();})()");
      await pause(150);
    };
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await initialize();
    await js("lassoDiscovery.setCanvasHintsEnabled(false);document.querySelector('#lassoToolBtn').click()");
    assert.equal(await js("localStorage.getItem('penecho-lasso-guidance-seen-v1')"), null);
    await js("document.querySelector('#penToolBtn').click();lassoDiscovery.setCanvasHintsEnabled(true);document.querySelector('#lassoToolBtn').click()");
    assert.equal(await js("lassoDiscovery.state.canvasHintKey"), "canvasHintLassoFirstUse");
    assert.equal(await js("document.querySelector('#canvasHint').textContent"), "圈出你想了解的部分，再点击「提问」。");
    assert.equal(await js("document.querySelector('#canvasHint').hidden"), false);
    assert.equal(await js("localStorage.getItem('penecho-lasso-guidance-seen-v1')"), "true");
    await pause(150);
    fs.writeFileSync(path.join(output,"first-use-hint.png"), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#penToolBtn').click();document.querySelector('#lassoToolBtn').click()");
    assert.notEqual(await js("lassoDiscovery.state.canvasHintKey"), "canvasHintLassoFirstUse");
    await new Promise(resolve => { win.webContents.once("did-finish-load", resolve); win.reload(); });
    await initialize();
    await js("document.querySelector('#penToolBtn').click();document.querySelector('#lassoToolBtn').click()");
    assert.notEqual(await js("lassoDiscovery.state.canvasHintKey"), "canvasHintLassoFirstUse");
    report.checks.push("First-use guidance is deterministic, respects disabled hints, and does not repeat after tool switching or reloading");

    win.webContents.debugger.attach("1.3");
    const mouse = (x,y) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type:"mouseMoved", x, y, button:"none" });
    const hover = async () => {
      await mouse(5,500);
      await js("document.querySelector('#lassoToolBtn').scrollIntoView({block:'nearest',inline:'center'})");
      const p = await js("(()=>{const r=document.querySelector('#lassoToolBtn').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
      await mouse(p.x,p.y);
      await pause(450);
      assert.match(await js("lassoDiscovery.state.canvasHintKey"), /^canvasHintLassoDiscover(?:Compact)?$/);
    };
    for (const [name,width,language,theme,zoom,pageScale=1] of [
      ["zh-wide",1440,"zh","studio",1], ["en-wide",1440,"en","studio",1],
      ["zh-narrow",390,"zh","studio",1], ["en-narrow",390,"en","studio",1],
      ["zh-dark",1440,"zh","scifi",1], ["zh-zoom-200",1440,"zh","studio",2],
      ["zh-ui-scale-125",1440,"zh","studio",1,1.25], ["en-ui-scale-90",1024,"en","studio",1,.9],
    ]) {
      win.webContents.setZoomFactor(zoom);win.setContentSize(width,900);
      // This BrowserWindow has no desktop preload; exercise web CSS scaling explicitly.
      await js(`window.PENECHO_CONFIG={...window.PENECHO_CONFIG,desktopApp:false};lassoDiscovery.state.language=${JSON.stringify(language)};lassoDiscovery.applyLanguage();document.body.dataset.theme=${JSON.stringify(theme)};lassoDiscovery.applyPageScale(${pageScale})`);
      await pause(120);await hover();
      const layout = await js("(()=>{const e=document.querySelector('#canvasHint'),b=document.querySelector('#lassoToolBtn'),r=e.getBoundingClientRect(),s=b.querySelector('svg');return {text:e.textContent,x:r.x,y:r.y,w:r.width,h:r.height,viewport:{w:innerWidth,h:innerHeight},overflow:e.scrollWidth>e.clientWidth,parent:e.parentElement.id,hidden:e.hidden,icon:{w:s.getBoundingClientRect().width,h:s.getBoundingClientRect().height},nativeTitle:b.getAttribute('title'),extraTooltip:!!document.querySelector('#lassoToolHint')};})()");
      assert.equal(layout.parent,"pageHintSlot","Guidance stays in the existing shared hint slot");
      assert.equal(layout.hidden,false);assert.equal(layout.extraTooltip,false);assert.equal(layout.nativeTitle,null);
      assert.equal(layout.overflow,false,`${name}: copy fits the existing hint line`);
      assert.ok(layout.x>=0 && layout.y>=0 && layout.x+layout.w<=layout.viewport.w+1 && layout.y+layout.h<=layout.viewport.h+1,`${name}: shared hint stays in view`);
      assert.match(layout.text,language === "zh" ? /圈住内容，直接问 AI/ : /Circle content and ask AI/);
      assert.ok(layout.icon.w/pageScale>=14 && layout.icon.w/pageScale<=20,"The icon retains the existing glyph size");
      report.layouts.push({name,...layout});
      fs.writeFileSync(path.join(output,name+".png"),(await win.webContents.capturePage()).toPNG());
      if(name === "zh-wide") {
        const crop=await js("(()=>{const a=document.querySelector('.mode-tools').getBoundingClientRect(),b=document.querySelector('#canvasHint').getBoundingClientRect(),x=Math.max(0,Math.min(a.x,b.x)-8),y=Math.max(0,Math.min(a.y,b.y)-8);return {x:Math.floor(x),y:Math.floor(y),width:Math.ceil(Math.min(innerWidth,Math.max(a.right,b.right)+8)-x),height:Math.ceil(Math.min(innerHeight,Math.max(a.bottom,b.bottom)+8)-y)};})()");
        fs.writeFileSync(path.join(output,"toolbar-detail.png"),(await win.webContents.capturePage(crop)).toPNG());
      }
    }
    report.checks.push("Hover guidance uses the existing hint slot in Chinese/English, wide/narrow, dark theme, Electron 200% zoom and 90/125% interface scales");
    win.webContents.setZoomFactor(1);win.setContentSize(1440,900);
    await js("document.body.dataset.theme='studio';lassoDiscovery.applyPageScale(1)");
    await mouse(5,500);
    await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent",{type:"keyDown",key:"F8",code:"F8",windowsVirtualKeyCode:119});
    await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent",{type:"keyUp",key:"F8",code:"F8",windowsVirtualKeyCode:119});
    await js("document.querySelector('#lassoToolBtn').focus()");
    assert.match(await js("lassoDiscovery.state.canvasHintKey"),/^canvasHintLassoDiscover(?:Compact)?$/);
    assert.match(await js("document.querySelector('#lassoToolBtn').getAttribute('aria-label')"),/ask AI/);
    await js("lassoDiscovery.setCanvasHintsEnabled(false)");await hover();
    assert.equal(await js("document.querySelector('#canvasHint').hidden"),true);
    report.checks.push("Keyboard focus shows the same guidance and disabled hints remain hidden");
    assert.deepEqual(report.errors,[]);
  } catch(error) {
    report.failure=error.stack;process.exitCode=1;
  } finally {
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
    console.log(JSON.stringify({checks:report.checks,errors:report.errors,failure:report.failure,output},null,2));
    win?.destroy();if(server)await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode || 0);
  }
});
