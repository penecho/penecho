"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const SMART=require("../public/smart-suggest.js"),math=SMART.createGraphMath();
const value=(source,x=0,y=0,z=0,p={})=>math.compile(source).f(x,y,p,z);

test("provider Math notation produces the same curve as native mathematical notation",()=>{
  for(const x of [-8,-Math.PI,-1,0,1,Math.PI,8])assert.equal(value("x*Math.sin(x)",x),value("x*sin(x)",x));
  assert.equal(value("Math.log(Math.E)"),1,"JavaScript log remains the natural logarithm");
  assert.equal(value("Math.log10(100)"),2);
  assert.equal(value("Math.PI"),Math.PI);
  assert.equal(value("Math.sqrt(9)+Math.abs(-2)"),5);
  for(const source of ["Math.random()","Math.sin.constructor(x)","window.Math.sin(x)","Math['sin'](x)","Math.sin(x);alert(1)"])assert.throws(()=>math.compile(source),source);
  const widget=SMART.graphWidgetCommand({expression:"x*Math.sin(x)"});
  assert.equal(widget.title,"y = x*sin(x)");
  assert.deepEqual(SMART.graphDocumentData(widget.html).data.expressions,["y = x*sin(x)"]);
  assert.equal(SMART.graphSpec({expression:"Math.sin(x)*Math.cos(y)"}).mode,"3d");
});

test("saved native graphs accept provider Math notation on reopen without rewriting document data",()=>{
  const fixture=fs.readFileSync(path.join(__dirname,"fixtures/graph-v2-before-interactions.html"),"utf8"),stored=SMART.graphDocumentData(fixture).data,
    original=SMART.updateGraphDocument(fixture,{...stored,mode:"2d",expressions:["x*Math.sin(x)","Math.log10(100)"],parameters:{},window2:[-10,10,-10,10]}).html,
    updated=SMART.upgradeGraphWidgetHtml(original);
  assert.deepEqual(SMART.graphDocumentData(updated).data,SMART.graphDocumentData(original).data);
  const engine=updated.slice(updated.indexOf("function createGraphMath()"),updated.indexOf("function installReadableGraphUi()")),restored=new Function(`${engine};return createGraphMath();`)();
  assert.equal(restored.equation("x*Math.sin(x)","2d").fn(2,0,{},0),2*Math.sin(2));
  assert.equal(restored.equation("Math.log10(100)","2d").fn(0,0,{},0),2);
  assert.equal(SMART.upgradeGraphWidgetHtml(updated),updated,"normalization repair is idempotent");
});

test("math parsing preserves coordinate meaning and standard precedence",()=>{
  assert.equal(value("-x²",3),-9);
  assert.equal(value("2^3^2"),512);
  assert.equal(value("x¹²",2),4096);
  assert.equal(value("2xy + 3z",2,3,4),24);
  assert.ok(Math.abs(value("sin²(x) + cos²(x)",.73)-1)<1e-12);
  assert.equal(value("a(x+1)",3,0,0,{a:2}),8);
  assert.equal(value("sqrt(9) + | -2 |"),5);
  assert.deepEqual(math.compile("x+y+z+a").names,["a"]);
  assert.throws(()=>math.compile("sin(x"));
  assert.throws(()=>math.equation("z = f(x)","3d"),/unsupported/);
  assert.throws(()=>math.equation("z > x","3d"),/unsupported/);
  assert.throws(()=>math.equation("z =","3d"),/equation/);
  assert.equal(math.equation("  ","3d").kind,"empty");
});

test("complete equations select the dependent axis; dimension is explicit",()=>{
  for(const [source,axis,expected] of [["z=sin(x)*cos(y)","z",Math.sin(1)*Math.cos(2)],["x=y²+z²","x",13],["y=x+z","y",4],["z=2","z",2]]) {
    const r=math.equation(source,"3d");assert.equal(r.kind,"explicit");assert.equal(r.axis,axis);assert.equal(r.fn(1,2,{},3),expected);
  }
  assert.equal(math.equation("x²+y²+z²=1","3d").fn(1,0,{},0),0);
  assert.equal(math.equation("x²+y²=4","2d").kind,"implicit");
  assert.equal(math.equation("y=x²","3d").axis,"y");
  assert.equal(math.equation("f(x,y)=x+y","3d").axis,"z");
  assert.throws(()=>math.equation("z=sin(x)","2d"),/dimension/);
  assert.throws(()=>math.equation("x²+y²+z²=1","2d"),/dimension/);
  assert.equal(math.equation("a=2","3d").kind,"parameter");
  assert.throws(()=>math.equation("a=x","3d"),/parameter/);
  assert.equal(SMART.graphSpec({expression:"y=x²"}).mode,"2d");
  assert.equal(SMART.graphSpec({expression:"z=2"}).mode,"3d");
  assert.equal(SMART.graphSpec({expression:"xy"}).mode,"3d");
  assert.equal(SMART.graphSpec({expression:"x²+y²=1"}).mode,"2d");
  assert.deepEqual(SMART.graphSpec({mode:"3d",expression:"y=x²"}).expressions,["y=x²"]);
});

test("numerical implicit geometry lies on a full sphere and preserves all axes",()=>{
  const row=math.equation("x²+y²+z²=1","3d"),faces=math.mesh(row,2,{},20),points=faces.flat();
  assert.ok(faces.length>100);
  assert.ok(points.every(([x,y,z])=>Math.abs(x*x+y*y+z*z-1)<1e-5));
  for(let axis=0;axis<3;axis++){assert.ok(Math.min(...points.map(p=>p[axis]))<-.99);assert.ok(Math.max(...points.map(p=>p[axis]))>.99);}
  for(const equation of ["x=y²+z²","y=x²+z²","z=x²+y²"]) {
    const r=math.equation(equation,"3d"),surface=math.mesh(r,2,{},20),axis="xyz".indexOf(r.axis);
    assert.ok(surface.length>20);
    assert.ok(surface.flat().every(p=>p.every(v=>v>=-2-1e-8&&v<=2+1e-8)));
    // Clipped edge vertices approximate the quadratic between sample points.
    assert.ok(surface.flat().every(p=>Math.abs(p[axis]-r.fn(p[0],p[1],{},p[2]))<.03));
  }
  const plane=math.mesh(math.equation("z=2","3d"),3,{},12);
  assert.ok(plane.length>20);assert.ok(plane.flat().every(p=>p[2]===2));
  assert.equal(math.mesh(math.equation("z=100","3d"),3,{},12).length,0,"offscreen surfaces must not become false box faces");
});

test("2D implicit contours are closed shapes, with no pole drawn as a root",()=>{
  const r=math.equation("x²+y²=1","2d"),lines=math.contour(r.fn,[-2,2,-2,2],{},40,40);
  assert.ok(lines.length>30);
  assert.ok(lines.flat().every(([x,y])=>Math.abs(x*x+y*y-1)<1e-5));
  const pole=math.equation("1/x=0","2d");
  assert.equal(math.contour(pole.fn,[-1.03,1,-1,1],{},30,30).length,0);
  assert.equal(math.mesh(math.equation("1/x=0","3d"),2.03,{},13).length,0);
});

test("document edits round-trip full equations, mode and sliders without code injection",()=>{
  const html=SMART.graphWidgetCommand({expression:"z=2"}).html;
  const document={version:2,mode:"3d",expressions:["x²+y²+z²=a²","a=2",""],parameters:{a:2},view3:{az:-.85,el:.55,R:3,zoom:1},window2:null};
  const saved=SMART.updateGraphDocument(html,document),data=SMART.graphDocumentData(saved.html).data;
  assert.deepEqual(data.expressions,document.expressions);assert.equal(data.mode,"3d");assert.equal(data.parameters.a,2);assert.equal(data.view3.R,3);
  assert.match(saved.copyText,/x²\+y²\+z²=a²/);
  const injected=SMART.updateGraphDocument(html,{...document,expressions:['</script><script>alert(1)</script>']});
  assert.equal((injected.html.match(/<script>/g)||[]).length,1);
  assert.deepEqual(SMART.graphDocumentData(injected.html).data.expressions,['</script><script>alert(1)</script>']);
  for(const invalid of [{mode:"auto"},{expressions:[]},{expressions:["x".repeat(2001)]},{parameters:{z:1}},{view3:{az:0,el:0,R:-1,zoom:1}},{window2:[1,1,0,1]}])assert.equal(SMART.updateGraphDocument(html,{...document,...invalid}),null);
});

test("legacy 3D rows retain their old height meaning during migration",()=>{
  const original=fs.readFileSync(path.join(__dirname,"fixtures/graph-legacy.html"),"utf8");
  const old=original.replace('"expressions":["x^2-2*x+8"]','"expressions":["x+y","sin(x)","2"]');
  const upgraded=SMART.upgradeGraphWidgetHtml(old),data=SMART.graphDocumentData(upgraded).data;
  assert.equal(data.mode,"3d");assert.deepEqual(data.expressions,["z = x+y","z = sin(x)","z = 2"]);
  assert.equal(SMART.upgradeGraphWidgetHtml(upgraded),upgraded);
  new Function(upgraded.slice(upgraded.indexOf("<script>")+8,upgraded.lastIndexOf("</script>")));
});
