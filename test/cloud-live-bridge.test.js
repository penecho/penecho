"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),http=require("node:http"),{WebSocket,WebSocketServer}=require("ws");
const {CloudLiveBridge}=require("../src/server/cloud-live-bridge.js");
const listen=server=>new Promise(resolve=>server.listen(0,"127.0.0.1",()=>resolve(server.address().port)));

test("live targets are one exact Canvas or share link",()=>{
  const id="0f8b7c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f";
  assert.equal(String(CloudLiveBridge.query(`?canvas=${id.toUpperCase()}`)),`canvas=${id}`);
  assert.equal(String(CloudLiveBridge.query(`?share=${id}&extra=1`)),`share=${id}`);
  for(const bad of ["",`?canvas=${id}&share=${id}`,"?canvas=../../x","?other=1"])assert.equal(CloudLiveBridge.query(bad),null,bad);
});

test("the host relays live frames to Cloud with its own account session",async t=>{
  const seen=[];
  const cloud=new WebSocketServer({port:0,host:"127.0.0.1"});
  await new Promise(resolve=>cloud.once("listening",resolve));
  cloud.on("connection",(socket,request)=>{
    seen.push({authorization:request.headers.authorization,url:request.url});
    socket.on("message",data=>socket.send(JSON.stringify({type:"echo",data:JSON.parse(String(data))})));
  });
  const bridge=new CloudLiveBridge(),local=http.createServer(),sockets=new WebSocketServer({noServer:true});
  local.on("upgrade",(request,socket,head)=>sockets.handleUpgrade(request,socket,head,ws=>bridge.attach(ws,{origin:`http://127.0.0.1:${cloud.address().port}`,token:"local-account-session",query:CloudLiveBridge.query(new URL(request.url,"http://x").search)})));
  const port=await listen(local);
  t.after(()=>{bridge.close();local.close();cloud.close();});
  const id="0f8b7c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f",browser=new WebSocket(`ws://127.0.0.1:${port}/api/cloud/live/socket?canvas=${id}`);
  await new Promise(resolve=>browser.once("open",resolve));
  browser.send(JSON.stringify({type:"hello",have:3}));
  const reply=await new Promise(resolve=>browser.once("message",data=>resolve(JSON.parse(String(data)))));
  assert.deepEqual(reply,{type:"echo",data:{type:"hello",have:3}},"frames sent before Cloud answered are kept in order");
  assert.deepEqual(seen,[{authorization:"Bearer local-account-session",url:`/api/v1/live/socket?canvas=${id}`}]);
  const closed=new Promise(resolve=>browser.once("close",code=>resolve(code)));
  for(const socket of cloud.clients)socket.close(4403,"Sharing was turned off");
  assert.equal(await closed,4403,"Cloud's refusal reaches the page");
});

test("without an account the host joins a link by the link alone",async t=>{
  const seen=[];
  const cloud=new WebSocketServer({port:0,host:"127.0.0.1"});
  await new Promise(resolve=>cloud.once("listening",resolve));
  cloud.on("connection",(socket,request)=>{seen.push({authorization:request.headers.authorization,url:request.url});socket.send(JSON.stringify({type:"welcome"}));});
  const bridge=new CloudLiveBridge(),local=http.createServer(),sockets=new WebSocketServer({noServer:true});
  local.on("upgrade",(request,socket,head)=>sockets.handleUpgrade(request,socket,head,ws=>bridge.attach(ws,{origin:`http://127.0.0.1:${cloud.address().port}`,token:null,query:CloudLiveBridge.query(new URL(request.url,"http://local").search)})));
  const port=await listen(local);
  t.after(()=>{bridge.close();local.close();cloud.close();});
  const id="0f8b7c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f",browser=new WebSocket(`ws://127.0.0.1:${port}/api/cloud/live/socket?share=${id}`);
  assert.deepEqual(JSON.parse(String(await new Promise(resolve=>browser.once("message",resolve)))),{type:"welcome"});
  assert.deepEqual(seen,[{authorization:undefined,url:`/api/v1/live/socket?share=${id}`}],"no account credential is sent");
  browser.close();
});
