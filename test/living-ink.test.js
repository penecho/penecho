"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
const M=require("../public/living-ink-model.js"),UI=require("../public/living-ink.js"),tools=require("../src/client/ink-lab-tools.js");
const p=(x,y)=>({x,y});

test("independent single-stroke and multi-stroke shapes become separate entities with source ink",()=>{
  for(const split of [false,true]) {
    const s=M.empty(),triangle=[p(20,150),p(90,20),p(170,150),p(20,150)],box=[p(260,30),p(390,30),p(390,140),p(260,140),p(260,30)];
    for(const points of [triangle,box]) {if(split)for(let i=0;i<points.length-1;i++)M.addStroke(s,[points[i],points[i+1]]);else M.addStroke(s,points);}
    M.recognize(s);assert.deepEqual(s.entities.map(e=>e.kind),["triangle","rectangle"]);assert.equal(s.pending.length,0);
    assert.deepEqual(s.entities.map(e=>e.ink.length),split?[3,4]:[1,1]);assert.deepEqual(M.validate(s),s);
  }
});
test("unrecognized freehand remains editable ink instead of disappearing",()=>{const s=M.empty();M.addStroke(s,[p(10,10),p(60,20),p(25,50),p(80,80)]);M.recognize(s);assert.equal(s.entities[0].kind,"ink");assert.equal(s.entities[0].ink.length,1);});
test("unrelated earlier strokes do not suppress a new pair of interactive objects",()=>{
  const strokes=Array.from({length:8},(_,i)=>({points:[p(10+i*20,10),p(30+i*20,30),p(10+i*20,50),p(30+i*20,70)]}));
  for(const points of [[p(20,250),p(90,120),p(170,250),p(20,250)],[p(260,130),p(390,130),p(390,240),p(260,240),p(260,130)]])for(let i=0;i<points.length-1;i++)strokes.push({points:[points[i],points[i+1]]});
  const offer=M.recentObjectOffer(strokes);assert.ok(offer);assert.equal(offer.count,2);assert.deepEqual(M.importStrokes(offer.strokes).entities.filter(e=>!["ink","line"].includes(e.kind)).map(e=>e.kind),["triangle","rectangle"]);
  assert.equal(M.recentObjectOffer(strokes.slice(0,8)),null);
});
test("recognition attaches a connecting line and preserves its source",()=>{
  const s=M.preset("objects"),[a,b]=s.entities;M.addStroke(s,[p(430,240),p(490,220)]);M.recognize(s);
  assert.equal(s.entities.length,2);assert.equal(s.edges.length,1);assert.equal(s.edges[0].from,a.id);assert.equal(s.edges[0].to,b.id);assert.equal(s.edges[0].ink.length,1);
});
test("group movement and connectors survive serialization and deletion removes dangling references",()=>{
  const s=M.preset("objects"),[a,b]=s.entities;const edge=M.connect(s,a.id,b.id,"yes"),before=M.anchors(s,edge);M.group(s,[a.id,b.id]);M.translate(s,[a.id],35,-10);
  assert.deepEqual(M.anchors(s,edge),before.map(p=>({x:p.x+35,y:p.y-10})));assert.deepEqual(M.validate(s),s);
  M.remove(s,[a.id]);assert.equal(s.edges.length,0);assert.equal(s.entities.length,1);assert.doesNotThrow(()=>M.validate(s));
});
test("geometry uses actual vertices, preserves a right angle, and mirrors equal area",()=>{
  const s=M.preset("geometry"),e=s.entities[0];assert.equal(M.metrics(e).area,33000);e.rightAngle=true;M.moveVertex(e,2,p(380,250));
  assert.ok(Math.abs(M.metrics(e).angles[1]-90)<.01);M.moveVertex(e,0,p(150,320));assert.ok(Math.abs(M.metrics(e).angles[1]-90)<.03);
  const copy=M.mirror(s,e.id);assert.ok(Math.abs(M.metrics(e).area-M.metrics(copy).area)<.1);
});
test("physics handles friction threshold, finite travel, periods, center of mass, and balance",()=>{
  const p=M.empty().physics;p.angle=30;p.friction=.7;assert.equal(M.physics(p,30).distance,0);p.friction=0;assert.ok(Math.abs(M.physics(p,1).acceleration-4.905)<1e-9);assert.equal(M.physics(p,100).distance,4);
  p.kind="pendulum";p.length=1;const first=M.physics(p,0);p.length=4;assert.equal(M.physics(p,0).period,2*first.period);
  p.kind="spring";p.mass=2;p.mass2=3;const v=M.physics(p,1);assert.ok(Math.abs(v.left*p.mass+v.right*p.mass2)<1e-10);
  p.kind="lever";p.mass=p.mass2;assert.equal(M.physics(p,20).angle,0);assert.equal(M.physics(p,20).balanced,true);
});
test("physics bindings reject incompatible objects without inventing them",()=>{const s=M.preset("objects");assert.equal(M.bindPhysics(s),true);s.physics.kind="pendulum";assert.equal(M.bindPhysics(s),false);assert.equal(s.entities.length,2);});
test("conditional flow follows yes/no and breadth-first queue avoids cycles",()=>{
  for(const answer of [true,false]){const s=M.preset("flow");s.flow.branch=answer;let r=M.flowStart(s);while(!r.done)r=M.flowStep(s,r);assert.deepEqual(r.visited,[s.entities[0].id,s.entities[1].id,s.entities[answer?2:3].id]);}
  const s=M.preset("tree");M.connect(s,s.entities[3].id,s.entities[0].id);let r=M.flowStart(s);while(!r.done)r=M.flowStep(s,r);assert.equal(r.visited.length,4);assert.equal(new Set(r.visited).size,4);
  s.flow.traversal="path";M.connect(s,s.entities[2].id,s.entities[0].id);r=M.flowStart(s);while(!r.done)r=M.flowStep(s,r);assert.equal(r.reason,"limit");assert.equal(r.steps,100);
});
test("wireframe controls belong to screens and retain navigation and values",()=>{
  const s=M.preset("wireframe"),screens=s.entities.filter(e=>e.role==="screen"),button=s.entities.find(e=>e.role==="button"),toggle=s.entities.find(e=>e.role==="toggle");assert.equal(button.parent,screens[0].id);assert.equal(button.target,screens[1].id);toggle.value=100;
  const before=M.center(button);M.translate(s,[screens[0].id],10,20);assert.deepEqual(M.center(button),{x:before.x+10,y:before.y+20});assert.equal(M.validate(s).entities.find(e=>e.id===toggle.id).value,100);
});
test("scene validation rejects malformed, oversized and recursive state",()=>{
  const s=M.preset("objects");s.entities[0].points[0].x=NaN;assert.throws(()=>M.validate(s));
  const duplicate=M.preset("objects");duplicate.entities[1].id=duplicate.entities[0].id;assert.throws(()=>M.validate(duplicate),/ID/);
  const dangling=M.preset("objects");dangling.edges.push({id:"l9",from:"e1",to:"e999",ink:[]});assert.throws(()=>M.validate(dangling),/edge/);
  const recursive=M.preset("slides");recursive.slides[0].scene.slides=[{scene:M.empty()}];assert.throws(()=>M.validate(recursive),/slide/);
});
test("all presets produce valid portable scene HTML with exactly two safe script blocks",()=>{
  for(const name of ["blank","objects","geometry","math","data","slides","incline","pendulum","spring","lever","wireframe","flow","tree"]){const s=M.validate(M.preset(name)),html=UI.createHtml(s,"zh");assert.ok(html.length<200000);assert.deepEqual(UI.extractScene(html),s);assert.equal((html.match(/<\/script/gi)||[]).length,2);for(const match of html.matchAll(/<script>([^]*?)<\/script>/g))assert.doesNotThrow(()=>new vm.Script(match[1]));}
  const s=M.preset("objects");s.entities[0].label='</script><img src=x onerror=alert(1)>';const html=UI.createHtml(s);assert.deepEqual(UI.extractScene(html),s);assert.equal((html.match(/<\/script/gi)||[]).length,2);
});
test("local math calculates derivatives, integrals, roots, parameters and finite plotting gaps",()=>{
  assert.equal(tools.calculate("x^3","derivative"),"3*x^2");assert.match(tools.calculate("2*x","integral"),/x\^2/);assert.deepEqual(tools.calculate("x^2-4","solve").split(", ").sort(),["-2","2"]);
  assert.ok(Math.abs(tools.compile("a*sin(x)+b",{a:2,b:1,c:0})(Math.PI/2)-3)<1e-10);assert.ok(Number.isNaN(tools.compile("1/x",{})(0)));
  assert.throws(()=>tools.compile("globalThis.fetch(x)",{}));assert.throws(()=>tools.compile("import(x)",{}));assert.throws(()=>tools.compile("sin(x);alert(x)",{}));
  assert.deepEqual(tools.dataset("A,12\nB,-5"),[{label:"A",value:12},{label:"B",value:-5}]);assert.throws(()=>tools.dataset("A,abc"));
});
test("PptxGenJS produces a valid PowerPoint package with editable title and speaker notes",async()=>{
  const pptx=new tools.PptxGenJS();pptx.layout="LAYOUT_WIDE";const slide=pptx.addSlide();slide.addText("Ink Lab 测试",{x:1,y:1,w:10,h:1});slide.addNotes("Test notes");
  const data=await pptx.write({outputType:"nodebuffer"}),zip=await require("jszip").loadAsync(data);
  assert.ok(zip.file("ppt/slides/slide1.xml"));assert.match(await zip.file("ppt/slides/slide1.xml").async("string"),/Ink Lab 测试/);assert.match(await zip.file("ppt/notesSlides/notesSlide1.xml").async("string"),/Test notes/);
});
test("Canvas source includes local bridge with interaction and source guards",()=>{
  const root=path.resolve(__dirname,".."),source=fs.readFileSync(path.join(root,"src/client/app/living-ink.js"),"utf8"),host=fs.readFileSync(path.join(root,"public/widget-host.js"),"utf8");
  assert.match(source,/widget\.sourceFormat !== livingInkSourceFormat/);assert.match(source,/state\.interactingWidgetId !== widget\.id/);assert.match(source,/recordWidgetsBefore\(\)/);assert.match(source,/saveUserCanvasChange\(\)/);assert.match(host,/event\.source !== inner\.contentWindow/);assert.match(host,/widgetState\.interactive && Number\.isInteger\(message\.revision\)/);
});
test("scene edits commit atomically through Canvas history and reject inactive or malformed messages",()=>{
  const source=fs.readFileSync(path.join(__dirname,"../src/client/app/living-ink.js"),"utf8"),
    fn=source.slice(source.indexOf("  function livingInkWidgetMessage("));
  const before=UI.createHtml(M.preset("objects")),replies=[],saved=[],widget={id:"widget-1",sourceFormat:"penecho-living-ink",html:before,contentVersion:0,frame:{contentWindow:{postMessage:m=>replies.push(m)}}};
  const context={livingInkSourceFormat:"penecho-living-ink",livingInkModel:M,livingInkRuntime:UI,state:{interactingWidgetId:"widget-1",language:"en",userRevision:0},
    location:{origin:"http://localhost"},recordWidgetsBefore:()=>saved.push(widget.html),saveUserCanvasChange(){},requestRender(){},setStatus(){},livingInkCopy:en=>en};
  vm.createContext(context);vm.runInContext(fn,context);
  const doc=M.preset("objects");M.translate(doc,[doc.entities[0].id],30,40);
  context.livingInkWidgetMessage(widget,{type:"penecho-living-ink-change",revision:1,document:doc});
  assert.equal(saved.length,1);assert.equal(saved[0],before);assert.deepEqual(UI.extractScene(widget.html),doc);assert.equal(replies.at(-1).ok,true);
  const committed=widget.html;doc.entities[0].points[0].x=NaN;
  context.livingInkWidgetMessage(widget,{type:"penecho-living-ink-change",revision:2,document:doc});
  assert.equal(widget.html,committed);assert.equal(saved.length,1);assert.equal(replies.at(-1).ok,false);
  context.state.interactingWidgetId=null;context.livingInkWidgetMessage(widget,{type:"penecho-living-ink-change",revision:3,document:M.empty()});assert.equal(widget.html,committed);
});
