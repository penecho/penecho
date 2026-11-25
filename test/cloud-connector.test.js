"use strict";
require("./helpers/safety.js");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { test } = require("node:test");
const { CloudConnector, accountSessionExpired, normalizedOrigin, publicCanvasMessage } = require("../src/server/cloud-connector.js");

async function eventually(predicate, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

test("Cloud Library forwards page, full-library search and metadata options",async()=>{
  const connector=Object.create(CloudConnector.prototype),paths=[];
  connector.configuration=null;connector.cloudRequest=async pathname=>{paths.push(pathname);return {canvases:[],page:{total:0,nextOffset:null}};};
  await connector.library(new URLSearchParams({limit:"24",offset:"48",q:"old needle",projectId:"all",sort:"created",locale:"zh",previews:"0",ignored:"value"}));
  const url=new URL(paths[0],"https://example.test");
  assert.equal(url.pathname,"/api/v1/device-sync/library");assert.equal(url.searchParams.get("offset"),"48");assert.equal(url.searchParams.get("q"),"old needle");assert.equal(url.searchParams.get("previews"),"0");assert.equal(url.searchParams.has("ignored"),false);
  await connector.library();assert.equal(paths[1],"/api/v1/device-sync/library");
});

test("Notes use the local account session through the actual Cloud request boundary", async () => {
  const connector = Object.create(CloudConnector.prototype), originalFetch = global.fetch, requests = [];
  connector.requireCloudAccount = () => ({ origin:"https://internaltest.penecho.ai", accountToken:"notes-test-session" });
  const id = "canvas:card /中文?", cursor = "next:card /中文?", entry = { id, note:{ title:"Complete card" } };
  try {
    global.fetch = async (url, options) => {
      requests.push({ url, ...options });
      assert.equal(options.headers.authorization, "Bearer notes-test-session");
      assert.equal(options.redirect, "error");
      return new Response(JSON.stringify(options.method === "PUT" ? { entry, version:3 } : { notes:[], nextCursor:null }), {
        status:200, headers:{ "content-type":"application/json" },
      });
    };
    assert.equal((await connector.saveNote(id, entry, 2)).version, 3);
    await connector.listNotes();
    await connector.listNotes(cursor);
    await connector.getNote(id);
    assert.deepEqual(requests.map(({ url, method }) => ({ url, method })), [
      { url:`https://internaltest.penecho.ai/api/v1/notes/${encodeURIComponent(id)}`, method:"PUT" },
      { url:"https://internaltest.penecho.ai/api/v1/notes", method:"GET" },
      { url:`https://internaltest.penecho.ai/api/v1/notes?cursor=${encodeURIComponent(cursor)}`, method:"GET" },
      { url:`https://internaltest.penecho.ai/api/v1/notes/${encodeURIComponent(id)}`, method:"GET" },
    ]);
    assert.deepEqual(JSON.parse(requests[0].body), { entry, expectedVersion:2 });
    assert.equal(requests[0].headers["content-type"], "application/json");
    assert.ok(requests.slice(1).every(request => request.body === undefined));
  } finally { global.fetch = originalFetch; }
});

test("Notes request permission does not include unrelated paths or methods", async () => {
  const connector = Object.create(CloudConnector.prototype), originalFetch = global.fetch;
  connector.requireCloudAccount = () => ({ origin:"https://internaltest.penecho.ai", accountToken:"notes-test-session" });
  try {
    global.fetch = async () => { assert.fail("Unsupported Notes requests must never reach the network."); };
    for (const [pathname, method] of [
      ["/api/v1/notes", "PUT"], ["/api/v1/notes/card", "POST"], ["/api/v1/notes/card", "DELETE"],
      ["/api/v1/notes/card", "PATCH"], ["/api/v1/notes-extra", "GET"], ["/api/v1/notes/card/extra", "GET"],
      ["/api/v1/notes?other=value", "GET"], ["/api/v1/notes/card?other=value", "PUT"],
    ]) await assert.rejects(connector.cloudRequest(pathname, { method }), /Unsupported cloud account request/);
  } finally { global.fetch = originalFetch; }
});

test("account status drops expired or invalid membership without exposing billing fields", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-membership-status-"));
  try {
    const connector = new CloudConnector({ stateDir });
    for (const membership of [undefined, { tier:"pro", expiresAt:Date.now()-1 }, { tier:"vip", expiresAt:2200000000000 }, { tier:"pro", expiresAt:"2200000000000" }]) {
      connector.account = { id:"account-id", name:"Ada", credits:1000, membership };
      assert.equal(connector.status().account.membership, undefined);
    }
    connector.account.membership = { tier:"plus", expiresAt:2200000000000, customerId:"private" };
    assert.deepEqual(connector.status().account.membership, { tier:"plus", expiresAt:2200000000000 });
  } finally { fs.rmSync(stateDir, { recursive:true, force:true }); }
});

test("cloud origin requires HTTPS except for loopback development", () => {
  assert.equal(normalizedOrigin("https://penecho.ai"), "https://penecho.ai");
  assert.equal(normalizedOrigin("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
  assert.throws(() => normalizedOrigin("http://example.com"), /HTTPS/);
  assert.throws(() => normalizedOrigin("https://penecho.ai/path"), /without a path/);
});

test("temporary Cloud failures explain that the local Canvas remains safe", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-unavailable-test-"));
  const originalFetch = global.fetch;
  try {
    const connector = new CloudConnector({ stateDir, defaultOrigin:"https://internaltest.penecho.ai" });
    connector.writeConfiguration({ version:2, origin:"https://internaltest.penecho.ai", accountToken:"uat-account-token" });
    global.fetch = async () => { throw Object.assign(new Error("connect timed out"), { code:"ETIMEDOUT" }); };
    await assert.rejects(
      () => connector.createCloudProject({ name:"Safe local Canvas" }),
      (error) => error.status === 503 && error.code === "cloud_temporarily_unavailable" && /still safe on this device/.test(error.message),
    );
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive:true, force:true });
  }
});

test("Cloudflare's 524 page (penecho.ai did not answer within 100 s) is a temporary failure, not a refused request", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-524-test-"));
  const originalFetch = global.fetch;
  try {
    const connector = new CloudConnector({ stateDir, defaultOrigin:"https://penecho.ai" });
    connector.writeConfiguration({ version:2, origin:"https://penecho.ai", accountToken:"local-account-session" });
    for (const status of [520, 522, 524, 530]) {
      global.fetch = async () => new Response("<html><title>A timeout occurred</title></html>", { status, headers:{ "content-type":"text/html" } });
      await assert.rejects(
        () => connector.cloudRequest("/api/v1/device-sync/line-projects/p1/blobs", { method:"POST", bytes:Buffer.from("x") }),
        (error) => error.status === status && error.code === "cloud_temporarily_unavailable" && new RegExp(`HTTP ${status}`).test(error.message) && !/request failed/.test(error.message),
      );
    }
    global.fetch = async () => new Response("<html>Bad request</html>", { status:400, headers:{ "content-type":"text/html" } });
    await assert.rejects(() => connector.cloudRequest("/api/v1/device-sync/line-projects/p1/blobs", { method:"POST", bytes:Buffer.from("x") }),
      (error) => error.status === 400 && error.code === "cloud_request_failed");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive:true, force:true });
  }
});

test("personal Widget favorites send one JSON object through the local Cloud account session", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-favorite-body-test-"));
  const originalFetch = global.fetch;
  try {
    const connector = new CloudConnector({ stateDir, defaultOrigin:"https://internaltest.penecho.ai" });
    connector.writeConfiguration({ version:2, origin:"https://internaltest.penecho.ai", accountToken:"local-account-session" });
    global.fetch = async (url, options) => {
      assert.equal(url, "https://internaltest.penecho.ai/api/v1/favorites");
      assert.equal(options.headers.authorization, "Bearer local-account-session");
      assert.deepEqual(JSON.parse(options.body), {
        name:"Timer",
        artifact:{ format:"penecho-widget", formatVersion:1, widget:{ title:"Timer" } },
        thumbnail:"AA==",
        sourceItemId:null,
        sourceWidgetId:"11111111-1111-4111-8111-111111111111",
      });
      return new Response(JSON.stringify({ favorite:{ id:"favorite-1", name:"Timer" } }), { status:201, headers:{ "content-type":"application/json" } });
    };
    assert.equal((await connector.saveWidgetFavorite({
      name:"Timer",
      artifact:{ format:"penecho-widget", formatVersion:1, widget:{ title:"Timer" } },
      thumbnail:"AA==",
      sourceWidgetId:"11111111-1111-4111-8111-111111111111",
    })).id, "favorite-1");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive:true, force:true });
  }
});

test("favorite feed forwards kind, page size, and opaque cursor through the local account session", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-favorite-feed-test-"));
  const originalFetch = global.fetch;
  try {
    const connector = new CloudConnector({ stateDir, defaultOrigin:"https://internaltest.penecho.ai" });
    connector.writeConfiguration({ version:2, origin:"https://internaltest.penecho.ai", accountToken:"local-account-session" });
    global.fetch = async (url, options) => {
      assert.equal(url, "https://internaltest.penecho.ai/api/v1/favorites/feed?kind=canvas&limit=20&cursor=opaque-next");
      assert.equal(options.headers.authorization, "Bearer local-account-session");
      return new Response(JSON.stringify({ items:[], pagination:{ limit:20, hasMore:false, nextCursor:null } }), { status:200, headers:{ "content-type":"application/json" } });
    };
    const feed = await connector.favoriteFeed({ kind:"canvas", limit:20, cursor:"opaque-next" });
    assert.deepEqual(feed.pagination, { limit:20, hasMore:false, nextCursor:null });
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive:true, force:true });
  }
});

test("public Cloud messages are bounded and reject unsafe links", async () => {
  assert.deepEqual(publicCanvasMessage({ title:{ en:"Offer", zh:"推介" }, body:{ en:"Free sync", zh:"免费同步" }, actionLabel:{ en:"Open", zh:"打开" }, actionUrl:"https://penecho.ai/offer", updatedAt:123 }), {
    title:{ en:"Offer", zh:"推介" }, body:{ en:"Free sync", zh:"免费同步" }, actionLabel:{ en:"Open", zh:"打开" }, actionUrl:"https://penecho.ai/offer", updatedAt:123,
  });
  assert.equal(publicCanvasMessage(null), null);
  assert.equal(publicCanvasMessage({ body:{ en:"", zh:"" } }), null);
  assert.throws(() => publicCanvasMessage({ body:{ en:"Message" }, actionUrl:"javascript:alert(1)" }), /unsafe link/);

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-message-test-")), originalFetch = global.fetch;
  try {
    const connector = new CloudConnector({ stateDir });
    global.fetch = async (url, options) => {
      assert.equal(url, "http://127.0.0.1:8080/api/v1/public/canvas-cloud-message");
      assert.equal(options.headers.authorization, undefined);
      return new Response(JSON.stringify({ message:{ body:{ en:"Service notice", zh:"服务消息" } } }), { status:200, headers:{ "content-type":"application/json" } });
    };
    assert.equal((await connector.publicCanvasMessage({ origin:"http://127.0.0.1:8080" })).message.body.zh, "服务消息");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive:true, force:true });
  }
});

test("signed-out users browse public community metadata and thumbnails without an account token", async () => {
  const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-public-community-test-")),originalFetch=global.fetch;
  try {
    const connector=new CloudConnector({stateDir,defaultOrigin:"http://127.0.0.1:18082"}),requests=[];
    global.fetch=async(url,options)=>{
      requests.push({url:String(url),headers:options.headers});
      if(String(url).endsWith("/thumbnail"))return new Response(Buffer.from("webp-thumbnail"),{status:200,headers:{"content-type":"image/webp"}});
      return new Response(JSON.stringify({items:[{id:"11111111-1111-4111-8111-111111111111",name:"Public Widget"}]}),{status:200,headers:{"content-type":"application/json"}});
    };
    const listed=await connector.communityItems({kind:"widget",scope:"community"}),thumbnail=await connector.communityThumbnail("11111111-1111-4111-8111-111111111111");
    assert.equal(listed.items[0].name,"Public Widget");
    assert.deepEqual(thumbnail.bytes,Buffer.from("webp-thumbnail"));
    assert.match(requests[0].url,/\/api\/v1\/community\/items\?kind=widget&scope=community$/);
    assert.equal(requests.some(request=>request.headers.authorization),false);
  } finally {
    global.fetch=originalFetch;
    fs.rmSync(stateDir,{recursive:true,force:true});
  }
});

test("expired local account sessions fail closed and remove the saved sign-in", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-expired-session-test-"));
  const file = path.join(stateDir, "cloud-device.json");
  try {
    fs.writeFileSync(file, JSON.stringify({
      version: 2,
      origin: "https://penecho.ai",
      accountToken: "expired-account-token",
      accountExpiresAt: "2099-01-01T00:00:00.000Z",
      account: { id: "account-id", name: "Ada", credits: 1000 },
    }), { mode: 0o600 });

    const connector = new CloudConnector({ stateDir });
    connector.configuration.accountExpiresAt = "2020-01-01T00:00:00.000Z";
    assert.throws(() => connector.requireCloudAccount(), (error) => {
      assert.match(error.message, /session expired/);
      assert.equal(error.status, 401);
      assert.equal(error.code, "cloud_sign_in_required");
      return true;
    });
    const status = connector.status();
    assert.equal(status.accountSession.signedIn, false);
    assert.equal(status.account, null);
    assert.throws(() => connector.requireCloudAccount(), (error) => {
      assert.match(error.message, /Connect your PenEcho Cloud account/);
      assert.equal(error.status, 401);
      assert.equal(error.code, "cloud_sign_in_required");
      return true;
    });
    assert.equal(fs.existsSync(file), false, "no sign-in left to keep");
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("missing local account sessions require Cloud sign-in", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-missing-session-test-"));
  const file = path.join(stateDir, "cloud-device.json");
  try {
    const connector = new CloudConnector({ stateDir });
    connector.writeConfiguration({
      version: 2,
      origin: "https://penecho.ai",
    });

    assert.throws(() => connector.requireCloudAccount(), (error) => {
      assert.match(error.message, /Connect your PenEcho Cloud account/);
      assert.equal(error.status, 401);
      assert.equal(error.code, "cloud_sign_in_required");
      return true;
    });
    assert.equal(connector.status().accountSession.signedIn, false);
    assert.equal(fs.existsSync(file), false, "an origin alone is not saved");
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("an endpoint 401 clears the account only after the authoritative session check confirms revocation", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-upstream-unauthorized-test-"));
  const file = path.join(stateDir, "cloud-device.json");
  const originalFetch = global.fetch;
  try {
    const connector = new CloudConnector({ stateDir });
    connector.writeConfiguration({
      version: 2,
      origin: "https://penecho.ai",
      accountToken: "expired-upstream-account-token",
      accountExpiresAt: "2099-01-01T00:00:00.000Z",
      account: { id:"account-id", name:"Ada", credits:1000 },
    });
    global.fetch = async () => new Response(JSON.stringify({
      error:"invalid_local_session",
      message:"The Cloud account session expired.",
    }), { status:401, headers:{ "content-type":"application/json" } });

    await assert.rejects(connector.library(), (error) => {
      assert.match(error.message, /Sign in on this computer again/);
      assert.equal(error.status, 401);
      assert.equal(error.code, "cloud_sign_in_required");
      return true;
    });
    const status = connector.status();
    assert.equal(status.accountSession.signedIn, false);
    assert.equal(status.account, null);
    assert.equal(fs.existsSync(file), false, "no sign-in left to keep");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("an untrusted 401 from the session-check path never clears the account", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-untrusted-session-401-test-"));
  const originalFetch = global.fetch;
  try {
    const connector = new CloudConnector({ stateDir });
    connector.writeConfiguration({
      version:2,
      origin:"https://penecho.ai",
      accountToken:"durable-account-token",
      accountExpiresAt:"2030-01-01T00:00:00.000Z",
      account:{ id:"account-id", name:"Ada", credits:1000 },
    });
    connector.account = { id:"account-id", name:"Ada", credits:1000 };

    for (const response of [
      new Response("Sign in", { status:401, headers:{ "content-type":"text/html" } }),
      new Response(JSON.stringify({ error:"unauthorized", message:"An edge rejected the request." }), { status:401, headers:{ "content-type":"application/json" } }),
    ]) {
      global.fetch = async () => response.clone();
      await assert.rejects(connector.refreshAccount({ force:true }), (error) => {
        assert.equal(error.status, 503);
        assert.equal(error.code, "cloud_session_validation_untrusted");
        return true;
      });
      assert.equal(connector.status().accountSession.signedIn, true);
      const saved = JSON.parse(fs.readFileSync(path.join(stateDir, "cloud-device.json"), "utf8"));
      assert.equal(saved.accountToken, "durable-account-token");
    }
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive:true, force:true });
  }
});

test("endpoint 401 responses never clear a valid current account", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-unconfirmed-401-test-"));
  const originalFetch = global.fetch;
  let sessionChecks = 0;
  try {
    const connector = new CloudConnector({ stateDir });
    connector.writeConfiguration({
      version: 2,
      origin: "https://penecho.ai",
      accountToken: "valid-current-account-token",
      accountExpiresAt: "2030-01-01T00:00:00.000Z",
      account: { id:"account-id", name:"Ada", credits:1000 },
    });
    global.fetch = async (url, options = {}) => {
      if (url.endsWith("/api/v1/local-access/session") && options.method === "GET") {
        sessionChecks++;
        return new Response(JSON.stringify({
          account:{ id:"account-id", name:"Ada", credits:1000 },
          expiresAt:"2030-01-01T00:00:00.000Z",
        }), { status:200, headers:{ "content-type":"application/json" } });
      }
      return new Response(JSON.stringify({ error:"request_unauthorized", message:"This individual request was rejected." }), {
        status:401,
        headers:{ "content-type":"application/json" },
      });
    };

    const operations = [
      () => connector.library(),
      () => connector.communityRequest("/api/v1/community/items?scope=favorites&kind=widget"),
      () => connector.communityPreview("community-item"),
      () => connector.cloudCanvasThumbnail("canvas-id"),
    ];
    for (const operation of operations) {
      await assert.rejects(operation(), (error) => {
        assert.equal(error.status, 403);
        assert.equal(error.code, "cloud_request_not_authorized");
        return true;
      });
      assert.equal(connector.status().accountSession.signedIn, true);
    }

    assert.equal(sessionChecks, operations.length);
    const saved = JSON.parse(fs.readFileSync(path.join(stateDir, "cloud-device.json"), "utf8"));
    assert.equal(saved.accountToken, "valid-current-account-token");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("background account refresh failures preserve the signed-in account", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-refresh-failure-test-"));
  const originalFetch = global.fetch;
  try {
    const connector = new CloudConnector({ stateDir });
    connector.writeConfiguration({
      version:2,
      origin:"https://penecho.ai",
      accountToken:"durable-account-token",
      accountExpiresAt:"2030-01-01T00:00:00.000Z",
      account:{ id:"account-id", name:"Ada", credits:1000 },
    });
    connector.account = { id:"account-id", name:"Ada", credits:1000 };
    connector.accountUpdatedAt = Date.now();

    global.fetch = async () => new Response(JSON.stringify({ message:"Temporary Cloud failure" }), {
      status:503,
      headers:{ "content-type":"application/json" },
    });
    await assert.rejects(connector.refreshAccount({ force:true }), /Temporary Cloud failure/);
    assert.equal(connector.status().accountSession.signedIn, true);

    global.fetch = async () => { throw Object.assign(new Error("temporary network failure"), { code:"ECONNRESET" }); };
    await assert.rejects(connector.refreshAccount({ force:true }), /temporary network failure/);
    const status = connector.status();
    assert.equal(status.accountSession.signedIn, true);
    assert.equal(status.account.name, "Ada");
    const saved = JSON.parse(fs.readFileSync(path.join(stateDir, "cloud-device.json"), "utf8"));
    assert.equal(saved.accountToken, "durable-account-token");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive:true, force:true });
  }
});

test("an old Favorites 401 cannot clear a newer browser sign-in", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-stale-favorites-401-test-"));
  const originalFetch = global.fetch;
  let resolveOldRequest;
  try {
    const connector = new CloudConnector({ stateDir });
    connector.writeConfiguration({
      version: 2,
      origin: "https://penecho.ai",
      accountToken: "old-account-token",
      accountExpiresAt: "2030-01-01T00:00:00.000Z",
      account: { id:"old-account", name:"Old account", credits:1000 },
    });
    global.fetch = async () => new Promise((resolve) => { resolveOldRequest = resolve; });

    const oldFavorites = connector.communityRequest("/api/v1/community/items?scope=favorites&kind=widget");
    connector.writeConfiguration({
      ...connector.configuration,
      accountToken: "new-browser-account-token",
      accountExpiresAt: "2030-02-01T00:00:00.000Z",
      account: { id:"new-account", name:"New account", credits:900 },
      accountUpdatedAt: Date.now(),
    });
    connector.account = { id:"new-account", name:"New account", credits:900 };
    connector.accountUpdatedAt = Date.now();
    resolveOldRequest(new Response(JSON.stringify({ message:"The old session expired." }), {
      status:401,
      headers:{ "content-type":"application/json" },
    }));

    await assert.rejects(oldFavorites, (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "cloud_request_superseded");
      return true;
    });
    const status = connector.status();
    assert.equal(status.accountSession.signedIn, true);
    assert.equal(status.account.name, "New account");
    const saved = JSON.parse(fs.readFileSync(path.join(stateDir, "cloud-device.json"), "utf8"));
    assert.equal(saved.accountToken, "new-browser-account-token");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("an old background account refresh cannot clear or overwrite a newer sign-in", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-stale-account-refresh-test-"));
  const originalFetch = global.fetch;
  let resolveOldRequest;
  try {
    const connector = new CloudConnector({ stateDir });
    connector.writeConfiguration({
      version: 2,
      origin: "https://penecho.ai",
      accountToken: "old-refresh-token",
      accountExpiresAt: "2030-01-01T00:00:00.000Z",
      account: { id:"old-account", name:"Old account", credits:1000 },
    });
    global.fetch = async () => new Promise((resolve) => { resolveOldRequest = resolve; });

    const oldRefresh = connector.refreshAccount({ force:true });
    connector.writeConfiguration({
      ...connector.configuration,
      accountToken: "new-refresh-token",
      accountExpiresAt: "2030-02-01T00:00:00.000Z",
      account: { id:"new-account", name:"New account", credits:900 },
      accountUpdatedAt: Date.now(),
    });
    connector.account = { id:"new-account", name:"New account", credits:900 };
    connector.accountUpdatedAt = Date.now();
    resolveOldRequest(new Response(JSON.stringify({ message:"The old refresh token expired." }), {
      status:401,
      headers:{ "content-type":"application/json" },
    }));

    await assert.rejects(oldRefresh, (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "cloud_request_superseded");
      return true;
    });
    const status = connector.status();
    assert.equal(status.accountSession.signedIn, true);
    assert.equal(status.account.name, "New account");
    const saved = JSON.parse(fs.readFileSync(path.join(stateDir, "cloud-device.json"), "utf8"));
    assert.equal(saved.accountToken, "new-refresh-token");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("an old successful account refresh cannot overwrite a newer browser sign-in", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-stale-account-success-test-"));
  const originalFetch = global.fetch;
  let resolveOldRequest;
  try {
    const connector = new CloudConnector({ stateDir });
    connector.writeConfiguration({
      version:2,
      origin:"https://penecho.ai",
      accountToken:"old-refresh-token",
      accountExpiresAt:"2030-01-01T00:00:00.000Z",
      account:{ id:"old-account", name:"Old account", credits:1000 },
    });
    global.fetch = async () => new Promise((resolve) => { resolveOldRequest = resolve; });

    const oldRefresh = connector.refreshAccount({ force:true });
    connector.writeConfiguration({
      ...connector.configuration,
      accountToken:"new-browser-account-token",
      accountExpiresAt:"2030-02-01T00:00:00.000Z",
      account:{ id:"new-account", name:"New account", credits:900 },
      accountUpdatedAt:Date.now(),
    });
    connector.account = { id:"new-account", name:"New account", credits:900 };
    connector.accountUpdatedAt = Date.now();
    resolveOldRequest(new Response(JSON.stringify({
      account:{ id:"old-account", name:"Old account", credits:50 },
      expiresAt:"2030-01-01T00:00:00.000Z",
    }), { status:200, headers:{ "content-type":"application/json" } }));

    const status = await oldRefresh;
    assert.equal(status.accountSession.signedIn, true);
    assert.equal(status.account.name, "New account");
    const saved = JSON.parse(fs.readFileSync(path.join(stateDir, "cloud-device.json"), "utf8"));
    assert.equal(saved.accountToken, "new-browser-account-token");
    assert.equal(saved.account.name, "New account");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive:true, force:true });
  }
});

test("local account expiry validation rejects elapsed or malformed timestamps", () => {
  const future = { accountToken: "token", accountExpiresAt: "2030-01-01T00:00:00.000Z" };
  assert.equal(accountSessionExpired(future, Date.parse("2029-01-01T00:00:00.000Z")), false);
  assert.equal(accountSessionExpired(future, Date.parse("2030-01-01T00:00:00.000Z")), true);
  assert.equal(accountSessionExpired({ accountToken: "token", accountExpiresAt: "not-a-date" }), false);
  assert.equal(accountSessionExpired({ accountToken: "legacy-without-expiry" }), false);
});

test("local account sign-in stores only the account session and sign-out removes it", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-account-session-test-"));
  const originalFetch = global.fetch;
  const calls = [];
  try {
    const connector = new CloudConnector({ stateDir });
    connector.writeConfiguration({
      version: 2,
      origin: "https://penecho.ai",
    });
    global.fetch = async (url, options = {}) => {
      calls.push({ url, method: options.method, authorization: options.headers?.authorization });
      if (url.endsWith("/api/v1/local-access/session") && options.method === "POST") {
        return new Response(JSON.stringify({
          accessToken: "independent-account-token",
          expiresAt: "2030-01-01T00:00:00.000Z",
          account: { id: "account-id", name: "Ada", credits: 1000, email: "hidden@example.com", membership:{ tier:"pro", expiresAt:2200000000000, stripeSubscriptionId:"private" } },
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/v1/local-access/session") && options.method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${options.method} ${url}`);
    };

    const signedIn = await connector.signIn({ origin: "https://penecho.ai", code: "local-authorization-code-with-enough-entropy" });
    assert.equal(signedIn.accountSession.signedIn, true);
    assert.equal(signedIn.account.name, "Ada");
    assert.equal(signedIn.account.email, undefined);
    assert.deepEqual(signedIn.account.membership, { tier:"pro", expiresAt:2200000000000 });
    const saved = JSON.parse(fs.readFileSync(path.join(stateDir, "cloud-device.json"), "utf8"));
    assert.equal(saved.accountToken, "independent-account-token");

    const signedOut = await connector.signOut();
    assert.equal(signedOut.accountSession.signedIn, false);
    assert.equal(signedOut.account, null);
    assert.equal(fs.existsSync(path.join(stateDir, "cloud-device.json")), false);
    assert.deepEqual(calls.map((call) => call.method), ["POST", "DELETE"]);
    assert.equal(calls[1].authorization, "Bearer independent-account-token");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("browser account sign-in preserves the current LAN callback before storing the global local token", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-browser-signin-test-"));
  const originalFetch = global.fetch;
  try {
    const connector = new CloudConnector({ stateDir });
    const started = connector.beginBrowserSignIn({
      origin: "https://penecho.ai",
      callbackUrl: "http://192.168.1.20:3888/api/cloud/sign-in/callback",
    });
    const authorizationUrl = new URL(started.authorizationUrl);
    assert.equal(authorizationUrl.origin, "https://penecho.ai");
    assert.equal(authorizationUrl.pathname, "/dashboard.html");
    // No Settings address: on penecho.ai it opened Settings over the Allow window.
    assert.equal(authorizationUrl.hash, "");
    const callbackUrl = new URL(authorizationUrl.searchParams.get("local_callback"));
    assert.equal(callbackUrl.origin, "http://192.168.1.20:3888");
    assert.equal(callbackUrl.pathname, "/api/cloud/sign-in/callback");
    assert.ok(callbackUrl.searchParams.get("state").length >= 32);
    assert.equal(connector.status().browserSignIn.pending, true);
    assert.equal("state" in connector.status().browserSignIn, false);

    global.fetch = async (url, options = {}) => {
      assert.equal(url, "https://penecho.ai/api/v1/local-access/session");
      assert.equal(options.method, "POST");
      const exchange = JSON.parse(options.body);
      assert.equal(exchange.callback, callbackUrl.toString());
      assert.equal(exchange.code, "one-time-browser-authorization-code");
      return new Response(JSON.stringify({
        accessToken: "browser-local-access-token",
        expiresAt: "2030-01-01T00:00:00.000Z",
        account: { id: "account-id", name: "Browser User", credits: 1000 },
      }), { status: 201, headers: { "content-type": "application/json" } });
    };
    const signedIn = await connector.completeBrowserSignIn({
      state: callbackUrl.searchParams.get("state"),
      code: "one-time-browser-authorization-code",
      callbackOrigin: callbackUrl.origin,
    });
    assert.equal(signedIn.accountSession.signedIn, true);
    assert.equal(signedIn.account.name, "Browser User");
    assert.equal(signedIn.browserSignIn.pending, false);
    const saved = JSON.parse(fs.readFileSync(path.join(stateDir, "cloud-device.json"), "utf8"));
    assert.equal(saved.accountToken, "browser-local-access-token");
    if (process.platform !== "win32") assert.equal(fs.statSync(path.join(stateDir, "cloud-device.json")).mode & 0o777, 0o600);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("browser account sign-in rejects public callbacks, mismatched state, and a changed return origin", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-browser-state-test-"));
  try {
    const connector = new CloudConnector({ stateDir });
    assert.throws(() => connector.beginBrowserSignIn({
      origin: "https://penecho.ai",
      callbackUrl: "https://attacker.example/api/cloud/sign-in/callback",
    }), /local PenEcho server/);
    const started=connector.beginBrowserSignIn({
      origin: "https://penecho.ai",
      callbackUrl: "http://localhost:3888/api/cloud/sign-in/callback",
    });
    const callbackUrl=new URL(new URL(started.authorizationUrl).searchParams.get("local_callback"));
    await assert.rejects(
      connector.completeBrowserSignIn({ state: "wrong-state", code: "one-time-browser-authorization-code", callbackOrigin:callbackUrl.origin }),
      /expired|state/i
    );
    assert.equal(connector.status().browserSignIn.pending, true);
    await assert.rejects(
      connector.completeBrowserSignIn({ state:callbackUrl.searchParams.get("state"),code:"one-time-browser-authorization-code",callbackOrigin:"http://127.0.0.1:3888" }),
      /different local Canvas address/
    );
    assert.equal(connector.status().browserSignIn.pending, true);
    assert.equal(connector.status().accountSession.signedIn, false);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("failed remote sign-out still clears the local account session", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-signout-retry-test-"));
  const originalFetch = global.fetch;
  try {
    const connector = new CloudConnector({ stateDir });
    connector.writeConfiguration({
      version: 2,
      origin: "https://penecho.ai",
      accountToken: "retryable-account-token",
      account: { id: "account-id", name: "Ada", credits: 1000 },
    });
    global.fetch = async () => new Response(JSON.stringify({ message: "Service unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });

    const signOut = connector.signOut();
    assert.equal(connector.status().accountSession.signedIn, false);
    const status = await signOut;
    assert.equal(status.accountSession.signedIn, false);
    assert.equal(fs.existsSync(path.join(stateDir, "cloud-device.json")), false);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("account library requests keep credentials on the local server and omit email from browser status", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-library-test-"));
  const originalFetch = global.fetch;
  try {
    const connector = new CloudConnector({ stateDir });
    connector.writeConfiguration({
      version: 2,
      origin: "https://penecho.ai",
      accountToken: "library-account-token",
    });
    global.fetch = async (url, options) => {
      assert.equal(url, "https://penecho.ai/api/v1/device-sync/library");
      assert.equal(options.headers.authorization, "Bearer library-account-token");
      return new Response(JSON.stringify({
        account: { id: "account-id", name: "Ada", email: "ada@example.com", credits: 1000 },
        folders: [],
        projects: [],
        canvases: [{ id: "11111111-1111-4111-8111-111111111111", previewDataUrl: "data:image/webp;base64,cHJldmlldw==" }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const library = await connector.library();
    assert.equal(library.account.email, undefined);
    assert.equal(library.canvases[0].previewDataUrl, "data:image/webp;base64,cHJldmlldw==");
    assert.deepEqual(connector.status().account, { id: "account-id", name: "Ada", credits: 1000, workspace: undefined });
    assert.equal("token" in connector.status(), false);
    await assert.rejects(
      connector.assetRequest({ url: "https://127.0.0.1/private-object" }),
      /unsafe asset URL/
    );
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("Cloud Canvas deletion uses the recoverable device-sync trash endpoint", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-delete-test-"));
  const originalFetch = global.fetch;
  try {
    const connector = new CloudConnector({ stateDir });
    connector.writeConfiguration({
      version: 2,
      origin: "https://penecho.ai",
      accountToken: "account-delete-token",
    });
    global.fetch = async (url, options) => {
      assert.equal(url, "https://penecho.ai/api/v1/device-sync/canvases/11111111-1111-4111-8111-111111111111");
      assert.equal(options.method, "DELETE");
      assert.equal(options.headers.authorization, "Bearer account-delete-token");
      return new Response(null, { status: 204 });
    };
    await connector.trashCloudCanvas("11111111-1111-4111-8111-111111111111");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("Cloud Canvas thumbnails stay behind the local account proxy and enforce compact WebP", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-thumbnail-test-"));
  const originalFetch = global.fetch;
  try {
    const connector = new CloudConnector({ stateDir });
    connector.writeConfiguration({ version: 2, origin: "https://penecho.ai", accountToken: "thumbnail-account-token" });
    global.fetch = async (url, options) => {
      assert.equal(url, "https://penecho.ai/api/v1/device-sync/canvases/11111111-1111-4111-8111-111111111111/thumbnail");
      assert.equal(options.headers.authorization, "Bearer thumbnail-account-token");
      return new Response(Buffer.from("small-webp"), { status: 200, headers: { "content-type": "image/webp" } });
    };
    const result = await connector.cloudCanvasThumbnail("11111111-1111-4111-8111-111111111111");
    assert.equal(result.contentType, "image/webp");
    assert.deepEqual(result.bytes, Buffer.from("small-webp"));
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("community sharing rejects blank titles and descriptions before contacting Cloud", async () => {
  const stateDir=fs.mkdtempSync(path.join(os.tmpdir(), "penecho-community-required-fields-"));
  try {
    const connector = new CloudConnector({ stateDir });
    const artifact={ formatVersion:1, communityPreview:{ dataBase64:"AA==" } };
    await assert.rejects(
      connector.shareCommunityItem({ kind:"widget", name:" ", description:"Useful", category:"productivity", artifact }),
      (error) => error.status===400&&error.code==="community_title_required",
    );
    await assert.rejects(
      connector.shareCommunityItem({ kind:"widget", name:"Timer", description:" ", category:"productivity", artifact }),
      (error) => error.status===400&&error.code==="community_description_required",
    );
  } finally { fs.rmSync(stateDir,{recursive:true,force:true}); }
});

test("community sharing derives lineage from the artifact and keeps contribution optional", async () => {
  const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-community-lineage-")),originalFetch=global.fetch;
  try {
    const origin="http://127.0.0.1:8080",parentItemId="123e4567-e89b-42d3-a456-426614174080",itemId="123e4567-e89b-42d3-a456-426614174081",requests=[];
    const connector=new CloudConnector({stateDir});
    connector.configuration={origin,accountToken:"account-token"};
    global.fetch=async(url,options={})=>{
      requests.push({url:String(url),options});
      if(String(url)===`${origin}/api/v1/community/items`)return new Response(JSON.stringify({item:{id:itemId},upload:{url:`${origin}/storage/${itemId}`,headers:{"content-type":"application/json"}}}),{status:201,headers:{"content-type":"application/json"}});
      if(String(url)===`${origin}/storage/${itemId}`)return new Response(null,{status:204});
      if(String(url)===`${origin}/api/v1/community/items/${itemId}/complete`)return new Response(JSON.stringify({item:{id:itemId,parentItemId}}),{status:200,headers:{"content-type":"application/json"}});
      throw new Error(`Unexpected request: ${url}`);
    };
    const artifact={formatVersion:1,widget:{communityOriginItemId:parentItemId},communityPreview:{dataBase64:"AA=="}};
    await connector.shareCommunityItem({kind:"widget",name:"Continuation",description:"Keeps its source.",category:"productivity",artifact,contributionNote:"",publicationTermsAccepted:true,publicationRightsAccepted:true,modelTrainingAccepted:true,publicationTermsVersion:"2026-08-12"});
    const reservation=JSON.parse(requests[0].options.body);
    assert.equal(reservation.parentItemId,parentItemId);
    assert.equal(reservation.contributionNote,"");
    await assert.rejects(connector.shareCommunityItem({kind:"widget",name:"Wrong parent",description:"Must fail closed.",category:"productivity",artifact,parentItemId:"123e4567-e89b-42d3-a456-426614174082"}),(error)=>error.status===409&&error.code==="community_lineage_mismatch");
  } finally {global.fetch=originalFetch;fs.rmSync(stateDir,{recursive:true,force:true});}
});

test("community sharing lets Cloud atomically publish a missing parent as a new root", async () => {
  const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-community-missing-parent-")),originalFetch=global.fetch;
  try {
    const origin="http://127.0.0.1:8080",parentItemId="123e4567-e89b-42d3-a456-426614174083",itemId="123e4567-e89b-42d3-a456-426614174084",reservations=[];
    const connector=new CloudConnector({stateDir});
    connector.configuration={origin,accountToken:"account-token"};
    let uploadedArtifact=null;
    global.fetch=async(url,options={})=>{
      if(String(url)===`${origin}/api/v1/community/items`){
        const body=JSON.parse(options.body);reservations.push(body);
        return new Response(JSON.stringify({item:{id:itemId,parentItemId:null,generation:0},upload:{url:`${origin}/storage/${itemId}`,headers:{"content-type":"application/json"}}}),{status:201,headers:{"content-type":"application/json"}});
      }
      if(String(url)===`${origin}/storage/${itemId}`){uploadedArtifact=JSON.parse(Buffer.from(options.body).toString("utf8"));return new Response(null,{status:204});}
      if(String(url)===`${origin}/api/v1/community/items/${itemId}/complete`)return new Response(JSON.stringify({item:{id:itemId,parentItemId:null,generation:0}}),{status:200,headers:{"content-type":"application/json"}});
      throw new Error(`Unexpected request: ${url}`);
    };
    const artifact={formatVersion:1,extensions:{penechoCommunity:{originItemId:parentItemId,rootItemId:parentItemId,originName:"Missing parent",originGeneration:0}},communityPreview:{dataBase64:"AA=="}};
    const result=await connector.shareCommunityItem({kind:"canvas",name:"New root",description:"Cloud resolves the missing parent in the reservation transaction.",category:"productivity",artifact});
    assert.equal(reservations.length,1);
    assert.equal(reservations[0].parentItemId,parentItemId);
    assert.equal(uploadedArtifact.extensions?.penechoCommunity?.originItemId,parentItemId,"the client must not rewrite lineage before Cloud decides");
    assert.equal(result.item.parentItemId,null);
    assert.equal(result.item.generation,0);
  } finally {global.fetch=originalFetch;fs.rmSync(stateDir,{recursive:true,force:true});}
});

test("community sharing never retries an HTTP error as a missing parent", async () => {
  const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-community-no-fallback-")),originalFetch=global.fetch;
  try {
    const origin="http://127.0.0.1:8080",parentItemId="123e4567-e89b-42d3-a456-426614174085",connector=new CloudConnector({stateDir}),artifact={formatVersion:1,widget:{communityOriginItemId:parentItemId},communityPreview:{dataBase64:"AA=="}};
    connector.configuration={origin,accountToken:"account-token"};
    for(const response of [
      {status:404,body:{error:"not_found",message:"Resource not found."}},
      {status:503,body:{error:"temporarily_unavailable",message:"Cloud unavailable."}},
    ]){
      let calls=0;
      global.fetch=async()=>{calls++;return new Response(JSON.stringify(response.body),{status:response.status,headers:{"content-type":"application/json"}});};
      await assert.rejects(connector.shareCommunityItem({kind:"widget",name:"No fallback",description:"Cloud request errors must remain errors.",category:"productivity",artifact}),(error)=>error.status===response.status);
      assert.equal(calls,1);
    }
  } finally {global.fetch=originalFetch;fs.rmSync(stateDir,{recursive:true,force:true});}
});

test("cloud Canvas save and load preserve animation manifests and widget assets", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-canvas-test-"));
  const originalFetch = global.fetch;
  try {
    const origin = "http://127.0.0.1:8080";
    const canvasId = "11111111-1111-4111-8111-111111111111";
    const revisionId = "22222222-2222-4222-8222-222222222222";
    const storage = new Map();
    const uploadedPaths = [];
    let reservationBody = null;
    let completionAttempts = 0;
    const connector = new CloudConnector({ stateDir });
    connector.writeConfiguration({
      version: 2,
      origin,
      accountToken: "canvas-account-token",
    });
    global.fetch = async (url, options = {}) => {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith("/api/v1/device-sync/")) assert.equal(options.headers.authorization, "Bearer canvas-account-token");
      if (options.method === "POST" && parsed.pathname.endsWith(`/canvases/${canvasId}/revisions`)) {
        reservationBody = JSON.parse(options.body);
        return new Response(JSON.stringify({
          revisionId,
          bundle: { upload: { url: `${origin}/storage/bundle` } },
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (options.method === "PUT" && parsed.pathname.startsWith("/storage/")) {
        uploadedPaths.push(parsed.pathname);
        storage.set(parsed.pathname, Buffer.from(options.body));
        return new Response(null, { status: 200 });
      }
      if (options.method === "POST" && parsed.pathname.endsWith(`/canvas-revisions/${revisionId}/complete`)) {
        completionAttempts += 1;
        if (completionAttempts === 1) throw new Error("Simulated lost completion response");
        return new Response(JSON.stringify({ revision: { id: revisionId, status: "complete" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (options.method === "GET" && parsed.pathname.endsWith(`/canvases/${canvasId}/revisions/latest`)) {
        const bundleBytes = storage.get("/storage/bundle");
        return new Response(JSON.stringify({
          revision: { id: revisionId },
          bundle: {
            download: { url: `${origin}/storage/bundle` },
            sha256: createHash("sha256").update(bundleBytes).digest("hex"),
            sizeBytes: bundleBytes.length,
            contentType: "application/json",
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if ((!options.method || options.method === "GET") && parsed.pathname.startsWith("/storage/")) {
        const bytes = storage.get(parsed.pathname);
        return new Response(bytes, { status: bytes ? 200 : 404, headers: { "content-type": "application/octet-stream" } });
      }
      throw new Error(`Unexpected test request: ${options.method || "GET"} ${url}`);
    };
    const widget = { id: "widget-1", pluginId: "flowchart", x: 100, y: 200, w: 800, h: 500, contentW: 800, contentH: 500, title: "Flowchart", refreshSeconds: 86400, html: "<!doctype html><title>Flowchart</title>", copyText: "flowchart TD\nA-->B", copyLabel: "Copy Mermaid" };
    const animations = [{ id: "animation-1", rendererVersion: 1, transform: { x: 300, y: 400, w: 600, h: 400 }, scene: { tool: "animate_scene", version: 1, w: 600, h: 400, durationMs: 2000, loop: true, objects: [], motions: [] }, playback: { playheadMs: 500, paused: false } }];
    const bundle = {
      bundleVersion: 2,
      mode: "snapshot",
      formatVersion: 1,
      manifest: { format: "penecho-raster-tiles", formatVersion: 1, animations },
      assets: [
        { kind: "tile", contentType: "image/png", metadata: { tileKey: "1,2" }, dataBase64: Buffer.from("tile-bytes").toString("base64") },
        { kind: "widget", contentType: "application/json", metadata: { widgetId: widget.id, pluginId: widget.pluginId }, dataBase64: Buffer.from(JSON.stringify(widget)).toString("base64") },
        { kind: "preview", contentType: "image/webp", metadata: { width: 640, height: 426 }, dataBase64: Buffer.from("preview-bytes").toString("base64") },
      ],
    };
    const saved = await connector.saveCloudCanvas({ canvasId, bundle });
    assert.equal(saved.revision.id, revisionId);
    assert.equal(completionAttempts, 2);
    const uploadedBundle = storage.get("/storage/bundle");
    assert.deepEqual(uploadedPaths, ["/storage/bundle"]);
    assert.equal(reservationBody.mode, "snapshot");
    assert.equal(reservationBody.bundle.sizeBytes, uploadedBundle.length);
    assert.equal(reservationBody.bundle.sha256, createHash("sha256").update(uploadedBundle).digest("hex"));
    const loaded = await connector.loadCloudCanvas(canvasId);
    assert.deepEqual(loaded.bundle.manifest.animations, animations);
    assert.deepEqual(loaded.bundle.assets.map((item) => item.kind), ["tile", "widget", "preview"]);
    assert.deepEqual(JSON.parse(Buffer.from(loaded.bundle.assets[1].dataBase64, "base64").toString("utf8")), widget);
    assert.equal(Buffer.from(loaded.bundle.assets[0].dataBase64, "base64").toString(), "tile-bytes");
    assert.equal(Buffer.from(loaded.bundle.assets[2].dataBase64, "base64").toString(), "preview-bytes");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("cloud Canvas save reconciles latest when both completion responses are lost", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-canvas-reconcile-test-"));
  const canvasId = "33333333-3333-4333-8333-333333333333";
  const revisionId = "44444444-4444-4444-8444-444444444444";
  const connector = new CloudConnector({ stateDir });
  let completionAttempts = 0;
  try {
    connector.cloudRequest = async (pathname) => {
      if (pathname.endsWith(`/canvas-revisions/${revisionId}/complete`)) {
        completionAttempts += 1;
        throw new Error("Simulated lost completion response");
      }
      if (pathname.endsWith(`/canvases/${canvasId}/revisions/latest`)) {
        return { revision: { id: revisionId, status: "complete" } };
      }
      throw new Error(`Unexpected reconciliation request: ${pathname}`);
    };
    const result = await connector.completeCloudCanvasRevision(canvasId, revisionId);
    assert.equal(completionAttempts, 2);
    assert.deepEqual(result, { revision: { id: revisionId, status: "complete" } });
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("a failed first Cloud Canvas save is moved to recoverable Trash", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-create-save-test-"));
  const connector = new CloudConnector({ stateDir });
  const canvasId = "55555555-5555-4555-8555-555555555555";
  let trashed = null;
  try {
    connector.createCloudCanvas = async (projectId, input) => {
      assert.equal(projectId, "66666666-6666-4666-8666-666666666666");
      assert.deepEqual(input, { name:"Cross-device draft" });
      return { canvas:{ id:canvasId, name:input.name } };
    };
    connector.saveCloudCanvas = async () => { throw Object.assign(new Error("upload interrupted"), { status:503 }); };
    connector.trashCloudCanvas = async (id) => { trashed = id; };
    await assert.rejects(() => connector.createAndSaveCloudCanvas({
      projectId:"66666666-6666-4666-8666-666666666666",
      name:"Cross-device draft",
      bundle:{ bundleVersion:2, manifest:{}, assets:[] },
    }), /upload interrupted/);
    assert.equal(trashed, canvasId);
  } finally {
    connector.close();
    fs.rmSync(stateDir, { recursive:true, force:true });
  }
});

test("Cloud Canvas loading downloads one verified bundle and preserves asset order", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-parallel-load-test-"));
  const originalFetch = global.fetch;
  const origin = "https://penecho.ai";
  const connector = new CloudConnector({ stateDir });
  connector.writeConfiguration({ version: 2, origin, accountToken: "parallel-load-account-token" });
  const assetCount = 12;
  const bundle = {
    bundleVersion: 2,
    mode: "snapshot",
    formatVersion: 1,
    manifest: { format: "penecho-raster-tiles", formatVersion: 1 },
    assets: Array.from({ length: assetCount }, (_, index) => ({
      kind: "tile",
      contentType: "image/webp",
      metadata: { tileKey: `${index},0` },
      dataBase64: Buffer.from(`asset-${index}`).toString("base64"),
    })),
  };
  const bundleBytes = Buffer.from(JSON.stringify(bundle));
  const bundleHash = createHash("sha256").update(bundleBytes).digest("hex");
  let latestRequests = 0;
  let bundleDownloads = 0;
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url, origin);
    if (parsed.pathname.endsWith("/revisions/latest")) {
      latestRequests += 1;
      return new Response(JSON.stringify({
        revision: { id: "22222222-2222-4222-8222-222222222222", formatVersion: 1 },
        bundle: {
          download: { url: `${origin}/storage/bundle` },
          sha256: bundleHash,
          sizeBytes: bundleBytes.length,
          contentType: "application/json",
        },
      }), { status:200, headers:{ "content-type":"application/json" } });
    }
    if (parsed.pathname === "/storage/bundle") {
      bundleDownloads += 1;
      return new Response(bundleBytes, { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected Cloud request: ${url} ${options.method || "GET"}`);
  };
  try {
    const loaded = await connector.loadCloudCanvas("11111111-1111-4111-8111-111111111111");
    assert.equal(latestRequests, 1);
    assert.equal(bundleDownloads, 1);
    assert.deepEqual(loaded.bundle.assets.map((item) => Buffer.from(item.dataBase64, "base64").toString()), Array.from({ length:assetCount }, (_, index) => `asset-${index}`));
  } finally {
    connector.close();
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("a link Canvas starts and ends without an account, and adopting it adds the account session", async () => {
  const connector = Object.create(CloudConnector.prototype), originalFetch = global.fetch, requests = [];
  const origin = "https://internaltest.penecho.ai", token = "0f8b7c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f", ownerKey = "k".repeat(43);
  connector.configuration = null;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers:{ "content-type":"application/json" } });
  try {
    global.fetch = async (url, options) => {
      requests.push({ url, ...options });
      if (url.endsWith("/adopt")) return json({ collaboration:{ token, url:`/canvas/collaborate/${token}` } });
      if (options.method === "DELETE") return json({ ended:true });
      if (options.body && JSON.parse(options.body).title === "Too big") return json({ message:"Payload Too Large" }, 413);
      return json({ token, url:`/canvas/collaborate/${token}`, ownerKey, expiresAt:"2026-11-08T00:00:00.000Z" });
    };
    const started = await connector.linkRequest("/api/v1/live/links", { method:"POST", body:{ title:"Sketch", bundle:{} }, origin });
    assert.deepEqual([started.origin, started.ownerKey], [origin, ownerKey]);
    assert.equal(requests[0].url, `${origin}/api/v1/live/links`);
    assert.equal(requests[0].headers.authorization, undefined, "no account credential is sent");
    await assert.rejects(connector.linkRequest("/api/v1/live/links", { method:"POST", body:{ title:"Too big", bundle:{} }, origin }), /too large to collaborate on without an account/);
    await connector.linkRequest(`/api/v1/live/links/${token}`, { method:"DELETE", ownerKey, origin });
    assert.deepEqual([requests[2].method, requests[2].headers["x-penecho-owner-key"], requests[2].body], ["DELETE", ownerKey, undefined]);
    for (const [pathname, method] of [["/api/v1/canvases", "POST"], [`/api/v1/live/links/${token}`, "POST"], ["/api/v1/live/links", "DELETE"]])
      await assert.rejects(connector.linkRequest(pathname, { method, origin }), /Unsupported link Canvas request/);
    connector.requireCloudAccount = () => ({ origin, accountToken:"account-session" });
    await connector.cloudRequest(`/api/v1/live/links/${token}/adopt`, { method:"POST", body:{ canvasId:token }, headers:{ "x-penecho-owner-key":ownerKey } });
    const adopt = requests.at(-1);
    assert.deepEqual([adopt.headers.authorization, adopt.headers["x-penecho-owner-key"], JSON.parse(adopt.body)], ["Bearer account-session", ownerKey, { canvasId:token }]);
  } finally { global.fetch = originalFetch; }
});

test("refreshAccount clears a stale local account expiry when Cloud returns expiresAt: null", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-refresh-no-expiry-"));
  const originalFetch = global.fetch;
  try {
    const connector = new CloudConnector({ stateDir });
    connector.writeConfiguration({
      version: 2,
      origin: "https://penecho.ai",
      accountToken: "long-lived-account-token",
      accountExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
      account: { id: "account-id", name: "Ada", credits: 1000 },
    });
    global.fetch = async () => new Response(JSON.stringify({
      account: { id: "account-id", name: "Ada", credits: 1500 },
      expiresAt: null,
    }), { status: 200, headers: { "content-type": "application/json" } });
    const refreshed = await connector.refreshAccount();
    assert.equal(refreshed.accountSession.signedIn, true);
    assert.equal(refreshed.accountSession.expiresAt, null);
    assert.equal(refreshed.account.credits, 1500);
    const saved = JSON.parse(fs.readFileSync(path.join(stateDir, "cloud-device.json"), "utf8"));
    assert.equal(saved.accountExpiresAt, null);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
