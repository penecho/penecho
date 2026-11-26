'use strict';
require('./helpers/safety.js');
// Release check 2026-11-19 (PE-714): the regressions behind its P0 and P1 findings.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('a Canvas bundle without a preview (a new blank project Canvas on penecho.ai) still opens', () => {
  const source = read('src/client/app/persistence.js');
  assert.doesNotMatch(source, /Canvas bundle has no preview/);
  assert.match(source, /preview:previewAsset \? snapshotBundleAssetBlob\(previewAsset\) : dataUrlBlob\(/);
});

test('a new project on penecho.ai is in the project list before its address opens', () => {
  const source = read('public/lines/hosted.js'), make = source.slice(source.indexOf('function hostedNewProject'), source.indexOf('function hostedRekey'));
  assert.ok(make.indexOf('await loadProjects()') > 0 && make.indexOf('await loadProjects()') < make.indexOf('hostedGo('));
});

test('Notes & AI starts closed on narrow/phone widths and never runs under the rail', () => {
  assert.match(read('src/client/app/project-lines-bridge.js'), /projectLinesPanelShow\(!matchMedia\("\(max-width: 900px\)"\)\.matches\)/);
  assert.match(read('public/project-lines-entry.css'), /\.project-lines-panel \{[^}]*max-width:100%/);
});

test('the project Share button keeps its name when its word is hidden', () => {
  assert.match(read('public/lines/pages.js'), /class="canvas-link bar-share" data-act="project-share" aria-label="Share project"/);
  assert.match(read('public/lines/cloud.js'), /share\.setAttribute\('aria-label'/);
});

test('a search that misses among favourites does not say there are none', () => {
  const source = read('public/lines/files.js'), start = source.indexOf('function flEmptyWords'), end = source.indexOf('\n}\n', start) + 2;
  const ctx = { st:{ q:'', fav:true, who:'all', kind:'all', size:'', usage:'' }, favs:new Set(['a.txt']) };
  vm.runInNewContext(`const flState = () => st; const flIsFav = (p, key) => favs.has(key); ${source.slice(start, end)}; this.words = flEmptyWords;`, ctx);
  const all = [{ key:'a.txt' }];
  ctx.st.q = 'missing';
  assert.equal(ctx.words({}, all), 'No favourites match.');
  ctx.favs.clear();
  assert.equal(ctx.words({}, all), 'No favourites yet.');
  ctx.st.fav = false;
  assert.equal(ctx.words({}, all), 'No files match.');
  ctx.st.q = '';
  assert.equal(ctx.words({}, []), 'No Canvases or files yet.');
});
