"use strict";

// The desktop app with its server in a process of its own, in a real Electron and an isolated profile.
//   <electron> scripts/verify-desktop-server-process.cjs <app root or app.asar> <output folder> [--hold] [--production]
// Proves: the window stays smooth while the server is stopped for 3 s; pictures, the agents' browser, the file picker and network
// access still work across the two processes; a killed server comes back on the same port; quitting ends the server before the app.
// --hold only starts the app and waits (to end it from outside and see that its server goes too).
// --production runs it as it ships, without the test settings; nothing is counted or sent.
const { app, BrowserWindow, Menu, dialog } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { monitorEventLoopDelay } = require("node:perf_hooks");
const archive = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]), hold = process.argv.includes("--hold"), production = process.argv.includes("--production");
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-desktop-server-"))), profile = path.join(temp, "profile"), home = path.join(temp, "home");
for (const dir of [profile, home, output]) fs.mkdirSync(dir, { recursive:true });
app.setPath("userData", profile);
// Frames are counted also when the window is behind another one.
for (const name of ["disable-backgrounding-occluded-windows", "disable-renderer-backgrounding"]) app.commandLine.appendSwitch(name);
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion,MacWebContentsOcclusion");
Object.assign(process.env, {
  ...(production ? { PENECHO_LINES_EXAMPLES:"0" } : { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1" }), PENECHO_DISABLE_AUTO_UPDATE:"1", HOME:home, USERPROFILE:home, PENECHO_USER_HOME:home,
  PENECHO_BROWSER_FILE:path.join(temp, "browser.json"), PENECHO_DRAW_FILE:path.join(temp, "draw.json"),
});
if (production) fs.writeFileSync(path.join(profile, "usage-stats.json"), JSON.stringify({ enabled:false, ratingsEnabled:false }));
fs.writeFileSync(path.join(profile, "config.env"), [
  "HOST=127.0.0.1", "PORT=0", "AI_PROVIDER=api", "AI_API_URL=http://127.0.0.1:1/v1",
  "AI_API_KEY=isolated-test-fixture", "AI_API_MODEL=fixture", "PENECHO_REQUEST_TRACE=false", "",
].join("\n"));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, tries = 200) {
  for (let n = 0; n < tries; n++) { const value = await check(); if (value) return value; await pause(100); }
  throw new Error(`Timed out: ${label}`);
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const serverRecord = () => { try { return fs.readdirSync(path.join(profile, "servers")).filter(n => n.endsWith(".json")).map(n => readJson(path.join(profile, "servers", n))).find(Boolean) || null; } catch { return null; } };
const report = { platform:process.platform, electron:process.versions.electron, source:archive };
const timeout = setTimeout(() => { console.error("Timed out"); app.exit(1); }, 150000);
require(path.join(archive, "desktop/main.js"));

async function frames(win, during) {
  const js = code => win.webContents.executeJavaScript(code);
  await js(`(() => {
    let box = document.getElementById("probe-scroll");
    if (!box) { box = document.createElement("div"); box.id = "probe-scroll"; box.style.cssText = "position:fixed;inset:0;overflow:auto;background:#fff;z-index:2147483647"; box.innerHTML = "<div style='height:200000px;background:repeating-linear-gradient(#fff 0 40px,#dde 40px 80px)'></div>"; document.body.append(box); }
    box.scrollTop = 0;
    window.__gaps = []; window.__moves = 0; window.__on = true; let last = performance.now(), top = 0;
    const tick = t => { if (!window.__on) return; window.__gaps.push(t - last); last = t; if (box.scrollTop !== top) { window.__moves++; top = box.scrollTop; } requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  })()`);
  const loop = monitorEventLoopDelay({ resolution:5 });
  loop.enable();
  let wheel = true;
  const wheeling = (async () => { while (wheel) { win.webContents.sendInputEvent({ type:"mouseWheel", x:400, y:400, deltaX:0, deltaY:-60, canScroll:true }); await pause(16); } })();
  await during();
  wheel = false;
  await wheeling;
  loop.disable();
  const seen = await js(`(() => { window.__on = false; const g = window.__gaps.slice(2); return { frames:g.length, moves:window.__moves, longest:Math.max(...g), over100:g.filter(x => x > 100).length, top:document.getElementById("probe-scroll").scrollTop }; })()`);
  return { ...seen, longest:Math.round(seen.longest), mainThreadLongestMs:Math.round(loop.max / 1e6) };
}

(async () => {
  await app.whenReady();
  const win = await waitFor(() => { const w = BrowserWindow.getAllWindows().find(w => /^http:/.test(w.webContents.getURL())); return w && !w.webContents.isLoading() && w.isVisible() ? w : null; }, "desktop window");
  const record = await waitFor(serverRecord, "server record");
  report.mainPid = process.pid; report.serverPid = record.pid; report.port = record.port;
  assert.notEqual(record.pid, process.pid, "the server runs in a process of its own");
  assert.ok(alive(record.pid));
  const unsaved = () => win.webContents.executeJavaScript(`window.addEventListener("beforeunload", event => { event.preventDefault(); event.returnValue = "unsaved"; }); true`, true);
  if (hold) { await unsaved(); fs.writeFileSync(path.join(output, "hold.json"), JSON.stringify(report)); clearTimeout(timeout); return; }
  const origin = new URL(win.webContents.getURL()).origin, js = code => win.webContents.executeJavaScript(code);
  assert.equal(Object.keys(require.cache).some(f => /src[\\/]server[\\/]main\.js$/.test(f)), false, "the server's code is not loaded into the window's process");

  // 1. A server that does nothing for 3 s.
  if (process.platform !== "win32") {
    await win.loadURL(`${origin}/projects.html`);
    win.webContents.setBackgroundThrottling(false);
    win.focus();
    report.quiet = await frames(win, () => pause(3000));
    console.log(JSON.stringify(report.quiet));
    report.stopped = await frames(win, async () => { process.kill(record.pid, "SIGSTOP"); try { await pause(3000); } finally { process.kill(record.pid, "SIGCONT"); } });
    assert.ok(report.stopped.mainThreadLongestMs < 100, `main thread: ${JSON.stringify(report.stopped)}`);
    assert.ok(report.stopped.moves > 30, `the page scrolled while the server was stopped: ${JSON.stringify(report.stopped)}`);
    await js(`document.getElementById("probe-scroll").remove()`);
  }

  // 2. The agents' browser, over the two processes.
  const browser = await waitFor(() => readJson(process.env.PENECHO_BROWSER_FILE), "browser.json");
  const ask = async (body, token = browser.token) => { const res = await fetch(`${origin}/api/browser`, { method:"POST", headers:{ "content-type":"application/json", "x-penecho-token":token }, body:JSON.stringify(body) }); return { httpStatus:res.status, ...await res.json() }; };
  const page = "<title>Two processes</title><body data-penecho-prototype><h1>Hello</h1><button onclick=\"document.querySelector('h1').textContent='Clicked';console.error('clicked it');setTimeout(()=>{throw new Error('late error')},50)\">Go</button><img src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='><img src='http://example.com/x.png'>";
  const seen = await ask({ html:page, steps:[{ op:"click", selector:"button" }, { op:"eval", expression:"1+41" }, { op:"eval", expression:"[...document.images].map(i=>i.naturalWidth).join()" }], settleMs:300, includeText:true, layoutCheck:true });
  assert.equal(seen.httpStatus, 200, JSON.stringify(seen).slice(0, 600));
  assert.equal(seen.engine, "electron-offscreen");
  assert.match(seen.text, /Clicked/);
  assert.equal(seen.steps[1].result, 42);
  assert.ok(seen.consoleErrors.some(line => /clicked it/.test(line)), JSON.stringify(seen.consoleErrors));
  assert.ok(seen.pageErrors.some(line => /late error/.test(line)), JSON.stringify(seen.pageErrors));
  assert.equal(seen.steps[2].result, "1,0", "the page's own picture is drawn, and the network stays closed to it");
  assert.ok(Array.isArray(seen.layoutChecks));
  assert.equal(fs.readFileSync(seen.png).subarray(1, 4).toString(), "PNG");
  fs.copyFileSync(seen.png, path.join(output, "browser.png"));
  const kept = await ask({ url:`${origin}/projects.html`, keepSession:true, screenshot:false });
  assert.equal(kept.httpStatus, 200, JSON.stringify(kept).slice(0, 600));
  assert.equal(kept.status, 200, "the page's HTTP status comes over");
  const later = await ask({ sessionId:kept.sessionId, steps:[{ op:"eval", expression:"document.title" }], screenshot:{ fullPage:true } });
  assert.equal(later.httpStatus, 200, JSON.stringify(later).slice(0, 600));
  assert.equal((await ask({ action:"close", sessionId:kept.sessionId })).httpStatus, 200);
  const both = await Promise.all([ask({ html:"<p>one</p>", includeText:true }), ask({ html:"<p>two</p>", includeText:true }), ask({ html:"<p>three</p>", includeText:true })]);
  assert.deepEqual(both.map(r => r.text.trim()), ["one", "two", "three"]);
  const slow = await ask({ html:"<p>never</p>", waitFor:"#missing", timeoutMs:1500, screenshot:false });
  assert.equal(slow.httpStatus, 504, JSON.stringify(slow).slice(0, 300));
  const refused = await ask({ url:"http://169.254.169.254/latest/", screenshot:false });
  assert.notEqual(refused.httpStatus, 200, "the server's rules still refuse a private address");
  report.browser = { engine:seen.engine, pooled:(await (await fetch(`${origin}/api/browser`, { headers:{ "x-penecho-token":browser.token } })).json()).pooled };

  // 3. A page picture (a drawing with no page open).
  const draw = await waitFor(() => readJson(process.env.PENECHO_DRAW_FILE), "draw.json");
  const form = new FormData(), folder = path.join(temp, "work");
  fs.mkdirSync(folder);
  form.append("folder", folder); form.append("title", "Two processes");
  form.append("file", new Blob(["<!doctype html><title>Picture</title><style>body{margin:0;background:#2563eb;color:#fff;font:40px sans-serif}</style><h1>Two processes</h1>"]), "picture.explorer.html");
  const loopPicture = monitorEventLoopDelay({ resolution:5 });
  loopPicture.enable();
  const started = Date.now(), drawnRes = await fetch(`${origin}/api/draw`, { method:"POST", headers:{ "x-penecho-token":draw.token }, body:form }), drawn = await drawnRes.json();
  loopPicture.disable();
  assert.equal(drawnRes.status, 200, JSON.stringify(drawn));
  assert.equal(fs.readFileSync(drawn.png).subarray(1, 4).toString(), "PNG");
  fs.copyFileSync(drawn.png, path.join(output, "picture.png"));
  report.picture = { bytes:fs.statSync(drawn.png).size, ms:Date.now() - started, mainThreadLongestMs:Math.round(loopPicture.max / 1e6) };

  // 4. The file picker: a file chosen in the window's dialog is taken in by the server, once.
  const chosen = path.join(home, "chosen.txt");
  fs.writeFileSync(chosen, "chosen");
  const openDialog = dialog.showOpenDialog;
  dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[chosen] });
  await win.loadURL(`${origin}/index.html`);
  const picked = await js(`window.penechoDesktop.pickProjectFile()`);
  dialog.showOpenDialog = openDialog;
  assert.equal(picked.path, chosen);
  const take = () => js(`fetch("/api/canvas-agent/projects", { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ kind:"file", path:${JSON.stringify(picked.path)}, pickerToken:${JSON.stringify(picked.pickerToken)} }) }).then(async r => ({ status:r.status, ...(await r.json()) }))`);
  const taken = await take();
  assert.equal(taken.status, 201, JSON.stringify(taken));
  assert.equal((await take()).status, 403, "a grant works once");
  report.picker = true;

  // 5. Network access off: the app's menu says so.
  const devices = () => Menu.getApplicationMenu().getMenuItemById("local-network-menu")?.submenu.items.map(item => item.label) || [];
  const off = await js(`fetch("/api/local-access/network", { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ on:false }) }).then(r => r.status)`);
  assert.equal(off, 200);
  await waitFor(() => devices().some(label => /Off for other devices/.test(label)), "menu follows network access");
  await js(`fetch("/api/local-access/network", { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ on:true }) }).then(r => r.status)`);
  await waitFor(() => !devices().some(label => /Off for other devices/.test(label)), "menu follows network access back");
  report.networkAccess = true;

  // 6. The server is killed: it comes back on the same port, and the page is still let in.
  const cookie = async () => (await win.webContents.session.cookies.get({ url:origin })).find(c => c.name.startsWith("penecho_ai_session"))?.value;
  const before = await cookie(), killedAt = Date.now();
  process.kill(record.pid, "SIGKILL");
  const again = await waitFor(() => { const r = serverRecord(); return r && r.pid !== record.pid && alive(r.pid) ? r : null; }, "server started again");
  assert.equal(again.port, record.port, "on the same port");
  await waitFor(() => fetch(`${origin}/projects.html`).then(r => r.ok, () => false), "serves again");
  report.restart = { ms:Date.now() - killedAt, pid:again.pid };
  assert.ok(before, "a pass before");
  await waitFor(async () => { const now = await cookie(); return now && now !== before; }, "a new pass for the page");
  const revived = await waitFor(async () => { const r = await ask({ html:"<p>again</p>", includeText:true }, readJson(process.env.PENECHO_BROWSER_FILE)?.token).catch(() => null); return r?.httpStatus === 200 ? r : null; }, "browser works after the restart");
  assert.match(revived.text, /again/);
  assert.equal(win.isDestroyed(), false);

  // A page asked for while there is no server is loaded again once there is one.
  process.kill(again.pid, "SIGKILL");
  await win.loadURL(`${origin}/projects.html?asked=without-a-server`).catch(() => {}); // Refused at once on a Mac; Windows keeps trying for two seconds.
  await waitFor(() => win.webContents.getURL().includes("without-a-server") && js(`document.readyState === "complete" && Boolean(document.querySelector("script[src]"))`).catch(() => false), "the page is loaded again");
  let last = await waitFor(() => { const r = serverRecord(); return r && r.pid !== again.pid && alive(r.pid) ? r : null; }, "server started again");
  // Stopped from outside, PenEcho asks about unsaved changes; "Stay" keeps the window and brings the server back for saving them.
  if (process.platform !== "win32") {
    await unsaved();
    const showMessageBox = dialog.showMessageBox;
    let asked = 0;
    dialog.showMessageBox = async () => { asked++; return { response:1 }; };
    process.kill(last.pid, "SIGTERM");
    const revived = await waitFor(() => { const r = serverRecord(); return r && r.pid !== last.pid && alive(r.pid) ? r : null; }, "server back after Stay");
    await waitFor(() => fetch(`${origin}/projects.html`).then(r => r.ok, () => false), "serves after Stay");
    dialog.showMessageBox = showMessageBox;
    assert.equal(asked, 1);
    assert.equal(win.isDestroyed(), false);
    report.stay = { pid:revived.pid };
    last = revived;
  }

  // 7. Quitting: the server has ended before the app has.
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  const quitAt = Date.now();
  app.once("quit", () => {
    report.quit = { ms:Date.now() - quitAt, serverEndedFirst:!alive(last.pid) };
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.quit.serverEndedFirst) process.exitCode = 1;
    clearTimeout(timeout);
    try { fs.rmSync(temp, { recursive:true, force:true }); } catch { /* Windows keeps the profile's files open until the app has ended. */ }
  });
  win.destroy();
  app.quit();
})().catch(error => { console.error(error.stack); fs.writeFileSync(path.join(output, "report.json"), JSON.stringify({ ...report, error:error.message }, null, 2)); clearTimeout(timeout); app.exit(1); });
