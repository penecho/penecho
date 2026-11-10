"use strict";
// Render canonical Widget chrome with isolated local data and touch emulation.
// Run: tools/electron/node_modules/.bin/electron scripts/verify-widget-toolbar-layout.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-toolbar-layout-"));
const output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || temporary);
const recordOnly = process.argv.includes("--record-only");
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) {
    const injection = "window.toolbarLayoutTest={state,canvasDocumentsReady,restoreWidgets,render,setCanvasMode,showHandObjectToolbar,hideHandObjectToolbar,setSmartSuggestEnabled};";
    return Readable.from([fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, injection + "})();")]);
  }
  return readStream.call(this, file, ...args);
};
const sha256 = file => require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");
const report = { checks:[], layouts:[], errors:[], physicalIPadTested:false, inputs:Object.fromEntries(["public/app.js", "public/style.css", "public/studio-shell.css"].map(file => [file, sha256(file)])) };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, server;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1200, height:900, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    const js = code => win.webContents.executeJavaScript(code, true);
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await js("(async()=>{const t=toolbarLayoutTest;await t.canvasDocumentsReady();t.state.auto=false;t.setSmartSuggestEnabled(false);document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();t.restoreWidgets([{id:'toolbar-layout',pluginId:'general',widgetType:'html_widget',x:80,y:250,w:640,h:360,contentW:640,contentH:360,title:'Toolbar layout',refreshSeconds:0,html:'<!doctype html><style>body{margin:0;padding:24px;background:#f7f9fc;font:20px system-ui}</style><h2>Widget</h2>'}]);t.state.widgets[0].favorite=true;t.setCanvasMode('select');t.render();})()");
    win.webContents.debugger.attach("1.3");
    const settings = [
      { name:"desktop", width:1200, touch:false, language:"en", scale:1 },
      { name:"ipad-landscape", width:1024, touch:true, language:"en", scale:1 },
      { name:"ipad-portrait", width:768, touch:true, language:"zh", scale:.65 },
      { name:"phone-wrapped", width:390, touch:true, language:"en", scale:.4 },
      { name:"phone-chinese", width:390, touch:true, language:"zh", scale:.4 },
    ];
    for (const setting of settings) {
      await win.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", { width:setting.width, height:900, deviceScaleFactor:1, mobile:setting.touch });
      await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", { enabled:setting.touch, maxTouchPoints:5 });
      await js(`(()=>{const t=toolbarLayoutTest,s=t.state;t.hideHandObjectToolbar({all:true,animate:false});s.language=${JSON.stringify(setting.language)};s.scale=${setting.scale};s.panX=0;s.panY=${setting.width < 600 ? 180 : 0};t.showHandObjectToolbar('widget',s.widgets[0]);t.render();})()`);
      await pause(250);
      const layout = await js(`(()=>{
        const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
        const surface=document.querySelector('.floating-widget-toolbar'), header=rect(surface),grip=getComputedStyle(surface,'::before');
        const gripCenter=header.top+parseFloat(getComputedStyle(surface).borderTopWidth)+parseFloat(grip.top)+parseFloat(grip.marginTop)+parseFloat(grip.height)/2;
        const items=[...document.querySelectorAll('.object-toolbar-item')].map(e=>{
          const r=rect(e),p=getComputedStyle(e,'::after'),svg=e.querySelector('svg'),label=e.querySelector('.widget-interact-label,.widget-refine-button-label');
          const textRange=label&&document.createRange();if(textRange)textRange.selectNodeContents(label);
          return {kind:e.penechoSpec.kind,row:e.penechoSpec.toolbarCompactRow,divider:e.classList.contains('toolbar-group-start'),rect:r,icon:svg&&rect(svg),text:textRange&&rect(textRange),pseudo:{left:parseFloat(p.left),right:p.right,top:parseFloat(p.top),bottom:p.bottom,width:parseFloat(p.width),height:parseFloat(p.height),background:p.backgroundColor},pressed:e.getAttribute('aria-pressed')};
        });
        return {header,items,gripCenter,coarse:matchMedia('(pointer:coarse)').matches,viewport:innerWidth};
      })()`);
      report.layouts.push({ setting, ...layout });
      const clip = { x:Math.max(0, Math.floor(layout.header.left)-4), y:Math.max(0, Math.floor(layout.header.top)-12), width:Math.ceil(layout.header.width)+8, height:Math.ceil(layout.header.height)+24 };
      fs.writeFileSync(path.join(output, `${setting.name}.png`), (await win.webContents.capturePage(clip)).toPNG());
      if (recordOnly) continue;
      assert.equal(layout.coarse, setting.touch, `${setting.name}: input media is emulated`);
      const epsilon = 1.1;
      assert.ok(Math.abs(layout.gripCenter-(layout.header.top+20))<epsilon,`${setting.name}: grip stays aligned with the first row`);
      for (const [index,item] of layout.items.entries()) {
        const r=item.rect,prev=layout.items[index-1];
        assert.ok(r.left >= layout.header.left && r.right <= layout.header.right, `${setting.name}: ${item.kind} stays horizontally inside`);
        assert.ok(r.top >= layout.header.top && r.bottom <= layout.header.bottom, `${setting.name}: ${item.kind} stays vertically inside`);
        if (prev?.row === item.row) {
          assert.ok(r.left >= prev.rect.right, `${setting.name}: adjacent buttons do not overlap`);
          const gap=r.left-prev.rect.right;
          assert.ok(Math.abs(gap-(item.divider?16:4)) < epsilon, `${setting.name}: ${item.kind} has the intended gap`);
          if (item.divider) {
            const dividerLeft=r.left+item.pseudo.left,dividerRight=dividerLeft+item.pseudo.width;
            assert.ok(Math.abs((dividerLeft-prev.rect.right)-(r.left-dividerRight)) < epsilon, `${setting.name}: ${item.kind} divider has equal side padding`);
          }
        } else if (item.row > 0) {
          assert.equal(item.divider,false,`${setting.name}: wrapped row has no leading divider`);
          assert.ok(Math.abs(r.left-layout.header.left-6)<epsilon,`${setting.name}: wrapped row uses the outer inset`);
        }
        if (item.divider) {
          const top=r.top+item.pseudo.top,bottom=top+item.pseudo.height;
          assert.ok(top>=layout.header.top+6 && bottom<=layout.header.bottom-6,`${setting.name}: divider has vertical breathing room`);
          assert.ok(Math.abs(item.pseudo.width-1)<.1 && Math.abs(item.pseudo.height-20)<.1,`${setting.name}: divider remains a short straight line`);
        }
        if (item.text && item.icon) {
          assert.ok(Math.abs((item.icon.left-r.left)-(r.right-item.text.right))<epsilon,`${setting.name}: ${item.kind} content has balanced padding`);
        }
      }
      const last=layout.items.at(-1);
      if(last.row===0) assert.ok(Math.abs(layout.header.right-last.rect.right-6)<epsilon,`${setting.name}: final action keeps the outer inset`);
      report.checks.push(`${setting.name}: spacing, centered dividers, contained lines and labeled padding`);
    }
    assert.deepEqual(report.errors, []);
    report.ok = true;
  } catch (error) {
    report.failure = error.stack || String(error);
    if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, "failure.png"), (await win.webContents.capturePage()).toPNG());
  } finally {
    win?.destroy();
    if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
    report.serverClosed = !server?.listening;
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ok:report.ok,checks:report.checks,failure:report.failure,serverClosed:report.serverClosed,output}, null, 2));
    if (output !== temporary) fs.rmSync(temporary, { recursive:true, force:true });
    app.exit(report.ok ? 0 : 1);
  }
});
