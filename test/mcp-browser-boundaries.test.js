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
  const pending=canvasBlob({toBlob(){}});
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
  const reading=blobDataUrl(new Blob(['x'])),readRejected=assert.rejects(reading,/encoding timed out/);
  [...timers.timers.values()].find(timer=>timer.ms===15_000).fn();await readRejected;
  const decoding=imageFromBlob(new Blob(['x'])),decodeRejected=assert.rejects(decoding,/decoding timed out/);
  [...timers.timers.values()].find(timer=>timer.ms===15_000).fn();await decodeRejected;
  assert.deepEqual(revoked,['blob:test']);
});

test('a missing diagram script event cannot keep document switching locked forever',async()=>{
  const timers=timerHarness(),script={remove(){this.removed=true;}},window={};
  const load=vm.runInNewContext(`(()=>{let diagramRuntimePromise=null;${functionSource(core,'diagramRuntime')}${functionSource(core,'loadDiagramRuntime')}return loadDiagramRuntime;})()`,{
    ...timers,window,document:{createElement:()=>script,head:{append(){}}},
  });
  const pending=load(),rejection=assert.rejects(pending,/load timed out/);
  const deadline=[...timers.timers.values()].find(timer=>timer.ms===10_000);assert.ok(deadline);deadline.fn();await rejection;
  assert.equal(script.removed,true);
});

test('Agent image encoding that never calls back has the same bounded failure behavior',async()=>{
  const timers=timerHarness();
  const encode=vm.runInNewContext(`(${functionSource(agent,'canvasAgentCanvasBlob')})`,timers);
  const pending=encode({toBlob(){}},'image/webp',.8),rejection=assert.rejects(pending,/encoding timed out/);
  const deadline=[...timers.timers.values()].find(timer=>timer.ms===15_000);assert.ok(deadline);deadline.fn();
  await rejection;
});
