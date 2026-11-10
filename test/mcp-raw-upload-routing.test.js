'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),https=require('node:https'),crypto=require('node:crypto');
const {WebSocket}=require('ws');
const {createMcpService}=require('../src/server/mcp/service.js');
const sharp=require('sharp');

test('authenticated raw upload routes through the opted-in connection without a conversation',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-upload-routing-'));
 const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const service=createMcpService({server,authorizeBrowser:()=>false,autoStartHttp:false,stateDirectory:directory,registryStateDirectory:directory,lanAddresses:()=>[],directAnnounce:()=>({close(){}})});
 let ws; t.after(async()=>{ws?.terminate();await service.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
 const calls=[];
 ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/api/mcp/canvas`);
 await new Promise((resolve,reject)=>{ws.once('error',reject);ws.once('open',()=>ws.send(JSON.stringify({type:'hello',canvasId:'canvas-raw',title:'Test'})));ws.on('message',raw=>{
  const m=JSON.parse(raw);if(m.type==='ready')return resolve();if(m.type!=='call')return;calls.push(m);
  const a=m.arguments,b=Buffer.from(a.source.split(',')[1],'base64'),assetId=crypto.createHash('sha256').update(b).digest('hex');
  ws.send(JSON.stringify({type:'result',requestId:m.requestId,ok:true,result:{documentId:a.documentId==='wrong'?'other':a.documentId,assetId,source:`penecho-asset:${assetId}`,name:a.name,mediaType:a.source.slice(5,a.source.indexOf(';')),bytes:b.length,width:32,height:24,revision:1}}));
 });});
 const status=await service.startDirect(),bytes=await sharp({create:{width:32,height:24,channels:4,background:'#12345688'}}).tiff().toBuffer();
 const upload=canvasId=>new Promise((resolve,reject)=>{
  const url=new URL(status.localUrl);url.pathname='/mcp/images';url.search=new URLSearchParams({canvasId,documentId:'doc-raw',requestId:'request-raw',name:'original.tiff'}).toString();
  const req=https.request(url,{method:'POST',ca:status.certificatePem,agent:false,headers:{authorization:`Bearer ${status.accessToken}`,'content-type':'application/octet-stream'}},res=>{let text='';res.on('data',v=>text+=v);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);req.end(bytes);
 });
 const result=await upload('canvas-raw');assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.documentId,'doc-raw');assert.equal(result.body.canvasId,'canvas-raw');assert.equal(result.body.inputSha256,crypto.createHash('sha256').update(bytes).digest('hex'));
 assert.deepEqual(calls.map(c=>c.name),['mcp_upload_image_to_document']);assert.equal(calls[0].arguments.sessionId,undefined);assert.equal(calls[0].arguments.originalName,'original.tiff');
 assert.equal((await upload('missing')).status,404);assert.equal(calls.length,1);
 ws.close();await new Promise(resolve=>ws.once('close',resolve));assert.equal((await upload('canvas-raw')).status,404);
});
