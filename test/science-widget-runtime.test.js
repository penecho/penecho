"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const vendorGenerator = require("../scripts/build-visual-explainer-vendor.js");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
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

test("the Visual Explorer vendor generator pins the Manim-Web entry, emitted chunk, and third-party notices", () => {
  assert.deepEqual(vendorGenerator.FILES.filter(file => file.source.startsWith("node_modules/manim-web/")), [
    { source:"node_modules/manim-web/dist/manim-web.browser.js", target:"public/vendor/manim-web-0.3.24/manim-web.browser.js" },
    { source:"node_modules/manim-web/dist/MathJaxBundle-xSidSV0E.js", target:"public/vendor/manim-web-0.3.24/MathJaxBundle-xSidSV0E.js" },
    { source:"node_modules/manim-web/LICENSE", target:"public/vendor/manim-web.LICENSE" },
  ]);
  assert.equal(vendorGenerator.expectedFiles().find(file => file.source.includes("manim-web.browser.js")).targetPath,
    path.join(ROOT, "public/vendor/manim-web-0.3.24/manim-web.browser.js"));
  const entry = read("node_modules/manim-web/dist/manim-web.browser.js"),
    relativeImports = [...entry.matchAll(/\bimport\(\s*["'](\.\/[^"']+)["']\s*\)/g)].map(match => match[1]);
  assert.deepEqual(relativeImports, ["./MathJaxBundle-xSidSV0E.js"]);
  const noticeTargets = vendorGenerator.FILES.filter(file => file.target.includes("manim-web-licenses/"));
  assert.equal(noticeTargets.length, 13);
  assert.equal(noticeTargets.every(file => file.source.includes("LICENSE") || /README|notices/i.test(file.source)), true);
  const notices = read("scripts/manim-web-third-party-notices.md");
  for (const dependency of ["@mathjax/src", "earcut", "gif.js", "katex", "opentype.js", "polygon-clipping", "splaytree", "three", "typia"]) {
    assert.equal(notices.includes(`| ${dependency} |`), true);
  }
});

test("the local Manim-Web entry and MathJax chunk routes mirror the Visual Explainer vendor route", () => {
  const server = read("src/server/main.js");
  assert.match(server, /["']\/visual-explorer-manim-web\/manim-web\.browser\.js["'][^\n]+manim-web-0\.3\.24[^\n]+manim-web\.browser\.js/);
  assert.match(server, /["']\/visual-explorer-manim-web\/MathJaxBundle-xSidSV0E\.js["'][^\n]+manim-web-0\.3\.24[^\n]+MathJaxBundle-xSidSV0E\.js/);
  const routeStart = server.indexOf("const visualExplorerManimWebAsset = VISUAL_EXPLORER_MANIM_WEB_ASSETS.get(url.pathname)");
  assert.notEqual(routeStart, -1);
  const routeIfStart = server.indexOf("if ((req.method === \"GET\" || req.method === \"HEAD\")", routeStart),
    route = server.slice(routeStart, server.indexOf("if ((req.method === \"GET\" || req.method === \"HEAD\")", routeIfStart + 10));
  assert.match(route, /req\.method === "GET" \|\| req\.method === "HEAD"/);
  assert.match(route, /req\.method === "HEAD"/);
  assert.match(route, /fs\.createReadStream\(visualExplorerManimWebAsset\)\.pipe\(res\)/);
  const visualStart = server.indexOf('url.pathname === "/visual-explainer-vendor.js"');
  const visualRoute = server.slice(server.lastIndexOf("  if ((req.method === \"GET\" || req.method === \"HEAD\")", visualStart), server.indexOf("if ((req.method === \"GET\" || req.method === \"HEAD\")", visualStart + 10));
  const headers = (block) => block.match(/res\.writeHead\(200, (\{[^\n]+\})\);/)[1];
  assert.equal(headers(route), headers(visualRoute));
});

test("Widget initialization carries its authored source identity", () => {
  const canvas = read("src/client/app/canvas-runtime.js"),
    sent = [],
    widget = {
      frame:{ contentWindow:{ postMessage(message, targetOrigin) { sent.push({ message, targetOrigin }); } } },
      hostReady:true,
      initialized:false,
      renderActive:true,
      pluginId:"general",
      title:"Fields",
      html:"<main></main>",
      sourceFormat:"penecho-visual-explorer+html",
      frameworkVersion:"penecho-visual-explorer/1",
      hostOrigin:"https://canvas.example",
    },
    send = vm.runInNewContext(`(${functionSource(canvas, "sendWidgetInit")})`, {
      pluginManifests:new Map([["general", { styles:"/* plugin */" }]]),
      location:{ origin:"https://parent.example" },
    });
  send(widget);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].targetOrigin, "https://canvas.example");
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].message)), {
    type:"penecho-widget-init",
    title:"Fields",
    html:"<main></main>",
    pluginStyles:"/* plugin */",
    sourceFormat:"penecho-visual-explorer+html",
    frameworkVersion:"penecho-visual-explorer/1",
  });
});

test("science mode requires both exact init metadata and one exact HTML skill marker", () => {
  const host = read("public/widget-host.js"),
    gate = vm.runInNewContext(`(${functionSource(host, "scienceWidgetMode")})`),
    meta = (content, name = "penecho-visual-skill") => ({ getAttribute(attribute) { return attribute === "content" ? content : name; } }),
    parsedFor = (metas) => ({ querySelectorAll(selector) { assert.equal(selector, "meta"); return metas; } });
  for (const skill of ["math-2d", "physics-2d", "math-3d"]) {
    assert.equal(gate(parsedFor([meta(skill)]), "penecho-visual-explorer+html", "penecho-visual-explorer/1"), true);
  }
  assert.equal(gate(parsedFor([meta("math-2d")]), "penecho-visual-explorer+html", "penecho-visual-explorer/2"), false);
  assert.equal(gate(parsedFor([meta("math-2d")]), "penecho-widget+html", "penecho-visual-explorer/1"), false);
  assert.equal(gate(parsedFor([meta("math-4d")]), "penecho-visual-explorer+html", "penecho-visual-explorer/1"), false);
  assert.equal(gate(parsedFor([meta("math-2d", "PENECHO-VISUAL-SKILL")]), "penecho-visual-explorer+html", "penecho-visual-explorer/1"), false);
  assert.equal(gate(parsedFor([meta("math-2d"), meta("math-3d")]), "penecho-visual-explorer+html", "penecho-visual-explorer/1"), false);
  assert.equal(gate(parsedFor([]), "penecho-visual-explorer+html", "penecho-visual-explorer/1"), false);
  assert.match(host, /widgetDocument\(message\.html, message\.pluginStyles \|\| "", runtimeVersion, message\.sourceFormat, message\.frameworkVersion\)/);
});

test("science mode rewrites only exact Manim-Web static and dynamic module imports", () => {
  const host = read("public/widget-host.js"),
    rewrite = vm.runInNewContext(`(${functionSource(host, "rewriteScienceModuleImports")})`),
    canonical = "https://cdn.jsdelivr.net/npm/manim-web@0.3.24/dist/manim-web.browser.js",
    local = "/visual-explorer-manim-web/manim-web.browser.js?v=0.3.24",
    source = `import { Scene } from "${canonical}";\nawait import('${canonical}');\nawait import("${canonical}", { with:{ type:"javascript" } });\nimport "${canonical}";\nconst authored = "${canonical}";\nexport * from "${canonical}";`;
  assert.equal(rewrite(source, canonical, local), `import { Scene } from "${local}";\nawait import('${local}');\nawait import("${local}", { with:{ type:"javascript" } });\nimport "${local}";\nconst authored = "${canonical}";\nexport * from "${canonical}";`);
  const nearMisses = [
    "https://cdn.jsdelivr.net/npm/manim-web/dist/manim-web.browser.js",
    "https://cdn.jsdelivr.net/npm/manim-web@0.3.25/dist/manim-web.browser.js",
    "https://cdn.jsdelivr.net/npm/manim-web@0.3.24/+esm",
    "https://unpkg.com/manim-web@0.3.24/dist/manim-web.browser.js",
  ].map((url) => `import("${url}")`).join("\n");
  assert.equal(rewrite(nearMisses, canonical, local), nearMisses);
  assert.match(host, /if \(type !== "module"\) return;/);
  assert.match(host, /rewriteScienceModuleImports\(element\.textContent \|\| "", authoredManimWebUrl, visualExplorerManimWebUrl\)/);
  const usesManim = vm.runInNewContext(`(${functionSource(host, "scienceUsesManim")})`, {
      authoredManimWebUrl:canonical,
      visualExplorerManimWebUrl:local,
      rewriteScienceModuleImports:rewrite,
    }),
    module = (textContent, type = "module") => ({ textContent, getAttribute(name) { return name === "type" ? type : null; } }),
    parsed = (scripts) => ({ querySelectorAll(selector) { assert.equal(selector, "script:not([src])"); return scripts; } });
  assert.equal(usesManim(parsed([module(`import("${canonical}")`)])), true);
  assert.equal(usesManim(parsed([module(`import(/* authored */ "${canonical}")`)])), true);
  assert.equal(usesManim(parsed([module(`// import("${canonical}")`)])), false);
  assert.equal(usesManim(parsed([module(`const citation = "${canonical}"`, "text/javascript")])), false);
  assert.equal(usesManim(parsed([module("<svg>static</svg>", "application/json")])), false);
});

test("science CSP adds only the exact local Manim-Web source", () => {
  const host = read("public/widget-host.js"),
    urls = {
      rendererUrl:"https://canvas.example/widget-renderer.js",
      visualExplainerVendorUrl:"https://canvas.example/visual-explainer-vendor.js?v=0.2.20",
      visualExplorerManimWebUrl:"https://canvas.example/visual-explorer-manim-web/manim-web.browser.js?v=0.3.24",
      visualExplorerManimMathJaxUrl:"https://canvas.example/visual-explorer-manim-web/MathJaxBundle-xSidSV0E.js?v=0.3.24",
      visualExplainerRuntimeUrl:"https://canvas.example/visual-explainer-runtime.js?v=3",
    },
    csp = vm.runInNewContext(`(${functionSource(host, "csp")})`, urls),
    ordinary = csp(false, false),
    science = csp(false, true),
    sourceUrl = url => url.replace(/[?#].*$/, "");
  assert.equal(ordinary, `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https: ${sourceUrl(urls.rendererUrl)} ${sourceUrl(urls.visualExplainerVendorUrl)} ${sourceUrl(urls.visualExplainerRuntimeUrl)}; style-src 'unsafe-inline' https:; connect-src https:; img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; frame-src 'none'; worker-src blob: https:; object-src 'none'; form-action 'none'; base-uri 'none'`);
  assert.equal(science.replace(` ${sourceUrl(urls.visualExplorerManimWebUrl)} ${sourceUrl(urls.visualExplorerManimMathJaxUrl)};`, ";"), ordinary);
  assert.equal((science.match(new RegExp(sourceUrl(urls.visualExplorerManimWebUrl).replace(/[?.*+^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 1);
  assert.equal((science.match(new RegExp(sourceUrl(urls.visualExplorerManimMathJaxUrl).replace(/[?.*+^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 1);
  assert.doesNotMatch(ordinary, /script-src[^;]*[?#]/);
  assert.doesNotMatch(science, /script-src[^;]*[?#]/);
});

test("science readiness waits for authored ready, the DOM renderer, and two presented frames", () => {
  const host = read("public/widget-host.js"),
    runtimeSource = functionSource(host, "scienceRuntime"),
    posted = [],
    frames = [],
    contexts = [];
  let originalGetContext = null;
  const HTMLCanvasElement = function HTMLCanvasElement() {};
  HTMLCanvasElement.prototype.getContext = function(type, attributes) {
    contexts.push({ type, attributes });
    return { type, attributes };
  };
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  const context = {
    HTMLCanvasElement,
    parent:{ postMessage(message) { posted.push(message); } },
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    clearTimeout() {},
  };
  context.globalThis = context;
  context.window = context;
  vm.runInNewContext(`(${runtimeSource})(9)`, context);
  const canvas = new HTMLCanvasElement();
  canvas.getContext("webgl2", { alpha:false, preserveDrawingBuffer:false });
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].type, "webgl2");
  assert.equal(contexts[0].attributes.alpha, false);
  assert.equal(contexts[0].attributes.preserveDrawingBuffer, true);
  assert.equal(typeof context.window.penechoWidgetReady, "function");
  context.penechoWidgetReady();
  assert.equal(posted.length, 0);
  assert.equal(frames.length, 0);
  context.__penechoScienceRendererReady();
  assert.equal(posted.length, 0);
  assert.equal(frames.length, 1);
  assert.equal(HTMLCanvasElement.prototype.getContext, originalGetContext);
  frames.shift()();
  assert.equal(frames.length, 1);
  assert.equal(posted.length, 0);
  frames.shift()();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, "penecho-widget-document-ready");
  assert.equal(posted[0].runtimeVersion, 9);
  assert.doesNotMatch(runtimeSource, /setTimeout/);
  assert.match(host, /typeof globalThis\.html2canvas===\\"function\\"/);
  assert.match(host, /globalThis\.__penechoScienceRendererReady\?\.\(\)/);

  const staticPosted = [], staticFrames = [], StaticCanvas = function StaticCanvas() {};
  StaticCanvas.prototype.getContext = () => ({});
  const staticContext = {
    HTMLCanvasElement:StaticCanvas,
    parent:{ postMessage(message) { staticPosted.push(message); } },
    requestAnimationFrame(callback) { staticFrames.push(callback); return staticFrames.length; },
  };
  staticContext.globalThis = staticContext;
  staticContext.window = staticContext;
  vm.runInNewContext(`(${runtimeSource})(10, false)`, staticContext);
  staticContext.__penechoScienceRendererReady();
  assert.equal(staticFrames.length, 1);
  staticFrames.shift()();
  staticFrames.shift()();
  assert.equal(staticPosted.length, 1);
  assert.equal(staticPosted[0].runtimeVersion, 10);
  assert.match(host, /scienceRuntime\.toString\(\).*waitForAuthoredReady/);
});

test("science snapshot hooks are bounded and failures do not displace the ordinary snapshot path", async () => {
  const host = read("public/widget-host.js"),
    timerCalls = [],
    timerContext = {
      setTimeout(callback, delay) {
        timerCalls.push(delay);
        Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve()).then(callback);
        return timerCalls.length;
      },
      clearTimeout() {},
    },
    bounded = vm.runInNewContext(`(${functionSource(host, "boundedSnapshotHook")})`, timerContext),
    hookCalls = [];
  await bounded(() => { hookCalls.push("before"); return "settled"; }, "before", 1000);
  assert.deepEqual(hookCalls, ["before"]);
  assert.deepEqual(timerCalls, [1000]);
  await assert.rejects(bounded(() => new Promise(() => { hookCalls.push("pending"); }), "before", 1), /Widget snapshot before hook timed out/);
  assert.deepEqual(hookCalls, ["before", "pending"]);
  assert.deepEqual(timerCalls, [1000, 250]);

  const scienceCalls = [], posted = [], warnings = [],
    scienceContext = {
      runtimeVersion:12,
      parent:{ postMessage(message) { posted.push(message); } },
      console:{ warn(...args) { warnings.push(args.join(" ")); } },
      boundedSnapshotHook: async (hook, phase) => {
        scienceCalls.push(phase);
        try {
          return await hook?.();
        } catch (error) {
          throw Error(`Widget snapshot ${phase} hook failed: ${error.message}`);
        }
      },
      snapshotDocument: async (message, requirePresentedFrame) => {
        scienceCalls.push(`capture:${requirePresentedFrame}`);
        return "canvas";
      },
    },
    scienceSnapshot = vm.runInNewContext(`(${functionSource(host, "scienceSnapshot").replace(/^function/, "async function")})`, scienceContext);
  assert.equal(await scienceSnapshot({ requestId:"science" }, { beforeSnapshot:() => {}, afterSnapshot:() => {} }), "canvas");
  assert.deepEqual(scienceCalls, ["before", "capture:true", "after"]);
  scienceCalls.length = 0;
  assert.equal(await scienceSnapshot({ requestId:"failed", timeoutMs:4000 }, {
      beforeSnapshot() { throw Error("prepare failed"); },
      afterSnapshot() { throw Error("restore failed"); },
    }), undefined);
  assert.deepEqual(scienceCalls, ["before", "after"]);
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [{
    type:"penecho-widget-snapshot-error",
    runtimeVersion:12,
    requestId:"failed",
    error:"Widget snapshot before hook failed: prepare failed",
  }]);
  assert.equal(warnings.some(message => message.includes("snapshot restore failed")), true);

  const snapshotCalls = [],
    snapshot = vm.runInNewContext(`(${functionSource(host, "snapshot")})`, {
      scienceMode:false,
      globalThis:{ __penechoScienceSnapshotHooks:{ beforeSnapshot() { throw Error("collision"); } } },
      snapshotDocument: async (message, requirePresentedFrame) => {
        snapshotCalls.push(requirePresentedFrame);
        return "ordinary";
      },
      scienceSnapshot: async () => "science",
    });
  assert.equal(await snapshot({ requestId:"ordinary" }), "ordinary");
  assert.deepEqual(snapshotCalls, [false]);
  assert.match(host, /runtime\.toString\(\).*JSON\.stringify\(scienceMode\)/);
  assert.match(functionSource(host, "snapshotDocument"), /if \(requirePresentedFrame && !presentedFrame\) throw Error\("Widget frame was not presented"\)/);
  assert.doesNotMatch(functionSource(host, "snapshotDocument"), /__penechoScienceSnapshotHooks|setRuntimeActive\(false\)/);
});
