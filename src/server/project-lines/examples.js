"use strict";
const L = require("./layout.js");
const F = require("./format.js");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { failure } = require("./store.js");

// Three example projects, one for each kind of work a project holds, already in the sidebar of someone with no project of their own:
//   app    a code project: a bug fixed from a marked-up screenshot, a drawing that Claude turns into a prototype on the Canvas and
//          Codex builds, and a feature talked through with Claude and Codex, then built on a branch of that branch;
//   class  class notes: two classes written by hand on the Canvas with Canvas AI's answers beside them, notes made by dsh, a practice exam;
//   deck   slides from a spreadsheet: a deck made on the Canvas from an attached Excel file, then changed on request.
// Each is made from the files in ./examples, with its times set back a few working days. The code project gets a real Git repository
// with a branch for each line, so its map, changes and Merge all work as they do in a project of your own. The folders live in
// PenEcho's own folder, and nothing already there is overwritten. scripts/build-project-line-examples.cjs makes their pictures.
// Every line must stay on Home: a merged line goes to Archive, and a finished one whose Works are all marked reviewed folds away,
// so each line keeps its branch unmerged or a Work not yet reviewed.
const TEMPLATES = path.join(__dirname, "examples");
const VERSION = 2;
const EXAMPLES = {
  app:{
    name:"Timeline app (Demo)", code:"timeline-app", lines:3,
    first:["Timeline app: the week of one project as lines", -7, "16:40"],
    // Each branch: where it starts, and its commits [message, working days back, time]; its files are in ./examples/app/code/<branch>.
    branches:[
      { name:"fix-time-labels", from:"main", commits:[["Time labels no longer run into each other", -5, "10:18"]] },
      { name:"homepage", from:"main", commits:[["Homepage from the drawing: projects, week, lines on a trunk, latest files", -3, "14:27"]] },
      { name:"dark-mode", from:"homepage", commits:[["Dark mode: Light, Dark or System", -1, "15:20"]] },
    ],
  },
  class:{ name:"Calculus class notes (Demo)", lines:2 },
  deck:{ name:"Sales review deck (Demo)", lines:1 },
};
const LEGACY_NAMES = {
  app:"Timeline app",
  class:"Calculus class notes",
  deck:"Sales review deck",
};
const KINDS = Object.keys(EXAMPLES);

const pad = n => String(n).padStart(2, "0");
// A day and time some working days before `now` (Saturdays and Sundays are skipped), as PenEcho writes times in a line: 2026-11-05 09:12.
function stamp(now, days, time) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let left = -Number(days); left > 0;) { d.setDate(d.getDate() - 1); if (d.getDay() % 6) left--; }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}
// {{when -2 09:12}}, {{id 1}}, {{code}}, {{branch main}}, {{commit main}} and {{short main}}. A line whose value is missing,
// such as a branch where Git could not be used, is left out whole.
function fill(text, values) {
  return text.split("\n").flatMap(row => {
    let missing = false;
    const out = row.replace(/\{\{(\w+)(?: ([^}]+))?\}\}/g, (_, name, arg = "") => {
      const value = name === "when" ? stamp(values.now, ...arg.split(" "))
        : name === "id" ? `${values.prefix}-${arg}`
        : name === "code" ? values.code
        : name === "branch" ? (values.commits?.[arg] ? arg : null)
        : name === "commit" ? values.commits?.[arg] || null
        : name === "short" ? values.commits?.[arg]?.slice(0, 8) || null
        : null;
      if (value == null) missing = true;
      return value ?? "";
    });
    return missing ? [] : [out];
  }).join("\n");
}
function copyTree(from, to, values) {
  for (const entry of fs.readdirSync(from, { withFileTypes:true })) {
    const source = path.join(from, entry.name), target = path.join(to, entry.name);
    if (entry.isDirectory()) { fs.mkdirSync(target, { recursive:true }); copyTree(source, target, values); continue; }
    if (fs.existsSync(target)) continue;
    if (values && entry.name.endsWith(".md")) {
      const filled = fill(fs.readFileSync(source, "utf8"), values);
      fs.writeFileSync(target, /^---\r?\n/.test(filled) ? F.setFront(filled, {}) : filled);
    }
    else fs.copyFileSync(source, target);
  }
}
const filesIn = dir => { try { return fs.readdirSync(dir).map(name => path.join(dir, name)); } catch { return []; } };
// Each line's files carry the time of its last step, so the page says when things happened in the example, not when it was made.
function dateFiles(docs) {
  const topics = path.join(docs, L.LINES);
  for (const name of fs.readdirSync(topics)) {
    if (!name.endsWith(".md")) continue;
    const slug = name.slice(0, -3), text = fs.readFileSync(path.join(topics, name), "utf8");
    const times = [...text.matchAll(/(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)/g)].map(m => new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]).getTime()).filter(t => t <= Date.now());
    if (!times.length) continue;
    const at = new Date(Math.max(...times));
    for (const file of [path.join(topics, name), ...filesIn(path.join(docs, L.worksDir(slug))), ...filesIn(path.join(docs, L.filesDir(slug)))]) fs.utimesSync(file, at, at);
  }
}
// A branch's files over what is there: new and changed files, and the ones its _removed.txt names are taken away.
function overlay(from, to) {
  for (const name of fs.readdirSync(from)) {
    if (name === "_removed.txt") { for (const gone of fs.readFileSync(path.join(from, name), "utf8").split("\n").map(s => s.trim()).filter(Boolean)) fs.rmSync(path.join(to, gone), { force:true }); continue; }
    fs.copyFileSync(path.join(from, name), path.join(to, name));
  }
}

// Git's own settings on this computer, such as signing or hooks, must not stop or change these commits.
const GIT_SAFE = ["-c", "user.name=PenEcho", "-c", "user.email=examples@penecho.ai", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=", "-c", "core.autocrlf=false"];
const git = (cwd, args, env = {}) => execFileSync("git", [...GIT_SAFE, ...args], { cwd, encoding:"utf8", stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, ...env }, windowsHide:true }).trim();
function commit(cwd, message, when) {
  const date = `${when}:00`;
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "--no-verify", "-m", message], { GIT_AUTHOR_DATE:date, GIT_COMMITTER_DATE:date });
  return git(cwd, ["rev-parse", "HEAD"]);
}
// The app on main, then each line's change on a branch of its own, from main or from another line's branch.
// Without Git the app is still there, with no branches.
function buildRepo(dir, spec, now) {
  fs.mkdirSync(dir, { recursive:true });
  const files = name => path.join(TEMPLATES, "app/code", name);
  copyTree(files("main"), dir, null);
  try {
    git(dir, ["init", "-q"]);
    git(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    const commits = { main:commit(dir, spec.first[0], stamp(now, spec.first[1], spec.first[2])) };
    for (const branch of spec.branches) {
      git(dir, ["checkout", "-q", "-b", branch.name, branch.from]);
      for (const [text, back, at] of branch.commits) { overlay(files(branch.name), dir); commits[branch.name] = commit(dir, text, stamp(now, back, at)); }
    }
    git(dir, ["checkout", "-q", "main"]);
    return commits;
  } catch {
    fs.rmSync(path.join(dir, ".git"), { recursive:true, force:true });
    return null;
  }
}
// A code folder made earlier keeps whatever has happened in it since.
function commitsOf(dir, spec) {
  const commits = {};
  for (const branch of ["main", ...spec.branches.map(b => b.name)]) { try { commits[branch] = git(dir, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`]); } catch { /* That branch is gone. */ } }
  return commits.main ? commits : null;
}

// Adds one example, or brings back the one already made. `root` is where the example folders go.
function addExample(store, kind, { root = path.join(store.directory, "examples"), now = new Date() } = {}) {
  const spec = Object.hasOwn(EXAMPLES, kind) ? EXAMPLES[kind] : null;
  if (!spec) throw failure("NOT_FOUND", "There is no example by that name.", 404);
  const known = store.projects.find(p => p.example === kind);
  if (known && fs.existsSync(known.docsPath)) {
    const patch = {};
    if (known.archived) patch.archived = false;
    if (known.name === LEGACY_NAMES[kind]) patch.name = spec.name;
    if (Object.keys(patch).length) store.update(known.id, patch);
    return known;
  }
  if (known) store.forget(known.id);
  const docs = path.join(root, spec.name), code = spec.code ? path.join(root, spec.code) : null;
  const fresh = !fs.existsSync(path.join(docs, L.LINES)) && !fs.existsSync(path.join(docs, L.TOPICS));
  const commits = code ? (fs.existsSync(code) ? commitsOf(code, spec) : buildRepo(code, spec, now)) : null;
  const project = fresh ? store.create({ name:spec.name, docsPath:docs, codePath:code }) : store.importFolder({ docsPath:docs });
  if (fresh) { copyTree(path.join(TEMPLATES, kind, "docs"), docs, { now, prefix:project.prefix, code, commits }); dateFiles(docs); }
  project.example = kind;
  project.offerSkill = false;
  project.seq = Math.max(project.seq, spec.lines + 1);
  store.save();
  return project;
}
// Someone with no project of their own (My Canvases and examples do not count) gets the examples, once for each version of them,
// so ones they remove do not come back, and nobody with projects of their own finds new ones in the sidebar after an update.
// The examples of an earlier version leave everyone's list on every start, also for someone with projects of their own; their
// folders stay. The code project is listed first. One that cannot be made is skipped, and PenEcho still starts.
function seedExamples(store, options = {}) {
  for (const old of store.projects.filter(p => p.example && !KINDS.includes(p.example))) store.forget(old.id);
  let renamed = false;
  for (const p of store.projects) {
    if (p.example && Object.hasOwn(LEGACY_NAMES, p.example) && p.name === LEGACY_NAMES[p.example]) {
      p.name = EXAMPLES[p.example].name;
      renamed = true;
    }
  }
  if (renamed) store.save();
  if ((store.examples || 0) >= VERSION) return [];
  store.examples = VERSION;
  if (store.projects.some(p => !p.myCanvases && !p.example)) { store.save(); return []; }
  const made = [], now = Date.now();
  for (const [i, kind] of ["deck", "class", "app"].entries()) {
    try { const project = addExample(store, kind, options); project.lastOpenedAt = now - 2 + i; made.push(project); }
    catch (error) { process.emitWarning(`PenEcho could not add the ${kind} example: ${error.message}`); }
  }
  store.save();
  return made;
}

module.exports = { addExample, seedExamples, fill, stamp, EXAMPLES, KINDS, VERSION };
