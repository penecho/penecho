"use strict";
require("./helpers/safety.js");

const assert = require("node:assert/strict");
const { execFileSync, spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const M = require("../src/server/project-lines/memory.js");
const { Service } = require("../src/server/project-lines/service.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-user-skills-")));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
let counter = 0;
const agents = { available:() => [], desktop:() => null, terminal:() => "" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding:"utf8", stdio:["ignore", "pipe", "pipe"] }).trim();
function repo(dir) {
  fs.mkdirSync(dir, { recursive:true });
  git(dir, "init", "-q", "-b", "main"); git(dir, "config", "user.name", "Test"); git(dir, "config", "user.email", "test@example.com");
  fs.writeFileSync(path.join(dir, "README.md"), `${path.basename(dir)}\n`); git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "first");
  return dir;
}
function fixture(t, name) {
  const root = path.join(temp, `${++counter}-${name}`), home = path.join(root, "home"), directory = path.join(root, "state", "project-lines");
  fs.mkdirSync(directory, { recursive:true }); fs.mkdirSync(home, { recursive:true });
  const service = new Service({ directory, home, agents, autoWatch:false });
  t.after(() => { service.close(); if (fs.existsSync(root)) fs.rmSync(root, { recursive:true, force:true }); });
  return { root, home, directory, service };
}
function memory(home, cwd, ...args) {
  return spawnSync("sh", [path.join(home, ".penecho", "memory"), "--cwd", cwd, ...args], { encoding:"utf8", env:{ ...process.env, HOME:home } });
}
function memoryHere(home, cwd, ...args) {
  return spawnSync("sh", [path.join(home, ".penecho", "memory"), ...args], { cwd, encoding:"utf8", env:{ ...process.env, HOME:home } });
}
function entries(docs) { return M.parse(fs.readFileSync(path.join(docs, "MEMORY.md"), "utf8")).sections; }
function ok(result, label = "memory command") { assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`); return result; }
function addWorktree(code, target, branch) { git(code, "worktree", "add", "-q", "-b", branch, target); return target; }
const diagram = title => JSON.stringify({ type:"architecture", title, nodes:[{ id:"a", label:"A", type:"frontend" }], edges:[] });

// PenEcho is closed before every helper invocation: these are genuinely offline, including apply and worktrees.
test("the shared memory helper resolves two projects offline and runs every command without crossing them", async t => {
  const { root, home, service } = fixture(t, "offline-two-projects");
  const codeA = repo(path.join(root, "code-a")), codeB = repo(path.join(root, "code-b"));
  const a = service.store.create({ name:"Project A", docsPath:path.join(root, "docs-a"), codePath:codeA });
  const b = service.store.create({ name:"Project B", docsPath:path.join(root, "docs-b"), codePath:codeB });
  const workA = addWorktree(codeA, path.join(root, "external-a"), "side-a"), workB = addWorktree(codeB, path.join(root, "external-b"), "side-b");
  const deepA = path.join(workA, "nested/deep"), srcA = path.join(codeA, "src");
  fs.mkdirSync(deepA, { recursive:true }); fs.mkdirSync(srcA, { recursive:true });
  await service.addMemorySkill(a);
  service.close();

  for (const cwd of [a.docsPath, codeA, srcA, workA, deepA]) {
    const where = ok(memory(home, cwd, "where"), `where from ${cwd}`);
    assert.match(where.stdout, /Project: Project A/);
    assert.match(where.stdout, new RegExp(`Docs: ${a.docsPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(where.stdout, new RegExp(`Memory: ${path.join(a.docsPath, "MEMORY.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(where.stdout, /Command: sh .*\.penecho\/memory/);
  }
  assert.match(ok(memoryHere(home, deepA, "where"), "default process.cwd").stdout, /Project: Project A/);
  assert.match(ok(memory(home, workB, "where"), "project B worktree").stdout, /Project: Project B/);
  assert.match(ok(memory(home, a.docsPath, "show"), "show").stdout, /0 of 60 lines/);

  ok(memory(home, a.docsPath, "add", "Facts", "A offline fact (PE-101, 2026-11-21)"), "add");
  ok(memory(home, srcA, "replace", "A offline fact", "A offline fact updated (PE-101, 2026-11-21)"), "replace");
  const applyFile = path.join(a.docsPath, ".penecho", M.CHANGE_FILE);
  fs.writeFileSync(applyFile, JSON.stringify({ ops:[
    { op:"replace", old:"A offline fact updated", text:"A fact applied offline (PE-101, 2026-11-21)" },
    { op:"add", section:"Facts", text:"Delete me offline (PE-102, 2026-11-21)" },
  ] }));
  ok(memory(home, deepA, "apply"), "apply from linked worktree subdirectory");
  assert.ok(!fs.existsSync(applyFile), "a successful default apply removes its JSON file");
  ok(memory(home, deepA, "delete", "Delete me offline"), "delete");
  assert.deepEqual(entries(a.docsPath).Facts, ["A fact applied offline (PE-101, 2026-11-21)"]);
  assert.deepEqual(entries(b.docsPath).Facts, [], "A's commands never touch B");

  ok(memory(home, workB, "add", "Facts", "B offline fact (PE-201, 2026-11-21)"), "B add from its worktree");
  assert.deepEqual(entries(b.docsPath).Facts, ["B offline fact (PE-201, 2026-11-21)"]);
  assert.deepEqual(entries(a.docsPath).Facts, ["A fact applied offline (PE-101, 2026-11-21)"], "B's command never touches A");
  const loose = path.join(root, "unknown"); fs.mkdirSync(loose);
  const beforeA = fs.readFileSync(path.join(a.docsPath, "MEMORY.md"), "utf8"), beforeB = fs.readFileSync(path.join(b.docsPath, "MEMORY.md"), "utf8");
  const unknown = memory(home, loose, "add", "Facts", "Must not land (PE-999, 2026-11-21)");
  assert.equal(unknown.status, 1); assert.match(unknown.stderr, /No non-archived PenEcho project/);
  assert.equal(fs.readFileSync(path.join(a.docsPath, "MEMORY.md"), "utf8"), beforeA);
  assert.equal(fs.readFileSync(path.join(b.docsPath, "MEMORY.md"), "utf8"), beforeB);
  assert.ok(fs.readdirSync(path.join(a.docsPath, ".history")).some(name => name.endsWith("__MEMORY.md")), "the existing history semantics remain");
});

test("the helper honors switches, archives and unknown folders, preserves user skills, and has an offline registry fallback", async t => {
  const { root, home, service } = fixture(t, "offline-safety");
  const code = repo(path.join(root, "code")), project = service.store.create({ name:"Safety", docsPath:path.join(root, "docs"), codePath:code });
  const worktree = addWorktree(code, path.join(root, "worktree"), "side");
  const own = path.join(home, ".agents/skills/penecho-memory/SKILL.md");
  fs.mkdirSync(path.dirname(own), { recursive:true }); fs.writeFileSync(own, "my own user skill");
  await service.addMemorySkill(project);
  assert.equal(fs.readFileSync(own, "utf8"), "my own user skill");
  const installed = fs.readFileSync(path.join(home, ".claude/skills/penecho-memory/SKILL.md"), "utf8");
  assert.match(installed, /sh ~\/\.penecho\/memory where/);
  assert.match(installed, /Read the resolved MEMORY\.md, including its "Keeping this file" part, when your work changes how the whole product behaves or a tool misbehaves/);
  assert.match(installed, /never by editing MEMORY\.md by hand/);
  assert.ok(fs.existsSync(path.join(home, ".penecho/memory.cmd")));
  assert.match(fs.readFileSync(path.join(home, ".penecho/memory.cmd"), "utf8"), /memory-home\.cjs/);
  assert.match(fs.readFileSync(path.join(home, ".penecho/memory.cmd"), "utf8"), /ELECTRON_RUN_AS_NODE=1/);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(home, ".penecho/memory")).mode & 0o777, 0o755);

  const file = path.join(project.docsPath, "MEMORY.md"), before = fs.readFileSync(file, "utf8");
  project.projectMemory = false; service.store.save(); service.close();
  let result = memory(home, worktree, "add", "Facts", "No write (PE-1, 2026-11-21)");
  assert.equal(result.status, 1); assert.match(result.stderr, /Project memory is disabled/); assert.equal(fs.readFileSync(file, "utf8"), before);
  project.projectMemory = true; project.memorySkill = false; service.store.save();
  result = memory(home, code, "show");
  assert.equal(result.status, 1); assert.match(result.stderr, /memory skill is disabled/i); assert.equal(fs.readFileSync(file, "utf8"), before);
  project.memorySkill = true; project.archived = true; service.store.save();
  result = memory(home, worktree, "where");
  assert.equal(result.status, 1); assert.match(result.stderr, /No non-archived PenEcho project/); assert.equal(fs.readFileSync(file, "utf8"), before);
  project.archived = false; service.store.save();

  const registry = path.join(home, ".penecho/memory-projects.json"), missing = path.join(root, "missing/projects.json");
  fs.writeFileSync(registry, JSON.stringify([missing, service.store.file, service.store.file]));
  assert.match(ok(memory(home, code, "where"), "deduped registered paths").stdout, /Project: Safety/);
  const fallback = path.join(home, ".penecho/project-lines/projects.json");
  fs.mkdirSync(path.dirname(fallback), { recursive:true }); fs.copyFileSync(service.store.file, fallback);
  fs.writeFileSync(registry, JSON.stringify([missing]));
  assert.match(ok(memory(home, worktree, "where"), "default registry fallback").stdout, /Project: Safety/);
  const loose = path.join(root, "loose"); fs.mkdirSync(loose);
  assert.equal(memory(home, loose, "help").status, 0, "help needs no project");
  result = memory(home, loose, "show");
  assert.equal(result.status, 1); assert.match(result.stderr, /No non-archived PenEcho project/);

  // If an old docs tool is unavailable, the installed shared core preserves the same behavior offline.
  const tool = path.join(project.docsPath, ".penecho/memory.cjs"), held = `${tool}.held`;
  fs.renameSync(tool, held);
  try { assert.match(ok(memory(home, code, "show"), "shared core fallback").stdout, /0 of 60 lines/); }
  finally { fs.renameSync(held, tool); }
  assert.equal(fs.readFileSync(file, "utf8"), before, "no refused or read-only command changed memory");
});

const SKILL_EXCLUDES = ["# PenEcho's drawing skill", "**/.claude/skills/penecho-canvas/", "**/.agents/skills/penecho-canvas/", "**/.penecho/drawings/"];
const MEMORY_EXCLUDES = ["# PenEcho's memory skill", "**/.claude/skills/penecho-memory/", "**/.agents/skills/penecho-memory/", "**/.penecho/memory", "**/.penecho/memory.cmd", "**/.penecho/memory.cjs", "**/.penecho/memory-change.json", "**/.MEMORY.md.*.tmp"];
function excludeFile(root) { return git(root, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude"); }
function markedLegacy(root, project, { ownCanvas = false, ownMemory = false } = {}) {
  for (const base of [".claude", ".agents"]) {
    const canvas = path.join(root, base, "skills/penecho-canvas/SKILL.md");
    fs.mkdirSync(path.dirname(canvas), { recursive:true });
    fs.writeFileSync(canvas, ownCanvas && base === ".agents" ? "my own canvas skill" : F.drawingSkill({ name:project.name, drop:path.join(root, ".penecho/drawings") }));
    const memory = path.join(root, base, "skills/penecho-memory/SKILL.md");
    fs.mkdirSync(path.dirname(memory), { recursive:true });
    fs.writeFileSync(memory, ownMemory && base === ".claude" ? "my own memory skill" : M.skillText({ name:project.name, docs:project.docsPath }));
  }
}
function legacySignature(root) {
  const result = { status:git(root, "status", "--porcelain"), exclude:fs.readFileSync(excludeFile(root), "utf8"), paths:[] };
  for (const base of [".claude", ".agents", ".penecho/drawings"]) {
    const dir = path.join(root, base);
    if (!fs.existsSync(dir)) continue;
    const walk = current => { for (const entry of fs.readdirSync(current, { withFileTypes:true })) { const file = path.join(current, entry.name); if (entry.isDirectory()) walk(file); else result.paths.push([path.relative(root, file), fs.readFileSync(file, "utf8")]); } };
    walk(dir);
  }
  result.paths.sort((a, b) => a[0].localeCompare(b[0]));
  return result;
}

test("one-time migration collects pending drops, retires only marked files, and later watches write no legacy files", async t => {
  const { root, home, service } = fixture(t, "migration");
  const code = repo(path.join(root, "code")), project = service.store.create({ name:"Migration", docsPath:path.join(root, "docs"), codePath:code });
  const worktree = addWorktree(code, path.join(root, "worktree"), "side"), recorded = path.join(root, "recorded-stale"), missing = path.join(root, "missing");
  fs.mkdirSync(recorded, { recursive:true }); git(project.docsPath, "init", "-q", "-b", "main");
  project.canvasSkill = true; project.memorySkill = true;
  project.canvasSkillFolders = [project.docsPath, code, worktree, recorded, missing];
  project.memorySkillFolders = [project.docsPath, code, worktree, recorded, missing];
  for (const rootPath of [project.docsPath, code, worktree, recorded]) markedLegacy(rootPath, project, { ownCanvas:rootPath === worktree, ownMemory:rootPath === code });
  for (const [rootPath, name] of [[worktree, "from-worktree.diagram.json"], [recorded, "from-recorded.diagram.json"]]) {
    const drop = path.join(rootPath, ".penecho/drawings"); fs.mkdirSync(drop, { recursive:true });
    fs.writeFileSync(path.join(drop, name), diagram(name)); fs.writeFileSync(path.join(drop, "old.error.txt"), "old mistake");
  }
  const docsDrop = path.join(project.docsPath, ".penecho/drawings"); fs.mkdirSync(docsDrop, { recursive:true }); fs.writeFileSync(path.join(docsDrop, "old.error.txt"), "old");
  const codeExclude = excludeFile(code), docsExclude = excludeFile(project.docsPath);
  fs.writeFileSync(codeExclude, `# mine\r\n${[...SKILL_EXCLUDES, ...MEMORY_EXCLUDES].join("\r\n")}\r\n`); // CRLF excludes are cleaned too.
  fs.writeFileSync(docsExclude, `# docs mine\n${[...SKILL_EXCLUDES, ...MEMORY_EXCLUDES].join("\n")}\n`);

  await service.migrateLegacySkills(project);
  assert.equal(project.skillsMigrated, 1);
  assert.deepEqual(project.canvasSkillFolders, []); assert.deepEqual(project.memorySkillFolders, []);
  assert.ok(fs.existsSync(path.join(home, ".claude/skills", F.LOCAL_SKILL_NAME, "SKILL.md")));
  for (const base of [".claude", ".agents"]) assert.ok(fs.existsSync(path.join(home, base, "skills/penecho-memory/SKILL.md")), `${base} has the shared Memory skill`);
  assert.ok(fs.existsSync(path.join(home, ".penecho/memory-home.cjs")));
  assert.ok(fs.existsSync(path.join(project.docsPath, "files/drawings/from-worktree.diagram.json")), "the worktree drop was collected first");
  assert.ok(fs.existsSync(path.join(project.docsPath, "files/drawings/from-recorded.diagram.json")), "a stale but recorded drop was collected too");
  for (const rootPath of [project.docsPath, code, worktree, recorded]) {
    assert.ok(!fs.existsSync(path.join(rootPath, ".penecho/drawings")), `${rootPath} drop is gone`);
    for (const base of [".claude", ".agents"]) {
      const canvas = path.join(rootPath, base, "skills/penecho-canvas/SKILL.md"), memory = path.join(rootPath, base, "skills/penecho-memory/SKILL.md");
      if (rootPath === worktree && base === ".agents") assert.equal(fs.readFileSync(canvas, "utf8"), "my own canvas skill");
      else assert.ok(!fs.existsSync(canvas), `${canvas} was PenEcho's`);
      if (rootPath === code && base === ".claude") assert.equal(fs.readFileSync(memory, "utf8"), "my own memory skill");
      else assert.ok(!fs.existsSync(memory), `${memory} was PenEcho's`);
    }
  }
  for (const rootPath of [code, worktree, recorded]) assert.ok(!fs.existsSync(path.join(rootPath, ".penecho")), `${rootPath} empty .penecho is gone`);
  for (const name of ["memory", "memory.cmd", "memory.cjs", "topics-guide.md", "ppt-slides.md", "design-prototype.md"]) assert.ok(fs.existsSync(path.join(project.docsPath, ".penecho", name)), `docs tool ${name} stays`);
  const codeText = fs.readFileSync(codeExclude, "utf8"), docsText = fs.readFileSync(docsExclude, "utf8");
  const codeLines = codeText.split(/\r?\n/), docsLines = docsText.split(/\r?\n/);
  assert.match(codeText, /# mine/); for (const line of [...SKILL_EXCLUDES, ...MEMORY_EXCLUDES]) assert.ok(!codeLines.includes(line), `code exclude retired: ${line}`);
  assert.match(docsText, /# docs mine/); for (const line of SKILL_EXCLUDES) assert.ok(!docsLines.includes(line), `docs drawing exclude retired: ${line}`);
  for (const line of MEMORY_EXCLUDES) assert.ok(docsLines.includes(line), `docs memory tools stay ignored: ${line}`);
  const saved = JSON.parse(fs.readFileSync(service.store.file, "utf8")).projects.find(p => p.id === project.id);
  assert.equal(saved.skillsMigrated, 1); assert.deepEqual(saved.canvasSkillFolders, []); assert.deepEqual(saved.memorySkillFolders, []);

  const beforeCode = legacySignature(code), beforeWork = legacySignature(worktree), beforeDocsExclude = fs.readFileSync(docsExclude, "utf8");
  let skillRootCalls = 0, rootsOfCalls = 0, collectCalls = 0;
  service.skillRoots = async () => { skillRootCalls++; return []; };
  service.conversations.rootsOf = async () => { rootsOfCalls++; return []; };
  service.collectDrawings = async () => { collectCalls++; return { failedRoots:[] }; };
  service.makePictures = async () => {};
  await service.migrateLegacySkills(project); // idempotent, and now cannot touch project folders
  await service.addSkill(project); await service.addMemorySkill(project);
  await service.watchProject(project);
  await service.removeSkill(project); await service.removeMemorySkill(project);
  assert.equal(skillRootCalls, 0, "migrated projects never call skillRoots");
  assert.equal(rootsOfCalls, 0, "migrated projects never enumerate worktrees");
  assert.equal(collectCalls, 0, "migrated projects never poll legacy drops");
  assert.deepEqual(legacySignature(code), beforeCode, "code checkout and exclude are byte-for-byte unchanged");
  assert.deepEqual(legacySignature(worktree), beforeWork, "linked worktree is unchanged");
  assert.equal(fs.readFileSync(docsExclude, "utf8"), beforeDocsExclude, "docs Git excludes stay unchanged");
  assert.ok(!fs.existsSync(path.join(project.docsPath, ".penecho/drawings")));
});

test("concurrent helper installations across distinct TMPDIRs never lose a registered projects.json path", async t => {
  const root = path.join(temp, `${++counter}-registry-race`), home = path.join(root, "home"), module = require.resolve("../src/server/project-lines/memory.js");
  fs.mkdirSync(home, { recursive:true }); t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const files = Array.from({ length:8 }, (_, i) => {
    const file = path.join(root, `state-${i}/project-lines/projects.json`);
    fs.mkdirSync(path.dirname(file), { recursive:true });
    fs.writeFileSync(file, JSON.stringify({ version:1, projects:[] }));
    return file;
  });
  await Promise.all(files.map((file, i) => new Promise((resolve, reject) => {
    const childTmp = path.join(root, `tmp-${i}`); fs.mkdirSync(childTmp, { recursive:true });
    const source = `const M=require(${JSON.stringify(module)});M.installUserSkill(${JSON.stringify(home)},[${JSON.stringify(file)}]);`;
    const child = spawn(process.execPath, ["-e", source], { stdio:["ignore", "ignore", "pipe"], env:{ ...process.env, TMPDIR:childTmp, TMP:childTmp } });
    let errors = ""; child.stderr.on("data", data => { errors += data; });
    child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(errors || `installer exited ${code}`)));
  })));
  const registered = JSON.parse(fs.readFileSync(path.join(home, ".penecho/memory-projects.json"), "utf8"));
  assert.deepEqual(new Set(registered), new Set(files), "every process's active store survives the locked read-merge-write across TMPDIRs");
  assert.ok(!fs.existsSync(path.join(home, ".penecho/.memory-projects.lock")), "lock beside registry is cleaned up");
});

test("enable switches are persisted before legacy migration starts", async t => {
  const { root, service } = fixture(t, "enable-before-cleanup"), code = repo(path.join(root, "code"));
  const project = service.store.create({ name:"Enable first", docsPath:path.join(root, "docs"), codePath:code });
  project.canvasSkill = false; project.memorySkill = false; project.canvasSkillFolders = [code]; project.memorySkillFolders = [code]; service.store.save();
  const save = service.store.save.bind(service.store), saves = [];
  service.store.save = () => { save(); const kept = JSON.parse(fs.readFileSync(service.store.file, "utf8")).projects.find(p => p.id === project.id); saves.push({ canvasSkill:kept.canvasSkill, memorySkill:kept.memorySkill, skillsMigrated:kept.skillsMigrated }); };
  await service.addSkill(project);
  assert.equal(saves[0].canvasSkill, true, "standalone drawing is enabled in projects.json before cleanup");
  assert.notEqual(saves[0].skillsMigrated, 1, "the first save precedes migration");
  project.memorySkill = false; project.skillsMigrated = undefined; project.canvasSkillFolders = [code]; project.memorySkillFolders = [code]; service.store.save(); saves.length = 0;
  await service.addMemorySkill(project);
  assert.equal(saves[0].memorySkill, true, "the offline helper sees memory enabled before cleanup");
  assert.notEqual(saves[0].skillsMigrated, 1, "the Memory enable save also precedes migration");
});

test("every registered docs root keeps its memory ignores when projects share Git worktrees", async t => {
  const { root, service } = fixture(t, "shared-docs-code-exclude"), code = repo(path.join(root, "code"));
  const a = service.store.create({ name:"Shared docs", docsPath:path.join(root, "docs-a"), codePath:code });
  const seed = `${a.docsPath}-seed`; fs.renameSync(a.docsPath, seed);
  addWorktree(code, a.docsPath, "docs-worktree");
  fs.cpSync(seed, a.docsPath, { recursive:true }); fs.rmSync(seed, { recursive:true, force:true });
  const codeB = addWorktree(code, path.join(root, "code-b"), "code-b"), b = service.store.create({ name:"Other project", docsPath:path.join(root, "docs-b"), codePath:codeB });
  for (const [project, roots] of [[a, [a.docsPath, code]], [b, [b.docsPath, codeB]]]) {
    project.canvasSkill = true; project.memorySkill = true; project.canvasSkillFolders = roots; project.memorySkillFolders = roots;
  }
  const shared = excludeFile(code);
  assert.equal(excludeFile(a.docsPath), shared, "both worktrees use the common Git exclude");
  fs.writeFileSync(shared, [...SKILL_EXCLUDES, ...MEMORY_EXCLUDES].join("\n") + "\n");
  await service.migrateLegacySkills(a);
  fs.writeFileSync(shared, [...SKILL_EXCLUDES, ...MEMORY_EXCLUDES].join("\n") + "\n");
  await service.migrateLegacySkills(b); // another project's code worktree must not strip A's docs ignores either
  const kept = fs.readFileSync(shared, "utf8").split("\n");
  for (const line of SKILL_EXCLUDES) assert.ok(!kept.includes(line), `drawing exclude retired: ${line}`);
  for (const line of MEMORY_EXCLUDES) assert.ok(kept.includes(line), `registered docs memory exclude survives every project's cleanup: ${line}`);
  assert.ok(fs.existsSync(path.join(a.docsPath, ".penecho/memory.cjs")));
});

test("omitted home grants no writes to user home and defers legacy migration", async t => {
  const root = path.join(temp, `${++counter}-omitted-home`), directory = path.join(root, "state");
  fs.mkdirSync(directory, { recursive:true });
  const service = new Service({ directory, agents, autoWatch:false });
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  assert.equal(service.home, "", "omitting home leaves this.home empty");
  const code = repo(path.join(root, "code")), project = service.store.create({ name:"NoHome", docsPath:path.join(root, "docs"), codePath:code });
  markedLegacy(code, project);
  project.canvasSkill = true; project.canvasSkillFolders = [code]; project.memorySkillFolders = [code]; service.store.save();
  await service.watchProject(project);
  assert.notEqual(project.skillsMigrated, 1, "legacy cleanup is deferred without an explicit home");
  assert.ok(fs.existsSync(path.join(code, ".claude/skills/penecho-canvas/SKILL.md")), "legacy skill stays when home is omitted");
});

test("migration never steals another project's sibling-worktree drops and avoids fallback basename collisions", async t => {
  const { root, service } = fixture(t, "sibling-drops");
  const codeA = repo(path.join(root, "code-a"));
  const codeB = addWorktree(codeA, path.join(root, "code-b"), "branch-b");
  const workA2 = addWorktree(codeA, path.join(root, "work-a2"), "branch-a2");
  const a = service.store.create({ name:"Alpha", docsPath:path.join(root, "docs-a"), codePath:codeA });
  const b = service.store.create({ name:"Beta", docsPath:path.join(root, "docs-b"), codePath:codeB });
  a.canvasSkill = true; b.canvasSkill = true;
  // Drop in B's checkout, in ambiguous sibling worktree, and colliding basenames in A's own roots.
  for (const [dir, title] of [[codeB, "From B"], [workA2, "From Ambiguous"], [a.docsPath, "A Docs"], [codeA, "A Code"]]) {
    const drop = path.join(dir, ".penecho/drawings"); fs.mkdirSync(drop, { recursive:true });
    fs.writeFileSync(path.join(drop, "same.diagram.json"), diagram(title));
  }
  await service.migrateLegacySkills(a);
  assert.ok(fs.existsSync(path.join(codeB, ".penecho/drawings/same.diagram.json")), "A must not steal or delete B's drop");
  assert.ok(fs.existsSync(path.join(workA2, ".penecho/drawings/same.diagram.json")), "A must not steal an ambiguous sibling worktree drop");
  const aDrawings = fs.readdirSync(path.join(a.docsPath, "files/drawings")).filter(n => n.endsWith(".diagram.json")).sort();
  assert.equal(aDrawings.length, 2, "both colliding A drops survive with unique names");
  const texts = aDrawings.map(n => fs.readFileSync(path.join(a.docsPath, "files/drawings", n), "utf8")).join("\n");
  assert.match(texts, /A Docs/); assert.match(texts, /A Code/);
  assert.doesNotMatch(texts, /From B/); assert.doesNotMatch(texts, /From Ambiguous/);
});

test("migration rejects symlinked ancestor directories and preserves user exclude rules outside PenEcho blocks", async t => {
  const { root, service } = fixture(t, "symlink-and-exclude-block");
  const code = repo(path.join(root, "code")), outside = path.join(root, "outside-target");
  fs.mkdirSync(path.join(outside, "penecho-canvas"), { recursive:true });
  const victim = path.join(outside, "penecho-canvas/SKILL.md");
  fs.writeFileSync(victim, F.drawingSkill({ name:"Victim", drop:"/tmp/x" }));
  const project = service.store.create({ name:"Safe", docsPath:path.join(root, "docs"), codePath:code });
  project.canvasSkill = true;
  fs.mkdirSync(path.join(code, ".claude"), { recursive:true });
  fs.symlinkSync(outside, path.join(code, ".claude/skills"), "dir");
  const exclude = excludeFile(code);
  fs.writeFileSync(exclude, `# hand maintained\n**/.claude/skills/penecho-canvas/\n${SKILL_EXCLUDES.join("\n")}\n# keep tail\n`);
  await service.migrateLegacySkills(project);
  assert.ok(fs.existsSync(victim), "symlinked .claude/skills must never delete files outside checkout");
  assert.notEqual(project.skillsMigrated, 1, "symlink rejection marks migration incomplete for inspection/retry");
  const excludeAfter = fs.readFileSync(exclude, "utf8").split(/\r?\n/);
  assert.ok(excludeAfter.includes("**/.claude/skills/penecho-canvas/"), "hand-maintained matching rule outside PenEcho block stays");
  assert.ok(!excludeAfter.includes("# PenEcho's drawing skill"), "PenEcho drawing block header is removed");
  assert.ok(excludeAfter.includes("# keep tail"));
});

test("migration keeps legacy copies when replacement cannot install and retains failed drops", async t => {
  const { root, home, service } = fixture(t, "replacement-unavailable");
  const code = repo(path.join(root, "code")), project = service.store.create({ name:"KeepOld", docsPath:path.join(root, "docs"), codePath:code });
  project.canvasSkill = true; project.memorySkill = true;
  markedLegacy(code, project);
  // Both user-level drawing destinations are occupied by unmarked user skills -> installUserSkill returns installed: false.
  for (const base of [".claude", ".agents"]) {
    const file = path.join(home, base, "skills", F.LOCAL_SKILL_NAME, "SKILL.md");
    fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, "my own local canvas skill");
  }
  await service.migrateLegacySkills(project);
  assert.notEqual(project.skillsMigrated, 1, "cannot mark migrated while replacement is unavailable");
  assert.ok(fs.existsSync(path.join(code, ".claude/skills/penecho-canvas/SKILL.md")), "legacy drawing skill stays active when replacement cannot install");
  assert.ok(!fs.existsSync(path.join(code, ".claude/skills/penecho-memory/SKILL.md")), "memory replacement succeeded so memory legacy copy retires");
  // Now test invalid drop retention: even when replacement is available, an uncollected invalid drop keeps the root for retry.
  for (const base of [".claude", ".agents"]) fs.rmSync(path.join(home, base, "skills", F.LOCAL_SKILL_NAME), { recursive:true, force:true });
  const drop = path.join(code, ".penecho/drawings"); fs.mkdirSync(drop, { recursive:true });
  fs.writeFileSync(path.join(drop, "broken.diagram.json"), "{ invalid json");
  await service.migrateLegacySkills(project, { force:true });
  assert.notEqual(project.skillsMigrated, 1, "invalid uncollected drop keeps migration incomplete");
  assert.ok(project.canvasSkillFolders.includes(code), "failed root stays recorded for retry");
});

test("memory helper refuses conflicting registries, ignores ambient GIT_DIR, handles root paths, strict --cwd parsing, and never executes project memory.cjs", async t => {
  const { root, home, service } = fixture(t, "memory-hardening");
  const code = repo(path.join(root, "code")), otherRepo = repo(path.join(root, "other-repo"));
  const project = service.store.create({ name:"Hardened", docsPath:path.join(root, "docs"), codePath:code });
  await service.addMemorySkill(project);
  service.close();

  // P2-1: Tampering docsPath/.penecho/memory.cjs must NEVER execute when running the shared helper.
  const sentinel = path.join(root, "pwned.txt");
  fs.writeFileSync(path.join(project.docsPath, ".penecho/memory.cjs"), `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "ran"); module.exports = { main: () => 0 };`);
  ok(memory(home, code, "show"), "show runs trusted memory-core.cjs");
  assert.ok(!fs.existsSync(sentinel), "project-local memory.cjs was never required or executed");

  // P2-2: Root-safe inside() and ambient GIT_DIR scrubbing.
  const homeMod = require("../src/server/project-lines/memory-home.cjs");
  assert.equal(homeMod.inside("/foo/bar", "/"), true);
  assert.equal(homeMod.inside("/foobar", "/foo"), false);
  const nonGit = path.join(root, "non-git-dir"); fs.mkdirSync(nonGit);
  const withGitDir = spawnSync("sh", [path.join(home, ".penecho/memory"), "--cwd", nonGit, "where"], {
    encoding:"utf8",
    env:{ ...process.env, HOME:home, GIT_DIR:path.join(code, ".git"), GIT_COMMON_DIR:path.join(code, ".git") },
  });
  assert.equal(withGitDir.status, 1, "ambient GIT_DIR must not hijack non-git folder into project");
  assert.match(withGitDir.stderr, /No non-archived PenEcho project/);

  // P2-3: Strict pre-verb --cwd parsing preserves post-verb --cwd= text and rejects empty/repeated --cwd.
  ok(memory(home, code, "add", "Facts", "--cwd=flag text survives verbatim (PE-401, 2026-11-21)"), "post-verb --cwd= preserved");
  assert.ok(entries(project.docsPath).Facts.includes("--cwd=flag text survives verbatim (PE-401, 2026-11-21)"));
  assert.equal(spawnSync("sh", [path.join(home, ".penecho/memory"), "--cwd=", "show"], { encoding:"utf8", env:{ ...process.env, HOME:home } }).status, 2);
  assert.equal(spawnSync("sh", [path.join(home, ".penecho/memory"), "--cwd", code, "--cwd", otherRepo, "show"], { encoding:"utf8", env:{ ...process.env, HOME:home } }).status, 2);

  // P1-5: Conflicting registries (archived vs active, disabled vs enabled) refuse cleanly; identical registries collapse.
  const reg2 = path.join(root, "state-2/projects.json");
  fs.mkdirSync(path.dirname(reg2), { recursive:true });
  const baseData = JSON.parse(fs.readFileSync(service.store.file, "utf8"));
  fs.writeFileSync(reg2, JSON.stringify(baseData));
  fs.writeFileSync(path.join(home, ".penecho/memory-projects.json"), JSON.stringify([service.store.file, reg2]));
  assert.match(ok(memory(home, code, "where"), "identical claims collapse cleanly").stdout, /Project: Hardened/);

  const archivedCopy = structuredClone(baseData);
  archivedCopy.projects[0].archived = true;
  fs.writeFileSync(reg2, JSON.stringify(archivedCopy));
  const conflictArch = memory(home, code, "add", "Facts", "Must not land (PE-402, 2026-11-21)");
  assert.equal(conflictArch.status, 1);
  assert.match(conflictArch.stderr, /Conflicting PenEcho project entries/);

  const disabledCopy = structuredClone(baseData);
  disabledCopy.projects[0].memorySkill = false;
  fs.writeFileSync(reg2, JSON.stringify(disabledCopy));
  const conflictDis = memory(home, code, "show");
  assert.equal(conflictDis.status, 1);
  assert.match(conflictDis.stderr, /Conflicting PenEcho project entries/);

  // Deeper stale active code root must NOT shadow a shallower archived entry for the same project id/docsPath.
  const sub = path.join(code, "packages/sub"); fs.mkdirSync(sub, { recursive:true });
  const deeperActive = structuredClone(baseData);
  deeperActive.projects[0].codePaths = [sub];
  const shallowerArchived = structuredClone(baseData);
  shallowerArchived.projects[0].archived = true;
  const reg3 = path.join(root, "state-3/projects.json");
  fs.mkdirSync(path.dirname(reg3), { recursive:true });
  fs.writeFileSync(reg2, JSON.stringify(deeperActive));
  fs.writeFileSync(reg3, JSON.stringify(shallowerArchived));
  fs.writeFileSync(path.join(home, ".penecho/memory-projects.json"), JSON.stringify([reg2, reg3]));
  const shadowedConflict = memory(home, sub, "show");
  assert.equal(shadowedConflict.status, 1);
  assert.match(shadowedConflict.stderr, /Conflicting PenEcho project entries/);
});

test("migration protects skipped sibling excludes, rejects symlinked error sidecars, retains EACCES exclude failures, and preserves global drawing opt-out on memory enable", async t => {
  const { root, home, service } = fixture(t, "work5-residuals");
  const codeA = repo(path.join(root, "code-a"));
  const codeB = addWorktree(codeA, path.join(root, "code-b"), "branch-b");
  const a = service.store.create({ name:"Alpha", docsPath:path.join(root, "docs-a"), codePath:codeA });
  const b = service.store.create({ name:"Beta", docsPath:path.join(root, "docs-b"), codePath:codeB });
  a.canvasSkill = true; a.memorySkill = true; b.canvasSkill = true; b.memorySkill = true;
  markedLegacy(codeA, a);
  markedLegacy(codeB, b);
  const sharedExclude = excludeFile(codeA);
  fs.writeFileSync(sharedExclude, `${[...SKILL_EXCLUDES, ...MEMORY_EXCLUDES].join("\n")}\n`);

  // 1. Migrating A while skipped sibling B still has legacy skill files keeps the shared exclude blocks protecting B.
  await service.migrateLegacySkills(a);
  assert.ok(!fs.existsSync(path.join(codeA, ".claude/skills/penecho-canvas/SKILL.md")));
  assert.ok(fs.existsSync(path.join(codeB, ".claude/skills/penecho-canvas/SKILL.md")));
  const afterA = fs.readFileSync(sharedExclude, "utf8").split(/\r?\n/);
  assert.ok(afterA.includes("# PenEcho's drawing skill"), "shared drawing exclude stays while skipped sibling B still has legacy files");
  assert.ok(afterA.includes("# PenEcho's memory skill"), "shared memory exclude stays while skipped sibling B still has legacy files");

  // 2. Symlinked .error.txt sidecar is never written through when collecting an invalid drop.
  const outsideSecret = path.join(root, "outside-secret.txt");
  fs.writeFileSync(outsideSecret, "DO NOT OVERWRITE");
  const dropB = path.join(codeB, ".penecho/drawings"); fs.mkdirSync(dropB, { recursive:true });
  fs.writeFileSync(path.join(dropB, "bad.diagram.json"), "{ broken");
  fs.symlinkSync(outsideSecret, path.join(dropB, "bad.diagram.json.error.txt"));
  const collected = await service.collectDrawings(b, { now:true, roots:[codeB], force:true });
  assert.equal(fs.readFileSync(outsideSecret, "utf8"), "DO NOT OVERWRITE", "symlinked .error.txt sidecar must never be written through");
  assert.ok(collected.failedRoots.includes(codeB), "symlinked sidecar marks drop collection failed");
  fs.rmSync(path.join(dropB, "bad.diagram.json"), { force:true });
  fs.unlinkSync(path.join(dropB, "bad.diagram.json.error.txt"));

  // 3. Unreadable info/exclude (EACCES) prevents marking migration complete (POSIX).
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    fs.chmodSync(sharedExclude, 0o000);
    try {
      await service.migrateLegacySkills(b, { force:true });
      assert.notEqual(b.skillsMigrated, 1, "EACCES reading info/exclude must not mark migration complete");
      assert.ok(b.canvasSkillFolders.includes(codeB) || b.memorySkillFolders.includes(codeB), "failed root retained for retry");
    } finally {
      fs.chmodSync(sharedExclude, 0o644);
    }
  }

  // 4. Enabling Memory on a project with unfinished Drawing migration must NOT clear global Drawing opt-out.
  const { removeUserSkill, userSkillStatus } = require("../src/server/draw.js");
  removeUserSkill(home);
  assert.equal(userSkillStatus(home).installed, false);
  b.skillsMigrated = 0; b.canvasSkill = true; b.canvasSkillFolders = [codeB];
  await service.addMemorySkill(b);
  assert.equal(userSkillStatus(home).installed, false, "addMemorySkill must not force-reinstall globally uninstalled Drawing skill");
});
