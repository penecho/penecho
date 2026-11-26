/* One Canvas execution queue receives the MCP calls of this Canvas, over one socket: the computer's own MCP server for a Canvas
   on a computer, the account's Cloud MCP for a Canvas on penecho.ai. */
(() => {
  'use strict';
  const SOCKET_CONNECT_TIMEOUT_MS=10000;
  window.PenEchoCloudMcpSocket = class extends EventTarget {
    constructor() {
      super();this.local=window.PENECHO_CONFIG?.runtime!=='cloud';this.readyState=0;this.routes=new Map();this.closed=false;this.hello=null;this.primaryReady=false;this.primaryCatalog=false;
      this.primary=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}${this.local?'/api/mcp/canvas':window.PENECHO_CONFIG?.browserDraftId?`/api/v1/mcp/workspaces/${window.PENECHO_CONFIG.browserDraftId}/canvas`:'/api/v1/mcp/canvas'}`);
      this.primaryTimer=setTimeout(()=>{if(!this.closed&&this.primary.readyState!==1){this.primary.close(4000,'MCP connection timed out.');}},SOCKET_CONNECT_TIMEOUT_MS);
      this.primary.addEventListener('open',()=>{clearTimeout(this.primaryTimer);if(this.closed)return;this.readyState=1;this.dispatchEvent(new Event('open'));});
      this.primary.addEventListener('message',event=>this.receive(event));
      this.primary.addEventListener('error',()=>{if(!this.closed)this.dispatchEvent(new Event('error'));});
      this.primary.addEventListener('close',event=>{if(this.closed)return;const closed=new Event('close');Object.defineProperties(closed,{code:{value:Number(event.code)||1006},reason:{value:String(event.reason||'')}});this.close();this.dispatchEvent(closed);});
    }
    emit(message){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(message)}));}
    // Which kind of MCP reaches this Canvas: the computer's own, or the account's on penecho.ai.
    get availability(){return {cloud:!this.local&&this.primaryReady,local:this.local&&this.primaryReady};}
    publishAvailability(){this.dispatchEvent(new Event('availabilitychange'));}
    receive(event) {
      if(this.closed)return;
      if(typeof event.data!=='string'||event.data.length>12*1024*1024)return;
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(!message||typeof message!=='object')return;
      if(message.type==='ready'){this.primaryReady=true;this.primaryCatalog=message.catalog===true;this.publishAvailability();}
      if(message.type==='call') {
        if(typeof message.requestId!=='string'||!message.requestId.length||message.requestId.length>128)return;
        const original=message.requestId,id=`cloud:${original}`;
        if(this.routes.has(id)){this.primary.send(JSON.stringify({type:'result',requestId:original,ok:false,error:{code:'REQUEST_ID_CONFLICT',message:'Request ID already active.'}}));return;}
        if(this.routes.size>=64){this.primary.send(JSON.stringify({type:'result',requestId:original,ok:false,error:{code:'CANVAS_BUSY',message:'Canvas queue is full.'}}));return;}
        this.routes.set(id,{original});message.requestId=id;
      }else if(message.type==='cancel'){
        message.requestId=`cloud:${message.requestId}`;
        // The upstream caller has already abandoned this request. Retaining its
        // route until uncooperative browser work finishes can exhaust all routes.
        this.routes.delete(message.requestId);
      }
      this.emit(message);
    }
    send(raw) {
      if(this.readyState!==1)throw new Error('MCP socket is not open.');
      const message=JSON.parse(raw);
      if(message.type==='result') {
        const route=this.routes.get(message.requestId);if(!route)return;
        this.routes.delete(message.requestId);
        if(this.primary.readyState===1)this.primary.send(JSON.stringify({...message,requestId:route.original}));
        return;
      }
      if(message.type==='hello')this.hello=raw;
      if(message.type==='catalog'){
        if(this.hello){const hello=JSON.parse(this.hello);hello.documents=message.documents;this.hello=JSON.stringify(hello);}
        if(this.primaryCatalog)this.primary.send(raw);
        return;
      }
      this.primary.send(raw);
    }
    close() {
      if(this.closed)return;this.closed=true;this.readyState=3;clearTimeout(this.primaryTimer);
      this.primaryReady=false;this.primaryCatalog=false;this.publishAvailability();
      this.primary.close();this.routes.clear();
    }
  };
})();
