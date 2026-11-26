"use strict";
// Job difficulty tiers (Light / Standard / Heavy) and hierarchical Bayesian scoring (PE-1087).
//
// Core principles:
// 1. A Work's score is NEVER altered by artificial difficulty bonuses or deductions.
// 2. Trivial smoke-test / ping / model-probe messages (no edits, no outputs) are excluded from ratings & cost baselines.
// 3. Difficulty controls ONLY cross-tier evidence weight (borrowed from chess rating uncertainty & empirical Bayes priors):
//    - Same tier (L = T): full weight (1.0) for both good and bad scores.
//    - Harder tier (L > T): passing (s >= 4.0) counts in full (1.0); failing (s < 4.0) is discounted (0.5 one tier up, 0.25 two tiers up).
//    - Easier tier (L < T):
//        * Passing (s >= 4.0, one tier below only): NEVER enters the denominator (never dilutes a stronger model's average
//          and never penalizes easy wins); gently lifts the target tier's prior P_eff with weight capped at capRatio * k.
//        * Failing (s < 4.0, any easier tier): enters the denominator with smooth ramp weight min(1, 4.0 - s), uncapped.
// 4. Composite leaderboard rating combines Standard (70%) and Heavy (30%), keeping Light-only records strictly bounded
//    below proven Standard/Heavy models while always surfacing the verified level ("Light only").

const SCOPES = ["light", "standard", "heavy"];
const SCOPE_INDEX = { light:0, standard:1, heavy:2 };
const SCOPE_LABELS = { light:"Light", standard:"Standard", heavy:"Heavy" };
const PASS_THRESHOLD = 4.0;
const DEFAULT_PRIOR = 4.0;
const DEFAULT_PRIOR_WEIGHT = 4;
const PERSON_WEIGHT = 2;
const GOOD_SCORE = 4.5;
const BAD_SCORE = 2.0;
const COMPOSITE_WEIGHTS = { standard:0.7, heavy:0.3 };

function normalizeScope(value) {
  const s = String(value || "").trim().toLowerCase();
  return s === "light" || s === "standard" || s === "heavy" ? s : "";
}

function scopeRank(scope) {
  return SCOPE_INDEX[normalizeScope(scope)] ?? 1;
}

const round = (value, places = 2) => (value == null || !Number.isFinite(value) ? null : Math.round((value + 1e-12) * 10 ** places) / 10 ** places);

// ---------- Layer 0: Trivial test / ping / model-probe filter ----------
const TRIVIAL_PING = /^(?:ping|pong|test(?:ing)?(?:\s+(?:message|only|ping|\d{1,3}|[a-z]{1,8}))?|just\s+testing|reply\s+(?:ok|pong|with\s+["']?[\w.-]{1,24}["']?)|测试|测试一下|测试消息)[.!?,，。！？\s]*$/i;
const TRIVIAL_MODEL_PROBE = /(?:^|\b)(?:reply\s+(?:concisely\s+)?(?:with\s*)?(?:only\s+)?(?:\(1\)\s*)?(?:your\s+)?(?:exact\s+|current\s+)?model\s*(?:id|name|identifier)|(?:your|current|exact)\s+(?:model\s*id|model\s+identifier|thinking\/reasoning\s+effort|reasoning\s+effort)\b|what\s+model\s+(?:are\s+you|is\s+this)|which\s+model\s+(?:are\s+you|is\s+this|am\s+i)|tell\s+me\s+your\s+model(?:\s+id|\s+name)?|回复.*模型(?:名|id|名称)?|你是什么模型|你是哪个模型)/i;
const TRIVIAL_GRILL_PROBE = /(?:\b(?:just\s+)?grill\s+me\s+a\s+(?:simple\s+|quick\s+)?question\b|\blive\s+test\s+of\b|\bask\s+(?:the\s+owner|me)\s+(?:exactly\s+)?one\s+(?:simple|short|quick|low-stakes)\s+(?:question|grill)|\bthis\s+is\s+(?:a\s+)?(?:quick\s+)?(?:smoke\s+)?test\s+(?:message|prompt|run)\b)/i;

function isTrivialAsk(text, { diff = null, hasOutputs = false, hasCanvas = false, hasAttachments = false, route = "", childCount = 0 } = {}) {
  if (hasOutputs || hasCanvas || hasAttachments) return false;
  if (route === "split" || route === "delegate" || childCount > 0) return false;
  if (diff && (diff.files > 0 || diff.add > 0 || diff.del > 0)) return false;
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return false;
  if (clean.length <= 80 && TRIVIAL_PING.test(clean)) return true;
  if (clean.length <= 1200 && TRIVIAL_MODEL_PROBE.test(clean)) return true;
  if (clean.length <= 1200 && TRIVIAL_GRILL_PROBE.test(clean)) return true;
  return false;
}

// ---------- High-precision narrow Light rule (never guesses Standard vs Heavy from keywords) ----------
const NON_LIGHT_WORDS = /\b(?:refactor\w*|architect\w*|migrat\w*|deploy\w*|sync(?:hroniz\w*|\s+bug|\s+failed)?|security|auth(?:enticat\w*|oriz\w*)?|database|schema|concurren\w*|race\s+condition|deadlock|memory\s+leak|performance|benchmark\w*|protocol|orchestrator|redesign\w*|end[- ]to[- ]end|investigat\w*|audit|root\s+cause|debug\w*|crash\w*|dead|stuck|broken|regression|entire|across\s+all|implement\s+(?:a\s+|the\s+)?(?:new\s+)?(?:feature|system|engine|api|pipeline|service)|package|build|install)\b|重构|架构|迁移|部署|同步|安全|鉴权|数据库|并发|死锁|性能|基准|协议|重新设计|排查|调查|审计|根因|崩溃|卡死|打包|安装|实现.*(?:系统|功能|引擎|服务)/i;
const LIGHT_UI_TWEAK = /(?:\b(?:remove|delete|hide|rename|recolor|change|update|adjust|tweak|swap|set)\b[^.!?\n]{0,60}\b(?:button|checkbox|label|badge|icon|tooltip|placeholder|title|heading|subtitle|wording|copy|text|bg|background|colou?r|font|padding|margin|spacing|border|link|typo)\b|\b(?:same|light|dark|blue|red|green|gray|grey|white|black)\s+(?:bg|background|colou?r)\b|\b(?:fix\s+(?:a\s+|the\s+)?typo|rename\s+(?:this|the)|change\s+(?:the\s+)?(?:text|label|color|bg|background|title|copy|wording))\b|(?:删(?:除|掉)|去掉|隐藏|改(?:一下|个|成|为)?|换(?:一下|个)?|调整)[^。！？\n]{0,30}(?:按钮|复选框|勾选框|标签|文案|文字|标题|副标题|颜色|背景色?|字体|字号|间距|图标|链接|错别字|名字))/i;
const LIGHT_SIMPLE_QA = /^(?:(?:hi|hello|hey|thanks|thank you|ok|okay|please|pls|can you|could you|what is|what's|what does|how do i|how to|explain|define|translate|summarize|你好|谢谢|帮我|请|解释一下|翻译一下|什么是|怎么用)\b)/i;

function inferLightScope(askText, { kind = "", hasCanvas = false, hasAttachments = false } = {}) {
  if (hasCanvas) return false;
  const raw = String(askText || "").trim();
  if (!raw || raw.length > 260) return false;
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length > 4) return false;
  const listItems = lines.filter(l => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l)).length;
  if (listItems >= 3) return false;
  if (NON_LIGHT_WORDS.test(raw)) return false;
  if (LIGHT_UI_TWEAK.test(raw)) return true;
  if (!hasAttachments && (kind === "chat" || kind === "docs") && raw.length <= 140 && LIGHT_SIMPLE_QA.test(raw) && !/```/.test(raw)) return true;
  return false;
}

// ---------- Post-hoc upward-only objective floors (never downgrades) ----------
function objectiveScopeFloor({ route = "", childCount = 0, diff = null, safety = null, score = null } = {}) {
  if (route === "split" || childCount >= 2) return { floor:"heavy", bump:0 };
  if (diff) {
    const files = Number(diff.files) || 0;
    const churn = (Number(diff.add) || 0) + (Number(diff.del) || 0);
    const dirs = Number(diff.dirs) || 0;
    const clean = (safety == null || safety >= 4) && (score == null || score >= 3);
    if (clean && ((files >= 4 && (dirs >= 2 || files >= 6)) || churn >= 150)) {
      return { floor:"", bump:1 };
    }
  }
  return { floor:"", bump:0 };
}

function resolveWorkScope({
  askText = "",
  kind = "",
  route = "",
  childCount = 0,
  diff = null,
  hasOutputs = false,
  hasCanvas = false,
  hasAttachments = false,
  userScope = "",
  recordScope = "",
  recordScopeSource = "",
  safety = null,
  score = null,
} = {}) {
  const manual = normalizeScope(userScope);
  if (manual) return { scope:manual, trivial:false, source:"user" };

  if (isTrivialAsk(askText, { diff, hasOutputs, hasCanvas, hasAttachments, route, childCount })) {
    return { scope:"trivial", trivial:true, source:"trivial" };
  }

  let base = "";
  let source = "default";
  const rec = normalizeScope(recordScope);
  if (rec && recordScopeSource === "user") {
    return { scope:rec, trivial:false, source:"user" };
  }
  if (rec && recordScopeSource === "orchestrator") {
    base = rec;
    source = "orchestrator";
  } else if (rec && recordScopeSource === "self") {
    // Anti self-inflation: self can claim light, never heavy on its own.
    base = rec === "light" ? "light" : "standard";
    source = rec === "light" ? "self" : (inferLightScope(askText, { kind, diff, hasCanvas, hasAttachments }) ? "rule" : "self");
    if (source === "rule") base = "light";
  } else if (rec) {
    base = rec;
    source = recordScopeSource || "recorded";
  } else if (inferLightScope(askText, { kind, diff, hasCanvas, hasAttachments })) {
    base = "light";
    source = "rule";
  } else {
    base = "standard";
    source = "default";
  }

  let level = SCOPE_INDEX[base] ?? 1;
  const lift = objectiveScopeFloor({ route, childCount, diff, safety, score });
  if (lift.floor && SCOPE_INDEX[lift.floor] > level) {
    level = SCOPE_INDEX[lift.floor];
    source = "objective";
  } else if (lift.bump > 0 && level < 2) {
    level = Math.min(2, level + lift.bump);
    source = "objective";
  }
  return { scope:SCOPES[level], trivial:false, source };
}

// ---------- Tiered rating buckets & exact hierarchical Bayesian formula ----------
function emptyBucket() {
  return { works:0, rated:0, passW:0, passSum:0, failW:0, failSum:0, negW:0, negSum:0 };
}

function emptyTierBuckets() {
  return { light:emptyBucket(), standard:emptyBucket(), heavy:emptyBucket() };
}

/** Add one rated observation (score 1..5, weight m > 0, count units = 1) into its difficulty tier bucket. */
function addScoreToBucket(bucket, score, weight = 1, count = 1) {
  if (!(score >= 1 && score <= 5) || !(weight > 0)) return;
  bucket.rated += count;
  if (score >= PASS_THRESHOLD) {
    bucket.passW += weight;
    bucket.passSum += weight * score;
  } else {
    bucket.failW += weight;
    bucket.failSum += weight * score;
    const ramp = Math.min(1, PASS_THRESHOLD - score);
    bucket.negW += weight * ramp;
    bucket.negSum += weight * ramp * score;
  }
}

/** Add a daily/summary aggregate row into its tier bucket (exact when passCount/negWeight present, clean fallback for legacy rows). */
function addAggregateRowToBuckets(buckets, row, { ratingWeight = 1, workWeight = 1, goodScore = GOOD_SCORE, badScore = BAD_SCORE, personWeight = PERSON_WEIGHT } = {}) {
  const scope = normalizeScope(row.scope) || "standard";
  const b = buckets[scope];
  const works = Number(row.works || 0);
  const scoreCount = Number(row.scoreCount || 0);
  const scoreSum = Number(row.scoreSum || 0);
  const good = Number(row.good || 0);
  const bad = Number(row.bad || 0);

  b.works += works * workWeight;
  b.rated += (scoreCount + good + bad) * ratingWeight;

  if (scoreCount > 0) {
    const hasExact = row.passCount != null && Number.isFinite(Number(row.passCount))
      && row.passSum != null && Number.isFinite(Number(row.passSum))
      && row.negWeight != null && Number.isFinite(Number(row.negWeight))
      && row.negWeightedSum != null && Number.isFinite(Number(row.negWeightedSum));
    if (hasExact) {
      const pc = Math.max(0, Math.min(scoreCount, Number(row.passCount)));
      const ps = Math.max(0, Math.min(scoreSum, Number(row.passSum)));
      const fc = Math.max(0, scoreCount - pc);
      const fs = Math.max(0, scoreSum - ps);
      const nw = Math.max(0, Number(row.negWeight));
      const ns = Math.max(0, Number(row.negWeightedSum));
      b.passW += pc * ratingWeight;
      b.passSum += ps * ratingWeight;
      b.failW += fc * ratingWeight;
      b.failSum += fs * ratingWeight;
      b.negW += nw * ratingWeight;
      b.negSum += ns * ratingWeight;
    } else {
      // Legacy row from before difficulty-tiered aggregates: infer from row mean score.
      const avg = Math.min(5, Math.max(1, scoreSum / scoreCount));
      if (avg >= PASS_THRESHOLD) {
        b.passW += scoreCount * ratingWeight;
        b.passSum += scoreSum * ratingWeight;
      } else {
        b.failW += scoreCount * ratingWeight;
        b.failSum += scoreSum * ratingWeight;
        const ramp = Math.min(1, PASS_THRESHOLD - avg);
        b.negW += scoreCount * ramp * ratingWeight;
        b.negSum += scoreSum * ramp * ratingWeight;
      }
    }
  }

  if (good > 0) {
    const gw = personWeight * good * ratingWeight;
    if (goodScore >= PASS_THRESHOLD) {
      b.passW += gw;
      b.passSum += gw * goodScore;
    } else {
      b.failW += gw;
      b.failSum += gw * goodScore;
      const ramp = Math.min(1, PASS_THRESHOLD - goodScore);
      b.negW += gw * ramp;
      b.negSum += gw * ramp * goodScore;
    }
  }

  if (bad > 0) {
    const bw = personWeight * bad * ratingWeight;
    const ramp = Math.min(1, Math.max(0, PASS_THRESHOLD - badScore));
    b.failW += bw;
    b.failSum += bw * badScore;
    b.negW += bw * ramp;
    b.negSum += bw * ramp * badScore;
  }
}

/**
 * Compute posterior expected rating (1..5) for a specific target difficulty tier.
 * - Same tier (L = T): full weight 1.0 for pass and fail.
 * - Harder tier (L > T): pass = 1.0; fail = 0.5 (1 tier up) or 0.25 (2 tiers up).
 * - Easier tier (L < T):
 *     * pass (1 tier down only): never enters denominator; lifts prior P_eff with weight min(k * capRatio, 0.25 * easierPassW), non-decreasing.
 *     * fail (any lower tier): enters denominator with smooth ramp weight min(1, 4.0 - s), uncapped.
 */
function tierRating(buckets, targetScope = "standard", { prior = DEFAULT_PRIOR, priorWeight = DEFAULT_PRIOR_WEIGHT, capRatio = 0.25 } = {}) {
  const T = SCOPE_INDEX[normalizeScope(targetScope)] ?? 1;
  const k = priorWeight > 0 ? priorWeight : DEFAULT_PRIOR_WEIGHT;
  const P0 = Number.isFinite(prior) ? prior : DEFAULT_PRIOR;
  let directW = 0, directSum = 0;
  let easierPassW = 0, easierPassSum = 0;

  for (let L = 0; L < SCOPES.length; L++) {
    const b = buckets[SCOPES[L]];
    if (!b) continue;
    if (L === T) {
      directW += b.passW + b.failW;
      directSum += b.passSum + b.failSum;
    } else if (L > T) {
      const failScale = L - T === 1 ? 0.5 : 0.25;
      directW += b.passW + failScale * b.failW;
      directSum += b.passSum + failScale * b.failSum;
    } else {
      directW += b.negW;
      directSum += b.negSum;
      if (T - L === 1 && b.passW > 0) {
        easierPassW += b.passW;
        easierPassSum += b.passSum;
      }
    }
  }

  let pEff = P0;
  if (easierPassW > 0) {
    const avgEasier = easierPassSum / easierPassW;
    if (avgEasier > P0) {
      const wPlus = Math.min(k * capRatio, 0.25 * easierPassW);
      pEff = (k * P0 + wPlus * avgEasier) / (k + wPlus);
    }
  }
  const rating = (directSum + k * pEff) / (directW + k);
  return { rating, directW, pEff };
}

function provenScopeOf(buckets) {
  if ((buckets.heavy?.rated || 0) > 0) return "heavy";
  if ((buckets.standard?.rated || 0) > 0) return "standard";
  if ((buckets.light?.rated || 0) > 0) return "light";
  return "";
}

/** Composite index rating (0.7 * Standard + 0.3 * Heavy) plus all three tier ratings & verified level metadata. */
function scoreBuckets(buckets, { prior = DEFAULT_PRIOR, priorWeight = DEFAULT_PRIOR_WEIGHT, capRatio = 0.25, scope = "all" } = {}) {
  const light = tierRating(buckets, "light", { prior, priorWeight, capRatio });
  const standard = tierRating(buckets, "standard", { prior, priorWeight, capRatio });
  const heavy = tierRating(buckets, "heavy", { prior, priorWeight, capRatio });
  const target = normalizeScope(scope);
  const rating = target
    ? ({ light:light.rating, standard:standard.rating, heavy:heavy.rating }[target])
    : COMPOSITE_WEIGHTS.standard * standard.rating + COMPOSITE_WEIGHTS.heavy * heavy.rating;
  const provenScope = provenScopeOf(buckets);
  const lightOnly = provenScope === "light";
  const effectiveEvidence = target
    ? Math.max(1, ({ light:light.directW, standard:standard.directW, heavy:heavy.directW }[target]) || 0)
    : Math.max(
        1,
        (buckets.standard?.rated || 0) + (buckets.heavy?.rated || 0)
          + Math.min(priorWeight * capRatio, 0.25 * (buckets.light?.passW || 0))
          + (buckets.light?.negW || 0),
      );
  const makeTier = (name, res) => {
    const b = buckets[name] || emptyBucket();
    const r = round(res.rating, 2);
    return { rating:r, score:round(100 * (res.rating - 1) / 4, 1), works:Math.round(b.works), rated:Math.round(b.rated) };
  };
  return {
    rating,
    effectiveEvidence,
    provenScope,
    lightOnly,
    tiers:{
      light:makeTier("light", light),
      standard:makeTier("standard", standard),
      heavy:makeTier("heavy", heavy),
    },
  };
}

/** Compute exact additive daily pass/neg stats from a single score (1..5). */
function scoreAggregateDelta(score) {
  if (!(score >= 1 && score <= 5)) return null;
  if (score >= PASS_THRESHOLD) {
    return { passCount:1, passSum:score, negWeight:0, negWeightedSum:0 };
  }
  const ramp = Math.min(1, PASS_THRESHOLD - score);
  return { passCount:0, passSum:0, negWeight:ramp, negWeightedSum:ramp * score };
}

module.exports = {
  SCOPES,
  SCOPE_INDEX,
  SCOPE_LABELS,
  PASS_THRESHOLD,
  DEFAULT_PRIOR,
  DEFAULT_PRIOR_WEIGHT,
  PERSON_WEIGHT,
  GOOD_SCORE,
  BAD_SCORE,
  COMPOSITE_WEIGHTS,
  normalizeScope,
  scopeRank,
  isTrivialAsk,
  inferLightScope,
  objectiveScopeFloor,
  resolveWorkScope,
  emptyBucket,
  emptyTierBuckets,
  addScoreToBucket,
  addAggregateRowToBuckets,
  tierRating,
  provenScopeOf,
  scoreBuckets,
  scoreAggregateDelta,
};
