"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const turn = () => new Promise(resolve => setImmediate(resolve));

// Run the real state loader and send handlers. Hold each response independently to
// check what the user sees while the folder is still being written.
function harness({ sending = false, here = false, hosted = false } = {}) {
  const requests = [], events = [], errors = [], notices = [], saved = deferred(), state = deferred(), list = deferred();
  const input = { value:"Fix the slow handoff", focus() {} };
  const form = { dataset:{ comp:"home-p", on:here ? "step" : "home", preview:"1" }, classList:{ add() {}, remove() {} } };
  const line = { id:"saved-line", slug:"saved-line", title:"Saved line", status:"waiting", stations:[{ id:"ask-1", kind:"ask", unsent:true, text:input.value }], ask:{ text:input.value, files:[] }, result:{ text:"", files:[] }, questions:[], pictures:[], labels:[] };
  const response = data => ({ ok:true, status:200, json:async () => data });
  const fetch = async (url, init) => {
    requests.push({ url, method:init.method, body:init.body && JSON.parse(init.body) });
    if (url.endsWith(sending ? "/topics" : "/unsent")) return response(await saved.promise);
    if (/\/state(?:\?|$)/.test(url)) return response(await state.promise);
    if (url === "/api/lines/projects") return response(await list.promise);
    throw new Error(`Unexpected request: ${url}`);
  };
  const context = vm.createContext({
    LINE_STATUS:require('../public/lines/line-status.js'),
    ACT:{}, HOSTED:hosted ? {} : null, EMBED:null, navigationTransition:0,
    navigator:{ platform:"MacIntel" }, localStorage:{ getItem:key => sending && key === "penecho-lines-test-run" ? "1" : null }, window:{}, addEventListener() {}, location:{ hash:"#p" },
    document:{ getElementById:() => null, addEventListener() {}, documentElement:{ addEventListener() {} } },
    fetch, hostedFetch:(url, init) => fetch(`/api/lines${url}`, init),
    $:selector => selector === ".cmp-input" ? input : null, $$:() => [form],
    isWork:s => s.kind === "work", isEnd:s => ["merge", "deliver"].includes(s.kind), canReview:() => false,
    homeShape:() => "code", embedCanvas:() => ({}), embedShown() {}, closeMenu() {},
    toast:(message, options) => { errors.push(message); notices.push(options); }, syncComposer() {},
    refreshAfterChange:() => events.push("refresh"), refreshChrome:() => events.push("chrome"), renderRail() {}, renderSwitcher() {},
    scrollToItem:step => events.push(`scroll:${step}`), scrollToLatest:() => events.push("latest"),
    syncHash() {}, pollActivity:async () => events.push("activity"),
    go:route => {
      context.route = route;
      events.push(`open:${route.line || route.view}`);
      // Render asks for what the page shows when navigation was given only a projection.
      vm.runInContext("S.route = route; if (lacks(project(), routeNeeds(S.route))) readNeeds(project(), routeNeeds(S.route)).catch(() => {});", context);
    },
  });
  const ui = Object.fromEntries(["syncComposer", "refreshAfterChange", "refreshChrome", "renderRail", "renderSwitcher"].map(name => [name, context[name]]));
  for (const name of ["state", "composer", "pages"]) vm.runInContext(fs.readFileSync(path.join(root, `public/lines/${name}.js`), "utf8"), context, { filename:name });
  Object.assign(context, ui);
  context.form = form;
  context.line = line;
  vm.runInContext(`
    S.cur = 'p'; S.data.p = { id:'p', code:true, defaultAgent:'codex', lines:${here ? "[line]" : "[]"}, landed:[], backlog:[], partial:'home', notes:[], pictures:[], files:[] };
    S.route = ${here ? "{view:'line',line:'saved-line'}" : "{view:'home'}"};
    S.agents = [{id:'codex',available:true}];
    Object.assign(comp('home-p'), {text:'Fix the slow handoff',defaults:${here ? "{topic:'saved-line'}" : "{}"},flags:${here ? "{topic:'saved-line'}" : "{}"}});
    renderPathPreview = () => {};
  `, context);
  const start = () => vm.runInContext(sending ? "SEND.home({text:comp('home-p').text,files:comp('home-p').files||[],refers:(comp('home-p').refers||[]).map(r=>r.step),quotes:[...(comp('home-p').refers||[])],box:'home-p',flags:comp('home-p').flags}, " + (here ? "line" : "null") + ")" : "saveToTopic(form,{agent:{id:'codex'}})", context);
  const accept = async () => { saved.resolve({ slug:line.id, step:"ask-1" }); await turn(); await turn(); };
  const showState = async () => {
    state.resolve({ format:2, rev:"new", project:{ id:"p", code:true }, lines:[line], landed:[], backlog:[], files:[], pictures:[] });
    await turn(); await turn();
  };
  const posts = () => requests.filter(r => r.method === "POST");
  return { context, requests, posts, events, errors, notices, saved, state, list, input, form, start, accept, showState, read:code => vm.runInContext(code, context) };
}

for (const sending of [false, true]) {
  const mode = sending ? "run" : "save for an agent";
  test(`home send (${mode}) is on a new line at once, before the folder is written`, async () => {
    const h = harness({ sending });
    h.start();
    // Nothing has been answered, and the line is already open with what you wrote.
    assert.ok(h.events.some(e => /^open:saving-/.test(e)), "the new line opens straight away");
    assert.match(h.read("S.route.line"), /^saving-/);
    assert.equal(h.read("project().lines[0].title"), "Fix the slow handoff");
    assert.equal(h.read("project().lines[0].stations[0].text"), "Fix the slow handoff");
    if (!sending) assert.equal(h.read("comp('home-p').text"), "", "the box is free for the next thing");
    assert.equal(h.form.dataset.busy, undefined);
    await turn();
    assert.equal(h.posts().length, 1, "the folder is written behind the page");
    await h.accept();
    // The server's names take over, on the page and in the address.
    assert.equal(h.read("S.route.line"), "saved-line");
    assert.equal(h.read("project().lines[0].id"), "saved-line");
    if (!sending) assert.equal(h.read("S.askFor['saved-line/ask-1']"), "codex");
    await h.showState();
    assert.equal(h.read("project().lines.length"), 1, "the server's line replaces the one shown, with no copy left");
    assert.equal(h.read("project().lines[0].ask.text"), "Fix the slow handoff");
    h.list.reject(new Error("Summary refresh failed"));
    await turn();
    assert.deepEqual(h.errors, [], "a background list failure must not turn a saved Ask into a send failure");
  });
}

for (const sending of [false, true]) test(`a new line ${sending ? "sent" : "saved"} with Off main chosen stands off main at once and asks for it`, async () => {
  const h = harness({ sending });
  h.read("Object.assign(project(),{git:true,trunk:'main'}); comp('home-p').flags.target = {off:true}");
  h.start();
  assert.equal(h.read("project().lines[0].offMain"), true, "never drawn on main while it is saved");
  await turn();
  assert.equal(h.posts()[0].body.offMain, true);
});

for (const sending of [false, true]) test(`a follow-up (${sending ? "run" : "save"}) is on its line at once`, async () => {
  const h = harness({ here:true, sending });
  const before = h.read("line.stations.length");
  h.start();
  assert.equal(h.read("lineById(project(),'saved-line').stations.length"), before + 1, "the new node is there before any answer");
  assert.ok(h.events.includes("refresh"));
  assert.ok(h.events.some(e => /^scroll:saving-/.test(e)));
  assert.ok(!h.events.some(e => e.startsWith("open:")), "you stay where you are");
  await turn();
  assert.equal(h.posts()[0].body.topic, "saved-line");
  await h.accept();
  if (sending) assert.ok(h.events.includes("activity"));
  h.list.resolve({ projects:[] });
});

test("a failed save takes its line off the page and puts your words back in the box", async () => {
  const h = harness();
  h.start();
  assert.equal(h.read("comp('home-p').text"), "");
  h.saved.reject(new Error("Save failed"));
  await turn(); await turn();
  assert.equal(h.read("comp('home-p').text"), "Fix the slow handoff");
  assert.equal(h.read("project().lines.length"), 0);
  assert.equal(h.read("S.route.view"), "home");
  assert.equal(h.posts().length, 1);
  assert.equal(h.errors.length, 1, "it says once that it was not saved");
});

test("a poll that arrives before the folder is written keeps what you just added", async () => {
  const h = harness();
  h.start();
  const shown = h.read("S.route.line");
  // A state read before the save holds nothing new.
  h.state.resolve({ format:2, rev:"old", project:{ id:"p", code:true }, lines:[], landed:[], backlog:[], files:[], pictures:[] });
  await h.read("loadState('p',{force:true,whole:true})");
  assert.equal(h.read("project().lines[0]?.id"), shown);
  assert.equal(h.read("project().lines[0].stations[0].text"), "Fix the slow handoff");
});

test("an older home poll cannot replace the saved line after its complete state arrives", async () => {
  const h = harness();
  const old = deferred();
  const fetch = h.context.fetch;
  h.context.fetch = (url, init) => url.includes("for=home") ? old.promise : fetch(url, init);
  const poll = h.read("loadState('p')");
  const full = h.read("loadState('p',{force:true,whole:true})");
  await h.showState(); await full;
  old.resolve({ ok:true, status:200, json:async () => ({ format:2, view:"home", rev:"old", project:{ id:"p", code:true }, lines:[], landed:[], backlog:[] }) });
  await poll;
  assert.equal(h.read("project().partial"), "");
  assert.equal(h.read("project().lines[0]?.id"), "saved-line");
});

test("a second Ask on a line still being saved goes to the name the server gave it", async () => {
  const h = harness();
  h.start();
  const first = h.read("S.route.line");
  h.read(`form.dataset.on = 'step'; Object.assign(comp('home-p'), {text:'And the tests'})`);
  h.start();
  assert.equal(h.read(`lineById(project(), '${first}').stations.filter(s => s.kind === 'ask').length`), 2);
  await turn();
  assert.equal(h.posts().length, 1, "the second waits for the first");
  await h.accept();
  assert.equal(h.posts().length, 2);
  assert.equal(h.posts()[1].body.topic, "saved-line");
});

test("a box opened on a line while it was being saved still sends to that line once it has its name", async () => {
  const h = harness({ sending:true });
  h.start();
  const first = h.read("S.route.line");
  // The line page's box was drawn while the line had its first name.
  h.read(`Object.assign(comp('home-p'), {text:'Next step', flags:{topic:'${first}'}, defaults:{topic:'${first}'}})`);
  await h.accept();
  assert.equal(h.read("comp('home-p').flags.topic"), "saved-line");
  h.read(`comp('home-p').flags.topic = '${first}'`);
  h.read("SEND.home({text:'Next step',files:[],flags:comp('home-p').flags,box:'home-p'}, lineById(project(), 'saved-line'))");
  assert.ok(!h.events.slice(-3).some(e => /^open:saving-/.test(e)), "no new line is started");
  await turn();
  assert.equal(h.posts()[1].body.topic, "saved-line");
});

test("attachments, references and source line are captured before upload completes", async () => {
  const h = harness({ here:true }), upload = deferred();
  h.context.uploadFiles = async () => upload.promise;
  h.read("Object.assign(comp('home-p'),{files:[{name:'notes.txt'}],refers:[{step:'note-1'}]})");
  h.start();
  h.read("navigationTransition++; S.route = {view:'line',line:'other'}; comp('home-p').refers = []");
  upload.resolve([{ path:"files/_incoming/notes.txt", name:"notes.txt" }]);
  await turn();
  const [post] = h.posts();
  assert.equal(post.body.topic, "saved-line");
  assert.deepEqual(post.body.refers, ["note-1"]);
  assert.equal(post.body.attachments[0].path, "files/_incoming/notes.txt");
  await h.accept();
  h.list.resolve({ projects:[] });
});

test("the new-line branch choice stays with the submitted request during upload", async () => {
  const h = harness(), upload = deferred();
  h.context.uploadFiles = async () => upload.promise;
  h.read("Object.assign(project(),{git:true,trunk:'main'}); Object.assign(comp('home-p'),{files:[{name:'notes.txt'}],flags:{target:{branch:'feature'}}})");
  h.start();
  h.read("comp('home-p').flags.target = {off:true}");
  upload.resolve([{ path:"files/_incoming/notes.txt", name:"notes.txt" }]);
  await turn();
  const [post] = h.posts();
  assert.equal(post.body.branch, "feature");
  assert.equal(post.body.offMain, undefined);
  await h.accept();
  h.list.resolve({ projects:[] });
});

test("the explicit test-run mode also opens at once on a hosted page", async () => {
  const h = harness({ sending:true, hosted:true });
  h.start();
  assert.ok(h.events.some(e => /^open:saving-/.test(e)));
  await turn();
  assert.equal(h.posts().length, 1);
  await h.accept();
  assert.equal(h.read("S.route.line"), "saved-line");
  h.list.resolve({ projects:[] });
});

test("PE-911: the Cloud composer only opens the acknowledged Line, not a temporary one", async () => {
  const h = harness({ hosted:true });
  h.start(); h.start();
  assert.equal(h.read("S.route.view"), "home");
  assert.equal(h.read("comp('home-p').text"), "Fix the slow handoff");
  assert.ok(h.read("comp('home-p').sending"));
  await turn(); assert.equal(h.posts().length, 1);
  await h.accept();
  assert.deepEqual(h.events.filter(event => event.startsWith("open:")), ["open:saved-line"]);
  assert.equal(h.read("lineById(project(), 'saved-line').stations[0].id"), "ask-1");
  h.list.resolve({ projects:[] });
});

for (const here of [false, true]) test(`${here ? 'follow-up' : 'new-Line'} attachments reserve their space before upload and through save acknowledgement`, async () => {
  const h = harness({ here }), upload = deferred();
  h.context.uploadFiles = async () => upload.promise;
  h.read(`comp('home-p').files = [
    {name:'screen.png',type:'image/png',url:'blob:local-preview',blob:{private:true}},
    {name:'no-mime.svg',type:'',url:''},
    {name:'notes.txt',type:'text/plain'}
  ]`);
  h.start();
  const attachments = () => JSON.parse(h.read("JSON.stringify(project().lines[0].stations.find(s => s.pendingFiles).pendingFiles)"));
  const expected = [
    { name:'screen.png', image:true, url:'blob:local-preview' },
    { name:'no-mime.svg', image:true, url:'' },
    { name:'notes.txt', image:false, url:'' }
  ];
  assert.deepEqual(attachments(), expected, 'presentation is available in the first synchronous render');
  assert.equal(h.read("project().lines[0].stations.find(s => s.pendingFiles).files.length"), 0, 'local URLs never become authoritative paths');
  assert.equal(h.read("project().files.length"), 0, 'the file catalog contains no fabricated entries');
  upload.resolve([{ path:'files/_incoming/screen.png', name:'screen.png', type:'image/png' }]);
  await turn(); await h.accept();
  assert.deepEqual(attachments(), expected, 'acknowledgement must not remove local presentation before refreshed state arrives');
  assert.equal(h.posts()[0].body.attachments[0].path, 'files/_incoming/screen.png');
  assert.equal(h.posts()[0].body.pendingFiles, undefined, 'presentation is never persisted');
  h.list.resolve({ projects:[] });
});

test('a failed image upload restores the original preview for retry', async () => {
  const h = harness(), upload = deferred();
  h.context.uploadFiles = async () => upload.promise;
  h.read("comp('home-p').files = [{name:'screen.png',type:'image/png',url:'blob:keep-for-retry',blob:{bytes:true}}]");
  const file = h.read("comp('home-p').files[0]");
  const saving = h.start();
  upload.reject(new Error('Upload failed')); await saving;
  assert.equal(h.read("project().lines.length"), 0);
  assert.equal(h.read("comp('home-p').files[0]"), file, 'rollback returns the original attachment object');
  assert.equal(file.url, 'blob:keep-for-retry');
  assert.equal(h.posts().length, 0, 'no incomplete Ask is persisted');
});

for (const sending of [false, true]) test(`Canvas sidebar follow-up waits for the Canvas save before ${sending ? "running" : "saving the Ask"}`, async () => {
  const h = harness({ here:true, sending }), ready = deferred(), target = "files/panned/canvas.penecho.json";
  h.context.embedCanvas = () => ({ canvas:target });
  h.context.embedCanvasReady = () => ready.promise;
  h.start();
  await turn();
  assert.equal(h.posts().length, 0);
  const viewport = { x:7440, y:8458, w:3640, h:3084 };
  ready.resolve(viewport);
  await turn();
  assert.equal(h.posts().length, 1);
  assert.deepEqual(h.posts()[0].body.canvasView, viewport);
  assert.equal(h.posts()[0].body.topic, "saved-line");
  assert.equal(h.posts()[0].body.canvas, target);
  await h.accept();
});

test("the sidebar accepts viewport data only from its matching Canvas save reply", async () => {
  const handlers = new Map();
  const parent = { postMessage() {} }, target = "files/sketch/canvas.penecho.json";
  const c = { URLSearchParams, setTimeout, clearTimeout, window:{ parent }, location:{ origin:"http://localhost", search:"?embed=panel&canvas=" + encodeURIComponent(target), hash:"#p/line/l" },
    document:{ documentElement:{ classList:{ add() {} } } }, addEventListener:(type, fn) => handlers.set(type, fn), removeEventListener:type => handlers.delete(type) };
  const source = fs.readFileSync(path.join(root, "public/lines/embed.js"), "utf8");
  vm.runInNewContext(source.slice(0, source.indexOf("const embedKeeps")), c);
  let ask;
  parent.postMessage = message => { ask = message.ask; };
  const respond = fields => handlers.get("message")({ source:parent, origin:c.location.origin, data:{ source:"penecho-canvas", file:ask, canvas:target, ...fields } });
  const first = c.embedCanvasReady(), view = { x:800, y:900, w:500, h:300 };
  respond({ file:"different-handshake", view });
  assert.ok(handlers.has("message"));
  respond({ view });
  assert.deepEqual(await first, view);
  const changed = c.embedCanvasReady();
  respond({ canvas:"files/other/canvas.penecho.json", view });
  await assert.rejects(changed, /open Canvas changed/);
  const failed = c.embedCanvasReady();
  respond({ error:"Save failed" });
  await assert.rejects(failed, /Save failed/);
});
