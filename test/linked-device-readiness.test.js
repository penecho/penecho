"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {WebSocketServer}=require('ws');
const {CloudConnector}=require('../src/server/cloud-connector.js');
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('condition timed out');}
async function fixture(t,timeout=1000){
 const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-ready-')),server=new WebSocketServer({host:'127.0.0.1',port:0});
 await new Promise(r=>server.once('listening',r));
 const sockets=[],frames=[];server.on('connection',s=>{sockets.push(s);s.on('message',b=>frames.push(JSON.parse(b)));});
 const connector=new CloudConnector({stateDir,executeRequest:async()=>({}),helloTimeoutMs:timeout});
 connector.writeConfiguration({version:2,origin:`http://127.0.0.1:${server.address().port}`,deviceToken:'test-token',deviceId:'device',enabled:true});
 t.after(async()=>{connector.close();for(const s of sockets)s.terminate();await new Promise(r=>server.close(r));fs.rmSync(stateDir,{recursive:true,force:true});});
 connector.start();await until(()=>sockets.length===1);
 return {connector,sockets,frames,hello:s=>s.send(JSON.stringify({type:'hello',protocol:1,deviceId:'device',capabilitiesAck:true})),ack:s=>s.send(JSON.stringify({type:'capabilities_ack',deviceId:'device'}))};
}
test('host remains connecting until capabilities are acknowledged and clears readiness on loss',async t=>{
 const f=await fixture(t);f.hello(f.sockets[0]);await until(()=>f.frames.length);
 assert.equal(f.frames[0].type,'capabilities');assert.equal(f.connector.status().state,'connecting');assert.equal(f.connector.lastConnectedAt,null);
 f.ack(f.sockets[0]);await until(()=>f.connector.status().connected);assert.equal(f.connector.helloTimer,null);
 f.sockets[0].close(4001,'replaced');await until(()=>!f.connector.status().connected);assert.equal(f.connector.configuration.deviceToken,'test-token');
});
test('missing capability ack times out without invalidating device credential',async t=>{
 const f=await fixture(t,40);f.hello(f.sockets[0]);await until(()=>f.frames.length);
 await until(()=>f.connector.status().state!=='connecting');assert.equal(f.connector.status().connected,false);assert.equal(f.connector.configuration.deviceToken,'test-token');assert.equal(f.connector.configuration.enabled,true);
});
test('superseded socket ack cannot make its replacement ready',async t=>{
 const f=await fixture(t);f.hello(f.sockets[0]);await until(()=>f.frames.length);
 const old=f.connector.socket;f.connector.socket=null;f.connector.connect();await until(()=>f.sockets.length===2);
 old.emit('message',Buffer.from(JSON.stringify({type:'capabilities_ack',deviceId:'device'})));
 assert.equal(f.connector.status().connected,false);f.hello(f.sockets[1]);await until(()=>f.frames.length===2);f.ack(f.sockets[1]);await until(()=>f.connector.status().connected);old.terminate();
});
test('unknown Agent selection returns CONNECTION_STALE with handshake correlation before any provider is created',async()=>{
 const {CanvasAgentHostRouter}=await import('../src/server/canvas-agent/host-router.mjs'),{createCanvasAgentPeer}=await import('../src/server/canvas-agent/peer.mjs');
 let providers=0;const frames=[],owner=new CanvasAgentHostRouter({resolveConnection:()=>null,harnessFactory:()=>{providers++;},nativeFactory:()=>{providers++;}});
 const peer=createCanvasAgentPeer({runtime:async()=>owner,sendFrame:s=>frames.push(JSON.parse(s))});
 await peer.receive(JSON.stringify({version:1,type:'hello',seq:1,clientId:'browser',canvasSessionId:'',payload:{connectionId:'deleted',handshakeId:'attempt-1'}}));
 assert.equal(providers,0);assert.equal(frames.length,1);assert.equal(frames[0].type,'error');assert.equal(frames[0].payload.code,'CONNECTION_STALE');assert.equal(frames[0].payload.status,409);assert.equal(frames[0].payload.handshakeId,'attempt-1');await peer.disconnect();
});
test('relay preserves stale connection status and code from local execution',async t=>{
 const f=await fixture(t);f.connector.executeRequest=async()=>{throw Object.assign(new Error('Refresh AI connections.'),{code:'CONNECTION_STALE',status:409});};
 f.hello(f.sockets[0]);await until(()=>f.frames.length);f.ack(f.sockets[0]);await until(()=>f.connector.status().connected);
 f.sockets[0].send(JSON.stringify({type:'request',requestId:'stale-request',payload:{}}));await until(()=>f.frames.some(x=>x.requestId==='stale-request'));
 const response=f.frames.find(x=>x.requestId==='stale-request');assert.equal(response.error,'CONNECTION_STALE');assert.equal(response.status,409);assert.equal(response.ok,false);
});
