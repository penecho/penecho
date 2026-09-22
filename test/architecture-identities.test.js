'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ELK = require('elkjs/lib/elk.bundled.js');
const {architectureHtml} = require('../src/architecture/schema.js');

function diagram(grouped, collision, direction) {
  const from = collision ? (grouped ? 'g_gateway' : 'n_gateway') : 'gateway';
  return {
    version: 1, title: 'Gateway request', direction,
    ...(grouped ? {groups: [{id: 'gateway_out', label: 'Service boundary'}]} : {}),
    nodes: [{id: from, label: 'Gateway'}, {
      id: grouped ? 'api' : 'gateway_out', label: 'API',
      ...(grouped ? {group: 'gateway_out'} : {}),
    }],
    edges: [{from, to: grouped ? 'api' : 'gateway_out', label: 'Request'}],
  };
}

function port(node, direction, output) {
  return direction === 'DOWN'
    ? [node.x + node.width / 2, node.y + (output ? node.height : 0)]
    : [node.x + (output ? node.width : 0), node.y + node.height / 2];
}

for (const grouped of [false, true]) for (const direction of ['RIGHT', 'DOWN']) {
  test(`architecture ${grouped ? 'group' : 'node'} IDs preserve declared endpoints in ${direction}`, async () => {
    const {layoutArchitecture} = await import('../src/architecture/layout.mjs');
    const {renderSvg} = await import('../src/architecture/render.mjs');
    for (const collision of [false, true]) {
      const input = diagram(grouped, collision, direction);
      const reopened = JSON.parse(architectureHtml(input).match(/data-architecture-source>(.*?)<\/script>/s)[1]);
      assert.deepEqual(reopened, input);
      const layout = await layoutArchitecture(reopened, new ELK());
      assert.deepEqual(layout.issues, []);
      const edge = layout.edges[0];
      assert.deepEqual(edge.sections[0][0], port(layout.nodes.find(n => n.id === edge.from), direction, true));
      assert.deepEqual(edge.sections.at(-1).at(-1), port(layout.nodes.find(n => n.id === edge.to), direction, false));
      assert.match(renderSvg(layout), /data-edge-id=/);
    }
  });
}

test('architecture graph identities remain unique across nodes, groups, ports and edges', async () => {
  const {buildGraph} = await import('../src/architecture/layout.mjs');
  for (const grouped of [false, true]) {
    const {graph} = buildGraph(diagram(grouped, true, 'RIGHT'));
    const ids = [];
    function collect(item) {
      ids.push(item.id);
      for (const child of [...(item.children || []), ...(item.ports || []), ...(item.edges || [])]) collect(child);
    }
    collect(graph);
    assert.equal(new Set(ids).size, ids.length);
  }
});
