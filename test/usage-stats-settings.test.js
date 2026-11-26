"use strict";
require("./helpers/safety.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");

const ROOT = path.join(__dirname, ".."), source = fs.readFileSync(path.join(ROOT, "public/lines/settings.js"), "utf8");
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const report = ({ days = [{ day:"2026-11-18", counts:{ "work-run":3, "run-claude":2 } }], agents = [] } = {}) => ({ installation:"a".repeat(32), version:"1.5.0", platform:"macos", app:"local", days, agents });

function boot({ delayGet = false } = {}) {
  const { document, window } = parseHTML("<!doctype html><html><body><main id='app'></main></body></html>");
  const storage = new Map(), calls = [], toasts = [];
  let status = { enabled:true, ratingsEnabled:true, report:report() };
  let failNextPost = false;
  let resolveGet = null;
  const location = { hash:"#settings/general", origin:"http://127.0.0.1:3888", assign() {} };
  const S = { thisComputer:true, shelfPage:"settings", agentCheck:{ problems:0, agents:[] }, projects:[] };
  const context = vm.createContext({
    window, document, location,
    history:{ replaceState(_s, _t, h) { location.hash = h; } },
    localStorage:{ getItem:k => storage.get(k) ?? null, setItem:(k, v) => storage.set(k, String(v)), removeItem:k => storage.delete(k) },
    sessionStorage:{ getItem:() => null, setItem() {}, removeItem() {} },
    queueMicrotask,
    requestAnimationFrame:fn => { const timer = setTimeout(() => fn(Date.now()), 0); timer.unref?.(); return timer; },
    Element:window.Element, HTMLElement:window.HTMLElement, Event:window.Event, CustomEvent:window.CustomEvent,
    S, ACT:{}, VIEWS:{}, COMMANDS:[], HOSTED:null,
    $:(selector, root = document) => root.querySelector(selector),
    esc:value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])),
    ic:name => `<svg data-ic="${name}"></svg>`, toast(msg) { toasts.push(msg); }, themeRow:() => "", agentInfo:id => ({ name:id }),
    checkAgents() {}, closeSwitcher() {}, copyText() {}, archivedProjectsHTML:() => "",
    render() { context.renderSettingsModal(); },
    fetch:async (url, init = {}) => {
      calls.push({ url, method:init.method || "GET", body:init.body ? JSON.parse(init.body) : null });
      if (url === "/api/usage-stats") {
        if (init.method === "POST") {
          const body = JSON.parse(init.body);
          const enabled = typeof body.enabled === "boolean" ? body.enabled : status.enabled;
          const ratingsEnabled = typeof body.ratingsEnabled === "boolean" ? body.ratingsEnabled : status.ratingsEnabled;
          status = { enabled, ratingsEnabled, report:(enabled || ratingsEnabled) ? report({ days:enabled ? undefined : [], agents:[] }) : null };
          if (failNextPost) { failNextPost = false; return { ok:false, status:500, json:async () => ({ error:"Disk full" }) }; }
        } else if (delayGet && !resolveGet) {
          await new Promise(resolve => { resolveGet = resolve; });
        }
        return { ok:true, status:200, json:async () => status };
      }
      return { ok:true, status:200, json:async () => ({}) };
    },
    console,
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "public/page-scale.js"), "utf8"), context, { filename:"public/page-scale.js" });
  vm.runInContext(source, context, { filename:"public/lines/settings.js" });
  return { context, document, window, S, calls, storage, toasts, finishGet:() => resolveGet?.(), failNextPost:() => { failNextPost = true; } };
}

test("Settings General places the Help us improve PenEcho section at the bottom with both toggles default on", async () => {
  const { context, document, window, S, calls, toasts, finishGet, failNextPost } = boot({ delayGet:true });
  assert.equal(calls.length, 0, "loading the Settings code makes no request");
  context.openSettingsTab("general");

  // While GET is in flight, both switches default visually checked and disabled instead of flashing off.
  assert.equal(document.getElementById("usageStatsToggle").getAttribute("aria-checked"), "true");
  assert.equal(document.getElementById("usageStatsToggle").hasAttribute("disabled"), true);
  assert.equal(document.getElementById("modelRatingsToggle").getAttribute("aria-checked"), "true");
  assert.equal(document.getElementById("modelRatingsToggle").hasAttribute("disabled"), true);

  finishGet();
  await settle();
  assert.deepEqual(calls.map(call => [call.url, call.method]), [["/api/usage-stats", "GET"]]);

  const sections = [...document.querySelectorAll("#sysPanel > section.sys-sec")];
  assert.deepEqual(sections.map(sec => sec.querySelector("h2").id), ["sysGeneral", "sysAbout", "sysHelpImprove"], "new section sits at the bottom of General below About");
  assert.equal(document.getElementById("sysGeneral").closest("section").querySelector("#usageStatsToggle"), null, "usage toggle was moved out of Preferences");
  assert.equal(document.getElementById("sysHelpImprove").textContent, "Help us improve PenEcho");

  const usageToggle = document.getElementById("usageStatsToggle");
  const ratingsToggle = document.getElementById("modelRatingsToggle");
  assert.equal(usageToggle.getAttribute("aria-checked"), "true");
  assert.equal(usageToggle.hasAttribute("disabled"), false);
  assert.equal(ratingsToggle.getAttribute("aria-checked"), "true");
  assert.equal(ratingsToggle.hasAttribute("disabled"), false);

  assert.equal(document.getElementById("usageStatsToggleLbl").textContent, "Share anonymous usage counts");
  assert.match(usageToggle.closest(".sys-row").querySelector(".sys-text small").textContent, /Never includes project or Line names, files, prompts, drawings, or paths\./);
  assert.equal(document.getElementById("modelRatingsToggleLbl").textContent, "Share anonymous model ratings");
  assert.match(ratingsToggle.closest(".sys-row").querySelector(".sys-text small").textContent, /never any project info.*improve Orchestrator performance for everyone/i);
  assert.equal(document.querySelector("#usageStatsPreview pre").textContent, JSON.stringify(report(), null, 2));

  context.generalSectionHTML(); context.generalSectionHTML();
  assert.equal(calls.length, 1, "ordinary Settings redraws do not poll");
  context.ACT["usage-stats-preview"]();
  await settle();
  assert.equal(calls.length, 2, "opening the disclosure refreshes once");
  assert.equal(document.getElementById("usageStatsPreview").hasAttribute("open"), true);

  context.ACT["set-lang"]({ dataset:{ lang:"zh" } });
  await settle();
  assert.equal(document.getElementById("sysHelpImprove").textContent, "帮助我们改进 PenEcho");
  assert.equal(document.getElementById("usageStatsToggleLbl").textContent, "分享匿名使用次数");
  assert.equal(document.getElementById("modelRatingsToggleLbl").textContent, "分享匿名模型评分");
  assert.match(document.querySelector(".sys-usage-details summary").textContent, /查看发送内容/);
  assert.match(document.querySelector("#usageStatsToggleLbl").closest(".sys-text").querySelector("small").textContent, /绝不包含项目或 Line 名称、文件、提示词、画作或路径/);
  assert.match(document.querySelector("#modelRatingsToggleLbl").closest(".sys-text").querySelector("small").textContent, /绝不包含任何项目信息.*Orchestrator/);
  assert.equal(document.getElementById("usageStatsPreview").hasAttribute("open"), true, "language redraw preserves the disclosure");
  assert.equal(calls.length, 2);

  // Turning off usage counts leaves model ratings on and keeps the preview visible.
  await context.ACT["usage-stats-toggle"]();
  await settle();
  assert.deepEqual(calls.at(-1), { url:"/api/usage-stats", method:"POST", body:{ enabled:false } });
  assert.equal(document.getElementById("usageStatsToggle").getAttribute("aria-checked"), "false");
  assert.equal(document.getElementById("modelRatingsToggle").getAttribute("aria-checked"), "true");
  assert.notEqual(document.getElementById("usageStatsPreview"), null);

  // Turning off model ratings too hides and closes the preview.
  await context.ACT["model-ratings-toggle"]();
  await settle();
  assert.deepEqual(calls.at(-1), { url:"/api/usage-stats", method:"POST", body:{ ratingsEnabled:false } });
  assert.equal(document.getElementById("usageStatsToggle").getAttribute("aria-checked"), "false");
  assert.equal(document.getElementById("modelRatingsToggle").getAttribute("aria-checked"), "false");
  assert.equal(document.getElementById("usageStatsPreview"), null);

  // Re-enabling model ratings alone brings the preview back (closed) while keeping usage counts off.
  await context.ACT["model-ratings-toggle"]();
  await settle();
  assert.deepEqual(calls.at(-1).body, { ratingsEnabled:true });
  assert.equal(document.getElementById("usageStatsToggle").getAttribute("aria-checked"), "false");
  assert.equal(document.getElementById("modelRatingsToggle").getAttribute("aria-checked"), "true");
  assert.notEqual(document.getElementById("usageStatsPreview"), null);
  assert.equal(document.getElementById("usageStatsPreview").hasAttribute("open"), false);

  // If a save fails after an in-memory opt-out on the server, Settings re-reads status so it never displays a stale ON switch.
  context.ACT["usage-stats-preview"]();
  await settle();
  assert.equal(document.getElementById("usageStatsPreview").hasAttribute("open"), true);
  failNextPost();
  await context.ACT["model-ratings-toggle"]();
  await settle();
  assert.equal(toasts.at(-1), "Disk full");
  assert.equal(document.getElementById("modelRatingsToggle").getAttribute("aria-checked"), "false", "refreshed server state overrides stale switch");
  assert.equal(document.getElementById("usageStatsPreview"), null);
  await context.ACT["model-ratings-toggle"]();
  await settle();
  assert.equal(document.getElementById("usageStatsPreview").hasAttribute("open"), false, "GET observing both off cleared the open disclosure flag");

  const beforeHidden = calls.length;
  context.HOSTED = {};
  assert.equal(vm.runInContext("helpImproveSectionHTML('en')", context), "");
  context.HOSTED = null; S.thisComputer = false;
  assert.equal(vm.runInContext("helpImproveSectionHTML('en')", context), "");
  S.thisComputer = true; window.PENECHO_CONFIG = { runtime:"viewer" };
  assert.equal(vm.runInContext("helpImproveSectionHTML('en')", context), "");
  window.PENECHO_CONFIG = { runtime:"cloud" };
  assert.equal(vm.runInContext("helpImproveSectionHTML('en')", context), "");
  assert.equal(calls.length, beforeHidden, "hidden runtimes never fetch usage status");
});

test("Settings General aligns Other devices and About rows with other preferences and opens the changelog for version", async () => {
  const { context, document } = boot();
  context.openSettingsTab("general");
  await settle();

  const prefRows = [...document.querySelectorAll("#sysGeneral")][0].closest("section").querySelectorAll(".sys-row");
  assert.equal(prefRows.length, 3, "Language, Page zoom, and Other devices");
  for (const row of prefRows) {
    assert.ok(row.classList.contains("sys-pref-row"), `preference row ${row.querySelector("strong")?.textContent} uses two-column preference layout`);
  }
  const otherDevicesLink = prefRows[2].querySelector("a.btn.sm");
  assert.equal(otherDevicesLink.textContent, "Open");
  assert.equal(otherDevicesLink.getAttribute("href"), "/lines/devices.html");

  const aboutRow = document.getElementById("sysAbout").closest("section").querySelector(".sys-row");
  assert.ok(aboutRow.classList.contains("sys-pref-row"), "About row uses two-column preference layout");
  assert.equal(aboutRow.querySelector("strong").textContent, `PenEcho ${require("../package.json").version}`);
  const changelogLink = aboutRow.querySelector("a.btn.sm");
  assert.equal(changelogLink.textContent, "Changelog");
  assert.equal(changelogLink.getAttribute("href"), "https://github.com/penecho/penecho/blob/main/CHANGELOG.md");
  assert.equal(changelogLink.getAttribute("target"), "_blank");
  assert.equal(changelogLink.getAttribute("rel"), "noopener noreferrer");
  assert.equal(aboutRow.querySelector('a[href="/?view=canvas"]'), null, "version row no longer links to Canvas");

  const desktopUpdateSource = fs.readFileSync(path.join(ROOT, "public/lines/desktop-update.js"), "utf8");
  const updateCtx = vm.createContext({
    window:{
      penechoDesktopUpdate:{
        onStateChange(fn) { this._fn = fn; },
        getState:async () => ({ status:"up-to-date", currentVersion:"1.5.0", version:"1.5.0", updateAvailable:false }),
      },
    },
    EMBED:false, ACT:{}, S:{ projects:[] },
    $:() => null, esc:v => String(v ?? ""), ic:() => "", clamp:v => v,
    CHANGELOG_URL:"https://github.com/penecho/penecho/blob/main/CHANGELOG.md",
  });
  vm.runInContext(desktopUpdateSource, updateCtx, { filename:"public/lines/desktop-update.js" });
  updateCtx.window.penechoDesktopUpdate._fn({ status:"up-to-date", currentVersion:"1.5.0", version:"1.5.0", updateAvailable:false });
  const desktopAboutDoc = parseHTML(updateCtx.desktopAboutHTML()).document;
  const desktopLink = desktopAboutDoc.querySelector(".sys-update-row a.btn.sm");
  assert.equal(desktopLink.textContent, "Changelog");
  assert.equal(desktopLink.getAttribute("href"), "https://github.com/penecho/penecho/blob/main/CHANGELOG.md");
  assert.equal(desktopLink.getAttribute("target"), "_blank");
  assert.equal(desktopLink.getAttribute("rel"), "noopener noreferrer");

  const linesCss = fs.readFileSync(path.join(ROOT, "public/lines/lines.css"), "utf8");
  const btnRule = linesCss.match(/^\.btn\s*\{([^}]+)\}/m)?.[1] || "";
  assert.match(btnRule, /\bcolor:\s*var\(--ink\)/, ".btn resets anchor link color");
  assert.match(btnRule, /\btext-decoration:\s*none\b/, ".btn removes anchor underline");
});

test("General shows the current page zoom and applies the selected percentage", async () => {
  const { context, document, storage } = boot();
  context.openSettingsTab("general");
  await settle();

  const options = () => [...document.querySelectorAll("#pageZoomOptions button")];
  assert.deepEqual(options().map(button => button.textContent), ["90%", "100%", "110%", "120%"]);
  assert.equal(options().find(button => button.getAttribute("aria-checked") === "true").textContent, "100%");
  context.ACT["set-scale"](document.getElementById("pageZoom120"));
  assert.equal(storage.get("penecho-canvas-page-scale"), "1.2");
  assert.equal(document.getElementById("pageZoom120").getAttribute("aria-checked"), "true");
  assert.equal(document.documentElement.dataset.penechoPageScale, "120");
  context.ACT["set-scale"](document.getElementById("pageZoom100"));
  assert.equal(document.getElementById("pageZoom100").getAttribute("aria-checked"), "true");
  assert.equal(document.documentElement.classList.contains("penecho-web-page-scale"), false);
});
