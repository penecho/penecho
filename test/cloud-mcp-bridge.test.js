'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const vm=require('node:vm');
const fs=require('node:fs');
function harness(){
  const sockets=[],timers=new Set();let now=0;
  class Socket extends EventEmitter{
    constructor(url,options){super();this.url=url;this.options=options;this.readyState=url?0:1;this.bufferedAmount=0;this.frames=[];this.pings=0;if(url)sockets.push(this);}
    send(data,options,done){this.frames.push({data,options});done?.();}
    close(code){if(this.readyState===3)return;this.closeCode=code;this.readyState=3;this.emit('close');}
    ping(){this.pings++;}
    open(){this.readyState=1;this.emit('open');}
  }
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/server/cloud-mcp-bridge.js'),'utf8'),{module,require:()=>Socket,URL,Date:{now:()=>now},setInterval:fn=>{const timer={fn,unref(){}};timers.add(timer);return timer;},clearInterval:id=>timers.delete(id)});
  return {bridge:new module.exports.CloudMcpBridge(),Socket,sockets,timers,tick:ms=>{now+=ms;for(const timer of timers)timer.fn();}};
}
const identity={origin:'https://cloud.example',token:'host-only-test-device'};
test('local cloud bridge forwards queued text in order without sending its credential to the browser',()=>{
  const {bridge,Socket,sockets,timers}=harness(),browser=new Socket();bridge.attach(browser,identity);const remote=sockets[0];
  assert.equal(remote.url.pathname,'/api/v1/mcp/device-canvas');assert.equal(remote.options.headers.authorization,`Bearer ${identity.token}`);assert.equal(remote.options.followRedirects,false);
  browser.emit('message',Buffer.from('hello'),false);browser.emit('message',Buffer.from('state'),false);remote.open();
  assert.deepEqual(remote.frames.map(frame=>frame.data.toString()),['hello','state']);
  remote.emit('message',Buffer.from('call'),false);assert.equal(browser.frames[0].data.toString(),'call');assert.equal(browser.frames[0].options.binary,false);
  browser.close();assert.equal(bridge.channels.size,0);assert.equal(remote.readyState,3);assert.equal(timers.size,0);
});
test('sixteen active bridges cap admission and immediately free capacity after opt-out',()=>{
  const {bridge,Socket,sockets,timers}=harness();const browsers=Array.from({length:17},()=>new Socket());
  for(const browser of browsers)bridge.attach(browser,identity);
  assert.equal(sockets.length,16);assert.equal(browsers[16].closeCode,1013);assert.equal(bridge.channels.size,16);
  browsers[0].close();bridge.attach(new Socket(),identity);assert.equal(bridge.channels.size,16);assert.equal(sockets.length,17);
  bridge.close();assert.equal(bridge.channels.size,0);assert.equal(timers.size,0);assert.ok(sockets.every(socket=>socket.readyState===3));
});
test('pending handshake queue, binary messages and slow consumers cannot accumulate unbounded bytes',()=>{
  for(const scenario of ['queue','bytes','binary','slow']){
    const {bridge,Socket,sockets,timers}=harness(),browser=new Socket();bridge.attach(browser,identity);const remote=sockets[0];
    if(scenario==='queue')for(let i=0;i<65;i++)browser.emit('message',Buffer.from('x'),false);
    if(scenario==='bytes')browser.emit('message',Buffer.alloc(12*1024*1024+1),false);
    if(scenario==='binary')browser.emit('message',Buffer.from('x'),true);
    if(scenario==='slow'){remote.open();browser.bufferedAmount=12*1024*1024;remote.emit('message',Buffer.from('x'),false);}
    assert.equal(bridge.channels.size,0,scenario);assert.equal(timers.size,0);assert.equal(remote.readyState,3);assert.equal(browser.readyState,3);
  }
});
test('dead peers expire; healthy idle browser channels remain usable without periodically destroying them',()=>{
  const {bridge,Socket,sockets,tick,timers}=harness(),browser=new Socket();bridge.attach(browser,identity);const remote=sockets[0];remote.open();
  for(let i=0;i<20;i++){tick(15000);browser.emit('pong');remote.emit('pong');}
  assert.equal(bridge.channels.size,1);assert.equal(browser.pings,20);
  tick(46000);assert.equal(bridge.channels.size,0);assert.equal(timers.size,0);
});
