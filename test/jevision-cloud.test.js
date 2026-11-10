"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {CloudConnector} = require("../src/server/cloud-connector.js");
const JEVISION = require("../src/server/jevision.js");

const request = {version:1,mode:"ink",image:"data:image/png;base64,AAAA",context:{shapesFit:false}};
const answers = {action:{type:"choice", choice:"plot", confidence:.9}};
test('mock visual creation keeps its action and independent executor',()=>{
 const result=JEVISION.mockModeAnswers(request,'create_visual');
 assert.equal(result.action.choice,'create_visual');
 assert.equal(result.kind.choice,'question');
 assert.equal(result.execution_create_visual.choice,'canvas_ai');
});

function connector() {
  const connector = Object.create(CloudConnector.prototype);
  connector.configuration = {origin:"https://penecho.ai", accountToken:"local-session"};
  connector.defaultOrigin = "https://penecho.ai";
  connector.suggestionTransport = {request:(...args) => global.fetch(...args)};
  connector.status = () => ({origin:connector.configuration.origin, accountSession:{signedIn:!!connector.configuration.accountToken}});
  return connector;
}

test("Canvas relay allows queue wait and transport regardless of legacy timeout settings", () => {
  const local=connector();
  assert.equal(JEVISION.cloudJeVisionConfig(local,{}).timeoutMs,44000);
  assert.equal(JEVISION.cloudJeVisionConfig(local,{PENECHO_JEVISION_TIMEOUT_MS:"8000"}).timeoutMs,44000);
  assert.equal(JEVISION.cloudJeVisionConfig(local,{PENECHO_LLM_TIMEOUT_MS:"10000"}).timeoutMs,44000);
  assert.equal(JEVISION.cloudJeVisionConfig(local,{PENECHO_LLM_TIMEOUT_MS:"30000"}).timeoutMs,44000);
  assert.equal(JEVISION.cloudJeVisionConfig(local,{PENECHO_LLM_TIMEOUT_MS:"90000"}).timeoutMs,44000);
});

test("trial initialization and inference share the relay deadline", async t => {
  const local=connector(),previous=global.fetch,calls=[];
  const keepAlive=setTimeout(()=>{},1000);
  t.after(()=>clearTimeout(keepAlive));
  t.after(()=>{global.fetch=previous;});
  global.fetch=async(url,options)=>{
    calls.push({url,signal:options.signal});
    if(url.endsWith('/status'))return new Response(JSON.stringify({configured:true,guestToken:'guest-secret'}));
    return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  };
  const config={...JEVISION.cloudJeVisionConfig(local,{}),timeoutMs:30};
  await assert.rejects(JEVISION.requestCloudJeVision(local,config,request),error=>error.name==='TimeoutError');
  assert.equal(calls.length,2);
  // Completed status is cached/shared across windows. Its transport signal is
  // independent of this caller, while the inference still uses the total deadline.
  assert.equal(calls[0].signal.aborted,false,'a completed shared status check is independent of a later caller timeout');
  assert.equal(calls[1].signal.aborted,true);
});

test("Canvas ignores legacy JeVision destinations and keys, and forwards with its Cloud account session", async t => {
  const local = connector();
  const config = JEVISION.cloudJeVisionConfig(local, {PENECHO_JEVISION_KEY:"legacy-secret", PENECHO_JEVISION_URL:"https://old.example", PENECHO_JEVISION_MODEL:"external/model"});
  assert.equal(config.configured,true);
  assert.equal(config.url,`https://penecho.ai${JEVISION.CLOUD_SUGGEST_PATH}`);
  assert.equal(config.key,undefined);
  const previous = global.fetch;
  t.after(() => { global.fetch=previous; });
  global.fetch = async (url, options) => {
    if(url.endsWith("/status"))return new Response(JSON.stringify({configured:true,guestToken:"guest-secret"}));
    assert.equal(url,config.url);
    assert.equal(options.headers.authorization,local.configuration.accountToken?"Bearer local-session":undefined);
    assert.equal(options.headers["x-penecho-guest"],"guest-secret");
    assert.equal(options.redirect,"error");
    assert.deepEqual(JSON.parse(options.body),request);
    return new Response(JSON.stringify({ok:true,answers}));
  };
  assert.equal((await JEVISION.requestCloudJeVision(local,config,request)).answers.action.choice,"plot");
  local.configuration.accountToken = null;
  assert.equal(JEVISION.cloudJeVisionConfig(local,{PENECHO_JEVISION_KEY:"legacy-secret"}).configured,true);
  const trial=await JEVISION.requestCloudJeVision(local,config,request);
  assert.equal(trial.answers.action.choice,"plot");
  assert.equal(trial.guestToken,undefined);
});

test("Cloud suggestion cancellation reaches the transport and arbitrary app paths stay blocked", async t => {
  const local=connector(),previous=global.fetch,controller=new AbortController();
  t.after(()=>{global.fetch=previous;});
  global.fetch = async (_url,options) => new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>reject(options.signal.reason),{once:true}));
  const pending=JEVISION.requestCloudJeVision(local,JEVISION.cloudJeVisionConfig(local,{}),request,{signal:controller.signal});
  controller.abort();
  await assert.rejects(pending,error=>error.name==="AbortError");
  await assert.rejects(local.cloudRequest("/api/v1/apps/arbitrary",{method:"POST",body:request}),/Unsupported/);
});
