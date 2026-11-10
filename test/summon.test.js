"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const SUMMON = require("../public/summon.js");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("selection AI anchors thinking to the captured lasso independently of recent ink", async () => {
  const source = read("src/client/app/core.js").match(/function requestSelectionAI\([^]*?\n  \}/)[0], calls = [], snapshots=[], released=[];
  const request = vm.runInNewContext(`(${source})`, {
    state:{}, aiPreparationGeneration:0, supersedeActiveAI(){}, setStatusKey(){}, selectionAIStatusKey:()=>"observing", updateSelectionToolbar(){}, renderInteractionLayer(){},
    captureSelectionDirtyInput:selection=>{const snapshot={selection};snapshots.push(snapshot);return snapshot;}, releaseDirtyInput:snapshot=>released.push(snapshot),
    requestAI:(action, packed, options)=>{ calls.push({action, packed, options}); return Promise.resolve(); },
  });
  const box = { x:1800, y:2300, w:580, h:280 }, packed = { sourceRect:{ ...box } };
  for (const action of ["plot", "continue", "answer", "auto", "normalize"]) {
    const selection = { phase:"active", box:{ ...box } }, transformCommands = commands=>commands;
    assert.equal(request(action, selection, packed, { suggestion:"plot", transformCommands, thinkingBox:{x:0,y:0,w:20,h:20} }), true);
    const call = calls.at(-1);
    assert.equal(call.packed, packed);
    assert.deepEqual(JSON.parse(JSON.stringify(call.options.thinkingBox)), box, "the captured input determines the loading region");
    assert.notEqual(call.options.thinkingBox, packed.sourceRect, "the animation owns a stable region snapshot");
    assert.equal(call.options.transformCommands, transformCommands);
    assert.equal(call.options.selectionRequestToken, selection.aiRequest.token);
    assert.equal(call.options.inputSnapshot,snapshots.at(-1));
    await Promise.resolve();
    assert.equal(selection.aiRequest, null);
    assert.equal(released.at(-1),snapshots.at(-1),"completed request releases its captured input tracking");
  }
});

test("Typeset stays busy and cancellable without the Canvas thinking animation", () => {
  const source = read("src/client/app/core.js").match(/function setBusy\([^]*?\n  \}/)[0],
    state = {}, attrs = {}, classes = {}, calls = [];
  const setBusy = vm.runInNewContext(`(${source})`, {
    state,
    embodiment:{classList:{toggle:(key,value)=>{classes[key]=value;}},setAttribute:(key,value)=>{attrs[key]=value;}},
    revealAIOrb:()=>calls.push("reveal"), showSummon:()=>calls.push("show"), hideSummon:()=>calls.push("hide"),
    scheduleAIOrbIdle:()=>calls.push("idle"), updateEmbodimentLabel:()=>calls.push("label"),
  });
  setBusy(true);
  assert.ok(calls.includes("show"),"ordinary AI requests retain their thinking animation");
  calls.length=0;
  setBusy(true,false);
  assert.equal(state.busy,true);
  assert.equal(attrs["aria-busy"],"true");
  assert.equal(classes.working,true,"the existing stop control remains active");
  assert.deepEqual(calls,["reveal","hide","label"],"Typeset hides any previous animation without starting another");
  calls.length=0;
  setBusy(false);
  assert.equal(state.busy,false);
  assert.deepEqual(calls,["hide","idle","label"]);
});

test("spatial echo projects the active canvas region into viewport coordinates", () => {
  assert.deepEqual(
    SUMMON.projectRegion({ x:120, y:80, w:300, h:140 }, { scale:1.5, panX:-40, panY:25 }),
    { x:140, y:145, w:450, h:210 },
  );
  assert.equal(SUMMON.projectRegion(null, { scale:1 }), null);
  assert.equal(SUMMON.normalizeRegion({ x:0, y:0, w:0, h:10 }), null);
});

test("spatial echo surrounds the current region and places one status line below it", () => {
  const region = { x:260, y:180, w:430, h:190 },
    layout = SUMMON.echoLayout(region, { width:1100, height:760 });
  assert.equal(layout.fallback, false);
  assert.ok(layout.outer.x < region.x);
  assert.ok(layout.outer.y < region.y);
  assert.ok(layout.outer.x + layout.outer.w > region.x + region.w);
  assert.ok(layout.outer.y + layout.outer.h > region.y + region.h);
  assert.ok(layout.inner.x > layout.outer.x && layout.inner.y > layout.outer.y);
  assert.ok(layout.inner.x + layout.inner.w < layout.outer.x + layout.outer.w);
  assert.ok(layout.status.y > layout.outer.y + layout.outer.h);
  assert.ok(layout.status.x - layout.status.w / 2 >= 0);
  assert.ok(layout.status.x + layout.status.w / 2 <= 1100);
});

test("spatial echo clips at viewport edges and only falls back without an input anchor", () => {
  const nearBottom = SUMMON.echoLayout({ x:120, y:510, w:500, h:180 }, { width:820, height:700 }),
    fallback = SUMMON.echoLayout(null, { width:820, height:700 });
  assert.equal(nearBottom.fallback, false);
  assert.ok(nearBottom.outer.y + nearBottom.outer.h > 700, "the outline stays around the input beyond the viewport");
  assert.ok(nearBottom.status.y > nearBottom.outer.y + nearBottom.outer.h, "the caption stays below its input instead of jumping above it");
  assert.equal(fallback.fallback, true);
  assert.ok(fallback.outer.w >= 180 && fallback.outer.h >= 110);
});

test("panning the input out of view translates the entire echo without recentering or resizing", () => {
  const region = { x:260, y:180, w:430, h:190 }, viewport = { width:1100, height:760 },
    initial = SUMMON.echoLayout(region, viewport);
  // Partial clipping and complete exit through each edge, then return.
  for (const [panX, panY] of [[-300,0],[700,0],[0,-220],[0,500],[-1400,0],[1400,0],[0,-1000],[0,1000],[0,0]]) {
    const layout = SUMMON.echoLayout(SUMMON.projectRegion(region, {scale:1,panX,panY}), viewport);
    assert.equal(layout.fallback, false, "offscreen input is still the anchor");
    for (const key of ["source", "outer", "inner", "status"]) {
      assert.equal(layout[key].x, initial[key].x + panX, `${key} follows horizontal pan`);
      assert.equal(layout[key].y, initial[key].y + panY, `${key} follows vertical pan`);
      assert.equal(layout[key].w, initial[key].w, `${key} keeps its width`);
      if (key !== "status") assert.equal(layout[key].h, initial[key].h, `${key} keeps its height`);
    }
  }
});

test("the two organic contours are deterministic, smooth, and distinct", () => {
  const rect = { x:80, y:60, w:640, h:300 },
    outer = SUMMON.buildEchoContour(rect, "outer"),
    inner = SUMMON.buildEchoContour({ x:102, y:82, w:596, h:256 }, "inner");
  assert.ok(outer.length >= SUMMON.THINKING_LAYOUT.samples);
  assert.ok(inner.length >= SUMMON.THINKING_LAYOUT.samples);
  assert.ok(outer.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.deepEqual(SUMMON.buildEchoContour(rect, "outer"), outer);
  assert.notDeepEqual(inner, outer);
  const longestStep = Math.max(...outer.map((point, index) => {
    const next = outer[(index + 1) % outer.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  }));
  assert.ok(longestStep < 50, `contour segment ${longestStep} should remain visually smooth`);
});

test("the request lifetime drives one restrained spatial echo with reduced-motion support", () => {
  const html = read("public/index.html"),
    css = read("public/style.css"),
    source = read("public/summon.js"),
    core = read("src/client/app/core.js"),
    bootstrap = read("src/client/app/ui-bootstrap.js"),
    summon = html.indexOf('id="summonLayer"'),
    ink = html.indexOf('id="inkLayer"');
  assert.match(html, /<canvas id="summonLayer" class="summon-layer" hidden aria-hidden="true"><\/canvas>/);
  assert.ok(summon >= 0 && summon < ink, "the echo must remain behind ink and widgets");
  assert.match(source, /dataset\.effect = "spatial-echo"/);
  assert.match(source, /drawLightSweep\(ctx, model\.outline, outer, elapsed, getReducedMotion\(\), tint, fade\)/);
  assert.match(source, /reducedMotion \? 1 : easeOutCubic/);
  assert.match(source, /progress = reducedMotion \? 0\.5 :/);
  assert.match(source, /t\("summonUnderstanding"\)/);
  assert.doesNotMatch(source, /LOADER_TYPES|PHRASE_KEYS|TIP_KEYS|setInterval|createRadialGradient|shadowBlur|hsla\(/);
  assert.match(css, /AI thinking: a spatial echo around the current input region/);
  assert.match(css, /\.summon-caption\s*\{[^}]*var\(--summon-accent[^}]*font-family:\s*var\(--pe-font-ui[^}]*animation:\s*summonStatusIn/);
  assert.doesNotMatch(css, /font-family:\s*ui-rounded/);
  assert.doesNotMatch(css, /\.summon-hint|summonBlueGlow|summonTipIn/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.summon-caption\s*\{[^}]*animation:\s*none/);
  assert.match(core, /getReducedMotion:\s*\(\)\s*=>\s*Boolean\(window\.matchMedia/);
  assert.match(core, /function showSummon\(\) \{[\s\S]*?summonFX\.show\(state\.summonAnchor\)/);
  assert.doesNotMatch(core, /chooseThinkingPlacement|summonScreenBlockers|summonControlBlockers/);
  assert.doesNotMatch(html, /summonEffectList|data-effect=|fx-preview/);
  assert.doesNotMatch(core, /summonEffect|setSummonEffect|previewSummon/);
  assert.doesNotMatch(bootstrap, /summon-effect-option|setSummonEffect|previewSummon/);
});

test("the top-right control keeps one active ring and no floating understanding card or font is added", () => {
  const html = read("public/index.html"),
    css = read("public/style.css"),
    source = read("public/summon.js"),
    core = read("src/client/app/core.js"),
    zh = read("public/locales/zh.js");
  assert.match(html, /id="aiOrb"[\s\S]*?class="ai-stop-icon"/);
  assert.match(core, /state\.busy \? t\("stopAIRequest"\) : t\("triggerAutoAI"\)/);
  assert.match(css, /@property --ai-orb-ring-angle[\s\S]*?body\[data-theme="studio"\] \.ai-embodiment\.working::before\s*\{[^}]*conic-gradient[^}]*ai-orb-ring-spin/);
  assert.doesNotMatch(css, /body\[data-theme="studio"\] \.ai-embodiment::before\s*\{/);
  assert.doesNotMatch(html, /understanding-card|summon-status-card/);
  assert.match(core, /summonUnderstanding:\s*"Understanding this part of the canvas\.\.\."/);
  assert.match(zh, /summonUnderstanding:\s*"正在理解这片内容…"/);
  assert.doesNotMatch(`${source}\n${css}`, /@font-face|\.woff2?|\.ttf|\.otf/);
});
