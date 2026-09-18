"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { WebSocket } = require("ws");
const { createMcpRequestTracer, safeTraceValue } = require("../src/server/mcp/request-trace.js");
const { createMcpService } = require("../src/server/mcp/service.js");

const temporaryDirectories = [];
after(() => { for (const directory of temporaryDirectories) fs.rmSync(directory, { recursive:true, force:true }); });

function tempDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-mcp-trace-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(server.address()); });
  });
}

function closeServer(server) {
  return new Promise(resolve => server.close(resolve));
}

function openCanvas(port, respond) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/mcp/canvas`, { headers:{ "x-test-browser":"allowed" } });
    ws.once("error", reject);
    ws.once("open", () => ws.send(JSON.stringify({ type:"hello", canvasId:"canvas-a", title:"Trace canvas" })));
    ws.on("message", raw => {
      const message = JSON.parse(raw.toString("utf8"));
      if (message.type === "ready") { ws.off("error", reject); resolve(ws); return; }
      if (message.type !== "call") return;
      const reply = respond(message);
      ws.send(JSON.stringify({ type:"result", requestId:message.requestId, ...reply }));
    });
  });
}

function traces(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes:true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => fs.readdirSync(path.join(directory, entry.name), {withFileTypes:true}).filter(child => child.isDirectory()).map(child => JSON.parse(fs.readFileSync(path.join(directory, entry.name, child.name, "trace.json"), "utf8"))));
}

async function waitFor(check, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for MCP request trace.");
}

test("disabled MCP request tracing creates no directory or serialized payload", async () => {
  const directory = tempDirectory(), traceDirectory = path.join(directory, "logs", "mcp-requests"), server = http.createServer();
  const options = {
    server,
    authorizeBrowser:() => null,
    requestTraceEnabled:false,
  };
  Object.defineProperty(options, "requestTraceDirectory", { get:() => { throw new Error("disabled tracing inspected its directory"); } });
  Object.defineProperty(options, "requestTraceLimit", { get:() => { throw new Error("disabled tracing inspected its limit"); } });
  const service = createMcpService(options);
  let payloadReads = 0;
  const untouchedInput = {};
  Object.defineProperty(untouchedInput, "secret", { enumerable:true, get:() => { payloadReads += 1; return "must-not-be-read"; } });
  await assert.rejects(service.callTool("invalid-owner", "penecho_list_canvases", untouchedInput), error => error.code === "invalid_owner");
  assert.equal(payloadReads, 0);
  const input = {};
  Object.defineProperty(input, "toJSON", { enumerable:false, value:() => { throw new Error("disabled tracing serialized the payload"); } });
  await service.callTool(crypto.randomUUID(), "penecho_list_canvases", input);
  assert.equal(fs.existsSync(traceDirectory), false);
  await service.close();
});

test("MCP trace sanitization bounds malformed nested input", () => {
  const input = { password:"nested-secret-value", image:{ mimeType:"image/png", data:"A".repeat(2_000) }, items:[] };
  let cursor = input;
  for (let index = 0; index < 1_000; index++) {
    cursor.next = { [`field-${index}-${"x".repeat(200)}`]:"value" };
    cursor = cursor.next;
    input.items.push({ index, text:"y".repeat(1_000) });
  }
  cursor.loop = input;
  const safe = safeTraceValue(input), serialized = JSON.stringify(safe);
  assert.equal(serialized.includes("nested-secret-value"), false);
  assert.equal(serialized.includes("A".repeat(100)), false);
  assert.equal(serialized.length < 100_000, true);
  assert.equal(safe.items.length, 33);
  assert.match(serialized, /truncated|omitted|limit reached|maximum depth/);
});

test("MCP trace filesystem and logger failures never change tool behavior", async () => {
  const directory = tempDirectory(), traceDirectory = path.join(directory, "trace-path"), server = http.createServer();
  fs.writeFileSync(traceDirectory, "blocks trace directory creation");
  const service = createMcpService({
    server,
    authorizeBrowser:() => null,
    requestTraceEnabled:true,
    requestTraceDirectory:traceDirectory,
    requestTraceLimit:1,
    logger:() => { throw new Error("logger unavailable"); },
  });
  const result = await service.callTool(crypto.randomUUID(), "penecho_list_canvases", {});
  assert.deepEqual(result.canvases, []);
  assert.equal(fs.readFileSync(traceDirectory, "utf8"), "blocks trace directory creation");
  await service.close();
});

test("enabled MCP request tracing records browser RPC timing, queued application, and redacts image and secret bodies", async () => {
  const directory = tempDirectory(), traceDirectory = path.join(directory, "logs", "mcp-requests"), legacyDirectory = path.join(directory, "logs", "requests");
  fs.mkdirSync(legacyDirectory, { recursive:true });
  fs.writeFileSync(path.join(legacyDirectory, "keep.txt"), "canvas agent trace area");
  const server = http.createServer(), service = createMcpService({
    server,
    authorizeBrowser:req => req.headers["x-test-browser"] === "allowed" ? null : "Forbidden",
    requestTraceEnabled:true,
    requestTraceDirectory:traceDirectory,
    requestTraceLimit:20,
  });
  const address = await listen(server), ws = await openCanvas(address.port, message => {
    if (message.name === "mcp_start_session") return { ok:true, result:{ sessionId:message.arguments.sessionId, boardObjectId:"board-object", revision:1 } };
    if (message.name === "mcp_update_session") return { ok:true, result:{ applied:true, visible:false, revision:2 } };
    if (message.name === "mcp_capture_canvas") return { ok:true, result:{ dataUrl:"data:image/png;base64,AQID", mediaType:"image/png", width:1, height:1, revision:3, runtimeDiagnostics:{ authorization:"Bearer browser-secret-token" } } };
    return { ok:false, error:"unexpected browser call" };
  });
  const ownerId = crypto.randomUUID();
  const started = await service.callTool(ownerId, "penecho_start_session", { canvasId:"canvas-a", instanceId:service.instanceId, title:"authorization=client-secret-value" });
  const queued = await service.callTool(ownerId, "penecho_update_session", { sessionId:started.sessionId, summary:"Bearer update-secret-token" });
  assert.equal(queued.applied, false);
  assert.equal(queued.accepted, true);
  const updateTrace = await waitFor(() => traces(traceDirectory).find(trace => trace.request.tool === "penecho_update_session" && trace.queuedUpdate?.state === "applied"));
  assert.equal(updateTrace.outcome.applied, false);
  assert.equal(updateTrace.queuedUpdate.applied, true);
  assert.equal(updateTrace.queuedUpdate.visible, false);
  assert.equal(updateTrace.browserInteractions[0].name, "mcp_update_session");
  assert.equal(updateTrace.browserInteractions[0].status, "completed");
  assert.equal(typeof updateTrace.browserInteractions[0].durationMs, "number");
  assert.equal(typeof updateTrace.durationMs, "number");

  await service.callTool(ownerId, "penecho_capture_canvas", { sessionId:started.sessionId,target:"artifact", artifactId:"artifact-a" });
  const captureTrace = traces(traceDirectory).find(trace => trace.request.tool === "penecho_capture_canvas");
  assert.equal(captureTrace.status, "completed");
  assert.equal(captureTrace.browserInteractions[0].result.dataUrl, "<encoded image omitted>");
  assert.equal(captureTrace.outcome.image.data, "<encoded image omitted>");
  const serialized = JSON.stringify(traces(traceDirectory));
  assert.equal(serialized.includes("client-secret-value"), false);
  assert.equal(serialized.includes("update-secret-token"), false);
  assert.equal(serialized.includes("browser-secret-token"), false);
  assert.equal(serialized.includes("data:image/png;base64,AQID"), false);
  assert.equal(fs.readFileSync(path.join(legacyDirectory, "keep.txt"), "utf8"), "canvas agent trace area");
  assert.deepEqual(fs.readdirSync(legacyDirectory), ["keep.txt"]);

  ws.close();
  await service.close();
  await closeServer(server);
});

test("closing the MCP service finalizes a still-queued update trace as failed", async () => {
  const directory = tempDirectory(), traceDirectory = path.join(directory, "logs", "mcp-requests"), server = http.createServer();
  const service = createMcpService({
    server,
    authorizeBrowser:req => req.headers["x-test-browser"] === "allowed" ? null : "Forbidden",
    requestTraceEnabled:true,
    requestTraceDirectory:traceDirectory,
    requestTraceLimit:10,
  });
  const address = await listen(server);
  await openCanvas(address.port, message => {
    if (message.name === "mcp_start_session") return { ok:true, result:{ sessionId:message.arguments.sessionId, boardObjectId:"board-object", revision:1 } };
    return { ok:true, result:{ applied:true, visible:true, revision:2 } };
  });
  const ownerId = crypto.randomUUID(), started = await service.callTool(ownerId, "penecho_start_session", { canvasId:"canvas-a", instanceId:service.instanceId, title:"Closing trace" });
  await service.callTool(ownerId, "penecho_update_session", { sessionId:started.sessionId, summary:"Still queued" });
  await service.close();
  const updateTrace = traces(traceDirectory).find(trace => trace.request.tool === "penecho_update_session");
  assert.equal(updateTrace.status, "completed");
  assert.equal(updateTrace.outcome.applied, false);
  assert.equal(updateTrace.queuedUpdate.state, "failed");
  assert.match(updateTrace.queuedUpdate.error, /service closed/i);
  await closeServer(server);
});

test("MCP request tracing records failures without changing errors and prunes only its own bounded directory", async () => {
  const directory = tempDirectory(), traceDirectory = path.join(directory, "logs", "mcp-requests"), server = http.createServer();
  const service = createMcpService({
    server,
    authorizeBrowser:req => req.headers["x-test-browser"] === "allowed" ? null : "Forbidden",
    requestTraceEnabled:true,
    requestTraceDirectory:traceDirectory,
    requestTraceLimit:2,
    logger:() => { throw new Error("logger unavailable"); },
  });
  const address = await listen(server), ws = await openCanvas(address.port, message => {
    if (message.name === "mcp_start_session") return { ok:true, result:{ sessionId:message.arguments.sessionId, boardObjectId:"board-object", revision:1 } };
    if (message.name === "mcp_update_session") return { ok:false, error:"apiKey=queued-update-secret" };
    if (message.name === "mcp_present_widget") return { ok:false, error:"apiKey=browser-failure-secret" };
    return { ok:true, result:{ applied:true, visible:true, revision:2 } };
  });
  const ownerId = crypto.randomUUID(), started = await service.callTool(ownerId, "penecho_start_session", { canvasId:"canvas-a", instanceId:service.instanceId, title:"Failure trace" });
  await service.callTool(ownerId, "penecho_update_session", { sessionId:started.sessionId, summary:"Queued failure" });
  const queuedFailure = await waitFor(() => traces(traceDirectory).find(trace => trace.request.tool === "penecho_update_session" && trace.queuedUpdate?.state === "failed"));
  assert.equal(queuedFailure.outcome.applied, false);
  assert.equal(queuedFailure.queuedUpdate.applied, false);
  assert.equal(JSON.stringify(queuedFailure).includes("queued-update-secret"), false);
  await assert.rejects(
    service.callTool(ownerId, "penecho_present_widget", { sessionId:started.sessionId,requestId:"failure-1", artifactId:"artifact-a", title:"Failure", html:`<img src="data:image/png;base64,${"A".repeat(600)}">` }),
    error => error.code === "canvas_call_failed" && error.message.includes("browser-failure-secret"),
  );
  const failedTrace = traces(traceDirectory).find(trace => trace.request.tool === "penecho_present_widget");
  assert.equal(failedTrace.status, "failed");
  assert.equal(failedTrace.browserInteractions[0].status, "failed");
  assert.equal(JSON.stringify(failedTrace).includes("browser-failure-secret"), false);
  assert.equal(JSON.stringify(failedTrace).includes("A".repeat(100)), false);

  await new Promise(resolve => setTimeout(resolve, 2));
  await service.callTool(ownerId, "penecho_list_canvases", {});
  await new Promise(resolve => setTimeout(resolve, 2));
  await service.callTool(ownerId, "penecho_list_canvases", {});
  const retained = traces(traceDirectory);
  assert.equal(fs.readdirSync(traceDirectory).length, 1);
  assert.equal(retained.length, 5);
  assert.equal(retained.every(trace => trace.kind === "mcp-tool-call"), true);

  ws.close();
  await service.close();
  await closeServer(server);
});


test("full session payloads preserve large text, source, images and owner isolation", () => {
  const directory = tempDirectory(), tracer = createMcpRequestTracer({requestTraceDirectory:directory});
  const html = `<p>${"full content ".repeat(3000)}</p><img src="data:image/png;base64,AQID">`;
  const first = tracer.begin({ownerId:"owner-a", name:"penecho_start_session", arguments:{sessionKey:"../../unsafe", html, password:"hidden"}});
  tracer.complete(first, {sessionId:"session-a", text:html});
  const second = tracer.begin({ownerId:"owner-a", name:"read", arguments:{sessionId:"session-a"}});
  tracer.complete(second, {image:{mimeType:"image/png", data:"AQID"}, text:"x".repeat(20000)});
  const reconnect = tracer.begin({ownerId:"owner-a", name:"penecho_start_session", arguments:{sessionKey:"../../unsafe"}});
  tracer.complete(reconnect, {sessionId:"session-b"});
  const other = tracer.begin({ownerId:"owner-b", name:"read", arguments:{sessionId:"session-a"}});
  tracer.complete(other, {});
  assert.equal(first.group.directory, second.group.directory);
  assert.equal(first.group.directory, reconnect.group.directory);
  assert.notEqual(other.group.directory, first.group.directory);
  const request = JSON.parse(fs.readFileSync(path.join(first.directory,"request.json")));
  assert.equal(request.arguments.html, html);
  assert.equal(request.arguments.password,"<redacted>");
  assert.equal(JSON.parse(fs.readFileSync(path.join(second.directory,"response.json"))).text.length,20000);
  assert.ok(fs.readFileSync(path.join(second.directory,"response.txt"),"utf8").includes("x".repeat(20000)));
  const imageFile = fs.readdirSync(second.directory).find(name => name.endsWith(".png"));
  assert.deepEqual(fs.readFileSync(path.join(second.directory,imageFile)),Buffer.from([1,2,3]));
  const source = fs.readdirSync(first.directory).find(name => name.endsWith(".html"));
  assert.equal(fs.readFileSync(path.join(first.directory,source),"utf8"),html);

});

test("POSIX request traces have owner-only directory and file permissions",{skip:process.platform==="win32"?"Windows uses inherited DACLs rather than POSIX permission bits":false},()=>{
  const tracer=createMcpRequestTracer({requestTraceDirectory:tempDirectory()});
  const request=tracer.begin({ownerId:"permissions",name:"read",arguments:{sessionId:"permissions"}});
  tracer.complete(request,{});
  assert.equal(fs.statSync(request.directory).mode & 0o777,0o700);
  assert.equal(fs.statSync(path.join(request.directory,"request.json")).mode & 0o777,0o600);
});

test("retention pins running and queued sessions, then prunes completed session groups", () => {
  const directory=tempDirectory(), tracer=createMcpRequestTracer({requestTraceDirectory:directory,requestTraceLimit:1});
  fs.mkdirSync(path.join(directory,"keep-me"));
  const first=tracer.begin({ownerId:"one",name:"update",arguments:{sessionId:"one"}});
  tracer.complete(first,{accepted:true,applied:false});
  const second=tracer.begin({ownerId:"two",name:"read",arguments:{sessionId:"two"}});
  assert.ok(fs.existsSync(first.directory));
  assert.ok(fs.existsSync(second.directory));
  tracer.queuedUpdateOutcome(first,"applied",{applied:true});
  assert.equal(fs.existsSync(first.directory),false);
  tracer.complete(second,{});
  assert.ok(fs.existsSync(second.directory));
  assert.ok(fs.existsSync(path.join(directory,"keep-me")));
});


test("symlinked trace roots cannot write or create outside the root", () => {
  const directory = tempDirectory(), outside = tempDirectory();
  fs.mkdirSync(path.join(outside, "session-" + "a".repeat(64)));
  fs.mkdirSync(path.join(outside, "session-" + "b".repeat(64)));
  fs.symlinkSync(outside, path.join(directory, "linked"));
  const tracer = createMcpRequestTracer({requestTraceDirectory:path.join(directory,"linked"),requestTraceLimit:1});
  const trace = tracer.begin({ownerId:"owner",name:"read",arguments:{}});
  tracer.complete(trace,{text:"must not escape"});
  assert.equal(fs.readdirSync(outside).length,2);
});

test("extracts an actual PNG byte-for-byte and records its manifest", () => {
  const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
  const tracer=createMcpRequestTracer({requestTraceDirectory:tempDirectory()});
  const trace=tracer.begin({ownerId:"owner",name:"capture",arguments:{}});
  tracer.complete(trace,{image:{mimeType:"image/png",data:png}});
  const manifest=JSON.parse(fs.readFileSync(path.join(trace.directory,"response-images.json")));
  assert.deepEqual(fs.readFileSync(path.join(trace.directory,manifest[0].filename)),Buffer.from(png,"base64"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(trace.directory,"response.json"))).image.data,png);
});

test("one logical request contains guidance, failed validation, repair and capture; next completion boundary splits it",()=>{
  const directory=tempDirectory(),tracer=createMcpRequestTracer({requestTraceDirectory:directory});
  const call=(name,args,result={})=>{const trace=tracer.begin({ownerId:"owner",name,arguments:args});tracer.complete(trace,result);return trace;};
  const start=call("penecho_start_session",{sessionKey:"conversation"},{sessionId:"session"});
  const guidance=call("penecho_get_guidance",{id:"visual-explorer"});
  const failed=tracer.begin({ownerId:"owner",name:"penecho_present_widget",arguments:{sessionId:"session",completion:{status:"done"}}});
  tracer.fail(failed,new Error('html: missing required content'));
  const fixed=call("penecho_present_widget",{sessionId:"session",completion:{status:"done"}},{applied:true});
  const capture=call("penecho_capture_canvas",{sessionId:"session"});
  for(const trace of [guidance,failed,fixed,capture])assert.equal(trace.group.directory,start.group.directory);
  const index=JSON.parse(fs.readFileSync(path.join(start.group.directory,"trace.json")));
  assert.equal(index.kind,"mcp-request");assert.equal(index.status,"done");assert.equal(index.tools.length,5);
  assert.equal(index.pendingToolCalls,0);assert.equal(index.tools[2].status,"failed");
  for(const tool of index.tools)assert.ok(fs.existsSync(path.join(start.group.directory,tool.path)));
  const nextGuide=call("penecho_get_guidance",{id:"general-html"});
  const next=call("penecho_present_widget",{sessionId:"session",completion:{status:"done"}},{applied:true});
  assert.notEqual(next.group.directory,start.group.directory);assert.equal(nextGuide.group.directory,next.group.directory);
  assert.equal(fs.readdirSync(directory).length,2);
});

test("incomplete requests split after inactivity; queued final completion waits for actual application",()=>{
  let time=1000;const directory=tempDirectory(),tracer=createMcpRequestTracer({requestTraceDirectory:directory,now:()=>time});
  const first=tracer.begin({ownerId:"owner",name:"penecho_update_session",arguments:{sessionId:"session",status:"done"}});
  tracer.complete(first,{accepted:true,applied:false});assert.equal(first.group.closed,undefined);
  tracer.queuedUpdateOutcome(first,"failed",{error:"disconnected"});assert.equal(first.group.closed,undefined);
  time+=31*60*1000;
  const retry=tracer.begin({ownerId:"owner",name:"penecho_update_session",arguments:{sessionId:"session",status:"done"}});
  assert.notEqual(retry.group.directory,first.group.directory);
  tracer.complete(retry,{accepted:true,applied:false});tracer.queuedUpdateOutcome(retry,"applied",{applied:true});
  assert.equal(retry.group.closed,true);
});

test("widget contract failures are logged before any Canvas dispatch with full repairable input",async()=>{
  const directory=tempDirectory(),server=http.createServer();
  const service=createMcpService({server,authorizeBrowser:()=>null,requestTraceEnabled:true,requestTraceDirectory:directory});
  try {
    const input={sessionId:"session",artifactId:"explainer",title:"Explainer",html:""};
    await assert.rejects(service.callTool(crypto.randomUUID(),"penecho_present_widget",input),/html is invalid/);
    const [trace]=traces(directory);assert.equal(trace.status,"failed");assert.equal(trace.browserInteractions.length,0);
    assert.match(trace.error.message,/html is invalid/);
    const folder=path.join(directory,fs.readdirSync(directory)[0]);const index=JSON.parse(fs.readFileSync(path.join(folder,"trace.json")));
    const request=JSON.parse(fs.readFileSync(path.join(folder,path.dirname(index.tools[0].path),"request.json")));
    assert.deepEqual(request.arguments,input);
  }finally{await service.close();}
});
