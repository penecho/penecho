'use strict';
// Render the canonical client with isolated storage. Stub model/Agent transport,
// retain real content commits, composer DOM, submit and conversation projection.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {Readable}=require('node:stream'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-suggest-review-'));
const output=path.join(root,'docs/verification/agent-suggest-review-20261004');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(temporary,'profile'));
Object.assign(process.env,{NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:path.join(temporary,'state'),
  PENECHO_CONFIG_FILE:path.join(temporary,'config.env'),HOST:'127.0.0.1',PORT:'0',AI_PROVIDER:'api',AI_API_KEY:'test-only',
  AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'test',PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false',PENECHO_JEVISION_ENABLED:'false'});
const injection=`
window.suggestAudit={state,smartSuggest,canvasAgent,agentSuggest,canvasDocumentsReady,loadCanvasSettings,settings,storeAiConnectionSelection,
  openCanvasAgent,closeCanvasAgent,t,updateCanvasAgentLanguage,canvasAgentFitPromptTabs,canvasAgentSyncPromptSuggestions,
  addClipboardText,confirmTextEditor,CANVAS_AGENT_PROMPT_LIBRARY,requests:[],envelopes:[],
  diagnostics:()=>({eligible:agentSuggestPanelVisible(),empty:agentSuggestComposerEmpty(),busy:agentSuggestAgentBusy(),available:canvasAgentPromptSuggestionsAvailable(),draft:canvasAgentPromptHasDraft(),mode:canvasAgent.inputMode,attachments:canvasAgent.attachments.length,references:canvasAgent.references.length,transcript:canvasAgentTranscript.innerText,refHidden:canvasAgentReferencePicker.hidden,approvalHidden:canvasAgentApproval.hidden})};
const auditFetch=window.fetch;
let auditUsed=37;
const auditAccess=()=>({signedIn:false,subscribed:false,freeLimit:200,used:auditUsed,remaining:200-auditUsed,paidEnabled:false,spentToday:0,reason:null});
window.fetch=async(url,options)=>{
  if(String(url).endsWith('/suggest/status'))return new Response(JSON.stringify({configured:true,access:auditAccess()}),{headers:{'Content-Type':'application/json'}});
  if(String(url).endsWith('/suggest')){
    const request=JSON.parse(options.body);suggestAudit.requests.push(request);
    if(request.mode!=='agent')return new Response(JSON.stringify({ok:true,answers:{action:{type:'choice',choice:'none',probabilities:{none:1}}}}),{headers:{'Content-Type':'application/json'}});
    await new Promise(resolve=>setTimeout(resolve,500));auditUsed++;
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
// Reuse the existing trigger fixture, replacing its draft and visibility fakes
// with actual runtime functions to expose integration gaps during this review.
async function reviewTriggers(){
  const vm=require('node:vm'),Module=require('node:module'),file=path.join(root,'test/agent-suggest.test.js'),fixture=fs.readFileSync(file,'utf8'),m=new Module(file,module);
  m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(fixture.slice(0,fixture.indexOf('\ntest('))+'\nmodule.exports={scene,runtime};',file);
  const {scene,runtime}=m.exports,call=(run,code)=>vm.runInContext(code,run.context);
  const functionSource=name=>{const start=runtime.indexOf('  function '+name+'(');assert.ok(start>=0,name);return runtime.slice(start,runtime.indexOf('\n  }',start)+4);};
  for(const kind of ['attachment','conversation']){
    const run=scene();run.context.ink=true;run.context.canvasAgent.references=[];run.context.canvasAgent.inkPresent=false;
    run.context.canvasAgentPromptSuggestionsAvailable=()=>true;
    run.context.canvasAgentTranscript={querySelector:()=>kind==='conversation'?{}:null};
    if(kind==='attachment')run.context.canvasAgent.attachments=[{id:'example',kind:'file',name:'budget.xlsx'}];
    call(run,functionSource('canvasAgentPromptHasDraft')+'\n'+functionSource('canvasAgentShouldShowPromptSuggestions'));
    call(run,'agentSuggestComposerFocused()');run.flushTimers();await run.settle();
    report.findings[kind]={requests:run.requests.length,panelEligible:call(run,'agentSuggestPanelVisible()'),composerEmpty:call(run,'agentSuggestComposerEmpty()')};
  }
  {
    const run=scene({available:false});run.context.ink=true;run.context.smartSuggest.availability.checkedAt=0;
    run.context.refreshSmartSuggestAvailability=async()=>{await Promise.resolve();run.context.smartSuggest.available=true;run.context.smartSuggest.availability.checkedAt=1;};
    call(run,'agentSuggestComposerFocused()');await run.settle();run.flushTimers();await run.settle();
    report.findings.coldAvailability={available:run.context.smartSuggest.available,requests:run.requests.length};
  }
  for(const gate of ['disabled','blocked']){
    const run=scene();run.context.ink=true;call(run,'agentSuggestComposerFocused()');
    if(gate==='disabled')run.context.smartSuggest.enabled=false;else run.context.suggestionAccessBlocked=()=>true;
    run.flushTimers();await run.settle();report.findings[gate+'DuringSettle']={requests:run.requests.length};
  }
  {
    const run=scene();run.context.state.textBoxes=[{id:'formula',text:'2x + 3 = 11'}];
    const ids=Array.from(call(run,'agentSuggestCandidates(agentSuggestSnapshot())'));
    report.findings.textOnlyCanvas={candidates:ids,hasSolve:ids.includes('solveProblem'),hasCheck:ids.includes('checkWork'),hasTypeset:ids.includes('typeset')};
  }
}
let server,win;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  try{
    await reviewTriggers();
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
    await focusComposer();await pause(500);
    assert.equal(await js("suggestAudit.requests.filter(r=>r.mode==='agent').length"),0);report.checks.push('blank Canvas does not rank');
    await js(`(async()=>{document.querySelector('#canvasAgentInput').blur();const a=suggestAudit;a.addClipboardText('2x + 3 = 11');await a.confirmTextEditor([...a.state.textEditors.values()][0]);})()`);await pause(250);
    await js(`suggestAudit.openCanvasAgent({focus:false,connect:false,animate:false});`);await focusComposer();
    await until("suggestAudit.agentSuggest.status==='loading'");
    assert.equal(await js("document.querySelector('#canvasAgentPromptSuggestList').getAttribute('aria-busy')"),'true');await shot('loading');
    await until("suggestAudit.agentSuggest.status==='ready'");
    for(const language of ['en','zh']){
      await js(`document.querySelector('[data-language="${language}"]').click();suggestAudit.canvasAgentSyncPromptSuggestions();`);
      assert.equal(await js('suggestAudit.state.language'),language);
      const rows=await js(`Array.from(document.querySelectorAll('#canvasAgentSuggestItems .canvas-agent-suggest-row'),r=>({text:r.textContent,title:r.title,aria:r.getAttribute('aria-label'),recommended:r.dataset.recommended,score:!!r.querySelector('.canvas-agent-suggest-score')}))`);
      assert.equal(rows.length,4);assert.equal(rows.filter(r=>r.recommended==='true').length,2);
      for(const row of rows){assert.equal(row.score,false);assert.doesNotMatch([row.text,row.title,row.aria].join(' '),/\d\s*[%％]/);}
      report.checks.push(language+': ranked rows, tooltips and accessible labels expose no probability');
      assert.ok(await js("document.querySelector('.canvas-agent-suggest-usage').textContent.length>0"));
      await js(`document.documentElement.style.setProperty('--canvas-agent-width','360px');document.body.style.setProperty('--canvas-agent-width','360px');suggestAudit.canvasAgentFitPromptTabs();`);await pause(200);
      const tabs=await js(`(()=>{const b=document.querySelector('#canvasAgentPromptCategories'),r=b.getBoundingClientRect();return {width:b.clientWidth,scroll:b.scrollWidth,tabs:Array.from(b.querySelectorAll('[role=tab]')).filter(t=>!t.hidden).map(t=>({label:t.textContent,left:t.getBoundingClientRect().left-r.left,right:t.getBoundingClientRect().right-r.left}))};})()`);
      assert.equal(tabs.tabs.length,4);assert.ok(tabs.scroll<=tabs.width+1,JSON.stringify(tabs));
      report.checks.push(language+': all four tabs fit the 360 px panel');await shot('ranked-'+language);
    }
    const before=await js("suggestAudit.requests.filter(r=>r.mode==='agent').length");
    const chosen=await js(`(()=>{const a=suggestAudit,row=document.querySelector('#canvasAgentSuggestItems [data-recommended=true]'),expected=a.t(a.CANVAS_AGENT_PROMPT_LIBRARY[row.dataset.suggestId].prompt);row.click();return {expected,value:document.querySelector('#canvasAgentInput').value};})()`);
    assert.equal(chosen.value,chosen.expected);assert.equal(await js('suggestAudit.envelopes.length'),0);
    await js(`(()=>{const i=document.querySelector('#canvasAgentInput');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(450);
    assert.equal(await js("suggestAudit.requests.filter(r=>r.mode==='agent').length"),before);
    report.checks.push('choosing fills the prompt without sending; clearing reuses the ranking');
    assert.deepEqual(report.errors,[]);console.log(JSON.stringify({output,checks:report.checks.length,findings:report.findings,errors:report.errors}));
  }catch(error){report.failure=error.stack;console.error(error);process.exitCode=1;if(win){report.state=await win.webContents.executeJavaScript(`(()=>{const a=suggestAudit;return {open:!document.querySelector('#canvasAgentPanel').hidden,focused:document.activeElement?.id,status:a.agentSuggest.status,reason:a.agentSuggest.reason,pending:a.agentSuggest.pendingKey,timer:a.agentSuggest.focusTimer,available:a.smartSuggest.available,enabled:a.smartSuggest.enabled,access:a.smartSuggest.access,requests:a.requests.map(r=>r.mode),value:document.querySelector('#canvasAgentInput').value,...a.diagnostics()};})()`);console.error(JSON.stringify(report.state));}}
  finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');win?.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode||0);}
});
