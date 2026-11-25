"use strict";
require("./helpers/safety.js");
// B7, local part: meetings and projects together, through the signed-in account, against a stand-in Cloud.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { fakeCloud, fakeConnector } = require("./fake-cloud-lines.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-meetcue-")));
const closing = [];
after(async () => { for (const close of closing.reverse()) await close(); fs.rmSync(temp, { recursive:true, force:true }); });
async function setup({ withCloud = true } = {}) {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const connector = fakeConnector(cloud), n = closing.length, directory = path.join(temp, `s-${n}`), docsBase = path.join(temp, `b-${n}`);
  fs.mkdirSync(directory, { recursive:true });
  const lines = createProjectLines({ ...(withCloud ? { cloud:() => connector } : {}), directory, agents:createAgents({ env:{ PATH:"" } }), serviceOptions:{ autoWatch:false, docsBase }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  closing.push(() => { server.close(); lines.close(); });
  const call = async (method, route, body) => { const res = await fetch(`http://127.0.0.1:${server.address().port}/api/lines${route}`, { method, ...(body ? { headers:{ "content-type":"application/json" }, body:JSON.stringify(body) } : {}) }); return { status:res.status, ...await res.json() }; };
  return { cloud, connector, service:lines.service, call, project:name => lines.service.store.create({ name, docsPath:path.join(docsBase, name) }) };
}

test("the MeetCue pass-through gives Cloud's answers, and signed out it answers without an error", async () => {
  const { connector, call } = await setup();
  const status = await call("GET", "/meetcue");
  assert.deepEqual([status.status, status.available, status.linked, status.signedIn, status.meetcue.balance.credits], [200, true, true, true, 12]);
  const list = await call("GET", "/meetcue/meetings?limit=5");
  assert.deepEqual(list.meetings.map(m => [m.id, m.title, m.action_count]), [["m-1", "Supplier call", 2]]);
  const one = await call("GET", "/meetcue/meetings/m-1");
  assert.deepEqual([one.meeting.title, one.actions.length], ["Supplier call", 2]);
  assert.equal((await call("GET", "/meetcue/meetings/nope")).status, 404);
  connector.signedIn = false;
  for (const route of ["/meetcue", "/meetcue/meetings", "/meetcue/meetings/m-1"]) assert.deepEqual(await call("GET", route), { status:200, available:false, signedIn:false });
  assert.equal((await call("DELETE", "/meetcue/link")).status, 401);
  assert.equal((await call("DELETE", "/meetcue/meetings/m-1")).status, 401);
  connector.signedIn = true;
  assert.deepEqual(await call("DELETE", "/meetcue/meetings/m-1"), { status:200, ok:true });
  assert.deepEqual(await call("DELETE", "/meetcue/link"), { status:200, linked:false, meetcueNotified:true });
  const afterUnlink = await call("GET", "/meetcue");
  assert.deepEqual([afterUnlink.status, afterUnlink.available, afterUnlink.linked, afterUnlink.signedIn], [200, true, false, true]);
  assert.equal((await call("GET", "/meetcue/link")).status, 404);
  const noCloud = await setup({ withCloud:false });
  assert.deepEqual(await noCloud.call("GET", "/meetcue"), { status:200, available:false, signedIn:false }, "with no Cloud at all, too");
});

test("a meeting with two actions makes one line: the meeting, then two Asks not sent; the second time it returns that line and writes nothing", async () => {
  const { service, call, project } = await setup(), p = project("Supplies");
  const made = await call("POST", `/projects/${p.id}/meetings`, { meetingId:"m-1" });
  assert.deepEqual([made.status, made.existed], [200, false]);
  const md = service.readDoc(p, made.slug), doc = F.parseLine(md);
  assert.equal(doc.title, "Supplier call");
  assert.equal(doc.front.meeting, "m-1");
  assert.deepEqual(doc.steps.map(s => [s.kind, F.isUnsent(s)]), [["meeting", false], ["ask", true], ["ask", true]]);
  assert.match(doc.steps[0].text, /\*\*Supplier call\*\* · 2026-11-10 08:00 · 30 min/);
  assert.match(doc.steps[0].text, /Prices agreed for next year\./);
  assert.deepEqual(doc.steps[0].files.map(f => f.href), [`../files/${made.slug}/minutes.md`]);
  assert.equal(fs.readFileSync(path.join(p.docsPath, `files/${made.slug}/minutes.md`), "utf8"), "# Supplier call\n\n## Decisions\n\n- Prices agreed.\n");
  assert.deepEqual(doc.steps.slice(1).map(s => s.text), ["Send the quote (Dana, by Friday)", "Book the next call"]);
  // An app that does not know meetings reads it as a note.
  assert.match(md, /^## Note · \d{4}-\d{2}-\d{2} \d{2}:\d{2} · Meeting$/m);
  const state = await call("GET", `/projects/${p.id}/state`), line = [...state.lines, ...state.backlog, ...state.landed].find(l => l.slug === made.slug);
  assert.deepEqual(line.stations.map(s => s.kind), ["meeting", "ask", "ask"]);
  const mtime = fs.statSync(path.join(p.docsPath, `lines/${made.slug}.md`)).mtimeMs;
  assert.deepEqual(await call("POST", `/projects/${p.id}/meetings`, { meetingId:"m-1" }), { status:200, slug:made.slug, existed:true });
  assert.equal(fs.statSync(path.join(p.docsPath, `lines/${made.slug}.md`)).mtimeMs, mtime, "nothing written");
  assert.equal(service.store.scan(p).topics.length, 1);
  assert.equal((await call("POST", `/projects/${p.id}/meetings`, { meetingId:"m-9" })).status, 404);
});

test("Use in MeetCue sends MEMORY.md only, never every line; a line goes when named; a send that fails half way sends only what is missing", async () => {
  const { cloud, call, project, service } = await setup(), p = project("Weather app");
  fs.writeFileSync(path.join(p.docsPath, "lines/done.md"), "---\nid: WA-1\nstatus: done\n---\n\n# Done thing\n\n## Ask · 2026-11-10 09:00\n\nIt is done.\n");
  fs.writeFileSync(path.join(p.docsPath, "lines/open.md"), "---\nid: WA-2\nstatus: working\n---\n\n# Open thing\n\n## Ask · 2026-11-10 09:00\n\nStill going.\n");
  const memory = await call("POST", `/projects/${p.id}/meetcue`, {});
  assert.equal(memory.status, 200, memory.error);
  assert.deepEqual(memory.sent, ["MEMORY.md"], "only the memory, not the finished line");
  assert.equal(memory.project.name, "Weather app");
  assert.equal(service.store.get(p.id).meetcue.projectId, memory.project.id, "the MeetCue project is remembered");
  cloud.failUpload = 2;
  const failed = await call("POST", `/projects/${p.id}/meetcue`, { files:["lines/done.md", "lines/open.md"] });
  assert.equal(failed.status, 502, "the second upload failed");
  const first = await call("POST", `/projects/${p.id}/meetcue`, { files:["lines/done.md", "lines/open.md"] });
  assert.equal(first.status, 200, first.error);
  assert.deepEqual(first.sent, ["lines/open.md"], "only what was missing");
  assert.deepEqual(first.skipped, ["lines/done.md"]);
  const done = [...cloud.mcFiles.values()].filter(f => f.done).map(f => f.name).sort();
  assert.deepEqual(done, ["MEMORY.md", "done.md", "open.md"]);
  const again = await call("POST", `/projects/${p.id}/meetcue`, {});
  assert.deepEqual([again.sent, again.skipped], [[], ["MEMORY.md"]], "unchanged files are not sent again");
  fs.appendFileSync(path.join(p.docsPath, "MEMORY.md"), "\n- New fact. (WA-1, 2026-11-10)\n");
  assert.deepEqual((await call("POST", `/projects/${p.id}/meetcue`, {})).sent, ["MEMORY.md"]);
  assert.equal([...cloud.mcProjects.values()].length, 1, "one MeetCue project of that name");
});

test("an app that does not know the meeting step reads it as a note", { skip:(() => { try { require("node:child_process").execFileSync("git", ["cat-file", "-e", "982b9bc1:src/server/project-lines/format.js"], { cwd:path.join(__dirname, ".."), stdio:"ignore" }); return false; } catch { return "no main branch to read the older format from"; } })() }, async () => {
  const { service, call, project } = await setup(), p = project("Old app");
  const made = await call("POST", `/projects/${p.id}/meetings`, { meetingId:"m-1" });
  // The format code of an app from before meetings (commit 982b9bc1, the last one before they were added): it has never heard of the step kind.
  const older = path.join(temp, "older-format.js");
  fs.writeFileSync(older, require("node:child_process").execFileSync("git", ["show", "982b9bc1:src/server/project-lines/format.js"], { cwd:path.join(__dirname, ".."), encoding:"utf8" }));
  const Old = require(older);
  assert.ok(!/meeting/i.test(JSON.stringify(Object.keys(Old))), "it knows no meetings");
  const doc = Old.parseLine(service.readDoc(p, made.slug));
  assert.deepEqual(doc.steps.map(s => s.kind), ["note", "ask", "ask"]);
  assert.match(doc.steps[0].text, /Supplier call/);
  assert.match(doc.steps[0].text, /Prices agreed for next year\./);
});

test("a meeting can be added as a node on an existing line, removed/undone, and linked across projects", async () => {
  const { cloud, service, call, project } = await setup(), p1 = project("Supplies"), p2 = project("Weather app");
  cloud.meetings.set("m-2", {
    meeting:{ id:"m-2", title:"Forecast review", status:"ended", started_at:"2026-11-11T09:00:00.000Z", duration_ms:1500000, minutes_ready:true, action_count:0, gist:"Rain layer stays off by default." },
    markdown:"# Forecast review\n\n- Rain layer off by default.\n",
    actions:[],
  });
  // Dedicated line in Supplies
  const own = await call("POST", `/projects/${p1.id}/meetings`, { meetingId:"m-1" });
  assert.equal(own.status, 200);
  // Existing line in Weather app
  const slug = await service.newYoursLine(p2, { title:"Launch prep" });
  const note = await call("POST", `/projects/${p2.id}/yours`, { topic:slug, kind:"note", text:"Initial launch checklist" });
  assert.equal(note.status, 200);
  const added1 = await call("POST", `/projects/${p2.id}/meetings`, { meetingId:"m-1", topic:slug });
  assert.deepEqual([added1.status, added1.slug, added1.existed], [200, slug, false]);
  assert.ok(added1.step);
  // Idempotent when added again to the same line
  const again = await call("POST", `/projects/${p2.id}/meetings`, { meetingId:"m-1", topic:slug });
  assert.deepEqual([again.status, again.slug, again.step, again.existed], [200, slug, added1.step, true]);
  // Second meeting on the same line gets its own minutes file
  const added2 = await call("POST", `/projects/${p2.id}/meetings`, { meetingId:"m-2", topic:slug });
  assert.deepEqual([added2.status, added2.slug, added2.existed], [200, slug, false]);
  assert.notEqual(added2.step, added1.step);
  assert.ok(fs.existsSync(path.join(p2.docsPath, `files/${slug}/minutes.md`)));
  assert.ok(fs.existsSync(path.join(p2.docsPath, `files/${slug}/minutes-2.md`)));
  const doc = F.parseLine(service.readDoc(p2, slug));
  assert.equal(doc.front.meeting, undefined, "line frontmatter is not hijacked");
  assert.deepEqual(doc.steps.map(s => [s.kind, s.meetingId || ""]), [["note", ""], ["meeting", "m-1"], ["meeting", "m-2"]]);
  const state = await call("GET", `/projects/${p2.id}/state`), line = [...state.lines, ...state.backlog, ...state.landed].find(l => l.slug === slug);
  assert.deepEqual(line.stations.filter(s => s.kind === "meeting").map(s => s.meetingId), ["m-1", "m-2"]);

  // Cross-project links returned on /meetcue, /meetcue/links, and /meetcue/meetings/:id
  const mc = await call("GET", "/meetcue");
  assert.deepEqual(mc.links["m-1"].map(x => [x.projectName, x.slug, x.ownLine, Boolean(x.step)]), [["Supplies", own.slug, true, true], ["Weather app", slug, false, true]]);
  assert.deepEqual(mc.links["m-2"].map(x => [x.projectName, x.slug, x.ownLine]), [["Weather app", slug, false]]);
  const linksOnly = await call("GET", "/meetcue/links");
  assert.deepEqual(linksOnly.links["m-1"].length, 2);
  const one = await call("GET", "/meetcue/meetings/m-1");
  assert.deepEqual(one.links.map(x => x.projectName), ["Supplies", "Weather app"]);

  // Dropping and restoring the meeting node updates links cleanly
  const dropped = await call("POST", `/projects/${p2.id}/topics/${encodeURIComponent(slug)}/drop-yours`, { step:added1.step });
  assert.equal(dropped.status, 200);
  const afterDrop = await call("GET", "/meetcue/meetings/m-1");
  assert.deepEqual(afterDrop.links.map(x => x.projectName), ["Supplies"]);
  const restored = await call("POST", `/projects/${p2.id}/topics/${encodeURIComponent(slug)}/restore-yours`, { removed:dropped.removed });
  assert.equal(restored.status, 200);
  const afterRestore = await call("GET", "/meetcue/meetings/m-1");
  assert.deepEqual(afterRestore.links.map(x => x.projectName), ["Supplies", "Weather app"]);
});

test("a meeting node added while Cloud is slow keeps what was written to the line meanwhile, and two quick clicks add it once", async () => {
  const { connector, service, call, project } = await setup(), p = project("Weather app");
  const slug = await service.newYoursLine(p, { title:"Launch prep" });
  const fetchFromCloud = connector.accountFetch;
  let open; const gate = new Promise(resolve => { open = resolve; });
  connector.accountFetch = async (...args) => { await gate; return fetchFromCloud(...args); };
  const first = call("POST", `/projects/${p.id}/meetings`, { meetingId:"m-1", topic:slug });
  const second = call("POST", `/projects/${p.id}/meetings`, { meetingId:"m-1", topic:slug });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await call("POST", `/projects/${p.id}/yours`, { topic:slug, kind:"note", text:"Written while Cloud was slow" })).status, 200);
  open();
  const answers = await Promise.all([first, second]);
  assert.deepEqual(answers.map(a => a.status), [200, 200]);
  assert.deepEqual(answers.map(a => a.existed).sort(), [false, true]);
  const doc = F.parseLine(service.readDoc(p, slug));
  assert.deepEqual(doc.steps.map(s => [s.kind, s.meetingId || ""]), [["note", ""], ["meeting", "m-1"]]);
  assert.match(doc.steps[0].body, /Written while Cloud was slow/);
  assert.equal(fs.existsSync(path.join(p.docsPath, `files/${slug}/minutes-2.md`)), false);
});

test("MeetCue's diagrams come with the meeting: one diagram file per topic, drawn as a Canvas and a picture on the meeting's node", async () => {
  const { cloud, service, call, project } = await setup(), p = project("Supplies");
  const diagrams = [
    { topic:"Price", status:"done", sofar:["$10.50 agreed"], ahead:["Volume discount?"], nodes:[{ id:"n1", label:"Acme", kind:"org", note:"" }, { id:"n2", label:"Unit price", kind:"metric", note:"$10.50" }], edges:[{ from:"n1", to:"n2", label:"sets" }] },
    { topic:"Empty", nodes:[], edges:[] },
    { topic:"Delivery", sofar:[], ahead:[], nodes:[{ id:"x9", label:"Truck", kind:"system", note:"" }], edges:[{ from:"x9", to:"gone", label:"bad" }] },
  ];
  cloud.meetings.set("m-3", { ...cloud.meetings.get("m-1"), meeting:{ ...cloud.meetings.get("m-1").meeting, id:"m-3" }, diagrams });
  const wait = async file => { for (let i = 0; i < 100 && !fs.existsSync(file); i++) await new Promise(r => { setTimeout(r, 50); }); return fs.existsSync(file); };

  const made = await call("POST", `/projects/${p.id}/meetings`, { meetingId:"m-3" });
  assert.equal(made.status, 200, JSON.stringify(made));
  const step = F.parseLine(service.readDoc(p, made.slug)).steps[0], dir = `files/${made.slug}/supplier-call-diagrams`;
  assert.deepEqual(step.pictures.map(x => [x.name, x.href]), [
    ["Full meeting map", `../${dir}/00-full-meeting-map.png`],
    ["Price", `../${dir}/01-price.png`],
    ["Delivery", `../${dir}/02-delivery.png`],
  ], "whole meeting map plus one picture per topic with boxes");
  assert.deepEqual(step.files.map(f => f.href), [`../files/${made.slug}/minutes.md`]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(p.docsPath, `${dir}/01-price.diagram.json`), "utf8")), {
    type:"architecture", title:"Price", description:"$10.50 agreed",
    nodes:[{ id:"n1", label:"Acme" }, { id:"n2", label:"Unit price", subtitle:"$10.50" }], edges:[{ from:"n1", to:"n2", label:"sets" }], notes:["? Volume discount?"],
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(p.docsPath, `${dir}/02-delivery.diagram.json`), "utf8")).edges, [], "a link to a box that is not there is left out");
  for (const name of ["00-full-meeting-map", "01-price", "02-delivery"]) {
    assert.ok(await wait(path.join(p.docsPath, `${dir}/${name}.png`)), `${name}.png is drawn`);
    assert.ok(fs.existsSync(path.join(p.docsPath, `${dir}/${name}.penecho.json`)), `${name} opens as a Canvas`);
  }
  // Drawn once, on the meeting: no second copy of the picture is added to the line.
  const md = service.readDoc(p, made.slug);
  assert.equal(md.split(`](../${dir}/01-price.png)`).length - 1, 1);

  // As a node on an existing line, too, in a folder of its own.
  const slug = await service.newYoursLine(p, { title:"Launch prep" });
  const node = await call("POST", `/projects/${p.id}/meetings`, { meetingId:"m-3", topic:slug });
  const onLine = F.parseLine(service.readDoc(p, slug)).steps.find(s => s.id === node.step);
  assert.deepEqual(onLine.pictures.map(x => x.href), [
    `../files/${slug}/supplier-call-diagrams/00-full-meeting-map.png`,
    `../files/${slug}/supplier-call-diagrams/01-price.png`,
    `../files/${slug}/supplier-call-diagrams/02-delivery.png`,
  ]);
  assert.ok(await wait(path.join(p.docsPath, `files/${slug}/supplier-call-diagrams/02-delivery.png`)));

  // A MeetCue that sends no diagrams gives a meeting with none, as before.
  const plain = await call("POST", `/projects/${p.id}/meetings`, { meetingId:"m-1", topic:slug });
  assert.deepEqual(F.parseLine(service.readDoc(p, slug)).steps.find(s => s.id === plain.step).pictures, []);
});

test("built-in MeetCue example meetings work offline/signed-out for detail view and adding to a project", async () => {
  const { connector, service, call, project } = await setup(), p = project("Demo");
  connector.signedIn = false;
  const ex = await call("GET", "/meetcue/meetings/example-launch-sync");
  assert.equal(ex.status, 200);
  assert.equal(ex.meeting.example, true);
  assert.ok(ex.map?.nodes?.length >= 5);
  assert.ok(ex.map?.tree?.frames?.length >= 2);
  assert.equal(ex.diagrams.length, 3);
  assert.equal((await call("DELETE", "/meetcue/meetings/example-launch-sync")).status, 403);
  const made = await call("POST", `/projects/${p.id}/meetings`, { meetingId:"example-launch-sync" });
  assert.equal(made.status, 200);
  const doc = F.parseLine(service.readDoc(p, made.slug));
  assert.equal(doc.front.meeting, "example-launch-sync");
  assert.ok(doc.steps[0].pictures.some(x => x.name === "Full meeting map"));
  assert.equal(doc.steps.filter(s => s.kind === "ask").length, 3);
});

test("native map payload without whole_diagram writes full meeting map and topic diagrams when added to a project", async () => {
  const { cloud, service, call, project } = await setup(), p = project("NativeMap");
  cloud.meetings.set("m-native", {
    ...cloud.meetings.get("m-1"),
    meeting:{ ...cloud.meetings.get("m-1").meeting, id:"m-native", title:"Native map call" },
    map:{
      title:"Native map call",
      gist:"Core party and two linked topics.",
      topics:[
        { id:"t1", label:"Pricing", status:"done", sofar:["$10 agreed"], ahead:[] },
        { id:"t2", label:"Delivery", status:"active", sofar:[], ahead:["Confirm ETA"] },
      ],
      nodes:[
        { id:"c1", label:"Acme", kind:"org", note:"Core", topic:"" },
        { id:"n1", label:"Unit cost", kind:"metric", note:"$10", topic:"t1" },
        { id:"n2", label:"Ship date", kind:"time", note:"Friday", topic:"t2" },
      ],
      edges:[
        { id:"c1__n1", from:"c1", to:"n1", label:"offers", kind:"owns" },
        { id:"n1__n2", from:"n1", to:"n2", label:"triggers", kind:"flow" },
      ],
    },
  });
  const made = await call("POST", `/projects/${p.id}/meetings`, { meetingId:"m-native" });
  assert.equal(made.status, 200, JSON.stringify(made));
  const step = F.parseLine(service.readDoc(p, made.slug)).steps[0];
  assert.deepEqual(step.pictures.map(x => x.name), ["Full meeting map", "Pricing", "Delivery"]);
  const wholeJson = JSON.parse(fs.readFileSync(path.join(p.docsPath, `files/${made.slug}/native-map-call-diagrams/00-full-meeting-map.diagram.json`), "utf8"));
  assert.equal(wholeJson.nodes.length, 3);
  assert.equal(wholeJson.edges.length, 2);
});
