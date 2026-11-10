"use strict";
// Verify that deployed UAT Suggest excludes Delete through the existing local relay.
// The optional request file can replay a captured Canvas request without editing its document.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"),
  { createHash } = require("node:crypto");

async function main() {
  const origin = "http://localhost:3921",
    requestArgument = process.argv.find(value => value.startsWith("--request=")),
    outputArgument = process.argv.find(value => value.startsWith("--output=")),
    image = /const SAMPLE_IMAGE = "([^"]+)"/.exec(fs.readFileSync(path.join(__dirname, "jevision-probe.js"), "utf8"))[1],
    payload = requestArgument ? JSON.parse(fs.readFileSync(requestArgument.slice(10), "utf8"))
      : { version:1, mode:"ink", image, context:{ shapesFit:false, deletionMark:true } };
  assert.equal(payload.version, 1);
  assert.equal(payload.mode, "ink");
  assert.equal(payload.context.deletionMark, true);
  const savedImage = /^<saved as (image\.(webp|png|jpe?g))>$/.exec(payload.image);
  if (savedImage && requestArgument) {
    const file = path.join(path.dirname(path.resolve(requestArgument.slice(10))), savedImage[1]),
      mime = savedImage[2].startsWith("jp") ? "jpeg" : savedImage[2];
    payload.image = `data:image/${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  }
  assert.match(payload.image, /^data:image\/(png|jpeg|webp);base64,/, "A trace's saved image must be restored before replay.");
  const configResponse = await fetch(`${origin}/api/config.js`, { signal:AbortSignal.timeout(15000) });
  assert.equal(configResponse.status, 200);
  const raw = await configResponse.text(), config = JSON.parse(raw.slice(raw.indexOf("=") + 1).replace(/;\s*$/, "")),
    headers = { origin, "x-penecho-session":config.accessSessionToken, "content-type":"application/json" };
  const cloudResponse = await fetch(`${origin}/api/cloud/status`, { headers, signal:AbortSignal.timeout(15000) });
  assert.equal(cloudResponse.status, 200);
  const cloud = await cloudResponse.json();
  assert.equal(cloud.origin, "https://internaltest.penecho.ai", "Only UAT may receive this verification request.");
  assert.equal(cloud.connected, true);
  const results = [];
  for (const [name, body] of [["deletion-contract", payload], ["deletion-cache", payload],
    ["ordinary-ink", { version:1, mode:"ink", image, context:{ shapesFit:false } }]]) {
    const started = Date.now(), response = await fetch(`${origin}/api/suggest`, {
      method:"POST", headers, body:JSON.stringify(body), signal:AbortSignal.timeout(15000),
    }), data = await response.json();
    results.push({ name, status:response.status, elapsedMs:Date.now() - started, context:body.context,
      ok:data.ok === true, model:data.model, cached:data.cached === true, error:data.error || null, answers:data.answers || null });
    assert.equal(response.status, 200, JSON.stringify({ name, status:response.status, error:data.error, message:data.message }));
    assert.equal(data.ok, true);
    assert.equal(data.model, "PenEchoLLM");
    assert.equal(Object.hasOwn(data.answers.action.probabilities, "delete"), false, "Delete belongs only to the independent gesture offer.");
    if (name === "deletion-cache") assert.equal(data.cached, true);
  }
  const report = { testedAt:new Date().toISOString(), origin, cloudOrigin:cloud.origin,
    requestImageSha256:createHash("sha256").update(Buffer.from(payload.image.split(",")[1], "base64")).digest("hex"), results };
  if (outputArgument) {
    const output = path.resolve(outputArgument.slice(9));
    fs.mkdirSync(path.dirname(output), { recursive:true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify({ testedAt:report.testedAt, cloudOrigin:report.cloudOrigin, results:results.map(result => ({
    name:result.name, status:result.status, elapsedMs:result.elapsedMs, cached:result.cached,
    kind:result.answers.kind.choice, action:result.answers.action.choice,
  })) }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
