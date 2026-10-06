"use strict";
// Real canonical client with an isolated local profile and offline note capture.
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict"),{Readable}=require("node:stream");
const root=path.resolve(__dirname,".."),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-note-suggest-")),output=path.resolve(process.env.PENECHO_VERIFY_OUTPUT||path.join(root,"docs/verification/suggest-note-ranking-20261004"));
const cloud=process.argv.includes("--cloud"),clientRoot=cloud?path.resolve(root,"../penecho_cloud/public/canvas"):path.join(root,"public");
fs.mkdirSync(output,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false"});
const readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([fs.readFileSync(path.join(clientRoot,"app.js"),"utf8").replace(/\}\)\(\);\s*$/,`
    window.noteSuggestTest={state,smartSuggest,canvasDocumentsReady,assistView,assistNoteScope,renderAssist,captureSelection,render,hideAssist,applyLanguage,renderedTextBoxRecord,positionAssist};
    const originalExecuteAssistAction=executeAssistAction;
    executeAssistAction=(item,target)=>noteSuggestTest.recordActions ? noteSuggestTest.lastAction={id:item.id,box:target.box,routing:target.routing} : originalExecuteAssistAction(item,target);
    hasSelectedAiConnection=()=>false;
  })();`)]);
  if(path.resolve(String(file))===path.join(root,"public/style.css"))return readStream.call(this,path.join(clientRoot,"style.css"),...args);
  return readStream.call(this,file,...args);
};
const report={runtime:cloud?"cloud-mirror":"local",checks:[],layouts:[],errors:[]},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let server,win;
app.whenReady().then(async()=>{try{
  server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
  win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on("console-message",(_event,level,message)=>{if(level>=3)report.errors.push(message);});
  const js=code=>win.webContents.executeJavaScript(code,true),shot=async name=>fs.writeFileSync(path.join(output,name+".png"),(await win.webContents.capturePage()).toPNG());
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  await js(`(async()=>{const t=noteSuggestTest;await t.canvasDocumentsReady();t.state.auto=false;t.state.language='zh';t.applyLanguage();t.smartSuggest.available=false;t.state.scale=1;t.state.panX=0;t.state.panY=0;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();})()`);
  const fixture=await js(`(async()=>{const t=noteSuggestTest,s=t.state;const source={id:'inside',text:'这是需要保存的一大片研究笔记。问题是如何保留原始信息并建立清晰的笔记结构。第一部分记录背景和假设，第二部分记录实验结果，第三部分记录后续验证步骤。内容应该完整保存，圈外文字不应进入笔记。',x:160,y:140,w:360,h:220,fontSize:20,color:'#202938'},outside={id:'outside',text:'OUTSIDE CONTENT MUST NOT BE CAPTURED',x:660,y:140,w:340,h:90,fontSize:18,color:'#202938'};s.textBoxes=await Promise.all([source,outside].map(item=>t.renderedTextBoxRecord({...item,maxWidth:item.w})));s.history=[{}];s.userRevision++;t.render();return source.text;})()`);
  const layout=()=>js(`(()=>{const e=document.querySelector('.assist-bar'),r=e.getBoundingClientRect(),controls=[...e.children].filter(node=>node.matches('button,.assist-ask,.assist-more')),rows=controls.map(node=>node.getBoundingClientRect());return {width:innerWidth,left:r.left,right:r.right,height:r.height,oneRow:Math.max(...rows.map(box=>box.top))<Math.min(...rows.map(box=>box.bottom)),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,visible:[...e.querySelectorAll(':scope > .assist-action')].map(b=>b.dataset.suggestion),overflow:[...e.querySelectorAll('.assist-menu > [data-suggestion]')].map(b=>b.dataset.suggestion)};})()`);
  const checkLayout=async name=>{const value=await layout();assert.ok(value.left>=-1&&value.right<=value.width+1,JSON.stringify(value));assert.ok(value.scrollWidth<=value.clientWidth+1,JSON.stringify(value));assert.ok(value.oneRow,JSON.stringify(value));report.layouts.push({name,...value});await shot(name);return value;};
  // Ordinary local suggestions do not invent a Note button.
  await js(`(()=>{const t=noteSuggestTest,stroke={id:1,at:performance.now(),size:4,points:[{x:170,y:150},{x:280,y:150}],box:{x:170,y:150,w:110,h:4},historyEntry:t.state.history[0]};t.smartSuggest.strokes=[stroke];const c={key:'plain',strokes:[stroke],recentIds:new Set([1]),box:{x:150,y:130,w:390,h:240},newBox:{x:170,y:150,w:110,h:4}};t.renderAssist({mode:'suggest',cluster:c,view:t.assistView(c),box:c.box});})()`);
  let order=await js(`[...document.querySelectorAll('.assist-bar > .assist-action')].map(b=>b.dataset.suggestion)`);assert.ok(!order.includes("note"));assert.ok(order.length<=3);report.checks.push({scope:"ordinary",order});await pause(150);await checkLayout("ordinary-local");
  await js(`noteSuggestTest.fixtureTexts=noteSuggestTest.state.textBoxes`);
  await js(`(async()=>{const t=noteSuggestTest,s=t.state;s.textBoxes=[await t.renderedTextBoxRecord({id:'formula',text:'z = x² + y²',x:160,y:140,w:300,h:80,maxWidth:300,fontSize:32,color:'#202938'})];s.userRevision++;t.render();const record={id:3,at:performance.now(),size:4,exact:true,points:[{x:160,y:150},{x:420,y:150}],box:{x:160,y:140,w:260,h:70},historyEntry:s.history[0]},box={x:150,y:130,w:280,h:90},cluster={key:'formula',strokes:[record],recentIds:new Set([3]),box,newBox:box};t.smartSuggest.strokes=[record];t.smartSuggest.jev={key:cluster.key,strokeIds:new Set([3]),answers:{kind:{type:'choice',choice:'math_expr',probabilities:{math_expr:1}},action:{type:'choice',choice:'plot',probabilities:{plot:0.86,explain:0.09,typeset:0.04,note:0.001,none:0.009}}}};t.renderAssist({mode:'suggest',cluster,view:t.assistView(cluster),box});})()`);
  const ranked=await js(`noteSuggestTest.smartSuggest.bar.view.items.map(item=>item.id)`);assert.equal(ranked[0],"plot");assert.ok(!ranked.includes("note"));
  for(const language of ["zh","en"]){
    await js(`(()=>{const t=noteSuggestTest;t.state.language=${JSON.stringify(language)};t.applyLanguage();const b=t.smartSuggest.bar;t.renderAssist({mode:'suggest',cluster:b.cluster,view:b.view,box:b.box});})()`);
    for(const width of [1440,640,390,320,1440]){win.setContentSize(width,1000);await pause(200);const measured=await checkLayout("formula-"+language+"-"+width);assert.deepEqual([...measured.visible,...measured.overflow].slice(0,ranked.length),ranked,"overflow preserves the ranked order");}
  }
  win.setContentSize(390,1000);await pause(200);
  const overflowAction=await js(`(()=>{const t=noteSuggestTest,b=t.smartSuggest.bar;t.recordActions=true;b.element.querySelector('.assist-more > button').click();const button=b.element.querySelector('.assist-menu > [data-suggestion]'),expected=button.dataset.suggestion;button.click();t.recordActions=false;return {expected,actual:t.lastAction.id,sameScope:JSON.stringify(t.lastAction.box)===JSON.stringify(b.target.box),sameRouting:t.lastAction.routing===b.target.routing,menuOpen:b.menu};})()`);
  assert.equal(overflowAction.actual,overflowAction.expected);assert.ok(overflowAction.sameScope&&overflowAction.sameRouting&&overflowAction.menuOpen);report.checks.push("An overflow action still invokes the original action id, source scope and saved routing verdict.");
  await js(`noteSuggestTest.smartSuggest.bar.element.querySelector('.assist-more > button').click()`);
  await js(`noteSuggestTest.smartSuggest.bar.element.querySelector('.assist-ask button').click()`);await pause(100);await checkLayout("formula-ask-open");
  await js(`(()=>{const t=noteSuggestTest,b=t.smartSuggest.bar;t.renderAssist({mode:'suggest',cluster:b.cluster,view:b.view,box:b.box});})()`);await pause(100);
  await js(`noteSuggestTest.smartSuggest.bar.element.querySelector('.assist-close').click()`);assert.equal(await js("noteSuggestTest.smartSuggest.bar"),null);report.checks.push("Formula rankings contain no forced Note; English and Chinese controls stay on one row at 320–1440 px; overflow preserves action order; Ask and dismissal remain usable.");
  win.setContentSize(1440,1000);await pause(100);
  await js(`(()=>{const t=noteSuggestTest;t.state.language='zh';t.applyLanguage();t.smartSuggest.jev=null;t.smartSuggest.strokes=[];t.smartSuggest.dismissedStrokeId=0;t.state.textBoxes=t.fixtureTexts;t.state.history=[{}];t.state.userRevision++;t.render();})()`);
  // A substantial actual lasso selection promotes the same action.
  await js(`(()=>{const t=noteSuggestTest;t.captureSelection([{x:130,y:110},{x:560,y:110},{x:560,y:390},{x:130,y:390}]);const c={key:'selected',selection:t.state.selection,strokes:[],recentIds:new Set(),box:{...t.state.selection.box}};t.renderAssist({mode:'suggest',cluster:c,view:t.assistView(c),box:c.box});})()`);
  order=await js(`[...document.querySelectorAll('.assist-bar > .assist-action')].map(b=>b.dataset.suggestion)`);assert.equal(order[0],"note");report.checks.push({scope:"large_text",order});await pause(150);await shot("selected-text-primary");
  // An ordinary pen loop has no active selection until the user clicks Note.
  await js(`(()=>{const t=noteSuggestTest;t.state.selection=null;t.state.userRevision++;const points=Array.from({length:65},(_,i)=>({x:345+235*Math.cos(i/64*Math.PI*2),y:250+170*Math.sin(i/64*Math.PI*2)})),stroke={id:2,at:performance.now(),size:4,points,box:{x:110,y:80,w:470,h:340},historyEntry:t.state.history[0]};t.smartSuggest.strokes=[stroke];const c={key:'enclosed',strokes:[stroke],recentIds:new Set([2]),box:{x:100,y:70,w:910,h:350},newBox:stroke.box};t.render();t.renderAssist({mode:'suggest',cluster:c,view:t.assistView(c),box:c.box});})()`);
  order=await js(`[...document.querySelectorAll('.assist-bar > .assist-action')].map(b=>b.dataset.suggestion)`);assert.equal(order[0],"note");assert.equal(await js("noteSuggestTest.state.selection"),null);report.checks.push({scope:"enclosed",order});await pause(150);await shot("enclosed-primary");
  for(const width of [1440,390]){
    win.setContentSize(width,1000);await pause(200);
    const measured=await checkLayout("enclosed-"+width);assert.equal(measured.visible[0],"note");
  }
  await js(`document.querySelector('.assist-action[data-suggestion="note"]').click()`);
  for(let n=0;n<120&&!(await js("noteSuggestTest.state.widgets.some(w=>w.sourceFormat==='penecho-note-card+json')"));n++)await pause(100);
  const captured=await js(`(()=>{const s=noteSuggestTest.state,w=s.widgets.find(w=>w.sourceFormat==='penecho-note-card+json');return {note:w&&JSON.parse(w.copyText),texts:s.textBoxes.map(t=>t.text),selection:s.selection};})()`);
  assert.ok(captured.note);const content=JSON.stringify(captured.note);assert.ok(content.includes(fixture));assert.ok(!content.includes("OUTSIDE CONTENT"));assert.ok(captured.texts.includes(fixture));assert.equal(captured.selection,null);
  report.checks.push("Clicking the real ordinary Note button creates a note from the enclosed text, excludes outside text, and retains the original Canvas text.");await shot("captured-note");assert.deepEqual(report.errors,[]);
}catch(error){report.failure=error.stack;process.exitCode=1;console.error(error);}finally{
  fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));if(win&&!win.isDestroyed())win.destroy();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode||0);
}});
