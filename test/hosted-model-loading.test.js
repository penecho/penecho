"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync(require.resolve("../src/client/app/core.js"),"utf8");
function harness(){
  const requests=[],hostedSettings={models:[],credits:null,loading:false,generation:0,signedIn:false};
  const context={hostedSettings,window:{PENECHO_CONFIG:{}},AI_CONNECTION_STORAGE_KEY:'selected-model',AbortController,AbortSignal,renderHostedModels(){},authenticatedApiHeaders:()=>({}),aiConnectionStorageKey:()=>'',localStorage:{getItem:()=>null},fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))};
  vm.runInNewContext(source.slice(source.indexOf('  function loadHostedModels('),source.indexOf('  function hasSelectedAiConnection(')),context);
  return {context,requests,hostedSettings};
}
const success=()=>new Response(JSON.stringify({accountId:'current',models:[],credits:{balance:25}}));
test('concurrent startup consumers reuse the same model request',async()=>{
  const h=harness(),first=h.context.loadHostedModels(),second=h.context.loadHostedModels();
  assert.equal(first,second);assert.equal(h.requests.length,1);
  h.requests[0].resolve(success());await first;
  assert.equal(h.hostedSettings.credits,25);assert.equal(h.hostedSettings.loading,false);
});
test('account switching aborts the old request and disposes a late response',async()=>{
  const h=harness(),first=h.context.loadHostedModels(),second=h.context.loadHostedModels({accountChanged:true});
  assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.requests.length,2);
  const stale=success();h.requests[0].resolve(stale);await first;
  assert.equal(stale.bodyUsed,true);assert.equal(h.hostedSettings.loading,true);
  h.requests[1].resolve(success());await second;
  assert.equal(h.hostedSettings.loading,false);assert.equal(h.context.window.PENECHO_CONFIG.connectionAccountId,'current');
});
test('denied and failed responses are cancelled and an explicit retry can recover',async()=>{
  for(const status of [401,403,503]){
    const h=harness(),pending=h.context.loadHostedModels(),response=new Response('unread response',{status});
    h.requests[0].resolve(response);await pending;assert.equal(response.bodyUsed,true);
    assert.equal(h.hostedSettings.loading,false);assert.equal(h.hostedSettings.models.length,0);
    const retry=h.context.loadHostedModels({force:true});assert.equal(h.requests[1].url,'/api/cloud/models?refresh=1');
    h.requests[1].resolve(success());await retry;assert.equal(h.hostedSettings.signedIn,true);
  }
});
