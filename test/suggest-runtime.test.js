"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {checkSuggestRuntime} = require("../scripts/check-suggest-runtime.cjs");

function fixture(status, cloudOrigin = "https://internaltest.penecho.ai") {
  const requests = [];
  return {requests,fetch:async (url,options) => {
    requests.push({url,options});
    assert.equal(options.redirect,"error");
    const path = new URL(url).pathname;
    if (path === "/api/local-access/status") return Response.json({accessSessionToken:"private-local-token"});
    assert.equal(options.headers["x-penecho-session"],"private-local-token");
    return Response.json(path === "/api/cloud/status" ? {origin:cloudOrigin,accountSession:{signedIn:true}} : status);
  }};
}

test("the runtime check detects a stale backend even when current source tests pass", async () => {
  const f = fixture({configured:true,model:"penecho/jevision"});
  await assert.rejects(checkSuggestRuntime("http://192.168.3.158:3921",f.fetch),/old Suggest protocol.*Restart/);
  assert.equal(f.requests.length,3);
});

test("the runtime check accepts the current LAN gateway without inference or token disclosure", async () => {
  const f = fixture({configured:true,model:"PenEchoLLM",access:{remaining:500}});
  const result = await checkSuggestRuntime("http://192.168.3.158:3921",f.fetch);
  assert.equal(result.signedIn,true);
  assert.equal(result.model,"PenEchoLLM");
  assert.doesNotMatch(JSON.stringify(result),/private-local-token/);
  assert.ok(f.requests.every(request => !request.options.method && !request.options.body));
});

test("the runtime check distinguishes missing allowance, disabled pool and wrong deployment target", async () => {
  for (const [status,message] of [
    [{configured:true,model:"PenEchoLLM"},/missing the allowance/],
    [{configured:false,model:"PenEchoLLM",access:{}},/pool is unavailable/],
    [{configured:true,model:"PenEchoLLM",access:{},guestToken:"private-trial"},/must not expose/],
  ]) await assert.rejects(checkSuggestRuntime("http://127.0.0.1:3921",fixture(status).fetch),message);
  const f = fixture({},"https://penecho.ai");
  await assert.rejects(checkSuggestRuntime("http://127.0.0.1:3921",f.fetch),/restricted to the UAT/);
  assert.equal(f.requests.length,2);
});
