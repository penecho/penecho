"use strict";
// Isolated canonical UI acceptance; all ranking traffic is intercepted locally.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "suggest-reopen-"));
const output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || temporary);
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) return Readable.from([fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, `
    window.reopenTest={state,smartSuggest,canvasDocumentsReady,smartSuggestSyncDocument,smartSuggestRecordStroke,assistRefresh,stroke,render,setCanvasMode,clientPoint};
    window.rankingRequests=[];
    const originalFetch=window.fetch;
    window.fetch=(url,options)=>{
      if(String(url).endsWith('/suggest/status'))return Promise.resolve(new Response(JSON.stringify({configured:true})));
      if(String(url).endsWith('/suggest'))return new Promise(resolve=>rankingRequests.push({signal:options.signal,at:performance.now(),resolve:action=>resolve(new Response(JSON.stringify({ok:true,answers:{kind:{type:'choice',choice:'notes',probabilities:{notes:1}},action:{type:'choice',choice:action,probabilities:{[action]:1}}}}),{headers:{'Content-Type':'application/json'}}))}));
      return originalFetch(url,options);
    };
  })();`)]);
  return readStream.call(this, file, ...args);
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)), report = { checks:[], errors:[] };
let server, win;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1200, height:900, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    const js = code => win.webContents.executeJavaScript(code, true);
    const until = async (code, label) => {
      for (let i = 0; i < 100; i++) { if (await js(code)) return; await pause(20); }
      throw Error(`Timed out: ${label}`);
    };
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await until("!!window.reopenTest", "startup");
    await js(`(async()=>{const t=reopenTest,s=t.state,a=t.smartSuggest;await t.canvasDocumentsReady();await new Promise(resolve=>setTimeout(resolve,300));
      document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();
      s.auto=false;s.language='zh';s.scale=1;s.panX=0;s.panY=0;t.setCanvasMode('pen');t.smartSuggestSyncDocument();
      a.enabled=true;a.available=true;a.localReadyAt=0;a.inkReadyAt=0;
      const entry={},points=[{x:150,y:250},{x:400,y:300}];s.history.push(entry);s.userRevision++;t.stroke(points[0],points[1],false,5,true);
      t.smartSuggestRecordStroke({id:a.nextStrokeId++,points,box:{x:150,y:250,w:250,h:50},size:5,at:performance.now(),historyEntry:entry});
      t.assistRefresh('seed');t.render();
    })()`);
    const point = await js("(()=>{const t=reopenTest,a=t.clientPoint({clientX:0,clientY:0}),b=t.clientPoint({clientX:1,clientY:1});return {x:Math.round((275-a.x)/(b.x-a.x)),y:Math.round((275-a.y)/(b.y-a.y))}})()");
    const touch = (type, p) => js(`document.querySelector('#screen').dispatchEvent(new PointerEvent('${type}',{bubbles:true,pointerId:81,pointerType:'touch',isPrimary:true,button:0,clientX:${p.x},clientY:${p.y}}))`);
    const blank = async () => { await touch("pointerdown", {x:900,y:600});await touch("pointerup", {x:900,y:600});await until("!reopenTest.smartSuggest.bar", "blank tap hides suggestions"); };
    await blank();
    await js("reopenTest.smartSuggest.inkReadyAt=performance.now()+60000;reopenTest.smartSuggest.localReadyAt=performance.now()+60000;window.reopenAt=performance.now()");
    await touch("pointerdown", point);await touch("pointerup", point);
    await until("rankingRequests.length===1", "finger tap immediately starts ranking");
    assert.equal(await js("reopenTest.smartSuggest.bar.element.dataset.rank"), "pending");
    assert.equal(await js("reopenTest.smartSuggest.bar.element.inert"), false);
    report.requestStartMs = await js("rankingRequests[0].at-reopenAt");
    assert.ok(report.requestStartMs < 500, `request delayed ${report.requestStartMs} ms`);
    report.checks.push("Finger recall shows a usable pending bar and starts ranking without waiting for the 60-second test deadline");

    await blank();assert.equal(await js("rankingRequests[0].signal.aborted"), true);
    await js("rankingRequests[0].resolve('plot')");await pause(50);
    assert.equal(await js("reopenTest.smartSuggest.bar"), null);
    report.checks.push("Blank finger taps still hide help and abort ranking; late replies stay ignored");

    await js("reopenTest.setCanvasMode('hand')");
    win.webContents.sendInputEvent({type:"mouseDown",...point,button:"left",clickCount:1});
    win.webContents.sendInputEvent({type:"mouseUp",...point,button:"left",clickCount:1});
    await until("rankingRequests.length===2", "Hand click immediately restarts cancelled ranking");
    assert.equal(await js("reopenTest.smartSuggest.bar.element.dataset.rank"), "pending");
    await js("rankingRequests[1].resolve('organize')");
    await until("reopenTest.smartSuggest.bar?.view?.source==='penecho-llm'", "ranking updates in Hand");
    assert.equal(await js("reopenTest.smartSuggest.bar.view.items[0].id"), "organize");
    assert.equal(await js("reopenTest.smartSuggest.bar.element.dataset.rank"), "ranked");
    assert.equal(await js("reopenTest.state.mode"), "hand");
    await pause(250);
    fs.writeFileSync(path.join(output, "hand-ranked.png"), (await win.webContents.capturePage()).toPNG());
    report.checks.push("Hand clicks restart cancelled ranking and display the returned action order in Hand mode");

    await blank();
    win.webContents.sendInputEvent({type:"mouseMove",x:900,y:600});await pause(20);
    win.webContents.sendInputEvent({type:"mouseMove",...point});
    await until("reopenTest.smartSuggest.bar?.element.dataset.rank==='ranked'", "hover restores cached ranking");
    await pause(100);assert.equal(await js("rankingRequests.length"), 2);
    report.checks.push("Hovering already-ranked dirty ink reuses its verdict without a duplicate request");

    await blank();await js("reopenTest.smartSuggest.jev=null");
    win.webContents.sendInputEvent({type:"mouseMove",x:900,y:600});await pause(20);
    win.webContents.sendInputEvent({type:"mouseMove",...point});
    await until("rankingRequests.length===3", "hovering unranked ink immediately requests ranking");
    assert.equal(await js("reopenTest.smartSuggest.bar.element.dataset.rank"), "pending");
    await blank();assert.equal(await js("rankingRequests[2].signal.aborted"), true);
    report.checks.push("Mouse hover immediately ranks unranked dirty ink and a further blank tap cancels it");
    assert.deepEqual(report.errors, []);report.ok=true;
  } catch (error) { report.failure=error.stack||String(error); }
  finally {
    win?.destroy();
    if (server) { server.closeAllConnections?.();await new Promise(resolve => server.close(resolve)); }
    report.serverClosed=!server?.listening;
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
    console.log(JSON.stringify({output,...report},null,2));app.exit(report.ok?0:1);
  }
});
