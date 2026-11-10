"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const {PassThrough} = require('node:stream');
const {PenEchoStdioServer,PROMPTS} = require('../src/server/mcp/stdio');
const {TOOLS} = require('../src/server/mcp/schema');
const {RESOURCES,DISCOVERY_URI,SKILL_URI} = require('../src/server/mcp/resources');

test('stdio resources require initialization and expose current discovery and live skill', async t => {
  const input=new PassThrough(),output=new PassThrough();
  const server=new PenEchoStdioServer({input,output}).start();
  t.after(()=>{server.close();input.end();});
  let id=0;
  const rpc=(method,params)=>new Promise(resolve=>{output.once('data',data=>resolve(JSON.parse(data.toString())));input.write(JSON.stringify({jsonrpc:'2.0',id:++id,method,params})+'\n');});
  assert.equal((await rpc('resources/list')).error.code,-32002);
  const initialized=await rpc('initialize');
  assert.deepEqual(initialized.result.capabilities.resources,{subscribe:false,listChanged:false});
  assert.deepEqual((await rpc('resources/list')).result.resources,RESOURCES);
  assert.deepEqual((await rpc('resources/templates/list')).result,{resourceTemplates:[]});
  const discovery=(await rpc('resources/read',{uri:DISCOVERY_URI})).result.contents[0];
  assert.equal(discovery.mimeType,'text/markdown');
  for(const entry of [...TOOLS,...PROMPTS])assert(discovery.text.includes(entry.name));
  for(const method of ['tools/list','prompts/list','prompts/get','resources/list','resources/read','tools/call'])assert(discovery.text.includes(method));
  assert.match(discovery.text,/refresh or reconnect/);
  assert.match(discovery.text,/not automatically overwritten/);
  const skill=(await rpc('resources/read',{uri:SKILL_URI})).result.contents[0].text;
  assert.match(skill,/echo/);assert.match(skill,/画布/);assert.match(skill,/static bootstrap/);
  for(const params of [{uri:'penecho://missing'}, {}, {uri:42}])assert.equal((await rpc('resources/read',params)).error.code,-32602);
});
