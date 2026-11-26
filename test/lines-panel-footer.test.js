"use strict";
require("./helpers/safety.js");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");

const read = name => fs.readFileSync(path.join(__dirname, "../public/lines", name), "utf8");

function makeHarness({ projectOverrides = {}, lineOverrides = {}, stepOverrides = {} } = {}) {
  const { document, window } = parseHTML(`<!doctype html><html><body>
    <main id="view"><div id="linePage">
      <aside id="lpPanel"></aside>
    </div></main>
  </body></html>`);
  if (!window.Element.prototype.scrollTo) window.Element.prototype.scrollTo = () => {};
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  $("#view").clientWidth = 1440;

  const work = {
    id:"work-1",
    kind:"work",
    label:"Work 1",
    state:"done",
    agent:"claude",
    out:"Done.",
    detail:"works/demo-line/work-1.md",
    picked:{ model:"claude-opus-5-5", effort:"medium" },
    pictures:[],
    ...stepOverrides,
  };
  const line = {
    id:"demo-line",
    slug:"demo-line",
    title:"Demo line",
    topicPath:"lines/demo-line.md",
    topicAbsolutePath:"/Users/test/Docs/lines/demo-line.md",
    workdir:"/Users/test/workspace/repo",
    branch:"main",
    agent:"claude",
    conversations:{
      claude:{ agent:"claude", app:"Claude", canOpen:true },
    },
    stations:[work],
    pictures:[],
    ask:{ files:[], later:[] },
    questions:[],
    ...lineOverrides,
  };
  const proj = {
    id:"proj-1",
    name:"Demo",
    vault:{ path:"/Users/test/Docs", code:[{ path:"/Users/test/workspace/repo" }] },
    lines:[line],
    files:[],
    knowledge:[],
    ...projectOverrides,
  };

  const copied = [];
  const toasts = [];
  const requests = [];
  const c = vm.createContext({
    document,
    window,
    $,
    $$,
    innerWidth:1440,
    ACT:{},
    SEND:{},
    HOSTED:null,
    EMBED:null,
    S:{ cur:proj.id, route:{ view:"line", line:line.id, step:work.id }, thisComputer:true },
    project:() => proj,
    lineById:(p, id) => p.lines.find(l => l.id === id),
    stationById:(l, id) => l.stations.find(s => s.id === id),
    allLines:p => p.lines,
    addEventListener() {},
    syncHash() {},
    go() {},
    ic:(name, size = 16) => `<svg data-ic="${name}" width="${size}" height="${size}"></svg>`,
    esc:v => String(v ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch])),
    stepLabel:s => s.label || "Work",
    fileEntry:(p, filePath) => p.files.find(f => f.path === filePath),
    docById:() => null,
    loadDoc:async () => null,
    api:async (url, opts) => { requests.push({ url, opts }); return { rows:[], seq:0 }; },
    pathFor:id => `/projects/${id}`,
    agentInfo:id => ({ id, name:id, mono:id.slice(0, 2), color:"#000" }),
    av:id => `<span class="av">${id}</span>`,
    can:() => true,
    availableAgents:() => [],
    copyText:(text, msg) => copied.push({ text, msg }),
    toast:msg => toasts.push(msg),
    reducedMotion:() => true,
    lineState:() => "ready",
    STATE_COLOR:{},
    boxWords:() => "",
    isPinned:() => false,
    projectsToggleHTML:() => "",
    stateChip:() => "",
    branchChip:() => "",
    chatButtons:() => "",
    canMerge:() => false,
    endStoppedButton:() => "",
    lineWorking:() => false,
    currentStation:l => l.stations[l.stations.length - 1],
    syncComposer() {},
    openQuestions:() => [],
    clearTimeout,
    setTimeout,
  });
  for (const file of ["work-pricing.js", "line-status.js", "markdown.js", "line.js"]) {
    vm.runInContext(read(file), c, { filename:file });
  }
  return { document, $, $$, c, proj, line, work, copied, toasts, requests };
}

test("Work panel Focused Toolbar renders Refer, desktop link, Work file, and copy paths while footer keeps Details and metadata", () => {
  const h = makeHarness();
  h.c.panelInto(h.proj, h.line, h.work);

  const toolbar = h.$("#lpPanel #lppToolbar.lpp-toolbar");
  assert.ok(toolbar, "sticky Focused Toolbar #lppToolbar exists");
  assert.equal(toolbar.hidden, false);

  const referBtn = h.$('[data-act="line-refer"]', toolbar);
  assert.ok(referBtn, "Refer button renders in Focused Toolbar");
  assert.equal(referBtn.dataset.step, "work-1");

  const desktopBtn = h.$('[data-act="open-desktop"]', toolbar);
  assert.ok(desktopBtn, "Open in desktop action renders in Focused Toolbar");
  assert.equal(desktopBtn.getAttribute("aria-label"), "Open in Claude desktop");
  assert.match(desktopBtn.textContent, /Claude desktop/);

  const workFileBtn = h.$('[data-act="preview-work-file"]', toolbar);
  assert.ok(workFileBtn, "Work file preview button renders in Focused Toolbar");
  assert.equal(workFileBtn.dataset.doc, "works/demo-line/work-1.md");
  assert.equal(workFileBtn.textContent, "Work file");

  const copyRefsBtn = h.$('[data-act="copy-refs"]', toolbar);
  assert.ok(copyRefsBtn, "copy-refs button renders in Focused Toolbar using project.vault.path");
  const expectedRefs = "Work file: /Users/test/Docs/works/demo-line/work-1.md\nLine file: /Users/test/Docs/lines/demo-line.md";
  assert.equal(copyRefsBtn.dataset.refs, expectedRefs);
  h.c.ACT["copy-refs"](copyRefsBtn);
  assert.deepEqual(h.copied[0], { text:expectedRefs, msg:"Copied the Work and Line file paths" });

  const footer = h.$("#lpPanel .lpp-bottom");
  assert.ok(footer, "clean .lpp-bottom footer exists");

  const footBtn = h.$("#lppFoot", footer);
  assert.ok(footBtn, "Details toggle button #lppFoot exists inside footer");
  assert.equal(footBtn.getAttribute("aria-expanded"), "false");
  assert.ok(h.$("#lppCount", footBtn), "#lppCount slot exists inside #lppFoot");

  const folderBtn = h.$('[data-act="copy-path"]', footer);
  assert.ok(folderBtn, "folder copy button renders");
  assert.equal(folderBtn.dataset.path, "/Users/test/workspace/repo");
  h.c.ACT["copy-path"](folderBtn);
  assert.deepEqual(h.copied[1], { text:"/Users/test/workspace/repo", msg:"Copied the folder path" });

  const meta = h.$("#lppWhere .where-card", footer);
  assert.ok(meta, "quiet metadata strip renders");
  assert.match(meta.textContent, /workspace\/repo/);
  assert.match(meta.textContent, /main/);
  assert.match(meta.textContent, /claude-opus-5-5/);
  assert.match(meta.textContent, /medium effort/);

  // Details toggle still works and keeps 14px chevron icon.
  h.c.ACT["panel-details"](footBtn);
  assert.equal(h.$("#lppDetails").hidden, false);
  assert.equal(footBtn.getAttribute("aria-expanded"), "true");
  assert.equal(h.$("svg", footBtn).getAttribute("data-ic"), "down");
});

test("Work panel toolbar hides copy-refs on hosted projects (no local docs root) and supports terminal commands + live refresh", () => {
  const h = makeHarness({
    projectOverrides:{ vault:{ path:"", code:[] }, docsPath:"" },
    lineOverrides:{
      topicAbsolutePath:"",
      workdir:"",
      branch:"",
      conversations:{ claude:{ agent:"claude", terminal:"claude --resume abc123", terminalFull:"claude --resume abc123 --verbose" } },
    },
    stepOverrides:{ picked:{}, selected:{} },
  });
  h.c.panelInto(h.proj, h.line, h.work);

  assert.equal(h.$("#lpPanel [data-act='copy-refs']"), null, "no local path copy button without docs root");
  assert.ok(h.$("#lpPanel #lppToolbar [data-act='preview-work-file']"), "Work file button still renders in toolbar");

  const cmdBtn = h.$("#lpPanel #lppToolbar [data-act='copy-command']");
  assert.ok(cmdBtn, "terminal command button renders in toolbar");
  h.c.ACT["copy-command"](cmdBtn);
  assert.equal(h.copied[0].text, "claude --resume abc123 --verbose");
  assert.match(h.$("#lppWhere").textContent, /Model and effort not recorded/);

  // Live refresh updates both toolbar (#lppToolbar) and metadata (#lppWhere) without touching #lppFoot.
  const footBefore = h.$("#lppFoot");
  h.proj.vault.path = "/Users/test/Docs";
  h.line.branch = "feat/redesign";
  h.work.picked = { model:"gpt-6.2-sol", effort:"high" };
  h.c.refreshLine();

  assert.equal(h.$("#lppFoot"), footBefore, "#lppFoot element is preserved across refreshLine()");
  assert.ok(h.$("#lpPanel #lppToolbar [data-act='copy-refs']"), "copy-refs appears in toolbar after refreshLine()");
  assert.match(h.$("#lppWhere").textContent, /feat\/redesign/);
  assert.match(h.$("#lppWhere").textContent, /gpt-6\.2-sol/);
  assert.match(h.$("#lppWhere").textContent, /high effort/);
});

test("Focused Toolbar keeps Review button in toolbar AND below Work output, shows full review notes unfolded, and provides Difficulty dropdown + inline Canvas", () => {
  const menus = [];
  const h = makeHarness({
    stepOverrides:{
      orchScore:4.8,
      review:{
        schema:2, verdict:"ready", score:4.8,
        by:"Claude Code · opus · medium effort", agent:"claude", mode:"user",
        why:"Assigned by you in Orchestrator settings (Reviewer).",
        note:"First paragraph of the review note that must render in full without any folding or line clamp.",
        notes:"Additional detailed reviewer notes that should also appear unfolded by default.",
      },
    },
  });
  h.c.orchSettings = () => ({
    review:true,
    reviewer:"codex-1",
    reviewers:[
      { id:"codex-1", name:"Codex · gpt-6.2", agent:"codex", model:"gpt-6.2", effort:"high" },
    ],
  });
  h.c.openMenu = (anchor, items, opts) => menus.push({ anchor, items, opts });
  h.c.menuAnchorRect = () => ({ left:0, top:0, width:100, height:28 });
  h.c.panelInto(h.proj, h.line, h.work);

  // 1. Review button is in sticky toolbar AND in its current place below the Work result.
  const tbReview = h.$("#lppToolbar [data-act='work-review-pick']");
  assert.ok(tbReview, "Review dropdown renders in sticky Focused Toolbar");
  const resultHtml = h.c.resultHTML(h.proj, h.line, h.work, null);
  h.$("#lppResult").innerHTML = resultHtml;
  const bodyReview = h.$("#lppResult .lpp-actions .rev-split [data-act='work-review']");
  assert.ok(bodyReview, "Review split button ALSO stays in its current place below Work output");

  // 2. Review notes in Work detail panel show BOTH note and extra notes in full, unfolded.
  const orchCard = h.$("#lppResult .lpp-orch-rate");
  assert.ok(orchCard, "Orchestrator review card renders");
  assert.match(orchCard.querySelector(".lpp-orch-note").textContent, /First paragraph of the review note/);
  assert.match(orchCard.querySelector(".lpp-orch-extra-notes").textContent, /Additional detailed reviewer notes/);
  assert.match(orchCard.querySelector(".lpp-orch-open").textContent, /View review details/);

  // 3. Single-row feedback bar includes Difficulty dropdown trigger and opens menu.
  const diffTrigger = h.$("#lppResult .lpp-rate-box [data-act='work-scope-menu']");
  assert.ok(diffTrigger, "Difficulty dropdown trigger renders inside feedback row");
  assert.match(diffTrigger.textContent, /Difficulty:Standard/);
  h.c.ACT["work-scope-menu"](diffTrigger);
  assert.equal(menus.length, 1);
  assert.deepEqual(Array.from(menus[0].items.filter(x => x.label), x => x.label), ["Light", "Standard", "Heavy"]);

  // 4. Composer includes inline Canvas button on Line pages and threadHTML omits floating Add new canvas.
  const threadHtml = h.c.threadHTML(h.proj, { ...h.line, stations:[] });
  assert.doesNotMatch(threadHtml, /lp-thread-adds|lp-newcv/);
  const compSrc = read("composer.js");
  assert.match(compSrc, /cmp-canvas-btn[^>]*data-act="line-draw"/);

  // 5. CSS keeps unfolded notes and excludes solid CTAs / question cards / Edit on canvas from quiet resets.
  const lineCss = read("line.css");
  assert.match(lineCss, /\.lpp-orch-note\s*\{[^}]*-webkit-line-clamp:\s*unset/);
  assert.match(lineCss, /:not\(\.primary\):not\(\.unsent-go\):not\(\.run-main\):not\(\.run-pick\):not\(\.danger\):not\(\.q-choice\):not\(\.line-pic-edit\)/);
});
