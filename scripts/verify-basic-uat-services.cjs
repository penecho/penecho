"use strict";
// Explicit live check of the user's local 3921 gateway; only synthetic test input is submitted.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
async function main(){
  const origin=process.argv[2]||"http://localhost:3921",output=process.argv[3]||path.join(__dirname,"../docs/verification/basic-uat-regression-20260930/live-services.json");
  assert.equal(new URL(origin).port,"3921");assert.ok(["localhost","127.0.0.1"].includes(new URL(origin).hostname));
  const raw=await(await fetch(origin+"/api/config.js")).text(),config=JSON.parse(raw.slice(raw.indexOf("=")+1).replace(/;\s*$/,"")),
    headers={origin,"x-penecho-session":config.accessSessionToken,"content-type":"application/json"};
  const get=async route=>{const response=await fetch(origin+route,{headers,signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,route);return response.json();};
  const cloud=await get("/api/cloud/status");assert.equal(cloud.origin,"https://internaltest.penecho.ai");assert.equal(cloud.connected,true);
  const signedIn=Boolean(cloud.accountSession?.signedIn||cloud.accountSession?.account);assert.equal(signedIn,true,"The local gateway must have a signed-in UAT account.");
  const status=await get("/api/suggest/status");assert.equal(status.configured,true);assert.equal(status.model,"PenEchoLLM");
  const connections=await get("/api/settings/connections"),image=/const SAMPLE_IMAGE = "([^"]+)"/.exec(fs.readFileSync(path.join(__dirname,"jevision-probe.js"),"utf8"))[1],results=[];
  for(let n=0;n<2;n++){
    const started=Date.now(),response=await fetch(origin+"/api/suggest",{method:"POST",headers,body:JSON.stringify({version:1,mode:"ink",image,context:{shapesFit:false}}),signal:AbortSignal.timeout(15000)}),body=await response.json();
    assert.equal(response.status,200,body.error||"Suggest HTTP response");assert.equal(body.ok,true);assert.equal(body.model,"PenEchoLLM");assert.equal(body.guestToken,undefined);
    results.push({status:response.status,elapsedMs:Date.now()-started,model:body.model,cached:body.cached,kind:body.answers?.kind?.choice,action:body.answers?.action?.choice,requestId:body.requestId||null});
  }
  assert.equal(results[1].cached,true);
  const report={testedAt:new Date().toISOString(),origin,cloudOrigin:cloud.origin,cloudConnected:cloud.connected,signedIn,configured:true,model:status.model,connectionCount:connections.connections.length,results};
  fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
