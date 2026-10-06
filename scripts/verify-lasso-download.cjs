"use strict";
// Run with tools/electron/node_modules/.bin/electron. Uses isolated data and no model calls.
const {app,BrowserWindow} = require("electron"), fs = require("node:fs"), path = require("node:path"),
  os = require("node:os"), assert = require("node:assert/strict"), {Readable} = require("node:stream"), {createHash} = require("node:crypto"), sharp = require("sharp");
const root = path.resolve(__dirname,".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(),"penecho-lasso-download-")),
  output = path.resolve(process.env.PENECHO_VERIFY_OUTPUT || path.join(root,"docs/verification/lasso-download-20261004"));
fs.mkdirSync(output,{recursive:true});
app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),
  PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",
  AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const readStream = fs.createReadStream;
fs.createReadStream = function(file,...args) {
  if (path.resolve(String(file))===path.join(root,"public/app.js")) {
    const injection = "markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);markChangelogSeen();window.lassoDownload={state,tiles,TILE,smartSuggest,canvasDocumentsReady,loadCanvasSettings,stroke,save,render,setCanvasMode,restoreWidgets,captureSelection,captureInkSelection,cancelSelection,selectionPathFor,updateSelectionObjects,applySelectionColor,assistRefresh,renderAssist,smartSuggestCluster,assistView,applyLanguage};";
    const source = fs.readFileSync(file,"utf8");
    report.clientSha256=createHash("sha256").update(source).digest("hex");
    return Readable.from([source.replace(/\}\)\(\);\s*$/,injection+"})();")]);
  }
  return readStream.call(this,file,...args);
};
const report = {checks:[],downloads:[],errors:[],modelRequests:[]}, downloads = [], pause = ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server, win, downloadLabel;
app.whenReady().then(async()=>{
  try {
    server = require("../server.js");
    await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
    win = new BrowserWindow({show:true,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const js = code=>win.webContents.executeJavaScript(code,true), wait = async expression=>{
      const until = Date.now()+30000;
      while (Date.now()<until) {if(await js(expression))return;await pause(50);}
      throw Error("Timed out: "+expression);
    };
    win.webContents.on("console-message",(_event,level,message)=>{if(level>=3)report.errors.push(message);});
    win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{
      const blocked = details.method==="POST" && /\/api\/(suggest|ai\/command|canvas-agent)/.test(details.url);
      if (blocked) report.modelRequests.push(details.url);
      callback({cancel:blocked || details.url.startsWith("https:")});
    });
    win.webContents.session.on("will-download",(_event,item)=>{
      const file = path.join(output,downloadLabel+".png"), entry = {filename:item.getFilename(),file,state:"pending"};
      downloads.push(entry);item.setSavePath(file);item.once("done",(_event,state)=>{entry.state=state;});
    });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await js("(async()=>{const t=lassoDownload;await t.canvasDocumentsReady();await t.loadCanvasSettings();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelector('#canvasWelcome').hidden=true;t.state.auto=false;t.smartSuggest.enabled=false;t.state.gridVisible=false;t.state.scale=1;t.state.panX=100;t.state.panY=40;t.setCanvasMode('select');t.state.language='zh';t.applyLanguage();})()");
    const widget = {id:"download-widget",pluginId:"general",widgetType:"html_widget",x:100,y:100,w:300,h:240,contentW:300,contentH:240,title:"Lasso download",refreshSeconds:0,
      html:'<!doctype html><html><body style="margin:0;width:300px;height:240px;background:white"><div id="inside" style="position:absolute;left:20px;top:20px;width:30px;height:30px;background:#00a000"></div><div style="position:absolute;left:110px;top:110px;width:30px;height:30px;background:#ff0000"></div><div style="position:absolute;left:210px;top:20px;width:30px;height:30px;background:#0000ff"></div></body></html>'};
    await js(`(()=>{const t=lassoDownload;t.restoreWidgets([${JSON.stringify(widget)}]);t.stroke({x:130,y:165},{x:155,y:165},false,8,false,'#cc2277');t.save();t.render();})()`);
    await wait("lassoDownload.state.widgets[0]?.hostReady && lassoDownload.state.widgets[0]?.initialized");
    await js("(()=>{const t=lassoDownload;t.state.scale=1;t.state.panX=100;t.state.panY=40;t.setCanvasMode('select');t.captureSelection([{x:110,y:110},{x:270,y:110},{x:110,y:270}]);t.render();document.activeElement?.blur();})()");
    console.log("Widget and polygon fixture ready; opening the menu with pointer input");
    await wait("lassoDownload.state.selection?.phase==='active' && document.querySelector('.assist-bar[data-scope=selection]')");
    const contentState = ()=>js("(()=>{const t=lassoDownload,s=t.state,l=s.selection;return {revision:s.userRevision,history:s.history.length,historyBefore:s.historyBefore.size,selection:{regionOnly:l.regionOnly,box:{...l.box},path:t.selectionPathFor(l),fragments:l.fragments.length,color:l.color},widgets:s.widgets.map(({id,x,y,w,h,html})=>({id,x,y,w,h,html})),tiles:[...t.tiles].map(([key,c])=>[key,c.toDataURL()])};})()");
    const downloadSelector = '.assist-menu [data-selection-action="download"]';
    const click = async selector=>{
      const p = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
      win.webContents.sendInputEvent({type:"mouseMove",...p});
      win.webContents.sendInputEvent({type:"mouseDown",button:"left",clickCount:1,...p});
      win.webContents.sendInputEvent({type:"mouseUp",button:"left",clickCount:1,...p});
      await pause(30);
    };
    const openMenu = async name=>{
      await wait("lassoDownload.smartSuggest.bar && !lassoDownload.smartSuggest.bar.element.inert && Number(getComputedStyle(lassoDownload.smartSuggest.bar.element).opacity)>.99");
      if(!await js("lassoDownload.smartSuggest.bar.menu"))await click(".assist-more > button");
      await wait(`(()=>{const e=document.querySelector(${JSON.stringify(downloadSelector)});return e && e.offsetHeight>0;})()`);
      assert.equal(await js(`document.querySelector(${JSON.stringify(downloadSelector)}).textContent.trim()`),name);
      assert.equal(await js(`document.querySelector(${JSON.stringify(downloadSelector)}).dataset.suggestion || null`),null);
      const bounds = await js(`(()=>{const e=document.querySelector(${JSON.stringify(downloadSelector)}),r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};})()`);
      assert.ok(bounds.x>=0 && bounds.y>=0 && bounds.right<=bounds.width && bounds.bottom<=bounds.height,"download button stays reachable");
    };
    const download = async label=>{
      const before = await contentState(), count=downloads.length;
      downloadLabel=label;
      await click(downloadSelector);
      for (let attempt=0;attempt<600 && (downloads.length<=count || downloads[count].state==="pending");attempt++)await pause(50);
      assert.equal(downloads.length,count+1); assert.equal(downloads[count].state,"completed");
      await wait("!lassoDownload.state.selection.downloadBusy");
      assert.deepEqual(await contentState(),before,"download preserves selection, ink, Widget source, revision and Undo history");
      const file = downloads[count].file, metadata = await sharp(file).metadata(),
        {data,info} = await sharp(file).removeAlpha().raw().toBuffer({resolveWithObject:true}),
        at = (x,y)=>Array.from(data.subarray((Math.floor(y)*info.width+Math.floor(x))*info.channels,(Math.floor(y)*info.width+Math.floor(x))*info.channels+3));
      assert.equal(metadata.format,"png");assert.equal(info.width,Math.ceil(before.selection.box.w*1.5));assert.equal(info.height,Math.ceil(before.selection.box.h*1.5));
      report.downloads.push({label,filename:downloads[count].filename,width:info.width,height:info.height});
      return {at,info};
    };
    await openMenu("下载图片");await pause(150);
    fs.writeFileSync(path.join(output,"zh-wide-menu.png"),(await win.webContents.capturePage()).toPNG());
    const first = await download("widget-and-ink-polygon");
    console.log("Downloaded the first PNG; checking polygon pixels");
    assert.deepEqual(first.at(37,37),[0,160,0],"enclosed Widget content is exported");
    assert.deepEqual(first.at(48,82),[204,34,119],"enclosed ink is exported");
    assert.deepEqual(first.at(180,180),[255,255,255],"content outside the polygon is masked");
    report.checks.push("The fixed Chinese menu control downloads a masked 1.5x PNG using real pointer input and a browser download, without changing Canvas data");
    let frame;
    for (const candidate of win.webContents.mainFrame.framesInSubtree)
      if(await candidate.executeJavaScript("Boolean(document.querySelector('#inside'))").catch(()=>false)){frame=candidate;break;}
    assert.ok(frame);await frame.executeJavaScript("document.querySelector('#inside').style.background='#800080'");
    const fresh = await download("fresh-widget-content");assert.deepEqual(fresh.at(37,37),[128,0,128],"fresh live Widget content replaces the cached preview");
    report.checks.push("The download refreshes current Widget pixels instead of reusing a stale thumbnail");
    for (const [language,label] of [["en","Download image"],["zh","下载图片"]]) {
      win.webContents.sendInputEvent({type:"mouseMove",x:10,y:10});await pause(50);
      win.setContentSize(390,844);
      await js(`(()=>{const t=lassoDownload;t.state.language=${JSON.stringify(language)};t.applyLanguage();t.assistRefresh('language');})()`);await pause(200);
      await openMenu(label);await pause(100);
      fs.writeFileSync(path.join(output,language+"-narrow-menu.png"),(await win.webContents.capturePage()).toPNG());
    }
    report.checks.push("The permanent control stays reachable at 390px in Chinese and English");
    win.setContentSize(1440,1000);
    await js("(()=>{const t=lassoDownload;t.cancelSelection(true);t.captureInkSelection([{x:120,y:150},{x:180,y:150},{x:180,y:180},{x:120,y:180}]);const l=t.state.selection;l.box.x=800;l.box.y=300;l.box.w*=1.5;l.box.h*=1.25;l.path=t.selectionPathFor(l);t.updateSelectionObjects(l);t.applySelectionColor('#228855');t.render();t.assistRefresh('moved');})()");
    await pause(200);await openMenu("下载图片");
    const moved = await download("moved-resized-recolored-ink");
    assert.deepEqual(moved.at(55,28),[34,136,85],"lifted ink uses current position, size and color");
    report.checks.push("Moved, resized and recolored lifted ink downloads at its current geometry and retains the active lasso");
    await js("(()=>{const t=lassoDownload;t.cancelSelection(true);t.captureSelection([{x:900,y:500},{x:1000,y:500},{x:1000,y:580},{x:900,y:580}]);t.render();})()");
    await pause(200);await openMenu("下载图片");
    const blank = await download("blank-selection");assert.deepEqual(blank.at(50,50),[255,255,255]);
    report.checks.push("A blank lasso also keeps the fixed download control and downloads its paper region");
    assert.deepEqual(report.modelRequests,[]);assert.deepEqual(report.errors,[]);
    console.log(JSON.stringify({output,checks:report.checks,downloads:report.downloads,modelRequests:report.modelRequests},null,2));
  } catch(error) {
    report.failure=error.stack;console.error(error);process.exitCode=1;
    if(win)report.rendererState=await win.webContents.executeJavaScript("(()=>{const t=window.lassoDownload;return t?{mode:t.state.mode,scale:t.state.scale,visibility:document.visibilityState,selection:t.state.selection,gesture:t.state.selectionGesture,bar:t.smartSuggest.bar?.mode}:null;})()").catch(()=>null);
    if(win)fs.writeFileSync(path.join(output,"failure.png"),(await win.webContents.capturePage()).toPNG());
  } finally {
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2)+"\n");
    win?.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode || 0);
  }
});
