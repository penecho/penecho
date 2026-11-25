"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const root = path.join(__dirname, "..");
async function withServer(env, run) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lines-page-"));
  const child = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "ignore"], env:{ ...process.env, NODE_ENV:"test", HOST:"127.0.0.1", PORT:"0", PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud"), PENECHO_CONFIG_FILE:path.join(temp, "config.env"), ...env } });
  try {
    const origin = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("The server did not start")), 15000);
      child.stdout.on("data", chunk => { output += chunk; const match = output.match(/PenEcho: http:\/\/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } });
    });
    await run(origin, temp);
  } finally {
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill(); await exited;
    fs.rmSync(temp, { recursive:true, force:true });
  }
}

test("the Projects page loads every file it names and keeps scripts strict", async () => {
  await withServer({ PENECHO_TEST_OPEN_ACCESS:"1" }, async origin => {
    const page = await fetch(`${origin}/projects.html`), html = await page.text(), csp = page.headers.get("content-security-policy");
    assert.equal(page.status, 200);
    assert.ok(html.includes('id="app"'));
    assert.match(csp, /style-src-attr 'unsafe-inline'/);
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    // The page names its files without a leading slash, so penecho.ai can serve the same page from a folder (public/lines/hosted.js).
    const resources = [...html.matchAll(/(?:src|href)="(lines\/[^"]+)"/g)].map(match => match[1]);
    assert.ok(resources.length >= 3 && resources.length <= 6, `expected bundled resources, got ${resources.length}`);
    assert.ok(resources.some(r => /^lines\/bundle\.css\?v=[a-f0-9]{10}$/.test(r)), "bundled CSS with content hash");
    assert.ok(resources.some(r => /^lines\/head-bundle\.js\?v=[a-f0-9]{10}$/.test(r)), "bundled head JS with content hash");
    const bodyBundle = resources.find(r => /^lines\/bundle\.js\?v=[a-f0-9]{10}$/.test(r));
    assert.ok(bodyBundle, "bundled body JS with content hash");
    assert.doesNotMatch(html, /(?:src|href)="\//);
    for (const resource of resources) {
      const res = await fetch(new URL(resource, `${origin}/projects.html`));
      assert.equal(res.status, 200, resource);
      assert.match(res.headers.get("cache-control") || "", /immutable/, `${resource} is content-hashed and immutable`);
    }
    const bundleText = await (await fetch(new URL(bodyBundle, `${origin}/projects.html`))).text();
    assert.ok(bundleText.includes("hostedBoot"), "bundle includes hosted.js");
    const canvas = await fetch(origin);
    assert.doesNotMatch(canvas.headers.get("content-security-policy"), /style-src-attr/);
    assert.match(await canvas.text(), /data-project-lines-link/);
  });
});

test("the Projects page and its data wait behind the same lock as the Canvas, for another device (F5: never for this computer)", async () => {
  await withServer({ PENECHO_TEST_OPEN_ACCESS:"" }, async origin => {
    const other = { "x-forwarded-for":"192.168.1.50" };
    const page = await (await fetch(`${origin}/projects.html`, { headers:other })).text();
    assert.doesNotMatch(page, /id="swInput"/);
    assert.match(page, /access\.js/);
    assert.equal((await fetch(`${origin}/api/lines/projects`, { headers:other })).status, 403);
    assert.match(await (await fetch(`${origin}/projects.html`)).text(), /lines\/bundle\.js/, "this computer opens it");
  });
});

test("project writes need this page's origin, and paths stay inside the folder", async () => {
  await withServer({ PENECHO_TEST_OPEN_ACCESS:"1" }, async (origin, temp) => {
    const json = { "content-type":"application/json" }, docsPath = path.join(temp, "docs");
    const send = headers => fetch(`${origin}/api/lines/projects`, { method:"POST", headers:{ ...json, ...headers }, body:JSON.stringify({ name:"Safe", docsPath }) });
    assert.equal((await send({})).status, 403);
    assert.equal((await send({ origin:"https://evil.example" })).status, 403);
    assert.ok(!fs.existsSync(docsPath));
    const made = await send({ origin });
    assert.equal(made.status, 200);
    const { project } = await made.json();
    assert.ok(fs.existsSync(path.join(docsPath, "README.md")));
    const outside = await fetch(`${origin}/api/lines/projects/${project.id}/doc?path=${encodeURIComponent("../../secret.md")}`);
    assert.ok(outside.status >= 400 && outside.status < 500);
    const planted = await fetch(`${origin}/api/lines/projects/${project.id}/upload?dir=${encodeURIComponent("topics")}&name=x.md`, { method:"POST", headers:{ origin }, body:"x" });
    assert.equal(planted.status, 400);
    const file = await fetch(`${origin}/api/lines/projects/${project.id}/file?path=README.md`);
    assert.match(file.headers.get("content-security-policy"), /sandbox/);
    assert.equal(file.headers.get("cross-origin-resource-policy"), "same-origin");
  });
});

test("an installed copy includes the Projects page", () => {
  const { files } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  for (const entry of ["public/projects.html", "public/project-lines-entry.css", "public/lines/"]) assert.ok(files.includes(entry), entry);
});
