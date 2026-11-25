"use strict";

// One offline command for every PenEcho project on this computer. It reads the project registry; it never writes it.
// The resolved project's own memory command does every MEMORY.md change, with its usual validation, lock and history.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REGISTRY_LIST = "memory-projects.json", DEFAULT_REGISTRY = path.join("project-lines", "projects.json");
const COMMANDS = new Set(["help", "where", "show", "add", "replace", "delete", "apply"]);
const GIT_ENV_SCRUB = ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_SUPER_PREFIX"];

function real(folder) {
  try { return (fs.realpathSync.native || fs.realpathSync)(folder); } catch { return ""; }
}
function canonical(folder) {
  const value = real(folder) || path.resolve(folder);
  return process.platform === "darwin" || process.platform === "win32" ? value.toLowerCase() : value;
}
function inside(child, parent) {
  if (!child || !parent) return false;
  if (child === parent) return true;
  const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(prefix);
}
function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of GIT_ENV_SCRUB) delete env[key];
  return env;
}
function registryPaths(home) {
  const dir = path.join(home, ".penecho"), listed = [];
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, REGISTRY_LIST), "utf8"));
    if (Array.isArray(data)) listed.push(...data);
    else if (Array.isArray(data?.projects)) listed.push(...data.projects);
  } catch { /* The default below also works before the first registration. */ }
  const files = [...listed.filter(file => typeof file === "string" && file).map(file => path.resolve(file)), path.join(dir, DEFAULT_REGISTRY)];
  const seen = new Set();
  return files.filter(file => { const key = canonical(file); if (seen.has(key)) return false; seen.add(key); return true; });
}
function readAllProjects(home) {
  const projects = [];
  for (const file of registryPaths(home)) {
    let rows;
    try { rows = JSON.parse(fs.readFileSync(file, "utf8")).projects; } catch { continue; }
    if (!Array.isArray(rows)) continue;
    for (const project of rows) {
      if (!project || typeof project.id !== "string" || !project.id || typeof project.docsPath !== "string" || !project.docsPath) continue;
      projects.push({
        ...project,
        registryFile:file,
        codePaths:Array.isArray(project.codePaths) ? project.codePaths.filter(root => typeof root === "string" && root) : [],
      });
    }
  }
  return projects;
}
function readProjects(home) {
  return readAllProjects(home).filter(project => !project.archived);
}
function claimSignature(project) {
  return JSON.stringify([canonical(project.docsPath), Boolean(project.archived), project.projectMemory !== false, project.memorySkill !== false]);
}
function collapseClaims(matches) {
  const unique = new Map();
  for (const project of matches) {
    const sig = claimSignature(project);
    if (!unique.has(sig)) unique.set(sig, project);
  }
  return [...unique.values()];
}
function directMatches(projects, cwd) {
  const where = canonical(cwd);
  let depth = -1, matches = [];
  for (const project of projects) {
    let bestRoot = -1;
    for (const root of [project.docsPath, ...project.codePaths]) {
      const base = canonical(root);
      if (inside(where, base) && base.length > bestRoot) bestRoot = base.length;
    }
    if (bestRoot < 0) continue;
    if (bestRoot > depth) { depth = bestRoot; matches = [project]; }
    else if (bestRoot === depth) matches.push(project);
  }
  return matches;
}
function gitCommon(folder) {
  if (!folder || !real(folder)) return "";
  const run = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd:folder, env:cleanGitEnv(), encoding:"utf8", stdio:["ignore", "pipe", "ignore"], timeout:10000, windowsHide:true });
  if (run.error || run.status !== 0) return "";
  const found = String(run.stdout || "").trim().split(/\r?\n/, 1)[0];
  return found ? canonical(path.resolve(folder, found)) : "";
}
function worktreeMatches(projects, cwd) {
  const common = gitCommon(cwd);
  if (!common) return [];
  return projects.filter(project => project.codePaths.some(root => gitCommon(root) === common));
}
function resolveProject(home, cwd) {
  const projects = readAllProjects(home);
  const direct = directMatches(projects, cwd);
  const matches = direct.length ? direct : worktreeMatches(projects, cwd);
  if (!matches.length) return { error:`No non-archived PenEcho project matches ${cwd}. Add or open that folder in PenEcho first; memory was not changed.` };
  // Include any other registry entries for the same project id or docsPath so a deeper stale root cannot shadow an archived/disabled row.
  const ids = new Set(matches.map(p => p.id)), docs = new Set(matches.map(p => canonical(p.docsPath)));
  const related = projects.filter(p => ids.has(p.id) || docs.has(canonical(p.docsPath)));
  const distinct = collapseClaims([...matches, ...related]);
  if (distinct.length > 1) {
    return { error:`Conflicting PenEcho project entries match ${cwd}. Fix the project folders or registry state in PenEcho; memory was not changed.` };
  }
  const chosen = distinct[0];
  if (chosen.archived) return { error:`No non-archived PenEcho project matches ${cwd}. Add or open that folder in PenEcho first; memory was not changed.` };
  return { project:chosen };
}
function shQuote(value) { return `'${String(value).replace(/'/g, "'\\''")}'`; }
function commandFor(home, platform = process.platform) {
  const file = path.join(home, ".penecho", platform === "win32" ? "memory.cmd" : "memory");
  return platform === "win32" ? `& '${file.replace(/'/g, "''")}'` : `sh ${shQuote(file)}`;
}
function helpText(home) {
  return `PenEcho memory for the project containing the current folder (works with PenEcho closed).

Usage: ${commandFor(home)} [--cwd <dir>] <command>

  where                          show the resolved project, docsPath, MEMORY.md and this command
  show                           every memory line, tagged D1, D2 … and F1, F2 …
  add <Decisions|Facts> <line>   add a line
  replace <old> <new line>       replace the line that contains <old> (text or its tag)
  delete <old>                   delete the line that contains <old>
  apply [file]                   several changes at once, all or nothing (default: the project's .penecho/memory-change.json)
  help                           this help

The helper only resolves the project. PenEcho's shared memory command validates and writes MEMORY.md.
Read the resolved MEMORY.md only when your work changes how the whole product behaves or a tool misbehaves, and never edit it by hand.`;
}
function argumentsOf(args) {
  let cwd = "", seenCwd = false, i = 0;
  while (i < args.length) {
    const arg = String(args[i]);
    if (arg === "--") { i++; break; }
    if (arg === "--cwd") {
      if (seenCwd) throw new Error("--cwd may only be passed once.");
      if (i + 1 >= args.length || !String(args[i + 1]).trim()) throw new Error("--cwd needs a folder.");
      cwd = String(args[i + 1]); seenCwd = true; i += 2;
    } else if (arg.startsWith("--cwd=")) {
      if (seenCwd) throw new Error("--cwd may only be passed once.");
      const value = arg.slice(6);
      if (!value.trim()) throw new Error("--cwd needs a folder.");
      cwd = value; seenCwd = true; i += 1;
    } else {
      break;
    }
  }
  return { cwd, rest:args.slice(i) };
}
function memoryCore(home) {
  // Always run the trusted PenEcho-installed shared core rather than executing arbitrary JS inside a project docs folder.
  const shared = require(path.join(home, ".penecho", "memory-core.cjs"));
  if (typeof shared.main !== "function") throw new Error("PenEcho's shared memory command is not installed correctly.");
  return shared;
}
function main(args = process.argv.slice(2), { home = path.resolve(__dirname, ".."), cwd = process.cwd(), out = text => process.stdout.write(`${text}\n`), err = text => process.stderr.write(`${text}\n`) } = {}) {
  let parsed;
  try { parsed = argumentsOf(args); } catch (error) { err(error.message); return 2; }
  const verb = String(parsed.rest[0] || "help").toLowerCase();
  if (["help", "-h", "--help"].includes(verb)) { out(helpText(home)); return 0; }
  if (!COMMANDS.has(verb)) { err(`Unknown command "${parsed.rest[0]}".\n\n${helpText(home)}`); return 2; }
  const where = path.resolve(parsed.cwd || cwd);
  try { if (!fs.statSync(where).isDirectory()) { err(`${where} is not a folder; memory was not changed.`); return 1; } } catch { err(`${where} does not exist; memory was not changed.`); return 1; }
  const found = resolveProject(home, where);
  if (found.error) { err(found.error); return 1; }
  const project = found.project;
  if (project.projectMemory === false) { err(`Project memory is disabled for "${project.name || project.id}" in PenEcho's Project settings; memory was not changed.`); return 1; }
  if (project.memorySkill === false) { err(`The memory skill is disabled for "${project.name || project.id}" in PenEcho's Project settings; memory was not changed.`); return 1; }
  const file = path.join(project.docsPath, "MEMORY.md");
  if (verb === "where") {
    out(`Project: ${project.name || project.id}\nDocs: ${project.docsPath}\nMemory: ${file}\nCommand: ${commandFor(home)}`);
    return 0;
  }
  try { return Number(memoryCore(home).main(parsed.rest, { file, out, err })) || 0; }
  catch (error) { err(`PenEcho could not use the memory command for ${project.name || project.id}: ${error.message}`); return 1; }
}

module.exports = { main, resolveProject, registryPaths, readProjects, readAllProjects, gitCommon, commandFor, helpText, inside, argumentsOf };
if (require.main === module) process.exitCode = main();
