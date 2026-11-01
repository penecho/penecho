'use strict';
const WebSocket=require('ws');
const MAX_BYTES=12*1024*1024;
const LIVE_TARGET=/^[0-9a-f-]{36}$/i;

// A Canvas opened from PenEcho Cloud in the local app, or collaborating by a
// link, joins the same live room as browsers on the website. The host alone
// holds the account session; the browser frames pass through unchanged.
class CloudLiveBridge {
  constructor(){this.channels=new Set();}
  static query(search) {
    const input=new URLSearchParams(search),query=new URLSearchParams();
    for(const key of ['canvas','share'])if(LIVE_TARGET.test(input.get(key)||''))query.set(key,input.get(key).toLowerCase());
    return [...query.keys()].length===1?query:null;
  }
  attach(browser,{origin,token,query}) {
    if(this.channels.size>=32){browser.close(1013,'Too many live Canvases');return;}
    const url=new URL(`/api/v1/live/socket?${query}`,origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    // Without an account the link alone opens the room.
    const remote=new WebSocket(url,{headers:token?{authorization:`Bearer ${token}`}:{},maxPayload:MAX_BYTES,perMessageDeflate:false,handshakeTimeout:10000,followRedirects:false});
    let closed=false,bytes=0,lastBrowserPong=Date.now(),lastRemoteActivity=Date.now();const queue=[];
    const close=(code=1012,reason='Live connection closed')=>{
      if(closed)return;closed=true;clearInterval(timer);queue.length=0;bytes=0;this.channels.delete(close);
      try{browser.close(code,reason);}catch{}
      try{remote.close();}catch{}
    };
    this.channels.add(close);
    const send=(socket,frame)=>{
      if(closed||socket.readyState!==1||socket.bufferedAmount+frame.length>MAX_BYTES){close();return;}
      socket.send(frame,{binary:false},error=>{if(error)close();});
    };
    browser.on('message',(data,binary)=>{
      if(closed)return;
      if(binary||data.length>MAX_BYTES){close();return;}
      if(remote.readyState===1)send(remote,data);
      else if(bytes+data.length>MAX_BYTES||queue.length>=64)close();
      else{bytes+=data.length;queue.push(data);}
    });
    remote.on('open',()=>{lastRemoteActivity=Date.now();for(const frame of queue)send(remote,frame);queue.length=0;bytes=0;});
    remote.on('message',(data,binary)=>{lastRemoteActivity=Date.now();if(binary)close();else send(browser,data);});
    remote.on('ping',()=>{lastRemoteActivity=Date.now();});
    remote.on('pong',()=>{lastRemoteActivity=Date.now();});
    // Cloud's own refusal (for example a revoked link) reaches the page as is.
    remote.on('close',(code,reason)=>close(code>=4000&&code<5000?code:1012,String(reason||'Live connection closed').slice(0,120)));
    remote.on('unexpected-response',(request,response)=>close(response.statusCode===401?4401:response.statusCode===403||response.statusCode===404?4403:1012,'Live Canvas unavailable'));
    browser.on('pong',()=>{lastBrowserPong=Date.now();});
    const timer=setInterval(()=>{
      if(Date.now()-lastBrowserPong>45000||Date.now()-lastRemoteActivity>45000){close();return;}
      if(browser.readyState===1)browser.ping();if(remote.readyState===1)remote.ping();
    },15000);timer.unref();
    browser.once('close',()=>close());browser.on('error',()=>close());remote.on('error',()=>close());
  }
  close(){for(const close of this.channels)close();}
}
module.exports={CloudLiveBridge};
