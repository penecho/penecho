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
  weather = fs.readFileSync(path.join(ROOT, "public", "plugins", "weather.md"), "utf8"),
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

function widgetRuntimeHarness() {
  const host = fs.readFileSync(path.join(ROOT, "public", "widget-host.js"), "utf8"),
    listeners = new Map(), messages = [], timers = new Map(), parent = {},
    documentElement = {
      clientWidth:1000,
      clientHeight:600,
      classList:{ add() {}, remove() {} },
      setPointerCapture() {},
      releasePointerCapture() {},
    };
  let nextTimer = 1;
  const sandbox = {
    document:{ documentElement, getSelection:() => ({ removeAllRanges() {} }) },
    parent,
    performance:{ now:() => 100 },
    addEventListener(type, listener) { listeners.set(type, listener); },
    setTimeout(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
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
    select(selected = true, scaleX = 1, scaleY = 1) {
      listeners.get("message")({ source:parent, data:{ type:"penecho-widget-state", selected, scaleX, scaleY } });
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

test("plugin directory contains the general, flowchart, image, and built-in data contracts", () => {
  const builtIns = ["earthquakes.md", "exchange-rates.md", "flowchart.md", "general.md", "github-pulse.md", "image-search.md", "natural-events.md", "space-weather.md", "stocks.md", "tech-news.md", "weather.md"];
  assert.deepEqual(pluginFiles.filter((file) => builtIns.includes(file)), builtIns);
  const allParsed = pluginFiles.map((file) => plugins.parse(fs.readFileSync(path.join(pluginDirectory, file), "utf8"))),
    parsed = builtIns.map((file) => plugins.parse(fs.readFileSync(path.join(pluginDirectory, file), "utf8")));
  assert.equal(new Set(allParsed.map((plugin) => plugin.id)).size, allParsed.length);
  for (const plugin of parsed) {
    assert.ok(Buffer.byteLength(plugin.document, "utf8") <= 3000, plugin.id);
    assert.ok(plugin.nameZh, plugin.id);
    assert.ok(plugin.description, plugin.id);
    assert.ok(plugin.descriptionZh, plugin.id);
    assert.ok(plugin.category, plugin.id);
    assert.ok(plugin.categoryZh, plugin.id);
    assert.ok(plugin.source, plugin.id);
    assert.match(plugin.document, /^## One-shot example$/m, plugin.id);
    assert.match(plugin.document, /`html_widget`/, plugin.id);
    if (plugin.connect.length) assert.match(plugin.document, /credentials:"omit"/, plugin.id);
    else assert.match(plugin.document, /no network access/i, plugin.id);
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
  assert.match(flowchart.document, /Mermaid is the portable professional source format/);
  assert.match(flowchart.document, /copyText/);
  assert.match(flowchart.document, /copyLabel:"Copy Mermaid"/);
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
  assert.match(app, /plugins\\\/\(\?:private\\\//);
  assert.match(server, /PENECHO_PRIVATE_PLUGIN_DIR/);
  assert.match(server, /STATE_DIRECTORY[\s\S]*?path\.join\(STATE_DIRECTORY, "plugins", "private"\)/);
  assert.match(server, /plugins\/private/);
});

test("plugin parser rejects oversized contracts, unsafe origins, and missing one-shots", () => {
  assert.throws(() => plugins.parse(`${weather}\n${"x".repeat(3000)}`), /1000-token budget/);
  assert.throws(() => plugins.parse(weather.replace("https://api.open-meteo.com", "https://*.open-meteo.com")), /invalid or duplicate origin/);
  assert.throws(() => plugins.parse(weather.replace("https://api.open-meteo.com", "https://api.open-meteo.com/v1")), /invalid or duplicate origin/);
  assert.throws(() => plugins.parse(weather.replace("## One-shot example", "## Usage example")), /one-shot example/);
  assert.throws(() => plugins.parse(weather.replace("Produce one `html_widget`", "Produce one widget")), /expected output command/);
  assert.throws(() => plugins.parse(weather.replace(/^description:.*\n/m, "")), /description is required/);
  assert.throws(() => plugins.parse(weather.replace(/^category:.*\n/m, "")), /category is required/);
  assert.throws(() => plugins.parse(weather.replace(/^source:.*\n/m, "")), /source is required/);
});

test("plugin parser accepts an explicitly empty connect list", () => {
  const document = fs.readFileSync(path.join(pluginDirectory, "general.md"), "utf8"),
    blockList = plugins.parse(document),
    inlineList = plugins.parse(document.replace("connect:\nrecommended-refresh-seconds", "connect: []\nrecommended-refresh-seconds"));
  assert.equal(blockList.id, "general");
  assert.deepEqual([...blockList.connect], []);
  assert.deepEqual([...inlineList.connect], []);
});

test("plugin model output extraction accepts commentary, fences, and common YAML lists", () => {
  const server = fs.readFileSync(path.join(ROOT, "src", "server", "main.js"), "utf8"),
    document = fs.readFileSync(path.join(pluginDirectory, "general.md"), "utf8")
      .replace("connect:\nrecommended-refresh-seconds", "connect: []\nrecommended-refresh-seconds"),
    extract = vm.runInNewContext(`(${functionSource(server, "pluginDocumentFromModel")})`, { PLUGIN_FORMAT:plugins });
  const extracted = extract(`Here is the revised contract:\n\n\`\`\`markdown\n${document}\n\`\`\``);
  assert.equal(plugins.parse(extracted).id, "general");
});

test("widget host keeps generated HTML in an opaque inner frame and snapshots it cooperatively", () => {
  const host = fs.readFileSync(path.join(ROOT, "public", "widget-host.js"), "utf8"),
    html = fs.readFileSync(path.join(ROOT, "public", "widget-host.html"), "utf8"),
    server = fs.readFileSync(path.join(ROOT, "src", "server", "main.js"), "utf8"),
    flowchart = fs.readFileSync(path.join(ROOT, "public", "plugins", "flowchart.md"), "utf8"),
    renderer = fs.readFileSync(path.join(ROOT, "public", "vendor", "penecho-dom-renderer.js"), "utf8"),
    rendererLicense = fs.readFileSync(path.join(ROOT, "public", "vendor", "html2canvas.LICENSE"), "utf8");
  assert.match(host, /setAttribute\("sandbox", "allow-scripts"\)/);
  assert.doesNotMatch(host, /allow-same-origin/);
  assert.match(host, /connect-src \$\{origins\}/);
  assert.match(host, /img-src \$\{images\}/);
  assert.match(host, /connect\.length \? connect\.join\(" "\) : "'none'"/);
  assert.match(host, /querySelectorAll\("base, iframe, object, embed, form[\s\S]*?script\[src\]/);
  assert.match(host, /script-src 'unsafe-inline' \$\{rendererUrl\}/);
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
  assert.doesNotMatch(host, /<foreignObject|penecho-widget-snapshot-markup/);
  assert.doesNotMatch(host, /createObjectURL/);
  assert.match(host, /toDataURL\("image\/png"\)/);
  assert.match(host, /penecho-widget-snapshot-request/);
  for (const type of [
    "penecho-widget-drag-start", "penecho-widget-drag-move", "penecho-widget-drag-end",
    "penecho-widget-touch-start", "penecho-widget-touch-move", "penecho-widget-touch-end",
  ]) assert.match(host, new RegExp(type));
  assert.match(host, /HOLD_MS = 500/);
  assert.match(host, /MOVE_TOLERANCE_PX = 8/);
  assert.match(host, /const presses = new Map\(\)/);
  assert.match(host, /if \(widgetState\.selected && press\.hit !== "move"[\s\S]*?activateHold\(press\)/);
  assert.match(host, /if \(widgetState\.selected\)[\s\S]*?activateHold\(press\)[\s\S]*?pointerMessage\(DRAG_MOVE, press\)/);
  assert.match(host, /!widgetState\.selected && moved[\s\S]*?pointerMessage\(TOUCH_MOVE, press\)/);
  assert.match(host, /touchCount\(\) >= 2[\s\S]*?cancelAllHoldsForNavigation/);
  assert.match(host, /hit:"resize"[\s\S]*?hit:"width"[\s\S]*?hit:"height"/);
  assert.match(host, /penecho-widget-state/);
  assert.match(host, /document\.execCommand\?\.\("copy"\)/);
  assert.match(host, /nativeCopy = navigator\.clipboard\?\.writeText \? navigator\.clipboard\.writeText\(copySourceText\)/);
  assert.ok(host.indexOf("nativeCopy = navigator.clipboard") < host.indexOf('document.execCommand?.("copy")'));
  assert.match(host, /penecho-widget-copy-source-result/);
  assert.match(host, /function updateCopySourceScale\(\)[\s\S]*?1 \/ scaleX[\s\S]*?1 \/ scaleY/);
  assert.match(host, /widgetState = \{ selected:message\.selected, scaleX:message\.scaleX, scaleY:message\.scaleY \};\s*updateCopySourceScale\(\)/);
  assert.match(host, /MAX_COPY_TEXT_LENGTH = 16000/);
  assert.match(html, /id="widgetCopySource"/);
  assert.match(html, /#widgetCopySource \{[^}]*transform-origin: top right/);
  assert.match(host, /function inlineSvgComputedStyles\(\)/);
  assert.match(host, /"fill"[\s\S]*?"stroke"[\s\S]*?"font-family"[\s\S]*?"font-size"/);
  assert.match(host, /element\.setAttribute\(property, value\)/);
  assert.match(host, /data-penecho-snapshot-background/);
  assert.match(host, /finally\s*\{\s*restoreSvgStyles\(\)/);
  assert.match(flowchart, /presentation attributes[\s\S]*?directly on the relevant SVG elements/);
  assert.match(host, /if \(press\.active\)[\s\S]*?event\.preventDefault/);
  assert.match(host, /penecho-widget-dragging[\s\S]*?user-select:none/);
  assert.match(host, /html,body\{background:transparent!important;color-scheme:light!important/);
  assert.doesNotMatch(host, /-webkit-touch-callout:none/);
  assert.match(html, /widget-host\.js/);
  assert.match(html, /html, body, iframe \{[^}]*color-scheme: light/);
  assert.match(html, /iframe \{[^}]*touch-action: none/);
});

test("widget iframe gestures distinguish first selection, direct editing, controls, and canvas navigation", () => {
  const navigation = widgetRuntimeHarness();
  navigation.pointer("pointerdown");
  navigation.pointer("pointermove", { clientX:120, screenX:120 });
  assert.deepEqual(navigation.messages.map((message) => message.type), ["penecho-widget-touch-start", "penecho-widget-touch-move"]);
  navigation.runTimers();
  assert.equal(navigation.messages.some((message) => message.type === "penecho-widget-drag-start"), false);

  const hold = widgetRuntimeHarness();
  hold.pointer("pointerdown", { pointerType:"pen" });
  assert.equal(hold.messages.length, 0);
  hold.runTimers();
  assert.equal(hold.messages.at(-1).type, "penecho-widget-drag-start");
  assert.equal(hold.messages.at(-1).hit, "move");

  const selected = widgetRuntimeHarness();
  selected.select();
  selected.pointer("pointerdown", { pointerType:"pen" });
  assert.equal(selected.messages.length, 0);
  selected.pointer("pointermove", { pointerType:"pen", clientX:120, screenX:120 });
  assert.deepEqual(selected.messages.map((message) => message.type), ["penecho-widget-drag-start", "penecho-widget-drag-move"]);

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
});
