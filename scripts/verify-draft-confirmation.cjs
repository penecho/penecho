"use strict";
// Exercise the real draft controls and persisted ink in an isolated Canvas.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), cloud = process.argv.includes("--cloud"), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-draft-confirmation-")),
  clientFile = cloud ? path.resolve(root, "../penecho_cloud/public/canvas/app.js") : path.join(root, "public/app.js"),
  output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || temporary);
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary,"state"), PENECHO_CONFIG_FILE:path.join(temporary,"config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) return Readable.from([fs.readFileSync(clientFile,"utf8").replace(/\}\)\(\);\s*$/, `
    if(${cloud})Object.assign(window.PENECHO_CONFIG,{runtime:'cloud',connectionAccountId:'test-only',linkedDeviceId:'test-only',linkedDeviceOnline:true});
    window.draftTest={state,tiles,smartSuggest,canvasDocumentsReady,loadCanvasSettings,loadHostedModels,aiConnectionScope,save,undo,redo,render,startPending,startPendingBatch,offscreen,requestAI,settings,storeAiConnectionSelection,saveSnapshot,readDeviceSnapshot,stroke};
    draftTest.alpha=(x,y)=>{const c=tile(Math.floor(x/TILE),Math.floor(y/TILE),false);return c?c.getContext('2d').getImageData(x%TILE,y%TILE,1,1).data[3]:0;};
    draftTest.visibleAlpha=(x,y)=>{const d=devicePixelRatio||1;return inkCtx.getImageData(Math.round((x*state.scale+state.panX)*d),Math.round((y*state.scale+state.panY)*d),1,1).data[3];};
    draftTest.makeImage=()=>{const c=offscreen(550,300),q=c.getContext('2d');q.strokeStyle='#2864ef';q.lineWidth=4;q.strokeRect(10,10,530,280);return c;};
    const originalFetch=window.fetch;window.fetch=async(url,options)=>{
      const json=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
      if(url==='/api/v1/models')return json({accountId:'test-only',models:[],credits:{available:1}});
      if(String(url).endsWith('/suggest/status'))return json({configured:false});
      if(url==='/api/ai/command')return json({commands:[{tool:'draw',origin:[200,200],types:['rect'],items:[[0,0,550,300]],width:4}]});
      return originalFetch(url,options);
    };
  })();`)]);
  return readStream.call(this, file, ...args);
};
let server, win;
const report = { runtime:cloud ? "cloud-client" : "local", clientFile, checks:[], errors:[] };
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening",resolve));
    win = new BrowserWindow({ show:false,width:1440,height:1000,webPreferences:{ contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true } });
    win.webContents.on("console-message",(_event,level,message) => { if(level>=3)report.errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const run = code => win.webContents.executeJavaScript(code), wait = async condition => {
      const deadline = Date.now()+15000;
      while(!await run(condition)){if(Date.now()>deadline)throw Error("Timed out: "+condition);await new Promise(resolve=>setTimeout(resolve,50));}
    }, screenshot = async name => {
      await new Promise(resolve=>setTimeout(resolve,180));
      await run("document.querySelector('#canvasWelcome').hidden=true");
      fs.writeFileSync(path.join(output,name+".png"),(await win.webContents.capturePage()).toPNG());
    },
      click = async selector => {
        const point = await run(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)throw Error('Missing control');const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
        win.webContents.sendInputEvent({type:"mouseMove",...point});
        win.webContents.sendInputEvent({type:"mouseDown",button:"left",clickCount:1,...point});
        win.webContents.sendInputEvent({type:"mouseUp",button:"left",clickCount:1,...point});
      };
    await run(`(async()=>{const t=draftTest,s=t.state;await t.canvasDocumentsReady();await t.loadCanvasSettings();if(window.PENECHO_CONFIG.runtime==='cloud'){await t.loadHostedModels({accountChanged:true});t.settings.connections=[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',provider:'api',hasApiKey:true,apiUrl:'http://127.0.0.1:1/v1',apiModel:'test'}];t.settings.connectionScope=t.aiConnectionScope();}t.storeAiConnectionSelection(t.settings.connections[0].id);document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelector('#canvasWelcome').hidden=true;t.smartSuggest.enabled=false;s.language='zh';s.auto=false;s.scale=1;s.panX=s.panY=0;s.mode='pen';s.viewInitialized=true;})()`);
    await run("void draftTest.requestAI('answer',null,{attentionBox:{x:200,y:200,w:100,h:100}})");
    await wait("draftTest.state.pending?.revealProgress===1");
    await screenshot("before-confirm");
    assert.equal(await run("draftTest.alpha(300,200)"),0);
    await click(".object-chrome-button.accept");
    await wait("!draftTest.state.pending && !draftTest.state.busy");
    await screenshot("after-confirm");
    report.committed = await run("({tile:draftTest.alpha(300,200),visible:draftTest.visibleAlpha(300,200),history:draftTest.state.history.length,status:draftTest.state.statusKey})");
    assert.ok(report.committed.tile>0,"Confirm must retain the drawing in Canvas tiles");
    assert.ok(report.committed.visible>0,"Confirm must retain the drawing on screen");
    report.checks.push("The real checkmark commits a draw command and retains visible ink.");
    await run("draftTest.undo()");
    assert.equal(await run("draftTest.alpha(300,200)"),0);
    assert.equal(await run("!!draftTest.state.pending"),true);
    report.restored = await run("({draftGeneration:draftTest.state.pending.recognitionGeneration,canvasGeneration:draftTest.state.recognitionGeneration})");
    await screenshot("undo-restored-draft");
    await click(".object-chrome-button.accept");
    await wait("!draftTest.state.pending");
    await screenshot("reconfirmed-after-undo");
    assert.ok(await run("draftTest.alpha(300,200)")>0,"Confirming a draft restored by Undo must retain its drawing");
    assert.ok(await run("draftTest.visibleAlpha(300,200)")>0,"Reconfirmed drawing must remain visible after rendering");
    await run("draftTest.undo()");
    assert.equal(await run("draftTest.alpha(300,200)"),0);
    await run("draftTest.redo()");
    assert.ok(await run("draftTest.alpha(300,200)")>0);
    assert.equal(await run("!!draftTest.state.pending"),false);
    report.checks.push("Undo restores a confirmable draft; reconfirm and redo retain committed ink.");
    await run("void draftTest.startPending(draftTest.makeImage(),200,550,draftTest.state.userRevision,{}, {tool:'draw'})");
    await wait("draftTest.state.pending?.revealProgress===1");
    await click(".object-chrome-button.cancel");
    await wait("!draftTest.state.pending");
    assert.equal(await run("draftTest.alpha(300,560)"),0);
    assert.ok(await run("draftTest.alpha(300,200)")>0);
    report.checks.push("The cross discards only its preview and retains earlier committed ink.");
    await run(`(()=>{const t=draftTest,s=t.state;s.mode='pen';s.scale=.5;s.panX=200-6000*s.scale;s.panY=180-9000*s.scale;t.stroke({x:6200,y:9200},{x:6300,y:9200},false,6,false,'#202938');t.stroke({x:6200,y:9200},{x:6300,y:9200},true,10,false);t.save();void t.startPendingBatch([{command:{tool:'draw'},image:t.makeImage(),x:6000,y:9000,layoutWidth:550,layoutHeight:300},{command:{tool:'draw'},image:t.makeImage(),x:6600,y:9000,layoutWidth:550,layoutHeight:300}],s.userRevision,{});s.pending.items[1].scaleX=1.2;s.pending.items[1].scaleY=1.1;t.render();})()`);
    await wait("!!document.querySelector('[data-object-chrome-key=\"pending-item:1:accept\"]')");
    await click('[data-object-chrome-key="pending-item:1:accept"]');
    await wait("draftTest.state.pending?.items?.length===1");
    assert.ok(await run("draftTest.alpha(6700,9011)")>0,"Scaled batch item must commit");
    assert.equal(await run("draftTest.alpha(6100,9010)"),0,"Other item remains a preview");
    await run("draftTest.undo()");
    assert.equal(await run("draftTest.state.pending.items.length"),2);
    assert.equal(await run("draftTest.alpha(6700,9011)"),0);
    await click('[data-object-chrome-key="pending-item:1:accept"]');
    await wait("draftTest.state.pending?.items?.length===1");
    assert.ok(await run("draftTest.alpha(6700,9011)")>0,"Undo-restored batch item must remain confirmable");
    await click('[data-object-chrome-key="pending-item:0:accept"]');
    await wait("!draftTest.state.pending");
    assert.ok(await run("draftTest.alpha(6100,9010)")>0);
    await screenshot("scaled-batch-confirmed");
    report.checks.push("Both batch checkmarks commit their own scaled drawing at 50% Canvas zoom after erasing nearby ink, including reconfirmation after Undo.");
    const saved = await run("draftTest.saveSnapshot({name:'Draft confirmation test',location:'device'})");
    assert.ok(saved);
    const snapshot = await run(`draftTest.readDeviceSnapshot(${JSON.stringify(saved)})`);
    assert.ok(snapshot.tileEntries.length>0,"Saved document must retain committed ink tiles");
    report.checks.push("Device save retains committed drawing tiles.");
    assert.deepEqual(report.errors,[]);
  } catch(error) { report.failure=String(error.stack||error); console.error(error); process.exitCode=1; }
  finally {
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
    console.log(JSON.stringify({output,...report}));
    win?.destroy(); server?.closeAllConnections(); if(server)await new Promise(resolve=>server.close(resolve));
    if(output!==temporary)fs.rmSync(temporary,{recursive:true,force:true});
    app.exit(process.exitCode||0);
  }
});
