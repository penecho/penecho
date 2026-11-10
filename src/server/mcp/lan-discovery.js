'use strict';
// Standalone DNS-SD transport: discovered addresses are hints; TLS pinning remains authority.
const dgram=require('node:dgram'),os=require('node:os'),net=require('node:net');
const GROUP='224.0.0.251',PORT=5353,SERVICE='_penecho-mcp._tcp.local',SEND_DEADLINE_MS=1000;
const privateIP=a=>net.isIPv4(a)&&(/^(10\.|192\.168\.)/.test(a)||/^172\.(1[6-9]|2\d|3[01])\./.test(a));
const interfaces=()=>[...new Set(Object.values(os.networkInterfaces()).flat().filter(a=>a?.family==='IPv4'&&privateIP(a.address)).map(a=>a.address))];
function names(hostId){if(!/^[a-f0-9]{64}$/i.test(hostId))throw new Error('Invalid host identity');const id=hostId.toLowerCase();let n=BigInt('0x'+id),label='';for(let i=0;i<52;i++){label='abcdefghijklmnopqrstuvwxyz234567'[Number(n&31n)]+label;n>>=5n;}return {instance:`${label}.${SERVICE}`,host:`${id.slice(0,32)}.${id.slice(32)}.penecho.local`};}
function encodeName(name){return Buffer.concat([...name.split('.').map(s=>{const b=Buffer.from(s);if(!b.length||b.length>63)throw new Error('Invalid DNS label');return Buffer.concat([Buffer.from([b.length]),b]);}),Buffer.from([0])]);}
function parsePacket(data){
 if(!Buffer.isBuffer(data)||data.length<12||data.length>9000)throw new Error('Invalid DNS packet');
 function name(offset){let cursor=offset,end=null,labels=[],visited=new Set(),length=0;
  for(let steps=0;steps<128;steps++){if(cursor>=data.length||visited.has(cursor))throw new Error('Invalid DNS name');visited.add(cursor);const n=data[cursor++];if(n===0)return {name:labels.join('.').toLowerCase(),end:end??cursor};if((n&192)===192){if(cursor>=data.length)throw new Error('Invalid DNS pointer');const target=((n&63)<<8)|data[cursor++];end??=cursor;cursor=target;continue;}if(n>63||cursor+n>data.length||length+n+1>255)throw new Error('Invalid DNS label');labels.push(data.toString('ascii',cursor,cursor+n));length+=n+1;cursor+=n;}throw new Error('DNS name too deep');}
 const counts=[4,6,8,10].map(p=>data.readUInt16BE(p));if(counts.reduce((a,b)=>a+b,0)>128)throw new Error('Too many DNS records');
 let offset=12;const questions=[],records=[];
 for(let i=0;i<counts[0];i++){const n=name(offset);offset=n.end;if(offset+4>data.length)throw new Error('Truncated DNS question');questions.push({name:n.name,type:data.readUInt16BE(offset),unicast:!!(data.readUInt16BE(offset+2)&32768)});offset+=4;}
 for(let i=0;i<counts[1]+counts[2]+counts[3];i++){const n=name(offset);offset=n.end;if(offset+10>data.length)throw new Error('Truncated DNS record');const type=data.readUInt16BE(offset),klass=data.readUInt16BE(offset+2)&32767,ttl=data.readUInt32BE(offset+4),size=data.readUInt16BE(offset+8);offset+=10;const end=offset+size;if(end>data.length)throw new Error('Truncated DNS data');let value;
  if(type===1&&size===4)value=[...data.subarray(offset,end)].join('.');
  if(type===12){const v=name(offset);if(v.end>end)throw new Error('Invalid PTR');value=v.name;}
  if(type===33&&size>=7){const v=name(offset+6);if(v.end>end)throw new Error('Invalid SRV');value={port:data.readUInt16BE(offset+4),host:v.name};}
  if(klass===1)records.push({name:n.name,type,ttl,value});offset=end;
 }
 return {response:!!(data.readUInt16BE(2)&32768),questions,records};
}
function question(instance,unicast=false){const header=Buffer.alloc(12);header.writeUInt16BE(1,4);return Buffer.concat([header,encodeName(instance),Buffer.from([0,255,unicast?128:0,1])]);}
function announcement(hostId,port,addresses,ttl=120){const {instance,host}=names(hostId);const records=[];
 function add(name,type,value){const h=Buffer.alloc(10);h.writeUInt16BE(type);h.writeUInt16BE(type===12?1:32769,2);h.writeUInt32BE(ttl,4);h.writeUInt16BE(value.length,8);records.push(Buffer.concat([encodeName(name),h,value]));}
 add(SERVICE,12,encodeName(instance));const srv=Buffer.alloc(6);srv.writeUInt16BE(port,4);add(instance,33,Buffer.concat([srv,encodeName(host)]));add(instance,16,Buffer.from([0]));for(const a of addresses.filter(privateIP).slice(0,16))add(host,1,Buffer.from(a.split('.').map(Number)));
 const header=Buffer.alloc(12);header.writeUInt16BE(0x8400,2);header.writeUInt16BE(records.length,6);return Buffer.concat([header,...records]);
}
function socket(onError){const s=dgram.createSocket({type:'udp4',reuseAddr:true});s.on('error',e=>{try{onError?.(e);}catch{}});return s;}
// dgram.send may defer the actual OS send. Keep each packet bounded so a
// missing callback cannot hold every later refresh (or goodbye) in the queue.
function multicastSender(s,timeoutMs=SEND_DEADLINE_MS){const duration=Number(timeoutMs);const deadline=Number.isFinite(duration)&&duration>0?duration:SEND_DEADLINE_MS;let queue=Promise.resolve();return (packet,addresses)=>{const run=queue.then(()=>new Promise(resolve=>{const list=[...addresses];let finished=false,timer;const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);resolve();};const next=()=>{if(finished)return;const address=list.shift();if(!address)return finish();try{s.setMulticastInterface(address);s.send(packet,PORT,GROUP,()=>next());}catch{next();}};timer=setTimeout(finish,deadline);timer.unref?.();next();}));queue=run.catch(()=>{});return run;};}
function join(s,addresses){for(const a of addresses){try{s.addMembership(GROUP,a);}catch{}}}
function createAnnouncer({hostId,port,getAddresses=interfaces,onError=()=>{}}){
 const {instance,host}=names(hostId);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid LAN port');
 const s=socket(onError),multicast=multicastSender(s);let closed=false,ready=false,timer,addresses=[],closePromise;const members=new Set();
 function send(ttl=120){if(!ready)return;const packet=announcement(hostId,port,addresses,ttl);return multicast(packet,addresses);}
 function refresh(){const next=[...new Set(getAddresses().filter(privateIP))].slice(0,16);for(const a of next)if(!members.has(a)){try{s.addMembership(GROUP,a);members.add(a);}catch{}}for(const a of members)if(!next.includes(a)){try{s.dropMembership(GROUP,a);}catch{}members.delete(a);}addresses=next;send();}
 let lastReply=0;s.on('message',(data,remote)=>{try{const p=parsePacket(data);if(!p.response&&Date.now()-lastReply>200&&p.questions.some(q=>[SERVICE,instance,host].includes(q.name)&&[1,12,16,33,255].includes(q.type))){lastReply=Date.now();if((remote.port!==PORT||p.questions.some(q=>q.unicast))&&privateIP(remote.address)){const packet=announcement(hostId,port,addresses);data.copy(packet,0,0,2);s.send(packet,remote.port,remote.address,()=>{});}else send();}}catch{}});
 s.bind(PORT,()=>{if(closed)return;ready=true;s.setMulticastTTL(255);refresh();timer=setInterval(refresh,30000);timer.unref?.();});s.unref?.();
 return {close(){if(closePromise)return closePromise;closed=true;clearInterval(timer);const goodbye=send(0);ready=false;let deadlineTimer;const deadline=new Promise(resolve=>{deadlineTimer=setTimeout(resolve,SEND_DEADLINE_MS);deadlineTimer.unref?.();});closePromise=Promise.race([Promise.resolve(goodbye),deadline]).catch(()=>{}).finally(()=>{clearTimeout(deadlineTimer);try{s.close();}catch{}});return closePromise;}};
}
function discover({hostId,signal,timeoutMs=5000,onCandidate}){
 const {instance}=names(hostId);return new Promise((resolve,reject)=>{
  if(signal?.aborted)return resolve([]);
  let s,done=false,timer,retry,sendTimer;const records=new Map(),emitted=new Set();
  function candidates(){const urls=new Set();for(const r of records.values())if(r.type===33&&r.name===instance&&r.value?.port>0){for(const a of records.values())if(a.type===1&&a.name===r.value.host&&privateIP(a.value))urls.add(`https://${a.value}:${r.value.port}/mcp`);}return [...urls].slice(0,16);}
  function close(target){try{target?.close();}catch{}}
  function finish(error){if(done)return;done=true;clearTimeout(timer);clearTimeout(sendTimer);clearInterval(retry);signal?.removeEventListener('abort',abort);close(s);if(error)reject(Object.assign(new Error('LAN discovery network unavailable',{cause:error}),{code:'LAN_DISCOVERY_NETWORK'}));else resolve(candidates());}
  function abort(){finish();}
  function message(data){if(done)return;try{const p=parsePacket(data);if(!p.response)return;for(const r of p.records){if(![1,33].includes(r.type)||!r.value)continue;const key=`${r.name}/${r.type}/${JSON.stringify(r.value)}`;if(!r.ttl)records.delete(key);else if(records.size<128)records.set(key,r);}}catch{return;}
   for(const url of candidates()){if(done||emitted.size>=16)break;if(emitted.has(url))continue;emitted.add(url);try{onCandidate?.(url);}catch{}}
  }
  function bind(unicast=false){
   let target,bound=false;
   function fail(error){if(done||target!==s)return;if(!bound&&!unicast&&['EACCES','EPERM','EADDRINUSE'].includes(error.code)){close(target);bind(true);}else finish(error);}
   try{target=socket(fail);s=target;target.on('message',data=>{if(target===s)message(data);});target.bind(unicast?0:PORT,()=>{
    if(done||target!==s)return;bound=true;const addresses=interfaces();if(!unicast)join(target,addresses);
    // Serialize per-interface sends; abort and socket replacement invalidate queued work.
    let sending=false;
    const send=()=>{if(done||target!==s||sending)return;sending=true;const pending=[...addresses],packet=question(instance,unicast);
     let finished=false;const release=()=>{if(finished)return;finished=true;clearTimeout(sendTimer);sendTimer=null;sending=false;};
     function next(error){if(finished)return;if(done||target!==s){release();return;}if(error){release();fail(error);return;}const address=pending.shift();if(!address){release();return;}try{target.setMulticastInterface(address);target.send(packet,PORT,GROUP,next);}catch(e){release();fail(e);}}
     sendTimer=setTimeout(release,SEND_DEADLINE_MS);sendTimer.unref?.();
     next();
    };
    retry=setInterval(send,1000);send();
   });}catch(error){if(!target)finish(error);else fail(error);}
  }
  signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>finish(),Math.max(1,Math.min(Number(timeoutMs)||5000,15000)));bind();
 });
}
module.exports={discover,createAnnouncer,parsePacket,announcement,names,privateIP,multicastSender};
