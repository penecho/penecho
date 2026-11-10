"use strict";
// Assist says who ranked its actions (instant local rules or PenEchoLLM) and
// shows each tier's daily PenEchoLLM allowance.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  let depth = 0, index = source.indexOf("{", source.indexOf(")", start));
  for (; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) break;
  }
  return source.slice(start, index + 1);
}
const smart = read("src/client/app/smart-suggestions.js");
function context(access, extra = {}) {
  const ctx = vm.createContext({
    state:{ language:"en" }, Date, Number, Math, String, Boolean,
    smartSuggest:{ access, enabled:true, available:true, controller:null, timer:0, status:null, lastKey:"", lastResult:null, ...extra.smartSuggest },
    smartSuggestRemote:() => extra.remote !== false,
  });
  vm.runInContext(["suggestionCopy", "suggestionAccessBlocked", "suggestionAllowance", "suggestionResetText", "suggestionAllowanceShort", "suggestionAllowanceLines", "penechoLLMRankState", "penechoLLMRankSentence"].map(name => functionSource(smart, name)).join("\n"), ctx);
  return ctx;
}
const future = Date.now() + 3600000;

test("each tier sees its PenEchoLLM allowance, and a warning before it runs out", () => {
  const guest = context({ signedIn:false, subscribed:false, freeLimit:200, used:190, remaining:10, price:0.1, resetsAt:future });
  assert.equal(guest.suggestionAllowance().tier, "guest");
  assert.equal(guest.suggestionAllowanceShort(guest.suggestionAllowance()), "10 left");
  assert.match(guest.suggestionAllowanceLines(guest.suggestionAllowance())[0], /Free trial: 10 of 200 left today\. Sign in/);
  assert.match(guest.suggestionAllowanceLines(guest.suggestionAllowance())[1], /Resets at/);
  const account = context({ signedIn:true, subscribed:false, freeLimit:500, used:20, remaining:480, price:0.1, resetsAt:future });
  assert.equal(account.suggestionAllowanceShort(account.suggestionAllowance()), "");
  assert.match(account.suggestionAllowanceLines(account.suggestionAllowance())[0], /480 of 500 free suggestions left today/);
  const credits = context({ signedIn:true, subscribed:false, freeLimit:500, used:500, remaining:0, price:0.1, paidEnabled:true, spentToday:1.3, dailyCreditLimit:50, resetsAt:future });
  assert.equal(credits.suggestionAllowance().tier, "credits");
  assert.equal(credits.suggestionAllowanceShort(credits.suggestionAllowance()), "0.1 credit");
  assert.match(credits.suggestionAllowanceLines(credits.suggestionAllowance())[0], /0\.1 credit each · 1\.3 of 50 credits today/);
  const subscriber = context({ signedIn:true, subscribed:true, freeLimit:null, remaining:null, price:0 });
  assert.deepEqual([...subscriber.suggestionAllowanceLines(subscriber.suggestionAllowance())], ["Unlimited PenEchoLLM with your subscription."]);
  assert.equal(subscriber.suggestionAllowanceShort(subscriber.suggestionAllowance()), "");
  const blocked = context({ signedIn:false, subscribed:false, freeLimit:200, used:200, remaining:0, reason:"sign_in_required", resetsAt:future });
  assert.equal(blocked.suggestionAllowanceShort(blocked.suggestionAllowance()), "limit reached");
  assert.match(blocked.suggestionAllowanceLines(blocked.suggestionAllowance())[0], /Sign in to continue/);
  const zh = context({ signedIn:false, subscribed:false, freeLimit:200, used:195, remaining:5, resetsAt:future });
  zh.state.language = "zh";
  assert.equal(zh.suggestionAllowanceShort(zh.suggestionAllowance()), "剩 5 次");
});

test("the bar distinguishes instant local order, PenEchoLLM on its way, ranked and refreshing", () => {
  const cluster = { key:"1,2" };
  const ctx = context({ signedIn:true, remaining:300, freeLimit:500 }, { smartSuggest:{ timer:7 } });
  assert.equal(ctx.penechoLLMRankState(cluster, { source:"local" }), "pending");
  ctx.smartSuggest.timer = 0;
  ctx.smartSuggest.controller = {};
  ctx.smartSuggest.status = { key:"1,2", state:"pending" };
  assert.equal(ctx.penechoLLMRankState(cluster, { source:"local" }), "pending");
  assert.equal(ctx.penechoLLMRankState(cluster, { source:"penecho-llm" }), "refreshing");
  ctx.smartSuggest.controller = null;
  ctx.smartSuggest.status = { key:"1,2", state:"ranked" };
  assert.equal(ctx.penechoLLMRankState(cluster, { source:"penecho-llm" }), "ranked");
  ctx.smartSuggest.status = { key:"1,2", state:"failed" };
  assert.equal(ctx.penechoLLMRankState(cluster, { source:"local" }), "local");
  assert.match(ctx.penechoLLMRankSentence("local"), /did not answer/);
  ctx.smartSuggest.timer = 7;
  assert.equal(ctx.penechoLLMRankState(cluster, { source:"local" }), "pending","a new timer overrides the same cluster's previous failure");
  assert.equal(ctx.penechoLLMRankState(cluster, { source:"penecho-llm" }), "refreshing");
  ctx.smartSuggest.timer = 0;
  ctx.smartSuggest.lastResult = { latencyMs:1340, cached:false, chargedCredits:0.1 };
  assert.match(ctx.penechoLLMRankSentence("ranked"), /ranked these actions for your ink in 1\.3 s\. Used 0\.1 credit\./);
  ctx.smartSuggest.lastResult = { latencyMs:80, cached:true, chargedCredits:0 };
  assert.match(ctx.penechoLLMRankSentence("ranked"), /no charge/);
  const off = context({ signedIn:true }, { remote:false });
  assert.equal(off.penechoLLMRankState(cluster, { source:"local" }), "local");
});

test("Assist, the Widget panel, the header chips and Settings show the ranking source and allowance", () => {
  const widget = read("src/client/app/widget-assist.js"), runtime = read("src/client/app/canvas-runtime.js"), css = read("public/style.css"), core = read("src/client/app/core.js"), zh = read("public/locales/zh.js");
  const render = functionSource(smart, "renderAssist");
  assert.match(render, /element\.dataset\.rank = penechoLLMRankState\(bar\.cluster, bar\.view\)/);
  assert.match(render, /assistSparkControl\(element\.dataset\.rank\)/);
  assert.match(render, /assistAnimateRanking\(element, previousRank\)/);
  assert.match(functionSource(smart, "assistAnimateRanking"), /prefers-reduced-motion/);
  assert.match(functionSource(smart, "runSmartSuggest"), /smartSuggest\.lastResult = \{ latencyMs:[^}]*cached:data\.cached === true, chargedCredits:/);
  assert.match(functionSource(smart, "runSmartSuggest"), /else assistRefreshRank\(\);/);
  assert.match(functionSource(smart, "updateSuggestionAccess"), /refreshSuggestionAllowanceStatus\(\)/);
  assert.doesNotMatch(functionSource(smart, "suggestionAccessNotice"), /今日 200 次|Today's 500/);
  assert.match(functionSource(widget, "renderWidgetRefinePanel"), /penechoLLMBadge\(pending \? "pending" : ranked \? "ranked" : "local",/);
  assert.match(widget, /source = probabilities \? "penecho-llm" : "local"/);
  assert.match(runtime, /button\.dataset\.source = source;/);
  for (const rule of [/\.penecho-llm-badge\[data-rank="pending"\]/, /\.assist-bar\.just-ranked/, /\.object-chrome-button\.suggest\[data-source="penecho-llm"\]::after/, /\.assist-llm-info \{/]) assert.match(css, rule);
  assert.match(css,/\.assist-bar\[data-rank="pending"\]::after, \.assist-bar\[data-rank="refreshing"\]::after/);
  assert.match(core, /widgetAssistRankedByLLM: "Ranked by PenEchoLLM"/);
  assert.match(zh, /widgetAssistRankedByLLM: "由 PenEchoLLM 排序"/);
});
