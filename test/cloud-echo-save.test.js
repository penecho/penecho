"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const persistenceSource = fs.readFileSync(path.join(ROOT, "src", "client", "app", "persistence.js"), "utf8");
const SAVED_CANVAS_ID = "123e4567-e89b-42d3-a456-426614174001";

function functionSource(name) {
  const start = persistenceSource.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const bodyStart = persistenceSource.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < persistenceSource.length; index++) {
    if (persistenceSource[index] === "{") depth++;
    else if (persistenceSource[index] === "}" && --depth === 0) return persistenceSource.slice(start, index + 1);
  }
  throw Error(`unterminated ${name}`);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function harness(overrides = {}) {
  const events = [];
  const context = {
    window:{ PENECHO_CONFIG:{ runtime:"cloud", browserCanvasEditing:true } },
    state:{ currentSnapshotId:"local-canvas", currentSnapshotLocation:"device", snapshotLocation:"device" },
    document:{ querySelector:() => ({ value:"Browser Canvas" }) },
    snapshotSaveInProgress:false,
    cloudSnapshotItems:async () => { events.push({ type:"cloud-projects" }); },
    setSnapshotLocation:(location, options) => { events.push({ type:"location", location, options }); },
    currentCanvasDisplayName:() => "Current Canvas",
    saveSnapshot:async (options) => { events.push({ type:"save", options }); return SAVED_CANVAS_ID; },
    setHistorySaveBusy:(busy) => { events.push({ type:"busy", busy }); },
    showHistoryNoticeKey:(key, tone, duration) => { events.push({ type:"notice-key", key, tone, duration }); },
    selectionAIBusy:() => false,
    finalizeCanvasForSnapshot:async () => { events.push({ type:"finalize" }); },
    canvasHasShareableContent:() => true,
    canvasHasUnsavedChanges:() => true,
    selectionAIStatusKey:() => "selectionBusy",
    setStatus:(message) => { events.push({ type:"status", message }); },
    showHistoryNotice:(message, tone, options) => { events.push({ type:"notice", message, tone, options }); },
    t:(key) => key === "snapshotError" ? "Snapshot error: " : key,
    ...overrides,
  };
  const functions = vm.runInNewContext(`(() => {
    ${functionSource("saveEchoToCloud")}
    ${functionSource("saveLiveShareToCloud")}
    ${functionSource("saveCurrentCanvas")}
    return { saveEchoToCloud, saveCurrentCanvas, saveLiveShareToCloud };
  })()`, context, { filename:"src/client/app/persistence.js" });
  return { ...functions, context, events };
}

test("saveEchoToCloud initializes the Cloud project list before creating a new snapshot", async () => {
  const run = harness();
  const id = await run.saveEchoToCloud("Echoed Canvas");
  assert.equal(id, SAVED_CANVAS_ID);
  assert.deepEqual(run.events.map((event) => event.type), ["cloud-projects", "location", "save"]);
  assert.deepEqual(plain(run.events[1]), { type:"location", location:"cloud", options:{ refresh:false } });
  assert.deepEqual(plain(run.events[2]), {
    type:"save",
    options:{ location:"cloud", overwriteId:null, name:"Echoed Canvas", allowEmpty:true },
  });
});

test("saveCurrentCanvas defaults an unsaved browser Canvas to Cloud", async () => {
  const run = harness({ state:{ currentSnapshotId:null, currentSnapshotLocation:null, snapshotLocation:"device" } });
  await run.saveCurrentCanvas();
  assert.deepEqual(run.events.map((event) => event.type), ["busy", "notice-key", "cloud-projects", "save", "notice-key", "busy"]);
  assert.deepEqual(plain(run.events[2]), { type:"cloud-projects" });
  assert.deepEqual(plain(run.events[3]), {
    type:"save",
    options:{ overwriteId:null, name:"Browser Canvas", location:"cloud" },
  });
  assert.deepEqual(plain(run.events[4]), { type:"notice-key", key:"snapshotSaved", tone:"success" });
});

test("browser editing saves back to the current Library source even when the linked device goes offline", async () => {
  for (const location of ["server", "cloud", "device"]) {
    for (const online of [true, false]) {
      const run = harness({
        window:{ PENECHO_CONFIG:{ runtime:"cloud", browserCanvasEditing:true, linkedDeviceOnline:online } },
        state:{ currentSnapshotId:"saved-canvas", currentSnapshotLocation:location, snapshotLocation:"cloud" },
      });
      await run.saveCurrentCanvas();
      assert.deepEqual(plain(run.events.find(event => event.type === "save").options), {
        overwriteId:"saved-canvas", name:"Browser Canvas", location,
      });
      assert.equal(run.events.some(event => event.type === "cloud-projects"), false);
    }
  }
});

test("saveCurrentCanvas reports a Cloud save failure without showing a success notice", async () => {
  const run = harness({
    saveSnapshot:async (options) => {
      run?.events.push({ type:"save", options });
      throw Error("Cloud save failed");
    },
  });
  await run.saveCurrentCanvas();
  assert.equal(run.events.some((event) => ["snapshotSaved", "snapshotOverwritten"].includes(event.key)), false);
  assert.deepEqual(plain(run.events.find((event) => event.type === "status")), { type:"status", message:"Snapshot error: Cloud save failed" });
  assert.deepEqual(plain(run.events.find((event) => event.type === "notice")), {
    type:"notice",
    message:"Snapshot error: Cloud save failed",
    tone:"error",
    options:{ duration:5000 },
  });
  assert.deepEqual(plain(run.events.at(-1)), { type:"busy", busy:false });
});


test("live sharing saves local content to Cloud without requiring a linked device", async () => {
  const run = harness({window:{PENECHO_CONFIG:{runtime:"local"}}});
  assert.equal(await run.saveLiveShareToCloud(), SAVED_CANVAS_ID);
  assert.deepEqual(run.events.map(event => event.type), ["finalize", "location", "cloud-projects", "save"]);
  assert.equal(run.events[3].options.overwriteId,null);
});

test("live sharing keeps the existing Cloud Canvas identity", async () => {
  const run = harness({state:{currentSnapshotLocation:"cloud",currentSnapshotId:SAVED_CANVAS_ID}});
  await run.saveLiveShareToCloud();
  assert.equal(run.events[3].options.overwriteId,SAVED_CANVAS_ID);
});


test("sharing an unchanged Cloud Canvas does not create another revision", async () => {
  const run=harness({state:{currentSnapshotLocation:"cloud",currentSnapshotId:SAVED_CANVAS_ID},canvasHasUnsavedChanges:()=>false});
  assert.equal(await run.saveLiveShareToCloud(),SAVED_CANVAS_ID);
  assert.deepEqual(run.events,[{type:"finalize"}]);
});

test("empty Canvas sharing stops before Cloud save or share request", async () => {
  const run=harness({canvasHasShareableContent:() => false});
  await assert.rejects(run.saveLiveShareToCloud(), /emptyCanvas/);
  assert.deepEqual(run.events,[{type:"finalize"}]);
});
