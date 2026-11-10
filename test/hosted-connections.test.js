"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { CloudConnector, cloudAiRelayRequest } = require("../src/server/cloud-connector.js");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const modelId = "00000000-0000-4000-8000-000000000101";

test("hosted models use local account authorization without exposing the credential to the browser", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-hosted-test-"));
  const originalFetch = global.fetch;
  try {
    const connector = new CloudConnector({ stateDir, executeRequest:async () => ({}), defaultOrigin:"https://example.com" });
    connector.writeConfiguration({ version:2, origin:"https://example.com", accountToken:"test-local-session" });
    global.fetch = async (url, options) => {
      assert.equal(options.headers.authorization, "Bearer test-local-session");
      return new Response(JSON.stringify(url.endsWith("/models") ? { models:[{ id:modelId, apiFormat:"openai", available:true, enabled:true, multiplier:2 }] } : { credits:{ balance:1000 } }));
    };
    const catalog = await connector.hostedModels();
    assert.equal(catalog.models[0].id, modelId);
    assert.equal(JSON.stringify(catalog).includes("test-local-session"), false);
    const connection = connector.hostedConnection(`hosted:${modelId}`);
    assert.equal(connection.apiUrl, "https://example.com/api/v1/hosted");
    assert.equal(connection.apiModel, modelId);
    assert.equal(connector.hostedConnections().length, 1);
    connector.writeConfiguration({ version:2, origin:"https://example.com", accountToken:"different-session" });
    assert.deepEqual(connector.hostedConnections(), []);
    await assert.rejects(connector.cloudRequest("/api/v1/billing/checkout", { method:"POST", body:{} }), /Unsupported cloud account request/);
  } finally { global.fetch = originalFetch; fs.rmSync(stateDir, { recursive:true, force:true }); }
});

test("late catalog responses cannot cross a local account change", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-hosted-race-test-"));
  const originalFetch = global.fetch;
  try {
    const connector = new CloudConnector({ stateDir, executeRequest:async () => ({}), defaultOrigin:"https://example.com" });
    connector.writeConfiguration({ version:2, origin:"https://example.com", accountToken:"first-session" });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    global.fetch = async () => { await gate; return new Response(JSON.stringify({ models:[], credits:{ balance:1000 } })); };
    const catalog = connector.hostedModels();
    connector.writeConfiguration({ version:2, origin:"https://example.com", accountToken:"second-session" });
    release();
    await assert.rejects(catalog, /account changed/);
    assert.deepEqual(connector.hostedConnections(), []);
  } finally { global.fetch = originalFetch; fs.rmSync(stateDir, { recursive:true, force:true }); }
});

test("catalog cache respects account identity, expiry and explicit refresh while balances remain fresh",async()=>{
  const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-hosted-cache-')),originalFetch=global.fetch;
  try{
    const connector=new CloudConnector({stateDir,executeRequest:async()=>({}),defaultOrigin:'https://example.com'});
    connector.writeConfiguration({version:2,origin:'https://example.com',accountToken:'first-session'});
    let catalogs=0,wallets=0;
    global.fetch=async url=>new Response(JSON.stringify(url.endsWith('/models')?(catalogs++,{models:[{id:modelId,apiFormat:'openai',available:true}]}):(wallets++,{credits:{balance:wallets}})));
    await connector.hostedModels();const cached=await connector.hostedModels();
    assert.equal(catalogs,1);assert.equal(wallets,2);assert.equal(cached.credits.balance,2);
    await connector.hostedModels({refresh:true});assert.equal(catalogs,2);
    connector.hostedCatalog.fetchedAt-=300001;await connector.hostedModels();assert.equal(catalogs,3);
    connector.writeConfiguration({version:2,origin:'https://example.com',accountToken:'second-session'});
    await connector.hostedModels();assert.equal(catalogs,4);
  }finally{global.fetch=originalFetch;fs.rmSync(stateDir,{recursive:true,force:true});}
});
