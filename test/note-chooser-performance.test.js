"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../src/client/app/note-cards.js"), "utf8"),
  track = source.slice(source.indexOf("  function noteChooserTrack("), source.indexOf("  function noteSetCategory("));
function fixture() {
  let now = 0, frame, documentId = "canvas", mask = {}, size = {width:1200,height:900};
  const writes = [], calls = {mask:0,search:0,closed:0}, widget = {x:400,y:180,w:320,h:400},
    state = {widgets:[widget],scale:1,panX:0,panY:0},
    element = {offsetWidth:400,offsetHeight:140,style:{set width(value){writes.push(["width",value]);},setProperty:(...args)=>writes.push(args)}},
    noteCards = {chooser:{widget,element}},
    context = vm.createContext({state,noteCards,ASSIST_NAVIGATION_SETTLE_MS:120,performance:{now:()=>now},
      requestAnimationFrame:callback=>{frame=callback;return 1;},canvasDocumentsCurrent:()=>({id:documentId}),
      closeNoteChooser:()=>{calls.closed++;noteCards.chooser=null;},widgetBox:widget=>widget,
      assistScreenBox:box=>({x:box.x*state.scale+state.panX,y:box.y*state.scale+state.panY,w:box.w*state.scale,h:box.h*state.scale}),
      canvasViewportMetrics:()=>size,assistContentMask:()=>{calls.mask++;return mask;},assistOccupiedArea:()=>0,
      assistFindPlacement:(_mask,_w,_h,spot)=>{calls.search++;return spot;},
    });
  vm.runInContext(track,context);context.noteChooserTrack();
  return {state,widget,element,noteCards,writes,calls,frame:ms=>{now+=ms;frame();},
    changeContent:()=>{mask={};},resize:(width,height)=>{size={width,height};},switchDocument:()=>{documentId="other";}};
}
test("a stationary Note chooser reuses placement and avoids redundant style writes",()=>{
  const h=fixture(),writes=h.writes.length;
  for(let i=0;i<10;i++)h.frame(16);
  assert.equal(h.calls.search,1);assert.equal(h.writes.length,writes);
  h.changeContent();h.frame(16);assert.equal(h.calls.search,2,"settled content changes still refresh the occupied placement");
});
test("pan and wheel zoom follow the card without pixel scans until navigation settles",()=>{
  for(const gesture of [null,{test:true}]){
    const h=fixture(),previous=h.noteCards.chooser.placement,initial={...h.calls};
    h.state.panGesture=gesture;
    for(let i=0;i<10;i++){h.state.panX+=2;h.state.panY+=1;h.frame(16);}
    assert.equal(h.calls.mask,initial.mask);assert.equal(h.calls.search,initial.search);
    assert.equal(h.noteCards.chooser.screenX,Math.round(previous.point.x+20));
    h.state.scale=1.2;h.frame(16);assert.equal(h.calls.mask,initial.mask);
    assert.equal(h.noteCards.chooser.screenY,Math.round(previous.point.y*1.2+10));
    h.state.panGesture=null;h.changeContent();h.frame(119);assert.equal(h.calls.search,initial.search);
    h.frame(1);assert.equal(h.calls.search,initial.search+1);assert.equal(h.calls.mask,initial.mask+1);
  }
});
test("drawing and object gestures defer content scans through their quiet period",()=>{
  for(const key of ["drawing","widgetGesture","imageGesture","animationGesture","selectionGesture","pendingGesture","touchGesture"]){
    const h=fixture(),initial={...h.calls};h.state[key]={};
    for(let i=0;i<10;i++){h.changeContent();h.frame(16);}
    assert.equal(h.calls.mask,initial.mask,key);assert.equal(h.calls.search,initial.search,key);
    h.state[key]=null;h.frame(119);assert.equal(h.calls.mask,initial.mask,key);
    h.frame(1);assert.equal(h.calls.search,initial.search+1,key);
  }
});
test("dragging keeps the chooser attached and viewport resize keeps it visible",()=>{
  const h=fixture(),previous=h.noteCards.chooser.placement;
  h.state.widgetGesture={};h.widget.x-=80;h.widget.y+=30;h.frame(16);
  assert.equal(h.calls.search,1);assert.equal(h.noteCards.chooser.screenX,previous.point.x-80);
  assert.equal(h.noteCards.chooser.screenY,previous.point.y+30);
  h.resize(390,844);h.element.offsetWidth=374;h.frame(16);
  assert.equal(h.noteCards.chooser.width,374);assert.equal(h.noteCards.chooser.screenX,8);
  h.state.widgetGesture=null;h.changeContent();h.frame(120);assert.equal(h.calls.search,2);
});
test("the tracking frame closes after its card is removed or its Canvas changes",()=>{
  for(const change of [h=>{h.state.widgets=[];},h=>h.switchDocument()]){
    const h=fixture();change(h);h.frame(16);assert.equal(h.calls.closed,1);assert.equal(h.noteCards.chooser,null);
  }
});
