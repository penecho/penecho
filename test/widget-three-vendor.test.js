"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const vendor = require("../scripts/build-visual-explainer-vendor.js");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const CDN = "https://cdn.jsdelivr.net/npm/three@0.184.0/";
const functionSource = (source, name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const body = source.indexOf("{", start);
  let depth = 0;
  for (let index = body; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
};
const LOCAL = "http://127.0.0.1:3921/widget-vendor/three@0.184.0/";
const SERVED = Object.freeze({
  "build/three.module.js":`${LOCAL}build/three.module.min.js`,
  "build/three.module.min.js":`${LOCAL}build/three.module.min.js`,
  "examples/jsm/controls/OrbitControls.js":`${LOCAL}examples/jsm/controls/OrbitControls.js`,
  "examples/jsm/renderers/CSS2DRenderer.js":`${LOCAL}examples/jsm/renderers/CSS2DRenderer.js`,
});

test("the vendor build copies the pinned three.js files unmodified with their MIT license", () => {
  assert.equal(JSON.parse(read("node_modules/three/package.json")).version, "0.184.0");
  assert.equal(JSON.parse(read("package.json")).dependencies.three, "0.184.0");
  const three = vendor.FILES.filter(file => file.source.startsWith("node_modules/three/") && file.target.startsWith("public/vendor/three-0.184.0/"));
  assert.deepEqual(three.map(file => file.target.slice("public/vendor/three-0.184.0/".length)),
    ["build/three.core.min.js", "build/three.module.min.js", "examples/jsm/controls/OrbitControls.js", "examples/jsm/renderers/CSS2DRenderer.js", "LICENSE"]);
  for (const file of three) assert.equal(read(file.target), read(file.source), file.target);
  for (const line of read("public/vendor/three-0.184.0/SOURCES.sha256").trim().split("\n")) {
    const [hash, file] = line.split(/\s+/);
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, "public/vendor/three-0.184.0", file))).digest("hex"), hash, file);
  }
  assert.match(read("public/vendor/three-0.184.0/LICENSE"), /The MIT License/);
  assert.match(read("NOTICE"), /three\.js 0\.184\.0 files,\nCopyright \(c\) 2010-2026 three\.js authors[\s\S]*?public\/vendor\/three-0\.184\.0\/LICENSE/);
  // The served module build loads its core relatively, so both files share one served folder.
  assert.match(read("public/vendor/three-0.184.0/build/three.module.min.js"), /from"\.\/three\.core\.min\.js"/);
});

test("the import map points pinned three.js and its served addons at this server while other addons keep the CDN", () => {
  const rewrite = vm.runInNewContext(`(${functionSource(read("public/widget-host.js"), "threeImportMap")})`);
  const authored = { imports:{ three:`${CDN}build/three.module.js`, "three/addons/":`${CDN}examples/jsm/`, chart:"https://cdn.example/chart.js" }, scopes:{ "/x/":{ y:"z" } } };
  const map = rewrite(authored, CDN, SERVED);
  assert.equal(map.imports.three, `${LOCAL}build/three.module.min.js`);
  assert.equal(map.imports["three/addons/"], `${CDN}examples/jsm/`);
  assert.equal(map.imports["three/addons/controls/OrbitControls.js"], `${LOCAL}examples/jsm/controls/OrbitControls.js`);
  assert.equal(map.imports["three/addons/renderers/CSS2DRenderer.js"], `${LOCAL}examples/jsm/renderers/CSS2DRenderer.js`);
  assert.equal(map.imports[`${CDN}build/three.module.js`], `${LOCAL}build/three.module.min.js`);
  assert.equal(map.imports[`${CDN}examples/jsm/controls/OrbitControls.js`], `${LOCAL}examples/jsm/controls/OrbitControls.js`);
  assert.equal(map.imports.chart, "https://cdn.example/chart.js");
  assert.deepEqual(map.scopes, { "/x/":{ y:"z" } });
  assert.equal(authored.imports.three, `${CDN}build/three.module.js`, "the authored map is not mutated");
  assert.ok(JSON.stringify(map).length < 2000, "the map holds links, never library code");

  // Direct URL imports without a map still resolve "three" for the served addons.
  const direct = rewrite({}, CDN, SERVED);
  assert.equal(direct.imports.three, `${LOCAL}build/three.module.min.js`);
  assert.equal(direct.imports[`${CDN}examples/jsm/renderers/CSS2DRenderer.js`], `${LOCAL}examples/jsm/renderers/CSS2DRenderer.js`);
  assert.equal(rewrite({ imports:{ three:`${CDN}build/three.module.min.js` } }, CDN, SERVED).imports.three, `${LOCAL}build/three.module.min.js`);

  // Another build of three.js is left alone so one widget never mixes two copies.
  for (const other of ["https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js", "https://unpkg.com/three@0.184.0/build/three.module.js", `${CDN}build/three.webgpu.js`])
    assert.equal(rewrite({ imports:{ three:other } }, CDN, SERVED), null, other);
});

test("the Widget host links this server's three.js only for widgets that import the pinned CDN build", () => {
  const host = read("public/widget-host.js");
  assert.match(host, /threeCdnBase = "https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.184\.0\/"/);
  assert.match(host, /threeLocalBase = new URL\("widget-vendor\/three@0\.184\.0\/", location\.href\)\.href/);
  assert.match(host, /threeScriptSources = Object\.freeze\(\[\.\.\.new Set\(Object\.values\(threeServedUrls\)\), `\$\{threeLocalBase\}build\/three\.core\.min\.js`\]\)/);
  assert.match(host, /if \(html\.includes\(threeCdnBase\)\) \{[\s\S]*?threeImportMap\(authored, threeCdnBase, threeServedUrls\)/);
  assert.match(host, /if \(!authoredMap\) parsed\.head\.prepend\(element\);/);
  assert.match(host, /policy\.content = csp\(.*sourceFormat === "penecho-living-ink", sceneEngine, threeServed\);/);
  assert.match(host, /\.concat\(threeMode \? threeScriptSources : \[\]\)/);
  // Widgets reference the library by URL; the host never embeds or prefetches library code.
  assert.doesNotMatch(host, /data:text\/javascript|loadThreeModules|threeModulesPromise/);
  assert.match(read("src/server/main.js"), /three@0\.184\.0\/build\/three\.module\.js[\s\S]*?three@0\.184\.0\/examples\/jsm\//);
});

test("the server serves only the pinned three.js files with immutable cross-origin caching", { timeout:20000 }, async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-three-")),
    child = spawn(process.execPath, [path.join(ROOT, "server.js")], { cwd:ROOT, stdio:["ignore", "pipe", "pipe"], windowsHide:true,
      env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-key",
        AI_API_URL:"http://127.0.0.1:9/v1", AI_API_MODEL:"test-model", PENECHO_STATE_DIR:stateDir, PENECHO_CLOUD_STATE_DIR:stateDir } });
  try {
    const origin = await new Promise((resolve, reject) => {
      let stdout = "";
      const timer = setTimeout(() => reject(new Error(`Server did not start.\n${stdout}`)), 10000);
      child.stdout.on("data", chunk => {
        stdout += chunk;
        const match = stdout.match(/PenEcho: http:\/\/[^:]+:(\d+)/);
        if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
      });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`Server exited (${code}).\n${stdout}`)); });
    });
    for (const file of ["build/three.core.min.js", "build/three.module.min.js", "examples/jsm/controls/OrbitControls.js", "examples/jsm/renderers/CSS2DRenderer.js"]) {
      const response = await fetch(`${origin}/widget-vendor/three@0.184.0/${file}`);
      assert.equal(response.status, 200, file);
      assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.equal(response.headers.get("cross-origin-resource-policy"), "cross-origin");
      assert.match(response.headers.get("content-type"), /^application\/javascript/);
      assert.equal(await response.text(), read(`public/vendor/three-0.184.0/${file}`));
    }
    for (const missing of ["/widget-vendor/three@0.184.0/build/three.module.js", "/widget-vendor/three@0.184.0/LICENSE", "/widget-vendor/three@0.184.0/../three-0.184.0/LICENSE"])
      assert.notEqual((await fetch(`${origin}${missing}`)).headers.get("cache-control"), "public, max-age=31536000, immutable", missing);
  } finally {
    child.kill();
    fs.rmSync(stateDir, { recursive:true, force:true });
  }
});
