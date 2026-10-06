"use strict";
// Browser acceptance for real encoders, isolated widget snapshots and payload
// limits. All model requests are intercepted; no user canvas is loaded.
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || "playwright");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict"), sharp = require("sharp");
const JEVISION = require("../src/server/jevision.js");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-jevision-images-"));
Object.assign(process.env, {
  NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(directory, "state"),
  PENECHO_CONFIG_FILE:path.join(directory, "config.env"), HOST:"127.0.0.1", PORT:"0",
  AI_PROVIDER:"api", AI_API_KEY:"test", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test",
  PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false",
});
const server = require("../server.js");
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    browser = await chromium.launch({ headless:true });
    const page = await browser.newPage({ viewport:{ width:1440, height:1100 } }), errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    const source = fs.readFileSync(path.resolve(__dirname, "../public/app.js"), "utf8").replace(/\}\)\(\);\s*$/, `
      const captureCalls = [], originalSnapshot = requestWidgetSnapshot;
      requestWidgetSnapshot = (...args) => { captureCalls.push(args[0].id); return originalSnapshot(...args); };
      async function replayCrop(snapshot, box, result = false) {
        const image = new Image(); image.src = snapshot; await image.decode();
        const scene = drawSmartSuggestScene, dirtyInk = drawSmartSuggestDirtyInk, dirty = state.dirty;
        try {
          drawSmartSuggestScene = context => context.drawImage(image, 0, 0);
          drawSmartSuggestDirtyInk = context => {
            context.save(); context.globalAlpha = 1; context.beginPath();
            context.rect(box.x, box.y, box.w, box.h); context.clip();
            context.drawImage(image, 0, 0); context.restore();
          };
          state.dirty = box;
          const cluster = { box, result, strokes:[], recentIds:new Set() }, region = smartSuggestCropRegion(cluster);
          return { region, image:smartSuggestCrop(cluster, region) };
        } finally { drawSmartSuggestScene = scene; drawSmartSuggestDirtyInk = dirtyInk; state.dirty = dirty; }
      }
      window.imageTest = { state, smartSuggest, widgetAssist, widgetRecord, mountWidget, requestWidgetSnapshot,
        widgetAssistPrefetch, widgetAssistEntry, widgetAssistCrop, widgetAssistCropRegion, smartSuggestCrop, smartSuggestCropRegion, smartSuggestEncodeImage,
        renderSelectionImage, canvasDocumentsReady, stroke, save, render, captureCalls, offscreen, settings,
        drawWidgetsToContext, drawImagesToContext, drawTextBoxesToContext, drawSharpOverlays, forTiles, TILE, replayCrop };
    })();`);
    await page.route(/^https:\/\//, route => route.abort());
    await page.route("**/app.js*", route => route.fulfill({ contentType:"application/javascript", body:source }));
    await page.route("**/api/suggest", route => {
      const body = route.request().postDataJSON();
      assert.equal(body.version,1);assert.equal(body.questions,undefined);
      requests.push(body);
      return route.fulfill({ contentType:"application/json", body:JSON.stringify({ ok:true, answers:JEVISION.mockAnswers(require("../public/smart-suggest.js").buildQuestions({shapesFit:body.context?.shapesFit}), "", "none") }) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.imageTest));
    await page.evaluate(async () => {
      const t = imageTest, s = t.state;
      await t.canvasDocumentsReady;
      s.auto = false; s.scale = 1; s.panX = 0; s.panY = 0; s.mode = "pen";
      t.smartSuggest.available = false;
      const cards = Array.from({ length:12 }, (_, i) => `<section><h2>Region ${i + 1} / 区域 ${i + 1}</h2><strong>${(21 + i * .37).toFixed(2)}%</strong><p>Revenue +12.5% · 2026 forecast</p><p>温度 33°C · 湿度 60% · 东南风</p><p>Check units, labels and fine details.</p><svg width="240" height="60"><path d="M0 50 L40 35 L80 40 L120 15 L180 28 L230 5" fill="none" stroke="#2463eb" stroke-width="2"/></svg></section>`).join("");
      const html = `<!doctype html><html><head><style>body{margin:0;padding:24px;background:#f5f7fb;color:#18243a;font:14px Arial,sans-serif}h1{font-size:25px;margin:0 0 16px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}section{background:white;border:1px solid #dce3ef;border-radius:8px;padding:12px}h2{font-size:16px;margin:0 0 8px}strong{font-size:28px;color:#2463eb}p{margin:7px 0;font-size:14px!important;line-height:1.4!important}</style></head><body><h1>Regional outlook · 区域数据概览</h1><div class="grid">${cards}</div></body></html>`;
      const target = t.widgetRecord({ id:"widget-9001", tool:"html_widget", pluginId:"general", x:100, y:100, w:1000, h:1100, refreshSeconds:0, title:"Dense report", html });
      const occluder = t.widgetRecord({ id:"widget-9002", tool:"html_widget", pluginId:"general", x:580, y:180, w:480, h:700, refreshSeconds:0, title:"Unrelated overlay", html:'<html><body style="margin:0"><svg width="480" height="700" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="700" fill="#ff00ff"/><text x="20" y="40">UNRELATED WIDGET</text></svg></body></html>' });
      s.widgets.push(target, occluder);
      t.mountWidget(target); t.mountWidget(occluder); t.render();
    });
    await page.waitForFunction(() => imageTest.state.widgets.every(widget => widget.hostReady && widget.initialized && widget.contentVersion > 0));
    await page.evaluate(async () => {
      const t = imageTest;
      await Promise.all(t.state.widgets.map(widget => t.requestWidgetSnapshot(widget, 10000)));
      t.captureCalls.length = 0;
    });
    const images = await page.evaluate(async () => {
      const t = imageTest, target = t.state.widgets[0], region = t.widgetAssistCropRegion(target);
      // The former 512-pixel composite, retained only as a visual baseline.
      function previousCrop(region, targetOnly = false, maxSide = 512) {
        const scale = Math.min(1, maxSide / Math.max(region.w, region.h)), out = t.offscreen(Math.round(region.w * scale), Math.round(region.h * scale)), q = out.getContext("2d");
        q.fillStyle = "white"; q.fillRect(0, 0, out.width, out.height);
        q.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
        if (targetOnly) q.drawImage(target.snapshotImage, target.x, target.y, target.w, target.h);
        else {
          t.drawWidgetsToContext(q, region); t.drawImagesToContext(q, region); t.drawTextBoxesToContext(q, region);
          t.forTiles(region.x, region.y, region.w, region.h, (canvas, tx, ty) => q.drawImage(canvas, tx * t.TILE, ty * t.TILE), false);
          t.drawSharpOverlays(q, region);
        }
        return out.toDataURL("image/png");
      }
      const before = previousCrop(region), referencePng = previousCrop(region, true, 1024), after = t.widgetAssistCrop(target, region);
      // Two strokes: only the red one belongs to the current annotation bounds.
      t.stroke({ x:160, y:200 }, { x:450, y:240 }, false, 12, true, "#ef1010");
      t.stroke({ x:180, y:850 }, { x:460, y:850 }, false, 12, true, "#ff00ff");
      t.state.dirty = { x:145, y:185, w:320, h:70 };
      const annotated = t.widgetAssistCrop(target, region, true), unannotated = t.widgetAssistCrop(target, region, false);
      const small = { ...target, w:250, h:275 };
      const scaled = t.widgetAssistCrop(small, t.widgetAssistCropRegion(small));
      t.state.dirty = null;
      t.smartSuggest.available = true;
      t.state.widgetRefineConfirmation = { widgetId:target.id, assistRequestedKey:t.widgetAssistEntry(target).key };
      await t.widgetAssistPrefetch(target, "image-verification");
      t.smartSuggest.available = false;
      return { before, referencePng, after, annotated, unannotated, scaled, captureCalls:t.captureCalls };
    });
    assert.deepEqual(images.captureCalls, ["widget-9001"], "only the target widget is refreshed");
    assert.equal(requests.length, 1, "the real prefetch sends an image request");
    images.payload = requests[0].image;
    delete images.captureCalls;
    const report = {};
    for (const [name, image] of Object.entries(images)) {
      const bytes = Buffer.from(image.split(",")[1], "base64"), metadata = await sharp(bytes).metadata();
      fs.writeFileSync(path.join(directory, `${name}.${metadata.format}`), bytes);
      const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject:true });
      let magenta = 0, red = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        const [r, g, b] = data.subarray(i, i + 3);
        if (r > 180 && b > 160 && g < 90) magenta++;
        if (r > 180 && g < 90 && b < 90) red++;
      }
      report[name] = { width:metadata.width, height:metadata.height, format:metadata.format, fileBytes:bytes.length, wireBytes:image.length, magenta, red };
      if (!["before", "referencePng"].includes(name)) {
        assert.equal(metadata.format, "webp", `${name}: PenEchoLLM prefers WebP`);
        assert.ok(metadata.width <= 512 && metadata.height <= 512);
        assert.ok(image.length <= 256 * 1024);
        assert.equal(magenta, 0, `${name}: unrelated objects and old marks are absent`);
      }
    }
    fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
    assert.ok(report.before.magenta > 10000);
    assert.equal(report.after.height, 512);
    assert.equal(report.scaled.height, 512, "a reduced canvas widget retains detail within the 512-pixel limit");
    assert.ok(report.annotated.red > 500, "related new marks are preserved");
    assert.equal(report.unannotated.red, 0, "old ink is excluded when no marks are being classified");
    const encoding = await page.evaluate(() => {
      const t = imageTest, canvas = t.offscreen(1024, 1024), q = canvas.getContext("2d");
      q.fillStyle = "white"; q.fillRect(0, 0, 1024, 1024); q.strokeStyle = "black"; q.lineWidth = 4;
      q.beginPath(); q.moveTo(80, 700); q.lineTo(650, 180); q.stroke();
      const line = t.smartSuggestEncodeImage(canvas), pixels = q.createImageData(1024, 1024);
      let seed = 27;
      for (let i = 0; i < pixels.data.length; i += 4) {
        for (let c = 0; c < 3; c++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels.data[i + c] = seed >>> 24; }
        pixels.data[i + 3] = 255;
      }
      q.putImageData(pixels, 0, 0);
      const noisyPngBytes = canvas.toDataURL("image/png").length, started = performance.now(), noisy = t.smartSuggestEncodeImage(canvas), encodeMs = performance.now() - started;
      const original = HTMLCanvasElement.prototype.toDataURL;
      let noWebp, noJpeg, failed;
      try {
        HTMLCanvasElement.prototype.toDataURL = function(type, quality) { return original.call(this, type === "image/webp" ? "image/png" : type, quality); };
        noWebp = t.smartSuggestEncodeImage(canvas);
        HTMLCanvasElement.prototype.toDataURL = function() { return original.call(this, "image/png"); };
        noJpeg = t.smartSuggestEncodeImage(canvas);
        HTMLCanvasElement.prototype.toDataURL = () => "data:,";
        failed = t.smartSuggestEncodeImage(canvas);
      } finally { HTMLCanvasElement.prototype.toDataURL = original; }
      // The lasso path shares the byte limiter without adding outside pixels.
      const selection = { phase:"active", originalBox:{ x:0, y:0, w:1024, h:1024 }, box:{ x:0, y:0, w:1024, h:1024 }, fragments:[{ x:0, y:0, w:1024, h:1024, image:canvas }] };
      const selected = t.smartSuggestCrop({ selection });
      // Existing context should be readable, while the newest stroke stays dark.
      const ink = t.smartSuggestCrop({ strokes:[], recentIds:new Set() }, { x:145, y:185, w:320, h:70 });
      return { line, noisy, noWebp, noJpeg, failed, selected, ink, noisyPngBytes, encodeMs };
    });
    assert.equal(encoding.failed, "", "failed encoding cannot become a text-only request");
    assert.ok(encoding.line.startsWith("data:image/webp;"), "small line art also prefers WebP");
    assert.ok(encoding.noisy.startsWith("data:image/webp;"));
    assert.ok(encoding.noWebp.startsWith("data:image/jpeg;"), "browsers without WebP can use JPEG");
    assert.ok(encoding.noJpeg.startsWith("data:image/png;"), "browsers without JPEG still obey the budget");
    for (const name of ["line", "noisy", "noWebp", "noJpeg", "selected", "ink"]) {
      const image = encoding[name];
      assert.ok(image && image.length <= 256 * 1024, `${name}: actual base64 budget`);
      const bytes = Buffer.from(image.split(",")[1], "base64"), m = await sharp(bytes).metadata();
      assert.ok(m.width <= 512 && m.height <= 512);
      report[name] = { width:m.width, height:m.height, fileBytes:bytes.length, wireBytes:image.length, format:m.format };
      fs.writeFileSync(path.join(directory, `${name}.${m.format}`), bytes);
    }
    const { data:inkPixels, info:inkInfo } = await sharp(Buffer.from(encoding.ink.split(",")[1], "base64")).removeAlpha().raw().toBuffer({ resolveWithObject:true });
    let readableRed = 0;
    for (let i = 0; i < inkPixels.length; i += inkInfo.channels) if (inkPixels[i] > 180 && inkPixels[i + 1] > 90 && inkPixels[i + 1] < 160 && inkPixels[i + 2] < 160) readableRed++;
    assert.ok(readableRed > 100, "context is rendered at the stronger contrast");
    // Replay the reported weather request using the actual model-input pixels.
    const weatherSource = fs.readFileSync(path.join(__dirname,"../test/fixtures/penecho-llm-weather-context.webp")),
      snapshot = `data:image/webp;base64,${weatherSource.toString("base64")}`,
      weather = await page.evaluate(snapshot => imageTest.replayCrop(snapshot,{x:170,y:175,w:680,h:165}),snapshot),
      resultCrop = await page.evaluate(snapshot => imageTest.replayCrop(snapshot,{x:170,y:175,w:680,h:165},true),snapshot);
    assert.deepEqual(weather.region,{x:162,y:167,w:696,h:181});
    for (const [name, crop] of [["weather",weather],["weather-result",resultCrop]]) {
      const bytes = Buffer.from(crop.image.split(",")[1],"base64"), metadata = await sharp(bytes).metadata(),
        {data,info} = await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
      let blue=0, dark=0;
      for(let i=0;i<data.length;i+=info.channels) {
        const [r,g,b]=data.subarray(i,i+3);
        if(b>r+25&&b>g+15)blue++;
        if(Math.max(r,g,b)<100)dark++;
      }
      assert.equal(metadata.width,512);assert.equal(metadata.height,133);
      assert.equal(blue,0,`${name}: the unrelated old formula is outside the model input`);
      assert.ok(dark>500,`${name}: the complete weather request and arrow remain readable`);
      fs.writeFileSync(path.join(directory,`${name}.webp`),bytes);
      report[name]={width:metadata.width,height:metadata.height,blue,dark,region:crop.region};
    }
    assert.deepEqual(errors, []);
    Object.assign(report, { directory, noisyPngWireBytes:encoding.noisyPngBytes, noisyEncodeMs:encoding.encodeMs, requests:requests.length, errors });
    fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
