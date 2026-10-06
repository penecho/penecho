'use strict';
// Render the canonical client with isolated storage. Stub model/Agent transport,
// retain real content commits, composer DOM, submit and conversation projection.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {Readable}=require('node:stream'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),cloud=process.argv.includes('--cloud'),
  clientRoot=cloud?path.resolve(root,'../penecho_cloud/public/canvas'):path.join(root,'public'),
  temporary=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-suggest-focus-'));
const output=path.resolve(process.argv.find(value=>value.startsWith('--output='))?.slice(9)
  ||path.join(root,'docs/verification/agent-suggest-live-fix-20261004'));fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(temporary,'profile'));
Object.assign(process.env,{NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:path.join(temporary,'state'),
  PENECHO_CONFIG_FILE:path.join(temporary,'config.env'),HOST:'127.0.0.1',PORT:'0',AI_PROVIDER:'api',AI_API_KEY:'test-only',
  AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'test',PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false',PENECHO_JEVISION_ENABLED:'false'});
const injection=`
if(${cloud})Object.assign(window.PENECHO_CONFIG,{runtime:'cloud',connectionAccountId:'test-only',linkedDeviceId:'test-only',linkedDeviceOnline:true});
window.suggestAudit={state,smartSuggest,canvasAgent,agentSuggest,canvasDocumentsReady,loadCanvasSettings,settings,storeAiConnectionSelection,
  loadHostedModels,aiConnectionScope,
  openCanvasAgent,closeCanvasAgent,t,updateCanvasAgentLanguage,canvasAgentSyncPromptSuggestions,assistRequestStarted,assistRequestFinished,
  addClipboardText,confirmTextEditor,canvasAgentRenderConversation,canvasAgentRenderAttachments,canvasAgentSetRunning,canvasAgentSyncFollowLatest,CANVAS_AGENT_PROMPT_LIBRARY,requests:[],envelopes:[],
  diagnostics:()=>({eligible:agentSuggestFocusEligible(),present:agentSuggestCanPresent(),busy:agentSuggestAgentBusy(),available:canvasAgentPromptSuggestionsAvailable(),draft:canvasAgentPromptHasDraft(),mode:canvasAgent.inputMode,attachments:canvasAgent.attachments.length,references:canvasAgent.references.length,transcript:canvasAgentTranscript.innerText,refHidden:canvasAgentReferencePicker.hidden,approvalHidden:canvasAgentApproval.hidden})};
const auditFetch=window.fetch;
let auditUsed=37;
const auditAccess=()=>({signedIn:false,subscribed:false,freeLimit:200,used:auditUsed,remaining:200-auditUsed,paidEnabled:false,spentToday:0,reason:null});
window.fetch=async(url,options)=>{
  if(url==='/api/v1/models')return new Response(JSON.stringify({accountId:'test-only',models:[],credits:{available:1}}),{headers:{'Content-Type':'application/json'}});
  if(String(url).endsWith('/suggest/status'))return new Response(JSON.stringify({configured:true,access:auditAccess()}),{headers:{'Content-Type':'application/json'}});
  if(String(url).endsWith('/suggest')){
    const request=JSON.parse(options.body);suggestAudit.requests.push(request);
    if(request.mode!=='agent')return new Response(JSON.stringify({ok:true,answers:{action:{type:'choice',choice:'none',probabilities:{none:1}}}}),{headers:{'Content-Type':'application/json'}});
    await new Promise(resolve=>setTimeout(resolve,suggestAudit.delayMs||500));auditUsed++;
    if(suggestAudit.failResponse)return new Response(JSON.stringify({ok:false,reason:'test-network-failure'}),{status:503,headers:{'Content-Type':'application/json'}});
    const answers=suggestAudit.emptyResponse?{}:Object.fromEntries(request.context.prompts.map((id,index)=>['prompt_'+id,{type:'noul',noul:([.82,.58,.31,.18,.1][index]??.02)}]));
    return new Response(JSON.stringify({ok:true,answers,access:auditAccess(),chargedCredits:0,cached:false}),{headers:{'Content-Type':'application/json'}});
  }
  return auditFetch(url,options);
};
canvasAgentConnect=async()=>{canvasAgent.socket={readyState:WebSocket.OPEN,send:body=>suggestAudit.envelopes.push(JSON.parse(body)),close(){}};canvasAgent.sessionId='suggest-review';canvasAgent.sessionReady=true;canvasAgent.sessionSearchEnabled=canvasAgent.searchEnabled;canvasAgent.connectionId=selectedAiConnectionId();canvasAgent.sessionProjectId=canvasAgentContextProjectId();canvasAgent.sessionAccessMode=canvasAgentEffectiveAccessMode();};
`;
// Freeze the canonical build for this run so concurrent workspace builds cannot
// change the served input after its hash has been recorded.
const canonicalClient=fs.readFileSync(path.join(clientRoot,'app.js'),'utf8');
const originalStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(path.resolve(String(file))===path.join(root,'public/app.js'))return Readable.from([canonicalClient.replace(/\}\)\(\);\s*$/,injection+'})();')]);
  if(path.resolve(String(file))===path.join(root,'public/style.css'))return originalStream.call(this,path.join(clientRoot,'style.css'),...args);
  return originalStream.call(this,file,...args);
};
const report={runtime:cloud?'cloud-client':'local',syntheticTransport:true,syntheticFocusEvents:true,nativeMouseClicks:true,clientSha256:createHash('sha256').update(canonicalClient).digest('hex'),checks:[],findings:{},errors:[]};
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
    await js(`(async()=>{const a=suggestAudit;await a.canvasDocumentsReady();await a.loadCanvasSettings();
      if(window.PENECHO_CONFIG.runtime==='cloud'){await a.loadHostedModels({accountChanged:true});a.settings.connections=[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',provider:'api',hasApiKey:true,apiUrl:'http://127.0.0.1:1/v1',apiModel:'test'}];a.settings.connectionScope=a.aiConnectionScope();}
      a.storeAiConnectionSelection(a.settings.connections[0].id);
      document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelector('#canvasWelcome').hidden=true;
      a.state.auto=false;a.state.canvasAgentAutoOpen=false;a.state.language='en';a.updateCanvasAgentLanguage();a.smartSuggest.available=true;a.smartSuggest.enabled=true;
      a.canvasAgent.initialCanvasAutoHidePending=false;a.openCanvasAgent({focus:false,connect:false,animate:false});})()`);await pause(400);
    // The release dialog opens after the tour closes and owns modal focus.
    await js(`document.querySelector('#changelogClose')?.click()`);await pause(150);
    // Hidden offscreen windows can change activeElement without native focus
    // events. Dispatch the same DOM event through the real composer listener.
    const focusComposer=()=>js(`(()=>{const i=document.querySelector('#canvasAgentInput');i.focus();i.dispatchEvent(new FocusEvent('focus'));})()`);
    const clickComposer=async()=>{
      const point=await js(`(()=>{const i=document.querySelector('#canvasAgentInput'),r=i.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);if(document.elementFromPoint(x,y)!==i)throw Error('Composer is not the pointer target');return {x,y};})()`);
      for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});
      await pause(50);
    };
    const visible=()=>js("!document.querySelector('#canvasAgentPromptSuggestions').hidden");
    const count=()=>js("suggestAudit.requests.filter(r=>r.mode==='agent').length");
    const edit=async value=>js(`(()=>{const i=document.querySelector('#canvasAgentInput');i.value=${JSON.stringify(value)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const close=()=>js("document.querySelector('#canvasAgentSuggestClose').click()");
    const changed=()=>js("suggestAudit.state.userRevision++;suggestAudit.canvasAgentSyncPromptSuggestions()");
    const settle=()=>until("!suggestAudit.agentSuggest.focusTimer&&!suggestAudit.agentSuggest.preparingEpoch&&!suggestAudit.agentSuggest.promise");
    assert.equal(await visible(),true);assert.equal(await count(),0);
    assert.equal(await js("document.querySelector('#canvasAgentPromptSuggestions').dataset.mode"),'default');
    assert.equal(await js("document.querySelector('#canvasAgentSuggestHeader').hidden"),true);
    assert.equal(await js("!!document.querySelector('#canvasAgentInputHint')"),false);
    await js("suggestAudit.smartSuggest.available=false;suggestAudit.smartSuggest.enabled=false;suggestAudit.canvasAgentSyncPromptSuggestions()");
    assert.equal(await visible(),true,'default presets do not depend on LLM availability');
    await js("suggestAudit.smartSuggest.available=true;suggestAudit.smartSuggest.enabled=true;suggestAudit.canvasAgentSyncPromptSuggestions()");
    assert.equal(await js("!!document.querySelector('#canvasAgentPromptControl')||!!document.querySelector('#canvasAgentPromptToggle')"),false);
    assert.equal(await js("Array.from(document.querySelectorAll('#canvasAgentPromptPopup [role=tabpanel]')).every(list=>list.children.length>0)"),true);
    for(const language of ['en','zh']){
      await js(`document.querySelector('[data-language="${language}"]').click();document.documentElement.style.setProperty('--canvas-agent-width','360px');document.body.style.setProperty('--canvas-agent-width','360px');document.querySelector('#canvasAgentPromptFilesTab').click();`);await pause(150);
      const tabs=await js(`Array.from(document.querySelectorAll('#canvasAgentPromptCategories [role=tab]'),tab=>{const r=tab.getBoundingClientRect(),p=tab.parentElement.getBoundingClientRect();return {text:tab.textContent,width:r.width,overflow:tab.scrollWidth-tab.clientWidth,inside:r.left>=p.left-1&&r.right<=p.right+1&&r.bottom<=p.bottom+1};})`);
      assert.equal(tabs.length,3);for(const tab of tabs){assert.ok(tab.width>0);assert.ok(tab.inside);assert.ok(tab.overflow<=1,JSON.stringify(tab));}
      assert.equal(await js("document.querySelector('#canvasAgentPromptFilesList').hidden"),false);
      await shot('default-files-narrow-'+language);report.findings['defaultTabs-'+language]=tabs;
    }
    await js(`document.querySelector('[data-language="en"]').click();document.documentElement.style.removeProperty('--canvas-agent-width');document.body.style.removeProperty('--canvas-agent-width');document.querySelector('#canvasAgentPromptCreateTab').click();`);
    await shot('default-create-en');assert.equal(await count(),0);
    report.checks.push('default welcome automatically shows all three populated categories; all labels fit in English and Chinese at 360px; no Try asking or inference');
    await edit('A question I have already started');await focusComposer();await pause(450);
    assert.equal(await count(),0);assert.equal(await visible(),false);report.checks.push('blank canvas stays silent even with a typed draft');
    await js(`(async()=>{const a=suggestAudit;document.querySelector('#canvasAgentInput').blur();a.addClipboardText('2x + 3 = 11');await a.confirmTextEditor([...a.state.textEditors.values()][0]);})()`);await pause(250);
    await js(`(()=>{const a=suggestAudit;a.openCanvasAgent({focus:false,connect:false,animate:false});a.smartSuggest.available=false;Object.assign(a.smartSuggest.availability,{checkedAt:0,nextAt:0,retryAfterAt:0,pending:null,authRequired:false});a.delayMs=1000;})()`);
    assert.equal(await visible(),false);assert.equal(await count(),0,'content insertion alone does not infer');
    await focusComposer();await edit('I can keep typing while suggestions are generated');
    await until("suggestAudit.agentSuggest.status==='loading'");
    const pendingEpoch=await js('suggestAudit.agentSuggest.focusEpoch');
    await clickComposer();await clickComposer();
    assert.equal(await count(),1);assert.equal(await js('suggestAudit.agentSuggest.focusEpoch'),pendingEpoch,'pending clicks preserve the request owner');
    assert.equal(await visible(),false);assert.equal(await js("document.querySelector('#canvasAgentSuggestLoading').hidden"),false);
    await shot('background-loading');
    await until("suggestAudit.agentSuggest.status==='ready'");await settle();assert.equal(await count(),1);assert.equal(await visible(),true);
    assert.equal(await js("document.querySelector('#canvasAgentInput').value"),'I can keep typing while suggestions are generated');
    assert.equal(await js("Array.from(document.querySelectorAll('#canvasAgentPromptSuggestions [role=tab]')).filter(tab=>tab.getBoundingClientRect().width>0).length"),0);
    assert.equal(await js("Array.from(document.querySelectorAll('#canvasAgentPromptPopup [role=tabpanel]')).every(list=>list.hidden)"),true);
    assert.equal(await js("!!document.querySelector('#canvasAgentPromptControl')"),false);assert.equal(await js("!!document.querySelector('#canvasAgentPromptToggle')"),false);
    assert.equal(await js("document.querySelector('#canvasAgentSuggestLoading').hidden"),true);
    report.checks.push('cold availability resumes the same typed focus; typing does not block; only successful results show Suggest with no other tabs or Try asking');
    await clickComposer();await pause(450);assert.equal(await count(),1);
    report.checks.push('native clicks during a request and while suggestions are visible never infer again');
    await close();await pause(450);assert.equal(await visible(),false);assert.equal(await count(),1,'close focus restoration is not another inference trigger');
    await focusComposer();await settle();assert.equal(await visible(),true);assert.equal(await count(),1,'same context cached');
    report.checks.push('X closes and stays closed; a new focus reuses the ranking');
    await close();
    await edit('');assert.equal(await visible(),true);assert.equal(await js("document.querySelector('#canvasAgentPromptSuggestions').dataset.mode"),'default');
    await js("document.querySelector('#canvasAgentPromptFilesTab').click()");
    await focusComposer();await settle();assert.equal(await js("document.querySelector('#canvasAgentPromptSuggestions').dataset.mode"),'suggest');
    await close();assert.equal(await js("document.querySelector('#canvasAgentPromptSuggestions').dataset.mode"),'default');
    assert.equal(await js("document.querySelector('#canvasAgentPromptFilesList').hidden"),false);
    const beforePreset=await count();
    const preset=await js(`(()=>{const row=document.querySelector('#canvasAgentPromptFilesList button'),expected=suggestAudit.t(row.dataset.promptKey);row.click();return {expected,value:document.querySelector('#canvasAgentInput').value};})()`);
    assert.equal(preset.value,preset.expected);await pause(450);assert.equal(await visible(),false);assert.equal(await count(),beforePreset);assert.equal(await js('suggestAudit.envelopes.length'),0);
    report.checks.push('clearing the draft restores defaults; successful Suggest replaces them; X returns to the chosen tab; preset inserts full prompt without sending or inference');
    await js(`(()=>{const a=suggestAudit,c=a.canvasAgent.currentConversation;c.items=Array.from({length:18},(_,index)=>({id:'message-'+index,type:'message',role:index%2?'assistant':'user',text:index%2?'I have arranged the main ideas on the Canvas. You can continue with a diagram, a step-by-step explanation, or a comparison of the source material.':'Please help me explain the ideas on this Canvas.',final:true}));a.canvasAgentRenderConversation(c,true);a.canvasAgentSyncPromptSuggestions();})()`);
    await edit('');assert.equal(await visible(),false,'presets never replace an existing chat, even with an empty draft');
    const transcript=await js("document.querySelector('#canvasAgentTranscript').textContent");
    await focusComposer();await settle();await pause(100);
    const layout=await js(`(()=>{const t=document.querySelector('#canvasAgentTranscript'),p=document.querySelector('#canvasAgentPromptSuggestions'),c=document.querySelector('.canvas-agent-conversation');return {transcriptHeight:t.clientHeight,panelHeight:p.getBoundingClientRect().height,area:c.clientHeight,display:getComputedStyle(t).display,remaining:t.scrollHeight-t.clientHeight-t.scrollTop};})()`);
    assert.equal(layout.display,'flex');assert.ok(layout.transcriptHeight>0);assert.ok(layout.panelHeight<=layout.area*.45+1);assert.ok(Math.abs(layout.remaining)<2);
    await shot('conversation-suggest-en');await close();
    await js("document.querySelector('#canvasAgentTranscript').scrollTop=100;suggestAudit.canvasAgentSyncFollowLatest()");await pause(50);assert.equal(await js("suggestAudit.canvasAgent.followLatest"),false);
    await focusComposer();await settle();await pause(100);assert.equal(await js("document.querySelector('#canvasAgentTranscript').scrollTop"),100);
    await close();await pause(100);assert.equal(await js("document.querySelector('#canvasAgentTranscript').scrollTop"),100);
    report.checks.push('existing messages remain visible with a bounded result panel and stable reading position');
    const beforeChange=await count();await changed();await pause(450);assert.equal(await count(),beforeChange);
    await focusComposer();await until("suggestAudit.agentSuggest.status==='loading'");
    await js("document.querySelector('#canvasAgentTranscript').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'}))");
    await settle();assert.equal(await visible(),false);assert.equal(await js("document.querySelector('#canvasAgentTranscript').textContent"),transcript);
    report.checks.push('context changes do not infer alone; focus does; dismissal suppresses late results without changing the chat');
    for(const mode of ['agent','canvas']){
      await changed();
      await js(mode==='agent'?"suggestAudit.canvasAgentSetRunning(true)":"suggestAudit.state.activeAI={};suggestAudit.workOwner={};suggestAudit.assistRequestStarted(suggestAudit.workOwner)");
      const before=await count();await focusComposer();await pause(450);assert.equal(await count(),before);
      await js(mode==='agent'?"suggestAudit.canvasAgentSetRunning(false)":"suggestAudit.state.activeAI=null;suggestAudit.assistRequestFinished(suggestAudit.workOwner,'success');suggestAudit.canvasAgentSyncPromptSuggestions()");
      await pause(450);assert.equal(await count(),before);assert.equal(await visible(),false);
      await focusComposer();await settle();assert.equal(await count(),before+1);assert.equal(await visible(),true);await close();
      report.checks.push(mode+': busy focus does not infer, completion does not retry, next focus works');
    }
    // Canvas work can begin and finish before an already sent ranking returns.
    await changed();await focusComposer();await until("suggestAudit.agentSuggest.status==='loading'");
    await js("suggestAudit.state.activeAI={};suggestAudit.workOwner={};suggestAudit.assistRequestStarted(suggestAudit.workOwner);suggestAudit.state.activeAI=null;suggestAudit.assistRequestFinished(suggestAudit.workOwner,'success')");
    await settle();assert.equal(await visible(),false);report.checks.push('Canvas AI start invalidates presentation intent even when it finishes before ranking returns');
    for(const failure of ['failResponse','emptyResponse']){
      await changed();await js(`suggestAudit.${failure}=true`);await focusComposer();await settle();
      assert.equal(await visible(),false);assert.equal(await js("document.querySelector('#canvasAgentSuggestLoading').hidden"),true);
      const before=await count();await js(`suggestAudit.${failure}=false;suggestAudit.canvasAgentSyncPromptSuggestions()`);await pause(450);assert.equal(await count(),before);
      report.checks.push(failure+': no error/result panel and no background retry');
      const draft=await js("document.querySelector('#canvasAgentInput').value");
      assert.equal(await js("document.activeElement.id"),'canvasAgentInput');
      await clickComposer();await clickComposer();await settle();
      assert.equal(await count(),before+1);assert.equal(await visible(),true);
      assert.equal(await js("document.activeElement.id"),'canvasAgentInput');
      assert.equal(await js("document.querySelector('#canvasAgentInput').value"),draft);
      await shot('click-retry-'+failure);
      await clickComposer();await pause(450);assert.equal(await count(),before+1);
      await close();await clickComposer();await settle();assert.equal(await count(),before+1);assert.equal(await visible(),true);
      report.checks.push(failure+': native click retries without a focus change, preserves draft and shares work; visible or dismissed successful suggestions are reused');
      await close();
    }
    await changed();await focusComposer();await settle();assert.equal(await visible(),true);
    for(const language of ['en','zh']){
      await js(`document.querySelector('[data-language="${language}"]').click();document.documentElement.style.setProperty('--canvas-agent-width','360px');document.body.style.setProperty('--canvas-agent-width','360px');`);await pause(150);
      const rows=await js("Array.from(document.querySelectorAll('#canvasAgentSuggestItems .canvas-agent-suggest-row'),r=>({text:[r.textContent,r.title,r.getAttribute('aria-label')].join(' '),recommended:r.dataset.recommended}))");
      assert.equal(rows.length,4);assert.equal(rows.filter(r=>r.recommended==='true').length,2);for(const row of rows)assert.doesNotMatch(row.text,/\d\s*[%％]/);
      assert.ok(await js("document.querySelector('.canvas-agent-suggest-usage').textContent.length>0"));
      assert.equal(await js("(()=>{const e=document.querySelector('#canvasAgentSuggestClose'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})()"),true);
      await shot('conversation-narrow-'+language);report.checks.push(language+': only Suggest, usable close control, allowance, highlighting and no percentages');
    }
    for(const pointerType of ['touch','pen','mouse']){
      await focusComposer();await settle();
      const chosen=await js(`(()=>{const a=suggestAudit,row=document.querySelector('#canvasAgentSuggestItems [data-recommended=true]'),expected=a.t(a.CANVAS_AGENT_PROMPT_LIBRARY[row.dataset.suggestId].prompt);row.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'${pointerType}'}));row.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'${pointerType}'}));row.click();return {expected,value:document.querySelector('#canvasAgentInput').value,focused:document.activeElement.id};})()`);
      assert.equal(chosen.value,chosen.expected);assert.equal(await visible(),false);assert.equal(await js('suggestAudit.envelopes.length'),0);
      assert.equal(chosen.focused,pointerType==='mouse'?'canvasAgentInput':'canvasAgentTranscript');await pause(400);assert.equal(await visible(),false);
      report.checks.push(pointerType+': selecting replaces draft, closes, restores appropriate focus, and does not send or reopen');
    }
    await focusComposer();await settle();
    await js("document.querySelector('#canvasAgentInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await pause(400);
    assert.equal(await visible(),false);assert.equal(await js("document.querySelector('#canvasAgentPanel').hidden"),false);report.checks.push('Escape closes only Suggest without triggering another request');
    await focusComposer();await settle();await edit('Continue explaining this Canvas');
    await js("document.querySelector('#canvasAgentInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
    assert.equal(await visible(),false);await until("suggestAudit.envelopes.some(e=>e.type==='user_turn')");
    report.checks.push('Enter closes Suggest and sends the actual typed request');await shot('after-send');
    assert.deepEqual(report.errors,[]);console.log(JSON.stringify({output,checks:report.checks.length,requests:await count(),errors:report.errors}));
  }catch(error){report.failure=error.stack;console.error(error);process.exitCode=1;if(win){report.state=await win.webContents.executeJavaScript(`(()=>{const a=suggestAudit;return {open:!document.querySelector('#canvasAgentPanel').hidden,focused:document.activeElement?.id,status:a.agentSuggest.status,reason:a.agentSuggest.reason,pending:a.agentSuggest.pendingKey,timer:a.agentSuggest.focusTimer,available:a.smartSuggest.available,enabled:a.smartSuggest.enabled,access:a.smartSuggest.access,requests:a.requests.map(r=>r.mode),value:document.querySelector('#canvasAgentInput').value,agentStatus:document.querySelector('#canvasAgentStatus').textContent,envelopes:a.envelopes.map(e=>e.type),...a.diagnostics()};})()`);console.error(JSON.stringify(report.state));}}
  finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');win?.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode||0);}
});
