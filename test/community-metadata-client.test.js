"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(require.resolve("../src/client/app/persistence.js"), "utf8");
const functionSource = source.slice(source.indexOf("  async function suggestCommunityMetadata("), source.indexOf("  async function importCommunityCanvasArtifact("));

test("Widget and Canvas auto-fill send the current AI selection, effort, preview and draft", async () => {
  const context = { state:{ reasoningEffort:"high" }, document:{ documentElement:{ lang:"zh" } }, aiRequestHeaders:headers => ({ ...headers, "X-PenEcho-Connection":"hosted:selected-model" }) };
  let captured;
  context.fetch = async (url, options) => { captured = { url, options }; return { ok:true, json:async () => ({ metadata:{ name:"Suggested" } }) }; };
  vm.createContext(context);
  vm.runInContext(functionSource, context);
  for (const kind of ["widget", "canvas"]) {
    const preview = { contentType:"image/webp", dataBase64:"image" };
    const result = await context.suggestCommunityMetadata({ kind, artifact:{ communityThumbnail:preview }, current:{ name:"Draft", tags:["test"] } });
    const body = JSON.parse(captured.options.body);
    assert.equal(result.name, "Suggested");
    assert.equal(captured.url, "/api/community/metadata");
    assert.equal(captured.options.headers["X-PenEcho-Connection"], "hosted:selected-model");
    assert.equal(body.reasoningEffort, "high");
    assert.equal(body.kind, kind);
    assert.equal(body.current.name, "Draft");
    assert.deepEqual(body.preview, preview);
  }
  context.fetch = async () => ({ ok:false, status:409, json:async () => ({ error:"model_unavailable", message:"Selected Cloud model is unavailable." }) });
  await assert.rejects(context.suggestCommunityMetadata({ kind:"widget", artifact:{ communityThumbnail:{} } }), /Selected Cloud model is unavailable/);
});
