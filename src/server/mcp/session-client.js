#!/usr/bin/env node
'use strict';
const https = require('node:https'),net=require('node:net');
const discovery = require('./discovery-client.js');
const MAX = 4 * 1024 * 1024;
function createTransportPool() {
  let scope, agent;
  return {
    get(url, credentials) {
      const next = JSON.stringify([new URL(url).origin, credentials.hostId, credentials.certificatePem, credentials.accessToken]);
      if (next !== scope) {
        agent?.destroy(); scope = next;
        agent = new https.Agent({keepAlive:true,maxSockets:4,maxFreeSockets:2});
        agent.on('free', socket => { socket.setTimeout(25000); });
      }
      return agent;
    },
    destroy() { agent?.destroy(); agent = undefined; scope = undefined; }
  };
}
function httpRequest(url, credentials, message, session, options = {}) {
  return new Promise((resolve, reject) => {
    let dispatched = false, size = 0; const chunks = [];
    const req = https.request(discovery.validateURL(url), {method:options.method || 'POST',ca:credentials.certificatePem,rejectUnauthorized:true,lookup:discovery.privateLookup,agent:options.agent ?? false,signal:options.signal,headers:{authorization:`Bearer ${credentials.accessToken}`,'content-type':'application/json',accept:'application/json, text/event-stream',...(session ? {'mcp-session-id':session} : {}),...(options.protocolVersion ? {'mcp-protocol-version':options.protocolVersion} : {})}}, res => {
      res.on('data', chunk => {size += chunk.length;if(size > MAX)req.destroy(Error('MCP response exceeds limit'));else chunks.push(chunk);});
      res.on('error', fail);res.on('end', () => {try {const raw=Buffer.concat(chunks).toString('utf8');resolve({status:res.statusCode,session:res.headers['mcp-session-id'],body:raw ? JSON.parse(raw) : null});} catch(e){fail(e);}});
    });
    function fail(e){e.dispatched=dispatched;e.transport=true;reject(e);}
    const setupTimer=setTimeout(()=>req.destroy(Error('MCP TCP/TLS connection deadline exceeded')),options.connectTimeoutMs || 1500);
    req.on('socket',socket=>{socket.setTimeout(0);const ready=()=>{clearTimeout(setupTimer);dispatched=true;};if(req.reusedSocket || socket.encrypted&&!socket.connecting&&socket.authorized)ready();else socket.once('secureConnect',ready);});
    const timer=setTimeout(()=>req.destroy(Error('MCP HTTPS deadline exceeded')),options.timeoutMs || 120000);
    req.once('close',()=>{clearTimeout(timer);clearTimeout(setupTimer);});req.on('error',fail);req.end(message === undefined ? undefined : JSON.stringify(message));
  });
}
function createSessionClient(options = {}) {
  const input=options.stdin || process.stdin, output=options.stdout || process.stdout;
  const request=options.request || httpRequest, resolve=options.resolveEndpoint || discovery.resolveEndpoint;
  const now=options.now || Date.now;
  let credentials, endpoint, session, initialization, initFlight, buffer='', pending=0, closed=false, closing, lastActivity=now(), sequence=0, protocolVersion;
  const starts=new Map(),lifetime=new AbortController(),pool=createTransportPool();
  function safeMessage(error){let message=String(error?.message || 'PenEcho request failed');for(const secret of [credentials?.accessToken,credentials?.certificatePem,credentials?.privateKey,credentials?.key])if(typeof secret==='string'&&secret)message=message.split(secret).join('[redacted]');return message.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g,'[redacted]').slice(0,1000);}
  let active=0, controlActive=0; const controls=[], controlKeys=new Set(), activeOwners=new Map(), queued=[], lanes=new Set(), lifecycle=Symbol('lifecycle');
  function pump() {
    if(lanes.has(lifecycle))return;
    while(active<4) {
      // A blocked document does not hold unrelated work behind it. Lifecycle
      // barriers still wait for all earlier work and block later submissions.
      const index=queued.findIndex((item,i)=>!lanes.has(item.keyFor())&&
        !queued.slice(0,i).some(prior=>prior.barrier)&&(!item.barrier||active===0&&i===0));
      if(index<0)return;
      const item=queued.splice(index,1)[0];item.key=item.keyFor();active++;lanes.add(item.key);
      void item.run().finally(()=>{active--;lanes.delete(item.key);pump();});
      if(item.barrier)return;
    }
  }
  function pumpControls() {
    while(controlActive<4&&controls.length) {
      const item=controls.shift();controlActive++;
      void (async()=>{
        try {
          // Cancellation belongs to the owner that accepted the original call;
          // it must not initialize or retry against a replacement connection.
          if(!closed&&session===item.owner)await send(item.message,item.owner,{timeoutMs:1500,agent:false});
        }catch{}finally{
          controlActive--;pending--;controlKeys.delete(item.key);pumpControls();
        }
      })();
    }
  }
  const write=value=>{if(value?.error?.message)value={...value,error:{...value.error,message:safeMessage(value.error)}};if(!closed)output.write(JSON.stringify(value)+'\n');};
  async function locate(){if(closed)throw Error('MCP client is closed');credentials=await (options.loadCredentials || discovery.loadCredentials)(options.hostId,options);endpoint=(await resolve({...options,initialUrl:endpoint&&net.isIP(new URL(endpoint).hostname.replace(/^\[|\]$/g,''))?endpoint:options.initialUrl,signal:lifetime.signal})).url;if(closed)throw Error('MCP client is closed');}
  async function send(message, sid=session, extra={}){return request(endpoint,credentials,message,sid,{protocolVersion,signal:lifetime.signal,agent:message?.method==='notifications/cancelled'?false:pool.get(endpoint,credentials),...extra});}
  function checked(response){if(response.status<200||response.status>=300)throw Object.assign(Error(`PenEcho HTTPS returned ${response.status}`),{status:response.status});return response;}
  async function ensure(){
    if(initFlight)return initFlight;if(session)return;
    if(!initialization)throw Error('Send initialize before MCP requests');
    initFlight=(async()=>{
      for(let attempt=0;attempt<2;attempt++){
        try{
          await locate();
          const response=checked(await send({...initialization,id:`penecho-init-${++sequence}`},undefined,{timeoutMs:1500,signal:undefined}));
          if(response.body?.error)throw Error(response.body.error.message);
          if(!response.session)throw Error('PenEcho initialize did not return a session');
          session=response.session;protocolVersion=response.body?.result?.protocolVersion;
          if(closed){await release();throw Error('MCP client is closed');}
          checked(await send({jsonrpc:'2.0',method:'notifications/initialized'},session,{timeoutMs:1500}));
          return response.body?.result;
        }catch(error){await release();if(closed||attempt||!(error.dispatched===false||error.status===404))throw error;}
      }
    })();
    try{return await initFlight;}finally{initFlight=null;}
  }

  async function restore(message){
    const args=message.params?.arguments, old=args?.sessionId;if(!old)return message;
    const saved=starts.get(old);if(!saved)return message;
    if(saved.owner===session)return {...message,params:{...message.params,arguments:{...args,sessionId:saved.current}}};
    if(!saved.args.sessionKey || !saved.documentId)throw Error('Canvas recovery requires the original explicit sessionKey and documentId; call penecho_start_session with both to reconnect safely');
    if(saved.restoreFlight){await saved.restoreFlight;return restore(message);}
    const owner=session;
    saved.restoreFlight=(async()=>{
    const restoreArgs={...saved.args,documentId:saved.documentId};delete restoreArgs.target;
    const response=checked(await send({jsonrpc:'2.0',id:`penecho-restore-${++sequence}`,method:'tools/call',params:{name:'penecho_start_session',arguments:restoreArgs}}));
    const result=response.body?.result?.structuredContent;
    if(response.body?.error || response.body?.result?.isError || !result?.sessionId || result.documentId!==saved.documentId || saved.args.canvasId&&result.canvasId!==saved.args.canvasId)throw Error('Canvas recovery could not verify the original document; explicitly reconnect with sessionKey and documentId');
    saved.current=result.sessionId;saved.owner=owner;
    })();
    try{await saved.restoreFlight;}finally{saved.restoreFlight=undefined;}
    return restore(message);
  }
  const cancelledRequests=new Set();
  function assertNotCancelled(message){if(cancelledRequests.has(message.id))throw Object.assign(Error("Request cancelled"),{code:-32800});}
  async function execute(message){
    assertNotCancelled(message);
    if(message.method==='initialize'){
      if(initialization)throw Error('MCP client is already initialized');initialization=message;
      try{return {jsonrpc:'2.0',id:message.id,result:await ensure()};}catch(error){await release();initialization=undefined;throw error;}
    }
    if(message.params?.name==='penecho_start_session'&&starts.size>=128)throw Error('This MCP process has reached its 128 Canvas handle limit; close it and reconnect using the existing sessionKey and documentId');
    await ensure();let response;
    for(let attempt=0;attempt<3;attempt++){
      let owner=session;
      try{assertNotCancelled(message);if(Object.hasOwn(message,'id'))activeOwners.set(message.id,null);const restored=await restore(message);assertNotCancelled(message);owner=session;if(Object.hasOwn(message,'id'))activeOwners.set(message.id,owner);response=await send(restored,owner);}catch(e){
        if(e.transport||typeof e.dispatched==='boolean'){if(session===owner)session=undefined;if(e.dispatched!==false)throw Error('PenEcho connection failed; request may have completed. Inspect Canvas before retrying: '+e.message);if(attempt===2)throw e;await ensure();continue;}
        if(e.status===404&&attempt<2){if(session===owner)session=undefined;await ensure();continue;}throw e;
      }
      if(response.status===404){if(session===owner)session=undefined;if(attempt<2){await ensure();continue;}}
      checked(response);
      const failure=response.body?.result?.isError&&response.body.result.structuredContent,saved=starts.get(message.params?.arguments?.sessionId);
      if(attempt<2&&saved&&['session_expired','session_not_found'].includes(failure?.code)){
        const details=failure.details;
        if(failure.code==='session_expired'&&details?.retry!=='penecho_start_session'||details?.documentId&&details.documentId!==saved.documentId||details?.sessionKey&&details.sessionKey!==saved.args.sessionKey)break;
        saved.owner=undefined;continue;
      }
      break;
    }
    const result=response?.body?.result?.structuredContent;
    if(message.params?.name==='penecho_start_session'&&result?.sessionId&&!response.body.result.isError)starts.set(result.sessionId,{args:{...message.params.arguments,...(result.canvasId ? {canvasId:result.canvasId} : {})},documentId:result.documentId,owner:session,current:result.sessionId});
    const original=message.params?.arguments?.sessionId,saved=starts.get(original);
    if(saved&&saved.current!==original&&response?.body?.result){
      const normalize=value=>value&&typeof value==='object'&&value.sessionId===saved.current ? {...value,sessionId:original} : value;
      response.body.result.structuredContent=normalize(response.body.result.structuredContent);
      for(const item of response.body.result.content || [])if(item.type==='text')try{const parsed=JSON.parse(item.text);if(parsed?.sessionId===saved.current)item.text=JSON.stringify(normalize(parsed));}catch{}
    }
    if(message.params?.name==='penecho_close_session'&&!response?.body?.error&&!response?.body?.result?.isError)starts.delete(original);
    return response?.body;
  }
  async function release(){const old=session;session=undefined;if(old&&endpoint)try{await send(undefined,old,{method:'DELETE',timeoutMs:1000,signal:undefined});}catch{}}
  async function close(){if(closing)return closing;closed=true;lifetime.abort();clearInterval(timer);input.removeListener('data',data);closing=(async()=>{if(initFlight){let deadline;await Promise.race([initFlight.catch(()=>{}),new Promise(r=>{deadline=setTimeout(r,2000);})]);clearTimeout(deadline);}await release();pool.destroy();options.onExit?.(0);})();return closing;}
  function accept(message){
    if(!message||message.jsonrpc!=='2.0'||typeof message.method!=='string'){write({jsonrpc:'2.0',id:message?.id??null,error:{code:-32600,message:'Invalid JSON-RPC request'}});return;}
    if(message.method==='notifications/cancelled') {
      const index=queued.findIndex(item=>Object.hasOwn(item.message,'id')&&item.message.id===message.params?.requestId);
      if(index>=0){const [item]=queued.splice(index,1);pending--;write({jsonrpc:'2.0',id:item.message.id,error:{code:-32800,message:'Request cancelled'}});pump();return;}
      const key=message.params?.requestId;
      if(!activeOwners.has(key))return;
      cancelledRequests.add(key);
      if(!session||!activeOwners.get(key)||controlKeys.has(key)||controlKeys.size>=20)return;
      controlKeys.add(key);pending++;controls.push({key,message,owner:activeOwners.get(key)});pumpControls();return;
    }
    if(pending>=64){write({jsonrpc:'2.0',id:message.id??null,error:{code:-32000,message:'MCP request queue is full'}});return;}
    const activity=message.method!=='ping'&&message.method!=='notifications/initialized';
    pending++;if(activity)lastActivity=now();
    const run=async()=>{const hasId=Object.hasOwn(message,'id');try{if(closed)return;if(hasId)activeOwners.set(message.id,null);const response=await execute(message);if(Object.hasOwn(message,'id')&&response)write(response);}catch(e){if(Object.hasOwn(message,'id'))write({jsonrpc:'2.0',id:message.id,error:{code:e.code===-32800?-32800:-32000,message:safeMessage(e)}});}finally{if(hasId){activeOwners.delete(message.id);cancelledRequests.delete(message.id);}pending--;if(activity)lastActivity=now();}};
    {
      const args=message.params?.arguments || {}, barrier=message.method==='initialize'||message.params?.name==='penecho_start_session';
      const independent=Symbol();
      const keyFor=()=>barrier?lifecycle:starts.get(args.sessionId)?.documentId||args.documentId||args.sessionId||independent;
      queued.push({run,keyFor,barrier,message});pump();
    }
  }
  function data(chunk){buffer+=chunk.toString('utf8');if(Buffer.byteLength(buffer)>MAX){void close();return;}let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;try{accept(JSON.parse(line));}catch{write({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}});}}}
  input.setEncoding?.('utf8');input.on('data',data);input.once('end',close);input.once('close',close);
  const timer=setInterval(()=>{if(closed||pending)return;const idle=now()-lastActivity;if(options.idleExitMs>0&&idle>=options.idleExitMs)void close();else if(session&&idle>=(options.idleTimeoutMs??1800000)){pending++;void release().finally(()=>pending--);}},options.tickMs||250);
  return {close,accept,get sessionId(){return session;},get pendingCount(){return pending;},get rememberedCount(){return starts.size;}};
}
async function main(argv=process.argv.slice(2)){
  const options={onExit:code=>process.exit(code)};
  try{for(let i=0;i<argv.length;i++){const flag=argv[i];if(flag==='--help'){process.stdout.write('PenEcho per-session stdio HTTPS bridge\n--host-id ID [--state-directory DIR] [--idle-timeout-ms 1800000] [--idle-exit-ms MS]\nRaw image upload: node client.js --host-id ID --upload-image /absolute/image.png --canvas-id C --document-id D [--request-id R] [--state-directory DIR]\nCanvas recovery across process restarts requires the client to retain sessionKey and documentId.\n');return 0;}const key={'--upload-image':'uploadImage','--canvas-id':'canvasId','--document-id':'documentId','--request-id':'requestId','--host-id':'hostId','--state-directory':'stateDirectory','--idle-timeout-ms':'idleTimeoutMs','--idle-exit-ms':'idleExitMs'}[flag];if(!key||!argv[i+1])throw Error('Unknown or incomplete option');options[key]=key.endsWith('Ms')?Number(argv[++i]):argv[++i];if(key.endsWith('Ms')&&(!Number.isFinite(options[key])||options[key]<=0))throw Error('Idle timeout must be positive');}if(!/^[a-f0-9]{64}$/i.test(options.hostId||''))throw Error('--host-id is required');if(options.uploadImage){const controller=new AbortController(),abort=()=>controller.abort();for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.once(signal,abort);try{return await require('./image-upload-client.js').main({...options,signal:controller.signal});}finally{for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.removeListener(signal,abort);}}if(options.canvasId||options.documentId||options.requestId)throw Error('Image target options require --upload-image');const client=createSessionClient(options);for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.once(signal,()=>void client.close());return 0;}catch(e){process.stderr.write(e.message+'\n');return 1;}
}
module.exports={createSessionClient,httpRequest,createTransportPool,main};
if(require.main===module)main().then(code=>{process.exitCode=code;});
