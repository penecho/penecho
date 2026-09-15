"use strict";

const { BOUND_CANVAS_TOOL_NAMES, executeBoundCanvasTool, MAX_CAPTURE_BYTES, MAX_MUTATION_REQUESTS, safeString, safeJsonValue, browserSessionProgress, mutationSignature, browserRevision, browserCursor, browserObject } = require("./bound-operations.js");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { createRemoteMcpChannels } = require("./remote.js");
const net = require("node:net");
const { isPrivateAddress, lanAddresses } = require("./network-addresses.js");
const path = require("node:path");
const { WebSocket, WebSocketServer } = require("ws");
const { GUIDANCE_VERSION } = require("./guidance.js");
const { createMcpRequestTracer } = require("./request-trace.js");
const { MAX_EVENTS_PER_UPDATE, McpBridgeError, validateToolArguments } = require("./schema.js");

const MAX_HTTP_BODY_BYTES = 3 * 1024 * 1024;
const MAX_WS_FRAME_BYTES = 12 * 1024 * 1024;

const MAX_CANVASES = 64;
const MAX_SESSIONS = 64;
const MAX_OWNER_SESSIONS = 16;
const MAX_DIRECT_SESSIONS = 256 * MAX_OWNER_SESSIONS;
const MAX_PENDING_CALLS = 128;
const CALL_TIMEOUT_MS = 45_000;
const HELLO_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
const UPDATE_DELAY_MS = 100;
const LOST_SESSION_TTL_MS = 60_000;
const MAX_PENDING_UPDATE_TRACES = 16;

function bridgeError(code, message, status = 400) {
  return new McpBridgeError(code, message, status);
}

function normalizedAddress(address) {
  const value = String(address || "").trim().toLowerCase().split("%", 1)[0];
  if (value.startsWith("::ffff:") && net.isIP(value.slice(7)) === 4) return value.slice(7);
  return value;
}

function isLoopback(address) {
  const value = normalizedAddress(address);
  return value === "::1" || value === "127.0.0.1" || value.startsWith("127.");
}

function sendJson(res, status, value) {
  const data = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    "content-type":"application/json; charset=utf-8",
    "content-length":data.length,
    "cache-control":"no-store",
    "x-content-type-options":"nosniff",
  });
  res.end(data);
}

function readJson(req, maximum = MAX_HTTP_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0, settled = false;
    const chunks = [];
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maximum) {
        fail(bridgeError("request_too_large", "Request body is too large.", 413));
        req.resume();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
        resolve(parsed);
      } catch { reject(bridgeError("invalid_json", "Request body must be valid JSON.", 400)); }
    });
    req.on("error", fail);
  });
}

function authorizationMatches(header, secret) {
  const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(String(header || ""));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function serializeError(error) {
  return { code:String(error?.code || "mcp_bridge_error").slice(0, 80), message:String(error?.message || "PenEcho MCP request failed.").slice(0, 1_000), ...(error?.details === undefined ? {} : {details:error.details}) };
}

// The persisted workspace retains up to 40 events (more than one update).
// Validate this response independently of the smaller per-update input limit.

function safeErrorDetails(value) {
  if (value === undefined) return undefined;
  try {
    const json = JSON.stringify(value);
    if (!json || Buffer.byteLength(json, "utf8") > 64 * 1024) return undefined;
    return JSON.parse(json);
  } catch { return undefined; }
}

function canvasCatalog(value) {
  if (!Array.isArray(value) || value.length > MAX_CANVASES) throw bridgeError("invalid_canvas_catalog", `Canvas catalog must contain at most ${MAX_CANVASES} documents.`);
  const documents = [], ids = new Set();
  let active = false;
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw bridgeError("invalid_canvas_catalog", "Canvas catalog entries must be objects.");
    for (const key of Object.keys(entry)) if (!["documentId","title","active"].includes(key)) throw bridgeError("invalid_canvas_catalog", `Canvas catalog contains an unsupported field: ${key}.`);
    const documentId = safeString(entry.documentId, 256, "documentId"), title = safeString(entry.title, 200, "title");
    if (typeof entry.active !== "boolean" || ids.has(documentId) || entry.active && active) throw bridgeError("invalid_canvas_catalog", "Canvas catalog identities or active state are invalid.");
    ids.add(documentId);active ||= entry.active;documents.push({documentId,title,active:entry.active});
  }
  return documents;
}

function publicCanvasDocuments(connection, instanceId) {
  // 1.3.1 advertises a browser, without the newer document catalog. Missing
  // capability is different from an explicit, authoritative empty catalog.
  if(connection.documents===null)return [{canvasId:connection.canvasId,instanceId,title:connection.title,connectedAt:connection.connectedAt}];
  return connection.documents.map(document => ({canvasId:connection.canvasId,instanceId,documentId:document.documentId,title:document.title,active:document.active,connectedAt:connection.connectedAt}));
}

function createMcpService(options) {
  if (!options?.server || typeof options.server.on !== "function") throw new TypeError("createMcpService requires an HTTP server.");
  if (typeof options.authorizeBrowser !== "function") throw new TypeError("createMcpService requires authorizeBrowser(req).");
  if (options.isLocalBrowserAddress !== undefined && typeof options.isLocalBrowserAddress !== "function") throw new TypeError("isLocalBrowserAddress must be a function.");
  if (options.inspectConfiguredClients !== undefined && typeof options.inspectConfiguredClients !== "function") throw new TypeError("inspectConfiguredClients must be a function.");
  const heartbeatIntervalMs = options.heartbeatIntervalMs === undefined ? HEARTBEAT_INTERVAL_MS : options.heartbeatIntervalMs;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs === undefined ? HEARTBEAT_TIMEOUT_MS : options.heartbeatTimeoutMs;
  const bindingTimeoutMs = options.bindingTimeoutMs === undefined ? 10_000 : options.bindingTimeoutMs;
  if (typeof heartbeatIntervalMs !== "number" || !Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) throw new TypeError("heartbeatIntervalMs must be positive.");
  if (typeof heartbeatTimeoutMs !== "number" || !Number.isFinite(heartbeatTimeoutMs) || heartbeatTimeoutMs <= 0 || heartbeatTimeoutMs < heartbeatIntervalMs) throw new TypeError("heartbeatTimeoutMs must be positive and at least heartbeatIntervalMs.");
  if (typeof bindingTimeoutMs !== "number" || !Number.isFinite(bindingTimeoutMs) || bindingTimeoutMs <= 0) throw new TypeError("bindingTimeoutMs must be positive.");
  const server = options.server, authorizeBrowser = options.authorizeBrowser, rootDirectory = path.resolve(options.rootDirectory || process.cwd());
  const isLocalBrowserAddress = options.isLocalBrowserAddress;
  const localModules = options.cloudRuntime ? {} : { ...require("./records.js"), ...require("./configure.js"), ...require("./discovery-client.js"), ...require("./discovery-client-bundle.js"), ...require("./session-client-bundle.js") };
  const {registryStateDirectory,recordsDirectory,removeRecord,writeRecord,configureClient,importCredentials,discoveryClientBundle,sessionClientBundle}=localModules;
  const inspectConfiguredClients = options.inspectConfiguredClients || localModules.inspectConfiguredClients;
  const stateDirectory = options.stateDirectory ? path.resolve(options.stateDirectory) : undefined;
  const requestedRegistryDirectory = options.cloudRuntime ? rootDirectory : options.registryStateDirectory ? path.resolve(options.registryStateDirectory) : registryStateDirectory();
  if (!options.cloudRuntime) fs.mkdirSync(requestedRegistryDirectory,{recursive:true,mode:0o700});
  const registryDirectory = options.cloudRuntime ? requestedRegistryDirectory : fs.realpathSync(requestedRegistryDirectory);
  const directory = options.cloudRuntime ? null : recordsDirectory(registryDirectory), instanceId = crypto.randomUUID(), secret = crypto.randomBytes(32).toString("hex");
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const requestTracer = options.requestTraceEnabled === true ? createMcpRequestTracer({
    requestTraceDirectory:options.requestTraceDirectory,
    requestTraceLimit:options.requestTraceLimit,
    logger,
  }) : null;
  const stdioPath = path.resolve(__dirname, "stdio.js");
  const defaultLaunch = {
    command:process.execPath,
    args:[stdioPath, "--state-directory", registryDirectory],
    ...((process.versions.electron || /electron(?:\.exe)?$/i.test(path.basename(process.execPath))) ? { env:{ ELECTRON_RUN_AS_NODE:"1" } } : {}),
  };
  const launchValue = typeof options.launch === "function" ? options.launch({ instanceId, stdioPath, stateDirectory:registryDirectory }) : options.launch;
  const launch = launchValue && typeof launchValue.command === "string" && Array.isArray(launchValue.args)
    ? { command:launchValue.command, args:launchValue.args.map(String), ...(launchValue.env && typeof launchValue.env === "object" ? { env:Object.fromEntries(Object.entries(launchValue.env).map(([key, value]) => [String(key), String(value)])) } : {}) }
    : defaultLaunch;
  const wss = new WebSocketServer({ noServer:true, maxPayload:MAX_WS_FRAME_BYTES, perMessageDeflate:false });
  const canvases = new Map(), connections = new Set(), sessions = new Map(), sessionKeys = new Map(), bindingOperations = new Map(), retiredSessions = new Map(), pendingBusinessStarts = new Map();
  let record = null, closed = false, registrationSequence = 0;
  const businessNow = options.businessNow || Date.now;
  const businessOwnerLimit = options.businessOwnerLimit || MAX_OWNER_SESSIONS;
  const businessSessionLimit = options.businessSessionLimit || MAX_DIRECT_SESSIONS;
  const bindings = options.bindings || require("./conversation-bindings.js").conversationBindings(path.join(registryDirectory,"mcp","conversations"));
  function bindingCall(operation, signal, timeoutMs = bindingTimeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => finish(bridgeError("binding_timeout", "The MCP conversation binding store did not respond in time.", 504)), timeoutMs);
      timer.unref?.();
      const abort = () => finish(bridgeError("request_cancelled", "The MCP request was cancelled.", 499));
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, {once:true});
      Promise.resolve().then(operation).then(value => finish(null, value), finish);
    });
  }
  function disposeOwner(ownerId) {
    for (const [id, session] of sessions) if (session.ownerId === ownerId) {
      clearTimeout(session.updateTimer);clearTimeout(session.lostTimer);
      for (const trace of session.pendingUpdateTraces) requestTracer?.queuedUpdateOutcome(trace,"failed",{applied:false,error:"MCP connection closed."});
      session.lost = true; session.pendingUpdate = null; session.pendingUpdateTraces = []; session.updateController?.abort();
      notifySessionDisposed(session);
      sessions.delete(id);
      if(session.sessionKey)sessionKeys.delete(session.bindingKey || `${ownerId}\0${session.sessionKey}`);
    }
  }
  function notifySessionDisposed(session) {
    if (session.direct && !session.connection.closed && session.connection.ws.readyState === WebSocket.OPEN) {
      try { session.connection.ws.send(JSON.stringify({type:"dispose-session",sessionId:session.id})); } catch {}
    }
  }
  function retireBusinessSession(session) {
    notifySessionDisposed(session);
    retiredSessions.set(session.id,{ownerId:session.ownerId,at:businessNow(),sessionKey:session.sessionKey,documentId:session.documentId});
    while (retiredSessions.size > businessSessionLimit) retiredSessions.delete(retiredSessions.keys().next().value);
    clearTimeout(session.updateTimer); clearTimeout(session.lostTimer);
    sessions.delete(session.id);
    if (session.sessionKey) sessionKeys.delete(session.bindingKey);
  }
  function pruneBusinessSessions(ownerId, pressure = false) {
    for (const [id,entry] of retiredSessions) if (businessNow()-entry.at >= 1800000) retiredSessions.delete(id);
    const candidates = [...sessions.values()].filter(s => s.direct && (!ownerId || s.ownerId === ownerId) && !s.activeCalls && !s.updateWork && !s.pendingUpdate && !s.updateTimer && businessNow() - s.lastUsed >= (pressure ? 60000 : 1800000)).sort((a,b) => a.lastUsed-b.lastUsed);
    for (const session of pressure ? candidates.slice(0,1) : candidates) retireBusinessSession(session);
  }
  function validateRestoredDocument(result,args) {
    const documentId = safeString(result.documentId,256,"documentId");
    if (args.documentId && documentId !== args.documentId) {
      const recovery = result.recovery;
      if (!(args.restore !== false && recovery?.restored === false && recovery?.created === true && recovery?.previousDocumentId === args.documentId && recovery?.reason === "DOCUMENT_NOT_FOUND")) throw bridgeError("session_document_conflict","The browser did not restore the conversation's original document.",409);
    }
    return documentId;
  }
  function notifyConnections() {
    for(const connection of connections)if(connection.canCopyLanSetup&&!connection.closed&&connection.ws.readyState===WebSocket.OPEN) {
      try{connection.ws.send(JSON.stringify({type:"lan-status-changed"}));}catch{}
    }
  }
  const direct = options.cloudRuntime ? {status:()=>({enabled:false}),close:async()=>{}} : require("./direct-http-service.js").createDirectHttpService({
    stateDirectory:path.join(registryDirectory,"mcp","server"),
    callTool:(ownerId,name,args,callOptions)=>callTool(ownerId,name,args,{...callOptions,direct:true}),
    uploadImage:uploadRawImage,
    disposeOwner,onChange:notifyConnections,
    ...(options.lanAddresses?{getAddresses:options.lanAddresses}:{}),
    ...(options.directAnnounce?{announce:options.directAnnounce}:{}),
  });
  // Raw uploads use the same authenticated host connection, without creating an
  // AI conversation. Both connection and persistent document must still match.
  async function uploadRawImage(args, callOptions = {}) {
    const connection = canvases.get(args.canvasId);
    if (!connection || connection.closed) throw bridgeError("canvas_not_found", "The selected Canvas is not connected or has not opted in.", 404);
    const {result} = await canvasCall(connection, "mcp_upload_image_to_document", {
      documentId:args.documentId, requestId:args.requestId, name:args.name,
      source:args.source, inputSha256:args.inputSha256, originalName:args.originalName,
    }, callOptions);
    browserObject(result,"image upload result");
    if (canvases.get(args.canvasId) !== connection || connection.closed) throw bridgeError("canvas_disconnected", "The upload connection changed. Retry the same request against the original document.",409);
    const assetId = crypto.createHash("sha256").update(Buffer.from(args.source.slice(args.source.indexOf(",")+1),"base64")).digest("hex");
    if (result.documentId !== args.documentId || result.source !== `penecho-asset:${assetId}` || result.assetId !== assetId) throw bridgeError("invalid_browser_result","The Canvas returned an image for a different document or content.",502);
    const mediaType = args.source.slice(5,args.source.indexOf(";")), bytes = Buffer.from(args.source.slice(args.source.indexOf(",")+1),"base64").length;
    if (result.mediaType !== mediaType || result.bytes !== bytes || !Number.isSafeInteger(result.width) || result.width < 1 || !Number.isSafeInteger(result.height) || result.height < 1) throw bridgeError("invalid_browser_result","The Canvas returned invalid image metadata.",502);
    return {canvasId:args.canvasId,documentId:args.documentId,requestId:args.requestId,inputSha256:args.inputSha256,
      source:result.source,assetId,name:safeString(result.name,200,"image name"),mediaType,bytes,width:result.width,height:result.height,revision:browserRevision(result.revision)};
  }
  let directStart = null;
  function startDirect() {
    if(closed)return Promise.resolve();
    if(!directStart)directStart=direct.start().then(value=>{
      importCredentials({...value,initialUrl:value.localUrl,addresses:[value.localUrl,...value.urls]},{stateDirectory:path.join(registryDirectory,"mcp")});
      const clientPath=path.join(registryDirectory,"mcp","client.js"),bytes=sessionClientBundle();
      let existing;try{if(fs.lstatSync(clientPath).isSymbolicLink())throw Error("MCP client path cannot be a symbolic link");existing=fs.readFileSync(clientPath);}catch(error){if(error.code!=="ENOENT")throw error;}
      if(!existing?.equals(bytes)){const temporary=clientPath+"."+crypto.randomUUID()+".tmp";try{fs.writeFileSync(temporary,bytes,{mode:0o600,flag:"wx"});fs.renameSync(temporary,clientPath);}finally{try{fs.unlinkSync(temporary);}catch{}}}
      return value;
    }).catch(error=>{directStart=null;log({type:"mcp-http-start-error",errorCode:String(error.code||"start_failed")});throw error;});
    return directStart;
  }

  function log(event) { try { logger(event); } catch {} }

  async function browserAuthorization(req) {
    try { return await authorizeBrowser(req); }
    catch { return "Forbidden"; }
  }

  function browserAddressAllowed(address) {
    const normalized = normalizedAddress(address);
    if (isLoopback(normalized)) return true;
    if (!isLocalBrowserAddress) return false;
    try { return isLocalBrowserAddress(normalized) === true; }
    catch { return false; }
  }

  function browserCanCopyLanSetup(address) {
    const normalized = normalizedAddress(address).split("%", 1)[0];
    return browserAddressAllowed(address) || isPrivateAddress(normalized)
      || net.isIP(normalized) === 6 && /^(?:f[cd]|fe[89ab])/i.test(normalized);
  }

  function localHostRequired() {
    return bridgeError("local_host_required", "Open this PenEcho canvas on the same computer to use the local MCP service.", 403);
  }

  function rejectUpgrade(socket, error = bridgeError("forbidden", "Forbidden", 403)) {
    if (socket.destroyed) return;
    const payload = Buffer.from(JSON.stringify({ error:serializeError(error) }));
    const status = error.status || 403;
    const reason = status === 503 ? "Service Unavailable" : "Forbidden";
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${payload.length}\r\n\r\n`);
    socket.write(payload);
    socket.destroy();
  }

  const upgrade = async (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, "http://localhost").pathname; } catch { return; }
    if (!["/api/mcp/canvas","/api/mcp/cloud-canvas"].includes(pathname)) return;
    if (closed) return rejectUpgrade(socket, bridgeError("service_closed", "The PenEcho MCP service is closed.", 503));
    if (await browserAuthorization(req)) return rejectUpgrade(socket);
    if(pathname==='/api/mcp/cloud-canvas') {
      if(!options.attachCloudBrowser)return rejectUpgrade(socket);
      return wss.handleUpgrade(req,socket,head,ws=>{try{options.attachCloudBrowser(ws,req);}catch{ws.close(4401,'Enable Cloud MCP after signing in.');}});
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
  };
  if (!options.cloudRuntime) server.on("upgrade", upgrade);

  function rejectPending(connection, error) {
    for (const pending of connection.pending.values()) {
      clearTimeout(pending.timer);
      pending.cleanup?.();
      pending.reject(error);
    }
    connection.pending.clear();
  }

  function markDisconnected(connection) {
    if (connection.closed) return;
    connection.closed = true;
    clearTimeout(connection.helloTimer);
    connections.delete(connection);
    if (connection.canvasId && canvases.get(connection.canvasId) === connection) canvases.delete(connection.canvasId);
    rejectPending(connection, bridgeError("canvas_disconnected", "The selected PenEcho canvas disconnected.", 409));
    for (const session of sessions.values()) if (session.connection === connection) {
      clearTimeout(session.updateTimer);
      session.updateTimer = null;
      for (const trace of session.pendingUpdateTraces) requestTracer?.queuedUpdateOutcome(trace, "failed", { applied:false, error:"The selected PenEcho canvas disconnected." });
      session.pendingUpdateTraces = [];
      session.pendingUpdate = null;
      session.lost = true;
      session.render = { state:"error", applied:false, pixelVerified:false, error:"The selected PenEcho canvas disconnected.", at:Date.now() };
      session.lostTimer = setTimeout(() => {
        if (sessions.get(session.id) !== session || !session.lost) return;
        sessions.delete(session.id);
        if (session.sessionKey) sessionKeys.delete(session.bindingKey || `${session.ownerId}\0${session.sessionKey}`);
      }, LOST_SESSION_TTL_MS);
      session.lostTimer.unref?.();
    }
  }

  const heartbeatTimer = setInterval(() => {
    if (closed) return;
    pruneBusinessSessions();
    const now = Date.now();
    for (const connection of connections) {
      if (connection.closed || !connection.canvasId) continue;
      if (now - connection.lastPong >= heartbeatTimeoutMs) {
        connection.ws.terminate();
        continue;
      }
      if (connection.ws.readyState === WebSocket.OPEN) {
        try { connection.ws.ping(); }
        catch { connection.ws.terminate(); }
      }
    }
  }, heartbeatIntervalMs);
  heartbeatTimer.unref?.();

  wss.on("connection", (ws, req) => {
    if (connections.size >= MAX_CANVASES) return ws.close(1013, "Too many canvases");
    const connection = { ws, localHost:Boolean(req && browserAddressAllowed(req.socket.remoteAddress)), canCopyLanSetup:Boolean(req && browserCanCopyLanSetup(req.socket.remoteAddress)), canvasId:null, title:null, documents:null, connectedAt:Date.now(), lastPong:Date.now(), closed:false, pending:new Map(), openRequests:new Map(), helloTimer:null, nextSlot:0 };
    connections.add(connection);
    connection.helloTimer = setTimeout(() => ws.close(1008, "Canvas hello required"), HELLO_TIMEOUT_MS);
    connection.helloTimer.unref?.();
    ws.on("message", raw => {
      let message;
      try { message = JSON.parse(raw.toString("utf8")); } catch { return ws.close(1007, "Invalid JSON"); }
      if (!message || typeof message !== "object" || Array.isArray(message)) return ws.close(1008, "Invalid message");
      if (!connection.canvasId) {
        if (message.type !== "hello") return ws.close(1008, "Canvas hello required");
        try {
          connection.canvasId = safeString(message.canvasId, 128, "canvasId");
          connection.title = safeString(message.title, 200, "title");
          connection.documents = message.documents === undefined ? null : canvasCatalog(message.documents);
          connection.documentRename = message.documentRename === true;
        } catch { return ws.close(1008, "Invalid canvas hello"); }
        clearTimeout(connection.helloTimer);
        connection.connectedAt = Date.now(); connection.registrationSequence = ++registrationSequence;
        const previous = canvases.get(connection.canvasId);
        canvases.set(connection.canvasId, connection);
        if (previous && previous !== connection) { markDisconnected(previous); previous.ws.close(4001, "Canvas connection replaced"); }
        ws.send(JSON.stringify({ type:"ready", heartbeat:true, catalog:true, canvasId:connection.canvasId, instanceId }));
        return;
      }
      if (message.type === "ping") {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:"pong" }));
        return;
      }
      if (message.type === "catalog") {
        try { connection.documents = canvasCatalog(message.documents); }
        catch { return ws.close(1008, "Invalid canvas catalog"); }
        return;
      }
      if (message.type !== "result" || typeof message.requestId !== "string") return ws.close(1008, "Invalid result");
      const pending = connection.pending.get(message.requestId);
      if (!pending) return;
      connection.pending.delete(message.requestId);
      clearTimeout(pending.timer);
      pending.cleanup?.();
      if (message.ok === true) pending.resolve(message.result === undefined ? null : message.result);
      else {
        const browserCode = typeof message.error?.code === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(message.error.code) ? message.error.code : "canvas_call_failed";
        const error = bridgeError(browserCode, typeof message.error === "string" ? message.error.slice(0, 1_000) : String(message.error?.message || "The PenEcho canvas rejected the request.").slice(0, 1_000), browserCode === "SOURCE_CONFLICT" ? 409 : 502);
        const details = safeErrorDetails(message.error?.details);
        if (details !== undefined) error.details = details;
        pending.reject(error);
      }
    });
    ws.on("pong", () => { connection.lastPong = Date.now(); });
    ws.on("close", () => markDisconnected(connection));
    ws.on("error", error => log({ type:"mcp-canvas-socket-error", errorCode:String(error?.code || "socket_error").slice(0, 80) }));
  });

  function canvasCall(connection, name, argumentsValue, optionsValue = {}) {
    const requestId = crypto.randomUUID(), requestedAt = Date.now();
    const timeoutMs = Math.max(1, Math.min(optionsValue.timeoutMs || CALL_TIMEOUT_MS, (optionsValue.expiresAt || requestedAt + CALL_TIMEOUT_MS) - requestedAt));
    const expiresAt = requestedAt + timeoutMs;
    const traces = requestTracer ? (Array.isArray(optionsValue.requestTraces) ? optionsValue.requestTraces : optionsValue.requestTrace ? [optionsValue.requestTrace] : []) : [];
    const interactions = traces.map(trace => requestTracer.browserStarted(trace, { requestId, name, arguments:argumentsValue, requestedAt }));
    const failed = error => {
      for (let index = 0; index < traces.length; index++) requestTracer.browserFailed(traces[index], interactions[index], error);
      return Promise.reject(error);
    };
    if (!connection || connection.closed || connection.ws.readyState !== WebSocket.OPEN) return failed(bridgeError("canvas_disconnected", "The selected PenEcho canvas is unavailable.", 409));
    if (connection.pending.size >= MAX_PENDING_CALLS) return failed(bridgeError("canvas_busy", "The selected PenEcho canvas has too many pending requests.", 429));
    return new Promise((resolve, reject) => {
      const finish = result => {
        const completedAt = Date.now();
        resolve({ result, timing:{ requestedAt, completedAt, durationMs:completedAt - requestedAt } });
      };
      const timer = setTimeout(() => {
        connection.pending.delete(requestId);
        cleanup();
        try { connection.ws.send(JSON.stringify({ type:"cancel", requestId })); } catch {}
        reject(bridgeError("canvas_timeout", "The PenEcho canvas did not respond in time.", 504));
      }, timeoutMs);
      timer.unref?.();
      const abort = () => {
        connection.pending.delete(requestId);
        clearTimeout(timer);
        try { connection.ws.send(JSON.stringify({ type:"cancel", requestId })); } catch {}
        reject(bridgeError("request_cancelled", "The MCP request was cancelled.", 499));
      };
      const cleanup = () => optionsValue.signal?.removeEventListener("abort", abort);
      if (optionsValue.signal?.aborted) return abort();
      optionsValue.signal?.addEventListener("abort", abort, { once:true });
      connection.pending.set(requestId, { resolve:finish, reject, timer, cleanup });
      try { connection.ws.send(JSON.stringify({ type:"call", requestId, name, arguments:argumentsValue, expiresAt, timeoutMs })); }
      catch (error) {
        connection.pending.delete(requestId);
        clearTimeout(timer);
        cleanup();
        reject(bridgeError("canvas_send_failed", String(error?.message || "Could not contact the PenEcho canvas."), 502));
      }
    }).then(value => {
      for (let index = 0; index < traces.length; index++) requestTracer.browserCompleted(traces[index], interactions[index], value);
      return value;
    }, error => {
      for (let index = 0; index < traces.length; index++) requestTracer.browserFailed(traces[index], interactions[index], error);
      throw error;
    });
  }

  function ownedSession(ownerId, sessionId) {
    const session = sessions.get(sessionId);
    if (!session && retiredSessions.get(sessionId)?.ownerId === ownerId) {
      const previous=retiredSessions.get(sessionId), error=bridgeError("session_expired","This idle conversation handle expired. Start the conversation again with its original sessionKey or documentId.",404);
      error.details={retry:"penecho_start_session",sessionKey:previous.sessionKey,documentId:previous.documentId}; throw error;
    }
    if (!session || session.ownerId !== ownerId) throw bridgeError("session_not_found", "This MCP connection does not own that PenEcho session.", 404);
    if (session.lost || session.connection.closed) throw bridgeError("canvas_disconnected", "The PenEcho canvas bound to this session disconnected. Start a new session after reconnecting.", 409);
    return session;
  }

  function dispatchUpdate(session) {
    clearTimeout(session.updateTimer);
    session.updateTimer = null;
    if (session.updateWork) return session.updateChain;
    const payload = session.pendingUpdate, renderSequence = session.pendingRenderSequence, queuedAt = session.pendingQueuedAt, requestTraces = session.pendingUpdateTraces;
    session.pendingUpdate = null;
    session.pendingUpdateTraces = [];
    if (!payload || session.lost) return session.updateChain;
    session.updateWork = (session.updateWork || 0) + 1;
    session.updateController = new AbortController();
    const task = session.updateChain.then(async () => {
      if (session.lost) throw bridgeError("session_closed", "The MCP session is no longer active.", 409);
      const { result, timing } = await canvasCall(session.connection, "mcp_update_session", { sessionId:session.id, ...payload }, { requestTraces, signal:session.updateController.signal });
      browserObject(result, "session update result");
      const revision = browserRevision(result.revision), applied = result.applied === true, visible = result.visible === true;
      if (session.renderSequence === renderSequence) session.render = { state:applied ? "applied" : "accepted", applied, visible, pixelVerified:false, queuedAt, ...timing, revision };
      for (const trace of requestTraces) requestTracer?.queuedUpdateOutcome(trace, applied ? "applied" : "accepted", { applied, visible, revision, timing });
    });
    session.updateChain = task.catch(error => {
      if (session.renderSequence === renderSequence) session.render = { state:"error", applied:false, pixelVerified:false, queuedAt, at:Date.now(), error:String(error?.message || "Progress application failed").slice(0, 500) };
      for (const trace of requestTraces) requestTracer?.queuedUpdateOutcome(trace, "failed", { applied:false, error });
    }).finally(() => {
      session.updateController = null; session.updateWork--; session.lastUsed = businessNow();
      if (session.pendingUpdate && !session.lost) dispatchUpdate(session);
    });
    return session.updateChain;
  }

  function enqueueUpdate(session, update, requestTrace) {
    const queuedAt = Date.now(), sequence = ++session.renderSequence;
    session.pendingRenderSequence = sequence;
    session.pendingQueuedAt = queuedAt;
    session.render = { state:"queued", applied:false, pixelVerified:false, queuedAt };
    session.pendingUpdate ||= {};
    for (const key of ["title", "status", "summary", "steps"]) if (update[key] !== undefined) session.pendingUpdate[key] = update[key];
    if (update.events) {
      const events = [...(session.pendingUpdate.events || []), ...update.events];
      session.pendingUpdate.events = events.slice(-MAX_EVENTS_PER_UPDATE);
    }
    if (requestTrace) {
      if (session.pendingUpdateTraces.length >= MAX_PENDING_UPDATE_TRACES) {
        const omitted = session.pendingUpdateTraces.shift();
        requestTracer?.queuedUpdateOutcome(omitted, "tracking-limited", { applied:false, queued:true });
      }
      session.pendingUpdateTraces.push(requestTrace);
    }
    if (!session.updateTimer) {
      session.updateTimer = setTimeout(() => { void dispatchUpdate(session); }, UPDATE_DELAY_MS);
      session.updateTimer.unref?.();
    }
  }

  async function flushUpdate(session, callOptions = {}) {
    while (session.pendingUpdate || session.updateWork) {
      if (!session.updateWork) dispatchUpdate(session);
      await bindingCall(() => session.updateChain, callOptions.signal, Math.max(1,(callOptions.expiresAt || Date.now()+CALL_TIMEOUT_MS)-Date.now()));
    }
  }

  function sessionSnapshot(session) {
    return {
      sessionId:session.id,
      canvasId:session.canvasId,
      ...(session.documentId === undefined ? {} : {documentId:session.documentId}),
      instanceId,
      slotIndex:session.slotIndex,
      title:session.title,
      status:session.status,
      summary:session.summary,
      steps:session.steps,
      events:session.events,
      ...(session.feedbackCursor === undefined ? {} : {feedbackCursor:session.feedbackCursor}),
      createdAt:session.createdAt,
      updatedAt:session.updatedAt,
      render:session.render,
    };
  }

  async function executeCallTool(ownerId, name, input, callOptions = {}) {
    if (typeof ownerId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId)) throw bridgeError("invalid_owner", "MCP owner id is invalid.");
    const args = validateToolArguments(name, input);
    if (name === "penecho_list_canvases") return { instanceId, canvases:[...canvases.values()].filter(item => item.canvasId && !item.closed).sort((a,b)=>b.registrationSequence-a.registrationSequence).flatMap(item => publicCanvasDocuments(item, instanceId)) };
    if (name === "penecho_open_canvas" || name === "penecho_find_canvases" || name === "penecho_rename_canvas") {
      if (args.instanceId !== instanceId) throw bridgeError("instance_mismatch", "The selected PenEcho instance is no longer active. List canvases again.", 409);
      const connection = canvases.get(args.canvasId);
      if (!connection || connection.closed) throw bridgeError("canvas_not_found", "The selected PenEcho canvas is not connected or has not opted in.", 404);
      if (name === "penecho_find_canvases") {
        if(connection.documents===null) {
          // Older browsers expose discovery as an RPC rather than catalog
          // pushes. Keep that contract behind the same cancellation/deadline.
          const {result,timing}=await canvasCall(connection,"mcp_find_canvases",args,callOptions);
          browserObject(result,"canvas candidates result");
          return {...safeJsonValue(result,"canvas candidates"),timing};
        }
        const requestedAt=Date.now();
        const candidates = connection.documents.filter(document => !args.documentId || document.documentId === args.documentId).map(document => ({...document,open:true}));
        const completedAt=Date.now();
        return {canvases:candidates,candidates,providers:[{location:"workspace",status:"ok"}],timing:{requestedAt,completedAt,durationMs:completedAt-requestedAt}};
      }
      if (name === "penecho_rename_canvas") {
        if (connection.documents !== null && !connection.documents.some(document => document.documentId === args.documentId)) throw bridgeError("document_not_found", "The selected document is not open. List canvases again and select an open document.", 404);
        if (!connection.documentRename) throw bridgeError("unsupported_operation", "This PenEcho browser does not support document rename. Update PenEcho and refresh the browser connection, then retry.", 409);
      }
      let openEntry, requestKey, browserArgs = args;
      if (name === "penecho_open_canvas" || name === "penecho_rename_canvas") {
        // Keep legacy open keys stable across server upgrades: the browser may
        // retain an open receipt. Only the additive rename operation is namespaced.
        requestKey = crypto.createHash("sha256").update(name === "penecho_open_canvas" ? `${ownerId}\0${args.requestId}` : `${ownerId}\0${name}\0${args.requestId}`).digest("hex");
        browserArgs = {...args,requestId:requestKey};
        const signature = mutationSignature(name === "penecho_open_canvas" ? args : {name,...args}), prior = connection.openRequests.get(requestKey);
        if (prior && prior.signature !== signature) throw bridgeError("REQUEST_ID_CONFLICT", "requestId was already used with different control mutation arguments. Use a new requestId.", 409);
        if (prior?.response) return {...prior.response,reused:true};
        if (!prior && connection.openRequests.size >= MAX_MUTATION_REQUESTS) {
          const completed = [...connection.openRequests].find(([, value]) => !value.inFlight && (value.response || value.settled));
          if (completed) connection.openRequests.delete(completed[0]);
          else throw bridgeError("request_limit", "Too many unresolved control mutation request IDs are retained for this connection.", 429);
        }
        openEntry = prior || {signature};
        connection.openRequests.set(requestKey, openEntry);
      }
      if (name === "penecho_rename_canvas") {
        openEntry.inFlight = (openEntry.inFlight || 0) + 1;
        openEntry.settled = false;
        try {
          const { result, timing } = await canvasCall(connection, "mcp_rename_canvas", browserArgs, callOptions);
          browserObject(result, "rename canvas result");
          if (result.documentId !== args.documentId || result.title !== args.title || typeof result.active !== "boolean" || result.applied !== true || typeof result.saved !== "boolean") throw bridgeError("invalid_browser_result", "The PenEcho canvas returned an invalid rename receipt.", 502);
          // Only browser catalog messages may add or refresh catalog documents.
          const response = {documentId:result.documentId,title:result.title,active:result.active,applied:true,saved:result.saved,timing};
          openEntry.response = response;
          return response;
        } finally {
          // Preserve recent failed signatures for conflicts while allowing bounded
          // eviction after every concurrent attempt using this key has settled.
          if (connection.openRequests.get(requestKey) === openEntry) {
            openEntry.inFlight -= 1;
            openEntry.settled = openEntry.inFlight === 0;
          }
        }
      }
      const { result, timing } = await canvasCall(connection, "mcp_open_canvas", browserArgs, callOptions);
      browserObject(result, "open canvas result");
      const documentId = safeString(result.documentId, 256, "documentId"), title = safeString(result.title, 200, "title");
      if (typeof result.active !== "boolean") throw bridgeError("invalid_browser_result", "The PenEcho canvas returned an invalid active state.", 502);
      let resultLocator;
      // Newly created, unsaved documents explicitly have no storage locator.
      if (result.locator !== undefined && result.locator !== null) {
        browserObject(result.locator, "document locator");
        if (!["device", "server", "cloud"].includes(result.locator.location)) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned an invalid document locator.", 502);
        resultLocator = {location:result.locator.location,id:safeString(result.locator.id, 512, "locator.id")};
      }
      const response = {documentId,title,active:result.active,...(resultLocator ? {locator:resultLocator} : {}),timing};
      openEntry.response = response;
      return response;
    }
    if (name === "penecho_start_session") {
      if (args.instanceId !== undefined && args.instanceId !== instanceId && !callOptions.direct) throw bridgeError("instance_mismatch", "The selected PenEcho instance is no longer active. List canvases again.", 409);
      if (callOptions.direct) pruneBusinessSessions();
      const bindingKey = callOptions.direct ? JSON.stringify([ownerId,args.client || "External AI",args.sessionKey]) : `${ownerId}\0${args.sessionKey}`;
      const current = args.sessionKey ? sessions.get(sessionKeys.get(bindingKey)) : null;
      const remembered = callOptions.direct && args.sessionKey ? await bindingCall(() => bindings.read(args.client,args.sessionKey), callOptions.signal) : null;
      const bound = current || remembered;
      if (callOptions.direct && bound) {
        if (args.canvasId !== undefined && args.canvasId !== bound.canvasId || args.documentId !== undefined && args.documentId !== bound.documentId) throw bridgeError("session_key_conflict", "That conversation is bound to another canvas document. Use its existing binding or a distinct sessionKey.",409);
        if (bound.documentId) { args.documentId = bound.documentId; delete args.target; }
      }
      const requestedCanvasId = bound?.canvasId || args.canvasId;
      let connection = canvases.get(requestedCanvasId);
      if ((!connection || connection.closed) && args.documentId && !args.canvasId) connection = [...canvases.values()].filter(item => !item.closed && item.documents?.some(document => document.documentId === args.documentId)).sort((a,b) => b.registrationSequence-a.registrationSequence)[0];
      if ((!connection || connection.closed) && callOptions.direct && !args.canvasId) connection = [...canvases.values()].filter(item => !item.closed).sort((a,b) => b.registrationSequence-a.registrationSequence)[0];
      if (!connection || connection.closed) throw bridgeError("canvas_not_found", "The selected PenEcho canvas is not connected or has not opted in.", 404);
      args.canvasId = connection.canvasId; args.instanceId = instanceId;
      if (args.sessionKey) {
        const existingId = sessionKeys.get(bindingKey), existing = sessions.get(existingId);
        if (existing) {
          if (existing.lost) {
            clearTimeout(existing.lostTimer);
            sessions.delete(existing.id);
            sessionKeys.delete(bindingKey);
          } else {
            if (existing.canvasId !== args.canvasId || existing.connection !== connection || args.documentId !== undefined && existing.documentId !== args.documentId) throw bridgeError("session_key_conflict", "That session key is already bound to another canvas document.", 409);
            if (callOptions.direct) {
              existing.activeCalls = (existing.activeCalls || 0) + 1;
              try {
                await flushUpdate(existing, callOptions);
                const {result,timing} = await canvasCall(connection,"mcp_start_session",{sessionId:existing.id,slotIndex:existing.slotIndex,title:existing.title,documentId:existing.documentId,sessionKey:args.sessionKey,...(args.client ? {client:args.client} : {}),...(args.restore === undefined ? {} : {restore:args.restore}),...(args.show === undefined ? {} : {show:args.show})},callOptions);
                browserObject(result,"session result");
                if (result.sessionId !== existing.id) throw bridgeError("invalid_browser_result","The browser returned a mismatched session.",502);
                const documentId = validateRestoredDocument(result,args);
                const revision = browserRevision(result.revision);
                await bindingCall(() => bindings.write({...existing,documentId,client:args.client}), callOptions.signal);
                existing.documentId = documentId;
                existing.render = {...existing.render,...timing,revision};
                return {...sessionSnapshot(existing),guidanceVersion:GUIDANCE_VERSION,reused:true,...(result.recovery ? {recovery:safeJsonValue(result.recovery,"recovery")} : {})};
              } finally { existing.activeCalls--; existing.lastUsed = businessNow(); }
            }
            if (args.target === "current") {
              const {result} = await canvasCall(connection, "mcp_start_session", {sessionId:existing.id, slotIndex:existing.slotIndex, title:existing.title, target:"current", ...(args.client ? {client:args.client} : {}), sessionKey:args.sessionKey}, callOptions);
              browserObject(result, "session result");
              if (result.sessionId !== existing.id || !existing.documentId || result.documentId !== existing.documentId) throw bridgeError("session_key_conflict", "That session key is bound to another Canvas. Use a distinct attachment sessionKey.", 409);
            }
            return { ...sessionSnapshot(existing), guidanceVersion:GUIDANCE_VERSION, reused:true };
          }
        }
      }
      if (callOptions.direct) {
        if ([...sessions.values()].filter(item => item.ownerId === ownerId).length >= businessOwnerLimit) pruneBusinessSessions(ownerId,true);
        if ([...sessions.values()].filter(item => item.direct).length >= businessSessionLimit) pruneBusinessSessions(null,true);
      }
      const pendingOwner = pendingBusinessStarts.get(ownerId) || 0;
      const pendingTotal = callOptions.direct ? [...pendingBusinessStarts.values()].reduce((sum,n) => sum+n,0) : 0;
      const sessionCount = [...sessions.values()].filter(item => Boolean(item.direct) === Boolean(callOptions.direct)).length + pendingTotal;
      if (sessionCount >= (callOptions.direct ? businessSessionLimit : MAX_SESSIONS) || [...sessions.values()].filter(item => item.ownerId === ownerId).length + pendingOwner >= (callOptions.direct ? businessOwnerLimit : MAX_OWNER_SESSIONS)) throw bridgeError("session_limit", "Too many active PenEcho conversations. Close an unused session or retry after it is idle.",429);
      if (callOptions.direct) pendingBusinessStarts.set(ownerId,pendingOwner+1);
      try {
      const sessionId = crypto.randomUUID(), slotIndex = connection.nextSlot++;
      const { result, timing } = await canvasCall(connection, "mcp_start_session", { sessionId, slotIndex, title:args.title, ...(args.target ? {target:args.target} : {}), ...(args.documentId ? {documentId:args.documentId} : {}), ...(args.restore === undefined ? {} : {restore:args.restore}), ...(args.show === undefined ? {} : {show:args.show}), ...(args.takeover === undefined ? {} : {takeover:args.takeover}), ...(args.client ? {client:args.client} : {}), ...(args.sessionKey ? {sessionKey:args.sessionKey} : {}) }, callOptions);
      browserObject(result, "session result");
      if (result.sessionId !== sessionId) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned a mismatched session.", 502);
      const boardObjectId = result.boardObjectId == null ? null : safeString(result.boardObjectId, 128, "boardObjectId"), revision = browserRevision(result.revision);
      const feedbackCursor = result.feedbackCursor === undefined ? undefined : browserCursor(result.feedbackCursor);
      const documentId = result.documentId === undefined && args.target !== "current" ? undefined : safeString(result.documentId, 256, "documentId");
      if (callOptions.direct) validateRestoredDocument(result,args);
      const progress = result.progress === undefined ? {} : browserSessionProgress(result.progress);
      const now = Date.now(), session = {
        id:sessionId, ownerId, connection, direct:!!callOptions.direct, lastUsed:businessNow(), activeCalls:0, updateWork:0, canvasId:args.canvasId, documentId, slotIndex, sessionKey:args.sessionKey, bindingKey,
        title:args.title, status:"working", summary:"", steps:[], events:[], ...progress, feedbackCursor, createdAt:now, updatedAt:now,
        render:{ state:"applied", applied:true, pixelVerified:false, ...timing, revision }, pendingUpdate:null, pendingUpdateTraces:[], pendingQueuedAt:0, pendingRenderSequence:0, renderSequence:0, updateChain:Promise.resolve(), updateTimer:null, lost:false, lostTimer:null, mutationRequests:new Map(),
      };
      sessions.set(sessionId, session);
      if (args.sessionKey) sessionKeys.set(bindingKey, sessionId);
      // Keep the browser-created session reachable if durable binding storage is
      // temporarily unavailable. A retry can reuse it and persist the binding
      // instead of creating an orphan browser session.
      if(callOptions.direct)await bindingCall(() => bindings.write({...session,client:args.client}), callOptions.signal);
      return { ...sessionSnapshot(session), boardObjectId, revision, ...(result.recovery?{recovery:safeJsonValue(result.recovery,"recovery")}:{}), guidanceVersion:GUIDANCE_VERSION };
      } finally { if (callOptions.direct) { const count=(pendingBusinessStarts.get(ownerId) || 1)-1; if (count) pendingBusinessStarts.set(ownerId,count); else pendingBusinessStarts.delete(ownerId); } }
    }
    const session = ownedSession(ownerId, args.sessionId);
    if (name === "penecho_update_session") {
      for (const key of ["title", "status", "summary", "steps"]) if (args[key] !== undefined) session[key] = args[key];
      if (args.events) session.events = [...session.events, ...args.events].slice(-500);
      session.updatedAt = Date.now();
      enqueueUpdate(session, args, callOptions.requestTrace);
      return { accepted:true, applied:false, pixelVerified:false, queuedAt:session.updatedAt, sessionId:session.id };
    }
    if (BOUND_CANVAS_TOOL_NAMES.includes(name)) return executeBoundCanvasTool({name,args:input,session,canvasCall,flushUpdate:target => flushUpdate(target,callOptions),sessionSnapshot,callOptions});
    if (name === "penecho_close_session") {
      await flushUpdate(session, callOptions);
      const { result, timing } = await canvasCall(session.connection, "mcp_close_session", args, callOptions);
      sessions.delete(session.id);
      if (session.sessionKey) sessionKeys.delete(session.bindingKey || `${ownerId}\0${session.sessionKey}`);
      return { sessionId:session.id, closed:true, revision:result?.revision, timing };
    }
    throw bridgeError("tool_not_found", "Unknown PenEcho MCP tool.", 404);
  }

  async function callTool(ownerId,name,input,callOptions = {}) {
    if (!callOptions.expiresAt) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const timer = setTimeout(abort, CALL_TIMEOUT_MS); timer.unref?.();
      callOptions.signal?.addEventListener("abort", abort, {once:true});
      if (callOptions.signal?.aborted) abort();
      try { return await callTool(ownerId,name,input,{...callOptions,signal:controller.signal,expiresAt:Date.now()+CALL_TIMEOUT_MS}); }
      finally {clearTimeout(timer);callOptions.signal?.removeEventListener("abort",abort);}
    }
    if (callOptions.signal?.aborted) throw bridgeError("request_cancelled","The MCP request was cancelled.",499);
    const tracked = sessions.get(input?.sessionId);
    const session = tracked?.ownerId === ownerId && tracked.direct ? tracked : null;
    if (session) session.activeCalls++;
    try {
      const result = await untrackedCallTool(ownerId,name,input,callOptions);
      if (name === "penecho_start_session" && result?.sessionId) {
        const http = direct.status();
        if (http.enabled && http.hostId) result.imageUpload = {
          hostId:http.hostId, canvasId:result.canvasId, documentId:result.documentId,
          clientPath:{windows:"%USERPROFILE%/.penecho/mcp/client.js",posix:"~/.penecho/mcp/client.js"},
          args:["--host-id",http.hostId,"--upload-image","ABSOLUTE_IMAGE_PATH","--canvas-id",result.canvasId,"--document-id",result.documentId,"--request-id","UNIQUE_UPLOAD_ID"],
          instructions:"Run the installed client.js on the agent computer with these arguments using its configured Node executable. Expand the fixed clientPath against the local user home. Replace only ABSOLUTE_IMAGE_PATH and UNIQUE_UPLOAD_ID. Use this returned hostId, never a Canvas/session ID. The client resolves the address/port and loads authentication automatically. Keep this document current/open. Reuse the returned source in Widget HTML/CSS or place_image."
        };
      }
      return result;
    }
    finally { if (session) { session.activeCalls--; session.lastUsed = businessNow(); } }
  }
  async function untrackedCallTool(ownerId, name, input, callOptions = {}) {
    if (callOptions.direct && !callOptions.bindingLocked && name === "penecho_start_session" && typeof input?.sessionKey === "string") {
      const key = JSON.stringify([input.client || "External AI",input.sessionKey]);
      const previous = bindingOperations.get(key) || Promise.resolve();
      const operation = previous.catch(() => {}).then(() => callTool(ownerId,name,input,{...callOptions,bindingLocked:true}));
      bindingOperations.set(key,operation);
      void operation.finally(() => { if (bindingOperations.get(key) === operation) bindingOperations.delete(key); }).catch(() => {});
      return bindingCall(() => operation, callOptions.signal);
    }
    if (!requestTracer) return executeCallTool(ownerId, name, input, callOptions);
    const requestTrace = requestTracer.begin({ ownerId, name, arguments:input });
    try {
      const result = await executeCallTool(ownerId, name, input, { ...callOptions, requestTrace });
      requestTracer.complete(requestTrace, result);
      return result;
    } catch (error) {
      requestTracer.fail(requestTrace, error);
      throw error;
    }
  }

  const remoteChannels = createRemoteMcpChannels({ attach:ws => wss.emit("connection", ws) });

  function statusPayload(canConfigureLocalClients = true, canCopyLanSetup = canConfigureLocalClients) {
    const http=direct.status();
    http.businessLimits={sessions:businessSessionLimit,sessionsPerOwner:businessOwnerLimit,idleMs:1800000,pressureIdleMs:60000};
    http.documentLimits={authority:"browser",openPerBrowser:64,serverEvictsDocuments:false};
    http.clientIdleMs=1800000;
    http.initialUrl=http.urls[0]||http.localUrl;
    if(canCopyLanSetup&&record&&http.enabled){
      const bytes=discoveryClientBundle(),address=(options.lanAddresses||lanAddresses)()[0] || (canConfigureLocalClients ? "127.0.0.1" : null);
      if(address)http.discoveryCliUrl=`http://${address}:${record.port}/api/mcp/discovery-client.js`;
      http.discoveryCliSha256=crypto.createHash("sha256").update(bytes).digest("hex");
      if(address)http.sessionCliUrl=`http://${address}:${record.port}/api/mcp/session-client.js`;
      http.sessionCliSha256=crypto.createHash("sha256").update(sessionClientBundle()).digest("hex");
    }
    return {
      enabled:Boolean(record),
      connectedCanvases:[...canvases.values()].filter(item => item.canvasId && !item.closed).length,
      instanceId,
      canConfigureLocalClients,
      canCopyLanSetup,
      ...(canCopyLanSetup ? {http} : {}),
      config:canConfigureLocalClients ? http.enabled?{type:"stdio",command:launch.command,args:[path.join(registryDirectory,"mcp","client.js"),"--host-id",http.hostId,"--state-directory",path.join(registryDirectory,"mcp")],...(launch.env?{env:launch.env}:{})}:null : null,
      instructions:http.enabled?"Use the small stdio CLI to connect directly over HTTPS. The CLI loads shared host credentials and discovers changed addresses. The CLI keeps stdin open; 30-minute idle releases HTTP only. The next call tries the known IP, shared cache, then discovery before restoring the original Canvas. The application starts MCP automatically; each browser opts in separately. A new conversation defaults to the latest registered browser, and a sessionKey/documentId restores its existing Canvas.":"The HTTP service is unavailable. Wait for the host service to become available before configuring a client.",
    };
  }

  async function handleHttp(req, res, suppliedUrl) {
    let url;
    try { url = suppliedUrl instanceof URL ? suppliedUrl : new URL(req.url, "http://localhost"); } catch { return false; }
    if (!["/api/mcp/status", "/api/mcp/configure", "/api/mcp/rpc", "/api/mcp/http", "/api/mcp/discovery-client.js", "/api/mcp/session-client.js"].includes(url.pathname)) return false;
    try {
      if (["/api/mcp/discovery-client.js","/api/mcp/session-client.js"].includes(url.pathname)) {
        if (req.method !== "GET") throw bridgeError("method_not_allowed", "Method Not Allowed", 405);
        const bytes = url.pathname.endsWith("/session-client.js")?sessionClientBundle():discoveryClientBundle();
        res.writeHead(200, {"content-type":"text/javascript; charset=utf-8", "content-length":bytes.length, "cache-control":"no-store", "x-content-type-options":"nosniff"});
        res.end(bytes); return true;
      }
      if (url.pathname === "/api/mcp/rpc") {
        if (req.method !== "POST") throw bridgeError("method_not_allowed", "Method Not Allowed", 405);
        if (!isLoopback(req.socket.remoteAddress) || req.headers.origin || !authorizationMatches(req.headers.authorization, secret)
          || req.headers["x-penecho-mcp-instance"] !== instanceId) throw bridgeError("forbidden", "Forbidden", 403);
        if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) throw bridgeError("unsupported_media_type", "Use application/json.", 415);
        const body = await readJson(req), ownerId = body?.ownerId;
        if (body?.operation === "list_canvases") return sendJson(res, 200, { result:await callTool(ownerId, "penecho_list_canvases", {}, { signal:requestSignal(req, res) }) }), true;
        if (body?.operation !== "call" || typeof body.name !== "string") throw bridgeError("invalid_operation", "MCP bridge operation is invalid.", 400);
        return sendJson(res, 200, { result:await callTool(ownerId, body.name, body.arguments, { signal:requestSignal(req, res) }) }), true;
      }
      if (!["GET", "POST"].includes(req.method) || ["/api/mcp/configure", "/api/mcp/http"].includes(url.pathname) && req.method !== "POST") throw bridgeError("method_not_allowed", "Method Not Allowed", 405);
      const canConfigureLocalClients = browserAddressAllowed(req.socket.remoteAddress);
      if (["/api/mcp/configure", "/api/mcp/http"].includes(url.pathname) && !canConfigureLocalClients) throw localHostRequired();
      if (await browserAuthorization(req)) throw bridgeError("forbidden", "Forbidden", 403);
      if(record&&options.autoStartHttp!==false&&url.pathname!=="/api/mcp/http")await startDirect();
      if (url.pathname === "/api/mcp/status") {
        // Only authenticated direct LAN requests receive pairing details. Remote
        // channels keep status(false) redacted and cannot infer this from headers.
        const canCopyLanSetup = canConfigureLocalClients || browserCanCopyLanSetup(req.socket.remoteAddress);
        const payload = statusPayload(canConfigureLocalClients, canCopyLanSetup);
        if (canConfigureLocalClients && url.searchParams.get("inspectClients") === "1") payload.configuredClients = await inspectConfiguredClients({ rootDirectory, stateDirectory });
        return sendJson(res, 200, payload), true;
      }
      if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) throw bridgeError("unsupported_media_type", "Use application/json.", 415);
      const body = await readJson(req, 4 * 1024);
      if(url.pathname==="/api/mcp/http") {
        if(body?.action!=="reset-certificate")throw bridgeError("invalid_action","Unknown HTTP MCP action.");
        await direct.reset();directStart=null;await startDirect();
        return sendJson(res,200,{http:statusPayload().http}),true;
      }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "client")) throw bridgeError("invalid_client", "Choose Codex or Claude.", 400);
      const config = statusPayload().config;
      if (!config) throw bridgeError("http_unavailable", "The HTTP MCP service is unavailable.", 503);
      const result = await configureClient(body.client, config, { rootDirectory, stateDirectory });
      return sendJson(res, result.configured ? 200 : 422, result), true;
    } catch (error) {
      const normalized = error instanceof McpBridgeError ? error : bridgeError("mcp_bridge_error", "PenEcho MCP request failed.", 500);
      log({ type:"mcp-http-error", path:url.pathname, errorCode:normalized.code });
      if (!res.headersSent) sendJson(res, normalized.status || 500, { error:serializeError(normalized) });
      else res.destroy();
      return true;
    }
  }

  function requestSignal(req, res) {
    const controller = new AbortController(), abort = () => controller.abort();
    req.once("aborted", abort);
    req.once("close", () => { if (!req.complete) abort(); });
    res.once("close", () => { if (!res.writableEnded) abort(); });
    return controller.signal;
  }

  function register(address) {
    if (closed) throw new Error("PenEcho MCP service is closed.");
    const port = typeof address === "object" && address ? Number(address.port) : Number(address);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PenEcho MCP requires a listening TCP address.");
    if (record) removeRecord(directory, record);
    record = { instanceId, pid:process.pid, host:"127.0.0.1", port, secret, rootDirectory, startedAt:Date.now() };
    writeRecord(directory, record);
    if(options.autoStartHttp!==false)void startDirect().catch(()=>{});
    return statusPayload();
  }

  async function close() {
    if (closed) return;
    closed = true;
    await direct.close();
    remoteChannels.close();
    clearInterval(heartbeatTimer);
    server.off("upgrade", upgrade);
    if (record) { try { removeRecord(directory, record); } catch (error) { log({ type:"mcp-record-cleanup-error", errorCode:String(error?.code || "cleanup_failed").slice(0, 80) }); } }
    record = null;
    for (const session of sessions.values()) {
      clearTimeout(session.updateTimer);
      clearTimeout(session.lostTimer);
      for (const trace of session.pendingUpdateTraces) requestTracer?.queuedUpdateOutcome(trace, "failed", { applied:false, error:"The PenEcho MCP service closed before the queued update was applied." });
      session.pendingUpdateTraces = [];
    }
    sessions.clear();
    sessionKeys.clear();
    for (const connection of connections) {
      rejectPending(connection, bridgeError("service_closed", "The PenEcho MCP service closed.", 503));
      connection.ws.terminate();
    }
    connections.clear();
    canvases.clear();
    await new Promise(resolve => wss.close(resolve));
  }

  return { callTool, disposeOwner, attachBrowser:ws=>wss.emit("connection",ws), close, startDirect, executeRemote:remoteChannels.execute, closeRemoteChannels:remoteChannels.disconnect, handleHttp, instanceId, listCanvases:() => [...canvases.values()].filter(item => item.canvasId && !item.closed).flatMap(item => publicCanvasDocuments(item, instanceId)), register, status:statusPayload };
}

module.exports = { BOUND_CANVAS_TOOL_NAMES, executeBoundCanvasTool, CALL_TIMEOUT_MS, MAX_CAPTURE_BYTES, MAX_HTTP_BODY_BYTES, createMcpService, isLoopback, normalizedAddress };
