"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const mapKimiEffort = effort => require("./kimi-cli.js").mapKimiEffort(effort);

const ACP_HANDSHAKE_TIMEOUT_MS = 45000;
const ACP_RESPAWN_BACKOFF_MS = 15000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const SESSION_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SESSION_BUCKET_PREFIX = "wd_penecho-kimi-acp";
const TOOL_ERROR = "Kimi Code CLI attempted to use a tool while tools are disabled.";

let penechoVersion = "0";
try { penechoVersion = require("../../package.json").version || "0"; } catch {}

function abortError() { return Object.assign(new Error("Kimi Code CLI request aborted."), { name:"AbortError" }); }
function acpInfraError(message) { return Object.assign(new Error(message), { acpInfraFailure:true }); }
function transportError(message) { return Object.assign(new Error(message), { acpTransport:true }); }

class KimiAcpClient {
  constructor({ launch, env, workDir, kimiHome, logger = null }) {
    this.launch = launch;
    this.env = env;
    this.workDir = workDir;
    this.kimiHome = kimiHome;
    this.logger = logger;
    this.child = null;
    this.startPromise = null;
    this.lastStartFailureAt = 0;
    this.lastPruneAt = 0;
    this.buffer = "";
    this.nextId = 0;
    this.pending = new Map();
    this.activeRequest = null;
    this.queue = Promise.resolve();
    this.closed = false;
  }

  log(event, data) { try { this.logger?.(event, data); } catch {} }

  request(options) {
    const run = () => this._request(options);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async start() {
    if (this.closed) throw acpInfraError("Kimi ACP client is closed.");
    if (this.child) return;
    if (this.startPromise) return this.startPromise;
    const elapsed = Date.now() - this.lastStartFailureAt;
    if (elapsed < ACP_RESPAWN_BACKOFF_MS) throw acpInfraError("Kimi ACP process is backing off after a failed start.");
    this.startPromise = this._start().finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async _start() {
    await fs.promises.mkdir(this.workDir, { recursive:true, mode:0o700 });
    const child = spawn(this.launch.command, [...this.launch.prefixArgs, "acp"], {
      cwd:this.workDir, env:this.env, stdio:["pipe", "pipe", "pipe"], windowsHide:true, shell:false,
    });
    this.child = child;
    child.unref();
    child.stdin.unref?.();
    child.stdout.unref?.();
    child.stderr.unref?.();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => this._onData(chunk));
    let stderrTail = "";
    child.stderr.on("data", chunk => { stderrTail = (stderrTail + chunk).slice(-2000); });
    child.once("error", error => this._onProcessGone(error));
    child.once("exit", (code, signal) => {
      const tail = stderrTail.trim();
      this._onProcessGone(new Error(`Kimi ACP process exited (code ${code}, signal ${signal}).${tail ? ` ${tail.slice(-400)}` : ""}`));
    });
    let timer;
    try {
      const handshake = this._rpc("initialize", {
        protocolVersion:1,
        clientCapabilities:{ fs:{ readTextFile:false, writeTextFile:false } },
        clientInfo:{ name:"penecho", version:penechoVersion },
      });
      const message = await Promise.race([
        handshake,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Kimi ACP initialize timed out.")), ACP_HANDSHAKE_TIMEOUT_MS); }),
      ]);
      if (message.error) throw new Error(`Kimi ACP initialize failed: ${message.error.message}`);
      this.log("acp-started", { agent:message.result?.agentInfo?.name, version:message.result?.agentInfo?.version });
    } catch (error) {
      this.lastStartFailureAt = Date.now();
      this._onProcessGone(error);
      try { child.kill(); } catch {}
      throw acpInfraError(error.message);
    } finally {
      clearTimeout(timer);
    }
    this._pruneSessions();
  }

  _onProcessGone(error) {
    if (!this.child) return;
    this.child = null;
    if (!error.acpTransport) error.acpTransport = true;
    this.log("acp-exit", { error:error.message });
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
    this.activeRequest?.fail(error);
  }

  _onData(chunk) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > MAX_RESPONSE_BYTES && !this.buffer.includes("\n")) {
      this.log("acp-oversized-line", {});
      this.buffer = this.buffer.slice(-MAX_RESPONSE_BYTES);
    }
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { this.log("acp-non-json", { preview:line.slice(0, 120) }); continue; }
      this._onMessage(message);
    }
  }

  _onMessage(message) {
    if (message.id !== undefined && message.method === undefined) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      entry.resolve(message);
      return;
    }
    if (message.method !== undefined && message.id !== undefined) return this._onReverseRpc(message);
    if (message.method === "session/update") return this._onSessionUpdate(message.params);
    if (message.method) this.log("acp-notification", { method:message.method });
  }

  _onReverseRpc(message) {
    const { id, method, params } = message;
    if (method === "session/request_permission") {
      this._send({ jsonrpc:"2.0", id, result:{ outcome:{ outcome:"selected", optionId:"reject" } } });
      const active = this.activeRequest;
      if (active && params?.sessionId === active.sessionId) {
        this._notify("session/cancel", { sessionId:active.sessionId });
        active.fail(new Error(TOOL_ERROR));
      }
      return;
    }
    this._send({ jsonrpc:"2.0", id, error:{ code:-32601, message:`PenEcho does not provide ${method}.` } });
  }

  _onSessionUpdate(params) {
    const update = params?.update;
    if (!update || typeof update !== "object") return;
    const active = this.activeRequest;
    if (!active || params.sessionId !== active.sessionId) return;
    try { active.onActivity?.(); } catch {}
    const kind = update.sessionUpdate;
    if (kind === "agent_message_chunk") {
      const contentText = update.content?.text;
      if (typeof contentText === "string") {
        active.text += contentText;
        if (Buffer.byteLength(active.text, "utf8") > MAX_RESPONSE_BYTES) {
          this._notify("session/cancel", { sessionId:active.sessionId });
          active.fail(new Error("Kimi Code CLI final response is too large."));
        }
      }
      return;
    }
    if (kind === "tool_call" || kind === "tool_call_update") {
      this._notify("session/cancel", { sessionId:active.sessionId });
      active.fail(new Error(TOOL_ERROR));
    }
  }

  _send(message) {
    if (!this.child) throw transportError("Kimi ACP process is not running.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  _notify(method, params) {
    try { this._send({ jsonrpc:"2.0", method, params }); } catch {}
  }

  _rpc(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.child) return reject(transportError("Kimi ACP process is not running."));
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      try {
        this._send({ jsonrpc:"2.0", id, method, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error.acpTransport ? error : transportError(error.message));
      }
    });
  }

  async _request({ model, effort, prompt, image, signal, onActivity }) {
    if (this.closed) throw acpInfraError("Kimi ACP client is closed.");
    if (signal?.aborted) throw abortError();
    const requestKeepAlive = setInterval(() => {}, 60_000);
    let stage = "start";
    try {
      await this.start();
      stage = "session";
      const created = await this._rpc("session/new", { cwd:this.workDir, mcpServers:[] });
      if (created.error) throw new Error(`Kimi ACP session/new failed: ${created.error.message}`);
      const sessionId = created.result?.sessionId;
      if (!sessionId) throw new Error("Kimi ACP did not return a session id.");
      if (model) {
        const configured = await this._rpc("session/set_config_option", { sessionId, configId:"model", value:model });
        if (configured.error) throw new Error(`Kimi ACP rejected model "${model}": ${configured.error.message}`);
      }
      const mapped = mapKimiEffort(effort);
      if (mapped) {
        const thinking = await this._rpc("session/set_config_option", { sessionId, configId:"thinking", value:mapped });
        if (thinking.error) throw new Error(`Kimi ACP rejected thinking effort "${mapped}": ${thinking.error.message}`);
      }
      stage = "prompted";
      return await this._prompt({ sessionId, prompt, image, signal, onActivity });
    } catch (error) {
      if (stage !== "prompted" && error.acpTransport && !error.acpInfraFailure) error.acpInfraFailure = true;
      throw error;
    } finally {
      clearInterval(requestKeepAlive);
    }
  }

  _prompt({ sessionId, prompt, image, signal, onActivity }) {
    return new Promise((resolve, reject) => {
      const blocks = [];
      if (image) blocks.push({ type:"image", data:image.data, mimeType:image.mimeType });
      blocks.push({ type:"text", text:String(prompt || "") });
      const state = {
        sessionId,
        text:"",
        onActivity,
        settled:false,
        fail:error => { if (state.settled) return; state.settled = true; cleanup(); reject(error); },
        succeed:() => { if (state.settled) return; state.settled = true; cleanup(); resolve(state.text.trim()); },
      };
      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        if (this.activeRequest === state) this.activeRequest = null;
      };
      const onAbort = () => {
        this._notify("session/cancel", { sessionId });
        state.fail(abortError());
      };
      this.activeRequest = state;
      signal?.addEventListener("abort", onAbort, { once:true });
      this._rpc("session/prompt", { sessionId, prompt:blocks }).then(message => {
        if (state.settled) return;
        if (message.error) return state.fail(new Error(`Kimi Code CLI failed: ${message.error.message}`));
        if (signal?.aborted) return state.fail(abortError());
        if (!state.text.trim()) return state.fail(new Error("Kimi Code CLI returned no assistant response."));
        state.succeed();
      }, error => state.fail(error));
    });
  }

  _pruneSessions() {
    const now = Date.now();
    if (now - this.lastPruneAt < SESSION_PRUNE_INTERVAL_MS) return;
    this.lastPruneAt = now;
    void pruneKimiAcpSessions({ kimiHome:this.kimiHome, now }).catch(() => {});
  }

  async close() {
    this.closed = true;
    const child = this.child;
    this.child = null;
    const error = new Error("Kimi ACP client closed.");
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
    this.activeRequest?.fail(error);
    if (child) {
      try { child.stdin.end(); } catch {}
      try { child.kill(); } catch {}
    }
  }
}

async function pruneKimiAcpSessions({ kimiHome, bucketPrefix = SESSION_BUCKET_PREFIX, maxAgeMs = SESSION_MAX_AGE_MS, now = Date.now() }) {
  const sessionsRoot = path.join(kimiHome, "sessions");
  let removedAny = false;
  try {
    for (const bucket of await fs.promises.readdir(sessionsRoot)) {
      if (!bucket.startsWith(bucketPrefix)) continue;
      const bucketDir = path.join(sessionsRoot, bucket);
      for (const entry of await fs.promises.readdir(bucketDir)) {
        const directory = path.join(bucketDir, entry);
        try {
          const stat = await fs.promises.stat(directory);
          if (now - stat.mtimeMs > maxAgeMs) {
            await fs.promises.rm(directory, { recursive:true, force:true });
            removedAny = true;
          }
        } catch {}
      }
      try { await fs.promises.rmdir(bucketDir); } catch {}
    }
  } catch { return false; }
  if (!removedAny) return false;
  try {
    const indexFile = path.join(kimiHome, "session_index.jsonl");
    const lines = (await fs.promises.readFile(indexFile, "utf8")).split(/\r?\n/).filter(Boolean);
    const kept = lines.filter(line => {
      let record = null;
      try { record = JSON.parse(line); } catch { return true; }
      return !record?.sessionDir || fs.existsSync(record.sessionDir);
    });
    if (kept.length !== lines.length) {
      const temporary = `${indexFile}.${process.pid}.tmp`;
      await fs.promises.writeFile(temporary, kept.length ? `${kept.join("\n")}\n` : "", { encoding:"utf8", mode:0o600 });
      await fs.promises.rename(temporary, indexFile);
    }
  } catch {}
  return true;
}

const sharedClients = new Map();

function sharedKimiAcpClient({ key, launch, env, workDir, kimiHome, logger }) {
  let client = sharedClients.get(key);
  if (!client || client.closed) {
    client = new KimiAcpClient({ launch, env, workDir, kimiHome, logger });
    sharedClients.set(key, client);
  }
  return client;
}

async function closeSharedKimiAcpClients() {
  const clients = [...sharedClients.values()];
  sharedClients.clear();
  await Promise.all(clients.map(client => client.close()));
}

module.exports = {
  KimiAcpClient,
  closeSharedKimiAcpClients,
  pruneKimiAcpSessions,
  sharedKimiAcpClient,
  ACP_HANDSHAKE_TIMEOUT_MS,
  SESSION_BUCKET_PREFIX,
  SESSION_MAX_AGE_MS,
};
