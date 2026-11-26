"use strict";
// Run the two Canvas 112 Asks with eligible saved presets, using a disposable Lines store.
// Usage: node scripts/benchmark-lines-plots.cjs <sine-preset> <tangent-preset> [pairs]
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { setTimeout:delay } = require("node:timers/promises");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { createDraw } = require("../src/server/draw.js");
const F = require("../src/server/project-lines/format.js");
const { plotRange } = require("../src/server/mcp/no-page.js");

async function verifyGraph(service, project, source, writes, first) {
  assert.equal(writes.length, 1, "one drawing request");
  const [write] = writes;
  assert.equal(write.status, 200);
  assert.equal(write.path, source);
  assert.equal(write.preview?.ready, true);
  const widgets = service.readBundle(project, source).assets.filter(a => a.kind === "widget").map(a => JSON.parse(Buffer.from(a.dataBase64, "base64")));
  assert.equal(widgets.length, first ? 2 : 1);
  const widget = widgets.find(w => w.id === write.widget);
  assert.ok(widget);
  if (first) {
    assert.deepEqual(widgets.find(w => w.id === first.id), first);
    assert.ok(widget.x >= first.x + first.w);
    assert.equal(widget.w, first.w);
    assert.equal(widget.h, first.h);
    assert.deepEqual(plotRange(widget.html), plotRange(first.html));
  } else assert.equal(write.fullyVisible, true);
  const range = plotRange(widget.html);
  assert.ok(Math.abs(range.xMin + 4 * Math.PI) < .01 && Math.abs(range.xMax - 4 * Math.PI) < .01);
  const runs = [...widget.html.matchAll(/<polyline points="([^"]+)"/g)].map(m => m[1].split(" ").map(p => Number(p.split(",")[0])));
  assert.equal(runs.length, first ? 9 : 1);
  if (first) {
    const width = Number(/viewBox="0 0 (\d+) /.exec(widget.html)[1]);
    for (let i = -4; i < 4; i++) {
      const pole = 48 + ((i + .5) * Math.PI - range.xMin) / (range.xMax - range.xMin) * (width - 96);
      assert.ok(runs.every(run => run.at(-1) <= pole || run[0] >= pole));
    }
  }
  const { data, info } = await require("sharp")(write.preview.png).removeAlpha().raw().toBuffer({ resolveWithObject:true });
  let ink = 0;
  for (let i = 0; i < data.length; i += info.channels) if (Math.max(data[i],data[i+1],data[i+2]) - Math.min(data[i],data[i+1],data[i+2]) > 85) ink++;
  assert.ok(ink > 500, "rendered preview contains the coloured curve");
  return widget;
}

async function main() {
  const [sine, tangent, pairs = "3"] = process.argv.slice(2);
  if (!sine || !tangent || !/^[1-9]$/.test(pairs)) throw Error("Supply two preset IDs and optionally 1–9 replay pairs.");
  const home = os.homedir(), installed = process.env.PENECHO_BENCH_INSTALL || path.join(home, ".penecho");
  const settings = path.join(installed, "project-lines"), all = JSON.parse(fs.readFileSync(path.join(settings, "agent-presets.json")));
  const presets = [sine, tangent].map(id => {
    const p = all.presets.find(p => p.id === id && p.allowDelegation !== false);
    if (!p) throw Error("Choose installed presets with assignments enabled.");
    return p;
  });
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-plot-replay-")));
  console.log("Replay records:", temp);
  const directory = path.join(temp, "state"), docs = path.join(temp, "docs");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "agent-presets.json"), JSON.stringify({ presets }));
  if (fs.existsSync(path.join(settings, "agent-models.json"))) fs.copyFileSync(path.join(settings, "agent-models.json"), path.join(directory, "agent-models.json"));
  // Agents receive only this disposable drawing endpoint and their ordinary provider configuration.
  delete process.env.PENECHO_ORCH_URL;
  delete process.env.PENECHO_ORCH_PASS;
  const lines = createProjectLines({ directory, agentPaths:{ home, stateDir:installed }, serviceOptions:{ autoWatch:false, recoverOnStart:false, docsBase:docs } });
  const service = lines.service;
  let origin, writes = [], start;
  const draw = createDraw({ service, stateDirectory:directory, origin:() => origin, drawFile:path.join(temp, "draw.json") });
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST") {
      const end = res.end;
      res.end = function(data, ...rest) {
        const receipt = JSON.parse(data);
        writes.push({ ms:Math.round(performance.now() - start), status:this.statusCode, widget:receipt.widgetId, bounds:receipt.bounds, visible:receipt.visible, fullyVisible:receipt.fullyVisible, preview:receipt.preview, path:receipt.path });
        return end.call(this, data, ...rest);
      };
    }
    if (!await draw.handle(req, res, new URL(req.url, origin))) { res.writeHead(404); res.end(); }
  });
  let beat, current;
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    origin = "http://127.0.0.1:" + server.address().port;
    service.drawEnv = () => ({ PENECHO_DRAW_URL:origin + "/api/draw", PENECHO_DRAW_PASS:draw.token });
    const project = service.store.create({ name:"Plot replay", docsPath:path.join(docs, "plots") });
    for (let i = 1; i <= Number(pairs); i++) {
      const board = await service.createCanvas(project, { title:`Replay ${i}`, blank:true });
      const viewport = { x:7440, y:8458, w:3640, h:3084 };
      let first;
      for (const [index, words] of ["add a function drawing for y=x*sinx on canvas", "OK, add another function, y = x*tan x"].entries()) {
        const p = presets[index], slug = board.slug, work = "work-" + (index + 1);
        if (index === 0) {
          const heartbeat = () => service.sawCanvas(project, board.source, viewport);
          heartbeat(); beat = setInterval(heartbeat, 3000);
        } else {
          clearInterval(beat); service.openCanvases.clear();
        }
        writes = []; start = performance.now(); current = { project, slug };
        await service.request(project, { text:words, canvas:board.source, topic:slug, preset:p.id, ...(index === 0 ? { canvasView:viewport } : {}) });
        const detail = path.join(project.docsPath, F.detailPath(slug, work));
        for (;;) {
          const md = fs.existsSync(detail) && fs.readFileSync(detail, "utf8");
          const doc = F.parseLine(service.readDoc(project, slug));
          if (md && F.splitFront(md).front.ended && !service.runs.size) {
            const front = F.splitFront(md).front;
            const replyMs = Math.round(performance.now()-start);
            const usage = JSON.parse(fs.readFileSync(detail.replace(/\.md$/, ".tokens.json"))).attempts.at(-1);
            const row = { pair:i, work, preset:p.id, model:front.model || front["selected model"], effort:front.effort || front["selected effort"], status:doc.status, replyMs, requests:usage.requests.length, usageComplete:usage.complete, writes, detail };
            try {
              const checked = await verifyGraph(service, project, board.source, writes, first);
              if (!index) first = checked;
              row.passed = true;
            } catch (error) {
              row.passed = false;
              row.error = error.message;
            }
            console.log(JSON.stringify(row)); fs.appendFileSync(path.join(temp, "timings.jsonl"), JSON.stringify(row) + "\n");
            if (!row.passed) throw Error("Graph acceptance failed. Inspect " + detail);
            break;
          }
          if (doc.status === "stopped" || performance.now() - start > 360000) throw Error(`Replay ${work} ${doc.status}: ${doc.front.why || "timed out"}`);
          await delay(100);
        }
        current = null;
      }
    }
  } finally {
    clearInterval(beat);
    if (current && service.runs.size) await service.stopWork(current.project, current.slug).catch(() => {});
    server.close(); lines.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
