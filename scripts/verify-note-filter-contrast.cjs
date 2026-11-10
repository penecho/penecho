"use strict";
// Verify actual Library controls with canonical assets and isolated local data.
const { app, BrowserWindow, nativeTheme } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-note-contrast-"));
const output = path.join(root, "docs/verification/card-appearance-20261003");
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV: "test", PENECHO_TEST_OPEN_ACCESS: "1", PENECHO_STATE_DIR: path.join(temporary, "state"), PENECHO_CONFIG_FILE: path.join(temporary, "config.env"), HOST: "127.0.0.1", PORT: "0", AI_PROVIDER: "api", AI_API_KEY: "test-only", AI_API_URL: "http://127.0.0.1:1/v1", AI_API_MODEL: "test", PENECHO_CANVAS_AGENT_AUTO_OPEN: "false", PENECHO_REQUEST_TRACE: "false", PENECHO_JEVISION_ENABLED: "true", PENECHO_JEVISION_MOCK: "auto" });
const originalRead = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) {
    return Readable.from([fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, `
      window.noteTest={state,noteCards,canvasDocumentsReady,noteLibraryLoad,noteLibraryPut,noteLibraryPersist,noteLibraryRender,openNoteLibrary,applyLanguage,applyTheme,addNoteCategory};
      penIntelRemote=()=>true;
    })();`)]);
  }
  return originalRead.call(this, file, ...args);
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function contrast(a, b) {
  const luminance = c => c.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
let server, win;
const report = { states: [] };
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const js = code => win.webContents.executeJavaScript(code, true);
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await js(`(async()=>{const t=noteTest;await t.canvasDocumentsReady();await t.noteLibraryLoad();t.state.auto=false;t.state.language='en';t.applyLanguage();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();t.addNoteCategory('Pale yellow','#fff4b8');for(const [id,bookmarked,category] of [['saved',true,'formula'],['plain',false,'Pale yellow']]){t.noteLibraryPut(PENECHO_NOTE_CARD.libraryEntry({id,note:{title:id==='saved'?'Bookmarked formula':'Unbookmarked note',style:'card',category,bookmarked,blocks:[{type:'markdown',text:'Contrast fixture'}],updated:Date.now()},updatedAt:Date.now()}));}await t.noteLibraryPersist();t.openNoteLibrary();})()`);
    await pause(300);
    const readState = () => js(`(()=>{
      const e=document.querySelector('.note-filter.active'), icon=e.querySelector('.note-chip-icon');
      const rgba=color=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data];};
      const mix=(fg,bg)=>fg.slice(0,3).map((v,i)=>v*fg[3]/255+bg[i]*(1-fg[3]/255));
      const s=getComputedStyle(e);let background=[255,255,255];const ancestors=[];for(let p=e;p;p=p.parentElement)ancestors.push(p);for(const p of ancestors.reverse())background=mix(rgba(getComputedStyle(p).backgroundColor),background);
      return {label:e.textContent,pressed:e.getAttribute('aria-pressed'),foreground:mix(rgba(s.color),background),background,icon:icon?mix(rgba(getComputedStyle(icon).color),background):null,outline:s.outlineStyle,outlineWidth:s.outlineWidth,tiles:document.querySelectorAll('.note-tile').length};
    })()`);
    const check = async (name, expectedTiles) => {
      const state = await readState();
      state.contrast = contrast(state.foreground, state.background);
      state.iconContrast = state.icon ? contrast(state.icon, state.background) : null;
      assert.equal(state.pressed, "true", name);
      assert.equal(state.tiles, expectedTiles, name);
      assert.ok(state.contrast >= 4.5, name + JSON.stringify(state));
      if (state.icon) assert.ok(state.iconContrast >= 4.5, name + JSON.stringify(state));
      report.states.push({ name, ...state });
    };
    for (const dark of [false, true]) {
      nativeTheme.themeSource = dark ? "dark" : "light";
      await js(`noteTest.applyTheme('studio');noteTest.noteCards.panel.category='';noteTest.noteCards.panel.bookmarked=false;noteTest.noteLibraryRender()`);
      await pause(120);
      const name = dark ? "dark" : "light";
      await check(name + "-all", 2);
      await js(`document.querySelectorAll('.note-filter')[1].click()`);
      await pause(80);
      await check(name + "-bookmarked", 1);
      const rect = await js(`document.querySelectorAll('.note-filter')[1].getBoundingClientRect().toJSON()`);
      win.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
      await pause(220);
      await check(name + "-bookmarked-hover", 1);
      win.webContents.focus();
      await js(`document.querySelectorAll('.note-filter')[1].focus()`);
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab", modifiers: ["shift"] });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab", modifiers: ["shift"] });
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
      await pause(150);
      await check(name + "-bookmarked-focus", 1);
      assert.equal(await js(`getComputedStyle(document.querySelectorAll('.note-filter')[1]).outlineStyle`), "solid");
      fs.writeFileSync(path.join(output, `bookmarked-${name}.png`), (await win.webContents.capturePage()).toPNG());
      await js(`document.querySelectorAll('.note-filter')[1].click()`);
      await check(name + "-toggle-off", 2);
      await js(`[...document.querySelectorAll('.note-filter')].find(e=>e.textContent.includes('Pale yellow')).click()`);
      await check(name + "-pale-category", 1);
    }
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.failure = error.stack;
    console.error(error);
  } finally {
    fs.writeFileSync(path.join(output, "filter-contrast.json"), JSON.stringify(report, null, 2) + "\n");
    win?.destroy();
    if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
    fs.rmSync(temporary, { recursive: true, force: true });
    app.exit(report.failure ? 1 : 0);
  }
});
