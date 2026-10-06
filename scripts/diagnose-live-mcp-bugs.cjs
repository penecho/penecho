"use strict";
// Read-only protocol discovery uses the existing MCP credential in memory.
// No credentials, transport handles, or upload authorization are saved.
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "docs/verification/mcp-bugs-20261004");
const configuration = fs.readFileSync("/Users/heack/.codex/config.toml", "utf8");
const sections = {};
let section = "";
for (const line of configuration.split("\n")) {
  if (line.trim().startsWith("[")) {
    section = line.trim().slice(1, -1).trim();
    sections[section] = "";
  } else sections[section] = (sections[section] || "") + "\n" + line;
}
function field(name, key) {
  const match = sections[name]?.match(new RegExp(`^${key}\\s*=\\s*(".*")\\s*$`, "m"));
  if (!match) throw Error(`Missing configured MCP field: ${key}`);
  return JSON.parse(match[1]);
}
const endpoint = field("mcp_servers.penecho-cloud", "url");
const authorization = field("mcp_servers.penecho-cloud.http_headers", "Authorization");
let sequence = 0;
async function rpc(method, params, handle) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(handle ? { "mcp-session-id": handle } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, params }),
    signal: AbortSignal.timeout(45000),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); }
  catch { body = text.split("\n").filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5))).at(-1); }
  return { status: response.status, handle: response.headers.get("mcp-session-id"), body };
}
async function initialize(name) {
  const result = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name, version: "1" } });
  if (result.body?.error || result.status !== 200) throw Error("MCP initialization failed");
  return result.handle;
}
async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const handle = await initialize("codex-live-bug-diagnosis");
  const result = await rpc("tools/list", {}, handle);
  if (!result.body?.result?.tools) throw Error("MCP tools/list failed");
  const tools = result.body.result.tools;
  fs.writeFileSync(path.join(OUTPUT, "live-schemas.json"), JSON.stringify(tools, null, 2) + "\n");
  if (!process.argv.includes("--run")) for (const name of ["penecho_draw", "penecho_present_widget", "penecho_open_canvas", "penecho_capture_canvas", "penecho_start_session"])
    console.log(JSON.stringify(tools.find(tool => tool.name === name)));
  if (process.argv.includes("--run")) {
    const evidence = { testedAt: new Date().toISOString(), transport: "configured penecho-cloud HTTPS MCP", calls: [] };
    const save = () => fs.writeFileSync(path.join(OUTPUT, "live-results.json"), JSON.stringify(evidence, null, 2) + "\n");
    function withoutImages(value, label) {
      if (!value || typeof value !== "object") return value;
      if (Array.isArray(value)) return value.map(item => withoutImages(item, label));
      if (value.type === "image" && value.data) {
        const file = label.replace(/[^a-z0-9-]/gi, "-") + ".png";
        fs.writeFileSync(path.join(OUTPUT, file), Buffer.from(value.data, "base64"));
        return { type: "image", mimeType: value.mimeType, localFile: file };
      }
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "imageUpload" ? { omitted: "authorization transport metadata" } : withoutImages(item, label)]));
    }
    async function call(label, name, args, currentHandle = handle) {
      const start = Date.now();
      let result;
      try { result = await rpc("tools/call", { name, arguments: args }, currentHandle); }
      catch (error) { result = { transportError: error.message }; }
      const body = withoutImages(result.body, label);
      evidence.calls.push({ label, name, arguments: args, status: result.status, elapsedMs: Date.now() - start, body, ...(result.transportError ? { transportError: result.transportError } : {}) });
      save();
      const content = body?.result?.structuredContent || body?.result?.content?.find(item => item.type === "text")?.text || body?.error || result.transportError;
      console.log(JSON.stringify({ label, status: result.status, result: typeof content === "string" ? content.slice(0, 700) : content }));
      const raw = result.body?.result;
      if (raw?.structuredContent) return raw.structuredContent;
      try { return JSON.parse(raw?.content?.find(item => item.type === "text")?.text); } catch { return null; }
    }
    const listed = await call("canvases", "penecho_list_canvases", {});
    const target = listed?.canvases?.find(item => item.title === "MCP 问题复测 · 2026-10-04");
    if (!target) throw Error("Dedicated diagnostic Canvas is unavailable; existing documents were preserved");
    const transient = process.argv.includes("--transient");
    const sessionArgs = { title: target.title, client: "codex", ...(!transient ? { sessionKey: "codex-mcp-bug-repro-01a102cd-20261004" } : {}), instanceId: listed.instanceId, canvasId: target.canvasId, documentId: target.documentId, restore: false };
    let started = await call("start", "penecho_start_session", sessionArgs);
    if (started?.code === "binding_timeout") started = await call("start-identical-retry", "penecho_start_session", sessionArgs);
    if (!started?.sessionId) throw Error("Diagnostic session could not be started");
    let sessionId = started.sessionId;
    const readCanvas = label => call(label, "penecho_read_file", { sessionId, path: "canvas.json" });
    try {
      await call("show", "penecho_open_canvas", { instanceId: started.instanceId, canvasId: target.canvasId, documentId: target.documentId, requestId: "repro-show-raw-20261004", show: true });
      for (const [label, extra] of [["list-default", {}], ["list-root", { path: "/" }], ["list-empty", { path: "" }], ["list-canvas", { path: "canvas.json" }]])
        await call(label, "penecho_list_files", { sessionId, ...extra });
      await readCanvas("canvas-before-note");
      await call("note-formula", "penecho_present_widget", { sessionId, artifactId: "bug-repro-note-formula", requestId: "repro-note-formula-valid-20261004", title: "链式法则复测", note: { title: "链式法则复测", style: "card", category: "formula", tags: ["calculus"], summary: "MCP note 写入验证测试。", blocks: [{ type: "formula", latex: "\\frac{d}{dx}f(g(x))=f'(g(x))\\,g'(x)" }, { type: "keypoints", items: ["先求外层导数", "再乘内层导数"] }] } });
      const objects = await call("objects-after-note", "penecho_read_file", { sessionId, path: "objects/index.json" });
      evidence.objectIndex = objects?.content;
      await call("list-objects", "penecho_list_files", { sessionId, path: "objects", limit: 100 });
      const index = JSON.parse(objects?.content || "null");
      const candidates = Array.isArray(index) ? index : index?.objects || index?.items || [];
      const noteObject = candidates.find(item => item.title === "链式法则复测" || item.sourceFormat === "penecho-note-card+json");
      if (noteObject) for (const file of ["widget.json", "widget.source", "widget.html"])
        await call("note-" + file.replace(".", "-"), "penecho_read_file", { sessionId, path: `objects/${noteObject.id || noteObject.objectId}/${file}` });
      for (const count of [3, 2]) await call(`line-${count}-points`, "penecho_draw", { sessionId, requestId: `repro-line-${count}-20261004`, artifactId: `repro-line-${count}`, title: `${count} 点 line 校验`, items: [{ id: "line", type: "line", points: [{ x: 10, y: 10 }, { x: 100, y: 100 }, ...(count === 3 ? [{ x: 180, y: 10 }] : [])], color: "#2563eb", strokeWidth: 3 }] });
      await call("native-text", "penecho_edit_canvas", { sessionId, requestId: "repro-native-text-20261004", action: "create_text", text: "MCP 复测：原生文本" });
      const beforeInk = await readCanvas("canvas-before-ink");
      if (beforeInk?.content) await call("draw-ink", "penecho_edit_canvas", { sessionId, requestId: "repro-ink-20261004", action: "draw_ink", baseRevision: JSON.parse(beforeInk.content).revision, strokes: [{ color: "#2563eb", width: 4, points: [{ x: 40, y: 80 }, { x: 120, y: 50 }, { x: 190, y: 90 }] }] });
      const secondHandle = await initialize("codex-bug-diagnosis-second-connection");
      await call("cross-connection-inspect", "penecho_inspect_session", { sessionId }, secondHandle);
      await call("same-connection-inspect", "penecho_inspect_session", { sessionId });
      // Captures run last so a transport reset cannot hide preceding evidence.
      for (const targetName of ["artifact", "viewport", "canvas"]) {
        await call("capture-static-" + targetName, "penecho_capture_canvas", { sessionId, target: targetName, ...(targetName === "artifact" ? { artifactId: "repro-static-html" } : {}) });
      }
      const currentList = await call("canvases-after-capture", "penecho_list_canvases", {});
      const recovered = await call(transient ? "resume-explicit-document-second-connection" : "resume-same-key-second-connection", "penecho_start_session", { ...sessionArgs, instanceId: currentList?.instanceId || sessionArgs.instanceId }, secondHandle);
      if (recovered?.sessionId) {
        sessionId = recovered.sessionId;
        await call("canvas-after-resume", "penecho_read_file", { sessionId, path: "canvas.json" }, secondHandle);
        await call("inspect-after-resume", "penecho_inspect_session", { sessionId }, secondHandle);
        await call("close-resumed-session", "penecho_close_session", { sessionId }, secondHandle);
      }
      await call("cross-connection-close", "penecho_close_session", { sessionId: started.sessionId }, secondHandle);
      await call("close-original-owned-session", "penecho_close_session", { sessionId: started.sessionId });
    } finally {
      const current = await call("final-canvases", "penecho_list_canvases", {});
      const original = current?.canvases?.find(item => item.documentId === "5bb13dd1-cf6b-46be-94f1-e70e64aa138a");
      if (original) await call("restore-original-view", "penecho_open_canvas", { instanceId: current.instanceId, canvasId: original.canvasId, documentId: original.documentId, requestId: "repro-restore-original-20261004", show: true });
      save();
    }
  }
  if (process.argv.includes("--connection-check")) {
    const input = JSON.parse(fs.readFileSync(path.join(OUTPUT, "session-target.json"), "utf8"));
    const checks = [];
    for (const name of ["penecho_inspect_session", "penecho_close_session"]) {
      const result = await rpc("tools/call", { name, arguments: { sessionId: input.sessionId } }, handle);
      checks.push({ name, result: result.body });
    }
    fs.writeFileSync(path.join(OUTPUT, "connection-check.json"), JSON.stringify(checks, null, 2) + "\n");
    console.log(JSON.stringify(checks));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
