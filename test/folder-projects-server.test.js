"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), https = require("node:https"), { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const bundle = (name, tile = PNG) => ({
  version:2, bundleVersion:2, mode:"snapshot", formatVersion:1, name,
  manifest:{ format:"penecho-raster-tiles", formatVersion:1, canvasSize:{ width:20000, height:20000 }, tileSize:512, theme:"studio", view:{ scale:0.5, panX:0, panY:0, navigationLocked:false }, animations:[], textBoxes:[], extensions:{} },
  assets:[{ kind:"preview", contentType:"image/png", metadata:{ width:1, height:1 }, dataBase64:PNG }, { kind:"tile", contentType:"image/png", metadata:{ tileKey:"0,0" }, dataBase64:tile }],
});

async function startServer(temp) {
  fs.writeFileSync(path.join(temp, "config.env"), "");
  // HOME keeps the MCP registry and its HTTPS identity inside this test.
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], { cwd:ROOT, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, HOME:path.join(temp, "home"), NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1",
    PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "state"), PENECHO_CONFIG_FILE:path.join(temp, "config.env"), HOST:"127.0.0.1", PORT:"0",
    AI_PROVIDER:"api", AI_API_KEY:"fixture", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"fixture", PENECHO_JEVISION_ENABLED:"false", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" } });
  const origin = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(Error("Isolated server startup timed out")), 15000);
    child.stdout.on("data", chunk => { output += chunk; const match = output.match(/PenEcho: http:\/\/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } });
    child.once("exit", code => reject(Error(`server exited ${code}`)));
  });
  return { child, origin };
}
function mcp(http, body, session) {
  return new Promise((resolve, reject) => {
    const req = https.request(http.localUrl, { method:"POST", ca:http.certificatePem, agent:false, headers:{ authorization:`Bearer ${http.accessToken}`, "content-type":"application/json", ...(session ? { "mcp-session-id":session } : {}) } }, res => {
      let data = ""; res.on("data", chunk => data += chunk); res.on("end", () => resolve({ session:res.headers["mcp-session-id"], body:JSON.parse(data) }));
    });
    req.on("error", reject); req.end(JSON.stringify({ jsonrpc:"2.0", id:1, ...body }));
  });
}

test("an agent opens its folder's page in the local app; signed out, its Canvases save into a Library project named after the folder", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-folder-projects-"));
  const { child, origin } = await startServer(temp);
  try {
    let status;
    for (let attempt = 0; attempt < 100 && !status?.http?.enabled; attempt++) {
      status = await (await fetch(`${origin}/api/mcp/status`, { headers:{ origin } })).json();
      if (!status?.http?.enabled) await new Promise(resolve => setTimeout(resolve, 100));
    }
    const session = (await mcp(status.http, { method:"initialize", params:{} })).session;
    const tools = (await mcp(status.http, { method:"tools/list" }, session)).body.result.tools;
    assert.ok(tools.some(tool => tool.name === "penecho_open_workspace"), "the local app lists its folder tool");
    const open = async folder => (await mcp(status.http, { method:"tools/call", params:{ name:"penecho_open_workspace", arguments:{ folder, sessionKey:"conversation-a" } } }, session)).body.result.structuredContent;
    const opened = await open("/Users/me/work/app/");
    assert.equal(opened.folder, "app");
    assert.equal(opened.alreadyConnected, false);
    assert.equal(opened.url, `${origin}/?workspace=${opened.workspaceId}&mcp=1&mode=companion`);
    assert.equal((await open("/Users/me/work/app")).workspaceId, opened.workspaceId, "the same folder, the same page");
    assert.notEqual((await open("/Users/me/work/app/.claude/worktrees/feature")).workspaceId, opened.workspaceId, "a worktree is another project");
    assert.equal((await mcp(status.http, { method:"tools/call", params:{ name:"penecho_open_workspace", arguments:{ folder:"" } } }, session)).body.result.isError, true);

    // The page is the Canvas page that also loads its folder's config.
    const page = await (await fetch(opened.url)).text(), id = opened.workspaceId;
    assert.ok(page.includes(`<script src="/api/config.js"></script><script src="/api/v1/mcp/workspaces/${id}/config.js"></script>`));
    assert.ok(!(await (await fetch(origin)).text()).includes("/api/v1/mcp/workspaces/"), "the regular page is unchanged");
    const config = JSON.parse((await (await fetch(`${origin}/api/v1/mcp/workspaces/${id}/config.js`)).text()).match(/^Object\.assign\(window\.PENECHO_CONFIG,(.*)\);$/)[1]);
    assert.deepEqual([config.browserDraftId, config.folderProject.name], [id, "app"]);
    const projects = (await (await fetch(`${origin}/api/canvas-projects`)).json()).projects;
    assert.deepEqual(projects.filter(project => project.id === config.folderProject.localProjectId).map(project => project.name), ["app"], "a Library project named after the folder");

    // The folder's Canvases: each save replaces the one it starts from.
    const api = (route, body) => fetch(`${origin}/api/v1/mcp/workspaces/${id}/${route}`, body ? { method:"POST", headers:{ origin, "content-type":"application/json" }, body:JSON.stringify(body) } : {});
    const created = await api("project/canvases", { name:"Plan", bundle:bundle("Plan") });
    assert.equal(created.status, 201, await created.clone().text());
    const { canvas, revision } = await created.json();
    assert.deepEqual([canvas.name, canvas.projectId], ["Plan", config.folderProject.localProjectId]);
    const saved = await (await api(`project/canvases/${canvas.id}/save`, { baseRevisionId:revision.id, bundle:bundle("Plan v2") })).json();
    assert.notEqual(saved.revision.id, revision.id);
    const stale = await api(`project/canvases/${canvas.id}/save`, { baseRevisionId:revision.id, bundle:bundle("Late") });
    assert.deepEqual([stale.status, (await stale.json()).code], [409, "revision_conflict"], "a save from an older revision comes back to merge");
    const read = await (await api(`project/canvases/${canvas.id}`)).json();
    assert.deepEqual([read.canvas.name, read.revision.id, read.bundle.bundleVersion], ["Plan v2", saved.revision.id, 2]);
    const library = (await (await fetch(`${origin}/api/canvases`)).json()).canvases;
    assert.deepEqual(library.filter(item => item.id === canvas.id).map(item => [item.name, item.projectId]), [["Plan v2", config.folderProject.localProjectId]], "one Canvas in the Library, its latest save");

    // Its tabs are the folder's, for every page of the folder.
    const tabbed = await (await api("project/tabs", { open:canvas.id })).json();
    assert.deepEqual(tabbed.tabs.map(tab => [tab.canvasId, tab.title, tab.revisionId]), [[canvas.id, "Plan v2", saved.revision.id]]);
    assert.equal((await api("project/tabs", { open:`${Date.now()}-not-in-project` })).status, 409);
    const view = await (await api("project")).json();
    assert.deepEqual([view.name, view.tabs.length, view.revision], ["app", 1, 1]);
    assert.equal((await fetch(`${origin}/api/v1/mcp/workspaces/${id}/project/tabs`, { method:"POST", headers:{ "content-type":"application/json" }, body:"{}" })).status, 403, "changes need the page's origin");
    const gone = await api(`project/canvases/${Date.now()}-123e4567-e89b-12d3-a456-426614174999/save`, { baseRevisionId:revision.id, bundle:bundle("Gone") });
    assert.equal(gone.status, 404, "a Canvas no longer in the project is saved again as new");
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = new Promise(resolve => child.once("exit", resolve)); child.kill(); await exited; }
    fs.rmSync(temp, { recursive:true, force:true });
  }
});
