"use strict";

// Node warns, once in each thread, that its SQLite is experimental. A person who starts PenEcho can do nothing about that,
// so only that warning is left out, and only while the module loads: every other warning is still shown.
// It stands alone: opencode-db.js also hands its source to a worker thread.
function requireSqlite() {
  const emitWarning = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const type = typeof rest[0] === "object" ? rest[0]?.type : rest[0];
    if (type === "ExperimentalWarning" && /^SQLite is an experimental feature/.test(String(warning?.message ?? warning))) return;
    return emitWarning.call(this, warning, ...rest);
  };
  try { return require("node:sqlite"); } finally { process.emitWarning = emitWarning; }
}
function loadSqlite() { try { return requireSqlite(); } catch { return null; } }

module.exports = { loadSqlite, requireSqlite };
