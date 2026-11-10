'use strict';
const WebSocket=require('ws');
const MAX_BYTES=12*1024*1024;

// The host alone reads its device credential. Browser frames remain scoped to
// one opted-in Canvas; the normal Cloud account runtime executes the same tools.
class CloudMcpBridge {
  constructor(){this.channels=new Set();}
  attach(browser,{origin,token}) {
    if(this.channels.size>=16){browser.close(1013,'Too many Cloud MCP canvases');return;}
    const url=new URL('/api/v1/mcp/device-canvas',origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const remote=new WebSocket(url,{headers:{authorization:`Bearer ${token}`},maxPayload:MAX_BYTES,perMessageDeflate:false,handshakeTimeout:10000,followRedirects:false});
    let closed=false,bytes=0,lastBrowserPong=Date.now(),lastRemoteActivity=Date.now();const queue=[];
    const close=()=>{
      if(closed)return;closed=true;clearInterval(timer);queue.length=0;bytes=0;this.channels.delete(close);
      try{browser.close(1012,'Cloud MCP connection closed');}catch{}
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
    browser.on('pong',()=>{lastBrowserPong=Date.now();});
    const timer=setInterval(()=>{
      if(Date.now()-lastBrowserPong>45000||Date.now()-lastRemoteActivity>45000){close();return;}
      if(browser.readyState===1)browser.ping();if(remote.readyState===1)remote.ping();
    },15000);timer.unref();
    browser.once('close',close);browser.on('error',close);remote.once('close',close);remote.on('error',close);
  }
  close(){for(const close of this.channels)close();}
}
module.exports={CloudMcpBridge};
