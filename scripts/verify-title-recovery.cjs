"use strict";
// Exercise real IndexedDB and reloads in an isolated renderer. Never use the
// existing 3921 instance, its browser profile, or its saved Canvas files.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), cloud = process.argv.includes("--cloud"),
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-title-recovery-")),
  output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || path.join(root,"docs/verification/title-recovery",cloud?"cloud-client":"local")),
  clientFile = path.resolve(root, cloud ? "../penecho_cloud/public/canvas/app.js" : "public/app.js");
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
app.disableHardwareAcceleration();
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const injection = `
  window.titleRecoveryTest={state,tiles,canvasDocuments,canvasDocumentsDraft,canvasDocumentsDb,canvasDocumentsStartDraft,canvasDocumentsFlushDraft,renameCurrentCanvasFromTitle,requestResult,allSnapshots,requests:[]};
  const titleRecoveryFetch=window.fetch;
  window.fetch=async(url,options={})=>{titleRecoveryTest.requests.push({url:String(url),method:options.method||'GET',bytes:typeof options.body==='string'?new TextEncoder().encode(options.body).length:0});return titleRecoveryFetch(url,options);};
  titleRecoveryTest.init=async()=>{state.auto=false;smartSuggest.enabled=false;markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);closeFeatureTour({retry:false,changelog:false});markChangelogSeen();document.querySelector('#canvasWelcome').hidden=true;await canvasDocumentsStartDraft();};
  titleRecoveryTest.seed=async location=>{state.snapshotLocation=location;const c=offscreen(TILE,TILE),q=c.getContext('2d');q.fillStyle='#111827';q.fillRect(20,20,100,30);tiles.set('0,0',c);state.userRevision++;render();await canvasDocumentsFlushDraft();};
  titleRecoveryTest.read=()=>({title:state.currentSnapshotName,id:state.currentSnapshotId,location:state.currentSnapshotLocation,documentId:canvasDocuments.activeId,tiles:tiles.size,userRevision:state.userRevision});
  titleRecoveryTest.record=async()=>{const db=await canvasDocumentsDb();return requestResult(db.transaction('documents','readonly').objectStore('documents').get(canvasDocuments.activeId)).then(record=>({title:record.metadata.title,locator:record.locator,tiles:record.stored.tileEntries.length}));};
  titleRecoveryTest.slowLibrary=()=>{refreshSnapshots=()=>new Promise(resolve=>{titleRecoveryTest.finishLibrary=resolve;});};
`;
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  return path.resolve(String(file)) === path.join(root, "public/app.js")
    ? Readable.from([fs.readFileSync(clientFile, "utf8").replace(/\}\)\(\);\s*$/, injection + "})();")]) : readStream.call(this, file, ...args);
};
const report = { client:cloud ? "official-cloud-mirror" : "canonical-071", clientFile, isolated:true, checks:[], errors:[], limitations:["Local isolated server and renderer; UAT, Cloud backend latency, and the user's live tab are not exercised."] };
let server, win;
const bounded = async (work, label, ms=20000) => {
  console.log(label);
  let timer;
  try { return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("Timed out: "+label)),ms);})]); }
  finally {clearTimeout(timer);}
};
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1200, height:900, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    win.webContents.on("console-message", event => { if (event.level === "error") report.errors.push(event.message); });
    win.webContents.on("will-prevent-unload",()=>{report.errors.push("Reload blocked by unfinished recovery");});
    const js = code => bounded(()=>win.webContents.executeJavaScript(code, true),code),
      check = (name, condition, value) => { report.checks.push({name,pass:Boolean(condition),state:value}); assert.ok(condition, name + ": " + JSON.stringify(value)); },
      load = async () => { await bounded(()=>win.loadURL(`http://127.0.0.1:${server.address().port}`),"Load isolated Canvas"); await js("titleRecoveryTest.init()"); },
      reload = async () => { const done = new Promise(resolve => win.webContents.once("did-finish-load", resolve)); win.webContents.reload(); await bounded(()=>done,"Reload isolated Canvas"); await js("titleRecoveryTest.init()"); };
    for (const location of ["device", "server"]) {
      if(win.webContents.getURL()) await win.webContents.session.clearStorageData();
      await load();
      await js(`titleRecoveryTest.seed(${JSON.stringify(location)})`);
      const initialDocument = await js("titleRecoveryTest.read().documentId");
      check(`${location}: first rename saves successfully`, await js("titleRecoveryTest.renameCurrentCanvasFromTitle('DNA first')"));
      const saved = await js("titleRecoveryTest.read()"), record = await js("titleRecoveryTest.record()");
      check(`${location}: first Save immediately persists name and locator`, record.title === "DNA first" && record.locator?.id === saved.id && record.locator.location === location, record);
      check(`${location}: first Save retains document identity`, saved.documentId === initialDocument, saved);
      for (const name of ["dna 333", "dna 444"]) {
        await reload();
        const reopened = await js("titleRecoveryTest.read()");
        check(`${location}: reload keeps the saved Canvas and ink`, reopened.id === saved.id && reopened.location === location && reopened.tiles === 1, reopened);
        await js("titleRecoveryTest.slowLibrary()");
        const timing = await js(`(async()=>{const started=performance.now(),ok=await titleRecoveryTest.renameCurrentCanvasFromTitle(${JSON.stringify(name)});return {ok,elapsedMs:performance.now()-started,libraryPending:typeof titleRecoveryTest.finishLibrary==='function'};})()`);
        check(`${location}: rename finishes before pending Library read`, timing.ok && timing.libraryPending, timing);
        const requests = await js("titleRecoveryTest.requests");
        check(`${location}: rename creates no snapshot or content upload`, !requests.some(request=>["POST","PUT"].includes(request.method)), requests);
        if(location === "server")check(`${location}: only the name is PATCHed`, requests.filter(request=>request.method === "PATCH").length === 1 && requests.find(request=>request.method === "PATCH").bytes < 100, requests);
        check(`${location}: rename is durable before returning`, (await js("titleRecoveryTest.record()")).title === name);
        await js("titleRecoveryTest.finishLibrary(true)");
      }
      await reload();
      const final = await js("titleRecoveryTest.read()");
      check(`${location}: final reload retains the last title`, final.title === "dna 444" && final.id === saved.id && final.documentId === initialDocument, final);
      const count = location === "device" ? await js("titleRecoveryTest.allSnapshots().then(items=>items.length)") : JSON.parse(fs.readFileSync(path.join(temporary,"state","canvases","shared",saved.id+".meta.json"),"utf8"));
      check(`${location}: no additional copies`, location === "device" ? count === 1 : fs.readdirSync(path.join(temporary,"state","canvases","shared")).filter(name=>name.endsWith(".meta.json")).length === 1, count);
    }
    report.passed = true;
  } catch(error) { report.passed=false;report.failure=String(error.stack||error);process.exitCode=1; }
  finally {
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2)+"\n");
    console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,report:path.join(output,"report.json"),failure:report.failure},null,2));
    if(win&&!win.isDestroyed())win.destroy();
    if(server){server.closeAllConnections();server.close();}
    fs.rmSync(temporary,{recursive:true,force:true});
    app.exit(report.passed?0:1);
  }
});
