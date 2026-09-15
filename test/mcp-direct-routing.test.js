'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const {WebSocket} = require('ws');
const {createMcpService} = require('../src/server/mcp/service.js');
const pause = () => new Promise(resolve => setTimeout(resolve,5));
async function app(directory,options={}) {
  let service;
  const server = http.createServer(async (req,res) => { if (!await service.handleHttp(req,res)) res.writeHead(404).end(); });
  service = createMcpService({server,authorizeBrowser:() => null,stateDirectory:directory,registryStateDirectory:directory,lanAddresses:() => ['192.168.42.8'],directAnnounce:() => ({close(){}}),...options});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); service.register(server.address());
  // Observe register's automatic startup without calling startDirect.
  for (let i=0; !service.status().http.enabled && i<100; i++) await pause();
  assert.equal(service.status().http.enabled,true);
  return {service,port:server.address().port,status:service.status().http,async close(){await service.close(); await new Promise(resolve => server.close(resolve));}};
}
async function browser(app,id) {
  const calls = [], disposed=[], held=[]; let mode = 'normal';
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/api/mcp/canvas`);
  await new Promise((resolve,reject) => {
    ws.on('error',reject); ws.on('open',() => ws.send(JSON.stringify({type:'hello',canvasId:id,title:id})));
    ws.on('message',raw => {
      const frame = JSON.parse(raw); if (frame.type === 'dispose-session') { disposed.push(frame.sessionId); return; } if (frame.type === 'ready') return resolve(); if (frame.type !== 'call') return;
      calls.push(frame); const args = frame.arguments;
      let result = {sessionId:args.sessionId,documentId:args.documentId || `${id}-document-${calls.length}`,boardObjectId:null,revision:1};
      if (mode === 'wrong') result.documentId = 'unrelated-existing';
      if (mode === 'replacement') { result.documentId = 'new-replacement'; result.recovery = {restored:false,created:true,previousDocumentId:args.documentId,reason:'DOCUMENT_NOT_FOUND'}; }
      const respond=()=>ws.send(JSON.stringify({type:'result',requestId:frame.requestId,ok:true,result}));
      if(mode==='hold')held.push(respond);else respond();
    });
  });
  return {calls,disposed,release(){mode="normal";held.splice(0).forEach(send=>send());},setMode:value => mode=value,async close(){if(ws.readyState===WebSocket.CLOSED)return; await new Promise(resolve => {ws.once('close',resolve);ws.close();});}};
}
function rpc(status,method,params,session,id=1) {
  return new Promise((resolve,reject) => {
    const req = https.request(status.localUrl,{method:'POST',ca:status.certificatePem,agent:false,headers:{authorization:`Bearer ${status.accessToken}`,'content-type':'application/json',...(session?{'mcp-session-id':session}:{})}},res => {
      let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({code:res.statusCode,session:res.headers['mcp-session-id'],body:JSON.parse(data)}));
    });req.on('error',reject);req.end(JSON.stringify({jsonrpc:'2.0',id,method,params}));
  });
}
const initialize = async app => (await rpc(app.status,'initialize',{})).session;
const start = (app,session,args,id=1) => rpc(app.status,'tools/call',{name:'penecho_start_session',arguments:{title:'Research',client:'Test AI',...args}},session,id);
const output = response => { assert.equal(response.code,200); assert.equal(response.body.result.isError,undefined,JSON.stringify(response.body)); return response.body.result.structuredContent; };

test('automatic HTTPS startup and persistent conversations route latest only when unbound',async t => {
  const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'penecho-routing-')); let current=await app(directory);
  t.after(async()=>{await current.close();fs.rmSync(directory,{recursive:true,force:true});});
  const initialStatus=current.status;
  assert.match(current.service.status().http.discoveryCliUrl,/192\.168\.42\.8/);
  assert.equal(current.service.status(false).http,undefined); assert.equal(current.service.status(false).config,null);
  await current.service.startDirect();
  const configured=current.service.status();
  assert.equal(configured.config.type,'stdio');
  assert.equal(configured.config.args[0],path.join(directory,'mcp','client.js'));
  assert.equal(configured.config.args.includes('--idle-exit-ms'),false);
  assert.equal(configured.http.clientIdleMs,1800000);
  assert.equal(configured.http.initialUrl,configured.http.urls[0]);
  const configDir=path.join(directory,'client-config');fs.mkdirSync(path.join(configDir,'.codex'),{recursive:true});
  fs.writeFileSync(path.join(configDir,'.codex','config.toml'),'[mcp_servers.penecho]\ncommand="node"\nargs=["old-client.js","--idle-exit-ms","60000"]\n[mcp_servers.other]\ncommand="keep"\n');
  const configuredClient=await require('../src/server/mcp/configure.js').configureClient('codex',configured.config,{home:configDir,env:{}});
  assert.equal(configuredClient.configured,true);assert.equal(configuredClient.trustRequired,false);
  const savedLaunch=fs.readFileSync(configuredClient.configFile,'utf8');
  assert.equal(savedLaunch.includes('--idle-exit-ms'),false);assert.ok(savedLaunch.includes('command="keep"'));
  assert.ok(savedLaunch.includes(JSON.stringify(configured.config.args[0])));

  assert.equal(configured.http.documentLimits.openPerBrowser,64);
  const downloaded=await new Promise((resolve,reject)=>{http.get(`http://127.0.0.1:${current.port}/api/mcp/session-client.js`,res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve(Buffer.concat(chunks)));res.on('error',reject);}).on('error',reject);});
  assert.deepEqual(downloaded,fs.readFileSync(configured.config.args[0]));
  assert.equal(require('node:crypto').createHash('sha256').update(downloaded).digest('hex'),configured.http.sessionCliSha256);
  const first=await initialize(current); output(await rpc(current.status,'tools/list',{},first));
  const a=await browser(current,'browser-a');
  const original=output(await start(current,first,{sessionKey:'conversation-a'})); assert.equal(original.canvasId,'browser-a');
  const b=await browser(current,'browser-b');
  const retained=output(await start(current,first,{sessionKey:'conversation-a'})); assert.equal(retained.sessionId,original.sessionId); assert.equal(b.calls.length,0);
  const fresh=output(await start(current,first,{sessionKey:'conversation-b'})); assert.equal(fresh.canvasId,'browser-b');
  const explicit=await start(current,first,{sessionKey:'conversation-a',canvasId:'browser-b'}); assert.equal(explicit.body.result.structuredContent.code,'session_key_conflict');
  const changedDoc=await start(current,first,{sessionKey:'conversation-a',documentId:'other-doc'}); assert.equal(changedDoc.body.result.structuredContent.code,'session_key_conflict');
  const second=await initialize(current);
  const resumed=output(await start(current,second,{sessionKey:'conversation-a',target:'current'})); assert.equal(resumed.documentId,original.documentId); assert.equal(resumed.canvasId,'browser-a'); assert.notEqual(resumed.sessionId,original.sessionId);
  assert.equal(a.calls.at(-1).arguments.target,undefined); assert.equal(a.calls.at(-1).arguments.documentId,original.documentId);
  const ownership=await rpc(current.status,'tools/call',{name:'penecho_inspect_session',arguments:{sessionId:original.sessionId}},second);assert.equal(ownership.body.result.isError,true);
  const otherClient=output(await start(current,second,{sessionKey:'conversation-a',client:'Other AI'}));assert.equal(otherClient.canvasId,'browser-b');assert.notEqual(otherClient.documentId,original.documentId);
  await a.close(); while(current.service.listCanvases().some(c=>c.canvasId==='browser-a'))await pause();
  const migrated=output(await start(current,second,{sessionKey:'conversation-a'}));assert.equal(migrated.canvasId,'browser-b');assert.equal(migrated.documentId,original.documentId);assert.equal(b.calls.at(-1).arguments.documentId,original.documentId);
  await current.close(); current=await app(directory); assert.equal(current.status.hostId,initialStatus.hostId);assert.equal(current.status.accessToken,initialStatus.accessToken);
  const c=await browser(current,'browser-c');const third=await initialize(current);
  const restarted=output(await start(current,third,{sessionKey:'conversation-a'}));assert.equal(restarted.documentId,original.documentId);assert.equal(c.calls.at(-1).arguments.documentId,original.documentId);
});

test('restoration rejects unrelated documents and accepts only explicit missing-document replacement',async t=>{
  const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'penecho-recovery-')); const current=await app(directory);
  t.after(async()=>{await current.close();fs.rmSync(directory,{recursive:true,force:true});});
  const a=await browser(current,'browser-a');const first=await initialize(current);
  const original=output(await start(current,first,{sessionKey:'key'}));await a.close();while(current.service.listCanvases().length)await pause();
  const b=await browser(current,'browser-b');b.setMode('wrong');const second=await initialize(current);
  assert.equal((await start(current,second,{sessionKey:'key'})).body.result.structuredContent.code,'session_document_conflict');
  b.setMode('replacement');assert.equal((await start(current,second,{sessionKey:'key',restore:false})).body.result.structuredContent.code,'session_document_conflict');
  const replaced=output(await start(current,second,{sessionKey:'key'}));assert.equal(replaced.documentId,'new-replacement');assert.equal(replaced.recovery.previousDocumentId,original.documentId);
});

test('simultaneous protocol owners share one logical binding without creating two documents',async t=>{
  const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'penecho-race-routing-'));const current=await app(directory);
  t.after(async()=>{await current.close();fs.rmSync(directory,{recursive:true,force:true});});
  const a=await browser(current,'browser-a');const sessions=await Promise.all([initialize(current),initialize(current)]);
  const results=await Promise.all(sessions.map(session=>start(current,session,{sessionKey:'same-key'})));
  assert.equal(output(results[0]).documentId,output(results[1]).documentId);assert.equal(a.calls[0].arguments.documentId,undefined);assert.equal(a.calls[1].arguments.documentId,output(results[0]).documentId);
});
test('a binding store that never settles releases the serialized session start',async t=>{
  const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'penecho-binding-timeout-'));let stalled=true;
  const bindings={read:()=>stalled?new Promise(()=>{}):null,write:async()=>{}};
  const current=await app(directory,{bindings,bindingTimeoutMs:15});
  t.after(async()=>{await current.close();fs.rmSync(directory,{recursive:true,force:true});});
  await browser(current,'browser-a');const session=await initialize(current);
  const timedOut=await start(current,session,{sessionKey:'stalled'});
  assert.equal(timedOut.body.result.isError,true);assert.equal(timedOut.body.result.structuredContent.code,'binding_timeout');
  stalled=false;
  assert.equal(output(await start(current,session,{sessionKey:'stalled'},2)).canvasId,'browser-a');
});
test('a binding write timeout retains the browser session for an idempotent retry',async t=>{
  const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'penecho-binding-write-timeout-'));let writes=0;
  const bindings={read:async()=>null,write:async()=>++writes===1?new Promise(()=>{}):undefined};
  const current=await app(directory,{bindings,bindingTimeoutMs:15});
  t.after(async()=>{await current.close();fs.rmSync(directory,{recursive:true,force:true});});
  const canvas=await browser(current,'browser-a'),session=await initialize(current);
  const timedOut=await start(current,session,{sessionKey:'write-stalled'});
  assert.equal(timedOut.body.result.structuredContent.code,'binding_timeout');
  const retried=output(await start(current,session,{sessionKey:'write-stalled'},2));
  assert.equal(retried.sessionId,canvas.calls[0].arguments.sessionId);
  assert.equal(canvas.calls[1].arguments.sessionId,canvas.calls[0].arguments.sessionId);
});
test('HTTP reset route refreshes credentials and protocol owner disposal retains durable bindings',async t=>{
  const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'penecho-reset-routing-'));const current=await app(directory);
  t.after(async()=>{await current.close();fs.rmSync(directory,{recursive:true,force:true});});
  await browser(current,'browser-a');const first=await initialize(current);const original=output(await start(current,first,{sessionKey:'keep-me'}));
  const previous=current.status;
  const reset=await new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:current.port,path:'/api/mcp/http',method:'POST',headers:{'content-type':'application/json'}},res=>{let bytes='';res.on('data',c=>bytes+=c);res.on('end',()=>resolve({code:res.statusCode,body:JSON.parse(bytes)}));});req.on('error',reject);req.end(JSON.stringify({action:'reset-certificate'}));
  });
  assert.equal(reset.code,200);current.status=reset.body.http;assert.notEqual(current.status.accessToken,previous.accessToken);assert.notEqual(current.status.hostId,previous.hostId);
  assert.equal((await current.service.startDirect()).hostId,current.status.hostId);
  const resumed=output(await start(current,await initialize(current),{sessionKey:'keep-me'}));assert.equal(resumed.documentId,original.documentId);
});
test('business idle pressure releases browser runtime, retains documents and scopes expired handles',async t=>{
  const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'penecho-business-idle-'));let clock=0;
  const current=await app(directory,{businessNow:()=>clock,businessOwnerLimit:2});
  t.after(async()=>{await current.close();fs.rmSync(directory,{recursive:true,force:true});});
  const a=await browser(current,'browser-a'), first=await initialize(current);
  const original=output(await start(current,first,{sessionKey:'original'}));
  clock=1000;output(await start(current,first,{sessionKey:'second'}));
  assert.equal((await start(current,first,{sessionKey:'third'})).body.result.structuredContent.code,'session_limit');
  clock=61000;output(await start(current,first,{sessionKey:'third'}));
  while(!a.disposed.includes(original.sessionId))await pause();
  const expired=await rpc(current.status,'tools/call',{name:'penecho_inspect_session',arguments:{sessionId:original.sessionId}},first);
  assert.equal(expired.body.result.structuredContent.code,'session_expired');assert.equal(expired.body.result.structuredContent.details.documentId,original.documentId);
  const other=await initialize(current), unauthorized=await rpc(current.status,'tools/call',{name:'penecho_inspect_session',arguments:{sessionId:original.sessionId}},other);
  assert.equal(unauthorized.body.result.structuredContent.code,'session_not_found');assert.equal(unauthorized.body.result.structuredContent.details,undefined);
  const resumed=output(await start(current,first,{sessionKey:'original'}));assert.equal(resumed.documentId,original.documentId);
  const before=a.calls.length;output(await start(current,first,{sessionKey:'original',show:true}));assert.equal(a.calls.length,before+1);assert.equal(a.calls.at(-1).arguments.documentId,original.documentId);assert.equal(a.calls.at(-1).arguments.show,true);
  assert.equal(current.service.status().http.businessLimits.sessions,4096);
});
test('business pressure never evicts a conversation while its browser restore is pending',async t=>{
  const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'penecho-business-active-'));let clock=0;
  const current=await app(directory,{businessNow:()=>clock,businessOwnerLimit:1});
  t.after(async()=>{await current.close();fs.rmSync(directory,{recursive:true,force:true});});
  const a=await browser(current,'browser-a'),session=await initialize(current);
  const original=output(await start(current,session,{sessionKey:'active'}));
  a.setMode('hold');const restoring=start(current,session,{sessionKey:'active'});while(a.calls.length<2)await pause();
  clock=61000;assert.equal((await start(current,session,{sessionKey:'new'},2)).body.result.structuredContent.code,'session_limit');assert.equal(a.disposed.length,0);
  a.release();assert.equal(output(await restoring).documentId,original.documentId);
  clock=122000;output(await start(current,session,{sessionKey:'new'}));while(!a.disposed.length)await pause();assert.equal(a.disposed[0],original.sessionId);
});
