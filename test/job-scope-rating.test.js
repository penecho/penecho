"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isTrivialAsk,
  inferLightScope,
  resolveWorkScope,
  emptyTierBuckets,
  addScoreToBucket,
  addAggregateRowToBuckets,
  tierRating,
  scoreBuckets,
  scoreAggregateDelta,
} = require("../src/server/project-lines/job-scope.js");
const { agentIndex } = require("../src/server/project-lines/agent-index.js");
const { createUsageStats } = require("../src/server/usage-stats.js");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const round2 = v => Math.round(v * 100) / 100;

function bucketsOf(entries) {
  const b = emptyTierBuckets();
  for (const [scope, count, score] of entries) {
    for (let i = 0; i < count; i++) addScoreToBucket(b[scope], score, 1, 1);
  }
  return b;
}

test("hierarchical Bayesian tierRating matches every case in the PE-1087 comparison table", () => {
  const cases = [
    ["untested", [], [4.00, 4.00, 4.00]],
    ["5 Light @ 5.0", [["light", 5, 5.0]], [4.56, 4.20, 4.00]],
    ["100 Light @ 5.0 (capped)", [["light", 100, 5.0]], [4.96, 4.20, 4.00]],
    ["10 Light @ 4.5 (thumbs up)", [["light", 10, 4.5]], [4.36, 4.10, 4.00]],
    ["30 Light @ 4.3", [["light", 30, 4.3]], [4.26, 4.06, 4.00]],
    ["10 Light @ 3.5 (smooth downward ramp, no inversion)", [["light", 10, 3.5]], [3.64, 3.72, 3.72]],
    ["5 Light @ 2.0 (easy failed badly)", [["light", 5, 2.0]], [2.89, 2.89, 2.89]],
    ["2 Std @ 3.5 + 8 Light @ 5.0 (easy cannot hide Std failure)", [["standard", 2, 3.5], ["light", 8, 5.0]], [4.58, 3.97, 3.90]],
    ["10 Std @ 4.4 (beats 100 Light @ 5.0)", [["standard", 10, 4.4]], [4.29, 4.29, 4.08]],
    ["10 Std @ 4.6", [["standard", 10, 4.6]], [4.43, 4.43, 4.12]],
    ["10 Std @ 4.6 + 1 Light @ 4.5 (never lowers strong model)", [["standard", 10, 4.6], ["light", 1, 4.5]], [4.43, 4.44, 4.12]],
    ["10 Std @ 4.6 + 1 Light @ 2.0", [["standard", 10, 4.6], ["light", 1, 2.0]], [4.27, 4.27, 3.70]],
    ["10 Std @ 4.6 + 1 Heavy @ 2.0", [["standard", 10, 4.6], ["heavy", 1, 2.0]], [4.39, 4.34, 3.70]],
    ["10 Heavy @ 4.5", [["heavy", 10, 4.5]], [4.36, 4.36, 4.36]],
    ["10 Heavy @ 3.5", [["heavy", 10, 3.5]], [3.81, 3.72, 3.64]],
  ];

  for (const [label, entries, [wantL, wantS, wantH]] of cases) {
    const b = bucketsOf(entries);
    const gotL = round2(tierRating(b, "light", { prior:4.0, priorWeight:4 }).rating);
    const gotS = round2(tierRating(b, "standard", { prior:4.0, priorWeight:4 }).rating);
    const gotH = round2(tierRating(b, "heavy", { prior:4.0, priorWeight:4 }).rating);
    assert.deepEqual([gotL, gotS, gotH], [wantL, wantS, wantH], `${label}: got [${gotL}, ${gotS}, ${gotH}]`);
  }
});

test("additive daily pass/neg aggregates reproduce per-Work tierRating exactly", () => {
  const raw = [
    ["light", 5.0], ["light", 4.5], ["light", 3.6], ["light", 2.0],
    ["standard", 4.7], ["standard", 3.4], ["standard", 4.2],
    ["heavy", 4.8], ["heavy", 3.2],
  ];
  const direct = emptyTierBuckets();
  const byScope = { light:[], standard:[], heavy:[] };
  for (const [scope, score] of raw) {
    addScoreToBucket(direct[scope], score, 1, 1);
    byScope[scope].push(score);
  }
  const agg = emptyTierBuckets();
  for (const [scope, scores] of Object.entries(byScope)) {
    let scoreSum = 0, passCount = 0, passSum = 0, negWeight = 0, negWeightedSum = 0;
    for (const s of scores) {
      scoreSum += s;
      const d = scoreAggregateDelta(s);
      passCount += d.passCount;
      passSum += d.passSum;
      negWeight += d.negWeight;
      negWeightedSum += d.negWeightedSum;
    }
    addAggregateRowToBuckets(agg, {
      scope, works:scores.length, scoreCount:scores.length, scoreSum,
      passCount, passSum, negWeight, negWeightedSum, good:0, bad:0,
    });
  }
  for (const target of ["light", "standard", "heavy"]) {
    const a = tierRating(direct, target, { prior:4.0, priorWeight:8 }).rating;
    const b = tierRating(agg, target, { prior:4.0, priorWeight:8 }).rating;
    assert.ok(Math.abs(a - b) < 1e-9, `${target}: direct ${a} vs aggregate ${b}`);
  }
});

test("trivial smoke tests are filtered while real tasks with diffs or substance stay", () => {
  assert.equal(isTrivialAsk("ping"), true);
  assert.equal(isTrivialAsk("test 1"), true);
  assert.equal(isTrivialAsk("Reply concisely with: (1) your exact model ID, and (2) your thinking/reasoning effort level"), true);
  assert.equal(isTrivialAsk('The person asked (Pi): "just grill me a question and return".'), true);
  assert.equal(isTrivialAsk("grill me a simple question"), true);
  assert.equal(isTrivialAsk("Ask the owner exactly one simple, low-stakes question in English as a live test of PenEcho's grill-me option"), true);
  assert.equal(isTrivialAsk("reply model id", { diff:{ files:1, add:5, del:0 } }), false, "code edits are never trivial");
  assert.equal(isTrivialAsk("hi"), false, "simple chat greetings are rated as Light rather than dropped");
  assert.equal(resolveWorkScope({ askText:"hi", kind:"chat" }).scope, "light");
  assert.equal(isTrivialAsk("fix the sync bug"), false);
  assert.equal(isTrivialAsk("remove this send fix button"), false);
});

test("scope resolution applies narrow light rule, anti-self-inflation, objective floors, and user chip override", () => {
  assert.equal(inferLightScope("remove this send fix button"), true);
  assert.equal(inferLightScope("remove this send fix button", { hasAttachments:true }), true, "screenshot of a button does not disqualify a Light UI tweak");
  assert.equal(inferLightScope("users's note should also have the same bg as user's asks(light blue maybe)", { hasAttachments:true }), true);
  assert.equal(inferLightScope("summarize this document", { kind:"docs", hasAttachments:true }), false, "attached document keeps Q&A out of Light");
  assert.equal(inferLightScope("fix the sync bug"), false);
  assert.equal(inferLightScope("refactor the orchestrator rating formula across 5 files"), false);

  // Self cannot self-proclaim heavy.
  const selfHeavy = resolveWorkScope({ askText:"update the docs", recordScope:"heavy", recordScopeSource:"self" });
  assert.equal(selfHeavy.scope, "standard");

  // Parent orchestrator can label heavy directly.
  const orchHeavy = resolveWorkScope({ askText:"fix the sync bug", recordScope:"heavy", recordScopeSource:"orchestrator" });
  assert.equal(orchHeavy.scope, "heavy");

  // Objective floor raises split / >=2 children to heavy, and clean large diff up one tier.
  assert.equal(resolveWorkScope({ askText:"update rating", route:"split" }).scope, "heavy");
  assert.equal(resolveWorkScope({ askText:"remove this button", diff:{ files:5, dirs:2, add:180, del:40 }, safety:5, score:4.5 }).scope, "standard");
  assert.equal(resolveWorkScope({ askText:"fix the sync bug", diff:{ files:6, add:200, del:50 }, safety:5, score:4.5 }).scope, "heavy");

  // User override chip always wins (even on trivial or large diff).
  assert.equal(resolveWorkScope({ askText:"hi", userScope:"standard" }).scope, "standard");
  assert.equal(resolveWorkScope({ askText:"refactor everything", diff:{ files:10, add:500, del:100 }, userScope:"light" }).scope, "light");
});

test("agentIndex caps Light-only pairings below proven Standard pairings and marks lightOnly", () => {
  const lightOnly = {
    day:"2026-11-20", runner:"opencode", model:"deepseek-v4.1-flash", effort:"max", kind:"code", scope:"light",
    works:40, finished:40, failed:0, stopped:0, followups:0,
    scoreCount:40, scoreSum:200, passCount:40, passSum:200, negWeight:0, negWeightedSum:0,
    good:0, bad:0, minutes:40, tokens:4e6, costUsd:0.4,
  };
  const provenStd = {
    day:"2026-11-20", runner:"codex", model:"gpt-6.2-sol", effort:"xhigh", kind:"code", scope:"standard",
    works:10, finished:10, failed:0, stopped:0, followups:0,
    scoreCount:10, scoreSum:45, passCount:10, passSum:45, negWeight:0, negWeightedSum:0,
    good:0, bad:0, minutes:60, tokens:1e7, costUsd:8,
  };
  const idx = agentIndex([lightOnly, provenStd], { projects:1 });
  const ranked = idx.tables.all.ranked;
  assert.equal(ranked[0].model, "gpt-6.2-sol", "proven Standard 4.5 beats 40 Light 5.0");
  assert.equal(ranked[1].model, "deepseek-v4.1-flash");
  assert.equal(ranked[1].lightOnly, true);
  assert.equal(ranked[1].provenScope, "light");
  assert.ok(ranked[1].tiers.standard.rating <= 4.20);
  assert.ok(ranked[0].score > ranked[1].score);
});

test("usage-stats validates, merges, and sorts scope and exact pass/neg aggregates", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-usage-scope-"));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const day = "2026-11-22";
  const stats = createUsageStats({
    stateDirectory:dir,
    now:() => Date.parse(`${day}T12:00:00Z`),
    agentRows:() => [
      { day, runner:"codex", model:"gpt-6.2-sol", effort:"xhigh", kind:"code", scope:"standard", works:2, finished:2, failed:0, stopped:0, followups:0, scoreCount:2, scoreSum:9.0, passCount:2, passSum:9.0, negWeight:0, negWeightedSum:0, good:1, bad:0, minutes:10, tokens:1000, costUsd:0.5, tokensIn:800, tokensOut:200, tokensCached:0 },
      { day, runner:"codex", model:"gpt-6.2-sol", effort:"xhigh", kind:"code", scope:"light", works:1, finished:1, failed:0, stopped:0, followups:0, scoreCount:1, scoreSum:3.5, passCount:0, passSum:0, negWeight:0.5, negWeightedSum:1.75, good:0, bad:0, minutes:2, tokens:200, costUsd:0.1, tokensIn:150, tokensOut:50, tokensCached:0 },
      { day, runner:"codex", model:"gpt-6.2-sol", effort:"xhigh", kind:"code", scope:"light", works:1, finished:1, failed:0, stopped:0, followups:0, scoreCount:1, scoreSum:4.8, passCount:1, passSum:4.8, negWeight:0, negWeightedSum:0, good:0, bad:0, minutes:1, tokens:100, costUsd:0.05, tokensIn:80, tokensOut:20, tokensCached:0 },
      // Invalid scope rejected cleanly:
      { day, runner:"codex", model:"gpt-6.2-sol", effort:"xhigh", kind:"code", scope:"extreme", works:1, finished:1, failed:0, stopped:0, followups:0, scoreCount:1, scoreSum:5.0, passCount:1, passSum:5.0, negWeight:0, negWeightedSum:0, good:0, bad:0, minutes:1, tokens:100, costUsd:0.05, tokensIn:80, tokensOut:20, tokensCached:0 },
    ],
  });
  const rep = stats.report();
  assert.equal(rep.agents.length, 2, "light and standard kept separate; invalid scope dropped");
  const light = rep.agents.find(r => r.scope === "light");
  const std = rep.agents.find(r => r.scope === "standard");
  assert.equal(light.works, 2);
  assert.equal(light.scoreCount, 2);
  assert.equal(light.scoreSum, 8.3);
  assert.equal(light.passCount, 1);
  assert.equal(light.passSum, 4.8);
  assert.equal(light.negWeight, 0.5);
  assert.equal(light.negWeightedSum, 1.75);
  assert.equal(std.works, 2);
  assert.equal(std.passCount, 2);
});
