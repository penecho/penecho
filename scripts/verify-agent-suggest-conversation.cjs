'use strict';
// Render the canonical client with isolated storage. Stub model/Agent transport,
// retain real content commits, composer DOM, submit and conversation projection.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {Readable}=require('node:stream'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-suggest-conversation-'));
const output=path.join(root,'docs/verification/agent-suggest-conversation-20261004');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(temporary,'profile'));
Object.assign(process.env,{NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:path.join(temporary,'state'),
  PENECHO_CONFIG_FILE:path.join(temporary,'config.env'),HOST:'127.0.0.1',PORT:'0',AI_PROVIDER:'api',AI_API_KEY:'test-only',
  AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'test',PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false',PENECHO_JEVISION_ENABLED:'false'});
const injection=`
window.suggestAudit={state,smartSuggest,canvasAgent,agentSuggest,canvasDocumentsReady,loadCanvasSettings,settings,storeAiConnectionSelection,
  openCanvasAgent,closeCanvasAgent,t,updateCanvasAgentLanguage,canvasAgentFitPromptTabs,canvasAgentSyncPromptSuggestions,
  addClipboardText,confirmTextEditor,canvasAgentRenderConversation,canvasAgentRenderAttachments,canvasAgentSetRunning,canvasAgentSyncFollowLatest,CANVAS_AGENT_PROMPT_LIBRARY,requests:[],envelopes:[],
  diagnostics:()=>({eligible:agentSuggestPanelVisible(),empty:agentSuggestComposerEmpty(),busy:agentSuggestAgentBusy(),available:canvasAgentPromptSuggestionsAvailable(),draft:canvasAgentPromptHasDraft(),mode:canvasAgent.inputMode,attachments:canvasAgent.attachments.length,references:canvasAgent.references.length,transcript:canvasAgentTranscript.innerText,refHidden:canvasAgentReferencePicker.hidden,approvalHidden:canvasAgentApproval.hidden})};
const auditFetch=window.fetch;
let auditUsed=37;
const auditAccess=()=>({signedIn:false,subscribed:false,freeLimit:200,used:auditUsed,remaining:200-auditUsed,paidEnabled:false,spentToday:0,reason:null});
window.fetch=async(url,options)=>{
  if(String(url).endsWith('/suggest/status'))return new Response(JSON.stringify({configured:true,access:auditAccess()}),{headers:{'Content-Type':'application/json'}});
  if(String(url).endsWith('/suggest')){
    const request=JSON.parse(options.body);suggestAudit.requests.push(request);
    if(request.mode!=='agent')return new Response(JSON.stringify({ok:true,answers:{action:{type:'choice',choice:'none',probabilities:{none:1}}}}),{headers:{'Content-Type':'application/json'}});
    await new Promise(resolve=>setTimeout(resolve,suggestAudit.delayMs||500));auditUsed++;
    const answers=Object.fromEntries(request.context.prompts.map((id,index)=>['prompt_'+id,{type:'noul',noul:[.82,.58,.31,.18,.1][index]??.02}]));
    return new Response(JSON.stringify({ok:true,answers,access:auditAccess(),chargedCredits:0,cached:false}),{headers:{'Content-Type':'application/json'}});
  }
  return auditFetch(url,options);
};
canvasAgentConnect=async()=>{canvasAgent.socket={readyState:WebSocket.OPEN,send:body=>suggestAudit.envelopes.push(JSON.parse(body)),close(){}};canvasAgent.sessionId='suggest-review';canvasAgent.sessionReady=true;};
`;
const originalStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(path.resolve(String(file))===path.join(root,'public/app.js'))return Readable.from([fs.readFileSync(file,'utf8').replace(/\}\)\(\);\s*$/,injection+'})();')]);
  return originalStream.call(this,file,...args);
};
const report={syntheticTransport:true,syntheticFocusEvents:true,clientSha256:createHash('sha256').update(fs.readFileSync(path.join(root,'public/app.js'))).digest('hex'),checks:[],findings:{},errors:[]};
let server,win;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  try{
    server=require('../server.js');await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
    win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)report.errors.push(message);});
    const js=code=>win.webContents.executeJavaScript(code,true);
    const until=async expression=>{const end=Date.now()+7000;while(!await js(expression)){if(Date.now()>end)throw Error('Timed out: '+expression);await pause(25);}};
    const shot=async name=>{await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await pause(100);fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());};
    await win.loadURL('http://127.0.0.1:'+server.address().port);
    await js(`(async()=>{const a=suggestAudit;await a.canvasDocumentsReady();await a.loadCanvasSettings();a.storeAiConnectionSelection(a.settings.connections[0].id);
      document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelector('#canvasWelcome').hidden=true;
      a.state.auto=false;a.state.canvasAgentAutoOpen=false;a.state.language='en';a.updateCanvasAgentLanguage();a.smartSuggest.available=true;a.smartSuggest.enabled=true;
      a.canvasAgent.initialCanvasAutoHidePending=false;a.openCanvasAgent({focus:false,connect:false,animate:false});})()`);await pause(400);
    // The release dialog opens after the tour closes and owns modal focus.
    await js(`document.querySelector('#changelogClose')?.click()`);await pause(150);
    // Hidden offscreen windows can change activeElement without native focus
    // events. Dispatch the same DOM event through the real composer listener.
    const focusComposer=()=>js(`(()=>{const i=document.querySelector('#canvasAgentInput');i.focus();i.dispatchEvent(new FocusEvent('focus'));})()`);
    const visible=()=>js("!document.querySelector('#canvasAgentPromptSuggestions').hidden");
    const count=()=>js("suggestAudit.requests.filter(r=>r.mode==='agent').length");
    const dismiss=()=>js("document.querySelector('#canvasAgentTranscript').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'}))");
    const layout=()=>js(`(()=>{const get=id=>{const e=document.querySelector(id),r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,width:r.width,display:getComputedStyle(e).display,scrollTop:e.scrollTop,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight};};return {transcript:get('#canvasAgentTranscript'),suggestions:get('#canvasAgentPromptSuggestions'),conversation:get('.canvas-agent-conversation'),form:get('#canvasAgentForm')};})()`);
    await focusComposer();await pause(500);
    assert.equal(await count(),0);report.checks.push('blank Canvas stays unranked');
    await shot('welcome');
    await js(`(()=>{const a=suggestAudit;a.canvasAgent.attachments=[{id:'sheet',kind:'file',name:'Quarterly results.xlsx',mediaType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}];a.canvasAgentRenderAttachments();})()`);
    await focusComposer();await until("suggestAudit.agentSuggest.status==='loading'");
    await until("suggestAudit.agentSuggest.status==='ready'");assert.equal(await count(),1);
    assert.equal(await js("suggestAudit.requests.find(r=>r.mode==='agent').context.attachments[0]"),'spreadsheet');
    assert.equal(await js("suggestAudit.canvasAgent.attachments.length"),1);
    report.checks.push('attachment-only composer ranks without consuming its file');
    await dismiss();
    // Project real message records through the production conversation renderer.
    await js(`(()=>{const a=suggestAudit,c=a.canvasAgent.currentConversation;c.items=Array.from({length:12},(_,index)=>({id:'message-'+index,type:'message',role:index%2?'assistant':'user',text:index%2?'The Canvas now contains the project overview. We can next inspect the quarterly spreadsheet, compare the source files, or add a clear summary beside the diagram.':'Please organize the project information on the Canvas.',final:true}));a.canvasAgentRenderConversation(c,true);a.canvasAgentSyncPromptSuggestions();})()`);
    assert.equal(await visible(),false);const transcriptText=await js("document.querySelector('#canvasAgentTranscript').textContent");
    await focusComposer();await pause(150);
    assert.equal(await visible(),true);assert.equal(await count(),1,'unchanged attachment context reuses ranking');
    let metrics=await layout();assert.equal(metrics.transcript.display,'flex');assert.ok(metrics.transcript.height>metrics.suggestions.height);assert.ok(metrics.suggestions.height<=metrics.conversation.height*.45+1);
    assert.ok(metrics.transcript.bottom<=metrics.suggestions.top+1);assert.ok(metrics.suggestions.bottom<=metrics.form.top+1);
    assert.ok(Math.abs(metrics.transcript.scrollHeight-metrics.transcript.clientHeight-metrics.transcript.scrollTop)<2,'keep latest message visible');
    report.layout=metrics;await shot('conversation-ranked');
    await dismiss();await pause(150);assert.equal(await visible(),false);metrics=await layout();assert.ok(Math.abs(metrics.transcript.scrollHeight-metrics.transcript.clientHeight-metrics.transcript.scrollTop)<2);
    report.checks.push('existing messages stay visible above a bounded Suggest region; bottom anchoring survives dismissal');
    // A reader of earlier messages retains their position in both directions.
    await js(`(()=>{const e=document.querySelector('#canvasAgentTranscript');e.scrollTop=100;suggestAudit.canvasAgentSyncFollowLatest();})()`);await pause(60);
    const readingTop=await js("document.querySelector('#canvasAgentTranscript').scrollTop");
    await focusComposer();await pause(100);assert.equal(await js("document.querySelector('#canvasAgentTranscript').scrollTop"),readingTop);
    await dismiss();await pause(100);assert.equal(await js("document.querySelector('#canvasAgentTranscript').scrollTop"),readingTop);
    report.checks.push('opening and closing preserve the position of a reader of earlier messages');
    // Force a distinct ranking, then leave while the response is pending.
    await js(`suggestAudit.agentSuggest.lastRequestAt=0;suggestAudit.canvasAgent.attachments.push({id:'second',kind:'file',name:'design.pdf'});suggestAudit.canvasAgentRenderAttachments();suggestAudit.delayMs=1800;`);
    await focusComposer();await until("suggestAudit.agentSuggest.status==='loading'");await shot('conversation-loading');
    await dismiss();assert.equal(await visible(),false);await until("suggestAudit.agentSuggest.status==='ready'");
    await js("suggestAudit.canvasAgentSyncPromptSuggestions()");assert.equal(await visible(),false);
    assert.equal(await js("document.querySelector('#canvasAgentTranscript').textContent"),transcriptText);
    report.checks.push('clicking transcript dismisses immediately; late ranking caches without reopening or changing messages');
    await focusComposer();await pause(100);const beforeTyping=await count();
    await js(`(()=>{const i=document.querySelector('#canvasAgentInput');i.value='My own question';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);assert.equal(await visible(),false);
    await js(`suggestAudit.canvasAgentSyncPromptSuggestions();document.querySelector('#canvasAgentInput').value='';document.querySelector('#canvasAgentInput').dispatchEvent(new Event('input',{bubbles:true}));`);
    assert.equal(await visible(),false);assert.equal(await count(),beforeTyping);
    // Keyboard moving into the panel is safe; moving out dismisses.
    await js("document.querySelector('#canvasAgentPromptToggle').click()");assert.equal(await visible(),true);
    await js(`document.querySelector('#canvasAgentPromptFilesTab').focus();document.querySelector('#canvasAgentInput').dispatchEvent(new FocusEvent('focusout',{bubbles:true}));`);await pause(20);assert.equal(await visible(),true);
    await js(`document.querySelector('#canvasAgentProject').focus();document.querySelector('#canvasAgentPromptFilesTab').dispatchEvent(new FocusEvent('focusout',{bubbles:true}));`);await pause(20);assert.equal(await visible(),false);
    report.checks.push('typing closes the region; clearing does not reopen it; keyboard navigation into tabs is safe and leaving dismisses');
    await focusComposer();
    await js("document.querySelector('#canvasAgentInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    assert.equal(await visible(),false);assert.equal(await js("document.querySelector('#canvasAgentPanel').hidden"),false);
    await js("suggestAudit.canvasAgentSyncPromptSuggestions()");assert.equal(await visible(),false);
    report.checks.push('Escape closes suggestions first and leaves Agent open');
    await focusComposer();
    await js("suggestAudit.canvasAgentSetRunning(true)");assert.equal(await visible(),false);
    await js("suggestAudit.canvasAgentSetRunning(false)");assert.equal(await visible(),false);
    await js("suggestAudit.canvasAgentSyncPromptSuggestions()");assert.equal(await visible(),false);
    report.checks.push('starting and finishing an Agent turn cannot overlay suggestions on its response');
    for(const language of ['en','zh']){
      await js(`document.querySelector('[data-language="${language}"]').click();document.documentElement.style.setProperty('--canvas-agent-width','360px');document.body.style.setProperty('--canvas-agent-width','360px');`);
      await focusComposer();await js("suggestAudit.canvasAgentFitPromptTabs()");await pause(150);
      const tabs=await js(`(()=>{const b=document.querySelector('#canvasAgentPromptCategories');return {width:b.clientWidth,scroll:b.scrollWidth,visible:Array.from(b.querySelectorAll('[role=tab]')).filter(t=>!t.hidden).length};})()`);
      assert.equal(tabs.visible,4);assert.ok(tabs.scroll<=tabs.width+1,JSON.stringify(tabs));
      const rows=await js("Array.from(document.querySelectorAll('#canvasAgentSuggestItems .canvas-agent-suggest-row'),r=>[r.textContent,r.title,r.getAttribute('aria-label')].join(' '))");
      assert.equal(rows.length,4);for(const row of rows)assert.doesNotMatch(row,/\d\s*[%％]/);
      assert.ok(await js("document.querySelector('.canvas-agent-suggest-usage').textContent.length>0"));
      await shot('conversation-narrow-'+language);
      report.checks.push(language+': four tabs fit at 360px; usage remains visible and probabilities stay internal');
    }
    for(const pointerType of ['touch','pen','mouse']){
      await js("document.querySelector('#canvasAgentInput').value='';suggestAudit.canvasAgentSyncPromptSuggestions()");await focusComposer();
      const chosen=await js(`(()=>{const a=suggestAudit,row=document.querySelector('#canvasAgentSuggestItems [data-recommended=true]'),expected=a.t(a.CANVAS_AGENT_PROMPT_LIBRARY[row.dataset.suggestId].prompt);row.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'${pointerType}'}));row.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'${pointerType}'}));row.click();return {expected,value:document.querySelector('#canvasAgentInput').value,focused:document.activeElement.id,files:a.canvasAgent.attachments.length};})()`);
      assert.equal(chosen.value,chosen.expected);assert.equal(chosen.files,2);assert.equal(await visible(),false);assert.equal(await js('suggestAudit.envelopes.length'),0);
      assert.equal(chosen.focused,pointerType==='mouse'?'canvasAgentInput':'canvasAgentPromptToggle');
      report.checks.push(pointerType+': choosing replaces draft, preserves attachments, closes region, and never sends');
    }
    await shot('conversation-dismissed');
    for(const [width,height,label] of [[1440,640,'short-desktop'],[390,844,'mobile']]){
      win.setSize(width,height);await pause(450);
      await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click()");await pause(150);
      await js("document.querySelector('#canvasAgentInput').value='';suggestAudit.canvasAgentSyncPromptSuggestions()");await focusComposer();await pause(100);
      const m=await layout();assert.ok(m.transcript.height>0);assert.equal(m.transcript.display,'flex');assert.ok(m.suggestions.height<=m.conversation.height*.45+1);
      const ui=await js(`(()=>{const bar=document.querySelector('#canvasAgentPromptCategories'),popup=document.querySelector('#canvasAgentPromptPopup');return {width:bar.clientWidth,scroll:bar.scrollWidth,height:popup.clientHeight,control:getComputedStyle(document.querySelector('#canvasAgentPromptControl')).display};})()`);
      assert.ok(ui.width>=ui.scroll-1,JSON.stringify(ui));assert.ok(ui.height>=44,JSON.stringify(ui));assert.notEqual(ui.control,'none');
      await shot('conversation-'+label);
      assert.equal(await js(`(()=>{const e=document.querySelector('#canvasAgentPromptCategories'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})()`),true,'tabs must not be covered by an onboarding overlay');
      report.checks.push(label+': chat remains visible, all tabs fit, list can scroll and Try asking is accessible');
    }
    await js("suggestAudit.closeCanvasAgent({focus:false,animate:false});suggestAudit.openCanvasAgent({focus:false,connect:false,animate:false});suggestAudit.canvasAgentSyncPromptSuggestions()");
    assert.equal(await visible(),false);report.checks.push('closing and reopening Agent does not resurrect a dismissed list');
    await js("document.querySelector('#canvasAgentInput').value='';suggestAudit.canvasAgentSyncPromptSuggestions()");await focusComposer();
    // Submit intent closes even an empty request, before async send guards.
    await js("document.querySelector('#canvasAgentForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");assert.equal(await visible(),false);
    report.checks.push('submit immediately dismisses suggestions');
    assert.deepEqual(report.errors,[]);console.log(JSON.stringify({output,checks:report.checks.length,errors:report.errors}));
  }catch(error){report.failure=error.stack;console.error(error);process.exitCode=1;if(win){report.state=await win.webContents.executeJavaScript(`(()=>{const a=suggestAudit;return {open:!document.querySelector('#canvasAgentPanel').hidden,focused:document.activeElement?.id,status:a.agentSuggest.status,reason:a.agentSuggest.reason,pending:a.agentSuggest.pendingKey,timer:a.agentSuggest.focusTimer,available:a.smartSuggest.available,enabled:a.smartSuggest.enabled,access:a.smartSuggest.access,requests:a.requests.map(r=>r.mode),value:document.querySelector('#canvasAgentInput').value,...a.diagnostics()};})()`);console.error(JSON.stringify(report.state));}}
  finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');win?.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode||0);}
});
