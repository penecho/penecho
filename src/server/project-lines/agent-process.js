"use strict";
const crossSpawn = require("cross-spawn");
const { spawnSync: nativeSpawnSync } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const iconv = require("iconv-lite");
let consoleEncoding;

// Probe the same Windows command processor without recursively using our decoder.
function windowsEncoding(env = process.env) {
  if (process.platform !== "win32") return "utf8";
  if (consoleEncoding !== undefined) return consoleEncoding;
  try {
    const result = nativeSpawnSync(env.ComSpec || env.COMSPEC || "cmd.exe", ["/d", "/c", "chcp"], { env, timeout:2000, windowsHide:true });
    const page = result.status === 0 && result.stdout?.toString("latin1").match(/:\s*(\d+)/)?.[1];
    const name = page === "65001" ? "utf8" : page ? `cp${page}` : "";
    consoleEncoding = name && iconv.encodingExists(name) ? name : "utf8";
  } catch { consoleEncoding = "utf8"; }
  return consoleEncoding;
}
function decodeDiagnostic(bytes, options = {}) {
  if (typeof bytes === "string") return bytes;
  const buffer = Buffer.from(bytes || []);
  try { return new TextDecoder("utf-8", { fatal:true }).decode(buffer); }
  catch { return iconv.decode(buffer, options.encoding || windowsEncoding(options.env)); }
}
// Decode complete diagnostic lines, so UTF-8/DBCS characters split across chunks survive.
// Overlong lines are explicitly omitted rather than decoding a truncated multibyte sequence.
function diagnosticDecoder(options = {}) {
  const limit = options.maxPending || 65536;
  let pending = Buffer.alloc(0), dropping = false;
  return {
    write(chunk) {
      let bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)), text = "";
      if (dropping) { const end = bytes.indexOf(10); if (end < 0) return ""; bytes = bytes.subarray(end + 1); dropping = false; }
      pending = Buffer.concat([pending, bytes]);
      for (let end; (end = pending.indexOf(10)) >= 0;) {
        text += end > limit ? "[Overlong diagnostic line omitted]\n" : decodeDiagnostic(pending.subarray(0, end + 1), options);
        pending = pending.subarray(end + 1);
      }
      if (pending.length > limit) { pending = Buffer.alloc(0); dropping = true; text += "[Overlong diagnostic line omitted]\n"; }
      return text;
    },
    end() { const text = dropping ? "" : decodeDiagnostic(pending, options); pending = Buffer.alloc(0); dropping = false; return text; },
  };
}

function withSpawnOptions(command, args, options) {
  const base = options && typeof options === "object" ? options : null;
  const needsHide = base?.windowsHide === undefined;
  const needsElectronNode = Boolean(process.versions?.electron) && command === process.execPath && Array.isArray(args) && args.length > 0 && !(base?.env || process.env).ELECTRON_RUN_AS_NODE;
  if (!needsHide && !needsElectronNode) return options;
  const next = { ...(base || {}) };
  if (needsHide) next.windowsHide = true;
  if (needsElectronNode) next.env = { ...(base?.env || process.env), ELECTRON_RUN_AS_NODE:"1" };
  return next;
}
function spawn(command, ...rest) {
  if (Array.isArray(rest[0])) return crossSpawn(command, rest[0], withSpawnOptions(command, rest[0], rest[1]));
  return crossSpawn(command, withSpawnOptions(command, null, rest[0]));
}
function spawnSync(command, ...rest) {
  if (Array.isArray(rest[0])) return crossSpawn.sync(command, rest[0], withSpawnOptions(command, rest[0], rest[1]));
  return crossSpawn.sync(command, withSpawnOptions(command, null, rest[0]));
}

function runCommand(command, args, { env = process.env, cwd, timeout = 15000, maxBuffer = 1024 * 1024, spawnFn = spawn } = {}) {
  return new Promise(resolve => {
    const childEnv = { ...env }; delete childEnv.CLAUDECODE; delete childEnv.CLAUDE_CODE_ENTRYPOINT;
    if (process.versions?.electron && command === process.execPath && Array.isArray(args) && args.length && !childEnv.ELECTRON_RUN_AS_NODE) {
      childEnv.ELECTRON_RUN_AS_NODE = "1";
    }
    const stdout = [], stderr = []; let size = 0, timedOut = false, overflow = false, error = null, child;
    try { child = spawnFn(command, args, { env:childEnv, ...(cwd ? { cwd } : {}), stdio:["ignore", "pipe", "pipe"], windowsHide:true }); }
    catch (caught) { return resolve({ status:-1, stdout:"", stderr:caught.message, timedOut:false, missing:caught.code === "ENOENT" }); }
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    const collect = target => chunk => { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)); size += bytes.length; if (size > maxBuffer) { overflow = true; child.kill(); } else target.push(bytes); };
    child.stdout?.on("data", collect(stdout)); child.stderr?.on("data", collect(stderr));
    child.on("error", caught => { error = caught; });
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ status:timedOut || overflow || error ? -1 : code ?? -1, stdout:decodeDiagnostic(Buffer.concat(stdout), { env }), stderr:overflow ? "Command output exceeded the diagnostic limit." : decodeDiagnostic(Buffer.concat(stderr), { env }) || error?.message || "", timedOut, missing:error?.code === "ENOENT" });
    });
  });
}
module.exports = { spawn, spawnSync, runCommand, decodeDiagnostic, diagnosticDecoder, StringDecoder };
