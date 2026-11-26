"use strict";
require("./helpers/safety.js");
// Archive on a branch's label takes the lines on that branch and on every branch off it, and nothing else, with one Undo for them all.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(p) {
  const posts = [], toasts = [], ctx = { ACT:{}, S:{ plan:[{ from:"b1" }, { from:"m1" }], mapFilter:{} }, console };
  Object.assign(ctx, {
    project:() => p, esc:x => String(x), ic:name => `<i>${name}</i>`, pathFor:id => `/p/${id}`,
    // PenEcho's server reads every POST as JSON, so a POST with no body fails there.
    api:async (url, opts) => { if (opts.method === "POST" && opts.body === undefined && opts.raw === undefined) throw new Error("Something went wrong reading this project."); posts.push([opts.method, url]); }, loadState:async () => {}, toast:(text, undo) => toasts.push({ text, undo }), refreshAfterChange:() => {},
    lineState:() => "ready", toReview:() => false, lineHint:() => "", boxTarget:() => null, homeBox:() => null, mergeTarget:() => ({ name:"main", to:"main" }),
    archiveWarning:async () => ({ choice:"archive" }), openMergeFor:() => {},
  });
  vm.createContext(ctx);
  const state = fs.readFileSync(path.join(__dirname, "../public/lines/state.js"), "utf8");
  vm.runInContext(state.slice(state.indexOf("const allLines ="), state.indexOf("\n}", state.indexOf("function archiveScope")) + 2), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/lines/panorama.js"), "utf8"), ctx);
  return { ctx, posts, toasts };
}
const line = (id, branch) => ({ id, slug:id, title:id, branch, started:`2026-11-0${id.length} 09:00`, stations:[] });
const project = () => ({ id:"p", trunk:"main", landed:[], backlog:[], lines:[line("m1", ""), line("b1", "work/big"), line("b2", "work/big"), line("s1", "work/sub"), line("d1", "work/deep"), line("o1", "work/other")], branches:{ "work/big":{ parent:"main" }, "work/sub":{ parent:"work/big" }, "work/deep":{ parent:"work/sub" }, "work/other":{ parent:"main" } } });

test("Archive on a branch closes its lines and its sub-branches' lines, and Undo reopens them", async () => {
  const { ctx, posts, toasts } = load(project());
  await ctx.ACT["archive-branch"]({ dataset:{ branch:"work/big" } });
  assert.deepEqual(posts.map(x => x[1]).sort(), ["/p/p/topics/b1/close", "/p/p/topics/b2/close", "/p/p/topics/d1/close", "/p/p/topics/s1/close"]);
  assert.deepEqual(ctx.S.plan.map(x => x.from), ["m1"]);
  assert.equal(toasts[0].text, "Archived work/big and its 4 lines.");
  posts.length = 0;
  await toasts[0].undo.fn();
  assert.deepEqual(posts.map(x => x[1]).sort(), ["/p/p/topics/b1/reopen", "/p/p/topics/b2/reopen", "/p/p/topics/d1/reopen", "/p/p/topics/s1/reopen"]);
});

test("Archive on the deepest branch takes only its own line", async () => {
  const { ctx, posts, toasts } = load(project());
  await ctx.ACT["archive-branch"]({ dataset:{ branch:"work/deep" } });
  assert.deepEqual(posts.map(x => x[1]), ["/p/p/topics/d1/close"]);
  assert.equal(toasts[0].text, "Archived work/deep.");
});

test("Branch archive warns for off-branch sessions and archives and restores a job in one call each", async () => {
  const p = project();
  p.lines[1].orchestratorRef = "PE-JOB";
  p.lines.find(l => l.id === "b2").orchestratedBySlug = "b1";
  p.lines.find(l => l.id === "o1").orchestratedBySlug = "b1";
  const { ctx, posts, toasts } = load(p);
  ctx.archiveWarning = async (_project, moving) => {
    assert.deepEqual(Array.from(moving, l => l.id).sort(), ["b1", "b2", "d1", "o1", "s1"]);
    return { choice:"archive" };
  };
  ctx.api = async (url, options) => {
    posts.push([url, options.body]);
    if (url.endsWith("b1/close")) return { archiveOperation:"operation", archivedLines:["b1", "b2", "o1"] };
  };
  await ctx.ACT["archive-branch"]({ dataset:{ branch:"work/big" } });
  assert.deepEqual(posts.map(([url]) => url).sort(), ["/p/p/topics/b1/close", "/p/p/topics/d1/close", "/p/p/topics/s1/close"]);
  assert.deepEqual(Array.from(posts.find(([url]) => url.endsWith("b1/close"))[1].expectedChildren).sort(), ["b2", "o1"]);
  posts.length = 0;
  await toasts[0].undo.fn();
  assert.deepEqual(posts.map(([url]) => url).sort(), ["/p/p/topics/b1/reopen", "/p/p/topics/d1/reopen", "/p/p/topics/s1/reopen"]);
  assert.equal(posts.find(([url]) => url.endsWith("b1/reopen"))[1].archiveOperation, "operation");
});

test("A failure stops there, and Undo offers back only what was archived", async () => {
  const p = project(), { ctx, posts, toasts } = load(p);
  let n = 0;
  ctx.api = async url => { if (++n === 2) throw new Error("No such Topic"); posts.push(url); };
  await ctx.ACT["archive-branch"]({ dataset:{ branch:"work/big" } });
  assert.equal(posts.length, 1);
  assert.equal(toasts[0].text, "No such Topic");
  assert.equal(toasts[1].text, "Archived work/big.");
});

test("Cancel on the unmerged-work question archives nothing, and Merge first opens the Merge instead", async () => {
  const { ctx, posts } = load(project()), opened = [];
  ctx.archiveWarning = async () => null;
  await ctx.ACT["archive-branch"]({ dataset:{ branch:"work/big" } });
  ctx.archiveWarning = async () => ({ choice:"merge", line:{ id:"b1" }, step:{ id:"m" } });
  ctx.openMergeFor = (l, s) => opened.push([l.id, s.id]);
  await ctx.ACT["archive-branch"]({ dataset:{ branch:"work/big" } });
  assert.deepEqual(posts, []);
  assert.deepEqual(opened, [["b1", "m"]]);
});

test("Archive on the trunk takes nothing: there it would be every line in the project", async () => {
  const { ctx, posts, toasts } = load(project());
  await ctx.ACT["archive-branch"]({ dataset:{ branch:"main" } });
  assert.deepEqual(posts, []);
  assert.deepEqual(toasts, []);
});
