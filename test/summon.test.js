"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const SUMMON = require("../public/summon.js");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("thinking indicator randomizes mathematical loaders and copy without immediate repeats", () => {
  assert.deepEqual(SUMMON.LOADER_TYPES, ["lemniscate", "rose", "superellipse", "golden-spiral", "deltoid"]);
  assert.equal(new Set(SUMMON.LOADER_TYPES).size, SUMMON.LOADER_TYPES.length);
  for (const previous of SUMMON.LOADER_TYPES) {
    assert.notEqual(SUMMON.pickLoaderType(() => 0, previous), previous);
    assert.notEqual(SUMMON.pickLoaderType(() => 0.999999, previous), previous);
  }
  assert.equal(SUMMON.pickDifferentIndex(() => 0, 12, 0), 1);
  assert.equal(SUMMON.pickDifferentIndex(() => 0.999999, 12, 11), 0);
});

test("thinking copy changes at a calm pace", () => {
  assert.match(read("public/summon.js"), /TIP_KEYS = Array\.from\(\{ length:24 \}/);
  assert.ok(SUMMON.TEXT_INTERVALS.phrase >= 5600 * 2);
  assert.ok(SUMMON.TEXT_INTERVALS.tip >= 10800 * 2);
  assert.equal(SUMMON.TEXT_INTERVALS.phrase, 12000);
  assert.equal(SUMMON.TEXT_INTERVALS.tip, 26000);
});

test("mathematical loaders keep their geometry simple and balanced", () => {
  for (const type of SUMMON.LOADER_TYPES) {
    const data = SUMMON.buildLoaderData(type, 41),
      points = SUMMON.buildLoaderPoints(type, data, 0);
    assert.ok(points.length >= 200 && points.length <= 250, `${type} should stay visually sparse`);
    assert.ok(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
    assert.ok(Math.max(...points.map((point) => Math.abs(point.x))) <= 1.001);
    assert.ok(Math.max(...points.map((point) => Math.abs(point.y))) <= 1.001);
    assert.deepEqual(SUMMON.buildLoaderData(type, 41), data);
  }
});

test("thinking placement measures the complete loader and text footprint against blockers", () => {
  const blocker = { x:0, y:0, w:620, h:640, weight:4 },
    placement = SUMMON.chooseThinkingPlacement({
      width:1000,
      height:640,
      anchor:{ x:420, y:250, w:120, h:80 },
      blockers:[blocker],
    }),
    box = placement.box,
    overlapWidth = Math.min(box.x + box.w, blocker.x + blocker.w) - Math.max(box.x, blocker.x),
    overlapHeight = Math.min(box.y + box.h, blocker.y + blocker.h) - Math.max(box.y, blocker.y),
    mobile = SUMMON.thinkingFootprint({ x:130, y:180 }, 260),
    desktop = SUMMON.thinkingFootprint({ x:500, y:250 }, 1000);
  assert.equal(placement.score, 0);
  assert.ok(overlapWidth <= 0 || overlapHeight <= 0);
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= 1000 && box.y + box.h <= 640);
  assert.equal(mobile.w, 248);
  assert.equal(SUMMON.THINKING_LAYOUT.loaderRadius, 32);
  assert.equal(SUMMON.THINKING_LAYOUT.copyTop, 52);
  assert.equal(SUMMON.THINKING_LAYOUT.copyWidth, 330);
  assert.equal(SUMMON.THINKING_LAYOUT.copyHeight, 82);
  assert.ok(mobile.h > desktop.h);
});

test("thinking placement finds a content-free slot between blocker edges", () => {
  const placement = SUMMON.chooseThinkingPlacement({
    width:1000,
    height:500,
    blockers:[
      { x:0, y:0, w:370, h:500 },
      { x:724, y:0, w:276, h:500 },
    ],
  });
  assert.equal(placement.score, 0);
  assert.equal(placement.box.x, 370);
  assert.equal(placement.box.x + placement.box.w, 724);
});

test("thinking placement avoids canvas text across the full caption width", () => {
  const blocker = { x:360, y:300, w:80, h:42 },
    placement = SUMMON.chooseThinkingPlacement({
      width:1000,
      height:640,
      blockers:[blocker],
    }),
    box = placement.box,
    overlapWidth = Math.min(box.x + box.w, blocker.x + blocker.w) - Math.max(box.x, blocker.x),
    overlapHeight = Math.min(box.y + box.h, blocker.y + blocker.h) - Math.max(box.y, blocker.y);
  assert.equal(placement.score, 0);
  assert.ok(overlapWidth <= 0 || overlapHeight <= 0);
  assert.notEqual(placement.x, 500, "a blank loader center must not hide caption overlap");
});

test("thinking placement keeps a numerically stable gap at blocker edges", () => {
  const blockers = [
      { x:0, y:0, w:370.3, h:500 },
      { x:724.3, y:0, w:275.7, h:500 },
    ],
    placement = SUMMON.chooseThinkingPlacement({ width:1000, height:500, blockers });
  assert.equal(placement.score, 0);
  assert.ok(Math.abs(placement.box.x - 370.3) < 1e-6);
  assert.ok(Math.abs(placement.box.x + placement.box.w - 724.3) < 1e-6);
});

test("AI waiting UI combines a clean mathematical loader with two neutral glowing lines", () => {
  const html = read("public/index.html"),
    css = read("public/style.css"),
    source = read("public/summon.js"),
    core = read("src/client/app/core.js"),
    bootstrap = read("src/client/app/ui-bootstrap.js");
  const summon = html.indexOf('id="summonLayer"'),
    ink = html.indexOf('id="inkLayer"');
  assert.match(html, /<canvas id="summonLayer" class="summon-layer" hidden aria-hidden="true"><\/canvas>/);
  assert.ok(summon >= 0 && summon < ink);
  assert.match(css, /\.summon-layer\s*\{[^}]*z-index:\s*2;/);
  assert.match(css, /\.summon-caption,\s*\.summon-hint\s*\{[^}]*ui-rounded/);
  assert.match(css, /\.summon-caption\s*\{[^}]*rgba\(22,\s*27,\s*34,\s*\.76\)/);
  assert.match(css, /\.summon-hint\s*\{[^}]*rgba\(67,\s*73,\s*82,\s*\.62\)/);
  assert.match(css, /\.summon-copy\s*\{[^}]*calc\(100% - 36px\)[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /@keyframes summonBlueGlow[\s\S]*?text-shadow:[\s\S]*?rgba\(42,\s*139,\s*255,\s*\.5\)/);
  assert.match(css, /\.summon-caption\.caption-swap\s*\{[^}]*summonTextIn 1\.35s[^}]*summonBlueGlow 3\.2s/);
  assert.match(css, /\.summon-hint\.hint-swap\s*\{[^}]*summonTipIn 1\.5s[^}]*summonBlueGlow 3\.2s/);
  assert.match(source, /LOADER_TYPES|buildLoaderPoints|drawLoader|drawTrail|getAiColor|fxCanvas/);
  assert.match(core, /summonLayer|fxCanvas:\s*summonLayer|getAiColor:\s*\(\)\s*=>\s*state\.aiColor/);
  assert.match(core, /function summonControlBlockers\(\)/);
  assert.match(core, /for \(const item of state\.textBoxes\) rects\.push/);
  assert.match(core, /element\.getBoundingClientRect\(\)/);
  for (const control of ["object-chrome-button", "animation-controls", "image-edit-bar", "selection-context-toolbar", "text-editor", "text-input-hint", "ai-embodiment"])
    assert.match(core, new RegExp(control));
  assert.match(core, /SUMMON\.chooseThinkingPlacement/);
  assert.match(core, /blockers:summonScreenBlockers\(\)/);
  assert.doesNotMatch(source, /drawViewportFlight|drawFlight|advanceFlight|buildFlightModel|screenObstacleRects|HOTSPOT_(?:TRAIL|LEAD)_BLUE/);
  assert.doesNotMatch(html, /summonEffectList|data-effect=|fx-preview/);
  assert.doesNotMatch(core, /summonEffect|setSummonEffect|previewSummon/);
  assert.doesNotMatch(bootstrap, /summon-effect-option|setSummonEffect|previewSummon/);
  assert.doesNotMatch(source, /\b(?:rift|portal|lightning|lorenz|fern|dragon|harmonograph)\b|RUNE_STROKES|create(?:Radial|Linear)Gradient|shadowBlur/);
});
