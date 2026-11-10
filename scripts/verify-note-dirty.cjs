"use strict";
// Isolated real renderer acceptance for Note input consumption. No live model
// or user documents are used; --cloud loads the officially mirrored client.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), cloud = process.argv.includes("--cloud"), baseline = process.argv.includes("--baseline"),
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-note-dirty-")),
  output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || temporary),
  clientFile = path.resolve(root, cloud ? "../penecho_cloud/public/canvas/app.js" : "public/app.js");
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
app.disableHardwareAcceleration();
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const injection = `
  window.noteDirtyTest={state,smartSuggest,tiles,canvasDocumentsReady,captureSelection,cancelSelection,clearDirtyContributionTracking,render,stroke,save,undo,redo,smartSuggestRecordStroke,assistNoteScope,organizeSuggestAsNote,organizeSelectionAsNote,renderedTextBoxRecord,noteCards,closeNoteChooser,releaseDirtyInput,dirtyInputSnapshots,supersedeActiveAI,requestAI,TILE,DIRTY_MASK_SCALE,smartSuggestResultCluster,executeAssistAction,requests:[],response:'note',connected:false};
  noteDirtyTest.reportedPath=${fs.readFileSync(path.join(root,'test/fixtures/note-enclosure-path.json'),'utf8').trim()};
  noteDirtyTest.drawSampled=(points,sizes)=>{
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),
      drawing={samples:points.map((point,i)=>({point,size:sizes[i]})),bbox:{x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y},color:'#111827',erase:false};
    commitLiveInkDrawing(drawing);state.userRevision++;save();smartSuggestDrawingFinished(drawing);
    return smartSuggest.strokes.at(-1);
  };
  noteDirtyTest.oldDirtyPixels=()=>{
    let count=0;for(const [key,mask] of state.dirtyInkTiles){const [tx,ty]=key.split(',').map(Number),data=mask.getContext('2d').getImageData(0,0,mask.width,mask.height).data;
      for(let y=0;y<mask.height;y++)for(let x=0;x<mask.width;x++)if((tx*TILE+x/DIRTY_MASK_SCALE)<600&&(ty*TILE+y/DIRTY_MASK_SCALE)<330&&data[(y*mask.width+x)*4+3])count++;
    }return count;
  };
  noteDirtyTest.init=async()=>{await canvasDocumentsReady();markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);closeFeatureTour({retry:false,changelog:false});markChangelogSeen();document.querySelector('#canvasWelcome').hidden=true;state.auto=false;smartSuggest.enabled=false;state.language='en';state.scale=1;state.panX=state.panY=0;state.viewInitialized=true;};
  hasSelectedAiConnection=()=>noteDirtyTest.connected;
  const prepareNoteWidgets=ensureWidgetSnapshots;
  ensureWidgetSnapshots=async(...args)=>{if(noteDirtyTest.pausePreparation)await new Promise(resolve=>noteDirtyTest.resumePreparation=resolve);return prepareNoteWidgets(...args);};
  const renderNoteCommand=animate;
  animate=async(...args)=>{if(noteDirtyTest.pauseRender)await new Promise(resolve=>noteDirtyTest.resumeRender=resolve);return renderNoteCommand(...args);};
  const captureNoteSelection=noteCaptureSelection;
  noteCaptureSelection=async selection=>{const parts=await captureNoteSelection(selection);if(noteDirtyTest.pauseCapture)await new Promise(resolve=>noteDirtyTest.resumeCapture=resolve);return parts;};
  requireAiConnectionSelection=()=>true;selectedAiConnectionId=()=>"test-connection";aiConnectionScope=()=>"test-scope";
  const noteTestFetch=fetch;
  const originalViewportImage=buildViewportImage;
  buildViewportImage=(...args)=>{if(noteDirtyTest.failCapture){noteDirtyTest.failCapture=false;throw Error('Forced capture retry');}return originalViewportImage(...args);};
  noteDirtyTest.nextRequest=async(options={})=>{
    noteDirtyTest.response='empty';
    await requestAI('auto',null,options);
    const request=noteDirtyTest.requests.at(-1),image=new Image();image.src=request.atlasImage;await image.decode();
    const canvas=offscreen(image.width,image.height),context=canvas.getContext('2d');context.drawImage(image,0,0);
    const shade=(x,y)=>{const px=Math.round((x-request.sourceRect.x)*request.imageScale),py=Math.round((y-request.sourceRect.y)*request.imageScale),
      data=context.getImageData(px-2,py-2,5,5).data;let darkest=255;for(let i=0;i<data.length;i+=4)darkest=Math.min(darkest,data[i]);return darkest;};
    return {old:shade(280,220),fresh:shade(280,350),outside:shade(780,110),image:shade(635,280),text:shade(675,280),request};
  };
  noteDirtyTest.addObjects=()=>{
    const image=offscreen(20,20);image.getContext('2d').fillRect(0,0,20,20);
    for(const [kind,x] of [['image',625],['text',665]]){
      const item={id:'pending-'+kind,x,y:270,w:20,h:20,image,text:'typed'},items=kind==='image'?state.images:state.textBoxes,
        ids=kind==='image'?state.dirtyImageIds:state.dirtyTextBoxIds;
      items.push(item);ids.add(item.id);mergeDirtyBox(item);
    }
  };
  noteDirtyTest.consumeOutside=()=>consumeDirtyInput(captureDirtyInput({x:700,y:70,w:160,h:80}));
  fetch=async(url,options)=>{
    if(url==='/api/ai/command'){
      noteDirtyTest.requests.push(JSON.parse(options.body));
      const mode=noteDirtyTest.response;
      if(mode.startsWith('hold'))await new Promise(resolve=>noteDirtyTest.reply=resolve);
      const commands=mode==='note'||mode==='hold-note'?[{tool:'html_widget',...noteCardWidgetFields(noteCardRuntime().normalize({version:1,title:'Formula note',blocks:[{type:'markdown',text:'The captured formula and its source.'}]})),x:140,y:400,w:440,h:600}]:[];
      return new Response(JSON.stringify(mode==='failure'?{error:'Test model unavailable'}:{commands}),{status:mode==='failure'?503:200,headers:{'Content-Type':'application/json'}});
    }
    if(String(url).endsWith('/suggest/status'))return new Response(JSON.stringify({configured:false}),{headers:{'Content-Type':'application/json'}});
    return noteTestFetch(url,options);
  };
  noteDirtyTest.draw=points=>{
    for(let i=1;i<points.length;i++)stroke(points[i-1],points[i],false,8,true,'#111827');
    state.userRevision++;
    const entry=save(),xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),
      record={id:smartSuggest.nextStrokeId++,points,box:{x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y},at:performance.now(),size:8,historyEntry:entry};
    smartSuggestRecordStroke(record);return smartSuggest.strokes.at(-1);
  };
  noteDirtyTest.penInput=()=>{
    state.mode='pen';
    const a={x:260,y:350},b={x:360,y:350};
    beginCanvasPointerAction({pointerId:77,pointerType:'pen',button:0,buttons:1,pressure:0.5,clientX:a.x,clientY:a.y},a);
    if(!state.drawing)throw Error('Pen input did not start');
    appendLiveInkSample(state.drawing,b,state.drawing.size);
    state.drawing.bbox={x:a.x,y:a.y,w:100,h:0};state.drawing.trail.push(b);
    finishDrawing('pen');
  };
  noteDirtyTest.prepare=async enclosed=>{
    closeNoteChooser();cancelSelection(true);hideAssist('test-reset');state.mode='pen';state.dirty=null;noteDirtyTest.reply=null;
    tiles.clear();state.inkBounds.clear();clearDirtyContributionTracking();
    state.history=[];state.future=[];state.historyBefore.clear();state.dirtyHistoryBefore=null;state.widgetHistoryBefore=null;
    state.widgets.forEach(unmountWidget);state.widgets=[];state.images=[];state.textBoxes=[];state.hotspotTrail=[];state.latestTypedInput=null;
    smartSuggest.strokes=[];smartSuggest.consumedStrokeId=0;smartSuggest.dismissedStrokeId=0;smartSuggest.noteScopeKey=null;
    state.textBoxes=[await renderedTextBoxRecord({id:'formula',text:'xeˣ − eˣ + C',x:190,y:150,w:250,h:80,maxWidth:250,fontSize:32,color:'#2563eb'})];
    const inside=noteDirtyTest.draw([{x:240,y:220},{x:340,y:220}]),outside=noteDirtyTest.draw([{x:740,y:110},{x:820,y:110}]);
    let target;
    if(enclosed){
      const points=noteDirtyTest.reportedLoop?noteDirtyTest.reportedPath:Array.from({length:97},(_,i)=>({x:300+180*Math.cos(i/96*Math.PI*2),y:200+110*Math.sin(i/96*Math.PI*2)})),
        loop=noteDirtyTest.reportedLoop?noteDirtyTest.drawSampled(points,points.map((_,i)=>i===points.length-1?2:8+6*Math.sin(i/13)**2)):noteDirtyTest.draw(points),
        cluster={key:'enclosure-'+loop.id,strokes:[inside,loop],recentIds:new Set([loop.id]),box:{x:100,y:70,w:400,h:260}};
      target={...cluster,noteScope:assistNoteScope(cluster)};
      if(target.noteScope?.kind!=='enclosed')throw Error('Fixture did not produce an actual pen enclosure');
    }else{
      captureSelection([{x:120,y:90},{x:480,y:90},{x:480,y:310},{x:120,y:310}]);target={selection:state.selection,box:{...state.selection.box}};
    }
    render();return target;
  };
  noteDirtyTest.read=()=>{
    const alpha=noteDirtyTest.alpha=(x,y)=>{const tx=Math.floor(x/TILE),ty=Math.floor(y/TILE),mask=state.dirtyInkTiles.get(tx+','+ty);return mask?mask.getContext('2d').getImageData(Math.floor((x-tx*TILE)*DIRTY_MASK_SCALE),Math.floor((y-ty*TILE)*DIRTY_MASK_SCALE),1,1).data[3]:0;};
    let ring=0;for(let i=0;i<96;i++){const p=i/96*Math.PI*2;for(const offset of [-3,0,3])ring+=alpha(300+(180+offset)*Math.cos(p),200+(110+offset)*Math.sin(p));}
    return {inside:alpha(280,220),outside:alpha(780,110),ring,widgets:state.widgets.filter(noteCardWidget).length,snapshots:dirtyInputSnapshots.size,selection:Boolean(state.selection),dirty:state.dirty};
  };
  noteDirtyTest.hash=async()=>{
    const bytes=[];for(const [key,tile]of tiles){bytes.push(key);const data=tile.getContext('2d').getImageData(0,0,tile.width,tile.height).data;bytes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).join(','));}return bytes.join('|');
  };
`;
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  return path.resolve(String(file)) === path.join(root, "public/app.js")
    ? Readable.from([fs.readFileSync(clientFile, "utf8").replace(/\}\)\(\);\s*$/, injection + "})();")]) : readStream.call(this, file, ...args);
};
const report = { runtime:cloud ? "cloud-client" : "local", clientFile, baseline, syntheticModel:true, checks:[], errors:[], limitations:["Isolated local renderer with deterministic model responses; deployed services and physical pen input are not exercised."] };
let server, win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    if (cloud) server.prependListener("request", request => { if (request.url.startsWith("/canvas/")) request.url = request.url.slice(7); });
    win = new BrowserWindow({ show:false, width:1200, height:1000, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    win.webContents.on("console-message", event => { if (event.level === "error") report.errors.push(event.message); });
    const js = code => win.webContents.executeJavaScript(code, true),
      until = async condition => { const deadline = Date.now() + 20000; while (!await js(condition)) { if (Date.now() > deadline) throw Error("Timed out: " + condition); await pause(40); } },
      check = (name, condition, value) => { report.checks.push({name,pass:Boolean(condition),state:value}); if (!baseline) assert.ok(condition, name + ": " + JSON.stringify(value)); };
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await js("noteDirtyTest.init()");
    await js("noteDirtyTest.reportedLoop=true");
    await js("(async()=>{const t=noteDirtyTest;t.connected=true;t.target=await t.prepare(true);t.before=await t.hash();await t.organizeSuggestAsNote(t.target);})()");
    await until("noteDirtyTest.read().widgets===1&&!noteDirtyTest.state.activeAI");
    const reported=await js("({oldDirtyPixels:noteDirtyTest.oldDirtyPixels(),...noteDirtyTest.read()})");
    check('Reported overlapping loop with varying pen width has no remaining dirty pixels',reported.oldDirtyPixels===0,reported);
    check('Reported loop source raster is preserved',await js("noteDirtyTest.hash().then(hash=>hash===noteDirtyTest.before)"));
    await js("noteDirtyTest.state.userRevision++;noteDirtyTest.undo()");
    await until("noteDirtyTest.read().widgets===0");
    const undoneLoop=await js("noteDirtyTest.oldDirtyPixels()");
    check('Undo restores pressure-varying loop input',undoneLoop>0,{oldDirtyPixels:undoneLoop});
    await js("noteDirtyTest.state.userRevision++;noteDirtyTest.redo()");
    await until("noteDirtyTest.read().widgets===1");
    const redoneLoop=await js("noteDirtyTest.oldDirtyPixels()");
    check('Redo consumes pressure-varying loop input again',redoneLoop===0,{oldDirtyPixels:redoneLoop});
    await js("noteDirtyTest.draw([{x:240,y:350},{x:340,y:350}]);noteDirtyTest.draw([{x:740,y:110},{x:820,y:110}]);noteDirtyTest.addObjects()");
    for(const scenario of [{name:'auto',options:{}},{name:'manual-orb',options:{captureCurrentViewport:true}},{name:'suggestion',options:{attentionBox:{x:100,y:80,w:740,h:300},focusAttention:true}},{name:'capture-retry',options:{}}]){
      if(scenario.name==='capture-retry')await js("noteDirtyTest.failCapture=true");
      const result=await js(`noteDirtyTest.nextRequest(${JSON.stringify(scenario.options)})`),{request,...shades}=result;
      fs.writeFileSync(path.join(output,scenario.name+'-request.png'),Buffer.from(request.atlasImage.split(',')[1],'base64'));
      check(scenario.name+': every object and stroke inside the dirty bounding rectangle stays dark, including clean context',result.old<70&&result.fresh<70&&result.outside<70&&result.image<70&&result.text<70,shades);
    }
    await js("noteDirtyTest.consumeOutside()");
    const narrowed=await js("noteDirtyTest.nextRequest()"),{request:narrowedRequest,...narrowedShades}=narrowed;
    fs.writeFileSync(path.join(output,'new-input-only-request.png'),Buffer.from(narrowedRequest.atlasImage.split(',')[1],'base64'));
    check('Consumed enclosure does not expand the next dirty rectangle; old content outside it is faded',narrowed.old>=110&&narrowed.fresh<70&&narrowedRequest.changedBox.y>=260,{...narrowedShades,changedBox:narrowedRequest.changedBox});
    const focus=await js("noteDirtyTest.nextRequest({attentionBox:{x:120,y:90,w:440,h:250}})");
    check('Explicit follow-up keeps the requested clean target readable at full contrast',focus.old<70,{old:focus.old});
    await js("noteDirtyTest.clearDirtyContributionTracking();noteDirtyTest.state.dirty=null");
    const viewport=await js("noteDirtyTest.nextRequest({captureCurrentViewport:true})");
    check('Manual request without pending input keeps the whole viewport at full contrast',viewport.old<70&&viewport.fresh<70,{old:viewport.old,fresh:viewport.fresh});
    await js("noteDirtyTest.reportedLoop=false");
    for (const scenario of [{name:'local-lasso',enclosed:false,connected:false,response:'note'},{name:'local-pen',enclosed:true,connected:false,response:'note'},{name:'ai-lasso',enclosed:false,connected:true,response:'note'},{name:'fallback-lasso',enclosed:false,connected:true,response:'failure'},{name:'ai-pen',enclosed:true,connected:true,response:'note'},{name:'fallback-pen',enclosed:true,connected:true,response:'failure'}]) {
      await js(`(async()=>{const t=noteDirtyTest;t.connected=${scenario.connected};t.response=${JSON.stringify(scenario.response)};t.target=await t.prepare(${scenario.enclosed});t.before=await t.hash();await t.organizeSuggestAsNote(t.target);})()`);
      await until("noteDirtyTest.read().widgets===1&&!noteDirtyTest.state.activeAI");
      await pause(120);
      const value = await js("noteDirtyTest.read()"), unchanged = await js("noteDirtyTest.hash().then(hash=>hash===noteDirtyTest.before)");
      check(scenario.name + ': committed note consumes captured input', !value.inside && (!scenario.enclosed || !value.ring), value);
      check(scenario.name + ': source pixels survive and dirty consumption matches the request scope', unchanged && (scenario.enclosed ? !value.outside && !value.dirty : value.outside > 0), value);
      if(scenario.connected){
        const request=await js("noteDirtyTest.requests.at(-1)");
        check(scenario.name+': request uses the matching canvas or lasso scope',scenario.enclosed ? !request.selectionContext && request.changedBox.x+request.changedBox.w>=820 : request.selectionContext?.closed===true && request.selectionContext.path.length===4 && request.sourceRect.x+request.sourceRect.w<700,{changedBox:request.changedBox,sourceRect:request.sourceRect,selectionContext:request.selectionContext});
      }
      check(scenario.name + ': input snapshots are released', !value.snapshots, value);
      if (scenario.name === 'local-pen') {
        await js("noteDirtyTest.state.userRevision++;noteDirtyTest.undo()");
        await until("noteDirtyTest.read().widgets===0");
        const undone = await js("noteDirtyTest.read()");
        check('Undo note restores the pending pen input', undone.inside > 0 && undone.ring > 0 && undone.outside > 0, undone);
        await js("noteDirtyTest.state.userRevision++;noteDirtyTest.redo()");
        await until("noteDirtyTest.read().widgets===1");
        const redone = await js("noteDirtyTest.read()");
        check('Redo note restores consumption', !redone.inside && !redone.ring && !redone.outside && !redone.dirty, redone);
      }
      if (scenario.name === 'ai-pen') {
        await js("noteDirtyTest.closeNoteChooser();noteDirtyTest.render()");
        await pause(120);
        fs.writeFileSync(path.join(output, "pen-note.png"), (await win.webContents.capturePage()).toPNG());
      }
    }
    // Exercise the production pointer-start path: this supersedes the request
    // before committing new ink, unlike calling the raster stroke helper alone.
    for (const {stage,enclosed} of [{stage:'media',enclosed:true},{stage:'response',enclosed:true},{stage:'render',enclosed:true},{stage:'response',enclosed:false},{stage:'request-prepare',enclosed:true},{stage:'request-prepare',enclosed:false}]) {
      await js(`(async()=>{const t=noteDirtyTest;t.connected=true;t.response=${JSON.stringify(stage==='render'?'note':'hold-note')};t.pauseCapture=${stage==='media'};t.pauseRender=${stage==='render'};t.pausePreparation=${stage==='request-prepare'};t.resumePreparation=null;t.resumeCapture=null;t.resumeRender=null;t.target=await t.prepare(${enclosed});t.pending=t.organizeSuggestAsNote(t.target);})()`);
      await until(stage==='media'?"Boolean(noteDirtyTest.resumeCapture)":stage==='render'?"Boolean(noteDirtyTest.resumeRender)":stage==='request-prepare'?"Boolean(noteDirtyTest.resumePreparation)":"Boolean(noteDirtyTest.reply)");
      if(stage==='render')check('Input is temporarily cleared before result commit',await js("!noteDirtyTest.state.dirty&&noteDirtyTest.state.activeAI.inputCleared"));
      await js("noteDirtyTest.penInput()");
      const cancelled=await js("({...noteDirtyTest.read(),fresh:noteDirtyTest.alpha(300,350),active:Boolean(noteDirtyTest.state.activeAI)})");
      check((enclosed?'canvas ':'lasso ')+stage+': new pen input cancels work and retains old plus new dirty',!cancelled.active&&cancelled.inside>0&&(!enclosed||cancelled.ring>0)&&cancelled.outside>0&&cancelled.fresh>0,cancelled);
      await js(stage==='media'?"noteDirtyTest.pauseCapture=false;noteDirtyTest.resumeCapture()":stage==='render'?"noteDirtyTest.pauseRender=false;noteDirtyTest.resumeRender()":stage==='request-prepare'?"noteDirtyTest.pausePreparation=false;noteDirtyTest.resumePreparation()":"noteDirtyTest.reply()");
      await until("!noteDirtyTest.state.activeAI&&noteDirtyTest.read().snapshots===0");
      await pause(100);
      check(stage+': cancelled capture or late response cannot create a Note or consume input',await js("noteDirtyTest.read().widgets===0&&noteDirtyTest.read().inside>0&&noteDirtyTest.alpha(300,350)>0"));
    }
    await js(`(async()=>{const t=noteDirtyTest;t.connected=true;t.response='hold';t.target=await t.prepare(true);await t.organizeSuggestAsNote(t.target);})()`);
    await until("Boolean(noteDirtyTest.reply)");
    await js("noteDirtyTest.supersedeActiveAI('user-stop');noteDirtyTest.reply()");
    await until("!noteDirtyTest.state.activeAI&&noteDirtyTest.read().snapshots===0");
    const stopped=await js("noteDirtyTest.read()");
    check('Stopped note retains all input and creates no fallback',stopped.inside>0&&stopped.ring>0&&stopped.outside>0&&!stopped.widgets,stopped);
    await js("(async()=>{const t=noteDirtyTest;t.connected=true;t.response='note';t.target=await t.prepare(true);t.smartSuggest.enabled=true;await t.organizeSuggestAsNote(t.target);})()");
    await until("!noteDirtyTest.state.activeAI&&noteDirtyTest.read().widgets===1&&Boolean(noteDirtyTest.smartSuggestResultCluster())");
    const followup=await js("({dirty:noteDirtyTest.state.dirty,mode:noteDirtyTest.smartSuggest.bar?.mode,result:noteDirtyTest.smartSuggestResultCluster()?.result,box:noteDirtyTest.smartSuggestResultCluster()?.box})");
    check('Generated Note remains eligible for next suggestions after user dirty is consumed',!followup.dirty&&followup.result,followup);
    await js("(async()=>{const t=noteDirtyTest;t.response='empty';const cluster=t.smartSuggestResultCluster(),target={box:cluster.box,newBox:cluster.box,strokes:[],followUp:true};await t.executeAssistAction({id:'explain'},target);await target.requestPromise;})()");
    await until("!noteDirtyTest.state.activeAI");
    const next=await js("({request:noteDirtyTest.requests.at(-1),dirty:noteDirtyTest.state.dirty})");
    check('Next suggestion can request the clean generated result',next.request.suggestion==='explain'&&!next.dirty,{suggestion:next.request.suggestion,changedBox:next.request.changedBox,dirty:next.dirty});
    assert.deepEqual(report.errors, []);
  } catch (error) { report.failure = error.stack; process.exitCode = 1; }
  finally {
    win?.destroy(); server?.closeAllConnections?.(); if (server) await new Promise(resolve => server.close(resolve));
    report.serverClosed = !server?.listening;
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    fs.rmSync(temporary, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
  }
  console.log(JSON.stringify(report));
  app.exit(process.exitCode || 0);
});
