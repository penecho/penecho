"use strict";
// Reproduce Create Visual with a real Canvas AI request, then replay its saved
// output through the canonical Widget host at multiple widths and pixel ratios.
const fs = require("node:fs"), path = require("node:path");
const option = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const root = path.resolve(__dirname, ".."), output = path.resolve(option("output", "docs/verification/create-visual-width-20261005"));
fs.mkdirSync(output, { recursive:true });

async function generate() {
  const sharp = require("sharp"), server = new URL(option("server", "http://localhost:3921"));
  const input = "请画出DNA的3D螺旋架构", w = 1000, h = 180;
  const image = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="white"/><text x="36" y="108" font-size="46" font-family="PingFang SC, sans-serif" fill="#273344">${input}</text></svg>`)).png().toBuffer();
  fs.writeFileSync(path.join(output, "input.png"), image);
  const configSource = await (await fetch(new URL("/api/config.js", server))).text();
  const token = /"accessSessionToken":"([^"]*)"/.exec(configSource)?.[1] || "";
  const headers = { "Content-Type":"application/json", Accept:"application/x-ndjson, application/json", Origin:server.origin,
    "X-PenEcho-Session":token, "X-PenEcho-Client":"create-visual-width-verification" };
  const connection = option("connection", "");
  if (connection) headers["X-PenEcho-Connection"] = connection;
  const plugins = [];
  for (const [id, name, version, refresh] of [["general", "General HTML", "1", 60], ["flowchart", "Professional Diagrams", "2", 86400]]) {
    const document = fs.readFileSync(path.join(root, "public/plugins", id, "plugin.md"), "utf8").trimEnd();
    plugins.push({ id, name, version, connect:[], recommendedRefreshSeconds:refresh, document });
  }
  const source = { x:1000, y:1000, w, h }, payload = {
    atlasImage:`data:image/png;base64,${image.toString("base64")}`, atlasSize:{ w, h }, imageScale:1,
    changedBox:source, sourceRect:source, captureRect:source, visibleRect:{ x:500, y:500, w:3000, h:2200 },
    focusInset:null, hotspotGrid:{ columns:8, rows:8, order:"oldest-to-newest", hotspots:[] },
    trigger:"manual", userAction:"plot", suggestion:"create_visual", reasoningEffort:"medium",
    animationEnabled:true, plugins, canvasSize:{ w:20000, h:20000 }, uiTheme:"studio",
    persona:"Minimal, well-organized general-purpose studio assistant. Prioritize clear structure, legible formatting, concise step-by-step reasoning, and practical actionable answers. Keep visual output clean and uncluttered; avoid decorative flourishes."
  };
  const started = Date.now();
  const response = await fetch(new URL("/api/ai/command", server), { method:"POST", headers, body:JSON.stringify(payload), signal:AbortSignal.timeout(240000) });
  let terminal;
  for (const line of (await response.text()).split("\n")) {
    try { const event = JSON.parse(line); if (["result", "error"].includes(event.type) || !event.type) terminal = event.type ? event : { type:"result", data:event }; } catch {}
  }
  const data = terminal?.data || {}, command = data.commands?.find(item => item.tool === "html_widget");
  const report = { input, inputKind:"Rendered text image; not the user's original handwriting", server:server.origin, connection:connection || "configured default",
    status:terminal?.status ?? response.status, elapsedMs:Date.now() - started, requestId:data.requestId, tools:data.commands?.map(item => item.tool),
    widget:command && { title:command.title, w:command.w, h:command.h, sourceFormat:command.sourceFormat }, error:data.error || null };
  fs.writeFileSync(path.join(output, "generation.json"), JSON.stringify(report, null, 2));
  if (command) {
    fs.writeFileSync(path.join(output, "command.json"), JSON.stringify(command, null, 2));
    fs.writeFileSync(path.join(output, "widget.html"), command.html);
  }
  console.log(JSON.stringify(report));
  if (!command) throw Error("The request did not return an HTML Widget; inspect generation.json.");
}

async function render() {
  const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || "playwright"), http = require("node:http"),
    assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
  const baseline = process.argv.includes("--baseline"), label = option("label", baseline ? "before" : "after");
  const assetRoot = path.resolve(option("assets", path.join(root, "public")));
  const runtime = baseline ? execFileSync("git", ["show", "HEAD:public/scene-runtime.js"], { cwd:root }) : fs.readFileSync(path.join(assetRoot, "scene-runtime.js"));
  const command = JSON.parse(fs.readFileSync(path.join(output, "command.json"), "utf8"));
  assert.equal(command.sourceFormat, "penecho-scene+json", "This regression targets the real generated Scene path.");
  const scene = JSON.parse(command.copyText);
  assert.equal(scene.engine, "3d");
  const report = { baseline, assetRoot, generation:JSON.parse(fs.readFileSync(path.join(output, "generation.json"), "utf8")), samples:[], errors:[] };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const aliases = { "/widget-renderer.js":"vendor/penecho-dom-renderer.js", "/scene-vendor/zdog.js":"vendor/scene/zdog-1.1.3.dist.min.js" };
  let server, browser;
  try {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end('<!doctype html><html><body style="margin:0;background:white"><iframe id="widget" src="/widget-host.html" style="border:0;width:960px;height:640px"></iframe></body></html>');
        return;
      }
      const file = path.resolve(assetRoot, aliases[url.pathname] || url.pathname.slice(1));
      if (!file.startsWith(assetRoot + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".html") ? "text/html" : "text/plain");
      res.end(url.pathname === "/scene-runtime.js" ? runtime : fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    console.log(JSON.stringify({ stage:"server-ready", baseline }));
    browser = await chromium.launch({ headless:true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const dpr of (baseline ? [1, 2] : [1, 1.25, 2, 3])) {
      const context = await browser.newContext({ viewport:{ width:1280, height:1400 }, deviceScaleFactor:dpr });
      const page = await context.newPage(), js = code => page.evaluate(code);
      page.on("pageerror", error => report.errors.push(error.message));
      await page.goto(origin, { waitUntil:"load" });
      console.log(JSON.stringify({ stage:"host-loaded", dpr }));
      await js(`document.querySelector('#widget').contentWindow.postMessage(${JSON.stringify({ type:"penecho-widget-init", title:command.title, html:command.html, sourceFormat:command.sourceFormat, frameworkVersion:command.frameworkVersion, language:"zh" })},location.origin)`);
      let frame;
      for (let attempt = 0; attempt < 100; attempt++) {
        frame = page.frames().find(item => item.url() === "about:srcdoc");
        if (frame && await frame.evaluate("!!document.querySelector('canvas.pes-stage')")) break;
        await pause(50);
      }
      assert.ok(frame, "Generated scene frame exists");
      await frame.evaluate("dispatchEvent(new MessageEvent('message',{data:{type:'penecho-scene-control',action:'pause'}}))");
      for (const [width, height] of (baseline ? [[960, 640], [390, 640]] : [[1000, 1250], [960, 640], [640, 640], [390, 640], [320, 480], [1200, 700], [640, 640]])) {
        await js(`Object.assign(document.querySelector('#widget').style,{width:'${width}px',height:'${height}px'})`);
        await pause(100);
        const facts = await frame.evaluate(`(()=>{
          const c=document.querySelector('canvas.pes-stage'),r=c.getBoundingClientRect(),probe=document.createElement('canvas'),ratio=Math.min(1,1200/c.width);
          probe.width=Math.round(c.width*ratio);probe.height=Math.round(c.height*ratio);
          const q=probe.getContext('2d');q.drawImage(c,0,0,probe.width,probe.height);const p=q.getImageData(0,0,probe.width,probe.height).data;
          let left=probe.width,top=probe.height,right=-1,bottom=-1,painted=0;
          for(let y=0;y<probe.height;y++)for(let x=0;x<probe.width;x++)if(p[(y*probe.width+x)*4+3]>32){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);painted++;}
          return {dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],css:[r.width,r.height],backing:[c.width,c.height],
            pixels:{left,top,right,bottom,painted},visiblePixels:{left:left*r.width/probe.width,right:(right+1)*r.width/probe.width,top:top*r.height/probe.height,bottom:(bottom+1)*r.height/probe.height},
            font:getComputedStyle(document.documentElement).fontSize,errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)};
        })()`);
        report.samples.push({ width, height, ...facts });
        console.log(JSON.stringify({ stage:"measured", dpr, width, height, css:facts.css }));
        assert.deepEqual(facts.errors, []);
        assert.ok(facts.pixels.painted > 100, "The DNA illustration must contain visible pixels");
        if (!baseline) {
          assert.deepEqual(facts.css, facts.viewport, "The 3D stage must match the Widget viewport after every resize");
          assert.deepEqual(facts.backing, facts.viewport.map(value => Math.floor(value * dpr)), "DPR is applied once");
          assert.ok(facts.visiblePixels.left >= 0 && facts.visiblePixels.right <= width, "Complete horizontal drawing bounds fit");
          assert.ok(facts.visiblePixels.top >= 0 && facts.visiblePixels.bottom <= height, "Complete vertical drawing bounds fit");
          assert.ok(facts.pixels.left > 1 && facts.pixels.top > 1, "The illustration must not touch a clipping edge");
          assert.ok(facts.visiblePixels.right < width - 1 && facts.visiblePixels.bottom < height - 1, "The full scene has visible trailing margins");
          assert.ok(Math.abs((facts.visiblePixels.left + facts.visiblePixels.right) / 2 - width / 2) < width * .06, "DNA stays centered horizontally");
        }
        if (dpr === 2 && [960, 390].includes(width)) await page.screenshot({ path:path.join(output, `${label}-${width}.png`), clip:{ x:0, y:0, width, height } });
      }
      if (!baseline && dpr === 2) {
        const paintHash = () => frame.evaluate(`(()=>{const c=document.querySelector('canvas.pes-stage'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let h=2166136261;for(let i=0;i<p.length;i+=29)h=Math.imul(h^p[i],16777619);return h>>>0})()`);
        const control = action => frame.evaluate(action => dispatchEvent(new MessageEvent("message", { data:{ type:"penecho-scene-control", action } })), action);
        const paused = await paintHash(); await pause(100);
        assert.equal(await paintHash(), paused, "Paused DNA keeps its orientation");
        await control("play"); await pause(350); await control("pause");
        assert.notEqual(await paintHash(), paused, "DNA rotation remains live");
        const rotated = await paintHash();
        await js("document.querySelector('#widget').style.width='390px'"); await pause(100);
        await js("document.querySelector('#widget').style.width='640px'"); await pause(100);
        assert.equal(await paintHash(), rotated, "Narrowing and restoring width preserves the current orientation");
        report.playback = { pause:true, rotation:true, resizePreservesOrientation:true };
      }
      await context.close();
    }
    assert.deepEqual(report.errors, []);
    report.ok = true;
  } catch (error) { report.failure = error.stack; }
  finally {
    await browser?.close();
    if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
    fs.writeFileSync(path.join(output, `${label}-report.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok:report.ok, samples:report.samples.length, failure:report.failure, output }));
    process.exitCode = report.ok ? 0 : 1;
  }
}

if (process.argv.includes("--generate")) generate().catch(error => { console.error(error.message); process.exitCode = 1; });
else render().catch(error => { console.error(error.stack); process.exitCode = 1; });
