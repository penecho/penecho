const assert = require('node:assert/strict');
const test = require('node:test');
const { TOOLS, validateToolArguments } = require('../src/server/mcp/schema.js');

test('document adapter exposes draw constraints and rejects excess items before browser RPC', async () => {
  const { createDocumentTools } = await import('../src/server/canvas-agent/document-tools.mjs');
  const { assertObjectJsonSchema } = await import('@deepseek-ai/dsh-tools');
  const calls = [];
  const session = {id:'schema-test', logicalConversationId:'schema-conversation', rpc:async (...args) => {
    calls.push(args);
    throw new Error('Invalid draw must never reach browser RPC');
  }};
  const draw = createDocumentTools(session).find(tool => tool.name === 'penecho_draw');
  assert.ok(draw);
  assert.doesNotThrow(() => assertObjectJsonSchema(draw.parameters));
  const items = draw.parameters.properties.items;
  assert.match(items.description, /"minItems":1,"maxItems":24/);
  assert.match(items.items.properties.strokeWidth.description, /"minimum":1,"maximum":12/);
  assert.match(items.items.description, /"allOf":.*"if":.*"rect","ellipse".*"then":.*"width":\{"minimum":80\},"height":\{"minimum":80\}/);
  await assert.rejects(draw.execute({
    artifactId:'diagram', requestId:'request', title:'Diagram',
    items:Array.from({length:25}, (_, index) => ({id:`rect-${index}`,type:'rect'})),
  }, {callId:'call',signal:new AbortController().signal}), error => {
    assert.equal(error.code, 'invalid_arguments');
    assert.match(error.message, /items has 25 entries; expected 1\.\.24/);
    return true;
  });
  assert.deepEqual(calls, []);
});

test('all public tool schemas remain SDK supported with model-visible execution constraints', async () => {
  const { harnessDocumentSchema } = await import('../src/server/canvas-agent/document-schema.mjs');
  const { assertSupportedJsonSchema, assertObjectJsonSchema } = await import('@deepseek-ai/dsh-tools');
  for (const tool of TOOLS) {
    const original = structuredClone(tool.inputSchema);
    const schema = harnessDocumentSchema(tool.inputSchema);
    assert.doesNotThrow(() => assertSupportedJsonSchema(schema), tool.name);
    assert.doesNotThrow(() => assertObjectJsonSchema(schema), tool.name);
    assert.deepEqual(tool.inputSchema, original);
  }
  const draw = harnessDocumentSchema(TOOLS.find(tool => tool.name === 'penecho_draw').inputSchema);
  const items = draw.properties.items;
  assert.match(items.description, /"minItems":1,"maxItems":24/);
  assert.match(items.items.properties.strokeWidth.description, /"minimum":1,"maximum":12/);
  assert.match(items.items.properties.points.description, /"minItems":2,"maxItems":256/);
  assert.match(items.items.description, /"allOf":.*"if":.*"rect","ellipse".*"then":.*"width":\{"minimum":80\},"height":\{"minimum":80\}/);
});

test('nested constraints remain lossless annotations without rewriting literal data', async () => {
  const { harnessDocumentSchema } = await import('../src/server/canvas-agent/document-schema.mjs');
  const { assertObjectJsonSchema } = await import('@deepseek-ai/dsh-tools');
  const literal = {minimum:7, properties:{maxItems:12}, pattern:'x'};
  const conditions = {allOf:[{if:{required:['x']},then:{not:{anyOf:[{required:['y']},{required:['z']}]}}}]};
  const input = {type:'object', ...conditions, default:literal, examples:[literal], properties:{
    x:{type:'array', minItems:1, uniqueItems:true, items:{type:'string', minLength:2, maxLength:4, pattern:'^[a-z]+$', enum:['ab'], const:'ab'}},
    y:{type:'object', additionalProperties:{type:'number', minimum:3}},
  }};
  const output = harnessDocumentSchema(input);
  assert.doesNotThrow(() => assertObjectJsonSchema(output));
  assert.ok(output.description.endsWith(JSON.stringify(conditions)));
  assert.deepEqual(output.default, literal);
  assert.deepEqual(output.examples, [literal]);
  assert.deepEqual(output.properties.x.items.enum, ['ab']);
  assert.equal(output.properties.x.items.const, 'ab');
  assert.match(output.properties.x.items.description, /"minLength":2,"maxLength":4,"pattern":"\^\[a-z\]\+\$"/);
  assert.match(output.properties.y.description, /"additionalProperties":\{"type":"number","minimum":3\}/);
});

test('draw rejection exposes actionable counts and ranges and never arbitrary invalid values', () => {
  const base = {sessionId:'s', artifactId:'a', requestId:'r', title:'Diagram'};
  const reject = (items, pattern) => assert.throws(() => validateToolArguments('penecho_draw', {...base, items}), error => {
    assert.equal(error.code, 'invalid_arguments');
    assert.equal(error.status, 400);
    assert.match(error.message, pattern);
    return true;
  });
  reject(Array.from({length:25}, (_, i) => ({id:String(i), type:'rect'})), /items has 25 entries; expected 1\.\.24/);
  reject([{id:'p',type:'path',points:Array.from({length:257}, () => ({x:0,y:0}))}], /points has 257 points; expected 2\.\.256/);
  reject([{id:'r',type:'rect',strokeWidth:13}], /strokeWidth.*1\.\.12.*received 13/);
  reject([{id:'r',type:'rect',x:-1,y:0}], /\.x.*0\.\.2400.*received -1/);
  reject([{id:'r',type:'rect',width:40}], /width.*80\.\.1200.*received 40/);
  reject([{id:'e',type:'ellipse',height:40}], /height.*80\.\.1200.*received 40/);
  reject([{id:'l',type:'line',points:[{x:0,y:0},{x:1,y:1},{x:2,y:2}]}], /has 3 points; expected exactly 2/);
  reject([{id:'r',type:'rect',strokeWidth:'PRIVATE SOURCE CONTENT'}], /received string/);
  assert.throws(() => validateToolArguments('penecho_draw', {...base,items:[{id:'r',type:'rect',width:{source:'PRIVATE SOURCE CONTENT'}}]}), error => !error.message.includes('PRIVATE SOURCE CONTENT'));
  assert.equal(validateToolArguments('penecho_draw', {...base,items:[{id:'r',type:'rect',width:80,strokeWidth:12,x:0,y:0}]}).items[0].width, 80);
});
