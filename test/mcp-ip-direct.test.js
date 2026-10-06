"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const https = require("node:https"), http = require("node:http"), crypto = require("node:crypto");
const {EventEmitter} = require("node:events");
const {createIpDirectSettings} = require("../src/server/mcp/ip-direct-settings.js");
const {createDirectHttpService} = require("../src/server/mcp/direct-http-service.js");
const {createMcpService} = require("../src/server/mcp/service.js");
const message = (method, params) => ({jsonrpc:"2.0",id:1,method,params});
function directory(t) {
  const value = fs.mkdtempSync(path.join(os.tmpdir(),"penecho-ip-direct-"));
  t.after(()=>fs.rmSync(value,{recursive:true,force:true}));return value;
}
async function fixture(t,options={}) {
  const stateDirectory = directory(t), disposed = [];
  const service = createDirectHttpService({stateDirectory,preferredPort:0,getHostnames:()=>[],getAddresses:()=>[],announce:()=>({close(){}}),callTool:async(_owner,_name,_args,options)=>({ipDirect:options.ipDirect===true}),disposeOwner:id=>disposed.push(id),...options});
  t.after(()=>service.close());
  return {service,status:await service.start(),stateDirectory,disposed};
}
function request(status,body,{token=status.accessToken,session,headers={},host="127.0.0.1",port=new URL(status.localUrl).port,method="POST",target="/mcp"}={}) {
  return new Promise((resolve,reject)=>{
    const req=https.request({host,port,path:target,method,ca:status.certificatePem,agent:false,headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(session?{"mcp-session-id":session}:{}),...headers}},res=>{
      const certificate=req.socket.getPeerCertificate().raw;let bytes="";
      res.on("data",chunk=>bytes+=chunk);res.on("end",()=>resolve({status:res.statusCode,headers:res.headers,body:bytes?JSON.parse(bytes):null,certificate}));
    });req.on("error",reject);req.end(body?JSON.stringify(body):undefined);
  });
}
const configure=(service,action,fields={})=>service.configureIpDirect({action,revision:service.status().ipDirect.revision,...fields});

test("IP settings validate input, retain credentials across address edits, and reject stale writes",t=>{
  const dir=directory(t),settings=createIpDirectSettings(dir);
  const apply=(action,extra={})=>settings.apply({action,revision:settings.get().revision,...extra});
  for(const host of ["0.0.0.0","224.1.1.1","255.255.255.255","192.168.1.999","::1","example.test","127.0.0.1/path"])
    assert.throws(()=>apply("generate-token",{host,port:3922}),{code:"invalid_ip_address"});
  for(const port of [0,65536,1.1,"3922",null])assert.throws(()=>apply("generate-token",{host:"127.0.0.1",port}),{code:"invalid_ip_port"});
  for(const action of ["__proto__","toString","unknown",["generate-token"],null,{}])assert.throws(()=>apply(action),{code:"invalid_ip_action"});
  assert.throws(()=>apply("generate-token",{host:"127.0.0.1",port:3922,accessToken:"injected"}),{code:"invalid_ip_action"});
  assert.throws(()=>apply("rotate-token"),{code:"ip_token_required"});
  const first=apply("generate-token",{host:"192.168.1.80",port:3922});
  assert.match(first.accessToken,/^[a-f0-9]{64}$/);assert.equal(first.enabled,true);
  assert.throws(()=>settings.apply({action:"rotate-token",revision:0}),{code:"ip_settings_changed"});
  const changed=apply("save-address",{host:"192.168.1.81",port:13922});
  assert.equal(changed.accessToken,first.accessToken);assert.equal(changed.previousUrl,"https://192.168.1.80:3922/mcp");
  assert.deepEqual(createIpDirectSettings(dir).get(),changed);
  assert.equal(fs.statSync(path.join(dir,"direct-http","ip-direct.json")).mode&0o777,0o600);
  const disabled=apply("set-enabled",{enabled:false});assert.equal(disabled.accessToken,first.accessToken);
  const rotated=apply("rotate-token");assert.notEqual(rotated.accessToken,first.accessToken);assert.equal(rotated.enabled,false);
  assert.equal(rotated.previousUrl,"");
});
test("IP settings reject malformed, oversized and symlinked persisted files",t=>{
  const dir=directory(t),folder=path.join(dir,"direct-http"),file=path.join(folder,"ip-direct.json");fs.mkdirSync(folder);
  for(const bytes of ["{}","broken","x".repeat(4097)]){
    fs.writeFileSync(file,bytes);assert.throws(()=>createIpDirectSettings(dir),{code:"invalid_ip_settings"});
  }
  fs.unlinkSync(file);const external=path.join(dir,"external.json");fs.writeFileSync(external,"{}");fs.symlinkSync(external,file);
  assert.throws(()=>createIpDirectSettings(dir),{code:"invalid_ip_settings"});assert.equal(fs.readFileSync(external,"utf8"),"{}");
  fs.unlinkSync(file);fs.rmdirSync(folder);fs.symlinkSync(dir,folder);
  assert.throws(()=>createIpDirectSettings(dir),{code:"invalid_ip_settings"});
});
test("real HTTPS fixed-IP and discovery sessions have independent authentication and revocation",async t=>{
  const {service,status,disposed}=await fixture(t),port=Number(new URL(status.localUrl).port);
  let fixed=await configure(service,"generate-token",{host:"127.0.0.1",port});assert.notEqual(fixed.accessToken,status.accessToken);
  const discovery=(await request(status,message("initialize"))).headers["mcp-session-id"];
  const initialized=await request(status,message("initialize"),{token:fixed.accessToken});
  const direct=initialized.headers["mcp-session-id"];assert.match(initialized.body.result.instructions,/IP direct Streamable HTTP/);
  assert.equal(service.status().ipDirect.sessionCount,1);
  assert.equal((await request(status,message("ping"),{session:direct})).status,403);
  assert.equal((await request(status,message("ping"),{session:discovery,token:fixed.accessToken})).status,403);
  assert.equal((await request(status,message("tools/call",{name:"penecho_list_canvases"}),{session:direct,token:fixed.accessToken})).body.result.structuredContent.ipDirect,true);
  const directTools=(await request(status,message("tools/list"),{session:direct,token:fixed.accessToken})).body.result.tools;
  assert.ok(directTools.length);assert.match(directTools.find(tool=>tool.name==="penecho_upload_image").description,/direct HTTPS/);
  const discoveryTools=(await request(status,message("tools/list"),{session:discovery})).body.result.tools;
  assert.match(discoveryTools.find(tool=>tool.name==="penecho_upload_image").description,/client.js/);
  const skill=await request(status,message("resources/read",{uri:"penecho://guidance/skill"}),{session:direct,token:fixed.accessToken});
  assert.match(skill.body.result.contents[0].text,/no discovery connector is needed/);
  assert.equal((await request(status,message("initialize"),{token:"bad"})).status,401);
  assert.equal((await request(status,message("initialize"),{token:fixed.accessToken,headers:{origin:"https://attacker.test"}})).status,403);
  await configure(service,"set-enabled",{enabled:false});assert.equal(service.status().ipDirect.sessionCount,0);
  assert.equal((await request(status,message("initialize"),{token:fixed.accessToken})).status,401);
  assert.equal((await request(status,message("ping"),{session:discovery})).status,200);
  await configure(service,"set-enabled",{enabled:true});
  const next=(await request(status,message("initialize"),{token:fixed.accessToken})).headers["mcp-session-id"];
  const previousToken=fixed.accessToken;fixed=await configure(service,"rotate-token");
  assert.equal((await request(status,message("initialize"),{token:previousToken})).status,401);
  assert.equal((await request(status,message("ping"),{session:next,token:fixed.accessToken})).status,404);
  assert.equal((await request(status,message("ping"),{session:discovery})).status,200);
  assert.equal((await request(status,message("initialize"),{token:fixed.accessToken})).status,200);
  assert.equal(service.status().certificatePem,status.certificatePem);assert.equal(service.status().accessToken,status.accessToken);assert.equal(disposed.length,2);
});
test("changing IP updates the TLS SAN under the same CA and survives a fresh service instance",async t=>{
  const {service,status,stateDirectory}=await fixture(t),port=Number(new URL(status.localUrl).port);
  const first=await configure(service,"generate-token",{host:"192.168.50.80",port});
  const discovery=(await request(status,message("initialize"))).headers["mcp-session-id"];
  const fixedSession=(await request(status,message("initialize"),{token:first.accessToken,headers:{host:`192.168.50.80:${port}`}})).headers["mcp-session-id"];
  const next=await configure(service,"save-address",{host:"203.0.113.42",port:8443});
  assert.equal(next.accessToken,first.accessToken);assert.equal(next.url,"https://203.0.113.42:8443/mcp");
  const reply=await request(status,message("initialize"),{token:next.accessToken,headers:{host:"203.0.113.42:8443"}});
  assert.equal(reply.status,200);const leaf=new crypto.X509Certificate(reply.certificate);
  assert.equal(leaf.checkIP("203.0.113.42"),"203.0.113.42");assert.equal(leaf.verify(new crypto.X509Certificate(status.certificatePem).publicKey),true);
  assert.equal((await request(status,message("initialize"),{token:next.accessToken,headers:{host:`192.168.50.80:${port}`}})).status,403);
  assert.equal((await request(status,message("ping"),{session:fixedSession,token:next.accessToken})).status,404);
  assert.equal((await request(status,message("ping"),{session:discovery})).status,200);
  await service.close();
  const restarted=createDirectHttpService({stateDirectory,preferredPort:0,getHostnames:()=>[],getAddresses:()=>[],announce:()=>({close(){}}),callTool:async()=>({}),disposeOwner(){}});t.after(()=>restarted.close());
  const persisted=await restarted.start();assert.equal(persisted.ipDirect.accessToken,first.accessToken);assert.equal(persisted.ipDirect.url,next.url);
  assert.equal(persisted.certificatePem,status.certificatePem);assert.equal(persisted.accessToken,status.accessToken);
  assert.equal((await request(persisted,message("initialize"),{token:first.accessToken,headers:{host:"203.0.113.42:8443"}})).status,200);
});
test("public-source requests require the fixed-IP token and configured Host; remote status exposes no credentials",async t=>{
  const original=https.createServer;let handler;
  https.createServer=(options,callback)=>{handler=callback;return original(options,callback);};
  let data;try{data=await fixture(t);}finally{https.createServer=original;}
  const {service,status}=data,port=Number(new URL(status.localUrl).port);
  const fixed=await configure(service,"generate-token",{host:"203.0.113.42",port:8443});
  async function probe(token,host) {
    const req={socket:{remoteAddress:"198.51.100.4"},rawHeaders:[],headers:{authorization:`Bearer ${token}`,host},url:"/status",method:"GET"};
    let result;const res={writeHead(status){result={status};},end(text){result.body=text?JSON.parse(text):null;}};
    await handler(req,res);return result;
  }
  assert.equal((await probe(status.accessToken,`127.0.0.1:${port}`)).status,403);
  assert.equal((await probe("wrong","203.0.113.42:8443")).status,403);
  assert.equal((await probe(fixed.accessToken,"attacker.test:8443")).status,403);
  const allowed=await probe(fixed.accessToken,"203.0.113.42:8443");assert.equal(allowed.status,200);
  assert.equal(JSON.stringify(allowed).includes(fixed.accessToken),false);assert.equal(allowed.body.ipDirect,undefined);
});
test("revoking fixed-IP authentication cancels its pending tool and redacts its token from errors",async t=>{
  let pending,secret;
  const {service,status}=await fixture(t,{callTool:async(_owner,name,_args,{signal})=>{
    if(name==="penecho_list_canvases")throw Object.assign(Error(`failed ${secret}`),{details:{text:secret}});
    return new Promise(resolve=>{pending={resolve,signal};});
  }});
  const fixed=await configure(service,"generate-token",{host:"127.0.0.1",port:Number(new URL(status.localUrl).port)});secret=fixed.accessToken;
  const session=(await request(status,message("initialize"),{token:secret})).headers["mcp-session-id"];
  const failed=await request(status,message("tools/call",{name:"penecho_list_canvases"}),{session,token:secret});
  assert.equal(JSON.stringify(failed).includes(secret),false);assert.match(failed.body.result.structuredContent.message,/redacted/);
  const ongoing=request(status,message("tools/call",{name:"test"}),{session,token:secret});
  while(!pending)await new Promise(resolve=>setTimeout(resolve,5));
  await configure(service,"set-enabled",{enabled:false});assert.equal(pending.signal.aborted,true);
  assert.equal((await ongoing).body.error.code,-32800);pending.resolve({done:true});
});
test("IP direct settings API requires a host browser authorization, strict actions and matching revision",async t=>{
  const dir=directory(t);let service;
  const server=http.createServer(async(req,res)=>{if(!await service.handleHttp(req,res)){res.writeHead(404);res.end();}});
  service=createMcpService({server,stateDirectory:dir,registryStateDirectory:dir,rootDirectory:path.resolve(__dirname,".."),autoStartHttp:false,
    authorizeBrowser:async req=>req.headers["x-test-browser"]==="allowed"?null:{code:"forbidden"},lanAddresses:()=>[],directAnnounce:()=>({close(){}})});
  t.after(async()=>{await service.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));service.register(server.address());await service.startDirect();
  const endpoint=`http://127.0.0.1:${server.address().port}/api/mcp/ip-direct`;
  const api=async(body,headers={"x-test-browser":"allowed"},method="POST")=>{
    const response=await fetch(endpoint,{method,headers:{"content-type":"application/json",...headers},...(method==="POST"?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};
  };
  const payload={action:"generate-token",revision:0,host:"127.0.0.1",port:service.status().http.ipDirect.listenerPort};
  assert.equal((await api(payload,{})).status,403);
  assert.equal((await api(undefined,undefined,"PUT")).status,405);
  assert.equal((await api({...payload,host:"bad"})).body.error.code,"invalid_ip_address");
  const first=await api(payload);assert.equal(first.status,200);assert.ok(first.body.http.ipDirect.accessToken);
  assert.equal((await api(payload)).status,409);
  assert.equal((await api(undefined,undefined,"GET")).body.http.ipDirect.accessToken,first.body.http.ipDirect.accessToken);
  assert.equal(service.status(false).http,undefined);
  const req=new EventEmitter();Object.assign(req,{socket:{remoteAddress:"192.168.50.8"},headers:{"x-test-browser":"allowed"},method:"POST",url:"/api/mcp/ip-direct"});
  let denied;const res={writeHead(status){denied=status;},end(){}};
  await service.handleHttp(req,res);assert.equal(denied,403);
});
test("Cloud runtime cannot configure or retrieve host IP direct credentials",async t=>{
  const server=new EventEmitter(),service=createMcpService({server,cloudRuntime:true,rootDirectory:directory(t),authorizeBrowser:()=>null});
  t.after(()=>service.close());
  for(const method of ["GET","POST"]){
    const req={socket:{remoteAddress:"127.0.0.1"},headers:{},method,url:"/api/mcp/ip-direct"};
    let status,body;const res={writeHead(value){status=value;},end(bytes){body=JSON.parse(bytes);}};
    await service.handleHttp(req,res);assert.equal(status,403);assert.equal(body.error.code,"local_host_required");assert.equal(body.http,undefined);
  }
});
