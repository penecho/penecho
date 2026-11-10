'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const hostId='a'.repeat(64),otherId='b'.repeat(64);
function fixture(bindErrors=[]){
 const sockets=[],timers=new Map();let id=0;
 class Socket extends EventEmitter{
  constructor(){super();this.sent=[];this.closed=false;this.members=[];}
  bind(port,callback){this.port=port;const code=bindErrors.shift();if(code)this.emit('error',Object.assign(Error('socket unavailable'),{code}));else callback();}
  close(){this.closed=true;}
  addMembership(...args){this.members.push(args);}
  setMulticastInterface(address){this.address=address;}
  send(packet,port,address,callback){this.sent.push({packet,port,address,source:this.address});callback();}
 }
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/server/mcp/lan-discovery'),'utf8'),{
  module,Buffer,require(name){if(name==='node:dgram')return {createSocket(){const s=new Socket();sockets.push(s);return s;}};if(name==='node:os')return {networkInterfaces:()=>({eth:[{family:'IPv4',address:'192.168.1.2'}]})};return require(name);},
  setTimeout(fn){timers.set(++id,{fn,interval:false});return id;},setInterval(fn){timers.set(++id,{fn,interval:true});return id;},clearTimeout(key){timers.delete(key);},clearInterval(key){timers.delete(key);}
 });
 return {...module.exports,sockets,timers,expire(){const t=[...timers.values()].find(t=>!t.interval);assert.ok(t);t.fn();}};
}
test('matching candidates arrive before completion, deduplicate, and retain final array',async()=>{
 const f=fixture(),seen=[];let completed=false;
 const result=f.discover({hostId,onCandidate:url=>seen.push(url)}).then(urls=>{completed=true;return urls;});
 const s=f.sockets[0];assert.equal(s.port,5353);assert.equal(f.parsePacket(s.sent[0].packet).questions[0].unicast,false);
 s.emit('message',f.announcement(otherId,3000,['192.168.1.4']));assert.deepEqual(seen,[]);
 s.emit('message',Buffer.from('invalid'));
 const packet=f.announcement(hostId,3001,['192.168.1.5','8.8.8.8']);s.emit('message',packet);s.emit('message',packet);
 assert.deepEqual(seen,['https://192.168.1.5:3001/mcp']);await Promise.resolve();assert.equal(completed,false);
 f.expire();assert.deepEqual(Array.from(await result),seen);assert.equal(s.closed,true);assert.equal(f.timers.size,0);
});
test('abort closes socket and removes all timers while returning collected candidates',async()=>{
 const f=fixture(),controller=new AbortController(),seen=[];const result=f.discover({hostId,signal:controller.signal,onCandidate:url=>seen.push(url)});
 f.sockets[0].emit('message',f.announcement(hostId,3001,['192.168.1.5']));controller.abort();
 assert.deepEqual(Array.from(await result),seen);assert.equal(f.sockets[0].closed,true);assert.equal(f.timers.size,0);
 f.sockets[0].emit('message',f.announcement(hostId,3002,['192.168.1.6']));assert.equal(seen.length,1);
 const before=f.sockets.length;assert.deepEqual(Array.from(await f.discover({hostId,signal:controller.signal})),[]);assert.equal(f.sockets.length,before);
});
for(const code of ['EACCES','EPERM','EADDRINUSE'])test(`${code} on primary bind falls back to ephemeral unicast query`,async()=>{
 const f=fixture([code]),seen=[];const result=f.discover({hostId,onCandidate:url=>seen.push(url)});
 assert.equal(f.sockets.length,2);assert.equal(f.sockets[0].closed,true);const s=f.sockets[1];assert.equal(s.port,0);assert.equal(s.members.length,0);assert.equal(f.parsePacket(s.sent[0].packet).questions[0].unicast,true);
 s.emit('message',f.announcement(hostId,3003,['10.1.2.3']));assert.deepEqual(seen,['https://10.1.2.3:3003/mcp']);f.expire();assert.deepEqual(Array.from(await result),seen);assert.equal(f.timers.size,0);assert.equal(s.closed,true);
});
test('unrecoverable network errors reject with network code and original cause',async()=>{
 for(const errors of [['EINVAL'],['EACCES','EPERM']]){const f=fixture(errors.slice());await assert.rejects(f.discover({hostId}),e=>e.code==='LAN_DISCOVERY_NETWORK'&&e.cause.code===errors.at(-1));assert.ok(f.sockets.every(s=>s.closed));assert.equal(f.timers.size,0);}
});
test('progress callback and final candidates are capped at sixteen',async()=>{
 const f=fixture(),seen=[];const result=f.discover({hostId,onCandidate:url=>seen.push(url)});
 for(let i=1;i<=20;i++)f.sockets[0].emit('message',f.announcement(hostId,3000,[`10.1.1.${i}`]));
 assert.equal(seen.length,16);f.expire();assert.deepEqual(Array.from(await result),seen);
});
test('multicast sender releases its queue when a dgram callback never arrives',async t=>{
 // The mocked socket has no native handle to keep Node 22 alive for unref'ed deadlines.
 const keepAlive=setTimeout(()=>{},10_000);t.after(()=>clearTimeout(keepAlive));
 const {multicastSender}=require('../src/server/mcp/lan-discovery.js');let sends=0;
 const sender=multicastSender({setMulticastInterface(){},send(){sends++;}},10);
 const first=sender(Buffer.from('one'),['192.168.1.2']);
 const second=sender(Buffer.from('two'),['192.168.1.2']);
 await Promise.all([first,second]);
 assert.equal(sends,2);
});
