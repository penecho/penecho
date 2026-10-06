"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const SMART=require("../public/smart-suggest.js");
function choice(probabilities){const [choice,confidence]=Object.entries(probabilities).sort((a,b)=>b[1]-a[1])[0];return {type:"choice",choice,confidence,probabilities};}
test("sketch motion participates directly in ordinary and selected model questions",()=>{
  for(const context of [{},{selection:true},{shapesFit:true}]){
    const criteria=SMART.buildQuestions(context).action.criteria;
    assert.ok(criteria.animate_sketch&&criteria.animate&&criteria.practice);
    assert.equal(SMART.actionById("animate_sketch").proxy,undefined);
  }
  assert.equal(SMART.executionRoute("animate_sketch"),"canvas_ai");
  assert.equal(SMART.executionRoute("animate"),"penecho_agent");
});
test("a static-illustration verdict does not fabricate a model sketch-motion score",()=>{
  const ranked=SMART.rankActions({answers:{kind:choice({drawing:1}),action:choice({none:.01,vivid:.94,animate_sketch:.02,finish_drawing:.03})}});
  assert.equal(ranked.items[0].id,"vivid");
  assert.ok((ranked.items.find(item=>item.id==="animate_sketch")?.p||0)<.05);
});
test("motion remains available for sketches classified as pictures, shapes or requests",()=>{
  for(const kind of ["drawing","shape","question","notes"]){
    const answers={kind:choice({[kind]:1}),action:choice({none:.01,animate_sketch:.96,vivid:.02,animate:.01})};
    assert.equal(SMART.rankActions({answers}).items[0].id,"animate_sketch");
    assert.equal(SMART.decide(answers).chips[0].id,"animate_sketch");
  }
});
test("animated teaching does not lose agreement for code or prose process explanations",()=>{
  for(const kind of ["code","notes","math_expr","diagram"]){
    assert.equal(SMART.rankActions({answers:{kind:choice({[kind]:1}),action:choice({none:.01,animate:.95,explain:.04})}}).items[0].id,"animate");
  }
});
test("a returned static picture can offer independently classified sketch animation",()=>{
  const answers={kind:choice({drawing:1}),action:choice({none:.02,animate_sketch:.93,vivid:.05})};
  assert.equal(SMART.rankResultActions(answers,{previousAction:"vivid"}).items[0].id,"animate_sketch");
  assert.deepEqual(SMART.rankResultActions(answers,{previousAction:"practice"}).items,[]);
});
test("an explicit request to complete the source drawing keeps Finish ahead of new visual creation",()=>{
  const answers={kind:choice({question:.58,shape:.38,drawing:.04}),
    action:choice({none:.001,finish_drawing:.64,create_visual:.33,answer:.029})};
  assert.equal(SMART.rankActions({answers}).items[0].id,"finish_drawing");
  assert.equal(SMART.decide(answers).chips[0].id,"finish_drawing");
});
test("motion marks beside a drawing promote sketch animation; shading inside it does not",()=>{
  const line=(x0,y0,x1,y1,n=16)=>({points:Array.from({length:n},(_,i)=>({x:x0+(x1-x0)*i/(n-1),y:y0+(y1-y0)*i/(n-1)}))});
  const circle=(cx,cy,r)=>({points:Array.from({length:40},(_,i)=>({x:cx+r*Math.cos(i/39*Math.PI*2),y:cy+r*Math.sin(i/39*Math.PI*2)}))});
  const car=[line(200,300,400,300),line(200,300,230,250),line(230,250,380,250),line(380,250,400,300),circle(240,310,18),circle(360,310,18)];
  const speed=[line(120,260,175,260),line(110,280,170,280),line(125,300,172,300)];
  assert.equal(SMART.motionCues([...car,...speed]).type,"speed-lines");
  const hatching=[line(250,270,300,270),line(250,280,300,280),line(250,290,300,290)];
  assert.equal(SMART.motionCues([...car,...hatching]),null,"parallel shading inside the body is not motion");
  const triangle={points:[...line(450,250,450,290,10).points,...line(450,290,480,270,10).points.slice(1),...line(480,270,450,250,10).points.slice(1)]};
  assert.equal(SMART.motionCues([...car,triangle]).type,"play");
  assert.equal(SMART.motionCues([line(0,0,50,0),line(0,10,50,10)]),null);
  const features={strokes:9,rows:2,aspect:1.3,motionCue:{type:"speed-lines"}},local=SMART.localPredict(features);
  assert.equal(local.kind,"drawing");
  assert.equal(Object.entries(local.probabilities).sort((a,b)=>b[1]-a[1])[0][0],"animate_sketch");
  const answers={kind:choice({drawing:1}),action:choice({none:.01,vivid:.9,animate_sketch:.05,finish_drawing:.04})},
    ranked=SMART.rankActions({local,answers});
  assert.equal(ranked.items[0].id,"vivid","a confident model verdict still leads");
  assert.equal(ranked.items[1].id,"animate_sketch","the motion cue keeps animation in view");
  const plain=SMART.rankActions({local:SMART.localPredict({strokes:9,rows:2,aspect:1.3}),answers});
  assert.ok(plain.items.findIndex(item=>item.id==="animate_sketch")!==1||plain.items[1].p<ranked.items[1].p);
});
