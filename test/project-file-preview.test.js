"use strict";
require("./helpers/safety.js");

const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");

function harness(count = 1) {
  const events = {}, observers = {}, frames = [];
  const elements = Array.from({ length:count }, (_, i) => ({
    isConnected:true, clientWidth:256, clientHeight:128,
    dataset:{ pageUrl:`/api/lines/projects/p/file?path=files%2Fpage-${i}.html&v=1` },
    append(frame) { this.frame = frame; frames.push(frame); },
  }));
  const p = { id:"p", files:[], pictures:[] }, body = { dataset:{ h:"same" }, writes:0, set innerHTML(value) { this.writes++; this.html = value; } };
  const observer = name => class {
    constructor(callback) { this.callback = callback; this.observed = new Set(); observers[name] = this; }
    observe(el) { this.observed.add(el); }
    unobserve(el) { this.observed.delete(el); }
    disconnect() { this.observed.clear(); }
  };
  const context = vm.createContext({
    ICONS:{}, ACT:{}, S:{ cur:"p", route:{ view:"files" } }, HOSTED:false,
    addEventListener() {},
    document:{ hidden:false, addEventListener:(name, fn) => (events[name] ||= []).push(fn), createElement:tag => {
      assert.equal(tag, "iframe");
      const listeners = {}, frame = { attributes:{}, style:{}, classList:new Set(),
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener(name, fn) { listeners[name] = fn; },
        event(name) { listeners[name]?.(); },
        remove() { this.removed = true; },
      };
      return frame;
    } },
    IntersectionObserver:observer("intersection"), ResizeObserver:observer("resize"), MutationObserver:observer("mutation"),
    $:selector => selector === "#flBody" || selector === "#view" ? body : null,
    $$:() => elements.filter(el => el.isConnected), project:() => p,
    lineById:() => null, av:() => "", ic:() => "", shortWhen:() => "Today", can:() => true,
    esc:s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])),
    assetUrl:(_p, file) => `/asset/${file}`, fileUrl:(_p, file) => `/api/lines/projects/p/file?path=${encodeURIComponent(file)}`,
  });
  const run = code => vm.runInContext(code, context);
  run(fs.readFileSync(path.join(__dirname, "../public/lines/files.js"), "utf8"));
  return { context, run, p, elements, frames, observers, body,
    mount:() => run("flPreviewMount()"),
    intersect:(el, visible) => observers.intersection.callback([{ target:el, isIntersecting:visible }]),
    visibility:hidden => { context.document.hidden = hidden; for (const fn of events.visibilitychange) fn(); },
  };
}

test("page cards keep their name, Page badge and fallback, using versioned project URLs", () => {
  const h = harness();
  const render = item => { h.context.item = { key:item.path, by:"you", mtime:12.7, ...item }; return h.run("flCardHTML(project(), item)"); };
  const page = render({ path:"files/line/prototype & one.html", kind:"page", title:"Prototype & one" });
  assert.match(page, /data-page-url="\/api\/lines\/projects\/p\/file\?path=files%2Fline%2Fprototype%20%26%20one.html&amp;v=13"/);
  assert.match(page, /aria-hidden="true" inert/);
  assert.match(page, /<span class="fl-mark">/);
  assert.match(page, /Prototype &amp; one/);
  assert.match(page, /<span class="fl-k">Page<\/span>/);
  assert.doesNotMatch(page, /<iframe/);
  const folder = render({ path:"files/site/index.html", kind:"page", title:"Site", folder:true });
  assert.match(folder, /data-page-url="\/api\/lines\/projects\/p\/page\/files\/site\/index.html\?v=13"/);
  const picture = render({ path:"files/picture.png", kind:"picture", title:"Picture", pic:"files/picture.png" });
  assert.match(picture, /<img src="\/asset\/files\/picture.png"/);
  assert.doesNotMatch(picture, /fl-page-preview/);
  const document = render({ path:"files/report.md", kind:"document", title:"Report" });
  assert.doesNotMatch(document, /fl-page-preview/);
});

test("a long list runs only intersecting previews, with the viewer's sandbox and no keyboard control", () => {
  const h = harness(200); h.mount();
  assert.equal(h.frames.length, 0, "mounting cards does not load their pages");
  for (const el of h.elements.slice(0, 3)) h.intersect(el, true);
  assert.equal(h.frames.filter(f => !f.removed).length, 3);
  const frame = h.frames[0];
  assert.equal(frame.attributes.sandbox, "allow-scripts");
  assert.equal(frame.attributes.allow, "focus-without-user-activation 'none'");
  assert.equal(frame.attributes["aria-hidden"], "true");
  assert.equal(frame.tabIndex, -1);
  assert.equal(frame.src, h.elements[0].dataset.pageUrl);
  assert.equal(frame.classList.has("is-ready"), false);
  frame.event("load");
  assert.equal(frame.classList.has("is-ready"), true);
  h.intersect(h.elements[0], false);
  assert.equal(frame.removed, true);
  h.intersect(h.elements[0], true);
  assert.equal(h.frames.filter(f => !f.removed).length, 3);
  assert.notEqual(h.elements[0].frame, frame);
});

test("resizing scales the whole desktop page and covers the thumbnail at narrow widths", () => {
  const h = harness(); h.mount(); h.intersect(h.elements[0], true);
  const el = h.elements[0], frame = el.frame;
  assert.equal(frame.style.transform, "scale(0.2)");
  assert.equal(frame.style.height, "800px");
  el.clientWidth = 200; el.clientHeight = 128;
  h.observers.resize.callback([{ target:el }]);
  assert.equal(frame.style.transform, "scale(0.15625)");
  assert.equal(frame.style.height, "820px");
  assert.ok(parseInt(frame.style.height) * 200 / 1280 >= el.clientHeight);
  assert.equal(el.frame, frame, "resizing does not reload the page");
});

test("unchanged polling preserves previews; changed cards and leaving Files release both observers", () => {
  const h = harness(2); h.mount(); h.intersect(h.elements[0], true);
  const first = h.elements[0].frame;
  h.run("flBodyHTML = () => 'same'; flRedraw({sheet:false})");
  assert.equal(h.body.writes, 0);
  assert.equal(h.elements[0].frame, first);
  assert.equal(h.frames.length, 1);
  h.elements[0].isConnected = false;
  h.mount();
  assert.equal(first.removed, true);
  assert.equal(h.observers.intersection.observed.has(h.elements[0]), false);
  assert.equal(h.observers.resize.observed.has(h.elements[0]), false);
  const last = h.elements[1]; h.intersect(last, true); last.isConnected = false;
  h.intersect(last, false);
  assert.equal(last.frame.removed, true);
  assert.equal(h.observers.intersection.observed.size, 0);
  assert.equal(h.observers.resize.observed.size, 0);
  assert.equal(h.run("flPreviews.size"), 0);
});

test("hidden documents stop all previews and restore only visible connected cards", () => {
  const h = harness(3); h.mount();
  h.intersect(h.elements[0], true); h.intersect(h.elements[1], true);
  h.visibility(true);
  assert.equal(h.frames.filter(f => !f.removed).length, 0);
  h.elements[1].isConnected = false;
  h.visibility(false);
  assert.equal(h.frames.filter(f => !f.removed).length, 1);
  assert.equal(h.elements[0].frame.removed, undefined);
  assert.equal(h.observers.resize.observed.has(h.elements[1]), false);
});

test("leaving Files also releases cards that never entered the viewport", () => {
  const h = harness(200); h.mount(); h.intersect(h.elements[0], true);
  for (const el of h.elements) el.isConnected = false;
  h.observers.mutation.callback();
  assert.equal(h.run("flPreviews.size"), 0);
  assert.equal(h.frames[0].removed, true);
  assert.equal(h.observers.intersection.observed.size, 0);
  assert.equal(h.observers.resize.observed.size, 0);
  assert.equal(h.observers.mutation.observed.size, 0);
});

test("without observation APIs the original icon remains available", () => {
  const h = harness();
  h.context.IntersectionObserver = undefined;
  h.mount();
  assert.equal(h.frames.length, 0);
  assert.equal(h.run("flPreviews.size"), 0);
});
