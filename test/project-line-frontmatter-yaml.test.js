"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const F = require("../src/server/project-lines/format.js");
const Memory = require("../src/server/project-lines/memory.js");
const Knowledge = require("../src/server/project-lines/knowledge.js");
const { upgradeTopic } = require("../src/server/project-lines/upgrade.js");
const { Store } = require("../src/server/project-lines/store.js");
const Examples = require("../src/server/project-lines/examples.js");

function extractFront(md) {
  const m = String(md).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert.ok(m, `Expected YAML frontmatter block in:\n${md.slice(0, 200)}`);
  return m[1];
}

function validateYamlBatch(docs) {
  const py = spawnSync("python3", [
    "-c",
    `import json, sys, yaml
items = json.load(sys.stdin)
out = []
for name, src in items:
    parsed = yaml.safe_load(src)
    assert isinstance(parsed, dict), f"{name}: expected dict, got {type(parsed)}"
    out.append([name, {k: str(v) if not isinstance(v, str) else v for k, v in parsed.items()}])
json.dump(out, sys.stdout)
`,
  ], { input: JSON.stringify(docs), encoding: "utf8" });
  if (py.error || (py.status !== 0 && /No module named 'yaml'/.test(py.stderr || ""))) {
    return null;
  }
  assert.equal(py.status, 0, `PyYAML rejected frontmatter:\n${py.stderr}`);
  return Object.fromEntries(JSON.parse(py.stdout));
}

test("initialLine, initialDetail, noteToLine, setFront, readmeIndex, drawingSkill, and memory write YAML 1.2-valid frontmatter", () => {
  const line = F.initialLine({
    title: "Example inventory",
    id: "PE-697",
    status: "done",
    who: "claude",
    base: "main",
    area: "Code: Frontend",
    labels: ["Code", "PR #172"],
    priority: 2,
    created: "2026-11-18 17:46",
    source: "Claude desktop",
    code: "/Users/heack/workspace/penecho_071_version",
    steps: [F.askStep({ words: "Check examples" }), F.workStep({ who: "claude", done: true, took: "4 min", body: "Done." })],
  });
  assert.match(line, /^who: "@claude"$/m);
  assert.match(line, /^area: "Code: Frontend"$/m);
  assert.match(line, /^labels: "Code, PR #172"$/m);
  assert.match(line, /^status: done$/m);
  assert.match(line, /^id: PE-697$/m);

  const detail = F.initialDetail({
    slug: "example-inventory",
    title: "Example inventory",
    label: "Work 1",
    who: "codex",
    started: "2026-11-18 17:46",
  });
  assert.match(detail, /^who: "@codex"$/m);

  const patched = F.setFront(detail, {
    "carried from": "@antigravity",
    "task why": "Short conversation (41305 input tokens), but idle 67 min: starting fresh",
    "route why": "Rebasing PR #172 onto origin/main",
    "quote test": 'Say "hi" & \\bye\\',
    "leading special": "`code`",
    "trailing colon": "done:",
    "dash list": "- item",
    "doc sep": "---",
    "multiline": "first line\nsecond line",
    "outer space": " padded ",
    "win path": "C:\\Users\\heack\\project",
  });
  const parsed = F.splitFront(patched).front;
  assert.equal(parsed.who, "@codex");
  assert.equal(parsed["carried from"], "@antigravity");
  assert.equal(parsed["task why"], "Short conversation (41305 input tokens), but idle 67 min: starting fresh");
  assert.equal(parsed["route why"], "Rebasing PR #172 onto origin/main");
  assert.equal(parsed["quote test"], 'Say "hi" & \\bye\\');
  assert.equal(parsed["leading special"], "`code`");
  assert.equal(parsed["trailing colon"], "done:");
  assert.equal(parsed["dash list"], "- item");
  assert.equal(parsed["doc sep"], "---");
  assert.equal(parsed["multiline"], "first line\nsecond line");
  assert.equal(parsed["outer space"], " padded ");
  assert.equal(parsed["win path"], "C:\\Users\\heack\\project");

  // Lossless round-trip on repeated setFront
  const repatched = F.setFront(patched, { reviewed: "2026-11-21 17:10" });
  assert.deepEqual(F.splitFront(repatched).front, { ...parsed, reviewed: "2026-11-21 17:10" });

  // Note to Line
  const noteLine = F.noteToLine("# Rough note\n\nBody.\n", {
    id: "PE-900",
    status: "working",
    who: "claude",
    steps: [F.askStep({ words: "Go" })],
    title: "Rough note",
  });
  assert.match(noteLine, /^who: "@claude"$/m);

  // README, Memory, Skills with tricky project names
  const readme = F.readmeIndex({
    name: "@acme: Web #1",
    code: "/tmp/code: v2",
    topics: [],
    notes: [],
    stateText: () => "",
  });
  const mem = Memory.initialMemory("@acme: Web #1", "AW");
  const memSkill = Memory.skillText({ name: "@acme: Web #1", docs: "/tmp/docs" });
  const drawSkill = F.drawingSkill({ name: "@acme: Web #1", user: false });

  // Upgrade from legacy unquoted frontmatter heals it
  const upgraded = upgradeTopic({
    slug: "legacy",
    topicMd: "---\nid: DE-1\nwho: @claude\ncode: /tmp/code\n---\n\n# Legacy\n",
    tasksMd: "---\nid: DE-1\nstatus: done\nwho: @claude\nwhy: Failed: retry #2\n---\n\n# Tasks: Legacy\n\n## Steps\n\n- [x] **Ask** (@you, 2026-11-05 09:00)\n- [x] **Work** (@claude, 2026-11-05 09:30): Done\n",
  });
  assert.match(upgraded.md, /^who: "@claude"$/m);
  assert.match(upgraded.md, /^why: "Failed: retry #2"$/m);

  const yamlResults = validateYamlBatch([
    ["line", extractFront(line)],
    ["detail", extractFront(detail)],
    ["patched", extractFront(patched)],
    ["repatched", extractFront(repatched)],
    ["noteLine", extractFront(noteLine)],
    ["readme", extractFront(readme)],
    ["memory", extractFront(mem)],
    ["memSkill", extractFront(memSkill)],
    ["drawSkill", extractFront(drawSkill)],
    ["upgraded", extractFront(upgraded.md)],
  ]);
  if (yamlResults) {
    assert.equal(yamlResults.line.who, "@claude");
    assert.equal(yamlResults.patched["quote test"], 'Say "hi" & \\bye\\');
    assert.equal(yamlResults.patched["multiline"], "first line\nsecond line");
    assert.equal(yamlResults.patched["win path"], "C:\\Users\\heack\\project");
    assert.equal(yamlResults.readme.project, "@acme: Web #1");
    assert.equal(yamlResults.memory.project, "@acme: Web #1");
  }
});

test("splitFront, Knowledge.topicsOf, and Store.importFolder stay backwards-compatible with unquoted, single-quoted, and double-quoted frontmatter", () => {
  const legacy = "---\nid: PE-1\nstatus: done\nwho: @claude\n---\n\n# Legacy\n";
  assert.equal(F.splitFront(legacy).front.who, "@claude");
  assert.equal(F.parseLine(legacy).front.who, "@claude");
  assert.equal(F.normalizeWho(F.splitFront(legacy).front.who), "claude");

  const singleQuoted = "---\nid: PE-2\nstatus: done\nwho: '@codex'\nnote: 'it''s fine'\n---\n\n# Single\n";
  assert.equal(F.splitFront(singleQuoted).front.who, "@codex");
  assert.equal(F.splitFront(singleQuoted).front.note, "it's fine");

  // Rewriting a legacy file heals it into valid YAML
  const healed = F.setFront(legacy, { status: "closed" });
  assert.match(healed, /^who: "@claude"$/m);
  assert.equal(F.splitFront(healed).front.who, "@claude");

  // Knowledge.topicsOf and Store.importFolder decode quoted frontmatter fields cleanly
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-yaml-"));
  try {
    const docs = path.join(tmp, "docs");
    const stateDir = path.join(tmp, "state");
    fs.mkdirSync(path.join(docs, "topics"), { recursive: true });
    fs.mkdirSync(path.join(docs, "lines"), { recursive: true });
    fs.writeFileSync(path.join(docs, "README.md"), F.readmeIndex({ name: "App: Next #1", code: "none", topics: [], notes: [], stateText: () => "" }));
    fs.writeFileSync(path.join(docs, "MEMORY.md"), Memory.initialMemory("App: Next #1", "AN"));
    fs.writeFileSync(path.join(docs, "topics", "search.md"), `---\nrecord_type: topic\nid: topic-s1\ntitle: "Search: Find & Ask"\narea: "UI: Core"\nparent_id: null\nupdated: 2026-11-21\nupdated_by: PE-1 Work 1\n---\n\n# Search: Find & Ask\n\n**Fast search.**\n`);

    const topics = Knowledge.topicsOf(docs);
    assert.equal(topics.length, 1);
    assert.equal(topics[0].title, "Search: Find & Ask");
    assert.equal(topics[0].area, "UI: Core");

    const store = new Store({ directory: stateDir });
    const imported = store.importFolder({ docsPath: docs });
    assert.equal(imported.name, "App: Next #1");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("all rendered bundled example markdown files have valid YAML frontmatter", () => {
  const examplesRoot = path.join(__dirname, "..", "src", "server", "project-lines", "examples");
  const sampleValues = {
    now: new Date("2026-11-21T12:00:00Z"),
    prefix: "EX",
    code: "/Users/test/Project: #1/timeline-app",
    commits: { main: "1111111122222222", "fix-time-labels": "3333333344444444", homepage: "5555555566666666", "dark-mode": "7777777788888888" },
  };
  const docs = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) {
        const text = fs.readFileSync(full, "utf8");
        if (text.startsWith("---\n") || text.startsWith("---\r\n")) {
          const filled = F.setFront(Examples.fill(text, sampleValues), {});
          docs.push([path.relative(examplesRoot, full), extractFront(filled)]);
        }
      }
    }
  })(examplesRoot);
  assert.ok(docs.length >= 17, `Expected bundled example docs, found ${docs.length}`);
  const parsed = validateYamlBatch(docs);
  if (parsed) {
    assert.equal(parsed["app/docs/lines/dark-mode.md"].who, "@codex");
    assert.equal(parsed["app/docs/lines/dark-mode.md"].code, sampleValues.code);
  }
});
