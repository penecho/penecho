"use strict";
// Real Canvas acceptance: masked input consumption and Suggest execution paths.
// Uses an isolated document and intercepted model responses; no external requests.
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{Readable}=require("node:stream"),sharp=require("sharp");
const root=path.resolve(__dirname,".."),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-suggest-consumption-"));
const cloud=process.argv.includes("--cloud"),clientFile=cloud?path.resolve(root,"../penecho_cloud/public/canvas/app.js"):path.join(root,"public/app.js");
const directory=path.resolve(process.argv.find(value=>value.startsWith("--output="))?.slice(9)||temporary);
fs.mkdirSync(directory,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([fs.readFileSync(clientFile,"utf8").replace(/\}\)\(\);\s*$/,`
    if(${cloud})window.PENECHO_CONFIG.runtime='cloud';
    // Both shells use the same isolated test connection; no account sessions.
    requireAiConnectionSelection=()=>true;selectedAiConnectionId=()=>"test-connection";aiConnectionScope=()=>"test-scope";
    window.consumptionTest={aiPreparing:()=>Boolean(aiPreparation),state,tiles,smartSuggest,canvasDocumentsReady,smartSuggestCluster,smartSuggestSyncDocument,smartSuggestCropRegion,smartSuggestCrop,smartSuggestRecordStroke,stroke,clearDirtyContributionTracking,captureSelection,cancelSelection,buildSelectionImage,captureDirtyInput,captureSelectionDirtyInput,consumeDirtyInput,releaseDirtyInput,dirtyInputContains,executeAssistAction,applySmartShapeSnap,acceptPending,rejectPending,supersedeActiveAI,requestSelectionAI,render,offscreen,assistAgent,canvasAgent,assistAgentFinishResult,canvasDocumentsCurrent,TILE,DIRTY_MASK_SCALE};
    window.commandRequests=[];window.commandMode='success';
    window.drawCheckPreview=language=>{
      state.language=language;smartSuggest.enabled=true;smartSuggest.available=true;smartSuggest.localReadyAt=0;
      cancelAnimationFrame(smartSuggest.frame);trackAssist=()=>{};
      const visible=viewportRect(),box={x:visible.x+visible.w*.25,y:visible.y+visible.h*.35,w:120/state.scale,h:70/state.scale},cluster={key:'check-label',box,newBox:box,strokes:[],recentIds:new Set()};
      setStatusKey('ready');
      renderAssist({mode:'suggest',box,cluster,view:{source:'penecho-llm',kind:'math_expr',confident:true,routing:{},items:[{id:'check_step',p:.8},{id:'solve',p:.1},{id:'hint',p:.05}],more:[]}});
      const bar=smartSuggest.bar.element,rect=bar.getBoundingClientRect();
      return {label:bar.querySelector('.assist-action')?.textContent,visible:rect.width>0&&rect.height>0,bounded:rect.left>=0&&rect.right<=innerWidth+1&&rect.top>=document.querySelector('#viewport').getBoundingClientRect().top&&rect.bottom<=innerHeight,buttonsFit:[...bar.querySelectorAll('button')].every(button=>button.scrollWidth<=button.clientWidth+1)};
    };
    window.drawRoundShapePreview=language=>{
      hideAssist('shape-preview');cancelSelection(true);tiles.clear();state.inkBounds.clear();clearDirtyContributionTracking();
      state.history=[];state.widgets=[];state.images=[];state.textBoxes=[];state.hotspotTrail=[];state.latestTypedInput=null;
      smartSuggest.documentId=null;smartSuggestSyncDocument();smartSuggest.enabled=true;smartSuggest.available=false;smartSuggest.localReadyAt=0;smartSuggest.jev=null;
      cancelAnimationFrame(smartSuggest.frame);trackAssist=()=>{};state.language=language;
      const visible=viewportRect(),cx=visible.x+visible.w*.4,cy=visible.y+visible.h*.3,r=35/state.scale;
      const paths=[Array.from({length:40},(_,i)=>({x:cx+r*Math.cos(i/39*Math.PI*2),y:cy+r*Math.sin(i/39*Math.PI*2)})),[{x:cx-r*2,y:cy+r*2.4},{x:cx+r*3,y:cy+r*2.4}]];
      const strokes=paths.map(points=>{
        const entry={};state.history.push(entry);
        for(let i=1;i<points.length;i++)stroke(points[i-1],points[i],false,4/state.scale,true,'#111827');
        const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);
        const record={id:smartSuggest.nextStrokeId++,points,box:{x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y},size:4/state.scale,at:Date.now(),historyEntry:entry};
        smartSuggestRecordStroke(record);return record;
      });
      const box={x:cx-r*2,y:cy-r,w:r*5,h:r*3.4},cluster={key:'round-shape-'+language,box,newBox:box,strokes,recentIds:new Set(strokes.map(record=>record.id))};
      const view=assistView(cluster);renderAssist({mode:'suggest',box,cluster,view});render();
      const bar=smartSuggest.bar.element,rect=bar.getBoundingClientRect(),actions=[...bar.querySelectorAll('[data-suggestion]')].map(button=>button.dataset.suggestion);
      return {actions,text:bar.textContent,visible:rect.width>0&&rect.height>0,bounded:rect.left>=0&&rect.right<=innerWidth+1&&rect.top>=document.querySelector('#viewport').getBoundingClientRect().top&&rect.bottom<=innerHeight,buttonsFit:[...bar.querySelectorAll(':scope>button')].every(button=>button.scrollWidth<=button.clientWidth+1)};
    };
    const originalFetch=window.fetch;
    window.fetch=(url,options)=>{
      if(url==='/api/ai/command'){
        commandRequests.push(JSON.parse(options.body));
        const mode=commandMode;
        if(mode==='hold')return new Promise(resolve=>window.finishCommand=()=>resolve(new Response(JSON.stringify({commands:[]}),{headers:{'Content-Type':'application/json'}})));
        const response=mode==='failure'?{error:'Test failure'}:{commands:mode==='empty'?[]:[{tool:'write_text',text:'Checked.',x:500,y:420,w:180,h:40,maxWidth:180,fontSize:24,color:'#2563eb'}]};
        return Promise.resolve(new Response(JSON.stringify(response),{status:mode==='failure'?503:200,headers:{'Content-Type':'application/json'}}));
      }
      if(String(url).endsWith('/suggest'))return Promise.resolve(new Response(JSON.stringify({ok:true,answers:{kind:{type:'choice',choice:'notes',probabilities:{notes:1}},action:{type:'choice',choice:'none',probabilities:{none:1}},finished:{noul:1}}}),{headers:{'Content-Type':'application/json'}}));
      return originalFetch(url,options);
    };
  })();`)]);
  return readStream.call(this,file,...args);
};
let server,win;
const report={runtime:cloud?'cloud':'local',clientFile,checks:[],errors:[]};
app.whenReady().then(async()=>{
  try{
    server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
    win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    win.webContents.on("console-message",(_event,level,message)=>{if(level>=3)report.errors.push(message);});
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const result=await win.webContents.executeJavaScript(`(async()=>{
      const t=consumptionTest,s=t.state,a=t.smartSuggest,checks=[],captures={};
      await t.canvasDocumentsReady();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();
      s.auto=false;s.mode='pen';s.scale=1;s.panX=0;s.panY=0;a.enabled=false;
      const check=(condition,message)=>{if(!condition)throw Error(message);checks.push(message);};
      const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
      const settle=async(accept=true)=>{for(let i=0;i<400;i++){if(s.pending){accept?t.acceptPending({restoreMode:false}):t.rejectPending();}if(!t.aiPreparing()&&!s.activeAI&&!s.selection?.aiRequest){await pause();return;}await pause();}throw Error('Request did not settle: '+document.querySelector('#status')?.textContent);};
      const reset=()=>{t.supersedeActiveAI('test-reset');t.cancelSelection(true);t.tiles.clear();s.inkBounds.clear();t.clearDirtyContributionTracking();s.history=[];s.redo=[];s.images=[];s.textBoxes=[];s.widgets=[];s.hotspotTrail=[];s.latestTypedInput=null;a.strokes=[];a.consumedStrokeId=0;a.dismissedStrokeId=0;a.resultTarget=null;a.documentId=null;t.smartSuggestSyncDocument();a.bar=null;commandMode='success';};
      const add=(x,y,w=80,h=0)=>{
        const points=[{x,y},{x:x+w,y:y+h}],entry={};s.history.push(entry);
        t.stroke(points[0],points[1],false,8,true,'#111827');
        const record={id:a.nextStrokeId++,points,box:{x,y,w,h},at:Date.now(),size:8,historyEntry:entry};t.smartSuggestRecordStroke(record);return a.strokes.at(-1);
      };
      const dirtyAt=(x,y)=>{const tx=Math.floor(x/t.TILE),ty=Math.floor(y/t.TILE),mask=s.dirtyInkTiles.get(tx+','+ty);if(!mask)return 0;return mask.getContext('2d').getImageData(Math.floor((x-tx*t.TILE)*t.DIRTY_MASK_SCALE),Math.floor((y-ty*t.TILE)*t.DIRTY_MASK_SCALE),1,1).data[3];};
      const lasso=()=>{t.captureSelection([{x:80,y:80},{x:250,y:80},{x:250,y:250},{x:180,y:250},{x:180,y:160},{x:80,y:160}]);return {selection:s.selection,box:s.selection.box,selectionKey:'selection:'+a.selectionVersion};};
      const capture=(name,box)=>{captures[name]={image:t.smartSuggestCrop({box},box),region:box};};
      reset();const selected=add(100,110),excluded=add(100,210),outside=add(330,110);
      const target=lasso(),snapshot=t.captureSelectionDirtyInput(target.selection);
      add(140,110,20);t.consumeDirtyInput(snapshot);
      check(!dirtyAt(120,110),'masked snapshot clears captured pixels');
      check(dirtyAt(150,110)>0,'later overlapping strokes stay dirty');
      check(dirtyAt(120,210)>0&&dirtyAt(350,110)>0,'concave-mask exclusions and outside input stay dirty');
      check(selected.inputConsumed&&!excluded.inputConsumed&&!outside.inputConsumed,'only fully selected stroke records retire');
      check(!t.dirtyInputContains(snapshot,{x:90,y:100,w:120,h:130}),'concave boundary crossing cannot consume a partly selected object');
      t.cancelSelection(true);
      const objects=[{id:'inside',x:100,y:100,w:20,h:20,text:'a'},{id:'cutout',x:100,y:200,w:20,h:20,text:'b'},{id:'changed',x:200,y:100,w:20,h:20,text:'c'}];
      s.textBoxes=objects.map(o=>Object.assign(o,{image:t.offscreen(20,20)}));s.dirtyTextBoxIds=new Set(objects.map(o=>o.id));
      const objectTarget=lasso(),objectSnapshot=t.captureSelectionDirtyInput(objectTarget.selection);objects[2].text='new';t.consumeDirtyInput(objectSnapshot);
      check(!s.dirtyTextBoxIds.has('inside')&&s.dirtyTextBoxIds.has('cutout')&&s.dirtyTextBoxIds.has('changed'),'text objects outside the mask or changed after capture stay dirty');
      t.cancelSelection(true);
      // Every model-backed selection action shares the masked completion path.
      for(const id of ['check_step','solve','next_step','hint','practice','typeset','answer','create_visual','explain','diagram','organize','vivid','finish_drawing','plot']){
        reset();add(100,110);add(100,210);add(330,110);const target=lasso(),before=commandRequests.length;
        await t.executeAssistAction({id},target);await settle();
        check(commandRequests.length===before+1,id+' submits its selected image');
        check(!dirtyAt(120,110)&&dirtyAt(120,210)>0&&dirtyAt(350,110)>0,id+' clears only the successful lasso input');
        if(id==='check_step'){t.cancelSelection(true);add(320,210,0,60);capture('after-check-new-writing',{x:80,y:80,w:310,h:200});}
      }
      for(const mode of ['failure','empty','reject','hold']){
        reset();add(100,110);const target=lasso();commandMode=mode==='reject'?'success':mode;
        await t.executeAssistAction({id:'check_step'},target);
        if(mode==='hold'){for(let i=0;i<200&&!window.finishCommand;i++)await pause();t.supersedeActiveAI('user-stop');finishCommand();}
        await settle(mode!=='reject');
        check(dirtyAt(120,110)>0,mode+' retains unfulfilled selected input');
      }

      for(const id of ['prototype','animate','animate_sketch']){
        reset();add(100,110);add(100,210);add(330,110);const target=lasso();
        t.assistAgent.resultTarget={...target,action:id,inputSnapshot:t.captureSelectionDirtyInput(target.selection),generation:t.assistAgent.generation,documentId:t.canvasDocumentsCurrent().id,conversationId:t.canvasAgent.currentConversation?.id,resultBox:{x:500,y:420,w:100,h:50},strokeId:a.strokes.at(-1).id};
        t.stroke({x:500,y:420},{x:590,y:450},false,5,false,'#2563eb');t.assistAgentFinishResult(true);
        check(!dirtyAt(120,110)&&dirtyAt(120,210)>0&&dirtyAt(350,110)>0,id+' Agent completion consumes only its masked input');
      }
      reset();add(100,110);const agentTarget=lasso();
      t.assistAgent.resultTarget={...agentTarget,inputSnapshot:t.captureSelectionDirtyInput(agentTarget.selection),generation:t.assistAgent.generation,documentId:t.canvasDocumentsCurrent().id,conversationId:t.canvasAgent.currentConversation?.id,resultBox:{x:500,y:420,w:100,h:50}};
      t.assistAgentFinishResult(false);check(dirtyAt(120,110)>0,'failed Agent completion retains selected input');
      // Ordinary AI completion clears all input actually submitted by that request.
      for(const id of ['check_step','solve','next_step','hint','practice','answer','create_visual','explain','diagram','organize','vivid','finish_drawing','plot']){
        reset();const record=add(100,110);await t.executeAssistAction({id},{box:{x:80,y:80,w:170,h:100},newBox:record.box,strokes:[record],followUp:id==='answer'});await settle();
        check(!dirtyAt(120,110),id+' consumes ordinary AI input after Keep');
      }
      // Internal Typeset extraction must not clear unrelated dirty input early.
      reset();const record=add(100,110);add(430,210);const generation=s.recognitionGeneration;
      await t.executeAssistAction({id:'typeset'},{box:{x:80,y:80,w:170,h:80},strokes:[record]});
      check(s.recognitionGeneration===generation&&dirtyAt(450,210)>0,'Typeset preserves unrelated dirty input during extraction');
      await settle();check(!dirtyAt(120,110)&&dirtyAt(450,210)>0,'Typeset success consumes only its extracted input');
      reset();const rough=add(100,110,80,20);add(330,110);
      t.applySmartShapeSnap([{strokes:[rough],outline:[{x:100,y:110},{x:180,y:110}]}]);
      check(!dirtyAt(140,120)&&dirtyAt(350,110)>0,'Shape cleanup clears source dirt and preserves other input');
      check(!dirtyAt(140,110),'generated exact shapes are clean context');
      reset();const removedSource=add(100,110),requestCount=commandRequests.length,consumed=a.consumedStrokeId;
      await t.executeAssistAction({id:'let_fall'},{box:removedSource.box,strokes:[removedSource]});await pause();
      check(dirtyAt(120,110)>0&&!removedSource.inputConsumed&&a.consumedStrokeId===consumed,'removed Let it fall action preserves source handwriting and pending input');
      check(!s.widgets.length&&commandRequests.length===requestCount,'removed Let it fall action creates no Widget or AI request');
      return {checks,captures,requests:commandRequests.map(r=>({suggestion:r.suggestion,userAction:r.userAction,selectionContext:!!r.selectionContext})),dirtyBounds:s.dirty};
    })()`);
    report.checks=result.checks;report.requests=result.requests;
    for(const [name,capture]of Object.entries(result.captures)){
      const bytes=Buffer.from(capture.image.split(',')[1],'base64');fs.writeFileSync(path.join(directory,name+'.webp'),bytes);
      const {data,info}=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
      const pixels=(box)=>{let dark=0,gray=0;for(let y=box.y;y<box.y+box.h;y++)for(let x=box.x;x<box.x+box.w;x++){const i=(y*info.width+x)*info.channels;if(data[i]<75&&data[i+1]<75&&data[i+2]<75)dark++;else if(data[i]>90&&data[i]<175&&data[i+1]>90&&data[i+1]<175)gray++;}return {dark,gray};};
      const old=pixels({x:12,y:23,w:90,h:16}),fresh=pixels({x:232,y:122,w:20,h:75});
      assert.equal(old.dark,0,'checked source becomes faded context');assert.ok(old.gray>100);assert.ok(fresh.dark>100);
      report.pixels={old,fresh,width:info.width,height:info.height};
    }
    assert.deepEqual(report.errors,[]);
    report.ui=[];
    for(const [language,width]of [['en',1200],['zh',600]]){
      win.setSize(width,900);const ui=await win.webContents.executeJavaScript(`drawCheckPreview(${JSON.stringify(language)})`);
      assert.ok(ui.visible&&ui.bounded&&ui.buttonsFit,JSON.stringify(ui));assert.ok(ui.label.includes(language==='zh'?'检查':'Check'));
      await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const screenshot=await win.webContents.capturePage();fs.writeFileSync(path.join(directory,`check-${language}-${width}.png`),screenshot.toPNG());report.ui.push({language,width,...ui});
      const shapeUi=await win.webContents.executeJavaScript(`drawRoundShapePreview(${JSON.stringify(language)})`);
      assert.ok(shapeUi.visible&&shapeUi.bounded&&shapeUi.buttonsFit,JSON.stringify(shapeUi));
      assert.ok(shapeUi.actions.includes('snap_shapes'));assert.ok(!shapeUi.actions.includes('let_fall'));assert.doesNotMatch(shapeUi.text,/Let it fall|让它落下/i);
      await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,200))');
      const shapeScreenshot=await win.webContents.capturePage();fs.writeFileSync(path.join(directory,`round-shape-${language}-${width}.png`),shapeScreenshot.toPNG());report.ui.push({language,width,scenario:'round-shape',...shapeUi});
    }
  }finally{
    win?.destroy();server?.closeAllConnections?.();if(server)await new Promise(resolve=>server.close(resolve));report.serverClosed=!server?.listening;
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify(report));
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
