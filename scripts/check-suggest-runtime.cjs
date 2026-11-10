"use strict";
// Read-only check of the running process, not merely the source on disk.
const assert = require("node:assert/strict");

async function checkSuggestRuntime(origin, fetcher = fetch) {
  const url = new URL(origin);
  assert.ok(["http:","https:"].includes(url.protocol) && !url.username && !url.password);
  origin = url.origin;
  const get = async (path, headers) => {
    const response = await fetcher(origin + path, {headers:{origin,...headers},signal:AbortSignal.timeout(15000),redirect:"error"});
    assert.equal(response.status,200,`${path} returned HTTP ${response.status}`);
    return response.json();
  };
  const session = await get("/api/local-access/status");
  assert.ok(session.accessSessionToken,"Unlock the local Canvas before checking its Suggest runtime.");
  const headers = {"x-penecho-session":session.accessSessionToken};
  const cloud = await get("/api/cloud/status",headers);
  assert.equal(cloud.origin,"https://internaltest.penecho.ai","This check is restricted to the UAT Cloud target.");
  const status = await get("/api/suggest/status",headers);
  assert.equal(status.model,"PenEchoLLM","The running Canvas has an old Suggest protocol. Restart its local server and refresh the page.");
  assert.ok(status.access && typeof status.access === "object","The running Suggest gateway is missing the allowance contract.");
  assert.equal(status.configured,true,"The UAT application pool is unavailable.");
  assert.equal(status.guestToken,undefined,"The local gateway must not expose its guest capability.");
  return {origin,cloudOrigin:cloud.origin,model:status.model,configured:true,signedIn:cloud.accountSession?.signedIn === true};
}

module.exports = {checkSuggestRuntime};
if (require.main === module) {
  checkSuggestRuntime(process.argv[2] || "http://127.0.0.1:3921").then(result => console.log(JSON.stringify(result,null,2))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
