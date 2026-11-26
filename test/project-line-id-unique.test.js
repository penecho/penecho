"use strict";
require("./helpers/safety.js");
// PE-927: a Line that came with its id from elsewhere (PenEcho Cloud, another computer's sync, a file put in the folder by hand)
// was never numbered here, so the next Line made on this computer took the same id: two Lines made on one day were both PE-911.
const { test, after } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const F = require("../src/server/project-lines/format.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-id-unique-")));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
const line = (id, title) => `---\nid: ${id}\nstatus: done\n---\n\n# ${title}\n\n## Ask · 2026-11-22 02:31\n\nSent from another place.\n`;

test("a new Line never takes the id of a Line that arrived from elsewhere, in lines/ or in the archive", async t => {
  const service = new Service({ directory:path.join(temp, "state"), agents:createAgents({ env:{ PATH:"" } }), autoWatch:false, memory:{ home:temp, env:{} }, conversations:{ home:temp, env:{} } });
  t.after(() => service.close());
  const project = service.store.create({ name:"Demo", docsPath:path.join(temp, "docs") }), prefix = project.prefix;
  const idOf = slug => F.parseLine(service.readDoc(project, slug)).front.id, number = id => Number(id.slice(prefix.length + 1));
  const first = idOf((await service.createTopic(project, { text:"The first job", start:false })).slug);
  // As PenEcho Cloud's sync does: a Line file with the next two numbers, written straight into the folders.
  fs.writeFileSync(path.join(project.docsPath, "lines/sent-from-cloud.md"), line(`${prefix}-${number(first) + 1}`, "Sent from Cloud"));
  fs.mkdirSync(path.join(project.docsPath, "archive/lines"), { recursive:true });
  fs.writeFileSync(path.join(project.docsPath, "archive/lines/older-from-cloud.md"), line(`${prefix}-${number(first) + 2}`, "Archived there"));
  const second = idOf((await service.createTopic(project, { text:"The next job made here", start:false })).slug);
  assert.equal(number(second), number(first) + 3, `${second} after ${first}`);
  const third = idOf((await service.createTopic(project, { text:"And another", start:false })).slug);
  assert.equal(number(third), number(first) + 4);
  const ids = service.store.scan(project).topics.map(t => t.doc.front.id);
  assert.equal(new Set(ids).size, ids.length, `every Line has an id of its own: ${ids.join(", ")}`);
});
