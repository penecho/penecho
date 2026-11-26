"use strict";
require("./helpers/safety.js");
// A branch merged into main by anyone takes every Finished line on it to the Archive. Lines still going stay, and so does anything on a branch that never had work of its own.
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const F = require("../src/server/project-lines/format.js");
const { Service } = require("../src/server/project-lines/service.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-merged-branch-"));
test.after(() => fs.rmSync(temp, { recursive:true, force:true }));
const gitIn = (cwd, ...args) => execFileSync("git", args, { cwd, encoding:"utf8", stdio:["ignore", "pipe", "pipe"] }).trim();
const commitOn = (code, branch, file) => { gitIn(code, "checkout", "-q", branch); fs.writeFileSync(path.join(code, file), `${file}\n`); gitIn(code, "add", "-A"); gitIn(code, "commit", "-q", "-m", file); gitIn(code, "checkout", "-q", "main"); };
let n = 0;
function setup() {
  const code = path.join(temp, `code-${++n}`), docs = path.join(temp, `docs-${n}`), directory = path.join(temp, `state-${n}`);
  fs.mkdirSync(code, { recursive:true }); fs.mkdirSync(directory, { recursive:true });
  gitIn(code, "init", "-q", "-b", "main"); gitIn(code, "config", "user.name", "Test"); gitIn(code, "config", "user.email", "test@example.com");
  fs.writeFileSync(path.join(code, "README.md"), "hello\n"); gitIn(code, "add", "-A"); gitIn(code, "commit", "-q", "-m", "first");
  const service = new Service({ directory, agents:{ list:() => [] }, autoWatch:false });
  const project = service.store.create({ name:"Demo", docsPath:docs, codePath:code });
  fs.mkdirSync(path.join(docs, "lines"), { recursive:true });
  const line = (slug, front) => fs.writeFileSync(path.join(docs, "lines", `${slug}.md`), `---\n${Object.entries({ base:"main", ...front }).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n# ${slug}\n\n## Ask · 2026-11-08 10:00\n\nDo ${slug}.\n\n## [x] Work 1 · @fake\n\nDid ${slug}.\n`);
  const look = async () => { await service.refreshTrunk(project); return service.landMergedBranches(project, service.store.scan(project).topics); };
  const status = slug => F.parseLine(service.readDoc(project, slug));
  return { service, project, code, line, look, status };
}

test("merged by hand into main, the branch's Finished lines go to the Archive and the rest stay", async () => {
  const { service, code, line, look, status } = setup();
  gitIn(code, "branch", "work/a"); commitOn(code, "work/a", "a.txt");
  gitIn(code, "branch", "work/fresh");
  line("a1", { status:"ready", branch:"work/a" });
  line("a2", { status:"ready", branch:"work/a" });
  line("a3", { status:"waiting", why:"Not sent", branch:"work/a" });
  line("a4", { status:"stopped", branch:"work/a" });
  line("f1", { status:"ready", branch:"work/fresh" });
  assert.equal(await look(), false, "nothing is merged yet");
  assert.equal(status("a1").status, "ready");

  gitIn(code, "merge", "-q", "--no-ff", "-m", "by hand", "work/a");
  assert.equal(await look(), true);
  const merge = gitIn(code, "rev-parse", "--short", "HEAD");
  for (const slug of ["a1", "a2"]) {
    const doc = status(slug);
    assert.equal(doc.status, "landed", `${slug} goes to the Archive`);
    assert.equal(doc.front.commit, merge, "as Merged, with the commit Git shows");
    assert.equal(doc.steps.at(-1).kind, "merge");
    assert.match(doc.steps.at(-1).body, new RegExp(`Merged into main as ${merge}`));
  }
  assert.equal(status("a3").status, "waiting", "a line not sent stays");
  assert.equal(status("a4").status, "stopped", "a stopped line stays");
  assert.equal(status("f1").status, "ready", "a branch with no work of its own is in main from the start, and is not merged");
  assert.equal(await look(), false, "asked again only when a branch moves");
  service.close();
});

test("a fast-forward counts as merged too", async () => {
  const { service, code, line, look, status } = setup();
  gitIn(code, "branch", "work/b"); commitOn(code, "work/b", "b.txt");
  line("b1", { status:"ready", branch:"work/b" });
  gitIn(code, "merge", "-q", "--ff-only", "work/b");
  await look();
  assert.equal(status("b1").status, "landed");
  service.close();
});

test("checking out another branch in the code folder archives nothing", async () => {
  const { service, code, line, look, status } = setup();
  gitIn(code, "branch", "work/c"); commitOn(code, "work/c", "c.txt");
  line("c1", { status:"ready", branch:"work/c" });
  gitIn(code, "checkout", "-q", "-b", "try/on-top", "work/c");
  assert.equal(await look(), false);
  assert.equal(status("c1").status, "ready");
  service.close();
});

test("before Merge is clicked, the panel says which lines go to the Archive and which stay", () => {
  const ctx = { esc:x => String(x), ic:name => `<i>${name}</i>`, console, addEventListener:() => {}, localStorage:{ getItem:() => null, setItem:() => {} }, location:{ hash:"", pathname:"/" }, document:{ addEventListener:() => {} } };
  vm.createContext(ctx);
  ctx.LINE_STATUS = require('../public/lines/line-status.js');
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/lines/state.js"), "utf8"), ctx);
  const l = (id, status, extra = {}) => ({ id, title:id, status, branch:"work/a", base:"main", stations:[], ...extra });
  const me = l("mine", "ready"), p = { trunk:"main", lines:[me, l("done too", "ready"), l("not sent", "waiting", { stations:[{ unsent:true }] }), l("going", "working"), l("merge ask", "waiting", { mergeOf:"mine" }), { ...l("elsewhere", "ready"), branch:"work/b" }] };
  const html = vm.runInContext("mergeOutcomeHTML", ctx)(p, me);
  assert.match(html, /Once <code>work\/a<\/code> is in <code>main<\/code>/);
  assert.match(html, /2 lines go to the Archive after merging<\/h4><ul><li><span>mine<\/span><\/li><li><span>done too<\/span><\/li><\/ul>/);
  assert.match(html, /2 stay on the home<\/h4><ul><li><span>not sent<\/span><em>Not sent<\/em><\/li><li><span>going<\/span><em>Working<\/em><\/li><\/ul>/);
  assert.doesNotMatch(html, /merge ask|elsewhere/);
});
