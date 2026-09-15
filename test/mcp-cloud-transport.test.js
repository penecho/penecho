const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
class Socket extends EventTarget {
  static instances=[];
  constructor(url){super();this.url=url;this.readyState=0;this.sent=[];Socket.instances.push(this);}
  open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
  send(raw){this.sent.push(JSON.parse(raw));}
  receive(message){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(message)}));}
  close(code=1000,reason=''){this.readyState=3;const event=new Event('close');Object.defineProperties(event,{code:{value:code},reason:{value:reason}});this.dispatchEvent(event);}
}
function setup(runtime='cloud',fetch){Socket.instances=[];const window=new EventTarget(),timers=new Map();window.PENECHO_CONFIG={runtime};let sequence=0;vm.runInNewContext(fs.readFileSync(require.resolve('../public/mcp-cloud-transport.js'),'utf8'),{window,fetch,sessionStorage:{getItem:()=>null},location:{protocol:'https:',host:'penecho.test'},WebSocket:Socket,EventTarget,Event,MessageEvent,setTimeout:(fn,ms)=>{timers.set(++sequence,{fn,ms});return sequence;},clearTimeout:id=>timers.delete(id)});return {window,timers};}
test('one opted-in Canvas routes direct cloud and device calls separately, including colliding request IDs',()=>{
  const {window}=setup();window.PENECHO_REMOTE_CLOUD_STATUS={deviceId:'8c8d3342-8258-470e-8ca1-61b732222024'};
  const facade=new window.PenEchoCloudMcpSocket(),cloud=Socket.instances[0],received=[];facade.addEventListener('message',event=>received.push(JSON.parse(event.data)));
  cloud.open();facade.send(JSON.stringify({type:'hello',canvasId:'same-canvas'}));const device=Socket.instances[1];device.open();assert.equal(device.sent[0].canvasId,'same-canvas');
  cloud.receive({type:'call',requestId:'same',arguments:{}});device.receive({type:'call',requestId:'same',arguments:{}});
  assert.deepEqual(received.map(frame=>frame.requestId),['cloud:same','device:same']);
  facade.send(JSON.stringify({type:'result',requestId:'device:same',result:{value:'device'}}));facade.send(JSON.stringify({type:'result',requestId:'cloud:same',result:{value:'cloud'}}));
  assert.equal(device.sent.at(-1).result.value,'device');assert.equal(cloud.sent.at(-1).result.value,'cloud');assert.equal(facade.routes.size,0);
  facade.close();assert.equal(cloud.readyState,3);assert.equal(device.readyState,3);
});
test('a device disconnect cancels only its work; retries are bounded and opt-out stops them',()=>{
  const {window,timers}=setup();window.PENECHO_REMOTE_CLOUD_STATUS={deviceId:'8c8d3342-8258-470e-8ca1-61b732222024'};
  const facade=new window.PenEchoCloudMcpSocket(),received=[];facade.addEventListener('message',event=>received.push(JSON.parse(event.data)));Socket.instances[0].open();const device=Socket.instances[1];device.open();
  device.receive({type:'call',requestId:'pending',arguments:{sessionId:'session-device'}});device.close();
  assert.ok(received.some(frame=>frame.type==='cancel'&&frame.requestId==='device:pending'));assert.ok(received.some(frame=>frame.type==='dispose-session'&&frame.sessionId==='session-device'));
  assert.equal(facade.readyState,1);assert.equal(timers.size,1);assert.ok([...timers.values()][0].ms<=1200);
  facade.close();assert.equal(timers.size,0);
});
test('the facade preserves an authenticated primary close code so the Canvas can stop retrying',()=>{
  const {window}=setup(),facade=new window.PenEchoCloudMcpSocket(),closed=new Promise(resolve=>facade.addEventListener('close',resolve,{once:true}));
  Socket.instances[0].close(4401,'Sign in again');
  return closed.then(event=>{assert.equal(event.code,4401);assert.equal(event.reason,'Sign in again');assert.equal(facade.readyState,3);});
});
test('an upstream cancellation releases its facade route even if browser work never finishes',()=>{
  const {window}=setup();const facade=new window.PenEchoCloudMcpSocket(),received=[];facade.addEventListener('message',event=>received.push(JSON.parse(event.data)));
  const cloud=Socket.instances[0];cloud.open();cloud.receive({type:'call',requestId:'stuck',arguments:{}});assert.equal(facade.routes.size,1);
  cloud.receive({type:'cancel',requestId:'stuck'});assert.equal(facade.routes.size,0);assert.ok(received.some(frame=>frame.type==='cancel'&&frame.requestId==='cloud:stuck'));
  facade.close();
});
test('cloud works without a linked device and a later exact-device change replaces only the device channel',()=>{
  const {window,timers}=setup(),facade=new window.PenEchoCloudMcpSocket();Socket.instances[0].open();assert.equal(Socket.instances.length,1);
  window.PENECHO_REMOTE_CLOUD_STATUS={deviceId:'8c8d3342-8258-470e-8ca1-61b732222024'};window.dispatchEvent(new Event('penecho:remote-cloud-status'));Socket.instances[1].open();
  window.PENECHO_REMOTE_CLOUD_STATUS={deviceId:'ab51c889-54fd-47ef-b815-15335baaa4e5'};window.dispatchEvent(new Event('penecho:remote-cloud-status'));assert.equal(Socket.instances[1].readyState,3);
  [...timers.values()][0].fn();assert.match(Socket.instances[2].url,/ab51c889-54fd-47ef-b815-15335baaa4e5/);assert.equal(Socket.instances[0].readyState,1);facade.close();
});
test('anonymous local MCP works offline; signing in attaches cloud through the host with no device token in browser URLs',async()=>{
  let enabled=false;const {window}=setup('local',async()=>({ok:true,json:async()=>({cloudMcpEnabled:enabled})})),facade=new window.PenEchoCloudMcpSocket();
  Socket.instances[0].open();await new Promise(setImmediate);assert.match(Socket.instances[0].url,/\/api\/mcp\/canvas$/);assert.equal(Socket.instances.length,1);
  enabled=true;await facade.connectDevice();assert.equal(Socket.instances.length,2);assert.match(Socket.instances[1].url,/\/api\/mcp\/cloud-canvas$/);Socket.instances[1].open();
  enabled=false;await facade.connectDevice();assert.equal(Socket.instances[1].readyState,3);assert.equal(facade.readyState,1);facade.close();
});
test('transient status failure retries with bounded backoff; a setting changed during lookup is not lost',async()=>{
  let fail=true,resolveStatus;const {window,timers}=setup('local',async()=>{if(fail)throw Error('network unavailable');return new Promise(resolve=>{resolveStatus=resolve;});});
  const facade=new window.PenEchoCloudMcpSocket();Socket.instances[0].open();await new Promise(setImmediate);assert.equal(timers.size,1);
  fail=false;const pending=facade.connectDevice();window.dispatchEvent(new Event('penecho:cloud-account-changed'));
  resolveStatus({ok:true,json:async()=>({cloudMcpEnabled:false})});await new Promise(setImmediate);
  resolveStatus({ok:true,json:async()=>({cloudMcpEnabled:true})});await pending;
  assert.equal(Socket.instances.length,2);facade.close();assert.equal(timers.size,0);
});
test('a stalled Cloud status lookup releases the connection check and schedules recovery',async()=>{
  const {window,timers}=setup('local',()=>new Promise(()=>{})),facade=new window.PenEchoCloudMcpSocket();Socket.instances[0].open();await new Promise(setImmediate);
  const timeout=[...timers].find(([,entry])=>entry.ms===5000);assert.ok(timeout,'status lookup has an absolute deadline');timers.delete(timeout[0]);timeout[1].fn();await new Promise(setImmediate);
  assert.equal(facade.checking,false);assert.ok([...timers.values()].some(entry=>entry.ms<=1200),'status lookup retries after its deadline');
  facade.close();assert.equal(timers.size,0);
});
test('a stalled Cloud status response body is covered by the same absolute deadline',async()=>{
  const {window,timers}=setup('local',async()=>({ok:true,json:()=>new Promise(()=>{})})),facade=new window.PenEchoCloudMcpSocket();Socket.instances[0].open();await new Promise(setImmediate);
  const timeout=[...timers].find(([,entry])=>entry.ms===5000);assert.ok(timeout,'response JSON parsing has an absolute deadline');timers.delete(timeout[0]);timeout[1].fn();await new Promise(setImmediate);
  assert.equal(facade.checking,false);assert.ok([...timers.values()].some(entry=>entry.ms<=1200),'stalled response bodies retry after the deadline');
  facade.close();assert.equal(timers.size,0);
});

test('availability waits for each authenticated ready frame and drops only the lost channel',()=>{
  const {window}=setup();window.PENECHO_REMOTE_CLOUD_STATUS={deviceId:'8c8d3342-8258-470e-8ca1-61b732222024',deviceOnline:true};
  const facade=new window.PenEchoCloudMcpSocket();let changes=0;facade.addEventListener('availabilitychange',()=>changes++);
  const cloud=Socket.instances[0];cloud.open();const device=Socket.instances[1];device.open();
  assert.equal(facade.availability.cloud,false);assert.equal(facade.availability.local,false);
  cloud.receive({type:'ready'});assert.equal(facade.availability.cloud,true);assert.equal(facade.availability.local,false);
  device.receive({type:'ready'});assert.equal(facade.availability.local,true);
  device.close();assert.equal(facade.availability.local,false);assert.equal(facade.availability.cloud,true);assert.equal(changes,3);
  facade.close();assert.equal(facade.availability.cloud,false);
});

test('local primary is Local; the device channel becomes Cloud only after ready',async()=>{
  const {window}=setup('local',async()=>({ok:true,json:async()=>({cloudMcpEnabled:true,device:{connected:true}})}));
  let status;window.PenEchoMcpSettings={setDeviceStatus:value=>{status=value;}};
  const facade=new window.PenEchoCloudMcpSocket(),local=Socket.instances[0];local.open();await new Promise(setImmediate);
  local.receive({type:'ready'});assert.equal(facade.availability.local,true);assert.equal(facade.availability.cloud,false);assert.equal(status.connected,true);
  const cloud=Socket.instances[1];cloud.open();assert.equal(facade.availability.cloud,false);cloud.receive({type:'ready'});assert.equal(facade.availability.cloud,true);
  facade.close();
});

test('offline linked device cannot appear online from a stale device ID',()=>{
  const {window}=setup();window.PENECHO_REMOTE_CLOUD_STATUS={deviceId:'8c8d3342-8258-470e-8ca1-61b732222024',deviceOnline:false};
  const facade=new window.PenEchoCloudMcpSocket();Socket.instances[0].open();Socket.instances[0].receive({type:'ready'});
  assert.equal(Socket.instances.length,1);assert.equal(facade.availability.cloud,true);assert.equal(facade.availability.local,false);facade.close();
});

test('document catalog updates go only to channels that advertise support and refresh late-device hello',()=>{
  const {window}=setup();window.PENECHO_REMOTE_CLOUD_STATUS={deviceId:'8c8d3342-8258-470e-8ca1-61b732222024'};
  const facade=new window.PenEchoCloudMcpSocket(),cloud=Socket.instances[0];cloud.open();
  facade.send(JSON.stringify({type:'hello',canvasId:'same-canvas',title:'Canvas',documents:[{documentId:'one',title:'One',active:true}]}));
  const device=Socket.instances[1];device.open();
  cloud.receive({type:'ready',catalog:true});device.receive({type:'ready',catalog:false});
  facade.send(JSON.stringify({type:'catalog',documents:[{documentId:'two',title:'Two',active:true}]}));
  assert.equal(cloud.sent.filter(message=>message.type==='catalog').length,1);
  assert.equal(device.sent.filter(message=>message.type==='catalog').length,0);
  assert.equal(JSON.parse(facade.hello).documents[0].documentId,'two');
  device.receive({type:'ready',catalog:true});
  facade.send(JSON.stringify({type:'catalog',documents:[{documentId:'three',title:'Three',active:true}]}));
  assert.equal(cloud.sent.filter(message=>message.type==='catalog').length,2);
  assert.equal(device.sent.filter(message=>message.type==='catalog').length,1);
  facade.close();
});
