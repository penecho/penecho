"use strict";
// Render canonical local and mirrored Cloud clients with disposable data.
// Run with Electron; add --cloud to verify the Cloud mirror.
const { app, BrowserWindow, nativeTheme } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict"), { Readable } = require("node:stream");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, ".."), cloudRoot = path.resolve(root, "../penecho_cloud");
const cloud = process.argv.includes("--cloud"), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-library-nav-"));
const output = path.join(root, "docs/verification/library-navigation-20261004", cloud ? "cloud" : "local");
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, {
  NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"),
  PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0",
  AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test",
  PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false",
});
const expose = source => source.replace(/\}\)\(\);\s*$/, `
  window.libraryNavTest = { state, canvasDocumentsReady, openHistoryPanel, closeCanvasAgent,
    setLanguage(value) { state.language=value; applyLanguage(); },
    dismiss() { markChangelogSeen(); markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);
      closeFeatureTour({restore:false,scroll:false,changelog:false,retry:false}); closeChangelog(); },
    read() { return {busy:snapshotListInProgress,rendering:!!historyListRenderFrame,
      serverProject:selectedServerProjectId,cloudProject:selectedCloudProjectId}; }
  };
})();`);
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (!cloud && path.resolve(String(file)) === path.join(root, "public/app.js"))
    return Readable.from([expose(fs.readFileSync(file, "utf8"))]);
  return readStream.call(this, file, ...args);
};
let server, win;
const report = { runtime:cloud ? "cloud" : "local", checks:[], errors:[] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i=0; i<150; i++) { if (await check()) return; await pause(50); }
  throw Error("Timed out: " + label);
}
app.whenReady().then(async () => {
  try {
    let origin, url, cookies=[];
    if (cloud) {
      const { buildApp } = await import(pathToFileURL(path.join(cloudRoot, "src/app.mjs")).href);
      const reservation = require("node:net").createServer();
      await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
      const port = reservation.address().port;
      await new Promise(resolve => reservation.close(resolve));
      origin = `http://127.0.0.1:${port}`;
      server = await buildApp({logger:false, env:{NODE_ENV:"test", AUTH_MODE:"development", DATA_MODE:"memory",
        SESSION_MODE:"memory", STORAGE_MODE:"memory", CLOUD_NATIVE_CANVAS_ENABLED:"true", APP_ORIGIN:origin}});
      server.get("/canvas/app.js", {config:{rateLimit:false},compress:false}, async (_request, reply) =>
        reply.type("application/javascript").send(expose(fs.readFileSync(path.join(cloudRoot, "public/canvas/app.js"), "utf8"))));
      server.addHook("onSend", async (request, _reply, payload) => request.url.startsWith("/api/config.js")
        ? String(payload)+"\nwindow.PENECHO_CONFIG.browserCanvasEditing=true;" : payload);
      const email="library-nav@isolated.test", password="Isolated Library A9";
      const registration = await server.inject({method:"POST",url:"/api/v1/auth/register",
        payload:{name:"Library verification",email,password,termsAccepted:true,privacyAccepted:true}});
      await server.inject({method:"POST",url:"/api/v1/auth/verify-email",payload:{email,code:registration.json().developmentCode}});
      const login = await server.inject({method:"POST",url:"/api/v1/auth/login",payload:{email,password}});
      cookies = [].concat(login.headers["set-cookie"]).map(cookie => {
        const [name,value] = cookie.split(";",1)[0].split("=");
        return {url:origin,name,value,path:"/",httpOnly:name!=="penecho_csrf"};
      });
      const account = login.json().account;
      const project = await server.services.repository.createProject(account.id, {name:"Navigation verification"});
      const canvas = await server.services.repository.createCanvas(account.id, project.id, {name:"Example Canvas"});
      await server.listen({port,host:"127.0.0.1"});
      url = `${origin}/canvas/${canvas.id}`;
    } else {
      server = require("../server.js");
      await new Promise(resolve => server.listening ? resolve() : server.once("listening",resolve));
      url = origin = `http://127.0.0.1:${server.address().port}`;
    }
    nativeTheme.themeSource = "light";
    win = new BrowserWindow({show:false,width:1440,height:1000,
      webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    for (const cookie of cookies) await win.webContents.session.cookies.set(cookie);
    win.webContents.on("console-message", event => { if (event.level === "error") report.errors.push(event.message); });
    const js = code => win.webContents.executeJavaScript(code,true);
    const current = () => js("[...document.querySelectorAll('.shell-library-link[aria-current=page]')].map(e=>e.id)");
    const settled = async () => {
      await pause(100);
      await until(() => js("!libraryNavTest.read().busy&&!libraryNavTest.read().rendering"), "Library settled");
    };
    const shot = async name => {
      await js("libraryNavTest.dismiss()"); await pause(150);
      fs.writeFileSync(path.join(output,name+".png"), (await win.webContents.capturePage()).toPNG());
    };
    await win.loadURL(url);
    await until(() => js("!!window.libraryNavTest"), "client startup");
    await js("(async()=>{await libraryNavTest.canvasDocumentsReady();libraryNavTest.state.auto=false;libraryNavTest.setLanguage('en');libraryNavTest.closeCanvasAgent();libraryNavTest.dismiss();libraryNavTest.openHistoryPanel();})()");
    await settled();
    assert.deepEqual(await current(), ["historyCanvasNav"]);
    assert.deepEqual(await js("[...document.querySelector('.shell-library-links').children].map(e=>e.id||e.getAttribute('role'))"),
      ["historyRecentNav","historyFavoritesNav","historyCanvasNav","separator","historyNotesNav"]);
    await shot("canvas-en");
    await js("document.querySelector('#historyNotesNav').click()"); await settled();
    assert.deepEqual(await current(), ["historyNotesNav"]);
    assert.equal(await js("document.querySelector('#historyPanel').dataset.libraryView"), "notes");
    assert.equal(await js("document.activeElement?.matches('input[type=search]')"), false);
    await shot("notes-en");
    await js("document.querySelector('#historyCanvasNav').click()"); await settled();
    assert.deepEqual(await current(), ["historyCanvasNav"]);
    assert.equal(await js("document.querySelector('#historyPanel').dataset.libraryView||''"), "");
    assert.equal(await js("document.querySelector('#historyNotesView').hidden"), true);
    await js("document.querySelector('#historyFavoritesNav').click()"); await settled();
    assert.deepEqual(await current(), ["historyFavoritesNav"]);
    await js("document.querySelector('#historyCanvasNav').click()"); await settled();
    assert.deepEqual(await current(), ["historyCanvasNav"]);
    assert.equal(await js("document.querySelector('#historyFavoritesView').hidden"), true);
    await js("document.querySelector('#historyRecentNav').click()"); await settled();
    assert.deepEqual(await current(), ["historyRecentNav"]);
    await js("document.querySelector('#historyCanvasNav').click()"); await settled();
    assert.deepEqual(await current(), ["historyCanvasNav"]);
    assert.deepEqual(await js("[libraryNavTest.read().serverProject,libraryNavTest.read().cloudProject]"), ["all","all"]);
    report.checks.push("Canvas, Recent, Favorites and Notes each have one active entry; Canvas returns from Notes/Favorites and selects all projects.");
    report.divider = await js("(()=>{const e=document.querySelector('.shell-library-divider'),s=getComputedStyle(e);return {width:e.clientWidth,borderWidth:s.borderTopWidth,color:s.borderTopColor};})()");
    assert.equal(report.divider.borderWidth, "1px"); assert.ok(report.divider.width>0);
    for (const [name,width,height,dark,language] of [["notes-system-dark",1440,1000,true,"en"],["notes-narrow-zh",390,844,false,"zh"]]) {
      win.setSize(width,height); nativeTheme.themeSource=dark ? "dark" : "light";
      await js(`libraryNavTest.setLanguage('${language}');document.querySelector('#historyNotesNav').click()`);
      await settled();
      const overflow = await js("[document.querySelector('#historyPanel'),document.querySelector('.history-library-sidebar')].map(e=>({width:e.clientWidth,scroll:e.scrollWidth}))");
      assert.ok(overflow.every(e=>e.scroll<=e.width+1),JSON.stringify(overflow));
      if (width<700) {
        const geometry = await js("['#historyCanvasNav','.shell-library-divider','#historyNotesNav'].map(selector=>document.querySelector(selector).getBoundingClientRect().toJSON())");
        assert.ok(geometry[1].width>0 && geometry[1].top>=geometry[0].bottom && geometry[2].top>=geometry[1].bottom,JSON.stringify(geometry));
      }
      await shot(name);
    }
    report.checks.push("The subtle separator renders with light and system-dark preferences; the narrow layout preserves a visible horizontal separator between Canvas and Notes without overflow.");
    assert.deepEqual(report.errors, []);
    report.ok=true;
  } catch (error) {
    report.failure=error.stack;
    if (win) fs.writeFileSync(path.join(output,"failure.png"), (await win.webContents.capturePage()).toPNG());
  } finally {
    win?.destroy();
    if (server) { if (cloud) await server.close(); else await new Promise(resolve=>server.close(resolve)); }
    fs.rmSync(temporary, {recursive:true,force:true});
    report.cleanedUp=true;
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2)+"\n");
    console.log(JSON.stringify(report,null,2)); app.exit(report.ok ? 0 : 1);
  }
});
