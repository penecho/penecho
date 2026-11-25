"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.join(__dirname, "..");

function harness() {
  const lightbox = { hidden:true, innerHTML:"" };
  const closeBtn = { focus() {} };
  const cardEvents = {}, viewportEvents = {};
  const card = { isConnected:true, addEventListener:(name, fn) => { cardEvents[name] = fn; } };
  const viewport = {
    clientWidth:800, clientHeight:600, style:{},
    classList:{ add() {}, remove() {} },
    addEventListener:(name, fn) => { viewportEvents[name] = fn; },
    hasPointerCapture:() => false,
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  const imgEl = { naturalWidth:120, naturalHeight:80, style:{}, addEventListener() {} };
  const outEl = { value:"" };
  const zoomOut = { disabled:false }, zoomIn = { disabled:false };
  const filePick = { addEventListener() {} };
  const calls = [];
  const form = { dataset:{ comp:"home-p", preview:"1", on:"home" } };
  const project = {
    id:"p",
    files:[{ path:"files/_incoming/saved.png", mtime:5, size:200 }],
    pictures:[],
  };
  const context = vm.createContext({
    S:{ cur:"p", comp:{}, data:{ p:project } },
    ACT:{}, HOSTED:null, EMBED:null, FV:{ opening:0 },
    CSS:{ escape:String }, can:() => true,
    navigator:{ platform:"MacIntel" },
    ResizeObserver:class { observe() {} disconnect() {} },
    addEventListener() {},
    document:{
      getElementById:id => id === "lightbox" ? lightbox : null,
      addEventListener() {},
    },
    project:() => project,
    pathFor:id => `/projects/${id}`,
    apiUrl:u => u,
    fileUrl:(p, f, dl) => `/projects/${p.id}/file?path=${encodeURIComponent(f)}${dl ? "&dl=1" : ""}`,
    esc:s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])),
    ic:name => `<svg data-ic="${name}"></svg>`,
    fmtSize:n => `${n} B`,
    FILE_ICON:() => "file",
    clamp:(v, a, b) => Math.max(a, Math.min(b, v)),
    uid:() => "u1",
    canvasUrl:(p, args) => ({ project:p.id, ...args }),
    openCanvasPage:(url, from) => calls.push(["canvas", url, from]),
    freeSource:() => "files/_incoming/drawing.penecho.json",
    rememberBoxes() {},
    closeLightbox:() => { lightbox.hidden = true; lightbox.innerHTML = ""; },
    uploadBoxes:async () => {},
    targetBody:() => ({}),
    boxTarget:() => ({}),
    sessionStorage:{ getItem:() => null, setItem() {}, removeItem() {} },
    $: (sel, rootEl) => {
      if (sel === "#lightbox") return lightbox;
      if (sel === "#filePick") return filePick;
      if (sel === '[data-act="lb-close"]' && rootEl === lightbox) return closeBtn;
      if (sel === ".lb-photo-preview" && rootEl === lightbox) return card;
      if (sel === ".lb-image-viewport" && rootEl === card) return viewport;
      if (sel === "img" && rootEl === viewport) return imgEl;
      if (sel === "output" && rootEl === card) return outEl;
      if (sel === '[data-zoom="out"]' && rootEl === card) return zoomOut;
      if (sel === '[data-zoom="in"]' && rootEl === card) return zoomIn;
      if (sel === ".cmp-file-pic, .orch-file-pic") return { tagName:"BUTTON", className:"cmp-file-pic" };
      return null;
    },
    $$: () => [],
    toast:msg => calls.push(["toast", msg]),
  });
  const state = fs.readFileSync(path.join(root, "public/lines/state.js"), "utf8");
  vm.runInContext(state.slice(state.indexOf("const fileEntry ="), state.indexOf("const docKind =")), context);
  for (const name of ["composer", "pages"]) {
    const src = fs.readFileSync(path.join(root, `public/lines/${name}.js`), "utf8");
    if (name === "composer") vm.runInContext(src, context, { filename:name });
    else {
      const start = src.indexOf("const previewable =");
      const end = src.indexOf("ACT['lb-close'] =");
      vm.runInContext(src.slice(start, end), context, { filename:name });
    }
  }
  return { context, lightbox, form, calls, project, cardEvents, viewportEvents, imgEl };
}

test("drawable attachment renders separate preview image and Click to draw on it button", () => {
  const h = harness();
  const html = h.context.boxFile(h.form, { id:"f1", name:"shot.png", type:"image/png", size:120, url:"blob:shot-1" });
  assert.match(html, /class="cmp-file-pic"[^>]*data-act="cmp-preview"/);
  assert.doesNotMatch(html, /class="cmp-file-pic"[^>]*cmp-edit-draw/);
  assert.match(html, /class="cmp-file-text"[^>]*><strong>shot\.png<\/strong><button type="button" class="cmp-file-edit" data-act="cmp-edit-draw"[^>]*>.*Click to draw on it<\/span><\/button><\/div>/);
});

test("non-drawable image attachment previews on click and shows no draw button", () => {
  const h = harness();
  const html = h.context.boxFile(h.form, { id:"f2", name:"icon.svg", type:"image/svg+xml", size:88, url:"blob:svg-1" });
  assert.match(html, /class="cmp-file-pic"[^>]*data-act="cmp-preview"/);
  assert.doesNotMatch(html, /cmp-edit-draw/);
  assert.match(html, /<strong>icon\.svg<\/strong><span>88 B<\/span>/);
});

test("clicking attached blob image opens lightbox preview and cycles through box images", () => {
  const h = harness();
  vm.runInContext(`
    comp('home-p').files = [
      { id:'f1', name:'first.png', type:'image/png', url:'blob:first' },
      { id:'f2', name:'saved.png', type:'image/png', path:'files/_incoming/saved.png', url:'/projects/p/file?path=files%2F_incoming%2Fsaved.png' },
      { id:'f3', name:'notes.txt', type:'text/plain', size:12 }
    ];
  `, h.context);
  const el = { dataset:{ file:"f1" }, closest:sel => sel === ".composer" ? h.form : null };
  h.context.ACT["cmp-preview"](el);
  assert.equal(h.lightbox.hidden, false);
  assert.match(h.lightbox.innerHTML, /<strong[^>]*>first\.png<\/strong>/);
  assert.match(h.lightbox.innerHTML, /data-act="lb-edit"[^>]*>.*Edit on canvas<\/button>/);
  assert.match(h.lightbox.innerHTML, /<span class="lb-count"[^>]*>1 \/ 2<\/span>/);
  assert.match(h.lightbox.innerHTML, /<img src="blob:first" alt="first\.png"/);
  assert.doesNotMatch(h.lightbox.innerHTML, /data-copy-image/);
  h.viewportEvents.contextmenu({ preventDefault:() => assert.fail("The browser menu should stay available") });
  assert.match(h.lightbox.innerHTML, /href="blob:first" download="first\.png"/);
  assert.equal(h.calls.length, 0);

  h.context.lbStep(1);
  assert.match(h.lightbox.innerHTML, /<strong[^>]*>saved\.png<\/strong>/);
  assert.match(h.lightbox.innerHTML, /<span class="lb-count"[^>]*>2 \/ 2<\/span>/);
  assert.match(h.lightbox.innerHTML, /\/projects\/p\/file\?path=files%2F_incoming%2Fsaved\.png/);
});

test("image preview copies the source PNG from the right-click menu and the visible button", async () => {
  const h = harness();
  const imageSrc = "blob:full-image";
  const png = new Blob(["PNG bytes"], { type:"image/png" });
  let menu, menuPoint, prevented = false;
  const writes = [];
  h.imgEl.currentSrc = imageSrc;
  h.context.ClipboardItem = class { constructor(types) { this.types = types; } };
  h.context.fetch = async src => {
    assert.equal(src, imageSrc);
    return { ok:true, blob:async () => png };
  };
  h.context.navigator.clipboard = {
    async write([item]) { writes.push(await item.types["image/png"]); },
  };
  h.context.openMenu = (_anchor, items, { point }) => { [menu] = items; menuPoint = [point.x, point.y]; };

  h.context.openLightbox(h.project, { name:"drawing.png", url:imageSrc });
  assert.match(h.lightbox.innerHTML, /data-copy-image[^>]*>.*<span>Copy image<\/span><\/button>/);
  h.viewportEvents.contextmenu({ clientX:140, clientY:250, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(menu.label, "Copy image");
  assert.deepEqual(menuPoint, [140, 250]);
  await menu.fn();
  h.cardEvents.click({ target:{ closest:selector => selector === "[data-copy-image]" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, [png, png]);
  assert.deepEqual(h.calls, [["toast", "Copied the image"], ["toast", "Copied the image"]]);
});

test("Edit on canvas uses the current attachment ID when two gallery items share a path", async () => {
  const h = harness();
  vm.runInContext(`
    comp('home-p').files = ['first', 'second'].map(id => ({ id, name:'saved.png', type:'image/png', path:'files/_incoming/saved.png', url:'blob:' + id }));
  `, h.context);
  let handoff;
  h.context.sessionStorage.setItem = (key, data) => { if (key === "penecho-lines-drawing") handoff = JSON.parse(data); };
  h.context.ACT["cmp-preview"]({ dataset:{ file:"first" }, closest:() => h.form });
  h.context.lbStep(1);
  assert.match(h.lightbox.innerHTML, /2 \/ 2/);
  await h.context.ACT["lb-edit"]({ disabled:false });
  assert.equal(h.lightbox.hidden, true);
  assert.equal(handoff.file, "second");
  assert.equal(h.calls[0][1].seed, "files/_incoming/saved.png");
});

test("a standalone image gets a separate Canvas and a saved drawing reopens its editable source", async () => {
  const h = harness();
  h.project.files.push(...["shot.png", "shot-edited.png", "shot-edited-2.penecho.json", "drawing.png"].map(name => ({ path:`files/example/${name}`, mtime:5 })));
  h.project.pictures.push({ path:"files/example/drawing.png", source:"files/example/drawing.penecho.json", topic:"example", title:"Drawing" });
  h.context.openLightbox(h.project, "files/example/shot.png");
  await h.context.ACT["lb-edit"]({ disabled:false });
  assert.equal(h.calls[0][1].seed, "files/example/shot.png");
  assert.equal(h.calls[0][1].source, "files/example/shot-edited-3.penecho.json");
  assert.equal(h.calls[0][1].draft, undefined);
  h.context.openLightbox(h.project, "files/example/drawing.png");
  await h.context.ACT["lb-edit"]({ disabled:false });
  assert.equal(h.calls[1][1].source, "files/example/drawing.penecho.json");
  assert.equal(h.calls[1][1].doc, "lines/example.md");
  assert.equal(h.calls[1][1].seed, undefined);
});

test("preview editing respects permissions and restores the preview when opening Canvas fails", async () => {
  const h = harness(), path = "files/_incoming/saved.png";
  h.context.HOSTED = { shared:true };
  h.context.openLightbox(h.project, path);
  assert.doesNotMatch(h.lightbox.innerHTML, /data-act="lb-edit"/);
  h.context.HOSTED = null;
  h.context.openCanvasPage = async () => { throw new Error("Canvas unavailable"); };
  h.context.openLightbox(h.project, path);
  await h.context.ACT["lb-edit"]({ disabled:false });
  assert.equal(h.lightbox.hidden, false);
  assert.match(h.lightbox.innerHTML, /data-act="lb-edit"/);
  assert.deepEqual(h.calls, [["toast", "Canvas unavailable"]]);
});

test("clicking Click to draw on it opens Canvas using the thumbnail as zoom source", async () => {
  const h = harness();
  vm.runInContext(`
    comp('home-p').files = [{ id:'f1', name:'first.png', type:'image/png', url:'blob:first' }];
  `, h.context);
  const el = { dataset:{ file:"f1" }, closest:sel => sel === ".composer" ? h.form : sel === ".cmp-file, .orch-file" ? {} : null };
  h.context.ACT["cmp-edit-draw"](el);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.lightbox.hidden, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], "canvas");
  assert.equal(h.calls[0][1].draft, true);
  assert.equal(h.calls[0][2].className, "cmp-file-pic");
});
