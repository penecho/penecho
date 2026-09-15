'use strict';
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto');
const {Transform}=require('node:stream');
const discovery=require('./discovery-client.js');
const MAX_INPUT=32*1024*1024,MAX_RESPONSE=64*1024;
const SERVER_ERRORS={
  CANVAS_NOT_VISIBLE:'Open the intended document in the selected Canvas, then verify canvasId and documentId before retrying.',
  CANVAS_BUSY:'The selected Canvas is busy. Retry explicitly after pending work finishes.',
  REQUEST_ID_CONFLICT:'This requestId was already used with different upload inputs. Use the original file and target or a new requestId.',
  canvas_timeout:'The original Canvas did not respond in time. Inspect it before explicitly retrying with the same requestId.',
  request_cancelled:'The upload was cancelled. Inspect the original Canvas before explicitly retrying with the same requestId.',
  canvas_not_found:'Connect the selected Canvas and enable MCP access, then retry.',
  document_mismatch:'The selected Canvas contains a different document. Verify canvasId and documentId before retrying.',
  DOCUMENT_MISMATCH:'The selected Canvas contains a different document. Verify canvasId and documentId before retrying.',
  DOCUMENT_CONFLICT:'The selected Canvas contains a different document. Verify canvasId and documentId before retrying.',
  SOURCE_CONFLICT:'This requestId was already used with different image bytes. Use the original file or a new requestId.',
  unsupported_image:'Export the image as PNG, JPEG, WebP, GIF, TIFF, AVIF or HEIF and retry.',
  image_codec_unavailable:'The host cannot decode this image codec. Export it as PNG or JPEG and retry.',
  invalid_image:'The image could not be decoded. Export a valid PNG or JPEG and retry.',
  image_too_large:'Reduce the image below 32 MiB and 40 megapixels, then retry.',
  image_encoder_unavailable:'Restore the host PenEcho image dependencies, then retry.',
  canvas_busy:'The selected Canvas is busy. Retry explicitly after pending work finishes.',
  canvas_disconnected:'Reconnect the original Canvas before explicitly retrying with the same requestId.'
};
function rejection(status,body,dispatched){
  const serverCode=typeof body?.error?.code==='string'&&Object.hasOwn(SERVER_ERRORS,body.error.code)?body.error.code:undefined;
  const definite=status>=400&&status<500&&![408,499].includes(status)&&!['canvas_disconnected','canvas_timeout','request_cancelled'].includes(serverCode);
  return Object.assign(failure(status===401||status===403?'AUTH_REJECTED':'UPLOAD_REJECTED',dispatched),{outcome:definite?'rejected':'unknown',status,...(serverCode?{serverCode}:{})});
}
function uploadName(file,pathAPI=path){return pathAPI.basename(file);}
function failure(code,dispatched=false){return Object.assign(Error(code),{code,dispatched});}
function metadata(body,options){
  if(!body||body.documentId!==options.documentId||body.canvasId!==options.canvasId||body.requestId!==options.requestId||!/^penecho-asset:[a-f0-9]{64}$/.test(body.source||'')||body.assetId!==body.source.slice(14)||!/^[a-f0-9]{64}$/.test(body.inputSha256||'')||typeof body.name!=='string'||!body.name.length||body.name.length>200||!['image/png','image/jpeg','image/webp'].includes(body.mediaType)||!['bytes','width','height','revision'].every(key=>Number.isSafeInteger(body[key])&&body[key]>=(key==='revision'?0:1)))throw failure('INVALID_RESPONSE',true);
  return Object.fromEntries(['source','assetId','name','mediaType','bytes','width','height','documentId','canvasId','requestId','inputSha256','revision','reused'].filter(key=>key!=='reused'||typeof body[key]==='boolean').map(key=>[key,body[key]]));
}
function requestUpload(endpoint,credentials,stream,size,options){
  const target=new URL(discovery.validateURL(endpoint));target.pathname='/mcp/images';target.search='';
  for(const key of ['canvasId','documentId','requestId','name'])target.searchParams.set(key,options[key]);
  return new Promise((resolve,reject)=>{
    let dispatched=false,finished=false,received=0,timer;const chunks=[];
    const req=https.request(target,{method:'POST',ca:credentials.certificatePem,rejectUnauthorized:true,lookup:discovery.privateLookup,agent:false,signal:options.signal,headers:{authorization:`Bearer ${credentials.accessToken}`,'content-type':'application/octet-stream','content-length':size,accept:'application/json'}},res=>{
      res.on('error',()=>finish(failure('UPLOAD_FAILED',dispatched)));
      res.on('aborted',()=>finish(failure('UPLOAD_FAILED',dispatched)));
      res.on('data',chunk=>{received+=chunk.length;if(received>MAX_RESPONSE)finish(failure('INVALID_RESPONSE',dispatched));else chunks.push(chunk);});
      res.on('end',()=>{
        if(res.statusCode<200||res.statusCode>=300){let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{}return finish(rejection(res.statusCode,body,dispatched));}
        try{finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{finish(failure('INVALID_RESPONSE',dispatched));}
      });
    });
    function finish(error,value){if(finished)return;finished=true;clearTimeout(timer);stream.unpipe(req);stream.destroy();req.destroy();if(error)reject(error);else resolve(value);}
    req.on('socket',socket=>socket.once('secureConnect',()=>{dispatched=true;}));
    req.on('error',()=>finish(failure('UPLOAD_FAILED',dispatched)));
    stream.on('error',()=>finish(failure('READ_FAILED',dispatched)));
    timer=setTimeout(()=>finish(failure('UPLOAD_TIMEOUT',dispatched)),options.timeoutMs||120000);
    stream.pipe(req);
  });
}
async function uploadImage(options={}){
  const requestId=options.requestId||crypto.randomUUID(),settings={...options,requestId};
  let handle,stream,bound,operation,requestStarted=false,timedOut=false,cancelled=false,cancelReject;
  const controller=new AbortController();
  const cancellation=new Promise((_,reject)=>{cancelReject=reject;});
  // A pre-aborted caller may exit before constructing the race.
  cancellation.catch(()=>{});
  const cleanup=async()=>{stream?.destroy();bound?.destroy();const opened=handle;handle=undefined;await opened?.close();};
  const abort=()=>{
    if(cancelled)return;
    cancelled=true;
    controller.abort();
    const error=failure('request_cancelled',requestStarted);
    error.outcome=requestStarted?'unknown':'not_dispatched';
    cancelReject(error);
  };
  const requestedTimeout=Number(options.timeoutMs),timeoutMs=Number.isFinite(requestedTimeout)&&requestedTimeout>0?requestedTimeout:120000;
  const timer=setTimeout(()=>{if(cancelled)return;cancelled=true;timedOut=true;controller.abort();const error=failure('UPLOAD_TIMEOUT',requestStarted);error.outcome=requestStarted?'unknown':'not_dispatched';cancelReject(error);},timeoutMs);
  options.signal?.addEventListener('abort',abort,{once:true});
  if(options.signal?.aborted)abort();
  try{
    if(cancelled)throw failure('request_cancelled',requestStarted);
    operation=(async()=>{
      try {
      controller.signal.throwIfAborted();
      if(!/^[a-f0-9]{64}$/i.test(options.hostId||'')||!path.isAbsolute(options.uploadImage||'')||!['canvasId','documentId','requestId'].every(key=>typeof settings[key]==='string'&&settings[key].length>0&&settings[key].length<=(key==='documentId'?256:128)&&!/[\x00-\x1f]/.test(settings[key])))throw failure('INVALID_ARGUMENT');
      settings.name=uploadName(options.uploadImage);if(!settings.name||settings.name.length>200)throw failure('INVALID_ARGUMENT');
      handle=await fs.promises.open(options.uploadImage,fs.constants.O_RDONLY|(fs.constants.O_NONBLOCK||0));controller.signal.throwIfAborted();const stat=await handle.stat();controller.signal.throwIfAborted();if(!stat.isFile()||stat.size<=0||stat.size>MAX_INPUT)throw failure('INVALID_FILE');
      const credentials=await (options.loadCredentials||discovery.loadCredentials)(options.hostId,options);controller.signal.throwIfAborted();
      const endpoint=await (options.resolveEndpoint||discovery.resolveEndpoint)({...options,signal:controller.signal});controller.signal.throwIfAborted();
      let total=0;const hash=crypto.createHash('sha256');
      bound=new Transform({transform(chunk,encoding,callback){total+=chunk.length;if(total>MAX_INPUT||total>stat.size)return callback(failure('INVALID_FILE'));hash.update(chunk);callback(null,chunk);},flush(callback){callback(total===stat.size?null:failure('INVALID_FILE'));}});
      stream=handle.createReadStream({autoClose:false,highWaterMark:64*1024});stream.on('error',()=>bound.destroy(failure('READ_FAILED')));stream.pipe(bound);
      requestStarted=true;
      const response=metadata(await (options.requestUpload||requestUpload)(endpoint.url,credentials,bound,stat.size,{...settings,signal:controller.signal}),settings);
      if(total!==stat.size||response.inputSha256!==hash.digest('hex'))throw failure('INVALID_RESPONSE',true);
      return {ok:true,...response};
      } finally { await cleanup(); }
    })();
    return await Promise.race([operation,cancellation]);
  }catch(error){const known=['INVALID_ARGUMENT','INVALID_FILE','INVALID_RESPONSE','AUTH_REJECTED','UPLOAD_REJECTED','UPLOAD_FAILED','UPLOAD_TIMEOUT','READ_FAILED','request_cancelled'];const code=timedOut?'UPLOAD_TIMEOUT':cancelled?'request_cancelled':known.includes(error.code)?error.code:'UPLOAD_FAILED';throw Object.assign(Error(code),{code,requestId,outcome:error.outcome|| (error.dispatched||requestStarted?'unknown':'not_dispatched'),...(Object.hasOwn(SERVER_ERRORS,error.serverCode)?{serverCode:error.serverCode}:{}),...(Number.isInteger(error.status)?{status:error.status}:{})});
  }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);operation?.catch(()=>{});await cleanup();}
}
async function main(options={},io={}){
  try{(io.stdout||process.stdout).write(JSON.stringify(await uploadImage(options))+'\n');return 0;}
  catch(error){(io.stderr||process.stderr).write(JSON.stringify({ok:false,code:error.code,requestId:error.requestId,outcome:error.outcome,...(error.serverCode?{serverCode:error.serverCode}:{}),...(error.status?{status:error.status}:{}),error:[error.serverCode?SERVER_ERRORS[error.serverCode]:error.code==='AUTH_REJECTED'?'Host authentication was rejected. Reimport the host credentials.':error.outcome==='rejected'?'The host rejected the upload. Verify the file format and Canvas target.':'Image upload failed; verify file, target and host credentials.',...(error.outcome==='unknown'?['Upload may have completed. Retry explicitly with this requestId and the same file and target.']:[])].join(' ')})+'\n');return 1;}
}
module.exports={MAX_INPUT,MAX_RESPONSE,uploadName,metadata,requestUpload,uploadImage,main};
