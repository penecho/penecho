#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const { discoverRecords } = require("./records.js");
const { TOOLS, validateToolArguments } = require("./schema.js");
const { SESSION_INSTRUCTIONS, VISUAL_INSTRUCTIONS, visualExplorerPrompt } = require("./guidance.js");

const { getAuthoringGuidance } = require("./authoring-guidance.js");

const { RESOURCES, readResource } = require("./resources.js");

const {PROTOCOL_VERSION,INSTRUCTIONS,PROMPTS,promptResult,captureToolResult}=require("./protocol.js");
const MAX_INPUT_LINE_BYTES = 3 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 50_000;

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : "";
}

function selectRecord(options = {}) {
  const records = discoverRecords(options);
  if (options.instanceId) {
    const record = records.find(item => item.instanceId === options.instanceId);
    if (!record) throw new Error("The configured PenEcho MCP instance is no longer available. Reopen PenEcho or configure the MCP client again.");
    return record;
  }
  if (!records.length) throw new Error("No local PenEcho MCP instance is available. Open PenEcho first.");
  return records[0];
}

function responseKey(id) {
  return `${typeof id}:${String(id)}`;
}

function bridgeRequest(record, payload, signal) {
  const body = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    if (body.length > MAX_INPUT_LINE_BYTES) return reject(new Error("PenEcho MCP request is too large."));
    const request = http.request({
      host:"127.0.0.1",
      port:record.port,
      path:"/api/mcp/rpc",
      method:"POST",
      headers:{
        authorization:`Bearer ${record.secret}`,
        "content-type":"application/json",
        "content-length":body.length,
        "x-penecho-mcp-instance":record.instanceId,
      },
      signal,
      timeout:REQUEST_TIMEOUT_MS,
    }, response => {
      const chunks = [];
      let size = 0, failed = false;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          failed = true;
          response.destroy(new Error("PenEcho MCP response is too large."));
        } else chunks.push(chunk);
      });
      response.on("end", () => {
        if (failed) return;
        let value;
        try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return reject(new Error("PenEcho returned an invalid MCP response.")); }
        if (response.statusCode !== 200 || value?.error) {
          const error = new Error(String(value?.error?.message || `PenEcho MCP request failed (${response.statusCode}).`));
          error.code = value?.error?.code;
          error.details = value?.error?.details;
          return reject(error);
        }
        resolve(value.result);
      });
      response.on("error", reject);
    });
    // Socket inactivity alone is not a deadline: a stalled peer can keep
    // sending partial bytes forever without completing its JSON response.
    const deadline = setTimeout(() => request.destroy(new Error("PenEcho MCP request timed out.")), REQUEST_TIMEOUT_MS);
    deadline.unref?.();
    request.once("close", () => clearTimeout(deadline));
    request.on("timeout", () => request.destroy(new Error("PenEcho MCP request timed out.")));
    request.on("error", reject);
    request.end(body);
  });
}

function normalToolResult(value) {
  return { content:[{ type:"text", text:JSON.stringify(value) }], structuredContent:value };
}


class PenEchoStdioServer {
  constructor({ input = process.stdin, output = process.stdout, record, stateDirectory, registryStateDirectory, instanceId, maxRequests = 32 } = {}) {
    this.input = input;
    this.output = output;
    this.fixedRecord = record || null;
    this.stateDirectory = stateDirectory;
    this.registryStateDirectory = registryStateDirectory;
    this.instanceId = instanceId || "";
    this.ownerId = crypto.randomUUID();
    this.sessions = new Map();
    this.pending = new Map();
    this.executing = new Set();
    this.maxRequests = Number.isSafeInteger(maxRequests) && maxRequests > 0 ? maxRequests : 32;
    this.buffer = Buffer.alloc(0);
    this.initialized = false;
    this.closed = false;
    this.onData = chunk => this.receive(chunk);
    this.onEnd = () => this.close();
  }

  records() {
    if (this.fixedRecord) return [this.fixedRecord];
    const records = discoverRecords(this);
    return this.instanceId ? records.filter(record => record.instanceId === this.instanceId) : records;
  }

  async listCanvases(signal) {
    const records = this.records();
    const results = await Promise.allSettled(records.map(record => bridgeRequest(record, { operation:"list_canvases", ownerId:this.ownerId }, signal)));
    const canvases = [], issues = [];
    let reachable = 0;
    results.forEach((result, index) => {
      const record = records[index];
      const valid = result.status === "fulfilled" && result.value?.instanceId === record.instanceId && Array.isArray(result.value.canvases);
      if (valid) {
        reachable++;
        for (const canvas of result.value.canvases) canvases.push(canvas);
      } else if (issues.length < 8) {
        issues.push({ instanceId:record.instanceId, code:result.status === "fulfilled" ? "invalid-response" : "connection-failed" });
      }
    });
    if (canvases.length && reachable === records.length) return { canvases };
    const status = !records.length ? "no-local-instance" : !reachable ? "instance-unavailable" : reachable < records.length ? "partial" : "no-opted-in-canvas";
    return { canvases, discovery:{ status, instances:records.length, reachable, ...(issues.length ? { issues } : {}) } };
  }

  recordForCall(name, args) {
    if (["penecho_start_session", "penecho_open_canvas", "penecho_find_canvases"].includes(name)) {
      const record = this.records().find(item => item.instanceId === args.instanceId);
      if (!record) throw new Error("The selected PenEcho instance is no longer available. List canvases again.");
      return record;
    }
    const record = this.sessions.get(args.sessionId);
    if (!record) throw new Error("This MCP connection does not own that PenEcho session. Start a new session after listing canvases.");
    return record;
  }

  start() {
    this.input.on("data", this.onData);
    this.input.on("end", this.onEnd);
    this.input.on("error", this.onEnd);
    this.input.resume?.();
    return this;
  }

  send(value) {
    if (!this.closed) this.output.write(`${JSON.stringify(value)}\n`);
  }

  receive(chunk) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    if (this.buffer.length > MAX_INPUT_LINE_BYTES && !this.buffer.includes(10)) return this.close();
    while (true) {
      const newline = this.buffer.indexOf(10);
      if (newline < 0) break;
      const line = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      if (!line.length || line.length === 1 && line[0] === 13) continue;
      if (line.length > MAX_INPUT_LINE_BYTES) { this.close(); return; }
      let message;
      try { message = JSON.parse(line.toString("utf8")); }
      catch { this.send({ jsonrpc:"2.0", id:null, error:{ code:-32700, message:"Parse error" } }); continue; }
      void this.handle(message);
    }
  }

  async handle(message) {
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      if (message?.id !== undefined) this.send({ jsonrpc:"2.0", id:message.id ?? null, error:{ code:-32600, message:"Invalid Request" } });
      return;
    }
    if (message.method === "notifications/cancelled") {
      const key = responseKey(message.params?.requestId), pending = this.pending.get(key);
      if (pending) {
        this.pending.delete(key);
        pending.abort();
        this.send({ jsonrpc:"2.0", id:message.params.requestId, error:{ code:-32800, message:"Request cancelled" } });
      }
      return;
    }
    if (message.id === undefined) return;
    const id = message.id;
    if (!(typeof id === "string" || typeof id === "number" && Number.isFinite(id))) return this.send({ jsonrpc:"2.0", id:null, error:{ code:-32600, message:"Invalid Request" } });
    try {
      if (message.method === "initialize") {
        this.initialized = true;
        return this.send({ jsonrpc:"2.0", id, result:{ protocolVersion:PROTOCOL_VERSION, capabilities:{ tools:{ listChanged:false }, prompts:{listChanged:false}, resources:{subscribe:false,listChanged:false} }, serverInfo:{ name:"PenEcho", version:"1.0.0" }, instructions:INSTRUCTIONS } });
      }
      if (message.method === "ping") return this.send({ jsonrpc:"2.0", id, result:{} });
      if (!this.initialized) return this.send({ jsonrpc:"2.0", id, error:{ code:-32002, message:"Initialize the PenEcho MCP server first." } });
      if (message.method === "tools/list") return this.send({ jsonrpc:"2.0", id, result:{ tools:TOOLS } });
      if (message.method === "prompts/list") return this.send({jsonrpc:"2.0",id,result:{prompts:PROMPTS}});
      if (message.method === "resources/list") return this.send({jsonrpc:"2.0",id,result:{resources:RESOURCES}});
      if (message.method === "resources/templates/list") return this.send({jsonrpc:"2.0",id,result:{resourceTemplates:[]}});
      if (message.method === "resources/read") {
        try { return this.send({jsonrpc:"2.0",id,result:readResource(message.params?.uri,PROMPTS)}); }
        catch (error) { return this.send({jsonrpc:"2.0",id,error:{code:error.code || -32602,message:error.message}}); }
      }
      if (message.method === "prompts/get") {
        try { return this.send({jsonrpc:"2.0",id,result:promptResult(message.params?.name,message.params?.arguments || {})}); }
        catch (error) { return this.send({jsonrpc:"2.0",id,error:{code:error?.code || -32602,message:String(error?.message || "Invalid params").slice(0,500)}}); }
      }
      if (message.method !== "tools/call") return this.send({ jsonrpc:"2.0", id, error:{ code:-32601, message:"Method not found" } });
      const name = message.params?.name, args = message.params?.arguments === undefined ? {} : message.params.arguments;
      if (typeof name !== "string" || !args || typeof args !== "object" || Array.isArray(args)) return this.send({ jsonrpc:"2.0", id, error:{ code:-32602, message:"Invalid params" } });
      const controller = new AbortController(), key = responseKey(id);
      if (this.pending.has(key)) return this.send({ jsonrpc:"2.0", id, error:{ code:-32600, message:"Request ID already active" } });
      if (this.executing.size >= this.maxRequests) return this.send({ jsonrpc:"2.0", id, error:{ code:-32000, message:"PenEcho MCP is busy. Retry after pending work finishes." } });
      this.pending.set(key, controller);
      this.executing.add(controller);
      try {
        if (name === "penecho_get_guidance") {
          const { id:guidanceId } = validateToolArguments(name, args);
          return this.send({ jsonrpc:"2.0", id, result:normalToolResult(getAuthoringGuidance(guidanceId,args.detail)) });
        }
        const record = name === "penecho_list_canvases" ? null : this.recordForCall(name, args);
        const value = name === "penecho_list_canvases"
          ? await this.listCanvases(controller.signal)
          : await bridgeRequest(record, { operation:"call", ownerId:this.ownerId, name, arguments:args }, controller.signal);
        if (this.pending.get(key) !== controller) return;
        if (name === "penecho_start_session" && typeof value?.sessionId === "string") this.sessions.set(value.sessionId, record);
        if (name === "penecho_close_session" && value?.closed === true) this.sessions.delete(args.sessionId);
        this.send({ jsonrpc:"2.0", id, result:value?.image ? captureToolResult(value) : normalToolResult(value) });
      } catch (error) {
        if (this.pending.get(key) !== controller) return;
        const failure = {code:String(error?.code || "mcp_bridge_error").slice(0,80),message:String(error?.message || "PenEcho MCP request failed.").slice(0,1_000),...(error?.details === undefined ? {} : {details:error.details})};
        this.send({ jsonrpc:"2.0", id, result:{ content:[{ type:"text", text:JSON.stringify(failure) }], structuredContent:failure, isError:true } });
      } finally { this.executing.delete(controller); if (this.pending.get(key) === controller) this.pending.delete(key); }
    } catch (error) {
      this.send({ jsonrpc:"2.0", id, error:{ code:-32603, message:String(error?.message || "Internal error").slice(0, 500) } });
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.input.off("data", this.onData);
    this.input.off("end", this.onEnd);
    this.input.off("error", this.onEnd);
    for (const controller of this.executing) controller.abort();
    this.pending.clear();
  }
}

function main(argv = process.argv.slice(2)) {
  const instanceId = argumentValue(argv, "--instance"), stateDirectory = argumentValue(argv, "--state-directory") || undefined;
  try { new PenEchoStdioServer({ instanceId, stateDirectory }).start(); }
  catch (error) {
    process.stderr.write(`PenEcho MCP: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { INSTRUCTIONS, MAX_INPUT_LINE_BYTES, PROMPTS, PROTOCOL_VERSION, PenEchoStdioServer, bridgeRequest, captureToolResult, main, promptResult, selectRecord };
