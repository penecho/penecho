"use strict";
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// Git for Topics. Fixed argument lists only, so nothing from a request or a file reaches a shell.
const SAFE = ["-c", "core.fsmonitor=false", "-c", "core.quotepath=false", "-c", "diff.external="];
function git(cwd, args, { timeout = 60000, maxBuffer = 16 * 1024 * 1024 } = {}) {
  return new Promise(resolve => {
    execFile("git", [...SAFE, ...args], { cwd, timeout, maxBuffer, windowsHide:true, env:{ ...process.env, GIT_TERMINAL_PROMPT:"0", GIT_OPTIONAL_LOCKS:"0" } }, (error, stdout, stderr) => {
      resolve({ ok:!error, code:error?.code ?? 0, stdout:String(stdout || ""), stderr:String(stderr || "") });
    });
  });
}
const isRepo = async dir => { try { if (!fs.statSync(dir).isDirectory()) return false; } catch { return false; } return (await git(dir, ["rev-parse", "--is-inside-work-tree"])).stdout.trim() === "true"; };
const currentBranch = async dir => (await git(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"])).stdout.trim();
const isClean = async dir => { const r = await git(dir, ["status", "--porcelain", "--untracked-files=no"]); return r.ok && !r.stdout.trim(); };
// A worktree keeps its commits and refs in the main repository's .git folder.
const commonDir = async dir => { const r = await git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]); return r.ok ? r.stdout.trim() : ""; };
// The project's main branch: the one the remote opens on, else main, else master. Also every local branch, in the same Git call.
async function defaultBranch(dir) {
  const r = await git(dir, ["for-each-ref", "--format=%(refname)%09%(symref)", "refs/heads/", "refs/remotes/origin/HEAD"]);
  if (!r.ok) return { name:"", heads:null };
  const heads = new Set();
  let remote = "";
  for (const line of r.stdout.split("\n").filter(Boolean)) {
    const [ref, to = ""] = line.split("\t");
    if (ref.startsWith("refs/heads/")) heads.add(ref.slice(11));
    else if (to.startsWith("refs/remotes/origin/")) remote = to.slice(20);
  }
  return { name:[remote, "main", "master"].find(name => name && heads.has(name)) || "", heads };
}
const hasCommits = async dir => (await git(dir, ["rev-parse", "--verify", "--quiet", "HEAD"])).ok;
const headOf = async dir => (await git(dir, ["rev-parse", "--short", "HEAD"])).stdout.trim();
const branchExists = async (dir, branch) => (await git(dir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).ok;
const validBranch = async (dir, branch) => /^[^-]/.test(branch) && (await git(dir, ["check-ref-format", "--branch", branch])).ok;

async function ensureWorktree(repo, worktree, branch, base) {
  if (fs.existsSync(path.join(worktree, ".git"))) return { ok:true, worktree };
  fs.mkdirSync(path.dirname(worktree), { recursive:true });
  const args = await branchExists(repo, branch) ? ["worktree", "add", worktree, branch] : ["worktree", "add", "-b", branch, worktree, base];
  const r = await git(repo, args, { timeout:120000 });
  return r.ok ? { ok:true, worktree } : { ok:false, error:r.stderr.trim().split("\n").pop() || "Could not create the worktree." };
}
async function removeWorktree(repo, worktree) {
  if (!fs.existsSync(worktree)) return true;
  return (await git(repo, ["worktree", "remove", worktree])).ok;
}
async function diffStat(repo, base, branch) {
  const r = await git(repo, ["diff", "--no-ext-diff", "--numstat", `${base}...${branch}`]);
  if (!r.ok) return null;
  let add = 0, del = 0, files = 0;
  for (const line of r.stdout.split("\n").filter(Boolean)) { const [a, d] = line.split("\t"); add += Number(a) || 0; del += Number(d) || 0; files++; }
  return { add, del, files };
}
// How many commits a branch has that its base does not. A branch with none has nothing to merge.
async function aheadCount(repo, base, branch) {
  const r = await git(repo, ["rev-list", "--count", `${base}..${branch}`]);
  return r.ok ? Number(r.stdout.trim()) || 0 : null;
}
// When a branch was made, at which commit, and from what, as Git's own log of the branch says. Nothing if Git kept no log of it.
async function branchMade(repo, branch) {
  const r = await git(repo, ["reflog", "show", "--date=unix", "--format=%H%x09%gd%x09%gs", `refs/heads/${branch}`]);
  const [sha, at, said] = (r.ok ? r.stdout.trim().split("\n").pop() : "").split("\t");
  const seconds = Number((at || "").match(/@\{(\d+)\}$/)?.[1]);
  return seconds ? { at:seconds * 1000, from:sha, createdFrom:(said || "").match(/^branch: Created from (?:refs\/heads\/)?(.+)$/)?.[1] || "" } : null;
}
// Every branch that is checked out, and the folder it is in.
async function worktrees(repo) {
  const r = await git(repo, ["worktree", "list", "--porcelain"]), found = new Map();
  let here = "";
  for (const line of r.ok ? r.stdout.split("\n") : []) {
    if (line.startsWith("worktree ")) here = line.slice(9);
    else if (line.startsWith("branch refs/heads/")) found.set(line.slice(18), here);
  }
  return found;
}
const isAncestor = async (repo, older, newer) => (await git(repo, ["merge-base", "--is-ancestor", older, newer])).ok;
// The folder a branch is checked out in, if it is. Git allows only one.
async function worktreeOf(repo, branch) {
  const r = await git(repo, ["worktree", "list", "--porcelain"]);
  if (!r.ok) return "";
  let here = "";
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("worktree ")) here = line.slice(9);
    else if (line === `branch refs/heads/${branch}`) return here;
  }
  return "";
}
// What could still be worked on: every branch not merged into the trunk, the latest commit first.
async function unmergedBranches(repo, trunk) {
  const r = await git(repo, ["for-each-ref", `--no-merged=refs/heads/${trunk}`, "--sort=-committerdate", "--format=%(refname:lstrip=2)%09%(committerdate:unix)", "refs/heads"]);
  if (!r.ok) return [];
  return r.stdout.split("\n").filter(Boolean).map(line => { const [name, at] = line.split("\t"); return { name, at:Number(at) * 1000 || 0 }; }).filter(b => b.name && b.name !== trunk);
}
const deleteBranch = async (repo, branch) => (await git(repo, ["branch", "-d", branch])).ok;
// Each changed file with its hunks, capped so a huge change cannot flood the page.
// Just the names, so a branch too large to show in full still has all of them.
async function changedPaths(repo, base, branch) {
  const r = await git(repo, ["diff", "--no-ext-diff", "--name-only", `${base}...${branch}`]);
  return r.ok ? r.stdout.split("\n").filter(Boolean) : [];
}
async function diffFiles(repo, base, branch, { maxBytes = 400 * 1024 } = {}) {
  const r = await git(repo, ["diff", "--no-ext-diff", "--no-color", `${base}...${branch}`], { maxBuffer:32 * 1024 * 1024 });
  if (!r.ok) return { files:[], truncated:false, error:r.stderr.trim() };
  const truncated = r.stdout.length > maxBytes, text = truncated ? r.stdout.slice(0, maxBytes) : r.stdout, files = [];
  let current = null;
  for (const line of text.split("\n")) {
    const start = line.match(/^diff --git a\/(.*) b\/(.*)$/);
    if (start) { current = { path:start[2], add:0, del:0, lines:[] }; files.push(current); continue; }
    if (!current || /^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(line)) continue;
    if (line[0] === "+") current.add++; else if (line[0] === "-") current.del++;
    current.lines.push(line);
  }
  return { files, truncated };
}
// A file as it is on a branch, so that work not merged yet can be read.
async function showFile(repo, branch, file) {
  const r = await git(repo, ["show", `${branch}:${file}`], { maxBuffer:4 * 1024 * 1024 });
  return r.ok ? r.stdout : null;
}
// Commits what a step left behind. Ignored files stay out, as they would for anyone running git add.
async function commitAll(dir, message) {
  const status = await git(dir, ["status", "--porcelain"]);
  if (!status.ok) return { ok:false, error:status.stderr.trim() };
  if (!status.stdout.trim()) return { ok:true, commit:null };
  const added = await git(dir, ["add", "-A"]);
  if (!added.ok) return { ok:false, error:added.stderr.trim() };
  let done = await git(dir, ["commit", "-q", "-m", message]);
  if (!done.ok && /identity|tell me who you are|user\.(name|email)/i.test(done.stderr)) done = await git(dir, ["-c", "user.name=PenEcho", "-c", "user.email=agent@penecho.local", "commit", "-q", "-m", message]);
  return done.ok ? { ok:true, commit:await headOf(dir) } : { ok:false, error:(done.stderr || done.stdout).trim() };
}
// Turns a folder into a repository with one first commit, because a branch needs a commit to start from. What nobody commits stays out, in the file only this computer sees. If it fails, a repository made here is taken away again, so the folder is as it was.
const NEVER_TRACKED = ["node_modules/", ".env", ".env.*", "*.pem", "*.key", ".DS_Store", ".penecho/"];
async function startTracking(dir, { message = "Start tracking changes" } = {}) {
  const dotGit = path.join(dir, ".git"), made = !fs.existsSync(dotGit), giveUp = error => { if (made) { try { fs.rmSync(dotGit, { recursive:true, force:true }); } catch { /* It stays, and says it has no commits. */ } } return { ok:false, error }; };
  if (made) {
    let init = await git(dir, ["init", "-q", "-b", "main"]);
    if (!init.ok) init = await git(dir, ["init", "-q"]);
    if (!init.ok) return { ok:false, error:init.stderr.trim() || "Git could not start here." };
  }
  const found = await git(dir, ["rev-parse", "--git-path", "info/exclude"]);
  if (!found.ok) return giveUp(found.stderr.trim());
  const exclude = path.resolve(dir, found.stdout.trim());
  let text = "";
  try { text = fs.readFileSync(exclude, "utf8"); } catch { /* Git has not made one yet. */ }
  const missing = NEVER_TRACKED.filter(line => !text.split("\n").includes(line));
  if (missing.length) { fs.mkdirSync(path.dirname(exclude), { recursive:true }); fs.writeFileSync(exclude, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`); }
  const added = await git(dir, ["add", "-A"], { timeout:300000 });
  if (!added.ok) return giveUp(added.stderr.trim().split("\n").pop() || "Git could not read this folder.");
  // An empty folder still gets its commit.
  const args = ["commit", "-q", "--allow-empty", "-m", message];
  let done = await git(dir, args, { timeout:120000 });
  if (!done.ok && /identity|tell me who you are|user\.(name|email)/i.test(done.stderr)) done = await git(dir, ["-c", "user.name=PenEcho", "-c", "user.email=agent@penecho.local", ...args], { timeout:120000 });
  return done.ok ? { ok:true, commit:await headOf(dir) } : giveUp((done.stderr || done.stdout).trim().split("\n").pop() || "Git could not make the first commit.");
}
// PenEcho never merges. An agent does, and these only read what Git says afterwards.
// Whether every commit on a branch is in the target now.
async function isMergedInto(repo, branch, target) {
  if (!await branchExists(repo, branch) || !await branchExists(repo, target)) return false;
  return (await git(repo, ["merge-base", "--is-ancestor", `refs/heads/${branch}`, `refs/heads/${target}`])).ok;
}
// Whether a branch had work of its own and all of it is in the target now. A branch never committed on is in its target from the start, and is not merged. Without the branch's reflog, only a merge commit says so.
async function landedOn(repo, branch, target) {
  if (!await isMergedInto(repo, branch, target)) return false;
  const tip = (await git(repo, ["rev-parse", `refs/heads/${branch}`])).stdout.trim(), made = await branchMade(repo, branch);
  if (made?.from) return made.from !== tip;
  const line = await git(repo, ["rev-list", "--first-parent", `refs/heads/${target}`]);
  return line.ok && !line.stdout.split("\n").includes(tip);
}
// The commit that brought a branch in: the first on the target that has the branch's tip behind it. A fast-forward has none of its own, so it is the tip.
async function mergeCommitOf(repo, branch, target) {
  const tip = (await git(repo, ["rev-parse", "--short", `refs/heads/${branch}`])).stdout.trim();
  const r = await git(repo, ["rev-list", "--ancestry-path", "--reverse", "--abbrev-commit", `refs/heads/${branch}..refs/heads/${target}`]);
  return (r.ok && r.stdout.split("\n").find(Boolean)) || tip;
}

module.exports = { git, isRepo, currentBranch, defaultBranch, isClean, commonDir, hasCommits, headOf, unmergedBranches, startTracking, branchExists, validBranch, ensureWorktree, removeWorktree, worktreeOf, branchMade, worktrees, isAncestor, aheadCount, deleteBranch, showFile, diffStat, changedPaths, diffFiles, commitAll, isMergedInto, landedOn, mergeCommitOf };
