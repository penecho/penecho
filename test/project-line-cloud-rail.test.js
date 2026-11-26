'use strict';
require('./helpers/safety.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', 'lines', name), 'utf8');
const cloudSrc = read('cloud.js');
const hostedSrc = read('hosted.js');
const cssSrc = read('cloud.css');
const pagesSrc = read('pages.js');
const esc = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

function loadCloud({ now, projects, cloudProjects = [], hosted = null, hostedList = [] }) {
  const inserted = new Map(), requests = [];
  const makeRow = id => ({
    dataset: { p: id },
    querySelector: sel => sel === '.rail-name' ? {
      insertAdjacentHTML: (_pos, html) => inserted.set(id, html),
    } : null,
  });
  let afterHtml = '';
  const S = {
    cloudAccount: { signedIn: true, name: 'Heack', plan: 'plus' },
    cloudProjects: { projects: cloudProjects },
    cloudKept: {},
    projects,
  };
  const host = {
    querySelectorAll: () => S.projects.map(p => makeRow(p.id)),
    insertAdjacentHTML: (_pos, html) => { afterHtml += html; },
  };
  const FakeDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  const context = vm.createContext({
    Date: FakeDate, Math, Number, String, Boolean, Array, Object, Set, Map, JSON,
    ICONS: { cloud: '<path/>', warn: '<path/>', link: '<path/>' },
    S,
    HOSTED: hosted,
    ACT: {},
    $: () => null,
    $$: () => [],
    api: async url => { requests.push(url); return {}; },
    project: () => null,
    summaryOf: id => S.projects.find(p => p.id === id) || null,
    glyph: p => `<i>${esc(p.name[0])}</i>`,
    ic: name => `<svg data-ic="${name}"></svg>`,
    esc,
    cloudBar: () => {},
    renderRail: () => { context.railRendered = true; },
    addEventListener: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    document: { addEventListener: () => {}, removeEventListener: () => {} },
    location: { hash: '' },
  });
  const chunk = cloudSrc.slice(0, cloudSrc.indexOf("ACT['cloud-keep'] ="));
  vm.runInContext(chunk, context);
  S.cloudProjects = { projects: cloudProjects };
  if (hosted) {
    const hChunk = hostedSrc.slice(hostedSrc.indexOf('const hostedSyncedAt'), hostedSrc.indexOf('// ---------- Someone with a shared link'));
    context.hostedCall = async url => { requests.push(url); return { ok:true, json:async () => ({ projects:hostedList, shared:[] }) }; };
    context.cloudColor = context.cloudColor || (() => '#4f46e5');
    vm.runInContext(`${hChunk}\nthis.hostedSummary = hostedSummary; this.hostedProjects = hostedProjects;`, context);
  }
  return { context, S, inserted, requests, runRail: () => { afterHtml = ''; context.cloudRail(host); return { inserted, afterHtml }; } };
}

test('PE-611: cloud mark changes class to recent only when synced in the last 5 minutes, and stuck always wins', () => {
  const now = Date.UTC(2026, 10, 17, 16, 0, 0);
  const projects = [
    { id: 'fresh', name: 'Fresh', cloudSyncedAt: now - 2 * 60 * 1000 },
    { id: 'edge', name: 'Edge', cloudSyncedAt: now - 5 * 60 * 1000 },
    { id: 'stale', name: 'Stale', cloudSyncedAt: now - 5 * 60 * 1000 - 1 },
    { id: 'never', name: 'Never' },
    { id: 'stuck', name: 'Stuck', cloudSyncedAt: now - 10 * 1000, cloudNotice: { id: 'err:1', message: 'Too many files.' } },
  ];
  const cloudProjects = projects.map(p => ({ key: p.id, id: p.id, name: p.name, here: true, syncing: true }));
  cloudProjects.push({ key: 'away-1', name: 'Away', here: false });

  const ui = loadCloud({ now, projects, cloudProjects });
  const { inserted, afterHtml } = ui.runRail();

  assert.match(inserted.get('fresh'), /class="rail-cloud recent"/);
  assert.match(inserted.get('fresh'), /title="Kept in PenEcho Cloud · Synced 2 minutes ago"/);
  assert.match(inserted.get('edge'), /class="rail-cloud recent"/, 'exactly 5 minutes counts as within last 5 minutes');
  assert.equal(inserted.get('stale').includes('recent'), false, 'past 5 minutes returns to default color');
  assert.match(inserted.get('stale'), /title="Kept in PenEcho Cloud · Synced 5 minutes ago"/);
  assert.equal(inserted.get('never').includes('recent'), false);
  assert.match(inserted.get('never'), /title="Kept in PenEcho Cloud"/);
  assert.match(inserted.get('stuck'), /class="rail-cloud stuck"/);
  assert.equal(inserted.get('stuck').includes('recent'), false, 'stuck notice overrides recent');
  assert.equal(afterHtml.includes('rail-cloud recent'), false, 'Cloud-only rows stay neutral');

  // Toggling Keep in Cloud via keepSeen updates summary cloudSyncedAt immediately.
  ui.context.keepSeen({ id: 'never' }, { signedIn: true, sync: true, syncedAt: now - 1000 });
  assert.equal(projects.find(p => p.id === 'never').cloudSyncedAt, now - 1000);
  ui.context.keepSeen({ id: 'never' }, { signedIn: true, sync: false });
  assert.equal(projects.find(p => p.id === 'never').cloudSyncedAt, undefined);
});

test('PE-611: hosted rail carries computerSyncedAt and marks recent syncs within 5 minutes', async () => {
  const now = Date.UTC(2026, 10, 17, 16, 0, 0);
  const hosted = { key: 'proj-a', onComputer: true, shared: false, list: [], listAt: 0 };
  const hostedList = [
    { key: 'proj-a', name: 'Project A', computerSyncedAt: now - 60 * 1000 },
    { key: 'proj-b', name: 'Project B', computerSyncedAt: now - 8 * 60 * 1000 },
    { key: 'proj-c', name: 'Cloud Only', cloudMade: true, computerSyncedAt: now - 30 * 1000 },
  ];
  const ui = loadCloud({ now, projects: [], hosted, hostedList });
  const here = ui.context.hostedSummary({ project: { name: 'Project A' }, pictures: [], notes: [] });
  const all = await ui.context.hostedProjects(here);
  ui.S.projects = all;
  const { inserted } = ui.runRail();
  assert.match(inserted.get('proj-a'), /class="rail-cloud recent"/);
  assert.match(inserted.get('proj-a'), /title="Synced with your computer · 1 minute ago"/);
  assert.equal(inserted.get('proj-b').includes('recent'), false);
  assert.equal(inserted.has('proj-c'), false);
});

test('PE-611: cloud.css defines quiet light and dark colors for recent sync without overriding stuck', () => {
  assert.match(cssSrc, /\.rail-cloud\.recent\s*\{\s*color:\s*#4f8772;/);
  assert.match(cssSrc, /:root\[data-mode="dark"\]\s*\.rail-cloud\.recent:not\(\.stuck\)\s*\{\s*color:\s*#6ca18d;/);
  assert.ok(cssSrc.indexOf('.rail-cloud.recent') < cssSrc.indexOf('.rail-cloud.stuck'));
});

test('v1 hosted rail stays flat with or without relationship metadata and uses the existing project list request', async () => {
  const now = Date.UTC(2026, 10, 20);
  const lines = [
    { id:'parent', title:'Parent', shown:'notes', createdAt:now - 1000, orchestratorRef:'PE-800' },
    { id:'child', title:'Child', shown:'notes', createdAt:now, orchestratedBy:'PE-800' },
    { id:'plain', title:'Plain', shown:'notes', createdAt:now - 2000 },
  ];
  const { context, S, requests } = loadCloud({ now, projects:[], hosted:{ key:'here' }, hostedList:[{ key:'other', name:'Other', rail:lines }] });
  S.projects = await context.hostedProjects({ id:'here', name:'Here', lines });
  Object.assign(context, { EMBED:null, LINE_ORDER_KEY:'line-order', railLinePositions:{}, lineReads:{}, STATE_TEXT:{}, readLists:() => ({}), localStorage:{ getItem:() => null } });
  S.cur = 'here'; S.route = { view:'line', line:'child' };
  vm.runInContext(pagesSrc.slice(pagesSrc.indexOf('const RAIL_LINES ='), pagesSrc.indexOf("ACT['rail-new-line']")), context);

  for (const p of S.projects) {
    const html = context.railLines(p);
    assert.deepEqual([...html.matchAll(/data-line="([^"]+)"/g)].map(m => m[1]), ['child', 'parent', 'plain']);
    assert.doesNotMatch(html, /rail-disclosure|rail-sub-cue|rail-sub-count|role="group"/);
  }
  for (const row of S.projects[1].lines) {
    assert.equal(Object.hasOwn(row, 'orchestratorRef'), false);
    assert.equal(Object.hasOwn(row, 'orchestratedBy'), false);
  }
  assert.deepEqual(requests, ['/api/v1/line-projects']);
});

test('PE-1114: Cloud-only projects appear as clickable local rail links, archived Cloud projects stay hidden, and clicking opens the Cloud project page', () => {
  const now = Date.UTC(2026, 10, 24, 16, 0, 0);
  const opened = [];
  const projects = [{ id:'local-1', name:'Local App' }];
  const cloudProjects = [
    { key:'local-1', id:'local-1', name:'Local App', here:true, syncing:true },
    { key:'cloud-alpha', name:'Alpha Cloud', here:false, cloudMade:true, lines:2, sizeBytes:2048, updatedAt:now - 120000 },
    { key:'cloud-archived', name:'Archived Cloud', here:false, cloudMade:true, archived:true },
    { key:'remote-sync', name:'Other Mac', here:false },
  ];
  const ui = loadCloud({ now, projects, cloudProjects });
  ui.context.window = { open: (...args) => opened.push(args) };
  ui.context.closeSwitcher = () => { ui.context.switcherClosed = true; };
  ui.S.cloudAccount.origin = 'https://penecho.ai';

  const { afterHtml } = ui.runRail();
  assert.match(afterHtml, /^<hr>/, 'separator appears when local projects are present');
  assert.match(afterHtml, /data-act="open-cloud-project" data-key="cloud-alpha"/);
  assert.match(afterHtml, /title="Alpha Cloud · Open on penecho\.ai"/);
  assert.match(afterHtml, /title="Cloud-only project · Open on penecho\.ai"/);
  assert.match(afterHtml, /data-act="open-cloud-project" data-key="remote-sync"/);
  assert.equal(afterHtml.includes('cloud-archived'), false, 'archived Cloud projects are omitted from the active rail');
  assert.equal(afterHtml.includes('rail-cloud recent'), false, 'away and Cloud-only rows stay neutral');

  ui.context.ACT['open-cloud-project']({ dataset:{ key:'cloud-alpha' } });
  assert.equal(ui.context.switcherClosed, true);
  assert.deepEqual(opened, [['https://penecho.ai/lines/cloud-alpha', '_blank', 'noopener']]);

  // Without local projects, no leading divider is rendered before Cloud-only rows.
  ui.S.projects = [];
  const noLocal = ui.runRail();
  assert.equal(noLocal.afterHtml.startsWith('<hr>'), false);
  assert.match(noLocal.afterHtml, /data-key="cloud-alpha"/);
});

test('PE-1114: local project switcher lists Cloud-only projects under In PenEcho Cloud and opens their web page', () => {
  const now = Date.UTC(2026, 10, 24, 16, 0, 0);
  const projects = [{ id:'local-1', name:'Local App', pinned:false, archived:false, lines:[], landed:[] }];
  const cloudProjects = [
    { key:'cloud-beta', name:'Beta Cloud', here:false, cloudMade:true, lines:3, sizeBytes:4096, updatedAt:now - 60000 },
    { key:'cloud-old', name:'Old Cloud', here:false, cloudMade:true, archived:true },
  ];
  const ui = loadCloud({ now, projects, cloudProjects });
  ui.S.tabs = [];
  let swListHtml = '', swPreviewHtml = '';
  const els = {
    '#switcher': { hidden:false, contains:() => false },
    '#swList': { set innerHTML(v) { swListHtml = v; }, get innerHTML() { return swListHtml; } },
    '#swPreview': { set innerHTML(v) { swPreviewHtml = v; }, get innerHTML() { return swPreviewHtml; } },
  };
  Object.assign(ui.context, {
    $: sel => els[sel] || null,
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    summaryNeeds: () => 0,
    summaryWorking: () => 0,
    tabStatus: () => '',
    miniMap: () => '',
    stateChip: () => '',
    lineState: () => '',
  });
  const swChunk = pagesSrc.slice(pagesSrc.indexOf('const SW ='), pagesSrc.indexOf('async function openSwitcher()'));
  vm.runInContext(`${swChunk}\nthis.SW = SW;`, ui.context);
  ui.context.renderSwitcher();

  assert.match(swListHtml, /In PenEcho Cloud/);
  assert.match(swListHtml, /data-act="open-cloud-project" data-key="cloud-beta"/);
  assert.match(swListHtml, /Cloud-only · Open on penecho\.ai/);
  assert.equal(swListHtml.includes('cloud-old'), false, 'archived Cloud projects stay out of switcher');

  const cloudItem = ui.context.SW.list.find(item => item.key === 'cloud-beta');
  assert.ok(cloudItem);
  const preview = ui.context.previewHTML(cloudItem);
  assert.match(preview, /Cloud-only project/);
  assert.match(preview, /3 lines/);
  assert.match(preview, /data-act="open-cloud-project" data-key="cloud-beta">Open on penecho\.ai<\/button>/);
});
