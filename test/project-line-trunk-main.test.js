"use strict";
require("./helpers/safety.js");
// PE-520: the home's trunk is the project's main branch, and every line keeps its own branch, so checking out a branch in the code folder moves nothing.
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const F = require("../src/server/project-lines/format.js");
const { Service } = require("../src/server/project-lines/service.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-trunk-main-"));
test.after(() => fs.rmSync(temp, { recursive:true, force:true }));
const gitIn = (cwd, ...args) => execFileSync("git", args, { cwd, encoding:"utf8", stdio:["ignore", "pipe", "pipe"] }).trim();
const commitOn = (code, branch, file) => { gitIn(code, "checkout", "-q", branch); fs.writeFileSync(path.join(code, file), `${file}\n`); gitIn(code, "add", "-A"); gitIn(code, "commit", "-q", "-m", file); };
let n = 0;
function setup(first = "main") {
  const code = path.join(temp, `code-${++n}`), docs = path.join(temp, `docs-${n}`), directory = path.join(temp, `state-${n}`);
  fs.mkdirSync(code, { recursive:true }); fs.mkdirSync(directory, { recursive:true });
  gitIn(code, "init", "-q", "-b", first); gitIn(code, "config", "user.name", "Test"); gitIn(code, "config", "user.email", "test@example.com");
  fs.writeFileSync(path.join(code, "README.md"), "hello\n"); gitIn(code, "add", "-A"); gitIn(code, "commit", "-q", "-m", "first");
  const service = new Service({ directory, agents:{ list:() => [] }, autoWatch:false });
  const project = service.store.create({ name:"Demo", docsPath:docs, codePath:code });
  fs.mkdirSync(path.join(docs, "lines"), { recursive:true });
  const line = (slug, front) => fs.writeFileSync(path.join(docs, "lines", `${slug}.md`), `---\n${Object.entries({ code, ...front }).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n# ${slug}\n\n## Ask · 2026-11-08 10:00\n\nDo ${slug}.\n\n## [x] Work 1 · @fake\n\nDid ${slug}.\n`);
  const home = async () => { await service.refreshTrunk(project); service.changed(project); const s = service.stateOf(project); return { trunk:s.project.trunk, here:s.project.here, on:Object.fromEntries(s.lines.map(l => [l.slug, l.branch || s.project.trunk])) }; };
  return { service, project, code, docs, line, home };
}

test("the trunk stays main while the folder is on another branch, and a checkout moves no line", async () => {
  const { service, code, line, home } = setup();
  gitIn(code, "branch", "codex/release"); commitOn(code, "codex/release", "r.txt");
  gitIn(code, "branch", "gone"); gitIn(code, "branch", "work/a");
  line("made-on-main", { status:"done", base:"main" });
  line("made-on-release", { status:"done", base:"codex/release" });
  line("own-branch", { status:"ready", branch:"work/a", base:"codex/release" });
  line("very-old", { status:"done" });
  line("on-a-gone-branch", { status:"done", base:"gone" });
  gitIn(code, "branch", "-D", "gone");
  const before = await home();
  assert.equal(before.trunk, "main");
  assert.equal(before.here, "codex/release");
  assert.deepEqual(before.on, { "made-on-main":"main", "made-on-release":"codex/release", "own-branch":"work/a", "very-old":"main", "on-a-gone-branch":"main" });
  gitIn(code, "checkout", "-q", "main");
  const after = await home();
  assert.equal(after.trunk, "main");
  assert.equal(after.here, "main");
  assert.deepEqual(after.on, before.on, "nothing moved");
  service.close();
});

test("the remote's default branch is the trunk; with no main, master or default the folder's branch still is", async () => {
  const one = setup("develop");
  gitIn(one.code, "branch", "main"); gitIn(one.code, "checkout", "-q", "-b", "feature");
  gitIn(one.code, "update-ref", "refs/remotes/origin/develop", "HEAD"); gitIn(one.code, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop");
  assert.equal(await one.service.refreshTrunk(one.project), "develop");
  one.service.close();
  const two = setup("trunk");
  gitIn(two.code, "checkout", "-q", "-b", "elsewhere");
  assert.equal(await two.service.refreshTrunk(two.project), "elsewhere");
  two.service.close();
});

test("the box: nothing chosen is your folder's branch, main chosen from another branch makes a line on main", async () => {
  const { service, project, code, home } = setup();
  gitIn(code, "checkout", "-q", "-b", "codex/release");
  await service.refreshTrunk(project);
  assert.deepEqual(await service.chosenBranch(project, {}), {});
  assert.deepEqual(await service.chosenBranch(project, { branch:"codex/release" }), {});
  assert.deepEqual(await service.chosenBranch(project, { branch:"main" }), { branch:"main" });
  const here = await service.saveUnsent(project, { text:"In my folder", topic:"new" });
  const trunk = await service.saveUnsent(project, { text:"On main please", topic:"new", branch:"main" });
  const doc = slug => F.parseLine(service.readDoc(project, slug)).front;
  assert.equal(doc(here.slug).base, "codex/release");
  assert.equal(doc(trunk.slug).base, "main");
  assert.ok(!doc(trunk.slug).branch, "a line on the trunk names no branch of its own");
  const { on } = await home();
  assert.equal(on[here.slug], "codex/release");
  assert.equal(on[trunk.slug], "main");
  service.close();
});

test("a line goes on working on its own branch after the folder moves to another", async () => {
  const { service, project, code, line } = setup();
  gitIn(code, "branch", "codex/release");
  line("made-on-release", { status:"done", base:"codex/release" });
  line("made-on-main", { status:"done", base:"main" });
  await service.refreshTrunk(project);
  const place = slug => service.placeForLine(project, slug, F.parseLine(service.readDoc(project, slug)));
  const onMain = await place("made-on-main");
  assert.deepEqual(onMain, { branch:"main", folder:code }, "the folder is on main, so that line works there");
  const away = await place("made-on-release");
  assert.equal(away.branch, "codex/release");
  assert.notEqual(away.folder, code, "release has a folder of its own, and the person's folder stays on main");
  assert.equal(gitIn(away.folder, "symbolic-ref", "--short", "HEAD"), "codex/release");
  assert.equal(gitIn(code, "symbolic-ref", "--short", "HEAD"), "main");
  service.close();
});

test("checking out a branch that holds another one archives nothing, even for a line that names no base", async () => {
  const { service, project, code, line } = setup();
  gitIn(code, "branch", "work/c"); commitOn(code, "work/c", "c.txt");
  line("synced", { status:"ready", branch:"work/c" });
  gitIn(code, "checkout", "-q", "-b", "try/on-top", "work/c");
  await service.refreshTrunk(project);
  assert.equal(await service.landMergedBranches(project, service.store.scan(project).topics), false);
  assert.equal(F.parseLine(service.readDoc(project, "synced")).status, "ready");
  service.close();
});
