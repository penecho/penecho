"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http"), path = require("node:path"), os = require("node:os"), { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const VERSION = require("../package.json").version;

test("answers to what to improve next reach the team through Cloud's contact form, with no account", async () => {
  const received = [];
  let reply = 202;
  const cloud = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => { received.push({ url:req.url, origin:req.headers.origin, body:JSON.parse(body || "{}") }); res.writeHead(reply, { "content-type":"application/json" }); res.end(JSON.stringify({ accepted:reply === 202 })); });
  });
  await new Promise(resolve => cloud.listen(0, "127.0.0.1", resolve));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-research-"));
  fs.writeFileSync(path.join(temp, "config.env"), "");
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], { cwd:ROOT, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, HOME:path.join(temp, "home"), NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1",
    PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "state"), PENECHO_CONFIG_FILE:path.join(temp, "config.env"), HOST:"127.0.0.1", PORT:"0",
    PENECHO_CLOUD_ORIGIN:`http://127.0.0.1:${cloud.address().port}`, AI_PROVIDER:"api", AI_API_KEY:"fixture", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"fixture",
    PENECHO_JEVISION_ENABLED:"false", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" } });
  try {
    const origin = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Isolated server startup timed out")), 15000);
      child.stdout.on("data", chunk => { output += chunk; const match = output.match(/PenEcho: http:\/\/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } });
      child.once("exit", code => reject(Error(`server exited ${code}`)));
    });
    const send = (body, headers = { origin }) => fetch(`${origin}/api/research`, { method:"POST", headers:{ "content-type":"application/json", ...headers }, body:JSON.stringify(body) });
    assert.equal((await send({ text:"Hello" }, {})).status, 403, "only the app's own page sends");
    assert.equal((await send({ improve:["nonsense"], text:"   " })).status, 400, "nothing chosen, nothing sent");
    const sent = await send({ improve:["collaboration", "agents", "agents", "speed", "drawing", "nonsense"], use:"agent", text:"  Undo across tabs, please.  ", language:"zh" });
    assert.deepEqual([sent.status, await sent.json()], [202, { sent:true }]);
    const [contact] = received;
    assert.equal(contact.url, "/api/v1/contact");
    assert.equal(contact.origin, undefined, "a server request, so Cloud's browser origin check does not apply");
    assert.deepEqual([contact.body.topic, contact.body.subject], ["product-feedback", `PenEcho ${VERSION}: what to improve next`]);
    assert.deepEqual(contact.body.body.split("\n"), [
      `PenEcho ${VERSION}: what should we improve next?`,
      "Improve next: Collaboration and sharing; Working with my AI agent; Speed and reliability",
      "Mostly used: With an AI coding agent",
      `App: npm ${VERSION}, ${process.platform}, zh`,
      "",
      "Undo across tabs, please.",
    ], "three known choices at most, in the order picked");
    reply = 503;
    assert.equal((await send({ text:"More export formats" })).status, 502, "the page offers to try again");
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = new Promise(resolve => child.once("exit", resolve)); child.kill(); await exited; }
    await new Promise(resolve => cloud.close(resolve));
    fs.rmSync(temp, { recursive:true, force:true });
  }
});
