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

function widgetRuntimeHarness() {
  const host = fs.readFileSync(path.join(ROOT, "public", "widget-host.js"), "utf8"),
    listeners = new Map(), messages = [], timers = new Map(), frames = new Map(), parent = {}, classes = new Set(),
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
    };
  let nextTimer = 1, nextFrame = 1;
  const sandbox = {
    document:{ documentElement, getSelection:() => ({ removeAllRanges() {} }), getAnimations:() => [animation], querySelectorAll:() => [svg] },
    parent,
    performance:{ now:() => 100 },
    addEventListener(type, listener) { listeners.set(type, listener); },
    setTimeout(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
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
    pointer,
    select(selected = true, scaleX = 1, scaleY = 1, active = true) {
      listeners.get("message")({ source:parent, data:{ type:"penecho-widget-state", selected, active, scaleX, scaleY } });
    },
    animation,
    svg,
    classes,
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
  assert.match(general.document, /五颜六色的钟/);
  assert.match(general.document, /browser-native HTML, CSS, JavaScript, timers, SVG, and canvas/);
  const flowchart = parsed.find((plugin) => plugin.id === "flowchart");
  assert.deepEqual([...flowchart.connect], []);
  assert.match(flowchart.document, /Professional fields not named here remain in scope/);
  assert.match(flowchart.document, /electrical\/electronic circuits and IEC\/IEEE schematics/);
  assert.match(flowchart.document, /mechanical kinematics[\s\S]*?chemical structures[\s\S]*?medical devices[\s\S]*?financial cash flow/);
  assert.match(flowchart.document, /local renderers are baseline conveniences, not the boundary/);
  assert.match(flowchart.document, /Never fall back to native `draw`/);
  assert.match(flowchart.document, /Prefer `diagram_source`[\s\S]*?PenEcho supplies the iframe, renderer, shared CSS, Copy button/);
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
  assert.match(flowchart.document, /unlisted need[\s\S]*?return `html_widget`[\s\S]*?There is no library whitelist/);
  assert.match(flowchart.document, /teaching-only JSON[\s\S]*?KiCad, SPICE/);
  assert.match(flowchart.document, /more than about 10 nodes[\s\S]*?penecho:responsive/);
  assert.match(flowchart.document, /same tool and `sourceFormat`[\s\S]*?smallest complete modification/);
  assert.match(flowchart.document, /copyText/);
  assert.match(flowchart.document, /copyLabel:"Copy <format>"/);
  assert.match(flowchart.styles, /\.pd-root/);
  assert.match(flowchart.styles, /\.pd-lifeline/);
  assert.match(flowchart.styles, /\.pd-class/);
  assert.match(flowchart.styles, /\.pd-svg :where\(rect, circle, ellipse, polygon\)\s*\{[^}]*fill:\s*var\(--pd-surface\)[^}]*stroke:\s*var\(--pd-border-strong\)/);
  assert.match(flowchart.styles, /\.pd-lifeline__head\s*\{[^}]*fill:\s*var\(--pd-surface\)[^}]*stroke:\s*var\(--pd-border-strong\)[^}]*stroke-width:\s*var\(--pd-line\)/);
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
    flowchart = fs.readFileSync(path.join(ROOT, "public", "plugins", "flowchart", "plugin.md"), "utf8"),
    renderer = fs.readFileSync(path.join(ROOT, "public", "vendor", "penecho-dom-renderer.js"), "utf8"),
    rendererLicense = fs.readFileSync(path.join(ROOT, "public", "vendor", "html2canvas.LICENSE"), "utf8");
  const scopeInlineScript = vm.runInNewContext(`(() => {
    ${functionSource(host, "inlineScriptHasWindowBinding")}
    ${functionSource(host, "scopedInlineWidgetScript")}
    return scopedInlineWidgetScript;
  })()`);
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
  assert.match(host, /setAttribute\("sandbox", parentOrigin === location\.origin \? "allow-scripts" : "allow-scripts allow-same-origin"\)/);
  assert.match(host, /script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https: \$\{rendererUrl\}/);
  assert.match(host, /connect-src https:/);
  assert.match(host, /img-src data: blob: https:/);
  assert.match(host, /querySelectorAll\("script\[src\]"\)[\s\S]*?safeHttpsResource/);
  assert.match(host, /querySelectorAll\("script:not\(\[src\]\)"\)[\s\S]*?scopedInlineWidgetScript/);
  assert.match(host, /penechoScopedWindowBindings/);
  assert.match(host, /querySelectorAll\("link"\)[\s\S]*?stylesheet[\s\S]*?safeHttpsResource/);
  assert.match(host, /pluginStyle\.dataset\.penechoPluginStyles/);
  assert.ok(host.indexOf("pluginStyle.textContent = pluginStyles") < host.indexOf('bridgeStyle.textContent = "html,body'));
  assert.match(server, /path\.join\(PUBLIC, "vendor", "penecho-dom-renderer\.js"\)/);
  assert.match(server, /url\.pathname === "\/widget-renderer\.js"[\s\S]*?Cross-Origin-Resource-Policy":"cross-origin"/);
  assert.match(host, /globalThis\.html2canvas\(document\.documentElement/);
  assert.match(host, /foreignObjectRendering:false/);
  assert.match(host, /penechoDirectRendering:true/);
  assert.match(host, /useCORS:true/);
  assert.doesNotMatch(host, /useCORS:false/);
  assert.match(host, /imageTimeout:10000/);
  assert.match(renderer, /html2canvas 1\.4\.1/);
  assert.match(renderer, /penechoDirectRendering/);
  assert.match(rendererLicense, /Copyright \(c\) 2012 Niklas von Hertzen/);
  assert.match(rendererLicense, /Permission is hereby granted, free of charge/);
  assert.match(host, /MAX_SNAPSHOT_DATA_URL_LENGTH/);
  assert.match(host, /MAX_HTML_LENGTH = 200000/);
  assert.match(server, /MAX_WIDGET_HTML_LENGTH = 200000/);
  assert.doesNotMatch(host, /<foreignObject|penecho-widget-snapshot-markup/);
  assert.match(host, /createObjectURL\(new Blob\(\[widgetDocument/);
  assert.match(host, /toDataURL\("image\/png"\)/);
  assert.match(host, /penecho-widget-snapshot-request/);
  for (const type of [
    "penecho-widget-drag-start", "penecho-widget-drag-move", "penecho-widget-drag-end",
    "penecho-widget-touch-start", "penecho-widget-touch-move", "penecho-widget-touch-end",
    "penecho-widget-pan-start", "penecho-widget-pan-move", "penecho-widget-pan-end", "penecho-widget-wheel",
  ]) assert.match(host, new RegExp(type));
  assert.match(host, /MOVE_TOLERANCE_PX = 8/);
  assert.match(host, /const presses = new Map\(\)/);
  assert.match(host, /if \(!widgetState\.selected\) return null/);
  assert.match(host, /if \(press\.hit && touchCount\(\) < 2\)[\s\S]*?activateHold\(press\)/);
  assert.doesNotMatch(host, /setTimeout\(\(\) => activateHold/);
  assert.doesNotMatch(host, /controls\[0\]\?\.hit \|\| "move"/);
  assert.match(host, /touchCount\(\) >= 2[\s\S]*?cancelAllHoldsForNavigation/);
  assert.match(host, /hit:"resize"[\s\S]*?hit:"width"[\s\S]*?hit:"height"/);
  assert.match(host, /penecho-widget-state/);
  assert.match(host, /inner\.addEventListener\("load", \(\) => \{[\s\S]*?URL\.revokeObjectURL\(innerDocumentUrl\)[\s\S]*?forwardWidgetState\(\)/);
  assert.match(host, /function setRuntimeActive\(active\)/);
  assert.match(host, /document\.getAnimations\(\)/);
  assert.match(host, /pauseAnimations/);
  assert.match(host, /penecho-widget-paused/);
  const updatedForwarding = host.slice(host.indexOf('if (message.type === "penecho-widget-updated")'), host.indexOf('} else if (message.type === "penecho-widget-snapshot"'));
  assert.match(updatedForwarding, /forwardWidgetState/);
  assert.match(updatedForwarding, /UPDATE_FORWARD_INTERVAL_MS/);
  assert.doesNotMatch(host, /FROZEN_IMAGE_MAX_PIXELS|drawImage\(img/);
  assert.match(host, /if \(!widgetState\.selected\) parent\.postMessage\(\{ type:"penecho-widget-activate" \}, "\*"\)/);
  assert.match(host, /message\.type === "penecho-widget-activate"[\s\S]*?parent\.postMessage\(\{ type:message\.type \}, parentOrigin\)/);
  assert.doesNotMatch(host, /penecho-widget-copy-source|copySourceText|updateCopySourceScale|MAX_COPY_TEXT_LENGTH/);
  assert.doesNotMatch(html, /widgetCopySource/);
  assert.match(host, /function inlineSvgComputedStyles\(\)/);
  assert.match(host, /"fill"[\s\S]*?"stroke"[\s\S]*?"font-family"[\s\S]*?"font-size"/);
  assert.match(host, /element\.setAttribute\(property, value\)/);
  assert.match(host, /data-penecho-snapshot-background/);
  assert.match(host, /finally\s*\{\s*restoreSvgStyles\(\)/);
  assert.match(flowchart, /injected CSS framework/);
  assert.match(host, /if \(press\.active\)[\s\S]*?event\.preventDefault/);
  assert.match(host, /penecho-widget-dragging[\s\S]*?user-select:none/);
  assert.match(host, /html,body\{background:transparent!important;color-scheme:light!important/);
  assert.doesNotMatch(host, /-webkit-touch-callout:none/);
  assert.match(html, /widget-host\.js/);
  assert.match(html, /html, body, iframe \{[^}]*color-scheme: light/);
  assert.match(html, /iframe \{[^}]*touch-action: none/);
});

test("widget iframe preserves direct interaction while forwarding resize and canvas navigation", () => {
  const navigation = widgetRuntimeHarness();
  navigation.pointer("pointerdown");
  navigation.pointer("pointermove", { clientX:120, screenX:120 });
  assert.deepEqual(navigation.messages.map((message) => message.type), ["penecho-widget-touch-start"]);
  navigation.runTimers();
  assert.equal(navigation.messages.some((message) => message.type === "penecho-widget-drag-start"), false);

  const direct = widgetRuntimeHarness();
  direct.pointer("pointerdown", { pointerType:"pen" });
  direct.pointer("pointermove", { pointerType:"pen", clientX:120, screenX:120 });
  direct.runTimers();
  assert.deepEqual(direct.messages.map((message) => message.type), ["penecho-widget-activate"]);

  const selected = widgetRuntimeHarness();
  selected.select();
  selected.pointer("pointerdown", { pointerType:"pen" });
  selected.pointer("pointermove", { pointerType:"pen", clientX:120, screenX:120 });
  assert.equal(selected.messages.length, 0);

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
  assert.equal(pinch.messages.filter((message) => message.type === "penecho-widget-touch-start").length, 2);
  assert.equal(pinch.messages.filter((message) => message.type === "penecho-widget-touch-move").length, 2);
  assert.equal(pinch.messages.some((message) => message.type === "penecho-widget-drag-start"), false);

  const middle = widgetRuntimeHarness();
  middle.pointer("pointerdown", { pointerType:"mouse", button:1 });
  middle.pointer("pointermove", { pointerType:"mouse", button:1, clientX:125, screenX:125 });
  middle.pointer("pointerup", { pointerType:"mouse", button:1, clientX:125, screenX:125 });
  assert.deepEqual(middle.messages.map((message) => message.type), ["penecho-widget-pan-start", "penecho-widget-pan-move", "penecho-widget-pan-end"]);

  const wheel = widgetRuntimeHarness();
  wheel.pointer("wheel", { pointerType:"mouse", deltaY:-120 });
  assert.equal(wheel.messages.at(-1).type, "penecho-widget-wheel");

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
