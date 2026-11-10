'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const {createDirectHttpService} = require('../src/server/mcp/direct-http-service.js');
function request(status, body, options = {}) {
  return new Promise((resolve,reject) => {
    const req = https.request(status.localUrl.replace('/mcp',options.path || '/mcp'), {method:options.method || 'POST',ca:status.certificatePem,agent:false,servername:options.servername,headers:{authorization:`Bearer ${status.accessToken}`,'content-type':'application/json',...(options.session ? {'mcp-session-id':options.session} : {}),...options.headers}}, res => {
      let data = ''; res.on('data',c => data += c); res.on('end',() => resolve({status:res.statusCode,headers:res.headers,body:data ? JSON.parse(data) : null,certificate:req.socket.getPeerCertificate().raw}));
    }); req.on('error',reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const message = (method,id = 1,params) => ({jsonrpc:'2.0',method,id,params});
async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'penecho-direct-test-'));
  const disposed = []; const service = createDirectHttpService({preferredPort:0,getHostnames:()=>[],stateDirectory:directory,getAddresses:() => [],announce:() => ({close(){}}),callTool:async ownerId => ({ownerId}),disposeOwner:id => disposed.push(id),...options});
  t.after(async () => { await service.close(); fs.rmSync(directory,{recursive:true,force:true}); });
  return {service,status:await service.start(),directory,disposed};
}
test('trusted HTTPS, auth, host, discovery, independent sessions and restart identity',async t => {
  const {service,status,directory,disposed} = await fixture(t);
  assert.equal((await request(status,message('initialize'),{headers:{authorization:''}})).status,401);
  assert.equal((await request(status,message('initialize'),{servername:'localhost',headers:{host:'attacker.test'}})).status,403);
  assert.equal((await request(status,message('initialize'),{headers:{origin:'https://attacker.test'}})).status,403);
  const first = await request(status,message('initialize')); const second = await request(status,message('initialize'));
  for(const pem of [status.certificatePem,first.certificate])assert.equal(Date.parse(new crypto.X509Certificate(pem).validTo),Date.parse('9999-12-31T23:59:59Z'));
  assert.equal(first.body.result.protocolVersion,'2025-11-25');
  const a = first.headers['mcp-session-id'], b = second.headers['mcp-session-id']; assert.notEqual(a,b);
  assert.ok((await request(status,message('tools/list'),{session:a})).body.result.tools.length);
  const calls = await Promise.all([a,b].map(session => request(status,message('tools/call',77,{name:'penecho_list_canvases'}),{session})));
  assert.notEqual(calls[0].body.result.structuredContent.ownerId,calls[1].body.result.structuredContent.ownerId);
  assert.equal((await request(status,message('ping'))).status,400);
  assert.equal((await request(status,undefined,{method:'GET'})).status,405);
  const summary = await request(status,undefined,{method:'GET',path:'/status'}); assert.equal(summary.body.hostId,status.hostId); assert.equal(summary.body.accessToken,undefined);
  assert.equal((await request(status,undefined,{session:a,method:'DELETE'})).status,200);
  assert.equal((await request(status,message('ping'),{session:a})).status,404); assert.equal(disposed.length,1);
  const stored = path.join(directory,'direct-http','identity.json'); assert.equal(fs.statSync(stored).isFile(),true);
  await service.close(); const next = await service.start(); assert.equal(next.accessToken,status.accessToken); assert.equal(next.hostId,status.hostId);
  const restarted = await request(next,message('initialize')); assert.notDeepEqual(first.certificate,restarted.certificate);
});
test('POSIX identity file is private to its owner',{skip:process.platform==='win32'?'Windows uses inherited DACLs rather than POSIX permission bits':false},async t=>{
  const {directory}=await fixture(t);
  assert.equal(fs.statSync(path.join(directory,'direct-http','identity.json')).mode & 0o777,0o600);
});
test('upgrading retains an existing finite-lived CA and token without silently resetting trust',async t => {
  const vm = require('node:vm');
  const modulePath = require.resolve('../src/server/mcp/direct-http-identity.js');
  const legacy = {exports:{}};
  vm.runInNewContext(fs.readFileSync(modulePath,'utf8').replace("Date.parse('9999-12-31T23:59:59Z')", "Date.now() + 3650 * 86400000"), {require,module:legacy,Buffer,process});
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'penecho-existing-ca-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  const existing = legacy.exports.loadDirectHttpIdentity(directory);
  const file = path.join(directory,'direct-http','identity.json'), before = fs.readFileSync(file);
  const current = require(modulePath).loadDirectHttpIdentity(directory);
  assert.equal(current.hostId,existing.hostId); assert.equal(current.accessToken,existing.accessToken);
  assert.equal(current.certificatePem,existing.certificatePem); assert.deepEqual(fs.readFileSync(file),before);
});
test('IP refresh leaf retains CA trust and session expiry disposes owner',async t => {
  let addresses = [], clock = 100;
  const {service,status,disposed} = await fixture(t,{getAddresses:() => addresses,now:() => clock,sessionIdleMs:10});
  const initial = await request(status,message('initialize')); const session = initial.headers['mcp-session-id'];
  addresses = ['192.168.42.8']; service.status();
  const refreshed = await request(status,message('ping'),{session});
  const cert = new crypto.X509Certificate(refreshed.certificate); assert.equal(cert.checkIP('192.168.42.8'),'192.168.42.8'); assert.equal(cert.verify(new crypto.X509Certificate(status.certificatePem).publicKey),true);
  clock = 111; assert.equal((await request(status,message('ping'),{session})).status,404); assert.equal(disposed.length,1);
});
test('cancellation is session-scoped; capacity remains protected until work settles',async t => {
  const pending = []; let clock = 0;
  const {status,service} = await fixture(t,{now:() => clock,sessionIdleMs:10,maxSessionRequests:1,maxRequests:2,callTool:(ownerId,name,args,{signal}) => new Promise(resolve => pending.push({ownerId,signal,resolve}))});
  const a = (await request(status,message('initialize'))).headers['mcp-session-id'];
  const b = (await request(status,message('initialize'))).headers['mcp-session-id'];
  const one = request(status,message('tools/call',7,{name:'test'}),{session:a});
  const two = request(status,message('tools/call',7,{name:'test'}),{session:b});
  while(pending.length < 2) await new Promise(resolve => setTimeout(resolve,5));
  clock = 100; assert.equal(service.status().sessionCount,2);
  assert.equal((await request(status,message('ping',8),{session:a})).status,429);
  assert.equal((await request(status,{jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:7}},{session:a})).status,202);
  assert.equal((await one).body.error.code,-32800);
  assert.equal(pending.filter(p => p.signal.aborted).length,1);
  assert.equal((await request(status,message('ping',8),{session:a})).status,429);
  pending.forEach(p => p.resolve({done:true})); assert.equal((await two).body.result.structuredContent.done,true);
});
test('session bound and invalid stored identity fail closed',async t => {
  const {service,status,directory} = await fixture(t,{maxSessions:1});
  assert.equal((await request(status,message('initialize'))).status,200);
  assert.equal((await request(status,message('initialize'))).status,429);
  await service.close();
  const file = path.join(directory,'direct-http','identity.json'); const value = JSON.parse(fs.readFileSync(file)); value.key = crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'pem',type:'pkcs8'}); fs.writeFileSync(file,JSON.stringify(value));
  await assert.rejects(service.start(),/identity is invalid/); assert.equal(service.status().enabled,false);
});
test('HTTP disconnect does not cancel a tool; service shutdown cancels it',async t => {
  let operation;
  const {service,status} = await fixture(t,{callTool:(owner,name,args,{signal}) => new Promise(resolve => { operation = {signal,resolve}; })});
  const session = (await request(status,message('initialize'))).headers['mcp-session-id'];
  const req = https.request(status.localUrl,{method:'POST',ca:status.certificatePem,agent:false,headers:{authorization:`Bearer ${status.accessToken}`,'content-type':'application/json','mcp-session-id':session}});
  req.on('error',() => {}); req.end(JSON.stringify(message('tools/call',1,{name:'test'})));
  while (!operation) await new Promise(resolve => setTimeout(resolve,5));
  req.destroy(); await new Promise(resolve => setTimeout(resolve,10)); assert.equal(operation.signal.aborted,false);
  await service.close(); assert.equal(operation.signal.aborted,true); operation.resolve({done:true});
});
test('concurrent processes atomically publish one shared identity',async t => {
  const {execFile} = require('node:child_process'); const {promisify} = require('node:util');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'penecho-direct-race-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  const modulePath = path.resolve(__dirname,'../src/server/mcp/direct-http-identity.js');
  const script = `const x=require(process.argv[1]).loadDirectHttpIdentity(process.argv[2]); process.stdout.write(JSON.stringify({hostId:x.hostId,token:x.accessToken}));`;
  const values = await Promise.all(Array.from({length:4},() => promisify(execFile)(process.execPath,['-e',script,modulePath,directory])));
  assert.equal(new Set(values.map(v => v.stdout)).size,1);
  assert.deepEqual(fs.readdirSync(path.join(directory,'direct-http')),['identity.json']);
});
test('identity rejects symlinks and oversized files without changing external modes',async t => {
  const {loadDirectHttpIdentity} = require('../src/server/mcp/direct-http-identity.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'penecho-direct-files-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  const external = path.join(directory,'external'); fs.mkdirSync(external,{mode:0o755});
  const externalMode=fs.statSync(external).mode;
  const state = path.join(directory,'state'); fs.mkdirSync(state);
  fs.symlinkSync(external,path.join(state,'direct-http'));
  assert.throws(() => loadDirectHttpIdentity(state),/invalid/); assert.equal(fs.statSync(external).mode,externalMode);
  fs.unlinkSync(path.join(state,'direct-http')); fs.mkdirSync(path.join(state,'direct-http'));
  const outside = path.join(external,'outside.json'); fs.writeFileSync(outside,'{}',{mode:0o644});
  const outsideMode=fs.statSync(outside).mode;
  const file = path.join(state,'direct-http','identity.json'); fs.symlinkSync(outside,file);
  assert.throws(() => loadDirectHttpIdentity(state),/invalid/); assert.equal(fs.statSync(outside).mode,outsideMode);
  fs.unlinkSync(file); fs.writeFileSync(file,'x'.repeat(65537)); assert.throws(() => loadDirectHttpIdentity(state),/invalid/);
});
test('leaf does not rotate on a monthly timer and unsupported protocol does not dispatch',async t => {
  let clock = 0, calls = 0;
  const {service,status} = await fixture(t,{now:() => clock,callTool:async () => { calls++; return {}; }});
  const first = await request(status,message('initialize')); const session = first.headers['mcp-session-id'];
  assert.equal((await request(status,message('tools/call',2,{name:'test'}),{session,headers:{'mcp-protocol-version':'2026-07-28'}})).status,400); assert.equal(calls,0);
  assert.equal((await request(status,message('ping'),{session,headers:{'mcp-protocol-version':'2025-11-25'}})).status,200);
  clock = 29 * 86400000; service.status();
  const current = await request(status,message('initialize')); assert.deepEqual(current.certificate,first.certificate); assert.equal(service.status().hostId,status.hostId);
});
test('tool recovery details remain available, bounded and redact credentials',async t => {
  let detail;
  const {status} = await fixture(t,{callTool:async () => { throw Object.assign(new Error('Recover connection'),{code:'BROWSER_DISCONNECTED',details:detail}); }});
  const session = (await request(status,message('initialize'))).headers['mcp-session-id'];
  detail = {recoverable:true,instanceId:'instance-a',nested:{accessToken:status.accessToken,text:`secret ${status.accessToken}`},long:'x'.repeat(100000)};
  const response = await request(status,message('tools/call',3,{name:'test'}),{session});
  const failure = response.body.result.structuredContent;
  assert.equal(failure.details.recoverable,true); assert.equal(failure.details.instanceId,'instance-a'); assert.equal(failure.details.nested.accessToken,'[redacted]');
  assert.equal(JSON.stringify(failure).includes(status.accessToken),false); assert.ok(Buffer.byteLength(JSON.stringify(failure.details)) <= 16384);
});
test('explicit reset replaces CA and token, disposes sessions and survives restart',async t => {
  const {service,status,directory,disposed} = await fixture(t);
  const oldLan = path.join(directory,'lan-identity.json'); fs.writeFileSync(oldLan,'legacy identity stays');
  const session = (await request(status,message('initialize'))).headers['mcp-session-id'];
  const next = await service.reset(); assert.equal(next.enabled,true);
  assert.notEqual(next.hostId,status.hostId); assert.notEqual(next.accessToken,status.accessToken); assert.equal(next.sessionCount,0); assert.equal(disposed.length,1);
  assert.equal((await request(next,message('initialize'),{headers:{authorization:`Bearer ${status.accessToken}`}})).status,401);
  assert.equal((await request(next,message('ping'),{session})).status,404);
  assert.equal((await request(next,message('initialize'))).status,200);
  await assert.rejects(request({...next,certificatePem:status.certificatePem},message('initialize')));
  await service.close(); const restarted = await service.start(); assert.equal(restarted.hostId,next.hostId); assert.equal(restarted.accessToken,next.accessToken);
  assert.equal(fs.readFileSync(oldLan,'utf8'),'legacy identity stays');
  await service.close(); const file = path.join(directory,'direct-http','identity.json'); fs.writeFileSync(file,'broken');
  await assert.rejects(service.start(),/invalid/); const repaired = await service.reset(); assert.equal(repaired.enabled,true); assert.notEqual(repaired.hostId,next.hostId);
});
test('capacity pressure evicts only sufficiently idle sessions; active work and fresh sessions survive',async t=>{
  let clock=0, operation;
  const {service,status,disposed}=await fixture(t,{now:()=>clock,maxSessions:2,callTool:()=>new Promise(resolve=>{operation=resolve;})});
  const a=(await request(status,message('initialize'))).headers['mcp-session-id'];
  const b=(await request(status,message('initialize'))).headers['mcp-session-id'];
  clock=30000;assert.equal((await request(status,message('initialize'))).status,429);
  clock=61000;await request(status,message('ping'),{session:b});
  const c=(await request(status,message('initialize'))).headers['mcp-session-id'];
  assert.equal((await request(status,message('ping'),{session:a})).status,404);assert.equal(disposed.length,1);
  const ongoing=request(status,message('tools/call',9,{name:'test'}),{session:b});while(!operation)await new Promise(resolve=>setTimeout(resolve,5));
  clock=122000;assert.equal((await request(status,message('initialize'))).status,200);
  assert.equal((await request(status,message('ping'),{session:c})).status,404);assert.equal(service.status().sessionCount,2);
  assert.equal((await request(status,message('initialize'))).status,429);
  operation({done:true});assert.equal((await ongoing).body.result.structuredContent.done,true);
  assert.equal((await request(status,undefined,{method:'DELETE',session:b})).status,200);assert.equal(service.status().sessionCount,1);
});
test('TCP capacity is independent of protocol sessions and status reports bounded timeouts',async t=>{
  const tls=require('node:tls');const {status}=await fixture(t);
  const sockets=[];t.after(()=>sockets.forEach(socket=>socket.destroy()));
  const summary=await request(status,undefined,{method:'GET',path:'/status'});
  assert.deepEqual(summary.body.limits,{sessions:256,requestsPerSession:8,requests:32,tcpConnections:512});
  assert.deepEqual(summary.body.timeouts,{sessionIdleMs:1800000,pressureIdleMs:60000,keepAliveMs:30000,headersMs:10000,requestUploadMs:15000});
  const port=Number(new URL(status.localUrl).port);
  await Promise.all(Array.from({length:65},()=>new Promise((resolve,reject)=>{
    const socket=tls.connect({host:'127.0.0.1',port,ca:status.certificatePem},resolve);sockets.push(socket);socket.on('error',reject);
  })));
  assert.equal((await request(status,message('initialize'))).status,200);
});
test('preferred port is reused across restarts with machine hostname TLS and Host allowlist',async t=>{
 const net=require('node:net'),reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'0.0.0.0',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const {service,status}=await fixture(t,{preferredPort:port,getHostnames:()=>['mcp-test-box','mcp-test-box.local']});assert.equal(new URL(status.localUrl).port,String(port));assert.equal(status.preferredUrl,`https://mcp-test-box:${port}/mcp`);
 const response=await request(status,message('initialize'),{servername:'mcp-test-box.local',headers:{host:`mcp-test-box.local:${port}`}});assert.equal(response.status,200);const cert=new crypto.X509Certificate(response.certificate);assert.equal(cert.checkHost('mcp-test-box.local'),'mcp-test-box.local');assert.equal(cert.checkHost('mcp-test-box'),'mcp-test-box');
 assert.equal((await request(status,message('initialize'),{servername:'localhost',headers:{host:`not-this-box:${port}`}})).status,403);
 await service.close();const restarted=await service.start();assert.equal(new URL(restarted.localUrl).port,String(port));assert.equal(restarted.hostId,status.hostId);
});
test('occupied preferred port falls back to an available listener',async t=>{
 const net=require('node:net'),occupied=net.createServer();await new Promise(resolve=>occupied.listen(0,'0.0.0.0',resolve));t.after(()=>new Promise(resolve=>occupied.close(resolve)));const port=occupied.address().port;
 const {status}=await fixture(t,{preferredPort:port,getHostnames:()=>['mcp-test-box']});assert.notEqual(new URL(status.localUrl).port,String(port));assert.equal(new URL(status.preferredUrl).port,new URL(status.localUrl).port);assert.equal((await request(status,message('initialize'))).status,200);assert.equal(occupied.listening,true);
});
function upload(status,bytes,options={}) {
 return new Promise((resolve,reject)=>{
  const req=https.request(status.localUrl.replace('/mcp',options.path||'/mcp/images?canvasId=c&documentId=d&requestId=r&name=photo.png'),{method:options.method||'POST',ca:status.certificatePem,servername:'localhost',agent:false,headers:{authorization:`Bearer ${status.accessToken}`,'content-type':'application/octet-stream',...options.headers}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));});req.on('error',reject);req.end(bytes);
 });
}
test('raw images authenticate without MCP sessions, validate exact targets and preserve retry fingerprints',async t=>{
 const calls=[];const {status}=await fixture(t,{uploadImage:async(args,{signal})=>{calls.push({args,signal});return {assetId:'asset-1'};}});
 const bytes=await require('sharp')({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer();
 for(const headers of [{authorization:''},{host:'evil.test'},{origin:'https://evil.test'}])assert.ok([401,403].includes((await upload(status,bytes,{headers})).status));
 for(const path of ['/mcp/images?canvasId=c&documentId=d&requestId=r','/mcp/images?canvasId=c&documentId=d&requestId=r&name=x&canvasId=z','/mcp/images?canvasId=c&documentId=d&requestId=r&name=x&extra=x'])assert.equal((await upload(status,bytes,{path})).status,400);
 assert.equal((await upload(status,bytes,{headers:{'content-type':'image/png'}})).status,415);
 assert.equal((await upload(status,bytes,{headers:{'content-length':String(32*1024*1024+1)}})).status,413);
 assert.equal((await upload(status,Buffer.from('<svg/>'))).status,415);assert.equal(calls.length,0);
 assert.deepEqual((await upload(status,bytes)).body,{assetId:'asset-1'});assert.equal((await upload(status,bytes)).status,200);
 assert.equal(calls[0].args.inputSha256,calls[1].args.inputSha256);assert.equal(calls[0].args.documentId,'d');assert.equal(calls[0].args.source,`data:image/png;base64,${bytes.toString('base64')}`);
});
test('raw image slots bound global concurrency and redact callback errors',async t=>{
 const pending=[];const {status}=await fixture(t,{maxRequests:2,uploadImage:(args,{signal})=>new Promise(resolve=>pending.push({resolve,signal}))});
 const bytes=await require('sharp')({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer();
 const one=upload(status,bytes),two=upload(status,bytes);while(pending.length<2)await new Promise(r=>setTimeout(r,5));
 assert.equal((await upload(status,bytes)).status,429);assert.equal((await request(status,message('initialize'))).status,429);
 pending.forEach(p=>p.resolve({ok:true}));await Promise.all([one,two]);
 const other=await fixture(t,{uploadImage:async()=>{throw Object.assign(new Error('bad '+other.status.accessToken),{code:'conflict',status:409});}});
 const result=await upload(other.status,bytes);assert.equal(result.status,409);assert.equal(result.body.error.code,'conflict');assert.equal(JSON.stringify(result).includes(other.status.accessToken),false);
});
test('raw upload timeout aborts callback and retains occupied capacity until it settles',async t=>{
 let pending;const {status}=await fixture(t,{maxRequests:1,uploadTimeoutMs:100,uploadImage:(args,{signal})=>new Promise(resolve=>{pending={resolve,signal};})});
 const bytes=await require('sharp')({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer();
 const result=await upload(status,bytes);assert.equal(result.status,408);assert.equal(pending.signal.aborted,true);assert.equal((await upload(status,bytes)).status,429);pending.resolve({ok:true});
});
test('raw upload rejects duplicated security headers before consuming body',async t=>{
 const tls=require('node:tls');let calls=0;const {status}=await fixture(t,{uploadImage:async()=>{calls++;return {};}});
 const port=new URL(status.localUrl).port;
 for(const duplicate of [`Authorization: Bearer ${status.accessToken}`,`Host: localhost:${port}`,'Content-Type: application/octet-stream','Origin: https://localhost:'+port]) {
  const response=await new Promise((resolve,reject)=>{
   const socket=tls.connect({host:'127.0.0.1',port:Number(port),ca:status.certificatePem,servername:'localhost'},()=>socket.write(`POST /mcp/images?canvasId=c&documentId=d&requestId=r&name=x HTTP/1.1\r\nHost: localhost:${port}\r\nAuthorization: Bearer ${status.accessToken}\r\nContent-Type: application/octet-stream\r\nOrigin: https://localhost:${port}\r\n${duplicate}\r\nContent-Length: 100\r\nConnection: close\r\n\r\n`));
   let data='';socket.on('data',c=>{data+=c;if(data.includes('\r\n\r\n')){socket.destroy();resolve(data);}});socket.on('error',reject);
  });assert.match(response,/HTTP\/1.1 400/);
 }
 assert.equal(calls,0);
});
test('raw upload bounds chunked bodies before dispatch',async t=>{
 let calls=0;const {status}=await fixture(t,{uploadTimeoutMs:5000,uploadImage:async()=>{calls++;return {};}});
 const response=await upload(status,Buffer.alloc(32*1024*1024+1),{headers:{'transfer-encoding':'chunked'}});assert.equal(response.status,413);
 assert.equal(calls,0);
});
test('raw upload times out incomplete bodies before dispatch',async t=>{
 let calls=0;const {status}=await fixture(t,{uploadTimeoutMs:100,uploadImage:async()=>{calls++;return {};}});
 const incomplete=await new Promise((resolve,reject)=>{
  const req=https.request(status.localUrl.replace('/mcp','/mcp/images?canvasId=c&documentId=d&requestId=r&name=x'),{method:'POST',ca:status.certificatePem,agent:false,headers:{authorization:`Bearer ${status.accessToken}`,'content-type':'application/octet-stream','content-length':'100'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write('x');
 });assert.equal(incomplete,408);assert.equal(calls,0);
});
test('MCP body deadline rejects a slow drip before dispatch',async t=>{
 const {status}=await fixture(t,{requestBodyTimeoutMs:20});
 const result=await new Promise((resolve,reject)=>{
  const req=https.request(status.localUrl,{method:'POST',ca:status.certificatePem,agent:false,headers:{authorization:`Bearer ${status.accessToken}`,'content-type':'application/json','content-length':'8'}} ,res=>{let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:data?JSON.parse(data):null}));});
  req.on('error',()=>{});req.write('{"j');setTimeout(()=>req.end('son}'),40);
 });
 assert.equal(result.status,408);assert.equal(result.body.error,'Request body timed out');
});
test('cancelled RPC keeps actual backend capacity bounded and recovers on settlement',async t=>{
 let calls=0,release;
 const {status}=await fixture(t,{maxRequests:1,maxSessionRequests:1,requestCancelGraceMs:5,callTool:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});
 const session=(await request(status,message('initialize'))).headers['mcp-session-id'];
 const pending=request(status,message('tools/call',11,{name:'stuck'}),{session});
 while(!calls)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal((await request(status,{jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:11}},{session})).status,202);
 assert.equal((await pending).body.error.code,-32800);
 await new Promise(resolve=>setTimeout(resolve,30));
 for(let id=12;id<16;id++) {
  assert.equal((await request(status,message('tools/call',id,{name:'stuck'}),{session})).status,429);
  assert.equal((await request(status,{jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:id}},{session})).status,202);
 }
 assert.equal(calls,1);
 release({ok:true});await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await request(status,message('ping',17),{session})).status,200);
});
test('cancelled raw uploads retain actual backend capacity and recover on settlement',async t=>{
 let calls=0,release;
 const {status}=await fixture(t,{maxRequests:1,uploadTimeoutMs:30,uploadCancelGraceMs:5,uploadImage:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});
 const bytes=await require('sharp')({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer();
 assert.equal((await upload(status,bytes)).status,408);
 await new Promise(resolve=>setTimeout(resolve,30));
 for(let i=0;i<4;i++)assert.equal((await upload(status,bytes)).status,429);
 assert.equal(calls,1);
 release({ok:true});await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await request(status,message('initialize'))).status,200);
});
