"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');
const LINE_STATUS = require('../public/lines/line-status.js');

function harness() {
  const { document, window } = parseHTML('<html><body></body></html>');
  const context = vm.createContext({
    LINE_STATUS, document, window, ACT:{}, SEND:{}, HOSTED:false, EMBED:null,
    esc:String, ic:name => `<i data-icon="${name}"></i>`, addEventListener() {},
    localStorage:{ getItem:() => null }, projectsToggleHTML:() => '', navigator:{ platform:'Mac' },
  });
  for (const name of ['state', 'line', 'panorama']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../public/lines/${name}.js`), 'utf8'), context);
  }
  const render = html => {
    const container = document.createElement('div');
    container.innerHTML = html;
    return container;
  };
  return { context, render };
}

const ask = extra => ({ id:'ask-1', index:0, kind:'ask', state:'done', ...extra });
const stopped = extra => ({ id:'work-1', index:1, kind:'work', state:'off', off:'stopped', reviewed:true, ...extra });
const finished = extra => ({ id:'one', title:'A Line', status:'done', landed:true, stations:[ask(), stopped()], questions:[], ...extra });

test('reviewed needs a finished Line, evidence of review, and no unfinished obligations', () => {
  const { lineReviewed } = LINE_STATUS;
  assert.equal(lineReviewed(finished({ branch:'main', commit:'abc123' })), true);
  assert.equal(lineReviewed(finished({ stations:[ask({ finishedAsk:true })] })), true);
  assert.equal(lineReviewed(finished({ status:'ready' })), true);
  for (const extra of [
    { archived:true }, { closed:true }, { running:true }, { elsewhere:true }, { asking:{} },
    { questions:[{ text:'What next?' }] }, { todo:true }, { status:'working' }, { status:'not-started' },
    { stations:[ask()] }, { stations:[stopped({ state:'active' })] },
    { commit:'abc123', stations:[ask({ finishedAsk:true }), stopped({ reviewed:false })] },
  ]) assert.equal(lineReviewed(finished(extra)), false, JSON.stringify(extra));
});

test('header, end card, stop row, home lane and sub-Line agree across polls without a Merged status', () => {
  const { context, render } = harness();
  for (const [line, word, icon] of [
    [finished({ branch:'main' }), 'Reviewed', 'check'],
    [finished({ branch:'main', commit:'abc123' }), 'Reviewed', 'check'],
    [finished({ status:'ready', branch:'feature', landed:false }), 'Reviewed', 'check'],
    [finished(), 'Reviewed', 'check'],
    [finished({ stations:[ask({ finishedAsk:true })] }), 'Reviewed', 'check'],
    [finished({ branch:'main', commit:'abc123', stations:[ask()] }), 'Finished', 'check'],
    [finished({ stations:[ask(), stopped({ off:'discarded', reviewed:false })] }), 'Finished', 'check'],
    [finished({ branch:'main', stations:[ask(), stopped({ reviewed:false })] }), 'To review', 'eye'],
    [finished({ branch:'main', commit:'abc123', stations:[ask(), stopped({ reviewed:false })] }), 'To review', 'eye'],
    [finished({ branch:'main', todo:true }), 'Todo', 'box'],
  ]) {
    const state = { format:2, project:{ id:'p', trunk:'main' }, lines:[line], landed:[], backlog:[] };
    for (let poll = 0; poll < 3; poll++) {
      state.rev = `rev-${poll}`;
      const project = context.adoptState(state);
      const stop = line.stations.at(-1);
      const chip = render(context.stateChip(LINE_STATUS.lineState(line), line));
      const card = render(context.endItem(project, line, stop));
      const row = render(context.stopRow(project, line, stop, stop.index));
      const lane = render(context.laneStateHTML(project, line));
      assert.equal(chip.textContent, word);
      assert.equal(card.querySelector('strong').textContent, word);
      assert.equal(row.querySelector('.lps-end').textContent, word);
      assert.equal(context.stopWords(stop), word);
      assert.equal(lane.textContent, word);
      assert.equal(context.subLineStatusInfo(line).label, word);
      assert.equal(card.querySelector('.nd i').dataset.icon, icon);
      assert.equal(row.querySelector('.lps-node i').dataset.icon, icon);
      assert.equal(line.stations.filter(station => ['merge', 'deliver'].includes(station.kind)).length, 1);
      assert.equal(stop.label, 'Finished');
      assert.doesNotMatch(chip.innerHTML + card.innerHTML + row.innerHTML + lane.innerHTML, /Merged/);
      if (line.status === 'ready' && line.branch === 'feature') {
        assert.match(context.lineHeadActions(project, line, 'ready', stop), /data-act="merge-now"/);
      }
    }
  }
});

test('legacy merge stops keep Git details but not a Merged status label or icon', () => {
  const { context, render } = harness();
  const legacy = { id:'merge', index:2, kind:'merge', state:'done', label:'Merged', out:'Merged into main as abc123' };
  const line = finished({ status:'landed', archived:true, branch:'feature', commit:'abc123', stations:[ask(), stopped(), legacy] });
  const project = context.adoptState({ format:2, project:{ id:'p' }, lines:[], landed:[line], backlog:[] });
  assert.equal(render(context.stateChip('landed', line)).textContent, 'Archived');
  assert.equal(render(context.endItem(project, line, legacy)).querySelector('strong').textContent, 'Finished');
  assert.equal(context.subLineStatusInfo(line).label, 'Archived');
  assert.equal(legacy.label, 'Finished');
  assert.match(context.panelBody(project, line, legacy), /Merged into main as abc123/);
  assert.equal(context.stopWords({ kind:'merge', state:'todo' }), 'Not finished');
});
