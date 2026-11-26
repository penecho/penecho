"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");
const { Store } = require("../src/server/project-lines/store.js");

const ROOT = path.join(__dirname, "..");
const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const esc = v => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

function extractFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  let depth = 0, inStr = false, quote = "", escaped = false;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
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

function makeUiHarness() {
  const pagesSrc = read("public/lines/pages.js");
  const panoSrc = read("public/lines/panorama.js");
  const syncDefs = pagesSrc.slice(pagesSrc.indexOf("const syncButton ="), pagesSrc.indexOf("ACT['sync-recent'] ="));
  const ctx = vm.createContext({
    HOSTED: false,
    S: { syncing: false },
    SKILL_WHY: "Drawing skill description",
    MEMORY_WHY: "Memory skill description",
    esc,
    ic: name => `<svg data-ic="${name}"></svg>`,
    whereRow: () => "",
    topicsSettingsRow: () => "",
    hostedDeleteRow: () => "",
  });
  vm.runInContext(
    `${syncDefs}\n${extractFn(pagesSrc, "settingsHTML")}\n${extractFn(panoSrc, "syncOn")}\nglobalThis.ui = { syncOn, syncButton, settingsHTML, SYNC_WHY, SYNC_MORE_WHY };`,
    ctx
  );
  return { ctx, ui: ctx.ui };
}

test("Home syncOn button switches to Sync more with updated tooltip once synced", () => {
  const { ctx, ui } = makeUiHarness();

  assert.equal(ui.syncOn({ code: false, synced: false }), "");
  assert.equal(ui.syncOn({ code: false, synced: true }), "");

  const before = parseHTML(ui.syncOn({ code: true, synced: false })).document.querySelector("button");
  assert.equal(before.dataset.act, "sync-recent");
  assert.equal(before.textContent.trim(), "Sync conversations");
  assert.equal(before.getAttribute("title"), ui.SYNC_WHY);
  assert.equal(before.disabled, false);

  const after = parseHTML(ui.syncOn({ code: true, synced: true })).document.querySelector("button");
  assert.equal(after.dataset.act, "sync-recent");
  assert.equal(after.textContent.trim(), "Sync more");
  assert.equal(after.getAttribute("title"), ui.SYNC_MORE_WHY);
  assert.equal(after.disabled, false);

  ctx.S.syncing = true;
  const busy = parseHTML(ui.syncOn({ code: true, synced: true })).document.querySelector("button");
  assert.equal(busy.textContent.trim(), "Syncing…");
  assert.equal(busy.disabled, true);
});

test("Project settings sync button and description switch to Sync more once synced", () => {
  const { ctx, ui } = makeUiHarness();
  const base = { id: "p1", name: "PenEcho", projectMemory: true, projectTopics: true, archived: false, canvasSkill: false, memorySkill: true };

  const beforeDoc = parseHTML(ui.settingsHTML({ ...base, synced: false })).document;
  const beforeRow = beforeDoc.querySelector('section.set-row[aria-label="Recent conversations"]');
  assert.equal(beforeRow.querySelector("p").textContent, ui.SYNC_WHY);
  assert.equal(beforeRow.querySelector('[data-act="sync-recent"]').textContent.trim(), "Sync recent conversations");

  const afterDoc = parseHTML(ui.settingsHTML({ ...base, synced: true })).document;
  const afterRow = afterDoc.querySelector('section.set-row[aria-label="Recent conversations"]');
  assert.equal(afterRow.querySelector("p").textContent, ui.SYNC_MORE_WHY);
  assert.equal(afterRow.querySelector('[data-act="sync-recent"]').textContent.trim(), "Sync more");

  ctx.S.syncing = true;
  const busyBtn = parseHTML(ui.settingsHTML({ ...base, synced: true })).document.querySelector('[data-act="sync-recent"]');
  assert.equal(busyBtn.textContent.trim(), "Syncing…");
  assert.equal(busyBtn.disabled, true);
});

test("changing a project's code folder resets synced, while saving the same path keeps it", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-synced-reset-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateDir = path.join(root, "state"), docs = path.join(root, "docs"), codeA = path.join(root, "code-a"), codeB = path.join(root, "code-b");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(codeA, { recursive: true });
  fs.mkdirSync(codeB, { recursive: true });

  const store = new Store({ directory: stateDir });
  const project = store.create({ name: "Demo", docsPath: docs, codePath: codeA });
  project.synced = true;
  store.save();

  store.update(project.id, { name: "Demo Renamed" });
  assert.equal(store.get(project.id).synced, true, "unrelated updates preserve synced");

  store.update(project.id, { codePath: codeA });
  assert.equal(store.get(project.id).synced, true, "saving the same code folder preserves synced");

  store.update(project.id, { codePath: codeB });
  assert.equal(store.get(project.id).synced, false, "switching to a different code folder resets synced");

  store.get(project.id).synced = true;
  store.update(project.id, { codePath: "" });
  assert.equal(store.get(project.id).synced, false, "clearing the code folder resets synced");
});
