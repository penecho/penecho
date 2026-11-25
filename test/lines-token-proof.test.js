"use strict";
require("./helpers/safety.js");
// PE-927: the token savings evidence shows how the saving comes about, in pictures drawn from the Work's own saved record: the tokens
// each request sent against what resuming would have sent, and what each side cost, part for part. Owner: "what we show to user is
// real", "show diagrams, not just texts, let user know how it is saved", and no tokens spent to report it.
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");
const T = require("../src/server/project-lines/token-evidence.js");

// The page's own code for token savings (public/lines/desk.js), run as the page runs it.
const lines = fs.readFileSync(path.join(__dirname, "../public/lines/desk.js"), "utf8").split("\n");
const source = lines.slice(lines.findIndex(l => l.startsWith("const tokenNumber")), lines.findIndex(l => l.startsWith("ACT['token-open-work']")) + 1).join("\n");
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
function page(evidence) {
  const { document, window } = parseHTML("<html><body><div id=\"host\"></div></body></html>");
  const c = vm.createContext({ document, window, console, Intl, Math, Number, String, JSON, Object, Array, Date, encodeURIComponent, esc, ic:() => "",
    ACT:{}, S:{ tokenPeriod:"week", route:{} }, go() {}, apiUrl:url => url, pathFor:id => `/projects/${id}`, lacks:() => null, isWork:s => s.kind === "work",
    fetch:async () => ({ json:async () => evidence }) });
  vm.runInContext(source, c);
  return { c, document, run:code => vm.runInContext(code, c) };
}
// A Work as Antigravity leaves it: three requests after a 158k conversation last used 63 minutes before.
function saved() {
  const at = 1e12, requests = [[12943, 0, 562], [15268, 12944, 382], [19810, 15269, 375]].map(([input, cached, out], n) => ({ id:`step:${n}`, model:"", at:at + n * 1000, inputTokens:input, outputTokens:out, cacheReadInputTokens:cached, cacheWriteInputTokens:null }));
  return { schemaVersion:1, comparisonVersion:"previous-input-v1", readsVersion:2, workId:"p/deep/work-9", taskId:"t", taskMode:"new", continuedFromWork:"", manifest:"", createdAt:at,
    attempts:[{ id:"a", agent:"antigravity", config:"c", sessionId:"", resumed:false, startedAt:at, model:"gemini-4-neon", requests, events:[], reads:[],
      totals:{ inputTokens:48021, outputTokens:1319, cacheReadInputTokens:28213, cacheWriteInputTokens:null }, source:"Antigravity step usage", complete:false, endedAt:at + 5000 }],
    startup:{ status:"compared", reason:"", baseline:{ requestId:"old:91", input:158040, model:"", agent:"antigravity", at:at - 63 * 60000 }, first:{ requestId:"step:0", input:12943, model:"", agent:"antigravity", at }, difference:145097 } };
}
const station = tokens => ({ id:"work-9", kind:"work", label:"Work 9", tokens, tokenEvidencePath:"works/deep/work-9.tokens.json" });
const line = { id:"deep", title:"Deep-sea icons" }, project = { id:"p" };

test("the evidence shows the saving, then how it comes about: each request's tokens and each side's cost in the same three parts", t => {
  t.after(() => T.usePrices(null));
  T.usePrices(model => model === "gemini-4-neon" ? { model:"gemini-4-neon", input:3, cached:0.15, output:15 } : null);
  const evidence = saved(), tokens = T.forPage(T.summary(evidence, { events:false })), k = tokens.startup.cost, pg = page(evidence), s = station(tokens);
  pg.c.row = { s, l:line }; pg.c.p = project;
  // The line under a Work says which way an unsure cache was counted.
  const chip = pg.run("tokenWorkHTML(row.s, 'deep')");
  assert.ok(chip.includes(`≈ ${Math.round(k.costPercent)}% less cost`));
  assert.match(chip, /than resuming the 158k conversation, cache counted as still warm after 1 h 3 min/);
  const host = pg.document.querySelector("#host");
  host.innerHTML = pg.run("tokenProofBody([row], p)");
  // The saving first, in money: the model's price is saved.
  const hero = host.querySelector(".tkp-hero");
  assert.ok(hero.textContent.includes(`≈ ${Math.round(k.costPercent)}% less cost`));
  assert.ok(hero.textContent.includes(`$${k.fresh.usd.toFixed(2)} instead of ≈ $${k.resumed.usd.toFixed(2)}`), hero.textContent);
  assert.match(host.querySelector(".tkp-how").textContent, /Resuming would have carried the earlier 158k tokens through all 3 requests of this Work; the fresh start began with 12\.9k\./);
  // What each side cost: two bars on one scale, the same three parts in each, sized by what each part cost.
  const bars = [...host.querySelectorAll(".tkc-bar")];
  assert.equal(bars.length, 2);
  const flex = bar => [...bar.querySelectorAll(".tkc-seg")].map(seg => Number(/flex:(\d+)/.exec(seg.getAttribute("style"))[1]));
  assert.deepEqual(flex(bars[0]), k.parts.resumed);
  assert.deepEqual(flex(bars[1]), k.parts.fresh);
  assert.equal(bars[0].getAttribute("style"), "width:100.00%");
  assert.equal(bars[1].getAttribute("style"), `width:${(100 * k.fresh.cost / k.resumed.cost).toFixed(2)}%`, "the fresh start's bar is shorter by what was saved");
  const [carried, own, out] = [...bars[0].querySelectorAll(".tkc-seg")];
  assert.equal(carried.dataset.tip, "The earlier conversation (158k tokens), sent again with every request");
  assert.equal(bars[1].querySelector(".tkc-seg").dataset.tip, "The fresh start (12.9k tokens), sent again with every request");
  assert.equal(own.dataset.tip, "This Work’s own context"); assert.equal(out.dataset.tip, "Output");
  assert.match(carried.dataset.value, /^\$0\.\d+ · \d+%$/, "a part says what it cost and its share, on hover or focus");
  assert.ok([...host.querySelectorAll(".tkc-seg")].every(seg => seg.getAttribute("tabindex") === "0"), "each part can be reached by keyboard");
  assert.deepEqual([...host.querySelectorAll(".tkc-bars + .tkc-legend li")].map(li => li.textContent), ["Sent again with every request", "This Work’s own context", "Output"]);
  // What is not known is said beside the saving, with the other figure.
  assert.match(host.querySelector(".tkp-note").textContent, new RegExp(`after 1 h 3 min is not known, so it is counted as if it were: the smaller saving\\. Had it expired: ≈ ${Math.round(k.otherCache.costPercent)}% less cost\\.`));
  // The figures and the method stay one click away, with the model and the prices that were used.
  const figures = host.querySelector(".tkp-more:not(.tkp-method)");
  assert.equal(figures.querySelector("summary").textContent, "The figures");
  assert.match(figures.textContent, /gemini-4-neon, as saved in Agent record & prices: cache hit 0\.05×, cache write 1×, output 5× new input/);
  assert.match(figures.textContent, /Model: gemini-4-neon/);
  assert.match(host.querySelector(".tkp-method").textContent, /No AI is called to make it\./);

  // Each request's tokens are drawn from the Work's saved evidence when the picture is wanted: the fresh start as measured, and
  // resuming as the earlier conversation in place of the fresh start.
  const slot = host.querySelector(".tkp-requests");
  assert.equal(slot.dataset.evidence, "/projects/p/file?path=works%2Fdeep%2Fwork-9.tokens.json");
  assert.ok(slot.hasAttribute("data-open"), "with a few Works the picture is drawn at once");
  const drawn = pg.run(`(() => { const d = tokenRequestsOf(${JSON.stringify(evidence)}, { baseline:{ input:158040 } }); return { d, html:tokenRequestsHTML(d.fresh, d.resumed, d.earlier) }; })()`);
  assert.deepEqual([...drawn.d.fresh], [12943, 15268, 19810]);
  assert.deepEqual([...drawn.d.resumed], [158040, 158040 + 15268 - 12943, 158040 + 19810 - 12943]);
  slot.innerHTML = drawn.html;
  assert.equal(slot.querySelectorAll("polyline.tkc-line").length, 2);
  assert.equal(slot.querySelector(".tkc-plot").dataset.fresh, "12943,15268,19810");
  assert.deepEqual([...slot.querySelectorAll(".tkc-legend li")].map(li => li.textContent), ["Resuming the 158k conversation", "Fresh start"]);
  assert.deepEqual([...slot.querySelectorAll(".tkc-end .v")].map(v => v.textContent), ["≈ 164.9k", "19.8k"], "each line says where it ended");
  assert.match(slot.querySelector("svg").getAttribute("aria-label"), /Over 3 requests the fresh start sent 12\.9k to 19\.8k tokens each time; resuming would have sent about 158k to 164\.9k\./);
});

test("after a change of model the page says the cache could not be used, not that it was warm", () => {
  const evidence = saved(), at = evidence.createdAt;
  Object.assign(evidence.attempts[0], { model:"gemini-4-neon" });
  evidence.startup.baseline = { ...evidence.startup.baseline, model:"gemini-4-carbon", at:at - 9 * 60000 };
  const tokens = T.forPage(T.summary(evidence, { events:false })), pg = page(evidence);
  assert.equal(tokens.startup.cost.cache, "model");
  pg.c.row = { s:station(tokens), l:line }; pg.c.p = project;
  assert.match(pg.run("tokenWorkHTML(row.s, 'deep')"), /than resuming the 158k conversation, cache lost when the model changed/);
  const host = pg.document.querySelector("#host");
  host.innerHTML = pg.run("tokenProofBody([row], p)");
  assert.equal(host.querySelector(".tkp-note").textContent, "The earlier conversation ran on gemini-4-carbon and this Work on gemini-4-neon. A model cannot use another’s cache, so resuming would have written the whole conversation to it again.");
  const figures = host.querySelector(".tkp-more:not(.tkp-method)").textContent;
  assert.match(figures, /cache lost when the model changed/); assert.doesNotMatch(figures, /Had the cache/);
});
test("with no price saved for the model nothing is told in dollars, and a long list draws each Work's requests only when asked", () => {
  const evidence = saved(), tokens = T.forPage(T.summary(evidence, { events:false })), pg = page(evidence);
  pg.c.rows = [1, 2, 3, 4].map(n => ({ s:{ ...station(tokens), id:`work-${n}`, label:`Work ${n}` }, l:line })); pg.c.p = project;
  const host = pg.document.querySelector("#host");
  host.innerHTML = pg.run("tokenProofBody(rows, p)");
  assert.equal(host.querySelectorAll(".token-proof-work").length, 4);
  assert.ok(!host.querySelector(".tkp-hero").textContent.includes("$"));
  assert.equal(host.querySelector(".tkc figcaption").textContent, "What that costs, in new-input tokens");
  assert.match(host.querySelector(".tkp-more:not(.tkp-method)").textContent, /typical Gemini prices: cache hit 0\.1×, cache write 1×, output 6× new input/);
  const slots = [...host.querySelectorAll(".tkp-requests")];
  assert.ok(slots.every(slot => !slot.hasAttribute("data-open") && slot.querySelector("[data-act=\"token-requests\"]").textContent === "Show each request"));
  assert.equal(host.querySelectorAll(".tkp-method").length, 1, "how it is worked out is said once, under them all");
});

test("evidence dialog sorts Works from recent to old and lazy-loads in batches on scroll, intersection, or click", () => {
  const { document, window } = parseHTML("<html><body><div id=\"host\"></div></body></html>");
  const observers = [];
  class FakeObserver {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.targets = new Set(); this.disconnected = false; observers.push(this); }
    observe(el) { this.targets.add(el); }
    unobserve(el) { this.targets.delete(el); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
    trigger(isIntersecting = true) { this.cb([...this.targets].map(target => ({ target, isIntersecting }))); }
  }
  const makeRecord = (slug, stepNum, at, lastAt = at + 500) => ({
    workId:`p/${slug}/work-${stepNum}`, lineId:slug, stepId:`work-${stepNum}`, label:`Work ${stepNum}`,
    createdAt:at, inputTokens:1000, outputTokens:200, cacheReadInputTokens:0, cacheWriteInputTokens:0,
    requests:2, coverage:"reported totals", startup:{ status:"unavailable", first:{ at } }, lastRequest:{ at:lastAt },
  });
  // Unsorted project records across 25 Works (mix of old, newest, middle)
  const base = Date.now() - 3 * 86400000;
  const order = [5, 19, 1, 24, 12, 0, 23, 8, 17, 3, 22, 14, 7, 21, 10, 2, 20, 15, 6, 18, 11, 4, 16, 9, 13];
  const linesData = order.map(n => ({ id:`line-${n}`, title:`Line ${n}`, stations:[] }));
  const records = order.map(n => makeRecord(`line-${n}`, 1, base + n * 60000, base + n * 60000 + 3000));
  const proj = { id:"p", lines:linesData, landed:[], backlog:[], tokens:{ records, starts:[], daily:[] } };
  const c = vm.createContext({
    document, window, console, Intl, Math, Number, String, JSON, Object, Array, Date, encodeURIComponent, esc, ic:() => "",
    IntersectionObserver:FakeObserver, ACT:{}, S:{ tokenPeriod:"all", route:{} },
    project:() => proj, allLines:p => [...p.lines, ...p.landed, ...p.backlog],
    periodSince:() => 0, go() {}, apiUrl:url => url, pathFor:id => `/projects/${id}`, lacks:() => null, isWork:s => s.kind === "work",
    fetch:async () => ({ json:async () => ({}) }),
  });
  // Linkedom <dialog> needs showModal/close helpers
  const origCreate = document.createElement.bind(document);
  document.createElement = tag => {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === "dialog") {
      el.showModal = () => { el.setAttribute("open", ""); };
      el.close = () => { el.removeAttribute("open"); el.dispatchEvent(new window.Event("close")); };
    }
    return el;
  };
  vm.runInContext(source, c);

  // 1. Project-level Details: newest first, first 10 rendered
  c.ACT["token-proof"]({ dataset:{} });
  const dialog = document.querySelector("dialog.token-proof-dialog");
  assert.ok(dialog);
  const titles = () => [...dialog.querySelectorAll(".token-proof-work h3")].map(h => h.textContent);
  assert.equal(titles().length, 10, "only the first batch of 10 renders immediately");
  assert.deepEqual(titles(), Array.from({ length:10 }, (_, i) => `Line ${24 - i} · Work 1`), "sorted from recent to old");
  assert.equal(dialog.querySelector(".token-proof-count").textContent, "Showing 10 of 25");
  assert.equal(observers.length, 1);

  // 2. IntersectionObserver loads the next 10 (Line 14 down to Line 5)
  observers[0].trigger(true);
  assert.equal(titles().length, 20);
  assert.equal(titles()[10], "Line 14 · Work 1");
  assert.equal(titles()[19], "Line 5 · Work 1");
  assert.equal(dialog.querySelector(".token-proof-count").textContent, "Showing 20 of 25");

  // 3. Clicking "Load more" loads the final 5 and removes the footer + disconnects observer
  const moreBtn = dialog.querySelector('[data-act="token-proof-more"]');
  c.ACT["token-proof-more"](moreBtn);
  assert.equal(titles().length, 25);
  assert.equal(titles()[20], "Line 4 · Work 1");
  assert.equal(titles()[24], "Line 0 · Work 1");
  assert.equal(dialog.querySelector("[data-token-proof-more]"), null, "sentinel disappears once all rows are shown");
  assert.equal(observers[0].disconnected, true, "observer disconnects when finished");
  dialog.close();

  // 4. Line-level Details: chronological stations also render newest-to-oldest and lazy-load on scroll
  const bigLine = {
    id:"busy", title:"Busy Line",
    stations:Array.from({ length:15 }, (_, i) => ({
      id:`work-${i + 1}`, kind:"work", label:`Work ${i + 1}`, startedAt:base + i * 10000, endedAt:base + i * 10000 + 5000,
      tokens:makeRecord("busy", i + 1, base + i * 10000, base + i * 10000 + 4000),
    })),
  };
  proj.lines.push(bigLine);
  c.ACT["token-proof"]({ dataset:{ line:"busy" } });
  const lineDialog = document.querySelector("dialog.token-proof-dialog");
  const lineTitles = () => [...lineDialog.querySelectorAll(".token-proof-work h3")].map(h => h.textContent);
  assert.equal(lineTitles().length, 10);
  assert.equal(lineTitles()[0], "Busy Line · Work 15");
  assert.equal(lineTitles()[9], "Busy Line · Work 6");

  // Scroll near bottom triggers the scroll listener fallback
  const body = lineDialog.querySelector(".token-proof-body");
  Object.defineProperties(body, { scrollHeight:{ value:2000, configurable:true }, clientHeight:{ value:600, configurable:true }, scrollTop:{ value:1250, configurable:true } });
  body.dispatchEvent(new window.Event("scroll"));
  assert.equal(lineTitles().length, 15);
  assert.equal(lineTitles()[14], "Busy Line · Work 1");
  assert.equal(lineDialog.querySelector("[data-token-proof-more]"), null);
  lineDialog.close();
});

test("closing the evidence dialog before loading all batches disconnects its IntersectionObserver", () => {
  const { document, window } = parseHTML("<html><body></body></html>");
  const observers = [];
  class FakeObserver {
    constructor(cb) { this.cb = cb; this.disconnected = false; observers.push(this); }
    observe() {}
    unobserve() {}
    disconnect() { this.disconnected = true; }
  }
  const base = Date.now() - 86400000;
  const records = Array.from({ length:14 }, (_, i) => ({
    workId:`p/l/work-${i + 1}`, lineId:"l", stepId:`work-${i + 1}`, label:`Work ${i + 1}`,
    createdAt:base + i * 1000, inputTokens:500, outputTokens:100, cacheReadInputTokens:0, cacheWriteInputTokens:0,
    requests:1, coverage:"reported totals", startup:{ status:"unavailable", first:{ at:base + i * 1000 } },
  }));
  const proj = { id:"p", lines:[{ id:"l", title:"L", stations:[] }], landed:[], backlog:[], tokens:{ records, starts:[], daily:[] } };
  const origCreate = document.createElement.bind(document);
  document.createElement = tag => {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === "dialog") {
      el.showModal = () => { el.setAttribute("open", ""); };
      el.close = () => { el.removeAttribute("open"); el.dispatchEvent(new window.Event("close")); };
    }
    return el;
  };
  const c = vm.createContext({
    document, window, console, Intl, Math, Number, String, JSON, Object, Array, Date, encodeURIComponent, esc, ic:() => "",
    IntersectionObserver:FakeObserver, ACT:{}, S:{ tokenPeriod:"all", route:{} },
    project:() => proj, allLines:p => [...p.lines, ...p.landed, ...p.backlog],
    periodSince:() => 0, go() {}, apiUrl:url => url, pathFor:id => `/projects/${id}`, lacks:() => null, isWork:s => s.kind === "work",
    fetch:async () => ({ json:async () => ({}) }),
  });
  vm.runInContext(source, c);
  c.ACT["token-proof"]({ dataset:{} });
  const dialog = document.querySelector("dialog.token-proof-dialog");
  assert.equal(observers.length, 1);
  assert.equal(observers[0].disconnected, false);
  dialog.close();
  assert.equal(observers[0].disconnected, true);
});
