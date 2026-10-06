"use strict";
// Isolated Electron acceptance for tool animation lifecycles. No model calls.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lasso-animation-"));
const output = path.resolve(process.env.PENECHO_VERIFY_OUTPUT || path.join(root, "docs/verification/lasso-animation-20261004"));
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary,"state"), PENECHO_CONFIG_FILE:path.join(temporary,"config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root,"public/app.js")) {
    const source = fs.readFileSync(file,"utf8").replace(/\}\)\(\);\s*$/, "window.lassoAnimation={state,smartSuggest,canvasDocumentsReady,setCanvasMode,syncCanvasModePresentation,playLassoShimmer};})();");
    return Readable.from([source]);
  }
  return readStream.call(this,file,...args);
};
const report = { checks:[], states:[], errors:[] }, pause = ms => new Promise(resolve => setTimeout(resolve,ms));
let server, win;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening",resolve));
    win = new BrowserWindow({show:false,width:1440,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const js = source => win.webContents.executeJavaScript(source,true);
    win.webContents.on("console-message", (_event,level,message) => { if(level>=3)report.errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await js("(async()=>{const t=lassoAnimation;await t.canvasDocumentsReady();t.state.auto=false;t.smartSuggest.enabled=false;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();t.setCanvasMode('pen');})()");
    win.webContents.debugger.attach("1.3");
    const point = id => js(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    const mouse = (type,p,extra={}) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type,x:p.x,y:p.y,button:type==="mouseMoved"?"none":"left",...extra});
    const click = async id => { const p=await point(id);await mouse("mouseMoved",p);await mouse("mousePressed",p,{buttons:1,clickCount:1});await mouse("mouseReleased",p,{buttons:0,clickCount:1});await pause(40); };
    const key = async (value,code,keyCode) => { for(const type of ["keyDown","keyUp"])await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent",{type,key:value,code,windowsVirtualKeyCode:keyCode});await pause(40); };
    const snapshot = async name => {
      const value=await js("(()=>{const b=document.querySelector('#lassoToolBtn'),loop=b.querySelector('.lasso-loop');return {mode:lassoAnimation.state.mode,active:b.classList.contains('active'),hover:b.matches(':hover'),focus:b===document.activeElement,focusVisible:b.matches(':focus-visible'),preview:b.classList.contains('lasso-preview'),shimmer:b.classList.contains('lasso-shimmer'),loopIterations:getComputedStyle(loop).animationIterationCount,running:b.getAnimations({subtree:true}).filter(a=>a.playState==='running'&&a.animationName?.startsWith('lasso-')).map(a=>({name:a.animationName,iterations:a.effect.getTiming().iterations===Infinity?'infinite':a.effect.getTiming().iterations}))};})()");
      report.states.push({name,...value});return value;
    };

    await mouse("mouseMoved",await point("lassoToolBtn"));await pause(80);
    let value=await snapshot("inactive-hover-start");
    assert.equal(value.active,false);assert.equal(value.preview,true);assert.equal(value.loopIterations,"1");assert.ok(value.running.length);
    await pause(1250);value=await snapshot("inactive-hover-finished");
    assert.equal(value.hover,true);assert.deepEqual(value.running,[]);
    report.checks.push("Inactive hover plays once and stays still while the pointer remains over the icon");

    await click("lassoToolBtn");value=await snapshot("active-lasso");
    assert.equal(value.mode,"select");assert.equal(value.active,true);assert.equal(value.loopIterations,"infinite");
    assert.ok(value.running.some(a=>a.name==="lasso-march"&&a.iterations==="infinite"));
    await key("p","KeyP",80);value=await snapshot("keyboard-switch-with-retained-hover");
    assert.equal(value.mode,"pen");assert.equal(value.hover,true);assert.equal(value.active,false);
    assert.equal(value.preview,false);assert.equal(value.shimmer,false);assert.deepEqual(value.running,[]);
    await pause(500);value=await snapshot("retained-hover-stays-still");assert.deepEqual(value.running,[]);assert.equal(value.preview,false);
    report.checks.push("The Pen shortcut immediately stops Lasso animation even with the pointer still hovering over it");

    await mouse("mouseMoved",{x:5,y:500});await mouse("mouseMoved",await point("lassoToolBtn"));await pause(80);
    value=await snapshot("new-pointer-hover");assert.equal(value.preview,true);assert.equal(value.loopIterations,"1");assert.ok(value.running.length);
    report.checks.push("A new pointer visit can still play the one-off preview after tool switching");

    await mouse("mouseMoved",{x:5,y:500});await key("F8","F8",119);
    await js("document.querySelector('#lassoToolBtn').focus();lassoAnimation.setCanvasMode('select')");
    await pause(40);value=await snapshot("active-with-keyboard-focus");
    assert.equal(value.focusVisible,true);assert.equal(value.loopIterations,"infinite");
    await js("lassoAnimation.setCanvasMode('hand')");await pause(40);value=await snapshot("switch-with-retained-keyboard-focus");
    assert.equal(value.focusVisible,true);assert.equal(value.mode,"hand");assert.equal(value.preview,false);assert.deepEqual(value.running,[]);
    report.checks.push("Retained keyboard focus does not restart animation after switching to Hand");

    await js("document.querySelector('#lassoToolBtn').blur();lassoAnimation.setCanvasMode('pen');lassoAnimation.playLassoShimmer();lassoAnimation.syncCanvasModePresentation()");
    await pause(80);value=await snapshot("discovery-shimmer");assert.equal(value.shimmer,true);assert.ok(value.running.length);
    await click("handToolBtn");value=await snapshot("mouse-switch-cancels-shimmer");
    assert.equal(value.mode,"hand");assert.equal(value.shimmer,false);assert.deepEqual(value.running,[]);
    report.checks.push("Mouse tool switching cancels the discovery flash immediately; re-syncing the same tool preserves a valid cue");
    const crop=await js("(()=>{const r=document.querySelector('.mode-tools').getBoundingClientRect();return {x:Math.floor(r.x-8),y:Math.floor(r.y-8),width:Math.ceil(r.width+16),height:Math.ceil(r.height+16)};})()");
    fs.writeFileSync(path.join(output,"inactive-toolbar.png"),(await win.webContents.capturePage(crop)).toPNG());

    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
    await js("lassoAnimation.setCanvasMode('select');lassoAnimation.playLassoShimmer()");await pause(80);value=await snapshot("reduced-motion");
    assert.equal(value.shimmer,false);assert.deepEqual(value.running,[]);
    report.checks.push("Reduced-motion preference disables all Lasso animation");
    assert.deepEqual(report.errors,[]);
  } catch(error) {
    report.failure=error.stack;process.exitCode=1;
  } finally {
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
    console.log(JSON.stringify({checks:report.checks,errors:report.errors,failure:report.failure,output},null,2));
    win?.destroy();if(server)await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode||0);
  }
});
