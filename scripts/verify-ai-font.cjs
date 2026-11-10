"use strict";
// Run: tools/electron/node_modules/.bin/electron scripts/verify-ai-font.cjs
// Uses canonical client source and an isolated local server/profile.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-ai-font-"));
const output = path.join(root, "docs/verification/ai-font-20260930");
const rounded = "ui-rounded, system-ui, sans-serif", handwritten = "Bradley Hand, Segoe Print, Comic Sans MS, cursive";
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" });
const createReadStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) {
    const source = fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, "window.aiFontTest={state,canvasDocumentsReady,textRasterMetrics,textImage,mixedTextImage,canvasAgentPrepareCreateItems,viewportRect,render,openSettings,closeSettings,selectSettingsPage};})();");
    return Readable.from([source]);
  }
  return createReadStream.call(this, file, ...args);
};
const report = { checks:[], runtimeErrors:[] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, win;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1280, height:850, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false } });
    const js = source => win.webContents.executeJavaScript(source, true);
    const load = async () => {
      await win.loadURL(`http://127.0.0.1:${server.address().port}`);
      await js("aiFontTest.canvasDocumentsReady().then(()=>{aiFontTest.state.auto=false;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();})");
    };
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.runtimeErrors.push(message); });
    await load();
    assert.equal(await js("localStorage.getItem('penecho-ai-font')"), null);
    assert.equal(await js("aiFontTest.state.aiFont"), rounded);
    assert.equal(await js("document.querySelector('#aiFont').value"), rounded);
    report.checks.push("A fresh profile defaults to Rounded in state and Settings");
    const rendered = await js(`(async()=>{
      const t=aiFontTest, v=t.viewportRect(), images=[t.textImage('Canvas AI response',30,'#375b68'),t.textImage('Fallback text',30,'#375b68',600,1.35,null),await t.mixedTextImage('**Canvas AI** response',30,'#375b68',600,1.35,null,1)];
      const items=await t.canvasAgentPrepareCreateItems([{type:'text',text:'Canvas AI · Rounded\\nAI 返回的文字默认使用 Rounded。',fontSize:34,maxWidth:720,placement:{mode:'absolute',x:Math.round(v.x+100),y:Math.round(v.y+100)}}]);
      t.state.textBoxes=items.map(item=>item.record);t.render();
      return {fonts:images.map(image=>image.getContext('2d').font),metricsFallback:t.textRasterMetrics('Fallback',30,600,1.35,null).family,agentFont:items[0].record.fontFamily,width:items[0].record.w,height:items[0].record.h};
    })()`);
    rendered.fonts.forEach(font => assert.match(font, /ui-rounded/));
    assert.equal(rendered.metricsFallback, rounded);
    assert.equal(rendered.agentFont, rounded);
    assert.ok(rendered.width > 0 && rendered.height > 0);
    report.rendered = rendered;
    report.checks.push("AI plain text, mixed text, missing-family fallbacks and Canvas Agent text render with Rounded");
    await pause(300);
    fs.writeFileSync(path.join(output, "canvas-rounded.png"), (await win.webContents.capturePage()).toPNG());
    await js("aiFontTest.openSettings();aiFontTest.selectSettingsPage('canvas');document.querySelector('#aiFont').scrollIntoView({block:'center'});");
    await pause(200);
    fs.writeFileSync(path.join(output, "settings-rounded.png"), (await win.webContents.capturePage()).toPNG());
    for (const [stored, expected] of [[handwritten,handwritten],["Segoe Print, Comic Sans MS, cursive",handwritten],["Georgia, serif","Georgia, serif"],["invalid-font",rounded]]) {
      await js(`localStorage.setItem('penecho-ai-font',${JSON.stringify(stored)})`);
      await load();
      assert.equal(await js("aiFontTest.state.aiFont"), expected);
      await js("aiFontTest.openSettings();aiFontTest.selectSettingsPage('canvas');");
      assert.equal(await js("document.querySelector('#aiFont').value"), expected);
    }
    report.checks.push("Explicit Handwritten/serif choices survive reload, legacy handwriting is normalized, invalid preferences use Rounded");
    await js(`(()=>{const select=document.querySelector('#aiFont');select.value=${JSON.stringify(handwritten)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    assert.equal(await js("localStorage.getItem('penecho-ai-font')"), handwritten);
    await load();
    assert.equal(await js("aiFontTest.state.aiFont"), handwritten);
    report.checks.push("Changing the Settings control persists the user's explicit choice");
    assert.deepEqual(report.runtimeErrors, []);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.failure = error.stack;
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    fs.createReadStream = createReadStream;
    win?.destroy();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
    fs.rmSync(temporary, { recursive:true, force:true });
    app.exit(process.exitCode || 0);
  }
});
