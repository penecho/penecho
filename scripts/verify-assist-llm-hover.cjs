"use strict";
// Render the real Assist toolbar with isolated data and real mouse/keyboard input.
// Run: tools/electron/node_modules/.bin/electron scripts/verify-assist-llm-hover.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-llm-hover-"));
const output = path.resolve(process.env.PENECHO_VERIFY_OUTPUT || path.join(root, "docs/verification/assist-llm-hover-20260930"));
const cloud = process.argv.includes("--cloud"), runtime = cloud ? "cloud" : "local";
const clientRoot = cloud ? path.resolve(root, "../penecho_cloud/public/canvas") : path.join(root, "public");
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary,"state"), PENECHO_CONFIG_FILE:path.join(temporary,"config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const originalStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  const name = path.resolve(String(file));
  if (name === path.join(root, "public/app.js")) return Readable.from([fs.readFileSync(path.join(clientRoot,"app.js"),"utf8").replace(/\}\)\(\);\s*$/, "window.llmHoverTest={state,smartSuggest,canvasDocumentsReady,renderAssist,hideAssist};})();")]);
  if (name === path.join(root, "public/style.css")) return originalStream.call(this, path.join(clientRoot,"style.css"), ...args);
  return originalStream.call(this, file, ...args);
};
const report = { runtime, checks:[], layouts:[], errors:[] }, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, server;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({show:false,width:1200,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    win.webContents.on("console-message", (_event,level,message) => { if (level >= 3) report.errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const js = code => win.webContents.executeJavaScript(code, true);
    await js("llmHoverTest.canvasDocumentsReady().then(()=>{llmHoverTest.state.auto=false;llmHoverTest.smartSuggest.enabled=false;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelector('#canvasWelcome').hidden=true;})");
    win.webContents.debugger.attach("1.3");
    const move = async (x,y) => { await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type:"mouseMoved",x,y,button:"none"}); await pause(400); };
    const metrics = () => js(`(()=>{const b=document.querySelector('.assist-bar'),s=b.querySelector('.assist-spark'),l=s.querySelector('.penecho-llm-label'),q=s.querySelector('.penecho-llm-quota'),r=s.getBoundingClientRect(),lr=l.getBoundingClientRect();return {hover:s.matches(':hover'),text:l.textContent,labelWidth:lr.width,labelScrollWidth:l.scrollWidth,labelOpacity:getComputedStyle(l).opacity,quotaWidth:q.getBoundingClientRect().width,quotaScrollWidth:q.scrollWidth,x:r.x,y:r.y,w:r.width,h:r.height,labelRight:lr.right,layerRight:b.parentElement.getBoundingClientRect().right,justRanked:b.classList.contains('just-ranked')};})()`);
    const hidden = async label => { const m = await metrics(); assert.equal(m.labelWidth,0,label); assert.equal(m.labelOpacity,"0",label); return m; };
    const complete = async label => { const m = await metrics(); assert.equal(m.labelOpacity,"1",label); assert.ok(m.labelWidth+.5>=m.labelScrollWidth,label); assert.ok(m.quotaWidth+.5>=m.quotaScrollWidth,label); assert.ok(m.labelRight<=m.layerRight,label); return m; };
    for (const settings of [{width:1200,language:"en",rank:"ranked"},{width:390,language:"en",rank:"ranked"},{width:390,language:"zh",rank:"pending"},{width:1200,language:"en",rank:"refreshing"}]) {
      await move(2,2); win.setContentSize(settings.width,900); await pause(100);
      await js(`(()=>{const t=llmHoverTest,s=t.smartSuggest;t.hideAssist('test');t.state.language=${JSON.stringify(settings.language)};t.state.scale=1;t.state.panX=0;t.state.panY=0;s.enabled=true;s.available=true;s.access={signedIn:false,subscribed:false,freeLimit:200,used:195,remaining:5};s.controller=${settings.rank === "ranked" ? "null" : "{}"};const box={x:20,y:200,w:120,h:80},cluster={key:'hover-test',box,newBox:box,strokes:[]};const view=source=>({source,confident:false,items:[{id:'vivid',source},{id:'finish_drawing',source}],more:[],routing:{}});t.renderAssist({mode:'suggest',cluster,box,view:view('local')});t.renderAssist({mode:'suggest',cluster,box,view:view(${JSON.stringify(settings.rank === "pending" ? "local" : "penecho-llm")})});})()`);
      const initial = await hidden("Ranking leaves the name hidden");
      if (settings.rank === "ranked") assert.equal(initial.justRanked,true,"Check while the completion animation is active");
      await move(initial.x+initial.w/2,initial.y+initial.h/2);
      const hover = await complete("Hover shows the full name and allowance");
      assert.equal(hover.hover,true);
      if (settings.width === 1200 && settings.rank === "ranked") fs.writeFileSync(path.join(output,`${runtime}-hover.png`),(await win.webContents.capturePage()).toPNG());
      await move(2,2); await hidden("Moving away hides the name again");
      if (settings.width === 1200 && settings.rank === "ranked") fs.writeFileSync(path.join(output,`${runtime}-default.png`),(await win.webContents.capturePage()).toPNG());
      await js("document.activeElement?.blur();document.querySelector('.assist-spark').focus()");
      await pause(400); await complete("Keyboard focus shows the full name");
      await js("document.activeElement.blur()"); await pause(400); await hidden("Blur hides the name");
      report.layouts.push({settings,initial,hover});
    }
    report.checks.push("Name stays hidden during ranking completion; real hover shows all letters and allowance; mouse leave hides it; keyboard focus reveals it. Desktop and 390 px layouts pass across ranked, pending and refreshing states, in English and Chinese.");
    assert.deepEqual(report.errors,[]);
  } catch (error) {
    report.failure = error.stack; console.error(error); process.exitCode = 1;
    if (win) fs.writeFileSync(path.join(output,`${runtime}-failure.png`),(await win.webContents.capturePage()).toPNG());
  } finally {
    fs.writeFileSync(path.join(output,`${runtime}-report.json`),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
    win?.destroy(); server?.closeAllConnections(); if(server) await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temporary,{recursive:true,force:true}); app.exit(process.exitCode || 0);
  }
});
