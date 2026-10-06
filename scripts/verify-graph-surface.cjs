"use strict";
// Render canonical native graphs in real Chromium with an isolated profile.
// Run: tools/electron/node_modules/.bin/electron scripts/verify-graph-surface.cjs
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict");
const SMART=require("../public/smart-suggest.js"),root=path.resolve(__dirname,".."),
  directory=path.resolve(process.env.PENECHO_VERIFY_OUTPUT||path.join(root,"docs/verification/graph-surface-20261003")),report={checks:[],samples:[],errors:[]};
fs.mkdirSync(directory,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-surface-"));app.setPath("userData",profile);
app.commandLine.appendSwitch("force-device-scale-factor","2");
const fixture=fs.readFileSync(path.join(root,"test/fixtures/graph-v2-before-interactions.html"),"utf8"),
  start=fixture.indexOf("function createGraphMath()"),end=fixture.indexOf("function installReadableGraphUi()",start),
  oldMath=new Function(`${fixture.slice(start,end)};return createGraphMath();`)(),
  data={version:2,mode:"3d",expressions:["z=3*x"],parameters:{},colors:["#dc2626","#2563eb"],view3:{az:-.85,el:.55,R:5,zoom:1.35},window2:null};
const old=SMART.updateGraphDocument(fixture,data).html,
  normal=SMART.createGraphMath().polygonNormal,
  missing=oldMath.mesh(oldMath.equation("z=3*x","3d"),5,{},36).filter(face=>Math.hypot(...normal(face.slice(0,3)))<1e-12&&Math.hypot(...normal(face))>1e-12);
assert.equal(missing.length,36);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let win;
app.whenReady().then(async()=>{
  try {
    win=new BrowserWindow({show:false,width:1280,height:960,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    win.webContents.on("console-message",event=>{if(event.level==="error")report.errors.push(event.message);});
    const js=code=>win.webContents.executeJavaScript(code,true);
    const load=async(html,fallback=false)=>{
      let instrumented=html.replace("    const $ = id =>", "    window.__graphSurface={state,draw,math,get renderer(){return surfaceRenderer;}}; const $ = id =>");
      if(fallback)instrumented=instrumented.replace("<script>","<script>const graphGetContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'?null:graphGetContext.call(this,type,...args)};");
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(instrumented)}`);
      await pause(250);assert.equal(await js("!!window.__graphSurface"),true);
    };
    const capture=async label=>{
      fs.writeFileSync(path.join(directory,`${label}.png`),(await win.webContents.capturePage()).toPNG());
    };
    const pixels=()=>js(`(()=>{
      const {state}=__graphSurface,c=document.querySelector('#c'),ctx=c.getContext('2d'),V=state.view3,
        ca=Math.cos(V.az),sa=Math.sin(V.az),ce=Math.cos(V.el),se=Math.sin(V.el),scale=Math.min(c.clientWidth,c.clientHeight)*.26*V.zoom;
      const project=p=>{const X=p[0]/V.R,Y=p[1]/V.R,Z=p[2]/V.R,x=X*ca-Y*sa,y=X*sa+Y*ca,d=y*ce+Z*se,t=1/(1+d*.18);return [c.clientWidth/2+x*scale*t,c.clientHeight*.52-(Z*ce-y*se)*scale*t]};
      const samples=${JSON.stringify(missing)}.map(face=>{
        const p=face.reduce((a,v)=>a.map((x,i)=>x+v[i]/face.length),[0,0,0]),q=project(p),
          rgb=[...ctx.getImageData(Math.floor(q[0]*c.width/c.clientWidth),Math.floor(q[1]*c.height/c.clientHeight),1,1).data];
        const channels=rgb.slice(0,3);return {point:p,pixel:q,rgb,filled:rgb[3]>240&&Math.max(...channels)-Math.min(...channels)>60};
      });return {holes:samples.filter(p=>!p.filled).length,total:samples.length,samples};
    })()`);
    await load(old);report.before=await pixels();await capture("before-plane");
    assert.ok(report.before.holes>15,"the old renderer reproduces visible boundary holes");
    await load(SMART.graphWidgetHtml({...data,colors:["#2563eb","#dc2626"]},{language:"en"}));
    report.after=await pixels();await capture("after-plane");assert.equal(report.after.holes,0,"all 36 formerly missing faces contain rendered surface pixels");
    report.checks.push("Before/after pixel checks reproduce old missing faces and verify all 36 are filled");
    await load(SMART.upgradeGraphWidgetHtml(old));report.reopened=await pixels();assert.equal(report.reopened.holes,0);
    assert.deepEqual(await js("JSON.parse(JSON.stringify(__graphSurface.state.view3))"),data.view3);
    report.checks.push("Saved native v2 graph receives the repair on reopen and retains its camera");
    const beforeView=await js("JSON.parse(JSON.stringify(__graphSurface.state.view3))"),
      box=await js("(()=>{const r=document.querySelector('#c').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()"),
      x=Math.round(box.x+box.w*.5),y=Math.round(box.y+box.h*.5);
    win.webContents.sendInputEvent({type:"mouseDown",x,y,button:"left",clickCount:1});
    win.webContents.sendInputEvent({type:"mouseMove",x:x+60,y:y+25,button:"left"});
    win.webContents.sendInputEvent({type:"mouseUp",x:x+60,y:y+25,button:"left",clickCount:1});await pause(120);
    const rotated=await js("JSON.parse(JSON.stringify(__graphSurface.state.view3))");assert.notEqual(rotated.az,beforeView.az);
    const radius=rotated.R;await js("document.querySelector('#zin').click()");
    assert.ok(await js("__graphSurface.state.view3.R")<radius);
    await js("document.querySelector('#home').click()");
    assert.equal(await js("__graphSurface.state.view3.R"),5);
    report.checks.push("Real pointer drag rotates; zoom and reset retain working camera controls");
    const overlap={...data,expressions:["z=0","z=x+y"],colors:["#2563eb","#dc2626"]},
      depthPixels=()=>js(`(()=>{
        const c=document.querySelector('#c'),ctx=c.getContext('2d'),V=__graphSurface.state.view3,
          ca=Math.cos(V.az),sa=Math.sin(V.az),ce=Math.cos(V.el),se=Math.sin(V.el),scale=Math.min(c.clientWidth,c.clientHeight)*.26*V.zoom,
          tests=[],sx=c.width/c.clientWidth,sy=c.height/c.clientHeight;
        for(let py=30;py<c.height-30;py+=17)for(let px=30;px<c.width-30;px+=17){
          const X=((px+.5)/sx-c.clientWidth/2)/scale,Z=(c.clientHeight*.52-(py+.5)/sy)/scale,
            world=d=>{const x=X*(1+.18*d),z=Z*(1+.18*d),y=d*ce-z*se;return [x*ca+y*sa,-x*sa+y*ca,z*ce+d*se]},
            equations=[p=>p[2],p=>p[2]-p[0]-p[1]],hits=equations.map(f=>{const d=-f(world(0))/(f(world(1))-f(world(0)));return {d,p:world(d)}});
          if(hits.some(hit=>!Number.isFinite(hit.d)||hit.p.some(v=>Math.abs(v)>.98))||Math.abs(hits[0].d-hits[1].d)<.005)continue;
          const rgb=[...ctx.getImageData(px,py,1,1).data];if(rgb[3]<240||Math.abs(rgb[0]-rgb[2])<40)continue;
          const expected=hits[0].d<hits[1].d?0:1,actual=rgb[0]>rgb[2]?1:0;
          tests.push({pixel:[px,py],expected,actual,depth:hits.map(hit=>hit.d)});
        }return {total:tests.length,wrong:tests.filter(t=>t.expected!==t.actual).length,examples:tests.filter(t=>t.expected!==t.actual).slice(0,12)};
      })()`);
    await load(SMART.updateGraphDocument(fixture,overlap).html);
    report.occlusionBefore=await depthPixels();await capture("before-intersection");
    assert.ok(report.occlusionBefore.wrong>5,"old face sorting reproduces incorrect intersection pixels");
    for(const fallback of [false,true]) {
      await load(SMART.graphWidgetHtml(overlap,{language:"en"}),fallback);
      const result=await depthPixels();report[fallback?"occlusionFallback":"occlusionAfter"]=result;
      assert.ok(result.total>200);assert.equal(result.wrong,0,"every sampled overlap pixel matches the analytic camera ray");
      report.samples.push({label:fallback?"software-depth":"webgl-depth",...await js("({webgl:!!__graphSurface.renderer.gl,antialias:__graphSurface.renderer.gl?.getContextAttributes()?.antialias})")});
      await capture(fallback?"after-intersection-fallback":"after-intersection");
    }
    report.checks.push("Intersection pixels match analytic ray/plane depths with WebGL and with WebGL disabled");
    await load(SMART.graphWidgetHtml(overlap,{language:"en"}));
    const contextLost=await js("(()=>{const extension=__graphSurface.renderer.gl?.getExtension('WEBGL_lose_context');if(!extension)return false;extension.loseContext();return true})()");
    if(contextLost) {
      await pause(100);await js("__graphSurface.draw()");report.occlusionContextLost=await depthPixels();
      assert.equal(report.occlusionContextLost.wrong,0);report.checks.push("Context loss switches to the software depth buffer without wrong overlap pixels");
    }
    await load(SMART.upgradeGraphWidgetHtml(old));
    for(const [width,height] of [[480,820],[1280,960]]) {
      win.setContentSize(width,height);await pause(200);
      assert.deepEqual(await js("JSON.parse(JSON.stringify(__graphSurface.state.view3))"),data.view3);
      assert.equal((await pixels()).holes,0);
    }
    report.checks.push("Live wide/narrow resize preserves the saved camera and filled boundary faces");
    for(const [label,width,height,expressions] of [
      ["surfaces-wide",1280,960,["z=sin(x)*cos(y)","z=3*x"]],
      ["surfaces-diagonal",1280,960,["z=sin(x)*cos(y)","z=x+y"]],
      ["surfaces-narrow",480,820,["z=sin(x)*cos(y)","z=3*x"]],
      ["implicit-sphere",1280,960,["x²+y²+z²=9"]],
    ]) {
      win.setContentSize(width,height);
      if(label==="surfaces-diagonal") {
        await load(SMART.updateGraphDocument(fixture,{...data,expressions}).html);await capture("before-diagonal");
      }
      await load(SMART.graphWidgetHtml({...data,expressions,colors:["#2563eb","#dc2626"]},{language:"zh"}));
      await capture(label);report.samples.push({label,...await js("(()=>{const c=document.querySelector('#c');return {width:innerWidth,height:innerHeight,canvas:[c.clientWidth,c.clientHeight],backing:[c.width,c.height],dpr:devicePixelRatio,errors:[...document.querySelectorAll('.row.bad')].length}})()")});
      assert.equal(report.samples.at(-1).errors,0);
      const {canvas,backing,dpr}=report.samples.at(-1);assert.ok(backing.every((v,i)=>Math.abs(v-canvas[i]*dpr)<=1));
    }
    report.checks.push("Wide/narrow overlapping surfaces and implicit sphere render at the device pixel ratio without expression errors");
    assert.deepEqual(report.errors,[]);report.ok=true;
  }catch(error){report.failure=error.stack||String(error);}
  finally {
    win?.destroy();fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify(report,null,2));
    console.log(JSON.stringify({directory,ok:report.ok,checks:report.checks,holes:[report.before?.holes,report.after?.holes,report.reopened?.holes],failure:report.failure,errors:report.errors},null,2));
    app.exit(report.ok?0:1);
  }
});
