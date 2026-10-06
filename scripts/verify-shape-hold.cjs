"use strict";
// Real stylus routing for hold-to-snap, using canonical assets and isolated data.
// Run: tools/electron/node_modules/.bin/electron scripts/verify-shape-hold.cjs
const {app, BrowserWindow} = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict"), {Readable} = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-shape-hold-")),
  output = path.join(root, "docs/verification/shape-hold-20261002");
fs.mkdirSync(output, {recursive:true});
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, {NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary,"state"),
  PENECHO_CONFIG_FILE:path.join(temporary,"config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only",
  AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false"});
const createReadStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root,"public/app.js")) return Readable.from([fs.readFileSync(file,"utf8").replace(/\}\)\(\);\s*$/, `
    window.shapeTest={state,smartSuggest,penIntel,tiles,canvasDocumentsReady,loadCanvasSettings,closeCanvasAgent,setCanvasMode,render,undo,redo,hideAssist,setSmartSuggestEnabled,clearDirtyContributionTracking};
  })();`)]);
  return createReadStream.call(this, file, ...args);
};
const report = {checks:[], cases:[], errors:[]}, pause = ms => new Promise(resolve => setTimeout(resolve,ms));
let server, win;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening",resolve));
    win = new BrowserWindow({show:false, width:1200, height:900, webPreferences:{contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true}});
    win.webContents.on("console-message", (_event, level, message) => {if (level >= 3) report.errors.push(message);});
    const js = code => win.webContents.executeJavaScript(code,true),
      shot = async name => fs.writeFileSync(path.join(output, name + ".png"), (await win.webContents.capturePage()).toPNG());
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await js(`(async()=>{const t=shapeTest,s=t.state;await t.canvasDocumentsReady();await t.loadCanvasSettings();
      document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();t.closeCanvasAgent();
      if(document.querySelector('#studioNavigatorToggle')?.getAttribute('aria-expanded')==='true')document.querySelector('#studioNavigatorToggle').click();
      s.auto=false;s.language='en';s.scale=1;s.panX=0;s.panY=0;t.smartSuggest.enabled=true;t.smartSuggest.available=false;
      t.penIntel.settings.gestures=false;t.penIntel.settings.stepCheck=false;t.setCanvasMode('pen');t.render();})()`);
    await pause(250);
    win.webContents.debugger.attach("1.3");
    const mouse = (type, p, extras = {}) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type, ...p, pointerType:"pen", ...extras}),
      move = p => mouse("mouseMoved",p,{button:"left",buttons:1}),
      start = async p => {await mouse("mouseMoved",p,{button:"none"});await mouse("mousePressed",p,{button:"left",buttons:1,clickCount:1});},
      release = p => mouse("mouseReleased",p,{button:"left",buttons:0,clickCount:1});
    const mapPoints = points => js(`(()=>{const r=document.querySelector('#viewport').getBoundingClientRect(),s=shapeTest.state;
      return ${JSON.stringify(points)}.map(p=>({x:r.x+s.panX+p.x*s.scale,y:r.y+s.panY+p.y*s.scale}));})()`);
    const anchor = () => js(`(()=>{const d=shapeTest.state.drawing,h=d.smartHold,r=document.querySelector('#viewport').getBoundingClientRect(),s=shapeTest.state;
      return {x:r.x+s.panX+h.x*s.scale,y:r.y+s.panY+h.y*s.scale};})()`);
    const reset = async (scale = 1) => {
      await js(`(()=>{const t=shapeTest,s=t.state;t.hideAssist();t.tiles.clear();s.inkBounds.clear();t.clearDirtyContributionTracking();s.historyBefore.clear();
        s.history=[];s.future=[];s.dirty=null;s.hotspotTrail=[];s.widgets=[];s.images=[];s.textBoxes=[];s.animations=[];s.scale=${scale};s.panX=0;s.panY=0;
        t.smartSuggest.strokes=[];t.smartSuggest.enabled=true;t.render();})()`);
      await pause(40);
    };
    const shapes = {
      line:Array.from({length:31},(_,i)=>({x:150+i*7,y:260+Math.sin(i*.7)*7})),
      circle:Array.from({length:65},(_,i)=>({x:270+80*Math.cos(i/64*Math.PI*1.8)+Math.sin(i*1.7)*3,y:300+75*Math.sin(i/64*Math.PI*1.8)+Math.cos(i*1.3)*3})),
      triangle:(()=>{const v=[[160,390],[260,220],[380,380]],out=[];for(let i=0;i<3;i++){const a=v[i],b=v[(i+1)%3];for(let j=0;j<24;j++)out.push({x:a[0]+(b[0]-a[0])*j/24+Math.sin(j*1.5)*4,y:a[1]+(b[1]-a[1])*j/24+Math.cos(j*1.3)*4});}return out.slice(0,-5);})(),
    };
    for (const scenario of [{width:1200,zoom:1,scale:.5},{width:1200,zoom:1,scale:1},{width:1200,zoom:1,scale:2},{width:820,zoom:1.5,scale:1}]) {
      win.setContentSize(scenario.width,900);win.webContents.setZoomFactor(scenario.zoom);await pause(120);
      for (const [type, points] of Object.entries(shapes)) {
        await reset(scenario.scale);
        // Keep the test shapes physically visible at every Canvas scale.
        const screenPoints = await mapPoints(points.map(p=>({x:p.x/scenario.scale,y:p.y/scenario.scale})));
        await start(screenPoints[0]);
        for (const p of screenPoints.slice(1)) await move(p);
        assert.equal(await js("shapeTest.state.drawing?.pointerType"),"pen");
        const a = await anchor();
        // Continuous small pen movement for the entire hold interval.
        for(let i=0;i<24;i++){await move({x:a.x+Math.sin(i)*5,y:a.y+Math.cos(i)*2});await pause(25);}
        const held = await js("shapeTest.state.drawing?.smartHold.fit?.type");
        assert.equal(held,type,`${type}: hold recognizes despite ongoing tremor`);
        const outline = await js("JSON.stringify(shapeTest.state.drawing.smartHold.fit.outline)");
        if(scenario.scale===1&&scenario.zoom===1)await shot(`${type}-recognized`);
        let last;
        for(let i=0;i<14;i++){last={x:a.x+Math.sin(i)*12,y:a.y+Math.cos(i)*7};await move(last);}
        assert.equal(await js("JSON.stringify(shapeTest.state.drawing.smartHold.fit?.outline)"),outline,`${type}: recognized geometry stays stable`);
        await release(last);await pause(50);
        assert.equal(await js("shapeTest.smartSuggest.strokes.at(-1).exact"),true,`${type}: release applies snap`);
        assert.equal(await js("shapeTest.smartSuggest.strokes.at(-1).inputConsumed"),true,"the complete rough/tremor ink is consumed");
        const pixels = await js("[...shapeTest.tiles].map(([key,c])=>[key,c.toDataURL()])");
        await js("shapeTest.undo()");
        assert.notDeepEqual(await js("[...shapeTest.tiles].map(([key,c])=>[key,c.toDataURL()])"),pixels,"Undo restores rough source");
        await js("shapeTest.redo()");
        assert.deepEqual(await js("[...shapeTest.tiles].map(([key,c])=>[key,c.toDataURL()])"),pixels,"Redo restores exactly the snapped pixels");
        report.cases.push({...scenario,type,held,releaseSnapped:true,undoRedo:true});
        if(scenario.scale===1)await shot(`${type}-snapped-${scenario.width}-zoom-${scenario.zoom}`);
      }
    }
    report.checks.push("Stylus circle, triangle and wavy line survive continuous pause tremor and larger release tremor at Canvas scales 0.5, 1 and 2, plus an 820px window at 150% page zoom; Undo/Redo preserves raster results.");
    win.setContentSize(1200,900);win.webContents.setZoomFactor(1);await reset();
    const line = await mapPoints([{x:150,y:260},{x:360,y:260}]);
    await start(line[0]);await move(line[1]);await pause(600);
    assert.equal(await js("shapeTest.state.drawing.smartHold.fit.type"),"line");
    const a = await anchor();let last;
    for(const dx of [5,10,15,25]){last={x:a.x+dx,y:a.y};await move(last);}
    assert.equal(await js("shapeTest.state.drawing.smartHold.fit"),null);
    await release(last);assert.equal(await js("!!shapeTest.smartSuggest.strokes.at(-1).exact"),false);
    report.checks.push("Deliberate continuation beyond the fixed anchor cancels recognition without snapping on release.");
    await reset();await start(line[0]);await move(line[1]);await release(line[1]);
    assert.equal(await js("!!shapeTest.smartSuggest.strokes.at(-1).exact"),false);
    await reset();await start(line[0]);await move(line[1]);await pause(600);await js("shapeTest.setSmartSuggestEnabled(false)");await release(line[1]);
    assert.equal(await js("!!shapeTest.smartSuggest.strokes.at(-1).exact"),false);
    report.checks.push("Immediate release and disabling Suggest during a recognized hold preserve freehand ink.");
    assert.deepEqual(report.errors,[],"no renderer errors");
  } catch(error) {
    report.failure = error.stack || String(error);process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    win?.destroy();
    if(server)await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temporary,{recursive:true,force:true});
    app.exit(process.exitCode || 0);
  }
});
