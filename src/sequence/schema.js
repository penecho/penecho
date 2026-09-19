"use strict";

const { validateArchitecture } = require('../architecture/schema.js');

// Semantic-only input. Shared metadata uses the architecture palette and text limits;
// chronology, references and ranges are validated here before any browser work.
function validateSequence(value) {
  const fail = message => { throw new Error(`Sequence: ${message}`); };
  const object = (v, name, keys) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${name} must be an object`);
    for (const key of Object.keys(v)) if (!keys.includes(key)) fail(`${name}.${key} is not supported`);
  };
  const array = (v, name, max) => {
    if (!Array.isArray(v) || v.length > max) fail(`${name} must be an array (max ${max})`);
    return v;
  };
  const text = (v, name, max) => {
    if (typeof v !== 'string' || !v.trim() || v.length > max) fail(`${name} must be nonempty text (max ${max})`);
  };
  if (value && typeof value === 'object' && ['sessionId','artifactId','requestId'].some(key => key in value)) fail('sessionId, artifactId and requestId belong beside sequence in tool arguments, not inside it');
  object(value, 'diagram', ['version','title','description','domains','participants','messages','activations','fragments','details','notes']);
  const participants = array(value.participants, 'participants', 16);
  for (const p of participants) object(p, 'participant', ['id','label','subtitle','type','domain','details']);
  const messages = array(value.messages, 'messages', 120);
  if (!messages.length) fail('messages cannot be empty');
  for (const m of messages) {
    object(m, 'message', ['id','from','to','label','kind','note','details']);
    text(m.label, 'message.label', 120);
    if (m.kind !== undefined && !['call','return','async'].includes(m.kind)) fail(`unknown message kind ${m.kind}`);
    if (m.note !== undefined) text(m.note, 'message.note', 400);
    for (const item of array(m.details ?? [], 'message.details', 12)) text(item, 'message detail', 1000);
  }
  try {
    validateArchitecture({version:value.version,title:value.title,description:value.description,domains:value.domains,
      nodes:participants,edges:messages.map(({id,from,to,label}) => ({id,from,to,label})),details:value.details,notes:value.notes});
  } catch (error) { fail(error.message.replace(/^Architecture: /,'').replace(/node/g,'participant').replace(/edge/g,'message')); }
  const indices = new Map(messages.flatMap((m,i) => m.id === undefined ? [] : [[m.id,i]]));
  const range = (v, name) => {
    if (!indices.has(v.from) || !indices.has(v.to)) fail(`${name}.from/to must reference explicit message ids`);
    const start=indices.get(v.from), end=indices.get(v.to);
    if (end < start) fail(`${name}.to must not precede from`);
    return {start,end};
  };
  const activations = array(value.activations ?? [], 'activations', 80).map(a => {
    object(a,'activation',['participant','from','to']);
    if (!participants.some(p => p.id === a.participant)) fail(`unknown activation participant ${a.participant}`);
    return {...range(a,'activation'),participant:a.participant};
  });
  const fragments = array(value.fragments ?? [], 'fragments', 24).map(f => {
    object(f,'fragment',['kind','label','from','to','branches']);
    if (!['alt','opt','loop','par','critical'].includes(f.kind)) fail(`unknown fragment kind ${f.kind}`);
    text(f.label,'fragment.label',160);
    const r=range(f,'fragment');
    const branches=array(f.branches ?? [],'fragment.branches',12);
    if (branches.length && !['alt','par'].includes(f.kind)) fail('branches are supported only in alt/par fragments');
    let last=r.start;
    for (const b of branches) {
      object(b,'branch',['from','label']); text(b.label,'branch.label',160);
      const index=indices.get(b.from);
      if (index === undefined || index <= last || index > r.end) fail('branch.from must be ordered, distinct message ids after the fragment start and within its range');
      last=index;
    }
    return {...r,branches:branches.map(b => indices.get(b.from))};
  });
  const contains = (a,b) => a.start <= b.start && a.end >= b.end;
  for (const ranges of [fragments,activations]) for (let i=0;i<ranges.length;i++) {
    const a=ranges[i];
    for (const b of ranges.slice(i+1)) {
      if (a.participant !== b.participant || a.end < b.start || b.end < a.start) continue;
      if ((!contains(a,b) && !contains(b,a)) || (a.start === b.start && a.end === b.end)) fail('overlapping ranges must be strictly nested or disjoint');
    }
    if (ranges.filter(b => b !== a && b.participant === a.participant && contains(b,a)).length >= 4) fail('range nesting exceeds 4');
  }
  // A nested fragment cannot straddle alternatives of its enclosing fragment.
  for (const a of fragments) for (const b of fragments) if (a !== b && contains(a,b) && a.branches.some(i => b.start < i && b.end >= i)) fail('nested fragment must stay within one parent branch');
  if (JSON.stringify(value).length > 60000) fail('diagram exceeds 60000 characters');
  return JSON.parse(JSON.stringify(value));
}

function sequenceHtml(value, options = {}) {
  const data=validateSequence(value);
  const json=JSON.stringify(data).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
  const language=String(options.language || '').toLowerCase().startsWith('zh')?'zh-CN':'en',loading=language==='zh-CN'?'正在布局时序图…':'Laying out sequence diagram…';
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"></head><body><section data-penecho-sequence><script type="application/json" data-sequence-source>${json}</script><p role="status">${loading}</p></section></body></html>`;
}
module.exports = { validateSequence, sequenceHtml };
