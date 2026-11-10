"use strict";
// Explicitly invoked Electron acceptance harness; no model requests or user profile.
const {app,BrowserWindow,nativeTheme}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const ROOT=path.resolve(__dirname,".."),directory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-mcp-browser-"));
const useLan=process.argv.includes("--lan"),lanHost=Object.values(os.networkInterfaces()).flat().find(entry=>entry&&!entry.internal&&(entry.family==="IPv4"||entry.family===4))?.address;
if(useLan&&!lanHost)throw Error("A local LAN interface is required for --lan acceptance.");
app.setPath("userData",path.join(directory,"electron"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(directory,"state"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"mcp-test-key",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"mcp-test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false"});
if(useLan)process.env.HOST="0.0.0.0";
let server,window,canvasSocket;
const report={directory,errors:[],checks:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(check,label){for(let i=0;i<100;i++){if(await check())return;await pause(100);}throw Error(`Timed out: ${label}`);}
app.whenReady().then(async()=>{
  try{
    server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
    server.on("upgrade",(request,socket)=>{if(request.url==="/api/mcp/canvas")canvasSocket=socket;});
    const origin=`http://${useLan?lanHost:"127.0.0.1"}:${server.address().port}`;
    window=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    window.webContents.on("console-message",(_event,level,message)=>{if(level>=3)report.errors.push(message);});
    await window.loadURL(origin);
    const js=code=>window.webContents.executeJavaScript(code,true);
    await waitFor(()=>js("!!document.querySelector('#settingsBtn')"),"canvas startup");
    await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click()");
    await js("document.querySelector('#settingsBtn').click();document.querySelector('#settingsNavMcp').click()");
    await waitFor(()=>js("!document.querySelector('#mcpCopyInstructions').disabled"),"MCP configuration");
    assert.equal(await js("document.querySelector('#mcpConfigure').disabled"),false,"configuration works before opting in the canvas");
    if(useLan){
      await js("window.mcpTestFetch=window.fetch;window.fetch=(input,options)=>String(input)==='/api/mcp/status'?Promise.resolve(new Response(JSON.stringify({error:{code:'forbidden'}}),{status:403,headers:{'Content-Type':'application/json'}})):window.mcpTestFetch(input,options);document.querySelector('#mcpRefresh').click()");
      await waitFor(()=>js("document.querySelector('#mcpConfigure').disabled&&!document.querySelector('#mcpConfigStatus').hidden"),"visible configuration failure");
      assert.equal(await js("document.querySelector('#mcpCopyInstructions').disabled"),true,"incomplete setup cannot be copied");
      assert.equal(await js("document.querySelector('#mcpConfigStatus').hidden"),false,"copying must not hide the configuration failure");
      window.setSize(700,900);await pause(150);
      await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelector('#mcpConfigStatus').scrollIntoView({block:'center'})");await pause(150);
      assert.equal(await js("(()=>{const notice=document.querySelector('#mcpConfigStatus'),rect=notice.getBoundingClientRect();return notice.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));})()"),true,"the configuration error must be visible to the user");
      fs.writeFileSync(path.join(directory,'settings-load-error.png'),(await window.webContents.capturePage()).toPNG());
      await js("window.fetch=window.mcpTestFetch;delete window.mcpTestFetch;document.querySelector('#mcpRefresh').click()");
      await waitFor(()=>js("!document.querySelector('#mcpConfigure').disabled&&document.querySelector('#mcpConfigStatus').hidden"),"configuration retry");window.setSize(1440,1000);
      report.checks.push({name:"same-host-lan-configuration-and-recovery",ok:true});
    }
    // Exercise setup feedback without modifying any real AI client's configuration.
    await js("window.mcpFeedbackFetch=window.fetch;window.fetch=(input,options)=>String(input)==='/api/mcp/configure'?new Promise(resolve=>{window.mcpFeedbackResolve=resolve;}):window.mcpFeedbackFetch(input,options);document.querySelector('#mcpConfigure').click()");
    assert.equal(await js("document.querySelector('#mcpConfigure').textContent"),"Configuring…");
    for(const [name,status,payload,width,zoom] of [["pending",null,null,700,1],["saved",200,{configured:true},1440,1],["existing",422,{configured:false,existing:true,error:"Already exists"},700,1],["failed",422,{error:"CLI was not found"},1440,2]]){
      if(status!==null){
        if(name!=="saved")await js("document.querySelector('#mcpConfigure').click()");
        await js(`window.mcpFeedbackResolve(new Response(JSON.stringify(${JSON.stringify(payload)}),{status:${status},headers:{'Content-Type':'application/json'}}))`);
        await waitFor(()=>js("document.querySelector('#mcpConfigure').getAttribute('aria-busy')==='false'"),`setup ${name}`);
      }
      window.setSize(width,1000);window.webContents.setZoomFactor(zoom);await pause(250);
      await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelector('#mcpConfigureStatus').scrollIntoView({block:'center'})");await pause(200);
      assert.equal(await js("(()=>{const e=document.querySelector('#mcpConfigureStatus'),r=e.getBoundingClientRect();return !e.hidden&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))&&e.scrollWidth<=e.clientWidth+1;})()"),true,`setup ${name} feedback visible without overflow`);
      fs.writeFileSync(path.join(directory,`setup-${name}.png`),(await window.webContents.capturePage()).toPNG());
    }
    await js("window.fetch=window.mcpFeedbackFetch;delete window.mcpFeedbackFetch;delete window.mcpFeedbackResolve;document.querySelector('#mcpClient').dispatchEvent(new Event('change'))");
    window.setSize(1440,1000);window.webContents.setZoomFactor(1);
    report.checks.push({name:"configuration-feedback-pending-saved-existing-failed",ok:true});
    await js("document.querySelector('#mcpEnabled').click()");
    const {readRecords,recordsDirectory}=require("../src/server/mcp/records.js"),{bridgeRequest}=require("../src/server/mcp/stdio.js");
    const record=readRecords(recordsDirectory(process.env.PENECHO_STATE_DIR))[0],ownerId=crypto.randomUUID();
    const call=async(name,args)=>{const start=performance.now(),result=await bridgeRequest(record,{ownerId,operation:"call",name,arguments:args});report.checks.push({name,elapsedMs:Math.round(performance.now()-start)});return result;};
    let listed;await waitFor(async()=>{listed=await call("penecho_list_canvases",{});return listed.canvases.length===1;},"canvas opt in");
    await js("document.querySelector('#settingsClose').click()");await pause(200);
    fs.writeFileSync(path.join(directory,'mcp-state-waiting.png'),(await window.webContents.capturePage()).toPNG());
    assert.match(await js("document.querySelector('#mcpCanvasNoticeButton').textContent"),/Waiting for AI/);
    await js("document.querySelector('#mcpCanvasNoticeButton').click()");
    const target=listed.canvases[0],one=await call("penecho_start_session",{instanceId:target.instanceId,canvasId:target.canvasId,title:"Checkout implementation",client:"Codex",sessionKey:"smoke-one"});
    assert.equal(await js("document.querySelector('#mcpCanvasNotice').hidden"),false);
    await js("document.querySelector('#settingsClose').click()");
    for(const [name,width,zoom] of [["wide",1440,1],["narrow",700,1],["zoom",1440,2]]){
      window.setSize(width,1000);window.webContents.setZoomFactor(zoom);await pause(250);
      assert.equal(await js("(()=>{const e=document.querySelector('#mcpCanvasNoticeButton'),r=e.getBoundingClientRect();return r.width>0&&r.bottom<=document.querySelector('.canvas-frame').getBoundingClientRect().bottom-10&&Math.abs(r.right-(document.querySelector('.canvas-frame').getBoundingClientRect().right-10))<2&&e.scrollWidth<=e.clientWidth+1&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()"),true,`canvas MCP notice ${name} visible`);
      fs.writeFileSync(path.join(directory,`canvas-mcp-${name}.png`),(await window.webContents.capturePage()).toPNG());
    }
    window.setSize(1440,1000);window.webContents.setZoomFactor(1);await pause(250);
    await js("document.querySelector('#canvasAgentToggle').click()");await pause(350);
    assert.equal(await js("(()=>{const e=document.querySelector('#mcpCanvasNoticeButton'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()"),true,"MCP notice remains visible beside the open Agent");
    fs.writeFileSync(path.join(directory,'canvas-mcp-agent.png'),(await window.webContents.capturePage()).toPNG());
    await js("document.querySelector('#canvasAgentToggle').click();document.querySelector('#mcpCanvasNoticeButton').click()");
    assert.equal(await js("document.querySelector('#settingsPageMcp').hidden"),false);
    window.setSize(1440,1000);window.webContents.setZoomFactor(1);
    const two=await call("penecho_start_session",{instanceId:target.instanceId,canvasId:target.canvasId,title:"API regression review",client:"Kimi",sessionKey:"smoke-two"});
    await call("penecho_update_session",{sessionId:one.sessionId,summary:"Implement the checkout layout and verify narrow screens.",steps:[{id:"plan",label:"Confirm interaction and API contract",status:"done"},{id:"build",label:"Build the checkout preview",status:"working"},{id:"test",label:"Verify layout and keyboard behavior",status:"pending"}],events:[{id:"e1",text:"The form keeps one primary action.",kind:"evidence"}]});
    await call("penecho_update_session",{sessionId:two.sessionId,summary:"Checking error responses and transaction boundaries.",steps:[{id:"review",label:"Review API contract",status:"working"}]});
    await pause(250);
    const html="<!doctype html><html><head><style>body{margin:0;font:16px system-ui;color:#25272c;background:#f8f8fa;padding:32px;box-sizing:border-box}main{max-width:640px;margin:auto}h1{font-size:28px}label{display:block;margin:18px 0}input{display:block;width:100%;box-sizing:border-box;padding:12px;font:inherit;border:1px solid #bbb;border-radius:6px}button{padding:12px 20px;border:0;background:#2455aa;color:white;font:inherit;border-radius:6px}</style></head><body><main><h1>Complete your order</h1><p>Review your details before continuing.</p><form onsubmit='event.preventDefault()'><label>Email address<input placeholder='you@example.com'></label><button>Continue to payment</button></form></main></body></html>";
    const preview=await call("penecho_present_widget",{sessionId:one.sessionId,artifactId:"checkout",title:"Checkout preview",html,width:960,height:640});
    const capture=await call("penecho_capture_widget",{sessionId:one.sessionId,artifactId:"checkout"});
    assert.ok(capture.image.bytes>100);fs.writeFileSync(path.join(directory,"widget.webp"),Buffer.from(capture.image.data,"base64"));
    const next=await call("penecho_present_widget",{sessionId:one.sessionId,artifactId:"checkout",title:"Checkout preview",html:html.replace("Complete your order","Review your order"),width:390,capture:true});assert.equal(next.objectId,preview.objectId);
    assert.ok(next.image.bytes>100);fs.writeFileSync(path.join(directory,"widget-narrow.webp"),Buffer.from(next.image.data,"base64"));
    const headingPixels=await js(`(async()=>{const image=new Image();image.src=${JSON.stringify(`data:${next.image.mimeType};base64,${next.image.data}`)};await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const bitmap=ctx.getImageData(0,0,image.width,image.height).data;let n=0;for(let y=50;y<85;y++)for(let x=32;x<150;x++){const p=(y*image.width+x)*4;if(bitmap[p]<110&&bitmap[p+1]<110&&bitmap[p+2]<110&&bitmap[p+3]>240)n++;}return n;})()`);
    assert.ok(headingPixels>50,"The narrow screenshot must capture the responsive layout, not crop the old desktop viewport.");
    const frameFacts=await Promise.all(window.webContents.mainFrame.framesInSubtree.map(frame=>frame.executeJavaScript("({width:innerWidth,heading:document.querySelector('h1')?.textContent,form:!!document.querySelector('form'),font:document.body&&getComputedStyle(document.body).fontSize,overflow:document.documentElement.scrollWidth>innerWidth})").catch(()=>null)));
    report.preview=frameFacts.find(frame=>frame?.heading==='Review your order');assert.equal(report.preview.width,390);assert.equal(report.preview.form,true);assert.equal(report.preview.font,'16px');assert.equal(report.preview.overflow,false);
    await js("document.querySelector('#settingsClose').click();window.mcpOriginalSubtle=crypto.subtle;Object.defineProperty(crypto,'subtle',{configurable:true,value:{digest(...args){return new Promise((resolve,reject)=>{window.releaseMcpDigest=()=>window.mcpOriginalSubtle?window.mcpOriginalSubtle.digest(...args).then(resolve,reject):reject(Error('Use LAN fallback'));});}}})");
    const inFlight=call("penecho_present_widget",{sessionId:one.sessionId,artifactId:"checkout",title:"Checkout preview",html:html.replace("Complete your order","Review your order"),width:390});
    await waitFor(()=>js("typeof window.releaseMcpDigest==='function'"),"active mutation awaiting digest");await pause(220);
    assert.match(await js("document.querySelector('#mcpCanvasNoticeButton').textContent"),/updating/);
    assert.equal(await js("document.querySelector('#mcpCanvasRing').dataset.state"),"updating");
    fs.writeFileSync(path.join(directory,'mcp-state-updating.png'),(await window.webContents.capturePage()).toPNG());
    await js("window.releaseMcpDigest();delete crypto.subtle;delete window.releaseMcpDigest;delete window.mcpOriginalSubtle");await inFlight;await pause(850);
    assert.equal(await js("document.querySelector('#mcpCanvasRing').dataset.state"),"open");
    fs.writeFileSync(path.join(directory,'mcp-state-sessions.png'),(await window.webContents.capturePage()).toPNG());
    await js("document.querySelector('#mcpCanvasNoticeButton').click()");
    for(const route of ['skill','guide']){const response=await fetch(`${origin}/api/mcp/${route}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,200);assert.ok((await response.json()).text.length>100);}

    await js("document.querySelector('#settingsClose').click();document.activeElement?.blur();document.querySelector('#mcpShowNewContent').click()");await pause(350);
    for(const id of ['layout-a','layout-b','layout-c'])await call("penecho_present_widget",{sessionId:one.sessionId,artifactId:id,title:id,html:`<html><body style="font:18px system-ui;padding:24px;background:#f6f9f8"><h2>${id}</h2><p>PenEcho places this preview within its task.</p></body></html>`,width:800,height:480});
    await pause(1200);
    const arranged=(await call("penecho_inspect_session",{sessionId:one.sessionId})).browser.artifacts.filter(item=>item.artifactId.startsWith('layout-'));
    for(let i=0;i<arranged.length;i++)for(let j=i+1;j<arranged.length;j++){const a=arranged[i].bounds,b=arranged[j].bounds;assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,"task previews do not overlap");}
    assert.equal(arranged.length,3);
    fs.writeFileSync(path.join(directory,'mcp-auto-layout.png'),(await window.webContents.capturePage()).toPNG());
    await js("document.querySelector('#viewport').dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:20}));document.activeElement?.blur()");await pause(350);
    const anchorId=arranged[0].objectId,screenBox=()=>js(`(()=>{const r=document.querySelector('[data-widget-id="${anchorId}"]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};})()`),before=await screenBox();
    await call("penecho_present_widget",{sessionId:one.sessionId,artifactId:'layout-d',title:'Later preview',html:'<p>A new preview while the user is navigating.</p>',width:800,height:480});await pause(1200);
    assert.deepEqual(await screenBox(),before,"user navigation pauses automatic camera movement");assert.equal(await js("document.querySelector('#mcpShowNewContent').hidden"),false);
    fs.writeFileSync(path.join(directory,'mcp-layout-paused.png'),(await window.webContents.capturePage()).toPNG());
    for(const [name,width,zoom] of [['narrow',700,1],['zoom',1440,2]]){
      window.setSize(width,1000);window.webContents.setZoomFactor(zoom);await pause(250);
      assert.equal(await js("(()=>{const e=document.querySelector('#mcpShowNewContent'),r=e.getBoundingClientRect(),s=document.querySelector('#mcpCanvasNoticeButton'),b=s.getBoundingClientRect();return !e.hidden&&e.scrollWidth<=e.clientWidth+1&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))&&s.contains(document.elementFromPoint(b.right-4,b.y+b.height/2));})()"),true,'new-content button stays usable '+name);
      fs.writeFileSync(path.join(directory,'mcp-new-content-'+name+'.png'),(await window.webContents.capturePage()).toPNG());
    }
    window.setSize(1440,1000);window.webContents.setZoomFactor(1);await pause(250);
    await js("document.querySelector('#mcpShowNewContent').click()");await pause(400);assert.notDeepEqual(await screenBox(),before,"explicit new-content action frames the pending group");
    report.checks.push({name:"task-auto-layout-and-user-camera-ownership",ok:true});
    await js("document.querySelector('#settingsBtn').click();document.querySelector('#settingsNavMcp').click()");
    await js("document.querySelector('#settingsClose').click();document.activeElement?.blur()");
    const frameCount=await js("document.querySelectorAll('.canvas-widget').length");
    const drawingArgs={sessionId:one.sessionId,artifactId:'native-flow',title:'Lightweight Canvas workflow',items:[
      {id:'plan',type:'rect',text:'Plan',fill:'#edf6f4'},
      {id:'build',type:'ellipse',text:'Build',fill:'#eef3fa'},
      {id:'verify',type:'text',text:'Verify with user feedback',fontSize:20},
      {id:'edge',type:'arrow',from:'plan',to:'build'},
      {id:'ink',type:'path',points:[{x:24,y:210},{x:80,y:185},{x:140,y:220},{x:205,y:185}],color:'#94702b'}]};
    const native=await call('penecho_draw',{...drawingArgs,capture:true});assert.equal(native.objectIds.length,5);assert.ok(native.image.bytes<=700*1024);
    fs.writeFileSync(path.join(directory,'mcp-native-drawing.webp'),Buffer.from(native.image.data,'base64'));
    const nativeUpdate=await call('penecho_draw',{...drawingArgs,items:drawingArgs.items.map(item=>item.id==='plan'?{...item,text:'Plan complete'}:item)});assert.deepEqual(nativeUpdate.objectIds,native.objectIds);
    const plotted=await call('penecho_plot',{sessionId:one.sessionId,artifactId:'native-function',title:'Sine curve',expression:'sin(x)',xMin:-6.28,xMax:6.28,width:800,height:500,capture:true});
    assert.ok(plotted.image.bytes<=700*1024);fs.writeFileSync(path.join(directory,'mcp-native-plot.webp'),Buffer.from(plotted.image.data,'base64'));
    await js("document.querySelector('[data-action=undo]').click()");
    const undone=await call('penecho_inspect_session',{sessionId:one.sessionId});assert.equal(undone.browser.artifacts.find(item=>item.artifactId==='native-function').removed,true,'plot participates in Canvas undo');
    await js("document.querySelector('[data-action=redo]').click()");
    const redone=await call('penecho_inspect_session',{sessionId:one.sessionId});assert.equal(redone.browser.artifacts.find(item=>item.artifactId==='native-function').removed,undefined,'plot participates in Canvas redo');
    await assert.rejects(call('penecho_plot',{sessionId:one.sessionId,artifactId:'bad-function',title:'Invalid',expression:'globalThis.alert(1)'}));
    assert.equal(await js("document.querySelectorAll('.canvas-widget').length"),frameCount,'native drawing creates no iframe');
    const nativeInspect=await call('penecho_inspect_session',{sessionId:one.sessionId});
    assert.equal(nativeInspect.browser.artifacts.find(item=>item.artifactId==='native-flow').elements.find(item=>item.id==='verify').kind,'text');
    report.checks.push({name:'native-drawing-and-plot-bounded-capture-stable-update',ok:true});
    await js("document.querySelector('#settingsBtn').click();document.querySelector('#settingsNavMcp').click()");
    const baseline=await call("penecho_read_feedback",{sessionId:one.sessionId});assert.equal(baseline.changeCount,0,"AI output is not user feedback");
    await js("document.querySelector('#settingsClose').click();if(document.querySelector('#auto').getAttribute('aria-pressed')==='true')document.querySelector('#auto').click();document.querySelector('#textToolBtn').click();(()=>{const screen=document.querySelector('#screen'),r=screen.getBoundingClientRect();for(const type of ['pointerdown','pointerup'])screen.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:77,pointerType:'mouse',button:0,buttons:type==='pointerdown'?1:0,clientX:r.x+160,clientY:r.y+240}));})()");
    await waitFor(()=>js("!!document.querySelector('.text-editor textarea')"),"user text input");
    await js("const input=document.querySelector('.text-editor textarea');input.value='Make the button blue';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.text-editor .confirm').click()");
    let feedback;await waitFor(async()=>{feedback=await call("penecho_read_feedback",{sessionId:one.sessionId});return feedback.hasFeedback;},"committed text feedback");
    const typedCursor=feedback.nextCursor;assert.ok(feedback.image.bytes>0);assert.equal(feedback.entries,undefined);fs.writeFileSync(path.join(directory,'user-feedback-text.webp'),Buffer.from(feedback.image.data,'base64'));report.checks.push({name:'text-feedback-compressed',bytes:feedback.image.bytes,width:feedback.width,height:feedback.height});
    await pause(600);
    await js("document.querySelector('[data-mode=pen]').click();(()=>{const screen=document.querySelector('#screen'),r=screen.getBoundingClientRect();for(const [type,x,y] of [['pointerdown',180,310],['pointermove',240,340],['pointerup',240,340]])screen.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:78,pointerType:'mouse',button:0,buttons:type==='pointerup'?0:1,pressure:.5,clientX:r.x+x,clientY:r.y+y}));})()");
    const inkFeedback=await call("penecho_read_feedback",{sessionId:one.sessionId,after:typedCursor,capture:true});assert.equal(inkFeedback.hasFeedback,true);assert.ok(inkFeedback.image.bytes>0);
    fs.writeFileSync(path.join(directory,'user-feedback-ink.webp'),Buffer.from(inkFeedback.image.data,'base64'));
    await js("(async()=>{const c=document.createElement('canvas');c.width=160;c.height=100;const ctx=c.getContext('2d');ctx.fillStyle='#246bd1';ctx.fillRect(0,0,160,100);const blob=await new Promise(resolve=>c.toBlob(resolve));const transfer=new DataTransfer();transfer.items.add(new File([blob],'reference.png',{type:'image/png'}));const input=document.querySelector('#imagePickerInput');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await waitFor(async()=>{feedback=await call("penecho_read_feedback",{sessionId:one.sessionId,after:inkFeedback.nextCursor});return feedback.hasFeedback;},"imported image feedback");
    const imageFeedback=await call("penecho_read_feedback",{sessionId:one.sessionId,after:inkFeedback.nextCursor,capture:true});assert.ok(imageFeedback.image.bytes>0);assert.equal(imageFeedback.pixelVerified,true);
    fs.writeFileSync(path.join(directory,'user-feedback-image.webp'),Buffer.from(imageFeedback.image.data,'base64'));
    assert.equal((await call("penecho_read_feedback",{sessionId:one.sessionId,after:imageFeedback.nextCursor})).changeCount,0);
    const peerFeedback=await call("penecho_read_feedback",{sessionId:two.sessionId});assert.ok(peerFeedback.hasFeedback,"one reader must not consume another session's feedback");
    for(const item of [feedback,inkFeedback,imageFeedback,peerFeedback]){assert.ok(item.image.bytes<=700*1024);assert.ok(item.width<=1024&&item.height<=1024&&item.width*item.height<=520000);assert.equal(item.entries,undefined);}
    const probe=await call("penecho_read_feedback",{sessionId:one.sessionId,capture:false});assert.equal(probe.image,undefined);assert.equal(probe.hasFeedback,true);
    report.checks.push({name:"user-text-stroke-image-feedback-and-cursors",ok:true});
    await js("document.querySelector('#settingsBtn').click();document.querySelector('#settingsNavMcp').click()");
    const inspected=await call("penecho_inspect_session",{sessionId:one.sessionId});assert.equal(inspected.browser.artifacts.length,7);
    await js("document.querySelector('#settingsNavMcp').click()");
    await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click()");
    for(const [name,width,height,zoom] of [["settings-wide",1440,1000,1],["settings-narrow",700,900,1],["settings-zoom",1440,1000,2]]){
      window.setSize(width,height);window.webContents.setZoomFactor(zoom);await pause(250);
      report.checks.push({name,overflow:await js("[...document.querySelectorAll('#settingsPageMcp button,#settingsPageMcp pre,#settingsPageMcp .settings-group')].filter(e=>e.getBoundingClientRect().width>0&&e.scrollWidth>e.clientWidth+1).map(e=>e.id||e.className)")});
      fs.writeFileSync(path.join(directory,`${name}.png`),(await window.webContents.capturePage()).toPNG());
    }
    await js("document.querySelector('#mcpCopyInstructions').closest('details').open=true;document.querySelector('#mcpCopyInstructions').scrollIntoView({block:'center'})");
    window.setSize(700,900);window.webContents.setZoomFactor(1);await pause(250);
    assert.equal(await js("document.querySelector('#mcpCopyInstructions').scrollWidth>document.querySelector('#mcpCopyInstructions').clientWidth+1"),false);
    fs.writeFileSync(path.join(directory,'settings-config.png'),(await window.webContents.capturePage()).toPNG());
    await js("document.querySelector('#mcpCopyInstructions').closest('details').open=false;document.querySelector('#mcpHeading').scrollIntoView({block:'start'})");
    window.setSize(700,1000);window.webContents.setZoomFactor(1);await js("document.querySelector('[data-language=zh]')?.click();document.querySelector('#settingsNavMcp').click()");await pause(250);
    fs.writeFileSync(path.join(directory,"settings-zh.png"),(await window.webContents.capturePage()).toPNG());
    nativeTheme.themeSource="dark";
    window.setSize(1440,1000);await js("document.querySelector('#mcpSessionList button').click()");await pause(250);
    fs.writeFileSync(path.join(directory,"session-board.png"),(await window.webContents.capturePage()).toPNG());
    await js("document.querySelector('#settingsBtn').click();document.querySelector('#settingsNavMcp').click()");
    await call("penecho_update_session",{sessionId:one.sessionId,status:"done",summary:"Preview updated and captured successfully."});await call("penecho_close_session",{sessionId:one.sessionId});
    await js("document.querySelector('#mcpEnabled').click()");
    await waitFor(async()=>!(await call("penecho_list_canvases",{})).canvases.length,"revocation");
    assert.equal(await js("document.querySelector('#mcpCanvasNotice').hidden"),true);
    await js("document.querySelector('#mcpEnabled').click()");await waitFor(()=>js("!document.querySelector('#mcpCanvasRing').hidden"),"reconnected canvas");
    await js("document.querySelector('#settingsClose').click()");canvasSocket.destroy();
    await waitFor(()=>js("document.querySelector('#mcpCanvasNoticeButton').textContent.includes('lost')||document.querySelector('#mcpCanvasNoticeButton').textContent.includes('断开')"),"unexpected disconnect notice");
    assert.equal(await js("document.querySelector('#mcpCanvasRing').hidden"),true);await pause(200);
    fs.writeFileSync(path.join(directory,'mcp-state-lost.png'),(await window.webContents.capturePage()).toPNG());
    report.ok=true;
  }catch(error){report.ok=false;report.error=error.stack;process.exitCode=1;if(window){report.frames=await window.webContents.executeJavaScript("[...document.querySelectorAll('.canvas-widget')].map(e=>({id:e.dataset.widgetId,title:e.querySelector('iframe')?.title}))").catch(()=>[]);fs.writeFileSync(path.join(directory,"failure.png"),(await window.webContents.capturePage()).toPNG());}}
  finally{fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));window?.destroy();if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}app.exit(report.ok?0:1);}
});
