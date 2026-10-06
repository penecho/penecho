"use strict";
// Read-only verification of published UAT / production resources. Never log credentials.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto"),{parseEnv}=require("node:util"),{execFileSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),cloud=path.resolve(root,"../penecho_cloud"),uat=process.argv.includes("--uat"),
  origin=uat?"https://internaltest.penecho.ai":"https://penecho.ai",
  output=path.resolve(process.env.PENECHO_VERIFY_OUTPUT||path.join(root,"docs/verification/canvas-command-release-20261006",uat?"uat":"production")),
  resources=path.join(output,"resources"),digest=value=>crypto.createHash("sha256").update(value).digest("hex");
const releaseCommit=process.env.PENECHO_VERIFY_CLOUD_COMMIT||null;
if(releaseCommit)assert.match(releaseCommit,/^[a-f0-9]{40}$/);
const readRelease=relative=>releaseCommit
  ? execFileSync("git",["show",releaseCommit+":"+relative],{cwd:cloud,maxBuffer:32*1024*1024})
  : fs.readFileSync(path.join(cloud,relative));
fs.mkdirSync(resources,{recursive:true});
const report={origin,checkedAt:new Date().toISOString(),cloudCommit:releaseCommit,sourceCommit:JSON.parse(readRelease("public/canvas/UPSTREAM.json")).commit,checks:[],passed:false};
const headers={"cache-control":"no-cache"};
if(uat){const env=parseEnv(fs.readFileSync(path.join(cloud,".env.uat"),"utf8"));assert.ok(env.UAT_GATE_USER&&env.UAT_GATE_PASSWORD);headers.authorization="Basic "+Buffer.from(env.UAT_GATE_USER+":"+env.UAT_GATE_PASSWORD).toString("base64");}
async function get(url){const response=await fetch(url,{headers,redirect:"error",signal:AbortSignal.timeout(60000)});assert.equal(response.status,200,new URL(url).pathname);return Buffer.from(await response.arrayBuffer());}
(async()=>{try{
  for(const pathname of ["/healthz","/readyz"]){await get(origin+pathname);report.checks.push({path:pathname,status:200});}
  for(const file of ["app.js","remote-canvas.js","locales/zh.js","smart-suggest.js","summon.js","style.css","UPSTREAM.json"]){
    const expected=readRelease("public/canvas/"+file),bytes=await get(origin+"/canvas/"+file+"?v="+digest(expected).slice(0,12));
    assert.equal(digest(bytes),digest(expected),file+" must match the official canonical mirror");fs.mkdirSync(path.dirname(path.join(resources,file)),{recursive:true});fs.writeFileSync(path.join(resources,file),bytes);report.checks.push({file,sha256:digest(bytes),matchesCanonical:true});
  }
  if(uat){
    const relative="src/canvas-agent-runtime/upstream/src/server/canvas-command-prompt.js",expected=digest(readRelease(relative));
    const probe='import fs from "node:fs";import crypto from "node:crypto";import {loadConfig} from "./src/config.mjs";const c=loadConfig();if(c.production||c.appOrigin!=="https://internaltest.penecho.ai")throw Error("UAT fence");console.log(JSON.stringify({sha256:crypto.createHash("sha256").update(fs.readFileSync('+JSON.stringify(relative)+')).digest("hex")}));';
    const installed=JSON.parse(execFileSync("docker",["exec","penecho-uat-local-app-1","node","--input-type=module","-e",probe],{encoding:"utf8",timeout:15000}));
    assert.equal(installed.sha256,expected);report.checks.push({installedBackend:true,sha256:installed.sha256,matchesCanonical:true});
    const tests=readRelease("test/canvas-command-source-parity.test.mjs").toString("utf8").replaceAll('"../src/','"./src/');
    const result=execFileSync("docker",["exec","-i","penecho-uat-local-app-1","node","--input-type=module","-"],{input:tests,encoding:"utf8",timeout:30000});
    fs.writeFileSync(path.join(output,"installed-backend-parity.tap"),result);assert.match(result,/# fail 0/);report.checks.push({installedBackendParity:true});
  }
  report.passed=true;
}finally{fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2)+"\n");}
console.log(JSON.stringify({origin,output,passed:report.passed,checks:report.checks.length}));})().catch(error=>{console.error(error.message);process.exitCode=1;});
