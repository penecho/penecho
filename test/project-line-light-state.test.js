"use strict";
require("./helpers/safety.js");
// PE-1132: a project opens with its light state. Every line is there by its name and where it stands; the lines that are going, wait for you
// or are still to review are whole; the rest is sent when a page shows it. What the page rebuilds from what it was sent must be what the
// server would have sent whole, and what the Home says of a line must not depend on which form of it the page has.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test, after } = require("node:test");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const Light = require("../src/server/project-lines/light-state.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-light-state-")));
const closing = [];
after(async () => { for (const close of closing.reverse()) await close(); fs.rmSync(temp, { recursive:true, force:true }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const plain = value => JSON.parse(JSON.stringify(value));

const work = (id, over = {}) => ({ id, index:1, kind:"work", label:"Work 1", state:"done", agent:"claude", when:"3 min", took:"3 min", startedAt:1000, endedAt:2000, reviewed:true, unsent:false, off:"", text:"", out:"Done the thing.\n\nMore words.", files:[], pictures:[], refers:[], tokens:{ inputTokens:9, outputTokens:2, startup:{ status:"compared", cost:{ fresh:{ tokensIn:1 }, resumed:{ tokensIn:2 }, costPercent:40, parts:{} } } }, review:{ score:4.5, verdict:"ok", note:"long" }, ...over });
const ask = (over = {}) => ({ id:"ask-1", index:0, kind:"ask", label:"Ask", state:"done", agent:"you", when:"2026-11-12 09:00", took:"", text:"Please do the thing", out:"", files:[], pictures:[], refers:[], unsent:false, reviewed:false, ...over });
const line = (id, over = {}) => ({ id, slug:id, title:`Line ${id}`, code:`PE-${id}`, status:"done", landed:true, archived:false, readRevision:"abc", createdAt:1, updatedAt:2.6, lastActivityAt:3, topicPath:`lines/${id}.md`, topicAbsolutePath:`/x/${id}.md`, questions:[], asking:null, branch:"", labels:[], stations:[ask(), work("work-1")], ask:{ text:"Please do the thing", when:"", files:[], later:[] }, result:{ text:"Done.\n\nAll of it.", files:[] }, pictures:[], tokens:{ cost:null }, ...over });
const stateOf = (lines, over = {}) => ({ format:2, rev:"r1", project:{ id:"p", name:"Garden", code:true }, deleted:{ lines:[], nodes:[], days:7 }, lines, landed:[], backlog:[], notes:[], pictures:[], artifacts:[], latestFiles:[], branches:{},
  files:Array.from({ length:700 }, (_, i) => ({ path:`files/${i % 2 ? "a" : "b"}/f${i}.txt`, size:1, mtime:i, kind:"document" })),
  tokens:{ works:2, starts:[{ workId:"p/a/work-1", at:1, status:"compared", difference:1, taskEstimate:2, baseline:3, cost:{ fresh:{ tokensIn:1, cost:1 }, resumed:{ tokensIn:2, cost:2 }, costPercent:50, prices:{} } }, { workId:"p/b/work-1", at:1, status:"unavailable" }], records:[{ workId:"p/a/work-1", inputTokens:9 }] }, ...over });

test("a line nobody has to look at is light, every other is whole", () => {
  const quiet = line("quiet"), busy = [
    line("working", { status:"working", landed:false, running:true }), line("waiting", { status:"waiting", landed:false }), line("stopped", { status:"stopped", landed:false }),
    line("review", { stations:[ask(), work("work-1", { reviewed:false })] }), line("asked", { asking:{ questions:[{ text:"?" }] } }), line("unsent", { stations:[ask({ unsent:true })] }),
    line("held", { stations:[ask(), work("work-1"), work("work-2", { held:{ reason:"computer" } })] }), line("ready", { status:"ready", landed:false }), line("todo", { todo:true }), line("question", { questions:[{ id:"q" }] }), line("reviewing", { stations:[ask(), work("work-1", { reviewing:true })] }),
  ];
  assert.equal(Light.isQuiet(quiet), true);
  for (const l of busy) assert.equal(Light.isQuiet(l), false, l.id);
  assert.equal(Light.isQuiet(line("archived", { archived:true, stations:[ask({ unsent:true })] })), true);
  const s = Light.lightState(stateOf([quiet, ...busy]));
  assert.equal(s.lines[0].light, true);
  for (const [i, l] of busy.entries()) assert.equal(s.lines[i + 1], l, `${l.id} is whole, the same object`);
  // Neither the list of files nor the Works' records come with it.
  assert.equal("files" in s, false); assert.equal("records" in s.tokens, false);
  assert.equal(s.filesShown, 700);
  assert.deepEqual(s.tokens.starts.map(x => x.workId), ["p/a/work-1"]);
  assert.equal("prices" in s.tokens.starts[0].cost, false);
  const text = JSON.stringify(s.lines[0]);
  for (const gone of ["topicAbsolutePath", "tokens", "readsKnown", "More words. More"]) assert.ok(!text.includes(gone), gone);
  assert.equal(Light.lightState(stateOf([quiet])).lines[0], s.lines[0], "its light form is made once");
});

test("the row's words are kept as the row shows them, and a question the agent ended on is found", () => {
  const long = "A [very long](/Users/somebody/somewhere/very/long/path/that/is/not/shown.md) **bold** answer ".repeat(9);
  const l = Light.lightLine(line("a", { stations:[ask(), work("work-1", { out:long })], result:{ text:`${long}\n\nShall I go on?`, files:[] } }));
  const last = l.stations[1];
  assert.ok(last.out.length < 120 && last.out.startsWith("A very long bold answer"), last.out);
  assert.equal(l.result.text, "Shall I go on?");
  assert.equal(Light.lightLine(line("b")).result.text, "…", "a result that ends on no question is only known to be there");
  assert.equal(l.stations[0].text, undefined, "only the last step's words are in the row");
  assert.equal(Light.lightLine(line("a", { stations:[ask(), work("work-1", { out:long })] }), { words:true }).stations[1].out.length > 120, true, "the filter box looks through all of them");
});

test("what a page shows besides is sent when it asks: open lines, files, records, counts", () => {
  const s = stateOf([line("a"), line("b")], { landed:[line("old", { archived:true, stations:[ask({ files:[{ path:"files/old/x.png" }] }), work("work-1")] })] });
  const open = Light.lightState(s, { full:["a"] });
  assert.equal(open.lines[0], s.lines[0]); assert.equal(open.lines[1].light, true);
  assert.deepEqual(open.full, ["a"]);
  assert.ok(open.lineFiles.length && open.lineFiles.every(f => f.path.startsWith("files/a/")), "an open line has its own files");
  const all = Light.lightState(s, { full:"*", parts:["files", "tokens"] });
  assert.equal(all.full, "*"); assert.equal(all.lines[1], s.lines[1]); assert.equal(all.files, s.files); assert.equal(all.tokens.records, s.tokens.records);
  const stats = Light.lightState(s, { parts:["stats"] }).lines[0].stations[1];
  assert.equal(stats.tokens.inputTokens, 9); assert.equal(stats.tokens.startup.cost.costPercent, 40); assert.equal("parts" in stats.tokens.startup.cost, false); assert.equal(stats.review.score, 4.5);
  assert.equal(Light.lightState(s).landed[0].stations.length, 0);
  assert.equal(Light.lightState(s, { parts:["archive"] }).landed[0].stations[0].files[0].path, "files/old/x.png");
  assert.deepEqual(Light.wantsOf({ full:"b,a,,b", parts:"tokens,nothing,files" }), { full:["a", "b"], parts:["files", "tokens"] });
  assert.equal(Light.wantsOf({ full:"a,*" }).full, "*");
});

test("a small project, and a folder of slides, are sent whole", () => {
  const small = stateOf([line("a")], { files:[{ path:"files/a/x.txt", mtime:1, size:1, kind:"document" }] }), s = Light.lightState(small);
  assert.equal(s.full, "*"); assert.deepEqual(s.parts, Light.PARTS); assert.equal(s.lines[0], small.lines[0]); assert.equal(s.files, small.files); assert.equal(s.tokens.records, small.tokens.records);
  const deck = stateOf([line("a")], { project:{ id:"p", code:false } }); deck.files.push({ path:"files/a/review.pptx", mtime:1, size:1 });
  assert.equal(Light.lightState(deck).full, "*");
});

async function computer() {
  const directory = path.join(temp, `state-${closing.length}`), docsBase = path.join(temp, `docs-${closing.length}`);
  fs.mkdirSync(directory, { recursive:true });
  const lines = createProjectLines({ directory, agents:createAgents({ env:{ PATH:"" } }), serviceOptions:{ autoWatch:false, docsBase }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:async () => ({}), send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  closing.push(() => { server.close(); lines.close(); });
  const p = lines.service.store.create({ name:"Garden", docsPath:path.join(docsBase, "Garden") });
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(p.docsPath, rel)), { recursive:true }); fs.writeFileSync(path.join(p.docsPath, rel), text); };
  const state = async q => { const text = await (await fetch(`http://127.0.0.1:${server.address().port}/api/lines/projects/${p.id}/state?${q}`)).text(); return { bytes:text.length, body:JSON.parse(text) }; };
  const touched = () => lines.service.folderWatch.touch(p.docsPath);
  return { lines, p, write, state, touched };
}
const source = fs.readFileSync(require.resolve("../public/lines/state.js"), "utf8");
function page() {
  const c = vm.createContext({ S:{ cur:"p", route:{ view:"home" }, data:{} }, HOSTED:false, EMBED:null, pathFor:id => `/projects/${id}`, lineById:() => null, api:async () => { throw new Error("No requests here."); } });
  vm.runInContext(source.slice(source.indexOf("const stateView ="), source.indexOf("async function loadProjects()")), c);
  return c;
}
const md = (title, words, done = true) => `---\nid: G-1\nstatus: ${done ? "done" : "waiting"}\n---\n\n# ${title}\n\n## Ask · 2026-11-12 09:00\n\n${words}\n${done ? "\n## [x] Work 1 · @codex\n\nDone.\n" : ""}`;

test("over the wire: light first, then only what changed, whatever is opened meanwhile", async () => {
  const a = await computer(), pg = page();
  for (let i = 0; i < 60; i++) { a.write(`lines/l${i}.md`, md(`Line ${i}`, "Words ".repeat(300))); for (let j = 0; j < 11; j++) a.write(`files/l${i}/n${j}.txt`, "x"); }
  a.write("lines/going.md", md("Going", "Where do they go?", false));
  await wait(300);
  // Lines marked Reviewed long ago (before the mark existed) count as reviewed or to review by the service: only the form matters here.
  const first = await a.state("for=light&base="), whole = await a.state("");
  assert.equal(first.body.view, "light"); assert.ok(first.body.tag);
  assert.ok(first.bytes < whole.bytes, `${first.bytes} < ${whole.bytes}`);
  pg.keepSent("p", structuredClone(first.body));
  assert.equal(first.body.lines.find(l => l.id === "going").light, undefined);
  let tag = first.body.tag;
  const steps = [
    ["a line opened", "full=l1", () => {}],
    ["its words changed", "full=l1", () => a.write("lines/l1.md", md("Line 1", "Other words"))],
    ["the files asked for", "full=l1&parts=files", () => {}],
    ["a file added", "full=l1&parts=files", () => a.write("files/l2/new.txt", "x")],
    ["another line opened, and the list let go", "full=l1,l2", () => {}],
    ["a new line", "full=l1,l2", () => a.write("lines/z.md", md("Last", "New"))],
    ["a line archived", "full=l1,l2", () => { fs.mkdirSync(path.join(a.p.docsPath, "archive/lines"), { recursive:true }); fs.renameSync(path.join(a.p.docsPath, "lines/l5.md"), path.join(a.p.docsPath, "archive/lines/l5.md")); }],
    ["no line open", "", () => {}],
  ];
  for (const [what, ask, change] of steps) {
    await wait(20); change(); a.touched();
    const sent = (await a.state(`for=light&${ask}&base=${encodeURIComponent(tag)}`)), want = (await a.state(`for=light&${ask}&base=`)).body;
    assert.ok(sent.body.delta, `${what}: only what changed is sent`);
    const kept = pg.sentWith("p", sent.body);
    assert.ok(kept, `${what}: it applies to the kept state`);
    pg.setSent("p", kept);
    const { tag:_a, ...expected } = want;
    assert.deepEqual(plain(pg.sentState(kept)), expected, `${what}: the rebuilt state is the one sent whole`);
    tag = sent.body.tag;
  }
  assert.equal((await a.state(`for=light&base=${encodeURIComponent(tag)}`)).body.same, true);
  // PenEcho restarted: a page that lacks nothing of this revision is told so, not sent it all again.
  const { rev } = (await a.state("for=light&base=")).body;
  assert.deepEqual((await a.state(`for=light&rev=${encodeURIComponent(rev)}&base=gone.abc.1`)).body, { same:true, rev });
  assert.equal((await a.state("for=light&rev=older&base=gone.abc.1")).body.view, "light");
  assert.equal((await a.state("for=nothing")).body.code, "BAD_VIEW");
});
