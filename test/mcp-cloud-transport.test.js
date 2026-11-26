require('./helpers/safety.js');
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
function setup(runtime='cloud',fetch){Socket.instances=[];const window=new EventTarget(),timers=new Map();window.PENECHO_CONFIG={runtime};let sequence=0;vm.runInNewContext(fs.readFileSync(require.resolve('../public/mcp-cloud-transport.js'),'utf8'),{window,fetch,sessionStorage:{getItem:()=>null},location:{protocol:'https:',host:'penecho.test'},WebSocket:Socket,EventTarget,Event,MessageEvent,AbortController,setTimeout:(fn,ms)=>{timers.set(++sequence,{fn,ms});return sequence;},clearTimeout:id=>timers.delete(id)});return {window,timers};}
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
test('duplicate active route IDs do not overwrite or redispatch the original work',()=>{
 const {window}=setup(),facade=new window.PenEchoCloudMcpSocket(),socket=Socket.instances[0],received=[];
 facade.addEventListener('message',event=>received.push(JSON.parse(event.data)));socket.open();
 socket.receive({type:'call',requestId:'same',arguments:{}});const original=facade.routes.get('cloud:same');
 socket.receive({type:'call',requestId:'same',arguments:{different:true}});
 assert.equal(received.length,1);assert.equal(facade.routes.get('cloud:same'),original);assert.equal(socket.sent.at(-1).error.code,'REQUEST_ID_CONFLICT');
 facade.send(JSON.stringify({type:'result',requestId:'cloud:same',ok:true,result:{original:true}}));
 assert.equal(socket.sent.at(-1).result.original,true);facade.close();
});
test('primary overload close code 1013 passes through unchanged',()=>{
 const {window}=setup(),facade=new window.PenEchoCloudMcpSocket();let closed;
 facade.addEventListener('close',event=>{closed=event;});Socket.instances[0].close(1013,'Busy');
 assert.equal(closed.code,1013);assert.equal(closed.reason,'Busy');
});
test('a Canvas on penecho.ai has one MCP socket, the account\'s; a status change opens no second one',()=>{
  const {window,timers}=setup(),facade=new window.PenEchoCloudMcpSocket();
  assert.equal(Socket.instances.length,1);assert.equal(Socket.instances[0].url,'wss://penecho.test/api/v1/mcp/canvas');
  Socket.instances[0].open();assert.equal(facade.readyState,1);
  window.PENECHO_REMOTE_CLOUD_STATUS={deviceId:'8c8d3342-8258-470e-8ca1-61b732222024',deviceOnline:true};window.dispatchEvent(new Event('penecho:remote-cloud-status'));
  for(const {fn} of [...timers.values()])fn();
  assert.equal(Socket.instances.length,1,'the linked device is retired: no second socket');
  assert.deepEqual({...facade.availability},{cloud:false,local:false});
  Socket.instances[0].receive({type:'ready',catalog:true});assert.deepEqual({...facade.availability},{cloud:true,local:false});
  facade.close();assert.deepEqual({...facade.availability},{cloud:false,local:false});
});
test('a Canvas on a computer has one MCP socket, the computer\'s own, and asks Cloud for nothing',()=>{
  let asked=0;const {window}=setup('local',()=>{asked++;return Promise.reject(new Error('no request expected'));}),facade=new window.PenEchoCloudMcpSocket();
  assert.equal(Socket.instances.length,1);assert.equal(Socket.instances[0].url,'wss://penecho.test/api/mcp/canvas');
  Socket.instances[0].open();window.dispatchEvent(new Event('penecho:cloud-account-changed'));
  assert.equal(asked,0);assert.equal(Socket.instances.length,1);
  Socket.instances[0].receive({type:'ready'});assert.deepEqual({...facade.availability},{cloud:false,local:true});
  facade.close();
});
test('a call goes to the Canvas once and its result goes back under the caller\'s own id; a catalog goes only where it is wanted',()=>{
  const {window}=setup(),facade=new window.PenEchoCloudMcpSocket(),socket=Socket.instances[0],received=[];
  facade.addEventListener('message',event=>received.push(JSON.parse(event.data)));socket.open();
  facade.send(JSON.stringify({type:'hello',documents:[]}));facade.send(JSON.stringify({type:'catalog',documents:[{id:'d1'}]}));
  assert.deepEqual(socket.sent.map(frame=>frame.type),['hello'],'no catalog before the server says it takes one');
  socket.receive({type:'ready',catalog:true});facade.send(JSON.stringify({type:'catalog',documents:[{id:'d2'}]}));
  assert.equal(socket.sent.at(-1).type,'catalog');assert.deepEqual(JSON.parse(facade.hello).documents,[{id:'d2'}]);
  socket.receive({type:'call',requestId:'r1',arguments:{}});assert.equal(received.at(-1).requestId,'cloud:r1');
  facade.send(JSON.stringify({type:'result',requestId:'cloud:r1',ok:true,result:{done:true}}));
  assert.deepEqual(socket.sent.at(-1),{type:'result',requestId:'r1',ok:true,result:{done:true}});assert.equal(facade.routes.size,0);
  facade.close();
});
test('a primary socket that never opens is closed after its deadline',()=>{
  const {window,timers}=setup(),facade=new window.PenEchoCloudMcpSocket();let closed;
  facade.addEventListener('close',event=>{closed=event;});
  const deadline=[...timers.values()].find(timer=>timer.ms===10000);assert.ok(deadline);deadline.fn();
  assert.equal(closed.code,4000);assert.equal(facade.readyState,3);
});
