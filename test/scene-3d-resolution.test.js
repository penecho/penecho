"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),
  source=fs.readFileSync(path.join(__dirname,"../public/scene-runtime.js"),"utf8"),
  mount=source.slice(source.indexOf("  function mount3d(scene)"),source.indexOf("  // ---------- Puppet:"));
test("3D Scene supplies CSS dimensions and logical zoom to the DPR-owning renderer",()=>{
  for(const dpr of [1,2,3]) {
    const canvas={style:{}},rect={width:960,height:640},events=new Map();let illo,allocations=0;
    class Illustration {
      constructor(options){this.options=options;this.width=300;this.height=150;this.rotate={set(){}};illo=this;}
      setSize(w,h){this.width=w;this.height=h;canvas.width=w*dpr;canvas.height=h*dpr;allocations++;}
      updateRenderGraph(){}
    }
    const context=vm.createContext({root:{append(){},getBoundingClientRect:()=>rect},document:{createElement:()=>canvas},
      devicePixelRatio:dpr,Zdog:{Illustration,Box:class{}},color:v=>v,PALETTE:{blue:"#2563eb"},
      reducedMotion:true,listen(){},notifyUpdated(){},ResizeObserver:class{constructor(callback){events.set("observer",callback);}observe(){}},
      addEventListener:(name,callback)=>events.set(name,callback),requestAnimationFrame(){throw Error("reduced motion must not start playback");}});
    vm.runInContext(mount,context);
    context.mount3d({size:[960,640],zoom:1.5,view:[0,0,0],spin:[0,20,0],shapes:[{id:"cube",type:"box",translate:[0,0,0],rotate:[0,0,0]}],controls:false,autoplay:true});
    assert.deepEqual([canvas.width,canvas.height],[960*dpr,640*dpr]);assert.equal(illo.zoom,1.5);
    assert.deepEqual(canvas.style,{width:"960px",height:"640px"});
    events.get("observer")();events.get("resize")();assert.equal(allocations,1,"unchanged size does not reallocate");
    rect.width=1920;rect.height=1200;events.get("observer")();
    assert.deepEqual([canvas.width,canvas.height],[1920*dpr,1200*dpr]);assert.equal(illo.zoom,1.5*1200/640);
    assert.deepEqual(canvas.style,{width:"1920px",height:"1200px"});
    assert.equal(allocations,2);
  }
});
