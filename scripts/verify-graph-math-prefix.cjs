"use strict";
// Render the exact provider expression and a repaired saved graph in Chromium.
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || "playwright");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,".."),output=path.resolve(process.env.PENECHO_VERIFY_OUTPUT||path.join(root,"docs/verification/graph-math-prefix-20261006")),
  cloud=process.argv.includes("--cloud"),context=vm.createContext({}),
  original=fs.readFileSync(path.join(root,"docs/verification/graph-math-prefix-20261006/before/graph.html"),"utf8"),
  report={runtime:cloud?"cloud-mirror":"local",mockedProviderExpression:"x*Math.sin(x)",checks:[],errors:[]};
fs.mkdirSync(output,{recursive:true});
const graphSource=path.resolve(process.env.PENECHO_VERIFY_GRAPH_SOURCE||(cloud?path.join(root,"../penecho_cloud/public/canvas/smart-suggest.js"):path.join(root,"public/smart-suggest.js")));
report.graphSource=graphSource;
vm.runInContext(fs.readFileSync(graphSource,"utf8"),context);
const SMART=context.PENECHO_SMART_SUGGEST;
(async()=>{let browser;try{
  browser=await chromium.launch({headless:true});
  for(const [name,html] of [["before",original],["after",SMART.graphWidgetCommand({expression:"x*Math.sin(x)"},{language:"en"}).html],["reopened",SMART.upgradeGraphWidgetHtml(original)]]) {
    const page=await browser.newPage({viewport:{width:1000,height:650},deviceScaleFactor:2});
    page.on("pageerror",e=>report.errors.push(e.message));
    const source=html.replace('const $ = id =>','window.graphMathAudit={state,math,draw};const $ = id =>');
    await page.setContent(source);
    await page.waitForFunction(()=>Boolean(window.graphMathAudit?.state.rows.length));
    const result=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const row=graphMathAudit.state.rows[0],canvas=document.querySelector('#c'),q=canvas.getContext('2d'),pixels=q.getImageData(0,0,canvas.width,canvas.height).data;
      let blue=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>128&&pixels[i+2]>150&&pixels[i+2]-pixels[i]>80&&pixels[i+2]-pixels[i+1]>25)blue++;
      resolve({expression:row.src,error:row.error||null,samples:row.fn?[-8,-3,-1,0,1,3,8].map(x=>({x,y:row.fn(x,0,graphMathAudit.state.params,0)})):[],bluePixels:blue});
    }))));
    if(name==='before'){assert.ok(result.error);assert.equal(result.bluePixels,0,'broken provider expression draws no curve');}
    else{assert.equal(result.error,null);assert.ok(result.bluePixels>500,'the curve has actual visible colored pixels');for(const point of result.samples)assert.equal(point.y,point.x*Math.sin(point.x));}
    await page.screenshot({path:path.join(output,`${name}.png`)});report.checks.push({name,...result});await page.close();
  }
  assert.deepEqual(report.errors,[]);
}finally{await browser?.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({output,runtime:report.runtime,checks:report.checks.length,errors:report.errors}));})().catch(e=>{console.error(e);process.exitCode=1;});
