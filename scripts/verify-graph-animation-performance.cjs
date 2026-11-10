"use strict";
// Measure native graph animation in isolated Chromium at inline/fullscreen sizes.
// Run with Electron; --baseline records the current source without assertions.
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict");
const SMART=require("../public/smart-suggest.js"),baseline=process.argv.includes("--baseline"),
  directory=path.resolve(__dirname,"../docs/verification/graph-animation-performance-20261005"),
  temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-graph-animation-")),
  report={baseline,samples:[],checks:[],errors:[]};
fs.mkdirSync(directory,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
app.commandLine.appendSwitch("force-device-scale-factor","2");
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let win;
app.whenReady().then(async()=>{
  try {
    win=new BrowserWindow({show:false,width:1000,height:720,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    win.webContents.on("console-message",event=>{if(event.level==="error")report.errors.push(event.message);});
    const js=code=>win.webContents.executeJavaScript(code,true),
      data={version:2,mode:"3d",expressions:["a=1","z=a*sin(x)*cos(y)","x²+y²+z²=9"],parameters:{a:1},colors:["#dc2626","#2563eb","#16a34a"],view3:{az:-.85,el:.55,R:5,zoom:1},window2:null};
    const baselineFile=path.join(directory,"baseline.html"),
      original=baseline&&fs.existsSync(baselineFile)?fs.readFileSync(baselineFile,"utf8"):SMART.graphWidgetHtml(data,{language:"en"});
    if(baseline&&!fs.existsSync(baselineFile))fs.writeFileSync(baselineFile,original);
    const instrument=html=>html.replace("    const math = createGraphMath();",`    const math = createGraphMath();
    const audit={meshes:{},durations:[],parameters:[]},originalMesh=math.mesh;
    math.mesh=(row,...args)=>{audit.meshes[row.src]=(audit.meshes[row.src]||0)+1;return originalMesh(row,...args);};`)
      .replace("    const $ = id =>", "    window.graphAudit={state,audit,draw,setParameter,refresh,get renderer(){return surfaceRenderer;}}; const $ = id =>")
      .replace("      setParameter(a.name,v,a.definition);", "      audit.parameters.push({now:performance.now(),value:v});const started=performance.now();setParameter(a.name,v,a.definition);audit.durations.push(performance.now()-started);");
    for(const fallback of [false,true]) {
      let html=instrument(original);
      if(fallback)html=html.replace("<script>","<script>const originalGetContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'?null:originalGetContext.call(this,type,...args)};");
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);await pause(200);
      for(const [label,width,height] of [["inline",1000,720],["maximized",1920,1200]]) {
        win.setContentSize(width,height);await pause(200);
        await js("graphAudit.audit.meshes={};graphAudit.audit.durations=[];graphAudit.audit.parameters=[];document.querySelector('.play').click()");
        await pause(1200);
        const sample=await js(`(()=>{
          const a=graphAudit.audit,d=a.durations.slice(2).sort((a,b)=>a-b),p=a.parameters,c=document.querySelector('#c'),r=graphAudit.renderer;
          const activeBacking=r.context?[r.context.canvas.width,r.context.canvas.height]:[r.canvas.width,r.canvas.height];
          document.querySelector('.play').click();
          return {frames:p.length,meshes:a.meshes,meanMs:d.reduce((a,b)=>a+b,0)/(d.length||1),p95Ms:d[Math.floor(d.length*.95)]||0,
            parameterTravel:p.length>1?Math.abs(p.at(-1).value-p[0].value):0,elapsedMs:p.length>1?p.at(-1).now-p[0].now:0,
            webgl:!!r.gl&&!r.gl.isContextLost(),backing:[c.width,c.height],activeBacking,surfaceBacking:r.context?[r.context.canvas.width,r.context.canvas.height]:[r.canvas.width,r.canvas.height],camera:{...graphAudit.state.view3}};
        })()`);
        report.samples.push({label,fallback,...sample});console.log(JSON.stringify(report.samples.at(-1)));
        if(!baseline) {
          assert.ok(sample.frames>=8,"animation must remain live");
          assert.equal(sample.meshes["x²+y²+z²=9"]||0,0,"unrelated static sphere must not be remeshed during playback");
          assert.deepEqual(sample.camera,data.view3,"resize/animation preserves camera");
          assert.ok(sample.activeBacking[0]*sample.activeBacking[1]<=1503000,"animated surface allocation is bounded");
          assert.deepEqual(sample.surfaceBacking,sample.backing,"pause restores full device resolution");
        }
        if(label==="maximized")fs.writeFileSync(path.join(directory,`${baseline?"before":"after"}-${fallback?"fallback":"webgl"}.png`),(await win.webContents.capturePage()).toPNG());
      }
      // Same-turn pause/play must leave exactly one pending animation callback.
      await js("graphAudit.audit.parameters=[];const b=document.querySelector('.play');b.click();b.click();b.click()");
      await pause(500);await js("document.querySelector('.play').click()");
      report.samples.push({label:"rapid-restart",fallback,...await js("({frames:graphAudit.audit.parameters.length})")});
      if(!baseline) {
        assert.ok(report.samples.at(-1).frames<=16,"rapid restart retains a single 30 fps playback");
        // Changing a derived parameter must refresh its dependent geometry.
        await js("graphAudit.state.rows[2].src='x²+y²+z²=b';graphAudit.state.rows[2].input.textContent='x²+y²+z²=b';document.querySelector('#add').click();const row=graphAudit.state.rows.at(-1);row.src='b=2*a';row.input.textContent=row.src;graphAudit.refresh(false);graphAudit.audit.meshes={};graphAudit.setParameter('a',2,graphAudit.state.rows[0]);");
        const dependencies=await js("({meshes:graphAudit.audit.meshes,b:graphAudit.state.params.b})");
        assert.equal(dependencies.b,4);assert.equal(dependencies.meshes['x²+y²+z²=b'],1);
        await js("document.querySelector('.play').click()");await pause(100);
        const snapshot=await js(`(()=>{
          const c=document.querySelector('#c'),r=graphAudit.renderer,getSize=()=>r.context?[r.context.canvas.width,r.context.canvas.height]:[r.canvas.width,r.canvas.height],
            camera={...graphAudit.state.view3},restore=window.__penechoPrepareGraphSnapshot(),during=getSize();restore();
          return {during,after:getSize(),backing:[c.width,c.height],playing:!!graphAudit.state.anim,camera,restoredCamera:{...graphAudit.state.view3}};
        })()`);
        assert.deepEqual(snapshot.during,snapshot.backing,"snapshot redraws at full resolution during playback");
        assert.ok(snapshot.playing);assert.deepEqual(snapshot.camera,snapshot.restoredCamera);
        assert.ok(snapshot.after[0]*snapshot.after[1]<=1503000);
        await js("document.querySelector('.play').click()");
        report.checks.push(`${fallback?'Software':'WebGL'}: derived dependencies, bounded playback, pause and full-resolution snapshot preserve live state`);
      }
    }
    if(!baseline) {
      const saved=fs.readFileSync(path.join(directory,"baseline.html"),"utf8"),upgraded=SMART.upgradeGraphWidgetHtml(saved);
      assert.notEqual(upgraded,saved);assert.equal(SMART.upgradeGraphWidgetHtml(upgraded),upgraded);
      assert.deepEqual(SMART.graphDocumentData(upgraded),SMART.graphDocumentData(saved));
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(instrument(upgraded))}`);await pause(200);
      await js("graphAudit.audit.meshes={};document.querySelector('.play').click()");await pause(500);await js("document.querySelector('.play').click()");
      assert.equal(await js("graphAudit.audit.meshes['x²+y²+z²=9']||0"),0);
      report.checks.push("Saved current graphs receive the performance repair and retain expressions/parameters/camera");
    }
    assert.deepEqual(report.errors,[]);report.ok=true;
  }catch(error){report.failure=error.stack||String(error);}
  finally {
    win?.destroy();fs.writeFileSync(path.join(directory,baseline?"before.json":"after.json"),JSON.stringify(report,null,2));
    fs.rmSync(temporary,{recursive:true,force:true});console.log(JSON.stringify({directory,ok:report.ok,failure:report.failure}));app.exit(report.ok?0:1);
  }
});
