"use strict";
// Real Canvas renderer acceptance with isolated storage and a mocked AI reply.
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict"),{Readable}=require("node:stream");
const root=path.resolve(__dirname,".."),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-note-selection-media-")),
  output=path.resolve(process.argv.find(arg=>arg.startsWith("--output="))?.slice(9)||path.join(root,"docs/verification/note-selection-media-20261006"));
fs.mkdirSync(output,{recursive:true});
app.setPath("userData",path.join(temporary,"profile"));app.disableHardwareAcceleration();
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const injection=`
  window.noteMediaTest={state,smartSuggest,canvasDocumentsReady,noteCardInsert,noteCardSource,noteCards,noteCaptureSelection,noteMergeModelNote,organizeSuggestAsNote,captureSelection,cancelSelection,renderAssist,render,stroke,save,undo,redo,acceptPendingWidget,rejectPendingWidget,closeNoteChooser,dirtyInputSnapshots,ensureWidgetSnapshots,requests:[],connected:true,response:'note'};
  const organizeMediaNote=organizeSuggestAsNote;
  organizeSuggestAsNote=target=>noteMediaTest.pending=organizeMediaNote(target);
  noteMediaTest.init=async()=>{await canvasDocumentsReady();markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);closeFeatureTour({retry:false,changelog:false});markChangelogSeen();document.querySelector('#canvasWelcome').hidden=true;state.auto=false;smartSuggest.enabled=false;state.language='en';state.scale=.6;state.panX=state.panY=0;state.viewInitialized=true;};
  hasSelectedAiConnection=()=>noteMediaTest.connected;
  requireAiConnectionSelection=()=>true;selectedAiConnectionId=()=>"test-connection";aiConnectionScope=()=>"test-scope";
  const mediaFetch=fetch;
  fetch=async(url,options)=>{
    if(url==='/api/ai/command'){
      noteMediaTest.requests.push(JSON.parse(options.body));
      await new Promise(resolve=>noteMediaTest.reply=resolve);
      const note=noteCardRuntime().normalize({title:'Organized large selection',blocks:[{type:'markdown',text:'Both source cards and handwriting organized.'}]});
      const commands=noteMediaTest.response==='note'?[{tool:'html_widget',...noteCardWidgetFields(note),x:100,y:100,w:600,h:800}]:[];
      return new Response(JSON.stringify({commands}),{headers:{'Content-Type':'application/json'}});
    }
    if(String(url).endsWith('/suggest/status'))return new Response(JSON.stringify({configured:false}),{headers:{'Content-Type':'application/json'}});
    return mediaFetch(url,options);
  };
  noteMediaTest.fixture=async()=>{
    const originals=[];
    for(let index=0;index<2;index++){
      const canvas=offscreen(400,260),context=canvas.getContext('2d'),pixels=context.createImageData(400,260);let seed=123456+index;
      for(let i=0;i<pixels.data.length;i+=4){for(let c=0;c<3;c++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i+c]=seed>>>24;}pixels.data[i+3]=255;}
      context.putImageData(pixels,0,0);
      const note=noteCardRuntime().normalize({title:'Source card '+(index+1),blocks:[{type:'markdown',text:'Source text '+(index+1)},{type:'image',src:canvas.toDataURL('image/png'),w:400,h:260}]});
      const widget=await noteCardInsert(note,{x:350+index*700,y:300,w:550,h:730});originals.push({id:widget.id,copyText:widget.copyText});
    }
    closeNoteChooser();
    for(const [a,b] of [[{x:450,y:1200},{x:600,y:1100}],[{x:600,y:1100},{x:650,y:1230}]])stroke(a,b,false,8,true,'#111827');save();
    noteMediaTest.originals=originals;noteMediaTest.select();render();
    const parts={items:state.widgets.map(widget=>({kind:'note',note:noteCardSource(widget)})),ink:null};
    let beforeError='';try{noteCardRuntime().noteFromParts(parts);}catch(error){beforeError=error.message;}
    return {mediaChars:parts.items.reduce((sum,item)=>sum+item.note.blocks.reduce((value,block)=>value+(block.src?.length||0),0),0),beforeError};
  };
  noteMediaTest.select=()=>{
    if(state.selection)cancelSelection(true);
    captureSelection([{x:250,y:200},{x:1750,y:200},{x:1750,y:1350},{x:250,y:1350}]);
    const selection=state.selection,box={...selection.box};
    renderAssist({mode:'suggest',cluster:{box,newBox:box,strokes:[],selection,key:'selection:'+smartSuggest.selectionVersion},view:{items:[{id:'note',source:'local'}],more:[],confident:false,source:'local'},box});
  };
  noteMediaTest.unchanged=()=>noteMediaTest.originals.every(original=>state.widgets.find(widget=>widget.id===original.id)?.copyText===original.copyText);
  noteMediaTest.inkPixels=()=>{const c=offscreen(300,220),context=c.getContext('2d');forTiles(400,1050,300,220,(tile,tx,ty)=>context.drawImage(tile,tx*TILE-400,ty*TILE-1050),false);return c.toDataURL();};
`;
const client=require("./build-client.js").compiledSource(),read=fs.createReadStream;
fs.createReadStream=function(file,...args){return path.resolve(String(file))===path.join(root,"public/app.js")?Readable.from([client.replace(/\}\)\(\);\s*$/,injection+"})();")]):read.call(this,file,...args);};
const report={canonicalSource:true,isolatedStorage:true,mockedModel:true,checks:[],errors:[]};let server,win;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  try{
    server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
    win=new BrowserWindow({show:false,width:1440,height:1100,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    win.webContents.on("console-message",event=>{if(event.level==='error'&&!/favicon|ResizeObserver/.test(event.message))report.errors.push(event.message);});
    const js=code=>win.webContents.executeJavaScript(code,true),until=async expression=>{const deadline=Date.now()+20000;while(!await js(expression)){if(Date.now()>deadline)throw Error("Timed out: "+expression);await pause(50);}},
      shot=async name=>fs.writeFileSync(path.join(output,name+".png"),(await win.webContents.capturePage()).toPNG());
    const renderedNote=async()=>{
      const deadline=Date.now()+20000;
      while(Date.now()<deadline){
        for(const frame of win.webContents.mainFrame.framesInSubtree.filter(frame=>frame.url==='about:srcdoc')){
          try{
            const content=await frame.executeJavaScript("(()=>{const images=[...document.querySelectorAll('.nc-body img')];return images.length===3&&images.every(image=>image.complete&&image.naturalWidth>0)?{title:document.querySelector('.nc-title').textContent,images:images.length,ink:!!document.querySelector('.nc-ink img')}:null;})()");
            if(content)return content;
          }catch{}
        }
        await pause(50);
      }
      throw Error('The new Note did not render all copied images and handwriting.');
    };
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);await js("noteMediaTest.init()");
    report.fixture=await js("noteMediaTest.fixture()");assert.ok(report.fixture.mediaChars>600000);assert.match(report.fixture.beforeError,/inline images/);
    const originalInk=await js("noteMediaTest.inkPixels()");
    await shot("large-selection");
    await js("document.querySelector('[data-suggestion=note]').click()");await until("noteMediaTest.reply && noteMediaTest.requests.length===1");
    assert.equal(await js("noteMediaTest.requests[0].suggestion"),"note");assert.equal(await js("noteMediaTest.unchanged()"),true);
    await shot("request-started");report.checks.push("Clicking Organize as Note starts an AI request for two source Notes whose combined inline media exceeds 600000 characters.");
    await js("noteMediaTest.reply()");await until("!noteMediaTest.state.activeAI && noteMediaTest.state.widgets.length===3");
    report.result=await js("(()=>{const widget=noteMediaTest.state.widgets.at(-1),note=noteMediaTest.noteCardSource(widget);return {title:note.title,blocks:note.blocks.map(b=>b.type),mediaChars:note.blocks.reduce((sum,b)=>sum+(b.src?.length||0),0),sourceChars:widget.copyText.length};})()");
    assert.equal(report.result.title,'Organized large selection');
    assert.equal(report.result.blocks.filter(type=>type==='image').length,2);assert.equal(report.result.blocks.filter(type=>type==='ink').length,1);
    assert.ok(report.result.mediaChars<600000);assert.ok(report.result.sourceChars<640000);assert.equal(await js("noteMediaTest.unchanged()"),true);
    assert.equal(await js("noteMediaTest.inkPixels()"),originalInk);
    report.rendered=await renderedNote();assert.equal(report.rendered.title,'Organized large selection');assert.equal(report.rendered.ink,true);
    await js("(async()=>{noteMediaTest.closeNoteChooser();await noteMediaTest.ensureWidgetSnapshots([noteMediaTest.state.widgets.at(-1)]);noteMediaTest.render();await new Promise(requestAnimationFrame);})()");await pause(200);await shot("ai-note");
    assert.equal(await js("noteMediaTest.unchanged()"),true);
    await js("noteMediaTest.undo()");assert.equal(await js("noteMediaTest.state.widgets.length"),2);assert.equal(await js("noteMediaTest.unchanged()"),true);
    await js("noteMediaTest.redo()");assert.equal(await js("noteMediaTest.state.widgets.length"),3);assert.equal(await js("noteMediaTest.unchanged()"),true);
    report.checks.push("The AI Note retains both copied images and handwriting within Note limits; insertion, Undo and Redo preserve both original cards and source ink pixels.");
    await js("noteMediaTest.undo();noteMediaTest.connected=false;noteMediaTest.select();document.querySelector('[data-suggestion=note]').click()");
    await js("noteMediaTest.pending");
    await until("noteMediaTest.state.widgets.length===3");report.offline=await js("(()=>{const n=noteMediaTest.noteCardSource(noteMediaTest.state.widgets.at(-1));return {blocks:n.blocks.map(b=>b.type),originals:noteMediaTest.unchanged()};})()");
    assert.equal(report.offline.blocks.filter(type=>type==='image').length,2);assert.equal(report.offline.blocks.filter(type=>type==='ink').length,1);assert.equal(report.offline.originals,true);
    assert.equal(await js("noteMediaTest.inkPixels()"),originalInk);
    await js("noteMediaTest.closeNoteChooser()");await shot("offline-note");report.checks.push("The same oversized selection also creates an offline Note with both pictures, native source text and handwriting.");
    await js("noteMediaTest.undo();noteMediaTest.connected=true;noteMediaTest.response='empty';noteMediaTest.reply=null;noteMediaTest.select();document.querySelector('[data-suggestion=note]').click()");
    await until("noteMediaTest.reply && noteMediaTest.requests.length===2");await js("noteMediaTest.reply()");
    await until("!noteMediaTest.state.activeAI && noteMediaTest.state.widgets.length===3 && noteMediaTest.dirtyInputSnapshots.size===0");
    assert.equal(await js("noteMediaTest.unchanged()"),true);assert.equal(await js("noteMediaTest.inkPixels()"),originalInk);
    assert.equal(await js("noteMediaTest.noteCardSource(noteMediaTest.state.widgets.at(-1)).blocks.filter(b=>b.type==='image').length"),2);
    report.checks.push("An empty AI response creates the compact local fallback without an unhandled rejection or source loss.");
    assert.deepEqual(report.errors,[]);
  }catch(error){report.failure=error.stack;process.exitCode=1;if(win&&!win.isDestroyed())try{report.failureState=await win.webContents.executeJavaScript("({requests:noteMediaTest.requests.length,widgets:noteMediaTest.state.widgets.length,active:!!noteMediaTest.state.activeAI,selection:!!noteMediaTest.state.selection,bar:noteMediaTest.smartSuggest.bar?.mode,status:noteMediaTest.state.statusKey,snapshots:noteMediaTest.dirtyInputSnapshots.size})");}catch{}}
  finally{win?.destroy();server?.closeAllConnections?.();if(server)await new Promise(resolve=>server.close(resolve));report.serverClosed=!server?.listening;fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2)+"\n");fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
  console.log(JSON.stringify(report));app.exit(process.exitCode||0);
});
