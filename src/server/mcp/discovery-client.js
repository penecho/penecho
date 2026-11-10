#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),https=require('node:https'),net=require('node:net'),dns=require('node:dns');
const {discover:lanDiscover}=require('./lan-discovery.js');
const MAX=65536;
const ERROR_MESSAGES={LAN_DISCOVERY_NETWORK:'LAN discovery could not open or use its UDP socket. Check firewall and network permissions.',MCP_CONFIG_UNSUPPORTED:'The client configuration contains syntax this helper cannot safely update. Update discover.js or use the setup prompt.',MCP_CONFIG_SYMLINK:'The client configuration uses a symbolic link; update its intended target safely.',MCP_CONFIG_INVALID:'The client configuration is invalid; repair its syntax before retrying.',AUTH_REJECTED:'PenEcho rejected the access token. Import the current host credentials.',TLS_HOSTNAME:'The endpoint IP is not covered by the host certificate. Refresh the host endpoint.',TLS_CA:'The host certificate could not be verified using the imported CA.',HOST_UNREACHABLE:'No authenticated PenEcho host is reachable. Check that PenEcho is open and both machines share a private network.',HOST_IDENTITY:'The responding endpoint does not match the imported host identity.',PERMISSION_DENIED:'Setup could not access a required file. Check file and directory permissions.',CONFIG_CONFLICT:'The client configuration changed during setup. Retry to preserve the newer changes.',MISSING_FILE:'A required credentials or configuration file is missing. Import the host trust bundle first.',INVALID_ARGUMENT:'An argument is missing or invalid. Run with --help for supported options.',INVALID_CREDENTIALS:'The imported credentials or CA identity are invalid. Export a new trust bundle from the host.',DISCOVERY_BUSY:'Another discovery is still running. Retry shortly.',INVALID_RESPONSE:'The host returned an invalid status response.',SETUP_FAILED:'Setup could not complete. Check the state and client configuration files.'};
function diagnostic(error){let code=error?.code;if(!Object.hasOwn(ERROR_MESSAGES,code)){if(['EACCES','EPERM'].includes(code))code='PERMISSION_DENIED';else if(code==='ENOENT')code='MISSING_FILE';else if(code==='ERR_TLS_CERT_ALTNAME_INVALID')code='TLS_HOSTNAME';else if(/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ISSUER/.test(code||''))code='TLS_CA';else if(/ECONN|ETIMEDOUT|EHOST|ENET/.test(code||''))code='HOST_UNREACHABLE';else if(/hostId|option|Unsupported client/.test(error?.message||''))code='INVALID_ARGUMENT';else if(/CA |credential|token|identity|PEM/i.test(error?.message||''))code='INVALID_CREDENTIALS';else if(/busy/.test(error?.message||''))code='DISCOVERY_BUSY';else code='SETUP_FAILED';}return {code,message:ERROR_MESSAGES[code],...(['read_credentials','read_ca','read_cache','lock_discovery','write_cache','configure_client','import_trust'].includes(error?.stage)?{stage:error.stage}:{}),...(['open','read','write','rename','mkdir','chmod','fsync','lstat','stat'].includes(error?.syscall)?{operation:error.syscall}:{})};}
function failure(code){return Object.assign(Error(ERROR_MESSAGES[code]),{code});}

function hostId(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/i.test(value))throw Error('Invalid hostId');return value.toLowerCase();}
function safePath(file){let current=path.parse(path.resolve(file)).root;for(const part of path.resolve(file).slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())throw Error('Symbolic links are not permitted');}catch(e){if(e.code!=='ENOENT')throw e;}}}
function directory(dir){safePath(dir);fs.mkdirSync(dir,{recursive:true,mode:0o700});if(process.platform!=='win32')fs.chmodSync(dir,0o700);}
function read(file){safePath(file);const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const s=fs.fstatSync(fd);if(!s.isFile()||s.size>MAX)throw Error('Invalid state file');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}}
function atomic(file,value){safePath(file);directory(path.dirname(file));const temp=path.join(path.dirname(file),`.${path.basename(file)}.${crypto.randomBytes(12).toString('hex')}.tmp`);try{const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,value);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}safePath(file);fs.renameSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch{}}}
function root(options={}){return path.resolve(options.stateDirectory||path.join(os.homedir(),'.penecho','mcp'));}
function location(id,options){return path.join(root(options),'hosts',hostId(id));}
function privateIP(ip){return net.isIPv4(ip)&&(/^(127\.|10\.|192\.168\.)/.test(ip)||/^172\.(1[6-9]|2\d|3[01])\./.test(ip))||ip==='::1'||net.isIPv6(ip)&&/^f[cd]/i.test(ip);}
function machineName(host){return /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.local)?$/i.test(host);}
function privateLookup(host,options,callback){
  dns.lookup(host,{family:4,all:true},(error,values)=>{
    if(error)return callback(error);const allowed=values.filter(value=>privateIP(value.address));
    if(!allowed.length)return callback(Object.assign(Error('Machine name did not resolve to a private address'),{code:'HOST_UNREACHABLE'}));
    if(options?.all)return callback(null,allowed);callback(null,allowed[0].address,allowed[0].family);
  });
}
function validateURL(value){const u=new URL(value),host=u.hostname.replace(/^\[|\]$/g,'');if(u.protocol!=='https:'||!(privateIP(host)||!net.isIP(host)&&machineName(host))||u.username||u.password||u.pathname!=='/mcp'||u.search||u.hash)throw Error('Endpoint must be a private IP or local machine HTTPS MCP URL');return u.href;}
function validateInitialURL(value){const url=validateURL(value);if(!net.isIP(new URL(url).hostname.replace(/^\[|\]$/g,'')))throw Error('initialUrl must use a private numeric IP');return url;}
function validateCredentials(value){const id=hostId(value.hostId),cert=new crypto.X509Certificate(value.certificatePem);if(!cert.ca||cert.subject!==cert.issuer||!cert.verify(cert.publicKey)||crypto.createHash('sha256').update(cert.raw).digest('hex')!==id)throw Error('CA identity mismatch');if(Date.parse(cert.validFrom)>Date.now()||Date.parse(cert.validTo)<=Date.now())throw Error('CA certificate is not valid now');if(!/^[a-f0-9]{64}$/i.test(value.accessToken||''))throw Error('Invalid access token');return {hostId:id,certificatePem:cert.toString(),accessToken:value.accessToken,addresses:[...new Set((value.addresses||[]).slice(0,16).map(validateURL))],...(value.preferredUrl?{preferredUrl:validateURL(value.preferredUrl)}:{}),...(value.initialUrl?{initialUrl:validateInitialURL(value.initialUrl)}:{})};}
function importCredentials(value,options={}){const credentials=validateCredentials(value),dir=location(credentials.hostId,options);directory(dir);try{const old=validateCredentials(JSON.parse(read(path.join(dir,'credentials.json'))));if(old.hostId!==credentials.hostId)throw Error('Cannot replace host identity');}catch(e){if(e.code!=='ENOENT')throw e;}atomic(path.join(dir,'ca.pem'),credentials.certificatePem);atomic(path.join(dir,'credentials.json'),JSON.stringify(credentials,null,2)+'\n');return {hostId:credentials.hostId,caFile:path.join(dir,'ca.pem')};}
function requestStatus(url,{certificatePem,accessToken,signal,timeoutMs=1200}){
  return new Promise((resolve,reject)=>{
    const target=new URL(validateURL(url));target.pathname='/status';
    let timer;const req=https.get(target,{ca:certificatePem,rejectUnauthorized:true,agent:false,signal,lookup:privateLookup,headers:{Authorization:`Bearer ${accessToken}`}},res=>{
      if(res.statusCode!==200){res.resume();return reject(failure([401,403].includes(res.statusCode)?'AUTH_REJECTED':'INVALID_RESPONSE'));}
      let data='';res.on('error',reject);res.on('data',chunk=>{data+=chunk;if(Buffer.byteLength(data)>MAX)req.destroy(failure('INVALID_RESPONSE'));});
      res.on('end',()=>{try{resolve(JSON.parse(data));}catch{reject(failure('INVALID_RESPONSE'));}});
    });
    // A wall-clock deadline also bounds TCP/TLS setup and trickling responses.
    timer=setTimeout(()=>req.destroy(failure('HOST_UNREACHABLE')),timeoutMs);
    req.once('close',()=>clearTimeout(timer));req.on('error',reject);
  });
}
function stage(name,fn){try{const result=fn();return result?.then?result.catch(e=>{e.stage ||= name;throw e;}):result;}catch(e){e.stage ||= name;throw e;}}
function loadCredentials(id,options={}){
  id=hostId(id);const dir=location(id,options),credentials=stage('read_credentials',()=>validateCredentials(JSON.parse(read(path.join(dir,'credentials.json')))));
  if(credentials.hostId!==id)throw failure('HOST_IDENTITY');const caFile=path.join(dir,'ca.pem');
  stage('read_ca',()=>{if(new crypto.X509Certificate(read(caFile)).fingerprint256!==new crypto.X509Certificate(credentials.certificatePem).fingerprint256)throw failure('INVALID_CREDENTIALS');});
  return {...credentials,caFile};
}
async function resolveEndpoint(options={}){
  const id=hostId(options.hostId),dir=location(id,options),credentials=loadCredentials(id,options),caFile=credentials.caFile;
  const diagnostics=[],failed=new Set(),cache=path.join(dir,'endpoint.json');
  const probe=async(value,signal=options.signal,timeoutMs=1200)=>{let url;try{
    url=validateURL(value);if(failed.has(url))return null;const status=await (options.request||requestStatus)(url,{...credentials,signal,timeoutMs});
    const startedAt=typeof status.startedAt==='number'?status.startedAt:Date.parse(status.startedAt);
    if(status.hostId!==id)throw failure('HOST_IDENTITY');if(!Number.isFinite(startedAt)||startedAt<=0)throw failure('INVALID_RESPONSE');
    return {url,hostId:id,startedAt:status.startedAt,caFile};
  }catch(error){if(!signal?.aborted){if(url)failed.add(url);diagnostics.push(diagnostic(error));}return null;}};
  const saveEndpoint=result=>{try{stage('write_cache',()=>atomic(cache,JSON.stringify(result,null,2)+'\n'));return result;}catch(error){if(['EACCES','EPERM','ENOSPC','EROFS'].includes(error.code))return {...result,cacheWarning:diagnostic(error)};throw error;}};
  const cached=async()=>{const c=stage('read_cache',()=>{try{return JSON.parse(read(cache));}catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError||e.message==='Invalid state file')return null;if(['EACCES','EPERM'].includes(e.code)){diagnostics.push(diagnostic(e));return null;}throw e;}});if(c?.hostId!==id)return null;return probe(c.url,options.signal,500);};
  if(!options.force){
    const initial=options.initialUrl || credentials.initialUrl || credentials.addresses.find(value=>net.isIP(new URL(value).hostname.replace(/^\[|\]$/g,'')));
    if(initial){const result=await probe(validateInitialURL(initial),options.signal,500);if(result)return saveEndpoint(result);}
    const result=await cached();if(result)return result;
  }
  const lock=path.join(dir,'discovery.lock'),deadline=Date.now()+8000;let acquired=false,waited=false;
  while(!acquired){options.signal?.throwIfAborted();stage('lock_discovery',()=>{
    safePath(lock);try{fs.mkdirSync(lock,{mode:0o700});acquired=true;}catch(e){
      if(e.code!=='EEXIST')throw e;waited=true;const stat=fs.lstatSync(lock);if(!stat.isDirectory())throw Error('Invalid discovery lock');
      if(Date.now()-stat.mtimeMs>30000){try{fs.rmdirSync(lock);}catch{}return;}
      if(Date.now()>deadline)throw failure('DISCOVERY_BUSY');
    }
  });if(!acquired)await new Promise(r=>setTimeout(r,75));}
  try{
    // Re-read shared state after locking; failed URLs are not probed twice.
    if(!options.force||waited){const result=await cached();if(result)return result;}
    options.signal?.throwIfAborted();
    const controller=new AbortController(),results=[],seen=new Set();let settle,hardTimer,finish,pending=0,discoveryDone=false;
    const completed=new Promise(resolve=>{finish=resolve;});
    const abort=()=>{controller.abort();finish();};options.signal?.addEventListener('abort',abort,{once:true});
    const candidate=value=>{
      if(controller.signal.aborted||seen.size>=32||seen.has(value))return;
      seen.add(value);
      pending++;void probe(value,controller.signal).then(result=>{if(!result||controller.signal.aborted)return;results.push(result);
        // Collect nearby replies, but never wait for every dead address to time out.
        if(!settle)settle=setTimeout(finish,250);
      }).finally(()=>{pending--;if(discoveryDone&&!pending&&!results.length)finish();});
    };
    try{
      hardTimer=setTimeout(finish,5000);
      void Promise.resolve().then(()=>(options.discover||lanDiscover)({hostId:id,signal:controller.signal,timeoutMs:5000,onCandidate:candidate})).then(hints=>{for(const hint of Array.isArray(hints)?hints:[])candidate(hint);},error=>{if(!controller.signal.aborted)diagnostics.push(diagnostic(error));}).finally(()=>{discoveryDone=true;if(!pending&&!results.length)finish();});
      await completed;options.signal?.throwIfAborted();
    }finally{clearTimeout(hardTimer);clearTimeout(settle);options.signal?.removeEventListener('abort',abort);controller.abort();}
    results.sort((a,b)=>(typeof b.startedAt==='number'?b.startedAt:Date.parse(b.startedAt))-(typeof a.startedAt==='number'?a.startedAt:Date.parse(a.startedAt)));
    if(!results.length){const priority=['AUTH_REJECTED','TLS_HOSTNAME','TLS_CA','HOST_IDENTITY','INVALID_RESPONSE','LAN_DISCOVERY_NETWORK'];throw failure(priority.find(code=>diagnostics.some(d=>d.code===code))||'HOST_UNREACHABLE');}
    return saveEndpoint(results[0]);
  }finally{try{fs.rmdirSync(lock);}catch{}}
}
async function main(argv=process.argv.slice(2),options={}){const out=options.stdout||process.stdout,err=options.stderr||process.stderr;try{const args={};for(let i=0;i<argv.length;i++){const key=argv[i];if(['--help','--force'].includes(key))args[key]=true;else if(['--import','--host-id','--state-directory','--client'].includes(key)&&argv[i+1]&&!argv[i+1].startsWith('--'))args[key]=argv[++i];else throw Error('Unknown or incomplete option');}if(args['--help']){out.write('PenEcho one-shot HTTPS discovery (Node >=18)\n--import FILE --host-id ID --state-directory DIR --force --client codex|claude|hermes|json\n');return 0;}const settings={...options,stateDirectory:args['--state-directory']||options.stateDirectory,hostId:args['--host-id'],force:!!args['--force']};if(args['--import']){const imported=stage('import_trust',()=>importCredentials(JSON.parse(read(path.resolve(args['--import']))),settings));settings.hostId||=imported.hostId;}const endpoint=await resolveEndpoint(settings);let result=endpoint;if(args['--client']){const credentials=JSON.parse(read(path.join(location(settings.hostId,settings),'credentials.json')));result={...endpoint,...await stage('configure_client',()=>require('./http-client-config.js').configureHttpClient(args['--client'],{...endpoint,accessToken:credentials.accessToken},options))};}out.write(JSON.stringify({ok:true,...result},null,2)+'\n');return 0;}catch(e){const details=diagnostic(e);err.write(JSON.stringify({ok:false,...details,error:details.message})+'\n');return 1;}}
module.exports={importCredentials,loadCredentials,resolveEndpoint,requestStatus,validateURL,privateLookup,diagnostic,main};
if(require.main===module)main().then(code=>{process.exitCode=code;});
