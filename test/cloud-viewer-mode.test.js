"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
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

test("the read-only viewer mode ships inert locally and activates only on /canvas/view", () => {
  const html = read("public/index.html"), js = read("public/viewer.js"), css = read("public/viewer.css"),
    core = read("src/client/app/core.js"), bootstrap = read("src/client/app/ui-bootstrap.js"), built = read("public/app.js");
  assert.match(html, /<link rel="stylesheet" href="viewer\.css">/);
  assert.match(html, /<script src="viewer\.js" defer><\/script>/);
  assert.match(js, /canvas\\\/view\\\//);
  assert.match(js, /PenEchoCommunityCanvas/);
  assert.match(js, /importWidget|viewCanvas/);
  assert.doesNotMatch(js, /\/api\/cloud\/library/);
  assert.doesNotMatch(js, /bridge\.importCanvas\(/);
  assert.match(js, /\/api\/v1\/auth\/session/);
  assert.match(js, /Read-only — link a device to edit/);
  assert.doesNotMatch(js, /PENECHO_CONFIG\?\.viewer/);
  assert.match(css, /html\.viewer-mode \.topbar[,\s]/);
  assert.match(css, /pointer-events: none !important/);
  assert.match(css, /viewer-topbar/);
  assert.match(core, /window\.PENECHO_CONFIG\?\.runtime === "viewer"[\s\S]*?\? "device"/);
  assert.match(bootstrap, /window\.PENECHO_CONFIG\?\.runtime !== "viewer"\) refreshSnapshots\(\)\.catch/);
  assert.match(built, /window\.PENECHO_CONFIG\?\.runtime === "viewer"[\s\S]*?\? "device"/);
  assert.match(built, /window\.PENECHO_CONFIG\?\.runtime !== "viewer"\) refreshSnapshots\(\)\.catch/);
});

test("the viewer localizes its actions and responsively frames Widgets and complete Canvases", () => {
  const js = read("public/viewer.js"), css = read("public/viewer.css"), canvas = read("src/client/app/canvas-runtime.js"),
    persistence = read("src/client/app/persistence.js"), bootstrap = read("src/client/app/ui-bootstrap.js");
  assert.equal((js.match(/takeFurther:"Echo"/g) || []).length, 2);
  assert.match(js, /backTitle:"Back to Echoes"/);
  assert.match(js, /backTitle:"返回 Echoes"/);
  assert.match(js, /PenEchoI18n\?\.currentLanguage/);
  assert.match(js, /penecho:languagechange/);
  assert.match(js, /fitViewport:true/);
  assert.match(js, /if \(artifact\?\.format === "penecho-widget"\) await bridge\.importWidget\(artifact, null, \{ fitViewport:true \}\);/);
  assert.match(js, /else await bridge\.viewCanvas\(artifact\);/);
  assert.match(canvas, /viewerAutoFitWidgetId/);
  assert.match(canvas, /viewerAutoFitCanvas/);
  assert.match(canvas, /options\?\.fitViewport === true/);
  assert.match(canvas, /visibleInkBounds\(\{ x:0, y:0, w:SIZE, h:SIZE \}\)/);
  assert.match(canvas, /widgetBounds\(\)/);
  assert.match(canvas, /availableWidth \/ Math\.max\(1, viewerBounds\.w\)/);
  assert.match(canvas, /availableHeight \/ Math\.max\(1, viewerBounds\.h\)/);
  assert.match(canvas, /querySelector\("\.viewer-topbar"\)/);
  assert.match(persistence, /async function viewCommunityCanvasArtifact\(artifact\)/);
  assert.match(bootstrap, /viewCanvas:viewCommunityCanvasArtifact/);
  assert.match(css, /\.viewer-chip,[\s\S]*?min-height:\s*36px/);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*?\.viewer-primary \{ min-height:\s*44px/);
  assert.match(css, /@media \(max-width:\s*620px\)/);
});

test("Canvas viewer restores the published bundle in memory without importing it into local history", () => {
  const js = read("public/viewer.js"), persistence = read("src/client/app/persistence.js"),
    start = persistence.indexOf("async function viewCommunityCanvasArtifact(artifact)"),
    end = persistence.indexOf("function communityLineageForArtifact", start),
    viewerRestore = persistence.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(js, /await bridge\.viewCanvas\(artifact\)/);
  assert.match(viewerRestore, /readSnapshotBundle\(artifact\)/);
  assert.match(viewerRestore, /state\.pluginCatalogLoading/);
  assert.match(viewerRestore, /pluginManifests\.has\(widget\?\.pluginId\)/);
  assert.match(viewerRestore, /decodeSnapshotTilesInBatches/);
  assert.match(viewerRestore, /decodeSnapshotImagesInBatches/);
  assert.match(viewerRestore, /restoreWidgets\(item\.widgets\)/);
  assert.match(viewerRestore, /restoreTextBoxes\(item\.textBoxes\)/);
  assert.match(viewerRestore, /fitViewerCanvas\(\)/);
  assert.doesNotMatch(viewerRestore, /saveDeviceSnapshot\(/);
  assert.doesNotMatch(viewerRestore, /refreshSnapshots\(/);
  assert.doesNotMatch(viewerRestore, /requestLoadSnapshot\(/);
});

test("the viewer presents its Widget limitation as a localized, transparent caption", () => {
  const js = read("public/viewer.js"), css = read("public/viewer.css");
  assert.match(js, /Live-data Widgets are static here; sign in and link a device to interact\./);
  assert.match(js, /实时 Widget 在此为静态预览；登录并连接设备即可交互。/);
  assert.match(js, /createElement\("button"\)/);
  assert.match(js, /notice\.hidden = true/);
  assert.match(js, /dismissNotice:"Hide this message"/);
  assert.match(js, /dismissNotice:"隐藏此提示"/);
  assert.match(css, /\.viewer-notice\s*\{[\s\S]*?background:\s*transparent;/);
  assert.match(css, /\.viewer-notice\s*\{[\s\S]*?color:\s*var\(--muted,/);
  assert.match(css, /white-space:\s*nowrap/);
  assert.match(css, /text-overflow:\s*ellipsis/);
  assert.match(css, /\.viewer-notice\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.doesNotMatch(css, /\.viewer-notice\s*\{[\s\S]*?background:\s*rgb\(10 9 6/);
});

test("the viewer controls stay quiet until hovered or focused", () => {
  const css = read("public/viewer.css");
  assert.match(css, /\.viewer-brand\s*\{[\s\S]*?opacity:\s*\.5/);
  assert.match(css, /\.viewer-actions\s*\{[\s\S]*?opacity:\s*\.5/);
  assert.match(css, /\.viewer-brand:hover\s*\{\s*opacity:\s*1/);
  assert.match(css, /\.viewer-actions:hover,[\s\S]*?\.viewer-actions:focus-within\s*\{\s*opacity:\s*1/);
});

test("Widget hosts stay same-origin in Viewer and Cloud while the local app keeps loopback isolation", (t) => {
  const canvas = read("src/client/app/canvas-runtime.js"),
    source = functionSource(canvas, "widgetHostUrl"),
    resolveHost = (runtime, pageUrl, connect = []) => {
      const page = new URL(pageUrl),
        canvasRoot = runtime === "cloud" || runtime === "viewer" ? "/canvas/" : "/";
      return vm.runInNewContext(`(${source})`, {
        URL,
        canvasAssetUrl:(name) => new URL(name, new URL(canvasRoot, page.origin)).href,
        configuredAccessSession:"",
        location:{ origin:page.origin },
        window:{ PENECHO_CONFIG:{ runtime } },
      })({ connect });
    };

  for (const page of [
    "http://127.0.0.1:18082/canvas/view/2c01",
    "http://localhost:18082/canvas/view/2c01",
    "https://penecho.ai/canvas/view/2c01",
  ]) {
    const host = new URL(resolveHost("viewer", page, ["https://api.example"]));
    assert.equal(host.origin, new URL(page).origin);
    assert.equal(host.pathname, "/canvas/widget-host.html");
    assert.equal(host.searchParams.has("parent-origin"), false);
    assert.deepEqual(host.searchParams.getAll("connect"), ["https://api.example"]);
  }

  const cloudHost = new URL(resolveHost("cloud", "http://127.0.0.1:18082/canvas/community/2c01"));
  assert.equal(cloudHost.origin, "http://127.0.0.1:18082");
  assert.equal(cloudHost.searchParams.get("remote-canvas"), "1");
  assert.equal(cloudHost.searchParams.has("parent-origin"), false);

  const local127 = new URL(resolveHost("device", "http://127.0.0.1:18081/"));
  assert.equal(local127.origin, "http://localhost:18081");
  assert.equal(local127.searchParams.get("parent-origin"), "http://127.0.0.1:18081");
  const localName = new URL(resolveHost("device", "http://localhost:18081/"));
  assert.equal(localName.origin, "http://127.0.0.1:18081");
  assert.equal(localName.searchParams.get("parent-origin"), "http://localhost:18081");

  const cloudRoot = path.resolve(root, "..", "penecho_cloud"),
    cloudWidgetRoutePath = path.join(cloudRoot, "src", "routes", "plugins.mjs"),
    cloudAppPath = path.join(cloudRoot, "src", "app.mjs");
  if (!fs.existsSync(cloudWidgetRoutePath) || !fs.existsSync(cloudAppPath)) {
    t.diagnostic("Sibling PenEcho Cloud checkout is unavailable; local Viewer origin assertions still passed.");
    return;
  }
  const cloudWidgetRoute = fs.readFileSync(cloudWidgetRoutePath, "utf8"),
    cloudApp = fs.readFileSync(cloudAppPath, "utf8");
  assert.match(cloudWidgetRoute, /frame-ancestors 'self'/);
  assert.match(cloudApp, /frame-src 'self' blob:/);
});

test("Viewer Widget initialization recovers when the host's first ready message is missed", async () => {
  const canvas = read("src/client/app/canvas-runtime.js"),
    host = read("public/widget-host.js"),
    runtimeSource = [
      functionSource(canvas, "probeWidgetHost"),
      functionSource(canvas, "sendWidgetInit"),
      functionSource(canvas, "sendWidgetHostState"),
      functionSource(canvas, "markWidgetHostReady"),
      `async ${functionSource(canvas, "handleWidgetMessage")}`,
    ].join("\n"),
    origin = "http://127.0.0.1:18082",
    sentToHost = [],
    hostWindow = {
      postMessage(message, targetOrigin) { sentToHost.push({ message, targetOrigin }); },
    },
    widget = {
      id:"widget-1",
      pluginId:"general",
      title:"Recovered Widget",
      html:"<!doctype html><main>Visible</main>",
      frame:{ contentWindow:hostWindow },
      hostOrigin:origin,
      hostReady:false,
      initialized:false,
      renderActive:true,
      pending:false,
      w:600,
      h:400,
      contentW:600,
      contentH:400,
    },
    state = {
      widgets:[widget],
      pendingWidget:null,
      scale:1,
      navigationLocked:false,
      widgetEdit:null,
      selectedWidgetId:null,
    },
    runtime = vm.runInNewContext(`(() => { ${runtimeSource}; return { probeWidgetHost, handleWidgetMessage }; })()`, {
      state,
      location:{ origin },
      pluginManifests:new Map([["general", { styles:"main{display:block}" }]]),
    });

  // The outer iframe load callback uses this probe after its message listener
  // is installed, so recovery does not depend on the initial one-shot ready.
  assert.match(functionSource(canvas, "mountWidget"), /addEventListener\("load"[\s\S]*?probeWidgetHost\(widget\)/);
  assert.equal(runtime.probeWidgetHost(widget), true);
  assert.equal(sentToHost.length, 1);
  assert.equal(sentToHost[0].message.type, "penecho-widget-host-probe");
  assert.equal(sentToHost[0].targetOrigin, origin);

  const sentToParent = [],
    parentWindow = { postMessage(message, targetOrigin) { sentToParent.push({ message, targetOrigin }); } },
    hostHandshake = vm.runInNewContext(`(() => {
      ${functionSource(host, "announceWidgetHostReady")}
      ${functionSource(host, "respondToWidgetHostProbe")}
      return respondToWidgetHostProbe;
    })()`, { parent:parentWindow, parentOrigin:origin });
  assert.equal(hostHandshake({ source:parentWindow, origin:"http://localhost:18082", data:{ type:"penecho-widget-host-probe" } }), false);
  assert.equal(sentToParent.length, 0);
  assert.equal(hostHandshake({ source:parentWindow, origin, data:{ type:"penecho-widget-host-probe" } }), true);
  assert.equal(sentToParent[0].message.type, "penecho-widget-host-ready");
  assert.equal(sentToParent[0].targetOrigin, origin);

  await runtime.handleWidgetMessage({ source:hostWindow, origin, data:sentToParent[0].message });
  assert.equal(widget.hostReady, true);
  assert.equal(widget.initialized, true);
  assert.equal(sentToHost.length, 3);
  assert.equal(sentToHost[1].message.type, "penecho-widget-init");
  assert.equal(sentToHost[1].message.html, widget.html);
  assert.equal(sentToHost[1].targetOrigin, origin);
  assert.equal(sentToHost[2].message.type, "penecho-widget-state");
  assert.equal(sentToHost[2].message.active, true);
  assert.equal(sentToHost[2].targetOrigin, origin);
});

test("Viewer fit produces visible transforms for a multi-Widget Canvas", () => {
  const canvas = read("src/client/app/canvas-runtime.js"),
    core = read("src/client/app/core.js"),
    widgets = [
      { id:"widget-1", x:1000, y:2000, w:600, h:400, contentW:600, contentH:400, styleRule:{ style:{} } },
      { id:"widget-2", x:2300, y:2400, w:800, h:600, contentW:800, contentH:600, styleRule:{ style:{} } },
    ];
  for (const widget of widgets) {
    const classes = new Set();
    widget.shell = { classList:{ toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } } };
    widget.classes = classes;
  }
  const state = { widgets, scale:.03, panX:0, panY:0, animationFullRedraw:false, viewInitialized:false, widgetGesture:null },
    rect = { left:0, top:0, width:1200, height:800 },
    view = { clientWidth:1200, clientHeight:800, getBoundingClientRect:() => rect },
    unionLocalBounds = (left, right) => {
      if (!left) return right || null;
      if (!right) return left;
      const x = Math.min(left.x, right.x), y = Math.min(left.y, right.y),
        maxX = Math.max(left.x + left.w, right.x + right.w), maxY = Math.max(left.y + left.h, right.y + right.h);
      return { x, y, w:maxX - x, h:maxY - y };
    },
    widgetBounds = () => widgets.reduce((bounds, widget) => unionLocalBounds(bounds, widget), null),
    layer = {},
    runtime = vm.runInNewContext(`(() => {
      ${functionSource(canvas, "fit")}
      ${functionSource(canvas, "updateWidgetRenderVisibility")}
      ${functionSource(canvas, "positionWidget")}
      return { fit, positionWidget };
    })()`, {
      SIZE:20000,
      INITIAL_VIEW_ZOOM:1.5,
      viewerAutoFitWidgetId:null,
      viewerAutoFitCanvas:true,
      state,
      view,
      screen:{},
      animationLayer:{},
      placedContentLayer:{},
      inkLayer:{},
      interactionLayer:layer,
      devicePixelRatio:1,
      visibleInkBounds:() => null,
      imageBounds:() => null,
      textBoxBounds:() => null,
      animationBounds:() => null,
      widgetBounds,
      unionLocalBounds,
      document:{ querySelector:() => ({ getBoundingClientRect:() => ({ bottom:56 }) }) },
      updateCoordinates() {},
      requestRender() {},
      sendWidgetInit() {},
      sendWidgetHostState() {},
    });

  runtime.fit();
  assert.ok(state.scale > .5 && state.scale < .54);
  for (const widget of widgets) runtime.positionWidget(widget);
  assert.equal(widgets[0].renderActive, true);
  assert.equal(widgets[1].renderActive, true);
  assert.equal(widgets[0].classes.has("widget-offscreen"), false);
  assert.equal(widgets[1].classes.has("widget-offscreen"), false);
  assert.match(widgets[0].styleRule.style.transform, /^translate3d\(40(?:\.0+)?px,1\d\d(?:\.\d+)?px,0\) scale\(0\.5/);
  assert.match(widgets[1].styleRule.style.transform, /^translate3d\(7\d\d(?:\.\d+)?px,3\d\d(?:\.\d+)?px,0\) scale\(0\.5/);
  assert.equal(widgets[0].styleRule.style.width, "600px");
  assert.equal(widgets[1].styleRule.style.height, "600px");

  const catalogLoad = functionSource(core, "loadPluginDocuments");
  assert.ok(catalogLoad.indexOf("syncWidgetRuntime();") < catalogLoad.indexOf("if (pluginEnabled(widget.pluginId)) mountWidget(widget)"));
});

test("Viewer skips onboarding observers and hidden plugin preview hosts, with a real-Node observer guard", () => {
  const core = read("src/client/app/core.js"),
    targetSource = functionSource(core, "featureTourObserverTarget"),
    activeObserver = functionSource(core, "observeActiveFeatureTour"),
    pendingObserver = functionSource(core, "watchForPendingFeatureTour"),
    onboardingSource = functionSource(core, "maybeStartOnboarding"),
    previewSource = functionSource(core, "updatePluginStylesPreview"),
    TestNode = class TestNode {},
    body = new TestNode();

  const deviceWindow = { PENECHO_CONFIG:{ runtime:"device" } };
  assert.equal(vm.runInNewContext(`(${targetSource})`, { document:{ body }, Node:TestNode, window:deviceWindow })(), body);
  assert.equal(vm.runInNewContext(`(${targetSource})`, { document:{ body:{} }, Node:TestNode, window:deviceWindow })(), null);
  assert.equal(vm.runInNewContext(`(${targetSource})`, { document:{ body:null }, Node:TestNode, window:deviceWindow })(), null);
  assert.equal(vm.runInNewContext(`(${targetSource})`, { document:{ body:{} }, window:deviceWindow })(), null);
  assert.equal(vm.runInNewContext(`(${targetSource})`, { document:{ body }, Node:TestNode, window:{ PENECHO_CONFIG:{ runtime:"viewer" } } })(), null);
  assert.match(activeObserver, /const target = featureTourObserverTarget\(\);[\s\S]*?!target[\s\S]*?\.observe\(target,/);
  assert.match(pendingObserver, /const target = featureTourObserverTarget\(\);[\s\S]*?!target[\s\S]*?\.observe\(target,/);

  let featureTourStarts = 0, changelogStarts = 0;
  const startViewerOnboarding = vm.runInNewContext(`(${onboardingSource})`, {
    window:{ PENECHO_CONFIG:{ runtime:"viewer" } },
    maybeStartFeatureTour:() => { featureTourStarts++; return false; },
    maybeShowChangelog:() => { changelogStarts++; },
  });
  assert.equal(startViewerOnboarding(), false);
  assert.equal(featureTourStarts, 0);
  assert.equal(changelogStarts, 0);
  assert.match(previewSource, /window\.PENECHO_CONFIG\?\.runtime === "viewer"\) return;/);
});

test("the cloud sync allow-list carries the viewer assets", (t) => {
  const cloudRoot = path.resolve(root, "..", "penecho_cloud");
  const syncPath = path.join(cloudRoot, "tools", "sync-public-canvas.mjs");
  if (!fs.existsSync(syncPath)) {
    t.skip("Sibling PenEcho Cloud checkout is unavailable in this CI job.");
    return;
  }
  const sync = fs.readFileSync(syncPath, "utf8");
  assert.match(sync, /"viewer\.js"/);
  assert.match(sync, /"viewer\.css"/);
  assert.ok(fs.existsSync(path.join(cloudRoot, "public", "canvas", "viewer.js")));
  assert.ok(fs.existsSync(path.join(cloudRoot, "public", "canvas", "viewer.css")));
});
