"use strict";
require('./helpers/safety.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { Service } = require('../src/server/project-lines/service.js');
const { createAgents } = require('../src/server/project-lines/agents.js');
const { Store } = require('../src/server/project-lines/store.js');
const { createProjectLines } = require('../src/server/project-lines/http.js');
const { folderCommand, revealCommand, createFolderOpener } = require('../src/server/project-lines/open-folder.js');
const F = require('../src/server/project-lines/format.js');
const agents = { available:() => [], desktop:() => null, terminal:(_, id) => `codex resume ${id}` };
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'line-actions-'));
  const directory = path.join(root, 'state'); fs.mkdirSync(directory);
  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:'Actions', docsPath:path.join(root, 'Docs with spaces') });
  project.follow = false; service.store.save();
  const put = (slug, title = slug) => service.writeDoc(project, slug, F.initialLine({ title, status:'done', steps:[F.askStep({ words:'Please help' }), { ...F.workStep({ who:'codex' }), done:true, out:'A finished result' }] }));
  put('one'); put('two'); service.sync(project);
  const line = slug => service.stateOf(project).lines.find(l => l.id === slug);
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { root, directory, service, project, put, line };
}
test('rename preserves the Topic identity, Markdown body and references, with stale-write rejection', async t => {
  const { service:s, project:p, line } = setup(t), before = s.readDoc(p, 'one'), first = line('one');
  await s.act(p, 'one', 'rename', { title:'A useful title', baseHash:first.topicHash });
  assert.equal(line('one').title, 'A useful title');
  assert.equal(line('one').topicAbsolutePath, path.join(p.docsPath, 'lines', 'one.md'));
  // The name is the person's now, so an agent's title never replaces it (N2).
  assert.equal(s.readDoc(p, 'one').replace('# A useful title', '# one').replace('title by: you\n', ''), before);
  assert.match(s.readDoc(p, 'one'), /^title by: you$/m);
  await assert.rejects(s.act(p, 'one', 'rename', { title:'Stale', baseHash:first.topicHash }), { code:'CONFLICT' });
  await assert.rejects(s.act(p, 'one', 'rename', { title:'bad\n## Ask', baseHash:line('one').topicHash }), { code:'BAD_TITLE' });
  assert.ok(fs.existsSync(path.join(p.docsPath, '.history')));
});
test('a Work opens its own conversation, even while the line is running', async t => {
  const { service:s, project:p } = setup(t), opened = [];
  s.openDesktop = async (agent, id) => { opened.push(`${agent} ${id}`); };
  s.conversations.recordOf('claude', 'first'); s.conversations.recordOf('claude', 'second');
  s.remember(p, 'one', 'claude', 'first', 'work', p.docsPath);
  s.remember(p, 'one', 'claude', 'second', 'work', p.docsPath);
  s.activity.add(p, 'one', { kind:'tool', id:'first:call-1', state:'done', step:'work-1' });
  s.activity.add(p, 'one', { kind:'tool', id:'second:call-2', state:'done', step:'work-2' });
  s.activity.add(p, 'one', { kind:'tool', id:'not-a-conversation:call-3', state:'done', step:'work-3' });
  await s.openConversation(p, 'one', 'claude', 'work-1');
  await s.openConversation(p, 'one', 'claude', 'work-2');
  await s.openConversation(p, 'one', 'claude', 'work-3');
  await s.openConversation(p, 'one', 'claude');
  assert.deepEqual(opened, ['claude first', 'claude second', 'claude second', 'claude second']);
  // Another agent's conversation is never where this one's link goes.
  s.conversations.recordOf('codex', 'first');
  s.remember(p, 'one', 'codex', 'theirs', 'work', p.docsPath);
  await s.openConversation(p, 'one', 'codex', 'work-2');
  assert.equal(opened.at(-1), 'codex theirs');
  // A run does not stop you going to look at it.
  s.runs.set(s.key(p, 'one'), { stepId:'work-1' });
  try { await s.openConversation(p, 'one', 'claude', 'work-1'); } finally { s.runs.delete(s.key(p, 'one')); }
  assert.equal(opened.at(-1), 'claude first');
  // If the app is not there, the words say so, in place of whatever the opener printed.
  delete s.openDesktop;
  const child = () => { const e = new (require('node:events').EventEmitter)(); setImmediate(() => e.emit('close', 1)); return e; };
  s.spawn = child;
  await assert.rejects(s.runDesktop({ command:'open', args:[] }), { code:'NO_DESKTOP', message:'The desktop app did not open. Is it installed?' });
});
test('semantic revisions ignore status banners and tool activity but include older work results', t => {
  const { service:s, project:p, line } = setup(t);
  const first = line('one');
  s.writeDoc(p, 'one', s.readDoc(p, 'one').replace(/<!-- status:[\s\S]*?<!-- \/status -->/, '<!-- status: PenEcho keeps this current -->\n> Other generated status\n<!-- /status -->'));
  s.activity.add(p, 'one', { kind:'tool', id:'tool', state:'running', target:'test' });
  const unchanged = line('one');
  assert.equal(unchanged.readRevision, first.readRevision); assert.equal(unchanged.updatedAt, first.updatedAt);
  s.store.writeText(p, 'works/one/work-1.md', '# Work 1\n\n## Result\n\nNew result\n\n## Now\n\nHeartbeat');
  const result = line('one'); assert.notEqual(result.readRevision, first.readRevision);
  s.store.writeText(p, 'works/one/work-1.md', '# Work 1\n\n## Result\n\nNew result\n\n## Now\n\nAnother heartbeat');
  assert.equal(line('one').readRevision, result.readRevision); assert.equal(line('one').updatedAt, result.updatedAt);
  s.close();
  const again = new Service({ directory:s.directory, agents, autoWatch:false });
  t.after(() => again.close());
  assert.equal(again.stateOf(p).lines.find(l => l.id === 'one').updatedAt, result.updatedAt);
});
test('delete requires confirmation and inactivity; takes its Works and files with it and blocks reimport across restart', async t => {
  const { service:s, project:p, line, directory } = setup(t);
  const rec = s.conversations.recordOf('codex', 'session-a', { projectId:p.id, slug:'one', active:false });
  s.store.writeText(p, 'works/one/work-1.md', '# Detail\n');
  s.store.writeText(p, 'files/one/shared.md', '# Shared artifact\n');
  const payload = () => ({ confirm:'one', baseHash:line('one').topicHash });
  await assert.rejects(s.act(p, 'one', 'delete', { baseHash:line('one').topicHash }), { code:'CONFIRM_DELETE' });
  s.live.set(s.key(p, 'one'), new Map([['x', { agent:'codex' }]]));
  await assert.rejects(s.act(p, 'one', 'delete', payload()), { code:'BUSY' }); s.live.clear();
  const deleted = await s.act(p, 'one', 'delete', payload());
  assert.ok(fs.existsSync(deleted.recoveryPath)); assert.equal(line('one'), undefined);
  // Its Works and its files go with it, kept beside it in the trash until it is restored or a week has passed.
  assert.ok(!s.store.exists(p, 'works/one/work-1.md')); assert.ok(!s.store.exists(p, 'files/one/shared.md'));
  assert.ok(fs.existsSync(path.join(deleted.recoveryPath, 'works/one/work-1.md'))); assert.ok(fs.existsSync(path.join(deleted.recoveryPath, 'files/one/shared.md')));
  await s.conversationChanges(p, rec, [{ me:'Continue the old request' }, { said:'Old reply' }]);
  assert.equal(s.isLine(p, 'one'), false); assert.equal(s.live.size, 0);
  assert.throws(() => s.store.writeText(p, 'lines/one.md', '# Restored without consent'), { code:'DELETED' });
  assert.throws(() => s.store.writeText(p, 'lines/./one.md', '# Alias'), { code:'DELETED' });
  const next = await s.createTopic(p, { text:'one', title:'one', start:false }); assert.notEqual(next.slug, 'one');
  s.close(); const again = new Service({ directory, agents, autoWatch:false }); t.after(() => again.close());
  assert.equal(again.isLine(p, 'one'), false);
  delete again.conversations.records['codex:session-a'];
  const recovered = again.conversations.recordOf('codex', 'session-a'); assert.equal(recovered.slug, 'one');
  await again.conversationChanges(p, recovered, [{ me:'Old message' }]); assert.equal(again.isLine(p, 'one'), false);
  await again.conversationChanges(p, recovered, [{ me:`New request\n\nRead this first, it has the whole story: ${path.join(p.docsPath, 'lines/two.md')}` }]);
  assert.equal(recovered.slug, 'two'); assert.ok(again.readDoc(p, 'two').includes('New request'));
});
test('failed move rolls back; interrupted final manifest reconciles from files on restart', async t => {
  const { service:s, project:p, line, directory } = setup(t);
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { if (from === fs.realpathSync(path.join(p.docsPath, 'lines/one.md'))) throw Error('disk'); return rename(from, to); };
  try { await assert.rejects(s.act(p, 'one', 'delete', { confirm:'one', baseHash:line('one').topicHash }), { code:'DELETE_FAILED' }); } finally { fs.renameSync = rename; }
  assert.ok(s.isLine(p, 'one')); assert.equal(s.store.isDeleted(p, 'one'), false);
  const save = s.store.saveDeleted.bind(s.store); let calls = 0;
  s.store.saveDeleted = () => { if (++calls === 2) throw Error('final write'); return save(); };
  const result = await s.act(p, 'one', 'delete', { confirm:'one', baseHash:line('one').topicHash });
  assert.ok(result.warning); assert.ok(fs.existsSync(result.recoveryPath));
  const restored = new Store({ directory }); assert.equal(restored.deleted[`${p.id}:one`].phase, 'completed');
});
test('folder open uses native argv without a shell on macOS, Windows and Linux', async t => {
  const { project:p } = setup(t), calls = [];
  for (const [platform, name] of [['darwin','open'], ['win32','explorer.exe'], ['linux','xdg-open']]) {
    const folder = platform === 'win32' ? 'C:\\Users\\A Person\\Docs & Notes' : '/home/A Person/Docs & Notes';
    assert.deepEqual(folderCommand(platform, folder), [name, [folder]]);
    const opener = createFolderOpener({ platform, run:(cmd,args,options,done) => { calls.push({ cmd,args,options }); done(null); } });
    await opener.open(p.docsPath); assert.equal(calls.at(-1).options.shell, undefined); assert.equal(calls.at(-1).args[0], p.docsPath);
    await assert.rejects(opener.open(path.join(p.docsPath, 'missing')), { code:'NOT_FOUND' });
  }
});
test('file reveal uses native Finder/Explorer/Linux commands, labels and handles Windows explorer exit code 1', async t => {
  const { project:p } = setup(t), calls = [];
  const sample = path.join(p.docsPath, 'files', 'note & draft.md');
  fs.mkdirSync(path.dirname(sample), { recursive:true });
  fs.writeFileSync(sample, '# Draft\n');
  assert.deepEqual(revealCommand('darwin', '/tmp/A Folder/a.md'), ['open', ['-R', '/tmp/A Folder/a.md']]);
  assert.deepEqual(revealCommand('win32', 'C:/Users/A Person/a.md'), ['explorer.exe', ['/select,', 'C:\\Users\\A Person\\a.md']]);
  assert.deepEqual(revealCommand('linux', '/home/a/docs/a.md'), ['xdg-open', ['/home/a/docs']]);
  for (const [platform, expectedLabel, expectedCmd] of [
    ['darwin', 'Reveal in Finder', 'open'],
    ['win32', 'Show in File Explorer', 'explorer.exe'],
    ['linux', 'Show in folder', 'xdg-open'],
  ]) {
    const opener = createFolderOpener({ platform, run:(cmd,args,options,done) => {
      calls.push({ cmd, args, options });
      done(platform === 'win32' ? Object.assign(new Error('exit 1'), { code:1, killed:false, signal:null }) : null);
    } });
    assert.equal(opener.revealLabel, expectedLabel);
    await opener.reveal(sample);
    assert.equal(calls.at(-1).cmd, expectedCmd);
    assert.equal(calls.at(-1).options.shell, undefined);
    if (platform === 'darwin') assert.deepEqual(calls.at(-1).args, ['-R', sample]);
    if (platform === 'win32') assert.deepEqual(calls.at(-1).args, ['/select,', sample.replace(/\//g, '\\')]);
    if (platform === 'linux') assert.deepEqual(calls.at(-1).args, [path.dirname(sample)]);
    await assert.rejects(opener.reveal(path.join(p.docsPath, 'files', 'missing.md')), { code:'NOT_FOUND' });
  }
  // A genuine spawn failure on Windows still rejects.
  const broken = createFolderOpener({ platform:'win32', run:(_cmd,_args,_options,done) => done(Object.assign(new Error('missing'), { code:'ENOENT' })) });
  await assert.rejects(broken.reveal(sample), { code:'OPEN_FAILED' });
});
test('files/reveal only runs on this computer and stays inside the project docs folder', async t => {
  const { directory, project:p } = setup(t); let here = false; const revealed = [];
  const rel = 'files/one/README-redesign.md', full = path.join(p.docsPath, rel);
  fs.mkdirSync(path.dirname(full), { recursive:true });
  fs.writeFileSync(full, '# Hello\n');
  const api = createProjectLines({
    directory, agents, serviceOptions:{ autoWatch:false }, isThisComputer:() => here,
    folderOpener:{ label:'Open folder in Finder', revealLabel:'Reveal in Finder', open:async () => ({ ok:true }), reveal:async target => { revealed.push(target); return { ok:true }; } },
    authorizeRead:() => null, authorizeWrite:() => null,
    readJson:async req => { let body=''; for await (const chunk of req) body+=chunk; return JSON.parse(body || '{}'); },
    send:(res,status,data) => { res.writeHead(status, { 'content-type':'application/json' }); res.end(JSON.stringify(data)); },
  });
  const server = http.createServer((req,res) => api.handle(req,res,new URL(req.url,'http://localhost')));
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  t.after(async () => { api.close(); await new Promise(r => server.close(r)); });
  const base = `http://127.0.0.1:${server.address().port}/api/lines`;
  const reveal = pth => fetch(`${base}/projects/${p.id}/files/reveal`, { method:'POST', body:JSON.stringify({ path:pth }) });
  assert.equal((await (await fetch(base+'/agents')).json()).revealFileLabel, '');
  assert.equal((await reveal(rel)).status, 403); assert.equal(revealed.length, 0);
  here = true;
  assert.equal((await (await fetch(base+'/agents')).json()).revealFileLabel, 'Reveal in Finder');
  assert.equal((await reveal('../outside.md')).status, 400);
  assert.equal((await reveal('/etc/passwd')).status, 400);
  assert.equal((await reveal('files/one/missing.md')).status, 404);
  assert.equal((await reveal(rel)).status, 200);
  assert.deepEqual(revealed, [fs.realpathSync(full)]);
});
test('remote clients cannot open folders or apps; local folder uses server-owned path', async t => {
  const { directory, project:p } = setup(t); let here = false; const opened = [];
  const api = createProjectLines({ directory, agents, serviceOptions:{ autoWatch:false }, isThisComputer:() => here, folderOpener:{ label:'Open folder', open:async folder => { opened.push(folder); return { ok:true }; } }, authorizeRead:() => null, authorizeWrite:() => null, readJson:async req => { let body=''; for await (const chunk of req) body+=chunk; return JSON.parse(body || '{}'); }, send:(res,status,data) => { res.writeHead(status, { 'content-type':'application/json' }); res.end(JSON.stringify(data)); } });
  const server = http.createServer((req,res) => api.handle(req,res,new URL(req.url,'http://localhost')));
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  t.after(async () => { api.close(); await new Promise(r => server.close(r)); });
  const base = `http://127.0.0.1:${server.address().port}/api/lines`;
  const post = verb => fetch(`${base}/projects/${p.id}/topics/one/${verb}`, { method:'POST', body:JSON.stringify({ path:'/ignored' }) });
  assert.equal((await (await fetch(base+'/agents')).json()).openFolderLabel, '');
  assert.equal((await post('open-folder')).status, 403); assert.equal((await post('open-desktop')).status, 403); assert.equal((await post('open-agent')).status, 403); assert.equal(opened.length, 0);
  here = true; assert.equal((await post('open-folder')).status, 200); assert.deepEqual(opened, [p.docsPath]);
});
test('a project opens its own folders by name, only on this computer, and remembers when it was archived', async t => {
  const { directory, project:p, root } = setup(t); let here = false; const opened = [];
  const api = createProjectLines({ directory, agents, serviceOptions:{ autoWatch:false }, isThisComputer:() => here, folderOpener:{ label:'Open folder', open:async folder => { opened.push(folder); return { ok:true }; } }, authorizeRead:() => null, authorizeWrite:() => null, readJson:async req => { let body=''; for await (const chunk of req) body+=chunk; return JSON.parse(body || '{}'); }, send:(res,status,data) => { res.writeHead(status, { 'content-type':'application/json' }); res.end(JSON.stringify(data)); } });
  const server = http.createServer((req,res) => api.handle(req,res,new URL(req.url,'http://localhost')));
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  t.after(async () => { api.close(); await new Promise(r => server.close(r)); });
  const base = `http://127.0.0.1:${server.address().port}/api/lines/projects/${p.id}`;
  const open = which => fetch(`${base}/open-folder`, { method:'POST', body:JSON.stringify({ which, path:'/ignored' }) });
  assert.equal((await open('docs')).status, 403); assert.equal(opened.length, 0);
  here = true;
  assert.equal((await open('docs')).status, 200);
  assert.equal((await open('code')).status, 404);
  const code = path.join(root, 'code'); fs.mkdirSync(code);
  assert.equal((await fetch(base, { method:'PATCH', body:JSON.stringify({ codePath:code }) })).status, 200);
  assert.equal((await open('code')).status, 200);
  assert.deepEqual(opened, [p.docsPath, code]);
  const summary = async () => (await (await fetch(`http://127.0.0.1:${server.address().port}/api/lines/projects`)).json()).projects.find(x => x.id === p.id);
  const state = async () => (await (await fetch(`${base}/state`)).json()).project;
  assert.ok((await state()).createdAt > 0); assert.equal((await summary()).archivedAt, 0);
  await fetch(base, { method:'PATCH', body:JSON.stringify({ archived:true }) });
  const at = (await summary()).archivedAt;
  assert.ok(at > 0); assert.equal((await state()).archivedAt, at); assert.equal((await summary()).archived, true);
  await fetch(base, { method:'PATCH', body:JSON.stringify({ archived:true }) });
  assert.equal((await summary()).archivedAt, at, 'archiving again keeps the first date');
  await fetch(base, { method:'PATCH', body:JSON.stringify({ archived:false }) });
  assert.equal((await summary()).archivedAt, 0); assert.equal((await summary()).archived, false);
});

test('pending deletions with conflicting paths stay blocked and expose the recovery paths', t => {
  const { service:s, project:p, directory } = setup(t);
  const recovery = '.trash/conflict.md'; s.store.writeText(p, recovery, '# Saved copy');
  s.store.deleted[`${p.id}:one`] = { projectId:p.id, slug:'one', phase:'pending', original:'lines/one.md', trash:recovery };
  s.store.saveDeleted();
  const restored = new Store({ directory });
  assert.equal(restored.deleted[`${p.id}:one`].phase, 'blocked');
  assert.ok(restored.deleted[`${p.id}:one`].error);
  assert.ok(restored.exists(p,'lines/one.md')); assert.ok(restored.exists(p,recovery));
  const again = new Service({ directory, agents, autoWatch:false }); t.after(()=>again.close());
  assert.equal(again.stateOf(p).deletionWarnings[0].recovery,recovery);
});
test('pasted without context into a conversation on another line, an Ask still reaches its own line', async t => {
  const { service:s, project:p } = setup(t);
  const unsent = await s.saveUnsent(p, { topic:'one', text:'Please rename the sidebar' });
  assert.ok(unsent);
  const rec = s.conversations.recordOf('codex', 'session-other', { projectId:p.id, slug:'two', active:false });
  await s.conversationChanges(p, rec, [{ me:'Something close to please rename the sidebar soon' }]);
  assert.equal(rec.slug, 'two', 'a near match leaves the conversation where it is');
  assert.ok(F.parseLine(s.readDoc(p, 'one')).steps.some(F.isUnsent));
  await s.conversationChanges(p, rec, [{ me:'Please rename the sidebar' }]);
  assert.equal(rec.slug, 'one', 'the exact words move it to the line whose Ask it is');
  const steps = F.parseLine(s.readDoc(p, 'one')).steps;
  assert.equal(steps.some(F.isUnsent), false, 'and that Ask is no longer waiting');
  assert.equal(steps.filter(x => x.kind === 'ask' && /rename the sidebar/.test(x.text)).length, 1);
  assert.ok(!s.readDoc(p, 'two').includes('Please rename the sidebar'));
});

const childGit = (dir, ...args) => require('node:child_process').execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', dir, ...args], { encoding:'utf8' });
test('quotes waiting in the box go on the Ask being pasted, once, and the copied words carry them', async t => {
  const { service:s, project:p } = setup(t);
  const { step } = await s.saveUnsent(p, { topic:'one', text:'Fix this please' });
  const first = await s.pasteUnsent(p, 'one', { step, context:true, refers:['work-1'] }, { local:false });
  assert.equal(first.referred, 1);
  assert.match(first.text, /^For context only, not a new request: this refers to Work 1 in .+one\.md[\s\S]*\n\nFix this please(?:\n\n|$)/);
  assert.deepEqual(F.parseLine(s.readDoc(p, 'one')).steps.find(x => x.id === step).refers.map(r => r.label), ['Work 1']);
  const again = await s.pasteUnsent(p, 'one', { step, context:true, refers:['work-1'] }, { local:false });
  assert.equal(F.parseLine(s.readDoc(p, 'one')).steps.find(x => x.id === step).refers.length, 1);
  assert.equal(again.text.match(/refers to Work 1/g).length, 1);
  const plain = await s.pasteUnsent(p, 'one', { step, context:true }, { local:false });
  assert.equal(plain.referred, 0);
  assert.equal(F.parseLine(s.readDoc(p, 'one')).steps.find(x => x.id === step).text, 'Fix this please');
});
test('a quote sits above an Ask\'s pictures, and an unknown one adds nothing', async t => {
  const { service:s, project:p } = setup(t);
  fs.mkdirSync(path.join(p.docsPath, 'files/_incoming'), { recursive:true });
  fs.writeFileSync(path.join(p.docsPath, 'files/_incoming/a.png'), 'x');
  const { step } = await s.saveUnsent(p, { topic:'one', text:'Look', attachments:[{ path:'files/_incoming/a.png', name:'a.png', type:'image/png' }] });
  assert.equal((await s.pasteUnsent(p, 'one', { step, context:true, refers:['work-99'] }, { local:false })).referred, 0);
  await s.pasteUnsent(p, 'one', { step, context:true, refers:['work-1'] }, { local:false });
  const ask = F.parseLine(s.readDoc(p, 'one')).steps.find(x => x.id === step);
  assert.ok(ask.body.indexOf('> Refers to') < ask.body.indexOf('![a.png]') && ask.body.indexOf('Look') < ask.body.indexOf('> Refers to'));
  assert.equal(ask.pictures.length, 1); assert.equal(ask.text, 'Look');
});
test('removing an Ask takes its attachments off the line, unless something else there shows them', async t => {
  const { service:s, project:p } = setup(t);
  fs.mkdirSync(path.join(p.docsPath, 'files/_incoming'), { recursive:true });
  fs.writeFileSync(path.join(p.docsPath, 'files/_incoming/gone.png'), 'x');
  const { step } = await s.saveUnsent(p, { topic:'one', text:'Words', attachments:[{ path:'files/_incoming/gone.png', name:'gone.png', type:'image/png' }] });
  assert.ok(fs.existsSync(path.join(p.docsPath, 'files/one/gone.png')));
  await s.act(p, 'one', 'drop-unsent', { step });
  assert.ok(!fs.existsSync(path.join(p.docsPath, 'files/one/gone.png')));
  assert.ok(fs.existsSync(path.join(p.docsPath, 'files/_incoming/gone.png')));
});
test('an older MEMORY.md gets its rules back: Landed rows go, people\'s own words stay, finishing writes nothing', async t => {
  const { service:s, project:p } = setup(t);
  await s.finish(p, 'one');
  assert.doesNotMatch(s.store.readText(p, 'MEMORY.md').text, /topics\/one\.md/);
  const old = ['---', 'project: Actions', '---', '', '# Project memory', '', 'What every agent on this project should know.', '', '## What matters', '', '- hi', '', '## Decisions', '', 'Nothing recorded yet.', '', '## Landed', '', '- PE-1 One: [one.md](topics/one.md)', '- Something I wrote myself', ''].join('\n');
  s.store.writeText(p, 'MEMORY.md', old);
  s.sync(p);
  const now = s.store.readText(p, 'MEMORY.md').text, M = require('../src/server/project-lines/memory.js'), parsed = M.parse(now);
  assert.match(now, /## Keeping this file/);
  assert.doesNotMatch(now, /## Landed|topics\/one\.md/);
  assert.deepEqual(parsed.sections.Decisions, ['hi', 'Something I wrote myself']);
  s.sync(p);
  assert.equal(s.store.readText(p, 'MEMORY.md').text, now);
});
test('the Memory page lists what agents saved and the project\'s files, on this computer only', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'line-memory-')), home = path.join(root, 'home'), code = path.join(root, 'code'), docs = path.join(root, 'docs');
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  fs.mkdirSync(code); childGit(code, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(code, 'AGENTS.md'), '# Rules\n'); fs.writeFileSync(path.join(code, 'a.txt'), '1'); childGit(code, 'add', '.'); childGit(code, 'commit', '-qm', 'one');
  childGit(code, 'checkout', '-qb', 'feature'); fs.mkdirSync(path.join(code, 'docs')); fs.writeFileSync(path.join(code, 'docs/spec.md'), '# Spec\n'); fs.writeFileSync(path.join(code, 'b.js'), '1'); childGit(code, 'add', '.'); childGit(code, 'commit', '-qm', 'two'); childGit(code, 'checkout', '-q', 'main');
  const claude = path.join(home, '.claude/projects', code.replace(/[^a-zA-Z0-9]/g, '-'), 'memory');
  fs.mkdirSync(claude, { recursive:true });
  fs.writeFileSync(path.join(claude, 'MEMORY.md'), '- [Nice title](a-note.md) — the short hook\n');
  fs.writeFileSync(path.join(claude, 'a-note.md'), '---\nname: a-note\ndescription: from the front\n---\n\nThe note body\n');
  fs.writeFileSync(path.join(claude, 'not-listed.md'), '---\nname: not-listed\ndescription: only in its own file\n---\n\nOther body\n');
  fs.mkdirSync(path.join(home, '.claude/projects/-other/memory'), { recursive:true }); fs.writeFileSync(path.join(home, '.claude/projects/-other/memory/secret.md'), 'Another project');
  fs.mkdirSync(path.join(home, '.codex/memories'), { recursive:true });
  fs.writeFileSync(path.join(home, '.codex/memories/MEMORY.md'), `# Task Group: This project\n\nscope: What it found\napplies_to: cwd=${code} with others\n\n## Task 1\n\nBody here\n\n# Task Group: Elsewhere\n\nscope: Not this\napplies_to: cwd=${code}-other\n\n# Task Group: Inside a worktree\n\nscope: Below it\napplies_to: cwd=${code}/.claude/worktrees/x\n`);
  let here = true;
  const api = createProjectLines({ directory:path.join(root, 'state'), agents, serviceOptions:{ autoWatch:false, memory:{ home, env:{} } }, isThisComputer:() => here, authorizeRead:() => null, authorizeWrite:() => null, readJson:async req => { let body=''; for await (const chunk of req) body+=chunk; return JSON.parse(body || '{}'); }, send:(res,status,data) => { res.writeHead(status, { 'content-type':'application/json' }); res.end(JSON.stringify(data)); return true; } });
  const s = api.service, p = s.store.create({ name:'Memory', docsPath:docs, codePath:code }); p.follow = false; p.offerSkill = false; s.store.save();
  s.writeDoc(p, 'open', F.initialLine({ title:'Open', status:'done', branch:'feature', base:'main', steps:[F.askStep({ words:'Hi' })] }));
  s.writeDoc(p, 'shelved', F.initialLine({ title:'Archived', status:'closed', branch:'feature-old', base:'main', steps:[F.askStep({ words:'Hi' })] }));
  s.sync(p);
  const server = http.createServer((req,res) => api.handle(req,res,new URL(req.url,'http://localhost')));
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  t.after(async () => { api.close(); await new Promise(r => server.close(r)); });
  const base = `http://127.0.0.1:${server.address().port}/api/lines/projects/${p.id}/memory`, get = async q => { const r = await fetch(base + q); return { status:r.status, body:await r.json() }; };
  const { body:lists } = await get('');
  const cl = lists.agents.find(a => a.agent === 'claude'), cx = lists.agents.find(a => a.agent === 'codex');
  assert.deepEqual(cl.rows.map(r => r.name).sort(), ['Nice title', 'Not listed']);
  assert.equal(cl.rows.find(r => r.name === 'Nice title').about, 'the short hook');
  assert.equal(cl.rows.find(r => r.name === 'Not listed').about, 'only in its own file');
  assert.deepEqual(cx.rows.map(r => r.name), ['This project', 'Inside a worktree']);
  assert.deepEqual(lists.files.map(f => f.path), ['AGENTS.md', 'docs/spec.md']);
  assert.equal(lists.files[1].branch, 'feature'); assert.equal(lists.files[1].line, 'open');
  const note = cl.rows.find(r => r.name === 'Nice title'), read = (await get(`/read?agent=claude&id=${encodeURIComponent(note.id)}`)).body;
  assert.equal(read.name, 'Nice title'); assert.match(read.md, /The note body/); assert.doesNotMatch(read.md, /description:/);
  assert.match((await get(`/read?agent=codex&id=${encodeURIComponent(cx.rows[0].id)}`)).body.md, /Body here/);
  assert.match((await get('/read?file=AGENTS.md')).body.md, /Rules/);
  for (const q of ['/read?file=../secret.md', '/read?file=a.txt', '/read?agent=claude&id=-other%2Fsecret.md', `/read?agent=claude&id=${encodeURIComponent(note.id.replace('a-note', '../../-other/memory/secret'))}`, '/read?agent=pi&id=x']) assert.equal((await get(q)).status, 404, q);
  here = false;
  const remote = (await get('')).body;
  assert.deepEqual(remote.agents, []); assert.deepEqual(remote.files.map(f => f.path), ['docs/spec.md']);
  assert.equal((await get(`/read?agent=claude&id=${encodeURIComponent(note.id)}`)).status, 403);
  assert.equal((await get('/read?file=AGENTS.md')).status, 403);
});

// The first Paste button goes on to the agent's app only when that is certain.
function pasteOpening(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paste-opens-')), home = path.join(root, 'home'), code = path.join(root, 'code'), launched = [];
  fs.mkdirSync(path.join(home, '.claude', 'projects', '-elsewhere'), { recursive:true }); fs.mkdirSync(code);
  fs.writeFileSync(path.join(home, '.claude', 'projects', '-elsewhere', 'claude-here.jsonl'), '');
  const threads = { live:{ source:'vscode', path:'/h/.codex/sessions/2026/11/07/rollout-live.jsonl' }, fromCli:{ source:'cli', path:'/h/.codex/sessions/2026/11/07/rollout-cli.jsonl' }, archived:{ source:'vscode', path:'/h/.codex/archived_sessions/rollout-archived.jsonl' }, script:{ source:'exec', path:'/h/.codex/sessions/2026/11/07/rollout-exec.jsonl' }, helper:{ source:{ subagent:{ other:'guardian' } }, path:'/h/.codex/sessions/2026/11/07/rollout-helper.jsonl' } };
  const codex = { call:async (method, { threadId }) => { assert.equal(method, 'thread/read'); if (!threads[threadId]) throw new Error(`thread not loaded: ${threadId}`); return { thread:threads[threadId] }; } };
  const links = { available:() => [], terminal:() => '', nameOf:id => ({ claude:'Claude', codex:'Codex' })[id] || id, desktop:(id, session) => (id === 'pi' ? null : { command:'open', args:[`${id}://chat/${session}`] }), desktopNew:(id, folder) => (id === 'pi' ? null : { command:'open', args:[`${id}://new${folder}`] }) };
  const state = { refuse:false };
  const spawnFn = (command, args, options) => { launched.push({ command, url:args[0], cwd:options.cwd }); const child = new EventEmitter(); setImmediate(() => child.emit('close', state.refuse ? 1 : 0)); return child; };
  const directory = path.join(root, 'state'); fs.mkdirSync(directory);
  const service = new Service({ directory, agents:links, autoWatch:false, spawnFn, conversations:{ env:{}, home, codex } });
  const project = service.store.create({ name:'Paste', docsPath:path.join(root, 'Docs') });
  project.follow = false; project.codePaths = [code]; service.store.save();
  service.writeDoc(project, 'one', F.initialLine({ title:'One', status:'not-started', code, steps:[F.askStep({ words:'Please help' })] }));
  service.sync(project);
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { root, code, service, project, launched, state };
}
test('the first Paste button goes to the line\'s own conversation when it is still there', async t => {
  const { root, service:s, project:p, launched } = pasteOpening(t);
  s.remember(p, 'one', 'claude', 'claude-here', 'work', root);
  assert.deepEqual(await s.openForPaste(p, 'one', 'claude'), { opened:true, app:'Claude', fresh:false });
  assert.deepEqual(launched, [{ command:'open', url:'claude://chat/claude-here', cwd:root }]);
  for (const id of ['live', 'fromCli']) {
    s.remember(p, 'one', 'codex', id, 'work', root);
    assert.equal((await s.openForPaste(p, 'one', 'codex')).opened, true, id);
    assert.equal(launched.at(-1).url, `codex://chat/${id}`);
  }
});
test('a conversation that cannot be opened for certain only copies, and starts nothing new', async t => {
  const { root, service:s, project:p, launched, state } = pasteOpening(t);
  s.remember(p, 'one', 'claude', 'claude-gone', 'work', root);
  assert.deepEqual(await s.openForPaste(p, 'one', 'claude'), { opened:false }, 'its transcript is gone');
  s.remember(p, 'one', 'claude', 'claude-here', 'work', path.join(root, 'deleted-worktree'));
  assert.deepEqual(await s.openForPaste(p, 'one', 'claude'), { opened:false }, 'its folder is gone');
  for (const id of ['archived', 'script', 'helper', 'missing']) {
    s.remember(p, 'one', 'codex', id, 'work', root);
    assert.deepEqual(await s.openForPaste(p, 'one', 'codex'), { opened:false }, id);
  }
  s.remember(p, 'one', 'pi', 'pi-1', 'work', root);
  assert.deepEqual(await s.openForPaste(p, 'one', 'pi'), { opened:false }, 'no app to open');
  assert.deepEqual(launched, []);
  s.remember(p, 'one', 'claude', 'claude-here', 'work', root); state.refuse = true;
  assert.deepEqual(await s.openForPaste(p, 'one', 'claude'), { opened:false }, 'the app did not open');
  state.refuse = false;
  s.runs.set(s.key(p, 'one'), { agent:'claude', stepId:'work-1' });
  assert.deepEqual(await s.openForPaste(p, 'one', 'claude'), { opened:false }, 'a running line does not open its busy session');
  s.runs.delete(s.key(p, 'one'));
});
test('a new line starts a new conversation in the project\'s folder, with the agent you chose', async t => {
  const { root, code, service:s, project:p, launched } = pasteOpening(t);
  assert.deepEqual(await s.openForPaste(p, 'one', 'codex'), { opened:true, app:'Codex', fresh:true });
  assert.deepEqual(launched, [{ command:'open', url:`codex://new${code}`, cwd:code }]);
  s.remember(p, 'one', 'claude', 'claude-here', 'work', root);
  assert.equal((await s.openForPaste(p, 'one', 'codex')).fresh, true, 'a conversation with another agent is not this agent\'s');
  assert.deepEqual(await s.openForPaste(p, 'one', 'pi'), { opened:false }, 'an agent with no app only copies');
  p.codePaths = [path.join(root, 'moved-away')]; launched.length = 0;
  assert.deepEqual(await s.openForPaste(p, 'one', 'codex'), { opened:false }, 'a folder that is gone only copies');
  assert.deepEqual(launched, []);
  p.codePaths = [];
  assert.equal((await s.openForPaste(p, 'one', 'codex')).opened, true);
  assert.equal(launched.at(-1).url, `codex://new${p.docsPath}`, 'a project with no code opens on its docs folder');
});
test('an app counts only when it is really the one that answers the links', { skip:process.platform !== 'darwin' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paste-apps-')), bin = path.join(root, 'bin'), apps = path.join(root, 'Applications');
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  fs.mkdirSync(bin); for (const name of ['claude', 'codex', 'opencode']) fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n', { mode:0o755 });
  const install = (name, bundle, version) => { const dir = path.join(apps, `${name}.app`, 'Contents'); fs.mkdirSync(dir, { recursive:true }); fs.writeFileSync(path.join(dir, 'Info.plist'), `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key>\n\t<string>${bundle}</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`); };
  const agents = createAgents({ env:{ PATH:bin, HOME:root }, appFolders:[apps] }), opens = () => { agents.reset(); return Object.fromEntries(agents.available().map(a => [a.id, a.opens])); };
  const urls = () => [agents.desktop('claude', 's1')?.args[0], agents.desktopNew('claude', '/a b')?.args[0], agents.desktop('codex', 't1')?.args[0], agents.desktopNew('codex', '/a b')?.args[0]];
  assert.deepEqual(opens(), { claude:false, codex:false, opencode:false, pi:false, omp:false, dsh:false, kimi:false, antigravity:false, penecho:false });
  assert.deepEqual(urls(), [undefined, undefined, undefined, undefined], 'no app, no link');
  install('ChatGPT', 'com.openai.chat', '26.1103.1'); agents.reset();
  assert.equal(agents.desktop('codex', 't1'), null, 'a plain ChatGPT knows nothing of codex://');
  install('ChatGPT', 'com.openai.codex', '26.900.1'); agents.reset();
  assert.equal(agents.desktop('codex', 't1')?.args[0], 'codex://threads/t1', 'an older Codex still opens a thread');
  assert.equal(agents.desktopNew('codex', '/a b'), null, 'but cannot be relied on to start one in a folder');
  assert.equal(opens().codex, false);
  install('ChatGPT', 'com.openai.codex', '26.1103.31037'); install('Claude', 'com.anthropic.claudefordesktop', '1.0.0'); agents.reset();
  assert.equal(agents.desktop('claude', 's1'), null, 'older than the links need');
  install('Claude', 'com.anthropic.claudefordesktop', '4.16336.0');
  assert.deepEqual(opens(), { claude:true, codex:true, opencode:false, pi:false, omp:false, dsh:false, kimi:false, antigravity:false, penecho:false });
  assert.equal(agents.terminal('opencode', 'ses_1'), 'opencode --session ses_1', 'with no app, the command on the PATH');
  assert.equal(agents.terminalLine('opencode', 'ses_1'), '', 'and nothing to open a window with');
  install('OpenCode', 'ai.opencode.desktop', '2.2.4'); fs.mkdirSync(path.join(apps, 'OpenCode.app', 'Contents', 'Resources')); const program = path.join(apps, 'OpenCode.app', 'Contents', 'Resources', 'opencode-cli'); fs.writeFileSync(program, '');
  assert.equal(opens().opencode, false, 'older than what was tested');
  install('OpenCode', 'ai.opencode.desktop', '2.2.5');
  assert.equal(opens().opencode, true);
  assert.equal(agents.available().find(a => a.id === 'opencode').opensIn, 'Terminal');
  assert.equal(agents.desktop('opencode', 'ses_1'), null, 'its app takes no links');
  assert.equal(agents.terminalLine('opencode', 'ses_1'), `${program} --session ses_1`);
  assert.equal(agents.terminalLine('opencode'), program, 'with no conversation, a new one');
  assert.equal(agents.terminal('opencode', 'ses_1'), `${program} --session ses_1`, 'the command it shows is one that knows what the app holds');
  assert.equal(agents.openApp('opencode'), null, 'a list made for a test never asks which apps are open');
  const asked = [], open = createAgents({ env:{ PATH:bin, HOME:root }, appFolders:[apps], isRunning:bundle => { asked.push(bundle); return true; } });
  assert.deepEqual(open.openApp('opencode'), { command:'open', args:['-a', path.join(apps, 'OpenCode.app')], app:'OpenCode', picks:true }, 'while its app is open, the app comes forward');
  assert.deepEqual(asked, ['ai.opencode.desktop']);
  assert.equal(open.available().find(a => a.id === 'opencode').opensIn, 'app');
  assert.equal(open.openApp('claude'), null, 'an app that takes links is sent to the conversation instead');
  assert.equal(open.openApp('dsh'), null);
  assert.equal(agents.terminalLine('pi', 'abc'), '', 'Pi has no app to take a program from');
  assert.equal(agents.terminalLine('dsh', 'abc'), '', 'dsh neither, and its app takes no link to a conversation');
  assert.deepEqual(urls(), ['claude://resume?session=s1', 'claude://code/new?folder=%2Fa%20b', 'codex://threads/t1', 'codex://threads/new?path=%2Fa%20b']);
});

test('OpenCode, whose app takes no links, opens in a terminal only for a conversation its app holds', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paste-opencode-')), data = path.join(root, 'data', 'opencode'), code = path.join(root, 'my code'), launched = [], directory = path.join(root, 'state');
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  for (const dir of [data, code, directory]) fs.mkdirSync(dir, { recursive:true });
  const db = new (require('node:sqlite').DatabaseSync)(path.join(data, 'opencode.db'));
  db.exec('create table session_v2 (id text, directory text, parent_id text, time_archived integer, time_updated integer); create table session_message (id text, session_id text, type text, seq integer, time_created integer, time_updated integer, data text); create table session (id text); create table message (id text); create table part (id text);');
  for (const [id, parent, archived] of [['ses_live', null, null], ['ses_archived', null, 5], ['ses_helper', 'ses_live', null]]) db.prepare('insert into session_v2 (id, directory, parent_id, time_archived) values (?, ?, ?, ?)').run(id, code, parent, archived);
  db.prepare('insert into session (id) values (?)').run('ses_older'); db.close();
  const links = { available:() => [], terminal:() => '', nameOf:() => 'OpenCode', desktop:() => null, desktopNew:() => null, terminalLine:(id, session = '') => (id !== 'opencode' ? '' : session ? `/app/opencode-cli --session ${session}` : '/app/opencode-cli') };
  const state = { refuse:false };
  const spawnFn = (command, args) => { launched.push({ command, args, script:fs.readFileSync(args[2], 'utf8') }); const child = new EventEmitter(); setImmediate(() => child.emit('close', state.refuse ? 1 : 0)); return child; };
  const service = new Service({ directory, agents:links, autoWatch:false, spawnFn, conversations:{ env:{ XDG_DATA_HOME:path.join(root, 'data') }, home:path.join(root, 'home') } });
  t.after(() => service.close());
  const project = service.store.create({ name:'Paste', docsPath:path.join(root, 'Docs') });
  project.follow = false; project.codePaths = [code]; service.store.save();
  service.writeDoc(project, 'one', F.initialLine({ title:'One', status:'not-started', code, steps:[F.askStep({ words:'Please help' })] })); service.sync(project);
  const leftovers = () => fs.readdirSync(directory).filter(name => name.endsWith('.command'));
  service.remember(project, 'one', 'opencode', 'ses_live', 'work', code);
  assert.deepEqual(await service.openForPaste(project, 'one', 'opencode'), { opened:true, app:'Terminal', fresh:false });
  assert.deepEqual(launched[0].args.slice(0, 2), ['-a', 'Terminal']);
  assert.match(launched[0].args[2], /\.command$/);
  assert.equal(launched[0].script, `#!/bin/sh\nrm -f "$0"\ncd '${code}' && exec /app/opencode-cli --session ses_live\n`, 'in its own folder, and it removes itself');
  assert.ok((fs.statSync(launched[0].args[2]).mode & 0o111) !== 0, 'Terminal can run it');
  for (const file of leftovers()) fs.rmSync(path.join(directory, file));
  launched.length = 0;
  for (const id of ['ses_archived', 'ses_helper', 'ses_older', 'ses_missing']) {
    service.remember(project, 'one', 'opencode', id, 'work', code);
    assert.deepEqual(await service.openForPaste(project, 'one', 'opencode'), { opened:false }, id);
  }
  service.remember(project, 'one', 'opencode', 'ses_live', 'work', path.join(root, 'moved-away'));
  assert.deepEqual(await service.openForPaste(project, 'one', 'opencode'), { opened:false }, 'its folder is gone');
  assert.deepEqual(launched, []); assert.deepEqual(leftovers(), []);
  service.forgetSession(project, 'one', 'opencode');
  assert.deepEqual(await service.openForPaste(project, 'one', 'opencode'), { opened:true, app:'Terminal', fresh:true }, 'a new line starts a new conversation');
  assert.equal(launched[0].script, `#!/bin/sh\nrm -f "$0"\ncd '${code}' && exec /app/opencode-cli\n`, 'in the line\'s folder');
  for (const file of leftovers()) fs.rmSync(path.join(directory, file));
  state.refuse = true;
  assert.deepEqual(await service.openForPaste(project, 'one', 'opencode'), { opened:false }, 'Terminal did not open');
  assert.deepEqual(leftovers(), [], 'and nothing is left behind');
  assert.deepEqual(await service.openForPaste(project, 'one', 'dsh'), { opened:false }, 'dsh only copies');
});

test('OpenCode\'s app comes forward while it is open, named with the conversation to pick there', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paste-opencode-app-')), data = path.join(root, 'data', 'opencode'), code = path.join(root, 'my code'), launched = [], directory = path.join(root, 'state');
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  for (const dir of [data, code, directory]) fs.mkdirSync(dir, { recursive:true });
  const db = new (require('node:sqlite').DatabaseSync)(path.join(data, 'opencode.db'));
  db.exec('create table session_v2 (id text, directory text, parent_id text, title text, time_archived integer, time_updated integer); create table session_message (id text, session_id text, type text, seq integer, time_created integer, time_updated integer, data text);');
  for (const [id, title] of [['ses_live', 'Fix the project name'], ['ses_untitled', null]]) db.prepare('insert into session_v2 (id, directory, title) values (?, ?, ?)').run(id, code, title);
  db.prepare('insert into session_v2 (id, directory, time_archived) values (?, ?, ?)').run('ses_archived', code, 5); db.close();
  const app = { open:true };
  const links = { available:() => [], terminal:() => '', nameOf:() => 'OpenCode', desktop:() => null, desktopNew:() => null, openApp:id => (id === 'opencode' && app.open ? { command:'open', args:['-a', '/Applications/OpenCode.app'], app:'OpenCode', picks:true } : null), terminalLine:(id, session = '') => (id !== 'opencode' ? '' : session ? `/app/opencode-cli --session ${session}` : '/app/opencode-cli') };
  const spawnFn = (command, args) => { launched.push({ command, args }); const child = new EventEmitter(); setImmediate(() => child.emit('close', 0)); return child; };
  const service = new Service({ directory, agents:links, autoWatch:false, spawnFn, conversations:{ env:{ XDG_DATA_HOME:path.join(root, 'data') }, home:path.join(root, 'home') } });
  t.after(() => service.close());
  const project = service.store.create({ name:'Paste', docsPath:path.join(root, 'Docs') });
  project.follow = false; project.codePaths = [code]; service.store.save();
  service.writeDoc(project, 'one', F.initialLine({ title:'One', status:'not-started', code, steps:[F.askStep({ words:'Please help' })] })); service.sync(project);
  const commands = () => fs.readdirSync(directory).filter(name => name.endsWith('.command'));
  service.remember(project, 'one', 'opencode', 'ses_live', 'work', code);
  assert.deepEqual(await service.openForPaste(project, 'one', 'opencode'), { opened:true, app:'OpenCode', fresh:false, pick:true, title:'Fix the project name' });
  assert.deepEqual(launched.at(-1).args, ['-a', '/Applications/OpenCode.app'], 'the app, not a terminal');
  assert.deepEqual(commands(), [], 'and no terminal file is written');
  service.remember(project, 'one', 'opencode', 'ses_untitled', 'work', code);
  assert.deepEqual(await service.openForPaste(project, 'one', 'opencode'), { opened:true, app:'OpenCode', fresh:false, pick:true }, 'a conversation with no title yet');
  launched.length = 0;
  service.remember(project, 'one', 'opencode', 'ses_archived', 'work', code);
  assert.deepEqual(await service.openForPaste(project, 'one', 'opencode'), { opened:false }, 'a conversation its app no longer holds still only copies');
  assert.deepEqual(launched, []);
  service.forgetSession(project, 'one', 'opencode');
  assert.deepEqual(await service.openForPaste(project, 'one', 'opencode'), { opened:true, app:'OpenCode', fresh:true, pick:true, folder:'my code' }, 'a new line starts its conversation in the app, in the folder the hint names');
  app.open = false;
  assert.deepEqual(await service.openForPaste(project, 'one', 'opencode'), { opened:true, app:'Terminal', fresh:true }, 'with its app closed, a terminal');
  for (const file of commands()) fs.rmSync(path.join(directory, file));
});

test('Stop in the app targets the selected live conversation, including concurrent Works with one agent', async t => {
  const { service:s, project:p } = setup(t), opened = [];
  s.agents = { ...agents, appOnly:(agent, id) => ({ app:'Antigravity', args:[id] }) };
  s.runDesktop = async command => { opened.push(command.args[0]); };
  const live = new Map(['first', 'second'].map((id, i) => [id, { sessionId:id, stepId:'work-' + (i + 1), agent:'antigravity' }]));
  s.live.set(s.key(p, 'one'), live);
  s.writeDoc(p, 'one', F.initialLine({ title:'Followed conversations', status:'working', steps:[
    F.askStep({ words:'Please help' }), F.workStep({ who:'antigravity' }), F.workStep({ who:'antigravity' }),
  ] }));
  const line = s.stateOf(p).lines.find(row => row.slug === 'one');
  for (const id of ['work-1', 'work-2']) {
    const work = line.stations.find(step => step.id === id);
    assert.equal(work.state, 'active');
    assert.deepEqual(work.stopIn, { agent:'antigravity', app:'Antigravity', terminal:false });
  }
  await s.openConversation(p, 'one', 'antigravity', 'work-1', true);
  await s.openConversation(p, 'one', 'antigravity', 'work-2', true);
  live.delete('first');
  await assert.rejects(s.openConversation(p, 'one', 'antigravity', 'work-1', true), { code:'NOT_RUNNING' });
  assert.deepEqual(opened, ['first', 'second']);
});
