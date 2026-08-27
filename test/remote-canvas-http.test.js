"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { createRemoteCanvasHttpExecutor, remoteCanvasTarget } = require("../src/server/remote-canvas-http.js");

const remoteCanvasClientSource = fs.readFileSync(path.resolve(__dirname, "../public/remote-canvas.js"), "utf8");

test("Remote Canvas allows only reviewed local routes and methods", () => {
  assert.equal(remoteCanvasTarget("GET", "/api/canvases"), "/api/canvases");
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
  assert.throws(() => remoteCanvasTarget("POST", "/api/ai/command"), /not available/);
  for (const target of [
    "/api/settings",
    "/api/cloud/sign-in/start", "/api/cloud/sign-in", "/api/cloud/sign-out", "/api/cloud/pair",
    "/api/cloud/device/enable", "/api/cloud/device/disable", "/api/cloud/device/revoke",
  ]) assert.throws(() => remoteCanvasTarget("POST", target), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/api/cloud/community/share"), /not available/);
  assert.throws(() => remoteCanvasTarget("PATCH", "/api/canvases"), /not available/);
  assert.throws(() => remoteCanvasTarget("OPTIONS", "/api/canvases"), /method/);
  assert.throws(() => remoteCanvasTarget("GET", "https://example.com/api/canvases"), /invalid/);
});

test("Remote Canvas client pins bridged HTTP and PenEcho Agent WebSocket traffic to the status device", () => {
  assert.match(remoteCanvasClientSource, /deviceIdPattern/);
  assert.match(remoteCanvasClientSource, /bridgeDeviceId\s*=\s*deviceIdPattern\.test/);
  assert.match(remoteCanvasClientSource, /path=\$\{encodeURIComponent[\s\S]*&deviceId=\$\{encodeURIComponent\(bridgeDeviceId\)/);
  assert.match(remoteCanvasClientSource, /target\.pathname !== "\/api\/v1\/remote-canvas\/canvas-agent"/);
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
