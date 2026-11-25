"use strict";
const { concreteModel } = require("../../../public/lines/work-pricing.js");
const {
  SCOPES, DEFAULT_PRIOR, PERSON_WEIGHT, GOOD_SCORE, BAD_SCORE,
  normalizeScope, emptyTierBuckets, addAggregateRowToBuckets, scoreBuckets,
} = require("./job-scope.js");

// The Statistics page's Agent index: every agent app, model and effort level, ranked by Orchestrator scores and user ratings
// across all projects on this computer (0–100 score from difficulty-tiered Bayesian rating with a 95% interval,
// competition-ranked by score), with thresholds for one person: a pairing is ranked from a few rated Works.

const KINDS = ["all", "code", "chat", "design", "research", "docs"];
const MIN_WORKS = 3, MIN_RATED = 1, PRIOR_WEIGHT = 8, GOOD = GOOD_SCORE, BAD = BAD_SCORE, Z = 1.96;
const FIELDS = ["works", "finished", "failed", "stopped", "scoreSum", "scoreCount", "good", "bad", "minutes", "tokens", "costUsd"];
const AGENT_NAMES = { claude:"Claude Code", codex:"Codex", kimi:"Kimi Code", opencode:"OpenCode", pi:"Pi", omp:"omp", antigravity:"Antigravity", dsh:"dsh", penecho:"PenEcho Agent" };
const PROVIDERS = [[/^claude|^anthropic/, "Anthropic"], [/^gpt|^o\d|^codex|^openai/, "OpenAI"], [/^gemini|^gemma/, "Google"], [/^deepseek/, "DeepSeek"],
  [/^kimi|^moonshot/, "Moonshot AI"], [/^glm|^zhipu|^z-ai/, "Zhipu AI"], [/^qwen/, "Alibaba"], [/^grok/, "xAI"], [/^mistral|^codestral|^devstral/, "Mistral"], [/^llama/, "Meta"], [/^minimax/, "MiniMax"]];

const modelKey = model => concreteModel(concreteModel(model).toLowerCase().replace(/^(?:(?:us|eu|apac)\.)?anthropic\./, ""));
// Built-in PenEcho Agent ratings are excluded from the Agent index and Cloud uploads (PE-782).
// Review assignments also stay out, even when a caller supplies historical rows.
const kindKey = value => String(value || "").trim().toLowerCase();
const isExcludedRating = row => String(row?.runner || "").trim().toLowerCase() === "penecho" || kindKey(row?.kind) === "review";
const providerOf = model => PROVIDERS.find(([test]) => test.test(model))?.[1] || "";
const round = (value, places = 1) => Math.round((value + 1e-12) * 10 ** places) / 10 ** places;
function wilson(successes, total) {
  if (!(total > 0)) return [0, 1];
  const p = Math.min(1, Math.max(0, successes / total)), z2 = Z * Z, centre = p + z2 / (2 * total), spread = Z * Math.sqrt(p * (1 - p) / total + z2 / (4 * total * total));
  return [Math.max(0, (centre - spread) / (1 + z2 / total)), Math.min(1, (centre + spread) / (1 + z2 / total))];
}

function table(rows, kind, { scope = "all" } = {}) {
  const groups = new Map();
  for (const row of rows) {
    if (isExcludedRating(row)) continue;
    const model = modelKey(row.model);
    const rawKind = kindKey(row.kind), rowKind = rawKind === "fix" || rawKind === "test" ? "code" : rawKind;
    if (!model || (kind !== "all" && rowKind !== kind)) continue;
    const key = `${row.runner}\0${model}\0${row.effort || ""}`;
    const group = groups.get(key) || {
      runner:row.runner, model, effort:row.effort || "",
      buckets:emptyTierBuckets(),
      ...Object.fromEntries(FIELDS.map(name => [name, 0])),
    };
    for (const name of FIELDS) group[name] += Number(row[name] || 0);
    addAggregateRowToBuckets(group.buckets, row, { goodScore:GOOD, badScore:BAD, personWeight:PERSON_WEIGHT });
    groups.set(key, group);
  }
  let sum = 0, weight = 0;
  for (const g of groups.values()) { sum += g.scoreSum + PERSON_WEIGHT * (GOOD * g.good + BAD * g.bad); weight += g.scoreCount + PERSON_WEIGHT * (g.good + g.bad); }
  const mean = weight ? sum / weight : DEFAULT_PRIOR;
  // Untested tiers start conservatively at min(mean, 4.0) so easy-only or unrated models never outrank proven Standard/Heavy work.
  const prior = Math.min(mean, DEFAULT_PRIOR);
  const all = [...groups.values()].map(g => {
    const personRated = g.good + g.bad, rated = g.scoreCount + personRated;
    const scored = scoreBuckets(g.buckets, { prior, priorWeight:PRIOR_WEIGHT, scope });
    const rating = scored.rating, quality = (rating - 1) / 4;
    // Score comes purely from difficulty-tiered Orchestrator and user ratings; finish rate and follow-up rate are not part of it.
    const [qLow, qHigh] = wilson(quality * scored.effectiveEvidence, scored.effectiveEvidence);
    return {
      agent:g.runner, agentName:AGENT_NAMES[g.runner] || g.runner, model:g.model, provider:providerOf(g.model), effort:g.effort,
      score:round(100 * quality), low:round(100 * qLow), high:round(Math.min(100, 100 * qHigh)),
      rating:round(rating, 2), rated,
      provenScope:scored.provenScope, lightOnly:scored.lightOnly, tiers:scored.tiers,
      minutes:g.finished ? round(g.minutes / g.finished) : null, costPerWork:g.costUsd > 0 && g.works ? round(g.costUsd / g.works, 3) : null,
      works:g.works, ranked:g.works >= MIN_WORKS && rated >= MIN_RATED,
    };
  });
  const ranked = all.filter(r => r.ranked).sort((a, b) => b.score - a.score || b.works - a.works || a.model.localeCompare(b.model));
  for (let i = 0; i < ranked.length; i++) {
    ranked[i].rank = i > 0 && ranked[i].score === ranked[i - 1].score ? ranked[i - 1].rank : i + 1;
  }
  const collecting = all.filter(r => !r.ranked).sort((a, b) => b.works - a.works).map(({ agent, agentName, model, provider, effort, works, rated }) => ({ agent, agentName, model, provider, effort, works, rated }));
  return { mean:round(mean, 2), prior:round(prior, 2), ranked, collecting };
}

/** rows: agent rows per day (orchestrator.agentDays) from every project. */
function agentIndex(rows, { from = "", to = "", projects = 0, scope = "all" } = {}) {
  const activeScope = normalizeScope(scope) || "all";
  return { from, to, projects, scope:activeScope, scopes:["all", ...SCOPES], works:rows.reduce((n, r) => n + (!isExcludedRating(r) && modelKey(r.model) ? Number(r.works || 0) : 0), 0), thresholds:{ works:MIN_WORKS, rated:MIN_RATED },
    tables:Object.fromEntries(KINDS.map(kind => [kind, table(rows, kind, { scope:activeScope })])) };
}

module.exports = { agentIndex, table, modelKey, isExcludedRating, providerOf, KINDS, SCOPES, MIN_WORKS, MIN_RATED, GOOD, BAD };
