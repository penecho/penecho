"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const RECORD_VERSION = 1;
const INSTANCE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function registryStateDirectory() {
  return path.join(os.homedir(), ".penecho");
}

function recordsDirectory(stateDirectory) {
  const base = stateDirectory ? path.resolve(stateDirectory) : registryStateDirectory();
  return path.join(base, "mcp", "instances");
}

function recordPath(directory, instanceId) {
  if (typeof instanceId !== "string" || !INSTANCE_ID_PATTERN.test(instanceId)) throw new Error("Invalid MCP instance id.");
  return path.join(directory, `${instanceId}.json`);
}

function writeRecord(directory, record) {
  fs.mkdirSync(directory, { recursive:true, mode:0o700 });
  try { fs.chmodSync(directory, 0o700); } catch {}
  const target = recordPath(directory, record.instanceId);
  const temporary = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const contents = `${JSON.stringify({ ...record, version:RECORD_VERSION })}\n`;
  try {
    fs.writeFileSync(temporary, contents, { encoding:"utf8", mode:0o600, flag:"wx" });
    try { fs.chmodSync(temporary, 0o600); } catch {}
    fs.renameSync(temporary, target);
    try { fs.chmodSync(target, 0o600); } catch {}
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
  return target;
}

function validRecord(value) {
  return value && value.version === RECORD_VERSION
    && typeof value.instanceId === "string" && INSTANCE_ID_PATTERN.test(value.instanceId)
    && Number.isInteger(value.pid) && value.pid > 0
    && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535
    && value.host === "127.0.0.1"
    && typeof value.secret === "string" && /^[0-9a-f]{64}$/i.test(value.secret);
}

function readRecords(directory) {
  let names;
  try { names = fs.readdirSync(directory); } catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const records = [];
  for (const name of names) {
    if (!/^[0-9a-f-]{36}\.json$/i.test(name)) continue;
    try {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16 * 1024 || process.platform !== "win32" && (stat.mode & 0o077) !== 0) continue;
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (validRecord(value) && name === `${value.instanceId}.json`) records.push({ ...value, _file:file });
    } catch {}
  }
  return records.sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));
}

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

function removeRecord(directory, identity) {
  const target = recordPath(directory, identity.instanceId);
  try {
    const current = JSON.parse(fs.readFileSync(target, "utf8"));
    if (current.instanceId === identity.instanceId && current.secret === identity.secret) fs.unlinkSync(target);
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

// Prefer the shared record when a legacy directory contains the same instance.
function discoverRecords({ stateDirectory, registryStateDirectory:sharedDirectory } = {}) {
  const directories = new Set([recordsDirectory(sharedDirectory)]);
  if (stateDirectory) directories.add(recordsDirectory(stateDirectory));
  const records = new Map();
  for (const directory of directories) {
    let candidates;
    try { candidates = readRecords(directory); } catch { continue; }
    for (const record of candidates) {
      if (!records.has(record.instanceId) && processIsAlive(record.pid)) records.set(record.instanceId, record);
    }
  }
  return [...records.values()].sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));
}

module.exports = { discoverRecords, registryStateDirectory, RECORD_VERSION, processIsAlive, readRecords, recordsDirectory, removeRecord, writeRecord };
