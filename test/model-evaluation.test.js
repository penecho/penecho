"use strict";
require("./helpers/safety.js");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { normalizeModelEvaluation, forwardModelEvaluation } = require("../src/server/model-evaluation.js");

const valid = {
  eventId:"2a57ac2b-0c22-4c79-8eaf-99683ffada0c",
  conversationId:"f36707a1-2095-4c2d-a693-fbc282947006",
  action:"like",
  modelName:"gpt-5.6-sol",
  channel:"codex-cli",
  client:"desktop",
  platform:"macos",
  appVersion:"1.2.0",
};

test("model evaluation validation accepts only content-free fields", () => {
  assert.deepEqual(normalizeModelEvaluation(valid), valid);
  assert.equal(normalizeModelEvaluation({ ...valid, prompt:"private prompt" }), null);
  assert.equal(normalizeModelEvaluation({ ...valid, response:"private response" }), null);
  assert.equal(normalizeModelEvaluation({ ...valid, conversationId:"not-a-conversation-id" }), null);
  assert.equal(normalizeModelEvaluation({ ...valid, action:"dislike" }), null);
});

test("model evaluation forwarding uses the Cloud API and a bounded request", async () => {
  let call;
  await forwardModelEvaluation(async (url, options) => {
    call = { url:String(url), options };
    return { ok:true, status:202 };
  }, "https://penecho.ai", "paired-device-token", valid, 10_000);
  assert.equal(call.url, "https://penecho.ai/api/v1/device-sync/model-evaluation");
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.redirect, "error");
  assert.equal(call.options.headers.authorization, "Bearer paired-device-token");
  assert.equal(call.options.signal instanceof AbortSignal, true);
  assert.deepEqual(JSON.parse(call.options.body), valid);
  await assert.rejects(
    forwardModelEvaluation(async () => ({ ok:true }), "https://penecho.ai", "", valid, 10_000),
    (error) => error?.code === "cloud_auth_required",
  );
});

test("model evaluation forwarding uses a bounded non-blocking background queue", () => {
  const connector=fs.readFileSync(path.join(__dirname,"../src/server/cloud-connector.js"),"utf8"),server=fs.readFileSync(path.join(__dirname,"../src/server/main.js"),"utf8");
  assert.match(connector,/MODEL_EVALUATION_QUEUE_TTL_MS = 10_000/);
  assert.match(connector,/MODEL_EVALUATION_QUEUE_LIMIT = 32/);
  assert.match(connector,/while\(!this\.closed&&this\.modelEvaluationQueue\.length\)/);
  assert.match(connector,/await this\.reportModelEvaluation\(item\.event,remaining\)/);
  assert.match(server,/send\(res,202,\{accepted:true\}\);\s*cloudConnector\?\.enqueueModelEvaluation\(event,10_000\)/);
});
