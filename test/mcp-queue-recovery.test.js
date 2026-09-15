'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const persistence=fs.readFileSync(path.join(__dirname,'../src/client/app/persistence.js'),'utf8');
const runtime=fs.readFileSync(path.join(__dirname,'../src/client/app/mcp-runtime.js'),'utf8');
const section=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
  const frames=new Map(),timers=new Map(),listeners=new Set();let next=0,decoded=0;
  const document={hidden:false,addEventListener:(_name,fn)=>listeners.add(fn),removeEventListener:(_name,fn)=>listeners.delete(fn)};
  class Socket extends EventTarget{
    static OPEN=1;readyState=1;sent=[];
    send(raw){this.sent.push(JSON.parse(raw));}
    close(){this.readyState=3;}
    receive(message){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(message)}));}
  }
  const mcpRuntime={socket:null,browserId:null,generation:0,controllers:new Map(),previews:new Map(),sessions:new Map(),pendingView:new Map(),queue:Promise.resolve(),queued:0,reconnectDelay:1000};
  const context=vm.createContext({Promise,Map,Array,Set,JSON,Date,Math,AbortController,WebSocket:Socket,Event,MessageEvent,performance,document,mcpRuntime,
    window:{PenEchoCloudMcpSocket:Socket},state:{currentSnapshotName:'Test'},
    requestAnimationFrame:fn=>{const id=++next;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    SNAPSHOT_IMAGE_DECODE_BATCH_SIZE:Number(persistence.match(/SNAPSHOT_IMAGE_DECODE_BATCH_SIZE\s*=\s*(\d+)/)[1]),MAX_VISIBLE_IMAGES:100,MCP_BROWSER_CALL_DEADLINE_MS:44000,
    decodeStoredImage:async item=>{decoded++;return item;},mcpLocal:()=>true,canvasClientId:()=> 'browser',mcpHeartbeat:()=>{},mcpRenderSettings:()=>{},
    canvasAgentAssertToolExecution:execution=>{if(execution.generation!==mcpRuntime.generation||execution.socket!==mcpRuntime.socket||execution.controller.signal.aborted)throw Error('cancelled');}
  });
  vm.runInContext(section(persistence,'  function waitForSnapshotTileFrame(','  async function finalizeCanvasForSnapshot()'),context);
  vm.runInContext(section(runtime,'  function mcpExecutionAbortError(','  function mcpExecutionCurrent(')+section(runtime,'  function mcpDisconnect(','  function mcpDisposeSession(')+section(runtime,'  function mcpConnect(','  function mcpEscape('),context);
  const connect=()=>{context.mcpConnect(true);return mcpRuntime.socket;};
  const runFallback=()=>{const entry=[...timers].find(([,value])=>value.ms===100||value.ms===0);assert.ok(entry,'frame fallback scheduled');timers.delete(entry[0]);entry[1].fn();};
  return {context,mcpRuntime,frames,timers,listeners,document,connect,runFallback,decoded:()=>decoded};
}
test('frame wait uses foreground frames, hidden fallback and immediate abort with complete cleanup',async()=>{
  const h=harness(),controller=new AbortController();
  let removed=0;const original=controller.signal.removeEventListener.bind(controller.signal);controller.signal.removeEventListener=(...args)=>{removed++;return original(...args);};
  const pending=h.context.waitForSnapshotTileFrame(controller.signal);assert.equal(h.frames.size,1);assert.equal(h.timers.size,1);
  controller.abort();await pending;assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);assert.equal(removed,1);
  const foreground=h.context.waitForSnapshotTileFrame();[...h.frames.values()][0]();await foreground;assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);
  h.document.hidden=true;const hidden=h.context.waitForSnapshotTileFrame();assert.equal([...h.timers.values()][0].ms,0);h.runFallback();await hidden;assert.equal(h.frames.size,0);assert.equal(h.listeners.size,0);
  h.document.hidden=false;const switching=h.context.waitForSnapshotTileFrame();h.document.hidden=true;for(const listener of [...h.listeners])listener();await switching;assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
});
test('paused real decoder observes timeout cancellation and releases the next MCP call',async()=>{
  const h=harness();assert.equal(h.context.SNAPSHOT_IMAGE_DECODE_BATCH_SIZE,4);
  h.context.canvasDocumentsExecute=async(name,args,execution)=>{
    if(name==='decode')return h.context.decodeSnapshotImagesInBatches(Array.from({length:5},(_,i)=>({i})),()=>!execution.controller.signal.aborted);
    return {next:true};
  };
  const socket=h.connect();socket.receive({type:'call',requestId:'first',name:'decode',arguments:{}});await tick();assert.equal(h.decoded(),4);assert.equal(h.mcpRuntime.queued,1);
  socket.receive({type:'call',requestId:'next',name:'read',arguments:{}});socket.receive({type:'cancel',requestId:'first'});await h.mcpRuntime.queue;
  assert.equal(socket.sent.find(frame=>frame.requestId==='first').ok,false);assert.equal(socket.sent.find(frame=>frame.requestId==='next').result.next,true);
  h.runFallback();await tick();
  assert.equal(h.decoded(),4);assert.equal(socket.sent.find(frame=>frame.requestId==='first').ok,false);assert.equal(socket.sent.find(frame=>frame.requestId==='next').result.next,true);assert.equal(h.mcpRuntime.queued,0);assert.equal(h.frames.size,0);assert.equal(h.listeners.size,0);
});
test('cancellation releases the queue even when browser work ignores AbortSignal',async()=>{
  const h=harness();
  h.context.canvasDocumentsExecute=(name)=>name==='stuck'?new Promise(()=>{}):Promise.resolve({next:true});
  const socket=h.connect();socket.receive({type:'call',requestId:'stuck',name:'stuck',arguments:{}});await tick();
  socket.receive({type:'call',requestId:'next',name:'read',arguments:{}});socket.receive({type:'cancel',requestId:'stuck'});
  await h.mcpRuntime.queue;
  assert.equal(socket.sent.find(frame=>frame.requestId==='stuck').error.code,'REQUEST_CANCELLED');
  assert.equal(socket.sent.find(frame=>frame.requestId==='next').result.next,true);
  assert.equal(h.mcpRuntime.queued,0);assert.equal(h.mcpRuntime.controllers.size,0);
});
test('reconnection is independent of retired work and late cleanup preserves new queue counters',async()=>{
  const h=harness();let finishOld,finishNew;
  h.context.canvasDocumentsExecute=async(name)=>name==='old'?new Promise(resolve=>{finishOld=resolve;}):new Promise(resolve=>{finishNew=resolve;});
  const old=h.connect();old.receive({type:'call',requestId:'old',name:'old',arguments:{}});await tick();const retired=h.mcpRuntime.queue;
  const next=h.connect();next.receive({type:'call',requestId:'new',name:'new',arguments:{}});await tick();assert.equal(typeof finishNew,'function');assert.equal(h.mcpRuntime.queued,1);
  finishOld({stale:true});await retired;assert.equal(h.mcpRuntime.queued,1);assert.equal(h.mcpRuntime.controllers.size,1);assert.equal(old.sent.length,0);
  finishNew({fresh:true});await h.mcpRuntime.queue;assert.equal(h.mcpRuntime.queued,0);assert.equal(h.mcpRuntime.controllers.size,0);assert.equal(next.sent[0].result.fresh,true);
});
