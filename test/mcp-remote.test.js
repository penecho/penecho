"use strict";
const assert = require("node:assert/strict");
const {test} = require("node:test");
const {createRemoteMcpChannels,MAX_CHANNELS,MAX_FRAME_BYTES} = require("../src/server/mcp/remote.js");
test("remote browser lease expires despite host output and synthetic native pongs", async t => {
  t.mock.timers.enable({apis:["setTimeout"]});
  let socket, closed=false;
  const remote=createRemoteMcpChannels({attach:ws=>{socket=ws;ws.on("close",()=>closed=true);},leaseMs:35,pollMs:10});
  const {channelId}=await remote.execute({operation:"canvas.mcp.open"});
  t.mock.timers.tick(20);
  socket.ping(); socket.send('{}');
  t.mock.timers.tick(25);
  assert.equal(closed,true);
  await assert.rejects(remote.execute({operation:"canvas.mcp.pull",channelId}),{code:"mcp_remote_session"});
  remote.close();
});
test("remote channels bound frame size, queues, channel count and concurrent polls",async()=>{
  const sockets=[];
  const remote=createRemoteMcpChannels({attach:ws=>sockets.push(ws),pollMs:20});
  try {
    const ids=[];
    for(let i=0;i<MAX_CHANNELS;i++)ids.push((await remote.execute({operation:"canvas.mcp.open"})).channelId);
    await assert.rejects(remote.execute({operation:"canvas.mcp.open"}),{code:"mcp_remote_limit"});
    const channelId=ids[0];
    await assert.rejects(remote.execute({operation:"canvas.mcp.frame",channelId,frame:'x'.repeat(MAX_FRAME_BYTES+1)}),{code:"mcp_remote_frame"});
    await assert.rejects(remote.execute({operation:"canvas.mcp.frame",channelId,frame:'not json'}),{code:"mcp_remote_frame"});
    const poll=remote.execute({operation:"canvas.mcp.pull",channelId});
    await assert.rejects(remote.execute({operation:"canvas.mcp.pull",channelId}),{code:"mcp_remote_poll_conflict"});
    await remote.execute({operation:"canvas.mcp.close",channelId});
    assert.deepEqual(await poll,{frames:[],closed:true});
    for(let i=0;i<128;i++)sockets[1].send('{}');
    assert.throws(()=>sockets[1].send('{}'),{code:"mcp_remote_limit"});
    await assert.rejects(remote.execute({operation:"canvas.mcp.pull",channelId:ids[1]}),{code:"mcp_remote_session"});
    await assert.rejects(remote.execute({operation:"canvas.http"}),{code:"mcp_remote_operation"});
  } finally {remote.close();}
});

test("disconnect revokes IDs without stopping new channels and pull batches fit relay limits",async()=>{
  const sockets=[],remote=createRemoteMcpChannels({attach:ws=>sockets.push(ws)});
  try {
    const {channelId}=await remote.execute({operation:"canvas.mcp.open"});
    const frame='x'.repeat(7*1024*1024);
    sockets[0].send(frame);sockets[0].send(frame);
    assert.equal((await remote.execute({operation:"canvas.mcp.pull",channelId})).frames.length,1);
    assert.equal((await remote.execute({operation:"canvas.mcp.pull",channelId})).frames.length,1);
    remote.disconnect();
    await assert.rejects(remote.execute({operation:"canvas.mcp.pull",channelId}),{code:"mcp_remote_session"});
    assert.notEqual((await remote.execute({operation:"canvas.mcp.open"})).channelId,channelId);
  }finally{remote.close();}
});
