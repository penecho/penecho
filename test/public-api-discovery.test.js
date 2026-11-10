const assert = require("node:assert/strict");
const { mkdtemp, mkdir, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

async function fixture(t, { stale = false, valid = true } = {}) {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), "penecho-public-api-root-"));
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "penecho-public-api-state-"));
  t.after(() => Promise.all([rm(rootDirectory, { recursive:true, force:true }), rm(stateDirectory, { recursive:true, force:true })]));
  const dataDirectory = path.join(rootDirectory, "src/server/canvas-agent/public-api-data");
  await mkdir(dataDirectory, { recursive:true });
  const entries = [
    { id:"weather-no", name:"Weather Plain", description:"Weather forecast", category:"Weather", documentation_url:"https://plain.example/docs", auth:"No", https:"Yes", cors:"No" },
    { id:"weather-yes", name:"Weather Browser", description:"Weather forecast", category:"Weather", documentation_url:"https://browser.example/docs", auth:"No", https:"Yes", cors:"Yes" },
    { id:"cats", name:"Cat Facts", description:"Daily facts about cats", category:"Animals", documentation_url:"https://cats.example/docs", auth:"No", https:"Yes", cors:"Yes" },
  ];
  const catalog = valid ? {
    schema_version:1,
    source:{ repository:"public-apis/public-apis", commit:"a".repeat(40), retrieved_at:stale ? "2020-01-01T00:00:00Z" : new Date().toISOString() },
    entries,
  } : { schema_version:999 };
  await writeFile(path.join(dataDirectory, "catalog.json"), JSON.stringify(catalog));
  return { rootDirectory, stateDirectory, catalog, entries };
}

async function loadService() {
  return import("../src/server/canvas-agent/public-api-discovery.mjs");
}

function response(body, options = {}) {
  return {
    status:options.status ?? 200,
    contentType:options.contentType ?? "application/json",
    body:Buffer.isBuffer(body) ? body : Buffer.from(body),
    finalUrl:options.finalUrl ?? "https://outside.example/data",
    corsAllowOrigin:options.corsAllowOrigin ?? null,
  };
}

test("search lazily uses stale snapshot when refresh fails, matches Chinese aliases, and does not return unrelated fallbacks", async t => {
  const paths = await fixture(t, { stale:true });
  let calls = 0;
  const { createPublicApiDiscovery } = await loadService();
  const service = createPublicApiDiscovery({ ...paths, publicFetch:async () => { calls++; throw new Error("offline upstream"); } });
  assert.equal(calls, 0, "construction must not read the network");
  const weather = await service.search({ query:"天气", limit:2 });
  assert.equal(calls, 1);
  assert.equal(weather.stale, true);
  assert.match(weather.warning, /using the existing directory/i);
  assert.deepEqual(weather.results.map(item => item.id), ["weather-yes", "weather-no"], "CORS breaks otherwise equal search ties");
  assert.match(weather.reminder, /web search remains an alternative when enabled/i);
  const missing = await service.search({ query:"quantum platypus", offline:true });
  assert.deepEqual(missing.results, []);
  assert.equal(calls, 1, "offline search never refreshes");
});

test("one in-flight refresh is shared, parses no-leading-pipe tables, and writes only the pinned valid catalog", async t => {
  const paths = await fixture(t, { stale:true });
  const sha = "b".repeat(40);
  const markdown = [
    "### Weather",
    "API | Description | Auth | HTTPS | CORS",
    "--- | --- | --- | --- | ---",
    "[Fresh Weather](https://fresh.example/docs) | New forecast | No | Yes | Yes | |",
    "[Needs Key](https://key.example/docs) | No | apiKey | Yes | Yes",
    "[HTTP Docs](http://http.example/docs) | No | No | Yes | Yes",
  ].join("\n");
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const publicFetch = async url => {
    calls.push(url);
    if (url.includes("commits/master")) { await gate; return response(JSON.stringify({ sha }), { finalUrl:url }); }
    return response(markdown, { finalUrl:url, contentType:"text/markdown" });
  };
  const { createPublicApiDiscovery } = await loadService();
  const service = createPublicApiDiscovery({ ...paths, publicFetch });
  const first = service.search({ query:"weather" });
  const second = service.search({ query:"weather" });
  for (let index = 0; index < 50 && calls.length === 0; index++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(calls.length, 1);
  release();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(calls.length, 2);
  assert.deepEqual(one.results.map(item => item.name), ["Fresh Weather"]);
  assert.deepEqual(two.results, one.results);
  assert.equal(one.stale, false);
  const third = await service.search({ query:"weather" });
  assert.equal(calls.length, 2, "a successful refresh replaces the memoized stale snapshot");
  assert.equal(third.source.commit, sha);
  assert.deepEqual(third.results.map(item => item.name), ["Fresh Weather"]);
  const cached = JSON.parse(await readFile(path.join(paths.stateDirectory, "public-api-discovery/catalog.json"), "utf8"));
  assert.equal(cached.source.commit, sha);
  assert.deepEqual(cached.entries.map(item => item.name), ["Fresh Weather"]);
});

test("offline search with malformed local snapshots remains bounded and never calls the network", async t => {
  const paths = await fixture(t, { valid:false });
  let calls = 0;
  const { createPublicApiDiscovery } = await loadService();
  const service = createPublicApiDiscovery({ ...paths, publicFetch:async () => { calls++; } });
  const result = await service.search({ query:"weather", offline:true });
  assert.equal(calls, 0);
  assert.equal(result.stale, true);
  assert.deepEqual(result.results, []);
  await assert.rejects(service.search({ query:"x", limit:11 }), /1 to 10/);
  await assert.rejects(service.search({ query:"" }), /non-empty/);
});

test("catalog refresh returns to the stale snapshot when an unresponsive fetch is cancelled", async t => {
  const paths = await fixture(t, { stale:true });
  let calls = 0;
  const { createPublicApiDiscovery } = await loadService();
  const service = createPublicApiDiscovery({ ...paths, publicFetch:async () => { calls++; return new Promise(() => {}); } });
  const controller = new AbortController();
  const pending = service.search({ query:"weather" }, controller.signal);
  for (let index = 0; index < 50 && calls === 0; index++) await new Promise(resolve => setTimeout(resolve, 2));
  controller.abort();
  let guardTimer;
  const guard = new Promise((_, reject) => { guardTimer = setTimeout(() => reject(new Error("refresh ignored caller abort")), 250); });
  let result;
  try { result = await Promise.race([pending, guard]); }
  finally { clearTimeout(guardTimer); }
  assert.equal(calls, 1);
  assert.equal(result.stale, true);
  assert.match(result.warning, /using the existing directory/i);
});

test("verify accepts an endpoint outside the catalog, reports TLS and header-only CORS evidence, caps keys, and persists no query values", async t => {
  const paths = await fixture(t);
  const seen = [];
  const object = Object.fromEntries(Array.from({ length:40 }, (_, index) => [`key-${String(index).padStart(2, "0")}`, index]));
  object.required = true;
  const { createPublicApiDiscovery } = await loadService();
  const service = createPublicApiDiscovery({
    ...paths,
    publicFetch:async (url, signal, options) => {
      seen.push({ url, signal, options });
      return response(JSON.stringify(object), { finalUrl:url, corsAllowOrigin:"https://widget.example" });
    },
  });
  const result = await service.verify({
    url:"https://outside.example/data?token=do-not-store#fragment",
    origin:"https://widget.example",
    expectedKeys:["required"],
  });
  assert.equal(result.status, "ok");
  assert.equal(result.tls.verified, true);
  assert.equal(result.cors.status, "allowed");
  assert.equal(result.cors.evidence, "response_header_only");
  assert.equal(result.runtime_verified, false);
  assert.equal(result.keys.length, 30);
  assert.deepEqual(seen[0].options, { allowHttp:false, inspectResponse:true, origin:"https://widget.example" });
  const probes = await readFile(path.join(paths.stateDirectory, "public-api-discovery/probes.json"), "utf8");
  assert.doesNotMatch(probes, /do-not-store/);
  assert.match(probes, /\?…/);
});

test("verify distinguishes TLS failure, timeout, caller abort, oversized response, and schema mismatch", async t => {
  const paths = await fixture(t);
  const { createPublicApiDiscovery } = await loadService();
  let mode = "tls";
  const never = new Promise(() => {});
  const publicFetch = async (_url, signal) => {
    if (mode === "tls") throw Object.assign(new Error("certificate has expired"), { code:"CERT_HAS_EXPIRED" });
    if (mode === "timeout") throw Object.assign(new Error("request timed out"), { name:"TimeoutError" });
    if (mode === "large") return response(Buffer.alloc(1024 * 1024 + 1));
    if (mode === "helper-large") throw Object.assign(new Error("The public data response is too large."), { status:413 });
    if (mode === "ignore-abort") return never;
    return response(JSON.stringify({ present:true }));
  };
  const service = createPublicApiDiscovery({ ...paths, publicFetch });
  let result = await service.verify({ url:"https://outside.example/data" });
  assert.equal(result.status, "tls_error");
  assert.equal(result.tls.verified, false);

  mode = "timeout";
  result = await service.verify({ url:"https://outside.example/slow" });
  assert.equal(result.status, "timeout");

  const controller = new AbortController();
  controller.abort();
  result = await service.verify({ url:"https://outside.example/abort" }, controller.signal);
  assert.equal(result.status, "network_error");

  mode = "ignore-abort";
  const delayedController = new AbortController();
  const pendingAbort = service.verify({ url:"https://outside.example/ignored-abort" }, delayedController.signal);
  delayedController.abort();
  let guardTimer;
  const guard = new Promise((_, reject) => { guardTimer = setTimeout(() => reject(new Error("verify ignored caller abort")), 250); });
  try { result = await Promise.race([pendingAbort, guard]); }
  finally { clearTimeout(guardTimer); }
  assert.equal(result.status, "network_error");

  mode = "large";
  result = await service.verify({ url:"https://outside.example/large" });
  assert.equal(result.status, "body_too_large");
  assert.equal(result.tls.verified, true);

  mode = "helper-large";
  result = await service.verify({ url:"https://outside.example/helper-large" });
  assert.equal(result.status, "body_too_large");
  assert.equal(result.tls.verified, false);

  mode = "json";
  result = await service.verify({ url:"https://outside.example/schema", expectedKeys:["missing"] });
  assert.equal(result.status, "schema_mismatch");
  assert.deepEqual(result.missing_keys, ["missing"]);
});

test("verify rejects malformed inputs without fetching and never labels absent Origin as CORS proof", async t => {
  const paths = await fixture(t);
  let calls = 0;
  let lastOptions;
  const { createPublicApiDiscovery } = await loadService();
  const service = createPublicApiDiscovery({ ...paths, publicFetch:async (url, _signal, options) => {
    calls++;
    lastOptions = options;
    return response("{}", { finalUrl:url, corsAllowOrigin:"*" });
  } });
  for (const args of [
    { url:"http://outside.example/data" },
    { url:"https://user:secret@outside.example/data" },
    { url:"https://outside.example/data", origin:"https://widget.example/path" },
    { url:"https://outside.example/data", origin:"https://widget.example/" },
    { url:"https://outside.example/data", origin:"" },
    { url:"https://outside.example/data", expectedKeys:Array.from({ length:17 }, (_, index) => String(index)) },
  ]) assert.equal((await service.verify(args)).status, "security_error");
  assert.equal(calls, 0);
  const result = await service.verify({ url:"https://outside.example/data" });
  assert.equal(result.status, "ok");
  assert.equal(result.cors.status, "not_checked");
  assert.equal(result.cors.allow_origin, "*");
  assert.equal(result.runtime_verified, false);
  assert.deepEqual(lastOptions, { allowHttp:false, inspectResponse:true });
});
