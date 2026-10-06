"use strict";

const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const SMART=require("../public/smart-suggest.js");
const saved=fs.readFileSync(path.join(__dirname,"fixtures/graph-v2-before-interactions.html"),"utf8");

function layoutHarness(html,width) {
  const start=html.indexOf("function installReadableGraphUi()"),body=html.slice(start,html.indexOf("\n  }",start)+4);
  assert.ok(start>=0 && body.endsWith("}"));
  const listeners=new Map(),properties={},classes=new Map(),parent={};
  const app={style:{setProperty:(name,value)=>properties[name]=value},classList:{toggle:(name,value)=>classes.set(name,value)}};
  const context=vm.createContext({document:{querySelector:()=>app},parent,window:{},innerWidth:width,
    addEventListener:(type,listener)=>{const handlers=listeners.get(type)||[];handlers.push(listener);listeners.set(type,handlers);}});
  vm.runInContext(`(${body})()`,context);
  const dispatch=(type,data)=>{for(const handler of listeners.get(type)||[])handler({source:parent,data});};
  return {context,dispatch,properties,classes};
}

for(const [name,html] of [["new",SMART.graphWidgetCommand({expression:"y = exp(-x^2/6)*cos(3*x)"}).html],["saved v2",SMART.upgradeGraphWidgetHtml(saved)]]) {
  test(`${name} graph keeps logical layout when Canvas or presentation scale changes`,()=>{
    const h=layoutHarness(html,1000);
    for(const scale of [.03,.35,.7,1,2]) {
      h.dispatch("message",{type:"penecho-widget-state",scaleX:scale,scaleY:scale,maximized:false});
      h.dispatch("message",{type:"penecho-widget-state",scaleX:scale,scaleY:scale,maximized:true});
      assert.equal(h.properties["--graph-screen-unit"],"1px");assert.equal(h.classes.get("narrow"),false);
    }
    h.context.innerWidth=500;h.dispatch("resize");assert.equal(h.classes.get("narrow"),true);
    h.dispatch("message",{type:"penecho-widget-state",scaleX:2,scaleY:2});assert.equal(h.classes.get("narrow"),true);
    h.context.innerWidth=1000;h.dispatch("resize");assert.equal(h.classes.get("narrow"),false);
  });
}

test("saved graph zoom repair preserves data, authored styles, handlers and snapshot preparation",()=>{
  const original=saved.replace("</style>","/* User appearance */.badge{color:tomato}</style>")
    .replace("zoom(Math.exp(-e.deltaY * 0.0015)","zoom(Math.exp(-e.deltaY * 0.002)");
  const upgraded=SMART.upgradeGraphWidgetHtml(original);
  assert.notEqual(upgraded,original);
  assert.deepEqual(SMART.graphDocumentData(upgraded),SMART.graphDocumentData(original));
  assert.ok(upgraded.includes("/* User appearance */.badge{color:tomato}"));
  assert.ok(upgraded.includes("zoom(Math.exp(-e.deltaY * 0.002)"));
  const snapshot=upgraded.slice(upgraded.indexOf("    // Download includes"),upgraded.indexOf("(function graphRuntime(D)"));
  assert.ok(snapshot.includes("restoreSurface?.()"),"snapshot restores animated surface resolution after capture");
  assert.equal(snapshot.replace('      const restoreSurface=window.__penechoPrepareGraphSurfaceSnapshot?.();\n','').replace('        restoreSurface?.();\n',''),
    original.slice(original.indexOf("    // Download includes"),original.indexOf("(function graphRuntime(D)")));
  assert.equal(SMART.upgradeGraphWidgetHtml(upgraded),upgraded);
  new Function(upgraded.slice(upgraded.indexOf("<script>")+8,upgraded.lastIndexOf("</script>")));
  const customLayout=original.replace("innerWidth * scale < 600","innerWidth * scale < 450");
  const repairedCustom=SMART.upgradeGraphWidgetHtml(customLayout);
  assert.ok(repairedCustom.includes("innerWidth * scale < 450"),"custom layout is left intact");
  assert.ok(repairedCustom.includes("zoom(Math.exp(-e.deltaY * 0.002)"),"custom interaction handler is left intact");
  assert.ok(repairedCustom.includes("normal=math.polygonNormal(face)"),"native geometry still receives its independent repair");
});
