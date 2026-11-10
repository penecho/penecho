#!/usr/bin/env node
'use strict';
// Windows-side control peer. Trust arrives only over SSH stdin; stdout is nonsecret JSON.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 let directory,child,cache,exited=false,exitCode=null,sequence=0,buffer='',control='',closing;const pending=new Map();
 const write=value=>process.stdout.write(JSON.stringify(value)+'\n');
 const cleanup=()=>closing||=(async()=>{if(child&&!exited){child.stdin.end();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(2500)]);if(!exited){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(1500)]);}}if(directory)fs.rmSync(directory,{recursive:true,force:true});return {pid:child?.pid,exited,exitCode,temporaryStateRemoved:!directory||!fs.existsSync(directory)};})();
 async function execute(method,params={}){
  if(method==='open'){
   if(child)throw Error('already-open');const trust=params.trust,cert=new crypto.X509Certificate(trust.certificatePem);if(!/^[a-f\d]{64}$/i.test(trust.hostId)||crypto.createHash('sha256').update(cert.raw).digest('hex')!==trust.hostId||!/^[a-f\d]{64}$/i.test(trust.accessToken))throw Error('invalid-trust');if(!path.isAbsolute(params.client))throw Error('invalid-client-path');
   directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'penecho-recovery-peer-'));const host=path.join(directory,'hosts',trust.hostId);fs.mkdirSync(host,{recursive:true,mode:0o700});fs.writeFileSync(path.join(host,'credentials.json'),JSON.stringify(trust),{mode:0o600});fs.writeFileSync(path.join(host,'ca.pem'),trust.certificatePem,{mode:0o600});cache=path.join(host,'endpoint.json');
   child=spawn(process.execPath,[params.client,'--host-id',trust.hostId,'--state-directory',directory,'--idle-timeout-ms','1000'],{stdio:['pipe','pipe','ignore']});child.stdin.on('error',()=>{});child.on('error',()=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('client-spawn-failed'));}pending.clear();});child.once('exit',code=>{exited=true;exitCode=code;for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('client-exited'));}pending.clear();});child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>4*1024*1024){child.kill();return;}let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);let value;try{value=JSON.parse(line);}catch{continue;}const item=pending.get(value.id);if(item){clearTimeout(item.timer);pending.delete(value.id);item.resolve(value);}}});return {pid:child.pid};
  }
  if(method==='rpc'){if(!child||exited)throw Error('client-not-running');return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('client-response-timeout'));},12000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:params.method,params:params.params})+'\n');});}
  if(method==='cache'){if(!cache)throw Error('not-open');fs.writeFileSync(cache,JSON.stringify({hostId:params.hostId,url:params.url}),{mode:0o600});return {written:true};}
  if(method==='status'){let url;try{url=JSON.parse(fs.readFileSync(cache,'utf8')).url;}catch{}return {pid:child?.pid,exited,exitCode,cacheUrl:url};}
  if(method==='finish')return cleanup();throw Error('unknown-control-method');
 }
 let queue=Promise.resolve();process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{control+=chunk;if(control.length>262144){void cleanup().then(()=>process.exit(1));return;}let n;while((n=control.indexOf('\n'))>=0){const line=control.slice(0,n);control=control.slice(n+1);let message;try{message=JSON.parse(line);}catch{continue;}queue=queue.then(async()=>{try{write({id:message.id,result:await execute(message.method,message.params)});}catch{write({id:message.id,error:'Peer operation failed; no sensitive diagnostic retained'});}});}});
 process.stdin.once('end',()=>void cleanup().then(()=>process.exit(0)));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void cleanup().then(()=>process.exit(1)));
}
module.exports={main};if(require.main===module)main().catch(()=>{process.stderr.write('Recovery peer failed\n');process.exitCode=1;});
