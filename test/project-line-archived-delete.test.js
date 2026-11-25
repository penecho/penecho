"use strict";
require("./helpers/safety.js");
// Delete on the Archived projects page asks first, then takes the project out of PenEcho for good.
const { test } = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm");
const fs = require("node:fs"), path = require("node:path");
const pages = fs.readFileSync(path.join(__dirname, "../public/lines/pages.js"), "utf8");
const shelf = pages.slice(pages.indexOf("function archivedProjectsHTML("), pages.indexOf("ACT['shelf-restore']"));

function fakeDialog() {
  const parts = {}, el = name => (parts[name] ||= { disabled:false, hidden:true, textContent:"", focus() { this.focused = true; } });
  const dialog = { innerHTML:"", className:"", listeners:{}, open:false,
    setAttribute() {}, addEventListener(type, fn) { this.listeners[type] = fn; },
    showModal() { this.open = true; }, close() { this.open = false; this.listeners.close?.(); }, remove() { this.removed = true; } };
  return { dialog, el, parts };
}
function setup({ fail = false } = {}) {
  const calls = [], toasts = [], d = fakeDialog(), appended = [];
  const projects = [
    { id:"w", name:"Weather app", archived:true, archivedAt:2, example:"code", docsPath:"/h/.penecho/project-lines/examples/Weather app", code:"/h/.penecho/project-lines/examples/weather-app" },
    { id:"m", name:"Mine", archived:true, archivedAt:1, docsPath:"/h/docs/Mine", code:"/h/code/mine" },
    { id:"k", name:"Knowledge", archived:false, docsPath:"/h/k", code:"" },
  ];
  const S = { projects, tabs:["w", "k"], data:{ w:{}, k:{} }, cur:"w" };
  const ctx = { S, ACT:{}, console, esc:x => String(x), ic:name => `<i>${name}</i>`, glyph:() => "", homeShort:p => p.replace(/^\/h/, "~"), dayWhen:() => "today",
    summaryOf:id => S.projects.find(p => p.id === id), pathFor:id => `/p/${id}`, rememberTabs:() => {}, render:() => {},
    api:async (url, opts) => { calls.push([opts.method, url]); if (fail) throw new Error("Could not delete."); },
    loadProjects:async () => { if (!fail) S.projects = S.projects.filter(p => p.id !== calls.at(-1)[1].slice(3)); },
    toast:text => toasts.push(text),
    document:{ createElement:() => d.dialog, body:{ append:x => appended.push(x) } },
    $:(sel, root) => sel === "form" ? (d.form ||= {}) : sel.startsWith("[data-cancel]") ? (d.cancel ||= { focus() { this.focused = true; } }) : sel.startsWith("button") ? d.el("submit") : d.el("error") };
  vm.createContext(ctx);
  vm.runInContext(shelf, ctx);
  return { ctx, S, calls, toasts, d };
}

test("every archived row offers Delete beside Restore", () => {
  const { ctx } = setup();
  const html = vm.runInContext("archivedProjectsHTML()", ctx);
  assert.equal((html.match(/data-act="shelf-delete"/g) || []).length, 2);
  assert.match(html, /data-act="shelf-restore" data-p="w">Restore<\/button>\s*<button[^>]*data-act="shelf-delete" data-p="w"[^>]*aria-label="Delete Weather app"/);
});

test("Delete asks first, and Cancel sends nothing", async () => {
  const { ctx, calls, d } = setup();
  ctx.ACT["shelf-delete"]({ dataset:{ p:"m" }, isConnected:true, focus() {} });
  assert.ok(d.dialog.open);
  assert.match(d.dialog.innerHTML, /Delete project\?/);
  assert.match(d.dialog.innerHTML, /cannot be undone/);
  assert.match(d.dialog.innerHTML, /folders stay where they are: <code>~\/docs\/Mine<\/code> and <code>~\/code\/mine<\/code>/);
  assert.ok(d.cancel.focused, "Cancel has the focus, so Enter does not delete");
  d.cancel.onclick();
  assert.equal(d.dialog.open, false);
  assert.deepEqual(calls, []);
});

test("an example says its folders go too; confirming deletes it and drops its tab", async () => {
  const { ctx, S, calls, toasts, d } = setup();
  ctx.ACT["shelf-delete"]({ dataset:{ p:"w" }, isConnected:true, focus() {} });
  assert.match(d.dialog.innerHTML, /example folders, which PenEcho made, are deleted too/);
  await d.form.onsubmit({ preventDefault() {} });
  assert.deepEqual(calls, [["DELETE", "/p/w"]]);
  assert.equal(d.dialog.open, false);
  assert.deepEqual([...S.tabs], ["k"]);
  assert.equal(S.data.w, undefined);
  assert.equal(S.cur, "k", "the deleted project is no longer the current one");
  assert.ok(!S.projects.some(p => p.id === "w"));
  assert.deepEqual(toasts, ["Deleted Weather app"]);
});

test("a failure stays in the box and leaves everything as it was", async () => {
  const { ctx, S, toasts, d } = setup({ fail:true });
  ctx.ACT["shelf-delete"]({ dataset:{ p:"m" }, isConnected:true, focus() {} });
  await d.form.onsubmit({ preventDefault() {} });
  assert.ok(d.dialog.open);
  assert.equal(d.parts.error.hidden, false);
  assert.equal(d.parts.error.textContent, "Could not delete.");
  assert.equal(d.parts.submit.disabled, false);
  assert.ok(S.projects.some(p => p.id === "m"));
  assert.deepEqual(toasts, []);
});
