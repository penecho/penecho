"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const SMART = require("../public/smart-suggest.js");
const source = fs.readFileSync(path.join(__dirname, "../src/client/app/smart-suggestions.js"), "utf8");

// Synthetic pen strokes in Canvas units, with a little hand tremor.
const line = (x0, y0, x1, y1, n = 12) => ({ points:Array.from({ length:n }, (_, i) => ({ x:x0 + (x1 - x0) * i / (n - 1) + (i % 2 ? 0.6 : -0.6), y:y0 + (y1 - y0) * i / (n - 1) + (i % 3 ? 0.5 : -0.5) })) });
const arc = (cx, cy, r, a0, a1, n = 20) => ({ points:Array.from({ length:n }, (_, i) => { const a = a0 + (a1 - a0) * i / (n - 1); return { x:cx + r * Math.cos(a), y:cy + r * Math.sin(a) }; }) });
const poly = corners => ({ points:corners.flatMap((p, i) => i ? Array.from({ length:10 }, (_, k) => ({ x:corners[i - 1].x + (p.x - corners[i - 1].x) * k / 9, y:corners[i - 1].y + (p.y - corners[i - 1].y) * k / 9 })) : [p]) });
const digit = x => arc(x + 10, 30, 12, -2.5, 2.5);
const plus = x => [line(x, 30, x + 20, 30), line(x + 10, 20, x + 10, 40)];
const equals = x => [line(x, 25, x + 26, 24), line(x + 1, 35, x + 28, 36)];
const shift = (strokes, dy) => strokes.map(stroke => ({ points:stroke.points.map(p => ({ x:p.x, y:p.y + dy })) }));
const open = [digit(0), ...plus(30), digit(60), ...equals(95)];
const top = (features, extra = {}) => SMART.rankActions({ local:SMART.localPredict({ ...features, ...extra }), exclude:["snap_shapes", "refine"] });
const ids = view => view.items.map(item => item.id);

test("stroke cues find open and complete equals signs without reading Chinese bars as equations", () => {
  assert.deepEqual(SMART.inkCues(open), { equals:1, openEquals:1, lineArt:false, dashes:3 });
  assert.equal(SMART.inkCues([...open, arc(140, 30, 12, 0, 4)]).openEquals, 0, "3+2=5 has a right-hand side");
  assert.equal(SMART.inkCues([...open, ...shift(open, 70)]).openEquals, 2, "stacked exercises are each open");
  const three = [line(0, 10, 30, 10), line(3, 25, 27, 25), line(-3, 42, 33, 42)];
  assert.equal(SMART.inkCues(three).equals, 0, "三");
  assert.equal(SMART.inkCues([...three, line(15, 8, 15, 44)]).equals, 0, "王");
  assert.equal(SMART.inkCues([line(5, 10, 25, 10), line(0, 25, 32, 25), line(8, 26, 4, 50), poly([{ x:20, y:26 }, { x:20, y:48 }, { x:32, y:48 }])]).equals, 0, "元");
  assert.equal(SMART.inkCues([line(5, 15, 25, 15), line(0, 35, 32, 35)]).equals, 0, "a lone 二 or = is not an equation");
  const maze = [poly([{ x:0, y:0 }, { x:200, y:0 }, { x:200, y:200 }, { x:0, y:200 }, { x:0, y:40 }]), poly([{ x:40, y:40 }, { x:160, y:40 }, { x:160, y:160 }, { x:40, y:160 }]), line(100, -30, 100, -5)];
  assert.equal(SMART.inkCues(maze).lineArt, true);
  const face = [arc(50, 50, 45, 0, 6.28, 40), arc(35, 40, 5, 0, 6.28), arc(65, 40, 5, 0, 6.28), arc(50, 60, 18, 0.3, 2.8)];
  assert.equal(SMART.inkCues(face).lineArt, false);
  assert.equal(SMART.inkCues([]), null);
});

test("the instant order matches what PenEchoLLM usually ranks for each kind of ink", () => {
  const row = { strokes:8, rows:1, aspect:4 };
  const solve = top(row, { cues:{ equals:1, openEquals:1 } });
  assert.deepEqual(ids(solve).slice(0, 2), ["solve", "typeset"], "an open = asks for Solve");
  assert.equal(solve.confident, true);
  assert.equal(SMART.localPredict({ ...row, cues:{ equals:2, openEquals:2 }, rows:3, newBelow:true }).bucket, "open_equation", "stacked exercises are not a derivation");
  assert.equal(ids(top(row, { cues:{ equals:1, openEquals:0 } }))[0], "plot", "f(x)=… is graphed");
  assert.equal(ids(top({ ...row, rows:2, newBelow:true }, { cues:{ equals:1, openEquals:0 } }))[0], "check_step", "a new derivation line is checked");
  const words = ids(top({ strokes:7, rows:1, aspect:3.5 }, { cues:{ equals:0, openEquals:0 } }));
  assert.deepEqual(words.slice(0, 2), ["answer", "typeset"]);
  assert.ok(!words.includes("plot") && !words.includes("solve"), "plain words never open with Plot or Solve");
  assert.deepEqual(ids(top({ strokes:6, rows:1, aspect:1.1 }, { cues:{ lineArt:true } })).slice(0, 2), ["answer", "diagram"]);
  assert.equal(SMART.localPredict({ strokes:12, rows:2, aspect:1.5, newBelow:true, cues:{} }).bucket, "text_rows", "a second written line is not a picture");
  assert.equal(SMART.localPredict({ strokes:9, rows:1, aspect:1.05, cues:{} }).bucket, "drawing");
  assert.equal(SMART.localPredict({ strokes:6, rows:1, aspect:4.2 }).bucket, undefined, "callers without stroke cues keep the geometric fallback");
  assert.equal(SMART.localPredict({ shapes:{ closed:2 }, cues:{ equals:1, openEquals:1 } }).probabilities.snap_shapes > 0.4, true, "fitted shapes keep Clean up");
  assert.equal(SMART.localPredict({ strokes:6, rows:1, aspect:4, motionCue:{ type:"speed-lines" }, cues:{ equals:1, openEquals:1 } }).bucket, "open_equation", "= bars are not speed lines");
});

test("per-device learning moves the instant order toward PenEchoLLM and the user's taps, within a cap", () => {
  let prior = SMART.learnInstantPrior({}, "open_equation", { typeset:0.6, solve:0.3, none:0.9, bogus:1 });
  assert.deepEqual(prior.open_equation.p, { typeset:0.667, solve:0.333 });
  assert.deepEqual(SMART.learnInstantPrior(prior, "not-a-bucket", { solve:1 }), prior);
  const features = { strokes:8, rows:1, aspect:4, cues:{ equals:1, openEquals:1 } };
  for (let i = 0; i < 6; i++) prior = SMART.learnInstantPrior(prior, "open_equation", { typeset:1 }, { weight:2 });
  assert.equal(ids(top(features, { learned:prior }))[0], "typeset", "a user who always typesets equations sees Typeset first");
  for (let i = 0; i < 80; i++) prior = SMART.learnInstantPrior(prior, "open_equation", { typeset:1 }, { weight:2 });
  assert.ok(prior.open_equation.n <= 40, "old evidence decays after 40 samples");
  assert.ok(SMART.localPredict({ ...features, learned:prior }).probabilities.solve > 0.2, "the calibrated table keeps at least 45% weight");
  assert.equal(ids(top(features, { learned:{ formula:prior.open_equation } }))[0], "solve", "learning stays within its bucket");
});

test("the client learns from confident ink rankings and ordinary taps, and keeps the prior on this device", () => {
  assert.match(source, /SMART_SUGGEST_PRIOR_KEY = "penecho-smart-suggestions-instant-prior"/);
  assert.match(source, /updateProfile\(smartSuggest\.profile, data\.answers\.kind\);\n\s+assistLearnInstantRanking\(cluster, data\.answers\);/);
  assert.match(source, /SMART_SUGGEST\.instantRankingEvidence\(answers\)/);
  assert.match(source, /if \(!action\) return;\n\s+if \(typeof assistLearnInstantTap === "function"\) assistLearnInstantTap\(id, target\);/);
  assert.match(source, /target\.selection \|\| target\.followUp \|\| target\.accept/);
  assert.match(source, /cues:assistInkCues\(cluster\),\n\s+learned:smartSuggest\.instantPrior,/);
});
