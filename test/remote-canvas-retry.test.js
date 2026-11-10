'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/remote-canvas.js'),'utf8');
function fn(name){const start=source.indexOf(`  function ${name}(`);assert.ok(start>=0);return source.slice(start,source.indexOf('\n  }',start)+4);}
function fixture(){
 const timers=new Map();let next=0;
 const c={readyRefreshTimer:null,readyRefreshDeadline:0,deviceRetryAttempt:0,deviceRetryStopped:false,deviceRetrySuspended:false,bridgeDeviceId:'mac',bridgeDeviceLinked:true,bridgeState:{online:false},browserEditing:true,Date,Math:Object.assign(Object.create(Math),{random:()=>0.5}),CustomEvent:class{constructor(type){this.type=type;}},window:{PENECHO_CONFIG:{},dispatchEvent:()=>{},PenEchoLinkedDevice:{refresh:async()=>{}}},setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)};
 vm.createContext(c);for(const name of ['linkedDeviceRetryDelay','scheduleLinkedDeviceRefresh','invalidateLinkedDevice'])vm.runInContext(fn(name),c);
 return {c,timers,tick:async()=>{assert.equal(timers.size,1);const [id,timer]=[...timers][0];timers.delete(id);timer.fn();await new Promise(setImmediate);}};
}
test('browser keeps retrying the same device indefinitely with increasing capped intervals',async()=>{
 const {c,timers,tick}=fixture();let calls=0;
 c.window.PenEchoLinkedDevice.refresh=async options=>{assert.equal(options.automatic,true);calls++;c.invalidateLinkedDevice();};
 c.invalidateLinkedDevice();
 for(let attempt=0;attempt<25;attempt++){
  assert.equal([...timers.values()][0].delay,attempt<3?10000:attempt<8?60000:300000);
  await tick();assert.equal(c.bridgeDeviceId,'mac');assert.equal(c.window.PENECHO_CONFIG.linkedDeviceOnline,false);
 }
 assert.equal(calls,25);assert.equal(timers.size,1);
});
test('readiness polling falls back to long-running reconnect backoff after its short window',()=>{
 const {c,timers}=fixture();c.bridgeState={online:true,ready:false};c.readyRefreshDeadline=Date.now()+15000;
 c.scheduleLinkedDeviceRefresh();assert.equal([...timers.values()][0].delay,500);
 c.clearTimeout(c.readyRefreshTimer);c.readyRefreshTimer=null;c.readyRefreshDeadline=Date.now()-1;
 c.scheduleLinkedDeviceRefresh();assert.equal([...timers.values()][0].delay,10000);
});
test('ready state, page exit and authorization suspension stop automatic retries; scheduling is deduplicated',()=>{
 for(const state of [{deviceRetryStopped:true},{deviceRetrySuspended:true},{bridgeState:{online:true,ready:true}}]){
  const {c,timers}=fixture();Object.assign(c,state);c.scheduleLinkedDeviceRefresh();assert.equal(timers.size,0);
 }
 const {c,timers}=fixture();c.scheduleLinkedDeviceRefresh();c.scheduleLinkedDeviceRefresh();assert.equal(timers.size,1);assert.equal(c.deviceRetryAttempt,1);
});
test('browser retry jitter matches host policy and stays capped after prolonged failure',()=>{
 const {c}=fixture();assert.equal(c.linkedDeviceRetryDelay(0,()=>0),8000);assert.equal(c.linkedDeviceRetryDelay(0,()=>1),12000);
 assert.equal(c.linkedDeviceRetryDelay(100000,()=>0),240000);assert.equal(c.linkedDeviceRetryDelay(100000,()=>1),360000);
});
test('recovery cancels retries and resets backoff without switching the pinned device',()=>{
 const {c,timers}=fixture();c.deviceIdPattern=/^(mac|windows)$/;c.publishCloudHeaderStatus=()=>{};
 vm.runInContext(fn('updateLinkedDevice'),c);c.deviceRetryAttempt=12;c.scheduleLinkedDeviceRefresh();
 c.updateLinkedDevice({device:{id:'windows',online:true,ready:true,capabilities:{canvasAgent:true}}});
 assert.equal(c.bridgeDeviceId,'mac');assert.equal(c.window.PENECHO_CONFIG.canvasAgent,false);assert.equal(timers.size,1);
 c.updateLinkedDevice({device:{id:'mac',online:true,ready:true,capabilities:{canvasAgent:true}}});
 assert.equal(c.bridgeDeviceId,'mac');assert.equal(c.window.PENECHO_CONFIG.canvasAgent,true);assert.equal(timers.size,0);assert.equal(c.deviceRetryAttempt,0);
 c.invalidateLinkedDevice();assert.equal([...timers.values()][0].delay,10000);
});
