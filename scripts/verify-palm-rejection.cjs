"use strict";
// Isolated renderer acceptance with native DevTools touch and synthetic pen.
// This checks browser routing, not physical digitizer palm classification.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"),
  assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-palm-")),
  output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || path.join(root,"docs/verification/palm-rejection-20261004"));
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) {
    const injection = "window.palmTest={state,canvasDocumentsReady,render,setCanvasMode,setSmartSuggestEnabled,resetCanvasPalmRejection,setCanvasViewMode,penGap:()=>performance.now()-canvasPalmLastPenAt};})();";
    return Readable.from([fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, injection)]);
  }
  return readStream.call(this, file, ...args);
};
const report = { checks:[], errors:[], physicalTouchDeviceTested:false, input:"Native DevTools touch contacts and synthetic PointerEvent pen input" };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i=0;i<100;i++) { if (await check()) return; await pause(100); }
  throw Error(`Timed out: ${label}`);
}
let server, win;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1280, height:900, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    const js = code => win.webContents.executeJavaScript(code, true);
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await until(()=>js("!!window.palmTest"), "client startup");
    await js("palmTest.canvasDocumentsReady().then(()=>true)");
    await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();palmTest.state.auto=false;palmTest.setSmartSuggestEnabled(false)");
    win.webContents.debugger.attach("1.3");
    let touchActive=false;
    const touch = async (type, points=[]) => {
      await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {type,touchPoints:points.map(([id,x,y,radiusX=2,radiusY=2])=>({id,x,y,radiusX,radiusY,force:1}))});
      touchActive=points.length>0;
    };
    const camera = () => js("({x:palmTest.state.panX,y:palmTest.state.panY,scale:palmTest.state.scale})");
    const reset = async (mode="pen") => {
      if(touchActive)await touch("touchCancel");
      await js(`palmTest.setCanvasViewMode(false);palmTest.resetCanvasPalmRejection({type:'blur'});palmTest.setCanvasMode(${JSON.stringify(mode)});Object.assign(palmTest.state,{scale:1,panX:0,panY:0,panGesture:null,touchGesture:null});palmTest.state.pointers.clear();palmTest.state.touches.clear();palmTest.render()`);
      await pause(100);
    };
    await reset();
    let p;
    await until(async()=>{
      p=await js("(()=>{const screen=document.querySelector('#screen'),r=document.querySelector('#viewport').getBoundingClientRect();for(let dy=.3;dy<.8;dy+=.1)for(let dx=.5;dx<.9;dx+=.1){const x=r.left+r.width*dx,y=r.top+r.height*dy;if(document.elementFromPoint(x,y)===screen)return {x,y};}return null})()");
      return Boolean(p);
    },"unobstructed Canvas input surface");
    const pen = (type, buttons=type==="pointerdown"?1:0) => js(`document.querySelector('#screen').dispatchEvent(new PointerEvent(${JSON.stringify(type)},{bubbles:true,cancelable:true,pointerId:91,pointerType:'pen',isPrimary:true,button:0,buttons:${buttons},pressure:${buttons ? 0.5 : 0},clientX:${p.x-100},clientY:${p.y-100}}))`);
    const drag = async (id=1) => {await touch("touchStart",[[id,p.x,p.y]]);await touch("touchMove",[[id,p.x+40,p.y+20]]);await touch("touchEnd");};

    const initial=await camera();
    await touch("touchStart",[[1,p.x,p.y]]);await touch("touchMove",[[1,p.x+4,p.y+3]]);await touch("touchEnd");
    assert.deepEqual(await camera(),initial);
    await drag();assert.ok((await camera()).x>30);
    report.checks.push("Single-finger jitter keeps the camera fixed; intentional finger dragging still pans");

    await reset();
    await touch("touchStart",[[1,p.x,p.y],[2,p.x+100,p.y]]);
    await touch("touchMove",[[1,p.x-40,p.y],[2,p.x+140,p.y]]);await touch("touchEnd");
    assert.ok((await camera()).scale>1.5);
    report.checks.push("Two clean fingers still pinch to zoom");

    await reset();
    await touch("touchStart",[[1,p.x,p.y,30,12]]);
    assert.equal(await js("palmTest.state.touches.size"),0);
    await touch("touchMove",[[1,p.x+50,p.y+30,2,2]]);await touch("touchEnd");
    assert.deepEqual(await camera(),initial);
    report.checks.push("A large palm contact cannot pan or become a finger when its reported area shrinks");

    await reset();
    await touch("touchStart",[[1,p.x,p.y]]);
    await pen("pointermove");
    assert.equal(await js("palmTest.state.touches.size"),0);
    await pause(750);await touch("touchMove",[[1,p.x+50,p.y+30]]);await touch("touchEnd");
    assert.deepEqual(await camera(),initial);
    await drag();assert.ok((await camera()).x>30);
    report.checks.push("Pen hover cancels an earlier resting contact until lift; a fresh finger drag works afterwards");

    await reset();await pen("pointerdown");
    await touch("touchStart",[[1,p.x,p.y]]);await touch("touchMove",[[1,p.x+50,p.y+30]]);
    assert.equal(await js("palmTest.state.drawing?.pointerType"),"pen");
    assert.deepEqual(await camera(),initial);await touch("touchEnd");await pen("pointerup");
    await touch("touchStart",[[1,p.x,p.y]]);await pause(750);await touch("touchMove",[[1,p.x+50,p.y+30]]);await touch("touchEnd");
    assert.deepEqual(await camera(),initial);
    await drag();assert.ok((await camera()).x>30);
    report.checks.push("Live pen writing and pen-up gaps reject touch; a rejected contact stays blocked beyond the gap");

    for (const mode of ["hand","view","space"]) {
      await reset();await pen("pointermove");
      if(mode==="hand") await js("palmTest.setCanvasMode('hand')");
      else if(mode==="view") await js("palmTest.setCanvasViewMode(true)");
      else await js("palmTest.state.spacePan=true");
      await drag();assert.ok((await camera()).x>30,mode);
      if(mode==="space") await js("palmTest.state.spacePan=false");
    }
    report.checks.push("Hand, View and Space pan allow deliberate finger navigation immediately after pen hover");

    await reset();await pen("pointermove");
    const mouse = (type,x,y,button,buttons) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type,x,y,button,buttons,clickCount:1});
    await mouse("mousePressed",p.x,p.y,"middle",4);await mouse("mouseMoved",p.x+40,p.y+20,"middle",4);await mouse("mouseReleased",p.x+40,p.y+20,"middle",0);
    assert.ok((await camera()).x>30);
    report.checks.push("Middle-button mouse pan remains available during the pen gap");
    report.passed=true;
  } catch(error) {
    report.passed=false;report.failure=error.stack;process.exitCode=1;
  } finally {
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    if(win&&!win.isDestroyed())win.destroy();
    if(server)await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temporary,{recursive:true,force:true});
    app.exit(report.passed?0:1);
  }
});
