"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createRemoteCanvasHttpExecutor, remoteCanvasTarget } = require("../src/server/remote-canvas-http.js");

test("Remote Canvas allows only reviewed local routes and methods", () => {
  assert.equal(remoteCanvasTarget("GET", "/api/canvases"), "/api/canvases");
  assert.equal(remoteCanvasTarget("GET", "/api/cloud/community?sort=recent&kind=widget"), "/api/cloud/community?sort=recent&kind=widget");
  assert.equal(remoteCanvasTarget("GET", "/api/favorites?view=summary"), "/api/favorites?view=summary");
  assert.equal(remoteCanvasTarget("GET", `/api/favorites/${"a".repeat(64)}/thumbnail`), `/api/favorites/${"a".repeat(64)}/thumbnail`);
  assert.equal(remoteCanvasTarget("PATCH", `/api/favorites/${"a".repeat(64)}/cloud`), `/api/favorites/${"a".repeat(64)}/cloud`);
  assert.equal(remoteCanvasTarget("GET", "/api/cloud/favorites?view=summary"), "/api/cloud/favorites?view=summary");
  assert.equal(remoteCanvasTarget("GET", "/api/cloud/favorites/feed?kind=all&limit=20&cursor=next"), "/api/cloud/favorites/feed?kind=all&limit=20&cursor=next");
  assert.equal(remoteCanvasTarget("GET", "/api/cloud/favorites/123e4567-e89b-42d3-a456-426614174000"), "/api/cloud/favorites/123e4567-e89b-42d3-a456-426614174000");
  assert.equal(remoteCanvasTarget("POST", "/api/cloud/community/share"), "/api/cloud/community/share");
  assert.equal(remoteCanvasTarget("POST", "/api/widget-fetch"), "/api/widget-fetch");
  assert.equal(remoteCanvasTarget("GET", "/plugins/private/air-quality/plugin.md"), "/plugins/private/air-quality/plugin.md");
  assert.equal(remoteCanvasTarget("GET", "/plugins/private/air-quality/styles.css"), "/plugins/private/air-quality/styles.css");
  assert.equal(remoteCanvasTarget("GET", "/plugins/private/legacy-widget.md"), "/plugins/private/legacy-widget.md");
  assert.throws(() => remoteCanvasTarget("POST", "/plugins/private/air-quality/plugin.md"), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/plugins/private/air-quality/plugin.md?v=1"), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/plugins/general/plugin.md"), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/api/settings?secret=1"), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/api/local-access"), /not available/);
  assert.throws(() => remoteCanvasTarget("POST", "/api/ai/command"), /not available/);
  for (const target of [
    "/api/settings", "/api/settings/connections", "/api/settings/connections/test",
    "/api/cloud/sign-in/start", "/api/cloud/sign-in", "/api/cloud/sign-out", "/api/cloud/pair",
    "/api/cloud/device/enable", "/api/cloud/device/disable", "/api/cloud/device/revoke",
  ]) assert.throws(() => remoteCanvasTarget("POST", target), /not available/);
  assert.throws(() => remoteCanvasTarget("GET", "/api/cloud/community/share"), /not available/);
  assert.throws(() => remoteCanvasTarget("PATCH", "/api/canvases"), /not available/);
  assert.throws(() => remoteCanvasTarget("OPTIONS", "/api/canvases"), /method/);
  assert.throws(() => remoteCanvasTarget("GET", "https://example.com/api/canvases"), /invalid/);
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

  const plugin = await execute({ operation:"canvas.http", request:{ method:"GET", path:"/plugins/private/air-quality/plugin.md" } }, 20_000);
  assert.equal(captured.url, "http://127.0.0.1:3888/plugins/private/air-quality/plugin.md");
  assert.equal(plugin.contentType, "text/markdown");
  assert.equal(plugin.body, "# Air quality");
  assert.equal(plugin.headers["set-cookie"], undefined);
});
