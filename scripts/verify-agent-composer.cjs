'use strict';
// Render the canonical client with isolated storage. Stub model/Agent transport,
// retain real content commits, composer DOM, submit and conversation projection.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {Readable}=require('node:stream'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-composer-'));
const output=path.join(root,'docs/verification/agent-composer-no-ranking-20261004');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(temporary,'profile'));
Object.assign(process.env,{NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:path.join(temporary,'state'),
  PENECHO_CONFIG_FILE:path.join(temporary,'config.env'),HOST:'127.0.0.1',PORT:'0',AI_PROVIDER:'api',AI_API_KEY:'test-only',
  AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'test',PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false',PENECHO_JEVISION_ENABLED:'false'});
const injection=`
window.composerAudit={state,smartSuggest,canvasAgent,canvasDocuments,canvasDocumentsCurrent,canvasDocumentsRecord,canvasDocumentsShow,canvasDocumentsReady,canvasDocumentsPark,canvasDocumentsSaveMetadata,saveDeviceSnapshot,loadSnapshot,loadCanvasSettings,settings,storeAiConnectionSelection,
  openCanvasAgent,closeCanvasAgent,t,updateCanvasAgentLanguage,canvasAgentCanvasDidChange,canvasAgentHandleEvent,canvasAgentSyncPromptSuggestions,
  stroke,save,recordWidgetsBefore,addClipboardText,confirmTextEditor,undo,redo,render,cancelSmartSuggest,rankRequests:[],envelopes:[]};
const composerFetch=window.fetch;
window.fetch=async(url,options)=>{
  if(String(url).endsWith('/suggest/status'))return new Response(JSON.stringify({configured:true}),{headers:{'Content-Type':'application/json'}});
  if(String(url).endsWith('/suggest')){
    composerAudit.rankRequests.push(JSON.parse(options.body));
    const pick=value=>({type:'choice',choice:value,confidence:1,probabilities:{[value]:1}});
    return new Response(JSON.stringify({ok:true,answers:{kind:pick('math_expr'),action:pick('solve')}}),{headers:{'Content-Type':'application/json'}});
  }
  return composerFetch(url,options);
};
canvasAgentConnect=async()=>{
  canvasAgent.socket={readyState:WebSocket.OPEN,send:body=>composerAudit.envelopes.push(JSON.parse(body)),close(){}};
  canvasAgent.sessionId='composer-test-session';canvasAgent.sessionReady=true;
};
canvasAgentEnsureSearchSession=async()=>{};
`;
const originalStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(path.resolve(String(file))===path.join(root,'public/app.js'))return Readable.from([fs.readFileSync(file,'utf8').replace(/\}\)\(\);\s*$/,injection+'})();')]);
  return originalStream.call(this,file,...args);
};
const report={syntheticTransport:true,providerSemantics:'not measured',clientSha256:createHash('sha256').update(fs.readFileSync(path.join(root,'public/app.js'))).digest('hex'),checks:[],errors:[]};
let server,win;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  try{
    server=require('../server.js');await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
    win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)report.errors.push(message);});
    const js=code=>win.webContents.executeJavaScript(code,true);
    const until=async expression=>{const end=Date.now()+6000;while(!await js(expression)){if(Date.now()>end)throw Error('Timed out: '+expression);await pause(30);}};
    const shot=async name=>{
      await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      await pause(100);
      fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
    };
    await win.loadURL('http://127.0.0.1:'+server.address().port);
    await js(`(async()=>{const a=composerAudit;await a.canvasDocumentsReady();await a.loadCanvasSettings();a.storeAiConnectionSelection(a.settings.connections[0].id);
      document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelector('#canvasWelcome').hidden=true;
      a.state.auto=false;a.state.canvasAgentAutoOpen=false;a.state.language='zh';a.updateCanvasAgentLanguage();})()`);await pause(150);
    const composerState=()=>js(`(()=>{const a=composerAudit,i=document.querySelector('#canvasAgentInput');return {value:i.value,placeholder:i.placeholder,
      expected:a.t('canvasAgentPlaceholder'),ranked:i.dataset.llmSuggestion||'',sendDisabled:document.querySelector('#canvasAgentSend').disabled};})()`);
    const assertEmptyComposer=async()=>{const state=await composerState();assert.equal(state.value,'');assert.equal(state.placeholder,state.expected);assert.equal(state.ranked,'');assert.equal(state.sendDisabled,true);return state;};
    await js(`document.querySelector('#changelogClose')?.click();composerAudit.smartSuggest.available=true;composerAudit.canvasAgent.initialCanvasAutoHidePending=false;composerAudit.openCanvasAgent({focus:false,connect:false,animate:false});`);await pause(800);
    assert.equal(await js('composerAudit.rankRequests.length'),0);await assertEmptyComposer();
    report.checks.push({name:'empty Canvas keeps ordinary placeholder with no ranking request'});await shot('empty');
    // Opening clean content must not create a composer ranking request.
    await js(`(async()=>{const a=composerAudit;const target=a.canvasDocumentsRecord({documentId:crypto.randomUUID(),title:'Clean nonempty Canvas'},
      {item:{version:2,theme:a.state.theme,widgets:[],textBoxes:[{id:'text-box-1',text:'2x + 3 = 11',x:16300,y:16300,w:240,h:55,fontSize:24,maxWidth:240}],images:[],animations:[]},tileEntries:[]});
      a.canvasDocuments.records.set(target.id,target);await a.canvasDocumentsShow(target.id);a.originalDocument=target.id;})()`);
    await pause(800);await assertEmptyComposer();assert.equal(await js('composerAudit.rankRequests.length'),0);
    report.checks.push({name:'opening clean nonempty Canvas does not rank Agent input'});await shot('nonempty');
    await js(`composerAudit.closeCanvasAgent({focus:false,animate:false});composerAudit.openCanvasAgent({focus:false,connect:false,animate:false});composerAudit.state.panX+=30;composerAudit.render();`);
    await pause(700);await assertEmptyComposer();assert.equal(await js('composerAudit.rankRequests.length'),0);
    report.checks.push({name:'panel toggles and pan keep ordinary placeholder'});
    // A genuinely unopened saved snapshot retains the previous Canvas draft.
    await js(`(async()=>{const a=composerAudit;await a.canvasDocumentsPark();const stored=a.canvasDocumentsCurrent().stored,id=crypto.randomUUID();
      await a.saveDeviceSnapshot({...stored.item,id,name:'Saved load fixture',createdAt:Date.now(),updatedAt:Date.now(),tileCount:stored.tileEntries.length,
        bundleExtensions:a.canvasDocumentsSaveMetadata({copy:true})},stored.tileEntries,null);
      const i=document.querySelector('#canvasAgentInput');i.value='Unsent pre-load draft';i.dispatchEvent(new Event('input',{bubbles:true}));
      a.closeCanvasAgent({focus:false,animate:false});a.state.canvasAgentAutoOpen=true;
      if(!await a.loadSnapshot(id,'device'))throw Error('Saved snapshot did not load');})()`);
    await pause(800);await assertEmptyComposer();assert.equal(await js('composerAudit.rankRequests.length'),0);
    assert.equal(await js("composerAudit.canvasDocuments.records.get(composerAudit.originalDocument).agentDraft"),'Unsent pre-load draft');
    report.checks.push({name:'saved nonempty Canvas loads without ranking and preserves previous draft'});await shot('loaded-snapshot');
    // Canvas Suggest remains enabled and can rank actual user content independently.
    await js(`(async()=>{const a=composerAudit;a.addClipboardText('3x = 12');await a.confirmTextEditor([...a.state.textEditors.values()][0]);})()`);
    await until('composerAudit.rankRequests.length>0');await pause(700);
    // The first committed user edit follows the existing initial-panel auto-hide.
    // Reopen it before exercising native composer input and inspecting pixels.
    await js(`composerAudit.openCanvasAgent({focus:false,connect:false,animate:false})`);await pause(150);await assertEmptyComposer();
    report.checks.push({name:'Canvas Suggest ranks dirty input without changing Agent placeholder',requests:await js('composerAudit.rankRequests.length')});await shot('canvas-suggest');
    const ranksBeforeTyping=await js('composerAudit.rankRequests.length');
    await js(`document.querySelector('#canvasAgentInput').focus()`);win.webContents.insertText('我的问题');
    await until("document.querySelector('#canvasAgentInput').value==='我的问题'");
    assert.equal((await composerState()).sendDisabled,false);await shot('typed');
    await js(`(()=>{const i=document.querySelector('#canvasAgentInput');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await pause(400);await assertEmptyComposer();assert.equal(await js('composerAudit.rankRequests.length'),ranksBeforeTyping);
    report.checks.push({name:'typing enables Send and clearing restores ordinary placeholder without ranking'});
    await js(`document.querySelector('#canvasAgentInput').focus()`);
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});
    await pause(200);assert.equal(await js("composerAudit.envelopes.filter(e=>e.type==='user_turn').length"),0);
    report.checks.push({name:'Enter with empty input does not send a placeholder'});
    win.webContents.insertText('解释这道题');await until("document.querySelector('#canvasAgentInput').value==='解释这道题'");
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});
    await until("composerAudit.envelopes.some(e=>e.type==='user_turn')");
    const sent=await js("composerAudit.envelopes.find(e=>e.type==='user_turn')");assert.equal(sent.payload.text,'解释这道题');
    assert.equal(await js("[...document.querySelectorAll('.canvas-agent-message.user')].some(r=>r.textContent.includes('解释这道题'))"),true);
    await js(`composerAudit.canvasAgentHandleEvent({kind:'turn_start'});composerAudit.canvasAgentHandleEvent({kind:'assistant_message',text:'x = 4'});composerAudit.canvasAgentHandleEvent({kind:'turn_end',reason:{kind:'completed'}});`);
    assert.equal(await js("[...document.querySelectorAll('.canvas-agent-message.assistant')].some(r=>r.textContent.includes('x = 4'))"),true);
    await assertEmptyComposer();report.checks.push({name:'typed Enter still sends an ordinary Agent turn and renders its response'});await shot('agent-conversation');
    await js(`composerAudit.state.language='en';composerAudit.updateCanvasAgentLanguage();`);await assertEmptyComposer();
    report.checks.push({name:'language change retains ordinary localized placeholder'});
    assert.deepEqual(report.errors,[]);fs.rmSync(path.join(output,'failure.png'),{force:true});console.log(JSON.stringify({output,checks:report.checks.length,errors:report.errors}));
  }catch(error){report.failure=error.stack;console.error(error);process.exitCode=1;if(win){
    report.state=await win.webContents.executeJavaScript(`(()=>{const t=composerAudit;return {open:!document.querySelector('#canvasAgentPanel').hidden,available:t.smartSuggest.available,

      ranks:t.rankRequests.length,running:t.canvasAgent.running,requestPending:t.canvasAgent.requestPending,textEditors:t.state.textEditors.size,
      placeholder:document.querySelector('#canvasAgentInput').placeholder,status:document.querySelector('#canvasAgentStatus').textContent};})()`);
    await fs.promises.writeFile(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());}}
  finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');win?.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode||0);}
});
