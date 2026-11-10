'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/client/app/canvas-navigation.js'), 'utf8');
const functions = source.slice(source.indexOf('  function canvasFitViewportSize('), source.indexOf("  document.querySelector('#canvasViewHand')", source.indexOf("  function canvasFitViewportSize(")));
function fit({ open = true, hidden = false, navigationHidden = false, rect = { left:800, top:40, right:1200, bottom:800, width:400, height:760 } } = {}) {
  const classes = new Set([...(open ? ['canvas-agent-open'] : []), ...(navigationHidden ? ['canvas-agent-navigation-hidden'] : [])]);
  const state = { scale:1, panX:0, panY:0 };
  const context = {
    state, SIZE:10000,
    document:{ body:{ classList:{ contains:name => classes.has(name) } }, querySelector:selector => {
      assert.equal(selector, '#canvasAgentPanel', 'Fit must not query the left navigator');
      return { hidden };
    } },
    canvasViewportMetrics:() => ({ width:1200, height:800 }),
    canvasElementLayoutRect:() => rect,
    setWidgetInteraction:() => {}, visibleInkBounds:() => ({ x:100, y:200, w:1000, h:400 }),
    imageBounds:() => null, textBoxBounds:() => null, animationBounds:() => null, widgetBounds:() => null,
    unionLocalBounds:(a,b) => a || b,
    requestCanvasNavigationPreview:() => {}, requestCoordinatesUpdate:() => {},
  };
  vm.createContext(context);
  vm.runInContext(functions + '\nfitCanvasContents();', context);
  return { scale:state.scale, centerX:state.panX + 600 * state.scale, centerY:state.panY + 400 * state.scale };
}
test('Fit All centers and scales inside the area left of the open Agent panel', () => {
  const result = fit();
  assert.equal(result.scale, .672);
  assert.ok(Math.abs(result.centerX - 400) < 1e-9);
  assert.equal(result.centerY, 400);
});
test('closed, hidden and temporarily hidden Agent panels restore full-width fit', () => {
  for (const options of [{ open:false }, { hidden:true }, { navigationHidden:true }]) {
    assert.deepEqual(fit(options), { scale:1.072, centerX:600, centerY:400 });
  }
});
test('resized Agent panel uses its current canvas-relative boundary', () => {
  assert.deepEqual(fit({ rect:{ left:600, top:40, right:1200, bottom:800, width:600, height:760 } }), { scale:.472, centerX:300, centerY:400 });
});
test('non-overlapping Agent panel does not shrink the fit region', () => {
  assert.deepEqual(fit({ rect:{ left:1200, top:0, right:1600, bottom:800, width:400, height:800 } }), { scale:1.072, centerX:600, centerY:400 });
});
test('bottom-sheet Agent panel leaves the top canvas area available', () => {
  assert.deepEqual(fit({ rect:{ left:0, top:400, right:1200, bottom:800, width:1200, height:400 } }), { scale:.68, centerX:600, centerY:200 });
});

test('Agent automatic framing ignores closed and navigation-hidden panels and centers actual content',()=>{
 const agentSource=fs.readFileSync(require('node:path').join(__dirname,'../src/client/app/canvas-agent-runtime.js'),'utf8');
 const start=agentSource.indexOf('  function canvasAgentFramePlan('),end=agentSource.indexOf('  function canvasAgentFrameRegion(',start);
 const region={x:5000,y:6000,w:1200,h:800};
 for(const options of [{open:false},{hidden:true},{navigationHidden:true},{open:true}]){
  const context={SIZE:32768,view:{clientWidth:1200,clientHeight:800},canvasAgentPanel:{hidden:!!options.hidden},document:{body:{classList:{contains:name=>name==='canvas-agent-open'?!!options.open:!!options.navigationHidden}}},canvasElementLayoutRect:()=>({left:600,top:0,right:1200,bottom:800})};
  const plan=vm.runInNewContext(agentSource.slice(start,end)+';canvasAgentFramePlan',context)(region,96);
  const expectedWidth=options.open?588:1200;
  assert.equal(plan.stage.w,expectedWidth);
  assert.ok(Math.abs(plan.panX+(region.x+region.w/2)*plan.scale-expectedWidth/2)<1e-8);
  assert.ok(Math.abs(plan.panY+(region.y+region.h/2)*plan.scale-400)<1e-8);
 }
});

test('AI framing caps small content at 100% while large content still fits',()=>{
 const agentSource=fs.readFileSync(require('node:path').join(__dirname,'../src/client/app/canvas-agent-runtime.js'),'utf8');
 const start=agentSource.indexOf('  function canvasAgentFramePlan('),end=agentSource.indexOf('  function canvasAgentFrameRegion(',start);
 const context={SIZE:32768,view:{clientWidth:1600,clientHeight:1000},canvasAgentPanel:{hidden:true}};
 const frame=vm.runInNewContext(agentSource.slice(start,end)+';canvasAgentFramePlan',context);
 const small={x:5000,y:6000,w:400,h:300},plan=frame(small,96);
 assert.equal(plan.scale,1);
 assert.equal(plan.panX+(small.x+small.w/2)*plan.scale,800);
 assert.equal(plan.panY+(small.y+small.h/2)*plan.scale,500);
 const large=frame({x:5000,y:6000,w:4000,h:3000},96);
 assert.ok(large.scale<1);
 assert.ok(large.framed.w*large.scale<=1600);
 assert.ok(large.framed.h*large.scale<=1000);
});
