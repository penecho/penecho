/* One Canvas execution queue receives local, account and Linked Device MCP calls. */
(() => {
  'use strict';
  const DEVICE_STATUS_TIMEOUT_MS=5000;
  window.PenEchoCloudMcpSocket = class extends EventTarget {
    constructor() {
      super();this.local=window.PENECHO_CONFIG?.runtime!=='cloud';this.readyState=0;this.routes=new Map();this.deviceSessions=new Set();this.closed=false;this.hello=null;this.retry=null;this.device=null;this.deviceId=null;this.retryCount=0;this.primaryReady=false;this.deviceReady=false;this.primaryCatalog=false;this.deviceCatalog=false;
      this.primary=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}${this.local?'/api/mcp/canvas':'/api/v1/mcp/canvas'}`);
      this.primary.addEventListener('open',()=>{if(this.closed)return;this.readyState=1;this.dispatchEvent(new Event('open'));this.connectDevice();});
      this.primary.addEventListener('message',event=>this.receive(event,this.primary,'cloud'));
      this.primary.addEventListener('error',()=>this.dispatchEvent(new Event('error')));
      this.primary.addEventListener('close',event=>{if(this.closed)return;const closed=new Event('close');Object.defineProperties(closed,{code:{value:Number(event.code)||1006},reason:{value:String(event.reason||'')}});this.close();this.dispatchEvent(closed);});
      this.status=()=>this.connectDevice();window.addEventListener(this.local?'penecho:cloud-account-changed':'penecho:remote-cloud-status',this.status);
    }
    emit(message){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(message)}));}
    get availability(){return {cloud:this.local?this.deviceReady:this.primaryReady,local:this.local?this.primaryReady:this.deviceReady};}
    publishAvailability(){this.dispatchEvent(new Event('availabilitychange'));}
    receive(event,socket,source) {
      if(this.closed || socket!==this.primary&&socket!==this.device)return;
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(message.type==='ready'){
        if(socket===this.primary){this.primaryReady=true;this.primaryCatalog=message.catalog===true;}
        else {this.deviceReady=true;this.deviceCatalog=message.catalog===true;}
        this.publishAvailability();
      }
      if(source==='device'&&['ready','pong','lan-status-changed'].includes(message.type))return;
      if(message.type==='call') {
        const original=message.requestId,id=`${source}:${original}`;
        if(this.routes.size>=64){socket.send(JSON.stringify({type:'result',requestId:original,ok:false,error:{code:'CANVAS_BUSY',message:'Canvas queue is full.'}}));return;}
        this.routes.set(id,{socket,original,source});message.requestId=id;
        if(source==='device'&&message.arguments?.sessionId)this.deviceSessions.add(message.arguments.sessionId);
      }else if(message.type==='cancel'){
        message.requestId=`${source}:${message.requestId}`;
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
        if(route.source==='device'&&message.result?.sessionId)this.deviceSessions.add(message.result.sessionId);
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
        if(this.checking){this.checkAgain=true;return;}
        this.checking=true;
        let statusTimer=null;
        try {
          const token=window.PENECHO_CONFIG?.accessSessionToken||sessionStorage.getItem('penecho-access-session');
          const status=await Promise.race([
            (async()=>{
              const response=await fetch('/api/cloud/status',{headers:token?{'x-penecho-session':token}:{}});
              if(response.status>=500)throw Error('Cloud status is temporarily unavailable.');
              return response.ok?await response.json():null;
            })(),
            new Promise((_,reject)=>{statusTimer=setTimeout(()=>reject(Error('Cloud status timed out.')),DEVICE_STATUS_TIMEOUT_MS);}),
          ]);
          window.PenEchoMcpSettings?.setDeviceStatus(status?.device||{connected:false});
          deviceId=status?.cloudMcpEnabled?'cloud':null;
        }catch{deviceId=null;this.scheduleDeviceRetry();}finally{clearTimeout(statusTimer);this.checking=false;}
        if(this.closed)return;
        if(this.checkAgain){this.checkAgain=false;return this.connectDevice();}
      }
      if(this.device){if(deviceId!==this.deviceId){this.deviceReady=false;this.deviceCatalog=false;this.publishAvailability();this.device.close();}return;}
      if(this.local?!deviceId:!/^[a-f0-9-]{36}$/i.test(deviceId||''))return;
      clearTimeout(this.retry);this.retry=null;
      this.deviceId=deviceId;
      const socket=this.device=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}${this.local?'/api/mcp/cloud-canvas':`/api/v1/remote-canvas/mcp?deviceId=${encodeURIComponent(deviceId)}`}`);
      socket.addEventListener('open',()=>{this.retryCount=0;if(this.device===socket&&this.hello)socket.send(this.hello);});
      socket.addEventListener('message',event=>this.receive(event,socket,'device'));
      socket.addEventListener('close',()=>{
        if(this.device!==socket)return;this.device=null;this.deviceReady=false;this.deviceCatalog=false;this.publishAvailability();
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
      if(this.closed)return;this.closed=true;this.readyState=3;clearTimeout(this.retry);
      window.removeEventListener(this.local?'penecho:cloud-account-changed':'penecho:remote-cloud-status',this.status);
      this.primaryReady=false;this.deviceReady=false;this.primaryCatalog=false;this.deviceCatalog=false;this.publishAvailability();
      this.primary.close();this.device?.close();this.device=null;this.routes.clear();this.deviceSessions.clear();
    }
  };
})();
