"use strict";
require("./helpers/safety.js");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { CANVAS_PAGE_SCALE, CANVAS_PAGE_SCALES, CANVAS_PAGE_SCALE_STORAGE_KEY, normalizeCanvasPageScale } = require("../public/page-scale.js");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function runPageScale({ desktop = false, parent, storedScale = null, computedZoom = "" } = {}) {
  const classes = new Set(), dataset = {}, storage = new Map(), desktopCalls = [], events = [];
  if (storedScale !== null) storage.set(CANVAS_PAGE_SCALE_STORAGE_KEY, String(storedScale));
  const browserWindow = new EventTarget();
  browserWindow.parent = parent || browserWindow;
  if (desktop) browserWindow.penechoDesktop = { setPageScale:value => desktopCalls.push(value) };
  browserWindow.getComputedStyle = () => ({ zoom:computedZoom });
  browserWindow.addEventListener("penecho:page-scale-change", () => events.push(browserWindow.PenEchoPageScale.current()));
  vm.runInNewContext(read("public/page-scale.js"), {
    window:browserWindow,
    Event,
    localStorage:{
      getItem:key => storage.get(key) ?? null,
      setItem:(key, value) => storage.set(key, String(value)),
    },
    document:{
      documentElement:{
        classList:{
          toggle(value, force) {
            if (force) classes.add(value);
            else classes.delete(value);
          },
        },
        dataset,
      },
    },
  });
  return { get classes() { return [...classes]; }, dataset, storage, desktopCalls, events, browserWindow };
}

test("Page zoom validates the four choices and migrates the former 125% preference", () => {
  const defaultWeb = runPageScale();
  const web = runPageScale({ storedScale:1.25 });
  const css = read("public/style.css"), linesCss = read("public/lines/lines.css");

  assert.equal(CANVAS_PAGE_SCALE, 1);
  assert.deepEqual(CANVAS_PAGE_SCALES, [0.9, 1, 1.1, 1.2]);
  assert.equal(normalizeCanvasPageScale(0.9), 0.9);
  assert.equal(normalizeCanvasPageScale(1.25), 1.2);
  assert.equal(normalizeCanvasPageScale(1.5), 1);
  assert.equal(normalizeCanvasPageScale("invalid"), 1);
  assert.deepEqual(defaultWeb.classes, []);
  assert.deepEqual(web.classes, ["penecho-web-page-scale"]);
  assert.equal(web.storage.get(CANVAS_PAGE_SCALE_STORAGE_KEY), "1.2");
  assert.equal(web.dataset.penechoPageScale, "120");
  assert.equal(web.browserWindow.PenEchoPageScale.apply(0.9), 0.9);
  assert.equal(web.storage.get(CANVAS_PAGE_SCALE_STORAGE_KEY), "0.9");
  assert.equal(web.dataset.penechoPageScale, "90");
  web.storage.set(CANVAS_PAGE_SCALE_STORAGE_KEY, "1.1");
  web.browserWindow.dispatchEvent(Object.assign(new Event("storage"), { key:CANVAS_PAGE_SCALE_STORAGE_KEY }));
  assert.equal(web.dataset.penechoPageScale, "110");
  assert.equal(web.browserWindow.PenEchoPageScale.apply(1), 1);
  assert.deepEqual(web.classes, []);
  assert.equal(web.dataset.penechoPageScale, undefined);
  assert.deepEqual(web.events, [1.2, 0.9, 1.1, 1]);
  assert.match(css, /html\.penecho-web-page-scale \{[^}]*--penecho-canvas-page-viewport-width: calc\(100vw \/ var\(--penecho-page-scale\)\)[^}]*zoom: var\(--penecho-page-scale\)/);
  assert.match(linesCss, /html\.penecho-web-page-scale \{[^}]*zoom: var\(--penecho-page-scale\)/);
  for (const stylesheet of [css, linesCss]) {
    const cssChoices = [...stylesheet.matchAll(/data-penecho-page-scale="(\d+)"\] \{ --penecho-page-scale: ([.\d]+);/g)];
    assert.deepEqual(cssChoices.map(([, percent, factor]) => [Number(percent), Number(factor)]), [[90, 0.9], [110, 1.1], [120, 1.2]]);
  }
});

test("The desktop uses native zoom and embedded pages inherit the shell zoom", () => {
  const desktop = runPageScale({ desktop:true, storedScale:1.2 });
  const canvas = runPageScale({ desktop:true, parent:desktop.browserWindow, storedScale:1.2 });
  const web = runPageScale({ storedScale:1.2 });
  const embeddedWeb = runPageScale({ parent:web.browserWindow, storedScale:1.2 });
  const main = read("desktop/main.js"), preload = read("desktop/canvas-preload.js");
  assert.deepEqual(desktop.classes, []);
  assert.deepEqual(desktop.desktopCalls, [1.2]);
  assert.deepEqual(canvas.desktopCalls, []);
  assert.deepEqual(embeddedWeb.classes, []);
  canvas.browserWindow.PenEchoPageScale.apply(0.9);
  canvas.browserWindow.PenEchoPageScale.apply(0.9);
  assert.deepEqual(desktop.desktopCalls, [1.2, 0.9]);
  assert.deepEqual(canvas.events, [1.2, 0.9]);
  assert.equal(canvas.dataset.windowScale, "90");
  assert.deepEqual(canvas.desktopCalls, []);
  assert.equal(desktop.storage.get(CANVAS_PAGE_SCALE_STORAGE_KEY), "0.9");
  assert.equal(canvas.storage.get(CANVAS_PAGE_SCALE_STORAGE_KEY), "1.2");
  assert.match(main, /const \{ CANVAS_PAGE_SCALE, normalizeCanvasPageScale \} = require\("\.\.\/public\/page-scale\.js"\)/);
  assert.match(main, /webPreferences:\{ preload:CANVAS_PRELOAD, zoomFactor:CANVAS_PAGE_SCALE \}/);
  assert.match(main, /ipcMain\.handle\("penecho:set-page-scale"[\s\S]*?fromCanvas\(event\) \|\| event.senderFrame !== event.sender.mainFrame[\s\S]*?setZoomFactor\(scale\)/);
  assert.match(preload, /setPageScale:scale => ipcRenderer\.invoke\("penecho:set-page-scale", scale\)/);
});

test("Projects and Canvas load page zoom before styles", () => {
  const html = read("public/index.html"), packageJson = JSON.parse(read("package.json"));
  const projects = read("public/projects.html");
  const config = html.indexOf('<script src="/api/config.js"></script>'),
    scale = html.indexOf('<script src="page-scale.js"></script>'),
    style = html.indexOf('<link rel="stylesheet" href="style.css">');

  assert.ok(config > 0 && config < scale && scale < style);
  assert.match(projects, /<script src="page-scale\.js"><\/script>\s*<link rel="stylesheet" href="lines\/bundle\.css/);
  assert.deepEqual([...html.matchAll(/data-page-scale="([^"]+)"/g)].map(match => Number(match[1])), CANVAS_PAGE_SCALES);
  assert.equal((html.match(/\/api\/config\.js/g) || []).length, 1);
  assert.ok(packageJson.files.includes("public/page-scale.js"));
});

test("web page scaling keeps Canvas layout coordinates aligned with screen input", () => {
  const core = read("src/client/app/core.js"), canvas = read("src/client/app/canvas-runtime.js"), agent = read("src/client/app/canvas-agent-runtime.js");

  assert.match(core, /clientScaleX = rect\.width > 0 \? width \/ rect\.width : 1/);
  assert.match(core, /function canvasClientPosition\(clientX, clientY\)/);
  assert.match(core, /addEventListener\("penecho:page-scale-change"[\s\S]*?updateAppearanceControls\(\);[\s\S]*?fit\(\);[\s\S]*?dispatchEvent\(new Event\("resize"\)\)/);
  assert.match(canvas, /function fit\(\) \{\s*invalidateCanvasViewportMetrics\(\);\s*const metrics = canvasViewportMetrics\(\)/);
  assert.match(canvas, /function clientPoint\(e\) \{\s*const point = canvasClientPosition\(e\.clientX, e\.clientY\)/);
  assert.match(canvas, /const delta = canvasClientDelta\(dx, dy\)/);
});

test("PenEchoPageScale.layoutScale reads numeric and percentage CSS zoom and falls back to 1", () => {
  assert.equal(runPageScale().browserWindow.PenEchoPageScale.layoutScale(), 1);
  assert.equal(runPageScale({ computedZoom:"1.2" }).browserWindow.PenEchoPageScale.layoutScale(), 1.2);
  assert.equal(runPageScale({ computedZoom:"0.9" }).browserWindow.PenEchoPageScale.layoutScale(), 0.9);
  assert.equal(runPageScale({ computedZoom:"120%" }).browserWindow.PenEchoPageScale.layoutScale(), 1.2);
  assert.equal(runPageScale({ computedZoom:"normal" }).browserWindow.PenEchoPageScale.layoutScale(), 1);
});

test("Projects menus, popups, tooltips and dialog CSS stay aligned and inside the window under web page zoom", () => {
  const { parseHTML } = require("./helpers/dom.js");
  const linesCss = read("public/lines/lines.css"), deskCss = read("public/lines/desk.css"), lineCss = read("public/lines/line.css"), cloudCss = read("public/lines/cloud.css");
  assert.match(linesCss, /html\.penecho-web-page-scale \{[^}]*--lines-viewport-width: calc\(100vw \/ var\(--penecho-page-scale\)\)[^}]*--lines-viewport-height: calc\(100vh \/ var\(--penecho-page-scale\)\)[^}]*--lines-viewport-dynamic-height: calc\(100dvh \/ var\(--penecho-page-scale\)\)/);
  assert.match(linesCss, /\.line-command-dialog \{[^}]*var\(--lines-viewport-width, 100vw\)[^}]*var\(--lines-viewport-dynamic-height, 100dvh\)/);
  assert.match(deskCss, /\.token-proof-dialog \{[^}]*var\(--lines-viewport-width, 100vw\)[^}]*var\(--lines-viewport-dynamic-height, 100dvh\)/);
  assert.match(deskCss, /\.token-proof-body \{[^}]*var\(--lines-viewport-dynamic-height, 100dvh\)/);
  assert.match(lineCss, /\.lp-panel\.is-popped \{[^}]*var\(--lines-viewport-width, 100vw\)[^}]*var\(--lines-viewport-dynamic-height, 100dvh\)/);
  assert.match(lineCss, /\.lp-review-pop \{[^}]*var\(--lines-viewport-width, 100vw\)[^}]*var\(--lines-viewport-dynamic-height, 100dvh\)/);
  assert.match(cloudCss, /\.menu\.cloud-pop \{[^}]*var\(--lines-viewport-width, 100vw\)/);

  for (const zoom of [0.9, 1, 1.1, 1.2]) {
    const viewportW = 1200, viewportH = 800;
    const { document, window } = parseHTML("<html><body><button id=\"anchor\"></button><div id=\"form\"></div><div id=\"share\" class=\"bar-share\"></div></body></html>");
    const boxOf = (el, layoutRect) => {
      el.getBoundingClientRect = () => ({
        left:layoutRect.left * zoom,
        top:layoutRect.top * zoom,
        right:(layoutRect.left + layoutRect.width) * zoom,
        bottom:(layoutRect.top + layoutRect.height) * zoom,
        width:layoutRect.width * zoom,
        height:layoutRect.height * zoom,
      });
      el.getClientRects = () => [el.getBoundingClientRect()];
      Object.defineProperty(el, "offsetWidth", { configurable:true, get:() => layoutRect.width });
      Object.defineProperty(el, "offsetHeight", { configurable:true, get:() => layoutRect.height });
    };
    const anchor = document.querySelector("#anchor");
    // Anchor at visual x=1150..1180, y=50..80 (right side of a 1200x800 window).
    const anchorLayout = { left:1150 / zoom, top:50 / zoom, width:30 / zoom, height:30 / zoom };
    boxOf(anchor, anchorLayout);

    const ctx = vm.createContext({
      document, window, innerWidth:viewportW, innerHeight:viewportH,
      getComputedStyle:() => ({ zoom:String(zoom) }),
      requestAnimationFrame:() => 1, cancelAnimationFrame() {},
      setTimeout, clearTimeout,
      Event,
    });
    const core = read("public/lines/core.js");
    vm.runInContext(core, ctx, { filename:"public/lines/core.js" });

    // 1. placeMenu right-aligned near right edge (core.js)
    const menu = document.createElement("div");
    menu.id = "menu";
    document.body.append(menu);
    boxOf(menu, { left:0, top:0, width:220, height:160 });
    ctx.placeMenu(menu, anchor, "right");
    const menuLeft = parseFloat(menu.style.left), menuTop = parseFloat(menu.style.top);
    const menuScreenRight = (menuLeft + 220) * zoom, menuScreenTop = menuTop * zoom;
    assert.ok(menuScreenRight <= viewportW - 8 * zoom + 0.5, `zoom=${zoom}: menu right ${menuScreenRight} exceeds viewport`);
    assert.ok(Math.abs(menuScreenRight - 1180) < 0.5, `zoom=${zoom}: menu right ${menuScreenRight} should align with anchor right 1180`);
    assert.ok(Math.abs(menuScreenTop - (80 + 6 * zoom)) < 0.5, `zoom=${zoom}: menu top ${menuScreenTop} misaligned`);
    menu.remove();

    // 2. placeMenu at pointer coordinate (context menu on lightbox image)
    const ctxMenu = document.createElement("div");
    ctxMenu.id = "menu";
    document.body.append(ctxMenu);
    boxOf(ctxMenu, { left:0, top:0, width:180, height:60 });
    ctx.placeMenu(ctxMenu, anchor, "left", { x:1140, y:760 });
    assert.ok((parseFloat(ctxMenu.style.left) + 180) * zoom <= viewportW - 8 * zoom + 0.5, `zoom=${zoom}: context menu right clipped`);
    assert.ok((parseFloat(ctxMenu.style.top) + 60) * zoom <= viewportH - 8 * zoom + 0.5, `zoom=${zoom}: context menu bottom clipped`);
    ctxMenu.remove();

    // 3. placeReviewTreePopover (line.js)
    const lineSrc = read("public/lines/line.js");
    const reviewStart = lineSrc.indexOf("function placeReviewTreePopover(");
    const reviewEnd = lineSrc.indexOf("function reviewTreePopoverHTML(");
    vm.runInContext(lineSrc.slice(reviewStart, reviewEnd), ctx, { filename:"placeReviewTreePopover" });
    const pop = document.createElement("div");
    document.body.append(pop);
    boxOf(pop, { left:0, top:0, width:320, height:200 });
    ctx.placeReviewTreePopover(pop, anchor);
    const popScreenRight = (parseFloat(pop.style.left) + 320) * zoom;
    assert.ok(popScreenRight <= viewportW - 8 * zoom + 0.5, `zoom=${zoom}: review popover right ${popScreenRight} exceeds viewport`);
    assert.ok(Math.abs(popScreenRight - 1180) < 0.5, `zoom=${zoom}: review popover should align with anchor right`);
    pop.remove();

    // 4. showStopCard (line.js)
    const stopStart = lineSrc.indexOf("function showStopCard(");
    const stopEnd = lineSrc.indexOf("function hideStopCard(");
    Object.assign(ctx, {
      isYours:() => false, isOrchReview:() => false, fileEntry:() => null,
      stepLabel:() => "Work 1", inlineSay:t => t, stopWords:() => "Done",
    });
    vm.runInContext(lineSrc.slice(stopStart, stopEnd), ctx, { filename:"showStopCard" });
    const card = document.createElement("div");
    card.id = "stopCard";
    document.body.append(card);
    boxOf(card, { left:0, top:0, width:300, height:90 });
    ctx.showStopCard({ id:"p" }, { id:"l" }, { kind:"work", took:"1m" }, anchor);
    const cardScreenRight = (parseFloat(card.style.left) + 300) * zoom;
    assert.ok(cardScreenRight <= viewportW - 8 * zoom + 0.5, `zoom=${zoom}: stopCard right ${cardScreenRight} exceeds viewport`);
    card.remove();

    // 5. nodeTipShow (desk.js)
    const deskSrc = read("public/lines/desk.js");
    const tipStart = deskSrc.indexOf("const NodeTip =");
    const tipEnd = deskSrc.indexOf("function nodeTipHide(");
    vm.runInContext(deskSrc.slice(tipStart, tipEnd), ctx, { filename:"nodeTipShow" });
    anchor.dataset.tip = "Page zoom"; anchor.dataset.tipS = "done"; anchor.dataset.tipMeta = "Ready";
    const nodeTip = vm.runInContext("NodeTip", ctx);
    nodeTip.el = document.createElement("div");
    document.body.append(nodeTip.el);
    boxOf(nodeTip.el, { left:0, top:0, width:220, height:50 });
    ctx.nodeTipShow(anchor);
    const tipScreenRight = (parseFloat(nodeTip.el.style.left) + 220) * zoom;
    assert.ok(tipScreenRight <= viewportW - 6 * zoom + 0.5, `zoom=${zoom}: nodeTip right ${tipScreenRight} exceeds viewport`);
    nodeTip.el.remove();

    // 6. keepPaint (cloud.js)
    const cloudSrc = read("public/lines/cloud.js");
    const keepStart = cloudSrc.indexOf("function keepPaint(");
    const keepEnd = cloudSrc.indexOf("function keepOutside(");
    Object.assign(ctx, { KEEP:{ id:"p" }, project:() => ({ id:"p" }), keepPopHTML:() => "<strong>Cloud</strong>" });
    vm.runInContext(cloudSrc.slice(keepStart, keepEnd), ctx, { filename:"keepPaint" });
    const share = document.querySelector(".bar-share");
    boxOf(share, anchorLayout);
    const cloudPop = document.createElement("div");
    cloudPop.id = "menu"; cloudPop.className = "menu cloud-pop";
    document.body.append(cloudPop);
    boxOf(cloudPop, { left:0, top:0, width:300, height:140 });
    ctx.keepPaint();
    const cloudScreenRight = (parseFloat(cloudPop.style.left) + 300) * zoom;
    assert.ok(cloudScreenRight <= viewportW - 8 * zoom + 0.5, `zoom=${zoom}: cloud popover right ${cloudScreenRight} exceeds viewport`);
    assert.ok(Math.abs(cloudScreenRight - 1180) < 0.5, `zoom=${zoom}: cloud popover should align with Share right edge`);
    cloudPop.remove();
  }
});

test("Branch menu in composer stays inside the zoomed viewport", async () => {
  const { parseHTML } = require("./helpers/dom.js");
  const core = read("public/lines/core.js"), compSrc = read("public/lines/composer.js");
  const branchStart = compSrc.indexOf("async function openBranchMenu(");
  const branchEnd = compSrc.indexOf("ACT['box-branch']");
  for (const zoom of [0.9, 1, 1.1, 1.2]) {
    const viewportW = 1200, viewportH = 800;
    const { document, window } = parseHTML("<html><body><div class=\"composer\"><button id=\"chip\"></button></div></body></html>");
    const boxOf = (el, layoutRect) => {
      el.getBoundingClientRect = () => ({
        left:layoutRect.left * zoom, top:layoutRect.top * zoom,
        right:(layoutRect.left + layoutRect.width) * zoom, bottom:(layoutRect.top + layoutRect.height) * zoom,
        width:layoutRect.width * zoom, height:layoutRect.height * zoom,
      });
      el.getClientRects = () => [el.getBoundingClientRect()];
    };
    const form = document.querySelector(".composer"), chip = document.querySelector("#chip");
    boxOf(form, { left:100 / zoom, top:680 / zoom, width:1080 / zoom, height:80 / zoom });
    boxOf(chip, { left:1080 / zoom, top:720 / zoom, width:90 / zoom, height:30 / zoom });
    const origAppend = document.body.append.bind(document.body);
    document.body.append = (...nodes) => {
      origAppend(...nodes);
      for (const n of nodes) {
        if (n?.classList?.contains("branch-menu")) {
          boxOf(n, { left:0, top:0, width:390, height:240 });
          for (const b of n.querySelectorAll("button")) b.focus = () => {};
        }
      }
    };
    const ctx = vm.createContext({
      document, window, innerWidth:viewportW, innerHeight:viewportH,
      getComputedStyle:() => ({ zoom:String(zoom) }),
      requestAnimationFrame:() => 1, cancelAnimationFrame() {},
      setTimeout:() => 0, clearTimeout() {}, Event,
      project:() => ({ id:"p", trunk:"main", lines:[], branches:{} }),
      homeBox:() => ({}), boxTarget:() => ({ main:true }),
      api:async () => ({ branches:[] }), pathFor:() => "/p", folderBranch:() => "main",
      latestBranch:() => "main", lineState:() => "done",
      ageWords:() => "", chooseTarget() {},
    });
    vm.runInContext(core, ctx, { filename:"public/lines/core.js" });
    vm.runInContext(compSrc.slice(branchStart, branchEnd), ctx, { filename:"openBranchMenu" });
    await ctx.openBranchMenu(chip);
    const m = document.querySelector("#menu.branch-menu");
    assert.ok(m, `zoom=${zoom}: branch menu rendered`);
    const rightScreen = (parseFloat(m.style.left) + 390) * zoom;
    const bottomGapScreen = parseFloat(m.style.bottom) * zoom;
    assert.ok(rightScreen <= viewportW - 8 * zoom + 0.5, `zoom=${zoom}: branch menu right ${rightScreen} exceeds viewport`);
    assert.ok(Math.abs(rightScreen - 1170) < 0.5, `zoom=${zoom}: branch menu right ${rightScreen} should align with chip right 1170`);
    assert.ok(Math.abs(bottomGapScreen - (viewportH - 680 + 6 * zoom)) < 0.5, `zoom=${zoom}: branch menu bottom ${bottomGapScreen} misaligned`);
  }
});
