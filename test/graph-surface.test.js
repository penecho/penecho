"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const SMART=require("../public/smart-suggest.js"),math=SMART.createGraphMath();
const saved=fs.readFileSync(path.join(__dirname,"fixtures/graph-v2-before-interactions.html"),"utf8");
const projectedArea=(face,axes)=>Math.abs(face.reduce((sum,p,i)=>{
  const q=face[(i+1)%face.length];return sum+p[axes[0]]*q[axes[1]]-q[axes[0]]*p[axes[1]];
},0))/2;

test("clipped planes retain their exact full area at all box boundaries and coordinate axes",()=>{
  for(const R of [.2,5,200])for(const n of [12,35,36])for(const axis of ["x","y","z"]) {
    const other=["x","y","z"].filter(a=>a!==axis),axes=other.map(a=>"xyz".indexOf(a));
    for(const [expression,expected] of [[`${axis}=3*${other[0]}`,4*R*R/3],[`${axis}=${other.join("+")}`,3*R*R]]) {
      const faces=math.mesh(math.equation(expression,"3d"),R,{},n);
      assert.ok(faces.length>20);
      for(const face of faces) {
        assert.ok(face.length>=3&&projectedArea(face,axes)>0);
        assert.ok(face.every((p,i)=>p.some((v,k)=>Math.abs(v-face[(i+1)%face.length][k])>R*1e-12)),"no repeated edge vertices");
        assert.ok(face.every(p=>p.every(v=>v>=-R-1e-10&&v<=R+1e-10)));
      }
      const area=faces.reduce((sum,face)=>sum+projectedArea(face,axes),0);
      assert.ok(Math.abs(area-expected)<expected*1e-10,`${expression}, R=${R}, n=${n}: ${area} vs ${expected}`);
    }
  }
});

test("polygon normals retain area after leading duplicate or collinear vertices",()=>{
  for(const face of [
    [[0,0,0],[0,0,0],[1,0,0],[1,1,0],[0,1,0]],
    [[0,0,0],[.5,0,0],[1,0,0],[1,1,0],[0,1,0]],
  ])assert.deepEqual(math.polygonNormal(face),[0,0,2]);
  assert.deepEqual(math.polygonNormal([[0,0,0],[1,0,0],[2,0,0]]),[0,0,0]);
});

test("implicit grid zeros and nonlinear surfaces produce finite usable polygons without false caps",()=>{
  for(const expression of ["x+y+z=0","x+y=0","x²+y²+z²=1","z=sin(x)*cos(y)","z=x²+y²"]) {
    const faces=math.mesh(math.equation(expression,"3d"),2,{},20);
    assert.ok(faces.length>100);
    assert.ok(faces.every(face=>face.flat().every(Number.isFinite)&&Math.hypot(...math.polygonNormal(face))>0));
  }
  assert.equal(math.mesh(math.equation("z=100","3d"),5,{},36).length,0);
  assert.equal(math.mesh(math.equation("1/x=0","3d"),2.03,{},13).length,0);
});

test("saved native graphs receive the surface repair and retain data, styles, custom handlers and snapshot code",()=>{
  const data={version:2,mode:"3d",expressions:["z=3*x","z=a*sin(x)*cos(y)"],parameters:{a:2},view3:{az:.7,el:.4,R:5,zoom:1.4},window2:null};
  const original=SMART.updateGraphDocument(saved,data).html.replace("</style>","/* user style */.badge{color:tomato}</style>")
    .replace("zoom(Math.exp(-e.deltaY * 0.0015)","zoom(Math.exp(-e.deltaY * 0.002)");
  const repaired=SMART.upgradeGraphWidgetHtml(original);
  assert.notEqual(repaired,original);
  assert.deepEqual(SMART.graphDocumentData(repaired),SMART.graphDocumentData(original));
  assert.ok(repaired.includes("/* user style */.badge{color:tomato}"));
  assert.ok(repaired.includes("zoom(Math.exp(-e.deltaY * 0.002)"));
  assert.ok(repaired.includes("normal=math.polygonNormal(face)"));
  assert.equal(SMART.upgradeGraphWidgetHtml(repaired),repaired);
  new Function(repaired.slice(repaired.indexOf("<script>")+8,repaired.lastIndexOf("</script>")));
  const customized=original.replace("const t=(sign*R-a[axis])/(b[axis]-a[axis]);","const t=.5;");
  assert.ok(!SMART.upgradeGraphWidgetHtml(customized).includes("normal=math.polygonNormal(face)"),"custom geometry is not partially migrated");
});
