require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { Store } = require("../src/server/project-lines/store.js");
const { Service } = require("../src/server/project-lines/service.js");

function makeService(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-task-cb-"));
  const docs = path.join(dir, "docs");
  fs.mkdirSync(docs, { recursive: true });
  const store = new Store({ directory: dir, docsBase: docs });
  const project = store.create({ name: "Demo", docsPath: docs });
  const service = new Service(store, { agents: { available: () => [], detect: () => [], run: () => { throw new Error("unexpected run"); } } });
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { store, project, service, docs };
}

test("toggle-task persists Markdown checkboxes in Ask (with subheading checklists), Note, and Canvas across reloads", async t => {
  const { project, service } = makeService(t);
  const slug = "checkbox-line";
  const initial = `---
id: PE-901
status: waiting
who: @antigravity
created: 2026-11-20 08:00
---

# Checkbox persistence test

## Ask · 2026-11-20 08:00

Please check these options.

![pic.png](../files/${slug}/pic.png)

<!-- penecho-task: new -->

### Questions for you

1. **Parent row density**
- [ ] **Option A**
- [ ] **Option B**

\`\`\`markdown
- [ ] fenced example should be ignored
\`\`\`

<!--
- [ ] commented example should be ignored
-->

2. **Default expand/collapse**
- [ ] **Status-aware**
- [ ] **Always expand**

## Note · 2026-11-20 08:05

- [ ] Note task one
- [x] Note task two

## Canvas · 2026-11-20 08:10

![diagram.png](../files/${slug}/diagram.png)

- [ ] Canvas follow-up

## [x] Work 1 · @antigravity · 2 min

Done.
`;
  service.writeDoc(project, slug, initial);

  await service.act(project, slug, "toggle-task", { step: "ask-1", index: 0, checked: true, expected: "**Option A**" });
  await service.act(project, slug, "toggle-task", { step: "ask-1", index: 2, checked: true, expected: "**Status-aware**" });
  await service.act(project, slug, "toggle-task", { step: "note-1", index: 0, checked: true, expected: "Note task one" });
  await service.act(project, slug, "toggle-task", { step: "note-1", index: 1, checked: false, expected: "Note task two" });
  await service.act(project, slug, "toggle-task", { step: "canvas-1", index: 0, checked: true, expected: "Canvas follow-up" });

  const reloadedMd = service.readDoc(project, slug);
  assert.match(reloadedMd, /- \[x\] \*\*Option A\*\*/);
  assert.match(reloadedMd, /- \[ \] \*\*Option B\*\*/);
  assert.match(reloadedMd, /- \[ \] fenced example should be ignored/);
  assert.match(reloadedMd, /- \[ \] commented example should be ignored/);
  assert.match(reloadedMd, /- \[x\] \*\*Status-aware\*\*/);
  assert.match(reloadedMd, /- \[ \] \*\*Always expand\*\*/);
  assert.match(reloadedMd, /- \[x\] Note task one/);
  assert.match(reloadedMd, /- \[ \] Note task two/);
  assert.match(reloadedMd, /- \[x\] Canvas follow-up/);

  const state = service.stateOf(project);
  const line = state.lines.find(l => l.slug === slug);
  assert.ok(line);
  const askStation = line.stations.find(s => s.id === "ask-1");
  assert.match(askStation.text, /- \[x\] \*\*Option A\*\*/);
  assert.match(askStation.text, /- \[x\] \*\*Status-aware\*\*/);

  await service.act(project, slug, "toggle-task", { step: "ask-1", index: 0, checked: false, expected: "**Option A**" });
  assert.match(service.readDoc(project, slug), /- \[ \] \*\*Option A\*\*/);

  // Rejects stale/mismatched expected text rather than toggling the wrong task
  await assert.rejects(() => service.act(project, slug, "toggle-task", { step: "ask-1", index: 0, checked: true, expected: "**Something else**" }), /changed/i);

  // Rejects invalid inputs and non-yours steps
  await assert.rejects(() => service.act(project, slug, "toggle-task", { step: "work-1", index: 0, checked: true }), /not on this line/i);
  await assert.rejects(() => service.act(project, slug, "toggle-task", { step: "ask-1", index: 99, checked: true }), /not on this item/i);
  await assert.rejects(() => service.act(project, slug, "toggle-task", { step: "ask-1", index: -1, checked: true }), /non-negative/i);
  await assert.rejects(() => service.act(project, slug, "toggle-task", { step: "ask-1", index: 0, checked: "yes" }), /checked/i);

  // Rejects closed/archived lines
  await service.act(project, slug, "close", {});
  await assert.rejects(() => service.act(project, slug, "toggle-task", { step: "ask-1", index: 0, checked: true }), /archived/i);
});

test("toggle-task ignores hidden ask-context tags and indented list math, and patches only one byte without reordering steps", async t => {
  const { project, service } = makeService(t);
  const slug = "in-place-patch";
  const initial = `---
id: PE-902
status: waiting
who: @antigravity
created: 2026-11-20 08:00
---

# In-place patch test

## Ask · 2026-11-20 08:00 · Not sent

<agent-context>
- [ ] hidden task inside stripped tag
</agent-context>

- [ ] first visible task
  $$
  x + y
- [ ] second visible task

## Note · 2026-11-20 08:05

- [ ] Note checklist item
`;
  service.writeDoc(project, slug, initial);

  // Clicking visible task #0 must check "first visible task", NOT the hidden task inside <agent-context>
  await service.act(project, slug, "toggle-task", { step: "ask-1", index: 0, checked: true, expected: "first visible task" });
  // Clicking visible task #1 after indented math inside the list must check "second visible task"
  await service.act(project, slug, "toggle-task", { step: "ask-1", index: 1, checked: true, expected: "second visible task" });
  const afterAsk = service.readDoc(project, slug);
  assert.match(afterAsk, /- \[ \] hidden task inside stripped tag/);
  assert.match(afterAsk, /- \[x\] first visible task/);
  assert.match(afterAsk, /- \[x\] second visible task/);

  // Toggling Note checkbox must NOT reorder the earlier "Not sent" Ask below the Note; only the single marker byte may differ
  await service.act(project, slug, "toggle-task", { step: "note-1", index: 0, checked: true, expected: "Note checklist item" });
  const afterNote = service.readDoc(project, slug);
  assert.equal(afterNote, afterAsk.replace("- [ ] Note checklist item", "- [x] Note checklist item"));
  assert.ok(afterNote.indexOf("## Ask · 2026-11-20 08:00 · Not sent") < afterNote.indexOf("## Note · 2026-11-20 08:05"));
});

test("summaryFrom flags ambiguousOrchestratorRefs even when a duplicate landed parent falls outside the 6-item landed cap", t => {
  const { project, service } = makeService(t);
  const landed = [];
  for (let i = 1; i <= 8; i++) {
    landed.push({
      id: `landed-${i}`,
      code: i === 1 ? "PE-584" : `PE-${600 + i}`,
      title: `Landed ${i}`,
      landed: true,
      status: "done",
      stations: [],
      questions: [],
      createdAt: 1000 + i,
      lastActivityAt: 1000 + i,
      ...(i === 1 ? { orchestratorRef: "PE-584" } : {}),
    });
  }
  const state = {
    lines: [
      { id: "active-parent", code: "PE-584", title: "Active dup", landed: false, status: "waiting", stations: [], questions: [], createdAt: 2000, orchestratorRef: "PE-584" },
      { id: "active-child", code: "PE-700", title: "Child", landed: false, status: "waiting", stations: [], questions: [], createdAt: 2001, orchestratedBy: "PE-584" },
    ],
    landed,
    backlog: [],
    pictures: [],
    notes: [],
    files: [],
  };
  const summary = service.summaryFrom(project, state);
  assert.equal(summary.landed.length, 6);
  assert.deepEqual(summary.ambiguousOrchestratorRefs, ["PE-584"]);
});

function loadLineMarkdownEnv() {
  const root = path.resolve(__dirname, "..");
  const code = name => fs.readFileSync(path.join(root, "public/lines", name), "utf8");
  const toasts = [];
  const apiCalls = [];
  let loadStateCount = 0;
  let refreshCount = 0;
  const savedDocs = [];
  let currentProject = null;
  const p = {
    id: "p1",
    name: "PenEcho",
    files: [{ path: "lines/demo.md", mtime: 100 }],
    pictures: [],
    lines: [],
    landed: [],
    backlog: [],
    notes: [],
  };
  const p2 = { id: "p2", name: "Other", files: [], pictures: [], lines: [], landed: [], backlog: [], notes: [] };
  currentProject = p;
  const line = {
    id: "demo",
    slug: "demo",
    title: "Demo",
    topicPath: "lines/demo.md",
    closed: false,
    questions: [],
    stations: [
      {
        id: "ask-1",
        index: 0,
        kind: "ask",
        state: "done",
        text: "Choose:\n\n1. **Density**\n- [ ] Option A\n- [ ] Option B\n\n2. **Cloud**\n- [ ] Stay flat\n",
        refers: [],
        files: [],
        pictures: [],
      },
      {
        id: "note-1",
        index: 1,
        kind: "note",
        state: "done",
        text: "- [ ] Follow up\n",
        refers: [],
        files: [],
        pictures: [],
      },
    ],
  };
  p.lines.push(line);
  const ctx = {
    console,
    Math,
    Date,
    Set,
    Map,
    Promise,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: fn => fn(),
    encodeURIComponent,
    decodeURIComponent,
    addEventListener: () => {},
    window: {},
    document: { body: null, activeElement: null, getElementById: () => null },
    navigator: { platform: "MacIntel" },
    innerWidth: 1400,
    LINE_STATUS: require("../public/lines/line-status.js"),
    HOSTED: null,
    EMBED: null,
    ACT: {},
    SEND: {},
    VIEWS: {},
    S: {
      cur: "p1",
      route: { view: "line", line: "demo" },
      docs: {},
      openAsks: new Set(),
      thisComputer: true,
    },
    $: () => null,
    $$: () => [],
    esc: s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c])),
    ic: () => "",
    av: () => "",
    slug: s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    project: id => (id === "p2" ? p2 : id === "p1" ? p : currentProject),
    allLines: proj => [...(proj?.lines || []), ...(proj?.backlog || []), ...(proj?.landed || [])],
    lineById: (proj, id) => (proj?.lines || []).find(x => x.id === id) || null,
    stationById: (l, id) => (l?.stations || []).find(x => x.id === id) || null,
    openQuestions: l => (l?.questions || []).filter(q => !q.ticked),
    lineOfDoc: (proj, doc) => (proj?.lines || []).find(x => x.topicPath === doc?.path) || null,
    docByPath: () => null,
    fileEntry: () => null,
    canvasByPath: () => null,
    assetUrl: () => "",
    fileUrl: () => "",
    apiUrl: u => u,
    pathFor: id => `/api/lines/projects/${id}`,
    docKey: (pid, docPath) => `${pid}:${docPath}`,
    resolvePath: (_a, b) => b,
    linkedPath: (_a, b) => b,
    agentInfo: id => ({ id, name: id }),
    availableAgents: () => [],
    toast: msg => toasts.push(msg),
    render: () => {},
    refreshAfterChange: () => { refreshCount++; },
    loadState: async () => { loadStateCount++; },
    saveDoc: async (proj, doc, md) => {
      if (ctx._saveHandler) return ctx._saveHandler(proj, doc, md);
      doc.md = md;
      savedDocs.push({ projectId: proj.id, path: doc.path, md });
      return { hash: `h${savedDocs.length + 1}`, mtime: 200 };
    },
    api: async (url, opts) => {
      apiCalls.push({ url, opts });
      if (ctx._apiHandler) return ctx._apiHandler(url, opts);
      return { ok: true };
    },
    act: async (l, verb, body, proj) => {
      apiCalls.push({ act: verb, slug: l.slug, body, projectId: proj?.id || currentProject.id });
      return { ok: true };
    },
    isYours: s => ["ask", "note", "canvas", "meeting"].includes(s?.kind),
    isWork: s => !["ask", "note", "canvas", "meeting"].includes(s?.kind),
    isEnd: () => false,
    lineState: () => "wait",
    stepLabel: s => s.id,
    STATE_COLOR: {},
    KIND: { ask: { label: "Ask" }, note: { label: "Note" } },
    askFiles: () => "",
    copiedNow: () => false,
    filesApart: () => false,
    copiedLabel: () => "",
    unsentFoot: () => "",
    refreshLine: () => { refreshCount++; },
  };
  vm.createContext(ctx);
  vm.runInContext(code("markdown.js"), ctx, { filename: "markdown.js" });
  vm.runInContext(code("line.js"), ctx, { filename: "line.js" });
  ctx.Reader = vm.runInContext("Reader", ctx);
  return {
    ctx,
    p,
    p2,
    line,
    toasts,
    apiCalls,
    savedDocs,
    setCurrentProject: next => { currentProject = next; },
    getLoadStateCount: () => loadStateCount,
    getRefreshCount: () => refreshCount,
  };
}

test("parseMd handles CRLF checklists without hanging and preserves CRLF in toggleTaskLineInDoc", () => {
  const { ctx, p } = loadLineMarkdownEnv();
  const crlf = "- [ ] First item\r\n- [x] Second item\r\n";
  const blocks = ctx.parseMd(crlf);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].t, "list");
  assert.equal(blocks[0].items.length, 2);
  assert.equal(blocks[0].items[0].rawText, "First item");
  assert.equal(blocks[0].items[1].task, true);

  const patched = ctx.toggleTaskLineInDoc(crlf, 0, true, "First item");
  assert.equal(patched.md, "- [x] First item\r\n- [x] Second item\r\n");

  const html = ctx.wordsMd(crlf, p, { interactive: true });
  assert.match(html, /data-task-text="First item"/);
});

test("wordsMd disables non-interactive checkboxes and enables interactive Line step checkboxes with sequential task indices", () => {
  const { ctx, p, line } = loadLineMarkdownEnv();

  const roHtml = ctx.wordsMd("- [ ] One\n- [x] Two", p);
  assert.match(roHtml, /data-task-index="0"[^>]*disabled/);
  assert.match(roHtml, /data-task-index="1"[^>]*checked[^>]*disabled/);

  const askHtml = ctx.askItem(p, line, line.stations[0]);
  assert.match(askHtml, /data-task-index="0" data-task-text="Option A"/);
  assert.match(askHtml, /data-task-index="1" data-task-text="Option B"/);
  assert.match(askHtml, /data-task-index="2" data-task-text="Stay flat"/);
  assert.doesNotMatch(askHtml, /data-task-index="0"[^>]*disabled/);

  line.closed = true;
  const closedHtml = ctx.askItem(p, line, line.stations[0]);
  assert.match(closedHtml, /data-task-index="0"[^>]*disabled/);
  line.closed = false;

  ctx.HOSTED = { key: "p1", read: false };
  const hostedHtml = ctx.askItem(p, line, line.stations[0]);
  assert.match(hostedHtml, /data-task-index="0"[^>]*disabled/);
  ctx.HOSTED = null;
});

test("toggleStepTask queues rapid multi-checkbox clicks, sends expected text, preserves optimistic state across polls, and syncs once settled", async () => {
  const { ctx, p, line, apiCalls, getLoadStateCount } = loadLineMarkdownEnv();
  const resolvers = [];
  ctx._apiHandler = (url, opts) => new Promise(resolve => resolvers.push({ url, opts, resolve }));

  const makeBox = (index, checked, taskText) => {
    const classes = new Set(["task"]);
    const li = { classList: { toggle: (c, v) => (v ? classes.add(c) : classes.delete(c)), has: c => classes.has(c) } };
    const card = { dataset: { step: "ask-1", h: "" } };
    return {
      checked,
      dataset: { taskIndex: String(index), taskText },
      closest: sel => (sel === "[data-step]" ? card : sel === "li.task" ? li : null),
      _li: li,
      _card: card,
    };
  };

  const b0 = makeBox(0, true, "Option A");
  const b2 = makeBox(2, true, "Stay flat");
  ctx.toggleStepTask(b0);
  ctx.toggleStepTask(b2);

  assert.equal(b0._li.classList.has("done"), true);
  assert.equal(b2._li.classList.has("done"), true);
  await new Promise(r => setImmediate(r));
  assert.equal(resolvers.length, 1);
  assert.equal(resolvers[0].url, "/api/lines/projects/p1/topics/demo/toggle-task");
  assert.deepEqual({ ...resolvers[0].opts.body }, { step: "ask-1", index: 0, checked: true, expected: "Option A" });

  const midHtml = ctx.askItem(p, line, line.stations[0]);
  assert.match(midHtml, /data-task-index="0" data-task-text="Option A" checked/);
  assert.match(midHtml, /data-task-index="2" data-task-text="Stay flat" checked/);
  assert.doesNotMatch(midHtml, /data-task-index="1" data-task-text="Option B" checked/);

  resolvers[0].resolve({ ok: true });
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(getLoadStateCount(), 0);
  assert.equal(resolvers.length, 2);
  assert.deepEqual({ ...resolvers[1].opts.body }, { step: "ask-1", index: 2, checked: true, expected: "Stay flat" });

  line.stations[0].text = ctx.toggleTaskInMd(ctx.toggleTaskInMd(line.stations[0].text, 0, true, "Option A"), 2, true, "Stay flat");
  resolvers[1].resolve({ ok: true });
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(getLoadStateCount(), 1);
  assert.equal(ctx.S.taskPending.size, 0);
  assert.equal(apiCalls.length, 2);
});

test("Reader renders data-question-text only above steps and prevents Note/uncheck/duplicate-option collisions", async () => {
  const { ctx, p, line, apiCalls, savedDocs } = loadLineMarkdownEnv();
  const md = [
    "# Demo",
    "",
    "## Questions for you",
    "",
    "**First question?** (@codex)",
    "",
    "- [ ] Yes",
    "- [ ] No",
    "",
    "**Second question?** (@codex)",
    "",
    "- [ ] Yes",
    "- [ ] Later",
    "",
    "## Note · 2026-11-20 08:00",
    "",
    "- [ ] Yes",
  ].join("\n");
  const doc = { path: "lines/demo.md", kind: "topic", md };
  const html = ctx.renderMd(md, p, { doc, interactive: true });
  assert.match(html, /data-task-line="6"[^>]*data-question-text="First question\?"/);
  assert.match(html, /data-task-line="11"[^>]*data-question-text="Second question\?"/);
  // Note checkbox below ## Note must NOT carry data-question-text
  const noteLineTag = html.match(/<input[^>]*data-task-line="16"[^>]*>/)[0];
  assert.doesNotMatch(noteLineTag, /data-question-text=/);

  line.questions = [
    { id: "q1", text: "First question?", options: ["Yes", "No"], ticked: null },
    { id: "q2", text: "Second question?", options: ["Yes", "Later"], ticked: null },
  ];

  // Checking "- [ ] Yes" inside Note (no questionText) saves to doc, NEVER submits answer!
  await ctx.answerFromBox(null, doc, { line: 16, checked: true, expectedText: "Yes", questionText: "", ownerProject: p });
  assert.equal(apiCalls.filter(c => c.act === "answer").length, 0);
  assert.equal(savedDocs.length, 1);
  assert.match(savedDocs[0].md, /## Note · 2026-11-20 08:00\n\n- \[x\] Yes/);

  // Unchecking even with questionText does NOT submit an answer
  await ctx.answerFromBox(null, doc, { line: 11, checked: false, expectedText: "Yes", questionText: "Second question?", ownerProject: p });
  assert.equal(apiCalls.filter(c => c.act === "answer").length, 0);

  // Checking "Yes" under Second question answers q2 specifically, NOT q1
  await ctx.answerFromBox(null, doc, { line: 11, checked: true, expectedText: "Yes", questionText: "Second question?", ownerProject: p });
  const ans = apiCalls.find(c => c.act === "answer");
  assert.ok(ans);
  assert.equal(ans.body.question, "q2");
  assert.equal(ans.body.answer, "Yes");

  // Misplaced ## Questions for you appearing after ## Ask also emits data-question-text and submits on tick
  apiCalls.length = 0;
  const misplacedMd = [
    "# Misplaced",
    "",
    "## Ask · 2026-11-21 12:34",
    "",
    "Choose an icon option.",
    "",
    "## Questions for you",
    "",
    "Which direction should I implement?",
    "",
    "- [ ] Option A",
    "- [ ] Option B",
  ].join("\n");
  const misplacedDoc = { path: "lines/misplaced.md", kind: "topic", md: misplacedMd };
  const misplacedHtml = ctx.renderMd(misplacedMd, p, { doc: misplacedDoc, interactive: true });
  assert.match(misplacedHtml, /data-task-line="10"[^>]*data-question-text="Which direction should I implement\?"/);
});

test("Reader.bind serializes rapid toggles with captured ownerProject and routes split-editor preview toggles to textarea", async () => {
  const { ctx, p, p2, savedDocs, setCurrentProject } = loadLineMarkdownEnv();
  const listeners = {};
  const rdBody = { innerHTML: "" };
  const rdRendered = { scrollTop: 0 };
  const rdArea = { hidden: true, value: "", matches: () => false, addEventListener: () => {} };
  const rdSrc = { innerHTML: "" };
  const el = {
    isConnected: true,
    classList: { contains: () => false },
    addEventListener: (ev, fn) => { listeners[ev] = fn; },
  };
  ctx.$ = sel => (sel === "#rdArea" ? rdArea : sel === "#rdBody" ? rdBody : sel === "#rdRendered" ? rdRendered : sel === "#rdSrc" ? rdSrc : null);

  const doc = { path: "notes/list.md", kind: "note", md: "- [ ] One\n- [ ] Two\n" };
  const saveResolvers = [];
  ctx._saveHandler = (proj, d, nextMd) => new Promise(resolve => {
    saveResolvers.push(() => {
      d.md = nextMd;
      savedDocs.push({ projectId: proj.id, path: d.path, md: nextMd });
      resolve({ hash: `h${savedDocs.length}`, mtime: 300 });
    });
  });

  ctx.Reader.bind(el, doc, p, () => {});
  const makeTarget = (lineNo, checked, taskText) => ({
    checked,
    disabled: false,
    dataset: { taskLine: String(lineNo), taskText },
    closest: sel => (sel === "[data-task-line]" ? target : sel === "li.task" ? { classList: { toggle: () => {} } } : null),
  });
  let target = makeTarget(0, true, "One");
  listeners.change({ target });
  // Switch active project before second click / save completes — captured ownerProject p must still receive both saves!
  setCurrentProject(p2);
  target = makeTarget(1, true, "Two");
  listeners.change({ target });

  await new Promise(r => setImmediate(r));
  assert.equal(saveResolvers.length, 1);
  saveResolvers[0]();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(saveResolvers.length, 2);
  saveResolvers[1]();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  assert.equal(savedDocs.length, 2);
  assert.equal(savedDocs[0].projectId, "p1");
  assert.equal(savedDocs[1].projectId, "p1");
  assert.equal(doc.md, "- [x] One\n- [x] Two\n");

  // Split-editor mode: preview toggle edits textarea draft without calling saveDoc
  rdArea.hidden = false;
  rdArea.value = "- [ ] Draft first\n- [x] One\n- [x] Two\n";
  const beforeSaves = savedDocs.length;
  target = makeTarget(0, true, "Draft first");
  listeners.change({ target });
  assert.equal(savedDocs.length, beforeSaves);
  assert.equal(rdArea.value, "- [x] Draft first\n- [x] One\n- [x] Two\n");
});

test("PE-860 #12 Reader routes mixed numbered prompts and bare checkboxes by exact source revision and line", async t => {
  const F = require("../src/server/project-lines/format.js");
  const { project, service } = makeService(t);
  const { ctx, p, apiCalls, savedDocs } = loadLineMarkdownEnv();
  const examples = [
    ["1. **Color**\n- [ ] Yes\n2. **Size**\n- [ ] Yes", "Size"],
    ["1) **Color**\n- [ ] Yes\n2) **Size**\n- [ ] Yes", "Size"],
    ["- [ ] Yes", "Use this color?"],
  ];
  for (const [questions, prompt] of examples) {
    const md = `---\nid: PE-860\nstatus: done\nwhy: Use this color?\n---\n\n# Demo\n\n## Questions for you\n\n${questions}\n`;
    const doc = { path:"lines/demo.md", kind:"topic", md, hash:F.hashText(md) };
    service.writeDoc(project, "demo", md);
    const html = ctx.renderMd(md, p, { doc, interactive:true });
    const at = md.split("\n").lastIndexOf("- [ ] Yes");
    const tag = html.match(new RegExp(`<input[^>]*data-task-line="${at}"[^>]*>`))[0];
    assert.ok(tag.includes(`data-question-source="${doc.hash}"`));
    await ctx.answerFromBox(null, doc, { checked:true, line:at, expectedText:"Yes", questionSource:doc.hash, ownerProject:p });
    const request = apiCalls.at(-1);
    assert.equal(request.act, "answer");
    assert.equal((await service.act(project, "demo", "answer", request.body)).mode, "recorded");
    assert.deepEqual(F.parseLine(service.readDoc(project,"demo")).decided, [{ text:prompt, answer:"Yes" }]);
    await assert.rejects(service.act(project, "demo", "answer", request.body), { code:"STALE_QUESTION" });
    assert.equal(savedDocs.length, 0);
  }
});
