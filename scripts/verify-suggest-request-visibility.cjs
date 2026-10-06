"use strict";
// Exercise canonical Canvas UI with isolated data and intercepted AI transports.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "suggest-request-visibility-"));
const output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || temporary);
const cloud = process.argv.includes("--cloud");
const clientFile = cloud ? path.resolve(root,"../penecho_cloud/public/canvas/app.js") : path.join(root,"public/app.js");
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) return Readable.from([fs.readFileSync(clientFile, "utf8").replace(/\}\)\(\);\s*$/, `
    if (${cloud}) Object.assign(window.PENECHO_CONFIG,{runtime:'cloud',connectionAccountId:'test-only',linkedDeviceId:'test-only',linkedDeviceOnline:true});
    requireAiConnectionSelection=()=>true;hasSelectedAiConnection=()=>true;selectedAiConnectionId=()=>"test-connection";aiConnectionScope=()=>"test-scope";
    allAiConnections=()=>[{id:'test-connection',provider:'api'}];
    window.visibilityTest={state,smartSuggest,canvasAgent,canvasDocumentsReady,canvasDocumentsCurrent,smartSuggestSyncDocument,smartSuggestRecordStroke,smartSuggestCluster,assistRefresh,renderAssist,hideAssist,clearDirtyContributionTracking,stroke,tiles,requestAI,executeAssistAction,assistAsk,captureSelection,cancelSelection,canvasAgentSubmitMessage,canvasAgentHandleEvent,canvasAgentBeginRequest,canvasAgentRequestDidNotSend,assistAgentFinishResult,assistAgent,restoreWidgets,acceptPending,dirtyInputSnapshots,assistDirtyClusterAtPoint,t};
    window.visibilityCommands=[];window.nextActions='none';window.commandResult='widget';
    const originalFetch=window.fetch;
    window.fetch=(url,options)=>{
      if(url==='/api/v1/auth/session')return Promise.resolve(new Response(JSON.stringify({account:{id:'test-only'}}),{headers:{'Content-Type':'application/json'}}));
      if(url==='/api/ai/command')return new Promise((resolve,reject)=>{
        const entry={resolve,reject};visibilityCommands.push(entry);
        options.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true});
        entry.complete=()=>resolve(new Response(JSON.stringify({commands:commandResult==='draft'?[{tool:'draw',origin:[300,420],types:['line'],items:[[0,0,140,80]],width:30}]:[{tool:'html_widget',pluginId:'general',x:300,y:420,w:400,h:200,title:'Completed result',refreshSeconds:0,html:'<!doctype html><html><body>Completed.</body></html>'}]}),{headers:{'Content-Type':'application/json'}}));
      });
      if(String(url).endsWith('/suggest/status'))return Promise.resolve(new Response(JSON.stringify({configured:true})));
      if(String(url).endsWith('/suggest'))return Promise.resolve(new Response(JSON.stringify({ok:true,answers:{kind:{type:'choice',choice:'notes',probabilities:{notes:1}},action:{type:'choice',choice:nextActions,probabilities:{[nextActions]:1}}}}),{headers:{'Content-Type':'application/json'}}));
      return originalFetch(url,options);
    };
    canvasAgentConnect=async()=>{canvasAgent.socket={readyState:WebSocket.OPEN};canvasAgent.sessionReady=true;canvasAgent.sessionId='test-session';};
    canvasAgentStartNewConversation=async()=>canvasAgentBeginLocalConversation();
    canvasAgentEnsureSearchSession=async()=>{};canvasAgentInitialTurnState=async()=>null;canvasAgentSyncState=()=>{};
    window.agentMessages=[];
    canvasAgentSendEnvelope=(type,payload)=>{agentMessages.push({type,payload});if(type==='cancel')canvasAgentHandleEvent({kind:'turn_end',turn:1,reason:{kind:'cancelled'}});};
  })();`)]);
  return readStream.call(this, file, ...args);
};
let server, win;
const report = { runtime:cloud ? "isolated-cloud-mirror-client" : "local", clientFile, clientSha256:require("node:crypto").createHash("sha256").update(fs.readFileSync(clientFile)).digest("hex"), checks:[], errors:[] };
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    if (cloud) server.prependListener("request", req => {
      if (req.url.startsWith("/canvas/")) req.url = req.url.slice("/canvas".length);
      // Keep Note fallback storage inside this isolated test server as well.
      else if (req.url.startsWith("/api/v1/notes")) req.url = req.url.replace("/api/v1/notes", "/api/notes");
    });
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1280, height:960, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    await win.loadURL('http://127.0.0.1:' + server.address().port);
    for (const [saved, expected] of [[null, false], ["true", true], ["false", false]]) {
      if (saved !== null) {
        await win.webContents.executeJavaScript(`localStorage.setItem('penecho-auto-ai',${JSON.stringify(saved)})`);
        await win.loadURL('http://127.0.0.1:' + server.address().port);
      }
      const automatic = await win.webContents.executeJavaScript(`(async()=>{
        await visibilityTest.canvasDocumentsReady();
        return {enabled:visibilityTest.state.auto,toolbar:document.querySelector('#auto').getAttribute('aria-pressed'),settings:document.querySelector('#settingsAutoToggle').getAttribute('aria-checked'),suggestions:visibilityTest.smartSuggest.enabled};
      })()`);
      assert.equal(automatic.enabled, expected);
      assert.equal(automatic.toolbar, String(expected));
      assert.equal(automatic.settings, String(expected));
      assert.equal(automatic.suggestions, true);
      report.checks.push(saved === null ? "New profiles default to Manual AI with automatic suggestions enabled" : "Saved Auto AI preference survives reload: " + saved);
    }
    report.checks.push(...await win.webContents.executeJavaScript(`(async()=>{
      const t=visibilityTest,s=t.state,a=t.smartSuggest,checks=[];window.visibilityChecks=checks;
      await t.canvasDocumentsReady();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();
      s.auto=false;s.mode='pen';s.language='zh';s.scale=1;s.panX=0;s.panY=0;
      const check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
      const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
      const until=async(predicate)=>{for(let i=0;i<200;i++){if(predicate())return;await pause();}throw Error('Timed out: '+document.querySelector('#status').textContent);};
      const visible=()=>{const element=a.bar?.element;return Boolean(element&&getComputedStyle(element).visibility!=='hidden'&&getComputedStyle(element).display!=='none'&&!document.querySelector('#smartSuggestLayer').hidden&&element.classList.contains('visible'));};
      const seed=()=>{
        t.hideAssist('test-reset');t.cancelSelection(true);t.tiles.clear();s.inkBounds.clear();t.clearDirtyContributionTracking();
        s.history=[];t.restoreWidgets([]);s.images=[];s.textBoxes=[];s.hotspotTrail=[];s.dirty=null;s.mode='pen';
        a.documentId=null;t.smartSuggestSyncDocument();a.requests.clear();a.localReadyAt=0;a.inkReadyAt=0;a.enabled=true;a.available=false;
        const entry={},points=[{x:120,y:160},{x:260,y:220}];s.history.push(entry);
        t.stroke(points[0],points[1],false,6,true,'#111827');
        t.smartSuggestRecordStroke({id:a.nextStrokeId++,points,box:{x:120,y:160,w:140,h:60},at:Date.now(),size:6,historyEntry:entry});
        t.assistRefresh('test-seed');check(visible(),'suggestion is visible before request');return a.bar.element.getBoundingClientRect().toJSON();
      };
      const assertRestored=(before,label)=>{check(visible(),label+' restores suggestions');const after=a.bar.element.getBoundingClientRect();check(Math.abs(before.x-after.x)<1&&Math.abs(before.y-after.y)<1,label+' restores the original position');};

      let before=seed(),start=visibilityCommands.length,promise=t.requestAI('answer');
      check(visible(),'Canvas AI keeps suggestions visible immediately during preparation');
      await until(()=>visibilityCommands.length>start);
      t.assistRefresh('late-ranking');check(visible(),'late refresh preserves suggestions while Canvas AI is running');
      document.querySelector('#aiOrb').click();await promise;assertRestored(before,'Canvas AI Stop');
      check(a.requests.size===0&&s.dirty,'Canvas AI Stop retains input and releases visibility ownership');

      seed();start=visibilityCommands.length;promise=t.requestAI('auto');
      check(visible(),'Auto AI keeps the existing suggestions visible during preparation');
      await until(()=>visibilityCommands.length>start);
      check(visible(),'Auto AI keeps suggestions visible while awaiting a response');
      document.querySelector('#aiOrb').click();await promise;

      before=seed();start=visibilityCommands.length;
      await t.executeAssistAction({id:'solve'},a.bar.target);await until(()=>visibilityCommands.length>start);
      check(!visible()&&a.bar.element.inert,'a Suggest AI action hides its working bar during the request');
      document.querySelector('#aiOrb').click();await until(()=>!s.activeAI);assertRestored(before,'suggestion action Stop');

      before=seed();const record=a.strokes.at(-1);
      t.captureSelection([{x:90,y:120},{x:300,y:120},{x:300,y:260},{x:90,y:260}]);
      await until(()=>a.bar?.mode==='suggest'&&a.bar.target?.selection&&visible());
      before=a.bar.element.getBoundingClientRect().toJSON();start=visibilityCommands.length;
      await t.executeAssistAction({id:'solve'},a.bar.target);await until(()=>visibilityCommands.length>start);
      check(!visible(),'lasso Suggest requests hide their working bar');document.querySelector('#aiOrb').click();
      await until(()=>!s.selection?.aiRequest);assertRestored(before,'lasso Stop');
      check(!record.inputConsumed,'lasso Stop preserves source ink');

      for(const id of ['answer','typeset','note','ask']) {
        before=seed();start=visibilityCommands.length;
        if(id==='ask')await t.assistAsk('Explain the selected content',a.bar.target);
        else await t.executeAssistAction({id},a.bar.target);
        await until(()=>visibilityCommands.length>start);
        check(!visible(),'Suggest '+id+' hides the bar even when its executor uses Canvas AI');
        if(id==='note') {visibilityCommands[start].complete();await until(()=>!s.activeAI&&s.widgets.some(widget=>widget.sourceFormat==='penecho-note-card+json'));}
        else {document.querySelector('#aiOrb').click();await until(()=>!s.activeAI&&!s.selection?.aiRequest);}
      }

      seed();a.available=true;nextActions='none';start=visibilityCommands.length;promise=t.requestAI('answer');
      await until(()=>visibilityCommands.length>start);visibilityCommands[start].complete();await promise;
      check(!visible(),'successful Canvas AI immediately hides the old bar before Next ranking');
      await until(()=>a.bar?.mode==='followup'||!a.bar);await pause();await pause();
      check(!visible(),'successful Canvas AI does not restore old suggestions when no next action exists');
      t.assistRefresh('late-after-success');check(!visible(),'late ranking after success does not reopen old suggestions');
      check(s.widgets.length===1,'the successful result is retained');

      seed();a.available=true;nextActions='explain';start=visibilityCommands.length;promise=t.requestAI('answer');
      await until(()=>visibilityCommands.length>start);visibilityCommands[start].complete();await promise;
      await until(()=>a.bar?.mode==='followup'&&visible());
      check(a.bar.element.textContent.includes(t.t('assistNext')),'successful Canvas AI retains existing Next actions');

      seed();commandResult='draft';start=visibilityCommands.length;
      await t.executeAssistAction({id:'solve'},a.bar.target);
      await until(()=>visibilityCommands.length>start);promise=a.bar.target.requestPromise;
      check(!visible(),'Suggest draft requests hide the working bar');visibilityCommands[start].complete();
      await until(()=>s.pending&&a.bar?.mode==='result');
      check(visible()&&!a.bar.element.inert,'draft Keep controls remain visible and usable before the request settles');
      a.bar.element.querySelector('.assist-action.primary').click();await promise;
      check(!s.pending,'Keep still commits the generated draft');commandResult='widget';

      before=seed();const sent=await t.canvasAgentSubmitMessage({textOverride:'Test request',omitInitialCapture:true,clearInput:false,includeDraftMedia:false});
      check(sent&&visible(),'Agent submission keeps suggestions visible while awaiting turn_start');
      t.canvasAgentHandleEvent({kind:'turn_start',turn:1});check(visible(),'Agent running keeps suggestions visible');
      document.querySelector('#canvasAgentStop').click();assertRestored(before,'Agent Stop');
      check(agentMessages.at(-1).type==='cancel','Agent Stop still sends cancellation');

      before=seed();await t.executeAssistAction({id:'animate'},a.bar.target);
      check(t.canvasAgent.requestPending&&!visible(),'suggestion Agent handoff hides suggestions after image capture');
      await new Promise(resolve=>setTimeout(resolve,600));check(!visible(),'suggestion Agent handoff stays hidden while awaiting the turn');
      check(a.consumedStrokeId===0,'suggestion Agent submission keeps the old suggestion recoverable');
      t.canvasAgentHandleEvent({kind:'turn_start',turn:1});document.querySelector('#canvasAgentStop').click();
      assertRestored(before,'suggestion Agent Stop');

      seed();const original=a.strokes.at(-1);
      await t.canvasAgentSubmitMessage({textOverride:'Test success',clearInput:false,includeDraftMedia:false});
      check(t.dirtyInputSnapshots.size===1,'ordinary Agent owns its submitted Canvas input snapshot');
      t.canvasAgentHandleEvent({kind:'turn_start',turn:2});
      t.canvasAgentHandleEvent({kind:'turn_end',turn:2,reason:{kind:'completed'}});
      check(!visible(),'successful ordinary Agent does not restore old suggestions');
      check(s.dirty===null&&original.inputConsumed,'successful ordinary Agent clears submitted dirty pixels and retires original strokes');
      check(t.dirtyInputSnapshots.size===0,'successful Agent releases its input snapshot');
      check(!t.assistDirtyClusterAtPoint({x:180,y:185}),'revisiting completed source cannot reopen old dirty suggestions');
      t.assistRefresh('late-agent-ranking');check(!visible(),'old Agent input stays dismissed after later refresh');

      seed();await t.canvasAgentSubmitMessage({textOverride:'Test while writing',clearInput:false,includeDraftMedia:false});
      t.canvasAgentHandleEvent({kind:'turn_start',turn:2});
      const newerEntry={},newer={id:a.nextStrokeId++,points:[{x:500,y:180},{x:600,y:220}],box:{x:500,y:180,w:100,h:40},at:Date.now(),size:6,historyEntry:newerEntry};
      s.history.push(newerEntry);t.stroke(newer.points[0],newer.points[1],false,6,true,'#111827');t.smartSuggestRecordStroke(newer);
      t.assistRefresh('newer-ink');check(visible(),'the existing bar stays visible while new writing waits for Agent completion');
      t.canvasAgentHandleEvent({kind:'turn_end',turn:2,reason:{kind:'completed'}});
      await until(()=>a.bar?.mode==='suggest'&&visible());
      check(a.bar.cluster.strokes.every(record=>record.id===newer.id),'completion resumes only newly added ink suggestions');
      check(s.dirty&&s.dirty.x>=490&&!newer.inputConsumed,'new writing remains dirty after Agent completion');

      seed();const old=a.strokes.at(-1);
      await t.canvasAgentSubmitMessage({textOverride:'Test overlapping writing',clearInput:false,includeDraftMedia:false});
      t.canvasAgentHandleEvent({kind:'turn_start',turn:4});
      const overlappingEntry={},overlapping={id:a.nextStrokeId++,points:[{x:120,y:160},{x:190,y:190}],box:{x:120,y:160,w:70,h:30},at:Date.now(),size:6,historyEntry:overlappingEntry};
      s.history.push(overlappingEntry);t.stroke(overlapping.points[0],overlapping.points[1],false,6,true,'#111827');t.smartSuggestRecordStroke(overlapping);
      t.canvasAgentHandleEvent({kind:'turn_end',turn:4,reason:{kind:'completed'}});
      check(old.inputConsumed&&!overlapping.inputConsumed&&s.dirty,'overlapping new writing remains dirty while old source retires');

      before=seed();await t.canvasAgentSubmitMessage({textOverride:'Test failure with input',clearInput:false,includeDraftMedia:false});
      t.canvasAgentHandleEvent({kind:'turn_start',turn:5});
      t.canvasAgentHandleEvent({kind:'turn_end',turn:5,reason:{kind:'error',error:{message:'Controlled test failure'}}});
      assertRestored(before,'Agent failure');
      check(s.dirty&&!a.strokes.at(-1).inputConsumed&&t.dirtyInputSnapshots.size===0,'Agent failure preserves input and releases the snapshot');

      before=seed();t.canvasAgentBeginRequest();t.canvasAgentRequestDidNotSend();assertRestored(before,'failed Agent submission');

      seed();a.available=true;nextActions='explain';t.canvasAgentBeginRequest();t.canvasAgentHandleEvent({kind:'turn_start',turn:3});
      const box={x:300,y:420,w:400,h:200};
      t.stroke({x:300,y:420},{x:440,y:500},false,4,false,'#2563eb');
      t.assistAgent.resultTarget={box,action:'explain',resultBox:box,generation:t.assistAgent.generation,documentId:t.canvasDocumentsCurrent().id,conversationId:t.canvasAgent.currentConversation.id,strokeId:a.strokes.at(-1).id};
      t.canvasAgentHandleEvent({kind:'turn_end',turn:3,reason:{kind:'completed'}});
      await until(()=>a.bar?.mode==='followup'&&visible());
      check(a.bar.element.textContent.includes(t.t('assistNext')),'successful suggestion Agent retains existing Next actions');
      return checks;
    })();`));
    for (const width of [1280, 760]) {
      win.setSize(width, 960);
      await win.webContents.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const layout = await win.webContents.executeJavaScript(`(()=>{const bar=visibilityTest.smartSuggest.bar.element,rect=bar.getBoundingClientRect();return{bounded:rect.left>=0&&rect.right<=innerWidth+1&&rect.top>=0&&rect.bottom<=innerHeight+1,labelsFit:[...bar.querySelectorAll('button')].every(button=>button.scrollWidth<=button.clientWidth+1)}})()`);
      assert.ok(layout.bounded && layout.labelsFit, "Next actions must fit viewport " + width);
      report.checks.push("Next actions and labels fit viewport " + width);
      fs.writeFileSync(path.join(output, "completed-next-" + width + ".png"), (await win.webContents.capturePage()).toPNG());
    }
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  } catch (error) {
    if(win)report.checks.push(...await win.webContents.executeJavaScript('window.visibilityChecks||[]').catch(()=>[]));
    report.failure = error.stack;
    console.error(JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    win?.destroy();server?.close();fs.rmSync(temporary, { recursive:true, force:true });app.exit(process.exitCode || 0);
  }
});
