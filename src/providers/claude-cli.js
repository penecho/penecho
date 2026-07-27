"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const MAX_CAPTURE_BYTES = 1024 * 1024;
const DISABLED_THINKING_FALLBACK_EFFORT = "low";

function findOnPath(name, env = process.env) {
  const directories = String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
  const candidates = process.platform === "win32" && !path.extname(name) ? [".exe", ".com", ".cmd", ".bat"].map(extension => `${name}${extension}`) : [name];
  for (const directory of directories) {
    for (const candidate of candidates) {
      const file = path.join(directory.replace(/^"|"$/g, ""), candidate);
      try { if (fs.statSync(file).isFile()) return file; } catch {}
    }
  }
  return null;
}

function resolveClaudeLaunch(configuredPath = "claude", env = process.env) {
  const requested = String(configuredPath || "claude").trim();
  if (!requested || requested.includes("\0")) throw new Error("CLAUDE_CLI_PATH is invalid.");
  const hasDirectory = path.isAbsolute(requested) || requested.includes("/") || requested.includes("\\");
  const executable = hasDirectory ? path.resolve(requested) : findOnPath(requested, env);
  if (!executable) throw new Error("Claude CLI was not found. Install Claude Code or set CLAUDE_CLI_PATH to the executable.");
  try { if (!fs.statSync(executable).isFile()) throw new Error(); }
  catch { throw new Error(`Claude CLI path is not a file: ${executable}`); }
  const extension = path.extname(executable).toLowerCase();
  if ([".js", ".cjs", ".mjs"].includes(extension)) return { command: process.execPath, prefixArgs: [executable] };
  if (process.platform === "win32" && [".cmd", ".bat", ".ps1"].includes(extension)) {
    const packageRoot = path.join(path.dirname(executable), "node_modules", "@anthropic-ai", "claude-code"),
      native = path.join(packageRoot, "bin", "claude.exe"), wrapper = path.join(packageRoot, "cli-wrapper.cjs");
    if (fs.existsSync(native)) return { command: native, prefixArgs: [] };
    if (fs.existsSync(wrapper)) return { command: process.execPath, prefixArgs: [wrapper] };
    throw new Error("The Claude shell wrapper cannot be launched safely. Set CLAUDE_CLI_PATH to the Claude executable.");
  }
  return { command: executable, prefixArgs: [] };
}

function sanitizeClaudeEnv(env = process.env, effort = null) {
  const clean = {}, allowed = [
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432",
    "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "LANG", "LC_ALL", "TERM", "COLORTERM", "NO_COLOR",
    "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN",
  ];
  for (const name of allowed) {
    const sourceName = Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase());
    if (sourceName && env[sourceName] !== undefined) clean[sourceName] = env[sourceName];
  }
  clean.CLAUDE_CODE_SKIP_PROMPT_HISTORY = "1";
  clean.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  clean.CLAUDE_CODE_DISABLE_TERMINAL_TITLE = "1";
  if (String(effort || "").trim().toLowerCase() === "none") clean.MAX_THINKING_TOKENS = "0";
  return clean;
}

function buildClaudeArgs({ systemPrompt, model, effort }) {
  const selectedEffort = String(effort || "").trim(), thinkingDisabled = selectedEffort.toLowerCase() === "none",
    cliEffort = thinkingDisabled ? DISABLED_THINKING_FALLBACK_EFFORT : selectedEffort;
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--safe-mode",
    "--disable-slash-commands",
    "--tools", "",
    "--disallowedTools", "Agent,Task",
    "--agents", "{}",
    "--strict-mcp-config",
    "--no-chrome",
    "--prompt-suggestions", "false",
    "--permission-mode", "dontAsk",
    "--system-prompt", systemPrompt,
  ];
  if (model) args.push("--model", model);
  if (cliEffort) {
    args.push("--effort", cliEffort);
    args.push("--settings", JSON.stringify({ env: { CLAUDE_CODE_EFFORT_LEVEL: cliEffort } }));
  }
  return args;
}

function claudeInput(prompt, atlasImage) {
  const match = atlasImage ? /^data:(image\/(?:png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(String(atlasImage)) : null;
  if (atlasImage && !match) throw new Error("Claude CLI received an invalid canvas image.");
  const content = [{ type: "text", text: String(prompt || "") }];
  if (match) content.push({ type: "image", source: { type: "base64", media_type: match[1].toLowerCase(), data: match[2] } });
  return `${JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content,
    },
    parent_tool_use_id: null,
  })}\n`;
}

function claudeResult(stdout) {
  let records;
  try { records = String(stdout || "").trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
  catch { throw new Error("Claude CLI returned invalid JSON output."); }
  const raw = records.findLast(record => record?.type === "result");
  if (!raw) throw new Error("Claude CLI returned no result event.");
  return claudeEventResult(raw);
}

function claudeEventResult(raw) {
  if (raw?.type !== "result" || raw?.subtype !== "success") throw new Error(`Claude CLI did not complete successfully${raw?.subtype ? ` (${raw.subtype})` : ""}.`);
  if (raw.structured_output && typeof raw.structured_output === "object") return JSON.stringify(raw.structured_output);
  if (typeof raw.result !== "string" || !raw.result.trim()) throw new Error("Claude CLI returned an empty result.");
  return raw.result;
}

function abortError() { return Object.assign(new Error("Claude CLI request aborted."), { name: "AbortError" }); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function processGroupExists(pid) { try { process.kill(-pid, 0); return true; } catch { return false; } }
async function stopProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    await new Promise(resolve => {
      let settled = false;
      const fallback = () => { try { child.kill(); } catch {} };
      const finish = (fallbackNeeded = false) => { if (!settled) { settled = true; clearTimeout(timer); if (fallbackNeeded) fallback(); resolve(); } };
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

function appendTail(current, chunk) {
  const next = current + chunk;
  return Buffer.byteLength(next, "utf8") <= MAX_CAPTURE_BYTES ? next : Buffer.from(next, "utf8").subarray(-MAX_CAPTURE_BYTES).toString("utf8");
}

function toolUseName(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = toolUseName(item);
      if (name) return name;
    }
    return "";
  }
  if (!value || typeof value !== "object") return "";
  if (value.type === "tool_use") return String(value.name || value.tool || "unknown");
  for (const item of Object.values(value)) {
    const name = toolUseName(item);
    if (name) return name;
  }
  return "";
}

function runProcess(launch, args, input, cwd, env, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    let child;
    try { child = spawn(launch.command, [...launch.prefixArgs, ...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false, detached: process.platform !== "win32" }); }
    catch (error) { reject(error); return; }
    let termination = null, settled = false, lineBuffer = "", stderr = "";
    const events = [];
    const terminate = () => termination ||= stopProcessTree(child);
    const traceDiagnostic = () => JSON.stringify({ events, stderr:stderr.slice(-4000) });
    const remember = (event, invalid = false) => {
      const summary = invalid
        ? { type:"invalid-json", preview:String(event).slice(0, 200) }
        : {
            type:String(event?.type || "unknown"),
            ...(event?.subtype ? { subtype:String(event.subtype) } : {}),
            ...(event?.model ? { model:String(event.model) } : {}),
            ...(Array.isArray(event?.tools) ? { tools:event.tools.map(String).slice(0, 32) } : {}),
            ...(Array.isArray(event?.mcp_servers) ? { mcpServers:event.mcp_servers.length } : {}),
          };
      events.push(summary);
      if (events.length > 64) events.shift();
    };
    const finishEarly = content => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      const cleanupReady = terminate();
      resolve({ code:0, content, stderr, traceDiagnostic:traceDiagnostic(), cleanupReady, deferCleanup:true });
    };
    const failEarly = error => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      error.traceDiagnostic ||= traceDiagnostic();
      error.cleanupReady = terminate();
      error.deferCleanup = true;
      reject(error);
    };
    const handleLine = rawLine => {
      const line = rawLine.replace(/\r$/, "").trim();
      if (!line || settled) return;
      if (Buffer.byteLength(line, "utf8") > MAX_CAPTURE_BYTES) return failEarly(new Error("Claude CLI produced an oversized JSON event."));
      let event;
      try { event = JSON.parse(line); }
      catch { remember(line, true); return; }
      remember(event);
      if (event?.type === "system" && event?.subtype === "init") {
        if (Array.isArray(event.tools) && event.tools.length) return failEarly(new Error(`Claude CLI exposed disabled tools: ${event.tools.map(String).join(", ")}.`));
        if (Array.isArray(event.mcp_servers) && event.mcp_servers.length) return failEarly(new Error("Claude CLI connected MCP servers despite strict isolation."));
      }
      const toolName = toolUseName(event);
      if (toolName) return failEarly(new Error(`Claude CLI attempted disabled tool use: ${toolName}.`));
      if (event?.type !== "result") return;
      let content;
      try { content = claudeEventResult(event); }
      catch (error) { return failEarly(error); }
      if (Buffer.byteLength(content, "utf8") > MAX_CAPTURE_BYTES) return failEarly(new Error("Claude CLI final response is too large."));
      if (signal?.aborted) return failEarly(abortError());
      finishEarly(content);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      if (settled) return;
      lineBuffer += chunk;
      let newline;
      while ((newline = lineBuffer.indexOf("\n")) >= 0 && !settled) {
        const line = lineBuffer.slice(0, newline);
        lineBuffer = lineBuffer.slice(newline + 1);
        handleLine(line);
      }
      if (!settled && Buffer.byteLength(lineBuffer, "utf8") > MAX_CAPTURE_BYTES) failEarly(new Error("Claude CLI produced an oversized unterminated JSON event."));
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { if (!settled) stderr = appendTail(stderr, chunk); });
    const onAbort = () => failEarly(abortError());
    signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", error => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      error.traceDiagnostic ||= traceDiagnostic();
      reject(error);
    });
    child.once("close", code => {
      if (settled) return;
      if (lineBuffer.trim()) handleLine(lineBuffer);
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return reject(abortError());
      resolve({ code, content:null, stderr, traceDiagnostic:traceDiagnostic(), cleanupReady:Promise.resolve(), deferCleanup:false });
    });
    child.stdin.on("error", error => { if (error.code !== "EPIPE") failEarly(error); });
    child.stdin.end(input);
  });
}

async function callClaudeCli({ executable, model, effort, systemPrompt, prompt, atlasImage, signal, env = process.env }) {
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "penecho-claude-"));
  let caughtError = null, cleanupReady = Promise.resolve(), deferCleanup = false;
  try {
    await fs.promises.chmod(workDir, 0o700).catch(() => {});
    const launch = resolveClaudeLaunch(executable, env), args = buildClaudeArgs({ systemPrompt, model, effort }), input = claudeInput(prompt, atlasImage), childEnv = sanitizeClaudeEnv(env, effort), result = await runProcess(launch, args, input, workDir, childEnv, signal);
    cleanupReady = result.cleanupReady || cleanupReady;
    deferCleanup = Boolean(result.deferCleanup);
    if (signal?.aborted) throw abortError();
    if (result.content) return result.content;
    if (result.code !== 0) {
      const error = new Error(`Claude CLI failed with exit code ${result.code}.`);
      error.diagnostic = result.stderr.slice(-4000);
      error.traceDiagnostic = result.traceDiagnostic;
      throw error;
    }
    const error = new Error("Claude CLI returned no result event.");
    error.traceDiagnostic = result.traceDiagnostic;
    throw error;
  } catch (error) {
    caughtError = error;
    cleanupReady = error.cleanupReady || cleanupReady;
    deferCleanup = deferCleanup || Boolean(error.deferCleanup);
    throw error;
  }
  finally {
    const cleanup = async () => {
      await cleanupReady.catch(() => {});
      await fs.promises.rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    };
    if (deferCleanup) {
      void cleanup().catch(() => {});
    } else {
      try { await cleanup(); }
      catch (cleanupError) { if (caughtError) caughtError.cleanupDiagnostic = cleanupError.message; else throw new Error(`Claude CLI temporary directory cleanup failed: ${cleanupError.message}`); }
    }
  }
}

module.exports = { buildClaudeArgs, callClaudeCli, claudeInput, claudeResult, resolveClaudeLaunch, sanitizeClaudeEnv };
