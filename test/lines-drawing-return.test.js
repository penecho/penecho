"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const read = name => fs.readFileSync(path.join(__dirname, "../public/lines", name), "utf8");
const drawing = { project:"p", comp:"home-p", source:"files/_incoming/drawing.penecho.json", picture:"files/_incoming/drawing.png", before:0 };
const drawingFiles = () => [{ path:drawing.picture, mtime:2, size:40 }, { path:drawing.source, mtime:2 }];
function harness({ embed = null, partial = "", files = true } = {}) {
  const storage = new Map(), calls = [];
  const p = { id:"p", partial, files:files ? drawingFiles() : [], pictures:[] };
  const c = { S:{ cur:"p", route:{view:"home"}, comp:{}, data:{p} }, EMBED:embed, HOSTED:false,
    navigator:{ platform:"Mac" }, ACT:{}, console, setTimeout, clearTimeout,
    sessionStorage:{ getItem:k => storage.get(k) || null, setItem:(k, v) => storage.set(k, String(v)), removeItem:k => storage.delete(k) },
    project:id => c.S.data[id || c.S.cur], pathFor:id => `/projects/${id}`, apiUrl:x => x,
    uid:() => "attachment", lineById:() => null, stationById:() => null,
    loadState:async (id, options) => { calls.push(["state", id, options]); c.S.data[id] = { ...p, partial:"", files:partial ? drawingFiles() : p.files }; },
    api:async (...args) => { calls.push(["api", ...args]); return { slug:"new", step:"s" }; },
    loadProjects:async () => {}, go:r => calls.push(["go", r]), scrollToItem:() => {},
    can:() => true, freeSource:() => drawing.source, canvasUrl:(_p, args) => args,
    openCanvasPage:args => calls.push(["open", args]), targetBody:() => ({}), boxTarget:() => ({}),
  };
  vm.createContext(c);
  const state = read("state.js");
  vm.runInContext(state.slice(state.indexOf("const fileEntry ="), state.indexOf("const docKind =")), c);
  vm.runInContext(read("composer.js"), c);
  vm.runInContext(state.match(/^const stateView = .*$/m)[0], c);
  vm.runInContext(state.match(/^const listsFiles = .*$/m)[0], c);
  const run = code => vm.runInContext(code, c);
  run("comp('home-p').project = 'p'; comp('home-p').text = 'Keep my words';");
  const handoff = data => storage.set("penecho-lines-drawing", JSON.stringify({ ...drawing, ...data }));
  return { c, p, calls, storage, run, handoff, box:() => c.S.comp["home-p"] };
}
test("Home return reads the folder's files before attaching an incoming drawing", async () => {
  const h = harness({ partial:"light", files:false }); h.handoff();
  assert.equal(h.run("stateView('p')"), "light");
  await h.run("takeDrawing(project())");
  assert.equal(h.calls[0][0], "state");
  assert.equal(JSON.stringify(h.calls[0][2].needs), '{"parts":["files"]}');
  assert.equal(h.box().files.length, 1); assert.equal(h.box().files[0].source, drawing.source);
  assert.equal(h.box().text, "Keep my words");
  assert.equal(h.storage.has("penecho-lines-drawing"), false);
  assert.ok(h.storage.get("penecho-lines-boxes").includes(drawing.picture));
  assert.equal(h.calls.filter(x => x[0] === "api").length, 0);
});
test("an ordinary Home requests the light state", () => {
  const h = harness(); assert.equal(h.run("stateView('p')"), "light");
});

test("polling behind a live Canvas leaves new, unchanged and autosaved drawing handoffs pending", async () => {
  for (const { files, before } of [{ files:false, before:0 }, { files:true, before:2 }, { files:true, before:0 }]) {
    const h = harness({ files });
    h.c.window = { PenEchoCanvasShell:{ active:true } };
    h.handoff({ before, box:{ text:"Draft at Canvas open", files:[] } });
    const handoff = h.storage.get("penecho-lines-drawing");
    await h.run("takeDrawing(project())");
    assert.equal(h.storage.get("penecho-lines-drawing"), handoff);
    assert.equal(h.box().text, "Keep my words");
    assert.equal(h.box().files.length, 0);
    assert.equal(h.calls.length, 0);
  }
});
test("after Done, reconciliation reads fresh files even if a poll supplied a complete pre-save state", async () => {
  const h = harness({ files:false });
  h.c.window = { PenEchoCanvasShell:{ active:false } };
  h.handoff();
  h.c.loadState = async (id, options) => {
    assert.equal(id, h.p.id);
    assert.equal(JSON.stringify(options.needs), '{"parts":["files"]}');
    assert.equal(options.force, true);
    h.c.S.data[id] = { ...h.p, files:drawingFiles() };
  };
  await h.run("takeDrawing(project())");
  assert.equal(h.box().files.length, 1);
  assert.equal(h.box().files[0].source, drawing.source);
  assert.equal(h.storage.has("penecho-lines-drawing"), false);
});
test("a Canvas opening during the return read leaves the draft and handoff intact", async () => {
  const h = harness();
  const shell = { active:false };
  h.c.window = { PenEchoCanvasShell:shell };
  h.handoff({ box:{ text:"Draft at Canvas open", files:[] } });
  let release;
  h.c.loadState = () => new Promise(resolve => { release = resolve; });
  const returning = h.run("takeDrawing(project())");
  shell.active = true;
  release();
  await returning;
  assert.ok(h.storage.has("penecho-lines-drawing"));
  assert.equal(h.box().text, "Keep my words");
  assert.equal(h.box().files.length, 0);
});

test('Canvas returns the annotated image to its project’s Orchestrator draft, not to Home', async () => {
  const h = harness(), original = 'files/_incoming/original.png';
  h.p.files.push({ path:original, size:30 });
  h.run(`Object.assign(comp('orch-p'), { project:'p', text:'Explain this', files:[{ id:'photo', type:'image/png', path:'${original}', uploaded:{ path:'${original}' } }], flags:{ make:{kind:'slides', sub:'auto'} } })`);
  await h.run("openDrawing(project(), { dataset:{ comp:'orch-p', on:'orchestrator' } }, { file:comp('orch-p').files[0] })");
  assert.equal(h.calls.at(-1)[1].seed, original);
  const transfer = JSON.parse(h.storage.get('penecho-lines-drawing')); transfer.before = 0;
  h.handoff(transfer); h.c.S.comp = {}; h.run('restoreBoxes()');
  await h.run('takeDrawing(project())');
  const draft = h.c.S.comp['orch-p'];
  assert.equal(draft.files.length, 1); assert.equal(draft.files[0].path, drawing.picture);
  assert.equal(draft.files[0].source, drawing.source); assert.equal(draft.files[0].uploaded, undefined);
  assert.equal(draft.text, 'Explain this'); assert.equal(draft.flags.make.kind, 'slides');
  assert.equal(h.box().files.length, 0); assert.equal(h.calls.some(call => call[0] === 'api'), false);
});
test("the cached-page return handler reconciles the drawing before rendering", async () => {
  const h = harness({ partial:"home", files:false }); h.handoff();
  let show, rendered = 0;
  h.c.$ = () => null; h.c.addEventListener = (_name, fn) => { show = fn; };
  h.c.render = () => { rendered++; assert.equal(h.box().files.length, 1); };
  h.c.toast = message => assert.fail(message);
  h.run(read("main.js").split("\n").find(line => line.includes("addEventListener('pageshow'")));
  show({ persisted:true }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(rendered, 1); assert.equal(h.storage.has("penecho-lines-drawing"), false);
});
test("a failed state read retains the handoff for the next return", async () => {
  const h = harness({ partial:"home", files:false }); h.handoff();
  h.c.loadState = async () => { throw Error("offline"); };
  await assert.rejects(h.run("takeDrawing(project())"), /offline/);
  assert.ok(h.storage.has("penecho-lines-drawing")); assert.equal(h.box().files.length, 0);
});
test("a different project cannot consume the drawing", async () => {
  const h = harness(); h.handoff({ project:"other" });
  await h.run("takeDrawing(project())");
  assert.ok(h.storage.has("penecho-lines-drawing")); assert.equal(h.box().files.length, 0);
});
for (const embed of [{ rail:true }, { rail:false }]) test(`${embed.rail ? "rail" : "panel"} boot and unload leave the top-level drafts and handoff alone`, async () => {
  const h = harness({ embed }); h.handoff(); h.storage.set("penecho-lines-boxes", '{"untouched":true}');
  h.run("restoreBoxes(); rememberBoxes()"); await h.run("takeDrawing(project())");
  assert.equal(h.storage.get("penecho-lines-boxes"), '{"untouched":true}'); assert.ok(h.storage.has("penecho-lines-drawing"));
  assert.equal(h.box().files.length, 0);
});
test("opening a note's drawing keeps the owner's draft and opens its original ink", async () => {
  const h = harness();
  h.p.pictures.push({ path:drawing.picture, source:drawing.source, title:"Drawing", topic:"review" });
  await h.run(`openDrawing(project(), { dataset:{ comp:'home-p' } }, { seed:'${drawing.picture}', from:{ closest:q => q === '.lp-note' } })`);
  assert.equal(h.calls[0][0], "open");
  assert.equal(h.calls[0][1].source, drawing.source);
  assert.equal(h.calls[0][1].doc, "lines/review.md");
  assert.ok(h.storage.get("penecho-lines-boxes").includes("Keep my words"));
  assert.equal(h.storage.has("penecho-lines-drawing"), false);
});
test("a drawing explicitly opened from the panel carries its originating box", async () => {
  const h = harness({ embed:{ rail:false } });
  await h.run("openDrawing(project(), { dataset:{ comp:'home-p' } })");
  const d = JSON.parse(h.storage.get("penecho-lines-drawing"));
  assert.equal(d.box.text, "Keep my words"); assert.equal(d.box.project, "p");
  h.p.files[0].mtime++;
  h.c.EMBED = null; h.box().text = "A different top-level draft";
  await h.run("takeDrawing(project())");
  assert.equal(h.box().text, "Keep my words"); assert.equal(h.box().files.length, 1);
});
test("editing a picture updates its single attachment and survives refresh", async () => {
  const h = harness(); h.handoff(); await h.run("takeDrawing(project())");
  h.handoff({ before:1 }); await h.run("takeDrawing(project())");
  assert.equal(h.box().files.length, 1);
  h.c.S.comp = {}; h.run("restoreBoxes(); boxUrls(project())");
  assert.equal(h.box().files.length, 1); assert.equal(h.box().text, "Keep my words");
  assert.ok(h.box().files[0].url.includes("drawing.png"));
  assert.equal(h.run("stateView('p')"), "light");
});
test("partial Home state is not evidence that the unsent attachment was deleted", async () => {
  const h = harness(); h.handoff(); await h.run("takeDrawing(project())");
  const current = h.c.project();
  current.partial = "home"; current.files = [];
  h.run("boxUrls(project())"); assert.equal(h.box().files.length, 1); assert.ok(h.box().files[0].url);
  current.partial = ""; h.run("boxUrls(project())"); assert.equal(h.box().files.length, 0);
});
test("duplicate return events attach once", async () => {
  const h = harness({ partial:"home", files:false }); h.handoff();
  await Promise.all([h.run("takeDrawing(project())"), h.run("takeDrawing(project())")]);
  assert.equal(h.box().files.length, 1); assert.equal(h.calls.filter(x => x[0] === "state").length, 1);
});
test("an older in-flight return leaves a newer drawing and its box alone", async () => {
  const h = harness({ partial:"home", files:false }); h.handoff();
  let release; h.c.loadState = () => new Promise(resolve => { release = resolve; });
  const old = h.run("takeDrawing(project())");
  h.handoff({ source:"files/_incoming/new.penecho.json", picture:"files/_incoming/new.png" });
  h.box().text = "Newer words"; release(); await old;
  assert.equal(h.box().text, "Newer words"); assert.equal(h.box().files.length, 0);
  assert.ok(h.storage.get("penecho-lines-drawing").includes("new.png"));
});
test("blank Done keeps the words and adds no file", async () => {
  const h = harness({ files:false }); h.handoff(); await h.run("takeDrawing(project())");
  assert.equal(h.box().text, "Keep my words"); assert.equal(h.box().files.length, 0);
  assert.equal(h.storage.has("penecho-lines-drawing"), false);
});
test("a missing PNG beside an existing Canvas keeps the handoff", async () => {
  const h = harness(); h.p.files = h.p.files.filter(f => f.path === drawing.source); h.handoff();
  await h.run("takeDrawing(project())"); assert.ok(h.storage.has("penecho-lines-drawing"));
});
test("a failed explicit drawing-as-line action can retry without losing its handoff", async () => {
  const h = harness(); h.handoff({ asLine:true });
  h.c.api = async () => { throw Error("not saved"); };
  await assert.rejects(h.run("takeDrawing(project())"), /not saved/);
  assert.ok(h.storage.has("penecho-lines-drawing"));
  h.c.api = async () => ({ slug:"new", step:"s" }); await h.run("takeDrawing(project())");
  assert.equal(h.storage.has("penecho-lines-drawing"), false); assert.equal(h.box().files.length, 0);
});
function shellHarness() {
  const h = harness({ files:false }), opened = [], saved = [];
  let finish, fail;
  h.c.window = { PenEchoCanvasShell:{ active:false, enabled:() => true, pictureSaved:(...args) => saved.push(args) } };
  h.c.openCanvasPage = (url, from, options) => opened.push({ url, options });
  h.c.toast = text => h.calls.push(["toast", text]);
  h.c.uploadFiles = (_p, files) => { h.calls.push(["upload", files[0].name]); return new Promise((resolve, reject) => { finish = () => resolve([{ path:"files/_incoming/shot.png", name:"shot.png" }]); fail = reject; }); };
  h.box().files.push({ id:"a1", name:"shot.png", type:"image/png", blob:{ size:3 }, url:"blob:shot" });
  const handoff = () => JSON.parse(h.storage.get("penecho-lines-drawing") || "null");
  const open = () => h.run("openDrawing(project(), { dataset:{ comp:'home-p' } }, { file:S.comp['home-p'].files[0] })");
  const settle = () => new Promise(resolve => setTimeout(resolve, 5));
  return { ...h, opened, saved, handoff, open, settle, finish:() => finish(), fail:error => fail(error) };
}
test("Click to draw on it opens the Canvas at once with the picture, which goes to the folder behind it", async () => {
  const h = shellHarness();
  await h.open();
  assert.equal(h.opened.length, 1, "nothing is waited for");
  assert.equal(h.opened[0].url.seed, "");
  assert.deepEqual([h.opened[0].options.seeded, h.opened[0].options.fresh, h.opened[0].options.picture.name, h.opened[0].options.picture.blob.size], [true, true, "shot.png", 3]);
  assert.equal(h.handoff().file, "a1");
  assert.deepEqual(h.handoff().box.files, [], "the folder does not have it yet");
  await h.settle(); h.finish(); await h.settle();
  assert.deepEqual(h.handoff().box.files.map(f => f.path), ["files/_incoming/shot.png"], "now a reload finds it too");
  assert.deepEqual(h.saved, [["p", drawing.source, "files/_incoming/shot.png"]]);
  // Done: the drawing takes the picture's place.
  h.p.files = drawingFiles();
  await h.run("takeDrawing(project())");
  assert.equal(JSON.stringify(h.box().files.map(f => [f.id, f.path, f.blob])), JSON.stringify([["a1", drawing.picture, null]]));
  assert.equal(h.box().text, "Keep my words");
});
test("Done before the picture has reached the folder waits for it", async () => {
  const h = shellHarness();
  await h.open(); await h.settle();
  h.p.files = [...drawingFiles(), { path:"files/_incoming/shot.png", mtime:1 }];
  const back = h.run("takeDrawing(project())");
  await h.settle();
  assert.equal(h.calls.some(call => call[0] === "state"), false);
  h.finish(); await back;
  assert.equal(JSON.stringify(h.box().files.map(f => [f.id, f.path])), JSON.stringify([["a1", drawing.picture]]));
  assert.equal(h.storage.has("penecho-lines-drawing"), false);
  assert.equal(h.calls.filter(call => call[0] === "upload").length, 1);
});
test("a picture that could not be put in the folder is still in the box after a Done that drew nothing", async () => {
  const h = shellHarness();
  await h.open(); await h.settle();
  h.fail(Error("The disk is full.")); await h.settle();
  assert.deepEqual(h.calls.filter(call => call[0] === "toast").map(call => call[1]), ["The disk is full."]);
  await h.run("takeDrawing(project())");
  assert.equal(JSON.stringify(h.box().files.map(f => [f.id, f.path, f.blob?.size])), JSON.stringify([["a1", null, 3]]));
});
test("a file already on its way to the folder is not sent there twice", async () => {
  const state = read("state.js"), calls = [];
  const c = vm.createContext({ api:async (...args) => { calls.push(args); return { path:"files/_incoming/again.png", name:"again.png" }; }, pathFor:id => `/projects/${id}`, boxFilesGoing:new WeakMap() });
  vm.runInContext(state.slice(state.indexOf("async function uploadFiles("), state.indexOf("\n}", state.indexOf("async function uploadFiles(")) + 2), c);
  const file = { name:"shot.png", type:"image/png", blob:{ size:3 } };
  c.boxFilesGoing.set(file, new Promise(resolve => setTimeout(() => { file.path = "files/_incoming/shot.png"; resolve(); }, 5)));
  assert.deepEqual(JSON.parse(JSON.stringify(await c.uploadFiles({ id:"p" }, [file]))), [{ path:"files/_incoming/shot.png", name:"shot.png", type:"image/png" }]);
  assert.equal(calls.length, 0);
});
test("boxFile renders a blank occupying placeholder while awaiting a pending drawing or missing image URL", () => {
  const h = harness();
  h.c.esc = s => String(s ?? ""); h.c.ic = name => `<i>${name}</i>`; h.c.FILE_ICON = () => "file"; h.c.fmtSize = n => `${n} B`;
  const form = { dataset:{ comp:"home-p", preview:"1" } };
  h.handoff({ file:"a1" });
  const pendingHtml = h.c.boxFile(form, { id:"a1", name:"shot.png", type:"image/png", size:120, url:"blob:dead-1" });
  assert.match(pendingHtml, /<span class="cmp-file-pic is-blank"/);
  assert.doesNotMatch(pendingHtml, /<img/);
  const noUrlHtml = h.c.boxFile(form, { id:"a2", name:"other.png", type:"image/png", size:120, url:"" });
  assert.match(noUrlHtml, /<span class="cmp-file-pic is-blank"/);
  assert.doesNotMatch(noUrlHtml, /<img/);
  h.storage.delete("penecho-lines-drawing");
  const readyHtml = h.c.boxFile(form, { id:"a1", name:"shot.png", type:"image/png", size:120, url:"/api/lines/projects/p/file?path=files/_incoming/drawing.png&v=2" });
  assert.match(readyHtml, /<button type="button" class="cmp-file-pic"[^>]*><img src="\/api\/lines\/projects\/p\/file\?path=files\/_incoming\/drawing\.png&v=2" alt=""><\/button>/);
});
test("keepPage and showKeptPage strip dead blob: images and pending drawn thumbnails so a blank box occupies the space", () => {
  const pages = read("pages.js");
  const start = pages.indexOf("const PAGE_KEPT_KEY =");
  const end = pages.indexOf("// The page has read its projects");
  const storage = new Map();
  const makeNode = (tag, attrs = {}, children = []) => {
    const node = {
      tagName: tag.toUpperCase(),
      attrs: { ...attrs },
      dataset: Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v])),
      style: {},
      children: [...children],
      parent: null,
      classList: { remove() {}, add() {}, contains: () => false },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); },
      closest(sel) {
        const classes = sel.split(",").map(s => s.trim().replace(/^\./, ""));
        for (let cur = this; cur; cur = cur.parent) {
          const cls = (cur.attrs.class || "").split(/\s+/);
          if (classes.some(c => cls.includes(c))) return cur;
        }
        return null;
      },
      querySelectorAll(sel) {
        const want = sel.split(",").map(s => s.trim()), out = [];
        const match = el => want.some(w => (w === "img" && el.tagName === "IMG") || (/^\[data-act="([^"]+)"\]$/.test(w) && el.attrs["data-act"] === w.match(/^\[data-act="([^"]+)"\]$/)[1]));
        const walk = el => { for (const ch of el.children) { if (match(ch)) out.push(ch); walk(ch); } };
        walk(this);
        return out;
      },
      toHTML() {
        const a = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${v}"`).join("");
        return this.tagName === "IMG" ? `<img${a}>` : `<${this.tagName.toLowerCase()}${a}>${this.children.map(c => c.toHTML()).join("")}</${this.tagName.toLowerCase()}>`;
      },
    };
    for (const ch of node.children) ch.parent = node;
    return node;
  };
  const parse = html => {
    const root = makeNode("div");
    const buttonRe = /<button class="([^"]+)" data-act="([^"]+)" (data-file|data-path)="([^"]+)">(?:<img src="([^"]+)" alt="">)?<\/button>/g;
    let m;
    while ((m = buttonRe.exec(html))) {
      const img = m[5] ? [makeNode("img", { src: m[5], alt: "" })] : [];
      const btn = makeNode("button", { class: m[1], "data-act": m[2], [m[3]]: m[4] }, img);
      btn.parent = root;
      root.children.push(btn);
    }
    return root;
  };
  const shell = {
    inert: false,
    _html: '<button class="cmp-file-pic" data-act="cmp-preview" data-file="a1"><img src="blob:http://127.0.0.1:3889/dead" alt=""></button><button class="orch-file-pic" data-act="orch-preview" data-file="a2"><img src="/api/lines/projects/p/file?path=old.png&v=1" alt=""></button>',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    append(frag) { this._html = frag.children.map(c => c.toHTML()).join(""); },
  };
  const view = { classList: { contains: () => false }, querySelectorAll: () => [], scrollTop: 0 };
  const ctx = {
    EMBED: null, HOSTED: false, S: { newPage: false },
    location: { hash: "#p/orchestrator" },
    sessionStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    $: sel => (sel === ".shell" ? shell : sel === "#view" ? view : null),
    pendingDrawing: () => ({ project: "p", file: "a2" }),
    document: {
      body: { classList: { contains: () => false, add() {} } },
      createElement() {
        return {
          content: null,
          set innerHTML(v) { this.content = parse(v); },
          get innerHTML() { return this.content.children.map(c => c.toHTML()).join(""); },
        };
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(pages.slice(start, end), ctx);
  ctx.keepPage();
  const saved = JSON.parse(storage.get("penecho-lines-page-kept"));
  assert.doesNotMatch(saved.html, /blob:/, "keepPage never stores revoked blob: URLs");
  assert.match(saved.html, /data-file="a1"><\/button>/, "blob thumbnail container stays as blank occupant");
  assert.match(saved.html, /data-file="a2"><img src="\/api\/lines\/projects\/p\/file\?path=old\.png&v=1"/);
  assert.equal(ctx.showKeptPage(), true);
  assert.doesNotMatch(shell.innerHTML, /<img/, "showKeptPage also clears the pending drawn thumbnail until reconciled");
  assert.match(shell.innerHTML, /data-file="a2"><\/button>/, "pending drawn thumbnail container stays as blank occupant");
});
