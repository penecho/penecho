"use strict";
// Exercise the actual Canvas renderer with isolated data and no model requests.
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || "playwright");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-summon-anchor-"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(directory,"state"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" });
const server = require("../server.js");
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listening ? resolve() : server.once("listening",resolve));
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:1440,height:900},reducedMotion:"reduce"}), errors = [], checks = [];
    page.on("pageerror", error => errors.push(error.message));
    const source = fs.readFileSync(path.resolve(__dirname,"../public/app.js"),"utf8")
      .replace(/\}\)\(\);\s*$/, "window.summonTest={state,stroke,render,setBusy,setCanvasMode};})();");
    await page.route(/^https:\/\//, route => route.abort());
    await page.route("**/app.js*", route => route.fulfill({contentType:"application/javascript",body:source}));
    await page.addInitScript(() => { if (window.top === window) localStorage.setItem("penecho-language","en"); });
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:"domcontentloaded"});
    await page.waitForFunction(() => Boolean(window.summonTest));
    async function measure() {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      return page.evaluate(() => {
        const s=summonTest.state, canvas=document.querySelector("#summonLayer"), copy=document.querySelector(".summon-copy"), style=getComputedStyle(copy),
          pixels=canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data;
        let painted=0;
        for(let i=3;i<pixels.length;i+=4) if(pixels[i]) painted++;
        return {scale:s.scale,panX:s.panX,panY:s.panY,x:parseFloat(style.left),y:parseFloat(style.top),w:parseFloat(style.width),painted,hidden:canvas.hidden};
      });
    }
    function followsPan(before,after,label) {
      assert.ok(Math.abs(after.x-before.x-(after.panX-before.panX))<0.1,`${label}: caption follows horizontal pan`);
      assert.ok(Math.abs(after.y-before.y-(after.panY-before.panY))<0.1,`${label}: caption follows vertical pan`);
      assert.equal(after.w,before.w,`${label}: caption is not squeezed at the edge`);
      assert.equal(after.hidden,false,`${label}: request animation continues`);
      checks.push({label,...after});
    }
    for (const anchored of [true,false]) {
      const label=anchored?"input-anchor":"initial-fallback";
      await page.evaluate(anchored => {
        const t=summonTest,s=t.state;
        s.auto=false;s.scale=1;s.panX=200;s.panY=120;s.summonEnabled=true;
        s.summonAnchor=anchored?{x:200,y:180,w:360,h:160}:null;
        if(anchored) t.stroke({x:240,y:220},{x:500,y:290},false,5,true,"#333333");
        t.setCanvasMode("hand");t.render();t.setBusy(true);
      },anchored);
      const initial=await measure();
      assert.ok(initial.painted>100,`${label}: initial outline is visible`);
      await page.screenshot({path:path.join(directory,`${label}-initial.png`)});
      // A real Hand drag must move both ink and the ongoing animation.
      const viewport=await page.locator("#viewport").boundingBox();
      await page.mouse.move(viewport.x+viewport.width-140,viewport.y+viewport.height-170);
      await page.mouse.down();
      await page.mouse.move(viewport.x+viewport.width-460,viewport.y+viewport.height-290,{steps:8});
      await page.mouse.up();
      const dragged=await measure();
      assert.ok(Math.abs(dragged.panX-initial.panX)>100,`${label}: the Hand drag changed the canvas view`);
      followsPan(initial,dragged,`${label}-drag`);
      for (const [name,dx,dy] of [["partial",-480,0],["left",-2400,0],["right",2400,0],["top",0,-1800],["bottom",0,1800],["return",0,0]]) {
        await page.evaluate(({panX,panY}) => {Object.assign(summonTest.state,{panX,panY});summonTest.render();},{panX:initial.panX+dx,panY:initial.panY+dy});
        const current=await measure();
        followsPan(initial,current,`${label}-${name}`);
        if(["left","right","top","bottom"].includes(name)) assert.equal(current.painted,0,`${label}-${name}: no replacement animation appears in the viewport`);
        if(name==="return") assert.ok(current.painted>100,`${label}: the original animation reappears`);
        if(["partial","left","return"].includes(name)) await page.screenshot({path:path.join(directory,`${label}-${name}.png`)});
      }
      await page.evaluate(() => {summonTest.state.scale=1.6;summonTest.render();});
      const zoomed=await measure();
      assert.ok(Math.abs(zoomed.x-(initial.panX+(initial.x-initial.panX)*1.6))<0.1,`${label}: zoom retains the canvas anchor`);
      checks.push({label:`${label}-zoom`,...zoomed});
      await page.evaluate(() => summonTest.setBusy(false));
      await page.waitForFunction(() => document.querySelector("#summonLayer").hidden && !document.querySelector(".summon-copy"));
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify({checks,errors},null,2));
    console.log(JSON.stringify({directory,checks:checks.length,errors}));
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().then(() => process.exit(0),error=>{console.error(error);process.exit(1);});
