"use strict";
require("./helpers/safety.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");

const ROOT = path.join(__dirname, "..");
const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

function bootLinesSettings({ initialLang = "" } = {}) {
  const html = `<!doctype html><html lang="en"><body>
    <main id="app"><aside id="rail"><div id="railMine"></div><nav id="railList"></nav><div id="railUpdate"></div><div id="railAccount"></div></aside><div class="shell"><div id="projbar"></div><main id="view"></main></div></main>
    <div id="switcher" hidden aria-label="Switch project"><div id="swList" aria-label="Projects"></div><div class="sw-foot"><button type="button" data-act="new-project"><svg></svg>New project</button></div></div>
    <div id="dropOverlay" hidden>Drop to attach</div>
    <input type="file" id="filePick" hidden aria-label="Add images or files">
    <div id="toast" hidden></div>
  </body></html>`;
  const { document, window } = parseHTML(html);
  const storage = new Map();
  if (initialLang) storage.set("penecho-language", initialLang);
  const langEvents = [];
  let canvasSyncCount = 0;
  let railRenderCount = 0;
  let projbarRenderCount = 0;
  window.addEventListener("penecho:languagechange", e => langEvents.push(e.detail?.language));
  window.PenEchoCanvasShell = { syncSettings() { canvasSyncCount++; return true; } };
  window.linesTheme = { get:() => "light", set() {} };

  const location = { hash:"#settings/general", origin:"http://127.0.0.1:3889", assign() {} };
  const S = {
    thisComputer:true,
    shelfPage:"settings",
    agentCheck:{ problems:1, agents:[{ id:"claude", name:"Claude Code", state:"ready", where:"/usr/local/bin/claude", problems:[] }] },
    presets:{ presets:[{ id:"p1", agent:"claude", name:"Claude · sonnet", model:"sonnet", effort:"high", available:true }], default:"p1" },
    projects:[{ id:"proj-1", name:"Settings", archived:true, docsPath:"/tmp/docs" }],
    computer:{ runsAsks:true },
    cloudAccount:{ signedIn:true, name:"Alice" },
  };
  const context = vm.createContext({
    window, document, location,
    innerWidth:1280, innerHeight:900, setTimeout, clearTimeout,
    history:{ replaceState(_s, _t, h) { location.hash = h; } },
    localStorage:{ getItem:k => storage.get(k) ?? null, setItem:(k, v) => storage.set(k, String(v)), removeItem:k => storage.delete(k) },
    sessionStorage:{ getItem:() => null, setItem() {}, removeItem() {} },
    queueMicrotask,
    requestAnimationFrame:fn => { const t = setTimeout(() => fn(Date.now()), 0); t.unref?.(); return t; },
    matchMedia:() => ({ matches:false, addEventListener() {}, removeEventListener() {} }),
    Element:window.Element, HTMLElement:window.HTMLElement, Event:window.Event, CustomEvent:window.CustomEvent,
    S, VIEWS:{}, COMMANDS:[], HOSTED:null,
    $:(selector, root = document) => root.querySelector(selector),
    $$:(selector, root = document) => [...root.querySelectorAll(selector)],
    esc:value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])),
    ic:name => `<svg data-ic="${name}"></svg>`,
    av:id => `<span class="av">${id}</span>`,
    themeRow:() => `<section class="set-row set-theme" aria-label="Appearance"><div class="set-text"><strong>Appearance</strong></div><div class="seg" role="radiogroup" aria-label="Appearance"><button type="button" role="radio" aria-checked="true"><span>Light</span></button><button type="button" role="radio" aria-checked="false"><span>Dark</span></button><button type="button" role="radio" aria-checked="false"><span>System</span></button></div></section>`,
    agentInfo:id => ({ id, name:id }),
    runnableAgents:() => [{ id:"claude", name:"Claude Code" }],
    checkAgents() {},
    closeSwitcher() {},
    copyText() {},
    archivedProjectsHTML:() => `<div class="shelf-page sys-archived"><div class="shelf-list"><div class="shelf-row"><button type="button" class="shelf-open"><span class="shelf-text"><strong>Settings</strong><code>~/docs</code></span></button><button type="button" class="btn sm">Restore</button></div></div></div>`,
    setupRowHTML:() => `<div class="setup-row"><span class="setup-state ok">Ready</span></div>`,
    renderRail() { railRenderCount++; },
    renderProjbar() { projbarRenderCount++; },
    render() { context.renderSettingsModal(); },
    fetch:async url => {
      if (url === "/api/usage-stats") {
        return { ok:true, status:200, json:async () => ({ enabled:true, ratingsEnabled:true, report:{ days:[] } }) };
      }
      return { ok:true, status:200, json:async () => ({ connections:[] }) };
    },
    console,
  });
  vm.runInContext(read("public/page-scale.js"), context, { filename:"public/page-scale.js" });
  vm.runInContext(read("public/lines/i18n.js"), context, { filename:"public/lines/i18n.js" });
  vm.runInContext(read("public/lines/core.js"), context, { filename:"public/lines/core.js" });
  vm.runInContext(read("public/lines/settings.js"), context, { filename:"public/lines/settings.js" });
  const ACT = vm.runInContext("ACT", context);
  return {
    context, ACT, document, window, storage, langEvents,
    get canvasSyncCount() { return canvasSyncCount; },
    get railRenderCount() { return railRenderCount; },
    get projbarRenderCount() { return projbarRenderCount; },
  };
}

test("switching language to Chinese translates Settings, dispatches languagechange, syncs Canvas, and switches back cleanly", async () => {
  const env = bootLinesSettings();
  const { context, ACT, document, storage, langEvents } = env;

  context.openSettingsTab("general");
  await settle();

  assert.equal(document.documentElement.lang, "en");
  assert.equal(document.getElementById("sysmTitle").textContent, "Settings");
  assert.equal(document.getElementById("sysGeneral").textContent, "Preferences");
  assert.equal(document.getElementById("sysCloudAsksHead").textContent, "PenEcho Cloud sync");
  assert.equal(document.getElementById("sysAbout").textContent, "About");
  assert.equal(document.getElementById("sysHelpImprove").textContent, "Help us improve PenEcho");
  assert.equal(document.getElementById("sysTab-general").querySelector("span").textContent, "General");

  // Switch to Chinese.
  ACT["set-lang"]({ dataset:{ lang:"zh" } });
  await settle();

  assert.equal(storage.get("penecho-language"), "zh");
  assert.equal(document.documentElement.lang, "zh-CN");
  assert.deepEqual(langEvents, ["zh"], "dispatches penecho:languagechange for Electron menu/preload and listeners");
  assert.equal(env.canvasSyncCount, 1, "notifies warm/active Canvas shell immediately");
  assert.ok(env.railRenderCount >= 1 && env.projbarRenderCount >= 1, "refreshes sidebar and project bar");

  // Settings modal chrome and General tab are translated to Chinese.
  assert.equal(document.getElementById("sysmTitle").textContent, "设置");
  assert.equal(document.querySelector(".sysm-head h3").textContent, "通用");
  assert.equal(document.querySelector(".sysm-head .sys-domain-tag").textContent, "应用");
  assert.equal(document.getElementById("sysGeneral").textContent, "偏好设置");
  assert.equal(document.getElementById("sysCloudAsksHead").textContent, "PenEcho Cloud 同步");
  assert.equal(document.getElementById("sysAbout").textContent, "关于");
  assert.equal(document.getElementById("sysHelpImprove").textContent, "帮助我们改进 PenEcho");
  assert.equal(document.getElementById("pageZoomLabel").textContent, "页面缩放");
  assert.equal(document.getElementById("sysTab-setup").querySelector("span").textContent, "本地提供方");
  assert.equal(document.getElementById("sysTab-agents").querySelector("span").textContent, "预设 Agent");
  assert.equal(document.getElementById("sysTab-providers").querySelector("span").textContent, "API 提供方");
  assert.equal(document.getElementById("sysTab-canvas-ai").querySelector("span").textContent, "画布 AI");
  assert.equal(document.getElementById("sysTab-canvas").querySelector("span").textContent, "视图");
  assert.equal(document.getElementById("sysTab-general").querySelector("span").textContent, "通用");
  assert.equal(document.getElementById("sysTab-archived").querySelector("span").textContent, "已归档");
  assert.equal(document.title, "通用 · 设置 · PenEcho Lines");

  // Static shell elements in projects.html are translated.
  assert.equal(document.getElementById("switcher").getAttribute("aria-label"), "切换项目");
  assert.equal(document.getElementById("dropOverlay").textContent, "松手以添加附件");
  assert.equal(document.getElementById("filePick").getAttribute("aria-label"), "添加图片或文件");

  // Other Settings tabs translate cleanly (including mixed-HTML paragraphs).
  context.openSettingsTab("setup");
  await settle();
  assert.equal(document.getElementById("sysInstalled").textContent, "已安装的 CLI 与内置运行器");
  assert.match(document.querySelector("#installed .sys-sub").innerHTML, /<strong>预设 Agent<\/strong>/);

  // Archived tab preserves user project name "Settings" while translating "Restore" button.
  context.openSettingsTab("archived");
  await settle();
  assert.equal(document.querySelector(".shelf-open .shelf-text strong").textContent, "Settings", "user project name is never translated");
  assert.equal(document.querySelector(".shelf-row .btn").textContent, "恢复");

  // Toast translates UI messages in Chinese.
  context.toast("Canvas setting updated.", { label:"Undo", fn() {} });
  assert.equal(document.querySelector("#toast span").textContent, "画布设置已更新。");
  assert.equal(document.querySelector("#toastAct").textContent, "撤销");

  // Switch back to English cleanly.
  context.openSettingsTab("general");
  ACT["set-lang"]({ dataset:{ lang:"en" } });
  await settle();

  assert.equal(storage.get("penecho-language"), "en");
  assert.equal(document.documentElement.lang, "en");
  assert.deepEqual(langEvents, ["zh", "en"]);
  assert.equal(document.getElementById("sysmTitle").textContent, "Settings");
  assert.equal(document.getElementById("sysGeneral").textContent, "Preferences");
  assert.equal(document.getElementById("sysCloudAsksHead").textContent, "PenEcho Cloud sync");
  assert.equal(document.getElementById("sysAbout").textContent, "About");
  assert.equal(document.getElementById("sysHelpImprove").textContent, "Help us improve PenEcho");
  assert.equal(document.getElementById("dropOverlay").textContent, "Drop to attach");
});

test("linesTranslateTree never translates user-authored markdown, code, project names, or line titles", () => {
  const { context, document } = bootLinesSettings({ initialLang:"zh" });
  const view = document.getElementById("view");
  view.innerHTML = `
    <span class="brand"><span>PenEcho <span class="brand-lines">Lines</span></span></span>
    <div class="rail-project"><span class="rail-name">Settings</span></div>
    <div class="rail-mine"><span class="rail-name">My Canvases</span></div>
    <button class="rail-line"><span class="rail-title">General</span></button>
    <span class="rail-line on is-new"><span class="rail-title">New line</span></span>
    <div class="md-words"><p>Preferences</p><code>Cancel</code></div>
    <button class="btn">Cancel</button>
  `;
  context.linesTranslateTree(view);

  assert.equal(view.querySelector(".brand-lines").textContent, "Lines", "brand name PenEcho Lines is never translated");
  assert.equal(view.querySelector(".rail-project .rail-name").textContent, "Settings");
  assert.equal(view.querySelector(".rail-mine .rail-name").textContent, "我的画布");
  assert.equal(view.querySelector(".rail-line:not(.is-new) .rail-title").textContent, "General");
  assert.equal(view.querySelector(".rail-line.is-new .rail-title").textContent, "新建 Line");
  assert.equal(view.querySelector(".md-words p").textContent, "Preferences");
  assert.equal(view.querySelector(".md-words code").textContent, "Cancel");
  assert.equal(view.querySelector("button.btn").textContent, "取消");
});

test("linesTranslateTree translates Orchestrator and filter controls while keeping Line/Lines untranslated", () => {
  const { context, document } = bootLinesSettings({ initialLang:"zh" });
  const view = document.getElementById("view");
  view.innerHTML = `
    <nav class="subnav">
      <button type="button"><span>Home</span></button>
      <button type="button"><span>Orchestrator</span></button>
      <button type="button"><span>Canvases &amp; files</span></button>
      <button type="button"><span>Statistics</span></button>
    </nav>
    <div class="pano-sum">
      <button type="button">All</button>
      <button type="button"><i></i>2 working</button>
      <button type="button"><i></i>4 finished</button>
      <button type="button"><i></i>3 unread</button>
    </div>
    <div class="pano-results"><span role="status">Finished · 4 of 12 lines shown · 2 finished folded</span></div>
    <div class="fl-tools">
      <button type="button">Everyone</button>
      <button type="button">Made by AI</button>
      <button type="button">From you</button>
      <button type="button">Favourites</button>
      <button type="button">Line status</button>
      <button type="button">Newest first</button>
    </div>
    <div class="orch-page">
      <h1>Orchestrator</h1>
      <button type="button">Agent record &amp; prices</button>
      <textarea placeholder="What should get done or discussed?"></textarea>
      <span class="orch-range">1–10 of 24 sessions</span>
    </div>
    <div class="del-tabs">
      <button type="button" role="tab">Lines <span>5</span></button>
      <button type="button" role="tab">Items <span>2</span></button>
    </div>
    <button type="button" data-grid="lines"><span>Lines</span></button>
    <span class="fl-state">Reviewed</span>
    <select name="access"><option value="reviewed">Reviewed</option><option value="full">Full access</option></select>
  `;
  context.linesTranslateTree(view);

  assert.deepEqual([...view.querySelectorAll(".subnav span")].map(el => el.textContent), ["首页", "调度器", "画布与文件", "统计"]);
  assert.deepEqual([...view.querySelectorAll(".pano-sum button")].map(el => el.textContent), ["全部", "2 进行中", "4 已完成", "3 未读"]);
  assert.equal(view.querySelector(".pano-results span").textContent, "已完成 · 显示 4 / 12 条 Line · 已折叠 2 条已完成");
  assert.deepEqual([...view.querySelectorAll(".fl-tools button")].map(el => el.textContent), ["全部", "AI 生成", "来自你", "收藏", "Line 状态", "最新优先"]);
  assert.equal(view.querySelector(".orch-page h1").textContent, "调度器");
  assert.equal(view.querySelector(".orch-page button").textContent, "Agent 战绩与价格");
  assert.equal(view.querySelector(".orch-page textarea").getAttribute("placeholder"), "要完成什么任务或讨论什么？");
  assert.equal(view.querySelector(".orch-range").textContent, "第 1–10 个，共 24 个会话");
  assert.equal(view.querySelector(".del-tabs [role='tab']").textContent, "Lines 5", "Lines tab stays untranslated");
  assert.equal(view.querySelector('[data-grid="lines"] span').textContent, "线条", "Canvas grid Lines translates to 线条");
  assert.equal(view.querySelector(".fl-state").textContent, "已审阅", "Line/Work status Reviewed translates to 已审阅");
  assert.equal(view.querySelector('select[name="access"] option[value="reviewed"]').textContent, "需审批", "Access mode Reviewed translates to 需审批");
});

test("Canvas core storage listener reacts to penecho-language changes", () => {
  const core = read("src/client/app/core.js");
  assert.match(core, /else if \(event\.key === "penecho-language"\)[\s\S]*?applyLanguage\(\)/);
});
