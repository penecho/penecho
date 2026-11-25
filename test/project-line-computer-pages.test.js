"use strict";
require("./helpers/safety.js");
// R4 pages. An Ask written on penecho.ai for a project that lives on a computer waits for that computer: penecho.ai says which
// computer and why it is not starting; the app says it came from penecho.ai and offers to run it. On penecho.ai, Run with offers the
// computer's agents for such a project, and only PenEcho for a project made there.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = name => fs.readFileSync(path.join(__dirname, "../public/lines", name), "utf8");
function extract(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`)), body = source.indexOf("{", source.indexOf(")", start));
  assert.ok(start >= 0, name);
  for (let depth = 0, i = body; i < source.length; i++) { if (source[i] === "{") depth++; else if (source[i] === "}" && !--depth) return source.slice(start, i + 1); }
  throw new Error(`Missing ${name}`);
}
const cloud = read("cloud.js"), hosted = read("hosted.js"), settings = read("settings.js");

function heldPage({ HOSTED = null, S = {}, agents = [] } = {}) {
  const names = { penecho:"PenEcho", claude:"Claude Code" };
  const c = vm.createContext({ HOSTED, S, esc:x => String(x), ic:name => `<i:${name}>`, agentInfo:id => ({ id, name:names[id] || id }),
    runnableAgents:() => agents, runAgent:() => agents[0] || null });
  vm.runInContext(extract(cloud, "heldComputerHTML"), c);
  const p = {}, l = { id:"rain" };
  return held => c.heldComputerHTML(p, l, { id:"ask-1", when:"today", held:{ reason:"computer", agent:"claude", ...held } });
}

test("penecho.ai says Waiting for your computer, which computer, and why the Ask is not starting", () => {
  const html = heldPage({ HOSTED:{} });
  assert.match(html({ name:"Studio Mac", blocked:"closed" }), /<strong>Waiting for your computer<\/strong> No recent check-in from Studio Mac\. Check that PenEcho is open and signed in\./);
  assert.match(html({ name:"Studio Mac", blocked:"switch" }), /Turn on Run Asks sent from penecho\.ai in PenEcho on Studio Mac\./);
  assert.match(html({ name:"Studio Mac", blocked:"agent" }), /Claude Code is not ready on Studio Mac\. Set it up in PenEcho there\./);
  const soon = html({ name:"Studio Mac", blocked:null });
  assert.match(soon, /Studio Mac checks about every 10 seconds\. Claude Code starts after sync\./);
  assert.match(soon, /class="spin"/, "only an Ask about to start spins");
  assert.doesNotMatch(html({ name:"Studio Mac", blocked:"closed" }), /class="spin"/);
  assert.match(html({ blocked:"closed" }), /Starts when the newest PenEcho is open on your computer, signed in\./, "no computer seen yet");
  assert.match(soon, /data-act="held-computer-back" data-line="rain" data-step="ask-1">Take it back</);
});

test("the app says the Ask came from penecho.ai, offers the switch on this computer only, and to run it now", () => {
  const claude = { id:"claude", name:"Claude Code" }, me = { id:"mac-1", runsAsks:false, agents:[{ id:"claude", ready:true }] };
  const off = heldPage({ S:{ computer:me, thisComputer:true }, agents:[claude] })({ computer:"mac-1" });
  assert.match(off, /<strong>Sent from penecho\.ai<\/strong> It runs here when Run Asks sent from penecho\.ai is on\./);
  assert.match(off, /data-act="computer-asks-on">Turn on</);
  assert.match(off, /data-act="unsent-run" data-agent="claude" data-line="rain" data-step="ask-1">Run it now</);
  assert.doesNotMatch(heldPage({ S:{ computer:me, thisComputer:false }, agents:[claude] })({ computer:"mac-1" }), /computer-asks-on/, "the switch is turned on at the computer itself");
  const other = heldPage({ S:{ computer:me, thisComputer:true }, agents:[claude] })({ computer:"mac-2" });
  assert.match(other, /It waits for another computer of yours\./);
  assert.doesNotMatch(other, /computer-asks-on/);
  assert.match(other, /Run it now/);
  const on = heldPage({ S:{ computer:{ ...me, runsAsks:true }, thisComputer:true }, agents:[claude] })({});
  assert.match(on, /Claude Code starts after this project syncs\./);
  assert.doesNotMatch(on, /Run it now|computer-asks-on/);
  const unready = heldPage({ S:{ computer:{ ...me, runsAsks:true, agents:[{ id:"claude", ready:false }] }, thisComputer:true }, agents:[{ id:"codex", name:"Codex" }] })({});
  assert.match(unready, /Claude Code is not ready on this computer\./);
  assert.match(unready, /data-agent="codex"[^>]*>Run it now</, "another agent that can run here");
});

function hostedPage({ projects, computers, models = [] }) {
  const asked = [];
  const bodies = { "/api/v1/computers":{ computers }, "/api/v1/line-projects":{ projects }, "/api/v1/models":{ models } };
  const c = vm.createContext({ HOSTED:{ key:"garden", onComputer:false, lives:null, computers:[], computersAt:0, runOn:{} }, S:{}, Date, Number, Boolean, Map, Set, String,
    document:{ documentElement:{ classList:{ toggle() {} } } },
    hostedCall:async url => { asked.push(url); return { ok:true, json:async () => bodies[url] }; } });
  const agents = hosted.slice(hosted.indexOf("const HOSTED_AGENTS ="), hosted.indexOf("function hostedAgent("));
  const functions = [
    "hostedAgent", "hostedLives", "hostedLivesFrom", "hostedLivesShown", "hostedComputers", "hostedSyncs",
    "hostedOwning", "hostedPresets", "hostedModels", "hostedWorkerModels", "hostedAgents", "hostedComputerFor",
  ];
  vm.runInContext(agents + functions.map(name => extract(hosted, name)).join("\n"), c);
  return { c, asked };
}
const plain = value => JSON.parse(JSON.stringify(value));
const computer = (id, extra = {}) => ({ id, name:id, agents:[{ id:"penecho", name:"PenEcho", ready:true }, { id:"claude", name:"Claude Code", ready:true }], runsAsks:true, lastSeenAt:1, open:false, ...extra });

test("on penecho.ai a project made there runs with PenEcho only; a project on a computer offers that computer's ready agents", async () => {
  const models = [{ id:"cloud-worker", displayName:"Cloud model", worker:true, workerDefault:true, defaultEffort:"high" }];
  const made = hostedPage({ projects:[{ key:"garden", cloudMade:true }], computers:[computer("mac")], models });
  const cloudAgents = await made.c.hostedAgents();
  assert.deepEqual(plain(cloudAgents.map(a => a.id)), ["penecho"]);
  assert.deepEqual(plain(cloudAgents[0].model), { name:"Cloud model", effort:"high", choices:["Cloud model"] });
  assert.deepEqual(made.asked, ["/api/v1/line-projects", "/api/v1/models"]);
  assert.equal(made.c.HOSTED.onComputer, false);
  const mine = hostedPage({ projects:[{ key:"garden", system:"my-canvases" }], computers:[computer("mac")] });
  assert.deepEqual(plain((await mine.c.hostedAgents()).map(a => a.id)), ["penecho"], "My Canvases works on penecho.ai");
  const lives = hostedPage({ projects:[{ key:"garden" }], computers:[computer("mac", { agents:[{ id:"claude", name:"Claude Code", ready:true }, { id:"kimi", name:"Kimi", ready:false }] })] });
  const agents = await lives.c.hostedAgents();
  assert.equal(lives.c.HOSTED.onComputer, true);
  assert.deepEqual(plain(agents.map(a => [a.id, a.name, a.mono, a.runs])), [["claude", "Claude Code", "Cl", true]], "an agent that is not ready is not offered");
  const none = hostedPage({ projects:[{ key:"garden" }], computers:[] });
  assert.deepEqual(plain((await none.c.hostedAgents()).map(a => a.id)), ["penecho"], "before any computer is seen: PenEcho, which every signed-in computer has");
});

test("the Ask is held for the computer picked in the menu, else an open one that has the agent, else the one seen last", async () => {
  const page = hostedPage({ projects:[{ key:"garden" }], computers:[computer("old", { lastSeenAt:5 }), computer("open", { open:true, lastSeenAt:9 }), computer("bare", { open:true, lastSeenAt:10, agents:[] })] });
  await page.c.hostedComputers(true);
  assert.equal(page.c.hostedComputerFor("rain", "claude").id, "open");
  page.c.HOSTED.runOn.rain = "old";
  assert.equal(page.c.hostedComputerFor("rain", "claude").id, "old");
  assert.equal(page.c.hostedComputerFor("rain", "codex"), null, "no computer has it: none is named");
});

test("only the computer that syncs this project is offered its Asks, even when another of the account's computers was seen last", async () => {
  const win = computer("windows", { open:true, lastSeenAt:20, projects:["elsewhere"], presets:[{ id:"win-claude", name:"Claude Code", agent:"claude", default:true }] });
  const mac = computer("mac", { open:true, lastSeenAt:10, projects:["garden"], presets:[{ id:"mac-claude", name:"Claude Code · opus", agent:"claude", default:true }] });
  const page = hostedPage({ projects:[{ key:"garden" }], computers:[win, mac] });
  await page.c.hostedAgents();
  assert.equal(page.c.hostedComputerFor("rain", "claude").id, "mac");
  assert.deepEqual(plain(page.c.S.presets.presets.map(x => x.computer)), ["mac"], "the other computer's saved agents are not offered");
  assert.equal(page.c.S.presets.default, "mac-claude");
});

test("Agents page owns the Run Asks sent from penecho.ai switch across signed-in, signed-out, LAN, and hosted views", () => {
  const ctx = (S, HOSTED = null) => {
    const c = vm.createContext({
      HOSTED,
      S,
      esc:x => String(x),
      ic:name => `<i:${name}>`,
      sysSwitchRowHTML:(id, title, sub, checked, attr, extra = '') =>
        `<div class="sys-row"><strong id="${id}Lbl">${title}</strong><small>${sub}</small>${extra}<button type="button" id="${id}" role="switch" aria-checked="${checked}" ${attr}></button></div>`,
    });
    vm.runInContext(`${extract(settings, "cloudAsksSectionHTML")}\n${extract(settings, "installedSectionHTML")}`, c);
    return c;
  };

  const offHtml = ctx({ thisComputer:true, cloudAccount:{ signedIn:true }, computer:{ id:"mac-1", runsAsks:false } }).cloudAsksSectionHTML();
  assert.match(offHtml, /id="sysCloudAsks"/);
  assert.match(offHtml, /id="prefComputerAsks"[^>]*aria-checked="false"[^>]*data-act="computer-asks-toggle"/);
  assert.match(offHtml, /Run Asks sent from penecho\.ai/);
  assert.match(offHtml, /only after you click Run with an agent on penecho\.ai/);
  assert.doesNotMatch(offHtml, /data-act="cloud-sign-in"/);

  const onHtml = ctx({ thisComputer:true, cloudAccount:{ signedIn:true }, computer:{ id:"mac-1", runsAsks:true } }).cloudAsksSectionHTML();
  assert.match(onHtml, /id="prefComputerAsks"[^>]*aria-checked="true"/);

  const signedOutHtml = ctx({ thisComputer:true, cloudAccount:{ signedIn:false }, computer:{ id:"mac-1", runsAsks:false } }).cloudAsksSectionHTML();
  assert.match(signedOutHtml, /data-act="cloud-sign-in"/);
  assert.match(signedOutHtml, /Sign in to PenEcho Cloud/);

  const lanHtml = ctx({ thisComputer:false, cloudAccount:{ signedIn:true }, computer:{ id:"mac-1", runsAsks:false } }).cloudAsksSectionHTML();
  assert.match(lanHtml, /id="prefComputerAsks"[^>]*disabled/);
  assert.match(lanHtml, /Change this on the computer running PenEcho\./);

  assert.equal(ctx({ thisComputer:true, cloudAccount:{ unavailable:true }, computer:null }).cloudAsksSectionHTML(), "");

  const hostedCtx = ctx({ thisComputer:false, cloudAccount:{ signedIn:true } }, { computers:[computer("mac-1", { open:true, runsAsks:true }), computer("mac-2", { open:false, runsAsks:false })] });
  assert.equal(hostedCtx.cloudAsksSectionHTML(), "");
  const hostedList = hostedCtx.installedSectionHTML();
  assert.match(hostedList, /Runs Asks sent from penecho\.ai/);
  assert.match(hostedList, /Cloud Asks off/);
});

test("account menu omits Run Asks sent from penecho.ai while computer-asks-toggle posts to /computer and re-renders Agents", async () => {
  const menus = [], calls = [];
  let renders = 0;
  const c = vm.createContext({
    HOSTED:null,
    SET:{ agentsTab:"agents" },
    S:{ thisComputer:true, shelfPage:"agents", cloudAccount:{ signedIn:true, credits:{ available:1200 } }, computer:{ id:"mac-1", runsAsks:false } },
    ACT:{},
    $:() => ({}),
    cloudNumber:n => String(n),
    cloudOpen() {},
    openMenu:(_el, items) => menus.push(items),
    api:async (url, init) => { calls.push({ url, init }); return { id:"mac-1", runsAsks:Boolean(init?.body?.runsAsks) }; },
    toast() {},
    refreshAfterChange() {},
    settingsRender:() => { renders++; },
    loadCloudAccount() {},
  });
  const menuFn = cloud.slice(cloud.indexOf("ACT['cloud-account'] ="), cloud.indexOf("// ---------- The rail:"));
  vm.runInContext(`${menuFn}\n${extract(cloud, "setComputerAsks")}\nACT['computer-asks-toggle'] = () => (S.computer ? setComputerAsks(!S.computer.runsAsks) : undefined);`, c);

  c.ACT["cloud-account"]({});
  assert.equal(menus.length, 1);
  assert.equal(menus[0].some(item => item.label === "Run Asks sent from penecho.ai"), false);
  assert.deepEqual([...menus[0].filter(item => item.label).map(item => item.label)], ["Plan & credits", "Sign out"]);

  await c.ACT["computer-asks-toggle"]();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/computer");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body.runsAsks, true);
  assert.equal(c.S.computer.runsAsks, true);
  assert.equal(renders >= 1, true);
});

test("a project on a computer runs with that computer's saved agents, by the names its Agents page gives them", async () => {
  const presets = [{ id:"p-high", name:"Claude Code · opus · high effort", agent:"claude", model:"opus", effort:"high", default:true }, { id:"p-x", name:"Kimi · k3", agent:"kimi", model:"k3", effort:"", default:false }];
  const { c } = hostedPage({ projects:[{ key:"garden", name:"Garden" }], computers:[computer("mac-1111111", { presets })] });
  c.HOSTED.onComputer = true;
  await c.hostedComputers(true);
  assert.deepEqual(plain(c.S.presets), { presets:[
    { ...presets[0], computer:"mac-1111111", available:true, auto:false },
    { ...presets[1], computer:"mac-1111111", available:false, auto:false },
  ], default:"p-high" }, "Kimi is not ready on that computer");
  c.HOSTED.onComputer = false; c.S.presets = null;
  await c.hostedComputers(true);
  assert.equal(c.S.presets, null, "a project made on penecho.ai runs with PenEcho only");
});

test("a browser on another device asks the computer running PenEcho for its agents; penecho.ai does not", async () => {
  const setup = fs.readFileSync(path.join(__dirname, "../public/lines/setup.js"), "utf8");
  const run = async (S, HOSTED = null) => {
    const asked = [];
    const c = vm.createContext({ HOSTED, S:{ route:{}, ...S }, api:async url => { asked.push(url); return { agents:[{ id:"codex", state:"ready" }] }; },
      ACT:{}, render() {}, renderRail() {}, refreshEmptyAgents() {}, refreshRunLabels() {}, loadAgents:async () => {} });
    vm.runInContext(`${setup.slice(0, setup.indexOf("// The agents installed here are on the Agents page."))}\nthis.checkAgents = checkAgents;`, c);
    await c.checkAgents();
    return { asked, S:c.S };
  };
  const lan = await run({ thisComputer:false });
  assert.deepEqual(lan.asked, ["/agents/check"]);
  assert.equal(lan.S.agentCheck.agents[0].id, "codex");
  assert.deepEqual((await run({ thisComputer:true })).asked, ["/agents/check"]);
  assert.deepEqual((await run({ thisComputer:false }, { computers:[] })).asked, [], "penecho.ai lists its computers instead");
  assert.deepEqual((await run({})).asked, [], "not before PenEcho says where the page is open");
});

test("hostedOrchAgents uses orchRefreshBox when presets change on the Orchestrator view so focus is preserved", async () => {
  const calls = [];
  let computers = [computer("mac", { presets:[{ id:"p-old", name:"Claude Code", agent:"claude", default:true }] })];
  const c = vm.createContext({
    HOSTED:{ key:"garden", onComputer:true, lives:null, computers:[], computersAt:0, computersAsk:null, runOn:{} },
    S:{ route:{ view:"orchestrator" }, presets:null },
    Date, Number, Boolean, Map, Set, String, JSON, Promise,
    document:{ documentElement:{ classList:{ toggle() {} } } },
    hostedCall:async () => ({ ok:true, json:async () => ({ computers }) }),
    orchRefreshBox:() => calls.push("refresh"),
    orchPaint:(...args) => calls.push(["paint", ...args]),
    orchBoxHTML:() => "<form></form>",
  });
  vm.runInContext(["hostedComputers", "hostedSyncs", "hostedOwning", "hostedPresets", "hostedOrchAgents"].map(name => extract(hosted, name)).join("\n"), c);

  // Initial load changes presets from null -> p-old -> calls orchRefreshBox.
  c.hostedOrchAgents();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["refresh"]);
  assert.equal(c.S.presets.default, "p-old");

  // Re-opening after 8s with changed presets refreshes again via orchRefreshBox, not raw destructive paint.
  c.HOSTED.computersAt = Date.now() - 9000;
  computers = [computer("mac", { presets:[{ id:"p-new", name:"Claude Code · opus", agent:"claude", default:true }] })];
  c.hostedOrchAgents();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["refresh", "refresh"]);
  assert.equal(c.S.presets.default, "p-new");

  // Fallback when only orchPaint is present still triggers forced orchBox repaint.
  delete c.orchRefreshBox;
  c.HOSTED.computersAt = Date.now() - 9000;
  computers = [computer("mac", { presets:[{ id:"p-third", name:"Claude Code · sonnet", agent:"claude", default:true }] })];
  c.hostedOrchAgents();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), ["paint", "orchBox", "<form></form>", true]);
});
