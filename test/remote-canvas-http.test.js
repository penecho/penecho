"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { createRemoteCanvasHttpExecutor, remoteCanvasTarget } = require("../src/server/remote-canvas-http.js");

const remoteCanvasClientSource = fs.readFileSync(path.resolve(__dirname, "../public/remote-canvas.js"), "utf8");
const serverSource = fs.readFileSync(path.resolve(__dirname, "../src/server/main.js"), "utf8");

test("Remote Canvas allows only reviewed local routes and methods", () => {
  assert.equal(remoteCanvasTarget("GET", "/api/canvases"), "/api/canvases");
  assert.equal(remoteCanvasTarget("PATCH", "/api/canvases/1234567890123-canvasname"), "/api/canvases/1234567890123-canvasname");
  assert.equal(remoteCanvasTarget("PATCH", "/api/cloud/canvases/123e4567-e89b-42d3-a456-426614174000"), "/api/cloud/canvases/123e4567-e89b-42d3-a456-426614174000");
  assert.equal(remoteCanvasTarget("GET", "/api/canvas-agent/projects"), "/api/canvas-agent/projects");
  assert.throws(() => remoteCanvasTarget("POST", "/api/canvas-agent/projects"), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/api/canvas-agent/host-roots"), /not available/);
  assert.throws(() => remoteCanvasTarget("POST", "/api/canvas-agent/projects/from-host-root"), /not available/);
  assert.equal(remoteCanvasTarget("DELETE", "/api/canvas-agent/projects/local-1234567890abcdef12345678"), "/api/canvas-agent/projects/local-1234567890abcdef12345678");
  assert.equal(remoteCanvasTarget("DELETE", "/api/canvas-agent/projects/file-1234567890abcdef12345678"), "/api/canvas-agent/projects/file-1234567890abcdef12345678");
  assert.equal(remoteCanvasTarget("GET", "/api/canvas-agent/projects/local-1234567890abcdef12345678/history"), "/api/canvas-agent/projects/local-1234567890abcdef12345678/history");
  assert.equal(remoteCanvasTarget("GET", "/api/canvas-agent/projects/file-1234567890abcdef12345678/history"), "/api/canvas-agent/projects/file-1234567890abcdef12345678/history");
  assert.equal(remoteCanvasTarget("PUT", "/api/canvas-agent/projects/local-1234567890abcdef12345678/history"), "/api/canvas-agent/projects/local-1234567890abcdef12345678/history");
  assert.equal(remoteCanvasTarget("GET", "/api/canvas-agent/roots"), "/api/canvas-agent/roots");
  assert.equal(remoteCanvasTarget("GET", "/api/canvas-agent/roots/root-1234567890abcdef12345678/entries?path="), "/api/canvas-agent/roots/root-1234567890abcdef12345678/entries?path=");
  assert.equal(remoteCanvasTarget("GET", "/api/canvas-agent/roots/root-1234567890abcdef12345678/entries?path=Work%2FNotes"), "/api/canvas-agent/roots/root-1234567890abcdef12345678/entries?path=Work%2FNotes");
  assert.equal(remoteCanvasTarget("GET", "/api/canvas-agent/roots/root-1234567890abcdef12345678/entries?path=AppData&approved=1"), "/api/canvas-agent/roots/root-1234567890abcdef12345678/entries?path=AppData&approved=1");
  assert.equal(remoteCanvasTarget("POST", "/api/canvas-agent/projects/from-root"), "/api/canvas-agent/projects/from-root");
  assert.equal(remoteCanvasTarget("POST", "/api/canvas-agent/files"), "/api/canvas-agent/files");
  assert.equal(remoteCanvasTarget("GET", "/api/cloud/community?sort=recent&kind=widget"), "/api/cloud/community?sort=recent&kind=widget");
  assert.equal(remoteCanvasTarget("GET", "/api/favorites?view=summary"), "/api/favorites?view=summary");
  assert.equal(remoteCanvasTarget("GET", `/api/favorites/${"a".repeat(64)}/thumbnail`), `/api/favorites/${"a".repeat(64)}/thumbnail`);
  assert.equal(remoteCanvasTarget("PATCH", `/api/favorites/${"a".repeat(64)}/cloud`), `/api/favorites/${"a".repeat(64)}/cloud`);
  assert.equal(remoteCanvasTarget("GET", "/api/cloud/favorites?view=summary"), "/api/cloud/favorites?view=summary");
  assert.equal(remoteCanvasTarget("GET", "/api/cloud/favorites/feed?kind=all&limit=20&cursor=next"), "/api/cloud/favorites/feed?kind=all&limit=20&cursor=next");
  assert.equal(remoteCanvasTarget("GET", "/api/cloud/favorites/123e4567-e89b-42d3-a456-426614174000"), "/api/cloud/favorites/123e4567-e89b-42d3-a456-426614174000");
  assert.equal(remoteCanvasTarget("POST", "/api/cloud/community/share"), "/api/cloud/community/share");
  assert.equal(remoteCanvasTarget("POST", "/api/widget-fetch"), "/api/widget-fetch");
  assert.equal(remoteCanvasTarget("POST", "/api/settings/search/test"), "/api/settings/search/test");
  assert.throws(() => remoteCanvasTarget("GET", "/api/settings/search/test"), /not available/);
  for (const target of [
    "/api/settings/connections", "/api/settings/connections/test",
    "/api/settings/connections/inspect-cli", "/api/settings/connections/models",
  ]) assert.equal(remoteCanvasTarget("POST", target), target);
  assert.throws(() => remoteCanvasTarget("GET", "/api/settings/connections/test"), /not available/);
  assert.throws(() => remoteCanvasTarget("POST", "/api/settings/connections/unknown"), /not available/);
  assert.equal(remoteCanvasTarget("GET", "/plugins/private/air-quality/plugin.md"), "/plugins/private/air-quality/plugin.md");
  assert.equal(remoteCanvasTarget("GET", "/plugins/private/air-quality/styles.css"), "/plugins/private/air-quality/styles.css");
  assert.equal(remoteCanvasTarget("GET", "/plugins/private/legacy-widget.md"), "/plugins/private/legacy-widget.md");
  assert.throws(() => remoteCanvasTarget("POST", "/plugins/private/air-quality/plugin.md"), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/plugins/private/air-quality/plugin.md?v=1"), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/plugins/general/plugin.md"), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/api/settings?secret=1"), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/api/canvas-agent/roots?path=Work"), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/api/canvas-agent/roots/root-1234567890abcdef12345678/entries?other=Work"), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/api/canvas-agent/roots/root-1234567890abcdef12345678/entries?path=Work&path=Notes"), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/api/canvas-agent/roots/root-1234567890abcdef12345678/entries?path=AppData&approved=0"), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/api/canvas-agent/roots/root-1234567890abcdef12345678/entries?path=AppData&approved=1&approved=1"), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/api/canvas-agent/roots/root-1234567890abcdef12345678/entries?path=..%2FSecrets"), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/api/canvas-agent/roots/root-1234567890abcdef12345678/entries?path=%2Fetc"), /not available/);
  assert.throws(() => remoteCanvasTarget("POST", "/api/canvas-agent/projects?path=%2Fetc"), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/api/local-access"), /not available/);
  for (const target of ["/api/ai/command", "/api/plugins/improve", "/api/settings"]) {
    assert.equal(remoteCanvasTarget("POST", target), target);
    assert.throws(() => remoteCanvasTarget("POST", `${target}?other=1`), /not available/);
  }
  for (const target of ["/api/ai/command", "/api/plugins/improve", "/api/ai/arbitrary"]) {
    assert.throws(() => remoteCanvasTarget("GET", target), /not available/);
  }
  for (const target of [
    "/api/cloud/sign-in/start", "/api/cloud/sign-in", "/api/cloud/sign-out", "/api/cloud/pair",
    "/api/cloud/device/enable", "/api/cloud/device/disable", "/api/cloud/device/revoke",
  ]) assert.throws(() => remoteCanvasTarget("POST", target), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/api/cloud/community/share"), /not available/);
  assert.throws(() => remoteCanvasTarget("PATCH", "/api/canvases"), /not available/);
  assert.throws(() => remoteCanvasTarget("OPTIONS", "/api/canvases"), /method/);
  assert.throws(() => remoteCanvasTarget("GET", "https://example.com/api/canvases"), /invalid/);
});

test("Canvas rename updates only validated server metadata", () => {
  assert.match(serverSource, /function renameSharedCanvas\(id,value\)[\s\S]*?value\.trim\(\)\.slice\(0,48\)[\s\S]*?metadata\.name=name[\s\S]*?atomicJsonWrite\(metadataFile,metadata\)/);
  assert.match(serverSource, /req\.method==="PATCH"&&sharedCanvasMatch[\s\S]*?renameSharedCanvas\(sharedCanvasMatch\[1\],input\?\.name\)/);
});

test("Remote Canvas client pins bridged HTTP and PenEcho Agent WebSocket traffic to the status device", () => {
  assert.match(remoteCanvasClientSource, /deviceIdPattern/);
  assert.match(remoteCanvasClientSource, /const candidate\s*=\s*deviceIdPattern\.test/);
  assert.match(remoteCanvasClientSource, /if \(!bridgeDeviceId && candidate\) bridgeDeviceId = candidate/);
  assert.match(remoteCanvasClientSource, /path=\$\{encodeURIComponent[\s\S]*&deviceId=\$\{encodeURIComponent\(bridgeDeviceId\)/);
  assert.match(remoteCanvasClientSource, /!\["\/api\/v1\/remote-canvas\/canvas-agent", "\/api\/v1\/remote-canvas\/mcp"\]\.includes\(target\.pathname\)/);
  assert.match(remoteCanvasClientSource, /target\.searchParams\.set\("deviceId", bridgeDeviceId\)/);
  assert.match(remoteCanvasClientSource, /projects\|roots\|files/);
});

test("Remote Canvas executor keeps the local session private and returns bounded response data", async () => {
  let captured;
  const execute = createRemoteCanvasHttpExecutor({
    origin:"http://127.0.0.1:3888",
    sessionCookie:"penecho_session=local-secret",
    fetchImpl:async (url, options) => {
      captured = { url, options };
      if (url.endsWith("/plugins/private/air-quality/plugin.md")) return new Response("# Air quality", {
        status:200,
        headers:{ "content-type":"text/markdown; charset=utf-8", "set-cookie":"do-not-forward=1" },
      });
      return new Response(JSON.stringify({ canvases:[{ id:"demo" }] }), {
        status:200,
        headers:{ "content-type":"application/json; charset=utf-8", "x-penecho-upstream-status":"206", "set-cookie":"do-not-forward=1" },
      });
    },
  });
  const result = await execute({ operation:"canvas.http", request:{ method:"GET", path:"/api/canvases" } }, 20_000);
  assert.equal(captured.url, "http://127.0.0.1:3888/api/canvases");
  assert.equal(captured.options.headers.cookie, "penecho_session=local-secret");
  assert.equal(captured.options.headers.origin, "http://127.0.0.1:3888");
  assert.deepEqual(result.body, { canvases:[{ id:"demo" }] });
  assert.equal(result.headers["x-penecho-upstream-status"], "206");
  assert.equal(result.headers["set-cookie"], undefined);
  assert.equal(JSON.stringify(result).includes("local-secret"), false);

  const shareBody = { kind:"canvas", name:"Remote Craft" };
  await execute({ operation:"canvas.http", request:{ method:"POST", path:"/api/cloud/community/share", body:shareBody } }, 20_000);
  assert.equal(captured.url, "http://127.0.0.1:3888/api/cloud/community/share");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers["content-type"], "application/json");
  assert.equal(captured.options.body, JSON.stringify(shareBody));

  const connectionId = "123e4567-e89b-42d3-a456-426614174080", metadataBody = { kind:"canvas", preview:{ contentType:"image/webp", dataBase64:"AA==" } };
  await execute({ operation:"canvas.http", request:{ method:"POST", path:"/api/community/metadata", body:metadataBody, connectionId } }, 20_000);
  assert.equal(captured.url, "http://127.0.0.1:3888/api/community/metadata");
  assert.equal(captured.options.headers["x-penecho-connection"], connectionId);
  await assert.rejects(execute({ operation:"canvas.http", request:{ method:"POST", path:"/api/community/metadata", body:metadataBody, connectionId:"not-a-connection" } }, 20_000), { code:"remote_canvas_connection" });
  await execute({ operation:"canvas.http", request:{ method:"POST", path:"/api/cloud/community/share", body:shareBody, connectionId } }, 20_000);
  assert.equal(captured.options.headers["x-penecho-connection"], undefined);

  const connectionBody = { action:"save", connection:{ provider:"codex-cli", cliPath:"codex", effort:"medium" } };
  await execute({ operation:"canvas.http", request:{ method:"POST", path:"/api/settings/connections", body:connectionBody } }, 20_000);
  assert.equal(captured.url, "http://127.0.0.1:3888/api/settings/connections");
  assert.equal(captured.options.body, JSON.stringify(connectionBody));
  const defaultConnectionBody = { ...connectionBody, id:"default" };
  await execute({ operation:"canvas.http", request:{ method:"POST", path:"/api/settings/connections", body:defaultConnectionBody } }, 20_000);
  assert.equal(captured.options.body, JSON.stringify(defaultConnectionBody));

  const plugin = await execute({ operation:"canvas.http", request:{ method:"GET", path:"/plugins/private/air-quality/plugin.md" } }, 20_000);
  assert.equal(captured.url, "http://127.0.0.1:3888/plugins/private/air-quality/plugin.md");
  assert.equal(plugin.contentType, "text/markdown");
  assert.equal(plugin.body, "# Air quality");
  assert.equal(plugin.headers["set-cookie"], undefined);
});

test("linked AI HTTP execution forwards an explicit connection and preserves final JSON and errors", async () => {
  const calls = [];
  let status = 200;
  const result = { requestId:"request", operations:[{ type:"text", text:"Done" }] };
  const execute = createRemoteCanvasHttpExecutor({ origin:"http://127.0.0.1:3888", sessionCookie:"session=secret", fetchImpl:async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(result), { status, headers:{ "content-type":"application/json" } });
  } });
  for (const path of ["/api/ai/command", "/api/plugins/improve", "/api/community/metadata"]) {
    for (const connectionId of [undefined, "", "invalid", "hosted:123e4567-e89b-42d3-a456-426614174000"]) {
      await assert.rejects(execute({ operation:"canvas.http", request:{ method:"POST", path, connectionId, body:{} } }), { code:"remote_canvas_connection" });
    }
    for (const connectionId of ["default", "123e4567-e89b-42d3-a456-426614174000"]) {
      const body = { typedInput:{ text:"Create a diagram" }, reasoningEffort:"high" };
      const response = await execute({ operation:"canvas.http", request:{ method:"POST", path, connectionId, body } });
      assert.deepEqual(response.body, result);
      assert.equal(response.status, status);
      assert.equal(calls.at(-1).options.headers["x-penecho-connection"], connectionId);
      assert.equal(calls.at(-1).options.headers.cookie, "session=secret");
      assert.equal(calls.at(-1).options.headers.origin, "http://127.0.0.1:3888");
      assert.doesNotMatch(calls.at(-1).options.headers.accept, /ndjson/);
      assert.deepEqual(JSON.parse(calls.at(-1).options.body), body);
      status = 409;
    }
  }
  assert.equal(calls.length, 6);
  const settings = { PENECHO_SETTINGS_SCOPE:"search", DEEPSEEK_SEARCH_PROVIDER:"tavily" };
  await execute({ operation:"canvas.http", request:{ method:"POST", path:"/api/settings", body:settings } });
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), settings);
});

test("Remote Canvas metadata-only listing permits one exact read-only flag", () => {
  assert.equal(remoteCanvasTarget("GET", "/api/canvases?metadataOnly=1"), "/api/canvases?metadataOnly=1");
  assert.equal(remoteCanvasTarget("GET", "/api/canvases"), "/api/canvases");
  assert.equal(remoteCanvasTarget("POST", "/api/canvases"), "/api/canvases");
  for (const query of ["metadataOnly=0", "metadataOnly=", "metadataOnly=true", "metadataOnly=1&metadataOnly=1", "metadataOnly=1&extra=1", "extra=1"])
    assert.throws(() => remoteCanvasTarget("GET", `/api/canvases?${query}`), /not available/);
  assert.throws(() => remoteCanvasTarget("POST", "/api/canvases?metadataOnly=1"), /not available/);
});

test("server canvas previews allow only exact GET paths", () => {
  const path="/api/canvases/1234567890123-canvasname/preview";
  assert.equal(remoteCanvasTarget("GET",path),path);
  for(const method of ["POST","PUT","PATCH","DELETE","HEAD"])assert.throws(()=>remoteCanvasTarget(method,path));
  for(const suffix of ["?extra=1","?metadataOnly=1","/","/nested"])assert.throws(()=>remoteCanvasTarget("GET",path+suffix));
  assert.throws(()=>remoteCanvasTarget("GET","/api/canvases/invalid/preview"));
});
