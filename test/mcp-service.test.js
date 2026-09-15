"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { after, test } = require("node:test");
const { WebSocket } = require("ws");
const { Command } = require("commander");
const { configurationArguments, configureClient, inspectConfiguredClients } = require("../src/server/mcp/configure.js");
const { SESSION_INSTRUCTIONS } = require("../src/server/mcp/guidance.js");
const { readRecords, recordsDirectory } = require("../src/server/mcp/records.js");
const { createMcpService: createService } = require("../src/server/mcp/service.js");
const createMcpService = options => createService({ autoStartHttp:false, ...options, registryStateDirectory:options.registryStateDirectory || options.stateDirectory || tempDirectory() });

const temporaryDirectories = [];
after(() => { for (const directory of temporaryDirectories) fs.rmSync(directory, { recursive:true, force:true }); });

function tempDirectory() {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "penecho-mcp-test-"));
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function reportCanvasCatalog(ws, documents) {
  ws.send(JSON.stringify({ type:"catalog", documents }));
  // Let the server-side ws message handler consume the frame before callers
  // inspect the in-memory catalog directly.
  await delay(5);
}

function waitForSocketEvent(socket, event, timeoutMs = 500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for WebSocket ${event}.`)), timeoutMs);
    socket.once(event, (...args) => {
      clearTimeout(timer);
      resolve(args);
    });
  });
}

function requestJson(port, target, { method = "POST", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = http.request({ host:"127.0.0.1", port, path:target, method, headers:{ ...(bytes ? {"content-type":"application/json","content-length":bytes.length} : {}), ...headers } }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        let value = null;
        try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
        resolve({ status:response.statusCode, value });
      });
    });
    request.on("error", reject);
    request.end(bytes);
  });
}

async function invokeServiceHttp(service, remoteAddress, target, { method = "POST", headers = {} } = {}) {
  const req = Object.assign(new EventEmitter(), {
    complete:true,
    headers,
    method,
    socket:{ remoteAddress },
    url:target,
  });
  const chunks = [];
  const res = Object.assign(new EventEmitter(), {
    destroyed:false,
    headers:null,
    headersSent:false,
    statusCode:null,
    writableEnded:false,
    destroy() { this.destroyed = true; },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
      this.writableEnded = true;
    },
    writeHead(status, responseHeaders) {
      this.statusCode = status;
      this.headers = responseHeaders;
      this.headersSent = true;
      return this;
    },
  });
  const handled = await service.handleHttp(req, res, new URL(target, "http://localhost"));
  const text = Buffer.concat(chunks).toString("utf8");
  return { handled, status:res.statusCode, value:text ? JSON.parse(text) : null };
}

function openCanvas(port, calls, progress, documents) {
  return new Promise((resolve, reject) => {
    const sessionDocuments = new Map();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/mcp/canvas`, { headers:{ "x-test-browser":"allowed" } });
    ws.once("error", reject);
    ws.once("open", () => ws.send(JSON.stringify({ type:"hello", canvasId:"canvas-a", title:"Research board", ...(documents === undefined ? {} : {documents}) })));
    ws.on("message", raw => {
      const message = JSON.parse(raw.toString("utf8"));
      if (message.type === "ready") { ws.off("error", reject); resolve({ ws, ready:message }); return; }
      if (message.type !== "call") return;
      calls.push(message);
      if (message.name === "mcp_patch_file" && message.arguments.requestId === "unknown-outcome" && calls.filter(call => call.name === "mcp_patch_file" && call.arguments.requestId === "unknown-outcome").length === 1) return;
      let result = { applied:true, visible:true, revision:calls.length };
      if (message.name === "mcp_start_session") {
        const documentId = message.arguments.documentId || "document-active";
        // A current-document attachment can reuse an existing session without
        // carrying documentId. Keep that session's stable catalog identity.
        if (message.arguments.documentId || !sessionDocuments.has(message.arguments.sessionId)) sessionDocuments.set(message.arguments.sessionId, documentId);
        result = { sessionId:message.arguments.sessionId, documentId, boardObjectId:null, revision:1, feedbackCursor:0 };
      }
      if (message.name === "mcp_open_canvas") result = {documentId:"document-new",title:"Persistent document",active:message.arguments.show,locator:{location:"device",id:"device-1"}};
      if (message.name === "mcp_find_canvases") result = {candidates:[{documentId:message.arguments.documentId || "document-new",title:message.arguments.documentId === "document-background" ? "Background document" : "Persistent document"}],providers:{device:{status:"available"},cloud:{status:"signed_out"}}};
      if (message.name === "mcp_list_files") result = {sessionId:message.arguments.sessionId,path:message.arguments.path,files:[{path:"/notes.md",kind:"text"}],offset:0,nextOffset:null};
      if (message.name === "mcp_read_file") result = {sessionId:message.arguments.sessionId,path:message.arguments.path,content:"hello\n",contentHash:"hash-1"};
      if (message.name === "mcp_patch_file") result = {sessionId:message.arguments.sessionId,path:message.arguments.path,contentHash:"hash-2",applied:true};
      if (message.name === "mcp_patch_file" && message.arguments.requestId === "receipt-recovery") result = {sessionId:message.arguments.sessionId,path:message.arguments.path,contentHash:"hash-recovered",applied:true,reused:true};
      if (message.name === "mcp_edit_canvas") result = {sessionId:message.arguments.sessionId,requestId:message.arguments.requestId,applied:true};
      if (message.name === "mcp_capture_canvas") result = {dataUrl:"data:image/webp;base64,AQIDBA==",mediaType:"image/webp",width:24,height:12,encodedBytes:4,revision:7,viewport:{width:1200,height:800}};
      if (message.name === "mcp_capture_canvas" && message.arguments.objectId === "bad-bytes") result.encodedBytes = 5;
      if (message.name === "mcp_read_messages") result = {sessionId:message.arguments.sessionId,after:message.arguments.feedbackAfter,nextCursor:1,messages:[{id:"request-1",cursor:1,text:"Please continue"}]};
      if (message.name === "mcp_ack_messages") result = {sessionId:message.arguments.sessionId,acknowledged:message.arguments.ids};
      if (message.name === "mcp_present_widget") result = message.arguments.presentation?.intent === "inspect"
        ? {artifactId:message.arguments.artifactId,dataUrl:"data:image/webp;base64,AQIDBA==",mediaType:"image/webp",width:message.arguments.width,height:message.arguments.height,encodedBytes:4,revision:8,ephemeral:true,viewport:{width:message.arguments.width,height:message.arguments.height}}
        : { objectId:"widget-object", artifactId:message.arguments.artifactId, revision:3, feedbackCursor:1, browserElapsedMs:4, viewport:{width:800,height:600} };
      if (message.name === "mcp_present_widget" && message.arguments.artifactId === "inspection-too-large") result.width = 1025;
      if (message.name === "mcp_present_widget" && message.arguments.artifactId === "inspection-viewport-mismatch") result.viewport.width += 1;
      if (message.name === "mcp_present_widget" && message.arguments.artifactId === "inspection-object") result.objectId = "must-not-persist";
      if (message.name === "mcp_present_widget" && message.arguments.artifactId === "inspection-bad-bytes") result.encodedBytes = 5;
      if (message.name === "mcp_present_widget" && message.arguments.artifactId === "inspection-persistent") result.ephemeral = false;
      if (message.name === "mcp_capture_widget") result = { dataUrl:"data:image/png;base64,AQID", mediaType:"image/png", width:10, height:20, revision:4, browserElapsedMs:12, viewport:{width:900,height:700}, mapping:{scale:2}, runtimeDiagnostics:{renderer:"canvas"} };
      if (message.name === "mcp_draw") result = { artifactId:message.arguments.artifactId, objectId:"draw-object-1", objectIds:["draw-object-1","draw-object-2"], kind:"drawing", revision:4, feedbackCursor:2 };
      if (message.name === "mcp_plot") result = { artifactId:message.arguments.artifactId, objectId:"plot-object", objectIds:["plot-object"], kind:"plot", revision:5, feedbackCursor:3 };
      if (message.name === "mcp_draw" && message.arguments.artifactId === "mismatched") result.artifactId = "another-artifact";
      if (message.name === "mcp_draw" && message.arguments.artifactId === "too-many") result.objectIds = Array.from({length:25}, (_, index) => `object-${index}`);
      if (message.name === "mcp_plot" && message.arguments.artifactId === "duplicate") result.objectIds = ["plot-object","plot-object"];
      if (message.name === "mcp_capture_primitives") result = { artifactId:message.arguments.artifactId, dataUrl:"data:image/webp;base64,BwgJ", mediaType:"image/webp", width:12, height:8, encodedBytes:3, revision:6 };
      if (message.name === "mcp_inbox" && message.arguments.mode === "read") {
        const after = message.arguments.feedbackAfter === undefined ? 0 : message.arguments.feedbackAfter;
        const hasEntry = after < 2 || [60, 80, 90, 91, 92].includes(after);
        const nextCursor = hasEntry ? (after < 2 ? 2 : after + 1) : after;
        const imageBytes = after === 90 ? Buffer.alloc(700 * 1024 + 1, 1) : Buffer.from([1, 2, 3, 4]);
        result = {
          sessionId:message.arguments.sessionId,
          after,
          nextCursor,
          latestCursor:after === 60 ? 65 : nextCursor,
          hasMore:after === 60,
          truncated:false,
          entries:hasEntry ? [{cursor:nextCursor,kind:"text",objectId:"note-1",text:"Move this closer",textTruncated:false,bounds:{x:10,y:20,w:140,h:60},createdAt:1_788_000_000_000}] : [],
          ...(message.arguments.capture && hasEntry && after !== 80 ? {
            visualContext:"current-canvas-with-nearby-design",
            dataUrl:`data:image/webp;base64,${imageBytes.toString("base64")}`,
            mediaType:"image/webp",
            width:after === 91 ? 1025 : after === 92 ? 800 : 24,
            height:after === 92 ? 700 : 12,
            encodedBytes:imageBytes.length,
            logicalRegion:{x:20,y:10,width:240,height:120},
            compression:{policy:"mcp-feedback-v1",format:"image/webp",quality:0.72,maxBytes:700 * 1024,automatic:true},
          } : {}),
        };
        if (message.arguments.feedbackAfter === 77) result = { ...result, nextCursor:78, latestCursor:78, entries:[{cursor:"bad",kind:"stroke",bounds:{x:-1,y:-2,w:3,h:4},createdAt:1_788_000_000_000}] };
      }
      if(message.name==="mcp_inbox")result=message.arguments.mode==="ack"?{sessionId:message.arguments.sessionId,acknowledged:message.arguments.ids}:{sessionId:message.arguments.sessionId,messages:{after:message.arguments.messageAfter,nextCursor:Math.max(1,message.arguments.messageAfter),latestCursor:Math.max(1,message.arguments.messageAfter),hasMore:false,messages:[{id:"request-1",cursor:1,text:"Please continue"}]},feedback:result};
      if(message.name==="mcp_present_widget" && message.arguments.capture && message.arguments.presentation?.intent!=="inspect")Object.assign(result,{dataUrl:"data:image/png;base64,AQID",mediaType:"image/png",width:10,height:20,encodedBytes:3,mapping:{scale:2},runtimeDiagnostics:{renderer:"canvas"}});
      if(["mcp_draw","mcp_plot"].includes(message.name)&&message.arguments.capture)Object.assign(result,{dataUrl:"data:image/webp;base64,BwgJ",width:12,height:8,encodedBytes:3});
      if (message.name === "mcp_inspect_session") result = { visible:true, revision:5, group:{objectIds:["draw-object-1","draw-object-2"]}, artifacts:[{artifactId:"diagram",requestId:"diagram",kind:"drawing",objectIds:["draw-object-1","draw-object-2"]}] };
      if (progress !== undefined && message.name === "mcp_start_session") result.progress = progress;
      if (progress !== undefined && message.name === "mcp_inspect_session") Object.assign(result, progress);
      if (message.name === "mcp_patch_file" && message.arguments.expectedHash === "stale") {
        ws.send(JSON.stringify({type:"result",requestId:message.requestId,ok:false,error:{code:"SOURCE_CONFLICT",message:"Source changed",details:{currentContentHash:"hash-1",retry:"read-before-patch"}}}));
      } else if (message.name === "mcp_capture_canvas" && message.arguments.target === "selection") {
        ws.send(JSON.stringify({type:"result",requestId:message.requestId,ok:false,error:{code:"CANVAS_NOT_VISIBLE",message:"Show this Canvas before capture.",details:{documentId:sessionDocuments.get(message.arguments.sessionId)||"document-new",retryable:true,retry:"show-then-capture"}}}));
      } else if (message.name === "mcp_patch_file" && message.arguments.requestId === "browser-conflict") {
        ws.send(JSON.stringify({type:"result",requestId:message.requestId,ok:false,error:{code:"SOURCE_CONFLICT",message:"Source changed during apply.",details:{currentContentHash:"hash-3",retry:"read-before-patch"}}}));
      } else ws.send(JSON.stringify({ type:"result", requestId:message.requestId, ok:true, result }));
    });
  });
}

test("MCP open request receipts are isolated by client owner", async t => {
  const stateDirectory = tempDirectory(), calls = [];
  let service;
  const server = http.createServer(async (req, res) => {
    if (!await service.handleHttp(req, res, new URL(req.url, "http://localhost"))) res.writeHead(404).end();
  });
  service = createMcpService({server,authorizeBrowser:() => null,rootDirectory:process.cwd(),stateDirectory});
  t.after(async () => { service.close(); await closeServer(server); });
  const address = await listen(server), status = service.register(address);
  const record = readRecords(recordsDirectory(stateDirectory))[0];
  await openCanvas(address.port, calls);
  const headers = {authorization:`Bearer ${record.secret}`,"x-penecho-mcp-instance":status.instanceId};
  const firstOwner = crypto.randomUUID(), secondOwner = crypto.randomUUID();
  const open = (ownerId, title = "Document") => requestJson(address.port, "/api/mcp/rpc", {headers,body:{operation:"call",ownerId,name:"penecho_open_canvas",arguments:{canvasId:"canvas-a",instanceId:status.instanceId,create:true,title,requestId:"shared-request"}}});
  assert.equal((await open(firstOwner)).status, 200);
  const second = await open(secondOwner);
  assert.equal(second.status, 200);
  assert.equal(second.value.result.reused, undefined);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].arguments.requestId, calls[1].arguments.requestId);
  assert.equal((await open(firstOwner)).value.result.reused, true);
  assert.equal((await open(secondOwner)).value.result.reused, true);
  assert.equal(calls.length, 2);
  const conflict = await open(firstOwner, "Changed document");
  assert.equal(conflict.value.error.code, "REQUEST_ID_CONFLICT");
  await openCanvas(address.port, calls);
  assert.equal((await open(firstOwner)).status, 200);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].arguments.requestId, calls[0].arguments.requestId);
});

test("MCP restored progress agrees in start and inspect and rejects invalid browser snapshots", async t => {
  const stateDirectory = tempDirectory(), calls = [];
  let service;
  const server = http.createServer(async (req, res) => {
    if (!await service.handleHttp(req, res, new URL(req.url, "http://localhost"))) res.writeHead(404).end();
  });
  service = createMcpService({server,authorizeBrowser:() => null,rootDirectory:process.cwd(),stateDirectory});
  t.after(async () => { service.close(); await closeServer(server); });
  const address = await listen(server), status = service.register(address);
  const record = readRecords(recordsDirectory(stateDirectory))[0];
  const headers = {authorization:`Bearer ${record.secret}`,"x-penecho-mcp-instance":status.instanceId};
  const ownerId = crypto.randomUUID();
  const rpc = (name, args) => requestJson(address.port, "/api/mcp/rpc", {headers,body:{operation:"call",ownerId,name,arguments:args}});
  const progress = {title:"Saved title",status:"waiting",summary:"Saved evidence",steps:[{id:"s",label:"Verify",status:"working"}],events:Array.from({length:40}, (_, i) => ({id:`e-${i}`,text:`Evidence ${i}`,kind:"evidence"}))};
  let connection = await openCanvas(address.port, calls, progress);
  const disconnect = async () => {
    const closed = new Promise(resolve => connection.ws.once("close", resolve));
    connection.ws.close();
    await closed;
  };
  const startArgs = {canvasId:"canvas-a",instanceId:status.instanceId,documentId:"saved-document",sessionKey:"stable",client:"Codex",title:"Reconnect title"};
  const start = await rpc("penecho_start_session", startArgs);
  assert.equal(start.status, 200);
  const inspect = await rpc("penecho_inspect_session", {sessionId:start.value.result.sessionId});
  for (const [key, value] of Object.entries(progress)) {
    assert.deepEqual(start.value.result[key], value);
    assert.deepEqual(inspect.value.result[key], value);
    assert.deepEqual(inspect.value.result.browser[key], value);
  }
  // A replacement browser connection issues a new session ID but resumes data.
  await disconnect();
  connection = await openCanvas(address.port, calls, progress);
  const resumed = await rpc("penecho_start_session", startArgs);
  assert.equal(resumed.status, 200);
  assert.notEqual(resumed.value.result.sessionId, start.value.result.sessionId);
  assert.deepEqual(resumed.value.result.events, progress.events);
  for (const invalid of [{...progress,events:[...progress.events,progress.events[0]]},{...progress,status:"unknown"},{...progress,steps:[{id:"bad",label:42}]},{...progress,summary:"x".repeat(4001)}]) {
    await disconnect();
    connection = await openCanvas(address.port, calls, invalid);
    const rejected = await rpc("penecho_start_session", startArgs);
    assert.equal(rejected.status, 502);
    assert.equal(rejected.value.error.code, "invalid_browser_result");
  }
});

test("MCP service keeps discovery credentials private and binds a session to its exact opted-in canvas", async t => {
  const stateDirectory = tempDirectory(), calls = [];
  let service;
  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, "http://localhost"); } catch { res.writeHead(400).end(); return; }
    if (await service.handleHttp(req, res, url)) return;
    res.writeHead(404).end();
  });
  service = createMcpService({ autoStartHttp:true, server, authorizeBrowser:req => req.headers["x-test-browser"] === "allowed" ? null : "Forbidden", rootDirectory:process.cwd(), stateDirectory });
  const address = await listen(server), status = service.register(address);
  const directory = recordsDirectory(stateDirectory), records = readRecords(directory);
  assert.equal(records.length, 1);
  assert.equal(records[0].instanceId, status.instanceId);
  assert.match(records[0].secret, /^[0-9a-f]{64}$/);
  assert.equal(process.platform === "win32" || (fs.statSync(directory).mode & 0o077) === 0, true);
  assert.equal(process.platform === "win32" || (fs.statSync(records[0]._file).mode & 0o077) === 0, true);

  const deniedStatus = await requestJson(address.port, "/api/mcp/status", { method:"GET" });
  assert.equal(deniedStatus.status, 403);
  const browserStatus = await requestJson(address.port, "/api/mcp/status", { method:"POST", headers:{"x-test-browser":"allowed"} });
  assert.equal(browserStatus.status, 200);
  assert.equal(browserStatus.value.enabled, true);
  assert.equal(JSON.stringify(browserStatus.value).includes(records[0].secret), false);
  assert.equal(browserStatus.value.config.type, "stdio");
  assert.equal(browserStatus.value.config.args[2], browserStatus.value.http.hostId);

  const { ws, ready } = await openCanvas(address.port, calls, undefined, []);
  t.after(async()=>{ws.terminate();await service.close();if(server.listening)await closeServer(server);});
  assert.equal(ready.instanceId, status.instanceId);
  assert.equal(ready.catalog, true);
  const rpcHeaders = { authorization:`Bearer ${records[0].secret}`, "x-penecho-mcp-instance":status.instanceId };
  const originRejected = await requestJson(address.port, "/api/mcp/rpc", { headers:{...rpcHeaders,origin:"http://127.0.0.1"}, body:{operation:"list_canvases",ownerId:crypto.randomUUID()} });
  assert.equal(originRejected.status, 403);
  const wrongInstance = await requestJson(address.port, "/api/mcp/rpc", { headers:{...rpcHeaders,"x-penecho-mcp-instance":crypto.randomUUID()}, body:{operation:"list_canvases",ownerId:crypto.randomUUID()} });
  assert.equal(wrongInstance.status, 403);

  const ownerId = crypto.randomUUID();
  const listed = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"list_canvases",ownerId} });
  assert.deepEqual(listed.value.result.canvases, [], "an explicit empty catalog does not list the connection as a Canvas");
  await reportCanvasCatalog(ws, [
    { documentId:"document-new", title:"Workspace document", active:true },
    { documentId:"document-background", title:"Background document", active:false },
  ]);
  const catalogued = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"list_canvases",ownerId} });
  assert.deepEqual(catalogued.value.result.canvases.map(({canvasId,documentId,title,active}) => ({canvasId,documentId,title,active})), [
    {canvasId:"canvas-a",documentId:"document-new",title:"Workspace document",active:true},
    {canvasId:"canvas-a",documentId:"document-background",title:"Background document",active:false},
  ], "catalog titles and document IDs come from browser records, not the stale hello title");
  const catalogEntry = catalogued.value.result.canvases.find(item => item.documentId === "document-background");
  assert.deepEqual({canvasId:catalogEntry.canvasId,documentId:catalogEntry.documentId},{canvasId:"canvas-a",documentId:"document-background"});
  const opened = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_open_canvas",arguments:{canvasId:"canvas-a",instanceId:status.instanceId,create:true,title:"Persistent document",requestId:"open-1"}}});
  assert.deepEqual({documentId:opened.value.result.documentId,active:opened.value.result.active,locator:opened.value.result.locator},{documentId:"document-new",active:false,locator:{location:"device",id:"device-1"}});
  assert.equal(calls.at(-1).arguments.show,false);
  const openedRetry = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_open_canvas",arguments:{canvasId:"canvas-a",instanceId:status.instanceId,create:true,title:"Persistent document",requestId:"open-1"}}});
  assert.equal(openedRetry.value.result.reused,true);
  assert.equal(calls.filter(call => call.name === "mcp_open_canvas").length,1);
  const callsBeforeFind = calls.length;
  const found = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_find_canvases",arguments:{canvasId:catalogEntry.canvasId,instanceId:status.instanceId,documentId:catalogEntry.documentId}}});
  assert.equal(found.value.result.canvases[0].documentId,"document-background");
  assert.deepEqual(found.value.result.candidates,found.value.result.canvases,"new alias must preserve the original canvases collection");
  assert.equal(found.value.result.timing.durationMs,found.value.result.timing.completedAt-found.value.result.timing.requestedAt);
  assert.equal(calls.length,callsBeforeFind,"find_canvases reads the open-document catalog without entering the browser request queue");
  const started = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_start_session",arguments:{canvasId:catalogEntry.canvasId,instanceId:status.instanceId,documentId:catalogEntry.documentId,takeover:true,title:"Build chart",client:"Codex",sessionKey:"stable"}} });
  assert.equal(started.status, 200);
  assert.equal(started.value.result.slotIndex, 0);
  assert.equal(started.value.result.boardObjectId, null);
  assert.equal(started.value.result.feedbackCursor, 0);
  assert.equal(started.value.result.documentId, "document-background");
  const upload = started.value.result.imageUpload;
  assert.match(upload.hostId,/^[a-f0-9]{64}$/);
  assert.equal(upload.canvasId,"canvas-a");
  assert.equal(upload.documentId,"document-background");
  assert.deepEqual(upload.args,["--host-id",upload.hostId,"--upload-image","ABSOLUTE_IMAGE_PATH","--canvas-id","canvas-a","--document-id","document-background","--request-id","UNIQUE_UPLOAD_ID"]);
  assert.equal(upload.accessToken,undefined);
  assert.equal(started.value.result.instructions, undefined);
  assert.equal(started.value.result.guidanceVersion,"2");
  const sessionId = started.value.result.sessionId;
  const startCall = calls.find(call => call.name === "mcp_start_session");
  assert.equal(startCall.arguments.slotIndex, 0);
  assert.deepEqual({documentId:startCall.arguments.documentId,takeover:startCall.arguments.takeover,client:startCall.arguments.client,sessionKey:startCall.arguments.sessionKey},{documentId:"document-background",takeover:true,client:"Codex",sessionKey:"stable"});
  assert.equal(startCall.arguments.instructions, undefined);

  const reused = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_start_session",arguments:{canvasId:"canvas-a",instanceId:status.instanceId,documentId:"document-background",takeover:true,title:"Build chart",client:"Codex",sessionKey:"stable"}} });
  assert.equal(reused.status, 200);
  assert.equal(reused.value.result.reused, true);
  assert.equal(reused.value.result.instructions, undefined);
  assert.equal(reused.value.result.guidanceVersion,"2");
  assert.equal(reused.value.result.sessionId, sessionId);
  assert.equal(calls.filter(call => call.name === "mcp_start_session").length, 1);

  const attachArgs={canvasId:"canvas-a",instanceId:status.instanceId,target:"current",title:"Attach",client:"Codex",sessionKey:"attachment"};
  const attach=await requestJson(address.port,"/api/mcp/rpc",{headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_start_session",arguments:attachArgs}});
  assert.equal(attach.status,200);
  assert.equal(calls.at(-1).arguments.target,"current");
  assert.equal(calls.at(-1).arguments.documentId,undefined);
  const attachRetry=await requestJson(address.port,"/api/mcp/rpc",{headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_start_session",arguments:attachArgs}});
  assert.equal(attachRetry.value.result.sessionId,attach.value.result.sessionId);
  assert.equal(attachRetry.value.result.reused,true);
  const currentConflict=await requestJson(address.port,"/api/mcp/rpc",{headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_start_session",arguments:{...attachArgs,sessionKey:"stable"}}});
  assert.equal(currentConflict.status,409);
  assert.equal(calls.at(-1).arguments.sessionId,sessionId);
  assert.equal(calls.at(-1).arguments.target,"current");

  const files = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_list_files",arguments:{sessionId}}});
  assert.deepEqual(files.value.result.files,[{path:"/notes.md",kind:"text"}]);
  const read = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_read_file",arguments:{sessionId,path:"/notes.md"}}});
  assert.deepEqual({content:read.value.result.content,contentHash:read.value.result.contentHash},{content:"hello\n",contentHash:"hash-1"});
  const patchArgs = {sessionId,path:"/notes.md",contentHash:"hash-1",patch:"--- a/notes.md\n+++ b/notes.md\n@@ -1 +1 @@\n-hello\n+world\n",requestId:"patch-1"};
  const patched = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_patch_file",arguments:patchArgs}});
  assert.equal(patched.value.result.applied,true);
  assert.deepEqual(calls.find(call => call.name === "mcp_patch_file").arguments,{sessionId,path:"/notes.md",requestId:"patch-1",expectedHash:"hash-1",patch:patchArgs.patch});
  assert.equal(calls.find(call => call.name === "mcp_patch_file").arguments.content,undefined);
  const patchRetry = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_patch_file",arguments:patchArgs}});
  assert.equal(patchRetry.value.result.reused,true);
  assert.equal(calls.filter(call => call.name === "mcp_prepare_patch").length,0);
  assert.equal(calls.filter(call => call.name === "mcp_patch_file").length,1);
  const patchConflict = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_patch_file",arguments:{...patchArgs,patch:patchArgs.patch.replace("world","again")}}});
  assert.equal(patchConflict.value.error.code,"REQUEST_ID_CONFLICT");
  const stalePatch = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_patch_file",arguments:{...patchArgs,contentHash:"stale",requestId:"patch-stale"}}});
  assert.equal(stalePatch.value.error.code,"SOURCE_CONFLICT");
  assert.deepEqual(stalePatch.value.error.details,{currentContentHash:"hash-1",retry:"read-before-patch"});
  const browserConflict = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_patch_file",arguments:{...patchArgs,requestId:"browser-conflict"}}});
  assert.equal(browserConflict.value.error.code,"SOURCE_CONFLICT");
  assert.deepEqual(browserConflict.value.error.details,{currentContentHash:"hash-3",retry:"read-before-patch"});
  const invalidPatch = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_patch_file",arguments:{...patchArgs,patch:"--- a/other.md\n+++ b/other.md\n@@ -1 +1 @@\n-hello\n+world\n",requestId:"patch-invalid"}}});
  assert.equal(invalidPatch.value.error.code,"invalid_patch");
  const unknownArgs = {...patchArgs,requestId:"unknown-outcome"};
  await assert.rejects(() => service.callTool(ownerId,"penecho_patch_file",unknownArgs,{timeoutMs:10}), error => error.code === "canvas_timeout");
  const unknownRetry = await service.callTool(ownerId,"penecho_patch_file",unknownArgs);
  assert.equal(unknownRetry.applied,true);
  assert.equal(calls.filter(call => call.name === "mcp_patch_file" && call.arguments.path === "/notes.md").length,5);
  assert.equal(calls.filter(call => call.name === "mcp_patch_file" && call.arguments.requestId === "unknown-outcome").length,2);
  const receiptRecovery = await service.callTool(ownerId,"penecho_patch_file",{...patchArgs,requestId:"receipt-recovery"});
  assert.deepEqual({applied:receiptRecovery.applied,contentHash:receiptRecovery.contentHash,reused:receiptRecovery.reused},{applied:true,contentHash:"hash-recovered",reused:true});
  assert.equal(calls.some(call => call.name === "mcp_patch_file" && call.arguments.requestId === "receipt-recovery"),true);
  const edited = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_edit_canvas",arguments:{sessionId,requestId:"edit-1",action:"show"}}});
  assert.equal(edited.value.result.applied,true);
  const canvasCapture = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_capture_canvas",arguments:{sessionId}}});
  assert.deepEqual(canvasCapture.value.result.image,{mimeType:"image/webp",data:"AQIDBA==",bytes:4});
  assert.deepEqual({target:canvasCapture.value.result.target,width:canvasCapture.value.result.width,height:canvasCapture.value.result.height,encodedBytes:canvasCapture.value.result.encodedBytes,revision:canvasCapture.value.result.revision,pixelVerified:canvasCapture.value.result.pixelVerified},{target:"viewport",width:24,height:12,encodedBytes:4,revision:7,pixelVerified:true});
  assert.deepEqual(calls.filter(call => call.name === "mcp_capture_canvas").at(-1).arguments,{sessionId,target:"viewport",quality:"basic"});
  const hiddenCapture = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_capture_canvas",arguments:{sessionId,target:"selection",quality:"detail"}}});
  assert.equal(hiddenCapture.value.error.code,"CANVAS_NOT_VISIBLE");
  assert.deepEqual(hiddenCapture.value.error.details,{documentId:"document-background",retryable:true,retry:"show-then-capture"});
  const invalidCanvasCapture = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_capture_canvas",arguments:{sessionId,target:"object",objectId:"bad-bytes"}}});
  assert.equal(invalidCanvasCapture.value.error.code,"invalid_capture");
  assert.equal(invalidCanvasCapture.status,502);
  const messages = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_inbox",arguments:{sessionId}}});
  assert.equal(messages.value.result.messages.messages[0].id,"request-1");
  const ack = await requestJson(address.port, "/api/mcp/rpc", {headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_inbox",arguments:{sessionId,mode:"ack",ids:["request-1"],status:"working"}}});
  assert.deepEqual(ack.value.result.acknowledged,["request-1"]);

  const stolen = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId:crypto.randomUUID(),name:"penecho_update_session",arguments:{sessionId,status:"done"}} });
  assert.equal(stolen.status, 404);
  const stolenFeedback = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId:crypto.randomUUID(),name:"penecho_inbox",arguments:{sessionId}} });
  assert.equal(stolenFeedback.status, 404);
  const stolenDraw = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId:crypto.randomUUID(),name:"penecho_draw",arguments:{sessionId,artifactId:"stolen",requestId:"stolen",title:"Stolen",items:[{id:"n",type:"rect"}]}} });
  assert.equal(stolenDraw.status, 404);
  const milestoneApplied = new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{ws.off("message",received);reject(new Error("Queued milestone never reached its bound Canvas."));},2000);
    const received=data=>{const message=JSON.parse(data.toString());if(message.name!=="mcp_update_session"||message.arguments?.summary!=="First milestone")return;clearTimeout(timer);ws.off("message",received);resolve();};
    ws.on("message",received);
  });
  const queued = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_update_session",arguments:{sessionId,status:"working",summary:"First milestone",events:[{id:"e1",text:"Collected evidence",kind:"evidence"}]}} });
  assert.deepEqual({ accepted:queued.value.result.accepted, applied:queued.value.result.applied, pixelVerified:queued.value.result.pixelVerified }, { accepted:true, applied:false, pixelVerified:false });
  await milestoneApplied;
  assert.equal(calls.filter(call => call.name === "mcp_update_session").length, 1);
  const inspected = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_inspect_session",arguments:{sessionId}} });
  assert.deepEqual({state:inspected.value.result.render.state,applied:inspected.value.result.render.applied,visible:inspected.value.result.render.visible,pixelVerified:inspected.value.result.render.pixelVerified}, {state:"applied",applied:true,visible:true,pixelVerified:false});
  assert.equal(inspected.value.result.browser.visible, true);
  assert.deepEqual(inspected.value.result.browser.group, {objectIds:["draw-object-1","draw-object-2"]});
  assert.deepEqual(inspected.value.result.browser.artifacts, [{artifactId:"diagram",requestId:"diagram",kind:"drawing",objectIds:["draw-object-1","draw-object-2"]}]);
  assert.equal(inspected.value.result.instructions, undefined);

  const beforeDrawUpdate = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_update_session",arguments:{sessionId,summary:"Before native drawing"}} });
  assert.equal(beforeDrawUpdate.value.result.applied, false);
  const drawItems = [
    {id:"label",type:"text",text:"Native\nCanvas",x:10,y:20,color:"#123456",fontSize:16},
    {id:"shape",type:"rect",text:"Plan",fontSize:18,width:240,height:120,fill:"transparent"},
    {id:"edge",type:"arrow",from:"label",to:"shape",strokeWidth:2},
  ];
  const drawing = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_draw",arguments:{sessionId,artifactId:"diagram",requestId:"diagram",title:"Diagram",items:drawItems,capture:true,presentation:{intent:"explain",role:"supporting"}}} });
  assert.equal(drawing.status, 200);
  assert.deepEqual({artifactId:drawing.value.result.artifactId,objectId:drawing.value.result.objectId,objectIds:drawing.value.result.objectIds,kind:drawing.value.result.kind,revision:drawing.value.result.revision,feedbackCursor:drawing.value.result.feedbackCursor,applied:drawing.value.result.applied,pixelVerified:drawing.value.result.pixelVerified}, {artifactId:"diagram",objectId:"draw-object-1",objectIds:["draw-object-1","draw-object-2"],kind:"drawing",revision:4,feedbackCursor:2,applied:true,pixelVerified:true});
  assert.deepEqual(drawing.value.result.image, {mimeType:"image/webp",data:"BwgJ",bytes:3});
  assert.deepEqual(drawing.value.result.presentation, {intent:"explain",role:"supporting",attention:"quiet"});
  assert.deepEqual({width:drawing.value.result.width,height:drawing.value.result.height,encodedBytes:drawing.value.result.encodedBytes,captureRevision:drawing.value.result.captureRevision}, {width:12,height:8,encodedBytes:3,captureRevision:4});
  const nativeCalls = calls.filter(call => call.name === "mcp_update_session" && call.arguments.summary === "Before native drawing" || ["mcp_draw","mcp_capture_primitives"].includes(call.name));
  assert.deepEqual(nativeCalls.map(call => call.name), ["mcp_update_session","mcp_draw"]);
  assert.deepEqual(nativeCalls[1].arguments, {sessionId,artifactId:"diagram",requestId:"diagram",title:"Diagram",items:drawItems,capture:true,presentation:{intent:"explain",role:"supporting",attention:"quiet"}});

  const plot = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_plot",arguments:{sessionId,artifactId:"plot",requestId:"plot",title:"Sine",expression:"sin(x)",xMin:-10,xMax:10,color:"#ABC",presentation:{intent:"compare",size:"wide",relativeTo:"diagram"}}} });
  assert.equal(plot.status, 200);
  assert.deepEqual({artifactId:plot.value.result.artifactId,objectIds:plot.value.result.objectIds,kind:plot.value.result.kind,applied:plot.value.result.applied,pixelVerified:plot.value.result.pixelVerified}, {artifactId:"plot",objectIds:["plot-object"],kind:"plot",applied:true,pixelVerified:false});
  assert.deepEqual(plot.value.result.presentation, {intent:"compare",role:"primary",size:"wide",relativeTo:"diagram",relation:"beside",attention:"normal"});
  assert.equal(calls.filter(call => call.name === "mcp_capture_primitives").length, 0);
  assert.deepEqual(calls.find(call => call.name === "mcp_plot").arguments, {sessionId,artifactId:"plot",requestId:"plot",title:"Sine",expression:"sin(x)",width:992,height:360,xMin:-10,xMax:10,color:"#ABC",presentation:{intent:"compare",role:"primary",size:"wide",relativeTo:"diagram",relation:"beside",attention:"normal"}});
  const mismatchedDrawing = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_draw",arguments:{sessionId,artifactId:"mismatched",requestId:"mismatched",title:"Mismatch",items:[{id:"n",type:"rect"}]}} });
  assert.equal(mismatchedDrawing.status, 502);
  assert.equal(mismatchedDrawing.value.error.code, "invalid_browser_result");
  const excessiveDrawingIds = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_draw",arguments:{sessionId,artifactId:"too-many",requestId:"too-many",title:"Too many",items:[{id:"n",type:"rect"}]}} });
  assert.equal(excessiveDrawingIds.status, 502);
  const duplicatePlotIds = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_plot",arguments:{sessionId,artifactId:"duplicate",requestId:"duplicate",title:"Duplicate",expression:"x"}} });
  assert.equal(duplicatePlotIds.status, 502);

  const plainPresentation = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_present_widget",arguments:{sessionId,artifactId:"plain",requestId:"plain",title:"Plain",html:"<p>Plain</p>"}} });
  assert.equal(plainPresentation.value.result.objectId, "widget-object");
  assert.equal(plainPresentation.value.result.pixelVerified, false);
  assert.equal(plainPresentation.value.result.feedbackCursor, 1);
  assert.equal(plainPresentation.value.result.image, undefined);
  assert.deepEqual(calls.find(call => call.name === "mcp_present_widget" && call.arguments.artifactId === "plain").arguments, {sessionId,artifactId:"plain",requestId:"plain",title:"Plain",html:"<p>Plain</p>",capture:false,width:1200,height:800});
  assert.equal(calls.some(call => call.name === "mcp_capture_widget" && call.arguments.artifactId === "plain"), false);
  const combined = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_present_widget",arguments:{sessionId,artifactId:"chart",requestId:"chart",title:"Chart",html:"<p>Chart</p>",output:"detailed",capture:true,quality:"detail"}} });
  assert.deepEqual(combined.value.result.image, { mimeType:"image/png", data:"AQID", bytes:3 });
  assert.equal(combined.value.result.pixelVerified, true);
  assert.equal(combined.value.result.objectId, "widget-object");
  assert.equal(combined.value.result.artifactId, "chart");
  assert.equal(combined.value.result.revision, 3);
  assert.equal(combined.value.result.timing.durationMs, combined.value.result.timing.completedAt - combined.value.result.timing.requestedAt);
  assert.deepEqual({browserElapsedMs:combined.value.result.browserElapsedMs,viewport:combined.value.result.viewport,mapping:combined.value.result.mapping,runtimeDiagnostics:combined.value.result.runtimeDiagnostics}, {browserElapsedMs:4,viewport:{width:800,height:600},mapping:{scale:2},runtimeDiagnostics:{renderer:"canvas"}});
  assert.equal(combined.value.result.presentationMetadata, undefined);
  const chartCalls = calls.filter(call => call.arguments.artifactId === "chart");
  assert.deepEqual(chartCalls.map(call => call.name), ["mcp_present_widget"]);
  assert.equal(chartCalls[0].arguments.capture, true);
  assert.equal(chartCalls[0].arguments.quality,"detail");
  const compared = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_present_widget",arguments:{sessionId,artifactId:"comparison",requestId:"comparison",title:"Comparison",html:"<p>Comparison</p>",presentation:{intent:"compare",role:"supporting",size:"large",relativeTo:"plain"}}} });
  assert.deepEqual(compared.value.result.presentation, {intent:"compare",role:"supporting",size:"large",relativeTo:"plain",relation:"beside",attention:"quiet"});
  assert.deepEqual(calls.find(call => call.name === "mcp_present_widget" && call.arguments.artifactId === "comparison").arguments, {sessionId,artifactId:"comparison",requestId:"comparison",title:"Comparison",html:"<p>Comparison</p>",capture:false,width:992,height:752,presentation:compared.value.result.presentation});
  const captureCountBeforeInspect = calls.filter(call => call.name === "mcp_capture_widget").length;
  const inspectedWidget = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_present_widget",arguments:{sessionId,artifactId:"inspection",requestId:"inspection",title:"Inspection",html:"<p>Inspect</p>",capture:true,presentation:{intent:"inspect",size:"wide"}}} });
  assert.deepEqual({ephemeral:inspectedWidget.value.result.ephemeral,applied:inspectedWidget.value.result.applied,pixelVerified:inspectedWidget.value.result.pixelVerified,width:inspectedWidget.value.result.width,height:inspectedWidget.value.result.height,encodedBytes:inspectedWidget.value.result.encodedBytes,revision:inspectedWidget.value.result.revision}, {ephemeral:true,applied:true,pixelVerified:true,width:992,height:360,encodedBytes:4,revision:8});
  assert.equal(inspectedWidget.value.result.objectId, undefined);
  assert.deepEqual(inspectedWidget.value.result.image, {mimeType:"image/webp",data:"AQIDBA==",bytes:4});
  assert.equal(calls.filter(call => call.name === "mcp_capture_widget").length, captureCountBeforeInspect);
  assert.deepEqual(calls.find(call => call.name === "mcp_present_widget" && call.arguments.artifactId === "inspection").arguments, {sessionId,artifactId:"inspection",requestId:"inspection",title:"Inspection",html:"<p>Inspect</p>",width:992,height:360,presentation:{intent:"inspect",role:"primary",size:"wide",attention:"quiet"},capture:true,quality:"basic"});
  const invalidInspections = [
    ["inspection-too-large",413,"capture_too_large"],
    ["inspection-viewport-mismatch",502,"invalid_browser_result"],
    ["inspection-object",502,"invalid_browser_result"],
    ["inspection-bad-bytes",502,"invalid_capture"],
    ["inspection-persistent",502,"invalid_browser_result"],
  ];
  for (const [artifactId,status,code] of invalidInspections) {
    const response = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_present_widget",arguments:{sessionId,artifactId,requestId:artifactId,title:"Invalid inspection",html:"<p>Inspect</p>",capture:true,presentation:{intent:"inspect",size:"wide"}}} });
    assert.equal(response.status, status);
    assert.equal(response.value.error.code, code);
  }
  assert.equal(calls.filter(call => call.name === "mcp_capture_widget").length, captureCountBeforeInspect);
  const inboxCall=arguments_=>requestJson(address.port,"/api/mcp/rpc",{headers:rpcHeaders,body:{operation:"call",ownerId,name:"penecho_inbox",arguments:{sessionId,...arguments_}}});
  const feedback=await inboxCall({});
  assert.equal(feedback.value.result.image,undefined);
  assert.equal(feedback.value.result.feedback.entries.length,1);
  assert.equal(feedback.value.result.feedback.nextCursor,2);
  assert.equal(feedback.value.result.messages.nextCursor,1);
  const capturedFeedback=await inboxCall({feedbackAfter:1,limit:3,capture:true});
  assert.deepEqual(capturedFeedback.value.result.image,{mimeType:"image/webp",data:"AQIDBA==",bytes:4});
  assert.equal(capturedFeedback.value.result.pixelVerified,true);
  assert.equal(capturedFeedback.value.result.feedback.nextCursor,2);
  const noFeedback=await inboxCall({feedbackAfter:2});
  assert.equal(noFeedback.value.result.feedback.entries.length,0);
  assert.equal(noFeedback.value.result.image,undefined);
  const spatialPage=await inboxCall({feedbackAfter:60,limit:3});
  assert.deepEqual({next:spatialPage.value.result.feedback.nextCursor,latest:spatialPage.value.result.feedback.latestCursor,hasMore:spatialPage.value.result.feedback.hasMore},{next:61,latest:65,hasMore:true});
  for(const [feedbackAfter,status,code] of [[80,502,"invalid_capture"],[90,413,"capture_too_large"],[91,413,"capture_too_large"],[92,413,"capture_too_large"],[77,502,"invalid_browser_result"]]){
    const response=await inboxCall({feedbackAfter,capture:true});assert.equal(response.status,status);assert.equal(response.value.error.code,code);
  }
  const finalQueued = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_update_session",arguments:{sessionId,status:"done",summary:"Final evidence"}} });
  assert.equal(finalQueued.value.result.applied, false);
  const closed = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_close_session",arguments:{sessionId}} });
  assert.equal(closed.value.result.closed, true);
  const finalUpdateIndex = calls.findIndex(call => call.name === "mcp_update_session" && call.arguments.summary === "Final evidence");
  const closeIndex = calls.findIndex(call => call.name === "mcp_close_session");
  assert.equal(finalUpdateIndex >= 0 && closeIndex > finalUpdateIndex, true);

  await reportCanvasCatalog(ws, [{documentId:"document-new",title:"Workspace document",active:true}]);
  assert.deepEqual(service.listCanvases().map(({canvasId,documentId,title,active}) => ({canvasId,documentId,title,active})), [
    {canvasId:"canvas-a",documentId:"document-new",title:"Workspace document",active:true},
  ], "a browser catalog replacement removes a document as soon as the user closes it");

  const lostStarted = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_start_session",arguments:{canvasId:"canvas-a",instanceId:status.instanceId,title:"Lost session"}} });
  const lostSessionId = lostStarted.value.result.sessionId;
  ws.close();
  await new Promise(resolve => ws.once("close", resolve));
  const lost = await requestJson(address.port, "/api/mcp/rpc", { headers:rpcHeaders, body:{operation:"call",ownerId,name:"penecho_present_widget",arguments:{sessionId:lostSessionId,artifactId:"next",requestId:"next",title:"Next",html:"<p>Next</p>"}} });
  assert.equal(lost.status, 409);
  assert.equal(lost.value.error.code, "canvas_disconnected");

  await service.close();
  assert.equal(readRecords(directory).length, 0);
  await closeServer(server);
});

test("MCP hello seeds the exact open document catalog and advertises catalog replacement", async t => {
  const server = http.createServer(), service = createMcpService({
    server,
    authorizeBrowser:req => req.headers["x-test-browser"] === "allowed" ? null : "Forbidden",
    stateDirectory:tempDirectory(),
  });
  const address = await listen(server), documents = [
    {documentId:"hello-active",title:"Active document",active:true},
    {documentId:"hello-background",title:"Background document",active:false},
  ];
  const {ws,ready} = await openCanvas(address.port, [], undefined, documents);
  t.after(async () => { ws.terminate(); await service.close(); if (server.listening) await closeServer(server); });
  assert.equal(ready.catalog, true);
  assert.deepEqual(service.listCanvases().map(({canvasId,documentId,title,active}) => ({canvasId,documentId,title,active})), [
    {canvasId:"canvas-a",documentId:"hello-active",title:"Active document",active:true},
    {canvasId:"canvas-a",documentId:"hello-background",title:"Background document",active:false},
  ]);
});

test("authenticated LAN browser status is allowed while configuration and private RPC stay local", async () => {
  const stateDirectory = tempDirectory(), server = http.createServer(), checkedAddresses = [];
  const service = createMcpService({
    server,
    authorizeBrowser:req => req.headers["x-test-browser"] === "allowed" ? null : "Forbidden",
    isLocalBrowserAddress:address => {
      checkedAddresses.push(address);
      return address === "192.168.50.7";
    },
    rootDirectory:process.cwd(),
    stateDirectory,
  });

  const sameHost = await invokeServiceHttp(service, "::ffff:192.168.50.7", "/api/mcp/status", { headers:{"x-test-browser":"allowed"} });
  assert.equal(sameHost.handled, true);
  assert.equal(sameHost.status, 200);
  assert.deepEqual(checkedAddresses, ["192.168.50.7"]);

  const sameHostConfigure = await invokeServiceHttp(service, "192.168.50.7", "/api/mcp/configure", { headers:{"x-test-browser":"allowed"} });
  assert.equal(sameHostConfigure.status, 415);
  assert.equal(sameHostConfigure.value.error.code, "unsupported_media_type");

  const otherLanHost = await invokeServiceHttp(service, "192.168.50.8", "/api/mcp/status", { headers:{"x-test-browser":"allowed"} });
  assert.equal(otherLanHost.status, 200);
  assert.equal(otherLanHost.value.canConfigureLocalClients, false);
  assert.equal(otherLanHost.value.config, null);
  const remoteConfigure = await invokeServiceHttp(service, "192.168.50.8", "/api/mcp/configure", {headers:{"x-test-browser":"allowed"}});
  assert.equal(remoteConfigure.value.error.code, "local_host_required");
  assert.equal(otherLanHost.value.canCopyLanSetup, true);
  assert.deepEqual(otherLanHost.value.http, sameHost.value.http);
  assert.equal(sameHost.value.canCopyLanSetup, true);
  assert.equal(service.status(false).canCopyLanSetup, false);
  assert.equal(service.status(false).lan, undefined);
  for (const address of ["::ffff:10.0.0.8", "172.16.0.8", "172.31.255.254", "fd12::8", "fe80::8%en0"]) {
    const status = await invokeServiceHttp(service, address, "/api/mcp/status", {headers:{"x-test-browser":"allowed"}});
    assert.equal(status.value.canCopyLanSetup, true);
    assert.equal(status.value.config, null);
    assert.deepEqual(status.value.http, sameHost.value.http);
  }
  for (const address of ["203.0.113.8", "172.32.0.8", "2001:db8::8", "unknown"]) {
    const status = await invokeServiceHttp(service, address, "/api/mcp/status", {headers:{"x-test-browser":"allowed", "x-forwarded-for":"192.168.50.8"}});
    assert.equal(status.value.canCopyLanSetup, false);
    assert.equal(status.value.lan, undefined);
    assert.equal(status.value.config, null);
  }
  const deniedLan = await invokeServiceHttp(service, "192.168.50.8", "/api/mcp/status");
  assert.equal(deniedLan.status, 403);
  assert.equal(deniedLan.value.lan, undefined);
  const remoteMutation = await invokeServiceHttp(service, "192.168.50.8", "/api/mcp/http", {headers:{"x-test-browser":"allowed"}});
  assert.equal(remoteMutation.status, 403);
  assert.equal(remoteMutation.value.error.code, "local_host_required");

  const authorizationDenied = await invokeServiceHttp(service, "192.168.50.7", "/api/mcp/status");
  assert.equal(authorizationDenied.status, 403);
  assert.deepEqual(authorizationDenied.value.error, { code:"forbidden", message:"Forbidden" });

  const rpcFromSameHostLan = await invokeServiceHttp(service, "::ffff:192.168.50.7", "/api/mcp/rpc", {
    headers:{ authorization:"Bearer deliberately-invalid", "x-penecho-mcp-instance":service.instanceId },
  });
  assert.equal(rpcFromSameHostLan.status, 403);
  assert.deepEqual(rpcFromSameHostLan.value.error, { code:"forbidden", message:"Forbidden" });

  const upgradeResult = await new Promise(resolve => {
    const writes = [];
    const socket = {
      destroyed:false,
      destroy() { this.destroyed = true; resolve(Buffer.concat(writes.map(value => Buffer.from(value))).toString("utf8")); },
      write(value) { writes.push(value); },
    };
    server.emit("upgrade", { headers:{}, socket:{remoteAddress:"192.168.50.8"}, url:"/api/mcp/canvas" }, socket, Buffer.alloc(0));
  });
  assert.match(upgradeResult, /403 Forbidden/);
  assert.match(upgradeResult, /forbidden/);
  assert.equal(upgradeResult.includes("192.168.50"), false);

  await service.close();
});

test("MCP status inspects configured clients only when explicitly requested", async () => {
  const server = http.createServer();
  let inspections = 0;
  const service = createMcpService({
    server,
    authorizeBrowser:req => req.headers["x-test-browser"] === "allowed" ? null : "Forbidden",
    rootDirectory:process.cwd(),
    stateDirectory:tempDirectory(),
    inspectConfiguredClients:async () => { inspections += 1; return ["codex"]; },
  });

  const ordinary = await invokeServiceHttp(service, "127.0.0.1", "/api/mcp/status", { method:"GET", headers:{"x-test-browser":"allowed"} });
  assert.equal(ordinary.status, 200);
  assert.equal(ordinary.value.configuredClients, undefined);
  assert.equal(inspections, 0);

  const denied = await invokeServiceHttp(service, "127.0.0.1", "/api/mcp/status?inspectClients=1", { method:"GET" });
  assert.equal(denied.status, 403);
  assert.equal(inspections, 0);

  const remote = await invokeServiceHttp(service, "192.168.50.8", "/api/mcp/status?inspectClients=1", {method:"GET",headers:{"x-test-browser":"allowed"}});
  assert.equal(remote.status,200);
  assert.equal(remote.value.config,null);
  assert.equal(remote.value.configuredClients,undefined);
  assert.equal(inspections,0);

  const inspected = await invokeServiceHttp(service, "127.0.0.1", "/api/mcp/status?inspectClients=1", { method:"GET", headers:{"x-test-browser":"allowed"} });
  assert.equal(inspected.status, 200);
  assert.deepEqual(inspected.value.configuredClients, ["codex"]);
  assert.equal(inspections, 1);

  const ignored = await invokeServiceHttp(service, "127.0.0.1", "/api/mcp/status?inspectClients=true", { method:"GET", headers:{"x-test-browser":"allowed"} });
  assert.equal(ignored.status, 200);
  assert.equal(ignored.value.configuredClients, undefined);
  assert.equal(inspections, 1);
  await service.close();
});

test("canvas WebSocket answers browser JSON pings after hello", async () => {
  const server = http.createServer(), service = createMcpService({ server, authorizeBrowser:req => req.headers["x-test-browser"] === "allowed" ? null : "Forbidden", rootDirectory:process.cwd(), stateDirectory:tempDirectory() });
  const address = await listen(server), {ws} = await openCanvas(address.port, []);
  const pong = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for JSON pong.")), 500);
    const receive = raw => {
      const message = JSON.parse(raw.toString("utf8"));
      if (message.type !== "pong") return;
      clearTimeout(timer);
      ws.off("message", receive);
      resolve(message);
    };
    ws.on("message", receive);
  });
  ws.send(JSON.stringify({type:"ping"}));
  assert.deepEqual(await pong, {type:"pong"});
  const closed = waitForSocketEvent(ws, "close");
  ws.close();
  await closed;
  await service.close();
  await closeServer(server);
});

test("native canvas heartbeat terminates clients that stop answering pong", async () => {
  const server = http.createServer(), service = createMcpService({
    server,
    authorizeBrowser:req => req.headers["x-test-browser"] === "allowed" ? null : "Forbidden",
    rootDirectory:process.cwd(),
    stateDirectory:tempDirectory(),
    heartbeatIntervalMs:10,
    heartbeatTimeoutMs:35,
  });
  const address = await listen(server), ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/mcp/canvas`, { autoPong:false, headers:{"x-test-browser":"allowed"} });
  try {
    await waitForSocketEvent(ws, "open");
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for canvas ready.")), 500);
      ws.on("message", raw => {
        const message = JSON.parse(raw.toString("utf8"));
        if (message.type !== "ready") return;
        clearTimeout(timer);
        resolve(message);
      });
    });
    let nativePings = 0;
    ws.on("ping", () => { nativePings += 1; });
    const closed = waitForSocketEvent(ws, "close");
    ws.send(JSON.stringify({type:"hello",canvasId:"heartbeat-canvas",title:"Heartbeat board"}));
    await ready;
    const pending = service.callTool(crypto.randomUUID(), "penecho_start_session", {instanceId:service.instanceId,canvasId:"heartbeat-canvas",title:"Offline request"});
    const rejected = assert.rejects(pending,{code:"canvas_disconnected"});
    const [code] = await closed;
    await rejected;
    await delay(0);
    assert.equal(code, 1006);
    assert.equal(nativePings > 0, true);
    assert.deepEqual(service.listCanvases(), []);
  } finally {
    await service.close();
    await closeServer(server);
  }
});

test("canvas heartbeat remains alive on native pong and stops with the service", async () => {
  const server = http.createServer(), service = createMcpService({
    server,
    authorizeBrowser:req => req.headers["x-test-browser"] === "allowed" ? null : "Forbidden",
    rootDirectory:process.cwd(),
    stateDirectory:tempDirectory(),
    heartbeatIntervalMs:10,
    heartbeatTimeoutMs:40,
  });
  const address = await listen(server), {ws} = await openCanvas(address.port, []);
  let nativePings = 0;
  ws.on("ping", () => { nativePings += 1; });
  await waitForSocketEvent(ws, "ping");
  await delay(45);
  assert.equal(ws.readyState, WebSocket.OPEN);
  assert.equal(nativePings > 0, true);
  const closed = waitForSocketEvent(ws, "close");
  await service.close();
  await closed;
  const pingsAtClose = nativePings;
  await delay(30);
  assert.equal(nativePings, pingsAtClose);
  await closeServer(server);
});

test("MCP tool validation is strict and client configuration uses official argv without a shell", async () => {
  const stateDirectory = tempDirectory(), server = http.createServer();
  const service = createMcpService({ server, authorizeBrowser:() => null, rootDirectory:process.cwd(), stateDirectory, launch:{command:"/opt/penecho/node",args:["/opt/penecho/stdio.js"],env:{ELECTRON_RUN_AS_NODE:"1"}} });
  assert.throws(() => createMcpService({server,authorizeBrowser:() => null,heartbeatIntervalMs:0}), /heartbeatIntervalMs must be positive/);
  assert.throws(() => createMcpService({server,authorizeBrowser:() => null,heartbeatTimeoutMs:0}), /heartbeatTimeoutMs must be positive/);
  assert.throws(() => createMcpService({server,authorizeBrowser:() => null,heartbeatIntervalMs:20,heartbeatTimeoutMs:10}), /at least heartbeatIntervalMs/);
  await assert.rejects(() => service.callTool(crypto.randomUUID(), "penecho_start_session", { canvasId:"x", instanceId:service.instanceId, title:"x", extra:true }), /unsupported field/);
  await assert.rejects(() => service.callTool(crypto.randomUUID(), "penecho_start_session", { canvasId:"x", instanceId:service.instanceId, title:"x".repeat(121) }), /title is invalid/);
  await assert.rejects(() => service.callTool(crypto.randomUUID(), "penecho_update_session", { sessionId:"x", status:"secretly-thinking" }), /status is invalid/);
  await assert.rejects(() => service.callTool(crypto.randomUUID(), "penecho_capture_canvas", { sessionId:"x",target:"artifact", artifactId:"a", quality:0.8 }), /quality is invalid/);
  await assert.rejects(() => service.callTool(crypto.randomUUID(), "penecho_present_widget", { sessionId:"x", artifactId:"a",requestId:"a", title:"Widget", html:"<p>x</p>", quality:"detail" }), /quality requires capture/);
  await assert.rejects(() => service.callTool(crypto.randomUUID(), "penecho_present_widget", { sessionId:"x", artifactId:"a",requestId:"a", title:"Widget", html:"<p>x</p>", width:299 }), /width must be a finite number in range 300\.\.4096 \(inclusive\); received 299/);
  await assert.rejects(() => service.callTool(crypto.randomUUID(), "penecho_inbox", { sessionId:"x", feedbackAfter:-1 }), /feedbackAfter is invalid/);
  await assert.rejects(() => service.callTool(crypto.randomUUID(), "penecho_inbox", { sessionId:"x", feedbackAfter:1.5 }), /feedbackAfter is invalid/);
  await assert.rejects(() => service.callTool(crypto.randomUUID(), "penecho_inbox", { sessionId:"x", limit:51 }), /limit is invalid/);
  await assert.rejects(() => service.callTool(crypto.randomUUID(), "penecho_inbox", { sessionId:"x", capture:"yes" }), /capture is invalid/);
  const explicitLaunch = {command:"/opt/penecho/node",args:["/opt/penecho/stdio.js"],env:{ELECTRON_RUN_AS_NODE:"1"}};
  assert.equal(service.status().config, null);
  assert.deepEqual(configurationArguments("codex", explicitLaunch), ["mcp","add","--env","ELECTRON_RUN_AS_NODE=1","penecho","--","/opt/penecho/node","/opt/penecho/stdio.js"]);
  assert.deepEqual(configurationArguments("claude", explicitLaunch), ["mcp","add","--transport","stdio","--scope","user","penecho","--env","ELECTRON_RUN_AS_NODE=1","--","/opt/penecho/node","/opt/penecho/stdio.js"]);
  const executions = [],configHome=tempDirectory(),configEnv={CLAUDE_CONFIG_DIR:configHome};
  const configured = await configureClient("claude", explicitLaunch, {
    env:configEnv,home:configHome,candidates:[{executable:"/opt/claude",source:"test"}],
    executeFile:async (executable,args)=>{executions.push({executable,args});return {stdout:"",stderr:""};},
  });
  assert.deepEqual(configured,{configured:true,updated:false,client:"claude"});
  assert.deepEqual(executions,[{executable:"/opt/claude",args:["mcp","add","--transport","stdio","--scope","user","penecho","--env","ELECTRON_RUN_AS_NODE=1","--","/opt/penecho/node","/opt/penecho/stdio.js"]}]);
  const file=path.join(configHome,".claude.json"),other={command:"/unchanged"};
  fs.writeFileSync(file,JSON.stringify({mcpServers:{penecho:{command:"/old"},other}}));
  const existing = await configureClient("claude",explicitLaunch,{
    env:configEnv,home:configHome,candidates:[{executable:"/opt/claude",source:"test"}],
    executeFile:async()=>assert.fail("existing user entry must update without remove/add"),
  });
  assert.deepEqual(existing,{configured:true,updated:true,client:"claude"});
  const saved=JSON.parse(fs.readFileSync(file,"utf8"));
  assert.deepEqual(saved.mcpServers.penecho,{type:"stdio",...explicitLaunch});
  assert.deepEqual(saved.mcpServers.other,other);
  await service.close();
});

test("HTTP auto configuration reports safe actionable failures without exposing configuration contents", async () => {
  const home = tempDirectory(), config = path.join(home, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(config));
  const original = 'developer_instructions = """private fixture instructions"""\n';
  fs.writeFileSync(config, original);
  const result = await configureClient("codex", {type:"http",url:"https://127.0.0.1:1234/mcp",accessToken:"private-fixture-token"}, {home,env:{}});
  assert.equal(result.configured, false);
  assert.equal(result.code, "MCP_CONFIG_UNSUPPORTED");
  assert.match(result.error, /syntax.*setup prompt/);
  assert.doesNotMatch(JSON.stringify(result), /private.fixture/);
  assert.equal(fs.readFileSync(config, "utf8"), original);
});

test("Claude MCP configuration argv parses with commander variadic env options", () => {
  const parseAddArguments = argv => {
    const program = new Command();
    program.exitOverride();
    let parsed = null;
    const mcp = program.command("mcp");
    mcp.command("add <name> <commandOrUrl> [args...]")
      .option("--transport <transport>")
      .option("--scope <scope>")
      .option("-e, --env <env...>")
      .action((name, commandOrUrl, args, options) => {
        parsed = { name, commandOrUrl, args, transport:options.transport, scope:options.scope, env:options.env || [] };
      });
    program.parse(["node", "claude", ...argv]);
    return parsed;
  };

  const cases = [
    {
      launch:{ command:"/opt/penecho/node", args:["/opt/penecho/stdio.js"], env:{ ELECTRON_RUN_AS_NODE:"1" } },
      expected:{ name:"penecho", commandOrUrl:"/opt/penecho/node", args:["/opt/penecho/stdio.js"], transport:"stdio", scope:"user", env:["ELECTRON_RUN_AS_NODE=1"] },
    },
    {
      launch:{
        command:'C:\\Program Files\\PenEcho & Tools\\PenEcho.exe',
        args:['C:\\Users\\用户\\stdio.js', "--state-dir", 'C:\\space & %PATH% ! ^ ( )\\', 'literal "quote"'],
        env:{ API_KEY:'value with spaces & %PATH% ! ^ "quoted"', EMPTY:"" },
      },
      expected:{
        name:"penecho",
        commandOrUrl:'C:\\Program Files\\PenEcho & Tools\\PenEcho.exe',
        args:['C:\\Users\\用户\\stdio.js', "--state-dir", 'C:\\space & %PATH% ! ^ ( )\\', 'literal "quote"'],
        transport:"stdio",
        scope:"user",
        env:['API_KEY=value with spaces & %PATH% ! ^ "quoted"', "EMPTY="],
      },
    },
    {
      launch:{ command:"/opt/penecho/node", args:[], env:{} },
      expected:{ name:"penecho", commandOrUrl:"/opt/penecho/node", args:[], transport:"stdio", scope:"user", env:[] },
    },
  ];

  for (const {launch, expected} of cases) assert.deepEqual(parseAddArguments(configurationArguments("claude", launch)), expected);
});

test("configured MCP client inspection is bounded, read-only, and treats failures as unknown", async () => {
  const executions = [];
  const configured = await inspectConfiguredClients({
    candidates:{
      codex:[{executable:"/opt/codex-one"},{executable:"/opt/codex-two"},{executable:"/opt/codex-ignored"}],
      claude:[{executable:"/opt/claude"}],
    },
    executeFile:async (executable, args, options) => {
      executions.push({executable,args,timeout:options.timeout});
      if (executable === "/opt/codex-one") throw new Error("missing entry");
      return {stdout:"private client configuration",stderr:""};
    },
  });
  assert.deepEqual(configured, ["codex","claude"]);
  assert.deepEqual(executions.map(item => item.executable).sort(), ["/opt/claude","/opt/codex-one","/opt/codex-two"]);
  assert.equal(executions.every(item => item.args.join(" ") === "mcp get penecho"), true);
  assert.equal(executions.every(item => item.timeout === 1_000), true);
  assert.equal(executions.some(item => item.executable.includes("ignored")), false);

  const failedCommands = [];
  const failed = await inspectConfiguredClients({
    candidates:{
      codex:[{executable:"/private/codex-one"},{executable:"/private/codex-two"},{executable:"/private/codex-ignored"}],
      claude:[{executable:"/private/claude"}],
    },
    executeFile:async (executable, args) => { failedCommands.push({executable,args}); throw Object.assign(new Error("secret path"), {stdout:"secret stdout",stderr:"secret stderr"}); },
  });
  assert.deepEqual(failed, []);
  assert.deepEqual(failedCommands.map(item => item.executable).sort(), ["/private/claude","/private/codex-one","/private/codex-two"]);
  assert.equal(failedCommands.some(item => item.executable.includes("ignored")), false);
  assert.equal(failedCommands.every(item => item.args.join(" ") === "mcp get penecho"), true);

  const startedAt = Date.now();
  const timedOut = await inspectConfiguredClients({
    candidates:{codex:[{executable:"/opt/codex"}],claude:[]},
    timeoutMs:10,
    executeFile:async () => new Promise(() => {}),
  });
  assert.deepEqual(timedOut, []);
  assert.equal(Date.now() - startedAt < 250, true);
});

test("authenticated LAN WebSocket participates in local RPC discovery and routing", async () => {
  const server = http.createServer();
  server.on("upgrade", req => Object.defineProperty(req.socket, "remoteAddress", {value:"192.168.50.8"}));
  const stateDirectory = tempDirectory();
  const service = createMcpService({server, authorizeBrowser:req => req.headers["x-test-browser"] === "allowed" ? null : "Forbidden", stateDirectory});
  server.on("request", (req,res) => { void service.handleHttp(req,res); });
  const address = await listen(server);
  service.register(address);
  const record = readRecords(recordsDirectory(stateDirectory))[0];
  try {
    const {ws} = await openCanvas(address.port, []);
    await reportCanvasCatalog(ws, [{documentId:"lan-document",title:"LAN document",active:true}]);
    assert.equal(service.status().lan, undefined);
    const owner = crypto.randomUUID();
    const rpc = await requestJson(address.port,"/api/mcp/rpc",{headers:{authorization:`Bearer ${record.secret}`,"x-penecho-mcp-instance":service.instanceId},body:{operation:"list_canvases",ownerId:owner}});
    assert.equal(rpc.status,200);
    assert.equal(rpc.value.result.canvases.length, 1);
    assert.deepEqual(rpc.value.result.canvases.map(({canvasId,documentId,title,active}) => ({canvasId,documentId,title,active})), [{canvasId:"canvas-a",documentId:"lan-document",title:"LAN document",active:true}]);
    const started = await service.callTool(owner, "penecho_start_session", {instanceId:service.instanceId,canvasId:"canvas-a",documentId:"lan-document",title:"LAN"});
    assert.ok(started.sessionId);
    const closed = waitForSocketEvent(ws, "close");
    ws.close();
    await closed;
    await delay(0);
    assert.deepEqual(service.listCanvases(), []);
    await assert.rejects(service.callTool(owner,"penecho_inspect_session",{sessionId:started.sessionId}), {code:"canvas_disconnected"});
  } finally { await service.close(); await closeServer(server); }
});

test("removed invitation routes and persisted identity never restore a service or fallback configuration", async () => {
  const stateDirectory = tempDirectory();
  fs.mkdirSync(path.join(stateDirectory,"lan"));
  fs.writeFileSync(path.join(stateDirectory,"lan","lan-identity.json"), JSON.stringify({fingerprint:"a".repeat(64),invitation:"b".repeat(64)}));
  const service = createMcpService({server:http.createServer(),stateDirectory,authorizeBrowser:() => null});
  try {
    service.register({port:12345});
    for (const url of ["/api/mcp/lan","/api/mcp/lan-client.js"]) assert.equal(await service.handleHttp({url,method:"POST"}, {}), false);
    const {channelId} = await service.executeRemote({operation:"canvas.mcp.open"});
    await service.executeRemote({operation:"canvas.mcp.frame",channelId,frame:JSON.stringify({type:"hello",canvasId:"canvas",title:"Canvas"})});
    assert.equal(service.status().lan, undefined);
    assert.equal(service.status().config, null);
    assert.equal(service.status().http.enabled, false);
    const server = http.createServer((req,res) => { void service.handleHttp(req,res); });
    const address = await listen(server);
    try {
      const result = await requestJson(address.port,"/api/mcp/configure",{body:{client:"codex"}});
      assert.equal(result.status,503);
      assert.equal(result.value.error.code,"http_unavailable");
    } finally {await closeServer(server);}
  } finally {await service.close();}
});

test("open accepts absent storage locators and caches successful creation receipts without weakening locator validation", async () => {
  const service = createMcpService({server:http.createServer(),authorizeBrowser:() => "Forbidden",stateDirectory:tempDirectory()});
  const execute = service.executeRemote;
  try {
    const {channelId} = await execute({operation:"canvas.mcp.open"});
    await execute({operation:"canvas.mcp.frame",channelId,frame:JSON.stringify({type:"hello",canvasId:"locator-canvas",title:"Canvas"})});
    await execute({operation:"canvas.mcp.pull",channelId});
    const owner = crypto.randomUUID();
    let sequence = 0;
    for (const locator of [null,undefined,{location:"device",id:"saved"},false,[],{}, {location:"unknown",id:"saved"}, {location:"device",id:""}]) {
      const args = {instanceId:service.instanceId,canvasId:"locator-canvas",create:true,show:false,title:"Unsaved",requestId:`locator-${++sequence}`};
      const pending = service.callTool(owner,"penecho_open_canvas",args);
      const valid = locator == null || locator.location === "device" && locator.id === "saved";
      const checked = valid ? pending : assert.rejects(pending,error=>["invalid_browser_result","invalid_browser_message"].includes(error.code));
      const pulled = await execute({operation:"canvas.mcp.pull",channelId});
      assert.equal(pulled.frames.length,1);
      const frame = JSON.parse(pulled.frames[0]);
      assert.equal(frame.name,"mcp_open_canvas");
      await execute({operation:"canvas.mcp.frame",channelId,frame:JSON.stringify({type:"result",requestId:frame.requestId,ok:true,result:{documentId:`document-${sequence}`,title:"Unsaved",active:false,locator}})});
      const result = await checked;
      if (valid) {
        assert.equal(result.documentId,`document-${sequence}`);
        assert.equal(result.active,false);
        assert.deepEqual(result.locator,locator == null ? undefined : locator);
        const replay = await service.callTool(owner,"penecho_open_canvas",args);
        assert.deepEqual(replay,{...result,reused:true});
      }
    }
  } finally { await service.close(); }
});

test("remote channels register canvases, route tools, replace and revoke pending calls", async () => {
  const service = createMcpService({server:http.createServer(),authorizeBrowser:() => "Forbidden",stateDirectory:tempDirectory()});
  const execute = service.executeRemote;
  const open = async () => {
    const {channelId} = await execute({operation:"canvas.mcp.open"});
    await execute({operation:"canvas.mcp.frame",channelId,frame:JSON.stringify({type:"hello",canvasId:"cloud-canvas",title:"Cloud"})});
    const ready = await execute({operation:"canvas.mcp.pull",channelId});
    assert.equal(JSON.parse(ready.frames[0]).type,"ready");
    await execute({operation:"canvas.mcp.frame",channelId,frame:JSON.stringify({type:"catalog",documents:[{documentId:"cloud-document",title:"Cloud document",active:true}]})});
    return channelId;
  };
  try {
    const channelId = await open(), owner = crypto.randomUUID();
    assert.deepEqual(service.listCanvases().map(({canvasId,documentId,title,active}) => ({canvasId,documentId,title,active})), [{canvasId:"cloud-canvas",documentId:"cloud-document",title:"Cloud document",active:true}]);
    const call = service.callTool(owner,"penecho_start_session",{instanceId:service.instanceId,canvasId:"cloud-canvas",documentId:"cloud-document",title:"Cloud work"});
    const pulled = await execute({operation:"canvas.mcp.pull",channelId}), frame = JSON.parse(pulled.frames[0]);
    assert.equal(frame.name,"mcp_start_session");
    await execute({operation:"canvas.mcp.frame",channelId,frame:JSON.stringify({type:"result",requestId:frame.requestId,ok:true,result:{sessionId:frame.arguments.sessionId,revision:1}})});
    const started = await call;
    const pending = service.callTool(owner,"penecho_inspect_session",{sessionId:started.sessionId});
    const rejected = assert.rejects(pending,{code:"canvas_disconnected"});
    const replacement = await open();
    await rejected;
    await assert.rejects(execute({operation:"canvas.mcp.pull",channelId}),{code:"mcp_remote_session"});
    await execute({operation:"canvas.mcp.close",channelId:replacement});
    assert.deepEqual(service.listCanvases(),[]);
  } finally { await service.close(); }
  await assert.rejects(execute({operation:"canvas.mcp.open"}),{code:"mcp_service_closed"});
});

 test("CLI rejects removed invitation flags before opening a stdio bridge", async () => {
  const {main} = require("../src/cli/main.js");
  for (const argument of ["--remote=https://192.168.1.2/mcp","--host-id","--fingerprint","--invitation"]) {
    let message = "";
    assert.equal(await main(["mcp",argument],{errorOutput:{write:value=>{message+=value;}}}),1);
    assert.match(message,/removed.*mcp connect/);
  }
});

test('slow progress retains only the latest coalesced update and cancelling a flush releases the caller', async t => {
  const service=createMcpService({server:new EventEmitter(),authorizeBrowser:()=>true,cloudRuntime:true});
  t.after(()=>service.close());
  const socket=new EventEmitter(),frames=[];
  Object.assign(socket,{readyState:1,ping(){},send(raw){
    const frame=JSON.parse(raw);frames.push(frame);
    if(frame.name==='mcp_start_session')queueMicrotask(()=>reply(frame,{sessionId:frame.arguments.sessionId,documentId:'doc',revision:0}));
  },close(){this.readyState=3;this.emit('close');},terminate(){this.close();}});
  const reply=(frame,result)=>socket.emit('message',Buffer.from(JSON.stringify({type:'result',requestId:frame.requestId,ok:true,result})));
  service.attachBrowser(socket);
  socket.emit('message',Buffer.from(JSON.stringify({type:'hello',canvasId:'canvas',title:'Canvas',documents:[{documentId:'doc',title:'Doc',active:true}]})));
  const owner=crypto.randomUUID(),call=(name,args,options={})=>service.callTool(owner,name,args,{direct:true,...options});
  const {sessionId}=await call('penecho_start_session',{title:'Test',canvasId:'canvas',documentId:'doc'});
  for(let i=1;i<=5;i++){await call('penecho_update_session',{sessionId,summary:`update ${i}`});await delay(110);}
  const updates=()=>frames.filter(frame=>frame.name==='mcp_update_session');
  assert.equal(updates().length,1);
  const controller=new AbortController();
  const closing=call('penecho_close_session',{sessionId},{signal:controller.signal});
  controller.abort();
  await assert.rejects(closing,error=>error.code==='request_cancelled');
  assert.equal(frames.filter(frame=>frame.name==='mcp_close_session').length,0);
  reply(updates()[0],{revision:1,applied:true});await delay(5);
  assert.deepEqual(updates().map(frame=>frame.arguments.summary),['update 1','update 5']);
  for(const frame of updates()){assert.ok(frame.timeoutMs>0&&frame.timeoutMs<=45000);assert.ok(frame.expiresAt<=Date.now()+45000);}
  reply(updates()[1],{revision:2,applied:true});await delay(5);
  assert.equal(updates().length,2);
});


test("1.3.1 browsers without catalog remain discoverable and retain legacy find response",async t=>{
  const server=http.createServer(),service=createMcpService({server,authorizeBrowser:()=>null}),calls=[];
  const address=await listen(server),{ws}=await openCanvas(address.port,calls);
  t.after(async()=>{ws.terminate();await service.close();if(server.listening)await closeServer(server);});
  const owner=crypto.randomUUID(),listed=await service.callTool(owner,"penecho_list_canvases",{});
  assert.equal(listed.canvases.length,1);assert.equal(service.listCanvases().length,1);
  assert.equal(listed.canvases[0].canvasId,"canvas-a");assert.equal(listed.canvases[0].title,"Research board");
  assert.equal(Object.hasOwn(listed.canvases[0],"documentId"),false,"do not invent a document ID for a legacy connection");
  ws.removeAllListeners("message");
  ws.on("message",raw=>{
    const message=JSON.parse(raw);if(message.type!=="call")return;calls.push(message);
    assert.equal(message.name,"mcp_find_canvases");assert.equal(message.arguments.documentId,"legacy-doc");
    ws.send(JSON.stringify({type:"result",requestId:message.requestId,ok:true,result:{canvases:[{documentId:"legacy-doc",title:"Old document",open:true,active:true}],providers:[{location:"device",status:"ok"}]}}));
  });
  const found=await service.callTool(owner,"penecho_find_canvases",{instanceId:service.instanceId,canvasId:"canvas-a",documentId:"legacy-doc"});
  assert.deepEqual(found.canvases,[{documentId:"legacy-doc",title:"Old document",open:true,active:true}]);
  assert.deepEqual(found.providers,[{location:"device",status:"ok"}]);assert.ok(found.timing);
  assert.equal(calls.length,1);
  await reportCanvasCatalog(ws,[]);
  assert.deepEqual((await service.callTool(owner,"penecho_list_canvases",{})).canvases,[]);
  const empty=await service.callTool(owner,"penecho_find_canvases",{instanceId:service.instanceId,canvasId:"canvas-a"});
  assert.deepEqual(empty.canvases,[]);assert.equal(calls.length,1,"after catalog negotiation an empty directory must not fall back to browser RPC");
});


test("rename routes exact documents with owner and operation scoped receipts, strict responses and cancellation", async t => {
  // Remote fixture channels have no native socket handle; retain Node 22 through the deadline assertion.
  const keepAlive = setTimeout(() => {}, 10_000); t.after(() => clearTimeout(keepAlive));
  const service = createMcpService({server:http.createServer(),authorizeBrowser:() => "Forbidden",stateDirectory:tempDirectory()});
  const execute = service.executeRemote;
  const owner = crypto.randomUUID(), otherOwner = crypto.randomUUID();
  let channelId;
  const frame = value => execute({operation:"canvas.mcp.frame",channelId,frame:JSON.stringify(value)});
  const pull = async () => (await execute({operation:"canvas.mcp.pull",channelId})).frames.map(value=>JSON.parse(value));
  const args = {instanceId:service.instanceId,canvasId:"rename-canvas",documentId:"doc",title:"Renamed",requestId:"same-id"};
  const receipt = {documentId:"doc",title:"Renamed",active:false,applied:true,saved:false};
  const reply = (call,result) => frame({type:"result",requestId:call.requestId,ok:true,result});
  try {
    ({channelId} = await execute({operation:"canvas.mcp.open"}));
    await frame({type:"hello",canvasId:"rename-canvas",title:"Canvas",documentRename:true,documents:[{documentId:"doc",title:"Original",active:true}]});
    await pull();
    for (const [override,code] of [[{instanceId:"wrong"},"instance_mismatch"],[{canvasId:"missing"},"canvas_not_found"],[{documentId:"missing"},"document_not_found"]]) await assert.rejects(service.callTool(owner,"penecho_rename_canvas",{...args,...override}),error=>error.code===code);
    await frame({type:"ping"});
    assert.deepEqual(await pull(),[{type:"pong"}]);
    const pending = service.callTool(owner,"penecho_rename_canvas",{...args,title:"  Renamed  "});
    const [call] = await pull();
    assert.equal(call.name,"mcp_rename_canvas");
    assert.deepEqual(call.arguments,{...args,requestId:call.arguments.requestId});
    assert.notEqual(call.arguments.requestId,args.requestId);
    assert.ok(call.expiresAt > 0);
    await reply(call,receipt);
    const result = await pending;
    assert.deepEqual({...result,timing:undefined},{...receipt,timing:undefined});
    assert.equal((await service.callTool(owner,"penecho_rename_canvas",args)).reused,true);
    await assert.rejects(service.callTool(owner,"penecho_rename_canvas",{...args,title:"Different"}),error=>error.code === "REQUEST_ID_CONFLICT");
    await frame({type:"ping"});
    assert.deepEqual(await pull(),[{type:"pong"}]);
    const otherPending = service.callTool(otherOwner,"penecho_rename_canvas",args), [otherCall] = await pull();
    assert.notEqual(otherCall.arguments.requestId,call.arguments.requestId);
    await reply(otherCall,{...receipt,saved:true});
    assert.equal((await otherPending).saved,true);
    const openPending = service.callTool(owner,"penecho_open_canvas",{instanceId:service.instanceId,canvasId:args.canvasId,documentId:"doc",requestId:args.requestId});
    const [openCall] = await pull();
    assert.equal(openCall.name,"mcp_open_canvas");
    assert.equal(openCall.arguments.requestId,crypto.createHash("sha256").update(`${owner}\0${args.requestId}`).digest("hex"));
    assert.notEqual(openCall.arguments.requestId,call.arguments.requestId);
    await reply(openCall,{documentId:"doc",title:"Original",active:true});await openPending;
    let index=0;
    for (const bad of [{documentId:"missing"},{title:"Wrong"},{active:1},{applied:false},{saved:"yes"}]) {
      const pendingBad = service.callTool(owner,"penecho_rename_canvas",{...args,requestId:`bad-${++index}`});
      const rejected = assert.rejects(pendingBad,error=>error.code === "invalid_browser_result");
      const [badCall] = await pull();await reply(badCall,{...receipt,...bad});await rejected;
    }
    const catalog = await service.callTool(owner,"penecho_list_canvases",{});
    assert.equal(catalog.canvases.length,1);
    assert.equal(catalog.canvases[0].documentId,"doc");
    assert.equal(catalog.canvases[0].title,"Original");
    for (const mode of ["timeout","abort"]) {
      const controller = new AbortController();
      const pendingCancel = service.callTool(owner,"penecho_rename_canvas",{...args,requestId:mode},{timeoutMs:mode === "timeout" ? 10 : 1000,signal:controller.signal});
      const rejected = assert.rejects(pendingCancel,error=>error.code === (mode === "timeout" ? "canvas_timeout" : "request_cancelled"));
      const [cancelCall] = await pull();
      if (mode === "abort") controller.abort();
      await rejected;
      assert.deepEqual(await pull(),[{type:"cancel",requestId:cancelCall.requestId}]);
      await reply(cancelCall,receipt); // Late results cannot revive completed calls.
      const retry = service.callTool(owner,"penecho_rename_canvas",{...args,requestId:mode});
      const [retryCall] = await pull();
      assert.equal(retryCall.arguments.requestId,cancelCall.arguments.requestId);
      assert.notEqual(retryCall.requestId,cancelCall.requestId);
      await reply(retryCall,receipt);
      assert.equal((await retry).applied,true);
    }
  } finally {await service.close();}
});

test("legacy browser rename fails with an actionable unsupported error without dispatch", async () => {
  const service = createMcpService({server:http.createServer(),authorizeBrowser:() => "Forbidden",stateDirectory:tempDirectory()});
  try {
    const {channelId} = await service.executeRemote({operation:"canvas.mcp.open"});
    await service.executeRemote({operation:"canvas.mcp.frame",channelId,frame:JSON.stringify({type:"hello",canvasId:"legacy",title:"Canvas"})});
    await service.executeRemote({operation:"canvas.mcp.pull",channelId});
    await assert.rejects(service.callTool(crypto.randomUUID(),"penecho_rename_canvas",{instanceId:service.instanceId,canvasId:"legacy",documentId:"doc",title:"Title",requestId:"r"}),error=>error.code === "unsupported_operation" && /Update PenEcho.*refresh/.test(error.message));
    await service.executeRemote({operation:"canvas.mcp.frame",channelId,frame:JSON.stringify({type:"ping"})});
    assert.deepEqual((await service.executeRemote({operation:"canvas.mcp.pull",channelId})).frames.map(JSON.parse),[{type:"pong"}]);
  } finally {await service.close();}
});


test("settled failed rename receipts are evictable while live requests remain protected", async () => {
  const service = createMcpService({server:http.createServer(),authorizeBrowser:() => "Forbidden",stateDirectory:tempDirectory()});
  const owner = crypto.randomUUID();
  try {
    const {channelId} = await service.executeRemote({operation:"canvas.mcp.open"});
    const frame = value => service.executeRemote({operation:"canvas.mcp.frame",channelId,frame:JSON.stringify(value)});
    const pull = async () => (await service.executeRemote({operation:"canvas.mcp.pull",channelId})).frames.map(JSON.parse);
    await frame({type:"hello",canvasId:"capacity",title:"Canvas",documentRename:true,documents:[{documentId:"doc",title:"Original",active:true}]});await pull();
    const args = {instanceId:service.instanceId,canvasId:"capacity",documentId:"doc",title:"Renamed",requestId:"r"};
    for (let index=0;index<40;index++) {
      const failed = service.callTool(owner,"penecho_rename_canvas",{...args,requestId:`failed-${index}`});
      const rejected = assert.rejects(failed,error=>error.code === "rename_failed");
      const [call] = await pull();
      await frame({type:"result",requestId:call.requestId,ok:false,error:{code:"rename_failed",message:"Storage unavailable"}});await rejected;
    }
    await assert.rejects(service.callTool(owner,"penecho_rename_canvas",{...args,requestId:"failed-39",title:"Different"}),error=>error.code === "REQUEST_ID_CONFLICT");
    const live=[];
    for(let index=0;index<32;index++) {
      const promise=service.callTool(owner,"penecho_rename_canvas",{...args,requestId:`live-${index}`});
      // Attach rejection handling before future frame/close operations.
      promise.catch(()=>{});
      const [call]=await pull();live.push({promise,call});
    }
    await assert.rejects(service.callTool(owner,"penecho_rename_canvas",{...args,requestId:"overflow"}),error=>error.code === "request_limit");
    for(const {promise,call} of live) {
      await frame({type:"result",requestId:call.requestId,ok:true,result:{documentId:"doc",title:"Renamed",active:true,applied:true,saved:false}});
      assert.equal((await promise).applied,true);
    }
    const recovered=service.callTool(owner,"penecho_rename_canvas",{...args,requestId:"recovered"});const [call]=await pull();
    await frame({type:"result",requestId:call.requestId,ok:true,result:{documentId:"doc",title:"Renamed",active:true,applied:true,saved:false}});
    assert.equal((await recovered).applied,true);
  } finally {await service.close();}
});
