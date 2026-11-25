#!/usr/bin/env node
"use strict";
// A project folder's layout (src/server/project-lines/layout.js), from the command line:
//   node scripts/project-layout.cjs check <docs folder>     which layout it has, and the last move
//   node scripts/project-layout.cjs migrate <docs folder>   move a layout-1 folder (Lines in topics/) to layout 2
//   node scripts/project-layout.cjs undo <docs folder>      move it back to layout 1, for good (PenEcho leaves it there)
// Quit PenEcho, or make sure no agent is working in the folder, before migrate or undo: PenEcho checks that itself, this does not.
const fs = require("node:fs");
const path = require("node:path");
const L = require("../src/server/project-lines/layout.js");

const [verb, folder] = process.argv.slice(2);
if (!["check", "migrate", "undo"].includes(verb) || !folder) {
  console.error("Usage: node scripts/project-layout.cjs check|migrate|undo <docs folder>");
  process.exit(2);
}
const docs = path.resolve(folder.replace(/^~(?=$|\/)/, process.env.HOME || ""));
if (!fs.existsSync(docs) || !fs.statSync(docs).isDirectory()) { console.error(`${docs} is not a folder.`); process.exit(1); }
const state = L.readState(docs);
if (verb === "check") {
  console.log(`${docs}\nlayout ${L.versionOf(docs)}${state?.stay ? " (moved back by hand; PenEcho leaves it)" : ""}${state?.migration ? `\nlast move: ${path.join(docs, L.MIGRATIONS, state.migration, "log.json")}` : ""}`);
  process.exit(0);
}
if (verb === "migrate" && state?.stay) { fs.writeFileSync(path.join(docs, L.LAYOUT_FILE), JSON.stringify({ version:1 }, null, 2)); }
const result = verb === "migrate" ? L.migrate(docs, { why:"scripts/project-layout.cjs" }) : L.undo(docs);
if (!result.moved) { console.error(`Nothing moved: ${result.reason}`); process.exit(1); }
// MEMORY.md says where Lines are; its paragraph follows the folder.
const memory = path.join(docs, "MEMORY.md");
try { const md = fs.readFileSync(memory, "utf8"), next = require("../src/server/project-lines/memory.js").introFor(md, L.versionOf(docs)); if (next !== md) fs.writeFileSync(memory, next); } catch { /* No MEMORY.md. */ }
console.log(`Moved ${result.moves} entries and rewrote links in ${result.rewritten} Markdown files${result.exact !== undefined ? ` (${result.exact} back to their exact old bytes)` : ""}.\nLog: ${result.log}`);
