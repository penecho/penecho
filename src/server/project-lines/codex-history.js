"use strict";
const fs = require("node:fs");
const readline = require("node:readline");
const zlib = require("node:zlib");
const { pipeline } = require("node:stream/promises");

const secondsToMs = value => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 8640000000000 ? value * 1000 : null;

// Codex may compact a rollout to .jsonl.zst while thread/read still names .jsonl.
// Stream both forms so large conversations and embedded images do not fill memory.
async function* rolloutLines(file) {
  if (!file) return;
  const actual = fs.existsSync(file) ? file : `${file}.zst`;
  const input = fs.createReadStream(actual);
  const compressed = actual.endsWith(".zst"), decoded = compressed ? zlib.createZstdDecompress() : input;
  const pumping = compressed ? pipeline(input, decoded) : null;
  pumping?.catch(() => {});
  const lines = readline.createInterface({ input:decoded, crlfDelay:Infinity });
  try { yield* lines; if (pumping) await pumping; }
  finally { lines.close(); input.destroy(); if (compressed) decoded.destroy(); }
}

// Match IDs, never turn order or thread.updatedAt: a thread can span many days.
async function rolloutTurnTimes(file) {
  const times = new Map();
  for await (const line of rolloutLines(file)) {
    if (!line.includes('"task_started"')) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    const event = row?.type === "event_msg" && row.payload;
    if (event?.type !== "task_started" || typeof event.turn_id !== "string") continue;
    const at = secondsToMs(event.started_at) ?? Date.parse(row.timestamp);
    if (Number.isFinite(at) && at > 0 && !times.has(event.turn_id)) times.set(event.turn_id, at);
  }
  return times;
}

// When each turn ended, from its own task_complete or turn_aborted event. thread.updatedAt is the file's time, and Codex
// rewrites old files (compacting them to .jsonl.zst) long after: a June conversation can say September (PE-571).
async function rolloutTurnEnds(file) {
  const ends = new Map();
  for await (const line of rolloutLines(file)) {
    if (!line.includes('"task_complete"') && !line.includes('"turn_aborted"')) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    const event = row?.type === "event_msg" && row.payload;
    if (!["task_complete", "turn_aborted"].includes(event?.type) || typeof event.turn_id !== "string") continue;
    const at = secondsToMs(event.completed_at) ?? Date.parse(row.timestamp);
    if (Number.isFinite(at) && at > 0) ends.set(event.turn_id, at);
  }
  return ends;
}

// Each turn's start and end, read in one pass. A turn with no end of its own (cut off, or still going) ends at 0.
async function rolloutTurnSpans(file) {
  const starts = new Map(), ends = new Map();
  for await (const line of rolloutLines(file)) {
    if (!line.includes('"task_started"') && !line.includes('"task_complete"') && !line.includes('"turn_aborted"')) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    const event = row?.type === "event_msg" && row.payload;
    if (typeof event?.turn_id !== "string") continue;
    const at = (event.type === "task_started" ? secondsToMs(event.started_at) : secondsToMs(event.completed_at)) ?? Date.parse(row.timestamp);
    if (!Number.isFinite(at) || at <= 0) continue;
    if (event.type === "task_started") { if (!starts.has(event.turn_id)) starts.set(event.turn_id, at); }
    else if (event.type === "task_complete" || event.type === "turn_aborted") ends.set(event.turn_id, at);
  }
  return [...starts].map(([id, started]) => ({ id, started, ended:ends.get(id) >= started ? ends.get(id) : 0 }));
}

// Thread defaults and selected aliases can differ from the model and effort used by one turn.
// A resumed thread can contain many models: only this exact turn's own context is evidence.
async function rolloutTurnSettings(file, turnId) {
  if (!file || !turnId) return null;
  let settings = null;
  const text = value => typeof value === "string" && value.trim() && !/[\r\n]/.test(value) ? value.trim() : "";
  for await (const line of rolloutLines(file)) {
    if (!line.includes('"turn_context"')) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (row?.type !== "turn_context" || row.payload?.turn_id !== turnId) continue;
    const model = text(row.payload.model), effort = text(row.payload.effort);
    if (model || effort) settings = { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
  }
  return settings;
}

module.exports = { rolloutLines, rolloutTurnTimes, rolloutTurnEnds, rolloutTurnSpans, rolloutTurnSettings, secondsToMs };
