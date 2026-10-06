"use strict";
// Verify real release onboarding with isolated profiles and no model requests.
// Run with the repository's Electron toolchain; all test services are temporary.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-release-onboarding-"));
const outputArgument = process.argv.find(value => value.startsWith("--output="));
const output = outputArgument ? path.resolve(outputArgument.slice(9)) : path.join(root, "docs/verification/release-1.4.0-20261004");
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
app.on("window-all-closed", () => {});
Object.assign(process.env, {
  NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOST:"127.0.0.1", PORT:"0",
  PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"),
  AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test",
  PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false",
});
const oldIds = [
  "core-effort-v1", "favorites-add-v1", "hand-v1", "core-text-v1", "core-lasso-v2", "core-image-v1",
  "core-fullscreen-v1", "cloud-share-canvas-v1", "cloud-workspace-v1", "mcp-canvas-v1",
  "canvas-agent-launcher-v2", "canvas-agent-panel-v2", "core-manual-ai-v1", "core-status-v1", "core-navigation-v1",
];
const updatedIds = ["notes-cards-v1", "smart-assist-v1", "core-lasso-v3"];
const report = { version:JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version, checks:[], layouts:[], errors:[] };
let server, win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, name) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Timed out: ${name}`)), 15000); })]); }
  finally { clearTimeout(timer); }
}
async function until(predicate, name) {
  for (let index = 0; index < 100; index++) {
    if (await predicate()) return;
    await pause(100);
  }
  throw Error(`Timed out: ${name}`);
}
async function capture(name, selector) {
  await pause(350);
  const layout = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)}), rect = element.getBoundingClientRect();
    return { x:rect.x, y:rect.y, w:rect.width, h:rect.height, viewport:{ w:innerWidth, h:innerHeight },
      overflow:element.scrollWidth > element.clientWidth + 1,
      bodyOverflow:document.documentElement.scrollWidth > innerWidth + 1,
      text:element.innerText };
  })()`);
  assert.ok(layout.w > 0 && layout.h > 0, `${name}: visible content`);
  assert.ok(layout.x >= -1 && layout.y >= -1 && layout.x + layout.w <= layout.viewport.w + 1 && layout.y + layout.h <= layout.viewport.h + 1, `${name}: dialog stays in viewport`);
  assert.equal(layout.overflow, false, `${name}: no horizontal dialog overflow`);
  assert.equal(layout.bodyOverflow, false, `${name}: no horizontal page overflow`);
  report.layouts.push({ name, ...layout });
  fs.writeFileSync(path.join(output, `${name}.png`), (await bounded(win.webContents.capturePage(), `${name}: screenshot`)).toPNG());
}
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    for (const [name, language, width, height, theme, zoom] of [
      ["en-wide", "en", 1440, 900, "studio", 1],
      ["zh-wide", "zh", 1440, 900, "studio", 1],
      ["en-narrow", "en", 390, 760, "studio", 1],
      ["zh-narrow", "zh", 390, 760, "studio", 1],
      ["en-zoom-200", "en", 1440, 1000, "studio", 2],
    ]) {
      console.log(`Opening ${name}`);
      win = new BrowserWindow({ show:false, width, height, webPreferences:{ partition:`release-${name}`, contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
      win.webContents.setZoomFactor(zoom);
      win.webContents.on("console-message", event => { if (event.level === "error") report.errors.push({ name, message:event.message }); });
      win.webContents.session.webRequest.onBeforeRequest({ urls:["http://*/*", "https://*/*"] }, (details, callback) => {
        callback({ cancel:new URL(details.url).hostname !== "127.0.0.1" });
      });
      console.log(`Initializing ${name} browser`);
      await bounded(win.loadURL("about:blank"), `${name}: blank browser`);
      win.webContents.debugger.attach("1.3");
      await bounded(win.webContents.debugger.sendCommand("Page.enable"), `${name}: enable Page`);
      await bounded(win.webContents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source:`
        if (window === window.top && location.origin === 'http://127.0.0.1:${server.address().port}' && !localStorage.getItem('release-fixture-initialized')) {
          localStorage.setItem('penecho-tour-progress', ${JSON.stringify(JSON.stringify({ schema:1, seen:oldIds }))});
          localStorage.setItem('penecho-changelog-seen', '1.3.0');
          localStorage.setItem('penecho-theme', ${JSON.stringify(theme)});
          localStorage.setItem('penecho-language', ${JSON.stringify(language)});
          localStorage.setItem('penecho-canvas-agent-auto-open', 'false');
          localStorage.setItem('release-fixture-initialized', 'true');
        }
      ` }), `${name}: profile initialization`);
      const js = source => bounded(win.webContents.executeJavaScript(source), `${name}: renderer evaluation`);
      console.log(`Loading ${name} Canvas`);
      await bounded(win.loadURL(`http://127.0.0.1:${server.address().port}`), `${name}: Canvas load`);
      console.log(`Checking ${name} onboarding`);
      await until(() => js("!document.querySelector('#tourLayer').hidden"), `${name}: updated Tour starts automatically`);
      console.log(`${name}: updated Tour is visible`);
      for (const id of updatedIds) {
        await until(() => js(`document.querySelector('#tourCard').dataset.stepId === ${JSON.stringify(id)}`), `${name}: ${id}`);
        await capture(`${name}-${id}`, "#tourCard");
        await js("document.querySelector('#tourNext').click()");
      }
      await until(() => js("!document.querySelector('#changelogLayer').hidden"), `${name}: release notes after Tour`);
      const release = await js(`({ version:document.querySelector('.changelog-version').textContent,
        items:[...document.querySelectorAll('.changelog-release li')].map(element => element.textContent),
        focus:document.activeElement.id, inert:document.querySelector('main').inert })`);
      assert.equal(release.version, "1.4.0");
      assert.equal(release.items.length, 5);
      assert.ok(release.items.every(value => value.length > 20 && !value.startsWith("changelog")));
      assert.match(release.items[2], language === "zh" ? /笔记与知识卡片/ : /notes and knowledge cards/);
      assert.equal(release.inert, true);
      await capture(`${name}-changelog`, "#changelogDialog");
      await js("document.querySelector('#changelogClose').click()");
      await pause(150);
      const completed = await js(`({ progress:JSON.parse(localStorage.getItem('penecho-tour-progress')), version:localStorage.getItem('penecho-changelog-seen'), inert:document.querySelector('main').inert })`);
      assert.equal(completed.version, "1.4.0");
      assert.equal(completed.inert, false);
      assert.ok([...oldIds, ...updatedIds].every(id => completed.progress.seen.includes(id)));
      await win.webContents.reload();
      await until(() => js("document.querySelector('#settingsBtn') !== null"), `${name}: reload`);
      await pause(700);
      assert.equal(await js("document.querySelector('#tourLayer').hidden && document.querySelector('#changelogLayer').hidden"), true, `${name}: completed onboarding stays closed after reload`);
      if (name === "en-wide") {
        await js("localStorage.setItem('penecho-changelog-seen', '1.3.0')");
        await win.webContents.reload();
        await until(() => js("!document.querySelector('#changelogLayer').hidden && document.querySelector('#tourLayer').hidden"), "completed Tour still shows a newer release note");
        await js("document.querySelector('#changelogClose').click()");
      }
      report.checks.push({ name, updates:updatedIds, changelog:release.version, oldProgressPreserved:true, noRepeatAfterReload:true });
      win.destroy(); win = null;
    }
    assert.deepEqual(report.errors, []);
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ version:report.version, checks:report.checks, layouts:report.layouts.length, errors:report.errors }, null, 2));
  } catch (error) {
    if (win && !win.isDestroyed()) {
      try {
        report.runtime = await bounded(win.webContents.executeJavaScript("({step:document.querySelector('#tourCard')?.dataset.stepId,stored:localStorage.getItem('penecho-tour-progress'),theme:document.body.dataset.theme,more:document.querySelector('#canvasMoreBtn')?.getBoundingClientRect().toJSON(),history:document.querySelector('#historyBtn')?.getBoundingClientRect().toJSON()})"), "failure diagnostics");
        fs.writeFileSync(path.join(output, "failure.png"), (await bounded(win.webContents.capturePage(), "failure screenshot")).toPNG());
      } catch {}
    }
    report.failure = error.stack;
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    console.error(error.stack); process.exitCode = 1;
  } finally {
    win?.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive:true, force:true });
    app.exit(process.exitCode || 0);
  }
});
