"use strict";
// Run with the bundled Electron against tools/preview-live-share.mjs in Cloud.
// The preview imports the supplied share response into memory-only test data.
// PENECHO_SHARE_TEST_UAT=1 permits read-only acceptance at the fixed UAT origin.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const url = process.env.PENECHO_SHARE_TEST_URL;
const target = url ? new URL(url) : null, uat = process.env.PENECHO_SHARE_TEST_UAT === "1";
if (!target || (uat ? target.origin !== "https://internaltest.penecho.ai" || !/^\/canvas\/share\/[0-9a-f-]{36}$/i.test(target.pathname)
  : !["127.0.0.1", "localhost"].includes(target.hostname))) throw Error("An isolated localhost preview or explicitly selected UAT share is required");
const directory = path.resolve(__dirname, "../docs/verification/viewer-widget-scroll-20261004/maximized-only", uat ? "uat" : ".");
fs.mkdirSync(directory, { recursive:true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-viewer-scroll-"));
app.setPath("userData", temporary);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { origin:target.origin, checkedAt:new Date().toISOString(), checks:[], samples:[], errors:[] };
if (uat) {
  const gate = require("node:util").parseEnv(fs.readFileSync(path.resolve(__dirname, "../../penecho_cloud/.env.uat"), "utf8"));
  app.on("login", (event, _contents, details, authInfo, callback) => {
    event.preventDefault();
    if (!authInfo.isProxy && new URL(details.url).origin === target.origin) callback(gate.UAT_GATE_USER, gate.UAT_GATE_PASSWORD);
    else callback();
  });
}
let win;
async function until(check, label) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await pause(100); }
  throw Error(`Timed out: ${label}`);
}
app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({ show:false, width:1440, height:1000,
      webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    win.webContents.on("console-message", event => { if (event.level === "error") report.errors.push(event.message); });
    const js = code => win.webContents.executeJavaScript(code, true);
    await win.loadURL(url);
    await until(() => js("document.querySelector('.viewer-status')?.hidden === true"), "share import");
    const cardFrame = async () => {
      for (const frame of win.webContents.mainFrame.framesInSubtree.filter(frame => frame.url === "about:srcdoc")) {
        if (await frame.executeJavaScript("!!document.querySelector('.nc-body')")) return frame;
      }
      return null;
    };
    await until(async () => Boolean(await cardFrame()), "note content");
    const content = await cardFrame();
    const shellMetrics = () => js(`(() => { const frame = document.querySelector('#widgetLayer iframe'); return {
      rect:frame.getBoundingClientRect().toJSON(), inert:frame.inert, pointerEvents:getComputedStyle(frame).pointerEvents,
      viewer:window.PENECHO_CONFIG.runtime }; })()`);
    const scrollMetrics = (frame = content) => frame.executeJavaScript(`(() => { const body = document.querySelector('.nc-body'); return {
      top:body.scrollTop, max:body.scrollHeight - body.clientHeight, rect:body.getBoundingClientRect().toJSON(), width:innerWidth, height:innerHeight }; })()`);
    const pointInBody = async (frame = content) => {
      const shell = await shellMetrics(), inside = await scrollMetrics(frame);
      return { x:Math.round(shell.rect.x + (inside.rect.x + inside.rect.width / 2) / inside.width * shell.rect.width),
        y:Math.round(shell.rect.y + (inside.rect.y + inside.rect.height / 2) / inside.height * shell.rect.height) };
    };
    const wheel = async (point, deltaY, modifiers = []) => {
      win.webContents.sendInputEvent({ type:"mouseMove", ...point });
      win.webContents.sendInputEvent({ type:"mouseWheel", ...point, deltaX:0, deltaY, modifiers, canScroll:true });
      await pause(250);
    };
    const stable = async before => {
      const after = await shellMetrics();
      for (const key of ["x", "y", "width", "height"]) assert.ok(Math.abs(after.rect[key] - before.rect[key]) < 1, `${key} changed during reading: ${JSON.stringify({before:before.rect,after:after.rect})}`);
      assert.equal(after.inert, before.inert); assert.equal(after.pointerEvents, "none"); assert.equal(after.viewer, "viewer");
    };
    const initial = await shellMetrics(), inside = await scrollMetrics();
    assert.ok(inside.max > 0, "The supplied card must have internal overflow");
    fs.writeFileSync(path.join(directory, "before.png"), (await win.webContents.capturePage()).toPNG());
    const point = await pointInBody();
    await wheel(point, -150); assert.equal((await scrollMetrics()).top, 0, "Inline wheel does not scroll card content");
    assert.ok(Math.abs((await shellMetrics()).rect.y - initial.rect.y) > 20, "Inline wheel pans the Canvas");
    fs.writeFileSync(path.join(directory, "inline-panned.png"), (await win.webContents.capturePage()).toPNG());
    await wheel(await pointInBody(), 150); await stable(initial);
    report.checks.push("Wheel over an unmaximized shared card pans the Canvas without scrolling its content");
    const doubleClick = async point => {
      win.webContents.sendInputEvent({ type:"mouseMove", ...point });
      for (const clickCount of [1, 2]) {
        win.webContents.sendInputEvent({ type:"mouseDown", ...point, button:"left", clickCount });
        win.webContents.sendInputEvent({ type:"mouseUp", ...point, button:"left", clickCount });
        await pause(60);
      }
      await until(() => js("!!document.querySelector('.canvas-widget.widget-maximized:popover-open')"), "double-click presentation");
      await pause(150);
    };
    const closePresentation = async () => {
      const position = await js(`(() => { const button = document.querySelector('.widget-maximized .widget-presentation-toolbar button:last-child'), rect = button.getBoundingClientRect(); return { x:Math.round(rect.x + rect.width / 2), y:Math.round(rect.y + rect.height / 2) }; })()`);
      win.webContents.sendInputEvent({ type:"mouseDown", ...position, button:"left", clickCount:1 });
      win.webContents.sendInputEvent({ type:"mouseUp", ...position, button:"left", clickCount:1 });
      await until(() => js("!document.querySelector('.canvas-widget.widget-maximized')"), "close presentation");
      await pause(150);
    };
    await doubleClick(point);
    const maximized = await shellMetrics(), maximizedPoint = await pointInBody();
    await wheel(maximizedPoint, -150); assert.ok((await scrollMetrics()).top > 0, "Maximized shared Note scrolls down"); await stable(maximized);
    const maximizedDown = (await scrollMetrics()).top;
    await wheel(maximizedPoint, 80); assert.ok((await scrollMetrics()).top < maximizedDown, "Maximized shared Note scrolls up"); await stable(maximized);
    await content.executeJavaScript("document.querySelector('.nc-body').scrollTop = 1000000");
    await wheel(maximizedPoint, -150);
    const bottom = await scrollMetrics();
    assert.ok(Math.abs(bottom.top - bottom.max) < 1, "Maximized reading stays at its current bottom boundary"); await stable(maximized);
    await content.executeJavaScript("document.querySelector('.nc-body').scrollTop = 0");
    await wheel(maximizedPoint, 150); assert.equal((await scrollMetrics()).top, 0); await stable(maximized);
    await wheel(maximizedPoint, -150);
    fs.writeFileSync(path.join(directory, "maximized-scrolled.png"), (await win.webContents.capturePage()).toPNG());
    await closePresentation(); await stable(initial);
    const retainedDesktopTop = (await scrollMetrics()).top;
    await wheel(await pointInBody(), -100); assert.equal((await scrollMetrics()).top, retainedDesktopTop, "Closing presentation restores Canvas navigation without scrolling the card");
    assert.ok(Math.abs((await shellMetrics()).rect.y - initial.rect.y) > 20);
    await wheel(await pointInBody(), 100); await stable(initial);
    await doubleClick(await pointInBody());
    assert.ok(Math.abs((await scrollMetrics()).top - retainedDesktopTop) < 1, "Reopening preserves reading position within layout rounding");
    await wheel(await pointInBody(), 50); assert.ok((await scrollMetrics()).top < retainedDesktopTop, "Reopening restores internal scrolling");
    await closePresentation(); await stable(initial);
    report.checks.push("Double-click maximization enables wheel reading in both directions and owns both boundaries; closing disables internal scrolling and reopening restores it");
    await wheel({ x:20, y:Math.round(point.y) }, -100);
    assert.ok(Math.abs((await shellMetrics()).rect.y - initial.rect.y) > 20, "Blank Canvas still pans");
    await win.loadURL(url); await until(() => js("document.querySelector('.viewer-status')?.hidden === true"), "reload after pan");
    await until(async () => Boolean(await cardFrame()), "content after reload");
    // A fresh document invalidates the old content-frame handle.
    const fresh = await cardFrame();
    const freshMetrics = () => fresh.executeJavaScript("document.querySelector('.nc-body').scrollTop");
    const fitted = await shellMetrics(), freshPoint = { x:Math.round(fitted.rect.x + fitted.rect.width / 2), y:Math.round(fitted.rect.y + fitted.rect.height / 2) };
    await wheel(freshPoint, -80, ["control"]);
    const zoomed = await shellMetrics(); report.samples.push({ fitted:fitted.rect, zoomed:zoomed.rect });
    assert.ok(Math.abs(zoomed.rect.width - fitted.rect.width) > 1, "Ctrl wheel still zooms the Canvas");
    report.checks.push("Blank-space navigation and Ctrl wheel zoom remain available");
    win.setContentSize(390, 844); await pause(300);
    const mobile = await shellMetrics();
    const mobilePoint = { x:Math.round(mobile.rect.x + mobile.rect.width / 2), y:Math.round(mobile.rect.y + mobile.rect.height / 2) };
    await wheel(mobilePoint, -100); assert.equal(await freshMetrics(), 0);
    assert.ok(Math.abs((await shellMetrics()).rect.y - mobile.rect.y) > 20);
    await wheel(await pointInBody(fresh), 100); await stable(mobile);
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", { enabled:true });
    const touch = (type, points = []) => win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {
      type, touchPoints:points.map(([id, x, y]) => ({ id, x, y, radiusX:2, radiusY:2, force:1 })) });
    await touch("touchStart", [[1, mobilePoint.x, mobilePoint.y]]);
    for (const distance of [15, 35, 65, 100]) { await touch("touchMove", [[1, mobilePoint.x, mobilePoint.y - distance]]); await pause(50); }
    await touch("touchEnd"); await pause(250);
    assert.equal(await freshMetrics(), 0, "Inline single-finger input does not scroll card content");
    const afterTouch = await shellMetrics();
    assert.ok(Math.abs(afterTouch.rect.y - mobile.rect.y) > 50, "Inline single-finger input pans the Canvas");
    fs.writeFileSync(path.join(directory, "mobile-inline-panned.png"), (await win.webContents.capturePage()).toPNG());
    const pinchPoint = await pointInBody(fresh);
    await touch("touchStart", [[1, pinchPoint.x - 25, pinchPoint.y], [2, pinchPoint.x + 25, pinchPoint.y]]);
    await touch("touchMove", [[1, pinchPoint.x - 45, pinchPoint.y], [2, pinchPoint.x + 45, pinchPoint.y]]);
    await touch("touchEnd"); await pause(250);
    assert.ok((await shellMetrics()).rect.width > afterTouch.rect.width + 1, "Two-finger pinch still zooms");
    assert.equal(await freshMetrics(), 0, "Pinch does not scroll the card");
    report.checks.push("At 390px width, inline wheel and single-finger input navigate the Canvas; two-finger pinch zooms without scrolling card content");
    // Open the same maximized presentation at phone width.
    win.webContents.debugger.detach();
    win.setContentSize(390, 844); await pause(150);
    const current = await shellMetrics(), currentPoint = { x:Math.round(current.rect.x + current.rect.width / 2), y:Math.round(current.rect.y + current.rect.height / 2) };
    await doubleClick(currentPoint);
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", { enabled:true });
    // Coarse-pointer media queries give the presentation toolbar its phone height.
    await pause(150);
    const mobileMaximized = await shellMetrics(), mobileInside = await fresh.executeJavaScript("(() => { const rect = document.querySelector('.nc-body').getBoundingClientRect(); return { x:rect.x + rect.width / 2, y:rect.y + rect.height / 2, width:innerWidth, height:innerHeight }; })()"),
      mobileMaxPoint = { x:Math.round(mobileMaximized.rect.x + mobileInside.x / mobileInside.width * mobileMaximized.rect.width), y:Math.round(mobileMaximized.rect.y + mobileInside.y / mobileInside.height * mobileMaximized.rect.height) };
    await fresh.executeJavaScript("document.querySelector('.nc-body').scrollTop = 0");
    await wheel(mobileMaxPoint, -120); assert.ok(await freshMetrics() > 0); await stable(mobileMaximized);
    await fresh.executeJavaScript("document.querySelector('.nc-body').scrollTop = 0");
    await touch("touchStart", [[1, mobileMaxPoint.x, mobileMaxPoint.y]]);
    for (const distance of [15, 35, 65, 100]) { await touch("touchMove", [[1, mobileMaxPoint.x, mobileMaxPoint.y - distance]]); await pause(50); }
    await touch("touchEnd"); await pause(250);
    assert.ok(await freshMetrics() > 50, "Maximized shared Note supports single-finger scrolling"); await stable(mobileMaximized);
    fs.writeFileSync(path.join(directory, "mobile-maximized-scrolled.png"), (await win.webContents.capturePage()).toPNG());
    const retainedTop = await freshMetrics();
    await closePresentation(); await pause(150);
    assert.ok(Math.abs(await freshMetrics() - retainedTop) < 1, "Closing maximization preserves the body scroll position");
    const returnedMobile = await shellMetrics();
    await wheel(await pointInBody(fresh), -80);
    assert.ok(Math.abs(await freshMetrics() - retainedTop) < 1, "Inline wheel cannot change reading position after closing");
    assert.ok(Math.abs((await shellMetrics()).rect.y - returnedMobile.rect.y) > 20);
    report.checks.push("At 390px width, only the maximized shared Note supports wheel and single-finger reading; closing preserves its position and returns gestures to Canvas navigation");
    report.samples.push({ initial:initial.rect, maxScroll:inside.max, maximizedDown, mobile:mobile.rect, retainedTop });
    assert.deepEqual(report.errors, []); report.ok = true;
  } catch (error) {
    report.ok = false; report.error = error.stack;
    if (win) fs.writeFileSync(path.join(directory, "failure.png"), (await win.webContents.capturePage()).toPNG());
  } finally {
    win?.destroy(); fs.rmSync(temporary, { recursive:true, force:true });
    if (report.ok) fs.rmSync(path.join(directory, "failure.png"), { force:true });
    fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2)); app.exit(report.ok ? 0 : 1);
  }
});
