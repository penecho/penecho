"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");
const { recordsDirectory, writeRecord } = require("../src/server/mcp/records.js");
const { PROTOCOL_VERSION, PenEchoStdioServer } = require("../src/server/mcp/stdio.js");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function close(server) { return new Promise(resolve => server.close(resolve)); }

function outputReader(stream) {
  let buffer = "";
  const queue = [], waiters = [];
  stream.on("data", chunk => {
    buffer += chunk.toString("utf8");
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n"), line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const value = JSON.parse(line), waiter = waiters.shift();
      if (waiter) waiter(value); else queue.push(value);
    }
  });
  return () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiters.push(resolve));
}

test("stdio MCP negotiates 2025-11-25, lists tools, emits image blocks, and keeps one owner id", async t => {
  const secret = crypto.randomBytes(32).toString("hex"), instanceId = crypto.randomUUID(), owners = [];
  const httpServer = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${secret}`);
    assert.equal(req.headers["x-penecho-mcp-instance"], instanceId);
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      owners.push(body.ownerId);
      if (body.name === "penecho_inspect_session") return;
      if (body.name === "penecho_inbox" && body.arguments.mode === "ack") {
        const bytes = Buffer.from(JSON.stringify({error:{code:"SOURCE_CONFLICT",message:"Retry after reading.",details:{retry:"read-before-patch"}}}));
        res.writeHead(409,{"content-type":"application/json","content-length":bytes.length}).end(bytes);
        return;
      }
      let result = { instanceId, canvases:[{canvasId:"canvas-a",instanceId,title:"Board"}] };
      if (body.name === "penecho_start_session") result = {sessionId:"session-a",boardObjectId:null,revision:1};
      if (body.name === "penecho_capture_canvas" && body.arguments.target === "artifact") result = { sessionId:"session-a", artifactId:"chart",requestId:"chart", image:{mimeType:"image/png",data:"AQID",bytes:3},width:10,height:20 };
      if (body.name === "penecho_capture_canvas" && body.arguments.target !== "artifact") result = { sessionId:"session-a", target:"viewport", image:{mimeType:"image/webp",data:"AQIDBA==",bytes:4},pixelVerified:true,width:24,height:12,encodedBytes:4,revision:7 };
      if (body.name === "penecho_present_widget") result = { sessionId:"session-a", artifactId:"combined",requestId:"combined", objectId:"object-a", image:{mimeType:"image/png",data:"BAUG",bytes:3},width:30,height:40 };
      if (body.name === "penecho_draw") result = { sessionId:"session-a", artifactId:"drawing",requestId:"drawing", objectId:"draw-a", objectIds:["draw-a"], kind:"drawing", applied:true, pixelVerified:true, image:{mimeType:"image/webp",data:"CgsM",bytes:3},width:16,height:12 };
      if (body.name === "penecho_plot") result = { sessionId:"session-a", artifactId:"plot",requestId:"plot", objectId:"plot-a", objectIds:["plot-a"], kind:"plot", applied:true, pixelVerified:false };
      if (body.name === "penecho_inbox" && body.arguments.mode !== "ack") result = { sessionId:"session-a", messages:{messages:[],after:0,nextCursor:0,latestCursor:0,hasMore:false},feedback:{after:0,nextCursor:1,latestCursor:1,hasMore:false,truncated:false,entries:[{cursor:1,kind:"text",text:"Feedback"}]}, image:{mimeType:"image/webp",data:"BwgJ",bytes:3},pixelVerified:true,width:12,height:8 };
      const bytes = Buffer.from(JSON.stringify({ result }));
      res.writeHead(200, {"content-type":"application/json","content-length":bytes.length}).end(bytes);
    });
  });
  const address = await listen(httpServer), input = new PassThrough(), output = new PassThrough(), next = outputReader(output);
  const stdio = new PenEchoStdioServer({ input, output, record:{ instanceId, secret, port:address.port, host:"127.0.0.1" } }).start();
  t.after(async () => {
    stdio.close();
    input.end();
    if (httpServer.listening) await close(httpServer);
  });
  const send = value => input.write(`${JSON.stringify(value)}\n`);
  send({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:PROTOCOL_VERSION,capabilities:{},clientInfo:{name:"test",version:"1"}}});
  const initialized = await next();
  assert.equal(initialized.result.protocolVersion, PROTOCOL_VERSION);
  assert.equal(initialized.result.instructions,require("../src/server/mcp/guidance.js").PUBLIC_INSTRUCTIONS);
  assert.ok(initialized.result.instructions.length/4<=250);
  assert.match(initialized.result.instructions,/cursors are independent/);
  assert.match(initialized.result.instructions,/mark done only after success/);
  send({jsonrpc:"2.0",method:"notifications/initialized"});
  send({jsonrpc:"2.0",id:2,method:"tools/list",params:{}});
  const listedTools = await next();
  assert.deepEqual(listedTools.result.tools,require("../src/server/mcp/schema.js").TOOLS);
  assert.equal(listedTools.result.tools.length,20);
  assert.deepEqual(listedTools.result.tools.find(tool=>tool.name==="penecho_rename_canvas").inputSchema.required,["instanceId","canvasId","documentId","title","requestId"]);
  assert.ok(listedTools.result.tools.find(tool=>tool.name==="penecho_inbox"));
  const widgetPresentation = listedTools.result.tools.find(tool => tool.name === "penecho_present_widget").inputSchema.properties.presentation;
  assert.deepEqual(widgetPresentation.properties.size.enum, ["base","wide","tall","large","page"]);
  assert.equal(listedTools.result.tools.find(tool => tool.name === "penecho_present_widget").inputSchema.properties.capture.default, false);
  assert.equal(widgetPresentation.additionalProperties, false);
  send({jsonrpc:"2.0",id:11,method:"prompts/list",params:{}});
  const prompts = await next();
  assert.deepEqual(prompts.result.prompts.map(prompt => prompt.name), ["penecho_visual_explorer","penecho_explain_selection","penecho_revise_feedback","penecho_resume_document"]);
  send({jsonrpc:"2.0",id:15,method:"prompts/get",params:{name:"penecho_visual_explorer",arguments:{}}});
  const visualPrompt = (await next()).result.messages[0].content.text;
  const { visualExplorerPrompt } = require("../src/server/mcp/guidance.js");
  assert.equal(visualPrompt, visualExplorerPrompt());
  assert.ok(visualPrompt.includes(require("../src/server/mcp/guidance.js").PAGE_PREVIEW_INSTRUCTIONS), "optional Visual Explorer keeps the same contract");
  assert.match(visualPrompt, /Concise Document Mode/);
  assert.match(visualPrompt, /penecho_present_widget/);
  assert.match(visualPrompt, /preserve the target product UI, its page background, and real local interactions/);
  assert.match(visualPrompt, /Inspect must faithfully render the supplied HTML at the requested viewport/);
  assert.doesNotMatch(visualPrompt, /canvas_create|load_visual_skill|plannedWidget/);
  assert.ok(initialized.result.instructions.length < 5000, "default instructions stay compact");
  assert.match(listedTools.result.tools.find(t=>t.name==="penecho_start_session").description,/target:current binds the visible document/);
  assert.deepEqual(listedTools.result.tools.find(t=>t.name==="penecho_start_session").inputSchema.properties.target.enum,["current"]);
  assert.match(initialized.result.instructions,/stable sessionKey per conversation/);
  send({jsonrpc:"2.0",id:17,method:"prompts/get",params:{name:"penecho_explain_selection",arguments:{}}});
  const selectionPrompt = (await next()).result.messages[0].content.text;
  assert.match(selectionPrompt, /target:"current" before reading the current selection/);
  assert.match(selectionPrompt, /do not create or open another Canvas/);
  send({jsonrpc:"2.0",id:16,method:"prompts/get",params:{name:"penecho_visual_explorer",arguments:{unsupported:"value"}}});
  assert.equal((await next()).error.code, -32602);
  send({jsonrpc:"2.0",id:12,method:"prompts/get",params:{name:"penecho_resume_document",arguments:{documentId:"document-a"}}});
  assert.match((await next()).result.messages[0].content.text, /show:false/);
  send({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"penecho_list_canvases",arguments:{}}});
  const canvases = await next();
  assert.equal(canvases.result.structuredContent.canvases[0].canvasId, "canvas-a");
  send({jsonrpc:"2.0",id:4,method:"tools/call",params:{name:"penecho_start_session",arguments:{canvasId:"canvas-a",instanceId,title:"Work"}}});
  const started = await next();
  assert.equal(started.result.structuredContent.sessionId, "session-a");
  assert.equal(started.result.structuredContent.boardObjectId, null);
  send({jsonrpc:"2.0",id:5,method:"tools/call",params:{name:"penecho_capture_canvas",arguments:{sessionId:"session-a",target:"artifact",artifactId:"chart",quality:"detail"}}});
  const capture = await next();
  assert.deepEqual(capture.result.content[0], {type:"image",data:"AQID",mimeType:"image/png"});
  assert.deepEqual(capture.result.structuredContent.image, {mimeType:"image/png",bytes:3});
  assert.equal(capture.result.structuredContent.image.data, undefined);
  send({jsonrpc:"2.0",id:14,method:"tools/call",params:{name:"penecho_capture_canvas",arguments:{sessionId:"session-a"}}});
  const canvasCapture = await next();
  assert.deepEqual(canvasCapture.result.content[0], {type:"image",data:"AQIDBA==",mimeType:"image/webp"});
  assert.deepEqual(canvasCapture.result.structuredContent.image, {mimeType:"image/webp",bytes:4});
  assert.equal(canvasCapture.result.structuredContent.pixelVerified, true);
  send({jsonrpc:"2.0",id:6,method:"tools/call",params:{name:"penecho_present_widget",arguments:{sessionId:"session-a",artifactId:"combined",requestId:"combined",title:"Combined",html:"<p>Combined</p>",capture:true,quality:"basic"}}});
  const combined = await next();
  assert.deepEqual(combined.result.content[0], {type:"image",data:"BAUG",mimeType:"image/png"});
  assert.equal(combined.result.structuredContent.objectId, "object-a");
  assert.equal(combined.result.structuredContent.image.data, undefined);
  send({jsonrpc:"2.0",id:9,method:"tools/call",params:{name:"penecho_draw",arguments:{sessionId:"session-a",artifactId:"drawing",requestId:"drawing",title:"Drawing",items:[{id:"n",type:"rect"}],capture:true}}});
  const drawing = await next();
  assert.deepEqual(drawing.result.content[0], {type:"image",data:"CgsM",mimeType:"image/webp"});
  assert.deepEqual(drawing.result.structuredContent.objectIds, ["draw-a"]);
  assert.equal(drawing.result.structuredContent.kind, "drawing");
  assert.equal(drawing.result.structuredContent.image.data, undefined);
  send({jsonrpc:"2.0",id:10,method:"tools/call",params:{name:"penecho_plot",arguments:{sessionId:"session-a",artifactId:"plot",requestId:"plot",title:"Plot",expression:"x*x"}}});
  const plot = await next();
  assert.deepEqual(plot.result.structuredContent.objectIds, ["plot-a"]);
  assert.equal(plot.result.structuredContent.kind, "plot");
  assert.equal(plot.result.content[0].type, "text");
  send({jsonrpc:"2.0",id:7,method:"tools/call",params:{name:"penecho_inbox",arguments:{sessionId:"session-a",capture:true}}});
  const feedback = await next();
  assert.deepEqual(feedback.result.content[0], {type:"image",data:"BwgJ",mimeType:"image/webp"});
  assert.equal(feedback.result.structuredContent.entries, undefined);
  assert.equal(feedback.result.structuredContent.feedback.entries.length, 1);
  assert.equal(feedback.result.structuredContent.feedback.nextCursor, 1);
  assert.equal(feedback.result.structuredContent.pixelVerified, true);
  assert.equal(feedback.result.structuredContent.image.data, undefined);
  send({jsonrpc:"2.0",id:13,method:"tools/call",params:{name:"penecho_inbox",arguments:{sessionId:"session-a",mode:"ack",ids:["request-a"],status:"working"}}});
  const structuredError = await next();
  assert.equal(structuredError.result.isError,true);
  assert.deepEqual(structuredError.result.structuredContent,{code:"SOURCE_CONFLICT",message:"Retry after reading.",details:{retry:"read-before-patch"}});
  assert.equal(owners.length, 9);
  assert.equal(new Set(owners).size, 1);
  send({jsonrpc:"2.0",id:8,method:"tools/call",params:{name:"penecho_inspect_session",arguments:{sessionId:"session-a"}}});
  send({jsonrpc:"2.0",method:"notifications/cancelled",params:{requestId:8,reason:"test"}});
  const cancelled = await next();
  assert.deepEqual(cancelled, {jsonrpc:"2.0",id:8,error:{code:-32800,message:"Request cancelled"}});
  stdio.close();
  input.end();
  await close(httpServer);
});

test("stdio keeps pending updates compact and acknowledges pull messages directly", async t => {
  const secret = crypto.randomBytes(32).toString("hex"), instanceId = crypto.randomUUID(), bodies = [];
  let messageIndex = 0;
  const httpServer = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      const args = body.arguments || {};
      let result = { instanceId, canvases:[{canvasId:"canvas-a",instanceId,title:"Board"}] };
      if (body.name === "penecho_start_session") result = {sessionId:"session-a",boardObjectId:null,revision:1};
      if (body.name === "penecho_update_session") result = {accepted:true,applied:false,pixelVerified:false,queuedAt:123,sessionId:"session-a"};
      if (body.name === "penecho_present_widget") result = {sessionId:"session-a",artifactId:args.artifactId,objectId:"object-a",applied:true,pixelVerified:false};
      if (body.name === "penecho_inbox" && body.arguments.mode !== "ack") {
        const id = messageIndex++ === 0 ? "request-done" : "request-error";
        result = {sessionId:"session-a",after:args.messageAfter || 0,nextCursor:messageIndex,latestCursor:messageIndex,hasMore:false,messages:[{id,cursor:messageIndex,text:"Continue"}]};
      }
      if (body.name === "penecho_inbox" && body.arguments.mode === "ack") result = {sessionId:"session-a",acknowledged:args.ids,status:args.status};
      if(body.name==="penecho_inbox"&&body.arguments.mode!=="ack")result={sessionId:"session-a",messages:result,feedback:{after:0,nextCursor:0,latestCursor:0,hasMore:false,truncated:false,entries:[]}};
      const bytes = Buffer.from(JSON.stringify({result}));
      res.writeHead(200,{"content-type":"application/json","content-length":bytes.length}).end(bytes);
    });
  });
  const address = await listen(httpServer), input = new PassThrough(), output = new PassThrough(), next = outputReader(output);
  const stdio = new PenEchoStdioServer({input,output,record:{instanceId,secret,port:address.port,host:"127.0.0.1"}}).start();
  t.after(async () => {
    stdio.close();
    input.end();
    if (httpServer.listening) await close(httpServer);
  });
  const send = value => input.write(`${JSON.stringify(value)}\n`);
  send({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:PROTOCOL_VERSION,capabilities:{},clientInfo:{name:"test",version:"1"}}});
  await next();
  send({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"penecho_list_canvases",arguments:{}}});
  await next();
  send({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"penecho_start_session",arguments:{canvasId:"canvas-a",instanceId,title:"Compact update"}}});
  assert.equal((await next()).result.structuredContent.sessionId,"session-a");

  send({jsonrpc:"2.0",id:4,method:"tools/call",params:{name:"penecho_update_session",arguments:{sessionId:"session-a",status:"working",summary:"Queued"}}});
  const update = await next();
  assert.deepEqual(update.result.structuredContent,{accepted:true,applied:false,pixelVerified:false,queuedAt:123,sessionId:"session-a"});
  assert.equal(update.result.content.length,1);
  assert.equal(update.result.content[0].type,"text");
  assert.doesNotMatch(update.result.content[0].text,/instructions|history|image/i);
  assert.deepEqual(bodies.find(body => body.name === "penecho_update_session").arguments,{sessionId:"session-a",status:"working",summary:"Queued"});

  send({jsonrpc:"2.0",id:5,method:"tools/call",params:{name:"penecho_present_widget",arguments:{sessionId:"session-a",artifactId:"default-capture",requestId:"default-capture",title:"Preview",html:"<p>Preview</p>"}}});
  const presented = await next();
  assert.equal(presented.result.structuredContent.image,undefined);
  assert.equal(presented.result.content.length,1);
  assert.equal(bodies.find(body => body.name === "penecho_present_widget").arguments.capture,undefined);

  send({jsonrpc:"2.0",id:6,method:"tools/call",params:{name:"penecho_inbox",arguments:{sessionId:"session-a"}}});
  const doneMessage = await next();
  send({jsonrpc:"2.0",id:7,method:"tools/call",params:{name:"penecho_inbox",arguments:{sessionId:"session-a",mode:"ack",ids:[doneMessage.result.structuredContent.messages.messages[0].id],status:"done"}}});
  assert.deepEqual((await next()).result.structuredContent,{sessionId:"session-a",acknowledged:["request-done"],status:"done"});

  send({jsonrpc:"2.0",id:8,method:"tools/call",params:{name:"penecho_inbox",arguments:{sessionId:"session-a",messageAfter:1}}});
  const errorMessage = await next();
  send({jsonrpc:"2.0",id:9,method:"tools/call",params:{name:"penecho_inbox",arguments:{sessionId:"session-a",mode:"ack",ids:[errorMessage.result.structuredContent.messages.messages[0].id],status:"error",message:"Could not continue"}}});
  assert.deepEqual((await next()).result.structuredContent,{sessionId:"session-a",acknowledged:["request-error"],status:"error"});

  assert.equal(new Set(bodies.map(body => body.ownerId)).size,1);
  assert.deepEqual([...new Set(bodies.filter(body => body.arguments?.sessionId).map(body => body.arguments.sessionId))],["session-a"]);
});

test("stdio framing rejects malformed JSON without writing logs around protocol messages", async () => {
  const input = new PassThrough(), output = new PassThrough(), next = outputReader(output);
  const stdio = new PenEchoStdioServer({ input, output, record:{instanceId:crypto.randomUUID(),secret:crypto.randomBytes(32).toString("hex"),port:1,host:"127.0.0.1"} }).start();
  input.write("{broken}\n");
  const response = await next();
  assert.deepEqual(response, {jsonrpc:"2.0",id:null,error:{code:-32700,message:"Parse error"}});
  stdio.close();
});

test("stdio starts before PenEcho, discovers multiple live instances, and pins sessions to the selected instance", async () => {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-stdio-discovery-"));
  const input = new PassThrough(), output = new PassThrough(), next = outputReader(output);
  const stdio = new PenEchoStdioServer({ input, output, stateDirectory, registryStateDirectory:stateDirectory }).start();
  const send = value => input.write(`${JSON.stringify(value)}\n`);
  send({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:PROTOCOL_VERSION,capabilities:{},clientInfo:{name:"test",version:"1"}}});
  assert.equal((await next()).result.protocolVersion, PROTOCOL_VERSION);
  send({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"penecho_list_canvases",arguments:{}}});
  assert.deepEqual((await next()).result.structuredContent, {canvases:[],discovery:{status:"no-local-instance",instances:0,reachable:0}});

  const requests = [[], []], servers = [], records = [];
  for (let index = 0; index < 2; index++) {
    const instanceId = crypto.randomUUID(), secret = crypto.randomBytes(32).toString("hex");
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        requests[index].push(body);
        let result = {instanceId,canvases:[{canvasId:`canvas-${index}`,instanceId,title:`Board ${index}`}]};
        if (body.name === "penecho_start_session") result = {sessionId:`session-${index}`,boardObjectId:`object-${index}`,revision:1};
        if (body.name === "penecho_update_session") result = {accepted:true,applied:false,pixelVerified:false};
        if(body.name==="penecho_inbox"&&body.arguments.mode!=="ack")result={sessionId:"session-a",messages:result,feedback:{after:0,nextCursor:0,latestCursor:0,hasMore:false,truncated:false,entries:[]}};
      const bytes = Buffer.from(JSON.stringify({result}));
        res.writeHead(200,{"content-type":"application/json","content-length":bytes.length}).end(bytes);
      });
    });
    const address = await listen(server);
    servers.push(server);
    records.push({version:1,instanceId,pid:process.pid,host:"127.0.0.1",port:address.port,secret,rootDirectory:process.cwd(),startedAt:Date.now()+index});
    writeRecord(recordsDirectory(stateDirectory), records[index]);
  }
  send({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"penecho_list_canvases",arguments:{}}});
  const discovered = await next();
  assert.deepEqual(discovered.result.structuredContent.canvases.map(item => item.canvasId).sort(), ["canvas-0","canvas-1"]);
  send({jsonrpc:"2.0",id:4,method:"tools/call",params:{name:"penecho_start_session",arguments:{canvasId:"canvas-1",instanceId:records[1].instanceId,title:"Pinned"}}});
  assert.equal((await next()).result.structuredContent.sessionId, "session-1");
  send({jsonrpc:"2.0",id:5,method:"tools/call",params:{name:"penecho_update_session",arguments:{sessionId:"session-1",summary:"Exact instance"}}});
  assert.equal((await next()).result.structuredContent.applied, false);
  assert.equal(requests[0].some(item => item.name === "penecho_update_session"), false);
  assert.equal(requests[1].some(item => item.name === "penecho_update_session"), true);
  stdio.close();
  input.end();
  for (const server of servers) await close(server);
  fs.rmSync(stateDirectory, {recursive:true,force:true});
});

test("penecho mcp enters stdio directly without an app banner or model preflight", {timeout:5_000}, async () => {
  assert.match(require("../src/cli/main.js").helpText(), /penecho mcp connect --host-id ID/);
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cli-mcp-"));
  const child = spawn(process.execPath, [path.resolve(__dirname, "../cli.js"), "mcp", "--state-directory", stateDirectory], {
    cwd:path.resolve(__dirname, ".."),
    env:{...process.env, HOME:stateDirectory, USERPROFILE:stateDirectory},
    stdio:["pipe", "pipe", "pipe"],
  });
  const next = outputReader(child.stdout);
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({code,signal}));
  });
  try {
    child.stdin.write(`${JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:PROTOCOL_VERSION,capabilities:{},clientInfo:{name:"entry-test",version:"1"}}})}\n`);
    const initialized = await next();
    assert.equal(initialized.result.protocolVersion, PROTOCOL_VERSION);
    child.stdin.write(`${JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/list",params:{}})}\n`);
    const tools = await next();
    assert.equal(tools.result.tools.some(tool => tool.name === "penecho_list_canvases"), true);
    child.stdin.write(`${JSON.stringify({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"penecho_list_canvases",arguments:{}}})}\n`);
    assert.deepEqual((await next()).result.structuredContent, {canvases:[],discovery:{status:"no-local-instance",instances:0,reachable:0}});
    child.stdin.end();
    const result = await exit;
    assert.deepEqual(result, {code:0,signal:null});
    assert.equal(stderr, "");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    fs.rmSync(stateDirectory, {recursive:true,force:true});
  }
});

test("canvas discovery distinguishes empty, unavailable, partial and invalid instances without leaking diagnostics", async t => {
  const servers = [];
  t.after(async () => { for (const server of servers) await close(server); });
  const records = [];
  const replies = new Map();
  for (let index = 0; index < 10; index++) {
    const instanceId = `discovery-${index}`;
    const server = http.createServer((req, res) => {
      req.resume();
      const reply = replies.get(instanceId);
      if (reply === "disconnect") return req.socket.destroy();
      if (reply === "error") return res.writeHead(503).end(JSON.stringify({error:{message:"secret-token http://127.0.0.1/private /private/host-path"}}));
      res.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({result:reply}));
    });
    const address = await listen(server);
    servers.push(server);
    records.push({instanceId,port:address.port,secret:"secret-token",rootDirectory:"/private/host-path"});
  }
  const stdio = new PenEchoStdioServer();
  let selected = [];
  stdio.records = () => selected;
  const list = () => stdio.listCanvases();
  const first = records[0], second = records[1];
  const canvas = {instanceId:first.instanceId,canvasId:"canvas-a",title:"Board"};

  assert.deepEqual(await list(), {canvases:[],discovery:{status:"no-local-instance",instances:0,reachable:0}});
  selected = [first];
  replies.set(first.instanceId,{instanceId:first.instanceId,canvases:[canvas]});
  assert.deepEqual(await list(), {canvases:[canvas]});
  replies.set(first.instanceId,{instanceId:first.instanceId,canvases:[]});
  assert.deepEqual(await list(), {canvases:[],discovery:{status:"no-opted-in-canvas",instances:1,reachable:1}});

  selected = [first, second];
  replies.set(first.instanceId,{instanceId:first.instanceId,canvases:[canvas]});
  replies.set(second.instanceId,"disconnect");
  assert.deepEqual(await list(), {canvases:[canvas],discovery:{status:"partial",instances:2,reachable:1,issues:[{instanceId:second.instanceId,code:"connection-failed"}]}});
  replies.set(first.instanceId,{instanceId:first.instanceId,canvases:[]});
  assert.deepEqual(await list(), {canvases:[],discovery:{status:"partial",instances:2,reachable:1,issues:[{instanceId:second.instanceId,code:"connection-failed"}]}});
  replies.set(first.instanceId,"error");
  assert.deepEqual(await list(), {canvases:[],discovery:{status:"instance-unavailable",instances:2,reachable:0,issues:selected.map(record => ({instanceId:record.instanceId,code:"connection-failed"}))}});

  selected = [first];
  for (const reply of [{instanceId:"wrong-instance",canvases:[canvas]}, {instanceId:first.instanceId}, {instanceId:first.instanceId,canvases:{}}, null]) {
    replies.set(first.instanceId,reply);
    assert.deepEqual(await list(), {canvases:[],discovery:{status:"instance-unavailable",instances:1,reachable:0,issues:[{instanceId:first.instanceId,code:"invalid-response"}]}});
  }
  selected = records;
  records.forEach(record => replies.set(record.instanceId,"error"));
  const bounded = await list();
  assert.deepEqual(bounded, {canvases:[],discovery:{status:"instance-unavailable",instances:10,reachable:0,issues:records.slice(0,8).map(record => ({instanceId:record.instanceId,code:"connection-failed"}))}});
  assert.doesNotMatch(JSON.stringify(bounded), /secret-token|http:|127\.0\.0\.1|\/private/);
});

test('stdio rejects duplicate active IDs without losing the original request', async t => {
  const output = new PassThrough(), next = outputReader(output);
  const stdio = new PenEchoStdioServer({input:new PassThrough(),output});
  t.after(() => stdio.close()); stdio.initialized = true;
  let resolve, calls = 0;
  stdio.listCanvases = () => { calls++; return new Promise(done => { resolve = done; }); };
  const call = {jsonrpc:'2.0',id:91,method:'tools/call',params:{name:'penecho_list_canvases'}};
  const first = stdio.handle(call);
  await stdio.handle(call);
  assert.equal((await next()).error.code,-32600);
  assert.equal(calls,1);
  assert.equal(stdio.pending.size,1);
  resolve({canvases:[]}); await first;
  assert.deepEqual((await next()).result.structuredContent,{canvases:[]});
  assert.equal(stdio.pending.size,0);
});

test('late cancelled stdio completion cannot consume a reused request ID', async t => {
  const output = new PassThrough(), next = outputReader(output);
  const stdio = new PenEchoStdioServer({input:new PassThrough(),output});
  t.after(() => stdio.close()); stdio.initialized = true;
  const work = [];
  stdio.listCanvases = signal => new Promise((resolve,reject) => work.push({signal,resolve,reject}));
  const call = {jsonrpc:'2.0',id:92,method:'tools/call',params:{name:'penecho_list_canvases'}};
  const first = stdio.handle(call);
  await stdio.handle({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:92}});
  assert.equal((await next()).error.code,-32800); assert.equal(work[0].signal.aborted,true);
  const second = stdio.handle(call);
  work[0].reject(new Error('late cancellation')); await first;
  assert.equal(stdio.pending.size,1);
  assert.equal(stdio.pending.get('number:92').signal,work[1].signal);
  work[1].resolve({canvases:[{canvasId:'new'}]}); await second;
  assert.equal((await next()).result.structuredContent.canvases[0].canvasId,'new');
  assert.equal(stdio.pending.size,0);
});

test('stdio bridge deadline stops a peer that sends bytes but never finishes JSON', {timeout:2000}, async t => {
  const vm = require('node:vm'), {createRequire} = require('node:module');
  const filename = require.resolve('../src/server/mcp/stdio.js'), loaded = {exports:{}};
  let deadlineDelay;
  vm.runInNewContext(fs.readFileSync(filename,'utf8'), {
    require:createRequire(filename),module:loaded,Buffer,process,
    setTimeout:(callback,ms) => { deadlineDelay = ms; return setTimeout(callback,40); },clearTimeout,
  },{filename});
  const server = http.createServer((req,res) => {
    res.writeHead(200,{'content-type':'application/json'}); res.write('{');
    const heartbeat = setInterval(() => res.write(' '),5);
    res.once('close',() => clearInterval(heartbeat));
  });
  const address = await listen(server);
  t.after(() => { server.closeAllConnections(); return close(server); });
  await assert.rejects(loaded.exports.bridgeRequest({port:address.port,secret:'test',instanceId:'test'},{operation:'list_canvases'}),/timed out/);
  assert.equal(deadlineDelay,50000,'retain the existing request timeout budget');
});

test('stdio admission bounds cancelled unresolved work while preserving control and recovery',async t=>{
 const output=new PassThrough(),next=outputReader(output);
 const stdio=new PenEchoStdioServer({input:new PassThrough(),output,maxRequests:1});
 t.after(()=>stdio.close());stdio.initialized=true;
 let release,calls=0;
 stdio.listCanvases=()=>{calls++;return new Promise(resolve=>{release=resolve;});};
 const call=id=>({jsonrpc:'2.0',id,method:'tools/call',params:{name:'penecho_list_canvases'}});
 const first=stdio.handle(call(1));
 await stdio.handle({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:1}});
 assert.equal((await next()).error.code,-32800);
 assert.equal(stdio.pending.size,0);assert.equal(stdio.executing.size,1);
 for(let id=2;id<6;id++){
  await stdio.handle(call(id));assert.equal((await next()).error.code,-32000);
 }
 assert.equal(calls,1);
 for(const method of ['initialize','ping','tools/list']){
  await stdio.handle({jsonrpc:'2.0',id:10,method});assert.ok((await next()).result);
 }
 release({canvases:[]});await first;assert.equal(stdio.executing.size,0);
 const second=stdio.handle(call(20));assert.equal(calls,2);
 release({canvases:[]});await second;
 assert.deepEqual((await next()).result.structuredContent,{canvases:[]});
});
