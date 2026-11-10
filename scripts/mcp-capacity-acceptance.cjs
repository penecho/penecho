#!/usr/bin/env node
'use strict';
// Isolated service acceptance only: no Canvas, model, existing user state, or full runtime.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),https=require('node:https'),net=require('node:net');
const {createDirectHttpService}=require('../src/server/mcp/direct-http-service.js');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){const deadline=Date.now()+10000;while(!predicate()){if(Date.now()>=deadline)throw Error('Timed out: '+label);await sleep(5);}}
async function parallel(count,concurrency,fn){let next=0,failure;const result=Array(count);await Promise.all(Array.from({length:Math.min(count,concurrency)},async()=>{while(next<count&&!failure){const index=next++;try{result[index]=await fn(index);}catch(error){failure=error;}}}));if(failure)throw failure;return result;}
async function runCapacityAcceptance(){
 const started=Date.now(),directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'penecho-capacity-'));const report={isolated:true,noModelCalls:true,noCanvasCalls:true,startedAt:new Date(started).toISOString(),checks:[],passed:false};
 let clock=1000,status,sequence=0,holding=false,port;const held=[],disposals=new Set(),requests=new Set(),pendingResponses=[];
 const service=createDirectHttpService({stateDirectory:directory,preferredPort:0,getHostnames:()=>[],getAddresses:()=>[],announce:()=>({close(){}}),now:()=>clock,disposeOwner:owner=>disposals.add(owner),callTool:async(owner,name,args,{signal})=>holding?new Promise(resolve=>held.push({resolve,signal,owner})):({ok:true})});
 const check=(name,condition,details={})=>{report.checks.push({name,passed:!!condition,...details});if(!condition)throw Error('Check failed: '+name);};
 const request=(method='POST',message,session)=>new Promise((resolve,reject)=>{
  let bytes=0,body='';const req=https.request(status.localUrl,{method,ca:status.certificatePem,rejectUnauthorized:true,agent:false,headers:{authorization:`Bearer ${status.accessToken}`,'content-type':'application/json',...(session?{'mcp-session-id':session}:{})}},res=>{res.setEncoding('utf8');res.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>4*1024*1024)req.destroy(Error('Response exceeded limit'));else body+=chunk;});res.once('error',reject);res.once('end',()=>{try{resolve({status:res.statusCode,session:res.headers['mcp-session-id'],body:body?JSON.parse(body):null});}catch{reject(Error('Invalid JSON response'));}});});requests.add(req);const timer=setTimeout(()=>req.destroy(Error('Request deadline exceeded')),10000);req.once('close',()=>{clearTimeout(timer);requests.delete(req);});req.once('error',reject);req.end(message===undefined?undefined:JSON.stringify(message));
 });
 const rpc=(method,session)=>request('POST',{jsonrpc:'2.0',id:++sequence,method,...(method==='tools/call'?{params:{name:'capacity_fixture',arguments:{}}}:{})},session);
 const hold=session=>{const promise=rpc('tools/call',session).catch(error=>({requestError:error.code || error.message}));pendingResponses.push(promise);return promise;};
 const release=()=>{holding=false;for(const item of held.splice(0))item.resolve({ok:true});};
 try{
  status=await service.start();port=Number(new URL(status.localUrl).port);report.limits={...status.limits};check('production protocol limits',status.limits.sessions===256&&status.limits.requests===32&&status.limits.requestsPerSession===8,status.limits);
  const phase=Date.now(),sessions=await parallel(256,8,async()=>{const response=await rpc('initialize');checkResponse(response,200,'initialize');if(!response.session)throw Error('Missing session ID');return response.session;});report.initialize256Ms=Date.now()-phase;
  check('256 independent sessions accepted',new Set(sessions).size===256&&service.status().sessionCount===256,{accepted:sessions.length});
  check('257th session rejected', (await rpc('initialize')).status===429);
  checkResponse(await request('DELETE',undefined,sessions[0]),200,'delete');const replacement=await rpc('initialize');check('DELETE frees session capacity',replacement.status===200&&!!replacement.session&&disposals.size===1);sessions[0]=replacement.session;
  holding=true;const perSession=Array.from({length:8},()=>hold(sessions[0]));await until(()=>held.length===8,'eight active requests');check('eight concurrent requests accepted for one session',held.length===8);check('ninth request in same session rejected',(await rpc('tools/call',sessions[0])).status===429);release();const perResults=await Promise.all(perSession);check('eight held requests complete',perResults.every(result=>result.status===200&&!result.body?.error&&!result.body?.result?.isError));
  holding=true;const global=Array.from({length:32},(_,index)=>hold(sessions[Math.floor(index/8)]));await until(()=>held.length===32,'32 active requests');check('32 global requests across four sessions accepted',held.length===32&&new Set(held.map(item=>item.owner)).size===4);check('33rd global request rejected',(await rpc('tools/call',sessions[4])).status===429);
  clock+=30*60*1000+1;check('idle expiry preserves active owners and in-flight work',service.status().sessionCount===4&&held.every(item=>!item.signal.aborted),{activeOwners:service.status().sessionCount});
  release();const globalResults=await Promise.all(global);check('32 held requests complete after release',globalResults.every(result=>result.status===200&&!result.body?.error&&!result.body?.result?.isError));check('new call succeeds after saturation', (await rpc('tools/call',sessions[0])).status===200);
 }catch(error){report.failure={code:error.code || 'ACCEPTANCE_FAILED',message:error.message};}
 finally{
  release();for(const req of requests)req.destroy();await Promise.allSettled(pendingResponses);await service.close();
  report.disposedOwnerCount=disposals.size;report.checks.push({name:'all accepted HTTP owners reclaimed',passed:disposals.size===257,expected:257,actual:disposals.size});report.checks.push({name:'service closed and sessions empty',passed:service.status().enabled===false&&service.status().sessionCount===0});
  if(port){const probe=net.createServer();try{await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'0.0.0.0',resolve);});report.checks.push({name:'TCP listening port released',passed:true});}catch(error){report.checks.push({name:'TCP listening port released',passed:false,code:error.code});}finally{if(probe.listening)await new Promise(resolve=>probe.close(resolve));}}
  fs.rmSync(directory,{recursive:true,force:true});report.elapsedMs=Date.now()-started;report.completedAt=new Date().toISOString();report.passed=!report.failure&&report.checks.every(item=>item.passed);
 }
 return report;
}
function checkResponse(response,expected,label){if(response.status!==expected)throw Error(`${label} returned ${response.status}, expected ${expected}`);}
async function main(argv=process.argv.slice(2)){
 let output;for(let index=0;index<argv.length;index++){if(argv[index]==='--help'){console.log('Isolated PenEcho MCP capacity acceptance: 256 sessions, 8 requests/session, 32 global requests. No live Canvas, full PenEcho runtime, or model calls.\nUsage: node scripts/mcp-capacity-acceptance.cjs [--output REPORT.json]');return 0;}if(argv[index]==='--output'&&argv[index+1])output=path.resolve(argv[++index]);else throw Error('Unknown or incomplete option');}
 const report=await runCapacityAcceptance();if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});}console.log(JSON.stringify(report,null,2));return report.passed?0:1;
}
module.exports={runCapacityAcceptance,main};
if(require.main===module)main().then(code=>{process.exitCode=code;},error=>{console.error(error.message);process.exitCode=1;});
