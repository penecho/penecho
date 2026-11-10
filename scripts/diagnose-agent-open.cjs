"use strict";
// Reproduce Agent opening against a read-only snapshot copy and isolated state.
// Suggestion responses are synthetic. Session recovery can use the local server;
// this measures renderer responsiveness and does not submit a provider turn.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, "..");
const snapshot = process.argv.find(value => value.startsWith("--snapshot="))?.slice(11);
const connectCase = process.argv.find(value => value.startsWith("--connect-case="))?.slice(15) || "normal";
if (!["normal", "busy", "unready"].includes(connectCase)) throw Error("Unknown connect case");
if (!snapshot) throw Error("Usage: Electron scripts/diagnose-agent-open.cjs --snapshot=/absolute/snapshot.json [--output=/absolute/directory]");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-agent-open-"));
const output = path.resolve(process.argv.find(value => value.startsWith("--output="))?.slice(9) || path.join(root, "docs/verification/agent-open-20261004"));
fs.mkdirSync(output, { recursive:true });
const canvasId = path.basename(snapshot, ".json"), canvasDir = path.join(temporary, "state/canvases/shared");
fs.mkdirSync(canvasDir, { recursive:true });
fs.copyFileSync(snapshot, path.join(canvasDir, canvasId + ".json"));
fs.copyFileSync(snapshot.replace(/\.json$/, ".meta.json"), path.join(canvasDir, canvasId + ".meta.json"));
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"),
  PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only",
  AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const injection = `
window.agentOpenAudit={state,canvasAgent,smartSuggest,canvasDocumentsReady,loadCanvasSettings,loadSnapshot,settings,storeAiConnectionSelection,
  openCanvasAgent,closeCanvasAgent,tiles,counts:{},timings:{},ranks:0,heartbeats:0,longTasks:[],debug:[],
  suggestionState:()=>({smartEnabled:smartSuggest.enabled,available:smartSuggest.available,blocked:suggestionAccessBlocked(),external:canvasDocumentsExternal(),inputDisabled:canvasAgentInput.disabled})};
const realAgentConnect=canvasAgentConnect;
agentOpenAudit.prepareConnectCase=kind=>{
  canvasAgentConnect=realAgentConnect;
  canvasAgent.socket={readyState:WebSocket.OPEN,send(){},close(){}};
  canvasAgent.sessionId='agent-open-test';canvasAgent.sessionReady=kind!=='unready';canvasAgent.connectionId=selectedAiConnectionId();
  canvasAgent.running=kind==='busy';canvasAgent.requestPending=false;
  canvasAgent.sessionSearchEnabled=!canvasAgent.searchEnabled;canvasAgent.sessionProjectId=canvasAgentContextProjectId();canvasAgent.sessionAccessMode=canvasAgentEffectiveAccessMode();
};
const auditDebug=debug;debug=(event,data)=>{if(event.includes('suggest')||event.includes('snapshot'))agentOpenAudit.debug.push({event,data});auditDebug(event,data);};
setInterval(()=>agentOpenAudit.heartbeats++,50);
new PerformanceObserver(list=>{agentOpenAudit.longTasks.push(...list.getEntries().map(e=>Math.round(e.duration)));}).observe({entryTypes:['longtask']});
const auditFetch=window.fetch;
window.fetch=async(url,options)=>{
  if(String(url).endsWith('/suggest/status'))return new Response(JSON.stringify({configured:true}),{headers:{'Content-Type':'application/json'}});
  if(String(url).endsWith('/suggest')){agentOpenAudit.ranks++;return new Response(JSON.stringify({ok:true,answers:{kind:{type:'choice',choice:'notes'},action:{type:'choice',choice:'explain',probabilities:{explain:1}}}}),{headers:{'Content-Type':'application/json'}});}
  return auditFetch(url,options);
};
canvasAgentConnect=async()=>{
  canvasAgent.socket={readyState:WebSocket.OPEN,send(){},close(){}};
  canvasAgent.sessionId='agent-open-test';canvasAgent.sessionReady=true;canvasAgentSyncState();
};
${['canvasAgentSyncState','canvasAgentSyncSelection','canvasAgentSyncPromptSuggestions','canvasAgentPromptContext','canvasAgentResizeInput','visibleInkBounds','canvasAgentContentBounds'].map(name => `{
  const original=${name};
  ${name}=function(...args){const start=performance.now();agentOpenAudit.counts.${name}=(agentOpenAudit.counts.${name}||0)+1;try{return original(...args);}finally{agentOpenAudit.timings.${name}=(agentOpenAudit.timings.${name}||0)+performance.now()-start;}};
}`).join('\n')}
`;
const originalStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) return Readable.from([fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, injection + "})();")]);
  return originalStream.call(this, file, ...args);
};
const report = { startedAt:new Date().toISOString(), clientSha256:require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(root,"public/app.js"))).digest("hex"),
  syntheticTransport:connectCase === "normal", syntheticSuggestions:true, injectedSessionState:connectCase, errors:[], stages:[] };
let server, win, watchdog;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async()=>{
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1440, height:1000, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    win.webContents.debugger.attach("1.3");
    win.webContents.debugger.on("message", (_event, method, params) => {
      if (method === "Debugger.paused") { report.pausedFrames = params.callFrames.map(f => ({ functionName:f.functionName, line:f.location.lineNumber + 1 })); fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2)); }
    });
    watchdog = setTimeout(()=>{report.errors.push("Renderer watchdog expired");setTimeout(()=>{fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));win.destroy();app.exit(1);},1000);void win.webContents.debugger.sendCommand("Debugger.pause").catch(()=>{});},20000);
    const js = code => win.webContents.executeJavaScript(code, true);
    const stage = async name => {
      const data = await js(`(()=>{const t=agentOpenAudit;return {tiles:t.tiles.size,widgets:t.state.widgets.length,history:t.state.history.length,open:!document.querySelector('#canvasAgentPanel').hidden,counts:t.counts,timings:t.timings,ranks:t.ranks,heartbeats:t.heartbeats,longTasks:t.longTasks,suggestion:t.suggestionState(),debug:t.debug,placeholder:document.querySelector('#canvasAgentInput').placeholder};})()`);
      report.stages.push({ name, ...data });console.log(JSON.stringify({ name, ...data }));
    };
    console.log("Loading isolated page");
    await win.loadURL("http://127.0.0.1:" + server.address().port);
    console.log("Loading snapshot");
    await win.webContents.debugger.sendCommand("Debugger.enable");
    await js(`(async()=>{const t=agentOpenAudit;await t.canvasDocumentsReady();await t.loadCanvasSettings();t.storeAiConnectionSelection(t.settings.connections[0].id);document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();t.state.auto=false;t.state.canvasAgentAutoOpen=false;t.smartSuggest.available=true;t.canvasAgent.initialCanvasAutoHidePending=false;await t.loadSnapshot(${JSON.stringify(canvasId)},'server');})()`);
    await pause(300);await stage("loaded");
    await js(`agentOpenAudit.smartSuggest.available=true;${connectCase === "normal" ? "" : `agentOpenAudit.prepareConnectCase(${JSON.stringify(connectCase)});`}agentOpenAudit.openCanvasAgent({focus:false,animate:false})`);
    await pause(5000);await stage("opened");
    fs.writeFileSync(path.join(output,"opened.png"),(await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#canvasAgentInput').value='Renderer still responsive';document.querySelector('#canvasAgentInput').dispatchEvent(new Event('input',{bubbles:true}));agentOpenAudit.closeCanvasAgent({focus:false,animate:false});");
    await pause(200);await stage("closed");
    fs.writeFileSync(path.join(output,"result.png"),(await win.webContents.capturePage()).toPNG());
  } catch (error) { report.errors.push(String(error.stack || error)); process.exitCode = 1; }
  finally {
    clearTimeout(watchdog);fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2)+"\n");win?.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode || 0);
  }
});
