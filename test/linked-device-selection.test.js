'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const core=fs.readFileSync(path.join(__dirname,'../src/client/app/core.js'),'utf8');
const agent=fs.readFileSync(path.join(__dirname,'../src/client/app/canvas-agent-runtime.js'),'utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
function fn(source,name){const match=new RegExp(`  (?:async )?function ${name}\\(`).exec(source);assert.ok(match,name);return source.slice(match.index,source.indexOf('\n  }',match.index)+4);}
function fixture(){
 const data=new Map(),c={window:{PENECHO_CONFIG:{runtime:'cloud',linkedDeviceId:'mac',connectionAccountId:'account-a'}},location:{origin:'https://cloud.test'},localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},AI_CONNECTION_STORAGE_KEY:'penecho-ai-connection-id',settings:{connections:[]},hostedSettings:{models:[]},t:k=>k,authenticatedApiHeaders:()=>({}),renderConnectionLists:()=>{},AbortSignal,fetch:async()=>({ok:true,json:async()=>({connections:[]})}),loadHostedModels:async()=>{},canvasAgent:{},canvasAgentRestoreScopedSession:()=>{},data};
 vm.createContext(c);
 for(const name of ['aiConnectionScope','aiConnectionStorageKey','selectedAiConnectionId','storeAiConnectionSelection','aiConnectionSelectionError','syncLocalConnectionSelection','validateAiConnectionSelection'])vm.runInContext(fn(core,name),c);
 return c;
}
test('same-name model UUIDs stay isolated by device, account, origin and hosted runtime',()=>{
 const c=fixture();c.storeAiConnectionSelection(A);
 c.window.PENECHO_CONFIG.linkedDeviceId='windows';assert.equal(c.selectedAiConnectionId(),'default');c.storeAiConnectionSelection(B);
 c.window.PENECHO_CONFIG.linkedDeviceId='mac';assert.equal(c.selectedAiConnectionId(),A);
 c.storeAiConnectionSelection(`hosted:${A}`);c.window.PENECHO_CONFIG.linkedDeviceId='windows';assert.equal(c.selectedAiConnectionId(),`hosted:${A}`);
 c.storeAiConnectionSelection(B);assert.equal(c.selectedAiConnectionId(),B);
 c.window.PENECHO_CONFIG.connectionAccountId='account-b';assert.equal(c.selectedAiConnectionId(),'default');
 c.window.PENECHO_CONFIG.connectionAccountId='account-a';c.location.origin='https://uat.test';assert.equal(c.selectedAiConnectionId(),'default');
});
test('legacy UUID migrates only after exact device catalog membership; deleted choice never switches model',()=>{
 const c=fixture();c.data.set(c.AI_CONNECTION_STORAGE_KEY,A);c.settings.connections=[{id:B,apiModel:'glm-5.3-flash'}];c.syncLocalConnectionSelection();assert.equal(c.selectedAiConnectionId(),'default');
 c.settings.connections=[{id:A}];c.syncLocalConnectionSelection();assert.equal(c.selectedAiConnectionId(),A);
 c.settings.connections=[{id:B}];c.syncLocalConnectionSelection();assert.equal(c.selectedAiConnectionId(),A);assert.equal(c.settings.connections[0].active,false);
 c.window.PENECHO_CONFIG.linkedDeviceId='windows';c.syncLocalConnectionSelection();assert.equal(c.settings.connections.length,0);assert.equal(c.selectedAiConnectionId(),'default');
});
test('hosted catalog migration never replaces a local choice made before or during loading',async()=>{
 for(const runtime of ['cloud','local'])for(const timing of ['before','during']){
  const c=fixture();c.window.PENECHO_CONFIG.runtime=runtime;
  Object.assign(c.hostedSettings,{generation:0,loading:false});c.renderHostedModels=()=>{};
  c.data.set(c.AI_CONNECTION_STORAGE_KEY,`hosted:${B}`);
  let release; c.fetch=()=>new Promise(resolve=>{release=()=>resolve({ok:true,status:200,json:async()=>({accountId:'account-a',models:[{id:B,available:true,multiplier:1}],credits:{available:10}})});});
  vm.runInContext(fn(core,'loadHostedModelsOnce'),c);
  if(timing==='before')c.storeAiConnectionSelection(A);
  const pending=c.loadHostedModelsOnce();
  if(timing==='during')c.storeAiConnectionSelection(A);
  release();await pending;
  assert.equal(c.selectedAiConnectionId(),A,`${runtime}, ${timing}: local selection must win over old hosted history`);
  assert.equal(c.data.get(`${c.aiConnectionStorageKey(true)}:selected`),'false');
 }
});
test('hosted legacy selection still migrates when no scoped choice exists',async()=>{
 const c=fixture();Object.assign(c.hostedSettings,{generation:0,loading:false});c.renderHostedModels=()=>{};
 c.data.set(c.AI_CONNECTION_STORAGE_KEY,`hosted:${B}`);
 c.fetch=async()=>({ok:true,status:200,json:async()=>({accountId:'account-a',models:[{id:B,available:true,multiplier:1}],credits:{available:10}})});
 vm.runInContext(fn(core,'loadHostedModelsOnce'),c);await c.loadHostedModelsOnce();
 assert.equal(c.selectedAiConnectionId(),`hosted:${B}`);
});
test('late catalog from replaced device is discarded before selection or connection list changes',async()=>{
 const c=fixture();c.storeAiConnectionSelection(A);let release;
 c.fetch=async()=>{await new Promise(resolve=>release=resolve);return{ok:true,json:async()=>({connections:[{id:A}]})};};
 const pending=c.validateAiConnectionSelection(A,c.aiConnectionScope());await new Promise(setImmediate);
 c.window.PENECHO_CONFIG.linkedDeviceId='windows';c.storeAiConnectionSelection(B);release();
 await assert.rejects(pending,e=>e.code==='CONNECTION_STALE');assert.equal(c.selectedAiConnectionId(),B);assert.equal(c.settings.connections.length,0);
});
test('preflight rejects deleted UUID and never uses same-name/default connection',async()=>{
 const c=fixture();c.storeAiConnectionSelection(A);c.fetch=async()=>({ok:true,json:async()=>({connections:[{id:B,apiModel:'glm-5.3-flash'}]})});
 await assert.rejects(c.validateAiConnectionSelection(A,c.aiConnectionScope()),e=>e.code==='CONNECTION_STALE');assert.equal(c.selectedAiConnectionId(),A);
});
test('handshake validates and retries only one stale rejection, with no user-turn replay',async()=>{
 const c=fixture();c.storeAiConnectionSelection(A);let validations=0,starts=0;
 c.validateAiConnectionSelection=async()=>validations++;
 vm.runInContext(fn(agent,'canvasAgentWaitForReady'),c);
 await c.canvasAgentWaitForReady(()=>{starts++;if(starts===1)c.canvasAgent.connectReject(Object.assign(Error('stale'),{code:'CONNECTION_STALE'}));else c.canvasAgent.connectResolve();},{handshakeId:'h',provider:'api'});
 assert.equal(starts,2);assert.equal(validations,2);assert.equal(c.canvasAgent.connectPromise,null);
 starts=0;await assert.rejects(c.canvasAgentWaitForReady(()=>{starts++;c.canvasAgent.connectReject(Object.assign(Error('closed'),{code:'CONNECTION_CLOSED'}));},{handshakeId:'h2'}),e=>e.code==='CONNECTION_CLOSED');assert.equal(starts,1);
 starts=0;await assert.rejects(c.canvasAgentWaitForReady(()=>{starts++;c.canvasAgent.connectReject(Object.assign(Error('stale'),{code:'CONNECTION_STALE'}));},{handshakeId:'h3'}),e=>e.code==='CONNECTION_STALE');assert.equal(starts,2);
});
test('preflight failure starts no handshake and concurrent callers share validation',async()=>{
 const c=fixture();c.storeAiConnectionSelection(A);let release,starts=0,validations=0;
 c.validateAiConnectionSelection=async()=>{validations++;await new Promise(resolve=>release=resolve);throw Object.assign(Error('stale'),{code:'CONNECTION_STALE'});};
 vm.runInContext(fn(agent,'canvasAgentWaitForReady'),c);
 const first=c.canvasAgentWaitForReady(()=>starts++,{handshakeId:'h'}),second=c.canvasAgentWaitForReady(()=>starts++,{handshakeId:'h2'});
 assert.equal(first,second);await new Promise(setImmediate);release();await assert.rejects(first);assert.equal(starts,0);assert.equal(validations,1);
});

test('deferred resume restores only matching account/device/connection identity',()=>{
 const c=fixture();vm.runInContext(fn(agent,'canvasAgentRestoreScopedSession'),c);
 const scope=c.aiConnectionScope(),saved={scope,sessionId:'session-a',resumeToken:'resume-a',connectionId:A,projectId:'',accessMode:'controlled'};
 Object.assign(c.canvasAgent,{projectId:'',accessMode:'controlled',pendingStoredSession:saved});
 c.canvasAgentRestoreScopedSession(scope,B);assert.equal(c.canvasAgent.sessionId,undefined);
 c.canvasAgent.pendingStoredSession=saved;c.canvasAgentRestoreScopedSession(scope,A);assert.equal(c.canvasAgent.sessionId,'session-a');
 c.canvasAgent.sessionId='';c.canvasAgent.pendingStoredSession=saved;c.canvasAgentRestoreScopedSession('different-account',A);assert.equal(c.canvasAgent.sessionId,'');
});

test('Canvas or conversation switch during preflight cancels the pending handshake',async()=>{
 const c=fixture();c.storeAiConnectionSelection(A);let release,starts=0;
 c.canvasAgent.sessionGeneration=1;c.canvasAgent.currentConversation={id:'old'};
 c.validateAiConnectionSelection=async()=>new Promise(resolve=>release=resolve);
 vm.runInContext(fn(agent,'canvasAgentWaitForReady'),c);
 const pending=c.canvasAgentWaitForReady(()=>starts++,{handshakeId:'h'});await new Promise(setImmediate);
 c.canvasAgent.sessionGeneration=2;c.canvasAgent.currentConversation={id:'new'};release();
 await assert.rejects(pending,e=>e.code==='SESSION_CHANGED');assert.equal(starts,0);
});
