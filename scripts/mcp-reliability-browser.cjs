'use strict';
// Explicit local acceptance: real browser + HTTP MCP, isolated home and model endpoint.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-mcp-reliability-'));
const fakeHome=path.join(directory,'home');fs.mkdirSync(fakeHome);os.homedir=()=>fakeHome;
app.setPath('userData',path.join(directory,'browser'));
Object.assign(process.env,{NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:path.join(directory,'state'),PENECHO_CLOUD_STATE_DIR:path.join(directory,'cloud'),HOST:'127.0.0.1',PORT:'0',AI_PROVIDER:'api',AI_API_KEY:'isolated-test',AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'test',PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false'});
const report={directory,checks:[],errors:[],timings:[]};let server,window,canvasSocket;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const waitFor=async(fn,label)=>{const until=Date.now()+25000;while(Date.now()<until){if(await fn())return;await pause(100);}throw Error('Timed out: '+label);};
app.whenReady().then(async()=>{
  try {
    server=require('../server.js');await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
    server.on('upgrade',(request,socket)=>{if(request.url==='/api/mcp/canvas')canvasSocket=socket;});
    const origin=`http://127.0.0.1:${server.address().port}`;
    window=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    window.webContents.on('console-message',(_event,level,message)=>{if(level>=3)report.errors.push(message);});
    const js=code=>window.webContents.executeJavaScript(code,true),click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await window.loadURL(origin);
    await waitFor(()=>js("!!document.querySelector('#mcpEnabled')"),'startup');
    await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click()");
    for(let i=0;i<12;i++){await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click()");await pause(150);}
    await click('#settingsBtn');await click('#settingsNavMcp');await click('#mcpLocalTab');
    await waitFor(()=>js("!document.querySelector('#mcpEnabled').disabled"),'MCP ready to opt in');
    assert.equal(await js("document.querySelector('#mcpKeepAwake').checked"),false);
    for(const [name,width,zoom]of [['wide',1440,1],['narrow',700,1],['zoom200',1440,2]]) {
      window.setSize(width,1000);window.webContents.setZoomFactor(zoom);await pause(200);
      await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelector('#mcpKeepAwake').scrollIntoView({block:'center'})");
      assert.equal(await js("(()=>{const e=document.querySelector('#mcpKeepAwake'),r=e.getBoundingClientRect();return r.width>0&&r.right<=innerWidth&&r.left>=0&&e===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);})()"),true);
      fs.writeFileSync(path.join(directory,`settings-${name}.png`),(await window.webContents.capturePage()).toPNG());
    }
    window.setSize(1440,1000);window.webContents.setZoomFactor(1);await click('#mcpEnabled');
    const {readRecords,recordsDirectory}=require('../src/server/mcp/records.js'),{bridgeRequest}=require('../src/server/mcp/stdio.js');
    let record;await waitFor(()=>Boolean(record=readRecords(recordsDirectory()).find(value=>value.pid===process.pid)),'isolated MCP record');
    const ownerId=crypto.randomUUID();
    const call=async(name,args={})=>{const start=performance.now();const result=await bridgeRequest(record,{ownerId,operation:'call',name,arguments:args});report.timings.push({name,ms:Math.round(performance.now()-start)});return result;};
    let list;await waitFor(async()=>{list=await call('penecho_list_canvases');return list.canvases.length===1;},'opt-in');
    await click('#settingsClose');
    const initial=list.canvases[0],session=await call('penecho_start_session',{instanceId:initial.instanceId,canvasId:initial.canvasId,target:'current',sessionKey:'local-current',client:'Acceptance',title:'Keep user Canvas'});
    const widget=await call('penecho_present_widget',{sessionId:session.sessionId,requestId:crypto.randomUUID(),artifactId:'first',title:'MCP proof',html:'<!doctype html><html><body style="font:24px system-ui;padding:20px"><h1>Reliable MCP</h1><button onclick="this.textContent=\'Clicked\'">Interact</button></body></html>',capture:true});
    assert.ok(widget.objectId);assert.ok(widget.image?.bytes>0||widget.pixelVerified===true);report.checks.push('real-widget-and-capture');
    for(let i=0;i<25;i++) {
      await call('penecho_update_session',{sessionId:session.sessionId,status:'working',summary:`Progress ${i}`});
      const read=await call('penecho_read_file',{sessionId:session.sessionId,path:`objects/${widget.objectId}/widget.html`});assert.match(read.content,/Reliable MCP/);
    }
    report.checks.push('50-consecutive-update-read-calls-no-errors');
    const drawing=await call('penecho_draw',{sessionId:session.sessionId,requestId:crypto.randomUUID(),artifactId:'native-proof',title:'Native proof',items:[{id:'label',type:'text',text:'Readable native text',width:300,fontSize:24},{id:'shape',type:'rect',text:'Next',width:180,height:100}],capture:false});
    assert.ok(drawing.objectIds.some(id=>/^text-box-\d+$/.test(id)));assert.equal(drawing.objectIds.length,2);
    const plot=await call('penecho_plot',{sessionId:session.sessionId,requestId:crypto.randomUUID(),artifactId:'plot-proof',title:'Plot proof',expression:'x^2',xMin:-3,xMax:3,capture:false});assert.ok(plot.objectId);
    report.checks.push('native-text-shape-and-plot-editable-objects');
    const other=await call('penecho_open_canvas',{instanceId:initial.instanceId,canvasId:initial.canvasId,create:true,requestId:'background',title:'Background',show:false});
    const second=await call('penecho_start_session',{instanceId:initial.instanceId,canvasId:initial.canvasId,documentId:other.documentId,sessionKey:'background',client:'Acceptance',title:'Background'});
    const background=await call('penecho_present_widget',{sessionId:second.sessionId,requestId:crypto.randomUUID(),artifactId:'background-proof',title:'Background proof',html:'<!doctype html><html><body><h1>Hidden document update</h1></body></html>',capture:false});
    assert.ok(background.objectId);list=await call('penecho_list_canvases');assert.equal(list.canvases.find(value=>value.documentId===initial.documentId).active,true);report.checks.push('background-updates-preserve-active-user-canvas');
    await call('penecho_edit_canvas',{sessionId:second.sessionId,action:'show',requestId:crypto.randomUUID()});
    list=await call('penecho_list_canvases');assert.equal(list.canvases.find(value=>value.documentId===other.documentId).active,true);report.checks.push('explicit-staged-show-succeeds');
    await click('#historyBtn');await click('input[name="historyStorageLocation"][value="device"]');
    await js("document.querySelector('#historySavePanel').open=true;document.querySelector('#historyName').value='Manual save reliability'");
    await waitFor(()=>js("!document.querySelector('#historySave').disabled"),'manual save available');await click('#historySave');
    let savedId;await waitFor(async()=>Boolean(savedId=await js("(()=>{const card=[...document.querySelectorAll('.history-card')].find(e=>e.querySelector('.history-card-title')?.textContent==='Manual save reliability');return card?.dataset.snapshotId;})()")),'manual save completed');
    if(await js("document.querySelector('#historyBtn').getAttribute('aria-expanded')==='true'"))await click('#historyBtn');
    await click('#newCanvasBtn');await pause(100);if(await js("document.querySelector('#newCanvasDialog').open"))await click('#newDiscard');
    await waitFor(async()=>{list=await call('penecho_list_canvases');return list.canvases.length===3;},'manual New catalog');report.checks.push('manual-new-published-without-closing-other-documents');
    const manual=list.canvases.find(value=>value.active);assert.ok(manual.documentId!==other.documentId);
    await call('penecho_start_session',{instanceId:initial.instanceId,canvasId:initial.canvasId,target:'current',sessionKey:'manual',client:'Acceptance',title:'Manual'});
    await click('#historyBtn');
    await waitFor(()=>js(`!!document.querySelector('.history-load[data-snapshot-id="${savedId}"]')`),'manual load available');
    await click(`.history-load[data-snapshot-id="${savedId}"]`);
    await waitFor(async()=>{list=await call('penecho_list_canvases');return list.canvases.find(value=>value.documentId===other.documentId)?.active;},'manual load restores same opened document');
    assert.equal(list.canvases.length,3);assert.match((await call('penecho_read_file',{sessionId:second.sessionId,path:`objects/${background.objectId}/widget.html`})).content,/Hidden document update/);
    report.checks.push('manual-device-save-and-load-preserve-document-identity-and-widget-content');
    // Protocol loss, then automatic reconnect and exact durable binding restoration.
    canvasSocket.destroy();await pause(1300);
    await waitFor(async()=>{list=await call('penecho_list_canvases');return list.canvases.length===3;},'automatic reconnect');
    const resumed=await call('penecho_start_session',{sessionKey:'background',client:'Acceptance',title:'Background'});assert.equal(resumed.documentId,other.documentId);
    assert.match((await call('penecho_read_file',{sessionId:resumed.sessionId,path:`objects/${background.objectId}/widget.html`})).content,/Hidden document update/);
    report.checks.push('reconnect-preserves-directory-binding-and-content');
    fs.writeFileSync(path.join(directory,'canvas-final.png'),(await window.webContents.capturePage()).toPNG());
    const sorted=report.timings.map(value=>value.ms).sort((a,b)=>a-b);report.latency={count:sorted.length,p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1)};
    assert.equal(report.errors.length,0);report.ok=true;
  }catch(error){report.ok=false;report.error=error.stack;if(window)fs.writeFileSync(path.join(directory,'failure.png'),(await window.webContents.capturePage()).toPNG());}
  finally {
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,timings:undefined},null,2));
    window?.destroy();server?.closeAllConnections?.();if(server)await new Promise(resolve=>server.close(resolve));app.exit(report.ok?0:1);
  }
});
