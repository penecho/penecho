'use strict';
require('./helpers/safety.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const readPublic = (...parts) => fs.readFileSync(path.join(__dirname, '../public', ...parts), 'utf8');

function renderNewProject({ hosted = false } = {}) {
  const startCtx = vm.createContext({ window: {} });
  vm.runInContext(readPublic('lines', 'start.js'), startCtx);
  const pagesSource = readPublic('lines', 'pages.js');
  const start = pagesSource.indexOf('const newProjectHTML = () =>');
  const end = pagesSource.indexOf('function mountNewProject()', start);
  assert.ok(start !== -1 && end > start, 'newProjectHTML definition should exist in pages.js');
  const fnCtx = vm.createContext({
    PenEchoProjects: startCtx.window.PenEchoProjects,
    S: { agents: [] },
    HOSTED: hosted,
  });
  vm.runInContext(`${pagesSource.slice(start, end)}\nthis.out = newProjectHTML();`, fnCtx);
  return fnCtx.out;
}

test('New project places the 8 equal points above the Create project form without a proof link', () => {
  const localHtml = renderNewProject({ hosted: false });
  const headIdx = localHtml.indexOf('class="np-head"');
  const givesIdx = localHtml.indexOf('class="np-gives"');
  const cardIdx = localHtml.indexOf('class="np-card"');
  assert.ok(headIdx > 0 && givesIdx > headIdx && cardIdx > givesIdx, 'Expected np-head -> np-gives -> np-card');
  assert.match(localHtml, /Not another AI agent\. A better way to work with yours\./);
  assert.equal((localHtml.match(/class="pls-point"/g) || []).length, 8);
  assert.equal((localHtml.match(/class="pls-art pls-pt-svg"/g) || []).length, 8);
  assert.doesNotMatch(localHtml, /class="pls-main"|class="pls-gain"|See proof/);
  assert.match(localHtml, /Every task shows why tokens were saved\./);

  const hostedHtml = renderNewProject({ hosted: true });
  assert.ok(hostedHtml.indexOf('class="np-gives"') < hostedHtml.indexOf('class="np-card"'));
  assert.equal((hostedHtml.match(/class="pls-point"/g) || []).length, 8);
  assert.doesNotMatch(hostedHtml, /Orchestrator/);
});

test('New project and empty Canvas CSS define an 8-point 2x4 grid above the centered Create project form', () => {
  const css = readPublic('lines', 'lines.css');
  const entryCss = readPublic('project-lines-entry.css');
  assert.match(css, /\.np-page\s*\{[^}]*container:\s*np-page\s*\/\s*inline-size;/);
  assert.match(css, /\.np-grid\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
  assert.match(css, /\.np-grid\s*>\s*\.np-card\s*\{[^}]*width:\s*min\(680px,\s*100%\);[^}]*margin:\s*0 auto;/);
  assert.match(entryCss, /\.pls-points\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(entryCss, /@container\s+pls-gains\s*\(max-width:\s*640px\)\s*\{[^}]*\.pls-points\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(entryCss, /#canvasWelcome\s+\.pls:has\(>\s*\.pls-hero\)\s+\.pls-points/);
});
