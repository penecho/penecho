'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/client/app/canvas-agent-runtime.js'),'utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
function fn(name){const start=source.indexOf(`  function ${name}(`);const asyncStart=source.indexOf(`  async function ${name}(`);const from=start<0?asyncStart:start;assert.ok(from>=0,name);const end=source.indexOf('\n  }',from)+4;return source.slice(from,end);}
function fixture(extra={}){
 let doc={};
 const context={crypto:require('node:crypto').webcrypto,canvasDocumentsCurrent:()=>doc,replaceDocument:()=>{doc={};},window:{PENECHO_CONFIG:{runtime:'cloud',canvasAgent:false,browserCanvasEditing:true,hostedCanvasAgent:true}},state:{currentSnapshotLocation:'cloud',currentSnapshotId:B},location:{pathname:`/canvas/${A}`,protocol:'https:',host:'cloud.test'},canvasAgent:{socket:null,socketCloudCanvasId:'',currentConversation:{id:'conversation'},toolControllers:new Map(),toolResultCache:new Map(),sessionGeneration:3},selectedAiConnectionId:()=>`hosted:${A}`,t:k=>k,...extra};
 vm.createContext(context);for(const name of ['canvasAgentCloudSavedCanvasId','canvasAgentCloudExecutionScope','canvasAgentCloudFilesPath','canvasAgentCloudCanvasId','canvasAgentUsesCloudHost','canvasAgentExecutionAvailable','canvasAgentUnavailableMessage','canvasAgentCloudFileScope','canvasAgentSocketUrl','canvasAgentReconcileCloudCanvas'])vm.runInContext(fn(name),context);return context;
}
test('hosted socket, attachments and availability follow active B, never stale URL A; drafts have independent execution scopes',()=>{
 const c=fixture();assert.equal(c.canvasAgentUsesCloudHost(),true);assert.match(c.canvasAgentSocketUrl(),new RegExp(`/canvases/${B}/agent$`));assert.equal(c.canvasAgentCloudFileScope().canvasId,B);
 for(const state of [{currentSnapshotLocation:'device',currentSnapshotId:B},{currentSnapshotLocation:null,currentSnapshotId:null},{currentSnapshotLocation:'cloud',currentSnapshotId:'draft'}]){Object.assign(c.state,state);assert.equal(c.canvasAgentExecutionAvailable(),true);assert.equal(c.canvasAgentCloudFileScope().draft,true);assert.match(c.canvasAgentSocketUrl(),/agent\?draft=1$/);assert.notEqual(c.canvasAgentCloudCanvasId(),A);assert.notEqual(c.canvasAgentCloudCanvasId(),B);}
 Object.assign(c.state,{currentSnapshotLocation:'cloud',currentSnapshotId:B});assert.equal(c.canvasAgentExecutionAvailable(),true);
 c.window.PENECHO_CONFIG={runtime:'local',canvasAgent:true};assert.equal(c.canvasAgentExecutionAvailable(),true);assert.match(c.canvasAgentSocketUrl(),/\/api\/canvas-agent\/socket$/);
});
test('changing Cloud owner closes connecting socket, rejects handshake and aborts old tools',async()=>{
 const controller=new AbortController(),calls=[];let rejection;
 const c=fixture({sessionStorage:{removeItem(){}},CANVAS_AGENT_SESSION_KEY:'test',canvasAgentResolveApproval:()=>{},canvasAgentInvalidateSubmitExecution:()=>calls.push('invalidate'),canvasAgentSetRunning:()=>calls.push('idle')});
 for(const name of ['canvasAgentBeginSessionTransition','canvasAgentDropSessionIdentity'])vm.runInContext(fn(name),c);
 c.canvasAgent.socketCloudCanvasId=A;c.canvasAgent.sessionId='session-A';c.canvasAgent.toolControllers.set('tool',controller);
 c.canvasAgent.connectPromise=new Promise((_,reject)=>{c.canvasAgent.connectReject=reject;});rejection=assert.rejects(c.canvasAgent.connectPromise,e=>e.code==='SESSION_CHANGED');
 c.canvasAgent.socket={close(){assert.equal(c.canvasAgent.socket,null);calls.push('close');}};
 c.canvasAgentReconcileCloudCanvas();await rejection;
 assert.equal(c.canvasAgent.sessionId,'');assert.equal(c.canvasAgent.sessionGeneration,4);assert.equal(c.canvasAgent.socketCloudCanvasId,'');assert.equal(controller.signal.aborted,true);assert.deepEqual(calls,['invalidate','idle','close']);
});
test('same Cloud owner and local socket do not lose sessions',()=>{
 let closes=0;const c=fixture();c.canvasAgent.socket={close(){closes++;}};c.canvasAgent.socketCloudCanvasId=B;c.canvasAgent.sessionId='keep';c.canvasAgentReconcileCloudCanvas();assert.equal(c.canvasAgent.sessionId,'keep');
 c.canvasAgent.socketCloudCanvasId='';c.state.currentSnapshotId=null;c.canvasAgentReconcileCloudCanvas();assert.equal(closes,0);
});

test('online device and hosted execution coexist and select distinct hosts on the same Cloud Canvas',()=>{
 let selected=`hosted:${A}`;const c=fixture({selectedAiConnectionId:()=>selected});
 Object.assign(c.window.PENECHO_CONFIG,{canvasAgent:true,linkedDeviceOnline:true});
 assert.equal(c.canvasAgentExecutionAvailable(),true);
 assert.match(c.canvasAgentSocketUrl(),new RegExp(`/hosted/canvases/${B}/agent$`));
 selected=A;
 assert.equal(c.canvasAgentExecutionAvailable(),true);
 assert.match(c.canvasAgentSocketUrl(),/remote-canvas\/canvas-agent$/);
 Object.assign(c.window.PENECHO_CONFIG,{canvasAgent:false,linkedDeviceOnline:false});
 assert.equal(c.canvasAgentExecutionAvailable(),false);
 selected=`hosted:${A}`;
 assert.equal(c.canvasAgentExecutionAvailable(),true);
 assert.match(c.canvasAgentSocketUrl(),new RegExp(`/hosted/canvases/${B}/agent$`));
});
test('Cloud ID changed during capabilities await cannot establish stale websocket',async()=>{
 let sockets=0;const c=fixture({canvasAgentEnsureProjects:async()=>{},canvasAgentSetStatus:()=>{},canvasAgentCurrentWidgetCapabilities:async()=>{c.state.currentSnapshotId=A;return{};},WebSocket:Object.assign(function(){sockets++;},{OPEN:1})});
 vm.runInContext(fn('canvasAgentConnect'),c);await assert.rejects(c.canvasAgentConnect(),e=>e.code==='SESSION_CHANGED');assert.equal(sockets,0);
});

test('draft execution is stable within a document and isolated across new documents',()=>{
 const c=fixture();Object.assign(c.state,{currentSnapshotLocation:null,currentSnapshotId:null});
 const first=c.canvasAgentCloudCanvasId();assert.equal(c.canvasAgentCloudCanvasId(),first);
 assert.match(c.canvasAgentCloudFilesPath(c.canvasAgentCloudFileScope(),'cloud-file-id'),/cloud-file-id\?draft=1$/);
 c.replaceDocument();assert.notEqual(c.canvasAgentCloudCanvasId(),first);
});

function restoredSessionFixture(saved, canvasKey=`cloud:${B}`, conversationId='conversation-B') {
 const c=fixture();
 Object.assign(c.state,{canvasAgentCanvasKey:canvasKey});
 Object.assign(c.canvasAgent,{sessionId:'',projectId:'',accessMode:'controlled',pendingStoredSession:saved,currentConversation:{id:conversationId}});
 vm.runInContext(fn('canvasAgentRestoreScopedSession'),c);
 c.canvasAgentRestoreScopedSession('account:hosted',`hosted:${A}`);
 return c;
}
const storedSession=()=>({scope:'account:hosted',connectionId:`hosted:${A}`,projectId:'',accessMode:'controlled',sessionId:'session-A',resumeToken:'test-resume-A',canvasKey:`cloud:${A}`,conversationId:'conversation-A'});

test('a new Cloud Canvas cannot restore another Canvas session from the same account and model',()=>{
 const c=restoredSessionFixture(storedSession());
 assert.equal(c.canvasAgent.sessionId,'');
 assert.equal(c.canvasAgent.pendingStoredSession,null);
});
test('a new conversation on the same Cloud Canvas cannot restore the previous conversation session',()=>{
 const c=restoredSessionFixture(storedSession(),`cloud:${A}`,'new-conversation');
 assert.equal(c.canvasAgent.sessionId,'');
});
test('reopening the original Canvas conversation can restore its matching session',()=>{
 const c=restoredSessionFixture(storedSession(),`cloud:${A}`,'conversation-A');
 assert.equal(c.canvasAgent.sessionId,'session-A');
 assert.equal(c.canvasAgent.resumeToken,'test-resume-A');
});
test('legacy sessions without a Canvas binding cannot replay into a new Cloud Canvas',()=>{
 const saved=storedSession();delete saved.canvasKey;delete saved.conversationId;
 const c=restoredSessionFixture(saved);
 assert.equal(c.canvasAgent.sessionId,'');
});
