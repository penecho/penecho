'use strict';
require('./helpers/safety.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/client/app/canvas-navigation.js'), 'utf8');
const functions = source.slice(source.indexOf('  function canvasFitViewportSize('), source.indexOf("  document.querySelector('#canvasViewHand')", source.indexOf("  function canvasFitViewportSize(")));
const core = fs.readFileSync(require('node:path').join(__dirname, '../src/client/app/core.js'), 'utf8');
const elementRect = core.slice(core.indexOf('  function canvasElementLayoutRect('), core.indexOf('  const AI_NON_PROGRESS_STATUS_KEYS'));
function fit({ panel = null, pageScale = 1 } = {}) {
  const state = { scale:1, panX:0, panY:0 };
  const context = {
    state, SIZE:10000,
    document:{ querySelector:selector => {
      assert.equal(selector, '#projectLinesPanel:not([hidden])');
      return panel && !panel.hidden ? { getBoundingClientRect:() => panel.rect } : null;
    } },
    canvasViewportMetrics:() => ({ width:1200, height:800,
      rect:{ left:100 * pageScale, top:50 * pageScale, width:1200 * pageScale, height:800 * pageScale },
      clientScaleX:1 / pageScale, clientScaleY:1 / pageScale }),
    setWidgetInteraction:() => {}, visibleInkBounds:() => ({ x:100, y:200, w:1000, h:400 }),
    imageBounds:() => null, textBoxBounds:() => null, animationBounds:() => null, widgetBounds:() => null,
    unionLocalBounds:(a,b) => a || b,
    requestCanvasNavigationPreview:() => {}, requestCoordinatesUpdate:() => {},
  };
  vm.createContext(context);
  vm.runInContext(elementRect + functions + '\nfitCanvasContents();', context);
  return { scale:state.scale, centerX:state.panX + 600 * state.scale, centerY:state.panY + 400 * state.scale };
}
test('Fit All centers the content in the whole Canvas viewport', () => {
  assert.deepEqual(fit(), { scale:1.072, centerX:600, centerY:400 });
});
test('Fit All keeps content clear of the open right panel', () => {
  const result = fit({ panel:{ rect:{ left:900, top:50, width:400, height:800 } } });
  assert.equal(result.scale, .672);
  assert.ok(Math.abs(result.centerX - 400) < 1e-9);
  assert.equal(result.centerY, 400);
  assert.ok(Math.abs(result.centerX + 1000 * result.scale / 2 - (800 - 64)) < 1e-9);
});
test('Fit All uses the full Canvas when the panel is hidden or does not overlap', () => {
  for (const panel of [
    { hidden:true, rect:{ left:900, top:50, width:400, height:800 } },
    { rect:{ left:0, top:0, width:0, height:0 } },
    { rect:{ left:1300, top:50, width:400, height:800 } },
    { rect:{ left:900, top:850, width:400, height:800 } },
    { rect:{ left:900, top:-750, width:400, height:800 } },
    { rect:{ left:-300, top:50, width:400, height:800 } },
  ]) assert.deepEqual(fit({ panel }), fit());
});
test('Fit All measures the panel edge relative to the Canvas at every page scale', () => {
  for (const pageScale of [.75, 1, 1.5, 2]) {
    const panel = { rect:{ left:900 * pageScale, top:50 * pageScale, width:500 * pageScale, height:800 * pageScale } };
    const result = fit({ panel, pageScale });
    assert.equal(result.scale, .672);
    assert.ok(Math.abs(result.centerX - 400) < 1e-9);
    assert.equal(result.centerY, 400);
  }
});
test('Agent automatic framing uses the whole view and centers actual content',()=>{
 const agentSource=fs.readFileSync(require('node:path').join(__dirname,'../src/client/app/canvas-agent-runtime.js'),'utf8');
 const start=agentSource.indexOf('  function canvasAgentFramePlan('),end=agentSource.indexOf('  function canvasAgentFrameRegion(',start);
 const region={x:5000,y:6000,w:1200,h:800};
 const plan=vm.runInNewContext(agentSource.slice(start,end)+';canvasAgentFramePlan',{SIZE:32768,view:{clientWidth:1200,clientHeight:800}})(region,96);
 assert.equal(plan.stage.w,1200);
 assert.ok(Math.abs(plan.panX+(region.x+region.w/2)*plan.scale-600)<1e-8);
 assert.ok(Math.abs(plan.panY+(region.y+region.h/2)*plan.scale-400)<1e-8);
});

test('AI framing caps small content at 100% while large content still fits',()=>{
 const agentSource=fs.readFileSync(require('node:path').join(__dirname,'../src/client/app/canvas-agent-runtime.js'),'utf8');
 const start=agentSource.indexOf('  function canvasAgentFramePlan('),end=agentSource.indexOf('  function canvasAgentFrameRegion(',start);
 const context={SIZE:32768,view:{clientWidth:1600,clientHeight:1000}};
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

function keepClear({ view, panel = { rect:{ left:900, top:50, width:400, height:800 } }, locked = false }) {
  const state = { scale:view.scale, panX:view.panX, panY:view.panY, navigationLocked:locked };
  const context = {
    state, SIZE:10000,
    document:{ querySelector:() => panel && !panel.hidden ? { getBoundingClientRect:() => panel.rect } : null },
    canvasViewportMetrics:() => ({ width:1200, height:800, rect:{ left:100, top:50, width:1200, height:800 }, clientScaleX:1, clientScaleY:1 }),
    visibleInkBounds:() => ({ x:100, y:200, w:1000, h:400 }),
    imageBounds:() => null, textBoxBounds:() => null, animationBounds:() => null, widgetBounds:() => null,
    unionLocalBounds:(a,b) => a || b,
    requestCanvasNavigationPreview:() => {}, requestCoordinatesUpdate:() => {},
  };
  vm.createContext(context);
  const moved = vm.runInContext(elementRect + functions + '\nkeepCanvasContentsClearOfPanel();', context);
  const left = state.panX + 100 * state.scale, top = state.panY + 200 * state.scale;
  return { moved, scale:state.scale, left, right:left + 1000 * state.scale, top, bottom:top + 400 * state.scale };
}
test('Opening the panel moves content framed in the whole window beside it', () => {
  // Framed for 1200 px: 100..1100 on screen, the panel starts at 800.
  const result = keepClear({ view:{ scale:1, panX:0, panY:0 } });
  assert.equal(result.moved, true);
  assert.ok(result.scale < 1);
  assert.ok(result.left >= 0 && result.right <= 800 - 40 + 1e-9);
  assert.ok(Math.abs((result.left + result.right) / 2 - 400) < 1e-9);
  assert.ok(Math.abs((result.top + result.bottom) / 2 - 400) < 1e-9);
});
test('Opening the panel only slides content that already fits beside it', () => {
  const result = keepClear({ view:{ scale:.5, panX:300, panY:0 } });
  assert.equal(result.moved, true);
  assert.equal(result.scale, .5);
  assert.ok(Math.abs((result.left + result.right) / 2 - 400) < 1e-9);
  assert.equal(result.top, 100);
});
test('Opening the panel leaves clear, zoomed-in, locked or panel-less views alone', () => {
  for (const options of [
    { view:{ scale:.5, panX:0, panY:0 } },
    { view:{ scale:3, panX:-600, panY:-600 } },
    { view:{ scale:1, panX:0, panY:0 }, locked:true },
    { view:{ scale:1, panX:0, panY:0 }, panel:null },
  ]) {
    const result = keepClear(options);
    assert.equal(result.moved, false);
    assert.equal(result.scale, options.view.scale);
  }
});
