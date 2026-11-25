"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const https = require("node:https");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
async function startServer(temp) {
  fs.writeFileSync(path.join(temp, "config.env"), "");
  // Every writable location is inside this test's temporary folder, never ~/.penecho.
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], { cwd:ROOT, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, HOME:path.join(temp, "home"), NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1",
    PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "state"), PENECHO_CONFIG_FILE:path.join(temp, "config.env"), PENECHO_CLOUD_ORIGIN:"http://127.0.0.1:1", HOST:"127.0.0.1", PORT:"0",
    AI_PROVIDER:"api", AI_API_KEY:"fixture", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"fixture", PENECHO_JEVISION_ENABLED:"false", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" } });
  let errors = ""; child.stderr.on("data", chunk => { errors += chunk; });
  const origin = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(Error(`Isolated server startup timed out: ${output}\n${errors}`)), 15000);
    child.stdout.on("data", chunk => { output += chunk; const match = output.match(/PenEcho: http:\/\/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } });
    child.once("exit", code => { clearTimeout(timer); reject(Error(`server exited ${code}: ${errors}`)); });
  });
  return { child, origin };
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.kill();
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited; clearTimeout(timer);
}
function mcp(http, body, session) {
  return new Promise((resolve, reject) => {
    const req = https.request(http.localUrl, { method:"POST", ca:http.certificatePem, agent:false, headers:{ authorization:`Bearer ${http.accessToken}`, "content-type":"application/json", ...(session ? { "mcp-session-id":session } : {}) } }, res => {
      let data = ""; res.on("data", chunk => data += chunk); res.on("end", () => resolve({ session:res.headers["mcp-session-id"], body:JSON.parse(data) }));
    });
    req.on("error", reject); req.end(JSON.stringify({ jsonrpc:"2.0", id:1, ...body }));
  });
}

test("the usage endpoint defaults on, counts successful local actions, and persists an explicit off marker", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-usage-server-")), { child, origin } = await startServer(temp);
  const stats = path.join(temp, "state", "usage-stats.json");
  try {
    const page = await fetch(`${origin}/`, { headers:{ "sec-fetch-dest":"document" } }), cookie = page.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
    const usage = async payload => {
      const response = await fetch(`${origin}/api/usage-stats`, payload === undefined ? { headers:{ cookie } } : { method:"POST", headers:{ origin, cookie, "content-type":"application/json" }, body:JSON.stringify(payload) });
      return { status:response.status, body:await response.json() };
    };
    const initial = await usage();
    assert.equal(initial.status, 200);
    assert.equal(initial.body.enabled, true);
    assert.equal(initial.body.ratingsEnabled, true);
    assert.match(initial.body.report.installation, /^[0-9a-f]{32}$/);
    assert.equal(initial.body.report.version, require("../package.json").version);
    assert.equal(initial.body.report.app, "local");
    assert.deepEqual(initial.body.report.days, [], "today is not part of the next completed-day report");
    const firstInstallation = initial.body.report.installation;

    assert.equal((await fetch(`${origin}/api/usage-stats`, { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ enabled:false }) })).status, 403, "a cross-site or cookie-less mutation is refused");
    assert.equal((await usage({ enabled:"yes" })).status, 400);
    assert.equal((await usage({ ratingsEnabled:"yes" })).status, 400);
    assert.equal((await usage({})).status, 400);

    let mcpStatus;
    for (let attempt = 0; attempt < 100 && !mcpStatus?.http?.enabled; attempt++) {
      mcpStatus = await (await fetch(`${origin}/api/mcp/status`, { headers:{ origin } })).json();
      if (!mcpStatus?.http?.enabled) await new Promise(resolve => setTimeout(resolve, 100));
    }
    const session = (await mcp(mcpStatus.http, { method:"initialize", params:{} })).session;
    const list = () => mcp(mcpStatus.http, { method:"tools/call", params:{ name:"penecho_list_canvases", arguments:{} } }, session);
    await list(); await list();

    const madeResponse = await fetch(`${origin}/api/lines/projects`, { method:"POST", headers:{ origin, cookie, "content-type":"application/json" }, body:JSON.stringify({ name:"Private project name", docsPath:path.join(temp, "private-docs") }) }), made = await madeResponse.json();
    assert.equal(madeResponse.status, 200, JSON.stringify(made));
    const projectId = made.project.id;
    const unsent = await fetch(`${origin}/api/lines/projects/${encodeURIComponent(projectId)}/unsent`, { method:"POST", headers:{ origin, cookie, "content-type":"application/json" }, body:JSON.stringify({ topic:"new", text:"A private prompt that must never leave" }) });
    assert.equal(unsent.status, 200);

    await new Promise(resolve => setTimeout(resolve, 2200));
    const storedText = fs.readFileSync(stats, "utf8"), stored = JSON.parse(storedText);
    const counts = Object.assign({}, ...Object.values(stored.days));
    assert.equal(counts.open, 1);
    assert.equal(counts["mcp.list_canvases"], 2);
    assert.equal(counts["project-new"], 1);
    assert.equal(counts["line-ask"], 1);
    assert.equal(counts["line-new"], 1);
    assert.doesNotMatch(storedText, /Private project name|private prompt|api\/lines\/projects/);

    const countsOff = await usage({ enabled:false });
    assert.equal(countsOff.status, 200);
    assert.equal(countsOff.body.enabled, false);
    assert.equal(countsOff.body.ratingsEnabled, true);
    assert.equal(countsOff.body.report.installation, firstInstallation);
    assert.deepEqual(countsOff.body.report.days, []);

    assert.deepEqual((await usage({ ratingsEnabled:false })).body, { enabled:false, ratingsEnabled:false, report:null });
    assert.deepEqual(JSON.parse(fs.readFileSync(stats, "utf8")), { enabled:false, ratingsEnabled:false });
    const enabled = await usage({ enabled:true, ratingsEnabled:true });
    assert.equal(enabled.body.enabled, true);
    assert.equal(enabled.body.ratingsEnabled, true);
    assert.notEqual(enabled.body.report.installation, firstInstallation);
    assert.deepEqual(enabled.body.report.days, []);
  } finally {
    await stop(child);
    fs.rmSync(temp, { recursive:true, force:true });
  }
});
