"use strict";
require('./helpers/safety.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Service } = require('../src/server/project-lines/service.js');
const { createAgents } = require('../src/server/project-lines/agents.js');
const F = require('../src/server/project-lines/format.js');

function setup(t, agents = { available:() => [], desktop:() => null, terminal:() => '' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'line-files-'));
  const directory = path.join(root, 'state'); fs.mkdirSync(directory);
  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:'Files', docsPath:path.join(root, 'Docs') });
  project.follow = false; service.store.save();
  service.writeDoc(project, 'one', F.initialLine({ title:'one', status:'done', steps:[F.askStep({ words:'Please help' }), { ...F.workStep({ who:'dsh' }), done:true, out:'Done' }] }));
  service.sync(project);
  const downloads = path.join(root, 'Downloads'); fs.mkdirSync(downloads);
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { root, service, project, downloads, line:slug => service.stateOf(project).lines.find(l => l.id === slug) };
}

test('a message names its attached files the way Claude Code and dsh write them', () => {
  assert.deepEqual(F.mentionedFiles('@"/Users/me/Downloads/PenEcho Lines v1.html" 这个是原始文件'), ['/Users/me/Downloads/PenEcho Lines v1.html']);
  assert.deepEqual(F.mentionedFiles('see @/tmp/a.mp4, then @~/b.pdf.'), ['/tmp/a.mp4', '~/b.pdf']);
  assert.deepEqual(F.mentionedFiles('@src/main.js and me@example.com'), [], 'a relative path is the code, and an address is not a file');
});

test('a file attached in another app is kept with the Ask, to open, and the words stay as they were sent', async t => {
  const { service:s, project:p, downloads, line } = setup(t), html = path.join(downloads, 'PenEcho Lines v1.html');
  fs.writeFileSync(html, '<h1>Lines</h1>'); fs.mkdirSync(path.join(downloads, 'a folder'));
  const rec = s.conversations.recordOf('dsh', 'session-1', { projectId:p.id, slug:'one', active:false });
  const words = `@"${html}" 这个是原始文件 @"${path.join(downloads, 'a folder')}" @"${path.join(downloads, 'gone.pdf')}"`;
  await s.conversationChanges(p, rec, [{ me:words, at:Date.now() }]);
  const ask = F.parseLine(s.readDoc(p, 'one')).asks.at(-1);
  assert.equal(ask.text, words, 'their words are untouched');
  assert.deepEqual(ask.files.map(f => [f.name, f.href]), [['PenEcho Lines v1.html', '../files/one/PenEcho-Lines-v1.html']], 'only the file that is there, with no spaces in its link');
  assert.equal(fs.readFileSync(path.join(p.docsPath, 'files/one/PenEcho-Lines-v1.html'), 'utf8'), '<h1>Lines</h1>');
  const station = line('one').stations.find(x => x.kind === 'ask' && x.text === words);
  assert.deepEqual(station.files, [{ name:'PenEcho Lines v1.html', path:'files/one/PenEcho-Lines-v1.html', image:false }], 'the page gets it as a file to open');
});

test('a file-only message from another app starts its line with the file', async t => {
  const { service:s, project:p, downloads } = setup(t), pdf = path.join(downloads, 'plan.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4');
  const rec = s.conversations.recordOf('codex', 'thread-1', { projectId:p.id, active:false });
  await s.conversationChanges(p, rec, [{ me:'', files:[pdf], at:Date.now() }]);
  const ask = F.parseLine(s.readDoc(p, rec.slug)).asks[0];
  assert.equal(ask.text, 'See the file.');
  assert.deepEqual(ask.files.map(f => f.name), ['plan.pdf']);
});

test('Asks that named a file before such files were kept get it once', async t => {
  const { service:s, project:p, downloads } = setup(t), video = path.join(downloads, 'clip.mp4');
  fs.writeFileSync(video, 'mp4');
  const md = F.updateSteps(s.readDoc(p, 'one'), steps => { steps.push(F.askStep({ words:`@"${video}"` })); });
  s.writeDoc(p, 'one', md);
  s.fillMentionedFiles(p);
  s.mentionsFilled.clear(); s.fillMentionedFiles(p);
  const ask = F.parseLine(s.readDoc(p, 'one')).asks.at(-1);
  assert.deepEqual(ask.files.map(f => f.href), ['../files/one/clip.mp4'], 'once, however often it is looked at');
  assert.equal(ask.text, `@"${video}"`);
});

test('dsh shows with the line and opens its own app, which cannot be sent to one conversation', { skip:process.platform !== 'darwin' }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-app-')), apps = path.join(root, 'Applications');
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const agents = createAgents({ env:{ PATH:path.join(root, 'bin'), HOME:root }, appFolders:[apps] });
  assert.equal(agents.appOnly('dsh'), null, 'no app, nothing to open');
  const dir = path.join(apps, 'DeepSeek Harness.app', 'Contents'); fs.mkdirSync(dir, { recursive:true });
  fs.writeFileSync(path.join(dir, 'Info.plist'), '<plist><dict><key>CFBundleIdentifier</key><string>com.deepseek.dsh</string><key>CFBundleShortVersionString</key><string>0.2.2-rc.1</string></dict></plist>');
  agents.reset();
  assert.deepEqual(agents.appOnly('dsh'), { command:'open', args:['dsh://open'], app:'DeepSeek Harness' });
  assert.equal(agents.desktop('dsh', 'session-1'), null, 'never as if it went to that conversation');
  assert.equal(agents.available().find(a => a.id === 'dsh').opens, false, 'so Paste still only copies');

  const { service:s, project:p, line } = setup(t, agents), opened = [];
  s.runDesktop = async command => { opened.push(command.args[0]); };
  s.remember(p, 'one', 'dsh', 'session-1', 'work', p.docsPath);
  assert.deepEqual(line('one').conversations.dsh, { agent:'dsh', canOpen:false, app:'', opensApp:'DeepSeek Harness', terminal:'dsh web', terminalFull:`cd '${p.docsPath}' && dsh web` });
  await s.openConversation(p, 'one', 'dsh');
  assert.deepEqual(opened, ['dsh://open']);
});
