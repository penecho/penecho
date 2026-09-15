'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),https=require('node:https');
const {uploadImage,uploadName,MAX_INPUT,main}=require('../src/server/mcp/image-upload-client.js');
const {sessionClientBundle}=require('../src/server/mcp/session-client-bundle.js');
const {importCredentials}=require('../src/server/mcp/discovery-client.js');
function receipt(bytes,options){const hash=crypto.createHash('sha256').update(bytes).digest('hex');return {source:'penecho-asset:'+hash,assetId:hash,inputSha256:hash,name:'canonical.webp',mediaType:'image/webp',bytes:12,width:1,height:2,revision:1,canvasId:options.canvasId,documentId:options.documentId,requestId:options.requestId};}
function fixture(t){const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'raw-client-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'含 空格 image.JPEG'),bytes=Buffer.from([0,255,17,92,0,129]);fs.writeFileSync(file,bytes);const options={hostId:'a'.repeat(64),uploadImage:file,canvasId:'canvas',documentId:'document',loadCredentials:()=>({accessToken:'secret'}),resolveEndpoint:async()=>({url:'https://127.0.0.1/mcp'})};return {dir,file,bytes,options};}
test('raw bytes remain exact, basename preserves unicode/suffix and no converter; output is allowlisted',async t=>{const {bytes,options}=fixture(t);let calls=0;const result=await uploadImage({...options,requestUpload:async(url,creds,stream,size,args)=>{calls++;assert.equal(creds.accessToken,'secret');assert.equal(args.name,'含 空格 image.JPEG');assert.equal(size,bytes.length);const chunks=[];for await(const chunk of stream)chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),bytes);return {...receipt(bytes,args),untrusted:'secret'};}});assert.equal(calls,1);assert.match(result.requestId,/^[a-f0-9-]{36}$/);assert.equal(result.untrusted,undefined);assert.equal(uploadName('C:\\图片 space\\image.jpeg',path.win32),'image.jpeg');});
test('ambiguous dispatched error never retries and stderr contains retry ID but no token/path',async t=>{const {file,options}=fixture(t);let calls=0,out='';const code=await main({...options,requestId:'explicit-retry',requestUpload:async()=>{calls++;throw Object.assign(Error('secret '+file),{dispatched:true});}},{stderr:{write:s=>out+=s}});assert.equal(code,1);assert.equal(calls,1);assert.equal(JSON.parse(out).outcome,'unknown');assert.equal(JSON.parse(out).requestId,'explicit-retry');assert.ok(!out.includes(file)&&!out.includes('secret'));});
test('reject mismatched target and original input hash',async t=>{const {bytes,options}=fixture(t);for(const bad of [{documentId:'other'},{inputSha256:'f'.repeat(64)}])await assert.rejects(uploadImage({...options,requestUpload:async(url,c,stream,size,args)=>{for await(const chunk of stream){}return {...receipt(bytes,args),...bad};}}),{code:'INVALID_RESPONSE',outcome:'unknown'});});
test('reject oversized and nonabsolute files before discovery',async t=>{const {file,options}=fixture(t);fs.truncateSync(file,MAX_INPUT+1);await assert.rejects(uploadImage(options),{code:'INVALID_FILE',outcome:'not_dispatched'});await assert.rejects(uploadImage({...options,uploadImage:'relative.png'}),{code:'INVALID_ARGUMENT'});});
test('portable generated bundle uses authenticated private HTTPS with exact binary and no MCP initialize',async t=>{
 const {dir,file,bytes}=fixture(t);const {loadDirectHttpIdentity,createDirectHttpLeaf}=require('../src/server/mcp/direct-http-identity.js');
 const host=loadDirectHttpIdentity(path.join(dir,'server'));let uploads=0;
 const server=https.createServer(createDirectHttpLeaf(host,['127.0.0.1'],[]),(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer '+host.accessToken);
  res.setHeader('content-type','application/json');
  if(req.url==='/status'){res.end(JSON.stringify({hostId:host.hostId,startedAt:Date.now()}));return;}
  uploads++;assert.equal(req.method,'POST');const url=new URL(req.url,'https://localhost');assert.equal(url.pathname,'/mcp/images');assert.equal(req.headers['content-type'],'application/octet-stream');assert.equal(url.searchParams.get('name'),'含 空格 image.JPEG');
  const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{assert.deepEqual(Buffer.concat(chunks),bytes);res.end(JSON.stringify(receipt(bytes,Object.fromEntries(url.searchParams))));});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const stateDirectory=path.join(dir,'client-state');importCredentials({...host,addresses:[`https://127.0.0.1:${server.address().port}/mcp`]}, {stateDirectory});
 const bundle=path.join(dir,'client.js');fs.writeFileSync(bundle,sessionClientBundle());
 const {spawn}=require('node:child_process');const child=spawn(process.execPath,[bundle,'--host-id',host.hostId,'--state-directory',stateDirectory,'--upload-image',file,'--canvas-id','canvas','--document-id','doc'],{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>err+=s);
 const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});assert.equal(code,0,err);assert.equal(JSON.parse(out).documentId,'doc');assert.equal(uploads,1);
});
test('HTTPS response limit and deadline terminate transport without mutation replay',async t=>{
 const {dir,options}=fixture(t);const {loadDirectHttpIdentity,createDirectHttpLeaf}=require('../src/server/mcp/direct-http-identity.js');const host=loadDirectHttpIdentity(path.join(dir,'server'));let requests=0,mode='oversize';
 const server=https.createServer(createDirectHttpLeaf(host,['127.0.0.1'],[]),(req,res)=>{requests++;req.resume();if(mode==='oversize'){res.writeHead(200);res.end('x'.repeat(70*1024));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const settings={...options,loadCredentials:()=>host,resolveEndpoint:async()=>({url:`https://127.0.0.1:${server.address().port}/mcp`})};
 await assert.rejects(uploadImage(settings),{code:'INVALID_RESPONSE',outcome:'unknown'});assert.equal(requests,1);mode='timeout';await assert.rejects(uploadImage({...settings,timeoutMs:50}),error=>error.outcome==='unknown'&&['UPLOAD_TIMEOUT','UPLOAD_FAILED'].includes(error.code));assert.equal(requests,2);
});
test('document IDs allow 256 characters but reject 257',async t=>{const {bytes,options}=fixture(t);const requestUpload=async(url,c,stream,size,args)=>{for await(const chunk of stream){}return receipt(bytes,args);};assert.equal((await uploadImage({...options,documentId:'d'.repeat(256),requestUpload})).documentId.length,256);await assert.rejects(uploadImage({...options,documentId:'d'.repeat(257),requestUpload}),{code:'INVALID_ARGUMENT'});});
test('absolute timeout releases a custom upload transport that ignores AbortSignal',async t=>{
 const {options}=fixture(t);let started=false;
 await assert.rejects(uploadImage({...options,timeoutMs:20,requestUpload:async()=>{started=true;return new Promise(()=>{});}}),error=>error.code==='UPLOAD_TIMEOUT'&&error.outcome==='unknown');
 assert.equal(started,true);
});
test('caller cancellation settles even when the custom upload transport ignores AbortSignal',async t=>{
 const {options}=fixture(t),controller=new AbortController();let started=false;
 const pending=uploadImage({...options,requestUpload:async()=>{started=true;return new Promise(()=>{});},signal:controller.signal});
 while(!started)await new Promise(resolve=>setTimeout(resolve,1));
 controller.abort();
 await assert.rejects(pending,{code:'request_cancelled',outcome:'unknown'});
});
test('definite HTTP rejection keeps safe actionable reason without server message secrets',async t=>{
 const {dir,options}=fixture(t);const {loadDirectHttpIdentity,createDirectHttpLeaf}=require('../src/server/mcp/direct-http-identity.js');const host=loadDirectHttpIdentity(path.join(dir,'server'));let response,requests=0;
 const server=https.createServer(createDirectHttpLeaf(host,['127.0.0.1'],[]),(req,res)=>{requests++;req.resume();res.writeHead(response.status,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:response.code,message:host.accessToken+' /private/secret.png'}}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 for(const scenario of [{status:409,code:'CANVAS_NOT_VISIBLE',reason:/intended document/,outcome:'rejected'},{status:429,code:'CANVAS_BUSY',reason:/busy/,outcome:'rejected'},{status:409,code:'REQUEST_ID_CONFLICT',reason:/different upload inputs/,outcome:'rejected'},{status:504,code:'canvas_timeout',reason:/did not respond/,outcome:'unknown'},{status:499,code:'request_cancelled',reason:/cancelled/,outcome:'unknown'},{status:409,code:'DOCUMENT_MISMATCH',reason:/different document/,outcome:'rejected'},{status:415,code:'unsupported_image',reason:/Export the image/,outcome:'rejected'},{status:503,code:'image_encoder_unavailable',reason:/dependencies/,outcome:'unknown'},{status:401,code:'secret-code',reason:/authentication/,outcome:'rejected'}]){
  response=scenario;let stderr='';const code=await main({...options,loadCredentials:()=>host,resolveEndpoint:async()=>({url:`https://127.0.0.1:${server.address().port}/mcp`})},{stderr:{write:s=>stderr+=s}});assert.equal(code,1);const result=JSON.parse(stderr);assert.equal(result.outcome,scenario.outcome);assert.match(result.error,scenario.reason);assert.ok(!stderr.includes(host.accessToken)&&!stderr.includes('/private/secret.png')&&!stderr.includes('secret-code'));if(scenario.outcome==='rejected')assert.doesNotMatch(result.error,/may have completed/);
 }
 assert.equal(requests,9);
});

test('pre-aborted upload is handled without a global unhandled rejection',async t=>{
 const {options}=fixture(t),controller=new AbortController();controller.abort();
 await assert.rejects(uploadImage({...options,signal:controller.signal}),{code:'request_cancelled',outcome:'not_dispatched'});
 // node:test also fails the test if a detached rejection appears on this turn.
 await new Promise(resolve=>setImmediate(resolve));
});
test('file opened after timeout is closed without proceeding to discovery',async t=>{
 const {options}=fixture(t);let finishOpen,closed=0,statCalls=0,discoveries=0;
 t.mock.method(fs.promises,'open',()=>new Promise(resolve=>{finishOpen=resolve;}));
 await assert.rejects(uploadImage({...options,timeoutMs:10,loadCredentials:()=>{discoveries++;}}),{code:'UPLOAD_TIMEOUT',outcome:'not_dispatched'});
 finishOpen({close:async()=>{closed++;},stat:async()=>{statCalls++;return {isFile:()=>true,size:1};}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(closed,1);assert.equal(statCalls,0);assert.equal(discoveries,0);
});
