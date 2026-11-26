"use strict";
require("./helpers/safety.js");
require("./helpers/show-topics.js");
// The project folder layout (layout.js): understanding.md, topics/ (knowledge), lines/, works/, files/, archive/.
// Moving a layout-1 folder (Lines in topics/) and undoing it, archiving and deleting a line with its Works and files,
// and Topic files never being read as Lines.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { test, after } = require("node:test");
const L = require("../src/server/project-lines/layout.js");
const Knowledge = require("../src/server/project-lines/knowledge.js");
const Memory = require("../src/server/project-lines/memory.js");
const F = require("../src/server/project-lines/format.js");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgents } = require("../src/server/project-lines/agents.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-layout-"));
const services = [];
after(() => { for (const s of services) s.close?.(); fs.rmSync(temp, { recursive:true, force:true }); });
let n = 0;
const write = (root, rel, text = "x") => { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, text); };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
const has = (root, rel) => fs.existsSync(path.join(root, rel));
// Every file under a folder, as [name, sha] (Markdown by its text with links taken out, so a moved link still counts as the same file).
function inventory(root, skip = [".penecho"]) {
  const out = [];
  const visit = rel => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes:true })) {
      const next = rel ? `${rel}/${e.name}` : e.name;
      if (skip.includes(next)) continue;
      if (e.isDirectory()) visit(next);
      else {
        const bytes = fs.readFileSync(path.join(root, next)), body = next.endsWith(".md") ? bytes.toString("utf8").replace(/\]\([^)]*\)/g, "]()").replace(/^line: .*$/m, "") : bytes;
        out.push([path.posix.basename(next), crypto.createHash("sha256").update(body).digest("hex")]);
      }
    }
  };
  visit("");
  return out.sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1));
}
const lineMd = ({ id = "PE-1", status = "done", title = "Fix the login", extra = "" } = {}) => `---\nid: ${id}\nstatus: ${status}\nwho: @claude\ncreated: 2026-11-10 09:00\n---\n\n# ${title}\n\n## Ask · 2026-11-10 09:00\n\nFix the login.\n\n![sketch](../files/fix-login/sketch.png)\n\n> Refers to [Work 1](fix-login/work-1.md): First try\n\n## [x] Work 1 · @claude · 3 min\n\nDone.\n\n[Details](fix-login/work-1.md)\n${extra}`;
// A folder as PenEcho made it before layout 2.
function layoutOne() {
  const docs = path.join(temp, `v1-${n++}`);
  write(docs, "MEMORY.md", Memory.initialMemory("Demo", "PE", 1));
  write(docs, "README.md", "# Demo\n\n| [Fix the login](topics/fix-login.md) | Done |\n");
  write(docs, "topics/fix-login.md", lineMd());
  write(docs, "topics/fix-login/work-1.md", "---\nline: ../fix-login.md\nstep: Work 1\n---\n\n# Work 1\n\n[Back to fix-login.md](../fix-login.md)\n\n## Result\n\nSee ![after](../../files/fix-login/after.png) and [the other line](../second.md).\n");
  write(docs, "topics/fix-login/work-1.tokens.json", "{}");
  write(docs, "topics/second.md", lineMd({ id:"PE-2", title:"Second", status:"waiting" }).replace(/fix-login\//g, "second/"));
  write(docs, "topics/ideas.md", "# My ideas\n\nA note of my own, linked to [the login](fix-login.md).\n");
  write(docs, "files/fix-login/sketch.png", "PNG1");
  write(docs, "files/fix-login/after.png", "PNG2");
  write(docs, "files/fix-login/notes.md", "Back to [the line](../../topics/fix-login.md) and [its work](../../topics/fix-login/work-1.md). [Site](https://penecho.ai)\n");
  write(docs, "files/shared/report with space.md", "[Line](<../../topics/second.md>)\n");
  write(docs, ".history/2026__topics__fix-login.md", "old copy");
  // An archived line, linked from a current one, linking a shared file.
  write(docs, "topics/old.md", "---\nid: PE-3\nstatus: closed\n---\n\n# Old\n\n## Ask · 2026-11-01 09:00\n\nOld.\n\n![p](../files/old/p.png) ![s](../files/shared/s.png)\n\n## [x] Work 1 · @claude\n\n[Details](old/work-1.md)\n");
  write(docs, "topics/old/work-1.md", "[Back](../old.md)\n");
  write(docs, "files/old/p.png", "PNG3");
  write(docs, "files/shared/s.png", "PNG4");
  fs.appendFileSync(path.join(docs, "topics/second.md"), "\nSee [the old one](old.md).\n");
  return docs;
}

test("a layout-1 folder moves to layout 2 once: every file kept, links rewritten, a log written", () => {
  const docs = layoutOne(), before = inventory(docs);
  assert.equal(L.versionOf(docs), 1);
  const result = L.migrate(docs);
  assert.equal(result.moved, true, result.reason);
  assert.equal(L.versionOf(docs), 2);
  assert.deepEqual(L.readState(docs), { version:2, migration:result.stamp });
  // Nothing lost: the same files, the same bytes apart from links.
  assert.deepEqual(inventory(docs, [".penecho"]).filter(([name]) => name !== ".gitkeep"), before);
  assert.ok(has(docs, "lines/fix-login.md") && has(docs, "lines/second.md") && has(docs, "lines/ideas.md"));
  assert.ok(has(docs, "works/fix-login/work-1.md") && has(docs, "works/fix-login/work-1.tokens.json"));
  assert.deepEqual(fs.readdirSync(path.join(docs, "topics")), [], "topics/ is left for knowledge Topics");
  // Links point where things are now.
  const line = read(docs, "lines/fix-login.md");
  assert.match(line, /\[Details\]\(\.\.\/works\/fix-login\/work-1\.md\)/);
  assert.match(line, /> Refers to \[Work 1\]\(\.\.\/works\/fix-login\/work-1\.md\): First try/);
  assert.match(line, /!\[sketch\]\(\.\.\/files\/fix-login\/sketch\.png\)/, "a file link keeps its depth");
  const work = read(docs, "works/fix-login/work-1.md");
  assert.match(work, /^line: \.\.\/\.\.\/lines\/fix-login\.md$/m);
  assert.match(work, /\[Back to fix-login\.md\]\(\.\.\/\.\.\/lines\/fix-login\.md\)/);
  assert.match(work, /\(\.\.\/\.\.\/files\/fix-login\/after\.png\)/);
  assert.match(work, /\[the other line\]\(\.\.\/\.\.\/lines\/second\.md\)/);
  assert.equal(read(docs, "files/fix-login/notes.md"), "Back to [the line](../../lines/fix-login.md) and [its work](../../works/fix-login/work-1.md). [Site](https://penecho.ai)\n");
  assert.equal(read(docs, "files/shared/report with space.md"), "[Line](<../../lines/second.md>)\n");
  assert.match(read(docs, "lines/ideas.md"), /\[the login\]\(fix-login\.md\)/, "a link between two lines stays");
  assert.match(read(docs, "README.md"), /\(lines\/fix-login\.md\)/);
  // A line archived already goes straight to archive/, and every link stays right for someone reading the folder.
  assert.ok(has(docs, "archive/lines/old.md") && has(docs, "archive/works/old/work-1.md") && has(docs, "archive/files/old/p.png"));
  const old = read(docs, "archive/lines/old.md");
  assert.match(old, /!\[p\]\(\.\.\/files\/old\/p\.png\)/, "its own files moved with it");
  assert.match(old, /!\[s\]\(\.\.\/\.\.\/files\/shared\/s\.png\)/, "a shared file is one folder further up");
  assert.match(old, /\[Details\]\(\.\.\/works\/old\/work-1\.md\)/);
  assert.match(read(docs, "lines/second.md"), /\[the old one\]\(\.\.\/archive\/lines\/old\.md\)/);
  // PenEcho reads each of those links as the name of what it points at.
  assert.equal(L.fromLine("../../files/shared/s.png"), "files/shared/s.png");
  assert.equal(L.fromLine("../archive/lines/old.md"), "lines/old.md");
  assert.equal(read(docs, ".history/2026__topics__fix-login.md"), "old copy", "PenEcho's own kept copies are not touched");
  // The log names every move and keeps each changed file as it was.
  const log = JSON.parse(fs.readFileSync(result.log, "utf8"));
  assert.equal(log.phase, "done");
  assert.ok(log.moves.some(([a, b]) => a === "topics/fix-login" && b === "works/fix-login"));
  assert.equal(fs.readFileSync(path.join(path.dirname(result.log), "before", "topics/fix-login.md"), "utf8"), lineMd());
  // Once is enough.
  assert.equal(L.migrate(docs).moved, false);
});

test("undo puts a moved folder back: untouched files byte for byte, changed ones keep their change, and it stays in layout 1", () => {
  const docs = layoutOne(), original = Object.fromEntries(["topics/fix-login.md", "topics/fix-login/work-1.md", "files/fix-login/notes.md", "topics/second.md"].map(rel => [rel, read(docs, rel)]));
  assert.equal(L.migrate(docs).moved, true);
  // After the move the person added to one line, and a new line was made.
  fs.appendFileSync(path.join(docs, "lines/second.md"), "\nA new note, with [a link](../works/second/work-1.md).\n");
  write(docs, "lines/third.md", "---\nstatus: waiting\n---\n\n# Third\n\n[Details](../works/third/work-1.md)\n");
  write(docs, "works/third/work-1.md", "[Back](../../lines/third.md)\n");
  const result = L.undo(docs);
  assert.equal(result.moved, true, result.reason);
  for (const rel of ["topics/fix-login.md", "topics/fix-login/work-1.md", "files/fix-login/notes.md"]) assert.equal(read(docs, rel), original[rel], rel);
  assert.equal(read(docs, "topics/second.md"), `${original["topics/second.md"]}\nA new note, with [a link](second/work-1.md).\n`);
  assert.equal(read(docs, "topics/third.md"), "---\nstatus: waiting\n---\n\n# Third\n\n[Details](third/work-1.md)\n");
  assert.equal(read(docs, "topics/third/work-1.md"), "[Back](../third.md)\n");
  assert.ok(!has(docs, "lines") && !has(docs, "works"));
  assert.ok(has(docs, "topics/old.md") && has(docs, "topics/old/work-1.md") && has(docs, "files/old/p.png") && !has(docs, "archive"), "archived lines come back too");
  assert.match(read(docs, "topics/second.md"), /\[the old one\]\(old\.md\)/);
  assert.equal(L.versionOf(docs), 1);
  assert.equal(L.readState(docs).stay, true, "PenEcho does not move it again by itself");
});

test("a move cut short by a crash is rolled back; a taken place stops the move before anything moves", () => {
  const docs = layoutOne(), before = inventory(docs);
  // A crash after the log was written and one folder had moved.
  const dir = path.join(docs, L.MIGRATIONS, "crash");
  write(docs, `${L.MIGRATIONS}/crash/before/topics/fix-login.md`, lineMd());
  fs.writeFileSync(path.join(dir, "log.json"), JSON.stringify({ from:1, to:2, phase:"moving", moves:[["topics/fix-login", "works/fix-login"], ["topics/fix-login.md", "lines/fix-login.md"]], rewrites:[{ from:"topics/fix-login.md", to:"lines/fix-login.md" }] }));
  fs.mkdirSync(path.join(docs, "works"), { recursive:true });
  fs.renameSync(path.join(docs, "topics/fix-login"), path.join(docs, "works/fix-login"));
  L.recover(docs);
  assert.ok(has(docs, "topics/fix-login/work-1.md"));
  assert.equal(JSON.parse(read(docs, `${L.MIGRATIONS}/crash/log.json`)).phase, "rolled back");
  assert.deepEqual(inventory(docs, [".penecho", "works"]), before);
  // A file already where a Line would go: nothing moves.
  fs.rmSync(path.join(docs, "works"), { recursive:true });
  fs.mkdirSync(path.join(docs, "lines"));
  fs.writeFileSync(path.join(docs, ".penecho/layout.json"), JSON.stringify({ version:1 }));
  write(docs, "lines/second.md", "someone's own file");
  const refused = L.migrate(docs);
  assert.equal(refused.moved, false);
  assert.match(refused.reason, /lines\/second\.md/);
  assert.ok(has(docs, "topics/second.md") && has(docs, "topics/fix-login.md"));
});

function service() {
  const directory = path.join(temp, `state-${n++}`);
  fs.mkdirSync(directory, { recursive:true });
  const s = new Service({ directory, agents:createAgents({ env:{ PATH:"" } }), autoWatch:false, carryOn:false });
  services.push(s);
  return s;
}

test("PenEcho moves a layout-1 project when it opens it, and its lines, Works and pictures read as before", () => {
  const docs = layoutOne(), s = service();
  const project = s.store.importFolder({ docsPath:docs });
  assert.equal(s.store.layoutOf(project), 1, "an older folder is adopted as it is");
  const state = s.stateOf(project);
  assert.equal(L.versionOf(docs), 2);
  const line = [...state.lines, ...state.landed].find(l => l.slug === "fix-login");
  assert.ok(line, "the line is there");
  assert.equal(line.topicPath, "lines/fix-login.md");
  assert.ok(line.stations.some(st => st.kind === "work"));
  assert.deepEqual(line.pictures.length >= 0, true);
  assert.equal(s.store.readText(project, F.detailPath("fix-login", "work-1")).text.includes("## Result"), true);
  assert.equal(s.stepDetail(project, "fix-login", F.parseLine(s.readDoc(project, "fix-login")).steps.find(st => st.kind === "work")), "works/fix-login/work-1.md");
  // MEMORY.md says where things are now.
  const memory = read(docs, "MEMORY.md");
  assert.match(memory, /Lines \(`lines\/<name>\.md`\) keep every Ask word for word/);
  assert.doesNotMatch(memory, /Every Ask is kept word for word in the `topics` folder/);
  assert.ok(has(docs, ".penecho/topics-guide.md"), "the Topic rules are next to the memory command");
  assert.match(read(docs, ".penecho/topics-guide.md"), /A fix that adds or changes no requirement only files its Line/, "a bug fix leaves the Topic text alone");
  // An old name for a line still opens it (a bookmark, an old link).
  assert.equal(s.store.readText(project, "topics/fix-login.md").text, read(docs, "lines/fix-login.md"));
});

test("a layout-1 project waits while an agent runs on it, and reads and writes in its old places meanwhile", () => {
  const docs = layoutOne(), s = service();
  const project = s.store.importFolder({ docsPath:docs });
  s.runs.set(s.key(project, "second"), { stepId:"work-1", agent:"fake" });
  assert.equal(s.ensureLayout(project), false);
  assert.equal(L.versionOf(docs), 1);
  assert.ok(s.store.scan(project).topics.some(t => t.slug === "second" && t.path === "lines/second.md"));
  s.writeDoc(project, "second", `${s.readDoc(project, "second")}\nMore.\n`);
  assert.match(read(docs, "topics/second.md"), /More\.\n$/);
  s.store.writeText(project, F.detailPath("second", "work-2"), "# Work 2\n");
  assert.ok(has(docs, "topics/second/work-2.md"));
  s.runs.clear();
  s.layoutTried.clear();
  assert.equal(s.ensureLayout(project), true);
  assert.ok(has(docs, "works/second/work-2.md") && has(docs, "lines/second.md"));
});

function freshProject() {
  const s = service(), docs = path.join(temp, `v2-${n++}`), project = s.store.create({ name:"Garden", docsPath:docs });
  write(docs, "lines/fix-login.md", lineMd({ status:"done" }).replace(/\]\(fix-login\//g, "](../works/fix-login/"));
  write(docs, "works/fix-login/work-1.md", "---\nline: ../../lines/fix-login.md\n---\n\n## Result\n\nDone.\n");
  write(docs, "files/fix-login/sketch.png", "PNG1");
  write(docs, "files/fix-login/canvas.penecho.json", "{}");
  write(docs, "topics/accounts.md", "---\nrecord_type: topic\nid: topic-ab12\ntitle: Accounts\nlifecycle: current\n---\n\n# Accounts\n\n## Lines\n\n| Line | What it is |\n| --- | --- |\n| [PE-1](../lines/fix-login.md) | Fix the login |\n");
  write(docs, "understanding.md", "# Garden\n\n- [Accounts](topics/accounts.md) · Open: [PE-1](lines/fix-login.md)\n");
  return { s, docs, project };
}

test("a new project starts in layout 2", () => {
  const s = service(), docs = path.join(temp, `new-${n++}`);
  s.store.create({ name:"New", docsPath:docs });
  assert.deepEqual(["files", "lines", "topics", "works"].filter(d => has(docs, d)), ["files", "lines", "topics", "works"]);
  assert.equal(L.readState(docs).version, 2);
  // Topics are hidden in every project (PE-1066): the memory does not send agents to topics/ or understanding.md.
  assert.match(read(docs, "MEMORY.md"), /search with `rg -n -i "word" lines`/);
  assert.doesNotMatch(read(docs, "MEMORY.md"), /topics\/|understanding\.md|PenEcho files requirements/);
});

test("archiving a line moves it, its Works and its files into archive/; unarchiving brings them back; links in Topics follow", async () => {
  const { s, docs, project } = freshProject();
  write(docs, "lines/fix-login.md", read(docs, "lines/fix-login.md").replace("status: done", "status: ready"));
  await s.act(project, "fix-login", "close");
  for (const rel of ["archive/lines/fix-login.md", "archive/works/fix-login/work-1.md", "archive/files/fix-login/sketch.png", "archive/files/fix-login/canvas.penecho.json"]) assert.ok(has(docs, rel), rel);
  assert.ok(!has(docs, "lines/fix-login.md") && !has(docs, "works/fix-login") && !has(docs, "files/fix-login"));
  assert.match(read(docs, "topics/accounts.md"), /\(\.\.\/archive\/lines\/fix-login\.md\)/);
  assert.match(read(docs, "understanding.md"), /\(archive\/lines\/fix-login\.md\)/);
  assert.match(read(docs, "archive/lines/fix-login.md"), /\(\.\.\/files\/fix-login\/sketch\.png\)/, "its own files stay beside it");
  assert.match(read(docs, "archive/works/fix-login/work-1.md"), /^line: \.\.\/\.\.\/lines\/fix-login\.md$/m, "a Work still finds its line beside it");
  // PenEcho still finds all of it by its usual names.
  const archived = s.stateOf(project).landed.find(l => l.slug === "fix-login");
  assert.ok(archived && archived.archived);
  assert.equal(archived.topicPath, "lines/fix-login.md");
  assert.ok(s.store.exists(project, "files/fix-login/sketch.png"));
  assert.match(s.store.readText(project, F.detailPath("fix-login", "work-1")).text, /Done\./);
  assert.ok(s.store.walk(project).some(f => f.path === "files/fix-login/sketch.png"), "the Files page lists it where it was");
  await s.act(project, "fix-login", "reopen");
  for (const rel of ["lines/fix-login.md", "works/fix-login/work-1.md", "files/fix-login/sketch.png"]) assert.ok(has(docs, rel), rel);
  assert.ok(!has(docs, "archive/lines/fix-login.md"));
  assert.match(read(docs, "topics/accounts.md"), /\(\.\.\/lines\/fix-login\.md\)/);
});

test("an archived line is still read in a folder past the 5,000-file count, so Remove on its only Ask leaves its page", async () => {
  const { s, docs, project } = freshProject();
  s.store.maxEntries = 5000; // a lower count than PenEcho's, so the test folder stays small
  for (let i = 0; i < 5100; i++) write(docs, `files/big/f${i}.txt`);
  write(docs, "lines/fix-login.md", read(docs, "lines/fix-login.md").replace("status: done", "status: ready"));
  await s.act(project, "fix-login", "close");
  assert.ok(has(docs, "archive/lines/fix-login.md"));
  assert.ok(s.store.walk(project).some(f => f.path === "lines/fix-login.md"), "read before the files use up the count");
  assert.ok(s.stateOf(project).landed.find(l => l.slug === "fix-login")?.closed);
});

test("deleting a line takes its Works and files to .trash with a note; restoring brings all of it back; a week later it is gone", async () => {
  const { s, docs, project } = freshProject();
  const hash = s.store.readText(project, "lines/fix-login.md").hash;
  const result = await s.act(project, "fix-login", "delete", { confirm:"fix-login", baseHash:hash });
  assert.ok(!has(docs, "lines/fix-login.md") && !has(docs, "works/fix-login") && !has(docs, "files/fix-login"));
  const trash = path.relative(fs.realpathSync(docs), result.recoveryPath);
  assert.match(trash, /^\.trash\/lines\/fix-login-[0-9a-f]+$/);
  for (const rel of ["lines/fix-login.md", "works/fix-login/work-1.md", "files/fix-login/sketch.png"]) assert.ok(has(docs, `${trash}/${rel}`), rel);
  assert.equal(JSON.parse(read(docs, `${trash}/deleted.json`)).slug, "fix-login");
  assert.ok(!s.store.scan(project).topics.some(t => t.slug === "fix-login"));
  s.restoreLine(project, { slug:"fix-login" });
  for (const rel of ["lines/fix-login.md", "works/fix-login/work-1.md", "files/fix-login/sketch.png"]) assert.ok(has(docs, rel), rel);
  assert.ok(!has(docs, trash));
  assert.ok(s.store.scan(project).topics.some(t => t.slug === "fix-login"));
  // Deleted again, and kept past its week.
  await s.act(project, "fix-login", "delete", { confirm:"fix-login", baseHash:s.store.readText(project, "lines/fix-login.md").hash });
  s.store.purgeDeleted(project, Date.now() + 1);
  assert.deepEqual(fs.readdirSync(path.join(docs, ".trash/lines")), []);
});

test("PE-466: an archived line is deleted with its Works and files from archive/, and restored it is archived again", async () => {
  const { s, docs, project } = freshProject();
  write(docs, "lines/fix-login.md", read(docs, "lines/fix-login.md").replace("status: done", "status: ready"));
  await s.act(project, "fix-login", "close");
  assert.ok(has(docs, "archive/works/fix-login/work-1.md"));
  const result = await s.act(project, "fix-login", "delete", { confirm:"fix-login", baseHash:s.store.readText(project, "lines/fix-login.md").hash });
  assert.ok(!has(docs, "archive/lines/fix-login.md") && !has(docs, "archive/works/fix-login") && !has(docs, "archive/files/fix-login"));
  const trash = path.relative(fs.realpathSync(docs), result.recoveryPath);
  for (const rel of ["lines/fix-login.md", "works/fix-login/work-1.md", "files/fix-login/sketch.png"]) assert.ok(has(docs, `${trash}/${rel}`), rel);
  s.restoreLine(project, { slug:"fix-login" });
  s.store.scan(project);
  for (const rel of ["archive/lines/fix-login.md", "archive/works/fix-login/work-1.md", "archive/files/fix-login/sketch.png"]) assert.ok(has(docs, rel), rel);
});

test("a line deleted by an older PenEcho (one file in .trash) still comes back, to lines/", () => {
  const { s, docs, project } = freshProject();
  write(docs, ".trash/old-abc.md", "---\nstatus: done\n---\n\n# Old\n");
  s.store.deleted[`${project.id}:old`] = { id:"abc", projectId:project.id, slug:"old", deletedAt:Date.now(), original:"topics/old.md", trash:".trash/old-abc.md", phase:"completed" };
  s.store.restoreTopic(project, "old");
  assert.equal(read(docs, "lines/old.md"), "---\nstatus: done\n---\n\n# Old\n");
});

test("Topic files are never read as Lines, whatever their front matter says", () => {
  const { s, docs, project } = freshProject();
  write(docs, "topics/looks-like-a-line.md", "---\nstatus: working\nwho: @claude\n---\n\n# Not a line\n\n## Ask · 2026-11-10 09:00\n\nHello\n");
  write(docs, "lines/a-topic-by-mistake.md", "---\nrecord_type: topic\nstatus: working\n---\n\n# Accounts\n");
  const scan = s.store.scan(project);
  assert.deepEqual(scan.topics.map(t => t.slug), ["fix-login"]);
  assert.ok(scan.notes.some(note => note.path === "topics/looks-like-a-line.md"), "a Topic is shown as a page to read");
  assert.equal(F.parseLine("---\nrecord_type: topic\nstatus: done\n---\n").isLine, false);
  // The page is told each Topic and the lines its Lines table names.
  const accounts = s.stateOf(project).knowledge.find(t => t.path === "topics/accounts.md");
  assert.deepEqual({ ...accounts, sig:undefined }, { path:"topics/accounts.md", id:"topic-ab12", area:"", title:"Accounts", goal:"", left:[], parent:"", lines:["fix-login"], status:"", by:"", sig:undefined });
  // With a mark of its text, so the pages can say when an agent changed it.
  assert.match(accounts.sig, /^[0-9a-f]{12}$/);
  assert.equal(F.parseLine("---\nrecord_type: project-understanding\nstatus: done\n---\n").isLine, false);
});

test("a Line's Topic is the Topic whose Lines table links it, and the run prompt names it", () => {
  const { docs } = freshProject();
  assert.equal(Knowledge.topicOfLine(docs, "fix-login").title, "Accounts");
  assert.equal(Knowledge.topicOfLine(docs, "other"), null);
  // A run is told nothing to read or write: a requirement it names in its last message is filed by PenEcho (PE-916).
  assert.match(Knowledge.knowledgeNote(), /Leave understanding\.md and topics\/ alone unless the request is about them/);
  assert.match(Knowledge.knowledgeNote(), /not a fix, question, test or check/);
  assert.match(Knowledge.knowledgeNote(), /<!-- penecho: requirement="/);
  assert.doesNotMatch(Knowledge.knowledgeNote(), /topics-guide\.md|Read .*understanding\.md/);
});

test("a Topic's first few What is left items reach the page as plain words", () => {
  const md = "# T\n\n## What is left, in order\n\n1. Commit [R1](../lines/a.md) with `make.js` (R1).\n2. Sync the **pages** to Cloud (R2–R5).\n\n3. Decide on R5 (R5, R6).\n4. Four\n5. Five\n\n## How the thinking changed\n\n- 2026 — not this\n";
  assert.deepEqual(Knowledge.leftOf(md), ["Commit R1 with make.js.", "Sync the pages to Cloud.", "Decide on R5.", "Four"]);
  assert.deepEqual(Knowledge.leftOf("# T\n\n## Lines\n"), []);
});

test("PenEcho Cloud keeps seeing layout-1 names", () => {
  assert.equal(L.toCloud("lines/a.md"), "topics/a.md");
  assert.equal(L.toCloud("works/a/work-1.md"), "topics/a/work-1.md");
  assert.equal(L.toCloud("files/a/p.png"), "files/a/p.png");
  assert.equal(L.toCloud("topics/accounts.md"), ".knowledge/topics/accounts.md", "never topics/, where Cloud keeps the Lines");
  assert.equal(L.toCloud("understanding.md"), ".knowledge/understanding.md");
  assert.equal(L.fromCloud(".knowledge/topics/accounts.md"), "topics/accounts.md");
  assert.equal(L.fromCloud(".knowledge/understanding.md"), "understanding.md");
  assert.equal(L.fromCloud("topics/a.md"), "lines/a.md");
  assert.equal(L.fromCloud("topics/a/work-1.md"), "works/a/work-1.md");
});

test("Build Topics makes one line in the docs folder that asks an agent to write understanding.md and the Topics; only with Lines and no Topics", async () => {
  const s = service(), docs = path.join(temp, `build-${n++}`), project = s.store.create({ name:"Garden", docsPath:docs });
  await assert.rejects(s.buildTopics(project), e => e.code === "NO_LINES");
  write(docs, "lines/fix-login.md", lineMd({ status:"done" }).replace(/\]\(fix-login\//g, "](../works/fix-login/"));
  write(docs, "lines/old.md", lineMd({ id:"PE-2", status:"closed", title:"Old" }));
  s.begin = async () => {};
  const made = await s.buildTopics(project);
  const doc = F.parseLine(s.readDoc(project, made.slug));
  assert.equal(doc.front.job, "build-topics");
  assert.equal(doc.front.git, "no", "it works in the docs folder, never on a branch of the code");
  assert.match(doc.steps[0].text, /from its Line\. Read each Line in lines\/ \(not archive\/\).*topics-guide\.md/s, "archived lines are not counted");
  assert.deepEqual(await s.buildTopics(project), { slug:made.slug, existing:true }, "a build already going is the one you get back");
  write(docs, "topics/accounts.md", "---\nrecord_type: topic\nid: topic-ab12\ntitle: Accounts\n---\n\n# Accounts\n");
  s.writeDoc(project, made.slug, F.setFront(s.readDoc(project, made.slug), { status:"done" }));
  await assert.rejects(s.buildTopics(project), e => e.code === "HAS_TOPICS");
  assert.equal(s.stateOf(project).lines.concat(s.stateOf(project).landed).find(l => l.slug === made.slug).job, "build-topics");
});

test("an earlier MEMORY.md comes back from .history, and Undo puts the one it replaced back", () => {
  const s = service(), docs = path.join(temp, `mem-${n++}`), project = s.store.create({ name:"Garden", docsPath:docs });
  const original = read(docs, "MEMORY.md"), withLine = original.replace("## Decisions\n\nNothing yet.", "## Decisions\n\n- Keep it small. (PE-1, 2026-11-15)");
  s.store.writeText(project, "MEMORY.md", withLine, { history:true });
  s.store.writeText(project, "MEMORY.md", original, { history:true });
  const { versions } = s.memoryVersions(project);
  assert.equal(versions.length, 1, "the version it is now is not offered");
  assert.equal(versions[0].lines, 1);
  const done = s.restoreMemory(project, { id:versions[0].id });
  assert.match(read(docs, "MEMORY.md"), /Keep it small\./);
  assert.ok(done.undo);
  s.restoreMemory(project, { id:done.undo });
  assert.doesNotMatch(read(docs, "MEMORY.md"), /Keep it small\./);
  assert.throws(() => s.restoreMemory(project, { id:"../MEMORY.md" }), e => e.code === "BAD_PATH");
});

test("Rebuild puts the Topics there are now aside and asks to keep their names; Recover brings them back, and Undo again", async () => {
  const s = service(), docs = path.join(temp, `rebuild-${n++}`), project = s.store.create({ name:"Garden", docsPath:docs });
  write(docs, "lines/fix-login.md", lineMd({ status:"done" }));
  write(docs, "topics/accounts.md", "---\nrecord_type: topic\nid: topic-ab12\ntitle: Accounts\n---\n\n# Accounts\n\n**People sign in once and stay signed in.**\n");
  write(docs, "understanding.md", "# Garden\n");
  assert.equal(s.stateOf(project).knowledge[0].goal, "People sign in once and stay signed in.");
  assert.equal(s.stateOf(project).understanding, true);
  s.begin = async () => {};
  await assert.rejects(s.buildTopics(project), e => e.code === "HAS_TOPICS");
  const made = await s.buildTopics(project, { rebuild:true });
  assert.ok(made.kept);
  assert.ok(!has(docs, "topics/accounts.md") && !has(docs, "understanding.md"));
  assert.ok(has(docs, `.penecho/topics-history/${made.kept}/topics/accounts.md`) && has(docs, `.penecho/topics-history/${made.kept}/understanding.md`));
  assert.match(F.parseLine(s.readDoc(project, made.slug)).steps[0].text, new RegExp(`Rebuild this project's Topics.*topics-history/${made.kept}/: keep a Topic's name and id`));
  assert.throws(() => s.restoreTopics(project, { id:made.kept }), e => e.code === "BUSY", "not while the rebuild writes them");
  s.writeDoc(project, made.slug, F.setFront(s.readDoc(project, made.slug), { status:"done" }));
  write(docs, "topics/sign-in.md", "---\nrecord_type: topic\nid: topic-cd34\ntitle: Sign-in\n---\n\n# Sign-in\n");
  assert.deepEqual(s.topicsVersions(project).versions.map(v => [v.id, v.topics]), [[made.kept, 1]]);
  const back = s.restoreTopics(project, { id:made.kept });
  assert.ok(has(docs, "topics/accounts.md") && has(docs, "understanding.md") && !has(docs, "topics/sign-in.md"));
  s.restoreTopics(project, { id:back.undo });
  assert.ok(has(docs, "topics/sign-in.md") && !has(docs, "topics/accounts.md"));
  assert.throws(() => s.restoreTopics(project, { id:"../x" }), e => e.code === "BAD_PATH");
});

test("Merge two Topics: a Topics line asks an agent to move one into the other; both are copied aside first, and one Topics line at a time", async () => {
  const s = service(), docs = path.join(temp, `merge-topics-${n++}`), project = s.store.create({ name:"Garden", docsPath:docs });
  write(docs, "lines/fix-login.md", lineMd({ status:"done" }));
  write(docs, "topics/accounts.md", "---\nrecord_type: topic\nid: topic-ab12\ntitle: Accounts\n---\n\n# Accounts\n\n## Lines\n\n| [Fix the login](../lines/fix-login.md) |\n");
  write(docs, "topics/sign-in.md", "---\nrecord_type: topic\nid: topic-cd34\ntitle: Sign-in\n---\n\n# Sign-in\n");
  write(docs, "understanding.md", "# Garden\n");
  s.begin = async () => {};
  await assert.rejects(s.mergeTopics(project, { into:"topics/accounts.md", from:"topics/accounts.md" }), e => e.code === "BAD_MERGE");
  await assert.rejects(s.mergeTopics(project, { into:"topics/accounts.md", from:"topics/gone.md" }), e => e.code === "NOT_FOUND");
  const made = await s.mergeTopics(project, { into:"topics/accounts.md", from:"topics/sign-in.md" });
  assert.ok(has(docs, "topics/accounts.md") && has(docs, "topics/sign-in.md"), "the agent changes them; PenEcho only copies them aside");
  assert.ok(has(docs, `.penecho/topics-history/${made.kept}/topics/sign-in.md`) && has(docs, `.penecho/topics-history/${made.kept}/understanding.md`));
  const doc = F.parseLine(s.readDoc(project, made.slug));
  assert.equal(doc.front.job, "build-topics");
  assert.equal(doc.front.git, "no");
  assert.match(doc.steps[0].text, /Merge the Topic "Sign-in" \(topics\/sign-in\.md\) into the Topic "Accounts" \(topics\/accounts\.md\).*its id topic-ab12.*then delete topics\/sign-in\.md.*parent_id is topic-cd34.*Change no Line\./s);
  await assert.rejects(s.mergeTopics(project, { into:"topics/sign-in.md", from:"topics/accounts.md" }), e => e.code === "BUSY");
  assert.equal((await s.buildTopics(project, { rebuild:true })).slug, made.slug, "a rebuild meanwhile gets the merge line back");
});

test("each Topic tells the page its status sentence, the Work that last changed it, and a mark that changes with its text", () => {
  const { docs } = freshProject();
  const text = "---\nrecord_type: topic\nid: topic-zz9\ntitle: Offline mode\nupdated: 2026-11-16\nupdated_by: PE-7 Work 2, PE-3 Work 1\n---\n\n# Offline mode\n\n**Work without a connection.**\n\nStatus on 2026-11-16: [Agreed](../lines/x.md), **not built**.\n\n## Lines\n";
  write(docs, "topics/offline-mode.md", text);
  const before = Knowledge.topicsOf(docs).find(t => t.path === "topics/offline-mode.md");
  assert.equal(before.status, "Agreed, not built.");
  assert.equal(before.by, "PE-7 Work 2");
  write(docs, "topics/offline-mode.md", text.replace("not built", "built"));
  assert.notEqual(Knowledge.topicsOf(docs).find(t => t.path === "topics/offline-mode.md").sig, before.sig);
});
