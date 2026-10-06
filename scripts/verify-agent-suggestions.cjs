"use strict";
// Render canonical local/Cloud clients with isolated data and deterministic
// model/Agent transport. Exercise the real request lifecycle, ranking and clicks.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { Readable } = require("node:stream"), { createHash } = require("node:crypto");
const root = path.resolve(__dirname, ".."), cloud = process.argv.includes("--cloud");
const clientRoot = cloud ? path.resolve(root, "../penecho_cloud/public/canvas") : path.join(root, "public");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-agent-suggest-"));
const output = path.resolve(process.argv.find(value => value.startsWith("--output="))?.slice(9)
  || path.join(root, "docs/verification/agent-request-suggestions-20261005", cloud ? "cloud" : "local"));
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"),
  PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only",
  AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const injection = `
  if(${cloud})Object.assign(window.PENECHO_CONFIG,{runtime:'cloud',connectionAccountId:'test-only',linkedDeviceId:'test-only',linkedDeviceOnline:true});
  window.agentSuggestAudit={state,smartSuggest,canvasAgent,assistAgent,settings,canvasDocumentsReady,loadCanvasSettings,
    loadHostedModels,aiConnectionScope,
    markFeatureTourStepsSeen,FEATURE_TOUR_STEPS,
    storeAiConnectionSelection,render,stroke,save,setCanvasMode,captureSelection,cancelSelection,scheduleAssist,runSmartSuggest,
    openCanvasAgent,closeCanvasAgent,canvasAgentBeginRequest,canvasAgentHandleEvent,assistAgentShow,positionAssist,rankRequests:[],commands:[],envelopes:[]};
  canvasAgentConnect=async()=>{};
  canvasAgentSendEnvelope=(type,payload)=>agentSuggestAudit.envelopes.push({type,payload});
  const auditFetch=window.fetch;
  window.fetch=async(url,options)=>{
    if(url==='/api/v1/models')return new Response(JSON.stringify({accountId:'test-only',models:[],credits:{available:1}}),{headers:{'Content-Type':'application/json'}});
    if(String(url).endsWith('/suggest/status'))return new Response(JSON.stringify({configured:true,model:'test-only'}),{headers:{'Content-Type':'application/json'}});
    if(String(url).endsWith('/suggest')){
      agentSuggestAudit.rankRequests.push(JSON.parse(options.body));
      const choice=value=>({type:'choice',choice:value,confidence:1,probabilities:{[value]:1}});
      return new Response(JSON.stringify({ok:true,answers:{kind:choice('math_expr'),action:choice('solve'),execution_solve:choice('canvas_ai')}}),{headers:{'Content-Type':'application/json'}});
    }
    if(String(url).endsWith('/api/ai/command')){
      agentSuggestAudit.commands.push(JSON.parse(options.body));
      return new Response(JSON.stringify({commands:[]}),{headers:{'Content-Type':'application/json'}});
    }
    return auditFetch(url,options);
  };
  agentSuggestAudit.seed=()=>{
    cancelSelection(true);hideAssist('test');smartSuggest.requests.clear();
    state.auto=false;state.language='zh';state.scale=1;state.panX=0;state.panY=0;state.drawing=null;state.pending=null;state.pendingWidget=null;
    setCanvasMode('pen');
    stroke({x:55,y:145},{x:120,y:175},false,6,true,'#263a36');save();
    smartSuggest.enabled=true;smartSuggest.available=true;smartSuggest.lastKey='';smartSuggest.jev=null;smartSuggest.pausedUntil=0;
    smartSuggest.strokes=[{id:1,points:[{x:55,y:145},{x:120,y:175}],size:6,box:{x:52,y:142,w:71,h:36},historyEntry:state.history.at(-1),at:performance.now(),durationMs:100}];
    smartSuggest.localReadyAt=0;smartSuggest.inkReadyAt=0;smartSuggest.consumedStrokeId=0;smartSuggest.dismissedStrokeId=0;
    render();scheduleAssist();
  };
`;
const canonicalClient = fs.readFileSync(path.join(clientRoot, "app.js"), "utf8");
const originalStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  const name = path.resolve(String(file));
  if (name === path.join(root, "public/app.js")) return Readable.from([canonicalClient.replace(/\}\)\(\);\s*$/, injection + "})();")]);
  if (name === path.join(root, "public/style.css")) return originalStream.call(this, path.join(clientRoot, "style.css"), ...args);
  return originalStream.call(this, file, ...args);
};
const report = { runtime:cloud ? "cloud-client" : "local", syntheticTransport:true, providerSemantics:"not measured",
  clientSha256:createHash("sha256").update(canonicalClient).digest("hex"), checks:[], errors:[] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, win;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1440, height:1000, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    const js = code => win.webContents.executeJavaScript(code, true);
    const wait = async expression => { const until = Date.now() + 15000; while (!await js(expression)) { if (Date.now() > until) throw Error("Timed out: " + expression); await pause(30); } };
    await win.loadURL("http://127.0.0.1:" + server.address().port);
    await js(`(async()=>{const t=agentSuggestAudit;await t.canvasDocumentsReady();await t.loadCanvasSettings();
      if(window.PENECHO_CONFIG.runtime==='cloud'){await t.loadHostedModels({accountChanged:true});t.settings.connections=[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',provider:'api',hasApiKey:true,apiUrl:'http://127.0.0.1:1/v1',apiModel:'test'}];t.settings.connectionScope=t.aiConnectionScope();}
      t.storeAiConnectionSelection(t.settings.connections[0].id);
      t.markFeatureTourStepsSeen(t.FEATURE_TOUR_STEPS);
      document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelector('#canvasWelcome').hidden=true;})()`);
    // The release dialog opens after the tour's close transition completes.
    // Dismiss it before checking pixels or native pointer hit targets.
    await pause(600);
    await js("document.querySelector('#changelogClose')?.click();");
    await pause(150);
    await wait("document.querySelector('#changelogLayer').hidden");
    const shot = async label => {
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      await pause(80);
      fs.writeFileSync(path.join(output, label + ".png"), (await win.webContents.capturePage()).toPNG());
    };
    const visible = async label => {
      await wait("agentSuggestAudit.smartSuggest.bar?.mode==='suggest' && !agentSuggestAudit.smartSuggest.bar.element.inert && getComputedStyle(agentSuggestAudit.smartSuggest.bar.element).visibility==='visible' && getComputedStyle(agentSuggestAudit.smartSuggest.bar.element).opacity==='1'");
      const geometry = await js(`(()=>{const bar=agentSuggestAudit.smartSuggest.bar.element,r=bar.getBoundingClientRect(),p=document.querySelector('#canvasAgentPanel'),pr=p.getBoundingClientRect();return {
        scope:bar.dataset.scope,disabled:[...bar.querySelectorAll('button')].some(b=>b.disabled),x:r.x,y:r.y,w:r.width,h:r.height,
        width:innerWidth,height:innerHeight,panelVisible:!p.hidden&&getComputedStyle(p).display!=='none',overlap:Math.max(0,Math.min(r.right,pr.right)-Math.max(r.left,pr.left))*Math.max(0,Math.min(r.bottom,pr.bottom)-Math.max(r.top,pr.top))};})()`);
      report.checks.push({ label, geometry });
      assert.equal(geometry.disabled, false, label);
      assert.ok(geometry.x >= 0 && geometry.y >= 0 && geometry.x + geometry.w <= geometry.width + 1 && geometry.y + geometry.h <= geometry.height + 1, label + " fits viewport");
      if (geometry.panelVisible) assert.equal(geometry.overlap, 0, label + " avoids Agent panel");
      await shot(label);
    };
    const completed = async label => {
      await wait("agentSuggestAudit.smartSuggest.bar===null");
      await pause(650);
      assert.equal(await js("agentSuggestAudit.smartSuggest.bar===null"), true, label + " stays dismissed");
      report.checks.push({ label, dismissed:true });
      await shot(label);
    };
    for (const width of [1440, 390]) {
      win.setContentSize(width, 1000); await pause(100);
      await js("agentSuggestAudit.seed();agentSuggestAudit.openCanvasAgent({focus:false,connect:false,animate:false});");
      await visible("ink-open-" + width);
      await js("agentSuggestAudit.canvasAgentBeginRequest();");
      await visible("ink-pending-" + width);
      await js("agentSuggestAudit.canvasAgentHandleEvent({kind:'turn_start'});");
      await visible("ink-running-" + width);
      await js("document.querySelector('#canvasAgentStop').click();");
      assert.equal(await js("agentSuggestAudit.envelopes.at(-1)?.type"), "cancel");
      await js("agentSuggestAudit.canvasAgentHandleEvent({kind:'turn_end',reason:{kind:'cancelled'}});");
      await visible("ink-stopped-" + width);
      await js("agentSuggestAudit.canvasAgentBeginRequest();agentSuggestAudit.canvasAgentHandleEvent({kind:'turn_start'});agentSuggestAudit.canvasAgentHandleEvent({kind:'turn_end',reason:{kind:'completed'}});");
      await completed("ink-completed-" + width);
      await js("agentSuggestAudit.seed();");
      await js("agentSuggestAudit.setCanvasMode('select');agentSuggestAudit.captureSelection([{x:35,y:125},{x:155,y:125},{x:155,y:200},{x:35,y:200}]);");
      await visible("lasso-open-" + width);
      assert.equal(await js("agentSuggestAudit.smartSuggest.bar.element.dataset.scope"), "selection");
      await js("agentSuggestAudit.currentSelection=agentSuggestAudit.state.selection;agentSuggestAudit.canvasAgentBeginRequest();agentSuggestAudit.canvasAgentHandleEvent({kind:'turn_start'});");
      await visible("lasso-running-" + width);
      await js("agentSuggestAudit.assistAgentShow('正在生成讲解');agentSuggestAudit.positionAssist();");
      await visible("lasso-mini-" + width);
      await js("agentSuggestAudit.canvasAgentHandleEvent({kind:'turn_end',reason:{kind:'cancelled'}});");
      await visible("lasso-stopped-" + width);
      assert.equal(await js("agentSuggestAudit.state.selection===agentSuggestAudit.currentSelection"), true);
      await js("agentSuggestAudit.canvasAgentBeginRequest();agentSuggestAudit.canvasAgentHandleEvent({kind:'turn_start'});agentSuggestAudit.canvasAgentHandleEvent({kind:'turn_end',reason:{kind:'completed'}});");
      await completed("lasso-completed-" + width);
      assert.equal(await js("agentSuggestAudit.state.selection===agentSuggestAudit.currentSelection && agentSuggestAudit.smartSuggest.dismissedSelection===agentSuggestAudit.currentSelection"), true);
      await js("agentSuggestAudit.seed();agentSuggestAudit.setCanvasMode('select');agentSuggestAudit.captureSelection([{x:35,y:125},{x:155,y:125},{x:155,y:200},{x:35,y:200}]);");
      await visible("lasso-new-input-" + width);
      await wait("agentSuggestAudit.smartSuggest.jev?.selection===agentSuggestAudit.state.selection");
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      // Actual mouse click reaches the masked selection Canvas AI entry point
      // after ranking settles, while the idle Agent panel remains open.
      const count = await js("agentSuggestAudit.commands.length");
      const point = await js("(()=>{const b=agentSuggestAudit.smartSuggest.bar.element.querySelector(':scope > .assist-action');if(!b)throw Error('Missing action');const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
      assert.equal(await js(`Boolean(document.elementFromPoint(${point.x},${point.y})?.closest('.assist-action'))`), true, "action is unobstructed");
      win.webContents.sendInputEvent({ type:"mouseMove", ...point });
      win.webContents.sendInputEvent({ type:"mouseDown", button:"left", clickCount:1, ...point });
      win.webContents.sendInputEvent({ type:"mouseUp", button:"left", clickCount:1, ...point });
      await wait("agentSuggestAudit.commands.length>" + count);
      await wait("!agentSuggestAudit.state.activeAI");
      report.checks.push({ label:"lasso-click-" + width, action:await js("agentSuggestAudit.commands.at(-1).userAction"), commands:await js("agentSuggestAudit.commands.length"), agentRunning:await js("agentSuggestAudit.canvasAgent.running") });
      await js("agentSuggestAudit.canvasAgentHandleEvent({kind:'turn_end',reason:{kind:'cancelled'}});");
      await js("agentSuggestAudit.closeCanvasAgent({focus:false,animate:false});document.querySelector('#assistAgentMini').hidden=true;");
    }
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify({ output, checks:report.checks.length, errors:report.errors }));
  } catch (error) {
    report.failure = error.stack; console.error(error); process.exitCode = 1;
    if (win) fs.writeFileSync(path.join(output, "failure.png"), (await win.webContents.capturePage()).toPNG());
  } finally {
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    win?.destroy(); server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive:true, force:true }); app.exit(process.exitCode || 0);
  }
});
