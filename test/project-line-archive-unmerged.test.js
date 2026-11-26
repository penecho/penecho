"use strict";
// Archive asks first when it would hide a branch's commits that are not yet where the branch merges to.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");
// Values made inside the vm have its own prototypes, so they are compared as JSON.
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));

const source = fs.readFileSync(path.join(__dirname, "../public/lines/line.js"), "utf8");
const from = source.indexOf("// The branches that would leave the map"), to = source.indexOf("// A Topic stays on the lines until you do this", from);

function load(p) {
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  const make = document.createElement.bind(document);
  document.createElement = tag => {
    const el = make(tag);
    if (tag === "dialog") { el.showModal = () => { el.open = true; }; el.close = () => { el.open = false; el.dispatchEvent(new document.defaultView.Event("close")); }; }
    return el;
  };
  const ctx = {
    document, S:{ route:{ view:"home" } },
    esc:x => String(x), ic:name => `<i>${name}</i>`, $:(sel, root = document) => root.querySelector(sel),
    allLines:q => [...q.lines, ...(q.landed || []), ...(q.backlog || [])],
    branchInfo:(q, l) => q.branches?.[l.branch] || {},
    canMerge:(q, l) => Boolean(l.branch) && (q.branches?.[l.branch] || {}).mergeable !== false,
    mergeTarget:(q, l) => ({ name:(q.branches?.[l.branch] || {}).parent || "main" }),
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(from, to), ctx);
  return { ctx, document };
}
const line = (id, branch, extra = {}) => ({ id, title:id, branch, stations:[{ id:`${id}-m`, kind:"merge", state:"wait" }], ...extra });
const project = () => ({
  trunk:"main", landed:[], backlog:[],
  lines:[line("a1", "work/a"), line("b1", "work/b"), line("b2", "work/b"), line("m1", "work/merged"), line("e1", "work/empty"), line("n1", "")],
  branches:{ "work/a":{ mergeable:true, ahead:3 }, "work/b":{ mergeable:true, ahead:1, parent:"work/a" }, "work/merged":{ merged:true, mergeable:false }, "work/empty":{ mergeable:false } },
});

test("only a branch with commits of its own, merged nowhere, and left with no line counts", () => {
  const p = project(), { ctx } = load(p), by = id => p.lines.find(l => l.id === id);
  same(ctx.unmergedLeaving(p, [by("a1")]).map(b => [b.branch, b.into, b.ahead]), [["work/a", "main", 3]]);
  same(ctx.unmergedLeaving(p, [by("m1"), by("e1"), by("n1")]), []);
  // Another line still on the branch keeps it on the map.
  same(ctx.unmergedLeaving(p, [by("b1")]), []);
  same(ctx.unmergedLeaving(p, [by("b1"), by("b2")]).map(b => [b.branch, b.into]), [["work/b", "work/a"]]);
  // Before Git has answered, nothing is in the way.
  same(ctx.unmergedLeaving({ ...p, branches:{} }, [by("a1")]), []);
});

test("nothing unmerged archives at once, with no dialog", async () => {
  const p = project(), { ctx, document } = load(p);
  same(await ctx.archiveWarning(p, [p.lines[3]]), { choice:"archive" });
  assert.equal(document.querySelector("dialog"), null);
});

test("unmerged work asks: Cancel, Merge first or Archive anyway", async () => {
  const p = project(), { ctx, document } = load(p);
  let pending = ctx.archiveWarning(p, [p.lines[0]]), dialog = document.querySelector("dialog");
  assert.match(dialog.textContent, /work\/a has 3 commits not in main/);
  assert.ok(dialog.querySelector("[data-merge]"));
  dialog.querySelector("[data-cancel]").onclick();
  assert.equal(await pending, null);
  assert.equal(document.querySelector("dialog"), null);

  pending = ctx.archiveWarning(p, [p.lines[0]]);
  document.querySelector("[data-merge]").onclick();
  const merge = await pending;
  assert.equal(merge.choice, "merge"); assert.equal(merge.line.id, "a1"); assert.equal(merge.step.id, "a1-m");

  pending = ctx.archiveWarning(p, [p.lines[0]]);
  document.querySelector("form").onsubmit({ preventDefault() {} });
  same(await pending, { choice:"archive" });
});

test("a whole branch lists each unmerged branch once, and Merge first only for a single one with a Merge waiting", async () => {
  const p = project(), { ctx, document } = load(p);
  const pending = ctx.archiveWarning(p, [p.lines[0], p.lines[1], p.lines[2]]), dialog = document.querySelector("dialog");
  assert.equal(dialog.querySelectorAll("li").length, 2);
  assert.match(dialog.textContent, /work\/b has 1 commit not in work\/a/);
  assert.equal(dialog.querySelector("[data-merge]"), null);
  dialog.querySelector("[data-cancel]").onclick();
  assert.equal(await pending, null);

  const working = { ...project(), lines:[line("w1", "work/a", { stations:[{ id:"w", kind:"work", state:"active" }] })] };
  const w = load(working), asking = w.ctx.archiveWarning(working, working.lines);
  assert.equal(w.document.querySelector("[data-merge]"), null);
  w.document.querySelector("[data-cancel]").onclick();
  await asking;
});
