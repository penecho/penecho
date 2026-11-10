"use strict";
// Read-only startup measurement against an already running local service.
// A temporary browser profile keeps the user's tabs and saved workspace intact.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-page-load-"));
let target = process.argv.find(arg => arg.startsWith("--url="))?.slice(6) || "http://127.0.0.1:3921/";
const output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || path.join(__dirname, "../docs/verification/page-load-20261004/report.json"));
const settleMs = Math.max(1000,Math.min(20000,Number(process.argv.find(arg=>arg.startsWith("--settle-ms="))?.slice(12))||8000));
const allowed = new URL(target);
if (!["127.0.0.1", "localhost", "192.168.1.11"].includes(allowed.hostname) || allowed.port !== "3921") throw Error("Expected the local 3921 service");
app.setPath("userData", path.join(temporary, "profile"));
const report = { measuredAt: new Date().toISOString(), target: allowed.origin, profile: "isolated", runs: [] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const safePath = raw => { try { return new URL(raw).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[id]"); } catch { return "[unknown]"; } };
let win, server, mockCloud;
app.whenReady().then(async () => {
  try {
    if (process.argv.includes("--isolated")) {
      report.fixtureUpstreamRequests={};
      mockCloud = require("node:http").createServer((req,res)=>{
        const route=req.url.split('?')[0];report.fixtureUpstreamRequests[route]=(report.fixtureUpstreamRequests[route]||0)+1;
        if(route==='/a/p.png'){res.writeHead(200,{'Content-Type':'image/png'});return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6J0sAAAAASUVORK5CYII=','base64'));}
        const body=req.url==='/api/v1/models'?{models:[{id:'00000000-0000-4000-8000-000000000101',displayName:'Fixture model',apiFormat:'openai',available:true,multiplier:1}]}:req.url==='/api/v1/credits'?{credits:{balance:100}}:{notes:[],account:{id:'fixture-account',name:'Fixture',credits:100}};
        setTimeout(()=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(body));},200);
      });
      await new Promise(resolve=>mockCloud.listen(0,'127.0.0.1',resolve));
      const stateDir=path.join(temporary,'state');fs.mkdirSync(stateDir,{recursive:true});
      fs.writeFileSync(path.join(stateDir,'cloud-device.json'),JSON.stringify({version:2,origin:`http://127.0.0.1:${mockCloud.address().port}`,accountToken:'fixture-only',accountExpiresAt:Date.now()+3600000,account:{id:'fixture-account',name:'Fixture',credits:100},accountUpdatedAt:Date.now(),enabled:false}));
      fs.writeFileSync(path.join(temporary,'config.env'),'');
      Object.assign(process.env,{NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:stateDir,PENECHO_CLOUD_STATE_DIR:stateDir,PENECHO_CLOUD_ORIGIN:`http://127.0.0.1:${mockCloud.address().port}`,PENECHO_CONFIG_FILE:path.join(temporary,'config.env'),HOST:'127.0.0.1',PORT:'0',AI_PROVIDER:'api',AI_API_KEY:'fixture',AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'fixture',PENECHO_JEVISION_ENABLED:'true',PENECHO_JEVISION_MOCK:'auto',PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false'});
      server=require('../server.js');await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
      target=`http://127.0.0.1:${server.address().port}/`;report.target=target;report.fixtureCloud=true;
    }
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    const contents = win.webContents, debuggerApi = contents.debugger;
    await win.loadURL("about:blank");
    debuggerApi.attach("1.3");
    await debuggerApi.sendCommand("Page.enable");
    await debuggerApi.sendCommand("Network.enable");
    await debuggerApi.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: "window.__pageLoadTasks=[];new PerformanceObserver(list=>window.__pageLoadTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({entryTypes:['longtask']});" });
    let current, requests;
    debuggerApi.on("message", (_event, method, data) => {
      if (!current) return;
      if (method === "Network.requestWillBeSent") requests.set(data.requestId, { method: data.request.method, origin: new URL(data.request.url).origin, path: safePath(data.request.url), start: data.timestamp, at:Date.now(), initiator:data.initiator?.stack?.callFrames?.slice(0,4).map(frame=>({function:frame.functionName,path:safePath(frame.url),line:frame.lineNumber+1})) });
      if (method === "Network.responseReceived" && requests.has(data.requestId)) Object.assign(requests.get(data.requestId), { status: data.response.status, responseMs:Math.round((data.timestamp-requests.get(data.requestId).start)*1000),cache: data.response.fromDiskCache || data.response.fromPrefetchCache || false });
      if (method === "Network.loadingFinished" && requests.has(data.requestId)) {
        const row = requests.get(data.requestId);
        current.requests.push({ method: row.method, origin: row.origin, path: row.path, status: row.status, cache: row.cache, durationMs: Math.round((data.timestamp - row.start) * 1000), transferredBytes: data.encodedDataLength, initiator:row.initiator });
        requests.delete(data.requestId);
      }
      if (method === "Network.loadingFailed" && requests.has(data.requestId)) {
        const row = requests.get(data.requestId);
        current.failures.push({ path: row.path,status:row.status,responseMs:row.responseMs,durationMs:Date.now()-row.at,error: data.errorText,initiator:row.initiator });
        requests.delete(data.requestId);
      }
    });
    for (const kind of process.argv.includes("--cold-only")?["cold"]:["cold", "warm"]) {
      current = { kind, requests: [], failures: [], errors: [] }; requests = new Map();
      report.runs.push(current);
      const onError = event => { if (event.level === "error") current.errors.push({ message: event.message.replace(/https?:\/\/[^\s]+/g, "[url]"), source: safePath(event.sourceId), line: event.lineNumber }); };
      contents.on("console-message", onError);
      console.log(`Measuring ${kind} startup`);
      await Promise.race([win.loadURL(target),pause(30000).then(()=>{throw Error("Page load exceeded 30 seconds");})]);
      await pause(settleMs);
      current.browser = await contents.executeJavaScript(`(() => ({ navigation: performance.getEntriesByType('navigation').map(e => ({ firstByteMs:e.responseStart, domMs:e.domContentLoadedEventEnd, loadMs:e.loadEventEnd, bytes:e.transferSize })), paints: performance.getEntriesByType('paint').map(e => ({ name:e.name, ms:e.startTime })), longTasks:window.__pageLoadTasks, resources: performance.getEntriesByType('resource').map(e => ({ path:new URL(e.name).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'[id]'), startMs:Math.round(e.startTime), durationMs:Math.round(e.duration), bytes:e.transferSize })), widgets:document.querySelectorAll('.widget').length }))()`);
      current.mathjax = await contents.executeJavaScript(`MathJax.tex2svgPromise('\\\\require{mhchem}\\\\ce{H2O}').then(node=>Boolean(node.querySelector('svg')))`);
      current.pending = [...requests.values()].map(row => ({ method:row.method, path:row.path,ageMs:Date.now()-row.at,initiator:row.initiator }));
      contents.removeListener("console-message", onError);
      console.log(JSON.stringify({ kind, navigation:current.browser.navigation, paints:current.browser.paints, longTasks:current.browser.longTasks, slowRequests:current.requests.filter(row=>row.durationMs>200).sort((a,b)=>b.durationMs-a.durationMs), pending:current.pending, failures:current.failures, errors:current.errors }));
      current = null;
    }
  } catch (error) { report.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    fs.mkdirSync(path.dirname(output), { recursive:true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    win?.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));mockCloud?.closeAllConnections();if(mockCloud)await new Promise(resolve=>mockCloud.close(resolve));fs.rmSync(temporary, { recursive:true, force:true }); app.exit(process.exitCode || 0);
  }
});
