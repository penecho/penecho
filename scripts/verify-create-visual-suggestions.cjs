"use strict";
// Render the real suggestion controls in an isolated Chromium Canvas.
// Run with tools/electron/node_modules/.bin/electron.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const root=path.resolve(__dirname,'..'), temporary=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-visual-action-'));
const output=path.resolve(process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||'docs/verification/create-visual-action-20261001');
fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(temporary,'profile'));
Object.assign(process.env,{NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:path.join(temporary,'state'),PENECHO_CONFIG_FILE:path.join(temporary,'config.env'),HOST:'127.0.0.1',PORT:'0',AI_PROVIDER:'api',AI_API_KEY:'test-only',AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'test',PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false',PENECHO_JEVISION_ENABLED:'false'});
const original=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(path.resolve(String(file))===path.join(root,'public/app.js'))return Readable.from([fs.readFileSync(file,'utf8').replace(/\}\)\(\);\s*$/,`
    window.visualActionTest={state,canvasDocumentsReady,smartSuggest,mount:language=>{
      state.language=language;document.querySelector('#visualActionPreview')?.remove();
      const bar=document.createElement('div');bar.id='visualActionPreview';bar.className='assist-bar visible';bar.dataset.mode='suggest';bar.dataset.rank='complete';
      bar.style.setProperty('--assist-x','24px');bar.style.setProperty('--assist-y','160px');
      for(const id of ['create_visual','answer'])bar.append(assistActionButton({id,source:'penecho-llm'},id==='create_visual',{}));
      document.body.append(bar);
    }};
  })();`)]);
  return original.call(this,file,...args);
};
let server,win;const report={samples:[],consoleErrors:[]};
app.whenReady().then(async()=>{
  try{
    server=require('../server.js');await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
    win=new BrowserWindow({show:false,width:1200,height:850,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)report.consoleErrors.push(message);});
    await win.loadURL('http://127.0.0.1:'+server.address().port);
    const run=code=>win.webContents.executeJavaScript(code);
    await run(`(async()=>{const t=visualActionTest;await t.canvasDocumentsReady();t.smartSuggest.enabled=false;t.state.auto=false;t.state.scale=1;t.state.panX=t.state.panY=0;t.state.viewInitialized=true;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();})()`);
    for(const width of [1200,390])for(const language of ['en','zh']){
      win.setSize(width,850);await run(`document.querySelector('#canvasWelcome').hidden=true;visualActionTest.mount(${JSON.stringify(language)});`);
      await new Promise(resolve=>setTimeout(resolve,220));
      const measure=await run(`(()=>{const b=document.querySelector('[data-suggestion="create_visual"]'),r=b.getBoundingClientRect(),label=b.querySelector('.assist-label');return {text:label.textContent,labelWidth:label.getBoundingClientRect().width,scrollWidth:label.scrollWidth,clientWidth:label.clientWidth,button:{x:r.x,y:r.y,w:r.width,h:r.height},viewport:innerWidth,title:b.title,role:b.type,icon:!!b.querySelector('[aria-hidden="true"]')};})()`);
      assert.equal(measure.text,language==='zh'?'生成可视内容':'Create visual');assert.equal(measure.role,'button');assert.ok(measure.icon);
      assert.ok(measure.button.x>=0&&measure.button.x+measure.button.w<=measure.viewport+1,'button fits the viewport');
      assert.ok(measure.scrollWidth<=measure.clientWidth+1,'label is not clipped');
      report.samples.push({width,language,...measure});
      fs.writeFileSync(path.join(output,language+'-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
    }
    assert.deepEqual(report.consoleErrors,[]);
    report.passed=true;
  }catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;}
  finally{
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({passed:report.passed,samples:report.samples.length,error:report.error,output}));
    win?.destroy();if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
    fs.rmSync(temporary,{recursive:true,force:true});app.exit(report.passed?0:1);
  }
});
