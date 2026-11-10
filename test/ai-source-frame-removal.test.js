"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = file => fs.readFileSync(`src/client/app/${file}.js`, "utf8");
const functionSource = (file, name) => {
  const match = source(file).match(new RegExp(`function ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, name);
  return match[0];
};
function fixture({busy = false} = {}) {
  const calls = { content:0, controls:0, paths:0, rectangles:0 }, box = {x:20,y:30,w:160,h:90},
    context = new Proxy({
      drawImage() { calls.content++; },
      strokeRect() { calls.rectangles++; },
    }, {get:(target, key) => target[key] ?? (() => {})}),
    env = { state:{scale:1}, ctx:context, draftBounds:() => box, batchBounds:() => box, pendingItemBounds:() => box,
      drawSelectionContent:() => calls.content++, selectionAIBusy:() => busy,
      selectionPathFor:selection => selection.originalPath || [],
      traceSelectionPath:() => calls.paths++, drawResizeHandle:() => calls.controls++, drawSelectionAxisHandles(){},
      drawTextDraftSurface(){}, drawMoveHandle(){}, drawDraftActions(){}, pendingAnimationChromeVisible:() => true,
    };
  return {calls, box, context, draw:(file, name) => vm.runInNewContext(`(${functionSource(file,name)})`, env)};
}
test("automatic AI source selections stay frameless, even with legacy frame metadata", () => {
  const h = fixture(), draw = h.draw("persistence", "drawSelection");
  draw({phase:"active",box:h.box,fragments:[],frameVisible:true});
  assert.equal(h.calls.content,1);
  assert.equal(h.calls.controls,1);
  assert.equal(h.calls.paths,0);
  assert.equal(h.calls.rectangles,0);
});
test("manual lasso selections retain their blue outline and resize controls", () => {
  const h = fixture(), draw = h.draw("persistence", "drawSelection");
  draw({phase:"active",origin:"lasso",box:h.box,fragments:[],originalPath:[{x:20,y:30},{x:180,y:30},{x:180,y:120}]});
  assert.equal(h.calls.paths,1);
  assert.equal(h.calls.controls,1);
  assert.equal(h.context.strokeStyle,"#2679b8");
  assert.equal(h.calls.rectangles,0);
});
test("manual lasso drawing remains visible while the user circles content", () => {
  const h = fixture(), draw = h.draw("persistence", "drawSelection");
  draw({phase:"lasso",points:[{x:20,y:30},{x:180,y:30},{x:180,y:120}]});
  assert.equal(h.calls.paths,1);
  assert.equal(h.calls.content,0);
  assert.equal(h.context.strokeStyle,"#2679b8");
});
test("a manual lasso used by an active AI request hides its outline until the request ends", () => {
  const h = fixture({busy:true}), draw = h.draw("persistence", "drawSelection");
  draw({phase:"active",origin:"lasso",box:h.box,fragments:[]});
  assert.equal(h.calls.content,1);
  assert.equal(h.calls.paths,0);
  assert.equal(h.calls.controls,0);
});
test("manual capture records its lasso origin without changing Canvas content", () => {
  const state = {scale:1}, points = [{x:20,y:30},{x:180,y:30},{x:180,y:120}],
    capture = vm.runInNewContext(`(${functionSource("persistence","captureSelection")})`, {
      state, SIZE:1000, SELECT:{polygonBounds:() => ({x:20,y:30,w:160,h:90}),pathLength:() => 300},
      setStatusKey(){},render(){},
    });
  assert.equal(capture(points),true);
  assert.equal(state.selection.origin,"lasso");
  assert.equal(state.selection.regionOnly,true);
  assert.equal(state.selection.fragments.length,0);
});
test("single AI drafts render content and controls without any rectangle outline", () => {
  const h = fixture(), draw = h.draw("ai-runtime", "drawPending");
  draw({image:{width:160,height:90},scaleX:1,scaleY:1,revealProgress:1,frameVisible:true});
  assert.equal(h.calls.content,1);
  assert.equal(h.calls.controls,1);
  assert.equal(h.calls.rectangles,0);
});
test("batch AI drafts have neither aggregate nor item outline drawing entries", () => {
  const h = fixture(), draw = h.draw("ai-runtime", "drawPendingBatch");
  draw({selectedIndex:0,frameVisible:true,items:[{image:{width:160,height:90}},{image:{width:160,height:90}}]});
  assert.equal(h.calls.content,2);
  assert.equal(h.calls.controls,2);
  assert.equal(h.calls.rectangles,0);
});
