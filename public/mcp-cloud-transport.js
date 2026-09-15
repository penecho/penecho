/* One Canvas execution queue receives local, account and Linked Device MCP calls. */
(() => {
  'use strict';
  const DEVICE_STATUS_TIMEOUT_MS=5000,SOCKET_CONNECT_TIMEOUT_MS=10000;
  window.PenEchoCloudMcpSocket = class extends EventTarget {
    constructor() {
      super();this.local=window.PENECHO_CONFIG?.runtime!=='cloud';this.readyState=0;this.routes=new Map();this.deviceSessions=new Set();this.closed=false;this.hello=null;this.retry=null;this.device=null;this.deviceId=null;this.retryCount=0;this.primaryReady=false;this.deviceReady=false;this.primaryCatalog=false;this.deviceCatalog=false;
      this.primary=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}${this.local?'/api/mcp/canvas':'/api/v1/mcp/canvas'}`);
      this.primaryTimer=setTimeout(()=>{if(!this.closed&&this.primary.readyState!==1){this.primary.close(4000,'MCP connection timed out.');}},SOCKET_CONNECT_TIMEOUT_MS);
      this.primary.addEventListener('open',()=>{clearTimeout(this.primaryTimer);if(this.closed)return;this.readyState=1;this.dispatchEvent(new Event('open'));this.connectDevice();});
      this.primary.addEventListener('message',event=>this.receive(event,this.primary,'cloud'));
      this.primary.addEventListener('error',()=>{if(!this.closed)this.dispatchEvent(new Event('error'));});
      this.primary.addEventListener('close',event=>{if(this.closed)return;const closed=new Event('close');Object.defineProperties(closed,{code:{value:Number(event.code)||1006},reason:{value:String(event.reason||'')}});this.close();this.dispatchEvent(closed);});
      this.status=()=>this.connectDevice();window.addEventListener(this.local?'penecho:cloud-account-changed':'penecho:remote-cloud-status',this.status);
    }
    emit(message){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(message)}));}
    get availability(){return {cloud:this.local?this.deviceReady:this.primaryReady,local:this.local?this.primaryReady:this.deviceReady};}
    publishAvailability(){this.dispatchEvent(new Event('availabilitychange'));}
    receive(event,socket,source) {
      if(this.closed || socket!==this.primary&&socket!==this.device)return;
      if(typeof event.data!=='string'||event.data.length>12*1024*1024)return;
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(!message||typeof message!=='object')return;
      if(message.type==='ready'){
        if(socket===this.primary){this.primaryReady=true;this.primaryCatalog=message.catalog===true;}
        else {this.deviceReady=true;this.deviceCatalog=message.catalog===true;}
        this.publishAvailability();
      }
      if(source==='device'&&['ready','pong','lan-status-changed'].includes(message.type))return;
      if(message.type==='call') {
        if(typeof message.requestId!=='string'||!message.requestId.length||message.requestId.length>128)return;
        const original=message.requestId,id=`${source}:${original}`;
        if(this.routes.has(id)){socket.send(JSON.stringify({type:'result',requestId:original,ok:false,error:{code:'REQUEST_ID_CONFLICT',message:'Request ID already active.'}}));return;}
        if(this.routes.size>=64){socket.send(JSON.stringify({type:'result',requestId:original,ok:false,error:{code:'CANVAS_BUSY',message:'Canvas queue is full.'}}));return;}
        if(source==='device'&&message.arguments?.sessionId&&!this.rememberDeviceSession(message.arguments.sessionId))return;
        this.routes.set(id,{socket,original,source});message.requestId=id;
      }else if(message.type==='cancel'){
        message.requestId=`${source}:${message.requestId}`;
        // The upstream caller has already abandoned this request. Retaining its
        // route until uncooperative browser work finishes can exhaust all routes.
        this.routes.delete(message.requestId);
      }
      if(source==='device'&&message.type==='dispose-session')this.deviceSessions.delete(message.sessionId);
      this.emit(message);
    }
    rememberDeviceSession(id) {
      if(typeof id!=='string'||!id.length||id.length>128)return true;
      if(this.deviceSessions.has(id))return true;
      if(this.deviceSessions.size>=256){this.device?.close(4008,'Canvas session capacity reached.');return false;}
      this.deviceSessions.add(id);return true;
    }
    send(raw) {
      if(this.readyState!==1)throw new Error('MCP socket is not open.');
      const message=JSON.parse(raw);
      if(message.type==='result') {
        const route=this.routes.get(message.requestId);if(!route)return;
        this.routes.delete(message.requestId);
        if(route.source==='device'&&message.result?.sessionId)this.rememberDeviceSession(message.result.sessionId);
        if(route.socket.readyState===1)route.socket.send(JSON.stringify({...message,requestId:route.original}));
        return;
      }
      if(message.type==='hello')this.hello=raw;
      if(message.type==='catalog'){
        if(this.hello){const hello=JSON.parse(this.hello);hello.documents=message.documents;this.hello=JSON.stringify(hello);}
        if(this.primaryCatalog)this.primary.send(raw);
        if(this.deviceCatalog&&this.device?.readyState===1)this.device.send(raw);
        return;
      }
      this.primary.send(raw);
      if(this.device?.readyState===1)this.device.send(raw);
    }
    async connectDevice() {
      if(this.closed||this.readyState!==1)return;
      const remoteStatus=window.PENECHO_REMOTE_CLOUD_STATUS;
      let deviceId=remoteStatus?.deviceOnline===false?null:remoteStatus?.deviceId;
      if(this.local) {
        // A deadline releases the caller, not an uncooperative fetch/body read.
        // Retain single-flight ownership until the actual operation settles.
        if(this.checking||this.statusFlight){this.checkAgain=true;return;}
        this.checking=true;
        const flight=this.statusFlight={controller:new AbortController(),timer:null,expired:false};
        let cancel;
        const cancelled=new Promise((_,reject)=>{cancel=()=>reject(Error('Cloud status cancelled.'));flight.controller.signal.addEventListener('abort',cancel,{once:true});});
        try {
          const operation=(async()=>{
            const token=window.PENECHO_CONFIG?.accessSessionToken||sessionStorage.getItem('penecho-access-session');
            const response=await fetch('/api/cloud/status',{signal:flight.controller.signal,headers:token?{'x-penecho-session':token}:{}});
            flight.controller.signal.throwIfAborted();
            if(response.status>=500)throw Error('Cloud status is temporarily unavailable.');
            const status=response.ok?await response.json():null;
            flight.controller.signal.throwIfAborted();
            return status;
          })();
          const settled=()=>{
            if(this.statusFlight===flight)this.statusFlight=null;
            if(flight.expired&&!this.closed)this.scheduleDeviceRetry();
          };
          operation.then(settled,settled);
          flight.timer=setTimeout(()=>{flight.expired=true;flight.controller.abort();},DEVICE_STATUS_TIMEOUT_MS);
          const status=await Promise.race([operation,cancelled]);
          if(this.closed||flight.controller.signal.aborted)return;
          window.PenEchoMcpSettings?.setDeviceStatus(status?.device||{connected:false});
          deviceId=status?.cloudMcpEnabled?'cloud':null;
        }catch{deviceId=null;this.scheduleDeviceRetry();}finally{
          clearTimeout(flight.timer);flight.controller.signal.removeEventListener('abort',cancel);this.checking=false;
        }
        if(this.closed)return;
        if(this.checkAgain){this.checkAgain=false;return this.connectDevice();}
      }
      if(this.device){if(deviceId!==this.deviceId){this.deviceReady=false;this.deviceCatalog=false;this.publishAvailability();this.device.close();}return;}
      if(this.local?!deviceId:!/^[a-f0-9-]{36}$/i.test(deviceId||''))return;
      clearTimeout(this.retry);this.retry=null;
      this.deviceId=deviceId;
      const socket=this.device=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}${this.local?'/api/mcp/cloud-canvas':`/api/v1/remote-canvas/mcp?deviceId=${encodeURIComponent(deviceId)}`}`);
      this.deviceTimer=setTimeout(()=>{if(this.device===socket&&socket.readyState!==1)socket.close(4000,'MCP connection timed out.');},SOCKET_CONNECT_TIMEOUT_MS);
      socket.addEventListener('open',()=>{if(this.device!==socket||this.closed)return;clearTimeout(this.deviceTimer);this.retryCount=0;if(this.device===socket&&this.hello)socket.send(this.hello);});
      socket.addEventListener('message',event=>this.receive(event,socket,'device'));
      socket.addEventListener('close',()=>{
        if(this.device!==socket)return;clearTimeout(this.deviceTimer);this.device=null;this.deviceReady=false;this.deviceCatalog=false;this.publishAvailability();
        for(const [id,route] of this.routes)if(route.socket===socket){this.emit({type:'cancel',requestId:id});this.routes.delete(id);}
        for(const sessionId of this.deviceSessions)this.emit({type:'dispose-session',sessionId});this.deviceSessions.clear();
        this.scheduleDeviceRetry();
      });
    }
    scheduleDeviceRetry() {
      if(this.closed)return;
      clearTimeout(this.retry);
      this.retry=setTimeout(()=>{this.retry=null;this.connectDevice();},Math.min(30000,1000*2**Math.min(this.retryCount++,5))*(0.8+Math.random()*0.4));
    }
    close() {
      if(this.closed)return;this.closed=true;this.readyState=3;clearTimeout(this.retry);clearTimeout(this.primaryTimer);clearTimeout(this.deviceTimer);
      if(this.statusFlight){clearTimeout(this.statusFlight.timer);this.statusFlight.controller.abort();}
      window.removeEventListener(this.local?'penecho:cloud-account-changed':'penecho:remote-cloud-status',this.status);
      this.primaryReady=false;this.deviceReady=false;this.primaryCatalog=false;this.deviceCatalog=false;this.publishAvailability();
      this.primary.close();this.device?.close();this.device=null;this.routes.clear();this.deviceSessions.clear();
    }
  };
})();
