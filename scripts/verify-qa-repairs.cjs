"use strict";
// Verify QA repairs with real pointer/keyboard input and IndexedDB in an isolated browser.
// Run with tools/electron/node_modules/.bin/electron scripts/verify-qa-repairs.cjs.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict'), { Readable } = require('node:stream');
const root = path.resolve(__dirname, '..'), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'penecho-qa-repairs-'));
const output = process.argv.find(value => value.startsWith('--output='));
const directory = output ? path.resolve(output.slice(9)) : path.join(root, 'docs/verification/qa-repairs-20261005/local');
fs.mkdirSync(directory, { recursive:true });
app.setPath('userData', path.join(temporary, 'profile'));
Object.assign(process.env, { NODE_ENV:'test', PENECHO_TEST_OPEN_ACCESS:'1', PENECHO_STATE_DIR:path.join(temporary, 'state'), PENECHO_CONFIG_FILE:path.join(temporary, 'config.env'), HOST:'127.0.0.1', PORT:'0', AI_PROVIDER:'api', AI_API_KEY:'test-only', AI_API_URL:'http://127.0.0.1:1/v1', AI_API_MODEL:'test', PENECHO_CANVAS_AGENT_AUTO_OPEN:'false', PENECHO_REQUEST_TRACE:'false', PENECHO_JEVISION_ENABLED:'false' });
const compiled = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
assert.equal(compiled, require('./build-client.js').compiledSource(), 'Build the canonical client before verification');
const injected = compiled.replace(/\}\)\(\);\s*$/, `
  window.qa = {state, tiles, smartSuggest, canvasDocuments, canvasDocumentsDraft, canvasDocumentsCurrent, canvasDocumentsReady, canvasDocumentsStartDraft, canvasDocumentsFlushDraft, canvasDocumentsDb, canvasDocumentsDraftUnsaved, createTextEditor, cancelSmartSuggest, noteCardPlacement, noteCardInsert, showNoteChooser, closeNoteChooser, noteCards, widgetBox, assistScreenBox, assistContentMask, assistOccupiedArea, canvasViewportMetrics, canvasElementLayoutRect, viewportRect, render};
})();`);
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  return path.resolve(String(file)) === path.join(root, 'public/app.js') ? Readable.from([injected]) : readStream.call(this, file, ...args);
};
let server, win;
const report = { source:root, checks:{}, errors:[] }, wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = source => win.webContents.executeJavaScript(source);
const click = async (x,y) => {
  win.webContents.sendInputEvent({ type:'mouseMove', x,y });
  win.webContents.sendInputEvent({ type:'mouseDown', x,y, button:'left', clickCount:1 });
  win.webContents.sendInputEvent({ type:'mouseUp', x,y, button:'left', clickCount:1 });
  await wait(80);
};
const key = async keyCode => {
  win.webContents.sendInputEvent({ type:'keyDown', keyCode });
  win.webContents.sendInputEvent({ type:'keyUp', keyCode });
  await wait(40);
};
const stroke = async (x,y) => {
  win.webContents.sendInputEvent({ type:'mouseDown', x,y, button:'left', clickCount:1 });
  for (let i=1;i<=8;i++) win.webContents.sendInputEvent({ type:'mouseMove', x:x+i*10,y:y+i*2, button:'left', movementX:10,movementY:2 });
  win.webContents.sendInputEvent({ type:'mouseUp', x:x+80,y:y+16, button:'left', clickCount:1 });
  await wait(80);
};
app.whenReady().then(async () => {
  try {
    server = require('../server.js');
    await new Promise(resolve => server.listening ? resolve() : server.once('listening',resolve));
    win = new BrowserWindow({ show:false,width:1200,height:900,webPreferences:{ contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true } });
    win.webContents.on('console-message', (_event,level,message) => { if (level>=3) report.errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await js(`(async()=>{await qa.canvasDocumentsStartDraft();qa.state.auto=false;qa.smartSuggest.enabled=false;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();})()`);
    await wait(100);
    await js(`document.querySelector('#changelogClose')?.click();`);
    await wait(100);
    report.checks.shortcuts = { initialFocus:await js('document.activeElement.id') };
    await key('V'); report.checks.shortcuts.V=await js('qa.state.mode');
    await key('H'); report.checks.shortcuts.H=await js('qa.state.mode');
    await key('P'); report.checks.shortcuts.P=await js('qa.state.mode');
    assert.equal(report.checks.shortcuts.V,'select');assert.equal(report.checks.shortcuts.H,'hand');assert.equal(report.checks.shortcuts.P,'pen');
    await js(`document.querySelector('#canvasWelcomeDraw')?.click();qa.state.auto=false;`);
    await wait(600);
    const position=await js(`(()=>{const b=document.querySelector('#screen').getBoundingClientRect();return {x:Math.round(b.left+180),y:Math.round(b.top+180)}})()`);
    // Keyboard-focused buttons must keep their keys; a deliberate Canvas click transfers focus.
    await js(`document.querySelector('#settingsBtn').focus();`);
    await key('V'); assert.equal(await js('qa.state.mode'),'pen');
    report.checks.shortcuts.hit=await js(`(()=>{const e=document.elementFromPoint(${position.x},${position.y});return {id:e.id,tag:e.tagName,cls:e.className,blocked:qa.state.textInputBlockedUntil-Date.now()}})()`);
    await click(position.x,position.y);
    report.checks.shortcuts.focusAfterClick=await js('document.activeElement.id');
    await key('V'); report.checks.shortcuts.afterCanvasClick=await js('qa.state.mode');assert.equal(report.checks.shortcuts.afterCanvasClick,'select');
    await key('P');
    await js(`qa.cancelSmartSuggest('qa-text');qa.state.mode='text';qa.createTextEditor({x:150,y:150},{text:'hello world'});`);
    await wait(400);
    const before = await js('({history:qa.state.history.length,strokes:qa.smartSuggest.strokes.length})');
    await click(position.x+100,position.y+30);
    report.checks.textCompletion=await js(`({editors:qa.state.textEditors.size,texts:qa.state.textBoxes.map(t=>t.text),history:qa.state.history.length,strokes:qa.smartSuggest.strokes.length,mode:qa.state.mode})`);
    assert.equal(report.checks.textCompletion.editors,0);assert.equal(report.checks.textCompletion.texts[0],'hello world');
    assert.equal(report.checks.textCompletion.strokes,before.strokes,'Finishing text must not produce a dot');
    assert.equal(report.checks.textCompletion.history,before.history+1,'Only text was committed');
    // Begin the next stroke within 300 ms: event ownership must not introduce an input cooldown.
    await stroke(position.x+140,position.y+60);
    assert.ok(await js('qa.tiles.size>0'));
    assert.equal(await js('qa.state.history.length'),report.checks.textCompletion.history+1);
    report.checks.textCompletion.nextStrokeAccepted=true;
    await wait(1100);
    await js(`(async()=>{qa.cancelSmartSuggest('qa-snapshot');await qa.canvasDocumentsFlushDraft();})()`);
    report.checks.recovery=await js(`(async()=>{const db=await qa.canvasDocumentsDb();const rows=await new Promise((resolve,reject)=>{const r=db.transaction('documents','readonly').objectStore('documents').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return {id:qa.canvasDocumentsCurrent().id,tiles:qa.tiles.size,texts:qa.state.textBoxes.length,saved:rows.filter(r=>r.id===qa.canvasDocumentsCurrent().id).map(r=>({tiles:r.stored.tileEntries.length,texts:r.stored.item.textBoxes.length})),unsaved:qa.canvasDocumentsDraftUnsaved(),explicitlySaved:qa.state.snapshotSavedRevision}})()`);
    assert.equal(report.checks.recovery.unsaved,false);assert.equal(report.checks.recovery.explicitlySaved,0);
    assert.equal(report.checks.recovery.saved.length,1);assert.ok(report.checks.recovery.tiles>0);
    await new Promise(resolve => { win.webContents.once('did-finish-load',resolve);win.webContents.reload(); });
    await js(`(async()=>{await qa.canvasDocumentsStartDraft();qa.state.auto=false;qa.smartSuggest.enabled=false;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();})()`);
    report.checks.recovery.afterReload=await js('({id:qa.canvasDocumentsCurrent().id,tiles:qa.tiles.size,texts:qa.state.textBoxes.map(t=>t.text),error:qa.canvasDocuments.error})');
    assert.equal(report.checks.recovery.afterReload.id,report.checks.recovery.id);
    assert.equal(report.checks.recovery.afterReload.tiles,report.checks.recovery.tiles);
    assert.equal(report.checks.recovery.afterReload.texts[0],'hello world');
    fs.writeFileSync(path.join(directory,'restored.png'),(await win.webContents.capturePage()).toPNG());
    report.checks.placement=await js(`(async()=>{
      const results=[];
      for(const scale of [.25,.7,1.5]) {
        qa.state.scale=scale;qa.state.panX=-300*scale;qa.state.panY=-200*scale;
        const view=qa.viewportRect(),source={x:view.x+view.w*.8,y:view.y+view.h*.5,w:view.w*.16,h:view.h*.1},box=qa.noteCardPlacement(source);
        results.push({scale,view,source,box});
      }
      qa.state.scale=.7;qa.state.panX=-210;qa.state.panY=-140;qa.render();
      const note=window.PENECHO_NOTE_CARD.noteFromParts({items:[{kind:'text',text:'A note created near the edge of the canvas should remain visible.'}],language:'en'});
      const view=qa.viewportRect(),box=qa.noteCardPlacement({x:view.x+view.w*.8,y:view.y+view.h*.5,w:100,h:100});
      const widget=await qa.noteCardInsert(note,box);qa.showNoteChooser(widget,{fresh:true});
      return results;
    })()`);
    for(const {view,box} of report.checks.placement) {
      assert.ok(box.x>=view.x && box.y>=view.y && box.x+box.w<=view.x+view.w+1 && box.y+box.h<=view.y+view.h+1,'Card must be inside the current viewport');
      assert.ok(Math.abs(box.w/box.h-.75)<.01,'Portrait proportions must be preserved');
    }
    await wait(900);
    report.checks.chooser=await js(`(()=>{const r=qa.canvasElementLayoutRect(qa.noteCards.chooser.element),b={x:r.left,y:r.top,width:r.width,height:r.height},{width,height}=qa.canvasViewportMetrics(),mask=qa.assistContentMask(width,height);return {x:b.x,y:b.y,w:b.width,h:b.height,width,height,covered:qa.assistOccupiedArea(mask,b.x,b.y,b.width,b.height)}})()`);
    assert.equal(report.checks.chooser.covered,0,'Chooser must avoid existing objects and ink when space is available');
    fs.writeFileSync(path.join(directory,'note-placement.png'),(await win.webContents.capturePage()).toPNG());
    await js('(async()=>{qa.closeNoteChooser();await qa.canvasDocumentsFlushDraft();})()');
    await new Promise(resolve => { win.webContents.once('did-finish-load',resolve);win.webContents.reload(); });
    await js('(async()=>{await qa.canvasDocumentsStartDraft();qa.state.auto=false;qa.smartSuggest.enabled=false;})()');
    report.checks.recovery.widgetsAfterReload=await js('qa.state.widgets.map(w=>({title:w.title,sourceFormat:w.sourceFormat}))');
    assert.equal(report.checks.recovery.widgetsAfterReload.length,1,'Recovery retains committed widgets');
    assert.match(report.checks.recovery.widgetsAfterReload[0].sourceFormat,/note/);
    assert.deepEqual(report.errors,[]);
    console.log(JSON.stringify(report,null,2));
  } catch(error) { report.failure=error.stack;console.error(error.stack);if(win)fs.writeFileSync(path.join(directory,'failure.png'),(await win.webContents.capturePage()).toPNG());process.exitCode=1; }
  finally {
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
    win?.destroy();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode||0);
  }
});
