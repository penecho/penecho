"use strict";
const https = require('node:https');
const {prepareUploadedImage,MAX_BYTES} = require('./image-upload.js');
const {listenMcp} = require('./listen.js');
const crypto = require('node:crypto');
const {loadDirectHttpIdentity, createDirectHttpLeaf, resetDirectHttpIdentity} = require('./direct-http-identity.js');
const {lanAddresses, isPrivateAddress} = require('./network-addresses.js');
const {createAnnouncer} = require('./lan-discovery.js');
const {INSTRUCTIONS, PROMPTS, PROTOCOL_VERSION, promptResult, captureToolResult} = require('./protocol.js');
const {TOOLS, validateToolArguments} = require('./schema.js');
const {RESOURCES, readResource} = require('./resources.js');
const {getAuthoringGuidance} = require('./authoring-guidance.js');
const normal = value => ({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
const fault = (status, message) => Object.assign(new Error(message), {status});
const keyOf = id => `${typeof id}:${id}`;
const boundedMs = (value, fallback) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : fallback; };
function settleWithin(promise, timeoutMs) {
  let timer, timedOut = false;
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => { timedOut = true; resolve(); }, boundedMs(timeoutMs, 1));
    timer.unref?.();
  });
  return Promise.race([Promise.resolve(promise).catch(() => {}), deadline]).then(() => timedOut).finally(() => clearTimeout(timer));
}
function readRequestBody(req, maxBytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0, done = false, timer;
    const cleanup = () => {
      clearTimeout(timer);
      req.off('data', data);
      req.off('end', end);
      req.off('aborted', aborted);
      req.off('error', error);
    };
    const finish = (failure, value) => {
      if (done) return;
      done = true;
      cleanup();
      failure ? reject(failure) : resolve(value);
    };
    const closeRequest = () => {
      // Let the response carry the connection-close decision. Destroying the
      // request immediately would also tear down the response before a client
      // can receive the bounded error. Resume the stream so the parser cannot
      // retain a paused request while the response is being written.
      try { req.resume(); } catch {}
    };
    const data = chunk => {
      length += chunk.length;
      if (length > maxBytes) {
        closeRequest();
        finish(fault(413, 'Request too large'));
        return;
      }
      chunks.push(chunk);
    };
    const end = () => finish(null, Buffer.concat(chunks, length));
    const aborted = () => finish(fault(408, 'Request body was cancelled or timed out'));
    const error = error => finish(error || fault(400, 'Request body could not be read'));
    timer = setTimeout(() => {
      closeRequest();
      finish(fault(408, 'Request body timed out'));
    }, boundedMs(timeoutMs, 1));
    timer.unref?.();
    req.on('data', data);
    req.once('end', end);
    req.once('aborted', aborted);
    req.once('error', error);
  });
}
function send(res, status, value, headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff', ...headers});
  res.end(value === undefined ? undefined : JSON.stringify(value));
}
function createDirectHttpService({preferredPort=3922,getHostnames=()=>{const host=require('node:os').hostname().toLowerCase().replace(/\.$/,'');return host.endsWith('.local')?[host]:[host,host+'.local'];},stateDirectory, callTool, uploadImage, uploadTimeoutMs = 30000, uploadCancelGraceMs = 1000, requestCancelGraceMs = 1000, requestBodyTimeoutMs = 15000, disposeOwner, getAddresses = lanAddresses, announce = createAnnouncer, now = Date.now, onChange = () => {}, sessionIdleMs = 30 * 60 * 1000, maxSessions = 256, maxSessionRequests = 8, maxRequests = 32}) {
  if(!Number.isInteger(preferredPort)||preferredPort<0||preferredPort>65535)throw new TypeError('Invalid preferred MCP port');
  const hostnames=[...new Set(getHostnames())].filter(host=>typeof host==='string'&&/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.local)?$/i.test(host)).map(host=>host.toLowerCase());
  let identity, server, announcer, timer, startedAt, addresses = [], transition = Promise.resolve(), active = 0;
  const sessions = new Map(), sockets = new Set(), uploads = new Set();
  const limits = {sessions:maxSessions,requestsPerSession:maxSessionRequests,requests:maxRequests,tcpConnections:512};
  const timeouts = {sessionIdleMs,pressureIdleMs:60000,keepAliveMs:30000,headersMs:10000,requestUploadMs:15000};
  const notify = () => { try { onChange(); } catch {} };
  const currentAddresses = () => [...new Set(getAddresses().filter(isPrivateAddress))].sort();
  function refresh() {
    const next = currentAddresses();
    if (JSON.stringify(next) !== JSON.stringify(addresses)) {
      if (server) server.setSecureContext(createDirectHttpLeaf(identity, next, hostnames));
      addresses = next; notify();
    }
  }
  function remove(session) {
    if (!sessions.delete(session.id)) return;
    for (const pending of session.pending.values()) pending.abort();
    try { Promise.resolve(disposeOwner(session.ownerId)).catch(() => {}); } catch {}
    notify();
  }
  function prune() { for (const s of sessions.values()) if (!s.active && now() - s.lastSeen >= sessionIdleMs) remove(s); }
  function status() {
    if (server?.listening) { refresh(); prune(); }
    const port = server?.address()?.port;
    return {enabled:!!port, preferredUrl:port&&hostnames.length?`https://${hostnames[0]}:${port}/mcp`:'', urls:port ? addresses.map(a => `https://${a}:${port}/mcp`) : [], localUrl:port ? `https://127.0.0.1:${port}/mcp` : '', hostId:identity?.hostId || '', certificatePem:identity?.certificatePem || '', accessToken:identity?.accessToken || '', startedAt:startedAt || null, sessionCount:sessions.size,limits:{...limits},timeouts:{...timeouts}};
  }
  function toolFailure(error) {
    const redact = value => String(value).split(identity.accessToken).join('[redacted]').split(identity.key).join('[redacted]').replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[redacted]');
    const failure = {code:redact(error.code || 'mcp_error').slice(0,80),message:redact(error.message || 'Tool failed').slice(0,1000)};
    // Walk a bounded plain JSON subset: details can guide recovery without carrying secrets or huge data.
    let budget = 8192;
    const clean = (value, depth = 0) => {
      if (budget <= 0 || depth > 6) return '[truncated]';
      if (value === null || typeof value === 'boolean' || typeof value === 'number') { budget -= 16; return value; }
      if (typeof value === 'string') { const text = redact(value).slice(0, Math.min(2000,budget)); budget -= text.length; return text; }
      if (!value || typeof value !== 'object') return undefined;
      const output = Array.isArray(value) ? [] : {};
      for (const key of Object.keys(value).slice(0,64)) {
        if (budget <= 0) break;
        const safeKey = redact(key).slice(0,120); budget -= safeKey.length;
        if (/token|secret|password|authorization|private.?key/i.test(key)) output[safeKey] = '[redacted]';
        else Object.defineProperty(output,safeKey,{value:clean(value[key],depth + 1),enumerable:true,configurable:true,writable:true});
      }
      return output;
    };
    if (error.details !== undefined) { try { failure.details = clean(error.details); if (Buffer.byteLength(JSON.stringify(failure.details) || '') > 16384) failure.details = '[truncated]'; } catch { failure.details = '[unavailable]'; } }
    return failure;
  }
  const rpc = require("./rpc.js").createMcpRpc({callTool,toolFailure});
  async function imageUpload(req,res) {
    if(req.method!=='POST') throw fault(405,'Use POST');
    if(typeof uploadImage!=='function') throw fault(404,'Image upload is unavailable');
    if(req.url.includes('#') || /%(?![0-9a-f]{2})/i.test(req.url)) throw fault(400,'Invalid upload URL');
    const url=new URL(req.url,'https://localhost');
    const fields={canvasId:128,documentId:256,requestId:128,name:200}, args={};
    for(const key of url.searchParams.keys()) if(!Object.hasOwn(fields,key)) throw fault(400,'Unexpected upload parameter');
    for(const [key,max] of Object.entries(fields)) {
      const values=url.searchParams.getAll(key), value=values[0];
      if(values.length!==1 || !value?.trim() || value.length>max || /[\x00-\x1f\x7f]/.test(value)) throw fault(400,'Invalid upload parameter: '+key);
      args[key]=value;
    }
    if(!/^application\/octet-stream$/i.test(req.headers['content-type']||'')) throw fault(415,'Use application/octet-stream');
    if(req.headers['content-encoding'] && req.headers['content-encoding']!=='identity') throw fault(415,'Content encoding is unsupported');
    if(Number(req.headers['content-length'])>MAX_BYTES) throw fault(413,'Image exceeds 32 MiB');
    if(active>=maxRequests || uploads.size>=2) throw fault(429,'Busy');
    const controller=new AbortController(); uploads.add(controller); active++;
    const abort=()=>controller.abort();
    const timer=setTimeout(abort,boundedMs(uploadTimeoutMs,30000)); timer.unref();
    req.once('aborted',abort);res.once('close',abort);
    let cancel;
    const cancelled=new Promise((_,reject)=>{cancel=()=>reject(Object.assign(fault(408,'Upload cancelled or timed out'),{code:'upload_cancelled'}));controller.signal.addEventListener('abort',cancel,{once:true});});
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      uploads.delete(controller);
      active--;
    };
    const operation=(async()=>{
      const bytes=await new Promise((resolve,reject)=>{
        const chunks=[];let size=0;
        const clean=()=>{req.off('data',data);req.off('end',end);req.off('error',error);controller.signal.removeEventListener('abort',aborted);};
        const error=e=>{clean();reject(e);};
        const aborted=()=>error(fault(408,'Upload cancelled or timed out'));
        const data=chunk=>{size+=chunk.length;if(size>MAX_BYTES){req.pause();error(fault(413,'Image exceeds 32 MiB'));}else chunks.push(chunk);};
        const end=()=>{clean();resolve(Buffer.concat(chunks,size));};
        req.on('data',data);req.once('end',end);req.once('error',error);controller.signal.addEventListener('abort',aborted,{once:true});
      });
      const prepared=await prepareUploadedImage(bytes,args.name,{signal:controller.signal});
      controller.signal.throwIfAborted();
      return uploadImage({...args,...prepared},{signal:controller.signal});
    })();
    operation.then(release, release);
    try { send(res,200,await Promise.race([operation,cancelled])); }
    catch(e) { const failure=toolFailure(e);send(res,e.status||500,{error:{code:failure.code,message:e.status||e.code?failure.message:'Image upload failed'}},{connection:'close'}); }
    finally {
      clearTimeout(timer);req.off('aborted',abort);res.off('close',abort);controller.signal.removeEventListener('abort',cancel);
      // Response cancellation does not end backend work; retain its execution slot
      // until settlement so repeated cancellations cannot bypass admission.
    }
  }
  async function handle(req, res) {
    let session, counted = false, pendingKey, requestController, cancelListener;
    try {
      refresh(); prune();
      const seenHeaders=new Set();
      for(let i=0;i<req.rawHeaders.length;i+=2) {
        const key=req.rawHeaders[i].toLowerCase();
        if(['host','authorization','origin','content-type','content-length','transfer-encoding','content-encoding'].includes(key) && seenHeaders.has(key)) throw fault(400,'Duplicate request header');
        seenHeaders.add(key);
      }
      const address = String(req.socket.remoteAddress || '').replace(/^::ffff:/,'');
      const port = server.address().port;
      const hosts = new Set(['localhost','127.0.0.1',...hostnames,...addresses].map(a => `${a}:${port}`));
      if (!(address === '127.0.0.1' || isPrivateAddress(address)) || !hosts.has(String(req.headers.host||'').toLowerCase())) throw fault(403,'Forbidden');
      if (req.headers.origin !== undefined) {
        let origin; try { origin = new URL(req.headers.origin); } catch { throw fault(403,'Forbidden'); }
        if (origin.origin !== req.headers.origin || origin.protocol !== 'https:' || !hosts.has(origin.host)) throw fault(403,'Forbidden');
      }
      const expected = Buffer.from(`Bearer ${identity.accessToken}`), supplied = Buffer.from(req.headers.authorization || '');
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied,expected)) throw fault(401,'Unauthorized');
      if (req.url === '/status' && req.method === 'GET') return send(res,200,{hostId:identity.hostId,startedAt,sessionCount:sessions.size,protocolVersion:PROTOCOL_VERSION,limits:{...limits},timeouts:{...timeouts}});
      if (req.url === '/mcp/images' || req.url.startsWith('/mcp/images?')) return await imageUpload(req,res);
      if (req.url !== '/mcp') throw fault(404,'Not found');
      if (!['POST','DELETE'].includes(req.method)) return send(res,405,{error:'Method Not Allowed'},{allow:'POST, DELETE'});
      const sessionId = req.headers['mcp-session-id'];
      if (sessionId !== undefined) {
        session = sessions.get(sessionId);
        if (!session) throw fault(404,'Session not found');
        session.lastSeen = now();
      }
      if (req.method === 'DELETE') {
        if (req.headers['mcp-protocol-version'] !== undefined && req.headers['mcp-protocol-version'] !== PROTOCOL_VERSION) throw fault(400,'Unsupported MCP protocol version');
        if (!session) throw fault(400,'Mcp-Session-Id is required');
        remove(session); return send(res,200,{});
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw fault(415,'Use application/json');
      const bodyBytes = await readRequestBody(req, 3 * 1024 * 1024, requestBodyTimeoutMs);
      let body; try { body = JSON.parse(bodyBytes); } catch { throw fault(400,'Invalid JSON'); }
      if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string' || (body.id !== undefined && typeof body.id !== 'string' && !(typeof body.id === 'number' && Number.isFinite(body.id)))) return send(res,400,{jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request'}});
      if (body.method !== 'initialize' && req.headers['mcp-protocol-version'] !== undefined && req.headers['mcp-protocol-version'] !== PROTOCOL_VERSION) throw fault(400,'Unsupported MCP protocol version');
      if (body.method === 'initialize') {
        if (session || body.id === undefined) throw fault(400,'Invalid initialize');
        if (active >= maxRequests) throw fault(429,'Busy');
        if (sessions.size >= maxSessions) {
          const idle = [...sessions.values()].filter(s => !s.active && !s.pending.size && now() - s.lastSeen >= 60000).sort((a,b) => a.lastSeen-b.lastSeen)[0];
          if (!idle) throw fault(429,'Session limit');
          remove(idle);
        }
        session = {id:crypto.randomBytes(32).toString('hex'),ownerId:crypto.randomUUID(),lastSeen:now(),active:0,pending:new Map()};
        sessions.set(session.id,session); notify();
      } else if (!session) throw fault(400,'Mcp-Session-Id is required');
      if (!sessions.has(session.id)) throw fault(404,'Session not found');
      if (body.id === undefined) {
        if (body.method === 'notifications/cancelled') session.pending.get(keyOf(body.params?.requestId))?.abort();
        return send(res,202);
      }
      if (active >= maxRequests || session.active >= maxSessionRequests) throw fault(429,'Busy');
      active++; session.active++; counted = true;
      pendingKey = keyOf(body.id);
      if (session.pending.has(pendingKey)) { pendingKey = undefined; throw fault(409,'Request ID already active'); }
      requestController = new AbortController(); session.pending.set(pendingKey,requestController);
      let cancelResponse;
      cancelListener = () => {
        cancelResponse?.({jsonrpc:'2.0',id:body.id,error:{code:-32800,message:'Request cancelled'}});
      };
      const cancelled = new Promise(resolve => { cancelResponse = resolve; requestController.signal.addEventListener('abort', cancelListener, {once:true}); });
      if (requestController.signal.aborted) cancelListener();
      // Keep the slot occupied until the operation settles, even when cancellation wins.
      const operation = rpc(body,session,requestController.signal);
      const executionSession = session;
      const releaseExecution = () => { active--; executionSession.active--; executionSession.lastSeen = now(); };
      operation.then(releaseExecution, releaseExecution);
      counted = false; // The backend operation now owns the execution counters.
      const response = await Promise.race([operation,cancelled]);
      send(res,200,response,{'mcp-session-id':session.id});

    } catch (e) { if(req.url === '/mcp/images' || req.url.startsWith('/mcp/images?')) { const failure=toolFailure(e); send(res,e.status||500,{error:{code:e.code||'upload_request_failed',message:e.status?failure.message:'Image upload failed'}},{connection:'close'}); } else send(res,e.status || 500,{error:e.status ? e.message : 'MCP request failed'},e.status===408||e.status===413?{connection:'close'}:{}); }
    finally {
      if (pendingKey && session) session.pending.delete(pendingKey);
      if (requestController && cancelListener) requestController.signal.removeEventListener('abort', cancelListener);
      if (counted) { active--; if (session) { session.active--; session.lastSeen = now(); } }
    }
  }
  async function stop() {
    clearInterval(timer); timer = null;
    const old = server; server = null; startedAt = null;
    try { await settleWithin(announcer?.close?.(), 2000); } catch {} announcer = null;
    for (const session of sessions.values()) remove(session);
    for (const controller of uploads) controller.abort();
    for (const socket of sockets) socket.destroy(); sockets.clear();
    if (old) {
      let closed = false;
      const closeResult = new Promise(resolve => {
        try { old.close(() => { closed = true; resolve(); }); }
        catch { closed = true; resolve(); }
      });
      const timedOut = await settleWithin(closeResult, 2000);
      if (timedOut || !closed) {
        try { old.closeAllConnections?.(); old.closeIdleConnections?.(); } catch {}
      }
    }
    notify();
  }
  function enqueue(fn) { const result = transition.then(fn); transition = result.catch(() => {}); return result; }
  async function performStart() {
    if (server?.listening) return status();
    try {
      identity = loadDirectHttpIdentity(stateDirectory); addresses = currentAddresses();
      server = https.createServer({...createDirectHttpLeaf(identity,addresses,hostnames),minVersion:'TLSv1.2'},handle);
      server.requestTimeout = timeouts.requestUploadMs; server.headersTimeout = timeouts.headersMs; server.keepAliveTimeout = timeouts.keepAliveMs; server.maxConnections = limits.tcpConnections;
      server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
      await listenMcp(server, preferredPort);
      startedAt = now();
      announcer = announce({hostId:identity.hostId,port:server.address().port,getAddresses:() => { refresh(); return addresses; },onError:() => {}});
      timer = setInterval(() => { try { refresh(); prune(); } catch {} },10000); timer.unref(); notify();
      return status();
    } catch (e) { await stop(); throw e; }
  }
  function start() { return enqueue(performStart); }
  function reset() { return enqueue(async () => {
    await stop();
    identity = resetDirectHttpIdentity(stateDirectory);
    return performStart();
  }); }
  return {start,reset,close:() => enqueue(stop),status};
}
module.exports = {createDirectHttpService};
