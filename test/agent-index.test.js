"use strict";
require("./helpers/safety.js");
// PE-742: the Statistics page's Agent index ranks agent app × model × effort across every project on this computer.
const test = require("node:test");
const assert = require("node:assert/strict");
const { agentIndex, modelKey, KINDS } = require("../src/server/project-lines/agent-index.js");

const row = extra => ({ day:"2026-11-18", runner:"codex", model:"gpt-6.1-sol", effort:"high", kind:"code", works:4, finished:4, failed:0, stopped:0, followups:0,
  scoreSum:18, scoreCount:4, good:2, bad:0, minutes:40, tokens:1e6, costUsd:1.6, ...extra });

test("rows from several projects add up into one ranked pairing per kind", () => {
  const index = agentIndex([
    row(), row({ kind:" Fix ", works:2, finished:2, scoreSum:10, scoreCount:2, good:0 }),
    row({ kind:"test", works:2, finished:2, scoreSum:10, scoreCount:2, good:0 }),
    row({ kind:" REVIEW ", runner:"claude", works:2, finished:2, scoreSum:2, scoreCount:2, good:0 }),
    row({ kind:"chat", runner:"claude", model:"claude-opus-5-5", works:1, finished:1, scoreSum:5, scoreCount:1, good:0 }),
  ], { projects:3 });
  assert.deepEqual(KINDS, ["all", "code", "chat", "design", "research", "docs"]);
  assert.deepEqual(Object.keys(index.tables), KINDS);
  assert.equal(index.projects, 3);
  assert.equal(index.works, 9);
  assert.equal(index.tables.all.ranked.length, 1, "the pairing with one Work is still collecting");
  assert.equal(index.tables.all.ranked[0].works, 8);
  assert.equal(index.tables.code.ranked[0].works, 8);
  assert.equal(index.tables.code.ranked[0].rank, 1);
  assert.equal(index.tables.chat.collecting[0].works, 1);
  assert.equal(index.tables.all.collecting.length, 1, "historical review rows stay out of the index");
  assert.equal(index.tables.all.collecting[0].agentName, "Claude Code");
  const r = index.tables.all.ranked[0];
  assert.ok(r.low <= r.score && r.score <= r.high);
  assert.equal(r.costPerWork, 0.6);
});

test("score uses only Orchestrator and user ratings, ignores follow-ups, and omits rows without a model", () => {
  const noFollowups = agentIndex([row({ followups:0 })]).tables.all.ranked[0];
  const withFollowups = agentIndex([row({ followups:4 })]).tables.all.ranked[0];
  assert.deepEqual(withFollowups, noFollowups, "follow-up count must not change score, interval, or rating");
  assert.equal("followupRate" in noFollowups, false);
  // Standard bucket: 4 orchestrator scores summing to 18 + 2 user goods (weight 2, value 4.5) = 36 / 8 = 4.5.
  // Conservative prior = min(4.5, 4.0) = 4.0, priorWeight = 8:
  //   Standard = (36 + 8*4.0) / 16 = 4.25; Heavy = (8*4.0 + 2*4.5) / 10 = 4.10;
  //   Composite (0.7*S + 0.3*H) = 4.205 -> 4.21, score = 100 * (4.205 - 1) / 4 = 80.1.
  assert.equal(noFollowups.rating, 4.21);
  assert.equal(noFollowups.score, 80.1);
  assert.equal(noFollowups.provenScope, "standard");
  assert.equal(noFollowups.lightOnly, false);

  const worse = agentIndex([row({ good:0, bad:3 })]).tables.all.ranked[0];
  assert.ok(worse.score < noFollowups.score);
  assert.equal(agentIndex([row({ model:"" })]).works, 0);
  assert.equal(agentIndex([row({ model:"magpie/auto/DeFaUlT" }), row({ model:"  " })]).works, 0);
  assert.equal(modelKey("openai/GPT-6.1-Sol"), "gpt-6.1-sol");
});

test("the built-in penecho runner is excluded from the Agent index and third-party UUID models stay ranked", () => {
  const bareUuid = "3ea3e82e-095e-4aa1-9c93-9eed1b963810";
  const prefixedUuid = "d460c354-bffd-44e3-82bf-ca5c1d7e4691";
  const eligible = [
    row({ works:4, finished:4, scoreSum:16, scoreCount:4, good:0, bad:0 }),
    row({ runner:"codex", model:bareUuid, effort:"high", works:5, finished:5, scoreSum:22, scoreCount:5, good:2, bad:0 }),
    row({ runner:"claude", model:`external/${prefixedUuid}`, effort:"medium", works:4, finished:4, scoreSum:19, scoreCount:4, good:1, bad:1 }),
  ];
  const penechoRows = [
    row({ runner:"penecho", model:bareUuid, effort:"max", works:10, finished:10, scoreSum:10, scoreCount:10, good:0, bad:5, costUsd:0.1 }),
    row({ runner:"PenEcho", model:"deepseek-4.1-flash", effort:"max", works:6, finished:6, scoreSum:30, scoreCount:6, good:3, bad:0 }),
  ];
  const onlyEligible = agentIndex(eligible, { projects:2 });
  const withPenecho = agentIndex([...eligible, ...penechoRows], { projects:2 });
  assert.deepEqual(withPenecho, onlyEligible, "penecho runner rows must not appear or alter mean, score, or total works");
  assert.equal(withPenecho.works, 13);
  assert.deepEqual(
    withPenecho.tables.all.ranked.map(r => `${r.agent}:${r.model}`).sort(),
    [`claude:${prefixedUuid}`, `codex:${bareUuid}`, "codex:gpt-6.1-sol"],
    "third-party bare and provider-prefixed UUID models remain ranked",
  );
  const onlyPenecho = agentIndex(penechoRows, { projects:1 });
  assert.equal(onlyPenecho.works, 0);
  assert.deepEqual(onlyPenecho.tables.all.ranked, []);
  assert.deepEqual(onlyPenecho.tables.all.collecting, []);
});

test("ranks follow descending score with competition ties even when small-sample 95% intervals overlap", () => {
  const index = agentIndex([
    row({ runner:"claude", model:"claude-opus-5-5", effort:"high", works:6, finished:6, scoreSum:30, scoreCount:6, good:0, bad:0 }),
    row({ runner:"codex", model:"gpt-6.2-sol", effort:"xhigh", works:8, finished:8, scoreSum:36, scoreCount:8, good:0, bad:0 }),
    row({ runner:"kimi", model:"kimi-k3.1-pro", effort:"max", works:8, finished:8, scoreSum:36, scoreCount:8, good:0, bad:0 }),
    row({ runner:"codex", model:"gpt-6.1-sol", effort:"max", works:3, finished:3, scoreSum:9, scoreCount:3, good:0, bad:0 }),
  ], { projects:2 });
  const ranked = index.tables.all.ranked;
  assert.equal(ranked.length, 4);
  // Small sample sizes still produce overlapping 95% intervals, but ranks must reflect score order rather than all 1s.
  assert.ok(ranked[0].low < ranked[3].high, "intervals overlap at small sample sizes");
  assert.equal(ranked[1].score, ranked[2].score);
  assert.deepEqual(ranked.map(r => r.rank), [1, 2, 2, 4]);
});
