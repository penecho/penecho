"use strict";
// Isolated real-renderer navigation benchmark. Run --baseline before changing
// the client, then run without it to enforce the navigation work budget.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "suggest-navigation-")),
  cloud = process.argv.includes("--cloud"), baseline = process.argv.includes("--baseline"),
  clientRoot = cloud ? path.resolve(root, "../penecho_cloud/public/canvas") : path.join(root, "public"),
  output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || temporary);
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const injection = `
  window.navigationTest={state,smartSuggest,canvasDocumentsReady,loadCanvasSettings,stroke,save,render,renderAssist,hideAssist,positionAssist,canvasViewportMetrics};
  const metrics={builds:0,searches:0};
  const maskOriginal=assistContentMask,searchOriginal=assistFindPlacement;
  assistContentMask=(...args)=>{const before=assistPlacementMask,result=maskOriginal(...args);if(result!==before)metrics.builds++;return result;};
  assistFindPlacement=(...args)=>{metrics.searches++;return searchOriginal(...args);};
  navigationTest.measure=async(kind,withBar)=>{
    const t=navigationTest,s=t.state;s.panX=0;s.panY=0;s.scale=1;s.panGesture=null;s.touchGesture=null;t.hideAssist('benchmark');
    if(withBar){t.renderAssist({mode:'suggest',box:{x:420,y:200,w:180,h:60},cluster:{key:'benchmark',box:{x:420,y:200,w:180,h:60},strokes:[]},view:{items:[{id:'typeset'},{id:'diagram'},{id:'answer'}],more:[],source:'local'}});cancelAnimationFrame(smartSuggest.frame);smartSuggest.frame=0;}
    metrics.builds=metrics.searches=0;
    const elapsed=[],frames=[];let previous=0;
    if(kind==='drag')s.panGesture={id:-1};
    for(let i=0;i<90;i++){
      await new Promise(requestAnimationFrame);const now=performance.now();if(previous)frames.push(now-previous);previous=now;
      s.panX=-i*3;s.panY=i*.5;if(kind==='zoom')s.scale=1-i*.003;
      const start=performance.now();t.positionAssist();elapsed.push(performance.now()-start);t.render();
    }
    const during={...metrics};s.panGesture=null;
    await new Promise(resolve=>setTimeout(resolve,180));t.positionAssist();
    const settled={...metrics},sample=values=>{values.sort((a,b)=>a-b);return{medianMs:values[Math.floor(values.length*.5)],p95Ms:values[Math.floor(values.length*.95)],maxMs:values.at(-1)}};
    for(let i=0;i<20;i++)t.positionAssist();
    return{kind,withBar,position:sample(elapsed),frames:sample(frames),during,settled,idle:{...metrics},samples:elapsed.length};
  };
  const originalFetch=window.fetch;
  window.fetch=(url,options)=>String(url).endsWith('/suggest/status')?Promise.resolve(new Response(JSON.stringify({configured:false}))):originalFetch(url,options);
`;
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  const absolute = path.resolve(String(file));
  if (absolute === path.join(root, "public/app.js")) return Readable.from([fs.readFileSync(path.join(clientRoot, "app.js"), "utf8").replace(/\}\)\(\);\s*$/, injection + "})();")]);
  if (cloud && absolute === path.join(root, "public/style.css")) return readStream.call(this, path.join(clientRoot, "style.css"), ...args);
  return readStream.call(this, file, ...args);
};
let server, win;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1920, height:1080, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    const errors = [], report = { runtime:cloud ? "cloud-client" : "local", baseline, cases:[], errors };
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const run = code => win.webContents.executeJavaScript(code);
    await run(`(async()=>{const t=navigationTest,s=t.state;await t.canvasDocumentsReady();await t.loadCanvasSettings();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();s.language='en';s.auto=false;s.mode='pen';s.scale=1;s.panX=s.panY=0;t.smartSuggest.enabled=true;t.smartSuggest.available=false;
      for(let y=100;y<1000;y+=100)for(let x=200;x<1800;x+=150){t.stroke({x,y},{x:x+100,y:y+45},false,8,false,'#2563eb');t.stroke({x:x+100,y:y+45},{x:x+70,y:y-20},false,8,false,'#2563eb');}t.save();t.render();})()`);
    for (const kind of ["drag", "wheel", "zoom"]) for (const withBar of [false, true]) {
      const result = await run(`navigationTest.measure(${JSON.stringify(kind)},${withBar})`);
      report.cases.push(result);
      console.log(JSON.stringify(result));
      if (!baseline && withBar) {
        assert.equal(result.during.builds, 0, kind + ": no full-viewport readback while navigating");
        assert.equal(result.during.searches, 0, kind + ": no placement search while navigating");
        assert.equal(result.settled.builds, 1, kind + ": rebuild once after navigation settles");
        assert.equal(result.settled.searches, 1, kind + ": correct placement once after navigation settles");
        assert.deepEqual(result.idle, result.settled, kind + ": unchanged frames reuse placement");
      }
    }
    fs.writeFileSync(path.join(output, "settled.png"), (await win.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    assert.deepEqual(errors, []);
  } finally {
    win?.destroy(); server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve));
    if (output !== temporary) fs.rmSync(temporary, { recursive:true, force:true });
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
