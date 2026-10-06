"use strict";
// Real HTTPS MCP against canonical source with an isolated Electron profile.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), https = require("node:https"), crypto = require("node:crypto");
const ROOT = path.resolve(__dirname, ".."), OUTPUT = path.join(ROOT, "docs/verification/mcp-bugs-20261004/isolated");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-mcp-diagnosis-"));
app.setPath("userData", path.join(temporary, "electron"));
app.on("window-all-closed", () => {});
Object.assign(process.env, { NODE_ENV: "test", PENECHO_TEST_OPEN_ACCESS: "1", PENECHO_STATE_DIR: path.join(temporary, "state"), HOST: "127.0.0.1", PORT: "0", AI_PROVIDER: "api", AI_API_KEY: "isolated-diagnosis", AI_API_URL: "http://127.0.0.1:1/v1", AI_API_MODEL: "test", PENECHO_CANVAS_AGENT_AUTO_OPEN: "false", PENECHO_REQUEST_TRACE: "false" });
require("../src/server/mcp/records.js").registryStateDirectory = () => path.join(temporary, "registry");
const report = { testedAt: new Date().toISOString(), environment: "isolated canonical Electron and real local HTTPS MCP", calls: [], rendererErrors: [], sourceHashes: {} };
let server, window, status, token, handle, sequence = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(check, label) { for (let i = 0; i < 100; i++) { if (await check()) return; await pause(100); } throw Error(`Timed out: ${label}`); }
function save() { fs.mkdirSync(OUTPUT, { recursive: true }); fs.writeFileSync(path.join(OUTPUT, "results.json"), JSON.stringify(report, null, 2) + "\n"); }
function rpc(method, params, connection = handle) {
  return new Promise((resolve, reject) => {
    const request = https.request(status.ipDirect.url, { method: "POST", ca: status.certificatePem, agent: false, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", ...(connection ? { "mcp-session-id": connection } : {}) } }, response => {
      let bytes = ""; response.on("data", chunk => bytes += chunk); response.on("end", () => resolve({ status: response.statusCode, handle: response.headers["mcp-session-id"], body: bytes ? JSON.parse(bytes) : null }));
    });
    request.setTimeout(45000, () => request.destroy(Error("MCP request timed out"))); request.on("error", reject);
    request.end(JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, params }));
  });
}
function clean(value, label) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(item => clean(item, label));
  if (value.type === "image" && value.data) { const file = label + (value.mimeType === "image/webp" ? ".webp" : ".png"); fs.writeFileSync(path.join(OUTPUT, file), Buffer.from(value.data, "base64")); return { type: "image", mimeType: value.mimeType, localFile: file }; }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "imageUpload" ? { omitted: "authorization transport metadata" } : clean(item, label)]));
}
async function call(label, name, args, connection = handle) {
  const startedAt = Date.now(); const result = await rpc("tools/call", { name, arguments: args }, connection);
  report.calls.push({ label, name, arguments: args, elapsedMs: Date.now() - startedAt, status: result.status, body: clean(result.body, label) }); save();
  const body = result.body?.result, value = body?.structuredContent || (() => { try { return JSON.parse(body?.content?.find(item => item.type === "text")?.text); } catch { return null; } })();
  console.log(JSON.stringify({ label, isError: body?.isError, result: value?.content ? { path: value.path, revision: value.revision, bytes: value.content.length } : value }));
  return value;
}
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    for (const file of ["public/app.js", "public/widget-host.js", "public/note-card.js", "src/server/mcp/schema.js", "src/client/app/canvas-documents.js"])
      report.sourceHashes[file] = crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex");
    server = require("../server.js"); await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    window.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.rendererErrors.push(message); });
    const js = code => window.webContents.executeJavaScript(code, true);
    await window.loadURL(`http://127.0.0.1:${server.address().port}`); await wait(() => js("!!window.PenEchoLocalMcp"), "Canvas ready");
    await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();true");
    let local = await js("window.PenEchoLocalMcp.api('status')");
    await js(`window.PenEchoLocalMcp.api('ip-direct',{action:'generate-token',host:'127.0.0.1',port:${local.http.ipDirect.listenerPort},revision:${local.http.ipDirect.revision}})`);
    await js("window.PenEchoLocalMcp.enable();true");
    local = await js("window.PenEchoLocalMcp.api('status')"); status = local.http; token = status.ipDirect.accessToken;
    const initialized = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "isolated-codex-diagnosis", version: "1" } }, null); handle = initialized.handle;
    const schemas = await rpc("tools/list", {}); fs.writeFileSync(path.join(OUTPUT, "schemas.json"), JSON.stringify(schemas.body.result.tools, null, 2));
    let canvases; await wait(async () => { canvases = await call("canvases", "penecho_list_canvases", {}); return canvases?.canvases?.length; }, "MCP browser connected");
    const target = canvases.canvases.find(item => item.active) || canvases.canvases[0];
    const sessionArgs = { title: "Isolated MCP bug diagnosis", client: "codex-diagnosis", sessionKey: "isolated-mcp-bugs-20261004", instanceId: canvases.instanceId, canvasId: target.canvasId, documentId: target.documentId, restore: false };
    const started = await call("start", "penecho_start_session", sessionArgs), sessionId = started.sessionId;
    await call("show", "penecho_open_canvas", { instanceId: canvases.instanceId, canvasId: target.canvasId, documentId: target.documentId, requestId: "show-isolated", show: true });
    for (const [label, extra] of [["list-default", {}], ["list-root", { path: "/" }], ["list-empty", { path: "" }], ["list-canvas", { path: "canvas.json" }]]) await call(label, "penecho_list_files", { sessionId, ...extra });
    const html = "<!doctype html>\n<html lang=\"zh\"><head><meta charset=\"utf-8\"><style>body{margin:0;padding:24px;box-sizing:border-box;font:20px system-ui;background:#eef4ff;color:#18335a}h1{font-size:28px}</style></head><body><h1>MCP 静态截图对照</h1><p>无动效和外部资源。</p></body></html>";
    await call("static-html", "penecho_present_widget", { sessionId, artifactId: "static-html", requestId: "static-html", title: "静态 HTML 截图对照", html, width: 600, height: 300 });
    const noteArgs = { sessionId, artifactId: "note-formula", requestId: "note-formula", title: "链式法则复测", note: { title: "链式法则复测", style: "card", category: "formula", tags: ["calculus"], summary: "MCP note 写入验证测试。", blocks: [{ type: "formula", latex: "\\frac{d}{dx}f(g(x))=f'(g(x))\\,g'(x)" }, { type: "keypoints", items: ["先求外层导数", "再乘内层导数"] }] } };
    await call("note-formula", "penecho_present_widget", noteArgs);
    const objectResult = await call("objects-after-note", "penecho_read_file", { sessionId, path: "objects/index.json" });
    const noteObject = JSON.parse(objectResult.content).find(item => item.title === noteArgs.title);
    if (noteObject) {
      for (const file of ["widget.source", "widget.json", "widget.html"]) {
        const read = await call("note-" + file.replace(".", "-"), "penecho_read_file", { sessionId, path: `objects/${noteObject.id}/${file}` });
        if (file === "widget.html") {
          const validated = require("../src/server/mcp/schema.js").validateToolArguments("penecho_present_widget", noteArgs);
          report.noteHtmlComparison = { equal: read.content === validated.html, expectedBytes: validated.html.length, storedBytes: read.content.length, firstDifference: [...validated.html].findIndex((character, index) => character !== read.content[index]) };
          fs.writeFileSync(path.join(OUTPUT, "note-expected.html"), validated.html); fs.writeFileSync(path.join(OUTPUT, "note-stored.html"), read.content);
        }
        if (file === "widget.source") {
          const validated = require("../src/server/mcp/schema.js").validateToolArguments("penecho_present_widget", noteArgs);
          report.noteSourceJsonEqual = JSON.stringify(JSON.parse(validated.copyText)) === JSON.stringify(JSON.parse(read.content));
        }
      }
    }
    await call("note-without-math", "penecho_present_widget", { sessionId, artifactId: "note-plain", requestId: "note-plain", title: "无公式笔记对照", note: { title: "无公式笔记对照", style: "card", category: "formula", blocks: [{ type: "markdown", text: "只有普通文字，用于排除 category 规范化本身造成误报。" }] } });
    await pause(350);
    await call("list-objects", "penecho_list_files", { sessionId, path: "objects", limit: 100 });
    for (const count of [3, 2]) await call(`line-${count}-points`, "penecho_draw", { sessionId, requestId: `line-${count}`, artifactId: `line-${count}`, title: `${count} point line`, items: [{ id: "line", type: "line", points: [{ x: 10, y: 10 }, { x: 100, y: 100 }, ...(count === 3 ? [{ x: 180, y: 10 }] : [])], color: "#2563eb", strokeWidth: 3 }] });
    await call("objects-after-lines", "penecho_read_file", { sessionId, path: "objects/index.json" });
    await call("native-text", "penecho_edit_canvas", { sessionId, requestId: "native-text", action: "create_text", text: "MCP native text control" });
    const beforeInk = await call("canvas-before-ink", "penecho_read_file", { sessionId, path: "canvas.json" });
    await call("draw-ink", "penecho_edit_canvas", { sessionId, requestId: "ink", action: "draw_ink", baseRevision: JSON.parse(beforeInk.content).revision, strokes: [{ color: "#2563eb", width: 4, points: [{ x: 40, y: 80 }, { x: 120, y: 50 }, { x: 190, y: 90 }] }] });
    const second = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "second-connection", version: "1" } }, null);
    await call("cross-connection-inspect", "penecho_inspect_session", { sessionId }, second.handle);
    await call("cross-connection-close", "penecho_close_session", { sessionId }, second.handle);
    for (const targetName of ["artifact", "viewport", "canvas"]) await call("capture-static-" + targetName, "penecho_capture_canvas", { sessionId, target: targetName, ...(targetName === "artifact" ? { artifactId: "static-html" } : {}) });
    // Add one looping scene only after the static-only capture baseline.
    await call("looping-motion", "penecho_present_widget", { sessionId, artifactId: "motion", requestId: "motion", title: "Looping motion control", scene: { engine: "motion", loop: true, actors: [{ id: "dot", type: "circle", x: 100, y: 100, r: 16, fill: "blue" }], beats: [{ steps: [{ do: "move", target: "dot", by: [180, 0], dur: 1 }] }] }, width: 600, height: 300 });
    await call("capture-static-with-motion", "penecho_capture_canvas", { sessionId, target: "artifact", artifactId: "static-html" });
    await call("capture-motion", "penecho_capture_canvas", { sessionId, target: "artifact", artifactId: "motion" });
    await pause(350);
    await call("capture-motion-after-settle", "penecho_capture_canvas", { sessionId, target: "artifact", artifactId: "motion" });
    await call("capture-viewport-with-motion", "penecho_capture_canvas", { sessionId, target: "viewport" });
    const resumed = await call("resume-same-key-second-connection", "penecho_start_session", sessionArgs, second.handle);
    await call("canvas-after-resume", "penecho_read_file", { sessionId: resumed.sessionId, path: "canvas.json" }, second.handle);
    await call("inspect-after-resume", "penecho_inspect_session", { sessionId: resumed.sessionId }, second.handle);
    await call("close-resumed", "penecho_close_session", { sessionId: resumed.sessionId }, second.handle);
    await call("close-original", "penecho_close_session", { sessionId });
    report.finalTransportSessionCount = (await js("window.PenEchoLocalMcp.api('status')")).http.ipDirect.sessionCount;
    fs.writeFileSync(path.join(OUTPUT, "window.png"), (await window.webContents.capturePage()).toPNG());
    report.completed = true;
  } catch (error) { report.error = error.stack; console.error(error.message); }
  finally {
    save(); window?.destroy();
    if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
    await pause(100); fs.rmSync(temporary, { recursive: true, force: true });
    app.exit(report.completed ? 0 : 1);
  }
});
