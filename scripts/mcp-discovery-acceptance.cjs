#!/usr/bin/env node
'use strict';
// Copies trust into disposable state; never writes real shared state or AI configuration.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
function argumentsFrom(argv){const options={};for(let i=0;i<argv.length;i++){if(argv[i]==='--help')return {help:true};const key={'--module-dir':'moduleDirectory','--host-id':'hostId','--state-directory':'stateDirectory','--endpoint':'endpoint','--output':'output'}[argv[i]];if(!key||!argv[i+1])throw Error('Unknown or incomplete option');options[key]=argv[++i];}for(const key of ['moduleDirectory','stateDirectory'])if(!options[key]||!path.isAbsolute(options[key]))throw Error(key+' must be an absolute directory');if(!/^[a-f\d]{64}$/i.test(options.hostId||''))throw Error('A valid --host-id is required');if(!options.endpoint)throw Error('--endpoint is required');if(options.output)options.output=path.resolve(options.output);return options;}
function assert(value,message){if(!value)throw Object.assign(Error(message),{code:'ACCEPTANCE_CHECK_FAILED'});}
async function runDiscoveryAcceptance(options){
 const client=require(path.join(options.moduleDirectory,'discovery-client.js')),lan=require(path.join(options.moduleDirectory,'lan-discovery.js'));const endpoint=client.validateURL(options.endpoint);
 assert(net.isIP(new URL(endpoint).hostname.replace(/^\[|\]$/g,'')),'Verified endpoint must contain a numeric private IP');
 const credentials=client.loadCredentials(options.hostId,{stateDirectory:options.stateDirectory});const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'penecho-discovery-acceptance-'));
 const report={startedAt:new Date().toISOString(),readOnlySharedState:true,noServerStop:true,noAIConfigurationWrites:true,cases:[],passed:false};const started=Date.now();
 let stalledServer;const stalledSockets=new Set();
 const badInitial='https://127.0.0.1:1/mcp',badCache='https://127.0.0.1:2/mcp';
 async function runCase(name,{initial=badInitial,cacheURL,corrupt=false,unreadable=false,simulated=false,reuseState,expectDiscovery=true,expectTimeout=false}={}){
  const caseStarted=Date.now(),stateDirectory=reuseState||path.join(root,String(report.cases.length)),record={name,simulatedOutage:simulated,attempts:[],discoveryCount:0,setupMs:0,resolveMs:0,discoveryMs:0,firstCandidateMs:null,cacheWriteMs:0,cacheFsyncMs:0,passed:false};report.cases.push(record);
  if(!reuseState)client.importCredentials({...credentials,initialUrl:initial},{stateDirectory});
  const cache=path.join(stateDirectory,'hosts',credentials.hostId,'endpoint.json');
  if(cacheURL)fs.writeFileSync(cache,JSON.stringify({hostId:credentials.hostId,url:cacheURL}));else if(corrupt)fs.writeFileSync(cache,'{ intentionally invalid JSON');
  record.setupMs=Date.now()-caseStarted;
  const originalOpen=fs.openSync,originalRename=fs.renameSync,originalFsync=fs.fsyncSync,cacheWrites=new Map(),cacheFDs=new Set(),controller=new AbortController();const abort=()=>controller.abort(options.signal?.reason);options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();const deadline=setTimeout(()=>controller.abort(Error('Case deadline exceeded')),15000);
  let result,error;const resolveStarted=Date.now();
  try{
   fs.openSync=function(file,...args){if(unreadable&&file===cache)throw Object.assign(Error('Injected unreadable disposable cache'),{code:'EACCES'});const began=Date.now(),fd=originalOpen.call(fs,file,...args);if(typeof file==='string'&&path.dirname(file)===path.dirname(cache)&&path.basename(file).startsWith('.endpoint.json.')&&file.endsWith('.tmp')){cacheWrites.set(file,began);cacheFDs.add(fd);}return fd;};
   fs.renameSync=function(from,to,...args){try{return originalRename.call(fs,from,to,...args);}finally{if(to===cache&&cacheWrites.has(from))record.cacheWriteMs+=Date.now()-cacheWrites.get(from);}};
   fs.fsyncSync=function(fd){const began=Date.now();try{return originalFsync.call(fs,fd);}finally{if(cacheFDs.has(fd))record.cacheFsyncMs+=Date.now()-began;}};
   result=await client.resolveEndpoint({hostId:credentials.hostId,stateDirectory,signal:controller.signal,request:async(url,settings)=>{const item={url,ok:false,statuscode:null};record.attempts.push(item);const attemptStarted=Date.now();try{const status=await client.requestStatus(url,settings);item.ok=true;item.statuscode=200;return status;}catch(error){item.errorCode=client.diagnostic(error).code;throw error;}finally{item.elapsedMs=Date.now()-attemptStarted;}},discover:async settings=>{record.discoveryCount++;record.discoveryStartedAfterAttempts=record.attempts.length;const discoveryStarted=Date.now();record.discoveryStartMs=discoveryStarted-resolveStarted;let ended=false;const markEnd=()=>{if(!ended){ended=true;record.discoveryMs=Date.now()-discoveryStarted;}};settings.signal?.addEventListener('abort',markEnd,{once:true});try{return simulated?[]:await lan.discover({...settings,onCandidate:url=>{record.firstCandidateMs??=Date.now()-discoveryStarted;settings.onCandidate?.(url);}});}finally{markEnd();settings.signal?.removeEventListener('abort',markEnd);}}});
  }catch(caught){error=caught;}finally{record.resolveMs=Date.now()-resolveStarted;fs.openSync=originalOpen;fs.renameSync=originalRename;fs.fsyncSync=originalFsync;clearTimeout(deadline);options.signal?.removeEventListener('abort',abort);}
  try{
   record.elapsedMs=Date.now()-caseStarted;
   assert(record.attempts[0]?.url===initial,'Initial numeric endpoint was not tried first');
   if(expectTimeout){assert(record.attempts[0]?.errorCode==='HOST_UNREACHABLE','Stalled TLS must return HOST_UNREACHABLE');assert(record.attempts[0]?.elapsedMs>=400&&record.attempts[0]?.elapsedMs<2000,'Stalled TLS did not respect the 500 ms probe deadline');}
   if(initial===badInitial)assert(record.attempts[0]?.ok===false,'Expected initial endpoint was not actually unreachable');
   if(cacheURL)assert(record.attempts[1]?.url===cacheURL,'Shared cache was not tried after initial endpoint failure');
   if(expectDiscovery)assert(record.discoveryStartedAfterAttempts>=(cacheURL?2:1),'Discovery started before required direct probes');
   assert(record.attempts.filter(item=>item.url===initial).length<=1,'Initial failed endpoint was probed more than once');assert(record.attempts.filter(item=>item.url===badCache).length<=1,'Stale cache endpoint was probed more than once');
   if(expectDiscovery)assert(record.discoveryCount===1,'Expected exactly one discovery');else assert(record.discoveryCount===0,'Discovery ran before a working initial/cache endpoint');
   if(simulated){assert(error?.code==='HOST_UNREACHABLE','Simulated no-advertisements outage must report HOST_UNREACHABLE');record.errorCode=error.code;assert(record.elapsedMs<15000,'Simulated outage exceeded deadline');}
   else{
    if(error)throw error;assert(result?.hostId===credentials.hostId,'Resolved host identity mismatch');assert(record.attempts.some(item=>item.url===result.url&&item.ok),'Resolved endpoint was not authenticated successfully');record.endpoint=result.url;
    const saved=JSON.parse(fs.readFileSync(cache,'utf8'));record.cacheMatches=saved.hostId===credentials.hostId&&saved.url===result.url;assert(record.cacheMatches,'Successful resolution did not write matching disposable cache');
    if(!expectDiscovery)assert(result.url===endpoint,'Initial/cache case resolved an unexpected endpoint');
   }
   record.passed=true;
  }catch(caught){record.failure={code:client.diagnostic(caught).code,checkCode:caught.code==='ACCEPTANCE_CHECK_FAILED'?caught.code:undefined,message:caught.code==='ACCEPTANCE_CHECK_FAILED'?caught.message:client.diagnostic(caught).message};}
  return stateDirectory;
 }
 try{
  stalledServer=net.createServer(socket=>{stalledSockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>stalledSockets.delete(socket));});
  await new Promise((resolve,reject)=>{stalledServer.once('error',reject);stalledServer.listen(0,'127.0.0.1',resolve);});
  const stalledURL=`https://127.0.0.1:${stalledServer.address().port}/mcp`;
  const cases=[['valid initial IP',{initial:endpoint,expectDiscovery:false}],['failed initial IP, valid shared cache',{cacheURL:endpoint,expectDiscovery:false}],['failed initial IP, missing cache, real LAN discovery',{}],['failed initial IP, stale cache, real LAN discovery',{cacheURL:badCache}],['failed initial IP, corrupted cache, real LAN discovery',{corrupt:true}],['failed initial IP, unreadable cache, real LAN discovery',{unreadable:true}],['stalled TLS initial endpoint, valid cache',{initial:stalledURL,cacheURL:endpoint,expectDiscovery:false,expectTimeout:true}],['stalled TLS initial endpoint, missing cache, real LAN discovery',{initial:stalledURL,expectTimeout:true}]];
  report.expectedCaseCount=cases.length+2;
  for(const [name,settings] of cases){options.signal?.throwIfAborted();await runCase(name,settings);}
  options.signal?.throwIfAborted();const recoveryState=await runCase('simulated outage: no advertisements',{cacheURL:badCache,simulated:true});options.signal?.throwIfAborted();await runCase('same disposable state recovers through real LAN discovery',{reuseState:recoveryState});
 }catch(error){report.failure=client.diagnostic(error);}finally{for(const socket of stalledSockets)socket.destroy();if(stalledServer?.listening)await new Promise(resolve=>stalledServer.close(resolve));fs.rmSync(root,{recursive:true,force:true});report.elapsedMs=Date.now()-started;report.completedAt=new Date().toISOString();report.passed=report.cases.length===report.expectedCaseCount&&report.cases.every(record=>record.passed)&&!report.failure;}
 return report;
}
async function main(argv=process.argv.slice(2)){
 const options=argumentsFrom(argv);if(options.help){console.log('PenEcho authenticated IP/cache/LAN discovery acceptance. Uses real LAN discovery and disposable credential/cache copies; real state is read-only.\n--module-dir ABS_DIR --host-id ID --state-directory ABS_REAL_STATE --endpoint https://PRIVATE_IP:PORT/mcp [--output REPORT.json]\nCovers initial IP, valid/missing/stale/corrupt/unreadable cache, stalled TLS with cache/discovery fallback, explicitly simulated no-advertisements outage, then real discovery recovery. Reports setup, resolve, discovery, first-candidate, cache-write and fsync timings. No server stop or AI config changes.');return 0;}
 const controller=new AbortController(),abort=()=>controller.abort(Error('Interrupted'));process.once('SIGINT',abort);process.once('SIGTERM',abort);
 try{const report=await runDiscoveryAcceptance({...options,signal:controller.signal});if(options.output){fs.mkdirSync(path.dirname(options.output),{recursive:true});fs.writeFileSync(options.output,JSON.stringify(report,null,2)+'\n',{mode:0o600});}console.log(JSON.stringify(report,null,2));return report.passed?0:1;}finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
module.exports={main,runDiscoveryAcceptance,argumentsFrom};
if(require.main===module)main().then(code=>{process.exitCode=code;},()=>{console.error('Discovery acceptance setup failed. Check module paths, host identity, endpoint, and readable imported trust.');process.exitCode=1;});
