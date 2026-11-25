'use strict';
require('./helpers/safety.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const F = require('../src/server/project-lines/format.js');
const { Service } = require('../src/server/project-lines/service.js');
const { createProjectLines } = require('../src/server/project-lines/http.js');
const { createAgents } = require('../src/server/project-lines/agents.js');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'penecho-split-retired-'));
const services = [];
after(() => { services.forEach(s => s.close()); fs.rmSync(temp, { recursive:true, force:true }); });
function setup({ routes = false } = {}) {
  const n = services.length;
  const options = { directory:path.join(temp, `state-${n}`), agents:createAgents({ env:{ PATH:'' } }) };
  const api = routes && createProjectLines({ ...options, serviceOptions:{ autoWatch:false }, authorizeRead:() => null, authorizeWrite:() => null, readJson:async req => req.body || {}, send:(res, status, body) => { res.status = status; res.body = body; res.headersSent = true; } });
  const service = api ? api.service : new Service({ ...options, autoWatch:false });
  services.push(service);
  const project = service.store.create({ name:'Saved work', docsPath:path.join(temp, `docs-${n}`), codePath:null });
  project.autoWake = false;
  const parent = '---\nid: T-1\nstatus: done\ncreated: 2026-11-13 09:00\n---\n\n# Saved plan\n\n## Parts\n\n1. **Unstarted task** · quick\n\n   Keep these exact instructions.\n\n2. **Existing task** · normal · [child](child.md)\n\n   Keep the child result.\n\n## Ask · 2026-11-13 09:00 · Plan and split\n\nMake a plan.\n\n## [x] Work 1 · @tester · 1 min\n\nA saved plan.\n';
  service.writeDoc(project, 'parent', parent);
  service.writeDoc(project, 'child', '---\nid: T-2\nstatus: working\nparent: parent\ncreated: 2026-11-13 09:01\n---\n\n# Existing task\n\n## Note · 2026-11-13 09:01\n\nExisting content.\n');
  service.sync(project);
  return { api, service, project, parent:service.readDoc(project, 'parent') };
}
const retired = error => error.code === 'SPLIT_RETIRED' && error.status === 410;

test('stale split requests reject before dispatching work or changing any topic', async () => {
  const { service:s, project:p } = setup(), before = s.readDoc(p, 'parent');
  let dispatched = 0;
  s.handTo = () => { dispatched++; };
  s.takeFile = () => { throw Error('Attachments must not be moved'); };
  s.launch = async () => { dispatched++; };
  for (const topic of ['new', 'parent']) {
    await assert.rejects(s.request(p, { topic, text:'Do this', plan:true, agent:'other', attachments:[{}] }), retired);
  }
  await assert.rejects(s.request(p, { plan:true, canvas:'old-canvas', text:'Do this' }), retired);
  await assert.rejects(s.createTopic(p, { text:'Do this', plan:true, attachments:[{}] }), retired);
  await assert.rejects(s.act(p, 'parent', 'plan', { agent:'other' }), retired);
  assert.equal(dispatched, 0);
  assert.equal(s.readDoc(p, 'parent'), before);
  assert.deepEqual(s.store.scan(p).topics.map(t => t.slug).sort(), ['child', 'parent']);
});

test('ordinary Asks still save normally with absent or false plan flags', async () => {
  const { service:s, project:p } = setup();
  for (const plan of [undefined, false]) {
    const made = await s.request(p, { text:`Ordinary request ${String(plan)}`, plan, topic:'new' });
    const doc = F.parseLine(s.readDoc(p, made.slug));
    assert.equal(doc.asks[0].via, '');
    assert.equal(doc.parent, '');
    assert.deepEqual(doc.parts, []);
  }
});

test('an ordinary Ask on a former child keeps its parent and saved plan unchanged', async () => {
  const { service:s, project:p } = setup(), parent = s.readDoc(p, 'parent');
  s.writeDoc(p, 'child', F.setFront(s.readDoc(p, 'child'), { status:'notes' }));
  s.sync(p);
  await s.request(p, { topic:'child', text:'Continue this child as ordinary work.' });
  const child = F.parseLine(s.readDoc(p, 'child'));
  assert.equal(child.parent, 'parent');
  assert.equal(child.asks.at(-1).text, 'Continue this child as ordinary work.');
  assert.equal(child.asks.at(-1).via, '');
  assert.equal(s.readDoc(p, 'parent'), parent);
  assert.equal(s.store.scan(p).topics.length, 2);
});

test('old metadata cannot replace saved Parts, create children, or coordinate completion', () => {
  const { service:s, project:p, parent } = setup();
  const run = { said:'Done.\n<!-- penecho: parts=[{"title":"New child","words":"Launch this"}] tags="saved work" -->', agent:'tester' };
  s.takeMeta(p, 'parent', run);
  assert.equal(run.said, 'Done.');
  assert.equal(run.tags, undefined);
  assert.equal(s.readDoc(p, 'parent'), parent);
  assert.equal(s.store.scan(p).topics.length, 2);
  const doc = F.parseLine(parent);
  assert.deepEqual(doc.parts.map(part => [part.title, part.words, part.slug]), [
    ['Unstarted task', 'Keep these exact instructions.', ''],
    ['Existing task', 'Keep the child result.', 'child'],
  ]);
  for (const method of ['planLine', 'putParts', 'startParts', 'bringTogether', 'partsBroughtTogether', 'crewOf']) assert.equal(s[method], undefined);
});

test('archive, reopen and deletion affect only the chosen line, including old archived-with metadata', async () => {
  const { service:s, project:p } = setup();
  const stopped = [];
  // Both lines have a Work at work. Archiving stops what it archives, and waits for it.
  const held = new Set(['parent', 'child']), heldWorks = s.heldWorks;
  s.heldWorks = (_project, slug) => (held.has(slug) ? [{ slug, stepId:'work-1' }] : []);
  s.stopHeldAndWait = async (_project, slug, works) => { assert.deepEqual(works.map(w => w.slug), [slug]); stopped.push(slug); held.delete(slug); };
  const child = s.readDoc(p, 'child');
  await s.act(p, 'parent', 'close');
  assert.equal(s.readDoc(p, 'child'), child);
  await s.act(p, 'parent', 'reopen');
  assert.equal(s.readDoc(p, 'child'), child);
  assert.deepEqual(stopped, ['parent'], 'archiving a parent never stops a working child');
  s.heldWorks = heldWorks;
  s.writeDoc(p, 'child', F.setFront(child, { status:'closed', 'archived with':'parent' }));
  s.sync(p);
  const archivedChild = s.readDoc(p, 'child');
  await s.act(p, 'parent', 'close');
  await s.act(p, 'parent', 'reopen');
  assert.equal(s.readDoc(p, 'child'), archivedChild);
  const parent = s.readDoc(p, 'parent');
  await s.act(p, 'child', 'reopen');
  assert.equal(s.readDoc(p, 'parent'), parent);
  await s.act(p, 'parent', 'delete', { confirm:'parent', baseHash:F.hashText(s.readDoc(p, 'parent')) });
  assert.equal(F.parseLine(s.readDoc(p, 'child')).parent, 'parent');
});

test('all old HTTP entry points return 410 without mutating documents or dispatching an agent', async () => {
  const { api, service:s, project:p } = setup({ routes:true });
  const before = ['parent', 'child'].map(slug => s.readDoc(p, slug));
  let dispatched = 0; s.launch = async () => { dispatched++; }; s.handTo = () => { dispatched++; };
  const entries = [
    ['POST', '/topics', { text:'Old request', plan:true }],
    ['POST', '/topics', { topic:'parent', text:'Old request', plan:true, agent:'other' }],
    ['POST', '/topics/parent/plan', { agent:'other' }],
    ['PUT', '/topics/parent/parts', { parts:[] }],
    ['POST', '/topics/parent/parts/start', {}],
    ['POST', '/topics/parent/parts/together', { agent:'other' }],
  ];
  for (const [method, suffix, body] of entries) {
    const res = {}, url = new URL(`http://test.local/api/lines/projects/${p.id}${suffix}`);
    assert.equal(await api.handle({ method, body }, res, url), true);
    assert.equal(res.status, 410, `${method} ${suffix}`);
    assert.equal(res.body.code, 'SPLIT_RETIRED');
  }
  // An old page's line merge, or its Undo, is refused too, and never reaches the branch Merge (PE-459).
  for (const [suffix, body] of [['/topics/parent/merge', { from:['child'] }], ['/topics/parent/merge/undo', {}]]) {
    const res = {}, url = new URL(`http://test.local/api/lines/projects/${p.id}${suffix}`);
    assert.equal(await api.handle({ method:'POST', body }, res, url), true);
    assert.equal(res.status, 410, suffix);
    assert.equal(res.body.code, 'LINE_MERGE_RETIRED');
  }
  assert.deepEqual(['parent', 'child'].map(slug => s.readDoc(p, slug)), before);
  assert.equal(s.store.scan(p).topics.length, 2);
  assert.equal(dispatched, 0);
});
