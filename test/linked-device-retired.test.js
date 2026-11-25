"use strict";
require("./helpers/safety.js");
// Linked Device was retired on 2026-11-13. An old install's saved device is removed once and its Cloud sign-in kept;
// nothing connects to /relay/device again; the routes today's pages still call answer "no device"; and the Cloud
// sign-in with everything on it (library, Canvas save, Lines sync and share) keeps working against a stand-in Cloud.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { test } = require("node:test");
const { WebSocket } = require("ws");
const { CloudConnector } = require("../src/server/cloud-connector.js");
const { fakeCloud } = require("./fake-cloud-lines.js");

const ROOT = path.join(__dirname, "..");
const RETIRED_FIELDS = ["deviceToken", "token", "enabled", "cloudMcpEnabled", "deviceId", "deviceName", "platform", "pairedAt", "legacyAccountAccess"];
const NO_DEVICE = { configured:false, enabled:false, connected:false, state:"disconnected", id:null, name:null };
const RETIRED = { error:"linked_device_retired", message:"Linked Device has been retired. Keep a project in Cloud to use it from penecho.ai." };
const temporary = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const savedDevice = { deviceToken:"retired-device-token", token:"older-device-token", enabled:true, cloudMcpEnabled:true, deviceId:"device-id", deviceName:"Studio Mac", platform:"darwin 25.0.0", pairedAt:"2026-10-01T00:00:00.000Z", legacyAccountAccess:false };

test("a saved Linked Device is removed once on start and the Cloud sign-in beside it is kept as it was", t => {
  const stateDir = temporary("penecho-retired-device-"), file = path.join(stateDir, "cloud-device.json");
  t.after(() => fs.rmSync(stateDir, { recursive:true, force:true }));
  const signIn = { version:2, origin:"https://penecho.ai", accountToken:"kept-account-token", accountExpiresAt:"2099-01-01T00:00:00.000Z", account:{ id:"account-id", name:"Ada", credits:1000 }, accountUpdatedAt:1_700_000_000_000 };
  fs.writeFileSync(file, JSON.stringify({ ...signIn, ...savedDevice }), { mode:0o644 });

  const events = [], connector = new CloudConnector({ stateDir, logger:event => events.push(event) });
  t.after(() => connector.close());
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), signIn, "only the device left the file");
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(events.filter(event => event.event === "linked-device-removed").map(event => event.signedIn), [true]);
  const status = connector.status();
  assert.deepEqual([status.accountSession.signedIn, status.accountSession.credential, status.account.name, status.origin], [true, "opaque-local-session", "Ada", "https://penecho.ai"]);
  assert.deepEqual([status.state, status.lastError, status.cloudMcpEnabled, status.device], ["disconnected", null, false, NO_DEVICE]);
  assert.doesNotMatch(JSON.stringify(status), /device-token|kept-account-token/);
  assert.equal(connector.requireCloudAccount().accountToken, "kept-account-token");

  // The next start finds nothing to remove and leaves the file alone.
  const before = fs.readFileSync(file, "utf8"), again = [], next = new CloudConnector({ stateDir, logger:event => again.push(event) });
  t.after(() => next.close());
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.deepEqual(again, []);
  assert.equal(next.status().accountSession.signedIn, true);

  // Saving the sign-in never writes device fields back, whatever a caller hands it.
  next.writeConfiguration({ ...next.configuration, ...savedDevice, account:{ id:"account-id", name:"Ada Lovelace", credits:900 } });
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(RETIRED_FIELDS.filter(field => field in saved), []);
  assert.deepEqual([saved.accountToken, saved.account.name], ["kept-account-token", "Ada Lovelace"]);
});

test("an old install that signed in only through its Linked Device is signed out and asked to sign in", t => {
  for (const saved of [
    { version:1, origin:"https://penecho.ai", token:"legacy-device-token", deviceId:"legacy-device", enabled:false },
    { version:2, origin:"https://penecho.ai", ...savedDevice, legacyAccountAccess:true, account:{ id:"account-id", name:"Ada", credits:1000 } },
  ]) {
    const stateDir = temporary("penecho-retired-device-only-"), file = path.join(stateDir, "cloud-device.json");
    t.after(() => fs.rmSync(stateDir, { recursive:true, force:true }));
    fs.writeFileSync(file, JSON.stringify(saved), { mode:0o600 });
    const events = [], connector = new CloudConnector({ stateDir, logger:event => events.push(event) });
    t.after(() => connector.close());
    assert.equal(fs.existsSync(file), false, "nothing worth keeping is left");
    assert.deepEqual(events.filter(event => event.event === "linked-device-removed").map(event => event.signedIn), [false]);
    const status = connector.status();
    assert.deepEqual([status.accountSession.signedIn, status.account, status.origin, status.device], [false, null, null, NO_DEVICE]);
    assert.doesNotMatch(JSON.stringify(status), /device-token/);
    assert.throws(() => connector.requireCloudAccount(), error => error.code === "cloud_sign_in_required" && error.status === 401);
  }
});

// The stand-in Cloud: the account session and the Canvas routes here, the Lines routes from test/fake-cloud-lines.js.
// It counts every socket opened to it and every request to the retired device routes.
async function standInCloud() {
  const lines = await fakeCloud(), front = { lines, upgrades:[], asked:[], uploads:new Map() };
  const account = { id:"account-1", name:"Ann Lee", credits:1500 };
  const projectId = crypto.randomUUID(), canvasId = crypto.randomUUID();
  Object.assign(front, { projectId, canvasId });
  const json = (res, status, body) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk)).on("end", async () => {
      const url = new URL(req.url, "http://x"), body = Buffer.concat(chunks), signedIn = req.headers.authorization === "Bearer account-token";
      front.asked.push(`${req.method} ${url.pathname}`);
      if (url.pathname === "/api/v1/local-access/session") {
        if (req.method === "POST") return json(res, 201, { accessToken:"account-token", expiresAt:new Date(Date.now() + 86_400_000).toISOString(), account });
        if (req.method === "DELETE") { res.writeHead(204); return res.end(); }
        if (!signedIn) return json(res, 401, { error:"invalid_local_session", message:"Sign in." });
        return json(res, 200, { account, expiresAt:new Date(Date.now() + 86_400_000).toISOString() });
      }
      if (req.method === "PUT" && url.pathname.startsWith("/upload/")) { front.uploads.set(url.pathname.slice(8), body); res.writeHead(200); return res.end(); }
      if (!signedIn) return json(res, 401, { error:"unauthorized", message:"Sign in." });
      if (url.pathname === "/api/v1/device-sync/library") return json(res, 200, { account, folders:[], projects:[{ id:projectId, name:"Plans" }], canvases:[{ id:canvasId, projectId, name:"Garden plan" }], workspace:{ storageLimitBytes:200 * 1048576, storageUsedBytes:0 } });
      if (req.method === "POST" && url.pathname === `/api/v1/device-sync/canvases/${canvasId}/revisions`) {
        const revisionId = crypto.randomUUID();
        return json(res, 201, { revisionId, bundle:{ upload:{ url:`${front.origin}/upload/${revisionId}`, headers:{ "content-type":"application/json" } } } });
      }
      const completed = url.pathname.match(/^\/api\/v1\/device-sync\/canvas-revisions\/([0-9a-f-]{36})\/complete$/);
      if (req.method === "POST" && completed) return json(res, 200, { revision:{ id:completed[1], status:"complete", completedAt:Date.now() } });
      if (req.method === "GET" && url.pathname === "/api/v1/mcp") return json(res, 200, { url:`${front.origin}/mcp`, grants:[] });
      // A shared Lines project: the stand-in Lines Cloud keeps the files, the link is added here.
      const shared = url.pathname.match(/^\/api\/v1\/device-sync\/line-projects\/([^/]+)\/share$/);
      if (shared) {
        const project = (await (await fetch(`${lines.origin}/api/v1/device-sync/line-projects/${shared[1]}`, { headers:{ authorization:"Bearer account-token" } })).json()).project;
        return json(res, 200, { project:{ ...project, share:req.method === "POST" ? { url:`/p/${shared[1]}`, expiresAt:new Date(Date.now() + 7 * 86_400_000).toISOString() } : null } });
      }
      try {
        const answer = await fetch(`${lines.origin}${url.pathname}${url.search}`, { method:req.method, headers:Object.fromEntries(Object.entries(req.headers).filter(([name]) => ["authorization", "content-type", "accept"].includes(name))), body:["GET", "HEAD"].includes(req.method) ? undefined : body });
        res.writeHead(answer.status, { "content-type":answer.headers.get("content-type") || "application/json" });
        res.end(Buffer.from(await answer.arrayBuffer()));
      } catch { res.writeHead(502); res.end(); }
    });
  });
  server.on("upgrade", (req, socket) => { front.upgrades.push(req.url); socket.destroy(); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  front.origin = `http://127.0.0.1:${server.address().port}`;
  front.close = async () => { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); await lines.close(); };
  return front;
}

test("the retired device routes answer for today's pages, nothing connects to /relay/device, and the Cloud sign-in keeps working", async t => {
  const front = await standInCloud(), temp = temporary("penecho-retired-device-server-");
  t.after(async () => { await front.close(); fs.rmSync(temp, { recursive:true, force:true }); });
  const state = path.join(temp, "state"), saved = path.join(state, "cloud-device.json");
  fs.mkdirSync(state, { recursive:true });
  fs.writeFileSync(path.join(temp, "config.env"), "");
  // An install that had its device linked and switched on, with Cloud MCP on: before, it connected to /relay/device on start.
  fs.writeFileSync(saved, JSON.stringify({ version:2, origin:front.origin, accountToken:"account-token", accountExpiresAt:new Date(Date.now() + 86_400_000).toISOString(), account:{ id:"account-1", name:"Ann Lee", credits:1500 }, ...savedDevice }), { mode:0o600 });
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], { cwd:ROOT, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, HOME:path.join(temp, "home"), NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1",
    PENECHO_STATE_DIR:state, PENECHO_CLOUD_STATE_DIR:state, PENECHO_CONFIG_FILE:path.join(temp, "config.env"), HOST:"127.0.0.1", PORT:"0",
    PENECHO_CLOUD_ORIGIN:front.origin, AI_PROVIDER:"api", AI_API_KEY:"fixture", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"fixture",
    PENECHO_JEVISION_ENABLED:"false", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent" } });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exited = new Promise(resolve => child.once("exit", resolve)); child.kill(); await exited; } });
  const origin = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(Error(`The server did not start: ${output}`)), 20000);
    child.stdout.on("data", chunk => { output += chunk; const match = output.match(/PenEcho: http:\/\/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } });
    child.stderr.on("data", chunk => { output += chunk; });
    child.once("exit", code => { clearTimeout(timer); reject(Error(`The server stopped (${code}): ${output}`)); });
  });
  const script = await (await fetch(`${origin}/api/config.js`)).text(), config = JSON.parse(script.slice(script.indexOf("=") + 1).replace(/;\s*$/, ""));
  const headers = { origin, "x-penecho-session":config.accessSessionToken, "content-type":"application/json" };
  const call = async (method, route, body) => {
    const response = await fetch(`${origin}${route}`, { method, headers, ...(body === undefined ? {} : { body:JSON.stringify(body) }) });
    const text = await response.text();
    let value = {}; try { value = JSON.parse(text); } catch { value = { text }; }
    return { status:response.status, body:value };
  };

  // On start the device left the saved file; the sign-in stayed and the page config says so.
  const cleaned = JSON.parse(fs.readFileSync(saved, "utf8"));
  assert.deepEqual(RETIRED_FIELDS.filter(field => field in cleaned), []);
  assert.equal(cleaned.accountToken, "account-token");
  assert.equal(config.cloudAccountSignedIn, true);

  // What today's pages read: signed in, and the device parts all say "no device".
  const status = await call("GET", "/api/cloud/status");
  assert.equal(status.status, 200);
  assert.deepEqual([status.body.accountSession.signedIn, status.body.account.name, status.body.origin], [true, "Ann Lee", front.origin]);
  assert.deepEqual([status.body.state, status.body.lastError, status.body.cloudMcpEnabled, status.body.device], ["disconnected", null, false, NO_DEVICE]);

  // Linking answers that the device is gone; switching it off succeeds with the "no device" status.
  for (const route of ["/api/cloud/pair", "/api/cloud/device/enable"]) assert.deepEqual(await call("POST", route, { code:"PEN-ABCD-2345" }), { status:410, body:RETIRED });
  for (const route of ["/api/cloud/device/disable", "/api/cloud/device/revoke"]) {
    const answer = await call("POST", route, {});
    assert.equal(answer.status, 200);
    assert.deepEqual([answer.body.device, answer.body.cloudMcpEnabled, answer.body.accountSession.signedIn], [NO_DEVICE, false, true]);
  }
  assert.deepEqual(await call("POST", "/api/cloud/mcp/access", { enabled:true }), { status:410, body:RETIRED });
  const mcpOff = await call("POST", "/api/cloud/mcp/access", { enabled:false });
  assert.deepEqual([mcpOff.status, mcpOff.body.cloudMcpEnabled, mcpOff.body.device], [200, false, NO_DEVICE]);
  assert.equal((await call("POST", "/api/cloud/mcp/access", { enabled:"yes" })).status, 400);
  const mcp = await call("GET", "/api/cloud/mcp");
  assert.deepEqual([mcp.status, mcp.body.grants, mcp.body.local], [200, [], { cloudMcpEnabled:false, device:null }]);

  // A page that still opens the Cloud MCP socket is closed at once, cleanly.
  const closed = await new Promise((resolve, reject) => {
    const socket = new WebSocket(`${origin.replace("http:", "ws:")}/api/mcp/cloud-canvas`, { headers:{ origin, "x-penecho-session":config.accessSessionToken } });
    socket.once("close", (code, reason) => resolve({ code, reason:String(reason) }));
    socket.once("unexpected-response", (_request, response) => reject(Error(`HTTP ${response.statusCode}`)));
  });
  assert.deepEqual(closed, { code:4410, reason:"Linked Device has been retired." });

  // The library and a Canvas save go through the account session.
  const library = await call("GET", "/api/cloud/library?limit=24");
  assert.deepEqual([library.status, library.body.canvases.map(canvas => canvas.name)], [200, ["Garden plan"]]);
  const bundle = { bundleVersion:2, formatVersion:1, mode:"snapshot", name:"Garden plan", manifest:{ objects:[] }, assets:[] };
  const savedCanvas = await call("POST", `/api/cloud/canvases/${front.canvasId}/save`, { bundle, baseRevisionId:null });
  assert.equal(savedCanvas.status, 200, JSON.stringify(savedCanvas.body));
  assert.deepEqual(JSON.parse(front.uploads.get(savedCanvas.body.revision.id).toString("utf8")), bundle);

  // Lines: Sync keeps the project in Cloud, and Share gives its link.
  const made = await call("POST", "/api/lines/projects", { name:"Garden", docsPath:path.join(temp, "docs", "Garden") });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const project = made.body.project;
  fs.mkdirSync(path.join(project.docsPath, "notes"), { recursive:true });
  fs.writeFileSync(path.join(project.docsPath, "notes", "plan.md"), "Plant tomatoes.\n");
  // Sync takes what a Line or the project's knowledge shows (PE-581), so a page there links the note.
  fs.writeFileSync(path.join(project.docsPath, "README.md"), "See [the plan](notes/plan.md).\n");
  const synced = await call("POST", `/api/lines/projects/${project.id}/cloud`, { sync:true });
  assert.equal(synced.status, 200, JSON.stringify(synced.body));
  assert.equal(front.lines.text(project.id, "notes/plan.md"), "Plant tomatoes.\n");
  const shared = await call("POST", `/api/lines/projects/${project.id}/share`, {});
  assert.equal(shared.status, 200, JSON.stringify(shared.body));
  assert.equal(shared.body.link, `${front.origin}/p/${project.id}`);

  // Sign out and in again: the new sign-in is saved alone.
  assert.equal((await call("POST", "/api/cloud/sign-out", {})).body.accountSession.signedIn, false);
  const signedIn = await call("POST", "/api/cloud/sign-in", { origin:front.origin, code:"local-sign-in-code-0123456789abcdef" });
  assert.deepEqual([signedIn.status, signedIn.body.accountSession.signedIn, signedIn.body.device], [200, true, NO_DEVICE]);
  const resaved = JSON.parse(fs.readFileSync(saved, "utf8"));
  assert.deepEqual([resaved.accountToken, RETIRED_FIELDS.filter(field => field in resaved)], ["account-token", []]);

  // Not one socket to Cloud, and nothing asked of the retired device routes.
  assert.deepEqual(front.upgrades, []);
  assert.deepEqual(front.asked.filter(line => /\/relay\/|\/api\/v1\/device\/|\/api\/v1\/device-sync\/device$|\/api\/v1\/mcp\/device-canvas/.test(line)), []);
});
