"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { mapKimiReasoningEffort } = require("./reasoning-effort.js");

const MAX_CAPTURE_BYTES = 1024 * 1024;
const KIMI_AGENT_FILE = "penecho-canvas-agent.md";
const KIMI_AGENT_DEFINITION = `---
name: penecho-canvas
description: Isolated response generator for PenEcho Canvas
tools: []
subagents: []
---

You are an isolated response generator for PenEcho Canvas. Follow the user prompt exactly and return only the requested response. Use only content supplied in the prompt, including virtual-file read views. You have no tools and must not access the host filesystem, run commands, access the network, delegate work, or modify the environment.
`;

function findOnPath(name, env = process.env) {
  const directories = String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
  const candidates = process.platform === "win32" && !path.extname(name)
    ? [".exe", ".com", ".cmd", ".bat"].map(extension => `${name}${extension}`)
    : [name];
  for (const directory of directories) {
    for (const candidate of candidates) {
      const file = path.join(directory.replace(/^"|"$/g, ""), candidate);
      try { if (fs.statSync(file).isFile()) return file; } catch {}
    }
  }
  return null;
}

function resolveKimiLaunch(configuredPath = "kimi", env = process.env) {
  const requested = String(configuredPath || "kimi").trim();
  if (!requested || requested.includes("\0")) throw new Error("KIMI_CLI_PATH is invalid.");
  const hasDirectory = path.isAbsolute(requested) || requested.includes("/") || requested.includes("\\");
  const executable = hasDirectory ? path.resolve(requested) : findOnPath(requested, env);
  if (!executable) throw new Error("Kimi Code CLI was not found. Install it from https://github.com/MoonshotAI/kimi-code, then set KIMI_CLI_PATH if needed.");
  try { if (!fs.statSync(executable).isFile()) throw new Error(); }
  catch { throw new Error(`Kimi Code CLI path is not a file: ${executable}`); }
  const extension = path.extname(executable).toLowerCase();
  if ([".js", ".cjs", ".mjs"].includes(extension)) return { command: process.execPath, prefixArgs: [executable] };
  if (process.platform === "win32" && [".cmd", ".bat", ".ps1"].includes(extension)) {
    const packageRoot = path.join(path.dirname(executable), "node_modules", "@moonshot-ai", "kimi-code");
    const script = ["dist/cli.js", "bin/kimi.js", "cli.js"].map(relative => path.join(packageRoot, relative)).find(file => fs.existsSync(file));
    if (script) return { command: process.execPath, prefixArgs: [script] };
    throw new Error("The Kimi Code shell wrapper cannot be launched safely. Set KIMI_CLI_PATH to kimi.exe or install the official Kimi Code package.");
  }
  return { command: executable, prefixArgs: [] };
}

function mapKimiEffort(effort) {
  const normalized = String(effort || "").trim().toLowerCase();
  if (!normalized || normalized === "config") return null;
  return mapKimiReasoningEffort(normalized) || normalized;
}

function sanitizeKimiEnv(env = process.env, effort = null) {
  const clean = {}, allowed = [
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432",
    "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "LANG", "LC_ALL", "TERM", "COLORTERM", "NO_COLOR",
    "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "KIMI_CODE_HOME", "KIMI_SHELL_PATH",
  ];
  for (const name of allowed) {
    const sourceName = Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase());
    if (sourceName && env[sourceName] !== undefined) clean[sourceName] = env[sourceName];
  }
  clean.KIMI_CODE_EXPERIMENTAL_FLAG = "1";
  clean.KIMI_CODE_NO_AUTO_UPDATE = "1";
  const mappedEffort = mapKimiEffort(effort);
  if (mappedEffort) clean.KIMI_MODEL_THINKING_EFFORT = mappedEffort;
  return clean;
}

function buildKimiArgs({ model, prompt, agentFile = KIMI_AGENT_FILE }) {
  const args = [
    "--prompt", String(prompt || ""),
    "--output-format", "stream-json",
    "--agent-file", agentFile,
  ];
  if (model) args.push("--model", model);
  return args;
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && !Array.isArray(content)) return String(content.text ?? content.content ?? content.output_text ?? "");
  if (!Array.isArray(content)) return "";
  return content.map(part => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    return String(part.text ?? part.content ?? part.output_text ?? "");
  }).join("");
}

function kimiAssistantText(event) {
  if (!event || typeof event !== "object") return "";
  const type = String(event.type || event.kind || "").toLowerCase(), role = String(event.role || event.message?.role || "").toLowerCase();
  if (type === "error" || type === "failed" || type === "turn.failed") return "";
  if (role && role !== "assistant") return "";
  if (type && !["assistant", "message", "assistant_message", "content_block_delta", "text_delta", "result", "response"].includes(type) && !role) return "";
  return textFromContent(event.text ?? event.delta?.text ?? event.message?.content ?? event.content ?? event.result ?? event.output_text);
}

function kimiEventError(event) {
  const value = event?.error?.message || event?.error || event?.message || event?.detail;
  return typeof value === "string" ? value.trim() : "";
}

function kimiEventHasToolActivity(event) {
  if (!event || typeof event !== "object") return false;
  if (String(event.role || event.message?.role || "").toLowerCase() === "tool") return true;
  const calls = [event.tool_calls, event.toolCalls, event.message?.tool_calls, event.message?.toolCalls];
  if (calls.some(value => Array.isArray(value) && value.length > 0)) return true;
  const content = [event.content, event.message?.content].flatMap(value => Array.isArray(value) ? value : []);
  if (content.some(part => ["tool_call", "tool_use", "tool_result"].includes(String(part?.type || "").toLowerCase()))) return true;
  return ["tool", "tool.call", "tool.call.started", "tool.result", "tool_use", "tool_result"].includes(
    String(event.type || event.kind || "").toLowerCase(),
  );
}

function abortError() { return Object.assign(new Error("Kimi Code CLI request aborted."), { name: "AbortError" }); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function processGroupExists(pid) { try { process.kill(-pid, 0); return true; } catch { return false; } }

async function stopProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    await new Promise(resolve => {
      let settled = false;
      const fallback = () => { try { child.kill(); } catch {} };
      const finish = fallbackNeeded => { if (settled) return; settled = true; clearTimeout(timer); if (fallbackNeeded) fallback(); resolve(); };
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true, shell: false });
      const timer = setTimeout(() => { try { killer.kill(); } catch {} finish(true); }, 2000);
      killer.once("error", () => finish(true));
      killer.once("close", code => finish(code !== 0));
    });
    return;
  }
  if (!processGroupExists(child.pid)) { if (child.exitCode === null && child.signalCode === null) try { child.kill("SIGTERM"); } catch {} return; }
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  const deadline = Date.now() + 1000;
  while (processGroupExists(child.pid) && Date.now() < deadline) await wait(40);
  if (processGroupExists(child.pid)) try { process.kill(-child.pid, "SIGKILL"); } catch {}
}

function appendTail(current, value) {
  const combined = `${current}${value}`, buffer = Buffer.from(combined, "utf8");
  return buffer.length <= MAX_CAPTURE_BYTES ? combined : buffer.subarray(-MAX_CAPTURE_BYTES).toString("utf8");
}

function runProcess(launch, args, cwd, env, signal, onActivity = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    let child;
    try { child = spawn(launch.command, [...launch.prefixArgs, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false, detached: process.platform !== "win32" }); }
    catch (error) { return reject(error); }
    let settled = false, lineBuffer = "", stderr = "", content = "", termination = null;
    const events = [];
    const terminate = () => termination ||= stopProcessTree(child);
    const traceDiagnostic = () => JSON.stringify({ events, stderr:stderr.slice(-4000) });
    const failEarly = error => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      error.traceDiagnostic ||= traceDiagnostic();
      error.cleanupReady = terminate();
      error.deferCleanup = true;
      reject(error);
    };
    const finishEarly = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      const cleanupReady = terminate();
      resolve({ code:0, content, stderr, traceDiagnostic:traceDiagnostic(), cleanupReady, deferCleanup:true });
    };
    const handleLine = rawLine => {
      const line = rawLine.replace(/\r$/, "").trim();
      if (!line || settled) return;
      if (Buffer.byteLength(line, "utf8") > MAX_CAPTURE_BYTES) return failEarly(new Error("Kimi Code CLI produced an oversized JSON event."));
      let event;
      try { event = JSON.parse(line); } catch { events.push({ type:"invalid-json", preview:line.slice(0,200) }); return; }
      events.push({ type:String(event?.type || event?.kind || "unknown"), ...(kimiEventError(event) ? { error:kimiEventError(event).slice(0,500) } : {}) });
      if (events.length > 64) events.shift();
      if (kimiEventHasToolActivity(event)) return failEarly(new Error("Kimi Code CLI attempted to use a tool while tools are disabled."));
      const detail = kimiEventError(event);
      if (["error", "failed", "turn.failed"].includes(String(event?.type || "").toLowerCase())) return failEarly(new Error(`Kimi Code CLI failed${detail ? `: ${detail}` : "."}`));
      const contentText = kimiAssistantText(event);
      if (contentText) {
        content += contentText;
        if (Buffer.byteLength(content, "utf8") > MAX_CAPTURE_BYTES) return failEarly(new Error("Kimi Code CLI final response is too large."));
      }
      if (event?.type === "result" || event?.type === "response.completed" || event?.done === true) {
        if (content.trim()) finishEarly();
      }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      if (settled) return;
      try { onActivity?.(); } catch {}
      lineBuffer += chunk;
      let newline;
      while ((newline = lineBuffer.indexOf("\n")) >= 0 && !settled) { const line = lineBuffer.slice(0, newline); lineBuffer = lineBuffer.slice(newline + 1); handleLine(line); }
      if (!settled && Buffer.byteLength(lineBuffer, "utf8") > MAX_CAPTURE_BYTES) failEarly(new Error("Kimi Code CLI produced an oversized unterminated JSON event."));
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { if (!settled) stderr = appendTail(stderr, chunk); });
    const onAbort = () => failEarly(abortError());
    signal?.addEventListener("abort", onAbort, { once:true });
    child.once("error", error => { if (settled) return; settled = true; signal?.removeEventListener("abort", onAbort); error.traceDiagnostic ||= traceDiagnostic(); reject(error); });
    child.once("close", code => {
      if (settled) return;
      if (lineBuffer.trim()) handleLine(lineBuffer);
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return reject(abortError());
      resolve({ code, content, stderr, traceDiagnostic:traceDiagnostic(), cleanupReady:Promise.resolve(), deferCleanup:false });
    });
  });
}

function imageParts(atlasImage) {
  const match = atlasImage ? /^data:(image\/(?:png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(String(atlasImage)) : null;
  if (atlasImage && !match) throw new Error("Kimi Code CLI received an invalid canvas image.");
  return match ? { mimeType:match[1].toLowerCase(), buffer:Buffer.from(match[2], "base64") } : null;
}

async function callKimiCliSpawn({ executable = "kimi", model = null, effort = null, prompt, atlasImage = null, signal, env = process.env, onActivity = null }) {
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "penecho-kimi-"));
  let cleanupReady = Promise.resolve(), deferCleanup = false, caughtError = null;
  try {
    await fs.promises.chmod(workDir, 0o700).catch(() => {});
    const agentFile = path.join(workDir, KIMI_AGENT_FILE);
    await fs.promises.writeFile(agentFile, KIMI_AGENT_DEFINITION, { mode:0o600, flag:"wx" });
    const image = imageParts(atlasImage);
    let imageHint = "";
    if (image) {
      const file = path.join(workDir, image.mimeType === "image/webp" ? "canvas.webp" : "canvas.png");
      await fs.promises.writeFile(file, image.buffer, { mode:0o600 });
      imageHint = `\n\nA canvas image is available at @${path.basename(file)}. Inspect only this image as needed. Do not run shell commands, modify files, or use other tools.`;
    }
    const launch = resolveKimiLaunch(executable, env), result = await runProcess(launch, buildKimiArgs({ model, prompt:`${String(prompt || "")}${imageHint}`, agentFile }), workDir, sanitizeKimiEnv(env, effort), signal, onActivity);
    cleanupReady = result.cleanupReady || cleanupReady;
    deferCleanup = Boolean(result.deferCleanup);
    if (signal?.aborted) throw abortError();
    if (result.content?.trim()) return result.content.trim();
    const detail = result.stderr.trim().slice(-4000);
    throw new Error(`Kimi Code CLI returned no assistant response${detail ? `: ${detail}` : "."}`);
  } catch (error) {
    caughtError = error;
    cleanupReady = error.cleanupReady || cleanupReady;
    deferCleanup = deferCleanup || Boolean(error.deferCleanup);
    throw error;
  } finally {
    const cleanup = async () => { await cleanupReady.catch(() => {}); await fs.promises.rm(workDir, { recursive:true, force:true, maxRetries:5, retryDelay:100 }); };
    if (deferCleanup) void cleanup().catch(() => {});
    else try { await cleanup(); } catch (cleanupError) { if (caughtError) caughtError.cleanupDiagnostic = cleanupError.message; else throw cleanupError; }
  }
}

function kimiAcpWorkDir() {
  const uid = typeof process.getuid === "function" ? `-${process.getuid()}` : "";
  return path.join(os.tmpdir(), `penecho-kimi-acp-work${uid}`);
}

function kimiHomeFromEnv(env) {
  return String(env.KIMI_CODE_HOME || "").trim() || path.join(os.homedir(), ".kimi-code");
}

async function callKimiCli({ executable = "kimi", model = null, effort = null, prompt, atlasImage = null, signal, env = process.env, onActivity = null }) {
  const image = imageParts(atlasImage);
  try {
    const launch = resolveKimiLaunch(executable, env);
    const { sharedKimiAcpClient } = require("./kimi-acp.js");
    const client = sharedKimiAcpClient({
      key:`${launch.command}${launch.prefixArgs.join("")}`,
      launch,
      env:sanitizeKimiEnv(env),
      workDir:kimiAcpWorkDir(),
      kimiHome:kimiHomeFromEnv(env),
    });
    return await client.request({
      model,
      effort,
      prompt:String(prompt || ""),
      image:image ? { mimeType:image.mimeType, data:image.buffer.toString("base64") } : null,
      signal,
      onActivity,
    });
  } catch (error) {
    if (!error.acpInfraFailure) throw error;
    return callKimiCliSpawn({ executable, model, effort, prompt, atlasImage, signal, env, onActivity });
  }
}

module.exports = {
  buildKimiArgs,
  callKimiCli,
  callKimiCliSpawn,
  kimiAssistantText,
  kimiEventHasToolActivity,
  mapKimiEffort,
  resolveKimiLaunch,
  sanitizeKimiEnv,
};
