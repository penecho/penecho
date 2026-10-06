"use strict";
// Real renderer acceptance with isolated data and intercepted model responses.
// Run: tools/electron/node_modules/.bin/electron scripts/verify-typeset-selection.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "typeset-selection-")),
  baseline = process.argv.includes("--baseline"),
  cloud = process.argv.includes("--cloud"),
  clientFile = cloud ? path.resolve(root,"../penecho_cloud/public/canvas/app.js") : path.join(root,"public/app.js"),
  clientSource = fs.readFileSync(clientFile,"utf8"),
  output = path.resolve(process.env.PENECHO_VERIFY_OUTPUT || path.join(root, "docs/verification/typeset-selection-20261002", baseline ? "before" : "after"));
fs.mkdirSync(output, {recursive:true});
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, {NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary,"state"), PENECHO_CONFIG_FILE:path.join(temporary,"config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false"});
const injection = `
  const testFetch=fetch;
  window.typesetTest={state,smartSuggest,tiles,canvasDocumentsReady,loadCanvasSettings,storeAiConnectionSelection,settings,render,stroke,save,undo,redo,captureSelection,captureInkSelection,selectionPathFor,cancelSelection,acceptPending,rejectPending,executeAssistAction,organizeSuggestAsNote,ensureWidgetSnapshots,renderAssist,setCanvasMode,markChangelogSeen,requests:[],responseMode:'success'};
  typesetTest.dismissTour=()=>{markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);closeFeatureTour({retry:false,changelog:false});};
  fetch=async(url,options)=>{
    if(String(url)==='/api/ai/command') {
      typesetTest.requests.push(JSON.parse(options.body));
      await new Promise(resolve=>{typesetTest.reply=resolve;});
      const mode=typesetTest.responseMode,commands=mode==='empty'?[]:[{tool:'write_text',text:'hello',x:600,y:400,fontSize:56,maxWidth:260,lineHeight:1.35}];
      if(mode==='batch')commands.push({tool:'draw_formula',latex:'x^2',x:610,y:510,fontSize:44});
      if(mode==='note')commands.splice(0,commands.length,{tool:'html_widget',...noteCardWidgetFields(noteCardRuntime().normalize({version:1,title:'Captured source note',blocks:[{type:'markdown',text:'Source content preserved in a Note.'}]})),x:600,y:400,w:600,h:700});
      return new Response(JSON.stringify(mode==='failure'?{error:'Test response unavailable'}:{requestId:'typeset-test',commands}),{status:mode==='failure'?503:200,headers:{'content-type':'application/json'}});
    }
    if(String(url)==='/api/suggest/status')return new Response(JSON.stringify({configured:false}),{headers:{'content-type':'application/json'}});
    return testFetch(url,options);
  };
  ${baseline ? `releaseSelectionAITransformLock=run=>{
    run ||= state.activeAI;
    const selection=run?.isolatedSelection?run.selection:null,token=run?.selectionRequestToken;
    if(!selection||!token||selection.aiRequest?.token!==token||state.selection!==selection)return;
    selection.aiRequest=null;updateSelectionToolbar();
  };` : ""}
  typesetTest.sourcePixels=async()=>{
    const capture=document.createElement('canvas');capture.width=270;capture.height=160;
    const context=capture.getContext('2d',{willReadFrequently:true});
    for(const [key,tile]of tiles){const [x,y]=key.split(',').map(Number);context.drawImage(tile,x*TILE-280,y*TILE-380);}
    const pixels=context.getImageData(0,0,270,160).data,
      digest=await crypto.subtle.digest('SHA-256',pixels);
    if(!typesetTest.originalPixels)typesetTest.originalPixels=pixels.slice();
    let changed=0,maxDelta=0,alphaChanged=0,maxAlphaDelta=0;
    for(let i=0;i<pixels.length;i++){
      const delta=Math.abs(pixels[i]-typesetTest.originalPixels[i]);
      if(delta){changed++;maxDelta=Math.max(maxDelta,delta);if(i%4===3){alphaChanged++;maxAlphaDelta=Math.max(maxAlphaDelta,delta);}}
    }
    typesetTest.sourceDiff={changedChannels:changed,maxDelta,alphaChanged,maxAlphaDelta};
    return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
  };
  typesetTest.outlinePixels=()=>{
    const d=devicePixelRatio||1,x=Math.max(0,Math.floor((state.panX+250*state.scale)*d)),y=Math.max(0,Math.floor((state.panY+350*state.scale)*d)),
      w=Math.min(interactionLayer.width-x,Math.ceil(330*state.scale*d)),h=Math.min(interactionLayer.height-y,Math.ceil(220*state.scale*d));
    if(w<=0||h<=0)return 0;
    const pixels=interactionCtx.getImageData(x,y,w,h).data;let count=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>100&&pixels[i]<90&&pixels[i+1]>70&&pixels[i+2]>130)count++;
    return count;
  };
  typesetTest.prepare=(region=false)=>{
    if(state.pending)rejectPending();if(state.selection)cancelSelection(true);
    state.scale=1;state.panX=0;state.panY=0;state.auto=false;state.aiColor='#2563eb';setCanvasMode('pen');
    smartSuggest.enabled=true;smartSuggest.available=false;
    const box={x:280,y:380,w:270,h:160};
    if(region)captureSelection([{x:280,y:380},{x:550,y:380},{x:550,y:540},{x:280,y:540}]);
    renderAssist({mode:'suggest',cluster:{box,newBox:box,strokes:[],selection:region?state.selection:null,key:region?'selection:'+smartSuggest.selectionVersion:'test-ink'},view:{items:[{id:'typeset',source:'local'}],more:[],confident:false,source:'local'},box});
    render();typesetTest.reply=null;
  };
`;
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root,"public/app.js")) return Readable.from([clientSource.replace(/\}\)\(\);\s*$/, injection + "})();")]);
  return readStream.call(this,file,...args);
};
const report = {baseline,runtime:cloud?"isolated-cloud-mirror-client":"isolated-local-client",clientSHA256:require("node:crypto").createHash("sha256").update(clientSource).digest("hex"),checks:[],errors:[]};
let server, win;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({show:false,width:1440,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    win.webContents.on("console-message", (_event,level,message) => {if(level>=3)report.errors.push(message);});
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const js = code => win.webContents.executeJavaScript(code,true),
      waitFor = expression => js(`(async()=>{const start=performance.now();while(!(${expression})){if(performance.now()-start>10000)throw Error('Timed out: '+${JSON.stringify(expression)});await new Promise(resolve=>setTimeout(resolve,20));}})()`),
      screenshot = async name => fs.writeFileSync(path.join(output, name + ".png"),(await win.webContents.capturePage()).toPNG());
    await js(`(async()=>{const t=typesetTest;await t.canvasDocumentsReady();await t.loadCanvasSettings();t.storeAiConnectionSelection(t.settings.connections[0].id);t.markChangelogSeen();t.dismissTour();document.querySelector('#changelogClose')?.click();
      const paths=[[[300,410],[300,500],[305,455],[320,440],[340,450],[340,500]],[[370,465],[398,458],[390,443],[373,445],[365,460],[368,484],[390,494],[406,483]],[[424,490],[424,410],[416,483],[427,498]],[[458,490],[458,410],[450,483],[461,498]],[[485,460],[494,446],[511,450],[522,465],[514,487],[497,492],[485,482],[485,460]]];
      for(const points of paths)for(let i=1;i<points.length;i++)t.stroke({x:points[i-1][0],y:points[i-1][1]},{x:points[i][0],y:points[i][1]},false,5,true,'#111827');t.save();t.render();})()`);
    const original = await js("typesetTest.sourcePixels()"), initialHistory = await js("typesetTest.state.history.length");
    await js("typesetTest.prepare(true);typesetTest.render()");
    report.manualLasso = await js("({origin:typesetTest.state.selection.origin,outlinePixels:typesetTest.outlinePixels()})");
    assert.equal(report.manualLasso.origin,"lasso");
    assert.ok(report.manualLasso.outlinePixels>300,"a manually selected lasso must retain its blue outline");
    await screenshot("manual-lasso-selected");
    await js("const t=typesetTest,s=t.state.selection;t.captureInkSelection(t.selectionPathFor(s),s);s.box={...s.box,x:s.box.x+8,w:s.box.w+12};t.render()");
    assert.equal(await js("typesetTest.state.selection.origin"),"lasso","lifting ink for a manual transform preserves its lasso origin");
    assert.ok(await js("typesetTest.outlinePixels()")>300,"the blue lasso outline follows transformed content");
    await screenshot("manual-lasso-transformed");
    await js("typesetTest.cancelSelection(true)");
    assert.deepEqual(await js("typesetTest.sourcePixels()"),original);
    assert.equal(await js("typesetTest.outlinePixels()"),0);
    report.checks.push("Manual lasso selection retains its blue outline through ink lifting and transforms; cancelling restores the source pixels");
    const start = async (mode, region=false) => {
      await js(`typesetTest.responseMode=${JSON.stringify(mode)};typesetTest.prepare(${region});document.querySelector('[data-suggestion="typeset"]').click()`);
      await waitFor("typesetTest.reply && typesetTest.state.selection?.aiRequest");
      await js("new Promise(requestAnimationFrame)");
      assert.equal(await js("typesetTest.outlinePixels()"),0,"Typeset hides the source outline while its request is in progress");
    };
    const ready = async () => {
      await js("typesetTest.reply()");
      await waitFor("typesetTest.state.pending?.revealProgress === 1");
      await js("new Promise(requestAnimationFrame)");
    };
    await start("success");
    report.request = await js("({selected:!!typesetTest.state.selection,busy:!!typesetTest.state.selection?.aiRequest,outlinePixels:typesetTest.outlinePixels()})");
    await js("new Promise(resolve=>setTimeout(resolve,250))");
    assert.equal(await js("typesetTest.outlinePixels()"),0,"the source outline stays hidden while waiting for the response");
    await screenshot("request-selection");
    report.checks.push("The source remains selected during the request without drawing its blue outline or handles");
    await ready();
    report.draft = await js("({selected:!!typesetTest.state.selection,outlinePixels:typesetTest.outlinePixels(),pending:!!typesetTest.state.pending,bar:typesetTest.smartSuggest.bar?.mode,status:typesetTest.state.statusKey})");
    await screenshot("draft-ready");
    if (baseline) {
      assert.equal(report.draft.selected,true);
      assert.ok(report.draft.outlinePixels > 300);
      await js("typesetTest.acceptPending()");
      await waitFor("!typesetTest.state.activeAI");
      assert.equal(await js("!!typesetTest.state.selection"),true,"reproduce the persistent source box after accepting Typeset");
      await screenshot("accepted");
      report.checks.push("The previous release hook reproduces the source outline after the draft appears and after Keep");
    } else {
      assert.equal(report.draft.selected,false);
      assert.equal(report.draft.outlinePixels,0);
      assert.equal(report.draft.pending,true);
      assert.equal(report.draft.bar,"result");
      const restored = await js("typesetTest.sourcePixels()");
      report.sourceDiff = await js("typesetTest.sourceDiff");
      assert.deepEqual(restored,original,"Typeset restores the original source pixels exactly");
      assert.equal(await js("typesetTest.state.history.length"),initialHistory,"ending the selection adds no undo step");
      report.checks.push("A single Typeset draft removes the source outline, preserves its pixels exactly, and retains result controls");
      await js("[...document.querySelectorAll('.assist-action')].find(button=>button.textContent.includes('Retry')).click()");
      await waitFor("typesetTest.requests.length===2 && typesetTest.reply && typesetTest.state.selection?.aiRequest");
      await ready();
      assert.equal(await js("typesetTest.state.selection"),null);
      await js("typesetTest.acceptPending()");
      await waitFor("!typesetTest.state.activeAI");
      assert.equal(await js("typesetTest.state.selection"),null);
      assert.deepEqual(await js("typesetTest.sourcePixels()"),original);
      await screenshot("accepted");
      await js("typesetTest.undo()");
      assert.deepEqual(await js("typesetTest.sourcePixels()"),original);
      assert.equal(await js("typesetTest.state.selection"),null);
      await js("typesetTest.redo()");
      assert.deepEqual(await js("typesetTest.sourcePixels()"),original);
      report.checks.push("Retry, Keep, Undo and Redo work without restoring the source outline or losing source ink");
      await start("batch",true);await ready();
      assert.equal(await js("typesetTest.state.selection"),null);
      assert.equal(await js("typesetTest.state.pending.items.length"),2);
      await screenshot("batch-draft");
      await js("typesetTest.rejectPending()");await waitFor("!typesetTest.state.activeAI");
      assert.deepEqual(await js("typesetTest.sourcePixels()"),original);
      report.checks.push("A lasso Typeset batch also closes its source selection; rejecting it preserves the handwriting");
      for (const mode of ["failure","empty"]) {
        await start(mode);await js("typesetTest.reply()");
        await waitFor("!typesetTest.state.activeAI && !typesetTest.state.selection?.aiRequest");
        assert.equal(await js("!!typesetTest.state.selection"),true);
        await js("typesetTest.render()");
        assert.equal(await js("typesetTest.outlinePixels()"),0,"failed automatic Typeset scope must stay frameless");
        await screenshot("auto-"+mode+"-no-frame");
        await waitFor("!!document.querySelector('.assist-close')");
        await js("document.querySelector('.assist-close').click()");
        assert.equal(await js("typesetTest.state.selection"),null);
        assert.deepEqual(await js("typesetTest.sourcePixels()"),original);
      }
      report.checks.push("Failed and empty responses retain a cancellable automatic scope without a blue frame; closing it restores the handwriting");
      await start("failure",true);await js("typesetTest.reply()");
      await waitFor("!typesetTest.state.activeAI && !typesetTest.state.selection?.aiRequest");
      await js("typesetTest.render()");
      assert.equal(await js("typesetTest.state.selection.origin"),"lasso");
      assert.ok(await js("typesetTest.outlinePixels()")>300,"failed AI requests preserve the user's manual lasso selection");
      await screenshot("manual-lasso-after-failed-request");
      await js("typesetTest.cancelSelection(true)");
      assert.deepEqual(await js("typesetTest.sourcePixels()"),original);
      report.checks.push("A failed request restores the existing manual lasso outline while automatic captures remain frameless");
      await start("success");
      await js("document.querySelector('#aiOrb').click();typesetTest.reply()");
      await waitFor("!typesetTest.state.activeAI && !typesetTest.state.selection?.aiRequest");
      await js("typesetTest.render()");
      assert.equal(await js("typesetTest.outlinePixels()"),0,"stopping automatic Typeset cannot reveal its blue frame");
      await screenshot("auto-stop-no-frame");
      await js("typesetTest.cancelSelection(true)");
      assert.deepEqual(await js("typesetTest.sourcePixels()"),original);
      report.checks.push("Stopping automatic Typeset also leaves no blue frame and preserves source ink");
      await start("success",true);
      await js("typesetTest.cancelSelection();typesetTest.reply()");
      await waitFor("!typesetTest.state.activeAI && !typesetTest.state.selection");
      assert.deepEqual(await js("typesetTest.sourcePixels()"),original);
      assert.equal(await js("typesetTest.outlinePixels()"),0);
      report.checks.push("Cancelling a Typeset request preserves the original handwriting and leaves no source outline");
      await js("typesetTest.prepare(true);document.activeElement?.blur()");
      win.webContents.sendInputEvent({type:"keyDown",keyCode:"Escape"});
      win.webContents.sendInputEvent({type:"keyUp",keyCode:"Escape"});
      await waitFor("!typesetTest.state.selection");
      report.checks.push("Escape manually clears an active selection");
      await js("typesetTest.responseMode='success';typesetTest.prepare(true);typesetTest.executeAssistAction({id:'solve'},{selection:typesetTest.state.selection,selectionKey:'selection:'+typesetTest.smartSuggest.selectionVersion,box:{...typesetTest.state.selection.box}})");
      await waitFor("typesetTest.reply && typesetTest.state.selection?.aiRequest");
      await js("typesetTest.render()");
      assert.equal(await js("typesetTest.outlinePixels()"),0);
      await ready();
      assert.equal(await js("typesetTest.state.selection"),null);
      await screenshot("solve-draft-no-frame");
      await js("typesetTest.rejectPending()");await waitFor("!typesetTest.state.activeAI");
      assert.deepEqual(await js("typesetTest.sourcePixels()"),original);
      report.checks.push("Solve also hides the AI source frame, releases its selection, retains draft controls and preserves source pixels");

      const noteHistory = await js("typesetTest.state.history.length");
      await js("typesetTest.responseMode='note';typesetTest.reply=null;typesetTest.organizeSuggestAsNote({box:{x:280,y:380,w:270,h:160},strokes:[]})");
      await waitFor("typesetTest.reply && typesetTest.state.activeAI");
      assert.equal(await js("typesetTest.state.selection"),null,"automatic Note requests do not create a lasso selection");
      await js("typesetTest.render()");
      assert.equal(await js("typesetTest.outlinePixels()"),0);
      await screenshot("note-request-no-frame");
      await js("typesetTest.reply()");
      await waitFor("!typesetTest.state.activeAI && !typesetTest.state.selection && typesetTest.state.widgets.length===1");
      await js("typesetTest.render()");
      const noteCapture = await js("typesetTest.ensureWidgetSnapshots(typesetTest.state.widgets,{currentFrame:true})");
      assert.equal(noteCapture.complete,true,"the generated Note is rendered before screenshot acceptance");
      await js("new Promise(resolve=>setTimeout(resolve,400))");
      await js("typesetTest.render()");
      assert.equal(await js("typesetTest.outlinePixels()"),0);
      assert.deepEqual(await js("typesetTest.sourcePixels()"),original);
      assert.equal(await js("typesetTest.state.history.length"),noteHistory+1);
      await screenshot("note-completed-no-frame");
      await js("typesetTest.undo()");assert.equal(await js("typesetTest.state.widgets.length"),0);
      assert.deepEqual(await js("typesetTest.sourcePixels()"),original);
      await js("typesetTest.redo()");assert.equal(await js("typesetTest.state.widgets.length"),1);
      assert.deepEqual(await js("typesetTest.sourcePixels()"),original);
      report.checks.push("Organize as Note never creates a lasso or automatic source frame and preserves source pixels through one-step Undo/Redo");
      win.setContentSize(390,900);
      await js("new Promise(resolve=>setTimeout(resolve,100))");
      await start("success");
      await js("typesetTest.state.scale=0.6;typesetTest.state.panX=-150;typesetTest.render()");
      await screenshot("narrow-request");
      await ready();
      assert.equal(await js("typesetTest.state.selection"),null);
      assert.equal(await js("typesetTest.outlinePixels()"),0);
      await screenshot("narrow-draft");
      await js("typesetTest.rejectPending()");await waitFor("!typesetTest.state.activeAI");
      report.checks.push("The narrow viewport also ends the source selection when the draft appears");
    }
    assert.deepEqual(report.errors,[]);
    report.ok = true;
  } catch (error) {
    report.ok = false;report.failure = error.stack;
  } finally {
    fs.createReadStream = readStream;
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2)+"\n");
    console.log(JSON.stringify(report,null,2));
    win?.destroy();server?.closeAllConnections?.();
    if(server)await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temporary,{recursive:true,force:true});
    app.exit(report.ok ? 0 : 1);
  }
});
