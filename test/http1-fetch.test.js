"use strict";
require("./helpers/safety.js");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, execFile } = require("node:child_process");

const MODULE = path.join(__dirname, "..", "src", "server", "http1-fetch.js");

// A server that offers both HTTP/2 and HTTP/1.1 and answers with the version the client chose, as penecho.ai does.
const CHILD = `
const http2 = require("node:http2"), fs = require("node:fs");
const [dir, fix] = process.argv.slice(1);
if (fix === "fix") require(${JSON.stringify(MODULE)}).useHttp1ForFetch();
const server = http2.createSecureServer({ key:fs.readFileSync(dir + "/key"), cert:fs.readFileSync(dir + "/cert"), allowHTTP1:true }, (req, res) => {
  res.write(req.httpVersion + " ");
  setTimeout(() => res.end("done"), 20);
});
server.listen(0, "127.0.0.1", async () => {
  const url = "https://127.0.0.1:" + server.address().port;
  const answer = await (await fetch(url, { method:"PUT", body:"x" })).text();
  const aborted = await fetch(url, { signal:AbortSignal.timeout(1) }).then(r => r.text()).then(() => "no", e => e.name);
  process.stdout.write(JSON.stringify({ answer, aborted }));
  server.close(); process.exit(0);
});`;

function certificate(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "penecho-http1-"));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  fs.writeFileSync(dir + "/openssl.cnf", "[req]\ndistinguished_name=dn\n[dn]\n");
  execFileSync("openssl", ["req", "-config", dir + "/openssl.cnf", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", dir + "/key", "-out", dir + "/cert", "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio:"ignore" });
  return dir;
}

function run(dir, fix) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["-e", CHILD, dir, fix], { env:{ ...process.env, NODE_TLS_REJECT_UNAUTHORIZED:"0", NODE_NO_WARNINGS:"1" }, timeout:20000 }, (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout)));
  });
}

test("fetch uses HTTP/1.1 even when the server offers HTTP/2, and still streams and times out", async t => {
  const dir = certificate(t);
  const result = await run(dir, "fix");
  assert.equal(result.answer, "1.1 done");
  assert.equal(result.aborted, "TimeoutError");
});

test("the server switches fetch to HTTP/1.1 before anything else loads", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "server", "main.js"), "utf8");
  const call = source.indexOf('require("./http1-fetch.js").useHttp1ForFetch()');
  assert.ok(call > 0 && call < source.indexOf("require(\"http\")"));
});

test("proxy settings Node was told to use are kept", () => {
  const made = [];
  class Agent { constructor(options) { made.push(["Agent", options]); } }
  class EnvHttpProxyAgent { constructor(options) { made.push(["EnvHttpProxyAgent", options]); } }
  delete require.cache[MODULE];
  const { useHttp1ForFetch } = require(MODULE);
  assert.equal(useHttp1ForFetch({ undici:{ Agent, EnvHttpProxyAgent, setGlobalDispatcher(){} }, env:{ NODE_USE_ENV_PROXY:"1" } }), true);
  assert.deepEqual(made, [["EnvHttpProxyAgent", { allowH2:false }]]);
  delete require.cache[MODULE];
  assert.equal(require(MODULE).useHttp1ForFetch({ undici:null }), false);
});
