"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const SUMMON = require("../public/summon.js");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("thinking indicator randomizes across mathematical loaders without immediate repeats", () => {
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
    assert.ok(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    assert.ok(Math.max(...points.map(point => Math.abs(point.x))) <= 1.001);
    assert.ok(Math.max(...points.map(point => Math.abs(point.y))) <= 1.001);
    assert.deepEqual(SUMMON.buildLoaderData(type, 41), data);
  }
});

test("viewport flight launches beside the latest stroke", () => {
  const transform = { scale:1, panX:0, panY:0, width:500, height:400 },
    flight = SUMMON.buildFlightModel(
      [{ x:90, y:80, w:120, h:60 }],
      { points:[{ x:120, y:100 }], point:{ x:120, y:100 } },
      transform,
      () => 0,
    ),
    obstacle = SUMMON.screenObstacleRects([{ x:90, y:80, w:120, h:60 }], transform, flight.clearance)[0];
  assert.ok(Number.isFinite(flight.x) && Number.isFinite(flight.y));
  assert.ok(!(flight.x > obstacle.x && flight.x < obstacle.x + obstacle.w
    && flight.y > obstacle.y && flight.y < obstacle.y + obstacle.h));
  assert.ok(Math.hypot(flight.vx, flight.vy) >= 110);
});

test("viewport flight bounces off stroke, tool, and viewport edges", () => {
  const flight = { x:98, y:100, vx:120, vy:0, radius:3.2, trail:[{ x:98, y:100 }], impacts:[] },
    obstacle = { x:100, y:60, w:80, h:80 };
  SUMMON.advanceFlight(flight, 0.2, { width:500, height:400 }, [obstacle]);
  assert.ok(flight.vx < 0);
  assert.ok(flight.x <= obstacle.x);
  assert.ok(flight.impacts.length > 0);
  flight.x = 493;
  flight.vx = 120;
  SUMMON.advanceFlight(flight, 0.1, { width:500, height:400 }, []);
  assert.ok(flight.vx < 0);
  assert.ok(flight.x < 494);
});

test("AI waiting UI contains a mathematical loader, bouncing viewport flight, and two quiet lines", () => {
  const html = read("public/index.html"),
    css = read("public/style.css"),
    source = read("public/summon.js"),
    core = read("src/client/app/core.js"),
    bootstrap = read("src/client/app/ui-bootstrap.js"),
    summon = html.indexOf('id="summonLayer"'),
    ink = html.indexOf('id="inkLayer"');
  assert.match(html, /<canvas id="summonLayer" class="summon-layer" hidden aria-hidden="true"><\/canvas>/);
  assert.ok(summon >= 0 && summon < ink);
  assert.match(css, /\.summon-layer\s*\{[^}]*z-index:\s*2;/);
  assert.match(css, /\.summon-copy\s*\{[^}]*--summon-ai-color:\s*#2563eb/);
  assert.match(css, /\.summon-caption\s*\{[^}]*var\(--summon-ai-color\)\s*48%/);
  assert.match(css, /\.summon-hint\s*\{[^}]*var\(--summon-ai-color\)\s*30%/);
  assert.match(source, /lemniscate|golden-spiral|superellipse/);
  assert.match(source, /drawTrail/);
  assert.match(source, /drawViewportFlight/);
  assert.match(source, /advanceFlight/);
  assert.match(source, /screenObstacleRects/);
  assert.match(source, /flight:buildFlightModel/);
  assert.match(source, /HOTSPOT_TRAIL_BLUE\s*=\s*"#2878ff"/);
  assert.match(source, /HOTSPOT_LEAD_BLUE\s*=\s*"#9bc7ff"/);
  assert.match(source, /getContentRects/);
  assert.match(source, /getHotspot/);
  assert.match(source, /getAiColor/);
  assert.match(core, /getContentRects:\s*summonBlockers/);
  assert.match(core, /getHotspot:\s*summonHotspot/);
  assert.match(core, /points\s*=\s*state\.hotspotTrail/);
  assert.match(core, /getAiColor:\s*\(\)\s*=>\s*state\.aiColor/);
  assert.doesNotMatch(html, /summonEffectList|data-effect=|fx-preview/);
  assert.doesNotMatch(core, /summonEffect|setSummonEffect|previewSummon/);
  assert.doesNotMatch(bootstrap, /summon-effect-option|setSummonEffect|previewSummon/);
  assert.doesNotMatch(source, /\b(?:rift|portal|lightning|lorenz|fern|dragon|harmonograph)\b|RUNE_STROKES|create(?:Radial|Linear)Gradient|shadowBlur/);
});
