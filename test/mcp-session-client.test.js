'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PassThrough}=require('node:stream');
const {createSessionClient}=require('../src/server/mcp/session-client.js');
const {createDirectHttpService}=require('../src/server/mcp/direct-http-service.js');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<300;n++){if(fn())return;await wait(10);}throw Error('Timed out');}
function streams(){const stdin=new PassThrough(),stdout=new PassThrough(),messages=[];let buf='';stdout.on('data',c=>{buf+=c;let n;while((n=buf.indexOf('\n'))>=0){messages.push(JSON.parse(buf.slice(0,n)));buf=buf.slice(n+1);}});return {stdin,stdout,messages};}
function send(io,id,method,params){io.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');}
test('HTTPS bridge forwards, recovers expired owner and releases on idle and EOF',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-session-'));let clock=0;const disposed=[];
 const service=createDirectHttpService({stateDirectory:directory,preferredPort:0,getHostnames:()=>[],getAddresses:()=>[],announce:()=>({close(){}}),now:()=>clock,sessionIdleMs:10,disposeOwner:id=>disposed.push(id),callTool:async(ownerId,name,args)=>({ownerId,name,args})});
 const status=await service.start(),io=streams();let exit=false;
 const client=createSessionClient({...io,hostId:status.hostId,loadCredentials:()=>status,resolveEndpoint:async()=>({url:status.localUrl}),idleTimeoutMs:40,tickMs:5,onExit:()=>{exit=true;}});
 t.after(async()=>{await client.close();await service.close();fs.rmSync(directory,{recursive:true,force:true});});
 send(io,1,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}});await until(()=>io.messages.length===1);assert.ok(io.messages[0].result);const original=client.sessionId;
 send(io,2,'tools/list');await until(()=>io.messages.length===2);assert.ok(io.messages[1].result.tools.length);
 clock=11;send(io,3,'tools/call',{name:'penecho_list_canvases',arguments:{}});await until(()=>io.messages.length===3);assert.ok(io.messages[2].result.structuredContent.ownerId);assert.notEqual(client.sessionId,original);
 await until(()=>!client.sessionId&&disposed.length>=2);assert.ok(disposed.length>=2);assert.equal(exit,false);
 send(io,4,'ping');await until(()=>io.messages.length===4);assert.ok(io.messages[3].result);io.stdin.end();await until(()=>exit);assert.equal(client.sessionId,undefined);
});
test('ambiguous mutation failure is not replayed and pending work protects idle',async t=>{
 const io=streams();let calls=0,finish,exit=false;
 const client=createSessionClient({...io,loadCredentials:()=>({}),resolveEndpoint:async()=>({url:'https://127.0.0.1/mcp'}),idleExitMs:20,tickMs:2,onExit:()=>exit=true,request:async(url,creds,message)=>{
 if(message?.method==='initialize')return {status:200,session:'a',body:{result:{protocolVersion:'2025-11-25'}}};
 if(message?.method==='tools/call'){calls++;await new Promise(r=>finish=r);throw Object.assign(Error('socket closed'),{dispatched:true});}return {status:202};}});
 t.after(()=>client.close());send(io,1,'initialize',{});send(io,2,'tools/call',{name:'mutation'});await until(()=>calls===1);await wait(45);assert.equal(exit,false);finish();await until(()=>io.messages.length===2);assert.match(io.messages[1].error.message,/may have completed/);assert.equal(calls,1);await until(()=>exit);
});
test('idle exit closes an actual child process while parent holds stdin open',async()=>{
 const {spawn}=require('node:child_process');const child=spawn(process.execPath,[path.join(__dirname,'../src/server/mcp/session-client.js'),'--host-id','a'.repeat(64),'--idle-exit-ms','30'],{stdio:['pipe','pipe','pipe']});
 const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('child did not exit'));},3000);child.once('exit',code=>{clearTimeout(timer);resolve(code);});child.once('error',reject);});assert.equal(code,0);
});
test('Canvas session recovery preserves document and maps original session ID',async t=>{
 const io=streams(),calls=[];let owner=0,expired=false,resolutions=0;
 const client=createSessionClient({...io,loadCredentials:()=>({}),resolveEndpoint:async()=>{resolutions++;return {url:'https://127.0.0.1/mcp'};},request:async(url,creds,message,sid)=>{
 if(message?.method==='initialize')return {status:200,session:`owner-${++owner}`,body:{result:{protocolVersion:'2025-11-25'}}};
 if(expired&&sid===`owner-${owner}`){expired=false;return {status:404};}
 if(message?.method==='tools/call'){calls.push(message.params);return {status:200,body:{jsonrpc:'2.0',id:message.id,result:{structuredContent:message.params.name==='penecho_start_session'?{sessionId:`canvas-${owner}`,documentId:'doc-1'}:{sessionId:message.params.arguments.sessionId}}}};}
 return {status:202};}});t.after(()=>client.close());
 send(io,1,'initialize',{});send(io,2,'tools/call',{name:'penecho_start_session',arguments:{client:'codex',sessionKey:'stable',target:'current'}});await until(()=>io.messages.length===2);expired=true;
 send(io,3,'tools/call',{name:'penecho_get_canvas',arguments:{sessionId:'canvas-1'}});await until(()=>io.messages.length===3);assert.equal(io.messages[2].result.structuredContent.sessionId,'canvas-1');assert.equal(calls[1].arguments.sessionKey,'stable');assert.equal(calls[1].arguments.documentId,'doc-1');assert.equal(calls[1].arguments.target,undefined);
 expired=true;send(io,4,'tools/call',{name:'penecho_get_canvas',arguments:{sessionId:'canvas-1'}});await until(()=>io.messages.length===4);assert.equal(io.messages[3].result.structuredContent.sessionId,'canvas-1');assert.equal(calls.at(-1).arguments.sessionId,'canvas-3');assert.equal(client.rememberedCount,1);assert.equal(resolutions,3);
});
test('failed initialize can retry, credentials are redacted, and closed queued work drains',async t=>{
 const io=streams();let attempts=0,resolutions=0;const token='secret-access-token',certificate='private-certificate';
 const client=createSessionClient({...io,loadCredentials:()=>({accessToken:token,certificatePem:certificate}),resolveEndpoint:async()=>{resolutions++;return {url:'https://127.0.0.1/mcp'};},request:async(url,creds,message)=>{
 if(message?.method==='initialize'){if(++attempts===1)throw Error(`bad ${token} ${certificate} -----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----`);return {status:200,session:'owner',body:{result:{}}};}return {status:202};}});t.after(()=>client.close());
 send(io,1,'initialize',{});await until(()=>io.messages.length===1);assert.doesNotMatch(io.messages[0].error.message,/secret-access-token|private-certificate|abc/);
 send(io,2,'initialize',{});await until(()=>io.messages.length===2);assert.deepEqual(io.messages[1].result,{});assert.equal(resolutions,2);
 send(io,3,'ping');send(io,4,'ping');await client.close();await until(()=>client.pendingCount===0);
});
test('remembered handles are capped before dispatch and successful close frees capacity',async t=>{
 const io=streams();let starts=0;
 const client=createSessionClient({...io,loadCredentials:()=>({}),resolveEndpoint:async()=>({url:'https://127.0.0.1/mcp'}),request:async(url,creds,message)=>{
 if(message?.method==='initialize')return {status:200,session:'owner',body:{result:{}}};
 if(message?.params?.name==='penecho_start_session')return {status:200,body:{jsonrpc:'2.0',id:message.id,result:{structuredContent:{sessionId:`s${++starts}`,documentId:'doc'}}}};
 return {status:200,body:{jsonrpc:'2.0',id:message?.id,result:{}}};}});t.after(()=>client.close());
 send(io,1,'initialize',{});await until(()=>io.messages.length===1);
 for(let n=0;n<128;n++){send(io,n+2,'tools/call',{name:'penecho_start_session',arguments:{sessionKey:`k${n}`}});await until(()=>io.messages.length===n+2);}
 send(io,130,'tools/call',{name:'penecho_start_session',arguments:{sessionKey:'overflow'}});await until(()=>io.messages.length===130);assert.match(io.messages.at(-1).error.message,/128/);assert.equal(starts,128);assert.equal(client.rememberedCount,128);
 send(io,131,'tools/call',{name:'penecho_close_session',arguments:{sessionId:'s1'}});await until(()=>io.messages.length===131);assert.equal(client.rememberedCount,127);
});
test('periodic transport pings do not prevent idle process exit',async t=>{
 const io=streams();let clock=0,exit=false;
 const client=createSessionClient({...io,now:()=>clock,idleExitMs:60,tickMs:2,onExit:()=>exit=true,loadCredentials:()=>({}),resolveEndpoint:async()=>({url:'https://127.0.0.1/mcp'}),request:async(url,creds,message)=>message?.method==='initialize'?{status:200,session:'owner',body:{result:{}}}:{status:200,body:{jsonrpc:'2.0',id:message?.id,result:{}}}});t.after(()=>client.close());
 send(io,1,'initialize',{});await until(()=>io.messages.length===1);
 for(let n=1;n<=3;n++){clock=n*15;send(io,n+1,'ping');await until(()=>io.messages.length===n+1);assert.equal(exit,false);}
 clock=61;send(io,5,'ping');await until(()=>exit);assert.equal(client.sessionId,undefined);
});
test('same live CLI reconnects through updated cache then discovery after idle HTTP release, preserving document',async t=>{
 const discovery=require('../src/server/mcp/discovery-client.js');const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'penecho-idle-reconnect-'));let clock=0,current,discoveries=0;const attempts=[];
 const service=createDirectHttpService({stateDirectory:directory,preferredPort:0,getHostnames:()=>[],getAddresses:()=>[],announce:()=>({close(){}}),disposeOwner:()=>{},callTool:async(owner,name,args)=>name==='penecho_start_session'?{sessionId:`business-${owner}`,documentId:'persistent-doc'}:{sessionId:args.sessionId,documentId:'persistent-doc'}});
 current=await service.start();const first=current.localUrl;const stateDirectory=path.join(directory,'client');discovery.importCredentials({...current,initialUrl:first,addresses:[first]},{stateDirectory});const io=streams();let exited=false;
 const client=createSessionClient({...io,hostId:current.hostId,stateDirectory,now:()=>clock,idleTimeoutMs:10,tickMs:2,onExit:()=>exited=true,resolveEndpoint:opts=>discovery.resolveEndpoint({...opts,request:async(url,settings)=>{attempts.push(url);return discovery.requestStatus(url,settings);},discover:async()=>{discoveries++;return [current.localUrl];}})});
 t.after(async()=>{await client.close();await service.close();fs.rmSync(directory,{recursive:true,force:true});});
 send(io,1,'initialize',{});send(io,2,'tools/call',{name:'penecho_start_session',arguments:{client:'test',sessionKey:'persistent-key'}});await until(()=>io.messages.length===2);const original=io.messages[1].result.structuredContent.sessionId;
 clock=20;await until(()=>!client.sessionId&&service.status().sessionCount===0);assert.equal(exited,false);await service.close();current=await service.start();assert.notEqual(current.localUrl,first);const second=current.localUrl;fs.writeFileSync(path.join(stateDirectory,'hosts',current.hostId,'endpoint.json'),JSON.stringify({hostId:current.hostId,url:second}));attempts.length=0;
 send(io,3,'tools/call',{name:'penecho_get_canvas',arguments:{sessionId:original}});await until(()=>io.messages.length===3);assert.equal(io.messages[2].result.structuredContent.documentId,'persistent-doc');assert.equal(io.messages[2].result.structuredContent.sessionId,original);assert.deepEqual(attempts,[first,second]);assert.equal(discoveries,0);
 clock=40;await until(()=>!client.sessionId&&service.status().sessionCount===0);await service.close();current=await service.start();assert.notEqual(current.localUrl,second);attempts.length=0;
 send(io,4,'tools/call',{name:'penecho_get_canvas',arguments:{sessionId:original}});await until(()=>io.messages.length===4);assert.equal(io.messages[3].result.structuredContent.documentId,'persistent-doc');assert.equal(io.messages[3].result.structuredContent.sessionId,original);assert.deepEqual(attempts,[second,current.localUrl]);assert.equal(discoveries,1);assert.equal(exited,false);
});
test('offline then online recovers on next call without exiting or replaying ambiguous mutations',async t=>{
 const io=streams();let online=true,failMutation=false,init=0,mutations=0,exited=false;const client=createSessionClient({...io,onExit:()=>exited=true,loadCredentials:()=>({}),resolveEndpoint:async()=>{if(!online)throw Error('offline');return {url:'https://127.0.0.1/mcp'};},request:async(url,credentials,message)=>{
 if(!online)throw Object.assign(Error('offline'),{dispatched:false});if(message?.method==='initialize')return {status:200,session:`owner-${++init}`,body:{result:{}}};if(message?.method==='tools/call'){mutations++;if(failMutation){failMutation=false;throw Object.assign(Error('response lost'),{dispatched:true});}}return {status:200,body:{jsonrpc:'2.0',id:message?.id,result:{}}};}});t.after(()=>client.close());
 send(io,1,'initialize',{});await until(()=>io.messages.length===1);online=false;send(io,2,'ping');await until(()=>io.messages.length===2);assert.ok(io.messages[1].error);assert.equal(exited,false);
 online=true;send(io,3,'ping');await until(()=>io.messages.length===3);assert.ok(io.messages[2].result);assert.equal(init,2);
 failMutation=true;send(io,4,'tools/call',{name:'mutation'});await until(()=>io.messages.length===4);assert.match(io.messages[3].error.message,/may have completed/);assert.equal(mutations,1);assert.equal(client.sessionId,undefined);
 send(io,5,'ping');await until(()=>io.messages.length===5);assert.ok(io.messages[4].result);assert.equal(init,3);assert.equal(mutations,1);assert.equal(exited,false);
});
test('explicit business session expiry restores stable document before retrying the rejected operation',async t=>{
 const io=streams();let starts=0,mutations=0,rejections=0;const client=createSessionClient({...io,loadCredentials:()=>({}),resolveEndpoint:async()=>({url:'https://127.0.0.1/mcp'}),request:async(url,credentials,message)=>{
 if(message?.method==='initialize')return {status:200,session:'owner',body:{result:{}}};if(message?.method!=='tools/call')return {status:202};let result;
 if(message.params.name==='penecho_start_session'){starts++;if(starts===2){assert.equal(message.params.arguments.documentId,'doc');assert.equal(message.params.arguments.sessionKey,'stable');}result={structuredContent:{sessionId:`handle-${starts}`,documentId:'doc'}};}
 else if(!rejections++){result={isError:true,structuredContent:{code:'session_expired',details:{retry:'penecho_start_session',sessionKey:'stable',documentId:'doc'}}};}
 else{mutations++;assert.equal(message.params.arguments.sessionId,'handle-2');result={structuredContent:{sessionId:'handle-2'}};}
 return {status:200,body:{jsonrpc:'2.0',id:message.id,result}};}});t.after(()=>client.close());
 send(io,1,'initialize',{});send(io,2,'tools/call',{name:'penecho_start_session',arguments:{sessionKey:'stable'}});send(io,3,'tools/call',{name:'mutation',arguments:{sessionId:'handle-1'}});await until(()=>io.messages.length===3);assert.equal(starts,2);assert.equal(mutations,1);assert.equal(io.messages[2].result.structuredContent.sessionId,'handle-1');
});
test('close during initialization deletes a late created HTTP session and drains queued requests',async()=>{
 const io=streams();let complete,deleted=0;const client=createSessionClient({...io,loadCredentials:()=>({}),resolveEndpoint:async()=>({url:'https://127.0.0.1/mcp'}),request:async(url,credentials,message,sid,options)=>{if(message?.method==='initialize')return new Promise(resolve=>{complete=()=>resolve({status:200,session:'late-owner',body:{result:{}}});});if(options.method==='DELETE'){assert.equal(sid,'late-owner');deleted++;}return {status:202};}});
 send(io,1,'initialize',{});send(io,2,'ping');await until(()=>complete);const closing=client.close();complete();await closing;await until(()=>client.pendingCount===0);assert.equal(deleted,1);assert.equal(client.sessionId,undefined);assert.equal(io.messages.length,0);
});
test('TCP TLS setup timeout is independent of a long tool deadline',async t=>{
 const net=require('node:net'),{httpRequest}=require('../src/server/mcp/session-client.js'),sockets=new Set();const server=net.createServer(socket=>sockets.add(socket));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});const started=Date.now();await assert.rejects(httpRequest(`https://127.0.0.1:${server.address().port}/mcp`,{accessToken:'test'}, {jsonrpc:'2.0',id:1,method:'tools/call'},undefined,{connectTimeoutMs:60,timeoutMs:120000}),error=>error.dispatched===false&&/TCP\/TLS/.test(error.message));assert.ok(Date.now()-started<2000);
});
test('initialization notification race retries once and persistent failure stays bounded',async t=>{
 const io=streams();let initializations=0,notifications=0,deletes=0;
 const client=createSessionClient({...io,loadCredentials:()=>({}),resolveEndpoint:async()=>({url:'https://127.0.0.1/mcp'}),request:async(url,credentials,message,sid,opts)=>{if(message?.method==='initialize')return {status:200,session:`owner-${++initializations}`,body:{result:{}}};if(message?.method==='notifications/initialized'){notifications++;return {status:404};}if(opts.method==='DELETE')deletes++;return {status:200};}});t.after(()=>client.close());send(io,1,'initialize',{});await until(()=>io.messages.length===1);assert.ok(io.messages[0].error);assert.equal(initializations,2);assert.equal(notifications,2);assert.equal(deletes,2);assert.equal(client.sessionId,undefined);
});
test('document mismatch during explicit expiry recovery never replays the original mutation',async t=>{
 const io=streams();let starts=0,operations=0;
 const client=createSessionClient({...io,loadCredentials:()=>({}),resolveEndpoint:async()=>({url:'https://127.0.0.1/mcp'}),request:async(url,credentials,message)=>{
 if(message?.method==='initialize')return {status:200,session:'owner',body:{result:{}}};if(message?.method!=='tools/call')return {status:202};
 const result=message.params.name==='penecho_start_session'?{structuredContent:{sessionId:`handle-${++starts}`,documentId:starts===1?'original':'wrong-document'}}:(operations++,{isError:true,structuredContent:{code:'session_expired',details:{retry:'penecho_start_session',documentId:'original',sessionKey:'stable'}}});return {status:200,body:{jsonrpc:'2.0',id:message.id,result}};}});t.after(()=>client.close());send(io,1,'initialize',{});send(io,2,'tools/call',{name:'penecho_start_session',arguments:{sessionKey:'stable'}});send(io,3,'tools/call',{name:'mutation',arguments:{sessionId:'handle-1'}});await until(()=>io.messages.length===3);assert.match(io.messages[2].error.message,/original document/);assert.equal(operations,1);assert.equal(starts,2);
});
test('default CLI lifetime remains open with stdin and exits on EOF',async t=>{
 const {spawn}=require('node:child_process');const child=spawn(process.execPath,[path.join(__dirname,'../src/server/mcp/session-client.js'),'--host-id','a'.repeat(64),'--idle-timeout-ms','20'],{stdio:['pipe','pipe','pipe']});t.after(()=>{if(child.exitCode===null)child.kill();});await wait(350);assert.equal(child.exitCode,null);child.stdin.end();const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('EOF did not stop CLI')),2000);child.once('exit',value=>{clearTimeout(timer);resolve(value);});});assert.equal(code,0);
});
test('HTTPS pool reuses authenticated TLS connections, isolates credentials and honors cancellation',async t=>{
 const https=require('node:https'),{loadDirectHttpIdentity,createDirectHttpLeaf}=require('../src/server/mcp/direct-http-identity.js');
 const {httpRequest,createTransportPool}=require('../src/server/mcp/session-client.js');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-pool-')),identity=loadDirectHttpIdentity(directory),pool=createTransportPool();let connections=0,slowMode=false;
 const server=https.createServer(createDirectHttpLeaf(identity,[],[]),(req,res)=>{if(slowMode)return;res.end(JSON.stringify({token:req.headers.authorization}));});server.keepAliveTimeout=30000;server.on('secureConnection',()=>connections++);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`https://127.0.0.1:${server.address().port}/mcp`;
 t.after(async()=>{pool.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
 const invoke=(credentials=identity,extra={})=>httpRequest(url,credentials,{},undefined,{agent:pool.get(url,credentials),connectTimeoutMs:50,...extra});
 assert.equal((await invoke()).body.token,`Bearer ${identity.accessToken}`);await wait(80);await invoke();assert.equal(connections,1);
 await invoke({...identity,accessToken:'replacement'});assert.equal(connections,2);
 slowMode=true;const controller=new AbortController();const slow=httpRequest(url,identity,{},undefined,{agent:pool.get(url,identity),signal:controller.signal,timeoutMs:1000});setTimeout(()=>controller.abort(),30);await assert.rejects(slow,e=>e.dispatched===true&&e.name==='AbortError');
 await assert.rejects(httpRequest(url,identity,{},undefined,{agent:pool.get(url,identity),timeoutMs:30}),/HTTPS deadline/);
 slowMode=false;await invoke();
 const originalAgent=pool.get(url,identity),otherHost=url.replace('127.0.0.1','localhost');
 assert.notEqual(pool.get(otherHost,identity),originalAgent);
 const untrusted={...identity,certificatePem:undefined};
 await assert.rejects(httpRequest(url,untrusted,{},undefined,{agent:pool.get(url,untrusted)}),error=>error.dispatched===false&&/certificate/i.test(error.message));
 await invoke();
});
test('bounded scheduler runs independent documents and directory queries while preserving handle order',async t=>{
 const io=streams(),begun=[],release=new Map();let active=0,peak=0;
 const client=createSessionClient({...io,loadCredentials:()=>({}),resolveEndpoint:async()=>({url:'https://127.0.0.1/mcp'}),request:async(url,credentials,message)=>{
 if(message?.method==='initialize')return {status:200,session:'owner',body:{result:{}}};
 if(message?.method==='tools/call'){begun.push(message.id);active++;peak=Math.max(peak,active);if(message.params.arguments?.sessionId)await new Promise(r=>release.set(message.id,r));active--;}
 return {status:200,body:{jsonrpc:'2.0',id:message?.id,result:{}}};}});t.after(()=>client.close());
 send(io,1,'initialize',{});await until(()=>io.messages.length===1);
 send(io,2,'tools/call',{name:'penecho_capture_canvas',arguments:{sessionId:'a'}});send(io,3,'tools/call',{name:'penecho_get_canvas',arguments:{sessionId:'a'}});
 send(io,4,'tools/call',{name:'penecho_get_canvas',arguments:{sessionId:'b'}});send(io,5,'tools/call',{name:'penecho_list_canvases',arguments:{}});
 await until(()=>begun.includes(5));assert.deepEqual(begun,[2,4,5]);release.get(2)();await until(()=>begun.includes(3));release.get(3)();release.get(4)();await until(()=>client.pendingCount===0);
 for(let id=6;id<12;id++)send(io,id,'tools/call',{name:'penecho_get_canvas',arguments:{sessionId:`doc-${id}`}});
 await until(()=>release.has(9));assert.equal(release.has(10),false);assert.equal(peak,4);
 for(let id=6;id<10;id++)release.get(id)();await until(()=>release.has(11));release.get(10)();release.get(11)();await until(()=>client.pendingCount===0);
});
test('cancelled queued requests never dispatch and a failed document lane resumes',async t=>{
 const io=streams(),seen=[];let finish;
 const client=createSessionClient({...io,loadCredentials:()=>({}),resolveEndpoint:async()=>({url:'https://127.0.0.1/mcp'}),request:async(url,credentials,message)=>{
 if(message?.method==='initialize')return {status:200,session:'owner',body:{result:{}}};
 if(message?.method==='tools/call'){seen.push(message.id);if(message.id===2){await new Promise(r=>finish=r);throw Error('operation failed');}}
 return {status:200,body:{jsonrpc:'2.0',id:message?.id,result:{}}};}});t.after(()=>client.close());
 send(io,1,'initialize',{});send(io,2,'tools/call',{name:'slow',arguments:{sessionId:'a'}});send(io,3,'tools/call',{name:'cancel-me',arguments:{sessionId:'a'}});await until(()=>finish);
 io.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:3}})+'\n');await until(()=>io.messages.some(m=>m.id===3));assert.equal(io.messages.find(m=>m.id===3).error.code,-32800);
 send(io,4,'tools/call',{name:'after-error',arguments:{sessionId:'a'}});finish();await until(()=>client.pendingCount===0);assert.deepEqual(seen,[2,4]);assert.ok(io.messages.find(m=>m.id===4).result);
});
test('late 404 from a second old-owner request does not invalidate the recovered owner',async t=>{
 const io=streams(),old=new Map(),calls=[];let initializations=0;
 const client=createSessionClient({...io,loadCredentials:()=>({}),resolveEndpoint:async()=>({url:'https://127.0.0.1/mcp'}),request:async(url,credentials,message,sid)=>{
 if(message?.method==='initialize')return {status:200,session:`owner-${++initializations}`,body:{result:{}}};
 if(message?.method==='ping'){calls.push([message.id,sid]);if(sid==='owner-1')return new Promise(r=>old.set(message.id,r));}
 return {status:200,body:{jsonrpc:'2.0',id:message?.id,result:{owner:sid}}};}});t.after(()=>client.close());
 send(io,1,'initialize',{});await until(()=>io.messages.length===1);send(io,2,'ping');send(io,3,'ping');await until(()=>old.size===2);
 old.get(2)({status:404});await until(()=>io.messages.some(m=>m.id===2));assert.equal(client.sessionId,'owner-2');
 old.get(3)({status:404});await until(()=>client.pendingCount===0);assert.equal(client.sessionId,'owner-2');assert.equal(initializations,2);
 assert.deepEqual(calls,[[2,'owner-1'],[3,'owner-1'],[2,'owner-2'],[3,'owner-2']]);assert.equal(io.messages.find(m=>m.id===3).result.owner,'owner-2');
});
test('aliases of the same document stay ordered during handle restoration after owner expiry',async t=>{
 const io=streams(),restored=[],operations=[];let owner=0,expire=false,finish;
 const client=createSessionClient({...io,loadCredentials:()=>({}),resolveEndpoint:async()=>({url:'https://127.0.0.1/mcp'}),request:async(url,credentials,message,sid)=>{
 if(message?.method==='initialize')return {status:200,session:`owner-${++owner}`,body:{result:{}}};
 if(expire&&message?.method==='ping'){expire=false;return {status:404};}
 const args=message?.params?.arguments;
 if(message?.params?.name==='penecho_start_session'){
   if(owner>1){assert.equal(args.documentId,'shared-document');restored.push(args.sessionKey);}
   return {status:200,body:{jsonrpc:'2.0',id:message.id,result:{structuredContent:{sessionId:`${args.sessionKey}-${owner}`,documentId:'shared-document'}}}};
 }
 if(args?.sessionId){operations.push(args.sessionId);if(message.id===5)await new Promise(r=>finish=r);return {status:200,body:{jsonrpc:'2.0',id:message.id,result:{structuredContent:{sessionId:args.sessionId}}}};}
 return {status:200,body:{jsonrpc:'2.0',id:message?.id,result:{}}};}});t.after(()=>client.close());
 send(io,1,'initialize',{});send(io,2,'tools/call',{name:'penecho_start_session',arguments:{sessionKey:'alias-a'}});send(io,3,'tools/call',{name:'penecho_start_session',arguments:{sessionKey:'alias-b'}});await until(()=>client.pendingCount===0);
 expire=true;send(io,4,'ping');await until(()=>client.pendingCount===0);assert.equal(owner,2);
 send(io,5,'tools/call',{name:'penecho_capture_canvas',arguments:{sessionId:'alias-a-1'}});send(io,6,'tools/call',{name:'penecho_get_canvas',arguments:{sessionId:'alias-b-1'}});
 await until(()=>finish);assert.deepEqual(restored,['alias-a']);assert.deepEqual(operations,['alias-a-2']);finish();await until(()=>client.pendingCount===0);
 assert.deepEqual(restored,['alias-a','alias-b']);assert.deepEqual(operations,['alias-a-2','alias-b-2']);assert.equal(io.messages.find(m=>m.id===5).result.structuredContent.sessionId,'alias-a-1');assert.equal(io.messages.find(m=>m.id===6).result.structuredContent.sessionId,'alias-b-1');
});
test('cancellation flood is bounded, deduplicated and independent of ordinary requests',async t=>{
 const io=streams(),release=new Map(),cancelRelease=[];let cancellations=0,cancelActive=0,peak=0;
 const client=createSessionClient({...io,loadCredentials:()=>({}),resolveEndpoint:async()=>({url:'https://127.0.0.1/mcp'}),request:async(url,credentials,message,sid,opts)=>{
 if(message?.method==='initialize')return {status:200,session:'owner',body:{result:{}}};
 if(message?.method==='notifications/cancelled'){assert.equal(opts.agent,false);assert.equal(opts.timeoutMs,1500);cancellations++;cancelActive++;peak=Math.max(peak,cancelActive);await new Promise(r=>cancelRelease.push(r));cancelActive--;}
 if(message?.method==='tools/call')await new Promise(r=>release.set(message.id,r));
 return {status:200,body:{jsonrpc:'2.0',id:message?.id,result:{}}};}});t.after(()=>client.close());
 const cancel=id=>client.accept({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:id}});
 send(io,1,'initialize',{});await until(()=>client.pendingCount===0);for(let id=2;id<=5;id++)send(io,id,'tools/call',{name:'slow',arguments:{sessionId:`doc-${id}`}});await until(()=>release.size===4);
 for(let n=0;n<100;n++)for(let id=2;id<=6;id++)cancel(id);
 await until(()=>cancellations===4);assert.equal(client.pendingCount,8);assert.equal(peak,4);
 for(const fn of release.values())fn();await until(()=>client.pendingCount===4);
 send(io,6,'ping');await until(()=>io.messages.some(m=>m.id===6));assert.equal(cancellations,4);
 // A new active operation's cancellation queues behind the four control slots.
 send(io,7,'tools/call',{name:'slow',arguments:{sessionId:'new-doc'}});await until(()=>release.has(7));cancel(7);await wait(15);assert.equal(cancellations,4);
 cancelRelease.shift()();await until(()=>cancellations===5);assert.equal(peak,4);release.get(7)();for(const fn of cancelRelease)fn();await until(()=>client.pendingCount===0);
});
test('cancellation immediately after dequeue prevents dispatch across the ensure await',async t=>{
 const io=streams(),calls=[];
 const client=createSessionClient({...io,loadCredentials:()=>({}),resolveEndpoint:async()=>({url:'https://127.0.0.1/mcp'}),request:async(_url,_credentials,message)=>{calls.push(message?.method);if(message?.method==='initialize')return {status:200,session:'owner',body:{result:{}}};return {status:200,body:{id:message?.id,result:{}}};}});t.after(()=>client.close());
 send(io,1,'initialize',{});await until(()=>io.messages.length===1);
 io.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'penecho_patch_file',arguments:{sessionId:'a'}}})+'\n'+JSON.stringify({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:2}})+'\n');
 await until(()=>io.messages.length===2);assert.equal(io.messages[1].error.code,-32800);assert.equal(calls.includes('tools/call'),false);
});
