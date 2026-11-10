"use strict";
// Comparable renderer timings with isolated documents, profile and server data.
// --client=/absolute/app.js accepts a saved baseline without changing source.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-note-chooser-")), cloud = process.argv.includes("--cloud"),
  option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3),
  clientFile = path.resolve(option("client") || path.join(root, cloud ? "../penecho_cloud/public/canvas/app.js" : "public/app.js")),
  output = path.resolve(option("output") || temporary), baseline = process.argv.includes("--baseline"),
  report = { runtime:cloud ? "cloud-client" : "local", baseline, clientFile, checks:[], samples:[], errors:[], limitations:["Synthetic dense canvas and navigation in an isolated Electron renderer; physical input and deployed services are not exercised."] };
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
app.disableHardwareAcceleration();
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary,"state"), PENECHO_CONFIG_FILE:path.join(temporary,"config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const injection = `
  const chooserPerf={state,noteCards,canvasDocumentsReady,insertBlankNoteCard,showNoteChooser,closeNoteChooser,render,stroke,save,requestCanvasNavigationPreview,undo,redo,canvasDocumentsCurrent,counts:{}};
  window.noteChooserPerf=chooserPerf;
  hasSelectedAiConnection=()=>false;
  noteRankWidget=async()=>null;
  for(const [name,original] of [['assistContentMask',assistContentMask],['assistFindPlacement',assistFindPlacement]]){
    const wrapped=(...args)=>{const start=performance.now();try{return original(...args);}finally{const metric=chooserPerf.counts[name]||={calls:0,totalMs:0,maxMs:0};const elapsed=performance.now()-start;metric.calls++;metric.totalMs+=elapsed;metric.maxMs=Math.max(metric.maxMs,elapsed);}};
    if(name==='assistContentMask')assistContentMask=wrapped;else assistFindPlacement=wrapped;
  }
  chooserPerf.init=async()=>{
    await canvasDocumentsReady();markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);closeFeatureTour({retry:false,changelog:false});markChangelogSeen();closeCanvasAgent();
    document.querySelector('#canvasWelcome').hidden=true;state.auto=false;smartSuggest.enabled=false;state.language='en';state.scale=1;state.panX=state.panY=0;state.viewInitialized=true;
    // Fill the canvas with ordinary raster ink, including areas around the card.
    for(let y=90;y<1500;y+=34)for(let x=20;x<2600;x+=70)stroke({x,y},{x:x+48,y:y+8},false,3,true,'#111827');
    state.userRevision++;save();
    const widget=await insertBlankNoteCard();chooserPerf.widget=widget;widget.x=520;widget.y=180;widget.w=360;widget.h=480;render();
  };
  chooserPerf.measure=async(kind,open)=>{
    closeNoteChooser();if(open)showNoteChooser(chooserPerf.widget);
    await new Promise(resolve=>setTimeout(resolve,240));chooserPerf.counts={};
    let previous=performance.now();const intervals=[];state.panGesture=kind==='pan'?{test:true}:null;state.drawing=kind==='drawing'?{test:true}:null;
    for(let i=0;i<36;i++){
      await new Promise(resolve=>requestAnimationFrame(resolve));const now=performance.now();intervals.push(now-previous);previous=now;
      if(kind==='pan'){
        const px=state.panX,py=state.panY;state.panX+=3;state.panY+=1;requestCanvasNavigationPreview(px,py);
      }else if(kind==='drawing'){
        stroke({x:80+i*6,y:710},{x:86+i*6,y:714},false,4,true,'#2563eb');state.userRevision++;requestRender();
      }
    }
    const counts=structuredClone(chooserPerf.counts);state.panGesture=null;state.drawing=null;
    const sorted=intervals.slice(3).sort((a,b)=>a-b),rect=noteCards.chooser?.element.getBoundingClientRect().toJSON();
    return {kind,open,counts,medianFrameMs:sorted[Math.floor(sorted.length/2)],p95FrameMs:sorted[Math.floor(sorted.length*.95)],maxFrameMs:Math.max(...sorted),rect};
  };
`;
const readStream = fs.createReadStream;
fs.createReadStream = function(file,...args) {
  return path.resolve(String(file)) === path.join(root,"public/app.js")
    ? Readable.from([fs.readFileSync(clientFile,"utf8").replace(/\}\)\(\);\s*$/, injection + "})();")]) : readStream.call(this,file,...args);
};
let server, win;
app.whenReady().then(async()=>{
  try {
    server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
    win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    win.webContents.on("console-message",event=>{if(event.level==="error")report.errors.push(event.message);});
    const js=code=>win.webContents.executeJavaScript(code,true),check=(name,pass,value)=>{report.checks.push({name,pass,value});if(!baseline)assert.ok(pass,name+": "+JSON.stringify(value));};
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);await js("noteChooserPerf.init()");
    for(const kind of ['idle','pan','drawing'])for(const open of [false,true]){
      const sample=await js(`noteChooserPerf.measure(${JSON.stringify(kind)},${open})`);report.samples.push(sample);
      if(open){if(kind!=='idle')check(kind+': no occupancy scans during active input',!sample.counts.assistContentMask?.calls,sample.counts);
        check(kind+': no repeated placement searches',!sample.counts.assistFindPlacement?.calls,sample.counts);}
    }
    await new Promise(resolve=>setTimeout(resolve,300));
    const settled=await js("(()=>{const t=noteChooserPerf,c=t.noteCards.chooser,r=c.element.getBoundingClientRect();return {rect:r.toJSON(),width:innerWidth,height:innerHeight,category:JSON.parse(t.widget.copyText).category.id}})()");
    check('Chooser stays visible after navigation and drawing',settled.rect.x>=0&&settled.rect.y>=0&&settled.rect.right<=settled.width+1&&settled.rect.bottom<=settled.height+1,settled);
    fs.writeFileSync(path.join(output,'chooser.png'),(await win.webContents.capturePage()).toPNG());
    const controls=await js("(()=>{const t=noteChooserPerf,e=t.noteCards.chooser.element;e.querySelector('.note-chooser-chips .note-chip').click();e.querySelector('.note-bookmark').click();e.querySelector('.note-look').click();const n=JSON.parse(t.widget.copyText);return {categorySource:n.categorySource,bookmarked:n.bookmarked,styleChosen:n.styleChosen,chooser:!!t.noteCards.chooser}})()");
    check('Category, bookmark and style actions still update the card',controls.categorySource==='user'&&controls.bookmarked&&controls.styleChosen&&controls.chooser,controls);
    await js("noteChooserPerf.noteCards.chooser.element.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    check('Escape closes the chooser',await js("!noteChooserPerf.noteCards.chooser"));
    check('No renderer console errors',!report.errors.length,report.errors);report.ok=true;
  }catch(error){report.ok=false;report.error=error.stack;}
  finally{win?.destroy();if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}report.closed=!server?.listening;
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));fs.rmSync(temporary,{recursive:true,force:true});app.exit(report.ok?0:1);}
});
