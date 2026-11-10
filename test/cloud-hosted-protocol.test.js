'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CloudConnector } = require('../src/server/cloud-connector.js');
const id = '12345678-1234-1234-1234-123456789abc';
function connector() {
  const connector = Object.create(CloudConnector.prototype);
  connector.configuration = { origin:'https://example.com', accountToken:'account-a' };
  connector.expireAccountSessionIfNeeded = () => false;
  return connector;
}
test('cold hosted protocol preparation deduplicates catalog and caches authoritative Anthropic route', async () => {
  const c = connector(); let calls = 0;
  c.cloudRequest = async () => { calls++; return { models:[{ id, available:true, apiFormat:'anthropic' }] }; };
  assert.equal(c.hostedConnection(`hosted:${id}`).apiFormat, null);
  const [a,b] = await Promise.all([c.prepareHostedConnection(`hosted:${id}`),c.prepareHostedConnection(`hosted:${id}`)]);
  assert.equal(calls, 1); assert.equal(a.apiFormat, 'anthropic'); assert.deepEqual(a,b);
  assert.equal(`${a.apiUrl}/v1/messages`, 'https://example.com/api/v1/hosted/v1/messages');
  await c.prepareHostedConnection(`hosted:${id}`); assert.equal(calls,1);
});
test('catalog refresh updates protocol and removes unavailable models', async () => {
  const c = connector(); let format = 'openai'; let available = true;
  c.cloudRequest = async () => ({ models:[{ id, available, apiFormat:format }] });
  assert.equal((await c.prepareHostedConnection(`hosted:${id}`)).apiFormat,'openai');
  format='anthropic'; await c.refreshHostedCatalog({force:true});
  assert.equal(c.hostedConnection(`hosted:${id}`).apiFormat,'anthropic');
  available=false; await c.refreshHostedCatalog({force:true});
  await assert.rejects(c.prepareHostedConnection(`hosted:${id}`), /unavailable/);
});
test('missing legacy metadata and unsupported protocols fail closed', async () => {
  for (const apiFormat of [undefined,'other']) {
    const c=connector(); c.cloudRequest=async()=>({models:[{id,available:true,apiFormat}]});
    await assert.rejects(c.prepareHostedConnection(`hosted:${id}`), {code:'hosted_model_protocol_unavailable'});
    assert.deepEqual(c.hostedConnections(),[]);
  }
});
test('account switch rejects late catalog and does not reuse the former account protocol', async () => {
  const c=connector(); let finish;
  c.cloudRequest=()=>new Promise(resolve=>{finish=resolve;});
  const old=c.prepareHostedConnection(`hosted:${id}`);
  c.configuration={...c.configuration,accountToken:'account-b'};
  finish({models:[{id,available:true,apiFormat:'anthropic'}]});
  await assert.rejects(old,/account changed/);
  assert.equal(c.hostedConnection(`hosted:${id}`).apiFormat,null);
  c.cloudRequest=async()=>({models:[{id,available:true,apiFormat:'openai'}]});
  assert.equal((await c.prepareHostedConnection(`hosted:${id}`)).apiFormat,'openai');
  c.configuration={...c.configuration,origin:'https://another.example.com'};
  assert.deepEqual(c.hostedConnections(),[]);
  assert.equal(c.hostedConnection(`hosted:${id}`).apiFormat,null);
});
test('Agent router awaits protocol preparation before synchronous connection resolution', async () => {
  const { CanvasAgentHostRouter } = await import('../src/server/canvas-agent/host-router.mjs');
  let prepared=false;
  const owner={initialize:async()=>{},connect:async()=>({})};
  const router=new CanvasAgentHostRouter({
    prepareConnection:async connectionId=>{assert.equal(connectionId,`hosted:${id}`);await Promise.resolve();prepared=true;},
    resolveConnection:()=>{assert.equal(prepared,true);return {provider:'api',apiFormat:'anthropic'};},
    harnessFactory:async()=>owner,nativeFactory:async()=>{throw new Error('wrong engine');},
  });
  assert.equal((await router.connect({connectionId:`hosted:${id}`})).engine,'harness');
});
test('hosted Anthropic Harness profile adds Cloud bearer auth without changing custom providers', async () => {
  const { connectionProfile } = await import('../src/server/canvas-agent/runtime.mjs');
  const connection={id:`hosted:${id}`,provider:'api',apiFormat:'anthropic',apiUrl:'https://example.com/api/v1/hosted',apiModel:id,apiKey:'account-token'};
  const hosted=connectionProfile({...connection,hosted:true});
  assert.deepEqual(hosted.config.headers,{'x-penecho-request-kind':'agent',Authorization:'Bearer account-token'});
  assert.equal(hosted.config.baseURL,'https://example.com/api/v1/hosted');
  assert.equal(connectionProfile(connection).config.headers,undefined);
  assert.deepEqual(connectionProfile({...connection,hosted:true,apiFormat:'openai'}).config.headers,{'x-penecho-request-kind':'agent'});
});

test('hosted Agent inactivity stops without five repeats while other transient failures retain recovery',async()=>{
  const {connectionProfile}=await import('../src/server/canvas-agent/runtime.mjs');
  const {resolveRetryPolicy}=await import('@deepseek-ai/dsh-llm');
  for(const apiFormat of ['anthropic','openai']) {
    const connection={id:'hosted:test',hosted:true,apiFormat,apiUrl:'https://example.com/api/v1/hosted',apiModel:'model'};
    const policy=resolveRetryPolicy(connectionProfile(connection).config.retryPolicy,'test');
    assert.equal(policy.retryableCodes.includes('TIMEOUT'),false);
    assert.equal(policy.maxRetries,5);
    for(const code of ['RATE_LIMIT','SERVER','TRANSPORT'])assert.equal(policy.retryableCodes.includes(code),true);
    assert.equal(connectionProfile({...connection,hosted:false}).config.retryPolicy,undefined);
  }
});
