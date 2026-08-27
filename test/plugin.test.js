"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, ".."),
  source = fs.readFileSync(path.join(ROOT, "public", "plugins.js"), "utf8"),
  pluginDirectory = path.join(ROOT, "public", "plugins"),
  pluginFiles = fs.readdirSync(pluginDirectory).filter((file) => file.endsWith(".md")).sort(),
  pluginBundles = fs.readdirSync(pluginDirectory, { withFileTypes:true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(pluginDirectory, entry.name, "plugin.md")))
    .map((entry) => `${entry.name}/plugin.md`),
  pluginDocuments = [...pluginFiles, ...pluginBundles].sort(),
  weather = fs.readFileSync(path.join(ROOT, "public", "plugins", "weather", "plugin.md"), "utf8"),
  context = { window:{}, URL };
vm.runInNewContext(source, context);
const plugins = context.window.PENECHO_PLUGINS;

function functionSource(input, name) {
  const start = input.indexOf(`function ${name}(`), body = input.indexOf("{", start);
  assert.notEqual(start, -1, `missing function ${name}`);
  let depth = 0;
  for (let index = body; index < input.length; index++) {
    if (input[index] === "{") depth++;
    else if (input[index] === "}" && --depth === 0) return input.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
}

function parsePlugin(relativePath) {
  const documentPath = path.join(pluginDirectory, relativePath),
    stylePath = path.join(path.dirname(documentPath), "styles.css"),
    styles = relativePath.includes("/") && fs.existsSync(stylePath) ? fs.readFileSync(stylePath, "utf8") : "";
  return plugins.parse(fs.readFileSync(documentPath, "utf8"), styles);
}

function widgetRuntimeHarness(options = {}) {
  const host = fs.readFileSync(path.join(ROOT, "public", "widget-host.js"), "utf8"),
    listeners = new Map(), messages = [], timers = new Map(), frames = new Map(), parent = {}, classes = new Set(), opened = [], directFetches = [], dispatched = [],
    createdObjectUrls = [], revokedObjectUrls = [],
    animation = {
      playState:"running",
      pause() { this.playState = "paused"; },
      play() { this.playState = "running"; },
    },
    svg = {
      paused:false,
      animationsPaused() { return this.paused; },
      pauseAnimations() { this.paused = true; },
      unpauseAnimations() { this.paused = false; },
    },
    documentElement = {
      clientWidth:1000,
      clientHeight:600,
      classList:{ add(name) { classes.add(name); }, remove(name) { classes.delete(name); } },
      setPointerCapture() {},
      releasePointerCapture() {},
    },
    RuntimeURL = class RuntimeURL extends URL {};
  RuntimeURL.createObjectURL = () => {
    const value = `blob:http://127.0.0.1/fallback-${createdObjectUrls.length + 1}`;
    createdObjectUrls.push(value);
    return value;
  };
  RuntimeURL.revokeObjectURL = value => revokedObjectUrls.push(value);
  let nextTimer = 1, nextFrame = 1;
  const sandbox = {
    document:{ baseURI:"blob:http://127.0.0.1/widget", documentElement, getSelection:() => ({ removeAllRanges() {} }), getAnimations:() => [animation], querySelectorAll:() => [svg] },
    parent,
    URL:RuntimeURL,
    open(...args) { opened.push(args); return {}; },
    fetch(...args) {
      directFetches.push(args);
      return options.fetch ? options.fetch(...args) : Promise.resolve(new Response("direct response"));
    },
    performance:{ now:() => 100 },
    Event:class RuntimeEvent { constructor(type) { this.type = type; } },
    dispatchEvent(event) { dispatched.push(event.type); return true; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    setTimeout(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ArrayBuffer,
    Blob,
    Headers,
    Request,
    Response,
  };
  parent.postMessage = (message) => messages.push(message);
  vm.runInNewContext(`(${functionSource(host, "runtime")})()`, sandbox);
  const pointer = (type, overrides = {}) => {
    const event = {
      pointerId:1,
      pointerType:"touch",
      button:0,
      clientX:100,
      clientY:100,
      screenX:100,
      screenY:100,
      preventDefault() {},
      stopImmediatePropagation() {},
      ...overrides,
    };
    listeners.get(type)(event);
    return event;
  };
  return {
    messages,
    opened,
    directFetches,
    pointer,
    select(selected = true, scaleX = 1, scaleY = 1, active = true) {
      listeners.get("message")({ source:parent, data:{ type:"penecho-widget-state", selected, active, scaleX, scaleY } });
    },
    animation,
    svg,
    classes,
    dispatched,
    fetchPublic(url) { return sandbox.penechoFetchPublic(url); },
    fetch(url, init = { credentials:"omit" }) { return sandbox.fetch(url, init); },
    open(url) { return sandbox.open(url); },
    resourceError(target) {
      let prevented = false, stopped = false;
      listeners.get("error")({
        target,
        preventDefault() { prevented = true; },
        stopImmediatePropagation() { stopped = true; },
      });
      return { prevented, stopped };
    },
    createdObjectUrls,
    revokedObjectUrls,
    click(target) {
      let prevented = false;
      listeners.get("click")({ target, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
      return { prevented };
    },
    respond(message) { listeners.get("message")({ source:parent, data:message }); },
    requestFrame(callback) { return sandbox.requestAnimationFrame(callback); },
    runFrames() {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(100);
    },
    runTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
    },
  };
}

test("widget public-data bridge returns a fetch-compatible response", async () => {
  const runtime = widgetRuntimeHarness(), pending = runtime.fetchPublic("https://example.com/feed.xml"),
    request = runtime.messages.at(-1);
  assert.equal(request.type, "penecho-widget-public-fetch-request");
  assert.equal(request.url, "https://example.com/feed.xml");
  runtime.respond({
    type:"penecho-widget-public-fetch-response",
    requestId:request.requestId,
    status:200,
    body:"<rss></rss>",
    contentType:"application/rss+xml; charset=utf-8",
    finalUrl:"https://example.com/feed.xml",
  });
  const response = await pending;
  assert.equal(response.ok, true);
  assert.equal(response.headers.get("content-type"), "application/rss+xml; charset=utf-8");
  assert.equal(await response.text(), "<rss></rss>");
});

test("widget public-data bridge preserves binary image responses", async () => {
  const runtime = widgetRuntimeHarness(), pending = runtime.fetchPublic("https://example.com/image.png"),
    request = runtime.messages.at(-1), bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  runtime.respond({
    type:"penecho-widget-public-fetch-response",
    requestId:request.requestId,
    status:200,
    body:bytes.buffer,
    contentType:"image/png",
    finalUrl:"https://example.com/image.png",
  });
  const response = await pending;
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...bytes]);
});

test("widget fetch tries the source directly and falls back to the public-data bridge after HTTP or CORS failure", async () => {
  const direct = widgetRuntimeHarness(), directResponse = await direct.fetch("https://example.com/direct.json");
  assert.equal(await directResponse.text(), "direct response");
  assert.equal(direct.directFetches.length, 1);
  assert.equal(direct.messages.some(message => message.type === "penecho-widget-public-fetch-request"), false);

  const notFound = widgetRuntimeHarness({ fetch:() => Promise.resolve(new Response("missing", { status:404 })) }),
    notFoundPending = notFound.fetch("https://example.com/missing.json");
  await new Promise(resolve => setImmediate(resolve));
  const notFoundRequest = notFound.messages.at(-1);
  assert.equal(notFoundRequest.type, "penecho-widget-public-fetch-request");
  notFound.respond({
    type:"penecho-widget-public-fetch-response",
    requestId:notFoundRequest.requestId,
    status:200,
    body:'{"source":"proxy"}',
    contentType:"application/json",
    finalUrl:notFoundRequest.url,
  });
  const notFoundResponse = await notFoundPending;
  assert.deepEqual(await notFoundResponse.json(), { source:"proxy" });

  const unavailable = widgetRuntimeHarness({ fetch:() => Promise.resolve(new Response("original unavailable", { status:503 })) }),
    unavailablePending = unavailable.fetch("https://example.com/unavailable.json");
  await new Promise(resolve => setImmediate(resolve));
  const unavailableRequest = unavailable.messages.at(-1);
  unavailable.respond({
    type:"penecho-widget-public-fetch-response",
    requestId:unavailableRequest.requestId,
    error:"The public data request failed",
  });
  const unavailableResponse = await unavailablePending;
  assert.equal(unavailableResponse.status, 503);
  assert.equal(await unavailableResponse.text(), "original unavailable");

  const corsBlocked = widgetRuntimeHarness({ fetch:() => Promise.reject(new TypeError("Failed to fetch")) }),
    pending = corsBlocked.fetch("https://www.reddit.com/hot.json?limit=10&raw_json=1");
  await new Promise(resolve => setImmediate(resolve));
  const request = corsBlocked.messages.at(-1);
  assert.equal(request.type, "penecho-widget-public-fetch-request");
  assert.equal(request.url, "https://www.reddit.com/hot.json?limit=10&raw_json=1");
  corsBlocked.respond({
    type:"penecho-widget-public-fetch-response",
    requestId:request.requestId,
    status:200,
    body:'{"data":{"children":[]}}',
    contentType:"application/json",
    finalUrl:request.url,
  });
  const fallbackResponse = await pending;
  assert.equal(fallbackResponse.ok, true);
  assert.deepEqual(await fallbackResponse.json(), { data:{ children:[] } });
});

test("widget image loads fall back through the public-data bridge and use a local blob URL", async () => {
  const runtime = widgetRuntimeHarness(), imageListeners = new Map(), removedAttributes = [],
    image = {
      tagName:"IMG",
      currentSrc:"https://images.example.com/chart.png",
      src:"https://images.example.com/chart.png",
      parentElement:null,
      getAttribute:name => name === "src" ? "https://images.example.com/chart.png" : null,
      removeAttribute:name => removedAttributes.push(name),
      addEventListener:(type, listener) => imageListeners.set(type, listener),
      dispatchEvent() {},
    },
    intercepted = runtime.resourceError(image);
  assert.deepEqual(intercepted, { prevented:true, stopped:true });
  const request = runtime.messages.at(-1);
  assert.equal(request.type, "penecho-widget-public-fetch-request");
  assert.equal(request.url, "https://images.example.com/chart.png");
  runtime.respond({
    type:"penecho-widget-public-fetch-response",
    requestId:request.requestId,
    status:200,
    body:Uint8Array.from([137, 80, 78, 71]).buffer,
    contentType:"image/png",
    finalUrl:request.url,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(image.src, runtime.createdObjectUrls[0]);
  assert.deepEqual(removedAttributes, ["srcset", "crossorigin"]);
  imageListeners.get("load")();
  assert.deepEqual(runtime.revokedObjectUrls, runtime.createdObjectUrls);
});

test("widget fetch does not proxy credentialed, body-bearing, or aborted requests", async () => {
  const runtime = widgetRuntimeHarness({ fetch:() => Promise.reject(new TypeError("Failed to fetch")) });
  await assert.rejects(runtime.fetch("https://example.com/private", { credentials:"include" }), /Failed to fetch/);
  await assert.rejects(runtime.fetch("https://example.com/post", { method:"POST", body:"value", credentials:"omit" }), /Failed to fetch/);
  await assert.rejects(runtime.fetch("https://example.com/aborted", { credentials:"omit", signal:{ aborted:true } }), /Failed to fetch/);
  assert.equal(runtime.messages.some(message => message.type === "penecho-widget-public-fetch-request"), false);
});

test("widget runtime notifies size-sensitive libraries when first shown or resumed", () => {
  const runtime = widgetRuntimeHarness();
  runtime.select(true, 1, 1, true);
  runtime.select(true, 1, 1, true);
  assert.deepEqual(runtime.dispatched, ["resize"]);
  runtime.select(false, 1, 1, false);
  runtime.select(false, 1, 1, true);
  assert.deepEqual(runtime.dispatched, ["resize", "resize"]);
});

test("widget links are limited to public HTTPS and always open outside the sandbox", () => {
  const runtime = widgetRuntimeHarness(), attributes = new Map([["href", "https://example.com/news?id=7"], ["target", "_self"]]),
    anchor = {
      getAttribute:name => attributes.get(name) || null,
      setAttribute:(name, value) => attributes.set(name, value),
      removeAttribute:name => attributes.delete(name),
    },
    target = { closest:() => anchor };
  assert.equal(runtime.click(target).prevented, false);
  assert.equal(attributes.get("target"), "_blank");
  assert.equal(attributes.get("rel"), "noopener noreferrer");
  assert.equal(runtime.open("http://example.com/news"), null);
  assert.equal(runtime.open("javascript:alert(1)"), null);
  assert.deepEqual(runtime.opened, []);
  runtime.open("https://example.com/news");
  assert.deepEqual(runtime.opened, [["https://example.com/news", "_blank", "noopener,noreferrer"]]);
});

test("public-data proxy queues requests beyond twenty and resumes them when a slot opens", async () => {
  const queue = require("../src/server/public-fetch.js").createPublicFetchService({ maxConcurrent:20, queueTimeoutMs:30000 });
  await Promise.all(Array.from({ length:20 }, () => queue.waitForPublicFetchSlot(new AbortController().signal)));
  let resumed = false;
  const queued = queue.waitForPublicFetchSlot(new AbortController().signal).then(() => (resumed = true));
  await Promise.resolve();
  assert.equal(resumed, false);
  queue.releasePublicFetchSlot();
  await queued;
  assert.equal(resumed, true);
  for (let index = 0; index < 20; index++) queue.releasePublicFetchSlot();
});

test("weather demo is a concise capability contract without an HTML template", () => {
  const parsed = plugins.parse(weather);
  assert.equal(parsed.id, "weather");
  assert.equal(parsed.version, "1");
  assert.equal(parsed.recommendedRefreshSeconds, 900);
  assert.equal(parsed.nameZh, "天气");
  assert.equal(parsed.source, "Open-Meteo");
  assert.deepEqual([...parsed.connect], ["https://geocoding-api.open-meteo.com", "https://api.open-meteo.com"]);
  assert.ok(Buffer.byteLength(parsed.document, "utf8") <= 3000);
  assert.match(parsed.document, /^## One-shot example$/m);
  assert.doesNotMatch(parsed.document, /```html/i);
  assert.match(parsed.document, /Generate a complete responsive HTML document/);
  assert.match(parsed.document, /keep text large/);
  assert.match(parsed.document, /transparent outer layout with no card background or shadow/);
  assert.match(parsed.document, /penecho-widget-updated/);
  assert.match(parsed.document, /credentials:"omit"/);
});

test("every built-in plugin uses a directory bundle", () => {
  const builtIns = ["earthquakes/plugin.md", "exchange-rates/plugin.md", "flowchart/plugin.md", "general/plugin.md", "github-pulse/plugin.md", "image-search/plugin.md", "natural-events/plugin.md", "space-weather/plugin.md", "stocks/plugin.md", "tech-news/plugin.md", "weather/plugin.md"];
  assert.deepEqual(pluginDocuments.filter((file) => builtIns.includes(file)), builtIns);
  const allParsed = pluginDocuments.map(parsePlugin),
    parsed = builtIns.map(parsePlugin);
  assert.equal(new Set(allParsed.map((plugin) => plugin.id)).size, allParsed.length);
  for (const plugin of parsed) {
    assert.ok(Buffer.byteLength(plugin.document, "utf8") <= 12000, plugin.id);
    assert.ok(plugin.nameZh, plugin.id);
    assert.ok(plugin.description, plugin.id);
    assert.ok(plugin.descriptionZh, plugin.id);
    assert.ok(plugin.category, plugin.id);
    assert.ok(plugin.categoryZh, plugin.id);
    assert.ok(plugin.source, plugin.id);
    assert.match(plugin.document, /^## One-shot example$/m, plugin.id);
    assert.match(plugin.document, plugin.id === "flowchart" ? /`diagram_source`/ : /`html_widget`/, plugin.id);
    if (plugin.connect.length) assert.match(plugin.document, /credentials:"omit"/, plugin.id);
    assert.match(plugin.document, /penecho-widget-updated/, plugin.id);
    assert.doesNotMatch(plugin.document, /```html/i, plugin.id);
  }
  assert.deepEqual([...parsed.find((plugin) => plugin.id === "stocks").connect], ["https://web.ifzq.gtimg.cn"]);
  assert.deepEqual([...parsed.find((plugin) => plugin.id === "tech-news").connect], ["https://hn.algolia.com"]);
  const general = parsed.find((plugin) => plugin.id === "general");
  assert.deepEqual([...general.connect], []);
  assert.match(general.document, /source: Public HTTPS web/);
  assert.match(general.document, /credentials:"omit"/);
  assert.match(general.document, /local channel solves browser CORS, not source authentication/);
  assert.match(general.document, /ordinary `fetch/);
  assert.match(general.document, /automatically falls back through its server/);
  assert.match(general.document, /browser CORS or a direct network failure/);
  assert.match(general.document, /may use public HTTPS URLs directly/);
  assert.doesNotMatch(general.document, /penechoFetchPublic/);
  assert.match(general.document, /need no CORS workaround/);
  assert.match(general.document, /response\.blob\(\)/);
  assert.match(general.document, /五颜六色的钟/);
  assert.match(general.document, /Native HTML, CSS, JavaScript, timers, SVG, and canvas remain preferred/);
  assert.match(general.document, /native `draw`[\s\S]*?10 or fewer basic primitives or line segments/);
  assert.match(general.document, /SVG is the default static and animated visual format/);
  assert.match(general.document, /never use a JSON, XML, YAML, source-code, or `<pre>` dump as the primary view/);
  assert.match(general.document, /locally renders its supported `diagram_source` formats from source alone/);
  assert.match(general.document, /Placement is semantic, not a search for unused canvas space/);
  assert.match(general.document, /## Capability router[\s\S]*Choose exactly one primary Widget path before authoring/);
  assert.match(general.document, /Use Visual Explainer when[\s\S]*Use ordinary General HTML when custom behavior is primary[\s\S]*Use Professional Diagrams when/);
  assert.match(general.document, /Transformer explanation is Visual Explainer[\s\S]*interactive attention simulator is General HTML[\s\S]*editable C4 model is Professional Diagrams/);
  assert.match(general.document, /Merely asking to draw, explain, or show an architecture, model, structure, process, flow, diagram, or chart is not enough[\s\S]*Visual Explainer when available/);
  assert.match(general.document, /overlay only the solution path on an existing maze/);
  assert.match(general.document, /existing figures or objects[\s\S]*?position the transparent widget over their actual locations[\s\S]*?never redraw the figures/);
  assert.match(general.document, /Match the current PenEcho theme and nearby visual language/);
  assert.match(general.document, /contained opaque or translucent surface[\s\S]*?materially improves contrast, legibility, semantic grouping, or media presentation[\s\S]*?smallest necessary local surface/);
  assert.match(general.document, /Dynamic SVG fully supports/);
  assert.match(general.document, /multi-part SVG visual[\s\S]*?wrapping CSS layout with tight-viewBox panels[\s\S]*?never make the whole widget one fixed-size viewBox/);
  assert.match(general.document, /explicitly aim the camera at the subject and keep it centered after resize/);
  assert.match(general.document, /Redraw canvas, SVG, and 3D visuals after viewport changes when needed/);
  assert.match(general.document, /source URLs from fetched news[\s\S]*?target="_blank"[\s\S]*?noopener noreferrer/);
  assert.match(general.document, /HTML is the sole reusable source[\s\S]*?Omit `copyText` and `copyLabel`[\s\S]*?Copy HTML/);
  assert.match(general.document, /Do not minify[\s\S]*?stable multiline formatting[\s\S]*?below 160 characters/);
  const flowchart = parsed.find((plugin) => plugin.id === "flowchart");
  assert.deepEqual([...flowchart.connect], []);
  assert.match(flowchart.document, /Professional fields not named here remain in scope/);
  assert.match(flowchart.document, /electrical\/electronic circuits and IEC\/IEEE schematics/);
  assert.match(flowchart.document, /mechanical kinematics[\s\S]*?chemical structures[\s\S]*?medical devices[\s\S]*?financial cash flow/);
  assert.match(flowchart.document, /local renderers are baseline conveniences, not the boundary/);
  assert.match(flowchart.document, /Never fall back to an improvised generic SVG/);
  assert.match(flowchart.document, /Prefer `diagram_source`[\s\S]*?PenEcho supplies the iframe, renderer, shared CSS, Copy button/);
  assert.match(flowchart.document, /Do not return HTML alongside a supported local format[\s\S]*?professional `source`/);
  assert.match(flowchart.document, /Use `html_widget` instead[\s\S]*?not locally rendered[\s\S]*?custom interaction/);
  assert.match(flowchart.document, /PlantUML, DBML, draw\.io XML, D2, Structurizr DSL, Excalidraw JSON, KiCad, SPICE/);
  assert.match(flowchart.document, /### A\. Locally rendered source: `diagram_source`/);
  assert.match(flowchart.document, /### B\. Directly rendered HTML: `html_widget`/);
  assert.match(flowchart.document, /WaveDrom JSON[\s\S]*?digital timing diagrams/);
  assert.match(flowchart.document, /examples above are not a whitelist[\s\S]*?describe, sketch or name any professional diagram/);
  assert.match(flowchart.document, /most suitable locally rendered `diagram_source` or directly rendered `html_widget`/);
  for (const format of ["mermaid", "dot", "bpmn-xml", "vega-lite", "geojson", "smiles", "cytoscape-json"])
    assert.match(flowchart.document, new RegExp(`\\\`${format}\\\``));
  assert.match(flowchart.document, /Do not include HTML, CSS, imports, URLs, or JavaScript in `diagram_source`/);
  assert.match(flowchart.document, /Use only when the required artifact needs established professional notation[\s\S]*faithful quantitative chart with axes and scales[\s\S]*Do not select it merely because the user says diagram, chart, architecture, model, structure, process, flow, or draw/);
  assert.match(flowchart.document, /C4\/BPMN[\s\S]*Transformer explanations[\s\S]*simulators, live maps/);
  assert.match(flowchart.document, /diagram background transparent by default[\s\S]*opaque or translucent backing[\s\S]*materially improves contrast, legibility, semantic grouping, or media presentation/);
  assert.match(flowchart.document, /palette and density that best match the current PenEcho theme and nearby Canvas content/);
  assert.match(flowchart.document, /use 3–5 meaningful phases[\s\S]*only when most inter-phase flow stays forward[\s\S]*Keep rework, exception and rejection branches beside the decision/);
  assert.match(flowchart.document, /multi-stage business process with repeated cross-phase returns[\s\S]*prefer `bpmn-xml` with explicit diagram geometry/);
  assert.match(flowchart.document, /reflows the diagram automatically as the widget is resized/);
  assert.match(flowchart.document, /unlisted need[\s\S]*?return `html_widget`[\s\S]*?There is no library whitelist/);
  assert.match(flowchart.document, /teaching-only JSON[\s\S]*?KiCad, SPICE/);
  assert.match(flowchart.document, /HTML is the primary human-readable visualization[\s\S]*?do not make JSON, XML, YAML, SQL, DSL, code, or a `<pre>` dump the main visible content[\s\S]*?complete professional source in `copyText`/);
  assert.match(flowchart.document, /more than about 10 nodes[\s\S]*?responsive Mermaid[\s\S]*?resized[\s\S]*?responsive DOT/);
  assert.match(flowchart.document, /`widget_patch`[\s\S]*?preserve the existing tool and `sourceFormat`[\s\S]*?smallest complete modification/);
  assert.doesNotMatch(flowchart.document, /never a patch/);
  assert.match(flowchart.document, /copyText/);
  assert.match(flowchart.document, /copyLabel:"Copy <format>"/);
  assert.match(flowchart.styles, /\.pd-root/);
  assert.match(flowchart.styles, /\.pd-lifeline/);
  assert.match(flowchart.styles, /\.pd-class/);
  assert.match(flowchart.styles, /\.pd-svg :where\(rect, circle, ellipse, polygon\)\s*\{[^}]*fill:\s*var\(--pd-surface\)[^}]*stroke:\s*var\(--pd-border-strong\)/);
  assert.match(flowchart.styles, /\.pd-lifeline__head\s*\{[^}]*fill:\s*var\(--pd-surface\)[^}]*stroke:\s*var\(--pd-border-strong\)[^}]*stroke-width:\s*var\(--pd-line\)/);
  const techNews = parsed.find((plugin) => plugin.id === "tech-news");
  assert.match(techNews.document, /Make every headline a public HTTPS link[\s\S]*?target="_blank"[\s\S]*?noopener noreferrer/);
  const imageSearch = parsed.find((plugin) => plugin.id === "image-search");
  assert.equal(imageSearch.name, "Show Real Photos Online");
  assert.equal(imageSearch.nameZh, "显示网络真实照片");
  assert.deepEqual([...imageSearch.connect], ["https://commons.wikimedia.org", "https://upload.wikimedia.org", "https://api.openverse.org"]);
  assert.match(imageSearch.document, /visibly show the actual images/);
  assert.match(imageSearch.document, /Default to exactly 1 image/);
  assert.match(imageSearch.document, /Do not return `copyText` or `copyLabel`/);
  assert.match(imageSearch.document, /page_size=<count>/);
  assert.match(imageSearch.document, /Api-User-Agent/);
  assert.match(imageSearch.document, /Retry-After/);
  assert.match(imageSearch.document, /at most one Openverse search request/);
  assert.match(imageSearch.document, /do not load raw `url`/);
  assert.match(imageSearch.document, /<img>/);
  assert.match(imageSearch.document, /URLSearchParams/);
  assert.match(imageSearch.document, /filetype:bitmap/);
  assert.match(imageSearch.document, /descriptionurl/);
  assert.match(imageSearch.document, /crossorigin="anonymous"/);
  assert.match(imageSearch.document, /two distinct candidates: `thumburl` first and `url` second/);
  assert.match(imageSearch.document, /switch once from `thumburl` to `url`/);
  assert.match(imageSearch.document, /saved thumbnails and exports contain pixels/);
  assert.equal(parsed.find((plugin) => plugin.id === "stocks").name, "Stocks");
  assert.match(parsed.find((plugin) => plugin.id === "stocks").document, /^# Stocks$/m);
});

test("personal plugin storage is ignored and separated from built-in contracts", () => {
  const ignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8"),
    app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8"),
    server = fs.readFileSync(path.join(ROOT, "src", "server", "main.js"), "utf8");
  assert.match(ignore, /^public\/plugins\/private\/$/m);
  assert.match(app, /function validPluginCatalogPath\(value, extension\)/);
  assert.match(app, /styles\\{2}\.css|styles\\\\\.css/);
  assert.match(server, /PENECHO_PRIVATE_PLUGIN_DIR/);
  assert.match(server, /STATE_DIRECTORY[\s\S]*?path\.join\(STATE_DIRECTORY, "plugins", "private"\)/);
  assert.match(server, /plugins\/private/);
});

test("plugin parser rejects oversized contracts, unsafe origins, and missing one-shots", () => {
  assert.throws(() => plugins.parse(`${weather}\n${"x".repeat(12000)}`), /12000 UTF-8 bytes/);
  assert.throws(() => plugins.parse(weather.replace("https://api.open-meteo.com", "https://*.open-meteo.com")), /invalid or duplicate origin/);
  assert.throws(() => plugins.parse(weather.replace("https://api.open-meteo.com", "https://api.open-meteo.com/v1")), /invalid or duplicate origin/);
  assert.throws(() => plugins.parse(weather.replace("## One-shot example", "## Usage example")), /one-shot example/);
  assert.throws(() => plugins.parse(weather.replace("Produce one `html_widget`", "Produce one widget")), /expected output command/);
  assert.throws(() => plugins.parse(weather.replace(/^description:.*\n/m, "")), /description is required/);
  assert.throws(() => plugins.parse(weather.replace(/^category:.*\n/m, "")), /category is required/);
  assert.throws(() => plugins.parse(weather.replace(/^source:.*\n/m, "")), /source is required/);
});

test("plugin parser keeps optional plugin CSS open for specialized resources", () => {
  const parsed = plugins.parse(weather, ".weather-root { color: var(--accent); }");
  assert.equal(parsed.styles, ".weather-root { color: var(--accent); }");
  assert.equal(plugins.parse(weather, '@import "https://cdn.example/theme.css";').styles, '@import "https://cdn.example/theme.css";');
  assert.equal(plugins.parse(weather, ".x { background:url(https://cdn.example/a.png) }").styles, ".x { background:url(https://cdn.example/a.png) }");
  assert.equal(plugins.parse(weather, ".x { color:red").styles, ".x { color:red");
});

test("plugin parser accepts an explicitly empty connect list", () => {
  const document = fs.readFileSync(path.join(pluginDirectory, "general", "plugin.md"), "utf8"),
    blockList = plugins.parse(document),
    inlineList = plugins.parse(document.replace("connect:\nrecommended-refresh-seconds", "connect: []\nrecommended-refresh-seconds"));
  assert.equal(blockList.id, "general");
  assert.deepEqual([...blockList.connect], []);
  assert.deepEqual([...inlineList.connect], []);
});

test("plugin model output extraction accepts a complete Markdown and CSS bundle", () => {
  const server = fs.readFileSync(path.join(ROOT, "src", "server", "main.js"), "utf8"),
    document = fs.readFileSync(path.join(pluginDirectory, "general", "plugin.md"), "utf8")
      .replace("connect:\nrecommended-refresh-seconds", "connect: []\nrecommended-refresh-seconds"),
    extract = vm.runInNewContext(`(${functionSource(server, "pluginBundleFromModel")})`, { PLUGIN_FORMAT:plugins });
  const extracted = extract(JSON.stringify({ document, styles:".general-root { color: #123456; }" }));
  assert.equal(plugins.parse(extracted.document, extracted.styles).id, "general");
  assert.equal(extracted.styles, ".general-root { color: #123456; }");
});

test("widget host keeps generated HTML in an opaque inner frame and snapshots it cooperatively", () => {
  const host = fs.readFileSync(path.join(ROOT, "public", "widget-host.js"), "utf8"),
    html = fs.readFileSync(path.join(ROOT, "public", "widget-host.html"), "utf8"),
    server = fs.readFileSync(path.join(ROOT, "src", "server", "main.js"), "utf8"),
    publicFetch = fs.readFileSync(path.join(ROOT, "src", "server", "public-fetch.js"), "utf8"),
    flowchart = fs.readFileSync(path.join(ROOT, "public", "plugins", "flowchart", "plugin.md"), "utf8"),
    renderer = fs.readFileSync(path.join(ROOT, "public", "vendor", "penecho-dom-renderer.js"), "utf8"),
    rendererLicense = fs.readFileSync(path.join(ROOT, "public", "vendor", "html2canvas.LICENSE"), "utf8");
  const snapshot = functionSource(host, "snapshotDocument"),
    widgetDocument = functionSource(host, "widgetDocument");
  const scopeInlineScript = vm.runInNewContext(`(() => {
    ${functionSource(host, "inlineScriptHasWindowBinding")}
    ${functionSource(host, "compatibleInlineWidgetScript")}
    ${functionSource(host, "scopedInlineWidgetScript")}
    return scopedInlineWidgetScript;
  })()`);
  const safeOutboundLink = vm.runInNewContext(`(${functionSource(host, "safeOutboundLink")})`, { URL, location:{ href:"http://127.0.0.1/widget-host.html" } }),
    linkAttributes = new Map([["href", "https://example.com/story?id=1"], ["target", "_self"], ["download", "story.html"]]),
    link = {
      getAttribute:name => linkAttributes.get(name) || null,
      setAttribute:(name, value) => linkAttributes.set(name, value),
      removeAttribute:name => linkAttributes.delete(name),
    };
  assert.equal(safeOutboundLink(link), true);
  assert.equal(linkAttributes.get("target"), "_blank");
  assert.equal(linkAttributes.get("rel"), "noopener noreferrer");
  assert.equal(linkAttributes.has("download"), false);
  linkAttributes.set("href", "javascript:alert(1)");
  assert.equal(safeOutboundLink(link), false);
  assert.equal(linkAttributes.has("href"), false);
  assert.equal(scopeInlineScript("window.parent.penechoFetchPublic(url).then(render);"), "window.penechoFetchPublic(url).then(render);");
  assert.equal(scopeInlineScript("globalThis.parent.penechoFetchPublic(url);"), "window.penechoFetchPublic(url);");
  assert.equal(
    scopeInlineScript("parent.penechoFetchPublic(url); window.parent.postMessage({type:'updated'}, '*');"),
    "window.penechoFetchPublic(url); window.parent.postMessage({type:'updated'}, '*');"
  );
  const conflictingScript = "var xs=[160,340], coilX=900, top=70, gap=104; globalThis.renderHeight=top+gap;";
  assert.match(scopeInlineScript(conflictingScript), /^\(\(\) => \{/);
  const scopedContext = {};
  vm.runInNewContext(scopeInlineScript(conflictingScript), scopedContext);
  assert.equal(scopedContext.renderHeight,174);
  for (const safeScript of [
    "var topLabel='top'; var options={top:70};",
    "let top=70; globalThis.renderHeight=top+104;",
    "window.parent.postMessage({type:'updated'}, '*');",
    "const source='var top=70';",
  ]) assert.equal(scopeInlineScript(safeScript),safeScript);
  assert.match(scopeInlineScript("function parent() {}"), /^\(\(\) => \{/);
  assert.match(host, /setAttribute\("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox"\)/);
  assert.doesNotMatch(host, /allow-same-origin/);
  assert.match(host, /\.map\(url => url\.replace\(\/\[\?#\]\.\*\$\/, ""\)\)/);
  assert.match(host, /script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https: \$\{scriptSources\}/);
  assert.match(host, /connect-src https:/);
  assert.match(host, /img-src data: blob: https:/);
  assert.match(host, /querySelectorAll\("script\[src\]"\)[\s\S]*?safeHttpsResource/);
  assert.match(host, /querySelectorAll\("script:not\(\[src\]\)"\)[\s\S]*?scopedInlineWidgetScript/);
  assert.match(host, /penechoScopedWindowBindings/);
  assert.match(host, /querySelectorAll\("link"\)[\s\S]*?stylesheet[\s\S]*?safeHttpsResource/);
  assert.match(host, /querySelectorAll\("a\[href\]"\)\.forEach\(safeOutboundLink\)/);
  assert.match(host, /target", "_blank"[\s\S]*?rel", "noopener noreferrer"/);
  assert.match(host, /nativeOpen\(href, "_blank", "noopener,noreferrer"\)[\s\S]*?Object\.defineProperty\(globalThis, "open"/);
  assert.match(host, /pluginStyle\.dataset\.penechoPluginStyles/);
  assert.match(host, /parsed\.head\.insertBefore\(pluginStyle, parsed\.head\.querySelector\("style, link"\)\)/);
  assert.ok(host.indexOf("pluginStyle.textContent = pluginStyles") < host.indexOf('bridgeStyle.textContent = "html,body'));
  assert.match(server, /path\.join\(PUBLIC, "vendor", "penecho-dom-renderer\.js"\)/);
  assert.match(server, /url\.pathname === "\/widget-renderer\.js"[\s\S]*?Cross-Origin-Resource-Policy":"cross-origin"/);
  assert.match(snapshot, /domSnapshotRenderer = globalThis\.html2canvas[\s\S]*?domSnapshotRenderer\(document\.documentElement/);
  assert.doesNotMatch(snapshot, /\bfetch\s*\(|proxyPublicFetch|PUBLIC_FETCH|notifyReady|penecho-widget-updated/);
  assert.match(host, /snapshotPrimarySvg\(requestedWidth, requestedHeight, scale\)/);
  assert.match(host, /HIGH_RESOLUTION_SNAPSHOT_SCALE = 1\.5,[\s\S]*?MAX_HIGH_RESOLUTION_SNAPSHOT_DIMENSION = 3600,[\s\S]*?MAX_HIGH_RESOLUTION_SNAPSHOT_PIXELS = 10800000/);
  assert.match(snapshot, /highResolution = message\.highResolution === true[\s\S]*?targetScale = highResolution \? HIGH_RESOLUTION_SNAPSHOT_SCALE : 1[\s\S]*?scale = Math\.min\(targetScale, maximumDimension \/ requestedWidth, maximumDimension \/ requestedHeight, Math\.sqrt\(maximumPixels \/ \(requestedWidth \* requestedHeight\)\)\)/);
  assert.match(host, /highResolution:request\.highResolution/);
  assert.match(host, /highResolution:message\.highResolution === true/);
  assert.match(host, /targetScale = request\.highResolution \? HIGH_RESOLUTION_SNAPSHOT_SCALE : 1[\s\S]*?scale = Math\.min\(targetScale, maximumDimension \/ request\.requestedWidth, maximumDimension \/ request\.requestedHeight, Math\.sqrt\(maximumPixels \/ \(request\.requestedWidth \* request\.requestedHeight\)\)\)/);
  assert.match(host, /MAX_HIGH_RESOLUTION_SNAPSHOT_DATA_URL_LENGTH = 64 \* 1024 \* 1024[\s\S]*?maximumDataUrlLength = request\.highResolution \? MAX_HIGH_RESOLUTION_SNAPSHOT_DATA_URL_LENGTH : MAX_SNAPSHOT_DATA_URL_LENGTH/);
  assert.doesNotMatch(host, /requestedScale|dataUrlLimit|scale:request\.requested/);
  assert.match(host, /new XMLSerializer\(\)\.serializeToString\(clone\)/);
  assert.match(host, /context\.drawImage\(image, 0, 0, canvas\.width, canvas\.height\)/);
  assert.match(snapshot, /await settleSnapshotFrame\(\)[\s\S]*?inlineSvgComputedStyles\(\)[\s\S]*?inlineSnapshotCompatibleColors\(\)/);
  assert.match(host, /function captureDirectRendererStyleMutations\(\)[\s\S]*?attributeFilter:\["style"\][\s\S]*?observer\.takeRecords\(\)[\s\S]*?element\.setAttribute\("style", value\)/);
  assert.match(host, /SNAPSHOT_GENERATED_PSEUDOS[\s\S]*?selector:"::before"[\s\S]*?selector:"::after"/);
  assert.match(host, /function materializeSnapshotGeneratedContent\(\)[\s\S]*?getComputedStyle\(element, pseudo\.selector\)[\s\S]*?data-penecho-snapshot-pseudo[\s\S]*?node\.style\.setProperty\(property, propertyValue, "important"\)/);
  assert.match(snapshot, /restoreGeneratedContent = materializeSnapshotGeneratedContent\(\)[\s\S]*?restoreDirectRendererStyles = \(\) => \{\}[\s\S]*?restoreDirectRendererStyles = captureDirectRendererStyleMutations\(\)[\s\S]*?rendering = domSnapshotRenderer\([\s\S]*?finally\s*\{[\s\S]*?restoreDirectRendererStyles\(\)[\s\S]*?restoreGeneratedContent\(\)[\s\S]*?canvas = await rendering/);
  assert.match(host, /unsupportedSnapshotColor = \/\\b\(\?:color\|lab\|lch\|oklab\|oklch\|hwb\)[\s\S]*?getImageData\(0, 0, 1, 1\)/);
  assert.match(host, /function inlineSnapshotCompatibleColors\(\)[\s\S]*?background-image[\s\S]*?box-shadow/);
  assert.doesNotMatch(host, /snapshotSemanticFallback|createTreeWalker/);
  assert.match(host, /function settleSnapshotFrame\(\)[\s\S]*?setTimeout\(\(\) => finish\(false\), 50\)[\s\S]*?nativeRequestAnimationFrame\(\(\) => finish\(true\)\)/);
  assert.match(host, /press\.pointerType === "mouse"[\s\S]*?event\.buttons[\s\S]*?finishPress\(event\)/);
  assert.match(host, /lostpointercapture[\s\S]*?finishPress\(\{ pointerId:event\.pointerId \}, true\)[\s\S]*?addEventListener\("blur"/);
  assert.doesNotMatch(snapshot, /setRuntimeActive\(|flushPendingSnapshotFrame|penecho-widget-paused/);
  assert.doesNotMatch(host, /notifySnapshotReady|penecho-widget-snapshot-ready/);
  assert.match(widgetDocument, /parsed\.body\.append\(renderer\)[\s\S]*?penecho-widget-document-ready[\s\S]*?parsed\.body\.append\(ready\)[\s\S]*?policy\.after\(bridge\)/);
  assert.match(host, /restoreCompatibleColors\(\)[\s\S]*?restoreSvgStyles\(\)/);
  assert.match(host, /foreignObjectRendering:false/);
  assert.match(host, /penechoDirectRendering:true/);
  assert.match(host, /useCORS:true/);
  assert.doesNotMatch(host, /useCORS:false/);
  assert.match(host, /imageTimeout:Math\.min\(10000, timeoutMs\)/);
  assert.match(renderer, /html2canvas 1\.4\.1/);
  assert.match(renderer, /penechoDirectRendering/);
  assert.match(rendererLicense, /Copyright \(c\) 2012 Niklas von Hertzen/);
  assert.match(rendererLicense, /Permission is hereby granted, free of charge/);
  assert.match(host, /MAX_SNAPSHOT_DATA_URL_LENGTH/);
  assert.match(host, /setTimeout\(\(\) => snapshotError\(message\.requestId, "Widget snapshot timed out"\), timeoutMs\)/);
  assert.match(host, /withTimeout\(render\(\), timeoutMs,[\s\S]*?captureExpired = true/);
  assert.match(host, /penecho-widget-document-ready" && message\.runtimeVersion === runtimeVersion[\s\S]*?innerDocumentReady = true;[\s\S]*?penecho-widget-capture-ready[\s\S]*?forwardSnapshotRequest/);
  assert.match(snapshot, /penecho-widget-snapshot", runtimeVersion/);
  assert.match(host, /for \(const requestId of \[\.\.\.pendingSnapshots\.keys\(\)\]\) snapshotError\(requestId, "Widget changed during snapshot"\)/);
  assert.match(host, /globalThis\.penechoFetchPublic/);
  assert.match(host, /response = await nativeFetch\(input, init\)[\s\S]*?if \(response\.ok\) return response[\s\S]*?globalThis\.penechoFetchPublic\(url\)/);
  assert.match(host, /function beginImageFallback\(event\)[\s\S]*?proxyImageFallback\(image, sourceUrl\)/);
  assert.match(host, /penecho-widget-public-fetch-request/);
  assert.match(host, /MAX_RUNTIME_ERRORS = 5/);
  assert.match(host, /addEventListener\("error"[\s\S]*?recordRuntimeError/);
  assert.match(host, /addEventListener\("unhandledrejection"[\s\S]*?recordRuntimeError/);
  assert.match(host, /error\.line \|\| error\.column[\s\S]*?\[error\.file, error\.line, error\.column\]\.join/);
  assert.match(host, /penecho-widget-runtime-diagnostics/);
  assert.match(host, /message\.runtimeVersion === runtimeVersion/);
  assert.match(host, /message\.errors\.length <= 5/);
  assert.doesNotMatch(host, /console\.log.*runtimeDiagnostics|console\.error.*runtimeDiagnostics/);
  assert.match(host, /fetch\(publicFetchUrl, \{[\s\S]*?method:"POST"[\s\S]*?body:JSON\.stringify\(\{ url:message\.url \}\)/);
  assert.match(host, /response\.arrayBuffer\(\)/);
  assert.match(host, /\}, \[body\]\)/);
  assert.match(server, /url\.pathname === "\/api\/widget-fetch"/);
  assert.match(publicFetch, /PUBLIC_FETCH_MAX_URL_LENGTH = 16 \* 1024/);
  assert.match(publicFetch, /PUBLIC_FETCH_MAX_CONCURRENT = 20/);
  assert.match(publicFetch, /PUBLIC_FETCH_QUEUE_TIMEOUT_MS = 30000/);
  assert.match(server, /waitForPublicFetchSlot\(controller\.signal\)/);
  assert.match(server, /if \(slotAcquired\) releasePublicFetchSlot\(\)/);
  assert.doesNotMatch(publicFetch, /url\.port !== "443"/);
  assert.doesNotMatch(publicFetch, /did not return text, JSON, XML, or RSS/);
  assert.match(publicFetch, /dnsLookup\(hostname, \{ all:true, verbatim:true \}\)/);
  assert.match(publicFetch, /lookup\(_hostname, requestOptions, callback\)/);
  assert.match(host, /MAX_HTML_LENGTH = 200000/);
  assert.match(server, /MAX_WIDGET_HTML_LENGTH = 200000/);
  assert.doesNotMatch(host, /<foreignObject|penecho-widget-snapshot-markup/);
  assert.match(host, /inner\.srcdoc = documentSource/);
  assert.doesNotMatch(host, /createObjectURL\(new Blob\(\[widgetDocument/);
  assert.match(host, /toDataURL\("image\/png"\)/);
  assert.match(host, /penecho-widget-snapshot-request/);
  for (const type of [
    "penecho-widget-drag-start", "penecho-widget-drag-move", "penecho-widget-drag-end",
    "penecho-widget-touch-start", "penecho-widget-touch-end",
  ]) assert.match(host, new RegExp(type));
  assert.doesNotMatch(functionSource(host, "runtime"), /penecho-widget-(?:touch-move|pan-start|pan-move|pan-end|wheel)/);
  assert.match(host, /MOVE_TOLERANCE_PX = 8/);
  assert.match(host, /const presses = new Map\(\)/);
  assert.match(host, /if \(!widgetState\.selected\) return null/);
  assert.match(host, /if \(press\.hit && touchCount\(\) < 2\)[\s\S]*?activateHold\(press\)/);
  assert.doesNotMatch(host, /setTimeout\(\(\) => activateHold/);
  assert.doesNotMatch(host, /controls\[0\]\?\.hit \|\| "move"/);
  assert.match(host, /touchCount\(\) >= 2[\s\S]*?cancelAllHoldsForNavigation/);
  assert.match(host, /hit:"resize"[\s\S]*?hit:"width"[\s\S]*?hit:"height"/);
  assert.match(host, /penecho-widget-state/);
  assert.match(host, /function setRuntimeActive\(active\)/);
  assert.doesNotMatch(snapshot, /setRuntimeActive|notifyVisibleViewport/);
  assert.match(host, /document\.getAnimations\(\)/);
  assert.match(host, /pauseAnimations/);
  assert.match(host, /penecho-widget-paused/);
  const updatedForwarding = host.slice(host.indexOf('if (message.type === "penecho-widget-updated")'), host.indexOf('} else if (message.type === "penecho-widget-snapshot"'));
  assert.match(updatedForwarding, /forwardWidgetState/);
  assert.match(updatedForwarding, /UPDATE_FORWARD_INTERVAL_MS/);
  assert.doesNotMatch(host, /FROZEN_IMAGE_MAX_PIXELS|drawImage\(img/);
  assert.match(host, /penecho-widget-activate"[\s\S]*?pointerId:event\.pointerId[\s\S]*?pointerType:event\.pointerType[\s\S]*?localX:Number\(event\.clientX\)[\s\S]*?localY:Number\(event\.clientY\)/);
  assert.match(host, /if \(tapped\) parent\.postMessage\(\{[\s\S]*?penecho-widget-activate[\s\S]*?localX:press\.clientX[\s\S]*?localY:press\.clientY[\s\S]*?\}, "\*"\)[\s\S]*?pointerMessage\(TOUCH_END/);
  assert.match(host, /validActivateMessage\(message\)[\s\S]*?localX:message\.localX[\s\S]*?localY:message\.localY[\s\S]*?parentOrigin/);
  assert.match(host, /press\.pointerType === "touch" && \(moved \|\| touchCount\(\) >= 2\)[\s\S]*?press\.navigation = true/);
  assert.doesNotMatch(host, /pointerMessage\(TOUCH_MOVE|const TOUCH_MOVE/);
  assert.doesNotMatch(host, /penecho-widget-copy-source|copySourceText|updateCopySourceScale|MAX_COPY_TEXT_LENGTH/);
  assert.doesNotMatch(html, /widgetCopySource/);
  assert.match(host, /function inlineSvgComputedStyles\(\)/);
  assert.match(host, /"fill"[\s\S]*?"stroke"[\s\S]*?"font-family"[\s\S]*?"font-size"/);
  assert.match(host, /element\.style\.setProperty\(property, value, "important"\)/);
  assert.doesNotMatch(host, /element\.setAttribute\(property, value\)/);
  assert.match(host, /upstreamStatus = Number\(response\.headers\.get\("x-penecho-upstream-status"\)\)/);
  assert.match(server, /"X-PenEcho-Upstream-Status":String\(result\.status\)/);
  assert.match(host, /data-penecho-snapshot-background/);
  assert.match(snapshot, /finally\s*\{\s*try\s*\{\s*restoreCompatibleColors\(\);\s*\}\s*finally\s*\{\s*restoreSvgStyles\(\);\s*\}/);
  assert.match(host, /snapshotError\(message\.requestId, message\.error\)/);
  assert.match(flowchart, /injected CSS framework/);
  assert.match(host, /if \(press\.active\)[\s\S]*?event\.preventDefault/);
  assert.match(host, /penecho-widget-dragging[\s\S]*?user-select:none/);
  assert.match(host, /html,body\{background:transparent!important;color-scheme:light!important/);
  assert.match(host, /font-size:clamp\(36px,1\.2cqw,52px\)/);
  assert.doesNotMatch(host, /-webkit-touch-callout:none/);
  assert.match(html, /widget-host\.js/);
  assert.match(html, /html, body, iframe \{[^}]*color-scheme: light/);
  assert.match(html, /iframe \{[^}]*touch-action: none/);
});

test("widget host loads generated HTML directly into the opaque sandbox", () => {
  const host = fs.readFileSync(path.join(ROOT, "public", "widget-host.js"), "utf8"),
    innerLoadRegistration = host.slice(host.indexOf('inner.addEventListener("load"'), host.indexOf("document.body.append(inner)"));
  assert.match(host, /inner\.addEventListener\("load", forwardWidgetState\)/);
  assert.doesNotMatch(innerLoadRegistration, /srcdoc|widgetDocument/);
  assert.match(host, /const documentSource = widgetDocument\(message\.html, message\.pluginStyles \|\| "", runtimeVersion, message\.sourceFormat, message\.frameworkVersion\);[\s\S]*?inner\.removeAttribute\("src"\);[\s\S]*?inner\.srcdoc = documentSource/);
  assert.doesNotMatch(host, /innerDocumentUrl|releaseInnerDocumentUrl|URL\.revokeObjectURL\(innerDocumentUrl\)/);
  assert.match(host, /inner\.setAttribute\("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox"\)/);
  assert.doesNotMatch(host, /allow-same-origin/);
});

test("widget snapshots wait for one presented frame without pausing the live runtime", async () => {
  const host = fs.readFileSync(path.join(ROOT, "public", "widget-host.js"), "utf8");
  let timerCallback = null,
    frameCallback = null;
  const settle = vm.runInNewContext(`(${functionSource(host, "settleSnapshotFrame")})`, {
    setTimeout(callback) { timerCallback = callback; return 1; },
    clearTimeout() {},
    nativeRequestAnimationFrame(callback) { frameCallback = callback; return 1; },
  });
  const throttled = settle();
  timerCallback();
  assert.equal(await throttled, false);
  const presented = settle();
  frameCallback();
  assert.equal(await presented, true);
});

test("direct widget snapshots restore live style mutations before rendering continues", () => {
  const host = fs.readFileSync(path.join(ROOT, "public", "widget-host.js"), "utf8"),
    element = {
      style:"transform: translate3d(10px, 20px, 0)",
      setAttribute(name, value) { if (name === "style") this.style = value; },
      removeAttribute(name) { if (name === "style") this.style = null; },
    };
  let observer;
  class TestMutationObserver {
    constructor(callback) { this.callback = callback; this.records = []; observer = this; }
    observe() {}
    takeRecords() { return this.records.splice(0); }
    disconnect() {}
  }
  const restore = vm.runInNewContext(`(${functionSource(host, "captureDirectRendererStyleMutations")})`, {
    MutationObserver:TestMutationObserver,
    document:{ documentElement:{} },
    Map,
  })();
  observer.records.push(
    { target:element, oldValue:"transform: translate3d(10px, 20px, 0)" },
    { target:element, oldValue:"transform: none" },
  );
  element.style = "transform: none; animation-duration: 0s";
  restore();
  assert.equal(element.style, "transform: translate3d(10px, 20px, 0)");
});

test("direct widget snapshots materialize generated pseudo-element graphics and text only during parsing", () => {
  const host = fs.readFileSync(path.join(ROOT, "public", "widget-host.js"), "utf8"),
    snapshotPseudoContentText = vm.runInNewContext(`(${functionSource(host, "snapshotPseudoContentText")})`),
    target = testElement(),
    root = testElement(),
    computed = (values) => {
      const properties = Object.keys(values);
      return {
        length:properties.length,
        item:index => properties[index],
        getPropertyValue:property => values[property] || "",
      };
    },
    hidden = computed({ content:"none", display:"none" }),
    before = computed({ content:'""', display:"block", visibility:"visible", position:"absolute", width:"7px", transform:"matrix(1, 0, 0, 1, 0, 0)" }),
    after = computed({ content:'"\\2192"', display:"block", visibility:"visible", position:"absolute", width:"2px" }),
    document = {
      documentElement:root,
      querySelectorAll:() => [target],
      createElement:() => testElement(),
    },
    materialize = vm.runInNewContext(`(${functionSource(host, "materializeSnapshotGeneratedContent")})`, {
      SNAPSHOT_GENERATED_PSEUDOS:[
        { selector:"::before", placement:"prepend" },
        { selector:"::after", placement:"append" },
      ],
      snapshotPseudoContentText,
      document,
      getComputedStyle:(element, selector) => element === target ? selector === "::before" ? before : after : hidden,
    }),
    restore = materialize();
  assert.equal(target.children.length, 2);
  assert.equal(target.children[0].attributes.get("data-penecho-snapshot-pseudo"), "before");
  assert.equal(target.children[0].styles.get("position").value, "absolute");
  assert.equal(target.children[1].attributes.get("data-penecho-snapshot-pseudo"), "after");
  assert.equal(target.children[1].textContent, "→");
  assert.equal(target.children[1].styles.get("pointer-events").value, "none");
  restore();
  assert.equal(target.children.length, 0);

  function testElement() {
    const children = [],
      attributes = new Map(),
      styles = new Map(),
      element = {
        namespaceURI:"http://www.w3.org/1999/xhtml",
        children,
        attributes,
        styles,
        textContent:"",
        style:{ setProperty(property, value, priority) { styles.set(property, { value, priority }); } },
        setAttribute(name, value) { attributes.set(name, value); },
        getAttribute(name) { return attributes.get(name) || null; },
        insertBefore(node) { node.parent = element; children.unshift(node); },
        appendChild(node) { node.parent = element; children.push(node); },
        remove() {
          const index = this.parent?.children.indexOf(this) ?? -1;
          if (index >= 0) this.parent.children.splice(index, 1);
        },
      };
    Object.defineProperty(element, "firstChild", { get:() => children[0] || null });
    return element;
  }
});

test("widget iframe preserves native navigation while forwarding only focus and resize chrome", () => {
  const interactionMessages = harness => harness.messages;
  const navigation = widgetRuntimeHarness();
  navigation.pointer("pointerdown");
  navigation.pointer("pointermove", { clientX:120, screenX:120 });
  assert.deepEqual(interactionMessages(navigation).map((message) => message.type), ["penecho-widget-touch-start"]);
  navigation.runTimers();
  assert.equal(navigation.messages.some((message) => message.type === "penecho-widget-drag-start"), false);

  const direct = widgetRuntimeHarness();
  direct.pointer("pointerdown", { pointerType:"pen" });
  direct.pointer("pointermove", { pointerType:"pen", clientX:120, screenX:120 });
  direct.runTimers();
  assert.deepEqual(interactionMessages(direct).map((message) => message.type), ["penecho-widget-activate"]);

  const selected = widgetRuntimeHarness();
  selected.select();
  selected.pointer("pointerdown", { pointerType:"pen" });
  selected.pointer("pointermove", { pointerType:"pen", clientX:120, screenX:120 });
  assert.deepEqual(interactionMessages(selected).map((message) => message.type), ["penecho-widget-activate"]);

  for (const [hit, point] of Object.entries({
    width:{ clientX:995, clientY:300, screenX:995, screenY:300 },
    height:{ clientX:500, clientY:595, screenX:500, screenY:595 },
    resize:{ clientX:995, clientY:595, screenX:995, screenY:595 },
  })) {
    const control = widgetRuntimeHarness();
    control.select();
    control.pointer("pointerdown", { pointerType:"pen", ...point });
    assert.equal(control.messages.at(-1).type, "penecho-widget-drag-start");
    assert.equal(control.messages.at(-1).hit, hit);
  }

  const pinch = widgetRuntimeHarness();
  pinch.pointer("pointerdown", { pointerId:1 });
  pinch.pointer("pointerdown", { pointerId:2, clientX:200, screenX:200 });
  pinch.runTimers();
  pinch.pointer("pointermove", { pointerId:1, clientX:80, screenX:80 });
  pinch.pointer("pointermove", { pointerId:2, clientX:220, screenX:220 });
  pinch.pointer("pointerup", { pointerId:1, clientX:80, screenX:80 });
  pinch.pointer("pointerup", { pointerId:2, clientX:220, screenX:220 });
  assert.equal(pinch.messages.filter((message) => message.type === "penecho-widget-touch-start").length, 2);
  assert.equal(pinch.messages.filter((message) => message.type === "penecho-widget-touch-move").length, 0);
  assert.equal(pinch.messages.filter((message) => message.type === "penecho-widget-touch-end").length, 2);
  assert.equal(pinch.messages.some((message) => message.type === "penecho-widget-drag-start"), false);
  assert.equal(pinch.messages.some((message) => message.type === "penecho-widget-activate"), false);

  const tap = widgetRuntimeHarness();
  tap.pointer("pointerdown", { pointerId:3 });
  tap.pointer("pointerup", { pointerId:3 });
  assert.deepEqual(tap.messages.map((message) => message.type), ["penecho-widget-touch-start", "penecho-widget-activate", "penecho-widget-touch-end"]);
  assert.deepEqual(
    { pointerId:tap.messages[1].pointerId, pointerType:tap.messages[1].pointerType, localX:tap.messages[1].localX, localY:tap.messages[1].localY },
    { pointerId:3, pointerType:"touch", localX:100, localY:100 }
  );

  const middle = widgetRuntimeHarness();
  middle.pointer("pointerdown", { pointerType:"mouse", button:1 });
  middle.pointer("pointermove", { pointerType:"mouse", button:1, clientX:125, screenX:125 });
  middle.pointer("pointerup", { pointerType:"mouse", button:1, clientX:125, screenX:125 });
  assert.deepEqual(interactionMessages(middle).map((message) => message.type), []);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "public", "widget-host.js"), "utf8"), /addEventListener\("wheel"|penecho-widget-wheel/);

  const suspended = widgetRuntimeHarness();
  let frameCount = 0;
  suspended.requestFrame(() => frameCount++);
  suspended.select(false, 1, 1, false);
  suspended.runFrames();
  assert.equal(frameCount, 0);
  assert.equal(suspended.animation.playState, "paused");
  assert.equal(suspended.svg.paused, true);
  assert.equal(suspended.classes.has("penecho-widget-paused"), true);
  suspended.select(false, 1, 1, true);
  suspended.runFrames();
  assert.equal(frameCount, 1);
  assert.equal(suspended.animation.playState, "running");
  assert.equal(suspended.svg.paused, false);
  assert.equal(suspended.classes.has("penecho-widget-paused"), false);
});

test("plugin catalog paths accept PenEcho Cloud content-version suffixes", () => {
  // PenEcho Cloud serves /api/plugins entries with ?v=<sha256-12> cache-busting
  // suffixes. The catalog validator must accept them (and keep rejecting
  // anything outside the plugins/ tree) or no manifest ever loads on
  // cloud-served canvases and widgets silently never mount.
  const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const validate = vm.runInNewContext(`(${functionSource(app, "validPluginCatalogPath")})`, {});
  assert.equal(validate("plugins/general/plugin.md", "md"), "plugins/general/plugin.md");
  assert.equal(validate("plugins/general/plugin.md?v=1734dd52572c", "md"), "plugins/general/plugin.md?v=1734dd52572c");
  assert.equal(validate("plugins/flowchart/styles.css?v=c5173c2e432d", "css"), "plugins/flowchart/styles.css?v=c5173c2e432d");
  assert.equal(validate("plugins/private/my-widget/plugin.md?v=abc123def456", "md"), "plugins/private/my-widget/plugin.md?v=abc123def456");
  assert.equal(validate("plugins/general/plugin.md?v=not-hex!!", "md"), null);
  assert.equal(validate("plugins/general/plugin.md?x=1734dd52572c", "md"), null);
  assert.equal(validate("https://evil.example/plugins/general/plugin.md", "md"), null);
  assert.equal(validate("plugins/../secret.md", "md"), null);
});

test("cloud community deep links load plugin assets from the Canvas root", () => {
  const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8"),
    deepLink = "https://cloud.penecho.test/canvas/community/123e4567-e89b-42d3-a456-426614174000",
    assetUrl = vm.runInNewContext(`(${functionSource(app, "canvasAssetUrl")})`, {
      window:{ PENECHO_CONFIG:{ runtime:"cloud" } },
      location:{ origin:"https://cloud.penecho.test", href:deepLink },
      URL,
    }),
    loadPluginDocuments = functionSource(app, "loadPluginDocuments");
  const documentUrl = assetUrl("plugins/general/plugin.md?v=1734dd52572c"),
    styleUrl = assetUrl("plugins/flowchart/styles.css?v=c5173c2e432d");
  assert.equal(documentUrl, "https://cloud.penecho.test/canvas/plugins/general/plugin.md?v=1734dd52572c");
  assert.equal(styleUrl, "https://cloud.penecho.test/canvas/plugins/flowchart/styles.css?v=c5173c2e432d");
  assert.doesNotMatch(documentUrl, /\/canvas\/community\/plugins\//);
  assert.match(loadPluginDocuments, /fetch\(canvasAssetUrl\(documentPath\)/);
  assert.match(loadPluginDocuments, /stylePath \? fetch\(canvasAssetUrl\(stylePath\)/);
});
