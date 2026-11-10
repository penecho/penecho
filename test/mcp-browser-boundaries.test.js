'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function functionSource(source,name){
  const start=source.indexOf(`function ${name}(`);
  if(start<0)throw Error(`Missing function ${name}`);
  const body=source.indexOf('{',start);let depth=0,quote='',escaped=false;
  for(let index=body;index<source.length;index++){
    const char=source[index];
    if(quote){
      if(escaped)escaped=false;
      else if(char==='\\')escaped=true;
      else if(char===quote)quote='';
      continue;
    }
    if(char==='"'||char==="'"||char==='`'){quote=char;continue;}
    if(char==='{')depth++;
    else if(char==='}'&&!--depth)return source.slice(start,index+1);
  }
  throw Error(`Unclosed function ${name}`);
}
function timerHarness(){
  const timers=new Map();let sequence=0;
  return {timers,setTimeout:(fn,ms)=>{timers.set(++sequence,{fn,ms});return sequence;},clearTimeout:id=>timers.delete(id)};
}

const persistence=fs.readFileSync(require.resolve('../src/client/app/persistence.js'),'utf8');
const core=fs.readFileSync(require.resolve('../src/client/app/core.js'),'utf8');
const agent=fs.readFileSync(require.resolve('../src/client/app/canvas-agent-runtime.js'),'utf8');

test('canvas encoding that never calls back expires and a later encoding can proceed',async()=>{
  const timers=timerHarness();
  const canvasBlob=vm.runInNewContext(`(${functionSource(persistence,'canvasBlob')})`,timers);
  const pending=canvasBlob({toBlob(){}},"image/png",undefined,{kind:"mcp"});
  const rejection=assert.rejects(pending,/encoding timed out/);
  const deadline=[...timers.timers.values()].find(timer=>timer.ms===15_000);assert.ok(deadline);deadline.fn();await rejection;
  const value={size:1};
  assert.equal(await canvasBlob({toBlob(callback){callback(value);}}),value);
});

test('snapshot image decoding and FileReader conversion have absolute deadlines',async()=>{
  const timers=timerHarness(),revoked=[];
  class Reader{readAsDataURL(){}abort(){this.aborted=true;}}
  class Image{}
  const context={...timers,Blob,FileReader:Reader,Image,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:url=>revoked.push(url)}};
  const blobDataUrl=vm.runInNewContext(`(${functionSource(persistence,'blobDataUrl')})`,context);
  const imageFromBlob=vm.runInNewContext(`(${functionSource(persistence,'imageFromBlob')})`,context);
  const reading=blobDataUrl(new Blob(['x']),{kind:'mcp'}),readRejected=assert.rejects(reading,/encoding timed out/);
  [...timers.timers.values()].find(timer=>timer.ms===15_000).fn();await readRejected;
  const decoding=imageFromBlob(new Blob(['x']),{kind:'mcp'}),decodeRejected=assert.rejects(decoding,/decoding timed out/);
  [...timers.timers.values()].find(timer=>timer.ms===15_000).fn();await decodeRejected;
  assert.deepEqual(revoked,['blob:test']);
});

test('normal diagram loading retains baseline singleflight and is not given an MCP deadline',async()=>{
  const timers=timerHarness(),script={},window={};
  const load=vm.runInNewContext(`(()=>{let diagramRuntimePromise=null;${functionSource(core,'diagramRuntime')}${functionSource(core,'loadDiagramRuntime')}return loadDiagramRuntime;})()`,{
    ...timers,window,document:{createElement:()=>script,head:{append(){}}},
  });
  const first=load(),second=load();assert.equal(first,second);assert.equal(timers.timers.size,0);
  const error=new Error('offline');script.onerror(error);await assert.rejects(first,/could not be loaded/);
});

test('Agent image encoding that never calls back has the same bounded failure behavior',async()=>{
  const timers=timerHarness();
  const encode=vm.runInNewContext(`(${functionSource(agent,'canvasAgentCanvasBlob')})`,timers);
  const pending=encode({toBlob(){}},'image/webp',.8,{kind:'mcp'}),rejection=assert.rejects(pending,/encoding timed out/);
  const deadline=[...timers.timers.values()].find(timer=>timer.ms===15_000);assert.ok(deadline);deadline.fn();
  await rejection;
});

test('ordinary Canvas and Agent encoding preserves late success and WebP null fallback',async()=>{
  const timers=timerHarness();
  for(const [source,name] of [[persistence,'canvasBlob'],[agent,'canvasAgentCanvasBlob']]) {
    const encode=vm.runInNewContext(`(${functionSource(source,name)})`,timers);let callback;
    const pending=encode({toBlob(fn){callback=fn;}},'image/webp',.8);
    assert.equal(timers.timers.size,0,'non-MCP encoding has no new deadline');
    const blob={type:'image/webp',size:1};callback(blob);assert.equal(await pending,blob);
  }
  const encode=vm.runInNewContext(`(${functionSource(agent,'canvasAgentCanvasBlob')})`,timers);
  assert.equal(await encode({toBlob(fn){fn(null);}},'image/webp'),null);
  assert.equal(await encode({toBlob(fn){fn(null);}},'image/webp',.8,{kind:'mcp'}),null);
});


test('timed out native encoders retain capacity until their real callbacks finish',async()=>{
  for(const [source,name] of [[persistence,'canvasBlob'],[agent,'canvasAgentCanvasBlob']]) {
    const timers=timerHarness(),encode=vm.runInNewContext(`(${functionSource(source,name)})`,timers),callbacks=[];
    for(let i=0;i<128;i++) {
      const pending=encode({toBlob(fn){callbacks.push(fn);}},'image/png',undefined,{kind:'mcp'}),rejected=assert.rejects(pending,/encoding timed out/);
      [...timers.timers.values()].find(timer=>timer.ms===15000).fn();await rejected;
    }
    await assert.rejects(encode({toBlob(){assert.fail('must not start another encoder');}},'image/png',undefined,{kind:'mcp'}),{code:'CANVAS_BUSY'});
    assert.equal(callbacks.length,128);
    callbacks.shift()({size:1});
    const blob={size:2};assert.equal(await encode({toBlob(fn){fn(blob);}},'image/png',undefined,{kind:'mcp'}),blob);
    // Ordinary user/Agent calls are not charged to the MCP capacity pool.
    assert.equal(await encode({toBlob(fn){fn(blob);}}),blob);
    callbacks.forEach(fn=>fn(blob));assert.equal(encode.pending.size,0);
  }
});

test('optional browser wake requests are singleflight and late grants are released',async()=>{
  const source=fs.readFileSync(require.resolve('../src/client/app/mcp-runtime.js'),'utf8');
  const runtime={wanted:true,ready:true,socket:{readyState:1}},document={hidden:false};let enabled=false,acquired=0,released=0,resolve;
  const context={mcpRuntime:runtime,document,window:{},WebSocket:{OPEN:1},localStorage:{getItem:()=>String(enabled)},navigator:{wakeLock:{request:()=>{acquired++;return new Promise(done=>resolve=done);}}}};
  const api=vm.runInNewContext(`(()=>{${functionSource(source,'mcpKeepAwakeEnabled')}${functionSource(source,'mcpReleaseWakeLock')}async ${functionSource(source,'mcpSyncWakeLock')}return {sync:mcpSyncWakeLock,release:mcpReleaseWakeLock};})()`,context);
  await api.sync();assert.equal(acquired,0);
  enabled=true;const first=api.sync();await Promise.resolve();await api.sync();assert.equal(acquired,1);
  document.hidden=true;await api.sync();resolve({release:async()=>released++,addEventListener(){}});await first;
  assert.equal(released,1);assert.equal(runtime.wakeLock,null);
  document.hidden=false;const second=api.sync();await Promise.resolve();resolve({release:async()=>released++,addEventListener(){}});await second;
  assert.ok(runtime.wakeLock);runtime.ready=false;await api.sync();assert.equal(released,2);
});

test('optional desktop wake renewals cannot pile up while IPC is unresolved',async()=>{
  const source=fs.readFileSync(require.resolve('../src/client/app/mcp-runtime.js'),'utf8');
  const runtime={wanted:true,ready:true,socket:{readyState:1}},calls=[];let finish;
  const context={mcpRuntime:runtime,document:{hidden:false},WebSocket:{OPEN:1},localStorage:{getItem:()=> 'true'},window:{penechoDesktop:{setMcpKeepAwake:value=>{calls.push(value);return value?new Promise(resolve=>finish=resolve):Promise.resolve();}}}};
  const api=vm.runInNewContext(`(()=>{${functionSource(source,'mcpKeepAwakeEnabled')}${functionSource(source,'mcpReleaseWakeLock')}async ${functionSource(source,'mcpSyncWakeLock')}return {sync:mcpSyncWakeLock,release:mcpReleaseWakeLock};})()`,context);
  const first=api.sync();await Promise.resolve();for(let i=0;i<20;i++)await api.sync();assert.deepEqual(calls,[true]);
  api.release();finish();await first;assert.deepEqual(calls,[true,false]);
  const late=api.sync();api.release();await late;assert.deepEqual(calls,[true,false,false]);
});
