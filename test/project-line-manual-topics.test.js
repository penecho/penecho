"use strict";
require("./helpers/safety.js");
require("./helpers/show-topics.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const Knowledge = require("../src/server/project-lines/knowledge.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { Service } = require("../src/server/project-lines/service.js");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pe-topic-"));
  const docs = path.join(root, "docs");
  const service = new Service({ directory:path.join(root, "state"), agents:createAgents({ env:{ PATH:"" }, appFolders:[] }), autoWatch:false, carryOn:false });
  const project = service.store.create({ name:"Garden", docsPath:docs });
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { service, project, docs };
}

test("a new Topic is discovered and used like any other Topic, without starting a Line", t => {
  const { service, project, docs } = fixture(t);
  const overview = "# Garden\n\nThe existing overview.\n";
  service.store.writeText(project, "understanding.md", overview);
  service.begin = () => assert.fail("Creating a Topic must not start an agent");
  const title = 'Water: "drip" & irrigation', goal = "How the garden is watered.";
  const made = service.createKnowledgeTopic(project, { title, goal });
  const original = fs.readFileSync(path.join(docs, made.path), "utf8");
  const { front } = F.splitFront(original);
  assert.deepEqual(Object.keys(front), ["record_type", "id", "title", "parent_id", "updated"]);
  assert.equal(front.record_type, "topic");
  assert.match(front.id, /^topic-[a-z0-9]{8}$/);
  assert.equal(front.id, made.id);
  assert.equal(front.title, title);
  assert.deepEqual(service.store.scan(project).topics, []);
  assert.equal(fs.readFileSync(path.join(docs, "understanding.md"), "utf8"), overview);
  const discovered = service.stateOf(project).knowledge.find(topic => topic.path === made.path);
  assert.deepEqual([discovered.title, discovered.goal, ...discovered.lines], [title, goal]);
  assert.equal(Knowledge.knowledgeNote(docs, "irrigation"), Knowledge.knowledgeNote());

  const lineRow = "| [PE-1](../lines/irrigation.md) | Irrigation timer | |\n";
  service.store.writeText(project, made.path, `${original}${lineRow}`);
  assert.equal(Knowledge.topicOfLine(docs, "irrigation")?.id, made.id);
  const ask = { kind:"ask", done:true, text:"Add a timer so the garden is watered in the morning." };
  const step = { kind:"work", id:"line-1", label:"Work 1" };
  const doc = { front:{ id:"PE-1" }, title:"Irrigation timer", steps:[ask, step] };
  assert.equal(service.fileRequirement(project, "irrigation", doc, step, "agreed | Irrigation timing | Water in the morning.", "Timer configured."), true);
  assert.match(fs.readFileSync(path.join(docs, made.path), "utf8"), /Irrigation timing/);
  assert.match(Knowledge.knowledgeNote(docs, "irrigation"), /requirements there: "Irrigation timing"/);
});

test("Tier 1 and Tier 2 topics can be created, selected, renamed, moved, and deleted cleanly", t => {
  const { service, project, docs } = fixture(t);
  service.begin = () => assert.fail("Manual Topic management must not start an agent");

  // 1. Add Tier 1 on an empty project -> creates standard understanding.md with no manual markers.
  const t1 = service.createTopicArea(project, { name:"Watering", goal:"Pumps, valves and schedules" });
  assert.equal(t1.name, "Watering");
  assert.equal(t1.topic, "area:Watering");
  let state = service.stateOf(project);
  assert.deepEqual(state.areas, ["Watering"]);
  assert.equal(state.areaDetails.Watering, "Pumps, valves and schedules");
  assert.equal(state.understanding, true);
  const u1 = fs.readFileSync(path.join(docs, "understanding.md"), "utf8");
  assert.match(u1, /^record_type: project-understanding$/m);
  assert.match(u1, /^\*\*Watering\*\* — Pumps, valves and schedules$/m);
  assert.doesNotMatch(u1, /manual|created_by|user/i);

  // 2. Add Tier 2 choosing existing Tier 1 -> frontmatter has area: Watering and understanding.md lists it.
  const drip = service.createKnowledgeTopic(project, { title:"Drip lines", goal:"Emitter layout.", area:"watering" });
  assert.equal(drip.area, "Watering");
  const dripText = fs.readFileSync(path.join(docs, drip.path), "utf8");
  const { front: dripFront } = F.splitFront(dripText);
  assert.equal(dripFront.area, "Watering");
  assert.equal(dripFront.title, "Drip lines");
  assert.equal("updated_by" in dripFront, false);
  const u2 = fs.readFileSync(path.join(docs, "understanding.md"), "utf8");
  assert.match(u2, /- \*\*\[Drip lines\]\(topics\/drip-lines\.md\)\*\* — Emitter layout\./);

  // 3. Add Tier 2 with a brand-new Tier 1 inline (including "/" in Tier 1 name) -> creates both Tier 1 and Tier 2.
  const soil = service.createKnowledgeTopic(project, { title:"Compost", goal:"Soil amendments.", area:"Soil / Beds" });
  assert.equal(soil.area, "Soil / Beds");
  assert.deepEqual(service.stateOf(project).areas, ["Watering", "Soil / Beds"]);

  // 4. Rename Tier 2 and move it to another Tier 1 -> keeps id, updates heading & understanding.md.
  const renamed = service.updateKnowledgeTopic(project, { path:soil.path, title:"Compost & Mulch", area:"Watering", goal:"Organic soil cover." });
  assert.equal(renamed.id, soil.id);
  assert.equal(renamed.area, "Watering");
  const soilAfter = fs.readFileSync(path.join(docs, soil.path), "utf8");
  assert.equal(F.splitFront(soilAfter).front.id, soil.id);
  assert.equal(F.splitFront(soilAfter).front.title, "Compost & Mulch");
  assert.equal(F.splitFront(soilAfter).front.area, "Watering");
  assert.match(soilAfter, /^# Compost & Mulch$/m);
  assert.match(soilAfter, /^\*\*Organic soil cover\.\*\*$/m);
  // Creating a brand-new topic with the old name "Compost" now succeeds using compost-2.md without overwriting!
  const compost2 = service.createKnowledgeTopic(project, { title:"Compost", area:"Soil / Beds" });
  assert.equal(compost2.path, "topics/compost-2.md");

  // 5. Rename Tier 1 -> updates understanding.md heading AND every Topic file in that Tier 1.
  const areaRenamed = service.updateTopicArea(project, { name:"Watering", newName:"Irrigation", goal:"Automated watering systems" });
  assert.equal(areaRenamed.name, "Irrigation");
  assert.equal(areaRenamed.updatedTopics, 2);
  state = service.stateOf(project);
  assert.deepEqual(state.areas, ["Irrigation", "Soil / Beds"]);
  assert.equal(state.areaDetails.Irrigation, "Automated watering systems");
  assert.equal(state.knowledge.find(x => x.path === drip.path)?.area, "Irrigation");
  assert.equal(state.knowledge.find(x => x.path === soil.path)?.area, "Irrigation");

  // 6. Delete a Tier 2 topic -> removes file & understanding.md bullet, preserves Lines, supports Recover/Undo.
  service.store.writeText(project, "lines/fix-drip.md", "---\nid: PE-1\nstatus: ready\n---\n\n# Fix drip\n");
  const delTopic = service.deleteKnowledgeTopic(project, { path:drip.path });
  assert.equal(delTopic.ok, true);
  assert.ok(delTopic.undo);
  assert.equal(fs.existsSync(path.join(docs, drip.path)), false);
  assert.equal(fs.existsSync(path.join(docs, "lines/fix-drip.md")), true);
  assert.doesNotMatch(fs.readFileSync(path.join(docs, "understanding.md"), "utf8"), /topics\/drip-lines\.md/);

  // Undo restores the deleted Topic cleanly.
  service.restoreTopics(project, { id:delTopic.undo });
  assert.equal(fs.existsSync(path.join(docs, drip.path)), true);
  assert.match(fs.readFileSync(path.join(docs, "understanding.md"), "utf8"), /topics\/drip-lines\.md/);

  // 7. Delete a Tier 1 topic with mode="ungroup" -> removes Tier 1 heading, keeps its Tier 2 topics ungrouped.
  const ungroup = service.deleteTopicArea(project, { name:"Irrigation", mode:"ungroup" });
  assert.equal(ungroup.ok, true);
  assert.equal(ungroup.affectedTopics, 2);
  state = service.stateOf(project);
  assert.deepEqual(state.areas, ["Soil / Beds"]);
  assert.equal(state.knowledge.find(x => x.path === drip.path)?.area, "");
  assert.equal(state.knowledge.find(x => x.path === soil.path)?.area, "");
  const uUngroup = fs.readFileSync(path.join(docs, "understanding.md"), "utf8");
  assert.doesNotMatch(uUngroup, /^\*\*Irrigation\*\*/m);
  // Kept topics must appear BEFORE **Soil / Beds**, not falsely nested under Soil / Beds!
  assert.ok(uUngroup.indexOf("topics/drip-lines.md") < uUngroup.indexOf("**Soil / Beds**"));

  // 8. Delete a Tier 1 topic with mode="delete-topics" -> removes Tier 1 AND its Tier 2 topic files.
  const wipe = service.deleteTopicArea(project, { name:"Soil / Beds", mode:"delete-topics" });
  assert.equal(wipe.ok, true);
  assert.equal(wipe.affectedTopics, 1);
  assert.equal(fs.existsSync(path.join(docs, compost2.path)), false);
  assert.equal(fs.existsSync(path.join(docs, "lines/fix-drip.md")), true);
  assert.deepEqual(service.stateOf(project).areas, []);

  // Restore brings Soil / Beds and compost-2.md back.
  service.restoreTopics(project, { id:wipe.undo });
  assert.equal(fs.existsSync(path.join(docs, compost2.path)), true);
  assert.deepEqual(service.stateOf(project).areas, ["Soil / Beds"]);
});

test("renaming or moving preserves rich understanding.md prose and deleting a parent promotes subtopics", t => {
  const { service, project, docs } = fixture(t);
  service.store.writeText(project, "understanding.md", [
    "---",
    "record_type: project-understanding",
    "project: Garden",
    "updated: 2026-11-20",
    "---",
    "",
    "# Garden",
    "",
    "## Open now",
    "",
    "**Important status note that must never change.**",
    "",
    "## Topics",
    "",
    "**Core** — main garden systems",
    "",
    "- **[Watering](topics/watering.md)** — Rich summary with [PE-1](lines/a.md) and *2 open · 3 done*",
    "",
    "**Not in a Topic yet:** [PE-9 Hello](lines/hello.md)",
    "",
  ].join("\n"));
  service.store.writeText(project, "topics/watering.md", "---\nrecord_type: topic\nid: topic-parent01\ntitle: Watering\narea: Core\nparent_id: null\nupdated: 2026-11-20\nupdated_by: PE-1 Work 1\n---\n\n# Watering\n\n**Keep plants watered.**\n\n## Lines\n\n| Line | What it is | Requirements |\n| --- | --- | --- |\n");
  service.store.writeText(project, "topics/valves.md", "---\nrecord_type: topic\nid: topic-child001\ntitle: Valves\nparent_id: topic-parent01\nupdated: 2026-11-20\n---\n\n# Valves\n\n**Valve controls.**\n");

  service.updateKnowledgeTopic(project, { path:"topics/watering.md", title:"Smart Watering" });
  const uRenamed = fs.readFileSync(path.join(docs, "understanding.md"), "utf8");
  assert.match(uRenamed, /\*\*Important status note that must never change\.\*\*/);
  assert.match(uRenamed, /- \*\*\[Smart Watering\]\(topics\/watering\.md\)\*\* — Rich summary with \[PE-1\]\(lines\/a\.md\) and \*2 open · 3 done\*/);
  assert.match(uRenamed, /\*\*Not in a Topic yet:\*\* \[PE-9 Hello\]\(lines\/hello\.md\)/);
  assert.equal(F.splitFront(fs.readFileSync(path.join(docs, "topics/watering.md"), "utf8")).front.updated_by, "PE-1 Work 1");

  // Deleting parent promotes child subtopic to root and inherits parent's Tier 1 area.
  service.deleteKnowledgeTopic(project, { path:"topics/watering.md" });
  const child = service.stateOf(project).knowledge.find(x => x.path === "topics/valves.md");
  assert.equal(child.parent, "");
  assert.equal(child.area, "Core");
});

test("invalid names, duplicate names, reserved Tier 1 names and slug collisions are rejected", t => {
  const { service, project, docs } = fixture(t);
  const create = (title, goal, area) => service.createKnowledgeTopic(project, { title, goal, area });
  assert.throws(() => create("   "), { code:"BAD_TITLE" });
  assert.throws(() => create("a".repeat(121)), { code:"BAD_TITLE" });
  assert.throws(() => create("Water", "a".repeat(301)), { code:"BAD_GOAL" });
  assert.throws(() => service.createTopicArea(project, { name:"   " }), { code:"BAD_AREA" });
  assert.throws(() => service.createTopicArea(project, { name:"a".repeat(81) }), { code:"BAD_AREA" });
  assert.throws(() => service.createTopicArea(project, { name:"Bad*Name" }), { code:"BAD_AREA" });
  assert.throws(() => service.createTopicArea(project, { name:"Bad[Name]" }), { code:"BAD_AREA" });
  assert.throws(() => service.createTopicArea(project, { name:"Other" }), { code:"BAD_AREA" });
  assert.throws(() => service.createTopicArea(project, { name:"Not in a Topic yet" }), { code:"BAD_AREA" });
  assert.throws(() => service.createTopicArea(project, { name:"Core", goal:"a".repeat(201) }), { code:"BAD_GOAL" });

  service.createTopicArea(project, { name:"Core" });
  assert.throws(() => service.createTopicArea(project, { name:" core " }), { code:"AREA_EXISTS" });
  assert.throws(() => service.updateTopicArea(project, { name:"Missing", newName:"New" }), { code:"NOT_FOUND" });
  assert.throws(() => service.deleteTopicArea(project, { name:"Core", mode:"bogus" }), { code:"BAD_MODE" });

  const made = create("Water pumps", "", "Core");
  const original = fs.readFileSync(path.join(docs, made.path), "utf8");
  for (const title of [" WATER  pumps ", "Water-pumps!"]) assert.throws(() => create(title), { code:"TOPIC_EXISTS" });
  assert.throws(() => service.updateKnowledgeTopic(project, { path:"../understanding.md", title:"Hack" }), { code:"BAD_PATH" });
  assert.throws(() => service.deleteKnowledgeTopic(project, { path:"../understanding.md" }), { code:"BAD_PATH" });
  assert.throws(() => service.deleteKnowledgeTopic(project, { path:"topics/nonexistent.md" }), { code:"NOT_FOUND" });
  assert.throws(() => service.store.writeText(project, made.path, "second writer", { createOnly:true }), { code:"EEXIST" });
  assert.equal(fs.readFileSync(path.join(docs, made.path), "utf8"), original);
  assert.deepEqual(fs.readdirSync(path.join(docs, "topics")), ["water-pumps.md"]);
  project.projectTopics = false;
  assert.throws(() => create("Flowers"), { code:"TOPICS_OFF" });
  assert.throws(() => service.createTopicArea(project, { name:"Plants" }), { code:"TOPICS_OFF" });
  assert.throws(() => service.deleteKnowledgeTopic(project, { path:made.path }), { code:"TOPICS_OFF" });
});

test("creation and mutations honor existing Build eligibility and wait for a Topics job to start or finish", async t => {
  const { service, project } = fixture(t);
  const create = title => service.createKnowledgeTopic(project, { title });
  const made = create("Watering");
  await assert.rejects(service.buildTopics(project), { code:"HAS_TOPICS" });
  await assert.rejects(service.buildTopics(project, { rebuild:true }), { code:"NO_LINES" });
  const { promise, resolve } = Promise.withResolvers();
  const starting = service.startTopicsJob(project, () => promise);
  try {
    assert.throws(() => create("Flowers"), { code:"BUSY" });
    assert.throws(() => service.createTopicArea(project, { name:"Core" }), { code:"BUSY" });
    assert.throws(() => service.updateKnowledgeTopic(project, { path:made.path, title:"Irrigation" }), { code:"BUSY" });
    assert.throws(() => service.deleteKnowledgeTopic(project, { path:made.path }), { code:"BUSY" });
  } finally { resolve(); await starting; }
  service.store.writeText(project, "lines/build.md", "---\nid: PE-1\nstatus: active\njob: build-topics\n---\n\n# Build Topics\n\n## Ask · 2026-11-23 12:00\n\nBuild Topics.\n");
  assert.throws(() => create("Flowers"), { code:"BUSY" });
  assert.throws(() => service.createTopicArea(project, { name:"Core" }), { code:"BUSY" });
  service.store.writeText(project, "lines/build.md", F.setFront(service.readDoc(project, "build"), { status:"done" }));
  assert.equal(create("Flowers").path, "topics/flowers.md");
});

test("HTTP endpoints enforce local-only access and support Tier 1 & Tier 2 CRUD", async t => {
  const http = require("node:http");
  const { createProjectLines } = require("../src/server/project-lines/http.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pe-topic-http-"));
  const docs = path.join(root, "docs"), directory = path.join(root, "state");
  let local = false;
  const lines = createProjectLines({
    directory,
    agents:createAgents({ env:{ PATH:"" }, appFolders:[] }),
    serviceOptions:{ autoWatch:false, carryOn:false },
    authorizeRead:() => null,
    authorizeWrite:() => null,
    isThisComputer:() => local,
    readJson:req => new Promise((resolve, reject) => {
      let s = "";
      req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (err) { reject(err); } });
    }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); },
  });
  const project = lines.service.store.create({ name:"Garden", docsPath:docs });
  const server = http.createServer(async (req, res) => {
    if (!await lines.handle(req, res, new URL(req.url, "http://127.0.0.1"))) { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.close(); lines.close(); fs.rmSync(root, { recursive:true, force:true }); });
  const base = `http://127.0.0.1:${server.address().port}/api/lines/projects/${encodeURIComponent(project.id)}`;
  const post = async (action, body) => {
    const res = await fetch(`${base}/${action}`, { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify(body) });
    return { status:res.status, body:await res.json() };
  };

  for (const [action, body] of [
    ["create-topic-area", { name:"Core" }],
    ["update-topic-area", { name:"Core", newName:"Core2" }],
    ["delete-topic-area", { name:"Core" }],
    ["create-knowledge-topic", { title:"Auth", area:"Core" }],
    ["update-knowledge-topic", { path:"topics/auth.md", title:"Auth2" }],
    ["delete-knowledge-topic", { path:"topics/auth.md" }],
  ]) {
    const denied = await post(action, body);
    assert.equal(denied.status, 403, `${action} must reject non-local callers`);
    assert.equal(denied.body.code, "LOCAL_ONLY");
  }

  local = true;
  const madeArea = await post("create-topic-area", { name:"Core", goal:"Core services" });
  assert.equal(madeArea.status, 201);
  assert.equal(madeArea.body.name, "Core");

  const madeTopic = await post("create-knowledge-topic", { title:"Auth", area:"Core", goal:"Login and sessions." });
  assert.equal(madeTopic.status, 201);
  assert.equal(madeTopic.body.area, "Core");

  const updTopic = await post("update-knowledge-topic", { path:madeTopic.body.path, title:"Sign-in", area:"Core" });
  assert.equal(updTopic.status, 200);
  assert.equal(updTopic.body.title, "Sign-in");

  const updArea = await post("update-topic-area", { name:"Core", newName:"Security" });
  assert.equal(updArea.status, 200);
  assert.equal(updArea.body.name, "Security");

  const delTopic = await post("delete-knowledge-topic", { path:madeTopic.body.path });
  assert.equal(delTopic.status, 200);
  assert.equal(delTopic.body.ok, true);

  const delArea = await post("delete-topic-area", { name:"Security", mode:"ungroup" });
  assert.equal(delArea.status, 200);
  assert.equal(delArea.body.ok, true);
});
