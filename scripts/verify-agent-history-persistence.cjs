'use strict';
// Exercise browser storage, real Canvas switching, reloads and sidebar clicks.
// Only Agent transport is synthetic; no model requests or existing data are used.
const {app,BrowserWindow,nativeTheme}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {Readable}=require('node:stream'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),cloudRoot=path.resolve(root,'../penecho_cloud'),cloud=process.argv.includes('--cloud');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-agent-history-'));
const output=path.join(root,'docs/verification/agent-history-persistence-20261004',cloud?'cloud':'local');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(temporary,'profile'));
Object.assign(process.env,{NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:path.join(temporary,'state'),PENECHO_CONFIG_FILE:path.join(temporary,'config.env'),
  HOST:'127.0.0.1',PORT:'0',AI_PROVIDER:'api',AI_API_KEY:'test-only',AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'test',
  PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false',PENECHO_JEVISION_ENABLED:'false'});
const injection=`
window.historyAudit={state,canvasAgent,canvasDocuments,canvasDocumentsReady,canvasDocumentsCurrent,canvasDocumentsRecord,canvasDocumentsShow,
  canvasDocumentsPark,canvasAgentBeginLocalConversation,canvasAgentHistoryForCanvas,canvasAgentStoredHistoryGroups,canvasAgentWriteHistoryForCanvas,
  canvasAgentPreviewStoredConversation,canvasAgentReturnToCurrentConversation,canvasAgentSubmitMessage,canvasAgentPersistCurrentConversation,
  canvasAgentScheduleHistoryPersist,canvasAgentConnect,canvasAgentRestoreLocalConversation,saveSnapshot,loadSnapshot,loadCanvasSettings,settings,storeAiConnectionSelection,
  openCanvasAgent,canvasAgentSetRunning,canvasAgentRenderHistoryList,envelopes:[],
  dismiss(){markChangelogSeen();markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);closeFeatureTour({restore:false,scroll:false,changelog:false,retry:false});closeChangelog();},
  seed(question,answer){canvasAgentRow('user',question);canvasAgentHandleEvent({kind:'turn_start',turn:1});
    canvasAgentHandleEvent({kind:'assistant_message',text:answer,turn:1,step:1});canvasAgentHandleEvent({kind:'turn_end',turn:1,reason:{kind:'completed'}});
    return canvasAgent.currentConversation.id;},
  read(){return {key:state.canvasAgentCanvasKey,id:canvasAgent.currentConversation?.id,history:canvasAgentHistoryForCanvas().map(c=>c.id),
    text:document.querySelector('#canvasAgentTranscript').textContent,draft:canvasAgentInput.value,viewing:canvasAgent.viewingHistoryId};}
};
canvasAgentConnect=async()=>{canvasAgent.socket={readyState:WebSocket.OPEN,send:value=>historyAudit.envelopes.push(JSON.parse(value)),close(){}};
  canvasAgent.sessionId='isolated-history';canvasAgent.sessionReady=true;};
historyAudit.canvasAgentConnect=canvasAgentConnect;
canvasAgentWaitForReady=async start=>{start();canvasAgent.sessionId='isolated-history';canvasAgent.sessionReady=true;};
`;
const expose=source=>source.replace(/\}\)\(\);\s*$/,injection+'})();');
const originalStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(!cloud&&path.resolve(String(file))===path.join(root,'public/app.js'))return Readable.from([expose(fs.readFileSync(file,'utf8'))]);
  return originalStream.call(this,file,...args);
};
const client=path.join(cloud?path.join(cloudRoot,'public/canvas'):path.join(root,'public'),'app.js');
const report={runtime:cloud?'cloud':'local',syntheticTransport:true,clientSha256:createHash('sha256').update(fs.readFileSync(client)).digest('hex'),checks:[],errors:[],blobCspWarnings:[],
  limitations:['Agent transport is synthetic. Blob resource requests rejected by the existing CSP are recorded separately; conversation assertions do not test thumbnail fetching.']};
let server,win,url;const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function makeWindow(){
  const browser=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  browser.webContents.on('console-message',event=>{if(event.level!=='error')return;
    if(/^Connecting to 'blob:http:\/\/127\.0\.0\.1:\d+\/[^']+' violates the following Content Security Policy directive: "connect-src /.test(event.message))report.blobCspWarnings.push(event.message);
    else report.errors.push(event.message);});return browser;
}
app.whenReady().then(async()=>{
  try{
    let cookies=[];
    if(cloud){
      const {buildApp}=await import(pathToFileURL(path.join(cloudRoot,'src/app.mjs')).href);
      const reservation=require('node:net').createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
      const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const origin='http://127.0.0.1:'+port;
      server=await buildApp({logger:false,env:{NODE_ENV:'test',AUTH_MODE:'development',DATA_MODE:'memory',SESSION_MODE:'memory',STORAGE_MODE:'memory',CLOUD_NATIVE_CANVAS_ENABLED:'true',APP_ORIGIN:origin}});
      server.get('/canvas/app.js',{config:{rateLimit:false},compress:false},async(_request,reply)=>reply.type('application/javascript').send(expose(fs.readFileSync(client,'utf8'))));
      server.addHook('onSend',async(request,_reply,payload)=>request.url.startsWith('/api/config.js')?String(payload)+'\nwindow.PENECHO_CONFIG.browserCanvasEditing=true;':payload);
      const email='agent-history@isolated.test',password='Isolated History A9';
      const registration=await server.inject({method:'POST',url:'/api/v1/auth/register',payload:{name:'Agent History Verification',email,password,termsAccepted:true,privacyAccepted:true}});
      await server.inject({method:'POST',url:'/api/v1/auth/verify-email',payload:{email,code:registration.json().developmentCode}});
      const login=await server.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password}});
      cookies=[].concat(login.headers['set-cookie']).map(cookie=>{const [name,value]=cookie.split(';',1)[0].split('=');return {url:origin,name,value,path:'/',httpOnly:name!=='penecho_csrf'};});
      const account=login.json().account,project=await server.services.repository.createProject(account.id,{name:'Agent History Test'});
      const canvas=await server.services.repository.createCanvas(account.id,project.id,{name:'Cloud History Test'});
      await server.listen({port,host:'127.0.0.1'});url=origin+'/canvas/'+canvas.id;
    }else{
      server=require('../server.js');await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));url='http://127.0.0.1:'+server.address().port;
    }
    nativeTheme.themeSource='light';win=makeWindow();for(const cookie of cookies)await win.webContents.session.cookies.set(cookie);
    const js=code=>win.webContents.executeJavaScript(code,true);
    const until=async expression=>{for(let i=0;i<150;i++){if(await js(expression))return;await pause(50);}throw Error('Timed out: '+expression);};
    const setup=async()=>{await until('!!window.historyAudit');await js(`(async()=>{const a=historyAudit;await a.canvasDocumentsReady();await a.loadCanvasSettings();
      if(a.settings.connections[0])a.storeAiConnectionSelection(a.settings.connections[0].id);a.dismiss();a.state.auto=false;a.state.canvasAgentAutoOpen=false;
      a.canvasAgent.initialCanvasAutoHidePending=false;a.openCanvasAgent({focus:false,connect:false,animate:false});})()`);await pause(250);};
    const shot=async name=>{await js('historyAudit.dismiss()');await pause(150);fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());};
    await win.loadURL(url);await setup();
    const first=await js(`(async()=>{const a=historyAudit;await a.canvasAgentConnect();const id=a.seed('画布 A 的问题','画布 A 的回答：历史应一直保留');
      const input=document.querySelector('#canvasAgentInput');input.value='A 未发送的草稿';input.dispatchEvent(new Event('input',{bubbles:true}));return {documentId:a.canvasDocumentsCurrent().id,conversationId:id};})()`);
    const second=await js(`(async()=>{const a=historyAudit,doc=a.canvasDocumentsRecord({documentId:crypto.randomUUID(),title:'Canvas B'},
      {item:{version:2,theme:a.state.theme,widgets:[],textBoxes:[],images:[],animations:[]},tileEntries:[]});a.canvasDocuments.records.set(doc.id,doc);
      await a.canvasDocumentsShow(doc.id);return {documentId:doc.id,conversationId:a.seed('画布 B 的问题','画布 B 的回答')};})()`);
    await js(`historyAudit.canvasDocumentsShow(${JSON.stringify(first.documentId)})`);
    let state=await js('historyAudit.read()');assert.equal(state.id,first.conversationId);assert.ok(state.text.includes('画布 A 的回答'));assert.ok(!state.text.includes('画布 B 的回答'));assert.equal(state.draft,'A 未发送的草稿');
    const continuation=await js('historyAudit.envelopes.filter(e=>e.type===\'new_conversation\').at(-1)?.payload.conversationHistory');
    assert.ok(continuation.some(item=>item.text==='画布 A 的问题'));report.checks.push('switching back restores the correct transcript, conversation ID, draft and continuation');await shot('switch-restored');
    await js(`document.querySelector('#studioNavigatorToggle').click();document.querySelector('#studioNavigatorAgentTab').click()`);
    await until(`!!document.querySelector('#studioNavigatorAgentPanel [data-conversation-id="${second.conversationId}"]')`);
    await js(`document.querySelector('#studioNavigatorAgentPanel [data-conversation-id="${second.conversationId}"]').click()`);
    await until(`historyAudit.canvasAgent.currentConversation?.id===${JSON.stringify(second.conversationId)}`);
    assert.ok((await js('historyAudit.read()')).text.includes('画布 B 的回答'));report.checks.push('clicking a workspace conversation in the sidebar opens its Canvas and transcript');
    const legacy={id:'legacy-draft',createdAt:1,updatedAt:2,title:'旧草稿会话',items:[{type:'message',role:'user',text:'旧草稿问题'},{type:'message',role:'assistant',text:'旧草稿回答仍然可以查看'}]};
    await js(`historyAudit.canvasAgentWriteHistoryForCanvas('draft:old-browser-page',[${JSON.stringify(legacy)}]);historyAudit.canvasAgentRenderHistoryList()`);
    await until(`!!document.querySelector('#studioNavigatorAgentPanel [data-conversation-id="legacy-draft"]')`);
    await js(`document.querySelector('#studioNavigatorAgentPanel [data-conversation-id="legacy-draft"]').click()`);
    await until(`historyAudit.canvasAgent.viewingHistoryId==='legacy-draft'`);state=await js('historyAudit.read()');assert.equal(state.id,second.conversationId);assert.ok(state.text.includes('旧草稿回答'));
    assert.equal(await js(`getComputedStyle(document.querySelector('#canvasAgentForm')).display`),'none');
    assert.equal(await js(`historyAudit.canvasAgentSubmitMessage({textOverride:'must not send'})`),false);report.checks.push('legacy draft history is visible without its Canvas and cannot submit against another Canvas');await shot('legacy-history');
    await js(`document.querySelector('#canvasAgentHistoryReturn').click()`);assert.equal((await js('historyAudit.read()')).id,second.conversationId);
    await js(`(()=>{const a=historyAudit;for(let i=0;i<6;i++){a.canvasAgentBeginLocalConversation();a.seed('会话 '+i,'第 '+i+' 次回答');}})()`);
    assert.equal((await js('historyAudit.read()')).history.length,7);report.checks.push('browser history retains seven conversations instead of silently dropping those beyond five');
    const saved=await js(`historyAudit.saveSnapshot({location:'device',name:'Browser History Save',allowEmpty:true})`);
    assert.ok(saved);const beforeReload=await js('historyAudit.read()');await shot('history-before-reload');
    win.webContents.reload();await until('!!window.historyAudit');await setup();
    assert.equal(await js(`historyAudit.canvasAgentStoredHistoryGroups().some(g=>g.conversations.some(c=>c.id==='legacy-draft'))`),true);
    await js(`historyAudit.loadSnapshot(${JSON.stringify(saved)},'device')`);state=await js('historyAudit.read()');
    assert.equal(state.id,beforeReload.id);assert.ok(state.text.includes('第 5 次回答'));assert.equal(state.history.length,7);
    report.checks.push('real page reload retains sidebar history and reopening the saved Canvas restores its latest transcript');await shot('reload-restored');
    await js(`historyAudit.seed('刷新后继续提问','恢复后的新回答')`);state=await js('historyAudit.read()');
    assert.equal(state.id,beforeReload.id);assert.ok(state.text.includes('第 5 次回答'));assert.ok(state.text.includes('恢复后的新回答'));
    const assistantMessages=await js(`historyAudit.canvasAgent.currentConversation.items.filter(i=>i.type==='message'&&i.role==='assistant').map(i=>i.text)`);
    assert.ok(assistantMessages.includes('第 5 次回答'));assert.ok(assistantMessages.includes('恢复后的新回答'));
    report.checks.push('continuing after reload with restarted transport turn counters appends a new answer without overwriting the old answer');
    // A response buffered for streaming must be flushed before a page is hidden.
    await js(`(()=>{const a=historyAudit;a.canvasAgent.currentConversation.items.push({type:'message',role:'assistant',text:'页面离开前的最新回复'});
      a.canvasAgentScheduleHistoryPersist(10000);window.dispatchEvent(new Event('pagehide'));})()`);
    const previous=win;win=makeWindow();previous.destroy();await win.loadURL(url);await setup();await js(`historyAudit.loadSnapshot(${JSON.stringify(saved)},'device')`);
    state=await js('historyAudit.read()');assert.ok(state.text.includes('页面离开前的最新回复'));assert.equal(state.history.length,7);
    report.checks.push('closing and reopening the browser retains the final pagehide-flushed response');await shot('reopened-history');
    assert.deepEqual(report.errors,[]);fs.rmSync(path.join(output,'failure.png'),{force:true});console.log(JSON.stringify({runtime:report.runtime,output,checks:report.checks.length,errors:report.errors,blobCspWarnings:report.blobCspWarnings.length}));
  }catch(error){report.failure=error.stack;console.error(error);process.exitCode=1;if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());}
  finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');if(win&&!win.isDestroyed())win.destroy();
    if(cloud)await server?.close();else if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode||0);}
});
