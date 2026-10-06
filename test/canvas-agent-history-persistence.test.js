'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'../src/client/app',file),'utf8');
const source=read('canvas-agent-runtime.js');
function fn(name,input=source){
  const match=new RegExp(`^( +)(?:async )?function ${name}\\(`,'m').exec(input);
  assert.ok(match,`Missing ${name}`);
  const rest=input.slice(match.index),end=rest.indexOf(`\n${match[1]}}\n`);
  assert.notEqual(end,-1,`Unterminated ${name}`);
  return rest.slice(0,end+match[1].length+2);
}
const plain=value=>JSON.parse(JSON.stringify(value));
const message=text=>({type:'message',role:'user',text});
const conversation=(id,updatedAt=1)=>({id,createdAt:1,updatedAt,title:id,items:[message(id)]});
function fixture(storage=new Map()){
  let sequence=0;
  const effects={renders:[],connections:[],projectWrites:[]};
  const c={
    CANVAS_AGENT_HISTORY_KEY:'history',CANVAS_AGENT_HISTORY_LIMIT:5,CANVAS_AGENT_HISTORY_ITEM_LIMIT:120,
    CANVAS_AGENT_HISTORY_TEXT_LIMIT:20000,CANVAS_AGENT_CONTINUATION_TEXT_LIMIT:80000,CANVAS_AGENT_MAX_ATTACHMENTS:5,
    CANVAS_AGENT_ERROR_MESSAGE_LIMIT:8000,CANVAS_AGENT_PROJECT_UPLOAD_LIMIT:32*1024*1024,CANVAS_AGENT_PROJECT_KEY:'project',
    canvasClientId:()=>`conversation-${++sequence}`,Date,clearTimeout,setTimeout,
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    canvasAgent:{projectId:'',projectHistory:[],projectHistoryLoaded:true,historyPersistTimer:0,currentConversation:null,pendingConversationHistory:[],socket:null},
    state:{canvasAgentCanvasKey:'',canvasAgentAutoOpen:false},canvasAgentPanel:{hidden:true},
    canvasDocuments:{},canvasDocumentsCurrent:()=>({id:'workspace-a'}),
    currentCanvasDisplayName:()=>c.state.canvasAgentCanvasKey,
    canvasAgentRenderHistoryList(){},canvasAgentSetHistoryViewing:id=>c.canvasAgent.viewingHistoryId=id,
    canvasAgentHideHistoryPopover(){},canvasAgentDismissPromptSuggestions(){},canvasAgentDidStartUserConversation(){},
    canvasAgentRenderConversation:(value,active)=>effects.renders.push({value:plain(value),active}),
    canvasAgentSetStatus(){},t:key=>key,canvasAgentWriteProjectHistory:value=>effects.projectWrites.push(plain(value)),
    canvasAgentReconcileCloudCanvas(){},canvasAgentCancelInitialAutoHide(){},canvasAgentRenderProjects(){},canvasAgentHideProjectPopover(){},canvasAgentSyncPromptSuggestions(){},
    canvasAgentDropSessionIdentity(){},canvasAgentReportAsyncError:error=>{throw error;},selectedAiConnectionId:()=> 'test',
    canvasAgentBeginLocalConversation(){c.canvasAgent.currentConversation=c.canvasAgentNewConversationRecord();c.canvasAgent.pendingConversationHistory=[];c.canvasAgent.viewingHistoryId='';},
    canvasAgentStartNewConversation:async(id,options)=>effects.connections.push({id,options:plain(options)}),
    WebSocket:{OPEN:1},window:{PENECHO_CONFIG:{}},document:{body:{classList:{contains:()=>false}}},
  };
  vm.createContext(c);
  const names=['canvasAgentHistoryText','canvasAgentNormalizeError','canvasAgentMessageText','canvasAgentVisibleAssistantText','canvasAgentNormalizeHistoryFile','canvasAgentNormalizeHistoryItem','canvasAgentRestoreLegacyCopyableSummaries','canvasAgentNormalizeConversation','canvasAgentReadHistoryStore','canvasAgentRememberCanvasMeta','canvasAgentStoredHistoryGroups','canvasAgentHistoryForCanvas','canvasAgentWriteHistoryForCanvas','canvasAgentDeleteStoredConversation','canvasAgentConversationTitle','canvasAgentPersistCurrentConversation','canvasAgentScheduleHistoryPersist','canvasAgentNewConversationRecord','canvasAgentConversationHistory','canvasAgentContinuationHistory','canvasAgentRestoreLocalConversation','canvasAgentPreviewStoredConversation','canvasAgentCanvasIdentity','canvasAgentCanvasDidChange','canvasAgentCanvasDidPersist'];
  vm.runInContext(names.map(name=>fn(name)).join('\n'),c);
  return {c,effects,storage};
}
test('switching canvases restores the most recent local conversation and sends its continuation',async()=>{
  const {c,effects}=fixture();
  c.canvasAgentCanvasDidChange({location:'workspace',id:'a'});
  const first=c.canvasAgent.currentConversation;
  first.items.push(message('Question A'),{type:'message',role:'assistant',text:'Answer A',final:true});
  c.canvasAgentCanvasDidChange({location:'workspace',id:'b'});
  const second=c.canvasAgent.currentConversation;second.items.push(message('Question B'));
  c.canvasAgent.socket={readyState:1};
  c.canvasAgentCanvasDidChange({location:'workspace',id:'a'});
  assert.equal(c.canvasAgent.currentConversation.id,first.id);
  assert.deepEqual(plain(c.canvasAgent.currentConversation.items).map(item=>item.text),['Question A','Answer A']);
  assert.deepEqual(plain(c.canvasAgentContinuationHistory()),[{role:'user',text:'Question A'},{role:'assistant',text:'Answer A'}]);
  assert.equal(effects.connections.at(-1).options.preserveConversation,true);
  assert.equal(effects.renders.at(-1).active,false);
  assert.equal(c.canvasAgentHistoryForCanvas('workspace:b')[0].id,second.id);
});
test('a fresh browser runtime restores saved-canvas history without a live Agent session',()=>{
  const first=fixture();first.c.canvasAgentCanvasDidChange({location:'cloud',id:'saved'});
  const original=first.c.canvasAgent.currentConversation;original.items.push(message('Persist through refresh'));
  first.c.canvasAgentPersistCurrentConversation();
  const reloaded=fixture(first.storage);reloaded.c.canvasAgentCanvasDidChange({location:'cloud',id:'saved'});
  assert.equal(reloaded.c.canvasAgent.currentConversation.id,original.id);
  assert.equal(reloaded.effects.renders.at(-1).value.items[0].text,'Persist through refresh');
  assert.equal(reloaded.effects.connections.length,0);
});
test('browser history retains earlier conversations beyond the five project entries',()=>{
  const {c,storage}=fixture();c.state.canvasAgentCanvasKey='device:saved';
  for(let index=0;index<8;index++){
    c.canvasAgent.currentConversation=conversation(`chat-${index}`,index+1);
    assert.equal(c.canvasAgentPersistCurrentConversation(),true);
  }
  const reloaded=fixture(storage);
  assert.equal(reloaded.c.canvasAgentHistoryForCanvas('device:saved').length,8);
  assert.equal(reloaded.c.canvasAgentStoredHistoryGroups()[0].conversations.length,8);
});
test('project-history loading failures do not block the browser copy',()=>{
  const {c,effects}=fixture();c.state.canvasAgentCanvasKey='workspace:a';
  c.canvasAgent.projectId='unavailable-project';c.canvasAgent.projectHistoryLoaded=false;
  c.canvasAgent.currentConversation=conversation('offline-project');
  assert.equal(c.canvasAgentPersistCurrentConversation(),true);
  assert.equal(c.canvasAgentHistoryForCanvas()[0].id,'offline-project');
  assert.equal(effects.projectWrites.length,0);
  c.canvasAgent.projectId='';
  assert.equal(c.canvasAgentHistoryForCanvas()[0].id,'offline-project');
});
test('local and project histories keep the newest version of each conversation',()=>{
  const {c}=fixture();c.state.canvasAgentCanvasKey='workspace:a';
  c.canvasAgentWriteHistoryForCanvas('workspace:a',[conversation('duplicate',30),conversation('local',20)]);
  c.canvasAgent.projectId='project';c.canvasAgent.projectHistory=[conversation('duplicate',10),conversation('remote',40)];
  const history=plain(c.canvasAgentHistoryForCanvas());
  assert.deepEqual(history.map(item=>item.id),['remote','duplicate','local']);
  assert.equal(history[1].updatedAt,30);
  assert.equal(c.canvasAgentHistoryForCanvas('workspace:b').length,0);
});
test('saving a workspace canvas retains its local conversation under the saved location',()=>{
  const {c}=fixture();c.canvasAgentCanvasDidChange({id:'a',location:'workspace'});
  c.canvasAgent.currentConversation.items.push(message('Before Save'));
  const id=c.canvasAgent.currentConversation.id;
  c.canvasAgentCanvasDidPersist('device','saved');
  c.canvasAgentCanvasDidChange({id:'saved',location:'device'});
  assert.equal(c.canvasAgent.currentConversation.id,id);
  assert.equal(c.canvasAgent.currentConversation.items[0].text,'Before Save');
});
test('old draft histories remain listed and can be previewed without replacing the active conversation',async()=>{
  const {c,effects}=fixture();c.canvasAgentCanvasDidChange({id:'active',location:'workspace'});
  const active=c.canvasAgent.currentConversation;active.items.push(message('Current draft'));
  const archived=conversation('old-draft');
  c.canvasAgentWriteHistoryForCanvas('draft:legacy',[archived]);
  assert.equal(c.canvasAgentStoredHistoryGroups().some(group=>group.canvasKey==='draft:legacy'),true);
  assert.equal(c.canvasAgentPreviewStoredConversation(archived),true);
  assert.equal(c.canvasAgent.currentConversation,active);
  assert.equal(c.canvasAgent.viewingHistoryId,'old-draft');
  assert.equal(effects.renders.at(-1).value.id,'old-draft');
  vm.runInContext(fn('canvasAgentSubmitMessage'),c);
  assert.equal(await c.canvasAgentSubmitMessage({textOverride:'Do not send from archived history'}),false);
});
test('messages marked for immediate persistence survive without a timer tick',()=>{
  const {c,storage}=fixture();c.state.canvasAgentCanvasKey='workspace:a';
  c.canvasAgent.currentConversation=conversation('immediate');
  c.canvasAgentScheduleHistoryPersist(0);
  assert.equal(JSON.parse(storage.get('history')).canvases['workspace:a'][0].id,'immediate');
  assert.equal(c.canvasAgent.historyPersistTimer,0);
});
test('unsaved canvas identity uses its workspace document instead of generating a new draft key',()=>{
  const {c}=fixture();assert.equal(c.canvasAgentCanvasIdentity(),'workspace:workspace-a');
  assert.equal(c.canvasAgentCanvasIdentity(),'workspace:workspace-a');
  assert.equal(c.canvasAgentCanvasIdentity({id:'saved',location:'device'}),'device:saved');
});
test('deleting a project-backed local conversation honors the active turn and removes both copies',()=>{
  const {c,effects}=fixture();c.state.canvasAgentCanvasKey='workspace:a';
  c.canvasAgent.projectId='project';c.canvasAgent.currentConversation=conversation('delete-me');
  c.canvasAgentPersistCurrentConversation();c.canvasAgent.running=true;
  assert.equal(c.canvasAgentDeleteStoredConversation('workspace:a','delete-me').reason,'busy');
  c.canvasAgent.running=false;
  assert.equal(c.canvasAgentDeleteStoredConversation('workspace:a','delete-me').deleted,true);
  assert.equal(c.canvasAgentHistoryForCanvas().length,0);
  assert.deepEqual(effects.projectWrites.at(-1),[]);
  assert.notEqual(c.canvasAgent.currentConversation.id,'delete-me');
});
test('unavailable saved canvases still allow offline transcript viewing',async()=>{
  const {c}=fixture(),navigator=read('studio-navigator.js'),archived=conversation('unavailable-canvas');
  let opened=0;c.canvasAgentCanvasDidChange({id:'active',location:'workspace'});
  const active=c.canvasAgent.currentConversation;
  Object.assign(c,{studioNavigatorPendingConversation:null,studioNavigator:{setAttribute(){},removeAttribute(){}},closeStudioNavigatorAfterCompactAction(){},
    openCanvasAgent(){opened++;},studioNavigatorCanvasIdentity:()=>({id:'missing',location:'device'}),requestLoadSnapshot:async()=>false,
    document:{querySelector:()=>({open:false})}});
  vm.runInContext(fn('previewStudioConversation',navigator)+'\n'+fn('openStudioConversation',navigator),c);
  const control={disabled:false};
  assert.equal(await c.openStudioConversation({canvasKey:'device:missing',name:'Missing'},archived,control),true);
  assert.equal(c.canvasAgent.viewingHistoryId,archived.id);assert.equal(c.canvasAgent.currentConversation,active);
  assert.equal(control.disabled,false);assert.equal(opened,1);
});
test('browser storage failure is reported without replacing the previous saved history',()=>{
  const {c,storage}=fixture(),statuses=[];c.state.canvasAgentCanvasKey='workspace:a';c.canvasAgent.currentConversation=conversation('retained');
  c.canvasAgentPersistCurrentConversation();const before=storage.get('history');
  c.canvasAgent.currentConversation.items.push(message('Unsaved latest message'));
  c.localStorage.setItem=()=>{throw Error('QuotaExceededError');};c.canvasAgentSetStatus=(...args)=>statuses.push(args);
  assert.equal(c.canvasAgentPersistCurrentConversation(),false);assert.equal(storage.get('history'),before);
  assert.deepEqual(statuses.at(-1),['canvasAgentHistorySaveFailed','error']);
});
