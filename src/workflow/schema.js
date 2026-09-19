"use strict";
const {validateArchitecture} = require('../architecture/schema.js');
const TYPES = ['start','process','decision','fork','join','end'];

function validateWorkflow(value) {
  const fail = message => { throw new Error(`Workflow: ${message}`); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('diagram must be an object');
  if (['sessionId','artifactId','requestId'].some(key => key in value)) fail('sessionId, artifactId and requestId belong beside workflow, not inside it');
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) fail('nodes and edges are required arrays');
  for (const node of value.nodes) if (!node || !TYPES.includes(node.type)) fail(`node.type is required: ${TYPES.join(', ')}`);
  for (const edge of value.edges) {
    if (!edge || (edge.kind !== undefined && !['flow','loop'].includes(edge.kind))) fail('edge.kind must be flow or loop');
    if ('bidirectional' in edge) fail('workflow edges have one direction; use a separate directed edge');
  }
  // Reuse only semantic validation, not architecture node shapes or layout policy.
  try {
    validateArchitecture({...value, nodes:value.nodes.map(n => ({...n,type:'backend'})),
      edges:value.edges.map(e => ({...e,kind:e.kind === 'loop' ? 'return' : 'call'}))});
  } catch (error) { fail(error.message.replace(/^Architecture: /,'')); }
  const outgoing = new Map(value.nodes.map(n => [n.id,[]]));
  const incoming = new Map(value.nodes.map(n => [n.id,[]]));
  for (const edge of value.edges) { outgoing.get(edge.from).push(edge); incoming.get(edge.to).push(edge); }
  for (const node of value.nodes) {
    const out = outgoing.get(node.id), inc = incoming.get(node.id);
    if (node.type === 'start' && inc.length) fail(`start ${node.id} cannot have incoming edges`);
    if (node.type === 'end' && out.length) fail(`end ${node.id} cannot have outgoing edges`);
    if (node.type === 'decision') {
      if (out.length < 2 || out.some(e => !e.label?.trim())) fail(`decision ${node.id} needs at least two outgoing edges, each with a condition label`);
      if (new Set(out.map(e => e.label.trim())).size !== out.length) fail(`decision ${node.id} conditions must be distinct`);
    } else if (node.type === 'fork') {
      if (out.length < 2) fail(`fork ${node.id} needs at least two outgoing edges`);
    } else if (out.length > 1) fail(`${node.id} has multiple outgoing edges; use a decision or fork`);
    if (node.type === 'join' && inc.length < 2) fail(`join ${node.id} needs at least two incoming edges`);
    if (out.some(e => e.kind === 'loop' && !e.label?.trim())) fail(`loop from ${node.id} needs a condition or retry label`);
  }
  const visited = new Set(), visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) fail('cycles must identify their returning edge with kind:loop');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of outgoing.get(id)) if (edge.kind !== 'loop') visit(edge.to);
    visiting.delete(id); visited.add(id);
  }
  value.nodes.forEach(n => visit(n.id));
  return JSON.parse(JSON.stringify(value));
}

function workflowHtml(value, options = {}) {
  const data = validateWorkflow(value);
  const json = JSON.stringify(data).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
  const language=String(options.language || '').toLowerCase().startsWith('zh')?'zh-CN':'en',loading=language==='zh-CN'?'正在布局流程图…':'Laying out workflow…';
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"></head><body><section data-penecho-workflow><script type="application/json" data-workflow-source>${json}</script><p role="status">${loading}</p></section></body></html>`;
}
module.exports = {validateWorkflow,workflowHtml,TYPES};
