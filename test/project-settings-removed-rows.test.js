"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function extractFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  let depth = 0, inStr = false, quote = "", esc = false;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { inStr = true; quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

test("Project settings omits Agents, Every project, and MeetCue rows while keeping all other sections", () => {
  const pagesSrc = read("public/lines/pages.js");
  const ctx = vm.createContext({
    HOSTED: false,
    S: { agentCheck: { problems: 2 } },
    SKILL_WHY: "Drawing skill description",
    MEMORY_WHY: "Memory skill description",
    SYNC_WHY: "Your latest 50 conversations in this project's folders.",
    esc: (v) => String(v ?? ""),
    ic: (name) => `<svg data-ic="${name}"></svg>`,
    whereRow: () => `<section class="set-row" aria-label="Folders"><div class="set-text"><strong>Folders</strong></div></section>`,
    topicsSettingsRow: () => `<section class="set-row" aria-label="Topics"><div class="set-text"><strong>Topics</strong></div><button type="button" class="btn sm">Rebuild</button></section>`,
    syncButton: () => `<button type="button" class="btn sm" data-act="sync-recent">Sync recent conversations</button>`,
    hostedDeleteRow: () => "",
    // Even if a stale global existed, settingsHTML must never render a MeetCue row.
    meetcueCardButton: () => `<button type="button" class="btn sm" data-act="use-in-meetcue">Use in MeetCue</button>`,
  });
  vm.runInContext(`${extractFn(pagesSrc, "settingsHTML")}\nglobalThis.settingsHTML = settingsHTML;`, ctx);

  const html = ctx.settingsHTML({
    id: "p1",
    name: "PenEcho",
    projectMemory: true,
    projectTopics: true,
    autoWake: true,
    follow: true,
    archived: false,
    canvasSkill: false,
    memorySkill: true,
    memoryFolders: 1,
  });

  const { document } = parseHTML(html);
  const sections = [...document.querySelectorAll(".settings-page > section.set-row")].map((el) => el.getAttribute("aria-label"));

  assert.deepEqual(sections, [
    "Name",
    "Folders",
    "Topics",
    "Project knowledge",
    "Recent conversations",
    "Archive",
    "Drawing skill",
    "Memory skill",
  ]);

  assert.equal(document.querySelector("#autoWake"), null);
  assert.equal(document.querySelector("#followChats"), null);
  assert.equal(document.querySelector('[data-act="open-agents"]'), null);
  assert.equal(document.querySelector('[data-act="open-settings"]'), null);
  assert.equal(document.querySelector('[data-act="use-in-meetcue"]'), null);
  assert.ok(document.querySelector("#projectMemory")?.hasAttribute("checked"));
  assert.ok(document.querySelector("#projectTopics")?.hasAttribute("checked"));
  // Topics hidden in every project (PE-1066): Project knowledge keeps only Project memory.
  const hidden = parseHTML(ctx.settingsHTML({ id:"p1", name:"PenEcho", projectMemory:true, projectTopics:false, topicsHidden:true, archived:false, memorySkill:true, memoryFolders:1 })).document;
  assert.equal(hidden.querySelector("#projectTopics"), null);
  assert.ok(hidden.querySelector("#projectMemory")?.hasAttribute("checked"));
  assert.ok(document.querySelector('[data-act="sync-recent"]'));
  assert.ok(document.querySelector('[data-act="project-archive"]'));
  assert.ok(document.querySelector('[data-act="skill-add"]'));
  assert.ok(document.querySelector('[data-act="memory-skill-remove"]'));
  assert.equal(document.querySelector(".set-state"), null);

  const installedHtml = ctx.settingsHTML({
    id: "p1",
    name: "PenEcho",
    projectMemory: true,
    projectTopics: true,
    archived: false,
    canvasSkill: true,
    skillFolders: 59,
    memorySkill: true,
    memoryFolders: 59,
  });
  const { document: installedDoc } = parseHTML(installedHtml);
  assert.ok(installedDoc.querySelector('[data-act="skill-remove"]'));
  assert.ok(installedDoc.querySelector('[data-act="memory-skill-remove"]'));
  assert.equal(installedDoc.querySelector(".set-state"), null);
  assert.doesNotMatch(installedHtml, /Added to \d+ folders?, out of Git/);
});

test("main.js and meetcue.js remove dead settings handlers while keeping rail and line MeetCue menu actions", () => {
  const mainSrc = read("public/lines/main.js");
  const meetcueSrc = read("public/lines/meetcue.js");

  assert.doesNotMatch(mainSrc, /#?followChats|id === 'followChats'|id !== 'autoWake'/);
  assert.match(mainSrc, /e\.target\.id === 'projectMemory' \|\| e\.target\.id === 'projectTopics'/);

  assert.doesNotMatch(meetcueSrc, /\bmeetcueCardButton\b/);
  assert.doesNotMatch(meetcueSrc, /ACT\['use-in-meetcue'\]/);
  assert.match(meetcueSrc, /const meetcueMenuItems = .*Use in MeetCue/);
  assert.match(meetcueSrc, /const meetcueLineItems = .*Send this line to MeetCue/);
});
