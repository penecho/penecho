"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const LLM=require("../src/server/jevision.js"),{CloudConnector}=require("../src/server/cloud-connector.js");
const {createJeVisionRequestTracer}=require("../src/server/jevision-request-trace.js");
const request={version:1,mode:"ink",image:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",context:{shapesFit:true}};
const result={ok:true,answers:{action:{type:"choice",choice:"snap_shapes",confidence:.9}}};
function fixture(t,options={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-llm-trace-")),root=path.join(directory,"traces");
  const connector=Object.create(CloudConnector.prototype);
  connector.suggestionTransport={request:(...args)=>global.fetch(...args)};
  Object.assign(connector,{configuration:{origin:"https://penecho.test",accountToken:"account-secret"},defaultOrigin:"https://penecho.test",suggestionGuests:{"https://penecho.test":"guest-secret"},status:()=>({origin:"https://penecho.test"})});
  const config=LLM.cloudJeVisionConfig(connector,{}),fetch=global.fetch;
  t.after(()=>{global.fetch=fetch;fs.rmSync(directory,{recursive:true,force:true});});
  const tracer=createJeVisionRequestTracer({requestTraceDirectory:root,...options});
  const traces=()=>fs.readdirSync(root).sort().map(name=>({dir:path.join(root,name),data:JSON.parse(fs.readFileSync(path.join(root,name,"trace.json"),"utf8"))}));
  const run=(extra={})=>LLM.requestCloudJeVision(connector,config,request,{requestTracer:tracer,...extra});
  return {root,directory,config,connector,tracer,traces,run};
}
test("Cloud traces save the actual closed request and image, redact capabilities, and never reveal upstream implementation",async t=>{
  const f=fixture(t);
  global.fetch=async(url,options)=>{
    const [{dir,data}]=f.traces();assert.equal(data.phase,"sending");assert.equal(data.model,"PenEchoLLM");
    assert.equal(url,"https://penecho.test/api/v1/apps/penecho-llm/suggest");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,"request.json"))),{...JSON.parse(options.body),image:"<saved as image.png>"});
    assert.deepEqual(fs.readFileSync(path.join(dir,"image.png")),Buffer.from(request.image.split(',')[1],'base64'));
    return new Response(JSON.stringify({...result,diagnostic:"account-secret guest-secret"}));
  };
  assert.equal((await f.run()).model,"PenEchoLLM");
  const [{dir,data}]=f.traces();assert.equal(data.status,"completed");assert.equal(data.response.status,200);
  assert.equal(data.result.answers.action.choice,"snap_shapes");
  for(const name of ["trace.json","request.json","prompt.txt"]){const text=fs.readFileSync(path.join(dir,name),"utf8");assert.doesNotMatch(text,/account-secret|guest-secret|systemone|penecho\/jevision/);assert.ok(!text.includes(request.image));}
});
test("WebP requests are forwarded unchanged and saved as a separate WebP trace image",async t=>{
  const f=fixture(t),bytes=await require('sharp')(Buffer.from(request.image.split(',')[1],'base64')).webp().toBuffer(),
    webp={...request,image:`data:image/webp;base64,${bytes.toString('base64')}`};
  global.fetch=async(_url,options)=>{
    assert.deepEqual(JSON.parse(options.body),webp);
    return new Response(JSON.stringify(result));
  };
  await LLM.requestCloudJeVision(f.connector,f.config,webp,{requestTracer:f.tracer});
  const [{dir,data}]=f.traces();
  assert.equal(data.status,'completed');assert.equal(data.image.mimeType,'image/webp');
  assert.equal(data.image.file,'image.webp');assert.equal(data.image.bytes,bytes.length);
  assert.deepEqual(fs.readFileSync(path.join(dir,'image.webp')),bytes);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'request.json'))).image,'<saved as image.webp>');
});
test("Cloud failures, timeout and pre-send cancellation retain diagnosable outcomes",async t=>{
  for(const [kind,status] of [["http","failed"],["invalid","failed"],["timeout","timeout"],["cancel","cancelled"]]) {
    const f=fixture(t);
    global.fetch=async(_url,options)=>{
      if(kind==="http")return new Response(JSON.stringify({error:"insufficient_credits",details:{access:{reason:"insufficient_credits"}}}),{status:402});
      if(kind==="invalid")return new Response("broken json");
      return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new DOMException("Timed out","TimeoutError")),10);options.signal.addEventListener("abort",()=>{clearTimeout(timer);reject(options.signal.reason);},{once:true});});
    };
    await assert.rejects(f.run(kind==="cancel"?{signal:AbortSignal.abort()}:{}));
    const [{data}]=f.traces();assert.equal(data.status,status);assert.ok(data.completedAt);
    if(kind==="http")assert.equal(data.response.status,402);
    if(kind==="cancel")assert.equal(data.upstreamAttempted,false);
  }
});
test("Trace retention protects active work; recording failures cannot break suggestions",async t=>{
  const f=fixture(t,{requestTraceLimit:1});let resolve;
  global.fetch=()=>new Promise(done=>{resolve=done;});const first=f.run();
  const active=f.traces()[0].dir;
  global.fetch=async()=>new Response(JSON.stringify(result));await f.run();assert.ok(fs.existsSync(active));
  resolve(new Response(JSON.stringify(result)));await first;await f.run();assert.equal(f.traces().length,1);
  fs.writeFileSync(path.join(f.directory,"blocked"),"file");const errors=[];
  const tracer=createJeVisionRequestTracer({requestTraceDirectory:path.join(f.directory,"blocked","trace"),logger:entry=>errors.push(entry)});
  await f.run({requestTracer:tracer});assert.equal(errors.length,1);
});
