"use strict";
// Exercise real text/image/clipboard entry points in an isolated Canvas.
// Intercept inference only: verify submitted pixels and automatic launch calls.
// Run with tools/electron/node_modules/.bin/electron.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict"), { Readable } = require("node:stream"), sharp = require("sharp");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-manual-dirty-"));
const cloud = process.argv.includes("--cloud"), clientFile = cloud ? path.resolve(root, "../penecho_cloud/public/canvas/app.js") : path.join(root, "public/app.js");
const output = process.argv.find(value => value.startsWith("--output=")), directory = output ? path.resolve(output.slice(9)) : temporary;
fs.mkdirSync(directory, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) return Readable.from([fs.readFileSync(clientFile, "utf8").replace(/\}\)\(\);\s*$/, `
    if (${cloud}) window.PENECHO_CONFIG.runtime = 'cloud';
    window.manualTest = { state, smartSuggest, canvasDocumentsReady, cancelSmartSuggest, clearDirtyContributionTracking, createTextEditor, addClipboardText, confirmTextEditor, addImageFile, acceptImageEdit, importClipboardPayload, render };
    window.manualRanks = []; window.manualAuto = [];
    requestAI = async action => { manualAuto.push({ action, at:performance.now(), dirty:{...state.dirty}, images:[...state.dirtyImageIds], texts:[...state.dirtyTextBoxIds] }); };
    const originalFetch = window.fetch;
    window.fetch = (url, options) => {
      if (/\\/suggest(?:\\/status)?$/.test(String(url))) {
        if (String(url).endsWith('/status')) return Promise.resolve(new Response(JSON.stringify({ configured:true }), { status:200, headers:{'Content-Type':'application/json'} }));
        manualRanks.push({ at:performance.now(), ...JSON.parse(options.body) });
        return Promise.resolve(new Response(JSON.stringify({ok:true,model:'PenEchoLLM',answers:{kind:{type:'choice',choice:'notes',probabilities:{notes:1}},action:{type:'choice',choice:'explain',probabilities:{explain:1}},finished:{type:'noul',noul:1}}}), {status:200,headers:{'Content-Type':'application/json'}}));
      }
      return originalFetch(url, options);
    };
  })();`)]);
  return readStream.call(this, file, ...args);
};
let server, win;
const report = { runtime:cloud ? "cloud" : "local", clientFile, checks:[], errors:[] };
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1200, height:900, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const cases = await win.webContents.executeJavaScript(`(async () => {
      const t = manualTest, s = t.state, a = t.smartSuggest, cases = [];
      await t.canvasDocumentsReady();
      document.querySelector('#tourSkip')?.click(); document.querySelector('#changelogClose')?.click();
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const until = async predicate => { const deadline = performance.now() + 4000; while (!predicate()) { if (performance.now() > deadline) throw Error('Manual input trigger timed out'); await wait(20); } };
      const reset = auto => {
        t.cancelSmartSuggest('test-reset'); clearTimeout(s.timer); s.timer = 0;
        t.clearDirtyContributionTracking(); s.dirty = null; s.autoEligible = false;
        s.images = []; s.textBoxes = []; s.history = []; a.strokes = []; a.lastKey = ''; a.jev = null;
        a.dismissedObjectKey = ''; a.enabled = true; a.available = true;
        s.auto = auto; s.autoDelayMs = 1200; s.mode = 'pen'; s.scale = 1; s.panX = 0; s.panY = 0;
        t.render();
      };
      const finish = async (name, rankBefore, autoBefore, settledAt, auto, kind) => {
        await until(() => manualRanks.length > rankBefore && a.bar?.element.dataset.rank === 'ranked');
        if (auto) await until(() => manualAuto.length > autoBefore); else await wait(1400);
        cases.push({ name, kind, auto, rankCount:manualRanks.length-rankBefore, autoCount:manualAuto.length-autoBefore,
          request:manualRanks.at(-1), launch:manualAuto.length > autoBefore ? manualAuto.at(-1) : null,
          settledAt, rank:a.bar?.element.dataset.rank, strokes:a.strokes.length, dirty:{...s.dirty},
          dirtyImages:[...s.dirtyImageIds], dirtyTexts:[...s.dirtyTextBoxIds] });
      };
      for (const [entry, auto] of [['text-tool', true], ['confirmed-text-auto-true', true], ['confirmed-text-auto-false', false], ['text-focus-loss', true]]) {
        reset(auto);
        const ranks = manualRanks.length, launches = manualAuto.length;
        if (entry === 'text-tool') {
          s.mode = 'text'; t.createTextEditor({x:100,y:100}, {text:'Explain how rain forms.'});
        } else t.addClipboardText('Explain how rain forms.');
        await wait(800);
        if (manualRanks.length !== ranks || manualAuto.length !== launches) throw Error('Unconfirmed text triggered AI');
        await t.confirmTextEditor([...s.textEditors.values()][0], entry === 'text-focus-loss' ? {focusLoss:true} : null);
        const settledAt = performance.now();
        await finish(entry, ranks, launches, settledAt, auto, 'text');
      }
      const bitmap = document.createElement('canvas'); bitmap.width = 240; bitmap.height = 160;
      const context = bitmap.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0,0,240,160);
      context.fillStyle = '#000000'; context.fillRect(30,30,180,100);
      const blob = await new Promise(resolve => bitmap.toBlob(resolve,'image/png'));
      for (const entry of ['image-picker', 'system-paste', 'clipboard-button']) {
        reset(true);
        const ranks = manualRanks.length, launches = manualAuto.length, file = new File([blob], 'manual.png', {type:'image/png'});
        if (entry === 'image-picker') await t.addImageFile(file);
        else if (entry === 'clipboard-button') await t.importClipboardPayload({image:file});
        else {
          const data = new DataTransfer(); data.items.add(file);
          document.dispatchEvent(new ClipboardEvent('paste', {bubbles:true,cancelable:true,clipboardData:data}));
          await until(() => s.images.length === 1 && !s.imageImporting);
        }
        await wait(800);
        if (manualRanks.length !== ranks || manualAuto.length !== launches) throw Error('Unsettled image triggered AI');
        if (!s.imageEdit) throw Error('Image placement did not open');
        t.acceptImageEdit(); const settledAt = performance.now();
        await finish(entry, ranks, launches, settledAt, true, 'image');
      }
      t.cancelSmartSuggest('test-complete'); clearTimeout(s.timer);
      return cases;
    })()`);
    for (const result of cases) {
      assert.equal(result.rankCount, 1, result.name);
      assert.equal(result.autoCount, result.auto ? 1 : 0, result.name);
      assert.equal(result.rank, "ranked", result.name);
      assert.equal(result.strokes, 0, result.name);
      assert.equal(result.kind === "image" ? result.dirtyImages.length : result.dirtyTexts.length, 1, result.name);
      assert.equal(result.request.mode, "ink", result.name);
      if (result.auto) {
        assert.equal(result.launch.action, "auto", result.name);
        assert.ok(result.launch.at - result.settledAt >= 1100, result.name + ": Auto AI respects its configured delay");
      }
      const encoded = result.request.image.split(",")[1], bytes = Buffer.from(encoded, "base64"), decoded = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject:true });
      let dark = 0;
      for (let index = 0; index < decoded.data.length; index += decoded.info.channels) if (decoded.data[index] < 50 && decoded.data[index+1] < 50 && decoded.data[index+2] < 50) dark++;
      assert.ok(dark > 100, result.name + ": pending input must reach the model at full contrast");
      const extension = result.request.image.startsWith("data:image/webp") ? "webp" : result.request.image.startsWith("data:image/png") ? "png" : "jpg";
      fs.writeFileSync(path.join(directory, `${result.name}.${extension}`), bytes);
      report.checks.push({ name:result.name, rankCount:result.rankCount, autoCount:result.autoCount, darkPixels:dark, rankDelayMs:Math.round(result.request.at-result.settledAt), autoDelayMs:result.launch ? Math.round(result.launch.at-result.settledAt) : null });
    }
    assert.deepEqual(report.errors, []);
    fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.failure = error.stack; fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
    console.error(error.stack); process.exitCode = 1;
  } finally {
    win?.destroy(); if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive:true, force:true }); app.exit(process.exitCode || 0);
  }
});
