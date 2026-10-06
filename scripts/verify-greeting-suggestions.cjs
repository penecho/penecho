"use strict";
// Replay real classifier replies through the built Canvas in an isolated profile.
// Inference is intercepted; the UI test makes no external model requests.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-greeting-ui-"));
const option = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const cloud = process.argv.includes("--cloud"), directory = path.resolve(option("output", "docs/verification/greeting-suggestions-20261004"));
const input = JSON.parse(fs.readFileSync(path.resolve(option("results", "../penecho_cloud/docs/verification/greeting-intent-20261004/implemented-final-results.json")), "utf8"));
const ids = ["hello-exact", "nihao-exact", "thanks", "thanks-chinese", "acknowledgement", "greeting-as-practice"];
const rows = input.rows.filter(row => row.valid && ids.includes(row.id));
assert.equal(rows.length, ids.length * 2);
const clientFile = cloud ? path.resolve(root, "../penecho_cloud/public/canvas/app.js") : path.join(root, "public/app.js");
fs.mkdirSync(directory, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  const name = path.resolve(String(file));
  if (cloud && name === path.join(root, "public/smart-suggest.js")) return Readable.from([fs.readFileSync(path.resolve(root, "../penecho_cloud/public/canvas/smart-suggest.js"))]);
  if (name === path.join(root, "public/app.js")) return Readable.from([fs.readFileSync(clientFile, "utf8").replace(/\}\)\(\);\s*$/, `
    if (${cloud}) window.PENECHO_CONFIG.runtime = 'cloud';
    window.greetingTest = { state, smartSuggest, canvasDocumentsReady, cancelSmartSuggest, clearDirtyContributionTracking, addClipboardText, confirmTextEditor, closeChangelog, render };
    window.greetingRows = ${JSON.stringify(rows)};
    window.greetingReply = null;
    const originalFetch = window.fetch;
    window.fetch = (url, options) => {
      if (/\\/suggest(?:\\/status)?$/.test(String(url))) return Promise.resolve(new Response(JSON.stringify(String(url).endsWith('/status') ? {configured:true} : {ok:true,model:'PenEchoLLM',answers:window.greetingReply}), {status:200,headers:{'Content-Type':'application/json'}}));
      return originalFetch(url, options);
    };
  })();`)]);
  return readStream.call(this, file, ...args);
};
let server, win;
const report = { runtime:cloud ? "cloud-mirror" : "local", clientFile, realReplies:true, modelRequests:0, checks:[], errors:[] };
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1200, height:900, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await win.webContents.executeJavaScript(`(async () => {
      await greetingTest.canvasDocumentsReady();
      document.querySelector('#tourSkip')?.click(); document.querySelector('#changelogClose')?.click();
      window.showGreetingCase = async row => {
        const t = greetingTest, s = t.state, a = t.smartSuggest;
        t.cancelSmartSuggest('test-reset'); clearTimeout(s.timer); s.timer = 0;
        t.clearDirtyContributionTracking(); s.dirty = null; s.autoEligible = false; s.auto = false;
        s.images = []; s.textBoxes = []; s.history = []; a.strokes = []; a.lastKey = ''; a.jev = null;
        a.dismissedObjectKey = ''; a.enabled = true; a.available = true;
        s.mode = 'pen'; s.scale = 1; s.panX = 0; s.panY = 0; greetingReply = row.answers;
        t.render();
        t.addClipboardText(row.id === 'greeting-as-practice' ? 'Handwriting practice: hello' : row.id.startsWith('nihao') ? '你好' : row.id === 'thanks-chinese' ? '谢谢！' : row.id === 'thanks' ? 'Thank you!' : row.id === 'acknowledgement' ? 'OK' : 'hello');
        await t.confirmTextEditor([...s.textEditors.values()][0]);
        const deadline = performance.now() + 5000;
        while (a.bar?.element.dataset.rank !== 'ranked') {
          if (performance.now() > deadline) throw Error('Ranking did not settle');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        document.querySelector('#tourSkip')?.click(); t.closeChangelog();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (document.querySelector('.changelog-layer:not([hidden]), .tour-layer:not([hidden])')) throw Error('Onboarding obscures the Canvas');
        if (!a.bar.element.getBoundingClientRect().width) throw Error('Suggestion bar is not visible');
        const main = [...a.bar.element.querySelectorAll(':scope > [data-suggestion]')].map(button => button.dataset.suggestion);
        a.bar.element.querySelector('.assist-more > button')?.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        const more = [...a.bar.element.querySelectorAll('.assist-more [data-suggestion]')].map(button => button.dataset.suggestion);
        return {provider:row.provider,id:row.id,action:row.answers.action.choice,applicable:row.answers.check_applicable.noul,main,more};
      };
    })()`);
    for (let index = 0; index < rows.length; index++) {
      const result = await win.webContents.executeJavaScript(`showGreetingCase(greetingRows[${index}])`);
      assert.ok(result.main.includes("answer"), result.id);
      if (result.id === "greeting-as-practice") assert.ok(result.main.includes("check_step"), result.id);
      else { assert.equal(result.main[0], "answer", result.id); assert.ok(!result.main.includes("check_step"), result.id); }
      if (result.id === "hello-exact" || result.id === "greeting-as-practice" || result.id === "thanks") fs.writeFileSync(path.join(directory, `${report.runtime}-${result.provider}-${result.id}.png`), (await win.webContents.capturePage()).toPNG());
      report.checks.push(result);
    }
    const rejected = structuredClone(rows.find(row => row.id === "hello-exact"));
    rejected.answers.action = {type:"choice",choice:"check_step",confidence:.8,probabilities:{check_step:.65,answer:.2,typeset:.1,none:.05}};
    rejected.answers.check_applicable = {type:"noul",noul:.1};
    const result = await win.webContents.executeJavaScript(`showGreetingCase(${JSON.stringify(rejected)})`);
    assert.ok(!result.main.includes("check_step")); assert.ok(result.more.includes("check_step"));
    report.checks.push({...result,forcedWrongWinner:true});
    fs.writeFileSync(path.join(directory, `${report.runtime}-report.json`), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({runtime:report.runtime,passed:report.checks.length,errors:report.errors}));
  } catch (error) {
    report.failure = error.stack; fs.writeFileSync(path.join(directory, `${report.runtime}-report.json`), JSON.stringify(report, null, 2) + "\n");
    console.error(error.stack); process.exitCode = 1;
  } finally {
    win?.destroy(); if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive:true, force:true }); app.exit(process.exitCode || 0);
  }
});
